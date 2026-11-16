# CLAUDE.md

## Current state (read first)
This repo is mid-**teardown and rebuild**. The full plan, decisions and salvage
list are in **[docs/REBUILD_PLAN.md](docs/REBUILD_PLAN.md)**. Follow it.

- Work on branch **`rebuild`**. `main` and tag **`legacy-v1`** hold the old app.
- Everything at the repo root right now (`index.html`, `js/`, `css/`, `server.js`,
  `worker.js`, `functions/`, `admin.html`, …) is **legacy**. Phase 1 deletes it.
  To read old code later, use `git show legacy-v1:<path>`.
- **Nothing has been built yet.** Next step is Phase 1 (scaffold).

## Name: always SHELLY
The product is **SHELLY**, named after the user's grandmother. Never rename it
(not to WeatherNow, not to anything else). This rebuild is **SHELLY v2**.

## Settled decisions (don't re-ask)
- US-only (NWS is the authority for alerts and forecasts).
- One Cloudflare Worker + static assets. No Pages Functions, no Express.
- Preact + @preact/signals + TypeScript + Vite + Vitest.
- Admin auth via Cloudflare Access, not a homemade password.
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

## Conventions
- Platform: Windows; Bash tool is Git Bash. Repo lives in OneDrive. If
  `node_modules` syncing causes trouble, exclude it from OneDrive.
- Node 22, npm.
- Check Cloudflare/wrangler syntax against current docs (use the `cloudflare` /
  `wrangler` / `workers-best-practices` skills). Don't rely on memory.
- Commit only when the user asks.
