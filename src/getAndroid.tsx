import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Logo, ThemeToggle } from "./components/Chrome";
import { formatMB, isAndroidBrowser, parseRelease, type AppRelease } from "./installApp";
import "./styles/main.css";

type Load = { state: "loading" } | { state: "none" } | { state: "ok"; release: AppRelease };

function GetAndroid() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  useEffect(() => {
    fetch("/api/android/latest.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const release = parseRelease(j);
        setLoad(release ? { state: "ok", release } : { state: "none" });
      })
      .catch(() => setLoad({ state: "none" }));
  }, []);
  const android = isAndroidBrowser(navigator.userAgent);

  return (
    <div class="get-android">
      <header style="display:flex;justify-content:space-between;align-items:center">
        <Logo />
        <ThemeToggle />
      </header>
      <h1>SHELLY for Android</h1>
      <p>
        Weather warnings for where you are, even with the app closed, plus a home-screen widget. Free, and it
        updates itself.
      </p>

      {!android && (
        <p class="ga-card">
          The app is Android only. On iPhone, add SHELLY to your Home Screen from the Share menu. To get the
          Android app, open this page on your Android phone.
        </p>
      )}

      <div class="ga-card">
        {load.state === "loading" && <span class="muted">Checking for the latest version…</span>}
        {load.state === "none" && <span class="muted">The Android app has not been published yet. Check back soon.</span>}
        {load.state === "ok" && (
          <>
            <a class="btn" href="/api/android/shelly.apk" download>Download SHELLY for Android</a>
            <span class="muted">
              Version {load.release.versionName} · {formatMB(load.release.size)} · Android 8 or newer
            </span>
            {load.release.notes && <span>{load.release.notes}</span>}
          </>
        )}
      </div>

      <div class="ga-card">
        <b>How to install</b>
        <ol>
          <li>Download the file, then open it. (Find it in your notifications or the Downloads app.)</li>
          <li>If Android asks, allow your browser to install apps. This is a one-time switch in Settings.</li>
          <li>If Play Protect warns you, tap More details, then Install anyway. SHELLY isn't on the Play Store, so this is expected.</li>
          <li>Open SHELLY and allow notifications. Set Location to "Allow all the time" so warnings work with the app closed.</li>
        </ol>
      </div>
      <p class="muted">
        <a href="/">Back to SHELLY</a>
      </p>
    </div>
  );
}

render(<GetAndroid />, document.getElementById("app")!);
