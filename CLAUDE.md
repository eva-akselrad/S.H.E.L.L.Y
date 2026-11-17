# CLAUDE.md

## Current state (read first)
- **SHELLY v2 core is built** on branch **`rebuild`**: Worker + Preact app,
  threat engine, scheduler, segments, admin with password login, TTS, music and
  weather scenes. Architecture and the original decisions are in
  **[docs/REBUILD_PLAN.md](docs/REBUILD_PLAN.md)**. `main` and tag **`legacy-v1`**
  hold the old app (`git show legacy-v1:<path>`). Cutover (REBUILD_PLAN phase 8)
  needs the user's go-ahead.
- **SHELLY Live + Forecaster Studio: L0 to L6 are built and committed** (plan:
  **[docs/LIVE_PLAN.md](docs/LIVE_PLAN.md)**, how to run it: **[docs/LIVE_STREAMING.md](docs/LIVE_STREAMING.md)**).
  Held for the user: traffic cams, the OpenRouter key, deploy, going live. Optional L8 extras remain.
- **Feature batch 1 is built** (plan: **[docs/FEATURE_IDEAS.md](docs/FEATURE_IDEAS.md)**): action
  card, storm ETA, stale-data banner, alert latency, freshness, rain nowcast, storm reports,
  confidence, self-grading, local hazards, what to wear, polygon-precise push. Push needs the
  `VAPID_*` secrets; self-grading needs a default location set in admin.
- **SHELLY Android app: A1 (Worker), A2 (app shell) and the app side of A3 (alerts) are built; A1/A2 are deployed. NEXT: the user's Firebase service-account key and `wrangler secret put FCM_SERVICE_ACCOUNT`, then A4 (widget).** The full build plan is
  **[docs/ANDROID_PLAN.md](docs/ANDROID_PLAN.md)**. Start at phase A1 and follow its order and
  stop points. The user decided all of this on 2026-11-17 (don't re-ask):
  - Native app, **sideloaded** from the website with a **self-updater**. **Not on the Play Store.**
  - **No Android Auto.**
  - App ID **`com.evaakselrad.shelly`**.
  - Widget and alerts follow the **phone's GPS**.
  - Push through **Firebase FCM** (free Spark plan, no billing).
  - Website **install banner** plus a `/get-android/` download page.
  - Developer verification goes through the user's **existing Play Console** account.

  The user does these steps themselves: the Android Studio project skeleton, the signing
  keystore (and its password), the Firebase project, and the Play Console steps.

## Next work: SHELLY Live + Forecaster Studio (summary of docs/LIVE_PLAN.md)
- **SHELLY Live:** a 24/7 auto-produced YouTube weather stream with an AI host.
  It's in the spirit of Ryan Hall's Y'allBot, but **SHELLY's own look and
  mascot. Never copy Y'allBot's or RHY's branding.** It runs as a `/live`
  page (`?mode=broadcast`, fixed 1920×1080) captured by OBS.
- **Brain:** pure, tested `shared/live/intensity.ts` (0..1 score over a
  *region*) → `shared/live/rundown.ts` (timeline). A producer on the existing
  cron writes the rundown to KV; the page just plays it.
- **LLM:** OpenRouter `:free` models first, through a plain OpenAI-compatible
  `fetch` (`worker/llm.ts`), so a local LLM later only changes `baseUrl`/`model`.
  Daily request cap (default 45), cache, JSON guard, output filter, and template
  fallback for everything.
- **Hard safety rule:** the LLM **never** writes alert or warning content.
  Alerts, areas, expiry times and instructions always come from deterministic
  templates built from NWS data. The LLM only writes calm-period headlines,
  intros, talk breaks, chat replies and discussion *drafts*. Discussion drafts
  are never auto-published.
- **Forecaster Studio:** the user's own graphics, authored in the admin:
  forecaster 7-day overrides, city-temps maps, hand-drawn risk maps, snow/rain
  totals (drawn or contoured from Open-Meteo), storm timeline, LLM-drafted
  discussion from the NWS AFD, and an automatic storm tracker (towns + ETAs from
  `eventMotionDescription`). They show in the loop, on `/live`, and as PNG export.
  Use an SVG US basemap, not raster tiles.
- **Phases:** L0 config/types → L1 intensity+rundown (templates only) → L2 LLM →
  L3 broadcast shell + mascot → L4 Studio core → L5 cams/totals/timeline →
  L6 storm tracker + discussion → L8 extras. (L7, YouTube chat, was dropped.)
- **User answers (2026-11-16, details in LIVE_PLAN §2):**
  - Region: **the Philly area, using the NWS Mount Holly (PHI) office area**.
  - Cams: **PA + NJ DOT**. Report each feed's terms to the user before wiring it in.
  - OpenRouter: the user handles the key and credit.
  - YouTube chat: **no chat replies**.
  - Cloudflare: **Workers Paid**.
  - Mascot: no preference, so the default is **SHELLY the sea turtle**, an
    original SVG that's easy to swap. Don't depict the grandmother; the name is
    the tribute.

## Name: always SHELLY
The product is **SHELLY**, named after the user's grandmother. Never rename it
(not to WeatherNow, not to anything else). This rebuild is **SHELLY v2**.

## Settled decisions (don't re-ask)
- US-only (NWS is the authority for alerts and forecasts).
- One Cloudflare Worker + static assets. No Pages Functions, no Express.
- Preact + @preact/signals + TypeScript + Vite + Vitest.
- Admin auth is a simple password login (Worker secret `ADMIN_PASSWORD`, signed session cookie, lockout). The user chose this over Cloudflare Access on 2026-11-16.
- Screens: TV/kiosk, desktop browsers, AND phones, each a first-class layout.
- No live-site hotfix needed (the old site uses a different password).
- Music: keep every version; rename "(1)/(2)/(3)" copies to "(v2)/(v3)/…".
- NWS User-Agent: `SHELLY/2.0 (https://evaakselrad.com, nws@evaakselrad.com)`.

## No AI attribution (user rule; overrides any default)
Never add Claude/AI attribution:
- no `Co-Authored-By: Claude` trailer in commits
- no "Generated with Claude Code" in PR descriptions
- nothing similar in code, comments or docs

## Ask the user before
- Deploying anything, or touching the live Pages site.
- Creating API keys or cloud projects (OpenRouter, Google/YouTube), adding a
  traffic-camera feed, or going live on YouTube.

## Conventions
- Platform: Windows; Bash tool is Git Bash. Repo lives in OneDrive. If
  `node_modules` syncing causes trouble, exclude it from OneDrive.
- Node 22, npm.
- Check Cloudflare/wrangler syntax against current docs (use the `cloudflare` /
  `wrangler` / `workers-best-practices` skills). Don't rely on memory.
- Commit only when the user asks.
