package com.evaakselrad.shelly

import org.json.JSONObject
import java.time.OffsetDateTime

/** One alert covering the phone's point, as served by /api/glance. Wording comes from NWS fields and server templates only. */
data class GlanceAlert(
    val id: String,
    val refs: List<String>,
    val event: String,
    val level: String,
    val expires: String?,
    val areaDesc: String,
    val headline: String,
    val actionTitle: String?,
    val steps: List<String>,
) {
    val rank: Int get() = levelRank(level)
    val expiresMs: Long get() = parseTimeMs(expires)
}

data class Glance(
    val updated: String,
    val alertsUpdated: String?,
    val placeName: String,
    val state: String?,
    val tz: String,
    val zones: List<String>,
    val temp: Int?,
    val feels: Int?,
    val desc: String?,
    val icon: String?,
    val hi: Int?,
    val lo: Int?,
    val rain: String?,
    val level: String,
    val alerts: List<GlanceAlert>,
)

fun levelRank(level: String): Int = when (level) {
    "EMERGENCY" -> 3
    "WARNING" -> 2
    "ELEVATED" -> 1
    else -> 0
}

/** NWS times carry an offset ("2026-11-17T18:00:00-05:00"). Returns 0 when missing or unreadable. */
fun parseTimeMs(s: String?): Long = try {
    if (s == null) 0L else OffsetDateTime.parse(s).toInstant().toEpochMilli()
} catch (_: Exception) {
    0L
}

private fun JSONObject.str(k: String): String? = if (isNull(k)) null else getString(k)
private fun JSONObject.int(k: String): Int? = if (isNull(k)) null else getInt(k)

object GlanceParser {
    /** Returns null if the JSON isn't a version-1 glance payload. */
    fun parse(json: String): Glance? = try {
        val o = JSONObject(json)
        if (o.optInt("v") != 1) null else {
            val place = o.getJSONObject("place")
            val now = if (o.isNull("now")) null else o.getJSONObject("now")
            val today = if (o.isNull("today")) null else o.getJSONObject("today")
            val zones = place.getJSONArray("zones").let { a -> (0 until a.length()).map { a.getString(it) } }
            val alerts = o.getJSONArray("alerts").let { arr ->
                (0 until arr.length()).map { i ->
                    val a = arr.getJSONObject(i)
                    val action = if (a.isNull("action")) null else a.getJSONObject("action")
                    GlanceAlert(
                        id = a.getString("id"),
                        refs = a.getJSONArray("refs").let { r -> (0 until r.length()).map { r.getString(it) } },
                        event = a.getString("event"),
                        level = a.getString("level"),
                        expires = a.str("expires"),
                        areaDesc = a.optString("areaDesc", ""),
                        headline = a.optString("headline", ""),
                        actionTitle = action?.str("title"),
                        steps = action?.getJSONArray("steps")?.let { s -> (0 until s.length()).map { s.getString(it) } } ?: emptyList(),
                    )
                }
            }
            Glance(
                updated = o.getString("updated"),
                alertsUpdated = o.str("alertsUpdated"),
                placeName = place.getString("name"),
                state = place.str("state"),
                tz = place.getString("tz"),
                zones = zones,
                temp = now?.int("temp"),
                feels = now?.int("feels"),
                desc = now?.str("desc"),
                icon = now?.str("icon"),
                hi = today?.int("hi"),
                lo = today?.int("lo"),
                rain = o.str("rain"),
                level = o.getString("level"),
                alerts = alerts,
            )
        }
    } catch (_: Exception) {
        null
    }
}
