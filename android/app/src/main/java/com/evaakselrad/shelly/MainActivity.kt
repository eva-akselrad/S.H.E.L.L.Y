package com.evaakselrad.shelly

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

class MainActivity : AppCompatActivity(), BridgeHost {
    private lateinit var web: WebView
    private lateinit var offline: View
    private lateinit var prefs: Prefs

    private val siteUri: Uri = Uri.parse(BuildConfig.SITE_URL)
    private val siteOrigin: String = "${siteUri.scheme}://${siteUri.authority}"

    /** Continues the setup walkthrough after the user comes back from a Settings screen. */
    private var afterSettings: (() -> Unit)? = null
    private var pendingGeoOrigin: String? = null
    private var pendingGeoCallback: GeolocationPermissions.Callback? = null
    private var onPermResult: (() -> Unit)? = null

    private val requestPerms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        val geoCb = pendingGeoCallback
        val geoOrigin = pendingGeoOrigin
        if (geoCb != null && geoOrigin != null) {
            geoCb.invoke(geoOrigin, hasLocation(), false)
            pendingGeoCallback = null
            pendingGeoOrigin = null
        }
        val next = onPermResult
        onPermResult = null
        next?.invoke()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)
        Notifier.createChannels(this)

        // dark app: light status/navigation bar icons
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        web = findViewById(R.id.web)
        offline = findViewById(R.id.offline)
        findViewById<View>(R.id.retry).setOnClickListener { load() }

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false // SHELLY's music
            setGeolocationEnabled(true)
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            allowContentAccess = false
            userAgentString = "$userAgentString SHELLYApp/${BuildConfig.VERSION_NAME}"
        }
        web.setBackgroundColor(ContextCompat.getColor(this, R.color.shelly_bg))
        web.webViewClient = SiteClient()
        web.webChromeClient = SiteChrome()

        // Only our own origin is ever loaded here (see shouldOverrideUrlLoading), and the bridge
        // returns no location or secrets, so exposing it to the page is safe.
        web.addJavascriptInterface(Bridge(prefs, this) { runOnUiThread(it) }, "ShellyApp")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else load()
        if (!prefs.onboarded) {
            prefs.onboarded = true // an interrupted walkthrough must not nag on every launch
            runSetup()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        val next = afterSettings
        afterSettings = null
        next?.invoke()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    private fun load() {
        offline.visibility = View.GONE
        web.visibility = View.VISIBLE
        web.loadUrl(BuildConfig.SITE_URL)
    }

    private fun isOurs(uri: Uri): Boolean = "${uri.scheme}://${uri.authority}" == siteOrigin

    private inner class SiteClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (isOurs(request.url)) return false
            // everything else opens in the browser, never inside SHELLY
            if (request.url.scheme == "http" || request.url.scheme == "https") {
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (_: Exception) {
                }
            }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            offline.visibility = View.GONE
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                offline.visibility = View.VISIBLE
                web.visibility = View.INVISIBLE
            }
        }
    }

    private inner class SiteChrome : WebChromeClient() {
        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            if (origin.trimEnd('/') != siteOrigin) return callback.invoke(origin, false, false)
            if (hasLocation()) return callback.invoke(origin, true, false)
            pendingGeoOrigin = origin
            pendingGeoCallback = callback
            requestPerms.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        }
    }

    // ── permissions ──
    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED
    private fun hasLocation() = granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)
    private fun hasNotifications() = Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS)
    private fun hasBackground() = Build.VERSION.SDK_INT < 29 || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)

    override fun permissionState(): JSONObject =
        JSONObject().put("notifications", hasNotifications()).put("location", hasLocation()).put("background", hasBackground())

    override fun openAppSettings() {
        startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }

    override fun openNotificationSettings() {
        startActivity(
            Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                .putExtra(Settings.EXTRA_CHANNEL_ID, Notifier.CH_WARNINGS),
        )
    }

    /**
     * The walkthrough: notifications, location, location all the time, Do Not Disturb, battery.
     * Each step explains why first. Every step can be skipped and the app still works.
     */
    override fun runSetup() {
        val steps = mutableListOf<(next: () -> Unit) -> Unit>()

        if (!hasNotifications()) steps += { next ->
            explain("Warnings", "SHELLY needs to send you notifications so a tornado or flash flood warning can reach you, even when the app is closed.", "Allow") {
                onPermResult = next
                requestPerms.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
            }.orElse(next)
        }
        if (!hasLocation()) steps += { next ->
            explain("Your location", "SHELLY uses where you are so warnings are for your exact spot, not a whole county. Your location is never saved on SHELLY's servers.", "Allow") {
                onPermResult = next
                requestPerms.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            }.orElse(next)
        }
        steps += { next ->
            if (!hasLocation() || hasBackground()) next() else {
                explain(
                    "Warnings with the app closed",
                    "To warn you wherever you are, even with the app closed, choose \"Allow all the time\" for Location on the next screen. If you skip this, SHELLY still works using your location from the last time you opened it.",
                    "Open settings",
                ) {
                    if (Build.VERSION.SDK_INT == 29) {
                        onPermResult = next
                        requestPerms.launch(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
                    } else {
                        afterSettings = next
                        openAppSettings()
                    }
                }.orElse(next)
            }
        }
        steps += { next ->
            explain(
                "Let warnings ring through Do Not Disturb",
                "Optional. On the next screen, turn on \"Override Do Not Disturb\" for Warnings so a tornado warning can wake you overnight.",
                "Open settings",
            ) {
                afterSettings = next
                openNotificationSettings()
            }.orElse(next)
        }
        steps += { next ->
            explain(
                "Keep SHELLY running",
                "Optional. Some phones stop apps in the background to save battery. Set SHELLY to \"Unrestricted\" so alerts are never delayed.",
                "Open settings",
            ) {
                afterSettings = next
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }.orElse(next)
        }

        fun run(i: Int) {
            if (i < steps.size) steps[i] { run(i + 1) }
        }
        run(0)
    }

    private class Dialog(val show: (onSkip: () -> Unit) -> Unit) {
        fun orElse(skip: () -> Unit) = show(skip)
    }

    private fun explain(title: String, message: String, positive: String, onYes: () -> Unit): Dialog =
        Dialog { onSkip ->
            AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setCancelable(false)
                .setPositiveButton(positive) { _, _ -> onYes() }
                .setNegativeButton("Not now") { _, _ -> onSkip() }
                .show()
        }
}
