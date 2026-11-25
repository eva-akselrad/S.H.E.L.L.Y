# SHELLY 2.2.0

Four new tools for the Philly area: **snow day odds**, **lightning proximity**, **future radar**
and a **storm damage report**. The radar gets a new source. Warnings get a chime and a fairer
SHELLY index. Self-grading now covers every part of the forecast.

> **Android app update: 2.1.0.** This release has a new app version. It adds opt-in lightning
> alerts. The app tells you when the update is ready, or you can download it from the
> **/get-android/** page. Everything else in these notes is on the
> website and works without updating the app.

## New

### Snow day odds
- **"Snow day odds for tomorrow: High."** A plain answer to the question every kid asks the night
  before, with the chance of a **closing** and the chance of a **2-hour delay**.
- **Built from the National Weather Service's own snow and ice forecast**, hour by hour. Snow that
  falls overnight and before the buses run counts the most. Ice counts more than snow. Snow that
  starts mid-morning points to an early dismissal, not a closing.
- **Honest about doubt:** when the weather models disagree, SHELLY shows the range ("1 to 9 in.")
  and says confidence is low. Two days out it never says "high confidence."
- **Knows days off:** weekends, holidays and days you mark off skip ahead to the next school day.
  On a Friday night storm, it gives the odds for Monday.
- **Shows up only when it matters:** November through mid-April, and only when snow or ice is in
  the forecast. You'll find it in the TV loop, on the phone card and on the website.
- Always labelled **"SHELLY's guess, not your school's decision."**

### Lightning proximity
- **"Lightning about 6 mi away. Stay inside. All clear at 7:42 PM."** SHELLY watches lightning
  from NOAA's GOES-19 weather satellite, which sees new flashes every 20 seconds.
- **Follows the 30-minute rule** from the National Weather Service: the all-clear comes
  30 minutes after the last flash within 10 miles, and starts over if another one hits.
- **Tells you which way it's heading:** closer, steady or moving away.
- **A ring map** with 5, 10 and 25 mile rings. Older flashes fade out.
- **Phone, website and TV:** a lightning chip shows at the top while lightning is near. It stays
  up through the whole 30-minute wait. The TV loop adds a lightning screen with the countdown.
- **SHELLY Live** mentions lightning near the region's towns.
- **Careful wording:** the satellite spots flashes to within a few miles, so distances say
  "about," and anything under 3 miles says "overhead." If the satellite data runs late, SHELLY
  says so and never gives an all-clear it can't back up.
- Lightning isn't a National Weather Service alert, so it **doesn't change the threat level**.
- **The Philadelphia region only for now.** Elsewhere, SHELLY says "Lightning isn't tracked here yet."

### Lightning alerts on Android (opt-in)
- A new setting in the app: **"Lightning within about 10 miles of me."** It's **off unless you turn it on**.
- Your phone decides whether to alert, using its own location. SHELLY's server still never
  learns where your phone is.
- **No more than one alert every 30 minutes.** It respects your quiet hours.
- **A gentle alert:** it uses its own notification channel. It never takes over the screen and
  never breaks through Do Not Disturb. Warnings still do.

### Future radar
- **The radar now plays past "now"** into the next 10 to 30 minutes on phones and TVs, and up to
  60 minutes on desktops and SHELLY Live.
- A **Past | Now | Future** bar under the map, and every future frame is labelled **"Future (estimate)."**
- **How it works:** SHELLY measures how the storms moved over the last few radar scans and moves
  them forward along the same path. Tap the **?** to read this on the map. It can't predict new
  storms popping up or old ones fading, so future frames get fainter the further ahead they go.
- **Never on the warning screen.** When a warning covers you, the map shows the real warning
  shape and real radar only.

### Storm damage report (admin preview)
- **A one-page printable report** for any address and date back to 2003. It covers:
  - the warnings that covered the address, with their start and end times
  - storm reports nearby (hail size, wind damage, tornadoes, flooding), each with a distance and
    direction like "1.2 mi NE"
  - the strongest wind gusts at the nearest weather stations
  - a map with 1, 5 and 10 mile rings
- **Made for insurance claims and contractors.** Press **Print / Save as PDF**. It prints clean in black and white.
- **Private:** the address you type is looked up on your own device. SHELLY's server only gets
  the map coordinates and doesn't keep the report.
- Every report says plainly that it is **not an official National Weather Service document**,
  and points to NOAA's Storm Events Database for the official record.
- **Admins only for now** while it's tested. It will open to everyone in a later release.

## Radar
- **New radar source:** the loop now uses the national radar mosaic from the
  **Iowa Environmental Mesonet**. Frames are 5 minutes apart, where before they were 10, so storms
  move more smoothly. It replaces RainViewer, which shut down its own future radar on January 1, 2026.
- **Warnings draw in the right order:** urgent warnings (tornado, severe thunderstorm and
  similar) draw in red on top. Long-lasting zone alerts like High Wind draw in amber underneath,
  so a big zone never hides a storm.
- **Zone alerts get their real shapes:** alerts the National Weather Service issues by zone,
  like Winter Storm and Coastal Flood, now show their actual areas on the map.

## Warnings
- **A warning chime:** before SHELLY reads a warning out loud, it plays a short three-note chime.
  Tornado warnings and emergencies get a faster, lower one. It plays on the speaker you chose.
  It isn't the Emergency Alert System tone.
- **Only urgent warnings take over the screen:** tornado, severe thunderstorm, flash flood and
  similar. Long-lasting ones like High Wind and Coastal Flood now show as elevated instead of a
  full-screen takeover.

## SHELLY Live
- **The SHELLY index now runs from 0 to 100,** and warnings that aren't about storms no longer
  push it to the top.
- **Watches count by type** and get read out loud. A Tornado Watch counts for more than a Flood Watch.
- **The local voice gets ready ahead of time:** bulletins and "Say it now" lines get their audio
  made before they air, so they play right away. On a busy day, warning audio waits up to a
  minute for the local voice before using the cloud voice, which saves the cloud quota.
- **Fixed:** a forecaster message could get cut off by the next item. Switching items now stops
  the voice clip that was playing.

## Forecaster Studio
- **New drawn areas map:** draw your own shapes, each with a label, legend text and a solid or
  dashed outline, plus markers. It plays on Live, in the site loop and as a PNG download.
- **Fixed:** Studio graphics now fit their box on the website and TV. Before, they could spill
  past the edge.

## SHELLY grades itself
- **Every part of the forecast now gets a grade:** dew point, wind, gusts, rain amount, the
  rain-or-no-rain call, and an hour-by-hour grade of tomorrow's forecast. Each one is checked
  against the nearest National Weather Service station.
- **The report card** shows how often the rain calls were right, how far off the gusts and dew
  points were, and the 3-day highs.
- **Confidence per element:** temperature, rain, snow, wind and dew point each get their own
  confidence rating. Daily rows show a range wherever the models disagree.

## Everything else
- **New icon:** the SHELLY v2 wordmark in your browser tab.
- **Fixed:** a page left open during an update now reloads itself instead of showing a blank radar.

## Data and credits
New sources in this release, all free:
- **NOAA GOES-19 Geostationary Lightning Mapper** (lightning)
- **Iowa Environmental Mesonet** (radar mosaic, past storm reports, past warnings, station wind gusts)
- **National Weather Service gridded forecast** (snow and ice amounts for snow day odds)
- **OpenStreetMap** (address search on the damage report)

The National Weather Service is still the only source of alerts. The AI never writes alert,
warning, lightning or snow day text.

---

## Short versions

**Android in-app update note** (for `--notes`):
> Opt-in lightning alerts within about 10 miles of you. Turn them on in the app's alert settings.

**Site announcement (one line):**
> New in SHELLY: snow day odds, lightning distance with a 30-minute all-clear, and radar that
> shows the next 30 to 60 minutes.

**Social post:**
> SHELLY 2.2 is here ❄️⚡ Snow day odds for tomorrow, how far away the lightning is and when it's
> safe to go back out, and radar that plays into the next hour. Free, no ads, made for Philly.
> weather.evaakselrad.com

---

## Before you deploy (for the admin, not for users)
- **Snow day odds is already live.** This deploy adds lightning, future radar, the damage report
  (admin-only) and the Live and radar changes.
- **School districts:** add your real ones in admin under Snow day, or the odds use one
  "Your schools" point at the default location.
- **Not yet tested:**
  - the Android lightning alert on a real phone and through live Firebase
  - future radar on a Fire TV
  - the damage report page in a browser while signed in and signed out
- **Lightning pushes** only reach the counties around the Live region's cities.
- **Android 2.1.0:** release it yourself with
  `node scripts/android-release.mjs --notes "…" --upload`. Lightning alerts need the app update.
  The website parts don't.
- **The `/api/health` version still says 2.0.0.** Bump it if you want it to match.
