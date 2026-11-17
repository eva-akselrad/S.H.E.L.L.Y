# SHELLY Android: release and distribution

Plan and decisions: [ANDROID_PLAN.md](ANDROID_PLAN.md). This file is the runbook.

## Publishing a release (you run this, it needs your keystore password)

1. Bump `versionCode` (and `versionName`) in `android/app/build.gradle.kts`. The updater only installs a higher `versionCode`.
2. In your own terminal, from the repo root:

```bash
node scripts/android-release.mjs --notes "What changed" --upload --copy-to "G:\My Drive\shelly apps"
```

It asks for the keystore password (hidden, never stored), builds and signs the APK, verifies the signature,
prints the **signing certificate SHA-256**, writes `android/release/latest.json`, and with `--upload` puts the APK and
`latest.json` into the Worker's KV. The download page `/get-android/` and the in-app updater serve from there.
Without `--upload` nothing on the live site changes.

Defaults: keystore `%USERPROFILE%\.shelly-keys\shelly-release.jks`, alias `shelly`. Override with `SHELLY_KEYSTORE`,
`SHELLY_KEY_ALIAS`, or `android/keystore.properties` (copy `keystore.properties.example`; git-ignored).

## First signed install

Debug and release builds are signed with different keys, so Android will not update one with the other.
**Uninstall the debug APK once**, then install the signed release. From then on the app updates itself.
The first self-update asks for one tap ("Install unknown apps" for SHELLY); after that Android can install it quietly.
Updates are never installed while a Warning or Emergency is active.

## Google developer verification (sideloaded apps)

Register `com.evaakselrad.shelly` and the signing certificate SHA-256 (printed by the script) in your existing Play
Console under developer verification. If Google gives you an ownership snippet, put it in
`android/app/src/main/assets/` and publish a new release.

## Back these up (losing them means users must reinstall)

- `%USERPROFILE%\.shelly-keys\shelly-release.jks` and its password
- `%USERPROFILE%\.shelly-keys\shelly-eva-firebase-adminsdk.json` (the live Worker already has it as `FCM_SERVICE_ACCOUNT`)

## Debug builds

`cd android && ./gradlew assembleDebug` (use Android Studio's bundled JDK as `JAVA_HOME`). Debug builds can point at a local
`wrangler dev` through `Prefs.siteOverride` (cleartext allowed in the debug manifest only).
