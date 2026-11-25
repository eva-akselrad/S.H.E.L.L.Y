package com.evaakselrad.shelly

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** The server's data message for a flash near one of the phone's zones: just a point and a time. */
data class LightningMsg(val lat: Double, val lon: Double, val tMs: Long) {
    companion object {
        fun parse(data: Map<String, String>): LightningMsg? {
            val lat = data["lat"]?.toDoubleOrNull() ?: return null
            val lon = data["lon"]?.toDoubleOrNull() ?: return null
            val t = data["t"]?.toLongOrNull() ?: return null
            if (lat !in -90.0..90.0 || lon !in -180.0..180.0) return null
            return LightningMsg(lat, lon, t)
        }
    }
}

enum class LightningVerdict { SHOW, OFF, QUIET, TOO_OLD, NO_LOCATION, TOO_FAR, COOLDOWN }

/**
 * Pure rules for the opt-in lightning notification. The server only knows the phone's NWS zone, so the
 * phone checks its own position here. Never an alarm: own low-priority channel, no full screen, no Do Not Disturb bypass.
 */
object LightningDecider {
    const val RADIUS_MI = 10.0
    const val MAX_AGE_MS = 15 * 60_000L
    const val COOLDOWN_MS = 30 * 60_000L

    /** a saved position older than this is too stale to say "close to you" */
    const val MAX_FIX_AGE_MS = 45 * 60_000L

    fun distanceMi(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 3958.8
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2) * sin(dLat / 2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * atan2(sqrt(a), sqrt(1 - a))
    }

    /**
     * @param fix the phone's own position (lat, lon, age in ms), or null when it has none
     * @param lastShownMs when we last showed a lightning notification (0 = never)
     */
    fun decide(
        msg: LightningMsg,
        prefs: AlertPrefs,
        hour: Int,
        fix: Triple<Double, Double, Long>?,
        lastShownMs: Long,
        nowMs: Long,
    ): LightningVerdict {
        if (!prefs.lightning) return LightningVerdict.OFF
        if (AlertDecider.inQuietHours(prefs, hour)) return LightningVerdict.QUIET
        if (nowMs - msg.tMs > MAX_AGE_MS) return LightningVerdict.TOO_OLD
        if (fix == null || fix.third > MAX_FIX_AGE_MS) return LightningVerdict.NO_LOCATION
        if (distanceMi(fix.first, fix.second, msg.lat, msg.lon) > RADIUS_MI) return LightningVerdict.TOO_FAR
        if (lastShownMs != 0L && nowMs - lastShownMs < COOLDOWN_MS) return LightningVerdict.COOLDOWN
        return LightningVerdict.SHOW
    }

    /** Template text only, always "about N mi" and always saying it is not an NWS alert. */
    fun body(distanceMi: Double): String {
        val where = if (distanceMi < 3) "Lightning overhead." else "Lightning about ${distanceMi.roundToInt()} mi from you."
        return "$where Stay inside. This is from satellite, not an NWS alert."
    }
}
