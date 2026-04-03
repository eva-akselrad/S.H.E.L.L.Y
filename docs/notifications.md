# 🔔 Push Notifications

S.H.E.L.L.Y. supports Web Push notifications so every subscribed device receives alerts even when the app is in the background or the screen is off.

---

## Overview

| Feature | Details |
|---------|---------|
| **Admin alerts** | Receive banners, popups, and E.S.T.O.P. emergencies as push notifications |
| **Daily weather summary** | Optional morning (or any-time) weather digest for your saved location |
| **PWA startup prompt** | When installed as a PWA, you are asked once at startup |
| **Subscriber management** | Admin panel shows subscriber count and can clear all subscriptions |

---

## Setup — Docker

### 1 · Generate VAPID keys (one-time)

VAPID keys authenticate your server to the browser push service. Run this once locally and save the output:

```bash
npx web-push generate-vapid-keys
```

### 2 · Set environment variables

Edit your `docker-compose.yml` or `.env` file:

```yaml
environment:
  - VAPID_PUBLIC_KEY=BYour64CharPublicKey...
  - VAPID_PRIVATE_KEY=your-private-key
  - VAPID_EMAIL=mailto:you@example.com
```

> **Why this matters:** If you do *not* set these, the server auto-generates keys on first run and saves them to `.vapid-keys.json`. This works fine for a single container, but all subscriptions are invalidated if the container is ever recreated (the keys change). Setting them as environment variables ensures keys (and subscriptions) survive rebuilds.

### 3 · Persist subscriptions

Subscriptions are saved to `.push-subscriptions.json` in the project root (gitignored). To survive container restarts, make sure your `docker-compose.yml` mounts a persistent volume for the project directory, or back up this file separately.

### 4 · Rebuild and start

```bash
docker compose up -d --build
```

---

## Setup — Cloudflare Pages (Serverless)

### 1 · Generate VAPID keys

```bash
npx web-push generate-vapid-keys
```

### 2 · Add environment variables

In the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages → your project → Settings → Environment variables (Production)**:

| Name                | Value                           |
|---------------------|---------------------------------|
| `VAPID_PUBLIC_KEY`  | `BExamplePublicKey...`         |
| `VAPID_PRIVATE_KEY` | `your-private-key`             |
| `VAPID_EMAIL`       | `mailto:you@example.com`       |

> **Keep `VAPID_PRIVATE_KEY` secret** — only set it in the Cloudflare dashboard, never commit it to your repo.

### 3 · Redeploy

Trigger a new deploy after setting the variables (push a commit or use **Deployments → Retry deploy**).

Subscriptions are stored in **Cloudflare KV** and survive redeployments.

> **Note:** Push notification payload encryption requires additional Web Crypto work beyond VAPID signing. In some browsers, notifications may arrive without a body — the title and badge will always show. For fully encrypted payloads, use the Docker + `web-push` npm route.

---

## User Setup (Subscriber)

### On a PWA (installed app)

1. Install S.H.E.L.L.Y. to your home screen (tap the install banner or use your browser's "Add to Home Screen" option).
2. On first launch as a PWA, a prompt will appear asking if you want to enable notifications.
3. Tap **🔔 Enable Notifications** and allow when the browser asks.

> If you tapped **No thanks**, you can still enable notifications manually via **Settings → 🔔 Push Notifications → Enable Notifications**.

### On a desktop browser

1. Open the **Settings** panel (☰ button).
2. Scroll to **🔔 Push Notifications**.
3. Click **🔔 Enable Notifications** and allow when prompted.

### Notification options

Once subscribed, the Settings panel shows additional options:

| Option | Default | Description |
|--------|---------|-------------|
| **Weather & admin alerts** | On | Receive push notifications when the admin sends announcements or E.S.T.O.P. alerts |
| **Daily weather summary** | Off | Receive a morning weather digest for your saved location |
| **Summary time** | 8:00 AM | Choose what local time you receive your daily summary |

---

## Daily Weather Summary

When **Daily weather summary** is enabled, the server sends a push notification at your chosen local time each day containing:

- Current conditions (temperature + weather description)
- Today's high and low
- Rain chance (shown when ≥ 20%)

The summary is fetched from [Open-Meteo](https://open-meteo.com/) and uses your saved location.

**Example notification:**

> 🌤 **Daily Weather – Austin, TX**  
> Clear skies ☀️ · 68°F now · High 84° / Low 61° · 💧 30% chance of rain

### Time zone handling

The delivery time is converted to UTC using your device's timezone offset, which is sent to the server when you subscribe. The server checks every minute and sends summaries within a 5-minute window of the target hour.

---

## Admin Controls

In the admin panel (`/admin.html`) → **Push Notifications** card:

| Control | Description |
|---------|-------------|
| **Subscriber count** | Shows how many devices are currently subscribed |
| **Send Test Push** | Sends a test notification to all subscribed devices immediately |
| **Clear All Subscriptions** | Removes all push subscriptions — devices must re-subscribe |

To send a push notification alongside an admin announcement, check the **📲 Also send push notification** box when posting a message.

---

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/push/vapid-key` | GET | No | Get the server's public VAPID key |
| `/api/push/subscribe` | POST | No | Register a push subscription (requires `endpoint`, `keys.auth`, `keys.p256dh`) |
| `/api/push/subscribe` | DELETE | No | Unsubscribe a push endpoint |
| `/api/push/prefs` | PUT | No | Update notification preferences for a subscription |
| `/api/push/count` | GET | ✅ | Count active push subscribers |
| `/api/push/send` | POST | ✅ | Send a test push to all subscribers |
| `/api/push/clear` | DELETE | ✅ | Remove all push subscriptions |

✅ = requires `X-Admin-Password` header or `password` in request body.

---

## Troubleshooting

### "0 sent, 1 failed" in admin console

| Cause | Fix |
|-------|-----|
| **Server restarted and subscriptions were lost** | Subscriptions now persist to `.push-subscriptions.json`. If VAPID keys change (e.g. container recreated), all existing subscriptions become invalid — devices must re-subscribe. Set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env vars to avoid this. |
| **Subscription keys missing (auth/p256dh)** | The server now rejects subscriptions without keys. Have the user unsubscribe and re-subscribe from the Settings panel to get a fresh valid subscription. |
| **Stale 410/404 subscriptions** | The server automatically removes subscriptions that return 410 (Gone) or 404 (Not Found). No action needed. |

### Notifications not appearing on iOS

- Push notifications require iOS 16.4+ and the app must be **installed as a PWA** (Add to Home Screen). Safari in a browser tab does not support push on iOS.
- Go to **Settings (iOS) → [App Name] → Notifications** and ensure notifications are enabled for the app.

### Permission is "denied" in the browser

If you previously blocked notifications in the browser:

**Chrome/Android:**
1. Open Chrome → tap the lock icon in the address bar → **Site settings** → **Notifications** → **Allow**.

**Safari/iOS:**
1. Open **Settings → Safari → Advanced → Website Data** and remove the site, then revisit and subscribe again.
2. Or: **Settings → [App Name] → Notifications** → enable.

**Firefox (desktop):**
1. Open Firefox → click the lock icon → **Connection secure** → **More information** → **Permissions** → reset **Receive Notifications**.

### Daily weather summary not arriving

1. Make sure **Daily weather summary** is toggled on in **Settings → Push Notifications**.
2. Check that your location is saved (search bar shows a city name).
3. Verify the time you set — it uses your **local time** based on the timezone of your device when you subscribed.
4. The server only fires summaries within the first 5 minutes of each hour. Wait up to 65 minutes after changing the time.
5. If summaries still don't arrive, try unsubscribing and re-subscribing from the Settings panel to refresh your timezone offset.

### Push notification prompt doesn't appear on startup

The prompt only shows:
- When running as an **installed PWA** (not in a browser tab)
- If notification permission is still **undecided** (not previously granted or denied)
- If you have not already clicked "No thanks" in a previous session

To re-trigger: clear the site's `localStorage` (DevTools → Application → Local Storage → delete `shelly-push-declined`) or uninstall and reinstall the PWA.

### VAPID key errors in server logs

```
[Push] Send error (401): Unauthorized – VAPID signature
```

This means the VAPID keys in the server no longer match what was used when the subscription was created. This happens when:
- The container was recreated without persistent VAPID env vars
- The `.vapid-keys.json` file was deleted

**Fix:** Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` as environment variables (generate with `npx web-push generate-vapid-keys`), then have all users re-subscribe.
