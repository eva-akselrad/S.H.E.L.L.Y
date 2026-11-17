package com.evaakselrad.shelly.update

import org.json.JSONObject
import java.security.MessageDigest

/** /api/android/latest.json */
data class Release(
    val versionCode: Int,
    val versionName: String,
    val sha256: String,
    val size: Long,
    val minSdk: Int,
    val notes: String,
) {
    companion object {
        fun parse(json: String): Release? = try {
            val o = JSONObject(json)
            Release(
                versionCode = o.getInt("versionCode"),
                versionName = o.getString("versionName"),
                sha256 = o.getString("sha256").lowercase(),
                size = o.getLong("size"),
                minSdk = o.optInt("minSdk", 26),
                notes = o.optString("notes", ""),
            ).takeIf { it.versionCode > 0 && it.sha256.length == 64 && it.size > 0 }
        } catch (_: Exception) {
            null
        }
    }
}

/** The decisions of the updater, kept pure so they are unit-tested. */
object UpdateRules {
    /** Update only to a higher versionCode, and only on a phone the release supports. */
    fun shouldUpdate(installedCode: Int, sdk: Int, r: Release): Boolean = r.versionCode > installedCode && sdk >= r.minSdk

    /** Warnings and emergencies covering the phone must never be interrupted by an install. */
    fun blockedByActiveWarning(maxActiveRank: Int): Boolean = maxActiveRank >= 2

    const val CHECK_INTERVAL_MS = 6 * 3_600_000L

    fun checkDue(lastCheckMs: Long, nowMs: Long, force: Boolean): Boolean = force || nowMs - lastCheckMs >= CHECK_INTERVAL_MS

    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    fun sha256(bytes: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))
}
