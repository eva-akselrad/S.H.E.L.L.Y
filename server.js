/* ════════════════════════════════════════════════════════════════
   server.js – WeatherNow Express backend
   Serves static files + admin announcement API + Web Push
   ════════════════════════════════════════════════════════════════ */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const webPush = require('web-push');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.json());

const server = http.createServer(app);

// ── Build hash (automatic cache busting) ───────────────────────
// Hash all local JS, CSS, and HTML files so that any code change
// produces a new CACHE_VERSION in the service worker, forcing the
// browser to install the new SW and discard stale cached assets.
function computeBuildHash() {
    const hash = crypto.createHash('sha256');
    for (const sub of ['js', 'css']) {
        try {
            const dir = path.join(__dirname, sub);
            fs.readdirSync(dir)
                .filter(f => f.endsWith(`.${sub}`))
                .sort()
                .forEach(f => hash.update(fs.readFileSync(path.join(dir, f))));
        } catch { /* skip if directory missing */ }
    }
    for (const f of ['index.html', 'admin.html']) {
        try { hash.update(fs.readFileSync(path.join(__dirname, f))); } catch { /* skip */ }
    }
    return hash.digest('hex').slice(0, 8);
}

const BUILD_HASH = computeBuildHash();
console.log(`[Server] Build hash: ${BUILD_HASH}`);

// Pre-process sw.js once: replace the hardcoded CACHE_VERSION with
// the computed hash so it changes automatically on every deploy.
const SW_CONTENT = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8')
    .replace(/const CACHE_VERSION = ['"`][^'"`]*['"`]/, `const CACHE_VERSION = 'shelly-${BUILD_HASH}'`);

// ── Service worker (dynamic, must be before express.static) ────
// Served as a route so the injected CACHE_VERSION is always fresh.
app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Content-Type', 'application/javascript');
    res.send(SW_CONTENT);
});

// ── Static files ───────────────────────────────────────────────
app.use(express.static(__dirname, {
    setHeaders(res, filePath) {
        if (filePath.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
        if (filePath.endsWith('.ogg')) res.setHeader('Content-Type', 'audio/ogg');
        if (filePath.endsWith('.flac')) res.setHeader('Content-Type', 'audio/flac');
        if (filePath.endsWith('.m4a')) res.setHeader('Content-Type', 'audio/mp4');
        // HTML pages must never be served stale so the browser always
        // gets the latest markup (and triggers a SW update check).
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
        res.setHeader('Accept-Ranges', 'bytes');
    }
}));

// ── VAPID key management ────────────────────────────────────────
const VAPID_FILE = path.join(__dirname, '.vapid-keys.json');

function loadOrGenerateVapidKeys() {
    // Check env vars first
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        return {
            publicKey: process.env.VAPID_PUBLIC_KEY,
            privateKey: process.env.VAPID_PRIVATE_KEY
        };
    }
    // Load from persisted file
    if (fs.existsSync(VAPID_FILE)) {
        try { return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')); } catch { /* fall through */ }
    }
    // Generate new keys and persist them
    const keys = webPush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
    console.log('[Push] Generated new VAPID keys → .vapid-keys.json');
    return keys;
}

const vapidKeys = loadOrGenerateVapidKeys();
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@shelly.local';

webPush.setVapidDetails(VAPID_EMAIL, vapidKeys.publicKey, vapidKeys.privateKey);

// ── In-memory stores ────────────────────────────────────────────
let messages = [];
let nextId = 1;
let pushSubscriptions = []; // { endpoint, keys: { auth, p256dh } }

let releaseNotes = [];
let releaseNoteId = 1;

let customForecasts = [];  // array of { id, label, periods, targeting, updatedAt }
let customForecastId = 1;

// Armageddon mode – when set, overrides the entire display with a single message
// Shape: { title, text, type, activatedAt, expiresAt } or null when inactive
let armageddonState = null;

// Acknowledgements: tracks which visitor IDs have acknowledged each message
// Map<msgId, Set<visitorId>>
const acknowledgements = new Map();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'weathernow';

// ── Rate limiter (admin routes) ────────────────────────────────
const adminLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' }
});
app.use('/api/verify', adminLimiter);
app.use('/api/announce', adminLimiter);
app.use('/api/messages', adminLimiter);
app.use('/api/push', adminLimiter);
app.use('/api/release-notes', adminLimiter);

// ── Auth helper ────────────────────────────────────────────────
function checkAuth(req, res) {
    const provided = req.headers['x-admin-password'] || req.body?.password;
    if (provided !== ADMIN_PASSWORD) {
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }
    return true;
}

// ── GET /api/messages?since=ID ─────────────────────────────────
app.get('/api/messages', (req, res) => {
    const since = parseInt(req.query.since) || 0;
    res.json(messages.filter(m => m.id > since).map(m => ({
        ...m,
        ackCount: acknowledgements.get(m.id)?.size || 0,
    })));
});

// ── GET /api/poll?since=ID ─────────────────────────────────────
// Combined endpoint: returns messages + armageddon state in one request
app.get('/api/poll', (req, res) => {
    const since = parseInt(req.query.since) || 0;
    if (armageddonState?.expiresAt && Date.now() > armageddonState.expiresAt) {
        armageddonState = null;
        console.log('[Admin] Armageddon mode auto-expired');
    }
    res.set('Cache-Control', 'no-store');
    res.json({
        messages: messages.filter(m => m.id > since),
        armageddon: armageddonState ? { active: true, ...armageddonState } : { active: false },
    });
});

// ── GET /api/verify ────────────────────────────────────────────
app.get('/api/verify', (req, res) => {
    if (!checkAuth(req, res)) return;
    res.json({ ok: true });
});

// ── POST /api/announce ─────────────────────────────────────────
// Body: { password, text, type, display, duration, title, tts, push, targeting }
app.post('/api/announce', async (req, res) => {
    if (!checkAuth(req, res)) return;
    const { text, type = 'info', display = 'banner', duration = 0, title = '', tts = false, push = false, targeting = { mode: 'all' } } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });

    const msg = {
        id: nextId++,
        text: text.trim(),
        title: title.trim(),
        type,
        display,
        duration,
        tts: !!tts,
        push: !!push,
        targeting,
        created: Date.now()
    };
    messages.push(msg);
    console.log(`[Admin] New ${type} ${display}: ${text.slice(0, 80)}`);

    // Fan-out push notification if requested
    if (push && pushSubscriptions.length > 0) {
        const payload = JSON.stringify({
            title: title.trim() || `S.H.E.L.L.Y. ${type.charAt(0).toUpperCase() + type.slice(1)}`,
            body: text.trim(),
            type,
            tag: `announce-${msg.id}`,
            url: '/'
        });
        await fanOutPush(payload);
    }

    res.json(msg);
});

// ── POST /api/messages/:id/acknowledge ────────────────────────
// Public – no admin auth required. Body: { visitorId: string }
app.post('/api/messages/:id/acknowledge', (req, res) => {
    const id = parseInt(req.params.id);
    const { visitorId } = req.body;
    if (!visitorId || typeof visitorId !== 'string' || visitorId.length > 128 || !/^[\w\-]+$/.test(visitorId)) {
        return res.status(400).json({ error: 'visitorId required' });
    }
    if (!messages.find(m => m.id === id)) return res.status(404).json({ error: 'not found' });
    if (!acknowledgements.has(id)) acknowledgements.set(id, new Set());
    acknowledgements.get(id).add(visitorId);
    const ackCount = acknowledgements.get(id).size;
    console.log(`[Ack] Message ${id}: ${ackCount} acknowledged`);
    res.json({ ok: true, ackCount });
});

// ── DELETE /api/messages/:id ───────────────────────────────────
app.delete('/api/messages/:id', (req, res) => {
    if (!checkAuth(req, res)) return;
    const id = parseInt(req.params.id);
    messages = messages.filter(m => m.id !== id);
    acknowledgements.delete(id);
    res.json({ ok: true });
});

// ── DELETE /api/messages ───────────────────────────────────────
app.delete('/api/messages', (req, res) => {
    if (!checkAuth(req, res)) return;
    messages = [];
    acknowledgements.clear();
    res.json({ ok: true });
});

// ── GET /api/armageddon ────────────────────────────────────────
// Public – display clients poll this to check override state
app.get('/api/armageddon', (req, res) => {
    if (armageddonState?.expiresAt && Date.now() > armageddonState.expiresAt) {
        armageddonState = null;
        console.log('[Admin] Armageddon mode auto-expired');
    }
    res.json(armageddonState ? { active: true, ...armageddonState } : { active: false });
});

// ── POST /api/armageddon ───────────────────────────────────────
// Body: { title, text, type, duration }  duration = minutes (0 = manual)
app.post('/api/armageddon', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const { title = '', text, type = 'emergency', duration = 0 } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });
    const durationMs = Math.max(0, parseInt(duration) || 0) * 60 * 1000;
    armageddonState = {
        title: title.trim(), text: text.trim(), type,
        activatedAt: Date.now(),
        expiresAt: durationMs > 0 ? Date.now() + durationMs : null,
    };
    console.log('[Admin] Armageddon mode ACTIVATED');
    res.json({ ok: true, ...armageddonState });
});

// ── DELETE /api/armageddon ─────────────────────────────────────
app.delete('/api/armageddon', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    armageddonState = null;
    console.log('[Admin] Armageddon mode deactivated');
    res.json({ ok: true });
});

// ── GET /api/push/vapid-key ─────────────────────────────────────
app.get('/api/push/vapid-key', (_, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
});
app.get('/api/push/count', (req, res) => {
    if (!checkAuth(req, res)) return;
    res.json({ count: pushSubscriptions.length });
});

// ── POST /api/push/subscribe ────────────────────────────────────
app.post('/api/push/subscribe', (req, res) => {
    const sub = req.body;
    if (!sub?.endpoint) return res.status(400).json({ error: 'invalid subscription' });
    // Upsert by endpoint
    const existing = pushSubscriptions.findIndex(s => s.endpoint === sub.endpoint);
    if (existing >= 0) {
        pushSubscriptions[existing] = sub;
    } else {
        pushSubscriptions.push(sub);
    }
    console.log(`[Push] Subscribed: ${pushSubscriptions.length} total`);
    res.json({ ok: true, total: pushSubscriptions.length });
});

// ── DELETE /api/push/subscribe ─────────────────────────────────
app.delete('/api/push/subscribe', (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== endpoint);
    console.log(`[Push] Unsubscribed: ${pushSubscriptions.length} remaining`);
    res.json({ ok: true, total: pushSubscriptions.length });
});

// ── POST /api/push/send (admin test) ──────────────────────────
app.post('/api/push/send', async (req, res) => {
    if (!checkAuth(req, res)) return;
    const { title = 'S.H.E.L.L.Y. Test', body = 'Push notifications are working! 🌤', type = 'info' } = req.body;
    const payload = JSON.stringify({ title, body, type, tag: 'test-push', url: '/' });
    const results = await fanOutPush(payload);
    res.json({ sent: results.sent, failed: results.failed, total: results.total });
});

// ── Fan-out helper ─────────────────────────────────────────────
async function fanOutPush(payload) {
    let sent = 0, failed = 0;
    const stale = [];

    await Promise.all(pushSubscriptions.map(async sub => {
        try {
            await webPush.sendNotification(sub, payload);
            sent++;
        } catch (err) {
            failed++;
            // 410 Gone = subscription is expired/unsubscribed
            if (err.statusCode === 410 || err.statusCode === 404) stale.push(sub.endpoint);
            else console.warn('[Push] Send error:', err.message);
        }
    }));

    // Remove stale subscriptions
    if (stale.length) {
        pushSubscriptions = pushSubscriptions.filter(s => !stale.includes(s.endpoint));
        console.log(`[Push] Removed ${stale.length} stale subscription(s)`);
    }

    console.log(`[Push] Fan-out: ${sent} sent, ${failed} failed / ${pushSubscriptions.length} active`);
    return { sent, failed, total: pushSubscriptions.length };
}

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({
    ok: true,
    uptime: process.uptime(),
    pushSubscribers: pushSubscriptions.length
}));

// ── Release Notes ─────────────────────────────────────────────
app.get('/api/release-notes', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    res.json(releaseNotes);
});

app.post('/api/release-notes', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const { version = '', notes = '' } = req.body;
    if (!notes.trim()) return res.status(400).json({ error: 'notes required' });
    const note = { id: releaseNoteId++, version: version.trim(), notes: notes.trim(), created: Date.now() };
    releaseNotes.unshift(note);
    console.log(`[Admin] Release note posted: ${version}`);
    res.json(note);
});

app.delete('/api/release-notes/:id', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    releaseNotes = releaseNotes.filter(n => n.id !== parseInt(req.params.id));
    res.json({ ok: true });
});

app.delete('/api/release-notes', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    releaseNotes = [];
    res.json({ ok: true });
});

// ── Custom Forecast ───────────────────────────────────────────
// Returns array of all custom forecasts
app.get('/api/custom-forecast', (_, res) => {
    // Short public cache — display clients refresh every 10 min anyway.
    // Use stale-while-revalidate so the browser reuses the cached response.
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(customForecasts);
});

// Add a new forecast (or replace one with same label if label provided)
app.post('/api/custom-forecast', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const { periods = [], targeting = { mode: 'all' }, label: rawLabel = '' } = req.body;
    const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
    if (!periods.length) return res.status(400).json({ error: 'periods required' });
    // If a non-empty label is given and a forecast with that label already exists, replace it
    const existing = label ? customForecasts.findIndex(c => c.label === label) : -1;
    const entry = { id: existing >= 0 ? customForecasts[existing].id : customForecastId++, label, periods, targeting, updatedAt: Date.now() };
    if (existing >= 0) {
        customForecasts[existing] = entry;
    } else {
        customForecasts.push(entry);
    }
    console.log(`[Admin] Custom forecast ${existing >= 0 ? 'updated' : 'added'}: "${label || entry.id}" — ${periods.length} period(s), targeting: ${targeting.mode}`);
    res.json(entry);
});

// Delete a single forecast by id
app.delete('/api/custom-forecast/:id', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const id = parseInt(req.params.id, 10);
    const before = customForecasts.length;
    customForecasts = customForecasts.filter(c => c.id !== id);
    if (customForecasts.length === before) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
});

// Delete all forecasts
app.delete('/api/custom-forecast', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    customForecasts = [];
    res.json({ ok: true });
});

// ── GET /api/spc-outlook?day=1|2|3 ───────────────────────────
// Proxies SPC categorical outlook GeoJSON to avoid browser CORS restrictions.
// In-memory TTL cache (15 min) so repeated client refreshes don't hammer SPC.
// The cache is permanently bounded to 3 entries (days 1, 2, 3) — no cleanup needed.
const spcCache = {}; // { [day]: { data, expiresAt } }
const SPC_TTL_MS = 15 * 60 * 1000;

app.get('/api/spc-outlook', async (req, res) => {
    const day = req.query.day || '1';
    const validFiles = {
        '1': 'day1otlk_cat.nolyr.geojson',
        '2': 'day2otlk_cat.nolyr.geojson',
        '3': 'day3otlk_cat.nolyr.geojson',
    };
    const file = validFiles[day];
    if (!file) return res.status(400).json({ error: 'Invalid day parameter. Use 1, 2, or 3.' });

    // Serve from cache if fresh
    const cached = spcCache[day];
    if (cached && Date.now() < cached.expiresAt) {
        res.setHeader('Cache-Control', 'public, max-age=900');
        return res.json(cached.data);
    }

    const url = `https://www.spc.noaa.gov/products/outlook/${file}`;
    try {
        const upstream = await fetch(url, {
            headers: { 'User-Agent': 'S.H.E.L.L.Y.-WeatherClient/1.0 (weather display)' },
            signal: AbortSignal.timeout(10000),
        });
        if (!upstream.ok) {
            // On upstream error, serve stale cache if available
            if (cached) {
                res.setHeader('Cache-Control', 'public, max-age=900');
                return res.json(cached.data);
            }
            return res.status(502).json({ error: `SPC returned ${upstream.status}` });
        }
        const data = await upstream.json();
        spcCache[day] = { data, expiresAt: Date.now() + SPC_TTL_MS };
        res.setHeader('Cache-Control', 'public, max-age=900');
        res.json(data);
    } catch (err) {
        console.error('[SPC] Proxy error:', err.message);
        // Serve stale cache rather than returning an error
        if (cached) {
            res.setHeader('Cache-Control', 'public, max-age=900');
            return res.json(cached.data);
        }
        res.status(502).json({ error: 'Failed to fetch SPC outlook data' });
    }
});

// ════════════════════════════════════════════════════════════════
//  STREAMING OVERLAY / DASHBOARD SYSTEM
//  WebSocket-based real-time communication between the streamer
//  control dashboard and the live OBS Browser Source displays.
// ════════════════════════════════════════════════════════════════

// ── Stream State ───────────────────────────────────────────────
// Single source of truth for what the stream display is showing.
let streamState = {
    radar:      { region: 'national', lat: null, lon: null, zoom: 5, animation: true, animSpeed: 600, opacity: 0.65 },
    mode:       'radar',          // 'radar' | 'forecast' | 'alerts' | 'cities'
    lowerThird: { visible: false, text: '', style: 'info' },
    alert:      { active: false, type: 'info', headline: '', county: '', expires: null },
    forecast:   { visible: false, location: '', lat: null, lon: null },
    ticker:     { visible: true, custom: '' },
    autoFocus:  true,  // auto-pan map to new warning polygons
    autoTTS:    true,  // TTS reads new NWS warnings aloud
    autoBanner: true,  // show non-disruptive banner for new warnings
    polygonVisibility: {
        tornado: true, storm: true, flood: true, fire: true,
        advisory: true, watch: true,
    },
};

// ── Cached NWS alerts (polled server-side every 2 min) ─────────
let cachedNwsAlerts = [];
let nwsAlertError   = null;
let lastSeenAlertIds = new Set(); // for diffing new vs. known alerts
const NWS_POLL_ZONE = process.env.NWS_POLL_ZONE || ''; // e.g. "TXC113" or leave blank for national
const NWS_POLL_MS   = 2 * 60 * 1000; // 2 minutes

// Alert types that trigger auto-focus, auto-TTS, and auto-banner
const AUTO_ALERT_EVENTS = [
    'tornado warning', 'severe thunderstorm warning', 'flash flood warning',
    'tornado emergency', 'particularly dangerous situation',
    'flash flood emergency', 'fire weather watch', 'red flag warning',
];

function alertCategory(event) {
    const e = (event || '').toLowerCase();
    if (e.includes('tornado'))             return 'tornado';
    if (e.includes('thunderstorm'))        return 'storm';
    if (e.includes('flash flood'))         return 'flood';
    if (e.includes('fire') || e.includes('red flag')) return 'fire';
    if (e.includes('watch'))               return 'watch';
    if (e.includes('advisory'))            return 'advisory';
    return 'advisory';
}

async function pollNwsAlerts() {
    const url  = NWS_POLL_ZONE
        ? `https://api.weather.gov/alerts/active?zone=${encodeURIComponent(NWS_POLL_ZONE)}`
        : 'https://api.weather.gov/alerts/active?status=actual&message_type=alert&urgency=Immediate,Expected&certainty=Observed,Likely&severity=Extreme,Severe';
    try {
        const r = await fetch(url, {
            headers: { 'User-Agent': 'S.H.E.L.L.Y./1.0 (streaming; github.com/eva-akselrad/S.H.E.L.L.Y)' },
            signal: AbortSignal.timeout(12000),
        });
        if (!r.ok) throw new Error(`NWS HTTP ${r.status}`);
        const json = await r.json();

        const features = (json.features || []).filter(f => f?.properties);

        cachedNwsAlerts = features.map(f => ({
            id:          f.id,
            event:       f.properties?.event    ?? '',
            headline:    f.properties?.headline ?? '',
            description: (f.properties?.description ?? '').slice(0, 2000),
            area:        f.properties?.areaDesc ?? '',
            severity:    f.properties?.severity ?? '',
            urgency:     f.properties?.urgency  ?? '',
            certainty:   f.properties?.certainty ?? '',
            expires:     f.properties?.expires  ?? null,
            sent:        f.properties?.sent     ?? null,
            category:    alertCategory(f.properties?.event),
            geometry:    f.geometry ?? null,  // GeoJSON polygon/multipolygon
        }));

        nwsAlertError = null;

        // ── Diff: find newly appeared alerts that merit auto-actions ──
        const currentIds  = new Set(cachedNwsAlerts.map(a => a.id));
        const newAlerts   = cachedNwsAlerts.filter(a =>
            !lastSeenAlertIds.has(a.id) &&
            AUTO_ALERT_EVENTS.some(e => a.event.toLowerCase().includes(e.replace(' warning','').replace(' emergency','')))
        );
        lastSeenAlertIds  = currentIds;

        // Push fresh alerts to all connected WebSocket clients
        broadcastToDisplays({ type: 'nws-alerts', alerts: cachedNwsAlerts });
        broadcastSSE({ type: 'nws-alerts', alerts: cachedNwsAlerts });

        // Push new-alert event so display can auto-focus/TTS/banner
        if (newAlerts.length > 0) {
            const newAlertMsg = { type: 'new-alerts', alerts: newAlerts };
            broadcastToDisplays(newAlertMsg);
            broadcastSSE(newAlertMsg);
            console.log(`[Stream] ${newAlerts.length} NEW alert(s):`, newAlerts.map(a => a.event).join(', '));
        }

    } catch (err) {
        nwsAlertError = err.message;
        console.warn('[Stream] NWS poll error:', err.message);
    }
}

// Poll immediately on startup, then every 2 minutes.
pollNwsAlerts();
setInterval(pollNwsAlerts, NWS_POLL_MS);

// ── WebSocket Server ───────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/api/stream/ws' });

// Track connected clients by role: 'display', 'dashboard', 'overlay'
const wsClients = new Set();

function broadcastToDisplays(msg) {
    const payload = JSON.stringify(msg);
    for (const client of wsClients) {
        if (client.readyState === 1 /* OPEN */ &&
            (client.role === 'display' || client.role === 'overlay')) {
            client.send(payload);
        }
    }
}

function broadcastToDashboards(msg) {
    const payload = JSON.stringify(msg);
    for (const client of wsClients) {
        if (client.readyState === 1 /* OPEN */ && client.role === 'dashboard') {
            client.send(payload);
        }
    }
}

wss.on('connection', (ws, req) => {
    ws.role = 'unknown';
    ws.isAlive = true;
    wsClients.add(ws);

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', rawData => {
        let msg;
        try { msg = JSON.parse(rawData.toString()); } catch { return; }

        if (msg.type === 'register') {
            const allowed = ['display', 'dashboard', 'overlay'];
            ws.role = allowed.includes(msg.role) ? msg.role : 'unknown';
            // Send current state to newly connected display/overlay clients
            if (ws.role === 'display' || ws.role === 'overlay') {
                ws.send(JSON.stringify({ type: 'state', state: streamState }));
                ws.send(JSON.stringify({ type: 'nws-alerts', alerts: cachedNwsAlerts }));
            }
            return;
        }

        // Heartbeat ping from client – reset alive flag
        if (msg.type === 'ping') {
            ws.isAlive = true;
            return;
        }

        // Display relays map-moved so dashboards can sync position
        if (msg.type === 'map-moved' && ws.role === 'display') {
            broadcastToDashboards({ type: 'map-moved', lat: msg.lat, lon: msg.lon, zoom: msg.zoom });
            return;
        }

        // Dashboard relays cursor-move so displays can show cursor
        if (msg.type === 'cursor-move' && ws.role === 'dashboard') {
            broadcastToDisplays({ type: 'cursor-move', lat: msg.lat, lon: msg.lon, visible: msg.visible });
            // Also broadcast via SSE for SSE clients if needed
            broadcastSSE({ type: 'cursor-move', lat: msg.lat, lon: msg.lon, visible: msg.visible });
            return;
        }

        // Only authenticated dashboards can send commands
        if (msg.type === 'command') {
            if (msg.password !== ADMIN_PASSWORD) {
                ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
                return;
            }
            applyStreamCommand(msg.action, msg.data || {});
            // Echo updated state back to all dashboards
            broadcastToDashboards({ type: 'state', state: streamState });
            return;
        }
    });

    ws.on('close', () => wsClients.delete(ws));
    ws.on('error', () => wsClients.delete(ws));
});

// Heartbeat – drop stale connections every 30 s
setInterval(() => {
    for (const ws of wsClients) {
        if (!ws.isAlive) { ws.terminate(); wsClients.delete(ws); continue; }
        ws.isAlive = false;
        ws.ping();
    }
}, 30000);

// ── Stream Command Handler ─────────────────────────────────────
function applyStreamCommand(action, data) {
    switch (action) {
        case 'set-radar':
            streamState.radar = { ...streamState.radar, ...data };
            streamState.mode  = 'radar';
            break;
        case 'set-mode':
            if (['radar','forecast','alerts','cities'].includes(data.mode)) {
                streamState.mode = data.mode;
            }
            break;
        case 'set-lower-third':
            streamState.lowerThird = {
                visible: !!data.visible,
                text:    (data.text || '').slice(0, 200),
                style:   ['info','warning','alert','success'].includes(data.style) ? data.style : 'info',
            };
            break;
        case 'trigger-alert':
            streamState.alert = {
                active:   true,
                type:     ['tornado','storm','flood','fire','emergency','info'].includes(data.type) ? data.type : 'info',
                headline: (data.headline || '').slice(0, 200),
                county:   (data.county || '').slice(0, 100),
                expires:  data.expires || null,
            };
            break;
        case 'clear-alert':
            streamState.alert = { active: false, type: 'info', headline: '', county: '', expires: null };
            break;
        case 'toggle-ticker':
            streamState.ticker.visible = data.visible !== undefined ? !!data.visible : !streamState.ticker.visible;
            if (data.custom !== undefined) streamState.ticker.custom = (data.custom || '').slice(0, 500);
            break;
        case 'set-forecast':
            streamState.forecast = {
                visible:  !!data.visible,
                location: (data.location || '').slice(0, 100),
                lat:      typeof data.lat === 'number' ? data.lat : null,
                lon:      typeof data.lon === 'number' ? data.lon : null,
            };
            if (data.visible) streamState.mode = 'forecast';
            break;
        case 'toggle-overlay':
            // Relay direct instruction to all display clients (no state change needed)
            broadcastToDisplays({ type: 'overlay-toggle', overlay: data.overlay, visible: !!data.visible });
            return; // skip the normal broadcastToDashboards state below
        case 'trigger-tts':
            // Ephemeral – broadcast directly without state change
            broadcastToDisplays({ type: 'tts', ...data });
            broadcastSSE({ type: 'tts', ...data });
            console.log(`[Stream] TTS triggered (WS):`, (data.text || '').slice(0, 60));
            return; // skip second broadcast below
        case 'trigger-sound':
            // Ephemeral – broadcast directly without state change
            broadcastToDisplays({ type: 'sound', sound: data.sound, volume: data.volume ?? 0.8 });
            broadcastSSE({ type: 'sound', sound: data.sound, volume: data.volume ?? 0.8 });
            console.log(`[Stream] Sound triggered (WS):`, data.sound);
            return;
        // ── New commands ────────────────────────────────────────
        case 'set-auto-focus':
            streamState.autoFocus = !!data.enabled;
            break;
        case 'set-auto-tts':
            streamState.autoTTS = !!data.enabled;
            break;
        case 'set-auto-banner':
            streamState.autoBanner = !!data.enabled;
            break;
        case 'set-polygon-visibility':
            if (data.type && data.type in streamState.polygonVisibility) {
                streamState.polygonVisibility[data.type] = !!data.visible;
            }
            break;
        case 'set-anim-speed':
            streamState.radar.animSpeed = Math.min(Math.max(parseInt(data.speed) || 600, 100), 3000);
            break;
        case 'set-radar-opacity':
            streamState.radar.opacity = Math.min(Math.max(parseFloat(data.opacity) || 0.65, 0.1), 1.0);
            break;
        case 'focus-polygon': {
            // Ephemeral – tell display to pan to a specific alert by id or bbox
            const focusMsg = { type: 'focus-polygon', alertId: data.alertId, bbox: data.bbox };
            broadcastToDisplays(focusMsg);
            broadcastSSE(focusMsg);
            console.log(`[Stream] Focus polygon: alertId=${data.alertId}`);
            return;
        }
        case 'dismiss-banner':
            // Ephemeral – tell display to hide the alert banner
            broadcastToDisplays({ type: 'dismiss-banner' });
            return;
        default:
            return; // unknown action – don't broadcast
    }
    // Broadcast updated state to all display/overlay clients
    broadcastToDisplays({ type: 'state', state: streamState });
    broadcastSSE({ type: 'state', state: streamState });
    console.log(`[Stream] Command: ${action}`, data);
}

// ── SSE fallback (/api/stream/events) ─────────────────────────
const sseClients = new Set();

app.get('/api/stream/events', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx: disable proxy buffering

    // Send initial state immediately
    res.write(`data: ${JSON.stringify({ type: 'state', state: streamState })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'nws-alerts', alerts: cachedNwsAlerts })}\n\n`);

    const sendEvent = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
    res.sseEmit = sendEvent;
    sseClients.add(res);

    req.on('close', () => sseClients.delete(res));
});

function broadcastSSE(msg) {
    for (const res of sseClients) {
        try { res.sseEmit(msg); } catch { sseClients.delete(res); }
    }
}

// ── Stream Rate Limiter ────────────────────────────────────────
const streamLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
});

// ── GET /api/stream/state ─────────────────────────────────────
app.get('/api/stream/state', (_, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ state: streamState, alerts: cachedNwsAlerts });
});

// ── POST /api/stream/command ──────────────────────────────────
app.post('/api/stream/command', streamLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const { action, data = {} } = req.body;
    if (!action) return res.status(400).json({ error: 'action required' });
    applyStreamCommand(action, data);
    broadcastToDashboards({ type: 'state', state: streamState });
    broadcastSSE({ type: 'state', state: streamState });
    res.json({ ok: true, state: streamState });
});

// ── POST /api/stream/tts ──────────────────────────────────────
app.post('/api/stream/tts', streamLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const { text = '', voice = '', rate = 1, pitch = 1, volume = 1 } = req.body;
    if (!text.trim()) return res.status(400).json({ error: 'text required' });
    const msg = {
        type: 'tts',
        text: text.slice(0, 500),
        voice: (voice || '').slice(0, 100),
        rate:   Math.min(Math.max(parseFloat(rate)   || 1, 0.1), 3),
        pitch:  Math.min(Math.max(parseFloat(pitch)  || 1, 0),   2),
        volume: Math.min(Math.max(parseFloat(volume) || 1, 0),   1),
    };
    broadcastToDisplays(msg);
    broadcastSSE(msg);
    console.log('[Stream] TTS triggered:', text.slice(0, 60));
    res.json({ ok: true });
});

// ── POST /api/stream/sound ────────────────────────────────────
app.post('/api/stream/sound', streamLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const ALLOWED_SOUNDS = ['tornado-warning','severe-thunderstorm','flash-flood',
                            'special-weather','test-tone','chime'];
    const { sound = 'chime', volume = 0.8 } = req.body;
    if (!ALLOWED_SOUNDS.includes(sound)) return res.status(400).json({ error: 'unknown sound', allowed: ALLOWED_SOUNDS });
    const msg = {
        type: 'sound',
        sound,
        volume: Math.min(Math.max(parseFloat(volume) || 0.8, 0), 1),
    };
    broadcastToDisplays(msg);
    broadcastSSE(msg);
    console.log('[Stream] Sound alert:', sound);
    res.json({ ok: true });
});

// ── GET /api/stream/alerts ────────────────────────────────────
app.get('/api/stream/alerts', (_, res) => {
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.json({ alerts: cachedNwsAlerts, error: nwsAlertError, polledAt: Date.now() });
});

// ── GET /api/stream/alerts/polygons ──────────────────────────
// Returns GeoJSON FeatureCollection of all active alert polygons
app.get('/api/stream/alerts/polygons', (_, res) => {
    res.setHeader('Cache-Control', 'public, max-age=120');
    const features = cachedNwsAlerts
        .filter(a => a.geometry)
        .map(a => ({
            type: 'Feature',
            id: a.id,
            geometry: a.geometry,
            properties: {
                event: a.event,
                headline: a.headline,
                area: a.area,
                severity: a.severity,
                category: a.category,
                expires: a.expires,
            }
        }));
    res.json({ type: 'FeatureCollection', features });
});

// ── POST /api/stream/alerts/force-check ──────────────────────
// Forces an immediate NWS poll (admin only)
app.post('/api/stream/alerts/force-check', streamLimiter, async (req, res) => {
    if (!checkAuth(req, res)) return;
    await pollNwsAlerts();
    res.json({ ok: true, count: cachedNwsAlerts.length });
});

// ── Connected client count ────────────────────────────────────
app.get('/api/stream/connections', (_, res) => {
    const counts = { total: wsClients.size, display: 0, dashboard: 0, overlay: 0, sse: sseClients.size };
    for (const c of wsClients) {
        if (counts[c.role] !== undefined) counts[c.role]++;
    }
    res.json(counts);
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`WeatherNow running on http://0.0.0.0:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
    console.log(`Admin password: ${ADMIN_PASSWORD}`);
    console.log(`VAPID public key: ${vapidKeys.publicKey.slice(0, 20)}…`);
});
