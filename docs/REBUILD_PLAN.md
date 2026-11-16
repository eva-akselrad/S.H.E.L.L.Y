# SHELLY v2 — Rebuild Plan

Status: **planning done, nothing built yet.** Work happens on branch `rebuild`.
The old app is preserved at tag `legacy-v1` (also still on `main`).

---

## 1. Goal

A US-only, kiosk-first live weather display that **changes what it shows based on
how dangerous the weather is** — the thing WeatherStar 4000+
(weatherstar.netbymatt.com) doesn't do. WeatherStar replays a fixed segment loop
and looks the same on a calm day as during a tornado outbreak. Ours escalates.

Give it its **own visual identity**. Don't clone WeatherStar's or the Weather
Channel's look, logos or music.

## 2. Decisions already made (don't re-ask)

| Topic | Decision |
|---|---|
| **Name** | **The product stays named SHELLY.** It's named after the user's grandmother. Never rename it. The rebuild is **SHELLY v2**. Use "SHELLY" in the UI title, manifest, `package.json` (`shelly`), Worker name (`shelly`) and User-Agent. The backronym "Severe Hydrology & Environmental Live Logging Yearbook" may stay as a subtitle. The repo folder being called WeatherNow doesn't change the product name. |
| Rebuild vs. renovate | **Full teardown and rebuild.** Salvage only the items in §6. |
| Coverage | **US only.** NWS (api.weather.gov) is the authority for alerts and forecasts. |
| Hosting | Was Cloudflare **Pages**. Move to **one Cloudflare Worker with static assets** (see §3 for why). |
| Frontend | **Preact + @preact/signals + TypeScript + Vite.** User asked for "any framework that is efficient". Preact is about 4 KB, and signals give fine-grained updates for a display that is always on. |
| Repo strategy | Rebuild on the `rebuild` branch in this repo. Merge to `main` once it does at least what the old app did. |
| Admin auth | **Cloudflare Access** in front of `/admin*` and the admin API routes. No homemade password or JWT code. |

| Target screens | **All of them: TV/kiosk, desktop browsers, and phones.** These are three first-class layouts, not one scaled canvas (see §5a). |
| Live-site hotfix | **Not needed.** The old Pages site uses a different password. Skip Phase 0. |
| Music | The `(1)`, `(2)`, `(3)` MP3s are **different versions** of the same songs. **Keep all of them.** Rename to `Song Title (v2).mp3`, `(v3)`, …, with the unsuffixed file as v1. Regenerate the playlist from the new names. |
| NWS User-Agent | `SHELLY/2.0 (https://evaakselrad.com, nws@evaakselrad.com)`. The user supplied this contact for this purpose only. |
| Attribution | **No Claude/AI attribution anywhere:** no `Co-Authored-By` lines, no "Generated with Claude Code" in PRs, none in code or docs. |

## 3. Why one Worker instead of Pages

- The alert poller needs **cron triggers**. Pages Functions don't support them; Workers do.
- Durable Objects, used later to push alerts, are cleaner on a Worker.
- Cloudflare now recommends Workers + static assets for new full-stack apps.
- The legacy repo's confusion came from three backends (`server.js`,
  `worker.js`, `functions/`) and two configs (`wrangler.jsonc` + `wrangler.toml`).
  Rebuild rule: **one backend, one `wrangler.jsonc`, nothing else.**

Check current Cloudflare docs before you write config. Use the `cloudflare`,
`wrangler` and `workers-best-practices` skills. Don't trust memory on wrangler syntax.

## 4. Target architecture

```
browser (Preact app, built to dist/)
   │  GET /api/*            (edge-cached JSON, normalized shapes)
   ▼
Cloudflare Worker  ── static assets: dist/client (SPA fallback)
   ├─ /api/location?q= | ?lat=&lon=   → NWS /points (office, grid, zones, county, tz)
   │                                     + geocoding (server-side, cached)
   ├─ /api/forecast?point=            → Open-Meteo (current/hourly/daily/15-min nowcast)
   │                                     + NWS gridpoint forecast text
   ├─ /api/alerts?zones=              → served from KV/cache, filled by cron
   ├─ /api/outlook?lat=&lon=          → SPC Day 1-3 categorical, risk at point
   ├─ /api/airquality?lat=&lon=       → Open-Meteo AQ + pollen
   ├─ /api/radar                      → RainViewer frame index (tiles load direct)
   ├─ /api/announcements (GET public, POST/DELETE behind Access)
   └─ scheduled() every 1 min         → fetch NWS active alerts → KV, keyed by zone
```

Rules for the data layer:
- **Clients never call upstream APIs directly**, except map and radar tiles.
- Cache by NWS grid point or rounded lat/lon using the Workers Cache API. TTLs:
  alerts 30 s, nowcast 5 min, forecast 15 min, outlook 30 min, AQ 30 min.
- Send the NWS `User-Agent` from the Worker:
  `SHELLY/2.0 (https://evaakselrad.com, nws@evaakselrad.com)`. Keep it in one
  constant or `vars` entry so it's easy to change.
- Normalize every source into typed shapes in `shared/types.ts`, which the Worker and frontend share.
- Clients poll `/api/alerts` every **30 s**. That's cheap because it's edge-cached.
  Optional phase 2: a Durable Object pushes updates over SSE.

## 5. The core feature: threat-level engine

A pure function: `computeThreat(alerts, outlook, nowcast, conditions) → ThreatState`.
Put it in `shared/threat.ts` and **unit-test it heavily**.

| Level | Triggers (any) | Display behavior |
|---|---|---|
| **CALM** | no alerts; SPC < MRGL | full relaxed rotation; extended, almanac, AQ/pollen, music on |
| **ELEVATED** | any Watch / Advisory for zone; SPC ≥ SLGT; storms in 15-min nowcast within ~25 mi | shorter loop, SPC outlook added, radar every other segment, filler dropped |
| **WARNING** | any Warning whose zone/county or polygon covers the point | radar locked on warning polygon, countdown to `expires`, TTS read-out, music ducked, alert crawl |
| **EMERGENCY** | Tornado/Flash Flood Emergency; PDS; `tornadoDetection=OBSERVED`; `thunderstormDamageThreat=DESTRUCTIVE` | full-screen takeover, everything else suppressed, repeating TTS |

Inputs from the NWS alert `parameters`: `tornadoDetection`, `tornadoDamageThreat`,
`thunderstormDamageThreat`, `maxHailSize`, `maxWindGust`, `flashFloodDamageThreat`.
Plus `severity`, `urgency`, `certainty`, `event` and `geometry`.

**Segment relevance scoring.** This is separate from the threat level. Each
segment declares `relevance(data) → 0..1`, and the scheduler builds a loop from
the threat level plus those scores. Examples:
- wind chill or snow totals in winter
- heat index in summer
- visibility in fog
- pollen when high
- hide AQ when it's Good and nothing else is happening

## 5a. Screen targets: TV, browser, phone

Three layouts, chosen by viewport and input, with a `?mode=kiosk|web|phone` override:

- **Kiosk/TV:** plays on its own, landscape, sized for viewing from across the
  room. Fixed 16:9 stage scaled to fit. No hover, no controls unless the remote or
  keyboard is used. Big type, high contrast, safe margins against TV overscan.
- **Desktop browser:** the same segments, but the user can drive them: click
  through segments, pause, search location, settings. The loop keeps running unless paused.
- **Phone:** portrait-first, **scrollable cards rather than a slideshow**. Alerts
  and the threat banner are pinned on top. Touch targets ≥ 44 px. Radar uses
  pinch-zoom. The WARNING/EMERGENCY takeover still applies. Respect safe-area insets.

Segments get written once, as data plus a component that responds to its
container (container queries). The three modes differ only in the **shell**
(slideshow vs. cards) and the controls. Test each mode at 1920×1080, 1366×768 and 390×844.

## 6. What to salvage from `legacy-v1`

Read it with `git show legacy-v1:<path>`. Port it into typed modules **with tests**.

| What | Where (legacy) |
|---|---|
| Open-Meteo forecast params | `js/weather.js` `fetchWeather` (~L58) |
| Air quality + pollen params | `js/weather.js` `fetchAirQuality` (~L100) |
| Formatters, `windDir`, `aqiLabel`, `pollenLevel`, `uvLabel`, `wmoToWeather` | `js/weather.js` L131–193 |
| `heatIndex`, `windChill`, `getSunData`, `getMoonPhase` | `js/weather.js` L159–230 |
| SPC point-in-polygon (`pointInRing`, `spcRiskAtPoint`, `processSPCOutlook`) | `js/weather.js` L530–633 |
| Climate history / almanac | `js/weather.js` `fetchClimateHistory` (~L635) |
| Nearby / travel cities | `js/weather.js` L435–528, `js/cities.js` |
| TTS voice pick + alert script + queue | `js/alerts.js` (all) |
| RainViewer frames + animation | `js/radar.js` L32–160 |
| Announcement banner/overlay *concepts* | `js/announcements.js` (rebuild smaller) |
| Music player concept + tracks | `js/music.js`, `music/` |
| Favicon | `assets/favicon.png` |

**Known legacy bugs. Don't port them:**
- 10-minute alert latency: alerts were only fetched during the weather refresh.
- `startAutoScroll` in `js/app.js` adds new listeners on every slide (a leak).
- A `User-Agent` header set in browser `fetch`, which the browser ignores.
- 3× Nominatim calls per load from the client.
- `marked` loaded from a CDN with no pinned version.

**Delete, don't port:**
- `server.js`, `worker.js`, `functions/`, `Dockerfile`, `docker-compose.yml`, `nginx.conf`
- `wrangler.toml`, the old `wrangler.jsonc`, `_redirects`, `generate-playlist.js`
- `admin.html`, `demo/`
- the honeypot, the security demo, "armageddon" mode (rebuild only as a plain
  emergency override if the user wants one), and the release-notes system
- legacy `docs/*.md` other than this file

## 7. Proposed layout

```
/
├─ wrangler.jsonc          # single config: main, assets, kv, crons
├─ vite.config.ts          # @cloudflare/vite-plugin + @preact/preset-vite
├─ tsconfig.json
├─ package.json
├─ shared/                 # used by worker AND client
│  ├─ types.ts
│  ├─ threat.ts            # threat engine (pure)
│  ├─ wx.ts                # heatIndex, windChill, labels, wmo map, moon
│  └─ geo.ts               # point-in-polygon, haversine
├─ worker/
│  ├─ index.ts             # fetch router + scheduled()
│  ├─ sources/             # nws.ts, openmeteo.ts, spc.ts, rainviewer.ts
│  └─ cache.ts
├─ src/                    # Preact app
│  ├─ main.tsx
│  ├─ state/               # signals: location, data, threat
│  ├─ engine/scheduler.ts  # builds the segment loop from threat + relevance
│  ├─ segments/            # one component per segment
│  ├─ takeover/            # warning + emergency screens
│  └─ styles/
├─ public/                 # favicon, music/, manifest
└─ test/                   # vitest (+ @cloudflare/vitest-pool-workers for worker)
```

## 8. Phases

0. ~~Live-site hotfix~~: not needed (see §2).
1. **Scaffold.**
   - Move `music/` to `public/music/` and rename the versions as described in §2.
   - Vite + Preact + TS + the Cloudflare Vite plugin, one `wrangler.jsonc`, Vitest.
   - On `rebuild`, remove the legacy files listed in §6.
   - `npm run dev` should serve a hello page plus `/api/health`.
   - Update CI (`.github/workflows/test.yml`) to run typecheck + tests + build.
2. **Data layer.** Each source module, normalization into `shared/types.ts`,
   caching, and the cron alert poller writing to KV. Test with recorded fixtures,
   not live calls.
3. **Engine.** `shared/threat.ts` + the scheduler + the three shells
   (kiosk / web / phone, see §5a).
4. **Segments.** Current conditions, hourly, 7-day, radar, regional observations,
   AQ/pollen, almanac, SPC outlook.
5. **Severe mode.** Warning polygon on radar, expiry countdown, TTS queue, audio
   ducking, emergency takeover.
6. **Admin.** Announcements + custom forecast + (optional) web push, behind Cloudflare Access.
7. **Polish.** Offline last-good cache (service worker, versioned), visual identity
   pass, accessibility, Lighthouse.
8. **Cutover.** Point the domain at the Worker, retire the Pages project, merge `rebuild` → `main`.

## 9. Done means
- One `npm run deploy` publishes the whole app, and only `dist/` + the Worker go out.
- A test can feed a Tornado Warning fixture and assert the WARNING takeover appears.
- Alert latency, from NWS issuing to the screen changing, is ≤ ~90 s.
- No secrets or default passwords in the repo. Admin is behind Access.
- Typecheck, tests and build all pass in CI.
