# S.H.E.L.L.Y — Project Proposal

**S**evere **H**azard and **E**nvironmental **L**ive **L**ocation **Y**ielding system

---

## Abstract

S.H.E.L.L.Y is a self-hosted, real-time weather display kiosk application inspired by the classic WeatherStar 4000 units that ran on The Weather Channel in the 1990s. The goal is to build a modern web-based recreation of that experience: a cycling slideshow of weather data slides — current conditions, forecasts, radar, severe alerts, and more — all sourced from free public APIs (NOAA/NWS and Open-Meteo) with no API key required.

The application will be packaged as a Progressive Web App (PWA) runnable inside Docker for easy self-hosting on a Raspberry Pi, home server, or any machine with a display. An admin control panel will allow a remote operator to push announcements, emergency banners, and full system-wide takeover alerts to every connected display in real time. Background music will play on the display, automatically ducking when text-to-speech severe weather alerts are read aloud.

S.H.E.L.L.Y is intended for hobbyist use and digital signage at makerspaces, community centers, or just anyone who misses the aesthetic of the original WeatherStar. It is **not** a replacement for official NWS/EAS emergency alert systems.

---

## Goals

The following goals define the initial scope of the project. Individual goals may be refined or re-ordered as work progresses.

### Core Display

- [ ] Build a cycling slide deck of weather data slides that auto-advances and can be manually navigated
- [ ] Implement at minimum the following slides:
  - Current Conditions (temperature, feels-like, humidity, wind, pressure, UV index)
  - Detailed Observations (ASOS-style 24-field grid)
  - Hourly Forecast (next 24 hours)
  - Extended Forecast (7-day)
  - Precipitation Chart (hourly probability + amount with CAPE thunder indicator)
  - Almanac (sunrise, sunset, solar noon, moon phase, day length)
  - Air Quality Index
  - Pollen Counts
  - Travel Forecast (major US cities temperature list)
  - Regional Observations and Forecast (nearest cities to viewer)
  - SPC Severe Weather Outlook (Days 1–3 categorical risk)
  - Animated Radar (RainViewer)
  - Active Severe Weather Alerts (NWS)
  - Custom Forecast (admin-posted)
- [ ] Support both °F and °C unit toggling
- [ ] Support multiple visual themes (light, dark, custom)
- [ ] Allow configurable slide cycle speed
- [ ] Allow individual slides to be toggled on/off

### Location

- [ ] Detect user location via browser GPS
- [ ] Fall back to IP geolocation for an instant location estimate before GPS resolves
- [ ] Allow manual location entry via city/address search
- [ ] Save location in `localStorage` for fast restore on next visit

### Radar

- [ ] Integrate RainViewer API for animated radar frames
- [ ] Support play/pause and jump-to-live controls
- [ ] Show active NWS warning polygons overlaid on the radar map
- [ ] Classic vs. App radar mode toggle

### Severe Weather Alerts

- [ ] Fetch active NWS alerts for the viewer's location
- [ ] Display alert details: event type, severity, area, description, expiration
- [ ] Read alerts aloud via browser text-to-speech (TTS)
- [ ] Duck background music volume during TTS announcements

### Background Music

- [ ] Load a server-side MP3 playlist automatically
- [ ] Fall back to a local folder picker if no server playlist exists
- [ ] Shuffle and autoplay options
- [ ] Volume control with smooth audio ducking

### Admin Panel

- [ ] Password-protected admin interface accessible from any browser on the network
- [ ] Push real-time announcements (info / warning / emergency) to all connected displays
  - Banner style (slides in below the alert bar)
  - Popup style (full-screen blurred overlay)
  - Optional auto-dismiss timer
  - Optional TTS readout on the display
  - Optional push notification to subscribed devices
- [ ] Location targeting: all viewers, map radius, ZIP codes, or counties
- [ ] E.S.T.O.P. (Exigent Site Take-down Operational Procedure): system-wide undismissable emergency overlay
  - Nine preset emergency types (Tornado Warning, Hurricane Warning, Flash Flood Warning, Wildfire, Winter Storm, Severe Thunderstorm, Nuclear Alert, Civil Emergency, Custom)
  - EAS-style audio alarm, music auto-paused, cannot be closed by viewer
- [ ] Post versioned release notes visible from the admin panel
- [ ] Post a custom hand-crafted forecast slide with markdown support

### PWA / Deployment

- [ ] Make the app installable as a PWA on iOS, Android, and desktop
- [ ] Implement a service worker with cache-first strategy for offline support
- [ ] Automatic cache-busting on deploy (build hash injected into service worker cache key)
- [ ] Package as a Docker image with `docker compose up` one-liner deployment
- [ ] Cloudflare Pages / serverless function deployment option as an alternative to Docker

### Push Notifications

- [ ] Web Push (VAPID) subscription support
- [ ] Admin can send push notifications to all subscribed devices simultaneously
- [ ] Subscribe/unsubscribe from the Settings panel

### Kiosk / Sharing

- [ ] Fullscreen kiosk mode (auto-enters on load if configured)
- [ ] Keyboard navigation shortcuts (arrow keys, P to pause, R to refresh)
- [ ] Permalink sharing: encode all settings + location into a shareable URL

### Climate / Historical Data

- [ ] "On This Day" climate history slide using Open-Meteo Archive API (30 years of data)
- [ ] Cache climate data in `localStorage` with 24-hour TTL

---

## Team Members and Responsibilities

| Team Member | Role | Responsibilities |
|---|---|---|
| **Me** | Frontend Design | UI layout, slide templates, CSS theming (light/dark/custom), responsive design, animations, WeatherStar aesthetic recreation |
| **Myself** | JavaScript Developer | Client-side app logic (`app.js`, `weather.js`, `displays.js`, `radar.js`), data fetching, state management, settings persistence, slide cycling engine |
| **I** | Security Analyst | Authentication design for the admin panel, input sanitization, rate limiting, CSP headers, VAPID key management, secrets handling, penetration test findings remediation |
| **Yours truly** | Network Admin | Docker networking, nginx reverse proxy configuration, port mapping, HTTPS/TLS setup, VAPID key rotation, WebSocket/SSE connection reliability |
| **That person in the mirror** | Compliance & Legal | Disclaimer language (non-affiliation with NWS/NOAA), data usage terms for third-party APIs, open-source license selection, GDPR/privacy considerations for location data and push subscriptions |
| **My shadow** | Incident Response | Monitoring plan for the deployed service, on-call runbook for outages, E.S.T.O.P. activation/deactivation procedures, incident logging |
| **The voices in my head** | QA & Pentesting Team | Test plan authoring, writing automated tests (`tests/`), manual regression testing of all 15 slides, cross-browser and cross-device testing, penetration testing of the admin panel and API endpoints |
| **Reflection in my coffee** | Database Admin | `localStorage` schema design, server-side in-memory store for announcements/subscriptions, data retention policies, performance of data access patterns |
| **Past version of me** | Legacy Support | Ensuring backward compatibility with older browser versions, maintaining the Cloudflare Pages function adapter (`functions/api/[[route]].js`), documenting "why is this code like this" for future maintainers |
| **My family and friends** | Stress Testers | Real-world usability testing, reporting confusing UX, accidentally finding bugs in unusual screen sizes and browsers, providing unsolicited opinions about the color scheme |
| **My computer** | "It Works on My Machine" Solver | Running the dev server, being the canonical reference environment, serving as proof that the app works at least once, building Docker images, and doing all the actual computational work |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla HTML5, CSS3, JavaScript (ES2022+) — no frameworks |
| **Backend** | Node.js + Express (Docker) / Cloudflare Pages Functions (serverless) |
| **Weather APIs** | NOAA/NWS (`api.weather.gov`), Open-Meteo (`api.open-meteo.com`, `archive-api.open-meteo.com`) |
| **Radar** | RainViewer API + Leaflet.js |
| **TTS** | Web Speech API (browser-native) |
| **Push** | Web Push (VAPID) via `web-push` npm package |
| **Audio** | HTML5 `<audio>` with server playlist + local folder picker |
| **Caching** | Service Worker (cache-first for app shell, network-first for APIs) |
| **Deployment** | Docker + nginx, or Cloudflare Pages |

---

## Out of Scope (Initial Release)

- No user accounts or multi-user roles beyond a single admin password
- No paid/commercial API integrations
- No mobile app (PWA installability covers this use case)
- No historical storm archives
- This is not an official emergency alerting system and will never be marketed as one

---

> *"It works on my computer" — My Computer, Lead Engineer*
