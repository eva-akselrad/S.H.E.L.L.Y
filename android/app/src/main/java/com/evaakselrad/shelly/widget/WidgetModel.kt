package com.evaakselrad.shelly.widget

import com.evaakselrad.shelly.Glance
import com.evaakselrad.shelly.parseTimeMs
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

enum class Look { NORMAL, ELEVATED, WARNING }

/** Everything the widget shows, decided here (pure, unit-tested) so the provider only paints it. */
data class WidgetModel(
    val look: Look,
    /** website icon key: sun, moon, partly, cloud, fog, drizzle, rain, snow, sleet, storm, unknown */
    val icon: String,
    /** the temperature, e.g. "48°" */
    val temp: String,
    /** the top alert's name while one is active; the small layout shows it instead of the temperature in a warning */
    val alertName: String?,
    val desc: String,
    val hilo: String,
    /** rain line normally; "Tornado Warning: Take cover now." in a warning */
    val line: String,
    val footer: String,
    /** short footer for the small layout */
    val smallFooter: String,
    val stale: Boolean,
    val hasData: Boolean,
) {
    companion object {
        const val STALE_MS = 2 * 3_600_000L

        fun from(glance: Glance?, nowMs: Long): WidgetModel {
            if (glance == null) {
                return WidgetModel(Look.NORMAL, "unknown", "--", null, "No data yet", "", "Open SHELLY to get started.", "", "Open app", stale = false, hasData = false)
            }
            val updatedMs = parseTimeMs(glance.updated)
            val stale = updatedMs > 0 && nowMs - updatedMs > STALE_MS
            val at = clock(updatedMs, glance.tz)
            val place = glance.placeName
            val footer = if (stale) "Not updated since $at" else "$place · updated $at"

            val temp = glance.temp?.let { "$it°" } ?: "--"
            val hilo = if (glance.hi != null && glance.lo != null) "H ${glance.hi}°  L ${glance.lo}°" else ""
            val top = glance.alerts.filter { it.rank >= 1 && (it.expiresMs == 0L || it.expiresMs > nowMs) }.maxByOrNull { it.rank }
            val rank = top?.rank ?: 0
            val look = when {
                rank >= 2 -> Look.WARNING
                rank == 1 -> Look.ELEVATED
                else -> Look.NORMAL
            }
            val line = when (look) {
                Look.WARNING -> listOfNotNull(top?.event, top?.actionTitle).joinToString(": ")
                Look.ELEVATED -> {
                    val names = glance.alerts.filter { it.rank == 1 }.map { it.event }.distinct()
                    names.take(2).joinToString(", ") + if (names.size > 2) " +${names.size - 2}" else ""
                }
                Look.NORMAL -> glance.rain ?: ""
            }
            return WidgetModel(
                look = look,
                icon = glance.icon ?: "unknown",
                temp = temp,
                alertName = top?.event,
                desc = glance.desc ?: "",
                hilo = hilo,
                line = line,
                footer = footer,
                smallFooter = if (stale) "Old $at" else place,
                stale = stale,
                hasData = true,
            )
        }

        private fun clock(ms: Long, tz: String): String {
            if (ms <= 0) return "--"
            val zone = try { ZoneId.of(tz) } catch (_: Exception) { ZoneId.systemDefault() }
            return DateTimeFormatter.ofPattern("h:mm a", Locale.US).withZone(zone).format(Instant.ofEpochMilli(ms))
        }
    }
}
