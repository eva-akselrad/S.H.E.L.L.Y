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
}
