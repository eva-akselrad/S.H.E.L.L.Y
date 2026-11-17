package com.evaakselrad.shelly

import com.evaakselrad.shelly.widget.Look
import com.evaakselrad.shelly.widget.WidgetModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetModelTest {
    private val now = parseTimeMs("2026-11-17T18:00:00Z")

    private fun alert(level: String, event: String, title: String? = "Take cover now.", expires: String? = "2026-11-17T19:00:00Z") =
        GlanceAlert("id-$event", emptyList(), event, level, expires, "Philly", "", title, emptyList())

    private fun glance(alerts: List<GlanceAlert> = emptyList(), updated: String = "2026-11-17T17:55:00Z", rain: String? = "No rain for 4 hours.") = Glance(
        updated = updated, alertsUpdated = null, placeName = "Philadelphia", state = "PA", tz = "America/New_York",
        zones = emptyList(), temp = 48, feels = 43, desc = "Clear sky", icon = "sun", hi = 57, lo = 35, rain = rain,
        level = "CALM", alerts = alerts,
    )

    @Test fun calmShowsConditionsAndRainLine() {
        val m = WidgetModel.from(glance(), now)
        assertEquals(Look.NORMAL, m.look)
        assertEquals("48°", m.temp)
        assertEquals("H 57°  L 35°", m.hilo)
        assertEquals("No rain for 4 hours.", m.line)
        assertEquals("Philadelphia · updated 12:55 PM", m.footer)
        assertFalse(m.stale)
    }

    @Test fun warningTurnsRedAndShowsEventAndActionTitle() {
        val m = WidgetModel.from(glance(listOf(alert("WARNING", "Tornado Warning"))), now)
        assertEquals(Look.WARNING, m.look)
        assertEquals("Tornado Warning: Take cover now.", m.line)
        assertEquals("Tornado Warning", m.alertName)
    }

    @Test fun mostSevereAlertWins() {
        val m = WidgetModel.from(glance(listOf(alert("ELEVATED", "Flood Watch", null), alert("EMERGENCY", "Tornado Warning"))), now)
        assertEquals(Look.WARNING, m.look)
    }

    @Test fun watchIsAmberWithEventNames() {
        val m = WidgetModel.from(glance(listOf(alert("ELEVATED", "Flood Watch", null), alert("ELEVATED", "Wind Advisory", null))), now)
        assertEquals(Look.ELEVATED, m.look)
        assertEquals("Flood Watch, Wind Advisory", m.line)
    }

    @Test fun expiredAlertsAreIgnored() {
        val m = WidgetModel.from(glance(listOf(alert("WARNING", "Tornado Warning", expires = "2026-11-17T17:00:00Z"))), now)
        assertEquals(Look.NORMAL, m.look)
    }

    @Test fun staleAfterTwoHoursSaysSoPlainly() {
        val m = WidgetModel.from(glance(updated = "2026-11-17T15:30:00Z"), now)
        assertTrue(m.stale)
        assertEquals("Not updated since 10:30 AM", m.footer)
        assertEquals("Old 10:30 AM", m.smallFooter)
    }

    @Test fun noDataYetPromptsToOpenTheApp() {
        val m = WidgetModel.from(null, now)
        assertFalse(m.hasData)
        assertEquals("Open SHELLY to get started.", m.line)
    }
}
