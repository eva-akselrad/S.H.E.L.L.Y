# SHELLY

**S**evere **H**ydrology & **E**nvironmental **L**ive **L**ogging **Y**earbook — a US-only live weather
display that gets louder when the weather does. Named after the author's grandmother.

SHELLY v2 is one Cloudflare Worker serving a Preact app and a small JSON API. The old v1 app is
tagged `legacy-v1`.

## What it does

- Computes a **threat level** (CALM / ELEVATED / WARNING / EMERGENCY) from NWS alerts, the SPC
  outlook and a 15-minute nowcast (`shared/threat.ts`).
- The threat level changes the screen: a relaxed loop when calm, a shorter loop with radar and the
  SPC outlook when elevated, a radar-locked warning takeover with countdown and spoken read-out for
  warnings, and a full-screen takeover for emergencies (observed tornado, destructive storm, PDS,
  flash flood emergency).
- Three layouts: **kiosk/TV** (16:9 stage, auto-cycling), **desktop** (drive it yourself) and
  **phone** (scrollable cards, threat pinned). Force one with `?mode=kiosk|web|phone`.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm test
npm run build
```

Trigger the alert poller locally: `curl http://localhost:5173/cdn-cgi/handler/scheduled`.

## Deploy

```bash
npm run deploy     # builds, then wrangler deploy
```

One `wrangler.jsonc` defines the Worker, static assets, the `STATE` KV namespace (auto-provisioned
on first deploy) and the every-minute alert-poller cron.

### Admin (announcements)

`/admin/` posts announcements to `/api/announcements`. Writes are **fail-closed**: the Worker
verifies a Cloudflare Access JWT, so until you configure Access they return 401.

1. In Cloudflare Zero Trust, create a self-hosted Access application covering `<your-host>/admin*`
   and `<your-host>/api/announcements`.
2. Put the team domain and the application AUD tag in `wrangler.jsonc` `vars`
   (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`) and redeploy.

## Data sources

NWS (alerts, points, forecast text), Open-Meteo (forecast, nowcast, air quality, pollen, geocoding),
NOAA SPC (convective outlook), RainViewer (radar tiles), Esri (basemap). Clients never call these
directly except map and radar tiles. NWS requests carry
`SHELLY/2.0 (https://evaakselrad.com, nws@evaakselrad.com)`.
