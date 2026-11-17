package com.evaakselrad.shelly

import android.content.Context
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

/**
 * The one pipeline behind every alert: location, then /api/glance, then topic sync, then
 * AlertDecider, then notifications. Runs from FCM, every 15 minutes, on app open and after boot.
 * It never throws: on a network failure the last glance is kept and the next run catches up.
 */
object Refresh {
    private const val TAG = "ShellyRefresh"
    private val lock = Any()

    /** One run at a time, so an FCM-triggered run and the periodic run never double-notify. */
    fun run(context: Context): Glance? = synchronized(lock) {
        val app = context.applicationContext
        val prefs = Prefs(app)
        Notifier.createChannels(app)

        val fix = LocationHelper.current(app)
        if (fix == null) { Log.i(TAG, "no location yet, skipping"); return null }
        Log.i(TAG, "location fix, age ${fix.ageMs / 1000}s")
        val json = Api.fetchGlance(app, fix.lat, fix.lon)
        if (json == null) { Log.i(TAG, "glance fetch failed, keeping the last one"); return null }
        val glance = GlanceParser.parse(json)
        if (glance == null) { Log.i(TAG, "glance unreadable"); return null }

        try { Topics.sync(app, glance.zones) } catch (_: Exception) { }

        val now = System.currentTimeMillis()
        val hour = try { ZonedDateTime.now(ZoneId.of(glance.tz)).hour } catch (_: Exception) { ZonedDateTime.now().hour }
        val decision = AlertDecider.decide(glance.alerts, DeciderState.parse(prefs.deciderState), prefs.alertPrefs, hour, now)
        for (id in decision.cancel) Notifier.cancel(app, id)
        for (n in decision.notify) Notifier.show(app, n, glance.tz, now)
        prefs.deciderState = decision.state.toJson()
        prefs.lastGlance = json
        Log.i(TAG, "glance ok: ${glance.alerts.size} alerts, notify ${decision.notify.size}, cancel ${decision.cancel.size}")
        glance
    }

    private val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** Every 15 minutes (Android's minimum), catching anything a push missed. */
    fun schedulePeriodic(context: Context) {
        val req = PeriodicWorkRequestBuilder<RefreshWorker>(15, TimeUnit.MINUTES).setConstraints(net).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("shelly-periodic", ExistingPeriodicWorkPolicy.KEEP, req)
    }

    /** Right now. `expedited` is for pushes: it may run while the app is in the background. */
    fun enqueueNow(context: Context, expedited: Boolean) {
        val b = OneTimeWorkRequestBuilder<RefreshWorker>().setConstraints(net)
        if (expedited) b.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        WorkManager.getInstance(context).enqueueUniqueWork("shelly-now", ExistingWorkPolicy.REPLACE, b.build())
    }
}

class RefreshWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try { Refresh.run(applicationContext) } catch (_: Exception) { }
        Result.success()
    }

    /** Needed by expedited work on Android 11 and older. */
    override suspend fun getForegroundInfo(): ForegroundInfo {
        val n = NotificationCompat.Builder(applicationContext, Notifier.CH_APP)
            .setSmallIcon(R.drawable.ic_stat_shelly)
            .setContentTitle("SHELLY")
            .setContentText("Checking for warnings")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        return ForegroundInfo(7002, n)
    }
}
