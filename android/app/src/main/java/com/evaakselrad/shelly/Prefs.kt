package com.evaakselrad.shelly

import android.content.Context
import org.json.JSONObject

/** Alert preferences. Same shape as PushPrefs on the website (shared/push.ts). */
data class AlertPrefs(val watches: Boolean, val quietStart: Int?, val quietEnd: Int?) {
    fun toJson(): String = JSONObject()
        .put("watches", watches)
        .put("quietStart", quietStart ?: JSONObject.NULL)
        .put("quietEnd", quietEnd ?: JSONObject.NULL)
        .toString()

    companion object {
        val DEFAULT = AlertPrefs(watches = false, quietStart = 22, quietEnd = 7)

        /** Parses and validates JSON from the website. Returns null if it is not usable. */
        fun parse(json: String): AlertPrefs? = try {
            val o = JSONObject(json)
            fun hour(key: String): Int? {
                if (!o.has(key) || o.isNull(key)) return null
                val v = o.getInt(key)
                require(v in 0..23)
                return v
            }
            AlertPrefs(o.optBoolean("watches", false), hour("quietStart"), hour("quietEnd"))
        } catch (_: Exception) {
            null
        }
    }
}

class Prefs(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("shelly", Context.MODE_PRIVATE)

    var onboarded: Boolean
        get() = sp.getBoolean("onboarded", false)
        set(v) = sp.edit().putBoolean("onboarded", v).apply()

    var alertPrefs: AlertPrefs
        get() = AlertPrefs.parse(sp.getString("alertPrefs", null) ?: "") ?: AlertPrefs.DEFAULT
        set(v) = sp.edit().putString("alertPrefs", v.toJson()).apply()

    /** AlertDecider memory (which alerts were already shown) */
    var deciderState: String?
        get() = sp.getString("deciderState", null)
        set(v) = sp.edit().putString("deciderState", v).apply()

    /** last /api/glance payload; the widget (phase A4) reads only this */
    var lastGlance: String?
        get() = sp.getString("lastGlance", null)
        set(v) = sp.edit().putString("lastGlance", v).apply()

    /** FCM topics this phone is subscribed to (zones). Stays on the phone. */
    var topics: Set<String>
        get() = sp.getStringSet("topics", emptySet()) ?: emptySet()
        set(v) = sp.edit().putStringSet("topics", v).apply()

    /** last known position, kept only on this phone as a fallback when a fresh fix is not possible */
    fun lastLocation(): Triple<Double, Double, Long>? {
        if (!sp.contains("lat")) return null
        return Triple(Double.fromBits(sp.getLong("lat", 0)), Double.fromBits(sp.getLong("lon", 0)), sp.getLong("locMs", 0))
    }

    fun saveLocation(lat: Double, lon: Double, atMs: Long) {
        sp.edit().putLong("lat", lat.toBits()).putLong("lon", lon.toBits()).putLong("locMs", atMs).apply()
    }

    /** debug builds only: point the app at another server, e.g. wrangler dev (set with adb run-as) */
    var siteOverride: String?
        get() = if (BuildConfig.DEBUG) sp.getString("siteOverride", null) else null
        set(v) = sp.edit().putString("siteOverride", v).apply()
}
