# SHELLY v2: Feature Batch 2 (build plan)

Status: **planned 2026-11-25. Part S built and deployed; part D (damage report) built; part R (future radar, on IEM tiles) built, awaiting the user (not committed).** The user picked these four from the feature
brainstorm. This doc is written so a builder (Sonnet) can work through it top to bottom.

| # | Feature | Size | Why this order |
|---|---|---|---|
| S | **Snow day odds** | M | It's winter now. Uses data we already fetch. Most shareable feature of the four. |
| D | **Storm damage report** | M | Reuses the storm-report parser; mostly new fetchers plus one print page. |
| R | **Future radar** | M to L | Client-side math on radar frames we already load. No new paid source. |
| L | **Lightning proximity** | L | The hardest one (satellite files in HDF5). Lightning season is summer, so it can go last. |

Build them in the order **S → D → R → L**. Each feature ends at a **STOP** point: run the checks,
write a short summary for the user, and wait for the go-ahead before the next feature.

---

## 0. Rules for the builder (read first)

- Read [CLAUDE.md](../CLAUDE.md) first. Name is always **SHELLY**. No AI attribution anywhere
  (no `Co-Authored-By`, no "Generated with", nothing in code or docs).
- **Never deploy, never commit** unless the user says so. No `wrangler deploy`.
- **Safety rule (same as Live):** nothing in this batch writes alert or warning text with the LLM.
  Lightning messages, snow day wording and damage report text are **deterministic templates**.
- **Honest labels.** Every number here is an estimate. The UI must say so in plain words
  (see each feature's "honesty" bullets). No fake precision.
- **Sponsor-ready, not sponsored.** Snow day odds, future radar and lightning each get an
  optional `sponsor` slot later (not in this batch). Don't build ads. Leave a `// sponsor slot`
  comment where a "presented by" line would go, and nothing else.
- Patterns to copy:
  - Pure logic in `shared/*.ts`, tested with Vitest. Fetchers in `worker/sources/*.ts`.
    Routes in `worker/index.ts` using `cached()` from `worker/cache.ts`.
  - Segments: add the id to `SegmentId` and `SEGMENTS` in `shared/scheduler.ts`, the view in
    `src/segments/`, register it in `src/segments/index.tsx`. Relevance 0 hides it.
  - Config: new fields go in `SiteConfig` (`shared/config.ts`) **with defaults in
    `normalizeConfig`**, so old stored configs keep working. Admin UI in `src/admin/`.
  - Tests use recorded fixtures in `test/fixtures/` (create it if missing). **No live network
    calls in tests.**
- Checks before every STOP: `npm run typecheck` and `npm test` both pass. Then `npm run build`.
- Look things up in current docs (Cloudflare skills, the data providers' own pages). Don't trust
  memory, and don't trust this doc for anything marked **verify**.
- KV writes cost money past the included amount. Budget for each feature is listed below. Stay in it.
- Phone, desktop and TV/kiosk are all first-class. Each feature lists what shows on each.
- Don't run `/live` in the preview (it spends TTS credits). Kiosk/web/phone previews are fine.

---

## S. Snow day odds

**What the user sees:** "Snow day odds for tomorrow: **High (70%)**. 4 to 6 in. overnight,
ending around 6 AM. Roads likely bad at bus time." Plus a delay chance and an icon row
(snow, ice, cold, timing). Shows only when it matters.

### S1. Data (all already available)
- **NWS gridpoint raw data** (`/gridpoints/{office}/{x},{y}`, not `/forecast`): `snowfallAmount`,
  `iceAccumulation`, `temperature`, `windChill`, `probabilityOfPrecipitation`. These are the NWS
  forecaster's numbers, so they're the primary source. Add `fetchGridData()` to
  `worker/sources/nws.ts` (reuse `nwsFetch`). It returns ISO-8601 interval values like
  `"2026-11-26T06:00:00+00:00/PT6H"`: write a pure parser that spreads each value evenly over
  its interval in hourly steps. **Verify** field names and units (`wmoUnit:mm`, `wmoUnit:degC`)
  against a live response, then record it as a fixture.
- **Open-Meteo hourly** (already fetched): `weather_code` for snow/freezing-rain timing.
- **Ensemble spread** (`/api/confidence`, already built): snowfall range sets the odds' uncertainty.
- **Active alerts** (already in the store): Winter Storm Warning / Advisory, Ice Storm Warning,
  Extreme Cold Warning covering the district point.

### S2. Model: `shared/snowday.ts` (pure, tested)
Inputs: hourly snow (in.), ice (in.), temperature and wind chill (°F), alert events, local date,
and a district profile. Output:

```ts
interface SnowDayOdds {
  forDate: string;              // the school day this is about (local YYYY-MM-DD)
  closed: number;               // 0..1, chance of no in-person school (closed OR remote day)
  delayed: number;              // 0..1, chance of a 2-hour delay
  band: "none" | "low" | "some" | "good" | "high" | "very_high";
  reasons: string[];            // plain bullets, max 4: "4–6 in. overnight", "ice at bus time"
  range: [number, number] | null; // snowfall range in inches from the ensemble
  confidence: "low" | "medium" | "high";
}
```

Scoring (a transparent points system, not a black box; keep the weights in one table at the top
of the file so they're easy to tune):
- **Snow that falls in the "decision window"** (8 PM the night before to 7 AM) counts most.
  Snow that falls during the school day counts much less (early dismissal, not closure).
- **Ice** counts more per inch than snow (0.1 in. of ice is about as bad as 3 in. of snow for buses).
- **Timing:** heavy snow at 5 to 8 AM raises delay and closure; snow ending by 2 AM with temps
  above freezing lowers both (roads get treated).
- **Cold:** wind chill at or below the district's cold threshold adds points (rare here, but real).
- **Alerts:** a Winter Storm or Ice Storm Warning covering the morning adds points; an Advisory adds fewer.
- **District toughness** (profile slider 0..1): shifts the curve. Philly-area districts differ a lot.
- Turn points into a probability with a logistic curve. Map to bands:
  `<5% none, <20% low, <40% some, <60% good, <80% high, else very_high`.
- **Confidence** comes from the ensemble snowfall spread and lead time (two days out is never "high").
- Weekends, holidays and district days off → `forDate` skips to the next school day; on a day off
  it says "No school tomorrow anyway."

Test cases to write first (fixtures of hourly arrays, no network):
1. 0 in. → `none`. 2. 1 in. ending 10 PM, 34°F → `low`. 3. 6 in. midnight to 7 AM → `high` or
`very_high`. 4. 0.2 in. ice at 6 AM, 0 snow → at least `good`. 5. Same storm with toughness 1.0
scores lower than with 0.0. 6. Snow starting at 11 AM → low closure, but delay ≈ 0 and a
reason "may mean early dismissal". 7. Friday night storm → `forDate` is Monday.
8. Ensemble range 1 to 9 in. → `confidence: "low"`.

### S3. Districts (config + admin)
- `SiteConfig.snowDay = { enabled: boolean; districts: District[]; daysOff: string[] }`,
  `District = { id, name, lat, lon, toughness: number, coldWindChillF: number }`.
  Default: `enabled: true`, one district at the default location named "Your schools",
  toughness 0.5, cold threshold −10°F. **Don't invent real districts' policies.** The user adds
  real ones in admin.
- Admin page `src/admin/SnowDay.tsx`: add, edit and remove districts (map click or search for the
  point), toughness slider, days-off date list.
- **Calibration log (self-grading, like `worker/grade.ts`):** after each forecast day, admin can
  mark what actually happened per district: open / delayed / closed / remote. Store under KV key
  `snowday:log` (max 200 entries). Show a small "SHELLY's snow day record" table in admin
  (hits and misses per band). Don't auto-fit weights yet; just show the record.

### S4. API + screens
- `GET /api/snowday?lat=&lon=` → odds for the nearest configured district within 25 mi, or for the
  point itself with toughness 0.5. Cache 15 min (`cached`, key rounded to 0.05°).
- **Segment** `snowday` ("Snow day odds"): relevance 1 when `closed ≥ 0.2` for the next school
  day, 0.5 when there's any snow or ice in the window, else 0. Only Nov 1 to Apr 15.
  Big gauge on TV, card on phone, panel on web.
- **Phone:** a card under the action card, only when relevance > 0.
- **Live (optional, templates only):** a calm-period rundown item when odds ≥ `some`.
  Template text, not the LLM. Example: "Snow day odds for Philadelphia schools tomorrow: good."
- **Honesty:** always show "SHELLY's guess, not your school's decision" under the number. Show the
  ensemble range when it's wide. Never show a percent above 95 or below 2; use the band words there.

### S5. Done when
- All 8 tests pass, plus a test for the grid-data parser with a recorded NWS fixture.
- Segment appears in the kiosk loop only on snowy setups (use the admin simulator or a fixture).
- **STOP:** summarize to the user, include a screenshot of the phone card and the TV segment.
  Ask the user for their real districts and how tough each is.

KV budget: reads only, plus one write per admin save. Negligible.

---

## D. Storm damage report

**What the user sees:** enter an address (or use a saved place) and a date, get a one-page
printable report: "Storm report for 123 Main St, Jenkintown PA, June 3 2026." It lists the
warnings that covered the address, storm reports nearby with distance and direction, the peak
wind gusts at the nearest weather stations, and a simple map. One button: **Print / Save as PDF**.
Made for insurance claims and contractors.

### D1. Data sources
- **IEM Local Storm Reports** (archive back to 2003, free): `https://mesonet.agron.iastate.edu/geojson/lsr.geojson`
  with `sts`/`ets` (UTC) and a bbox or WFO. **Verify** current parameter names on its `?help=` page.
  Reports carry type (hail, tstm wind, tornado, wind damage, flood), magnitude, remarks, and
  since 2024 a measured / estimated qualifier. Show that qualifier.
- **IEM storm-based warnings** (`/geojson/sbw.geojson`, with `wfo` + `sts`/`ets`; the old `sbw.py` name is gone, verified 2026-11-25): which warning polygons
  covered the point and when. **Verify** params.
- **Peak gusts:** IEM ASOS download service (`/cgi-bin/request/asos.py`, `data=gust` or `peak_wind_gust`)
  for the 3 nearest stations within 30 mi. The NWS `/stations/.../observations` API only keeps about
  a week, so it's only good for recent storms. Use IEM for anything older. **Verify** params.
- **Recent days** (last 48 h): also merge the SPC CSVs we already parse (`fetchStormReports`),
  removing duplicates by kind + time within 5 min + distance within 1 mi.
- **Out of scope for v1:** MRMS hail size grids (MESH). They're GRIB2 files and need a decoder.
  Leave a TODO and a note in the report: "Radar-estimated hail size not included yet."
- Terms: IEM is free and asks for attribution. Put "Data: Iowa Environmental Mesonet, NWS, NOAA
  SPC" in the footer. Before wiring IEM in, **tell the user** the terms you found (same rule as cams).

### D2. Logic: `shared/damage.ts` (pure, tested)
- `buildDamageReport({ point, date, tz, lsrs, warnings, gusts }) → DamageReport`:
  - Window: the local calendar day (midnight to midnight in `tz`), optionally ±1 day.
  - Reports within 10 mi (hail, wind, tornado) or 5 mi (flood), sorted by distance, each with
    distance (mi, 1 decimal), compass direction from the point ("2.3 mi NW"), time, magnitude,
    measured / estimated, source.
  - Warnings whose polygon contains the point (`pointInGeometry` in `shared/geo.ts`), with
    issued and expired times. Distances use `haversineMi`; compass words reuse `compass()` in
    `shared/live/track.ts`.
  - `summary`: a one-paragraph template, e.g. "A Severe Thunderstorm Warning covered this address
    from 4:12 to 5:00 PM. 1.75 in. hail was reported 1.2 mi NE at 4:31 PM." No LLM.
- Tests: compass direction (8 points), distance rounding, the dedupe rule, the day window across
  DST, a "nothing found" report that still renders and says so plainly.

### D3. Route + page
- `GET /api/damage?lat=&lon=&date=YYYY-MM-DD` → `DamageReport`. Cache 6 h for past dates,
  10 min for today. Reject dates before 2003-01-01 or in the future. Max range 3 days.
- Page `/report` (new client route, like `/get-android/`): form (place search + date), then the
  report. **Print CSS:** white background, black text, the map as an inline SVG (point, distance
  rings at 1, 5 and 10 mi, report dots, warning outline). No raster tiles, so it prints clean.
  Keep it to 1 page for a normal storm, 2 at most.
- The address the user typed is **not** sent to the server. Geocode as the app already does and
  send only lat/lon. Don't store reports server-side.
- Link it from the phone and web Reports segment ("Get a report for your address") and the
  Android app's menu (web view of `/report` is fine; no Android release needed).
- **Honesty footer (always):** "Not an official NWS document. Storm reports are preliminary and
  can be incomplete. For an official record, see NOAA's Storm Events Database, usually updated
  within 75 days." Link `https://www.ncdc.noaa.gov/stormevents/` (**verify** URL).

### D4. Done when
- Tests pass with recorded IEM fixtures from a real past Philly-area storm (pick one with hail
  and wind reports and record the responses).
- The printed page (Chrome print preview → PDF) fits on one page and reads well in black and white.
- **STOP:** show the user a sample PDF and the IEM terms.

KV budget: none (Cache API only).

---

## R. Future radar (30 to 60 min)

**What the user sees:** the radar loop keeps playing past "now" into a dimmer, dashed-border
"**Future (estimate)**" section: +10, +20, +30 (and +40 to +60 on wide setups) minutes.
A timeline under the map shows Past | Now | Future.

### R0. Facts that shape this (checked 2026-11-25)
- **RainViewer dropped its nowcast on 2026-01-01.** It also capped zoom at 7, kept only the
  "Universal Blue" color scheme, and limits each IP to 100 requests a minute
  ([transition FAQ](https://www.rainviewer.com/api/transition-faq.html)). Our code asks for scheme `6`;
  that now silently returns Universal Blue. So future frames are ours to compute.
- **IEM NEXRAD mosaic tiles** are a possible second source: timestamped layer names like
  `ridge::USCOMP-N0Q-YYYYMMDDHHMM` via `/c/tile.py/1.0.0/.../{z}/{x}/{y}.png`, frames every 5 min
  ([docs](https://mesonet.agron.iastate.edu/GIS/ridge.phtml)). **Verify** the layer still exists
  (`?operation=available`) before using it.
- **First task of R:** write a half-page comparison (RainViewer vs IEM: terms for an app that may
  carry a sponsor line, CORS headers, max zoom, frame spacing, attribution). **Tell the user**
  and let them pick. Default if they don't care: keep RainViewer for the map, use the same
  frames for motion.

### R1. Tile proxy (needed to read pixels)
- A canvas can't read cross-origin tiles without CORS. Add `GET /api/radar/tile/{frame}/{z}/{x}/{y}`
  in the Worker that fetches the upstream tile and returns it with `access-control-allow-origin`
  same-origin (it already is) and `cache-control: public, max-age=600`. Use the Cache API so
  each tile is fetched upstream once per colo. Only allow z ≤ 7 and frame ids that are in the
  current `/api/radar` list (no open proxy).
- Only the future-radar canvas uses the proxy. The normal loop keeps loading tiles directly.

### R2. Motion + extrapolation: `shared/radarflow.ts` (pure, tested, no DOM)
Works on plain `Uint8ClampedArray` RGBA buffers so it's testable in Node.
- `intensity(rgba) → Float32Array`: alpha × luminance (we don't need dBZ to move echoes).
- `motionField(prev, curr, w, h, { block: 16, search: 12 }) → { u, v }` per block:
  block matching (sum of absolute differences) between the frames 10 or 20 min apart;
  skip blocks with almost no echo; fill empty blocks from neighbours; smooth with a 3×3
  median then mean. Clamp speeds to 0 to 80 mph (convert using the tile pixel size at that zoom
  and latitude).
- **Fallback motion:** if fewer than 5% of blocks have echo, use one global vector: the
  average of the valid blocks, or (if none) the storm motion from an active warning's
  `eventMotionDescription` (`parseMotion()` in `shared/live/track.ts`; reuse it).
- `advect(curr, field, minutes) → rgba`: backward semi-Lagrangian (for each output pixel, look
  back along the motion vector, bilinear sample). Steps of 10 min. Fade alpha by lead time
  (×0.9 at +10 down to ×0.55 at +60) so it looks less certain the further out it goes.
- Tests: a synthetic blob moved 5 px right per frame → field ≈ (5, 0) and advected blob lands
  within 1 px; empty frames → zero field, no NaN; speed clamp; fade factors.

### R3. Client
- `src/components/FutureRadar.ts`: given the current map view, fetch the last 3 frames' tiles via
  the proxy at the map's zoom capped at 7 (about a 4×3 tile area), stitch into one offscreen
  canvas, run `radarflow` in a **Web Worker** (`src/workers/radarflow.worker.ts`, Vite worker
  import) so the TV never janks, then add the outputs to Leaflet as `L.imageOverlay` frames
  appended to the existing loop in `src/segments/Radar.tsx` and `src/live/LiveRadar.tsx`.
- Recompute when a new frame arrives (every 10 min), not on every render. Cancel on unmount.
- Frames: phone and kiosk +10, +20, +30. Desktop and Live +10 to +60.
- Performance budget: on a Fire TV-class device, all future frames ready in < 3 s; skip future
  frames entirely if the worker takes > 8 s or `navigator.hardwareConcurrency < 2`.
- **Honesty:** label "Future (estimate)" on every future frame, and a small "?" that explains:
  "SHELLY moves today's storms forward along their path. It can't see new storms forming or old
  ones dying." Never show future frames on the warning takeover map. There, the real polygon
  is the truth.

### R4. Done when
- `radarflow` tests pass. Manual check on a rainy day (or recorded frames saved as fixtures):
  +30 min frame looks like the storm moved the right way.
- Measured worker time on the kiosk preview logged in the console once.
- **STOP:** screenshot of the loop on phone and TV, and the source comparison from R0.

KV budget: none.

### R0 result: source comparison (checked 2026-11-25 on the providers' own pages and live endpoints)

| | RainViewer (current) | IEM NEXRAD mosaic (`ridge::USCOMP-N0Q-…`) |
|---|---|---|
| **Terms vs. a sponsor line** | api.html: "available for personal and educational use only"; the FAQ says free tier is for "personal, educational, and small community projects" and commercial use is "bespoke terms... case-by-case". A "presented by" line makes SHELLY arguably commercial, so this is the real risk. | disclaimer.php: material is "in the public domain and may be used freely by anyone for any lawful purpose". Nothing about commercial use specifically, nothing blocking it. Not legal advice. |
| **CORS on tiles** | Yes, `access-control-allow-origin: *` (tested). | Yes, `Access-Control-Allow-Origin: *` (tested). |
| **Max zoom** | 7, hard cap since 2026-01-01 (docs). | Not stated in docs. Tiles returned 200 at z7 to z10. Source is 1 km NEXRAD, so more zoom adds blur, not detail. We cap at 7 either way. |
| **Frame spacing / history** | 10 min, 13 past frames (about 2 h). `nowcast` is empty now. | 5 min, any past time by timestamp (`…-YYYYMMDDHHMI`, minute divisible by 5). Layer exists: `/json/tms.json` lists `ridge::USCOMP-N0Q-202611252055`. Note: `?operation=available` on the tile URL just returns a PNG, and the TMS listing doesn't name it; `tms.json` is the real check. |
| **Rate limits** | Docs conflict: FAQ says 100 requests/IP/minute, api.html says no hard limits, "cache aggressively". Our proxy makes this per Cloudflare colo IP, so the Cache API matters. | No number. Page asks not to use it in apps with "thousands of simultaneous users". Tiles are cacheable 14 days (`/c/`) so our proxy cache cuts load a lot. Fine for us; it is a university server with no SLA ("as-is"). |
| **Color scheme** | Only Universal Blue now. | One fixed NEXRAD palette. Whichever we pick, motion math uses alpha × luminance, so it doesn't care. |
| **Attribution** | Mandatory under free terms: "Weather data by RainViewer" with link. | "Would be appreciated": credit Iowa Environmental Mesonet. |
| **Other** | Owners can change or remove the data; no uptime promise. | Same "as-is" caveat. Two feeds would also let us fall back from one to the other. |

**Recommendation:** switch the radar map and the motion frames to IEM. The reason is the sponsor line: RainViewer's free
tier is personal/educational and the user wants a "presented by" slot later. IEM is public domain, has finer 5-min steps
(better motion estimates), and is already CORS-open. The cost is a different look (NEXRAD palette instead of Universal
Blue), no 2 h history in one call (we generate timestamps ourselves, which is simple), and a university server with no SLA.
**Middle option:** keep RainViewer as the displayed map for now and use IEM only for motion and future frames. That mixes
two palettes on one map, so I don't recommend it. **Default if the user doesn't care: keep RainViewer.**

**Decision (2026-11-25): the user chose IEM for everything.** The normal loop, the future frames and the credit
("Radar: Iowa Environmental Mesonet") all use IEM; `worker/sources/rainviewer.ts` is gone and RainViewer is no longer
credited. Built as:
- `worker/sources/iemradar.ts`: reads `/json/tms.json` for the newest `ridge_uscomp_n0q` time, then lists 12 frames
  5 minutes apart (55 min). `/api/radar` keeps its shape (`host` + `frames[{time,path}]`); clients load
  `${host}${path}/{z}/{x}/{y}.png` straight from IEM's `/c/` tiles (cached 14 days, CORS open), maxNativeZoom 7.
- `GET /api/radar/tile/{unixTime}/{z}/{x}/{y}`: same-origin proxy for the future canvas only, Cache API, z ≤ 7. "Known
  frames" is checked by arithmetic (time on the 5-minute grid and within the last 2 hours), not against the cached list,
  so a tile never waits on a second upstream call.
- `shared/radarflow.ts` (pure, `test/radarflow.test.ts`), `src/workers/radarflow.worker.ts`, `src/components/FutureRadar.ts`
  (tiles, stitching, worker, 8 s worker cap and 10 s total cap, remembered per frame time), `radarLoop.ts` (shared loop for
  `Radar.tsx` and `LiveRadar.tsx`) and `futureRadarUi.ts` (Past | Now | Future bar, "Future (estimate)" badge, "?").
- Differences from the plan text: motion uses 2 frames 10 minutes apart (not 3); the stitched area is capped at 5×4 tiles
  centred on the view (a dashed box shows where the estimate covers), at the map's own zoom up to 7; the "?" is always
  visible (not only on future frames) and Live prints the explainer as a line since nobody can click there.
- Not shown on the warning takeover map (`<Radar future={false} />`) or when `LiveRadar` is locked on a warning polygon.
- Measured (dev, desktop Chrome, 1280×1024 stitched): worker 0.8 to 1.0 s; tiles+stitch+encode 0.2 to 0.6 s with warm
  tile cache (a cold dev run took 12 s before the proxy stopped re-fetching the frame list for every tile). Not measured
  on a Fire TV.

Side finding: both sources send CORS `*`, so the R1 proxy is not strictly needed to read pixels. It is still worth
building as written (it caps load on a free server, caches per colo, and stops being an open proxy), but it could be
dropped if the user prefers less code.

---

## L. Lightning proximity

**What the user sees:** "⚡ Lightning **6 mi** away, 2 min ago. **Stay inside.** All clear at
**7:42 PM** if no more strikes within 10 mi." A ring map with recent flashes. Optional push on
the Android app.

### L0. Source and the hard part
- **NOAA GOES-19 (GOES-East) Geostationary Lightning Mapper, Level-2 "LCFA" files.** Public
  domain, free, no key. S3 bucket `noaa-goes19`, prefix `GLM-L2-LCFA/YYYY/DDD/HH/`, three files a
  minute (20 s each). Filenames carry start/end/created times (`_s…_e…_c…`). **Verify** the bucket
  and prefix with an S3 `ListObjectsV2` call (`?list-type=2&prefix=…`, public XML).
- Files are **netCDF-4 (HDF5)**. We need `flash_lat`, `flash_lon`, `flash_time_offset_of_first_event`,
  `flash_quality_flag`, plus the file's `product_time` and scale/offset attributes. **Verify** the
  variable names from the GLM L2 product guide.
- **Spike first (half a day, then STOP if it fails):** can a Worker parse one file within the
  cron CPU budget? Try a pure-JS HDF5 reader (e.g. `jsfive`, which needs zlib through `pako`)
  in a Vitest test on a recorded file. Measure CPU time. If it doesn't work, **stop and tell
  the user**. Don't pull in a big WASM build or an outside server without asking.
- GLM sees **total lightning** (in-cloud and cloud-to-ground) from orbit with ~8 km pixels. Fine
  for "lightning nearby, go inside", not for exact strike points. Wording must say "about".
- Workers Paid cron limits (CPU time per invocation): **verify** in Cloudflare docs and set
  `limits.cpu_ms` in `wrangler.jsonc` only if needed.

### L1. Ingest (Worker cron)
- `worker/sources/glm.ts`: list files newer than the last one seen, fetch them (max 6 per run),
  parse, keep good-quality flashes inside the **region bbox** (`live.region.bbox`, already in config,
  plus 0.5° buffer). Region-only on purpose: it keeps KV and CPU small. Outside the region the
  API answers `{ available: false }` and the UI says "Lightning isn't tracked here yet."
- Store one KV value `lightning:recent` = `{ lastFile, updated, flashes: [lat, lon, tMs][] }`,
  keeping the last 45 min, lat/lon rounded to 0.01°. **One write per cron pass** at most, and
  none when nothing changed. Budget: about 86k writes a month (within Workers Paid's included
  writes; **verify** the current number).
- Run it inside the existing `pass()` in `worker/index.ts`, **after** the alert push fan-outs
  (alerts stay first), wrapped in its own `.catch` so a GLM failure never blocks alerts.
- If no new file has arrived in 5 min, mark `stale: true` (GOES outages happen).

### L2. Logic: `shared/lightning.ts` (pure, tested)
- `lightningNear(flashes, lat, lon, now) → LightningState`:
  `{ nearestMi, lastWithin10At, count10, count25, trend: "closer" | "steady" | "away" | null, allClearAt, level }`.
- Levels: **danger** = a flash within 10 mi in the last 10 min (audible thunder range).
  **nearby** = within 10 to 25 mi in the last 15 min. **clear** otherwise.
- **30-minute rule** (NWS lightning safety guidance): `allClearAt` = last flash within 10 mi + 30 min.
  It resets if another one comes in.
- Trend: compare the mean distance of flashes in the last 5 min against the 10 min before.
- Round distances to whole miles and say "about". Under 3 mi, say "overhead".
- Tests: empty list, one flash at 6 mi → danger and allClear +30 min, a new flash resets it,
  flashes 20 mi away → nearby, trend closer and away, stale data → no "all clear" claim
  (show "data delayed" instead).

### L3. API + screens
- `GET /api/lightning?lat=&lon=` → `LightningState` plus the flashes within 30 mi (for the ring
  map). Reads the KV value (KV `cacheTtl: 30`). Browser cache 30 s.
- **Threat engine:** lightning does **not** raise the threat level (it isn't an NWS alert). It
  shows as its own banner chip on all screens while `danger` or `nearby`.
- **Phone / web:** a banner chip and a small ring map (rings at 5, 10 and 25 mi, flashes fading by
  age). The all-clear countdown is the big number.
- **Kiosk:** a corner chip; a full segment `lightning` (relevance 1 at danger, 0.6 at nearby, else 0).
- **Live:** add `lightning` to the rundown inputs as a deterministic template item
  ("Lightning about 6 miles from Norristown, moving closer."), and let it nudge
  `shared/live/intensity.ts` slightly (cap the contribution so it can't outrank a warning).
  Add a test for that cap.
- **Accessibility:** the chip text works without color; the ring map has an `aria-label` summary.

### L4. Push (optional, ask the user before building)
- Web push and FCM are keyed by **NWS zone** so the server never learns where a phone is.
  Keep that: when a zone in the region gets a flash within 10 mi of its outline, send a data
  message to topic `z_{zone}` carrying the flash point and time. The phone (in `AlertDecider.kt`)
  checks its own GPS and only notifies if it's within 10 mi.
- Opt-in, **off by default**. One message per zone per 30 min. Respect quiet hours. Never a
  full-screen or DND-bypass alert for lightning.
- Needs an Android release (bump `versionCode`, see [ANDROID.md](ANDROID.md)). **Ask the user**
  before building the Android part.

### L5. Done when
- Spike result reported. If it works: ingest test with a recorded GLM file (keep the fixture
  small: cut it to the region, or record the parsed JSON plus one small raw file),
  `lightning.ts` tests, the intensity cap test.
- A dry-day check: the chip stays hidden and the API says `clear`.
- **STOP:** report the CPU time per cron run and KV writes per hour from a local `wrangler dev`
  run with `--test-scheduled`, plus screenshots.

---

## Order of work and stop points (summary)

1. **S** snow day odds → STOP (screenshots, ask for real districts).
2. **D** damage report → STOP (sample PDF, IEM terms).
3. **R0** source comparison → STOP for the user's pick → **R1 to R3** → STOP (screenshots).
4. **L0** spike → STOP if it fails → **L1 to L3** → STOP → **L4** only if the user says yes.

## Open questions for the user (ask at the matching STOP, not before)
- Snow day: which school districts, and how quick is each to close?
- Damage report: should it be public on the site, or only for signed-in admin at first?
- Future radar: RainViewer or IEM tiles (after the comparison)?
- Lightning: Android push yes or no? Region-only OK for now?
