package com.evaakselrad.shelly

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a reboot or an app update, WorkManager schedules are rebuilt and a catch-up run starts. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            Refresh.schedulePeriodic(context)
            com.evaakselrad.shelly.update.UpdateWorker.schedule(context)
            Refresh.enqueueNow(context, expedited = false)
        }
    }
}
