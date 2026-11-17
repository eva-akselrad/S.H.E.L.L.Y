# The website calls these through window.ShellyApp, so R8 must keep them.
-keepclassmembers class com.evaakselrad.shelly.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
