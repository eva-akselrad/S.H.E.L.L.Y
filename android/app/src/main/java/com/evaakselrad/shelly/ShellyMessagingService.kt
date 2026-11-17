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
            "test" -> {
                Notifier.createChannels(applicationContext)
                Notifier.showTest(applicationContext)
            }
        }
    }

    /** Topics are tied to the install, not the token, so only a refresh is needed. */
    override fun onNewToken(token: String) {
        Refresh.enqueueNow(applicationContext, expedited = false)
    }
}
