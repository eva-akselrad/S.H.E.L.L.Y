package com.evaakselrad.shelly

import android.webkit.JavascriptInterface
import org.json.JSONObject

/** What the app activity must do for the website. Everything here runs on the main thread. */
interface BridgeHost {
    fun openAppSettings()
    fun openNotificationSettings()
    fun runSetup()
    fun permissionState(): JSONObject
    fun canInstallUpdates(): Boolean
    fun openInstallSettings()
    fun checkForUpdate()
}

/**
 * window.ShellyApp, exposed to our own origin only. It never returns location or secrets.
 * @JavascriptInterface methods run on a background thread, so UI work is posted to the host.
 */
class Bridge(private val prefs: Prefs, private val host: BridgeHost, private val post: (() -> Unit) -> Unit) {
    @JavascriptInterface
    fun isApp(): Boolean = true

    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun openAppSettings() = post { host.openAppSettings() }

    @JavascriptInterface
    fun openNotificationSettings() = post { host.openNotificationSettings() }

    /** Re-runs the permission walkthrough (notifications, location, all-the-time, Do Not Disturb, battery). */
    @JavascriptInterface
    fun runSetup() = post { host.runSetup() }

    /** {"notifications":bool,"location":bool,"background":bool} */
    @JavascriptInterface
    fun permissionStatus(): String = host.permissionState().toString()

    /** Whether Android lets SHELLY install its own updates ("Install unknown apps"). */
    @JavascriptInterface
    fun canInstallUpdates(): Boolean = host.canInstallUpdates()

    @JavascriptInterface
    fun openInstallSettings() = post { host.openInstallSettings() }

    /** Looks for a newer SHELLY app right now. */
    @JavascriptInterface
    fun checkForUpdate() = post { host.checkForUpdate() }

    @JavascriptInterface
    fun getAlertPrefs(): String = prefs.alertPrefs.toJson()

    /** Returns true if the JSON was valid and saved. */
    @JavascriptInterface
    fun setAlertPrefs(json: String): Boolean {
        val p = AlertPrefs.parse(json) ?: return false
        prefs.alertPrefs = p
        return true
    }
}
