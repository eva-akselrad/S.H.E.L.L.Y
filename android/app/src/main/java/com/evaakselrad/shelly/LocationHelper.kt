package com.evaakselrad.shelly

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.android.gms.tasks.Tasks
import java.util.concurrent.TimeUnit

/** The phone's position, kept on the phone. Blocking; call from a background thread. */
object LocationHelper {
    data class Fix(val lat: Double, val lon: Double, val ageMs: Long)

    private const val FRESH_MS = 15 * 60_000L

    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /**
     * Last known position if it is under 15 minutes old, else a balanced-power fix (20 s limit),
     * else the last known position of any age, else the one saved from the last successful run.
     */
    @Suppress("MissingPermission")
    fun current(context: Context, nowMs: Long = System.currentTimeMillis()): Fix? {
        val prefs = Prefs(context)
        if (hasPermission(context)) {
            val client = LocationServices.getFusedLocationProviderClient(context)
            val last = try { Tasks.await(client.lastLocation, 5, TimeUnit.SECONDS) } catch (_: Exception) { null }
            if (last != null && nowMs - last.time < FRESH_MS) return save(prefs, last.latitude, last.longitude, last.time, nowMs)
            val fresh = try {
                Tasks.await(client.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, CancellationTokenSource().token), 20, TimeUnit.SECONDS)
            } catch (_: Exception) {
                null
            }
            if (fresh != null) return save(prefs, fresh.latitude, fresh.longitude, fresh.time, nowMs)
            if (last != null) return save(prefs, last.latitude, last.longitude, last.time, nowMs)
            // Google's location service gave nothing: ask Android's own providers (GPS, network, passive)
            val lm = context.getSystemService(LocationManager::class.java)
            val best: Location? = try {
                lm.getProviders(true).mapNotNull { lm.getLastKnownLocation(it) }.maxByOrNull { it.time }
            } catch (_: Exception) {
                null
            }
            if (best != null) return save(prefs, best.latitude, best.longitude, best.time, nowMs)
        }
        val saved = prefs.lastLocation() ?: return null
        return Fix(saved.first, saved.second, nowMs - saved.third)
    }

    /**
     * Quick, for an FCM handler (it has about 20 s): the fused last position if there is one, else the one saved
     * by the last refresh. Never starts a new fix.
     */
    @Suppress("MissingPermission")
    fun lastKnown(context: Context, nowMs: Long = System.currentTimeMillis()): Triple<Double, Double, Long>? {
        if (hasPermission(context)) {
            val last = try { Tasks.await(LocationServices.getFusedLocationProviderClient(context).lastLocation, 5, TimeUnit.SECONDS) } catch (_: Exception) { null }
            if (last != null) return Triple(last.latitude, last.longitude, nowMs - last.time)
        }
        val saved = Prefs(context).lastLocation() ?: return null
        return Triple(saved.first, saved.second, nowMs - saved.third)
    }

    private fun save(prefs: Prefs, lat: Double, lon: Double, fixMs: Long, nowMs: Long): Fix {
        prefs.saveLocation(lat, lon, fixMs)
        return Fix(lat, lon, nowMs - fixMs)
    }
}
