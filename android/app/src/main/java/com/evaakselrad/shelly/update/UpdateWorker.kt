package com.evaakselrad.shelly.update

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

class UpdateWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try { Updater.check(applicationContext, force = inputData.getBoolean("force", false)) } catch (_: Exception) { }
        Result.success()
    }

    companion object {
        private val net = Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build()

        /** Once a day, on Wi-Fi (the APK is a few MB). */
        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<UpdateWorker>(24, TimeUnit.HOURS).setConstraints(net).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("shelly-update", ExistingPeriodicWorkPolicy.KEEP, req)
        }

        /** On app open: the check itself limits itself to once per six hours unless [force]. */
        fun checkNow(context: Context, force: Boolean = false) {
            val req = OneTimeWorkRequestBuilder<UpdateWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInputData(workDataOf("force" to force))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("shelly-update-now", ExistingWorkPolicy.KEEP, req)
        }
    }
}
