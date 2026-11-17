# SHELLY v2: Feature Ideas

Status: **first batch built on 2026-11-16:** 1, 2, 3, 6, 9, 10, 11, 13, 24, 25, 26, 27 below
(numbers from the short list). Push (3) needs the VAPID secrets before it turns on. Everything else
is still an idea.
Scope: the main app (kiosk, web, phone, admin). SHELLY Live is out of scope here.

---

## 1. Where SHELLY already wins, and where it doesn't yet

SHELLY's edge is the **threat engine**: the screen changes with the danger.
Most weather apps look the same on a calm day as during a tornado.

| App | What it does well | What it's missing that SHELLY can own |
|---|---|---|
| Apple Weather / Google | clean, "rain in 10 min" | county-level alerts, no "what do I do", no kiosk, no escalation |
| The Weather Channel | brand, video | ad-heavy, hype, slow alerts, cluttered |
| RadarScope / RadarOmega | pro radar, velocity | expert-only, no plain language, paid |
| Carrot | personality | gimmick only, no severe mode |
| WeatherStar 4000+ | nostalgia kiosk | fixed loop, no escalation, no phone |
| NOAA Weather Radio | loud, reliable alerts | no map, no context, county-wide |

**The pitch:** the calmest weather app on a calm day and the clearest one on
the worst day, built for a whole household, and honest about what it knows.

Each idea below lists **why** it matters, **how** it fits the current code, and
a rough size (S = a day or two, M = about a week, L = more).

---

## 2. Tier 1: signature features (build these first)

### 2.1 "What do I do right now" card  · M
When a Watch, Warning or Emergency covers you, show a plain action card:
*"Tornado Warning. Go to your basement now. Stay away from windows."*
- Deterministic templates per event + severity + time of day (night tornadoes
  get "wake everyone up"). **No LLM**, same safety rule as Live.
- The user enters their own shelter plan in settings ("basement, under the
  stairs"; "interior bathroom on floor 1"), and the card uses it.
- Fits: `shared/threat.ts` already knows the level; add `shared/actions.ts` (pure, tested).

### 2.2 Storm arrival at *your* address  · M
"Storm reaches your house in **14 min** (about 7:42 PM)."
- Reuse the L6 storm tracker (`eventMotionDescription` → ETA), but for the
  user's saved points on every screen, not just `/live`.
- Also show "the warning polygon misses you by 3 mi" so people don't panic
  over a county-wide alert that isn't headed for them.

### 2.3 Polygon-precise web push  · M
Push alerts only when the **polygon** covers a saved place, not the whole county.
That alone beats Apple, Google and NOAA Weather Radio on false alarms.
- Web Push (VAPID) from the Worker, triggered by the existing 1-minute cron.
- Rules: warnings always push; watches/advisories respect quiet hours; one
  push per alert, then an update only if it upgrades (e.g. PDS, OBSERVED).
- Needs: VAPID keys (generated locally, stored as Worker secrets), a
  subscription store (KV or D1). iPhone needs the PWA added to the home screen.

### 2.4 Family places ("My people")  · M
Save several places (home, work, a parent's house, a kid's school) and see them
all on one board, each with its own threat level.
- A "check on them" nudge when a family place hits extreme heat, cold or a
  warning. It fits why SHELLY exists.
- Pushes can go to anyone in the household for any place they follow.

### 2.5 Faster alerts: push to screens instead of polling  · M
Today screens poll every 30 s. A Durable Object can push changes over SSE or
WebSocket the moment the cron sees them. Target: **NWS issue → screen in ≤ 60 s**,
measured and shown in admin (see 6.2).

### 2.6 "Rain starts in 12 min"  · S
Minute-by-minute precip for the next 2 hours from Open-Meteo's 15-minute data,
shown as a small bar strip, with a plain sentence on top. Already-fetched data,
mostly a new segment + phone card.

### 2.7 Accessibility as a feature, not a checkbox  · M
- Deaf/hard-of-hearing: a strong (strobe-safe, under 3 flashes/s) visual alarm on
  WARNING/EMERGENCY, and phone vibration patterns.
- Low vision: a huge-text mode on the kiosk; full screen-reader support on web/phone.
- **Spanish** UI + alert TTS (NWS issues some products in Spanish; templates
  handle the rest).
- Colorblind-safe radar and risk palettes.

---

## 3. Tier 2: better data than anyone free

### 3.1 Radar that's actually useful  · L
- **Future radar** (extrapolate the last frames 30 to 60 min ahead).
- **Storm cell tracks** with arrival times, hail/rotation flags.
- Optional pro layer: NEXRAD velocity (NOAA open data) so a couplet is visible.
- Overlay toggles: warning polygons, SPC watch boxes, mesoscale discussions,
  storm reports.

### 3.2 Storm reports + spotter feed  · S
Show NWS Local Storm Reports (hail size, wind damage, tornado touchdowns) on
the map as they come in. Free from NWS. It's the thing people refresh Twitter for.

### 3.3 Forecast confidence  · M
Use Open-Meteo's ensemble API to show "**High confidence**: 72°" vs
"**Low confidence**: 1 to 6 inches of snow". Show the range, not fake precision.
No mainstream free app does this.

### 3.4 SHELLY grades itself  · M
Store each day's forecast, compare it with what happened, and show it:
"Yesterday's forecast high was 2° off." A running accuracy score, by
season. That's honest, rare, and builds trust. Needs D1 (or KV) for history.

### 3.5 "Is this normal?"  · S
"Today is **11° above normal**, warmest Nov 16 since 2015." From NOAA ACIS
(free climate normals and records). Upgrades the existing Almanac segment.

### 3.6 Local hazards for the Philly / PHI area  · M
- **River gauges** (Delaware, Schuylkill, Wissahickon) from NWS/USGS, with
  flood stage lines.
- **Coastal flooding + tides** for the Shore (NOAA tides API).
- **Tropical**: NHC cone and "closest approach" when a storm is in play.
- **Winter**: ice accumulation, snow ratio, a "snow day odds" score.

### 3.7 Health and comfort  · S
- NWS **HeatRisk** and a wet-bulb (WBGT) reading for outdoor work and sports.
- Wildfire smoke (AQ already fetched), pollen by type, migraine-prone pressure drops.

### 3.8 Your own backyard  · S
Connect a personal weather station (Tempest or Ambient Weather APIs) so
"current conditions" is your yard, not the airport 12 miles away.

---

## 4. Tier 3: home and kiosk

### 4.1 Smart-home hooks  · M
On a threat-level change, send a webhook (Home Assistant, IFTTT, Hue):
lights turn amber for a watch, red for a warning, TV wakes up. One generic
outgoing webhook in admin covers most of it.

### 4.2 Kiosk that runs for years  · S to M
- Night dimming / ambient mode on CALM, full brightness on WARNING.
- TV burn-in protection (slow pixel shift of static elements).
- A one-page setup guide for Fire TV, Chromecast, and a Raspberry Pi image
  that boots straight into SHELLY.
- A heartbeat in admin: "Living room TV last checked in 40 s ago."

### 4.3 Morning briefing  · S
At a set time: a 20-second spoken summary on the kiosk plus an optional push or
email ("Rain after 3, take an umbrella. High 54."). Templates first; the LLM
can polish calm-day wording only.

### 4.4 Plan-my-day  · M
"Best 2-hour window to walk the dog / run / mow today." Scores hourly data
against simple activity rules. Calendar (ICS) import to flag weather on your events.

### 4.5 Storm replay  · M
Pick a past event and replay it through the real engine (the simulator in
`shared/simulate.ts` is most of this). Good for teaching kids, and a great
demo of what SHELLY does on a bad day.

### 4.6 Embeddable widget  · S
A small iframe/script for other sites (a school, a church page) showing the
current conditions + threat banner for a place.

---

## 5. Tier 4: personality, carefully

- **SHELLY's almanac**: optional family dates ("weather on Grandma's birthday,
  every year since 1950"). Personal, never shown publicly unless chosen.
- Custom photo backgrounds per condition from the user's own photos.
- "What to wear" one-liner on the phone card.
- Keep personality **off** during WARNING/EMERGENCY. Serious days stay serious.

---

## 6. Tier 5: trust and reliability (the boring stuff that wins)

### 6.1 Never fail silently  · S
If NWS is unreachable or the alert data is stale beyond 3 minutes, show a loud
"**Alerts may be delayed**" banner on every screen. A weather app that quietly
shows "no alerts" during an outage is dangerous.

### 6.2 Measure alert latency  · S
Record `sent` → cron fetch → first screen ack. Show the median and worst in admin.

### 6.3 Data freshness + sources  · S
Every segment shows "updated 3 min ago" and its source (NWS, SPC, Open-Meteo).

### 6.4 Offline last-good  · S
Service worker keeps the last good forecast and alerts (with a clear "offline
since 6:12 PM" label). Was REBUILD_PLAN phase 7; check what `public/sw.js` covers.

### 6.5 Performance budget  · S
Phone first load under 100 KB JS, Lighthouse 95+, CI fails if the bundle grows past budget.

---

## 7. Suggested first batch

If you want "better than anything else" fast, this order gives the biggest jump:

1. **6.1** Never fail silently (small, safety-critical)
2. **2.1** "What do I do right now" card
3. **2.2** Storm arrival at your address
4. **2.6** "Rain starts in 12 min"
5. **2.4** Family places
6. **2.3** Polygon-precise web push
7. **3.2** Storm reports on the map
8. **3.3** Forecast confidence
9. **3.4** SHELLY grades itself
10. **2.7** Accessibility + Spanish

## 8. Questions for you

- Push notifications: OK to add VAPID keys (local, free) and D1 for subscriptions?
- Family places: just your household, or should others be able to sign up?
- Spanish: yes, or another language too?
- Personal weather station: do you own one (Tempest, Ambient, other)?
- Smart home: do you run Home Assistant or Hue?
- Anything here you **don't** want (e.g. family dates, personality features)?
