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
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const xss = require('xss');

const app = express();
app.set('trust proxy', 1);

// ── Security Headers & HTTPS Redirection (Task 3.1 & 4.3) ──────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org", "https://*.tile.weather.gov", "https://api.weather.gov"],
            connectSrc: ["'self'", "https://api.weather.gov", "https://nominatim.openstreetmap.org"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
}));

// Enforce HTTPS in production
app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    // Task 3.1: HSTS
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

app.use(express.json({ limit: '10kb' })); // Payload size limit

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

// ── GET /cs242 (Security Demo) ────────────────────────────────
// Password-protected route: requires CS242_PASSWORD query param
app.get('/cs242', (req, res) => {
    const providedPassword = req.query.password || '';
    if (providedPassword !== CS242_PASSWORD) {
        return res.status(403).json({ error: 'Access denied. Invalid or missing password.' });
    }
    logSecurityEvent('CS242 Demo Accessed', req.ip, 'Correct password provided');
    res.sendFile(path.join(__dirname, 'demo.html'));
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
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('X-Content-Type-Options', 'nosniff');
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
let appUpdateSettings = {
    version: `build-${BUILD_HASH}`,
    autoUpdateEnabled: true,
    updatedAt: Date.now(),
};

let customForecasts = [];  // array of { id, label, periods, targeting, updatedAt }
let customForecastId = 1;

// Armageddon mode – when set, overrides the entire display with a single message
// Shape: { title, text, type, activatedAt, expiresAt } or null when inactive
let armageddonState = null;

// Acknowledgements: tracks which visitor IDs have acknowledged each message
// Map<msgId, Set<visitorId>>
const acknowledgements = new Map();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'weathernow';
const CS242_PASSWORD = process.env.CS242_PASSWORD || 'cs242-security';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// ── Security & Audit (Task 1.2 & 2.1) ──────────────────────────
const failedLogins = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

let securityLogs = [];
function logSecurityEvent(event, ip, details = '') {
    securityLogs.unshift({
        timestamp: new Date().toISOString(),
        event,
        ip,
        details
    });
    if (securityLogs.length > 50) securityLogs.pop();
    console.log(`[Security] ${event} from ${ip} ${details ? '(' + details + ')' : ''}`);
}

let auditLogs = [];
function logAuditAction(action, ip, details = '') {
    auditLogs.unshift({
        timestamp: new Date().toISOString(),
        action,
        ip,
        details
    });
    if (auditLogs.length > 100) auditLogs.pop();
    console.log(`[Audit] ${action} by ${ip} ${details ? '(' + details + ')' : ''}`);
}

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

// ── Rate limiter (unlock attempts) ────────────────────────────
const unlockLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many unlock attempts. Try again later.' }
});

// ── Auth helper ────────────────────────────────────────────────
function checkAuth(req, res) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        // Fallback for legacy /api/poll and others that might still use headers/body
        const provided = req.headers['x-admin-password'] || req.body?.password;
        if (provided === ADMIN_PASSWORD) return true;
        
        res.status(401).json({ error: 'Authentication required' });
        return false;
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        return true;
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired session' });
        return false;
    }
}

// ── GET /api/security/logs ─────────────────────────────────────
app.get('/api/security/logs', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    res.json({ security: securityLogs, audit: auditLogs });
});

// ── GET /api/security/check-lockout ────────────────────────────
// Returns lockout status for the client to show/hide the main app
app.get('/api/security/check-lockout', (req, res) => {
    const ip = req.ip;
    const status = failedLogins.get(ip);
    
    // Check if IP is locked out
    if (status && status.lockedUntil > Date.now()) {
        const minutesRemaining = Math.ceil((status.lockedUntil - Date.now()) / 1000 / 60);
        res.json({
            locked: true,
            minutesRemaining,
            reason: 'Too many failed login attempts'
        });
    } else {
        res.json({ locked: false });
    }
});

// ── POST /api/login ────────────────────────────────────────────
app.post('/api/login', adminLimiter, (req, res) => {
    const ip = req.ip;
    const { password } = req.body;

    const status = failedLogins.get(ip);
    if (status && status.lockedUntil > Date.now()) {
        const remaining = Math.ceil((status.lockedUntil - Date.now()) / 1000 / 60);
        return res.status(429).json({ error: `Locked out. Try again in ${remaining} min.` });
    }

    if (password === ADMIN_PASSWORD) {
        failedLogins.delete(ip);
        const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '1h' });
        logSecurityEvent('Login Success', ip);
        res.json({ token });
    } else {
        const count = (status?.count || 0) + 1;
        const lockedUntil = count >= MAX_FAILED_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0;
        failedLogins.set(ip, { count, lockedUntil });
        
        logSecurityEvent('Login Failed', ip, `Attempt ${count}/${MAX_FAILED_ATTEMPTS}`);
        if (lockedUntil > 0) logSecurityEvent('IP Locked', ip, '15-minute lockout');
        
        res.status(401).json({ error: 'Invalid password' });
    }
});

// ── POST /api/security/unlock ───────────────────────────────────
// Allows locked-out users to enter CS242 password to bypass lockout
app.post('/api/security/unlock', unlockLimiter, (req, res) => {
    const ip = req.ip;
    const { password } = req.body;

    if (password === CS242_PASSWORD) {
        failedLogins.delete(ip);
        logSecurityEvent('Lockout Bypassed', ip, 'User entered CS242 password to unlock');
        res.json({ ok: true, message: 'Lockout cleared' });
    } else {
        logSecurityEvent('Unlock Failed', ip, 'Invalid unlock password attempt');
        res.status(401).json({ error: 'Invalid lockout password' });
    }
});

// ── Honeypot (Task 2.3) ────────────────────────────────────────
app.get('/api/admin-backdoor', (req, res) => {
    const ip = req.ip;
    logSecurityEvent('Honeypot Triggered', ip, 'Accessed /api/admin-backdoor');
    failedLogins.set(ip, { count: MAX_FAILED_ATTEMPTS, lockedUntil: Date.now() + LOCKOUT_MS * 4 });
    res.status(403).json({ error: 'Access denied' });
});

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
    
    // Task 3.3: API Payload Validation
    if (!text || typeof text !== 'string' || text.length > 5000) return res.status(400).json({ error: 'text required (max 5000 chars)' });
    if (typeof title !== 'string' || title.length > 200) return res.status(400).json({ error: 'title must be string (max 200 chars)' });
    if (!['info', 'warning', 'emergency', 'success'].includes(type)) return res.status(400).json({ error: 'invalid type' });
    if (!['banner', 'kiosk', 'modal'].includes(display)) return res.status(400).json({ error: 'invalid display' });

    const msg = {
        id: nextId++,
        // Task 3.2: Input Sanitization
        text: xss(text.trim()),
        title: xss(title.trim()),
        type,
        display,
        duration: Math.max(0, parseInt(duration) || 0),
        tts: !!tts,
        push: !!push,
        targeting,
        created: Date.now()
    };
    messages.push(msg);
    logAuditAction('Created Announcement', req.ip, text.slice(0, 50));
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
    logAuditAction('Deleted Message', req.ip, `ID: ${id}`);
    res.json({ ok: true });
});

// ── DELETE /api/messages ───────────────────────────────────────
app.delete('/api/messages', (req, res) => {
    if (!checkAuth(req, res)) return;
    messages = [];
    acknowledgements.clear();
    logAuditAction('Cleared All Messages', req.ip);
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
    
    // Task 3.3: API Payload Validation
    if (!text || typeof text !== 'string' || text.length > 5000) return res.status(400).json({ error: 'text required (max 5000 chars)' });
    if (typeof title !== 'string' || title.length > 200) return res.status(400).json({ error: 'title must be string (max 200 chars)' });
    
    const durationMs = Math.max(0, parseInt(duration) || 0) * 60 * 1000;
    armageddonState = {
        // Task 3.2: Input Sanitization
        title: xss(title.trim()), 
        text: xss(text.trim()), 
        type: xss(type),
        activatedAt: Date.now(),
        expiresAt: durationMs > 0 ? Date.now() + durationMs : null,
    };
    logAuditAction('Activated Armageddon', req.ip, text.slice(0, 50));
    console.log('[Admin] Armageddon mode ACTIVATED');
    res.json({ ok: true, ...armageddonState });
});

// ── DELETE /api/armageddon ─────────────────────────────────────
app.delete('/api/armageddon', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    armageddonState = null;
    logAuditAction('Deactivated Armageddon', req.ip);
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

// ── App update settings ───────────────────────────────────────
// Public read endpoint used by clients at startup.
app.get('/api/app-update', (_, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(appUpdateSettings);
});

// Admin write endpoint used by admin panel.
app.put('/api/app-update', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const version = String(req.body?.version ?? '').trim();
    if (!version || version.length > 30) {
        return res.status(400).json({ error: 'valid version required (1-30 chars)' });
    }
    const autoUpdateEnabled = typeof req.body?.autoUpdateEnabled === 'boolean'
        ? req.body.autoUpdateEnabled
        : appUpdateSettings.autoUpdateEnabled;
    appUpdateSettings = {
        version: xss(version),
        autoUpdateEnabled,
        updatedAt: Date.now(),
    };
    logAuditAction('Updated App Settings', req.ip, `v:${version}, auto:${autoUpdateEnabled}`);
    console.log(`[Admin] Update settings saved: version=${version}, autoUpdateEnabled=${autoUpdateEnabled}`);
    res.json(appUpdateSettings);
});

// ── Release Notes ─────────────────────────────────────────────
app.get('/api/release-notes', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    res.json(releaseNotes);
});

app.post('/api/release-notes', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const { version = '', notes = '', autoUpdateEnabled } = req.body;
    if (!notes || typeof notes !== 'string' || !notes.trim()) return res.status(400).json({ error: 'notes required' });
    
    const normalizedVersion = xss(version.trim());
    const note = { 
        id: releaseNoteId++, 
        version: normalizedVersion, 
        notes: xss(notes.trim()), 
        created: Date.now() 
    };
    releaseNotes.unshift(note);
    if (normalizedVersion) {
        appUpdateSettings = {
            version: normalizedVersion,
            autoUpdateEnabled: typeof autoUpdateEnabled === 'boolean' ? autoUpdateEnabled : appUpdateSettings.autoUpdateEnabled,
            updatedAt: Date.now(),
        };
    }
    logAuditAction('Posted Release Note', req.ip, normalizedVersion);
    console.log(`[Admin] Release note posted: ${version}`);
    res.json(note);
});

app.delete('/api/release-notes/:id', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    const id = parseInt(req.params.id);
    releaseNotes = releaseNotes.filter(n => n.id !== id);
    logAuditAction('Deleted Release Note', req.ip, `ID: ${id}`);
    res.json({ ok: true });
});

app.delete('/api/release-notes', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    releaseNotes = [];
    logAuditAction('Cleared All Release Notes', req.ip);
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
    if (!periods || !Array.isArray(periods) || !periods.length) return res.status(400).json({ error: 'periods required' });
    
    // If a non-empty label is given and a forecast with that label already exists, replace it
    const existing = label ? customForecasts.findIndex(c => c.label === label) : -1;
    const entry = { 
        id: existing >= 0 ? customForecasts[existing].id : customForecastId++, 
        label: xss(label), 
        periods, 
        targeting, 
        updatedAt: Date.now() 
    };
    if (existing >= 0) {
        customForecasts[existing] = entry;
    } else {
        customForecasts.push(entry);
    }
    logAuditAction(existing >= 0 ? 'Updated Custom Forecast' : 'Added Custom Forecast', req.ip, label || entry.id);
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
    logAuditAction('Deleted Custom Forecast', req.ip, `ID: ${id}`);
    res.json({ ok: true });
});

// Delete all forecasts
app.delete('/api/custom-forecast', adminLimiter, (req, res) => {
    if (!checkAuth(req, res)) return;
    customForecasts = [];
    logAuditAction('Cleared All Custom Forecasts', req.ip);
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

// ── Security Demo Endpoints (Task 5) ──────────────────────────
const DEMO_ENABLED = process.env.SECURITY_DEMO_ENABLED === 'true' || true; // Default true for this project

app.post('/api/security/demo/reset', (req, res) => {
    if (!DEMO_ENABLED) return res.status(403).json({ error: 'Demo mode disabled' });
    failedLogins.clear();
    securityLogs = [];
    auditLogs = [];
    logSecurityEvent('Demo Reset', req.ip, 'Logs and lockouts cleared via demo control');
    res.json({ ok: true });
});

app.post('/api/security/demo/expire-token', (req, res) => {
    if (!DEMO_ENABLED) return res.status(403).json({ error: 'Demo mode disabled' });
    // We can't easily "expire" a JWT from the server side without a blacklist,
    // but we can signal the client to clear its token.
    logSecurityEvent('Demo Token Expire', req.ip, 'Triggered token expiration demo');
    res.json({ ok: true, action: 'logout' });
});

app.post('/api/security/demo/sanitize', (req, res) => {
    if (!DEMO_ENABLED) return res.status(403).json({ error: 'Demo mode disabled' });
    const { input } = req.body;
    const sanitized = xss(input || '');
    res.json({ input, sanitized });
});

// ── GET /api/security/demo/lockouts ───────────────────────────
app.get('/api/security/demo/lockouts', (req, res) => {
    if (!DEMO_ENABLED) return res.status(403).json({ error: 'Demo mode disabled' });
    const lockouts = [];
    failedLogins.forEach((status, ip) => {
        if (status.lockedUntil > Date.now()) {
            lockouts.push({
                ip,
                remaining: Math.ceil((status.lockedUntil - Date.now()) / 1000),
                count: status.count
            });
        }
    });
    res.json(lockouts);
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`WeatherNow running on http://0.0.0.0:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
    console.log(`Admin password: ${ADMIN_PASSWORD}`);
    console.log(`VAPID public key: ${vapidKeys.publicKey.slice(0, 20)}…`);
});
