package com.evaakselrad.shelly

import android.content.Context
import java.net.HttpURLConnection
import java.net.URL

object Site {
    fun url(context: Context): String = Prefs(context).siteOverride ?: BuildConfig.SITE_URL
}

/** Tiny HTTP client for SHELLY's own API. Call from a background thread. */
object Api {
    /** @return the raw JSON of /api/glance for this point, or null on any failure */
    fun fetchGlance(context: Context, lat: Double, lon: Double): String? {
        val url = "${Site.url(context)}/api/glance?lat=${"%.4f".format(java.util.Locale.US, lat)}&lon=${"%.4f".format(java.util.Locale.US, lon)}"
        return get(url)
    }

    private fun get(url: String): String? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000
        c.readTimeout = 15_000
        c.setRequestProperty("User-Agent", "SHELLYApp/${BuildConfig.VERSION_NAME}")
        c.setRequestProperty("Accept", "application/json")
        try {
            if (c.responseCode == 200) c.inputStream.bufferedReader().use { it.readText() } else null
        } finally {
            c.disconnect()
        }
    } catch (_: Exception) {
        null
    }
}
