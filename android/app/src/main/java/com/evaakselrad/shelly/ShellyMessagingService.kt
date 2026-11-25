package com.evaakselrad.shelly

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCM only says "something may have changed". The message carries no alert text; the app asks
 * /api/glance what covers the phone and builds the notification from that.
 */
class ShellyMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        when (message.data["type"]) {
            "alert" -> Refresh.enqueueNow(applicationContext, expedited = true)
            "custom" -> {
                Notifier.createChannels(applicationContext)
                val title = message.data["title"].orEmpty()
                val body = message.data["body"].orEmpty()
                if (title.isNotBlank() && body.isNotBlank()) Notifier.showAnnouncement(applicationContext, title, body)
            }
            "lightning" -> handleLightning(message.data)
            "test" -> {
                Notifier.createChannels(applicationContext)
                Notifier.showTest(applicationContext)
            }
        }
    }

    /**
     * Opt-in lightning near this phone. The message only says where a flash was; whether it matters is decided
     * here from the phone's own position and settings, and nothing about the phone's position is sent anywhere.
     */
    private fun handleLightning(data: Map<String, String>) {
        val app = applicationContext
        val prefs = Prefs(app)
        if (!prefs.alertPrefs.lightning) return
        val msg = LightningMsg.parse(data) ?: return
        val now = System.currentTimeMillis()
        val fix = LocationHelper.lastKnown(app, now)
        val hour = java.time.ZonedDateTime.now().hour
        val verdict = LightningDecider.decide(msg, prefs.alertPrefs, hour, fix, prefs.lastLightningMs, now)
        if (verdict != LightningVerdict.SHOW || fix == null) return
        Notifier.createChannels(app)
        Notifier.showLightning(app, LightningDecider.distanceMi(fix.first, fix.second, msg.lat, msg.lon))
        prefs.lastLightningMs = now
    }

    /** Topics are tied to the install, not the token, so only a refresh is needed. */
    override fun onNewToken(token: String) {
        Refresh.enqueueNow(applicationContext, expedited = false)
    }
}
