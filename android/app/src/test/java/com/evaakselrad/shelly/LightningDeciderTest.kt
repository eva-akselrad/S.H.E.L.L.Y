package com.evaakselrad.shelly

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LightningDeciderTest {
    private val now = 1_800_000_000_000L
    private val on = AlertPrefs(watches = false, quietStart = 22, quietEnd = 7, lightning = true)

    // the phone is at Norristown; the flash is about 6 miles north of it
    private val phone = Triple(40.12, -75.34, 2 * 60_000L)
    private val near = LightningMsg(40.12 + 6.0 / 69.0, -75.34, now - 60_000L)

    private fun decide(
        msg: LightningMsg = near,
        prefs: AlertPrefs = on,
        hour: Int = 15,
        fix: Triple<Double, Double, Long>? = phone,
        last: Long = 0L,
    ) = LightningDecider.decide(msg, prefs, hour, fix, last, now)

    @Test fun offByDefault() {
        assertFalse(AlertPrefs.DEFAULT.lightning)
        assertEquals(LightningVerdict.OFF, decide(prefs = AlertPrefs.DEFAULT))
        assertEquals(LightningVerdict.OFF, decide(prefs = on.copy(lightning = false)))
    }

    @Test fun showsWhenWithinTenMilesOfThePhone() {
        assertEquals(LightningVerdict.SHOW, decide())
    }

    @Test fun staysQuietWhenTheFlashIsFartherThanTenMilesFromThePhone() {
        val far = near.copy(lat = 40.12 + 14.0 / 69.0)
        assertEquals(LightningVerdict.TOO_FAR, decide(msg = far))
    }

    @Test fun respectsQuietHours() {
        assertEquals(LightningVerdict.QUIET, decide(hour = 23))
        assertEquals(LightningVerdict.QUIET, decide(hour = 3))
        assertEquals(LightningVerdict.SHOW, decide(hour = 8))
        // quiet hours turned off: lightning can come at night
        assertEquals(LightningVerdict.SHOW, decide(prefs = on.copy(quietStart = null, quietEnd = null), hour = 3))
    }

    @Test fun oldFlashesAreIgnored() {
        assertEquals(LightningVerdict.TOO_OLD, decide(msg = near.copy(tMs = now - 16 * 60_000L)))
    }

    @Test fun needsAFreshEnoughPositionOfItsOwn() {
        assertEquals(LightningVerdict.NO_LOCATION, decide(fix = null))
        assertEquals(LightningVerdict.NO_LOCATION, decide(fix = phone.copy(third = 60 * 60_000L)))
    }

    @Test fun oneNotificationPerThirtyMinutes() {
        assertEquals(LightningVerdict.COOLDOWN, decide(last = now - 10 * 60_000L))
        assertEquals(LightningVerdict.SHOW, decide(last = now - 31 * 60_000L))
    }

    @Test fun parsesTheServerMessageAndRejectsGarbage() {
        val m = LightningMsg.parse(mapOf("lat" to "40.12", "lon" to "-75.34", "t" to "1800000000000"))
        assertEquals(LightningMsg(40.12, -75.34, 1_800_000_000_000L), m)
        assertNull(LightningMsg.parse(mapOf("lat" to "x", "lon" to "-75.34", "t" to "1")))
        assertNull(LightningMsg.parse(mapOf("lat" to "95", "lon" to "-75.34", "t" to "1")))
        assertNull(LightningMsg.parse(mapOf("lat" to "40", "lon" to "-75")))
    }

    @Test fun distanceIsRoughlyRight() {
        assertEquals(6.0, LightningDecider.distanceMi(40.12, -75.34, 40.12 + 6.0 / 69.0, -75.34), 0.2)
    }

    @Test fun wordingIsATemplateWithAbout() {
        val s = LightningDecider.body(6.4)
        assertTrue(s.startsWith("Lightning about 6 mi from you."))
        assertTrue(s.contains("not an NWS alert"))
        assertTrue(LightningDecider.body(1.0).startsWith("Lightning overhead."))
    }

    @Test fun prefsRoundTripWithLightningAndOldJsonStaysOff() {
        val p = AlertPrefs(watches = true, quietStart = 22, quietEnd = 7, lightning = true)
        assertEquals(p, AlertPrefs.parse(p.toJson()))
        // JSON saved by an older build has no lightning field
        assertEquals(false, AlertPrefs.parse("""{"watches":true,"quietStart":22,"quietEnd":7}""")?.lightning)
    }
}
