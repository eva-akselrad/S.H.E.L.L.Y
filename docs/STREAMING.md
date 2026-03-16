# S.H.E.L.L.Y. Streaming System Documentation

> **Feature Branch:** `copilot/add-livestreaming-overlay-dashboard`  
> This document covers the livestreaming overlay and dashboard features added to S.H.E.L.L.Y.

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Automated Mode (overlay.html)](#automated-mode-overlayhtml)
4. [Streamer-Controlled Mode](#streamer-controlled-mode)
   - [Stream Display (stream-display.html)](#stream-display-stream-displayhtml)
   - [Stream Dashboard (stream-dashboard.html)](#stream-dashboard-stream-dashboardhtml)
5. [OBS Integration](#obs-integration)
6. [WebSocket Protocol](#websocket-protocol)
7. [REST API Reference](#rest-api-reference)
8. [TTS (Text-to-Speech)](#tts-text-to-speech)
9. [Sound Alerts](#sound-alerts)
10. [Docker Configuration](#docker-configuration)
11. [Environment Variables](#environment-variables)
12. [Architecture Overview](#architecture-overview)

---

## Overview

S.H.E.L.L.Y.'s streaming system adds two broadcast modes on top of the core weather display:

| Mode | URL | Purpose |
|------|-----|---------|
| **Automated (Y'allbot)** | `/overlay.html` | Self-cycling overlay; no human required |
| **Stream Display** | `/stream-display.html` | OBS capture page; driven by the dashboard |
| **Stream Dashboard** | `/stream-dashboard.html` | Streamer control panel |

Both OBS pages are designed for **1920×1080** browser sources and use the same dark blue S.H.E.L.L.Y. aesthetic.

---

## Quick Start

### With Docker (recommended)

```bash
# Clone and start
git clone https://github.com/eva-akselrad/S.H.E.L.L.Y
cd S.H.E.L.L.Y

# (Optional) Add custom sounds
# Place .mp3 files in ./sounds/ — see sounds/README.md

# Start the stack
docker compose up -d --build

# Pages available at:
#   http://localhost:9000/overlay.html          ← OBS Browser Source (Automated)
#   http://localhost:9000/stream-display.html   ← OBS Browser Source (Broadcast)
#   http://localhost:9000/stream-dashboard.html ← Your private control panel
```

### Without Docker

```bash
npm install
npm start  # Runs on port 3000

# http://localhost:3000/overlay.html
# http://localhost:3000/stream-dashboard.html
```

---

## Automated Mode (`overlay.html`)

The automated overlay runs **completely without human intervention**. It is inspired by Ryan Hall Y'all's "Y'allbot" stream.

### What it does

- **Radar carousel** – Rotates through 6 preset US radar regions every 30 seconds using RainViewer animated radar frames.
- **NWS Alert ticker** – A scrolling banner at the bottom shows active Tornado, Severe Thunderstorm, and Flash Flood warnings fetched from `api.weather.gov` every 2 minutes.
- **City forecasts** – The right-hand side panel shows current conditions and 24-hour high/low for 8 major US cities using Open-Meteo.
- **Full-screen alert takeover** – When a **Tornado Warning** or **Tornado Emergency** is detected by the server's NWS poll, the entire screen is covered by a red alert card. It auto-dismisses when the warning expires (or after 10 minutes as a safety timeout).
- **Weather data auto-refresh** – Current conditions, hourly, and 7-day forecast refresh every 5 minutes.
- **Dashboard override** – Even in automated mode, the page connects to the WebSocket server. If a streamer is also running the dashboard, they can override the view (e.g., trigger an alert takeover).

### Layout (1920×1080)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ⚡ S.H.E.L.L.Y.   LIVE WEATHER     AUTO MODE     [Location]  [Clock]   │ ← 60px header
├────────────────────────────────────────────────┬─────────────────────────┤
│                                                │                         │
│        MAIN PANEL  (~1440×900)                 │   SIDE PANEL  (~480px)  │
│   Slide 1: Live Radar (animated, RainViewer)   │   🌎 City Forecasts     │
│   Slide 2: Current Conditions                  │   ──────────────────    │
│   Slide 3: 7-Day Forecast                      │   ⚠ Active Alerts       │
│   Slide 4: Alert Detail List                   │                         │
│   (rotates every 30 seconds)                   │                         │
├────────────────────────────────────────────────┴─────────────────────────┤
│  ⚠ ALERTS  [scrolling ticker with active NWS warnings]                   │ ← 60px ticker
└──────────────────────────────────────────────────────────────────────────┘
```

### OBS Setup for Automated Mode

1. In OBS, add a **Browser Source**
2. URL: `http://localhost:9000/overlay.html` (or your server's IP)
3. Width: `1920`, Height: `1080`
4. ✅ Check **"Shutdown source when not visible"** (optional, saves resources)
5. ✅ Check **"Refresh browser when scene becomes active"**
6. CSS: *(leave blank)*

The overlay has a transparent background by default — the dark `#0a0e1a` background fills the full 1920×1080.

---

## Streamer-Controlled Mode

This is a **dual-screen setup**:
- `stream-display.html` — Clean 1920×1080 view captured by OBS
- `stream-dashboard.html` — Private control panel in your browser

### Stream Display (`stream-display.html`)

The display page connects to the server via WebSocket and **only changes when you push an update from the dashboard**. It shows a "waiting for broadcast" screen until the dashboard sends its first command.

**Responds to:**
- Mode switches (Radar / Forecast / Alerts / Cities)
- Radar region changes
- Lower-third overlays
- Full-screen alert takeovers
- NWS alert ticker updates (auto-pushed by server every 2 min)
- TTS voice commands
- Sound alert triggers

**OBS Setup:**
1. Add a **Browser Source**
2. URL: `http://localhost:9000/stream-display.html`
3. Width: `1920`, Height: `1080`
4. Same settings as the automated overlay

### Stream Dashboard (`stream-dashboard.html`)

Your private control panel. **Open this in your own browser** (not OBS). It is password-protected using the same `ADMIN_PASSWORD` as the main S.H.E.L.L.Y. admin panel.

#### Dashboard Sections

| Section | Description |
|---------|-------------|
| **Status Bar** | Live count of connected display/dashboard/SSE clients + current stream state |
| **Display Mode** | Switch between Radar, Forecast, Alerts, and Cities modes |
| **Radar Region** | 8 preset US regions + manual lat/lon/zoom entry |
| **Alert Takeover** | Trigger full-screen weather alerts with type, headline, and county text |
| **Lower Third** | Show/hide a lower-third bar with custom text in Info/Warning/Alert/Success styles |
| **Text-to-Speech** | Type a message to speak on the stream display (rate/pitch/volume controls) |
| **Sound Alerts** | Trigger pre-loaded audio alerts on the display (Tornado siren, etc.) |
| **Alert Ticker** | Toggle the bottom ticker and optionally override with custom text |
| **Forecast Location** | Point the display to a specific location's weather forecast |
| **Live NWS Alerts** | Auto-refreshing list of current active warnings from NWS |
| **Activity Log** | Log of the last 20 dashboard actions |

#### Authentication

The dashboard uses the `ADMIN_PASSWORD` environment variable (default: `weathernow`). The password is stored in `sessionStorage` so you stay logged in through page refreshes without re-entering it.

---

## OBS Integration

### Recommended Scene Layout

```
Scene: "Weather Stream"
  Sources (bottom to top in OBS):
  1. Browser Source: stream-display.html (1920×1080, full scene)
  
Scene: "Automated Weather"  
  Sources:
  1. Browser Source: overlay.html (1920×1080, full scene)
```

### Custom CSS for OBS Browser Source

If you want to make the background transparent so you can layer it over other content:

```css
body { background: transparent !important; }
.overlay-root { background: transparent !important; }
```

### Capturing Just the Ticker

If you only want the alert ticker as an overlay over other video:

```css
body { background: transparent !important; }
.overlay-root { background: transparent !important; }
.overlay-header, .overlay-body { display: none !important; }
.alert-ticker { position: fixed; bottom: 0; left: 0; right: 0; }
```

### Audio in OBS

S.H.E.L.L.Y. can play TTS and sound alerts directly in the OBS Browser Source. To capture this audio:
1. In the Browser Source properties, check ✅ **"Control audio via OBS"**
2. The browser source will appear in OBS's audio mixer
3. Set the channel to your stream's audio track

---

## WebSocket Protocol

The server exposes a WebSocket endpoint at `/api/stream/ws`.

### Connection

```javascript
const ws = new WebSocket('ws://localhost:9000/api/stream/ws');
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'register', role: 'display' }));
  // role: 'display' | 'dashboard' | 'overlay'
};
```

### Message Types (Server → Client)

| Type | Description | Sent to |
|------|-------------|---------|
| `state` | Full stream state object | display, dashboard, overlay |
| `nws-alerts` | Array of active NWS alerts | display, dashboard, overlay |
| `tts` | Speak text on display | display, overlay |
| `sound` | Play sound alert on display | display, overlay |
| `error` | Error response | all |

### Message Types (Dashboard → Server)

| Type | Description |
|------|-------------|
| `register` | Set client role |
| `command` | Send a stream command (requires `password` field) |

### Command Message Format

```json
{
  "type": "command",
  "password": "yourpassword",
  "action": "set-radar",
  "data": { "region": "southeast" }
}
```

### Available Actions

| Action | Data Fields | Description |
|--------|-------------|-------------|
| `set-radar` | `region`, `lat`, `lon`, `zoom`, `animation` | Change radar region |
| `set-mode` | `mode` (radar/forecast/alerts/cities) | Switch display mode |
| `set-lower-third` | `visible`, `text`, `style` | Show/hide lower third |
| `trigger-alert` | `type`, `headline`, `county`, `expires` | Show alert takeover |
| `clear-alert` | *(none)* | Dismiss alert takeover |
| `toggle-ticker` | `visible`, `custom` | Show/hide ticker |
| `set-forecast` | `visible`, `location`, `lat`, `lon` | Set forecast location |
| `trigger-tts` | *(sent via REST only)* | Speak text |
| `trigger-sound` | *(sent via REST only)* | Play sound alert |

### Alert Types

| Type | Icon | Display Color |
|------|------|---------------|
| `tornado` | 🌪️ | Red/dark red (pulse animation) |
| `storm` | ⛈️ | Orange/amber |
| `flood` | 🌊 | Blue/teal |
| `fire` | 🔥 | Orange/red |
| `emergency` | 🚨 | Red/purple (strong pulse) |
| `info` | ℹ️ | Blue |

---

## REST API Reference

All POST endpoints require authentication via the `X-Admin-Password` header or `password` field in the JSON body.

### GET `/api/stream/state`
Returns the current stream state and cached NWS alerts.

```json
{
  "state": {
    "radar": { "region": "national", "lat": null, "lon": null, "zoom": 5, "animation": true },
    "mode": "radar",
    "lowerThird": { "visible": false, "text": "", "style": "info" },
    "alert": { "active": false, "type": "info", "headline": "", "county": "", "expires": null },
    "forecast": { "visible": false, "location": "", "lat": null, "lon": null },
    "ticker": { "visible": true, "custom": "" }
  },
  "alerts": [...]
}
```

### POST `/api/stream/command`
Send a stream command from an HTTP client (e.g., a script).

```bash
curl -X POST http://localhost:9000/api/stream/command \
  -H "Content-Type: application/json" \
  -H "X-Admin-Password: yourpassword" \
  -d '{"action":"trigger-alert","data":{"type":"tornado","headline":"Tornado Warning in effect","county":"Parker County TX"}}'
```

### POST `/api/stream/tts`
Trigger TTS on all connected display/overlay clients.

```bash
curl -X POST http://localhost:9000/api/stream/tts \
  -H "Content-Type: application/json" \
  -H "X-Admin-Password: yourpassword" \
  -d '{"text":"Tornado warning issued for Parker County. Take shelter immediately.","rate":0.9,"pitch":1,"volume":1}'
```

### POST `/api/stream/sound`
Play a sound alert on all connected display/overlay clients.

```bash
curl -X POST http://localhost:9000/api/stream/sound \
  -H "Content-Type: application/json" \
  -H "X-Admin-Password: yourpassword" \
  -d '{"sound":"tornado-warning","volume":0.9}'
```

**Allowed sounds:** `tornado-warning`, `severe-thunderstorm`, `flash-flood`, `special-weather`, `test-tone`, `chime`

### GET `/api/stream/alerts`
Returns the server's cached NWS alerts (polled every 2 minutes).

```json
{
  "alerts": [
    {
      "id": "...",
      "event": "Tornado Warning",
      "headline": "Tornado Warning issued for...",
      "area": "Parker County, TX",
      "severity": "Extreme",
      "urgency": "Immediate",
      "expires": "2024-05-20T18:00:00-05:00",
      "sent": "2024-05-20T17:30:00-05:00"
    }
  ],
  "error": null,
  "polledAt": 1716231600000
}
```

### GET `/api/stream/connections`
Returns the count of connected WebSocket and SSE clients.

```json
{ "total": 3, "display": 1, "dashboard": 1, "overlay": 0, "sse": 1 }
```

### GET `/api/stream/events` (SSE Fallback)
Server-Sent Events endpoint for environments where WebSocket is not available. Connect with `EventSource` and receive the same messages as WebSocket clients.

```javascript
const es = new EventSource('/api/stream/events');
es.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  // Same message format as WebSocket
};
```

---

## TTS (Text-to-Speech)

S.H.E.L.L.Y. uses the **Web Speech API** (`speechSynthesis`) for TTS — no external service required.

### From the Dashboard

1. Open the **Text-to-Speech** section
2. Type your message
3. Adjust Rate (speed), Pitch, and Volume sliders
4. Click **🔊 Speak on Stream**

The message will be spoken on all connected stream displays.

### From the API

```bash
curl -X POST http://localhost:9000/api/stream/tts \
  -H "Content-Type: application/json" \
  -H "X-Admin-Password: yourpassword" \
  -d '{"text":"Severe thunderstorm warning issued until 6 PM.","rate":1.0,"pitch":1.0,"volume":1.0}'
```

### TTS Parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| `text` | String (max 500 chars) | required | Text to speak |
| `voice` | String | `""` (system default) | Voice name |
| `rate` | 0.1 – 3.0 | `1.0` | Speech rate |
| `pitch` | 0.0 – 2.0 | `1.0` | Pitch |
| `volume` | 0.0 – 1.0 | `1.0` | Volume |

### Browser Compatibility Note

TTS requires the display page to be running in a browser with Web Speech API support (Chrome, Edge, Firefox). Some browsers require user interaction before TTS will work — if TTS appears silent, reload the browser source.

---

## Sound Alerts

Sound alerts are triggered from the dashboard or API and played on all connected display/overlay clients.

### Adding Custom Sounds

1. Place `.mp3` files in the `./sounds/` directory with the exact filenames listed in `sounds/README.md`
2. They are served at `/sounds/{filename}.mp3`
3. If a file is missing, S.H.E.L.L.Y. auto-generates a synthesized tone using the Web Audio API

### Docker Volume Mount

In `docker-compose.yml`, the sounds directory is volume-mounted:

```yaml
volumes:
  - ./sounds:/app/sounds:ro
```

### Sound Fallback (Web Audio API)

When a sound file is not found, S.H.E.L.L.Y. synthesizes tones:

| Sound | Synthesized Fallback |
|-------|---------------------|
| `tornado-warning` | Sweeping siren (440Hz→880Hz, 2s) |
| `severe-thunderstorm` | Three descending tones |
| `flash-flood` | Low rumble sweep |
| `special-weather` | Double notification chime |
| `chime` | Simple musical chime |
| `test-tone` | 1-second 440Hz sine wave |

---

## Docker Configuration

### docker-compose.yml

The `docker-compose.yml` includes the sounds volume mount and new environment variables:

```yaml
services:
  weathernow:
    build: .
    container_name: weathernow
    restart: unless-stopped
    ports:
      - "9000:3000"
    volumes:
      - ./music:/app/music:ro
      - ./sounds:/app/sounds:ro
    environment:
      - TZ=America/New_York
      - ADMIN_PASSWORD=yourpassword    # Change this!
      - PORT=3000
      - NWS_POLL_ZONE=                 # Optional: NWS zone code (e.g. TXC113)
```

### Exposing Publicly (Cloudflare Tunnel)

If you want to access the dashboard from a remote location (e.g., from a different device at a venue), you can use Cloudflare Tunnel. Uncomment the `cloudflared` service in `docker-compose.yml`.

> ⚠️ **Security Note:** If you expose the server publicly, make sure to set a strong `ADMIN_PASSWORD`. The dashboard does not have rate limiting on the WebSocket connection itself, so keep the port behind a tunnel or reverse proxy.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP/WebSocket server port |
| `ADMIN_PASSWORD` | `weathernow` | Password for admin panel and stream dashboard |
| `NWS_POLL_ZONE` | `""` (national) | NWS zone code to filter alerts (e.g. `TXC113` for Parker County TX). Leave blank for national severe alerts. |
| `VAPID_PUBLIC_KEY` | (auto-generated) | Web Push public key |
| `VAPID_PRIVATE_KEY` | (auto-generated) | Web Push private key |
| `VAPID_EMAIL` | `mailto:admin@shelly.local` | Web Push contact email |
| `TZ` | `UTC` | Server timezone |

### Finding Your NWS Zone Code

1. Go to [https://alerts.weather.gov/](https://alerts.weather.gov/)
2. Select your state
3. Find your county/zone and note the code (e.g., `TXC113`)
4. Set `NWS_POLL_ZONE=TXC113` in `docker-compose.yml`

When `NWS_POLL_ZONE` is set, the server will only poll for alerts in that specific zone. When blank, it polls for all national Extreme/Severe/Immediate alerts.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Docker Container                             │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Node.js / Express  +  ws WebSocket Server                  │   │
│  │                                                              │   │
│  │  REST API endpoints (/api/stream/*)                         │   │
│  │  WebSocket Server   (/api/stream/ws)                        │   │
│  │  SSE Fallback       (/api/stream/events)                    │   │
│  │  NWS Alert Poller   (every 2 min → NWS API)                 │   │
│  │  Static File Server (overlay.html, stream-display.html, …)  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│           ↕ HTTP/WS          ↕ HTTP/WS            ↕ HTTP/WS        │
└───────────┼──────────────────┼────────────────────┼────────────────┘
            │                  │                    │
    ┌───────┴──────┐  ┌────────┴────────┐  ┌───────┴──────────┐
    │ overlay.html │  │ stream-         │  │ stream-          │
    │ (OBS Source) │  │ display.html    │  │ dashboard.html   │
    │              │  │ (OBS Source)    │  │ (Streamer's      │
    │ Autonomous   │  │                 │  │  Browser)        │
    │ Y'allbot     │  │ Driven by       │  │                  │
    │ mode         │  │ dashboard       │  │ Sends commands   │
    └──────────────┘  └─────────────────┘  └──────────────────┘
    
    Also polls:                                
    ├── api.open-meteo.com (weather)           
    ├── api.weather.gov (alerts)               
    └── api.rainviewer.com (radar)             
```

### Data Flow

1. **NWS polling**: The server polls `api.weather.gov` every 2 minutes and broadcasts fresh alerts to all connected WebSocket clients automatically.
2. **Dashboard → Display**: When the streamer clicks a button in the dashboard, it sends an HTTP POST to `/api/stream/command`. The server updates the in-memory stream state and broadcasts a `state` message to all display/overlay WebSocket clients. Displays update instantly — no page reload needed.
3. **TTS & Sound**: These are ephemeral commands not stored in state. The server broadcasts them directly to displays and they are acted upon immediately.
4. **SSE Fallback**: If a browser doesn't support WebSocket (rare), the display can fall back to Server-Sent Events at `/api/stream/events`. The SSE connection receives the same messages.
5. **Persistence**: Stream state is in-memory and resets on server restart. The last state is sent to newly-connected display clients on WebSocket registration.

---

## Troubleshooting

### Dashboard shows "Connection error"

- Make sure the server is running: `docker compose ps` or `curl http://localhost:9000/api/health`
- Check that the `ADMIN_PASSWORD` you entered matches what's in `docker-compose.yml`

### Stream display is blank / shows "Connecting to dashboard…"

- The display shows a waiting screen until it receives a state from the server
- Check browser console for WebSocket errors
- Verify the server URL is correct in the OBS Browser Source settings

### No sound playing

- The browser source must be focused (or have audio capture enabled in OBS)
- Sound files in `./sounds/` must be named exactly as specified in `sounds/README.md`
- If files are missing, a synthesized tone will play instead — verify the browser source has audio enabled

### TTS is silent

- Some browsers block speech synthesis until user interaction occurs
- If using OBS, reload the browser source to trigger fresh page load
- Check that Web Speech API is supported in the OBS built-in browser (it is, as of OBS 30+)

### NWS alerts not updating

- The server polls NWS every 2 minutes; if `NWS_POLL_ZONE` is set, verify the zone code is correct
- Check server logs: `docker compose logs -f weathernow`
- The sandbox/testing environment may not have external internet access; this is expected during development

### Overlay radar is blank

- RainViewer requires internet access for radar tile data
- Leaflet.js is loaded from `unpkg.com` — ensure that CDN is accessible
- In development/sandboxed environments, the radar map container will appear but tiles won't load

---

## Security Notes

- The stream dashboard is protected by `ADMIN_PASSWORD` — change the default `weathernow` before deploying
- The WebSocket connection validates the password on every `command` message
- Stream commands have a rate limit of 60 requests per minute per IP
- NWS alert data comes directly from `api.weather.gov` — no third-party intermediary
- Sound filenames are validated against an allow-list before serving

---

*For the main S.H.E.L.L.Y. documentation, see [README.md](../README.md).*
