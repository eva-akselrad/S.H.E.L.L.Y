# SHELLY for Android: implementation plan

Written 2026-11-17 for the model or engineer who builds it. Read **CLAUDE.md** first; every
rule there applies (name is always SHELLY, no AI attribution anywhere, commit only when
asked, ask before deploying or creating cloud projects).

## Decisions already made by the user (don't re-ask)

- **Native Android app**, sideloaded from the SHELLY website. **Not on the Play Store.**
- **No Android Auto.** Dropped.
- Package / app ID: **`com.evaakselrad.shelly`** (final; it gets registered with Google).
- Widget and alerts follow the **phone's GPS**, not the place picked on the website.
- **Push through Firebase Cloud Messaging (FCM)**, free Spark plan, no billing account.
  The Worker decides everything; FCM only delivers. No Firebase SDK in the Worker.
- **Self-updating app** (no Play Store): the app downloads and installs its own updates.
- The website shows an **"install the app" prompt** on Android that leads to a download page.
- Google developer verification goes through the user's **existing Play Console account**
  (register package + signing key there; nothing is published on Play).

## Hard rules for this work

1. **Alert text is never written by an LLM.** Everything a notification or widget says
   about a warning comes from NWS fields plus the deterministic templates in
   `shared/actions.ts` (`actionFor`). Same rule as the rest of SHELLY.
2. **The Worker never stores a phone's location.** Phones subscribe to FCM topics named
   after their NWS zones; exact polygon checks happen per request and are not saved.
3. **Stop and ask the user** before: creating the Firebase project (the user creates it),
   `wrangler secret put`, any `npm run deploy`, publishing an APK, committing, or anything
   in the user's Play Console. The user enters all passwords themselves (keystore).
4. Check current docs (Android, FCM HTTP v1, Glance, WorkManager, PackageInstaller,
   Cloudflare) instead of relying on memory. Versions below are starting points.

## Architecture

```
NWS ─(cron, every minute)─> Worker pollAlerts() ─> KV alerts
                                    │
                                    ├─> fanOutPushes()  (existing web push, unchanged)
                                    └─> fanOutFcm()     NEW: for each new/upgraded alert,
                                          send a tiny data message to FCM topic condition
                                          "'z_PAZ106' in topics || 'z_PAC101' in topics ..."
                                                │
Phone (SHELLY app)  <──── FCM high-priority data message {type:"alert", id, level}
   │  1. get location (fused, last known is OK if fresh < 15 min, else current)
   │  2. GET /api/glance?lat&lon  -> conditions + alerts covering this exact point
   │  3. AlertDecider: notify for covering alerts not shown yet (or upgraded)
   │  4. update widget
   └─ WorkManager every 15 min: same steps 1-4 (catch-up if a push was lost), refresh
      topic subscriptions when zones change, check for app updates (daily)
```

The app's main screen is a **WebView of the live site** (`https://shelly.scienceandfire66.workers.dev`),
so every website deploy updates the app UI with no new APK. Only native changes (widget,
notifications, updater) need a new APK. No Capacitor: a plain Kotlin WebView activity plus
a tiny JS bridge is simpler and everything else is native anyway.

## Repo layout (new)

```
android/                      Gradle project (Kotlin, Gradle Kotlin DSL)
  app/src/main/java/com/evaakselrad/shelly/
    MainActivity.kt           WebView host, permissions onboarding, JS bridge
    Bridge.kt                 @JavascriptInterface "ShellyApp"
    Api.kt                    HTTP client for /api/glance, /api/location, /api/android/latest.json
    Glance.kt                 data classes for the /api/glance JSON
    LocationHelper.kt         fused location, last-known with freshness check
    Topics.kt                 zone -> FCM topic subscribe/unsubscribe
    AlertDecider.kt           pure: which alerts to notify (unit-tested)
    Notifier.kt               channels + notifications
    ShellyMessagingService.kt FirebaseMessagingService
    RefreshWorker.kt          WorkManager 15-min periodic: location->glance->notify->widget
    widget/ShellyWidget.kt    Jetpack Glance widget (+ receiver)
    update/Updater.kt         version check, download, verify, PackageInstaller
    update/UpdateWorker.kt    daily check
    Prefs.kt                  SharedPreferences wrapper
  app/src/test/...            JVM unit tests for AlertDecider, version compare, topic names
shared/fcm.ts                 pure: topic names, conditions, which alerts to send (tested)
shared/glance.ts              pure: build the glance payload (tested)
worker/fcm.ts                 OAuth (service-account JWT via WebCrypto), send, fanOutFcm
worker/android.ts             /api/glance, /api/android/latest.json, /api/android/shelly.apk
src/components/InstallApp.tsx install banner (website, Android only, not inside the app)
get-android/index.html        Vite entry for the /get-android download page (like admin/index.html)
src/getAndroid.tsx            that page's Preact code
scripts/android-release.mjs   build release APK, hash it, upload to KV, write latest.json
test/android.test.ts          Vitest for shared/fcm.ts, shared/glance.ts, worker/fcm.ts JWT
```

Add to `.gitignore`: `android/.gradle/`, `android/build/`, `android/app/build/`,
`android/local.properties`, `android/keystore.properties`, `android/app/google-services.json`,
`*.apk`, `*.aab`, `*.jks`, `*.keystore`.

## Toolchain on this PC (verified 2026-11-17)

- Android Studio installed (`C:\Program Files\Android\Android Studio`).
- SDK at `%LOCALAPPDATA%\Android\Sdk`: platforms 35, 36, 36.1; build-tools up to 36.1.0;
  platform-tools (adb is there but **not on PATH**: use the full path).
- System Java is 25, likely too new for the Android Gradle Plugin. Build with Android
  Studio's bundled JBR: `JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"`.
- No `gradle` on PATH. **Ask the user** to create the skeleton in Android Studio
  (New Project → Empty Views Activity → name SHELLY, package `com.evaakselrad.shelly`,
  Kotlin, Gradle Kotlin DSL, min SDK 26, save to `<repo>/android`). That produces a
  working `gradlew`. Then build from the shell with `./gradlew` (Git Bash) and the JBR.
- Repo is in OneDrive. Exclude `android/.gradle` and `android/**/build` from OneDrive
  sync if builds get file-lock errors.

---

## Phase A1: Worker data for the app (no Android needed)

**STATUS: built 2026-11-17 (not deployed).** Deviation from the text below: NWS `references` are
not in chronological order (checked against live data) and can span different events, so
`GlanceAlert` has `refs: string[]` instead of `rootId`. The app's AlertDecider must treat any
shared id among `[id, ...refs]` as the same alert. Also added: `worker/loaders.ts` (shared cached
loaders), the `/api/android/*` routes (A5.1), and `.gitignore` entries.

**A1.1 `shared/glance.ts`** (pure, tested). `buildGlance(input)` returns:

```ts
interface GlancePayload {
  v: 1;
  updated: string;                 // ISO, when built
  alertsUpdated: string | null;    // ISO of the last NWS poll (for staleness)
  place: { name: string; state: string | null; tz: string; zones: string[] };
  now: { temp: number; feels: number; code: number; isDay: boolean; desc: string; icon: string } | null;
  today: { hi: number; lo: number } | null;
  rain: string | null;             // rainNowcast(...).sentence
  level: "CALM" | "ELEVATED" | "WARNING" | "EMERGENCY";
  alerts: GlanceAlert[];           // only alerts covering THIS point, most severe first
}
interface GlanceAlert {
  id: string; rootId: string;      // rootId = oldest id in references chain, or id
  event: string; level: ThreatLevel; expires: string | null; areaDesc: string;
  headline: string;
  action: { urgency: string; title: string; steps: string[] } | null; // actionFor()
}
```
- Coverage: `alertCoversPoint(a, {lat, lon, zones})` from `shared/threat.ts`.
- Level: `alertLevel(a)`; overall level: `computeThreat(...)` (pass alerts, point, nowcast).
- Action: `actionFor(alert, localHour(tz), config.safety)`.
- Sky: `wmoToWeather(code, isDay)`. Rain: `rainNowcast(...)` from `shared/nowcast.ts`.
- `rootId`: if `references` is non-empty use the **last** element (oldest), else `id`.
  Check NWS ordering of `references` in `worker/sources/nws.ts` and pick the oldest.
- Truncate `areaDesc` to ~200 chars, steps to 4.

**A1.2 `GET /api/glance?lat=&lon=`** in `worker/android.ts`, wired in `worker/index.ts`.
- Reuse the same cached loaders as `/api/location` (key `loc:…`) and `/api/forecast`
  (key `fc:…`); factor them into helpers rather than copying.
- Zones = `[forecastZone, countyZone, fireZone]` filtered.
- Alerts from `readAlerts(env)` plus admin test alerts (`readSim` + `buildSimAlert`,
  exactly like `/api/alerts`) so the admin "test alert" button also tests the app.
- Same staleness safety net as `/api/alerts` (`ctx.waitUntil(pollAlerts(env))` if > 180 s).
- `Cache-Control: max-age=15`. 400 on bad coords, 404 outside the US.

**A1.3 `shared/fcm.ts`** (pure, tested):
- `zoneTopic(zone)` → `"z_" + zone` (FCM topic charset `[a-zA-Z0-9-_.~%]`; NWS zone ids fit).
- `topicConditions(zones)` → array of condition strings, at most **5 topics each**
  (FCM limit), e.g. `"'z_PAZ106' in topics || 'z_PAC101' in topics"`. Dedupe zones.
- `decideFcmSends(alerts, sent, now)` → alerts to send this minute:
  level ≥ ELEVATED, not expired, id not in `sent`; an update (any `references` id in
  `sent`) is sent again **only if its level rank is higher** than what was sent.
  Mirror the logic and tests of `decidePushes` in `shared/push.ts`.
- `updateFcmSent(sent, sentNow, alerts, now)` → prune entries whose alert expired > 1 h ago.

**A1.4 `worker/fcm.ts`**:
- Secret `FCM_SERVICE_ACCOUNT` (the whole service-account JSON). Add to `worker/env.d.ts`
  as optional; when missing, `fanOutFcm` is a no-op (like `vapid()` in `worker/push.ts`).
- OAuth: RS256 JWT (`iss`=client_email, `scope`=`https://www.googleapis.com/auth/firebase.messaging`,
  `aud`=`https://oauth2.googleapis.com/token`, 1 h exp), signed with WebCrypto
  (`importKey("pkcs8", …, {name:"RSASSA-PKCS1-v1_5", hash:"SHA-256"})`), exchanged at the
  token URL. Cache the access token in KV (`fcm:token`, ~50 min). Plain `fetch`, no SDK.
- Send: `POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send`
  with `{ message: { condition, data: { type: "alert", id, level }, android: { priority: "HIGH", ttl: "1800s" } } }`.
  Data-only (no `notification` block) so the app decides what to show.
  ELEVATED alerts: `priority: "NORMAL"`, ttl 3 h.
- `fanOutFcm(env, alerts)`: called in the `scheduled` handler right after `fanOutPushes`
  with the same `alerts`. KV key `fcm:sent`. Cap sends per run (start with 300 requests;
  check the current Workers subrequest limit); leftovers go next minute because they are
  not marked sent. Log failures as JSON like `push_failed`.
- Admin: `POST /api/admin/fcm-test` sends `{type:"test"}` to topic `all`. Add an
  "App push" tile and "Send test to app" button in `src/admin/Overview.tsx` next to the
  web-push ones, and report `fcm: configured|missing` in the admin status.

**A1.5 Tests** (`test/android.test.ts`): buildGlance covers/doesn't cover a polygon point,
zone-only alerts, rootId, action steps present for a Tornado Warning; topicConditions
chunking (12 zones → 3 conditions); decideFcmSends new/duplicate/upgrade/expired; JWT:
generate an RSA key in the test, sign, verify with the public key, check claims.

**Done when:** `npm test`, `npm run typecheck` (or whatever the repo's scripts are; see
`package.json`) pass, and `wrangler dev` returns a sane `/api/glance?lat=39.95&lon=-75.16`.
Don't deploy yet.

## Phase A2: Android app shell

**A2.1 Project** (after the user creates the skeleton, see Toolchain):
- `minSdk 26`, `targetSdk`/`compileSdk` 36. `applicationId "com.evaakselrad.shelly"`.
- Dependencies (check latest stable): androidx core-ktx, appcompat, webkit,
  work-runtime-ktx, glance-appwidget, `com.google.android.gms:play-services-location`,
  Firebase BoM + `firebase-messaging` (plugin `com.google.gms.google-services`), kotlinx
  coroutines, kotlinx-serialization-json (or org.json). JUnit for tests.
- App icon: adaptive icon from the SHELLY logo (see `src/components/Chrome.tsx` `Logo`
  and `public/favicon.png`). Dark background `#0b1220`, accent `#ff8a65`.
- Signing: `android/keystore.properties` (gitignored) read by `app/build.gradle.kts` for
  the `release` config. **The user creates the keystore** by running this themselves
  (it prompts for passwords; never ask for them in chat):
  `"C:\Program Files\Android\Android Studio\jbr\bin\keytool" -genkeypair -v -keystore "%USERPROFILE%\.shelly-keys\shelly-release.jks" -alias shelly -keyalg RSA -keysize 4096 -validity 36500`
  Keep it **outside OneDrive and outside the repo**, and tell the user to back it up
  (password manager or USB drive). Losing it means no updates and no Google registration.
- Print the SHA-256 fingerprint for the user (`keytool -list -v -keystore … -alias shelly`).

**A2.2 `MainActivity`**: full-screen WebView loading the site root.
- `javaScriptEnabled`, `domStorageEnabled`, `mediaPlaybackRequiresUserGesture=false`
  (music), geolocation enabled (`WebChromeClient.onGeolocationPermissionsShowPrompt`
  → grant only for our origin after the Android permission is granted).
- User agent: append `" SHELLYApp/<versionName>"`.
- Only our origin loads in the WebView; any other link opens in the browser
  (`shouldOverrideUrlLoading`). Back button → `webView.goBack()` if possible.
- Offline / error: a simple native "Can't reach SHELLY, retry" view.
- Edge-to-edge with correct insets; status bar dark.

**A2.3 Bridge** (`window.ShellyApp`, added only for our origin):
`isApp(): Boolean`, `version(): String`, `openAppSettings()`, `openNotificationSettings()`,
`getAlertPrefs(): String` / `setAlertPrefs(json)` (watches on/off, quiet hours, same shape
as `PushPrefs` in `shared/push.ts`). Nothing that returns location or secrets.

**A2.4 Website changes for in-app use** (`src/`):
- `src/native.ts`: `inApp = navigator.userAgent.includes("SHELLYApp/")` and typed
  access to `window.ShellyApp`.
- In the app: hide `PushToggle` (web push doesn't work in WebView; native push replaces
  it), hide `SoundOutput`, hide the install banner, and on load locate by GPS
  (`navigator.geolocation` → `locateByCoords`) because the app follows GPS.
- Show an "App alerts" section (in the phone shell's tools area) with watch/quiet-hours
  toggles that call the bridge, and a button to open notification settings.

**A2.5 Permissions onboarding** (native, first launch, then from the "App alerts" button):
1. Notifications (`POST_NOTIFICATIONS`, Android 13+).
2. Location while using (`ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION`).
3. Location **all the time** (`ACCESS_BACKGROUND_LOCATION`): Android 11+ can't prompt
   inline; explain why (warnings for where you are, even with the app closed) and open
   app settings. If refused, the app still works using the last location from when it
   was open; say so plainly.
4. "Warnings can ring through Do Not Disturb": open the Warnings channel settings
   (`Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS`) so the user can enable
   "Override Do Not Disturb". Optional, skippable.
5. Battery: suggest "Unrestricted" for SHELLY (link to app battery settings). Optional.

**Done when:** debug APK installs on the user's phone over USB
(`<sdk>/platform-tools/adb.exe install -r app-debug.apk`, user enables USB debugging),
the site loads, GPS locates, music plays, back button works, external links leave the app.

## Phase A3: Alerts (FCM + catch-up)

**Prerequisite, user action:** the user creates a free Firebase project (Spark plan, no
billing), adds an Android app with package `com.evaakselrad.shelly`, downloads
`google-services.json` into `android/app/` (gitignored), and creates a service-account
key for the Worker. Walk them through it; do not do it for them. Then **ask** before
running `npx wrangler secret put FCM_SERVICE_ACCOUNT` (the user pastes the JSON).

**A3.1 Channels** (`Notifier.kt`):
- `warnings`: "Warnings", IMPORTANCE_HIGH, alarm-style sound (`AudioAttributes.USAGE_ALARM`),
  vibration, lockscreen public. For EMERGENCY (tornado emergency, etc.) also use a
  full-screen intent if `USE_FULL_SCREEN_INTENT` is granted (Android 14+ check
  `canUseFullScreenIntent()`; otherwise just the high-priority notification).
- `watches`: "Watches & advisories", IMPORTANCE_DEFAULT.
- `app`: "App updates", IMPORTANCE_LOW.
- Notification: title = event (e.g. "Tornado Warning"), text = action title, big text =
  numbered steps + "Until 4:30 PM" + area. **All from `/api/glance`**, never invented.
  Tap opens MainActivity. Notification id = stable hash of `rootId`.

**A3.2 `AlertDecider.kt`** (pure, JVM-tested), state in Prefs as `rootId → shownRank, expires`:
- Notify a covering alert if its `rootId` was never shown, or its level rank is higher
  than what was shown (upgrade, e.g. warning → emergency). Otherwise update the existing
  notification silently (`setOnlyAlertOnce(true)`) or leave it.
- ELEVATED alerts: only if the user enabled watches, and silent during quiet hours.
  WARNING/EMERGENCY ignore quiet hours. Same semantics as `shared/push.ts`.
- Cancel notifications for alerts that are gone/expired. Prune state after expiry + 1 h.

**A3.3 `ShellyMessagingService`**:
- `onMessageReceived`: for `type=alert` → enqueue an **expedited** one-time WorkManager
  job (`setExpedited`) that runs the refresh pipeline (location → glance → decide →
  notify → widget). For `type=test` → show "Test from SHELLY: app alerts work" on the
  warnings channel.
- `onNewToken`: no server registration needed (topics only); just re-run topic sync.

**A3.4 `Topics.kt`**: after each location fix, `GET /api/location?lat&lon` (cached 1 day
on the Worker) → zones → subscribe `z_<zone>` for new zones, unsubscribe old ones, keep
`all` always subscribed. Store the current set in Prefs. Only call when zones change.

**A3.5 `RefreshWorker`**: periodic every 15 min (`PeriodicWorkRequest`, network
constraint), plus on app open, on boot (`RECEIVE_BOOT_COMPLETED`), after app update, and
from FCM. Pipeline: location (use last known if < 15 min old, else a balanced-power
current fix with a 20 s timeout, else last known of any age) → topics sync →
`/api/glance` → AlertDecider → Notifier → save glance JSON → update widget.
Never crash on network failure; keep the last glance and mark it stale.

**Known limit to document:** FCM may deprioritize high-priority messages that often
don't produce a notification (zone topics are broader than warning polygons). The
15-minute catch-up covers missed pushes. If deprioritization shows up in testing,
consider sending warnings only to county-zone topics or a finer scheme.

**Done when:** with the phone's location inside an admin test alert (admin → test alert),
"Send test to app" shows a notification within seconds with the app swiped away; a real
NWS-style test via the sim produces the correct template steps; turning off the network
and back on recovers within one worker run.

## Phase A4: Widget (Jetpack Glance)

- Two layouts: **small** (2×1: icon + temp) and **wide** (4×2: temp, sky, hi/lo, rain
  line, place name, "updated 9:41 PM"). Responsive `SizeMode.Responsive`.
- During WARNING/EMERGENCY the widget background turns red (`#7a0010`-ish, white text)
  and shows the event + action title instead of the rain line ("Tornado Warning — Take
  shelter now"). ELEVATED: amber strip with the event name.
- Reads the saved glance JSON only (no network in the widget itself); `RefreshWorker`
  calls `ShellyWidget().updateAll(context)` after saving.
- Stale > 2 h: show "Not updated since …" in muted text. Tap → MainActivity.
- Icons: vector drawables matching the site's `WxIcon` keys (`src/components/Icon.tsx`).
- Light and dark aware; readable text sizes (≥ 12sp; temp large).

**Done when:** both sizes render on the phone, update after a refresh, and turn red with
an admin test alert at the phone's location.

## Phase A5: Self-updates and distribution

**A5.1 Hosting** (no new cloud resources): APK bytes in the existing KV namespace
`STATE` (value limit 25 MiB; keep the APK well under, R8/minify on).
- KV keys: `android:apk:<versionCode>` (bytes), `android:latest` (JSON:
  `{versionCode, versionName, sha256, size, minSdk, notes, published}`).
- Routes in `worker/android.ts` (under `/api/` so no wrangler config change is needed):
  `GET /api/android/latest.json` (max-age 300) and `GET /api/android/shelly.apk`
  (streams the latest bytes, `Content-Type: application/vnd.android.package-archive`,
  `Content-Disposition: attachment; filename="SHELLY-<versionName>.apk"`).

**A5.2 `scripts/android-release.mjs`**: reads versionCode/versionName from
`app/build.gradle.kts`, runs `gradlew assembleRelease` with the JBR, computes SHA-256 and
size, then (after **asking the user**) uploads with
`npx wrangler kv key put --binding STATE --remote "android:apk:<code>" --path <apk>` and
writes `android:latest`. Check the current `wrangler kv` syntax with the wrangler skill.
Bump versionCode every release. Document the steps in `docs/LIVE_STREAMING.md`-style
`docs/ANDROID.md`.

**A5.3 `Updater.kt`** (daily via `UpdateWorker`, and on app open at most every 6 h):
- Fetch `latest.json`; if `versionCode` > installed, download to app cache, verify
  SHA-256, and verify the APK's signing certificate equals the installed app's
  (`getPackageArchiveInfo(..., GET_SIGNING_CERTIFICATES)`); refuse otherwise.
- Install with `PackageInstaller` session. On Android 12+ set
  `setRequireUserAction(USER_ACTION_NOT_REQUIRED)` and declare
  `UPDATE_PACKAGES_WITHOUT_USER_ACTION` (Android 13+) so later updates install silently.
  Also needs `REQUEST_INSTALL_PACKAGES` and the user allowing "Install unknown apps" for
  SHELLY (send them to `ACTION_MANAGE_UNKNOWN_APP_SOURCES` once). Verify on the device
  which updates are truly silent; the first self-update is expected to need one tap.
- Never update while a WARNING/EMERGENCY is active for the user's location.
- Show progress/errors on the `app` channel. After an update, re-schedule workers.

**A5.4 Developer verification (user action, in the user's Play Console):** register
package `com.evaakselrad.shelly` with the release key's SHA-256 under the Android developer
verification page. Google then gives an ownership snippet: put it in
`app/src/main/assets/` exactly as instructed, build a signed release, and the user uploads
that APK in the console. Not required in the US until Google's 2027 global rollout, but
doing it now avoids a cliff later.

## Phase A6: Install prompt and download page (website)

- **`InstallApp.tsx`** banner in the web and phone shells: shown when the UA is Android,
  not `inApp`, not kiosk, and not dismissed in the last 30 days (`localStorage` key
  `shelly.v2.appBanner`, wrapped in try/catch). Text: "Get the SHELLY app: warnings for
  where you are, even with the app closed, and a home-screen widget." Buttons: "Get the
  app" → `/get-android/`, "Not now".
- **`/get-android/` page**: a separate Vite entry exactly like the admin page
  (`get-android/index.html` + `src/getAndroid.tsx`, add it to `build.rollupOptions.input`
  in `vite.config.ts`). Don't use `/android`: that folder is the Gradle project.
  Content: version + size from `latest.json`, big
  "Download SHELLY for Android" button → `/api/android/shelly.apk`, and short steps:
  1. Tap Download, then open the file.
  2. If asked, allow your browser to "Install unknown apps", then go back and tap Install.
  3. If Play Protect warns, tap "More details → Install anyway". (SHELLY is from a
     verified developer once A5.4 is done; keep the wording honest about the warning.)
  4. Open SHELLY and allow notifications and location "All the time".
  Non-Android visitors see: "The app is Android only. On iPhone, add SHELLY to your
  Home Screen from the Share menu." Match the site's existing styles; readable on all
  weather scenes and in light/dark.

## Order and checkpoints

1. **A1** (Worker + tests) → show the user `/api/glance` output from `wrangler dev`.
2. **A2** → user creates skeleton + keystore; install debug build on their phone.
3. **A3** → user creates Firebase project; **ask** to set the secret and deploy the Worker;
   test with admin "Send test to app".
4. **A4** widget → screenshot from the phone (ask the user).
5. **A5** → first release build, **ask** before uploading the APK to KV and deploying.
6. **A6** → **ask** before deploying the banner and page.
7. Update `README.md` and the "Current state" section of `CLAUDE.md` (one bullet: app
   built, where the plan is, what's held for the user). Commit only when asked.

## Testing checklist (end to end)

- [ ] `/api/glance` at a point inside a sim alert returns it with template steps; outside, not.
- [ ] App swiped away, phone idle 10+ min: admin test alert at the phone's location → loud
      notification within ~10 s.
- [ ] Same alert re-sent / NWS update at same level → no second alarm; upgrade → alarms again.
- [ ] Watches off → no watch notifications; quiet hours → watches silent, warnings still loud.
- [ ] Airplane mode 30 min then back → catch-up shows any active covering warning.
- [ ] Widget small + wide, normal and red states, stale label.
- [ ] Moving to another county (emulator `adb emu geo fix`) re-subscribes topics.
- [ ] Self-update from version N to N+1 (first with a tap, then silent); tampered APK refused.
- [ ] Website on Android Chrome shows the banner; inside the app it doesn't; `/get-android/` works.
- [ ] `npm test`, `npm run typecheck`, `./gradlew test`, `./gradlew assembleRelease` all pass.
