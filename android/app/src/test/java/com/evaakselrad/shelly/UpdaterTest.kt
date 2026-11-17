package com.evaakselrad.shelly

import com.evaakselrad.shelly.update.Release
import com.evaakselrad.shelly.update.UpdateRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdaterTest {
    private val sha = "a".repeat(64)
    private fun release(code: Int = 2, minSdk: Int = 26) = Release(code, "1.0.1", sha, 1000, minSdk, "")

    @Test fun parsesLatestJson() {
        val r = Release.parse("""{"versionCode":3,"versionName":"1.2.0","sha256":"${sha.uppercase()}","size":1234,"minSdk":26,"notes":"Fixes","published":"2026-11-17"}""")
        assertNotNull(r)
        assertEquals(3, r!!.versionCode)
        assertEquals(sha, r.sha256) // lower-cased
        assertEquals("Fixes", r.notes)
    }

    @Test fun rejectsBrokenOrIncompleteReleases() {
        assertNull(Release.parse("nope"))
        assertNull(Release.parse("""{"versionCode":0,"versionName":"x","sha256":"$sha","size":1}"""))
        assertNull(Release.parse("""{"versionCode":2,"versionName":"x","sha256":"short","size":1}"""))
        assertNull(Release.parse("""{"versionCode":2,"versionName":"x","sha256":"$sha","size":0}"""))
    }

    @Test fun onlyUpdatesToAHigherVersionOnASupportedPhone() {
        assertTrue(UpdateRules.shouldUpdate(1, 34, release(2)))
        assertFalse(UpdateRules.shouldUpdate(2, 34, release(2)))
        assertFalse(UpdateRules.shouldUpdate(3, 34, release(2)))
        assertFalse(UpdateRules.shouldUpdate(1, 26, release(2, minSdk = 30)))
    }

    @Test fun neverInstallsDuringAWarning() {
        assertTrue(UpdateRules.blockedByActiveWarning(2))
        assertTrue(UpdateRules.blockedByActiveWarning(3))
        assertFalse(UpdateRules.blockedByActiveWarning(1))
        assertFalse(UpdateRules.blockedByActiveWarning(0))
    }

    @Test fun checksAtMostEverySixHoursUnlessForced() {
        val now = 100 * 3_600_000L
        assertFalse(UpdateRules.checkDue(now - 3_600_000L, now, force = false))
        assertTrue(UpdateRules.checkDue(now - 7 * 3_600_000L, now, force = false))
        assertTrue(UpdateRules.checkDue(now - 1_000L, now, force = true))
    }

    @Test fun sha256IsHexLowercase() {
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", UpdateRules.sha256(ByteArray(0)))
    }
}
