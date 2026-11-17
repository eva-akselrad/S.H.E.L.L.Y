package com.evaakselrad.shelly.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.evaakselrad.shelly.BuildConfig
import com.evaakselrad.shelly.GlanceParser
import com.evaakselrad.shelly.Notifier
import com.evaakselrad.shelly.Prefs
import com.evaakselrad.shelly.R
import com.evaakselrad.shelly.Site
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Self-update for the sideloaded app. Checks /api/android/latest.json, downloads the APK, and installs it
 * only if (1) the SHA-256 and size match, and (2) it is SHELLY signed with the very same certificate as
 * the installed app. Anything else is refused. Blocking: call from a background thread.
 */
object Updater {
    private const val TAG = "ShellyUpdate"
    const val ACTION_RESULT = "com.evaakselrad.shelly.INSTALL_RESULT"
    private const val NOTIF_ID = 7100

    enum class Outcome { UP_TO_DATE, NOT_DUE, BLOCKED_BY_WARNING, NEEDS_PERMISSION, REFUSED, DOWNLOAD_FAILED, INSTALL_STARTED, NO_RELEASE }

    fun canInstall(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

    fun check(context: Context, force: Boolean = false, nowMs: Long = System.currentTimeMillis()): Outcome {
        val app = context.applicationContext
        val prefs = Prefs(app)
        if (!UpdateRules.checkDue(prefs.lastUpdateCheckMs, nowMs, force)) return Outcome.NOT_DUE
        val json = get("${Site.url(app)}/api/android/latest.json") ?: return Outcome.NO_RELEASE
        prefs.lastUpdateCheckMs = nowMs
        val release = Release.parse(json) ?: return Outcome.NO_RELEASE
        if (!UpdateRules.shouldUpdate(BuildConfig.VERSION_CODE, Build.VERSION.SDK_INT, release)) return Outcome.UP_TO_DATE

        // never install while a warning covers the phone
        val glance = prefs.lastGlance?.let { GlanceParser.parse(it) }
        val rank = glance?.alerts?.filter { it.expiresMs == 0L || it.expiresMs > nowMs }?.maxOfOrNull { it.rank } ?: 0
        if (UpdateRules.blockedByActiveWarning(rank)) {
            prefs.lastUpdateCheckMs = 0 // look again on the next run instead of waiting six hours
            return Outcome.BLOCKED_BY_WARNING
        }

        if (!canInstall(app)) {
            notify(app, "Allow SHELLY to install updates", "SHELLY ${release.versionName} is ready. Tap, then turn on \"Allow from this source\".", settingsIntent(app))
            return Outcome.NEEDS_PERMISSION
        }

        val file = File(File(app.cacheDir, "update").apply { mkdirs() }, "shelly-${release.versionCode}.apk")
        if (!download("${Site.url(app)}/api/android/shelly.apk", file, release)) {
            file.delete()
            return Outcome.DOWNLOAD_FAILED
        }
        if (!sameSigner(app, file, release.versionCode)) {
            Log.w(TAG, "refused: APK is not signed like the installed app")
            file.delete()
            notify(app, "Update refused", "The downloaded update was not signed by SHELLY, so it was not installed.", null)
            return Outcome.REFUSED
        }
        install(app, file)
        return Outcome.INSTALL_STARTED
    }

    private fun get(url: String): String? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000
        c.readTimeout = 15_000
        try { if (c.responseCode == 200) c.inputStream.bufferedReader().use { it.readText() } else null } finally { c.disconnect() }
    } catch (_: Exception) {
        null
    }

    /** Streams to disk while hashing, and checks size and SHA-256 against latest.json. */
    private fun download(url: String, to: File, r: Release): Boolean = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 15_000
        c.readTimeout = 60_000
        try {
            if (c.responseCode != 200) false else {
                val md = MessageDigest.getInstance("SHA-256")
                var total = 0L
                c.inputStream.use { input ->
                    to.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            total += n
                            if (total > r.size) return@use // longer than promised: stop, the check below fails
                            md.update(buf, 0, n)
                            out.write(buf, 0, n)
                        }
                    }
                }
                total == r.size && UpdateRules.hex(md.digest()) == r.sha256
            }
        } finally {
            c.disconnect()
        }
    } catch (_: Exception) {
        false
    }

    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo?): Set<String> {
        val s = info?.signingInfo ?: return emptySet()
        val sigs = if (s.hasMultipleSigners()) s.apkContentsSigners else s.signingCertificateHistory
        return sigs.map { UpdateRules.sha256(it.toByteArray()) }.toSet()
    }

    /** True only if the APK is our package, the promised version, and signed by a certificate the installed app has. */
    fun sameSigner(context: Context, apk: File, expectedCode: Int): Boolean = try {
        val pm = context.packageManager
        val flags = PackageManager.GET_SIGNING_CERTIFICATES
        val candidate = pm.getPackageArchiveInfo(apk.path, flags)
        val installed = pm.getPackageInfo(context.packageName, flags)
        candidate != null &&
            candidate.packageName == context.packageName &&
            candidate.longVersionCode == expectedCode.toLong() &&
            signers(candidate).isNotEmpty() &&
            signers(candidate).intersect(signers(installed)).isNotEmpty()
    } catch (_: Exception) {
        false
    }

    private fun install(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(context.packageName)
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            apk.inputStream().use { input -> session.openWrite("shelly.apk", 0, apk.length()).use { out -> input.copyTo(out); session.fsync(out) } }
            val pi = PendingIntent.getBroadcast(
                context,
                id,
                Intent(ACTION_RESULT).setPackage(context.packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE, // the system fills in the status extras
            )
            session.commit(pi.intentSender)
        }
    }

    private fun settingsIntent(context: Context): Intent =
        Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, android.net.Uri.parse("package:${context.packageName}"))

    /** Notification on the "App updates" channel; tapping runs [intent] (an activity). */
    fun notify(context: Context, title: String, text: String, intent: Intent?) {
        Notifier.createChannels(context)
        val b = NotificationCompat.Builder(context, Notifier.CH_APP)
            .setSmallIcon(R.drawable.ic_stat_shelly)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setAutoCancel(true)
        if (intent != null) {
            b.setContentIntent(PendingIntent.getActivity(context, NOTIF_ID, intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
        try {
            if (NotificationManagerCompat.from(context).areNotificationsEnabled()) NotificationManagerCompat.from(context).notify(NOTIF_ID, b.build())
        } catch (_: SecurityException) {
        }
    }
}
