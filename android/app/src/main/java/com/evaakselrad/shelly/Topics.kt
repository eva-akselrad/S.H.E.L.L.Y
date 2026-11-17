package com.evaakselrad.shelly

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import java.util.concurrent.TimeUnit

/**
 * FCM topics. The server never learns where the phone is: it sends alerts to topics named after NWS
 * zones ("z_PAZ106") and the phone subscribes to the zones it is in. Topic "all" is for admin tests.
 */
object Topics {
    const val ALL = "all"
    private val ZONE = Regex("^[A-Z]{2}[CZ]\\d{3}$")

    fun topicFor(zone: String): String = "z_$zone"

    /** Topics to hold for these zones, including "all". Malformed zones are ignored. */
    fun wanted(zones: List<String>): Set<String> = zones.filter { ZONE.matches(it) }.map(::topicFor).toSet() + ALL

    /** Subscribes to new zones and drops old ones. Only touches the network when something changed. */
    fun sync(context: Context, zones: List<String>) {
        val prefs = Prefs(context)
        val want = wanted(zones)
        val have = prefs.topics
        if (want == have) return
        val fm = FirebaseMessaging.getInstance()
        val held = have.toMutableSet()
        for (t in have - want) {
            try { Tasks.await(fm.unsubscribeFromTopic(t), 15, TimeUnit.SECONDS); held -= t } catch (_: Exception) { }
        }
        for (t in want - have) {
            try { Tasks.await(fm.subscribeToTopic(t), 15, TimeUnit.SECONDS); held += t } catch (_: Exception) { }
        }
        // a failed call leaves the topic out of `held`, so the next run retries it
        prefs.topics = held
    }
}
