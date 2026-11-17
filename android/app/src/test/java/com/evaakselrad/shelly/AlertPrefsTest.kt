package com.evaakselrad.shelly

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AlertPrefsTest {
    @Test fun roundTrips() {
        val p = AlertPrefs(watches = true, quietStart = 22, quietEnd = 7)
        assertEquals(p, AlertPrefs.parse(p.toJson()))
    }

    @Test fun nullQuietHoursMeanNeverQuiet() {
        val p = AlertPrefs.parse("""{"watches":false,"quietStart":null,"quietEnd":null}""")
        assertEquals(AlertPrefs(false, null, null), p)
    }

    @Test fun rejectsBadHoursAndGarbage() {
        assertNull(AlertPrefs.parse("""{"watches":true,"quietStart":24,"quietEnd":7}"""))
        assertNull(AlertPrefs.parse("""{"watches":true,"quietStart":-1,"quietEnd":7}"""))
        assertNull(AlertPrefs.parse("not json"))
        assertNull(AlertPrefs.parse(""))
    }
}
