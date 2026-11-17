package com.evaakselrad.shelly

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.app.Notification

object Notifier {
    const val CH_WARNINGS = "warnings"
    const val CH_WATCHES = "watches"
    const val CH_APP = "app"

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
        nm.createNotificationChannels(listOf(warnings, watches, app))
    }
}
