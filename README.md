# S.H.E.L.L.Y 🌤

A modern, real-time weather client inspired by WeatherStar 4000. Vanilla HTML/CSS/JS, NOAA weather data, RainViewer animated radar, background music with TTS ducking, severe weather alerts, and a full admin control panel.

---
> ⚠️ **Disclaimer:** S.H.E.L.L.Y. is an **unofficial**, hobbyist weather display project. It is **not** affiliated with, endorsed by, or a replacement for the National Weather Service (NWS), NOAA, or any official emergency management agency. **Do not rely solely on S.H.E.L.L.Y. for life-safety decisions.** Always monitor official sources (weather.gov, your local NWS office, Wireless Emergency Alerts, NOAA Weather Radio, and local emergency management) during severe weather or other emergencies. The admin E.S.T.O.P. mode is intended for informational display purposes only and is **not** a substitute for official emergency alert systems (EAS/WEA).

---
## ✨ Features

- Live NOAA/NWS weather + Open-Meteo data — no API key required
- **15 weather slides:** Current Conditions, Detailed Observations, Hourly, Extended, Precipitation Chart, Almanac, Air Quality, Pollen, Travel Forecast, Regional Observations, Regional Forecast, SPC Outlook, Radar, Severe Alerts, Custom Forecast
- RainViewer animated radar (6 frames, auto-refresh)
- Background music — server playlist auto-loaded, local folder picker fallback
- Text-to-speech severe weather alerts with audio ducking
- **Admin panel** — push info/warning/emergency banners or full-screen popups to every display
- **Release Notes** — post versioned changelogs visible in the admin panel
- **Custom Forecast** — publish a hand-crafted forecast slide targeted by map area, ZIP code, or county
- **SPC Outlook** — Days 1–3 categorical severe weather risk polygons from NOAA
- **Push notifications** — subscribe on any device, receive alerts even in the background
- **PWA** — installable on iOS, Android, and desktop; works offline with last-loaded data cached
- **Automatic cache busting** — app always loads the latest code after a deploy, no manual cache clearing needed
- Multiple themes, kiosk/fullscreen mode, keyboard navigation, permalink sharing

---

## 🔒 Security Features

S.H.E.L.L.Y. includes several layered defenses that demonstrate common web-application security concepts.

### HTTP Security Headers

Every response is sent with a hardened set of headers:

| Header | Value / Purpose |
|--------|----------------|
| `Content-Security-Policy` | Allow-lists all script, style, font, image, and API connection sources; blocks resources from unlisted origins |
| `X-Frame-Options` | `SAMEORIGIN` — prevents clickjacking by blocking the page from being embedded in a foreign `<iframe>` |
| `X-Content-Type-Options` | `nosniff` — stops browsers from MIME-sniffing a response away from its declared Content-Type |
| `X-XSS-Protection` | `1; mode=block` — legacy IE/Edge XSS auditor safety net |
| `Referrer-Policy` | `strict-origin-when-cross-origin` — limits referer leakage to cross-origin requests |
| `Permissions-Policy` | Disables camera, microphone, and payment APIs; restricts geolocation to this origin to support location-based weather features |
| `Strict-Transport-Security` | 1-year HSTS; effective when served over TLS/HTTPS |

### Rate Limiting

Admin API routes are protected by a per-IP rate limiter (60 requests per minute) via `express-rate-limit`.  
Responses include standard `RateLimit-*` headers so clients can see their remaining quota.  
Exceeding the limit returns **HTTP 429** with a descriptive JSON error.

### Brute-Force / Account-Lockout Protection

Admin authentication routes track failed password attempts per source IP.  
After **5 consecutive failures** the IP is **locked out for 15 minutes** and every subsequent request returns HTTP 429 with a `Retry-After` header.  
A successful login resets the counter. Idle entries are periodically evicted to prevent unbounded memory growth.

> **Behind a proxy / Cloudflare Tunnel:** Set the `TRUST_PROXY=1` environment variable so `express` resolves the real client IP instead of the container/proxy address.

### Security Event Logging

All notable security events are captured in an in-memory ring buffer (last 500 events) and tagged with a timestamp, source IP, path, user-agent, and event type:

| Event type | Meaning |
|------------|---------|
| `auth_success` | Admin password accepted (login only) |
| `auth_failure` | Wrong password provided |
| `lockout` | IP locked out after repeated failures |
| `rate_limited` | Request rejected by the rate limiter |
| `honeypot` | Request hit the honeypot endpoint |

Events are visible in the **Admin Panel → 🔒 Security Log** section (auto-refreshes every 30 s).

### Honeypot Endpoint

`/api/admin-backdoor` is a **honeypot** — a path that looks attractive to automated scanners but serves no legitimate function.  
Any hit is immediately logged as a `honeypot` event, making it easy to spot port-scans, vulnerability probes, and poorly-written bots.

### Security API Endpoints (admin-only)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/security/events?limit=N` | Returns the last N security events |
| `GET` | `/api/security/stats` | Returns event-type counts and currently-locked IPs |
| **Location Targeting** | Restrict who sees the message: all viewers, map radius, ZIP codes, or counties |
| **Security** | Password set via `ADMIN_PASSWORD` env var |

### 🛑 E.S.T.O.P. (Exigent Site Take-down Operational Procedure)

Push a system-wide, **undismissable** full-screen alert to every connected display instantly. Viewers cannot close it — only the admin can deactivate it. An EAS-style alarm sound plays on all displays and background music is automatically paused when E.S.T.O.P. is activated.

#### Emergency types

Nine preset types each provide a unique colour palette, icon, and default title:

| Preset | Icon | Colour |
|--------|------|--------|
| Tornado Warning | 🌪️ | Red |
| Hurricane Warning | 🌀 | Purple |
| Flash Flood Warning | 🌊 | Blue |
| Wildfire Emergency | 🔥 | Orange |
| Winter Storm Warning | ❄️ | Icy blue |
| Severe Thunderstorm | ⛈️ | Amber |
| Nuclear Alert | ☢️ | Red |
| Civil Emergency | 📻 | Orange |
| Custom | 🚨 | Red (user-defined title) |

#### Extra options

| Option | Details |
|--------|---------|
| **Title** | Optional headline, pre-filled from the preset (editable) |
| **Message** | Supports Markdown |
| **Auto-deactivate** | Choose Manual, 5 / 15 / 30 / 60 / 120 minutes — a live countdown appears on the overlay and the admin status bar |
| **Push notify** | Simultaneously push-notify all subscribed devices when activating |
| **Confirmation modal** | A full-screen confirmation dialog shows a preview of the type, title, message, and expiry before activating — prevents accidental activation |

