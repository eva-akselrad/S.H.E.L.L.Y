package com.evaakselrad.shelly

import org.json.JSONArray
import org.json.JSONObject

/** What we have already shown for one alert chain. NWS updates are new ids that list the old ones in `refs`. */
data class Shown(
    val rank: Int,
    val expiresMs: Long,
    val ids: Set<String>,
    val notifId: Int,
    /** the notification was taken down because the alert stopped covering the phone (or went away) */
    val cancelled: Boolean = false,
)

data class DeciderState(val shown: Map<String, Shown> = emptyMap()) {
    fun toJson(): String {
        val o = JSONObject()
        for ((k, s) in shown) {
            o.put(
                k,
                JSONObject().put("rank", s.rank).put("exp", s.expiresMs).put("ids", JSONArray(s.ids.toList()))
                    .put("n", s.notifId).put("c", s.cancelled),
            )
        }
        return o.toString()
    }

    companion object {
        fun parse(json: String?): DeciderState = try {
            val o = JSONObject(json ?: "{}")
            val m = mutableMapOf<String, Shown>()
            for (k in o.keys()) {
                val s = o.getJSONObject(k)
                m[k] = Shown(
                    rank = s.getInt("rank"),
                    expiresMs = s.getLong("exp"),
                    ids = s.getJSONArray("ids").let { a -> (0 until a.length()).map { a.getString(it) }.toSet() },
                    notifId = s.getInt("n"),
                    cancelled = s.optBoolean("c", false),
                )
            }
            DeciderState(m)
        } catch (_: Exception) {
            DeciderState()
        }
    }
}

enum class Kind {
    /** first time we show this alert: sound */
    NEW,

    /** same alert, higher level (warning to emergency): sound again */
    UPGRADE,

    /** the notification was taken down and the alert covers the phone again: put it back quietly */
    REPOST,
}

data class Notify(val alert: GlanceAlert, val kind: Kind, val notifId: Int)

data class Decision(val notify: List<Notify>, val cancel: List<Int>, val state: DeciderState)

/**
 * Pure rules, same meaning as decidePushes in shared/push.ts:
 *  - warnings and emergencies always notify, even in quiet hours
 *  - watches and advisories only if the user opted in, and never in quiet hours
 *  - one notification per alert chain; an update re-alerts only on an upgrade
 */
object AlertDecider {
    private const val KEEP_AFTER_EXPIRY_MS = 3_600_000L
    private const val NO_EXPIRY_KEEP_MS = 24 * 3_600_000L

    fun inQuietHours(p: AlertPrefs, hour: Int): Boolean {
        val s = p.quietStart
        val e = p.quietEnd
        if (s == null || e == null || s == e) return false
        return if (s < e) hour in s until e else hour >= s || hour < e
    }

    fun decide(alerts: List<GlanceAlert>, state: DeciderState, prefs: AlertPrefs, hour: Int, nowMs: Long): Decision {
        val quiet = inQuietHours(prefs, hour)
        val next = LinkedHashMap<String, Shown>()
        val notify = mutableListOf<Notify>()
        val matched = mutableSetOf<String>()

        val active = alerts
            .filter { it.expiresMs == 0L || it.expiresMs > nowMs }
            .filter { it.rank > 0 }
            .sortedByDescending { it.rank }

        for (a in active) {
            val ids = a.refs.toSet() + a.id
            val key = state.shown.entries.firstOrNull { (_, s) -> s.ids.any { it in ids } }?.key
            val exp = if (a.expiresMs == 0L) nowMs + NO_EXPIRY_KEEP_MS else a.expiresMs
            if (key == null) {
                if (a.rank == 1 && (!prefs.watches || quiet)) continue
                val notifId = a.id.hashCode()
                next[a.id] = Shown(a.rank, exp, ids, notifId)
                notify += Notify(a, Kind.NEW, notifId)
            } else {
                matched += key
                val e = state.shown.getValue(key)
                when {
                    a.rank > e.rank -> {
                        next[key] = e.copy(rank = a.rank, expiresMs = exp, ids = e.ids + ids, cancelled = false)
                        notify += Notify(a, Kind.UPGRADE, e.notifId)
                    }
                    e.cancelled -> {
                        next[key] = e.copy(expiresMs = exp, ids = e.ids + ids, cancelled = false)
                        notify += Notify(a, Kind.REPOST, e.notifId)
                    }
                    else -> next[key] = e.copy(expiresMs = exp, ids = e.ids + ids)
                }
            }
        }

        // Alerts we showed that no longer cover the phone: take the notification down, but remember
        // the alert until it expires so leaving and re-entering the area does not ring again.
        val cancel = mutableListOf<Int>()
        for ((key, s) in state.shown) {
            if (key in matched) continue
            if (s.expiresMs + KEEP_AFTER_EXPIRY_MS < nowMs) continue // forget
            if (!s.cancelled) cancel += s.notifId
            next[key] = s.copy(cancelled = true)
        }
        return Decision(notify, cancel, DeciderState(next))
    }
}
