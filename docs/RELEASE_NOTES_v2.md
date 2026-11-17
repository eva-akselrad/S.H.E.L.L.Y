# SHELLY v2: what changed from the old site (v1)

SHELLY was rebuilt from scratch. The old site is kept (tag `legacy-v1`, branch `legacy`; see [LEGACY.md](LEGACY.md)).

## The big picture
- **One Cloudflare Worker** with a Preact app, replacing the old Pages site and Express-style server. Typed, tested (260+ tests), one deploy.
- **Three first-class layouts:** TV/kiosk, desktop browser, and phone.
- **New Android app** (sideloaded from the website, not the Play Store).
- **Name unchanged:** still SHELLY.

## For everyone using the site
- **No start screen.** It opens straight to your weather, located by IP, with a search box and a "My location" button.
- **Weather scenes:** animated skies, rain, snow, fog and lightning that follow current conditions, with text that stays readable on every sky.
- **Alert takeover redesigned,** plus an announcements bar.
- **Natural-sounding alert voice** (text to speech).
- **Safety features:**
  - an action card telling you what to do
  - storm ETA for your town
  - a stale-data banner when information is out of date
  - alert latency and freshness shown on each card
  - a rain/snow nowcast for the next hours
  - storm reports
  - forecast confidence
  - local hazards
  - what to wear
- **Self-grading forecasts** (needs a default location set in admin).
- **Web push alerts,** matched to the exact warning polygon, not just the county.
- **"Play sound on":** send SHELLY's music and voice to a chosen speaker, such as a Roku display.
- **TV warning layout:** map and steps stay in the big row when the location bar is hidden.

## Android app
- **Warnings for where you are,** even with the app closed, following the phone's location (private: the server never stores it).
- **Home-screen widget** with current conditions that turns amber or red during alerts.
- **Self-updating,** with a Check for updates button. It checks the file and signature, and never installs during an active warning.
- **Permission walkthrough,** an install banner on the website, and a `/get-android/` download page.
- **Announcements** from the admin arrive as notifications.

## Admin
- **Password login** with lockout.
- **Alert simulator,** including **custom test alerts** you write yourself (always labelled TEST).
- **Send a notification** to the app and to web subscribers.
- **Display settings, music, announcements and activity.**
- **Test buttons** for web push and app push.

## Built, but not switched on yet
- **SHELLY Live:** a 24/7 auto-produced stream with a sea-turtle host, an intensity score and rundown, and an optional free-model LLM that never writes alert text. Needs the OpenRouter key and going live from you.
- **Forecaster Studio:** your own graphics (7-day overrides, city temps, hand-drawn risk maps, snow and rain totals, storm timeline and tracker, discussion drafts that are never auto-published). Traffic cams are deliberately not wired up.

## Behind the scenes
- **Alert text is never written by an LLM.** It comes from NWS data and fixed templates.
- **Gone:** the old Express/Pages setup and `wrangler.toml`. The NWS User-Agent is now `SHELLY/2.0`.
