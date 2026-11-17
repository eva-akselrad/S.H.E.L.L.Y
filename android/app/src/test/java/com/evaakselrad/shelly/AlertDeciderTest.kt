package com.evaakselrad.shelly

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertDeciderTest {
    private val now = 1_800_000_000_000L
    private val later = "2030-01-01T00:00:00-05:00"
    private val prefs = AlertPrefs(watches = false, quietStart = 22, quietEnd = 7)

    private fun alert(
        id: String,
        level: String = "WARNING",
        refs: List<String> = emptyList(),
        expires: String? = later,
        event: String = "Tornado Warning",
    ) = GlanceAlert(id, refs, event, level, expires, "Philadelphia, PA", "", "Take cover now.", listOf("Go to the basement."))

    private fun decide(alerts: List<GlanceAlert>, state: DeciderState = DeciderState(), p: AlertPrefs = prefs, hour: Int = 14) =
        AlertDecider.decide(alerts, state, p, hour, now)

    @Test fun newWarningNotifiesOnce() {
        val first = decide(listOf(alert("a1")))
        assertEquals(listOf(Kind.NEW), first.notify.map { it.kind })
        val again = decide(listOf(alert("a1")), first.state)
        assertTrue(again.notify.isEmpty())
        assertTrue(again.cancel.isEmpty())
    }

    @Test fun updateAtSameLevelStaysQuietAndKeepsNotification() {
        val first = decide(listOf(alert("a1")))
        val update = decide(listOf(alert("a2", refs = listOf("a1"))), first.state)
        assertTrue(update.notify.isEmpty())
        // a later re-issue that only mentions the first update is still the same alert
        val third = decide(listOf(alert("a3", refs = listOf("a2"))), update.state)
        assertTrue(third.notify.isEmpty())
    }

    @Test fun upgradeAlertsAgainOnTheSameNotification() {
        val first = decide(listOf(alert("a1")))
        val up = decide(listOf(alert("a2", level = "EMERGENCY", refs = listOf("a1"))), first.state)
        assertEquals(listOf(Kind.UPGRADE), up.notify.map { it.kind })
        assertEquals(first.notify[0].notifId, up.notify[0].notifId)
        assertTrue(decide(listOf(alert("a2", level = "EMERGENCY", refs = listOf("a1"))), up.state).notify.isEmpty())
    }

    @Test fun watchesNeedOptInAndRespectQuietHours() {
        val watch = alert("w1", level = "ELEVATED", event = "Flood Watch")
        assertTrue(decide(listOf(watch)).notify.isEmpty())
        val on = prefs.copy(watches = true)
        assertEquals(1, decide(listOf(watch), p = on).notify.size)
        val quiet = decide(listOf(watch), p = on, hour = 23)
        assertTrue(quiet.notify.isEmpty())
        // not remembered while quiet, so it shows once quiet hours end
        assertEquals(1, decide(listOf(watch), quiet.state, on, hour = 8).notify.size)
    }

    @Test fun warningsIgnoreQuietHours() {
        assertEquals(1, decide(listOf(alert("a1")), hour = 3).notify.size)
    }

    @Test fun alertThatStopsCoveringIsCancelledOnceAndQuietlyReposted() {
        val first = decide(listOf(alert("a1")))
        val gone = decide(emptyList(), first.state)
        assertEquals(listOf(first.notify[0].notifId), gone.cancel)
        assertTrue(decide(emptyList(), gone.state).cancel.isEmpty())
        val back = decide(listOf(alert("a1")), gone.state)
        assertEquals(listOf(Kind.REPOST), back.notify.map { it.kind })
    }

    @Test fun expiredAlertsAreIgnoredAndForgottenAfterAnHour() {
        assertTrue(decide(listOf(alert("old", expires = "2000-01-01T00:00:00-05:00"))).notify.isEmpty())
        val first = decide(listOf(alert("a1", expires = "2027-01-15T10:00:00Z")))
        assertEquals(1, first.state.shown.size)
        val forgotten = AlertDecider.decide(emptyList(), first.state, prefs, 12, parseTimeMs("2027-01-15T12:00:00Z"))
        assertTrue(forgotten.state.shown.isEmpty())
    }

    @Test fun calmAlertsAreNeverShown() {
        assertTrue(decide(listOf(alert("c1", level = "CALM"))).notify.isEmpty())
    }

    @Test fun stateSurvivesJson() {
        val s = decide(listOf(alert("a1", refs = listOf("a0")))).state
        assertEquals(s, DeciderState.parse(s.toJson()))
        assertEquals(DeciderState(), DeciderState.parse("garbage"))
    }

    @Test fun quietHours() {
        assertTrue(AlertDecider.inQuietHours(prefs, 23))
        assertTrue(AlertDecider.inQuietHours(prefs, 6))
        assertTrue(!AlertDecider.inQuietHours(prefs, 7))
        assertTrue(!AlertDecider.inQuietHours(AlertPrefs(false, null, null), 3))
    }

    @Test fun parsesGlanceJson() {
        val g = GlanceParser.parse(
            """{"v":1,"updated":"2026-11-17T15:00:00Z","alertsUpdated":null,
            "place":{"name":"Philadelphia","state":"PA","tz":"America/New_York","zones":["PAZ106","PAC101"]},
            "now":{"temp":48,"feels":43,"code":0,"isDay":true,"desc":"Clear sky","icon":"sun"},
            "today":{"hi":57,"lo":35},"rain":null,"level":"WARNING",
            "alerts":[{"id":"x","refs":["y"],"event":"Tornado Warning","level":"WARNING","expires":"2030-01-01T00:00:00-05:00",
            "areaDesc":"Philly","headline":"h","action":{"urgency":"now","title":"Take cover now.","steps":["a","b"]}},
            {"id":"z","refs":[],"event":"Flood Watch","level":"ELEVATED","expires":null,"areaDesc":"","headline":"","action":null}]}""",
        )
        assertNotNull(g)
        assertEquals(48, g!!.temp)
        assertNull(g.rain)
        assertEquals(listOf("PAZ106", "PAC101"), g.zones)
        assertEquals("Take cover now.", g.alerts[0].actionTitle)
        assertEquals(listOf("a", "b"), g.alerts[0].steps)
        assertEquals(0L, g.alerts[1].expiresMs)
        assertNull(GlanceParser.parse("""{"v":2}"""))
        assertNull(GlanceParser.parse("nope"))
    }
}
