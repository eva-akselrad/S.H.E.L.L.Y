# SHELLY Live + Forecaster Studio — Implementation Plan

Status: **planned 2026-11-16, open questions answered (§2), nothing built yet. Start at L0.** Builds on the finished SHELLY v2
core (Worker + Preact app, threat engine, scheduler, segments, admin, TTS, music,
scenes). Read `docs/REBUILD_PLAN.md` for the core architecture. The rules there
still apply: one Worker, one `wrangler.jsonc`, typed shapes in `shared/`, pure
logic unit-tested, and no Claude/AI attribution anywhere.

Two features:

- **A. SHELLY Live**: a 24/7 auto-produced weather broadcast for YouTube, hosted
  by an AI persona. It's in the spirit of Y'allBot, but with SHELLY's own look.
- **B. Forecaster Studio**: the user's own forecast graphics (risk maps, snow and
  rain totals, highs-tomorrow maps, a forecaster 7-day, storm tracker), in the
  style of a TV station or Ryan Hall's custom screens. They show in the normal
  SHELLY loop, in SHELLY Live, and as PNGs for social media.

---

## 0. What the reference looks like (researched 2026-11-16)

Y'allBot (YouTube `@OfficialYallBot`, run by Ryan Hall, Y'all) is a 24/7 stream.
One stream covers KY/TN and one covers the nation. It describes itself as a
"timeline of weather content" that gets reprioritized automatically by a
"Weather Intensity Score" (WIS). On-screen anatomy, 1920×1080:

| Zone | What it shows |
|---|---|
| Top-left | Three small counters, colored by type (looked like TOR / SVR / FFW warning counts). |
| Top bar | An AI-written **headline** in caps, e.g. "PATCHY DENSE FOG POSSIBLE TONIGHT ACROSS WESTERN KENTUCKY". It changes every ~20–30 s. |
| Top-right | A numeric gauge (showed `0.26`, which is probably the intensity score) plus small labels. |
| Main panel (~70%) | Rotates through **DOT traffic cameras** (titled "TDOT CAM #189", with a caption line holding road, city and lat/lon), **regional radar** on a dark street basemap with a legend and time, and maps. |
| Right rail | A **locator mini-map** showing where the camera is, plus a "live from" source caption. |
| Bottom-right | An **animated robot mascot** that "talks". |
| Lower third | Logo, **clock and date**, "TOP ALERT: NO ACTIVE WARNINGS IN KENTUCKY OR TENNESSEE" and a status line ("AWAITING NEW ALERTS"). |
| Chat | The bot answers member chat and Super Chats, and says it may be delayed during active weather. The persona is sassy, with a pet AI dog. |

Ryan Hall's main channel uses dense, vivid custom maps built on NWS products and
model data. Nothing public says how they're produced. **Don't copy either
brand's look, mascot, logos or wording.** We take the *structure*. SHELLY's
identity comes from the existing theme tokens in `src/styles/main.css`.

---

## 1. Decisions (settled in this plan; change only if the user says so)

| Topic | Decision |
|---|---|
| Name | **SHELLY Live** for the stream and **Forecaster Studio** for the editor. The product stays SHELLY. |
| LLM | **OpenRouter free models first** (`*:free`), through an **OpenAI-compatible provider interface**. Switching to a local LLM (Ollama, LM Studio, llama.cpp server, vLLM) only means changing `baseUrl` + `model` + key. No SDK lock-in: use plain `fetch` to `/v1/chat/completions`. |
| Safety rule | **The LLM never writes life-safety content.** Alert text, warning areas, expiry times and instructions always come from deterministic templates (`shared/script.ts` style) built from NWS data. The LLM writes only "colour": headlines for calm periods, segment intros, forecast-discussion drafts and chat replies. Every LLM output has a template fallback, so the stream never stalls or goes silent when the model is down or rate-limited. |
| Where the stream renders | A new **broadcast shell** at `/live` (`?mode=broadcast`): a fixed 1920×1080 stage. The user captures it with **OBS Browser Source** and streams it to YouTube. Headless cloud streaming is a later, optional phase. |
| Voice | Reuse the existing TTS path (`worker/tts.ts`, Aura-2, daily char cap). Add a provider seam so a local TTS (Piper/Kokoro on the user's PC) can replace it later, the same way the LLM can. |
| Region | A broadcast covers a **region** (a list of states, or a bounding box), not one point. The existing single-point app is unchanged. |
| Storage | KV for config and the current rundown. **D1** only if forecast history/verification (B6) is built. |
| Data | NWS for alerts, AFDs and warnings; Open-Meteo for model fields; SPC for outlooks; RainViewer for radar. These are all already integrated. |

## 2. User answers (2026-11-16)

| Question | Answer |
|---|---|
| Broadcast region | **The Philly area.** Use the **NWS Mount Holly office (WFO PHI)** area: SE Pennsylvania, southern/central NJ, Delaware and NE Maryland. See §2a. |
| Traffic cams | **PA and NJ DOT cameras are wanted** (511PA / PennDOT and 511NJ / NJDOT). Find each feed's official source and its terms for rebroadcast or streaming. Report the terms to the user before wiring anything in. |
| OpenRouter | **The user handles the account, key and credit.** Build for the free tier: default cap 45 req/day, configurable in the admin. |
| YouTube chat replies | **No.** L7 is dropped. Don't build chat reading or replies. |
| Cloudflare plan | **Workers Paid.** KV write volume isn't a concern at this scale, and Durable Objects are available. |
| Mascot | **The user has no preference.** Use the default in §2b, built so it's easy to swap later. |

### 2a. Region definition: Philly / WFO PHI

- `region.office = "PHI"`. An alert is "in region" when it was issued by NWS
  Mount Holly. Check which normalized alert field identifies the issuing office
  (e.g. `senderName` "NWS Mount Holly NJ" or the `AWIPSidentifier`/`WMOidentifier`
  parameters) against a recorded fixture, and add it to the `Alert` type if it's
  missing. Also keep alerts whose polygon intersects the region bbox, so
  neighbouring offices' warnings near the edge still count.
- Region bbox, approximate (refine from the PHI county list): lat 38.4–41.4, lon −76.4 to −73.8.
- Timezone `America/New_York`. Lower-third wording: "Philadelphia region" /
  "Delaware Valley".
- CALM rotation cities, a starting list the admin can edit: Philadelphia, Trenton,
  Camden, Wilmington, Allentown, Reading, Doylestown, West Chester, Norristown,
  Mount Holly, Atlantic City, Cape May, Toms River, Dover (DE).
- The locator map and the Studio SVG basemap show only the region's counties,
  with the Delaware River, the Shore and the bay as landmarks.

### 2b. Default mascot (no user preference; easy to swap)

**SHELLY the sea turtle.** It fits the name (a shell) and the Jersey Shore /
Delaware Bay region, it's calm and steady (right for a safety-first stream), and
it looks nothing like Y'allBot's robot. Design notes:

- Flat, rounded SVG with no outlines, in SHELLY theme colors.
- The shell pattern is a subtle radar-sweep or isobar motif.
- States: idle (slow blink, gentle bob), talking (mouth flap driven by TTS
  amplitude), excited (calm-day fun fact), serious (WARNING+: still, no jokes,
  shell glows in the threat color), and off-air (forecaster live).
- The host's spoken name is "SHELLY". **Don't depict or refer to the user's
  grandmother.** The name is the tribute.
- Keep all art in `src/live/host/` behind one `<Host state=… level=… />`
  component, so a different mascot can replace it without touching anything else.

---

## Part A — SHELLY Live

### A1. Architecture

```
                     cron (every minute, already exists)
                              │
Worker ── pollAlerts ─────────┤
       └─ producer.tick() ────┘  (throttled inside; see A3)
             │ reads: alerts (KV), SPC, Open-Meteo regional grid, config
             │ computes: Intensity (pure, shared/live/intensity.ts)
             │ builds:   Rundown (pure, shared/live/rundown.ts)
             │ enriches: LLM headlines/intros (worker/llm.ts, budgeted, cached)
             ▼
          KV "live:rundown"  ──►  GET /api/live/rundown  (edge-cached 15 s)
                                            │
                       /live page (Broadcast shell, 1920×1080)
                       plays rundown, speaks via /api/tts, ducks music
                                            │
                                 OBS Browser Source ──► YouTube RTMP
```

The page is a "dumb player". All decisions are pure functions in `shared/`, so
the scheduling logic is unit-tested and the same in tests and production.

### A2. Intensity (the Weather Intensity Score equivalent)

`shared/live/intensity.ts`: `computeIntensity(input) → { score: 0..1, level, drivers[] }`.

- Inputs: active alerts **inside the region** (count and weight by event,
  reusing `alertLevel`/`isEmergency` from `shared/threat.ts`), max SPC category
  over the region, a regional nowcast (storm cells / CAPE from the Open-Meteo
  grid), and the "newest alert age" so fresh warnings spike it.
- Rough weights to start with, then tune with fixtures: emergency = 1.0 floor;
  each tornado warning +0.25; SVR +0.08; FFW +0.08; watches +0.05; SPC
  MRGL/SLGT/ENH/MDT/HIGH = 0.05/0.15/0.3/0.5/0.7; decay over 30 min after the
  last warning ends.
- `level` maps onto the existing `ThreatLevel` names (CALM/ELEVATED/WARNING/EMERGENCY).
- `drivers` is a list of human-readable reasons. It feeds the headline templates
  and the on-screen gauge tooltip.
- **Tests:** a calm fixture, a fog advisory, a slight-risk day, one TOR, an
  outbreak (8 TOR + PDS), and the decay curve.

### A3. Rundown (the timeline)

`shared/live/rundown.ts`: `buildRundown(intensity, data, cfg, now) → RundownItem[]`.

```ts
type RundownItem =
  | { kind: "alert"; alertId: string }              // template script, never LLM
  | { kind: "radar"; view: "region" | "warning"; alertId?: string }
  | { kind: "cam"; camId: string }
  | { kind: "map"; product: StudioProductId }       // Part B graphics
  | { kind: "segment"; id: SegmentId; point: Place } // reuse existing segments for a city
  | { kind: "outlook" }
  | { kind: "host"; text: string; source: "llm" | "template" };
// each item also has: durationSec, headline, speak?: string
```

- **CALM:** rotate city conditions (top N cities in the region), regional
  radar, the forecaster's latest Studio graphics, outlook, cams, and an
  occasional host "talk break". (The LLM writes talk breaks; there's no chat interaction.)
- **ELEVATED:** add the watch summary and SPC outlook, show radar every other item, and drop the cams.
- **WARNING:** lock onto the newest/highest warning: warning radar, storm tracker (B4) and template read-out. Repeat every ~90 s while other content cycles.
- **EMERGENCY:** a full takeover that matches the existing `src/takeover/` behavior.
- The producer stores the rundown in KV only when it changed (diff the JSON), to save KV writes.
- The account is on **Workers Paid**, so KV writes are fine. A single Durable
  Object for live state (pushing to `/live` over WebSocket instead of polling) is
  an allowed upgrade later, and B4 needs it anyway. Use the `durable-objects` skill.

### A4. LLM layer

`worker/llm.ts`:

```ts
interface LlmConfig {
  provider: "openrouter" | "openai-compatible";
  baseUrl: string;          // https://openrouter.ai/api/v1  |  http(s)://<tunnel>/v1
  models: string[];         // ordered fallbacks, e.g. 2–3 ":free" ids
  dailyRequestCap: number;  // default 45 (stay under the 50/day free cap)
  temperature: number;
}
```

- The secret `LLM_API_KEY` goes on the Worker (add to `worker/env.d.ts`). The config lives in `SiteConfig.live.llm`, and the admin can edit it.
- OpenRouter: send the `models` array for fallback, plus `HTTP-Referer` /
  `X-Title: SHELLY` headers. Check the current OpenRouter docs for header names
  and the `models` fallback field before you write it.
- **Budget:** a KV counter per UTC day, the same as `tts-chars`. Over the cap, use templates silently.
- **Cache:** key on a hash of prompt inputs, so the same weather means no new call.
- **Batching:** one call returns **a JSON pack**:
  `{ headlines: string[8], intros: Record<itemKey,string>, talkBreak: string }`.
  Ask for JSON and **validate with a hand-written guard**. Free models often
  return broken JSON, so on failure the reply is discarded and templates are used.
- **Call cadence:** calm = one pack every 60 min (~24/day); on the intensity
  level changing, one immediate pack (rate-limited to one per 5 min).
- **Output filter:** cap the length, strip URLs and markdown, and block any
  phrase that claims an alert, warning or "take shelter" when there's no
  matching active alert. Unit-test the filter.
- **Prompts** live in `shared/live/prompts.ts` as pure builders, so tests can
  snapshot them. The system prompt gives SHELLY's persona (warm, a little witty,
  never flippant during warnings), the region, and a hard rule against stating
  numbers or alerts that aren't in the provided data.
- **Local LLM later:** a Cloudflare Worker can't reach `localhost` on the user's
  PC. There are two options:
  (a) expose the local server through **Cloudflare Tunnel**, protected by an
  Access service token passed as headers from the Worker; or
  (b) a `browser` provider mode, where `/live` (running on the same PC as OBS)
  calls `http://localhost:11434/v1` directly for colour text, with the Worker
  still supplying the data. Build (a) first; (b) is the zero-cloud fallback.
  Document both in the README.

### A5. Broadcast shell (`src/shells/Broadcast.tsx`)

Fixed 1920×1080 stage, scaled to the window, no controls, cursor hidden. Add
`"broadcast"` to `src/mode.ts` (only via `?mode=broadcast` or the `/live` path;
never auto-detected). Components live in `src/live/`:

| Component | Notes |
|---|---|
| `AlertCounters` | TOR / SVR / FFW / watch counts for the region, color-coded with the existing threat colors. |
| `HeadlineBar` | Rotating headline with a typewriter or slide transition. In WARNING+ it shows template text only. |
| `IntensityGauge` | 0.00–1.00 with a color ramp and the level name. Call it "SHELLY Index" or similar, not WIS. |
| `MainPanel` | Renders the current `RundownItem`: radar (reuse `Radar` segment logic + warning polygon), cam, Studio map, or an existing segment in a 16:9 panel. |
| `RightRail` | Locator mini-map (Leaflet, region outline + pin), "next up" list, and a source/credit line (NWS, RainViewer, DOT name). |
| `Host` | Mascot with idle and talking states. Lip-flap is driven by TTS playback amplitude (WebAudio `AnalyserNode`). SVG/CSS animation, no video assets. |
| `LowerThird` | SHELLY logo, clock/date in the region's timezone, "TOP ALERT" line, and status ("Watching N alerts" / "Awaiting new alerts"). |
| `Crawl` | Full alert crawl at WARNING+ (reuse the takeover crawl). |

- Audio: the existing music player + TTS queue, with ducking already wired through `applyThreatToMusic`. Add a "talk break" duck.
- Burn-in protection is not needed for a stream, but **keep everything inside 5% safe margins** (YouTube player overlays).
- Visual QA: screenshots at 1920×1080 for each threat level using the admin **simulator** (`shared/simulate.ts`), which already fakes alerts.

### A6. Admin additions (`src/admin/Live.tsx`)

- Region picker (states multi-select, plus optional bounding box drawn on a map).
- City list for the CALM rotation (prefilled with the largest cities in the region).
- LLM settings: provider, base URL, model list, a "Test" button (one call, shows output and latency), and today's usage against the cap.
- Persona: host name, tone slider (calm ↔ playful), and banned topics.
- Cams list (L5), Studio graphics to include, and segment durations.
- "Preview rundown": shows the current rundown JSON and the next 10 items.
- Everything goes through the existing admin session and `audit()`.

### A7. Streaming setup (docs, not code at first)

`docs/LIVE_STREAMING.md`: OBS Browser Source at 1920×1080 / 30 fps, URL
`https://<site>/live?key=<viewer token>`. Tick "Control audio via OBS", add a
YouTube stream key, and add a nightly OBS restart via the Windows Task
Scheduler. The **viewer token** is a long random value in the config, so the
`/live` page isn't advertised. It isn't secret-grade, because the page holds no
secrets. Later option: a small headless runner (Chromium + ffmpeg in a container
on a home server or a VPS). Don't use Cloudflare for video egress.

---

## Part B — Forecaster Studio

The user's own forecast products, authored in the admin and shown everywhere
(loop segments, SHELLY Live `map` items, PNG export).

### B1. Product model (`shared/studio.ts`)

```ts
type StudioProductId = string;
interface StudioProduct {
  id: StudioProductId;
  kind: "riskMap" | "totalsMap" | "cityTemps" | "sevenDay" | "timeline" | "discussion" | "stormTrack";
  title: string;           // "SHELLY Severe Risk — Tuesday"
  validFrom: string; validTo: string;
  region: Bbox;
  published: boolean;
  author: "forecaster" | "auto";   // auto = generated from model data, not hand-drawn
  body: RiskMap | TotalsMap | CityTemps | SevenDay | Timeline | Discussion | StormTrack;
  updated: string;
}
```

Store the list in KV `studio:products` (≤ 50 items, expired ones pruned).
Expose `GET /api/studio` (public, published only) and admin CRUD under
`/api/admin/studio`.

### B2. Products, in build order

1. **Forecaster 7-day** (`sevenDay`): starts from the model 7-day. The
   forecaster overrides any high/low/icon/PoP and adds a one-line note per day.
   Overridden values get a small "SHELLY forecast" marker. Easiest win, and it
   reuses the `Daily` segment's look.
2. **City temps map** (`cityTemps`): "Highs Tomorrow" / "Lows Tonight" /
   "Feels Like". The region basemap has city labels and values. The data comes
   from Open-Meteo's multi-location request for the region's city list. Auto-
   generated, but the forecaster can edit before publishing.
3. **Risk map** (`riskMap`): the forecaster draws polygons on a Leaflet map and
   assigns SHELLY's own categories. Use our own names and palette (e.g. Low /
   Some / Moderate / High / Extreme); don't reuse SPC's labels. Each category
   has a hazard tag (tornado, wind, hail, flood, winter, heat). Use Leaflet-
   Geoman (free edition, MIT; verify the licence and version) or a minimal custom
   polygon tool. Store as GeoJSON. Add a "Start from SPC" button that imports the
   SPC Day 1/2/3 polygons as an editable starting point.
4. **Totals map** (`totalsMap`): snow or rain totals as filled bands
   (e.g. 1–3", 3–6", 6–12", 12"+). Two modes: **draw** bands like the risk map,
   or **model**: sample an Open-Meteo grid (~15×15 points over the region,
   batched multi-coordinate requests, cached 1 h), contour it on a canvas
   (marching squares, a small pure function in `shared/contour.ts`, tested),
   then let the forecaster nudge it.
5. **Timeline** (`timeline`): "Storm Timeline" across the cities as a row of
   hour blocks colored by expected hazard. Auto-filled from hourly precip
   type/intensity and editable.
6. **Discussion** (`discussion`): a plain-language forecast write-up.
   **LLM draft from the NWS Area Forecast Discussion**
   (`/products/types/AFD/locations/{office}`, the latest one) plus model data.
   The forecaster edits and publishes. The LLM draft is clearly marked as a
   draft in the admin and is never auto-published.
7. **Storm tracker** (`stormTrack`, automatic during warnings): parse the NWS
   `eventMotionDescription` parameter (time, direction, speed in knots, and the
   storm's lat/lon points). Project the storm along its motion vector, and list
   **towns in the path with ETAs**, using the existing city data + haversine in
   `shared/geo.ts`. Draw it on the warning radar as a cone/arrow. This is the
   Ryan Hall-style "here's when it reaches you" screen. Pure function
   `shared/live/track.ts`, heavily tested with recorded warning fixtures. Add
   `eventMotionDescription` to `AlertParams` and the NWS normalizer.

### B3. Rendering and export

- Each kind has one Preact view in `src/studio/views/`. It's used by the loop
  segment `studio` (new `SegmentId`, relevance = 1 when a product is published
  and valid now, otherwise 0), by the broadcast `MainPanel`, and by the admin
  preview.
- Shared map chrome: a SHELLY title bar, a valid-time line, a legend, a
  "Forecast by <forecaster name>" credit, and the logo. One visual system, so
  all graphics look like a set.
- **PNG export:** render the view into an offscreen 1920×1080 node and
  rasterize it. Leaflet tiles need CORS-safe tiles for canvas. Simpler: draw
  export versions of the maps with an SVG basemap (US states/counties
  TopoJSON, public domain, bundled), not raster tiles. Prefer that for **all**
  Studio maps, because it makes them crisp, fast and exportable. Provide
  1920×1080 (stream/X) and 1080×1350 (Instagram/Facebook) sizes.

### B4. Live Desk (when the user goes live in person)

This comes later, after A and B2.1–B2.7 work:
- `/live?desk=1` adds a small operator overlay (only for the admin session).
  The user can pin an item, lock onto a warning, skip, mute the host, or push
  a manual headline.
- **Telestrator:** draw on the main panel. Strokes are sent to the `/live` page
  through a Durable Object WebSocket, so the user can draw from a second device.
- Host handoff: "Forecaster on air" mode silences the AI host and the LLM headlines.

### B5. Optional: forecast verification (D1)

Archive each published 7-day and totals map. After each valid time, pull the
observations (NWS station obs / Open-Meteo archive), then show a "How did SHELLY
do?" scorecard in the admin. Only build this if the user wants it.

---

## 3. Phases (in order; each phase ends with typecheck + tests + build green)

| Phase | Scope | Done when |
|---|---|---|
| **L0** | Config + types: `SiteConfig.live`, `SiteConfig.studio`, `StudioProduct` types, `eventMotionDescription` param, `"broadcast"` mode. Normalizer + tests. | Config round-trips; old configs still load. |
| **L1** | `intensity.ts` + `rundown.ts` (pure, fixtures) + producer on the cron + `GET /api/live/rundown`. Templates only, no LLM yet. | Tests cover calm → outbreak; rundown in KV updates within ~1 min of an alert change. |
| **L2** | `worker/llm.ts` (OpenRouter, fallbacks, budget, cache, JSON guard, output filter) + admin LLM settings and Test button. | With the key unset or the cap hit, the stream still has headlines (templates). A test proves the filter blocks a fake "tornado warning" headline. |
| **L3** | Broadcast shell + all `src/live/` components + host mascot (after the mascot question is answered). | Screenshot set at 1920×1080 for CALM / ELEVATED / WARNING / EMERGENCY via the simulator. |
| **L4** | Studio B2.1–B2.3 (7-day override, city temps, risk map) + SVG basemap + `studio` segment + PNG export. | The forecaster can draw, publish, and see the product in the loop, on `/live` and as a PNG. |
| **L5** | PA + NJ DOT cams (report each feed's terms to the user first), Studio B2.4–B2.5 (totals + contour, timeline). | `contour.ts` tests pass; cam failures skip quietly. |
| **L6** | Storm tracker B2.7 + discussion drafts B2.6. | A warning fixture shows the correct towns and ETAs (±2 min against a hand calculation). |
| ~~L7~~ | **Dropped by the user (no chat replies).** | — |
| **L8** | (Optional) Live Desk B4, local-LLM option (b), local TTS, D1 verification B5, headless runner. | Per item. |

**Ask the user before:** deploying, creating the OpenRouter key or any Google
Cloud project, adding a DOT camera feed, or going live on YouTube.

## 4. Testing notes

- Pure modules (`intensity`, `rundown`, `prompts`, output filter, `contour`,
  `track`, studio normalizers) get Vitest unit tests with recorded fixtures,
  never live API calls.
- Worker routes: extend `test/smoke.test.ts` / `test/admin.test.ts` patterns.
  The LLM is mocked with a fetch stub that returns valid JSON, broken JSON, a 429
  and a timeout. All four must end with a working rundown.
- UI: `test/app.test.tsx` pattern (happy-dom) for the Broadcast shell rendering each RundownItem kind.
