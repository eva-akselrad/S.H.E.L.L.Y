package com.evaakselrad.shelly

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

object Notifier {
    const val CH_WARNINGS = "warnings"
    const val CH_WATCHES = "watches"
    const val CH_APP = "app"
    const val CH_ANNOUNCE = "announcements"
    private const val ANNOUNCE_ID = 7700
    private const val TEST_ID = 7001

    /** Safe to call repeatedly; Android keeps the user's changes to existing channels. */
    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)

        val alarm = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val warnings = NotificationChannel(CH_WARNINGS, "Warnings", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Tornado, severe thunderstorm, flash flood and other warnings for where you are"
            setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), alarm)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 500, 250, 500, 250, 800)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setBypassDnd(true) // takes effect once the user allows it in the channel settings
        }
        val watches = NotificationChannel(CH_WATCHES, "Watches & advisories", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Watches and advisories for where you are"
        }
        val app = NotificationChannel(CH_APP, "App updates", NotificationManager.IMPORTANCE_LOW).apply {
            description = "SHELLY app updates"
        }
        val announce = NotificationChannel(CH_ANNOUNCE, "Announcements", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Messages from SHELLY"
        }
        nm.createNotificationChannels(listOf(warnings, watches, app, announce))
    }

    private fun canPost(context: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    private fun openApp(context: Context, requestCode: Int): PendingIntent =
        PendingIntent.getActivity(
            context,
            requestCode,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /** "Until 4:30 PM" in the place's own time zone; empty when the alert has no end time. */
    fun untilText(expiresMs: Long, tz: String): String {
        if (expiresMs <= 0) return ""
        val zone = try { ZoneId.of(tz) } catch (_: Exception) { ZoneId.systemDefault() }
        return "Until " + DateTimeFormatter.ofPattern("h:mm a", Locale.US).withZone(zone).format(Instant.ofEpochMilli(expiresMs)) + "."
    }

    /** All wording comes from the alert (NWS fields plus the server's templates). Nothing is invented here. */
    fun show(context: Context, n: Notify, tz: String, nowMs: Long = System.currentTimeMillis()) {
        if (!canPost(context)) return
        val a = n.alert
        val warning = a.rank >= 2
        val prefix = when {
            a.rank >= 3 -> "EMERGENCY: "
            n.kind == Kind.UPGRADE -> "Upgraded: "
            else -> ""
        }
        val title = prefix + a.event
        val text = a.actionTitle ?: a.headline.ifBlank { a.event }
        val big = buildString {
            a.steps.forEachIndexed { i, s -> append(i + 1).append(". ").append(s).append('\n') }
            val until = untilText(a.expiresMs, tz)
            if (until.isNotEmpty()) append(until).append(' ')
            if (a.areaDesc.isNotBlank()) append(a.areaDesc)
        }.trim()

        val builder = NotificationCompat.Builder(context, if (warning) CH_WARNINGS else CH_WATCHES)
            .setSmallIcon(R.drawable.ic_stat_shelly)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(if (big.isNotEmpty()) "$text\n$big" else text))
            .setCategory(if (warning) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_STATUS)
            .setPriority(if (warning) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openApp(context, n.notifId))
            .setAutoCancel(false)
            .setOnlyAlertOnce(n.kind == Kind.REPOST)
            .setColor(0xFFFF8A65.toInt())
        if (a.expiresMs > nowMs) builder.setTimeoutAfter(a.expiresMs - nowMs)
        if (a.rank >= 3 && fullScreenAllowed(context)) builder.setFullScreenIntent(openApp(context, n.notifId + 1), true)
        try {
            NotificationManagerCompat.from(context).notify(n.notifId, builder.build())
        } catch (_: SecurityException) {
        }
    }

    private fun fullScreenAllowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < 34 || context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()

    fun cancel(context: Context, id: Int) = NotificationManagerCompat.from(context).cancel(id)

    /** "Send test to app" from the admin screen. */
    fun showTest(context: Context) {
        if (!canPost(context)) return
        val n = NotificationCompat.Builder(context, CH_WARNINGS)
            .setSmallIcon(R.drawable.ic_stat_shelly)
            .setContentTitle("Test from SHELLY")
            .setContentText("App alerts work. This is only a test.")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(openApp(context, TEST_ID))
            .setAutoCancel(true)
            .setColor(0xFFFF8A65.toInt())
            .build()
        try {
            NotificationManagerCompat.from(context).notify(TEST_ID, n)
        } catch (_: SecurityException) {
        }
    }

    /** A plain message written by the SHELLY admin. Shown when the app is open (otherwise Android shows it from the push itself). */
    fun showAnnouncement(context: Context, title: String, body: String) {
        if (!canPost(context)) return
        val n = NotificationCompat.Builder(context, CH_ANNOUNCE)
            .setSmallIcon(R.drawable.ic_stat_shelly)
            .setContentTitle(title.take(65))
            .setContentText(body.take(240))
            .setStyle(NotificationCompat.BigTextStyle().bigText(body.take(240)))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(openApp(context, ANNOUNCE_ID))
            .setAutoCancel(true)
            .setColor(0xFFFF8A65.toInt())
            .build()
        try {
            NotificationManagerCompat.from(context).notify(ANNOUNCE_ID, n)
        } catch (_: SecurityException) {
        }
    }
}
