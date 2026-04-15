/**
 * Cloudflare Pages Function — handles all /api/* routes
 * Storage: Cloudflare KV (WEATHERNOW_KV binding)
 *
 * Deploy via: npx wrangler pages deploy  (or push to GitHub → Cloudflare Pages)
 *
 * KV Bindings required (Pages dashboard → Settings → Functions → KV namespace bindings):
 *   Variable name: WEATHERNOW_KV  →  your KV namespace
 *
 * Environment variables (Pages dashboard → Settings → Environment variables):
 *   ADMIN_PASSWORD        — admin panel password
 *   VAPID_PUBLIC_KEY      — generate with: npx web-push generate-vapid-keys
 *   VAPID_PRIVATE_KEY     — (same command)
 *   VAPID_EMAIL           — mailto:you@example.com
 */

const CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
    'Cache-Control': 'no-store',
};

const KV_MESSAGES_KEY = 'messages';
const KV_SUBSCRIPTIONS_KEY = 'push_subscriptions';
const KV_RELEASE_NOTES_KEY = 'release_notes';
const KV_APP_UPDATE_SETTINGS_KEY = 'app_update_settings';
const KV_CUSTOM_FORECAST_KEY = 'custom_forecast';
const KV_ARMAGEDDON_KEY = 'armageddon';

const KV_MSG_SEQ_KEY = 'msg_next_id'; // persistent counter — never resets on message delete
const KV_ACKS_KEY = 'msg_acks'; // { [msgId]: [visitorId, ...] }
const KV_SECURITY_LOGS_KEY = 'security_logs';
const KV_AUDIT_LOGS_KEY = 'audit_logs';
const KV_FAILED_LOGINS_KEY = 'failed_logins';
const MAX_APP_VERSION_LENGTH = 30;

// ── Helpers ────────────────────────────────────────────────────────
async function getSecurityLogs(env) {
    return (await env.WEATHERNOW_KV.get(KV_SECURITY_LOGS_KEY, 'json')) ?? [];
}
async function saveSecurityLog(env, event, ip, details = '') {
    const logs = await getSecurityLogs(env);
    logs.unshift({ timestamp: new Date().toISOString(), event, ip, details });
    if (logs.length > 50) logs.pop();
    await env.WEATHERNOW_KV.put(KV_SECURITY_LOGS_KEY, JSON.stringify(logs));
}

async function getAuditLogs(env) {
    return (await env.WEATHERNOW_KV.get(KV_AUDIT_LOGS_KEY, 'json')) ?? [];
}
async function saveAuditLog(env, action, ip, details = '') {
    const logs = await getAuditLogs(env);
    logs.unshift({ timestamp: new Date().toISOString(), action, ip, details });
    if (logs.length > 100) logs.pop();
    await env.WEATHERNOW_KV.put(KV_AUDIT_LOGS_KEY, JSON.stringify(logs));
}

async function getFailedLogins(env) {
    return (await env.WEATHERNOW_KV.get(KV_FAILED_LOGINS_KEY, 'json')) ?? {};
}
async function saveFailedLogins(env, failed) {
    await env.WEATHERNOW_KV.put(KV_FAILED_LOGINS_KEY, JSON.stringify(failed));
}
async function getMessages(env) {
    return (await env.WEATHERNOW_KV.get(KV_MESSAGES_KEY, 'json')) ?? [];
}
async function saveMessages(env, msgs) {
    await env.WEATHERNOW_KV.put(KV_MESSAGES_KEY, JSON.stringify(msgs));
}
async function getSubscriptions(env) {
    return (await env.WEATHERNOW_KV.get(KV_SUBSCRIPTIONS_KEY, 'json')) ?? [];
}
async function saveSubscriptions(env, subs) {
    await env.WEATHERNOW_KV.put(KV_SUBSCRIPTIONS_KEY, JSON.stringify(subs));
}
async function getReleaseNotes(env) {
    return (await env.WEATHERNOW_KV.get(KV_RELEASE_NOTES_KEY, 'json')) ?? [];
}
async function saveReleaseNotes(env, notes) {
    await env.WEATHERNOW_KV.put(KV_RELEASE_NOTES_KEY, JSON.stringify(notes));
}
async function getAppUpdateSettings(env) {
    return (await env.WEATHERNOW_KV.get(KV_APP_UPDATE_SETTINGS_KEY, 'json')) ?? {
        version: 'build-cloudflare-pages',
        autoUpdateEnabled: true,
        updatedAt: 0,
    };
}
async function saveAppUpdateSettings(env, settings) {
    await env.WEATHERNOW_KV.put(KV_APP_UPDATE_SETTINGS_KEY, JSON.stringify(settings));
}
async function getCustomForecasts(env) {
    const stored = await env.WEATHERNOW_KV.get(KV_CUSTOM_FORECAST_KEY, 'json');
    // Migrate legacy single-object storage to array format
    if (stored && !Array.isArray(stored)) {
        return stored.periods?.length ? [{ id: 1, label: '', ...stored }] : [];
    }
    return stored ?? [];
}
async function saveCustomForecasts(env, forecasts) {
    await env.WEATHERNOW_KV.put(KV_CUSTOM_FORECAST_KEY, JSON.stringify(forecasts));
}

async function getAcks(env) {
    return (await env.WEATHERNOW_KV.get(KV_ACKS_KEY, 'json')) ?? {};
}
async function saveAcks(env, acks) {
    await env.WEATHERNOW_KV.put(KV_ACKS_KEY, JSON.stringify(acks));
}

async function getArmageddonState(env) {
    return (await env.WEATHERNOW_KV.get(KV_ARMAGEDDON_KEY, 'json')) ?? null;
}
async function saveArmageddonState(env, state) {
    if (state === null) {
        await env.WEATHERNOW_KV.delete(KV_ARMAGEDDON_KEY);
    } else {
        await env.WEATHERNOW_KV.put(KV_ARMAGEDDON_KEY, JSON.stringify(state));
    }
}




// ── Auth helpers ───────────────────────────────────────────────────
async function hmacSha256(message, secret) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function signToken(env) {
    const expiry = Date.now() + 3600000; // 1 hour
    const payload = `${expiry}`;
    const signature = await hmacSha256(payload, env.ADMIN_PASSWORD || 'weathernow');
    return `${payload}.${signature}`;
}

async function verifyToken(token, env) {
    if (!token) return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expiry = parseInt(payload);
    if (isNaN(expiry) || Date.now() > expiry) return false;
    const expected = await hmacSha256(payload, env.ADMIN_PASSWORD || 'weathernow');
    return signature === expected;
}

async function checkAuth(request, env) {
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if (await verifyToken(token, env)) return true;
    }

    // Fallback for legacy /api/poll and others that might still use headers/body
    const pw = request.headers.get('x-admin-password');
    if (pw === (env.ADMIN_PASSWORD ?? 'weathernow')) return true;

    // Check body if it was parsed (only for announce)
    return false;
}

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), { status, headers: { ...CORS, ...extraHeaders } });
}

function noStore(data, status = 200) {
    // Use for real-time/dynamic endpoints that must never be served from cache.
    return json(data, status, { 'Cache-Control': 'no-store' });
}

// ── VAPID / Web Push (Web Crypto — no npm needed) ──────────────────

function base64UrlToUint8Array(base64Url) {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function uint8ArrayToBase64Url(uint8Array) {
    let binary = '';
    uint8Array.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function signVapidJwt(audience, privateKeyB64Url, email) {
    const now = Math.floor(Date.now() / 1000);
    const header = { typ: 'JWT', alg: 'ES256' };
    const payload = { aud: audience, exp: now + 12 * 3600, sub: email };

    const encode = obj => uint8ArrayToBase64Url(
        new TextEncoder().encode(JSON.stringify(obj))
    );
    const headerPayload = `${encode(header)}.${encode(payload)}`;

    const keyBytes = base64UrlToUint8Array(privateKeyB64Url);
    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8', keyBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false, ['sign']
    );
    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        cryptoKey,
        new TextEncoder().encode(headerPayload)
    );
    return `${headerPayload}.${uint8ArrayToBase64Url(new Uint8Array(sig))}`;
}

async function sendPushMessage(sub, payload, env) {
    const vapidPublic = env.VAPID_PUBLIC_KEY;
    const vapidPrivate = env.VAPID_PRIVATE_KEY;
    const vapidEmail = env.VAPID_EMAIL || 'mailto:admin@shelly.local';

    if (!vapidPublic || !vapidPrivate) throw new Error('VAPID keys not configured');

    const endpoint = new URL(sub.endpoint);
    const audience = `${endpoint.protocol}//${endpoint.host}`;
    const jwt = await signVapidJwt(audience, vapidPrivate, vapidEmail);

    const response = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            'Authorization': `vapid t=${jwt},k=${vapidPublic}`,
            'TTL': '86400',
        },
        body: typeof payload === 'string' ? new TextEncoder().encode(payload) : payload,
    });
    return response;
}

async function fanOutPush(subs, payload, env) {
    let sent = 0, failed = 0;
    const stale = [];
    await Promise.all(subs.map(async sub => {
        try {
            const res = await sendPushMessage(sub, payload, env);
            if (res.status === 410 || res.status === 404) {
                stale.push(sub.endpoint);
                failed++;
            } else {
                sent++;
            }
        } catch { failed++; }
    }));
    const alive = subs.filter(s => !stale.includes(s.endpoint));
    if (stale.length) await saveSubscriptions(env, alive);
    return { sent, failed, total: alive.length };
}

// ── Main handler ───────────────────────────────────────────────────
export async function onRequest({ request, env }) {
    const url = new URL(request.url);
    const path = url.pathname;
    const { method } = request;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // ── Health ──────────────────────────────────────────────────
    if (path === '/api/health' && method === 'GET') {
        const subs = await getSubscriptions(env);
        return noStore({ ok: true, pushSubscribers: subs.length });
    }

    // ── Security & Audit ────────────────────────────────────────
    if (path === '/api/security/logs' && method === 'GET') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const [security, audit] = await Promise.all([getSecurityLogs(env), getAuditLogs(env)]);
        return json({ security, audit });
    }

    if (path === '/api/login' && method === 'POST') {
        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        const { password } = await request.json();
        
        const failed = await getFailedLogins(env);
        const status = failed[ip];
        if (status && status.lockedUntil > Date.now()) {
            const remaining = Math.ceil((status.lockedUntil - Date.now()) / 1000 / 60);
            return json({ error: `Locked out. Try again in ${remaining} min.` }, 429);
        }

        if (password === (env.ADMIN_PASSWORD || 'weathernow')) {
            delete failed[ip];
            await saveFailedLogins(env, failed);
            const token = await signToken(env);
            await saveSecurityLog(env, 'Login Success', ip);
            return json({ token });
        } else {
            const count = (status?.count || 0) + 1;
            const MAX_FAILED = 5;
            const lockedUntil = count >= MAX_FAILED ? Date.now() + 15 * 60 * 1000 : 0;
            failed[ip] = { count, lockedUntil };
            await saveFailedLogins(env, failed);
            
            await saveSecurityLog(env, 'Login Failed', ip, `Attempt ${count}/${MAX_FAILED}`);
            if (lockedUntil > 0) await saveSecurityLog(env, 'IP Locked', ip, '15-minute lockout');
            
            return json({ error: 'Invalid password' }, 401);
        }
    }

    if (path === '/api/admin-backdoor' && method === 'GET') {
        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        await saveSecurityLog(env, 'Honeypot Triggered', ip, 'Accessed /api/admin-backdoor');
        const failed = await getFailedLogins(env);
        const lockedUntil = Date.now() + 60 * 60 * 1000;
        failed[ip] = { count: 5, lockedUntil };
        await saveFailedLogins(env, failed);
        return json({ error: 'Access denied' }, 403);
    }





    // ── Messages ────────────────────────────────────────────────
    if (path === '/api/messages' && method === 'GET') {
        const since = parseInt(url.searchParams.get('since') ?? '0') || 0;
        const [msgs, acks] = await Promise.all([getMessages(env), getAcks(env)]);
        return json(msgs.filter(m => m.id > since).map(m => ({
            ...m,
            ackCount: (acks[m.id] ?? []).length,
        })));
    }

    // ── Poll (combined messages + armageddon in one request) ────
    if (path === '/api/poll' && method === 'GET') {
        const since = parseInt(url.searchParams.get('since') ?? '0') || 0;
        const [msgs, armageddon] = await Promise.all([getMessages(env), getArmageddonState(env)]);
        let armState = armageddon;
        if (armState?.expiresAt && Date.now() > armState.expiresAt) {
            await saveArmageddonState(env, null);
            armState = null;
        }
        return noStore({
            messages: msgs.filter(m => m.id > since),
            armageddon: armState ? { active: true, ...armState } : { active: false },
        });
    }

    if (path === '/api/verify' && method === 'GET') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        return json({ ok: true });
    }

    if (path === '/api/announce' && method === 'POST') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const { text = '', title = '', type = 'info', display = 'banner',
            duration = 0, tts = false, push = false, targeting = { mode: 'all' } } = await request.json();
        if (!text.trim()) return json({ error: 'text is required' }, 400);

        const msgs = await getMessages(env);
        const stored = parseInt(await env.WEATHERNOW_KV.get(KV_MSG_SEQ_KEY) || '0', 10);
        const maxExisting = msgs.length ? Math.max(...msgs.map(m => m.id)) : 0;
        const nextId = Math.max(stored, maxExisting) + 1;
        await env.WEATHERNOW_KV.put(KV_MSG_SEQ_KEY, String(nextId));
        const msg = { id: nextId, text: text.trim(), title: title.trim(), type, display, duration, tts: !!tts, push: !!push, targeting, created: Date.now() };
        msgs.push(msg);
        await saveMessages(env, msgs);
        await saveAuditLog(env, 'Created Announcement', request.headers.get('cf-connecting-ip') || 'unknown', text.slice(0, 50));

        // Fan-out push if requested
        if (push) {
            const subs = await getSubscriptions(env);
            if (subs.length > 0) {
                const payload = JSON.stringify({
                    title: title.trim() || `S.H.E.L.L.Y. ${type.charAt(0).toUpperCase() + type.slice(1)}`,
                    body: text.trim(), type, tag: `announce-${nextId}`, url: '/'
                });
                await fanOutPush(subs, payload, env);
            }
        }

        return json(msg, 201);
    }

    const oneMatch = path.match(/^\/api\/messages\/(\d+)$/);
    if (oneMatch && method === 'DELETE') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const id = parseInt(oneMatch[1]);
        const [msgs, acks] = await Promise.all([getMessages(env), getAcks(env)]);
        await saveMessages(env, msgs.filter(m => m.id !== id));
        delete acks[id];
        await saveAcks(env, acks);
        await saveAuditLog(env, 'Deleted Message', request.headers.get('cf-connecting-ip') || 'unknown', `ID: ${id}`);
        return json({ ok: true });
    }

    if (path === '/api/messages' && method === 'DELETE') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        await Promise.all([saveMessages(env, []), saveAcks(env, {})]);
        await saveAuditLog(env, 'Cleared All Messages', request.headers.get('cf-connecting-ip') || 'unknown');
        return json({ ok: true });
    }

    // ── Acknowledge ──────────────────────────────────────────────
    // Public – no admin auth required. Body: { visitorId: string }
    const ackMatch = path.match(/^\/api\/messages\/(\d+)\/acknowledge$/);
    if (ackMatch && method === 'POST') {
        const id = parseInt(ackMatch[1]);
        let body;
        try { body = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
        const { visitorId } = body;
        if (!visitorId || typeof visitorId !== 'string' || visitorId.length > 128 || !/^[\w\-]+$/.test(visitorId)) {
            return json({ error: 'visitorId must be alphanumeric with optional hyphens, max 128 characters' }, 400);
        }
        const [msgs, acks] = await Promise.all([getMessages(env), getAcks(env)]);
        if (!msgs.find(m => m.id === id)) return json({ error: 'not found' }, 404);
        if (!Array.isArray(acks[id])) acks[id] = [];
        if (!acks[id].includes(visitorId)) acks[id].push(visitorId);
        await saveAcks(env, acks);
        return json({ ok: true, ackCount: acks[id].length });
    }

    // ── Push ────────────────────────────────────────────────────
    if (path === '/api/push/vapid-key' && method === 'GET') {
        const key = env.VAPID_PUBLIC_KEY;
        if (!key) return json({ error: 'VAPID keys not configured. See README.' }, 503);
        return json({ publicKey: key });
    }

    if (path === '/api/push/count' && method === 'GET') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const subs = await getSubscriptions(env);
        return json({ count: subs.length });
    }

    if (path === '/api/push/subscribe' && method === 'POST') {
        const sub = await request.json();
        if (!sub?.endpoint) return json({ error: 'invalid subscription' }, 400);
        const subs = await getSubscriptions(env);
        const idx = subs.findIndex(s => s.endpoint === sub.endpoint);
        if (idx >= 0) subs[idx] = sub; else subs.push(sub);
        await saveSubscriptions(env, subs);
        return json({ ok: true, total: subs.length });
    }

    if (path === '/api/push/subscribe' && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const { endpoint } = await request.json();
        if (!endpoint) return json({ error: 'endpoint required' }, 400);
        const subs = await getSubscriptions(env);
        await saveSubscriptions(env, subs.filter(s => s.endpoint !== endpoint));
        return json({ ok: true });
    }

    if (path === '/api/push/send' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const { title = 'S.H.E.L.L.Y. Test', body = 'Push notifications are working! 🌤', type = 'info' } = await request.json();
        const subs = await getSubscriptions(env);
        const payload = JSON.stringify({ title, body, type, tag: 'test-push', url: '/' });
        const results = await fanOutPush(subs, payload, env);
        return json(results);
    }

    // ── App Update Settings ───────────────────────────────────────
    if (path === '/api/app-update' && method === 'GET') {
        const settings = await getAppUpdateSettings(env);
        return new Response(JSON.stringify(settings), {
            status: 200,
            headers: {
                ...CORS,
                'Cache-Control': 'no-store',
            },
        });
    }

    if (path === '/api/app-update' && method === 'PUT') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const body = await request.json();
        const version = String(body?.version ?? '').trim();
        if (!version || version.length > MAX_APP_VERSION_LENGTH) {
            return json({ error: 'valid non-whitespace version required (1-30 chars)' }, 400);
        }
        const existing = await getAppUpdateSettings(env);
        const autoUpdateEnabled = typeof body?.autoUpdateEnabled === 'boolean'
            ? body.autoUpdateEnabled
            : existing.autoUpdateEnabled;
        const settings = {
            version,
            autoUpdateEnabled,
            updatedAt: Date.now(),
        };
        await saveAppUpdateSettings(env, settings);
        await saveAuditLog(env, 'Updated App Settings', request.headers.get('cf-connecting-ip') || 'unknown', `v:${version}, auto:${autoUpdateEnabled}`);
        return json(settings);
    }

    // ── Release Notes ────────────────────────────────────────────
    if (path === '/api/release-notes' && method === 'GET') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        return json(await getReleaseNotes(env));
    }

    if (path === '/api/release-notes' && method === 'POST') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const { version = '', notes = '' } = await request.json();
        if (!notes.trim()) return json({ error: 'notes is required' }, 400);
        const existing = await getReleaseNotes(env);
        const nextId = existing.length ? Math.max(...existing.map(n => n.id)) + 1 : 1;
        const note = { id: nextId, version: version.trim(), notes: notes.trim(), created: Date.now() };
        await saveReleaseNotes(env, [note, ...existing]);
        await saveAuditLog(env, 'Posted Release Note', request.headers.get('cf-connecting-ip') || 'unknown', version.trim());
        return json(note, 201);
    }

    const releaseNoteMatch = path.match(/^\/api\/release-notes\/(\d+)$/);
    if (releaseNoteMatch && method === 'DELETE') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const id = parseInt(releaseNoteMatch[1]);
        const existing = await getReleaseNotes(env);
        await saveReleaseNotes(env, existing.filter(n => n.id !== id));
        await saveAuditLog(env, 'Deleted Release Note', request.headers.get('cf-connecting-ip') || 'unknown', `ID: ${id}`);
        return json({ ok: true });
    }

    if (path === '/api/release-notes' && method === 'DELETE') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        await saveReleaseNotes(env, []);
        await saveAuditLog(env, 'Cleared All Release Notes', request.headers.get('cf-connecting-ip') || 'unknown');
        return json({ ok: true });
    }

    // ── Custom Forecast ──────────────────────────────────────────
    if (path === '/api/custom-forecast' && method === 'GET') {
        return json(await getCustomForecasts(env));
    }

    if (path === '/api/custom-forecast' && method === 'POST') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const { periods = [], targeting = { mode: 'all' }, label: rawLabel = '' } = await request.json();
        const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
        if (!periods.length) return json({ error: 'periods required' }, 400);
        const forecasts = await getCustomForecasts(env);
        const existing = label ? forecasts.findIndex(c => c.label === label) : -1;
        const nextId = forecasts.length ? Math.max(...forecasts.map(c => c.id ?? 0)) + 1 : 1;
        const entry = { id: existing >= 0 ? forecasts[existing].id : nextId, label, periods, targeting, updatedAt: Date.now() };
        if (existing >= 0) {
            forecasts[existing] = entry;
        } else {
            forecasts.push(entry);
        }
        await saveCustomForecasts(env, forecasts);
        await saveAuditLog(env, existing >= 0 ? 'Updated Custom Forecast' : 'Added Custom Forecast', request.headers.get('cf-connecting-ip') || 'unknown', label || entry.id);
        return json(entry, 201);
    }

    const customFcMatch = path.match(/^\/api\/custom-forecast\/(\d+)$/);
    if (customFcMatch && method === 'DELETE') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const id = parseInt(customFcMatch[1], 10);
        const forecasts = await getCustomForecasts(env);
        const updated = forecasts.filter(c => c.id !== id);
        if (updated.length === forecasts.length) return json({ error: 'not found' }, 404);
        await saveCustomForecasts(env, updated);
        await saveAuditLog(env, 'Deleted Custom Forecast', request.headers.get('cf-connecting-ip') || 'unknown', `ID: ${id}`);
        return json({ ok: true });
    }

    if (path === '/api/custom-forecast' && method === 'DELETE') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        await saveCustomForecasts(env, []);
        await saveAuditLog(env, 'Cleared All Custom Forecasts', request.headers.get('cf-connecting-ip') || 'unknown');
        return json({ ok: true });
    }

    // ── Armageddon ───────────────────────────────────────────────
    // GET is public; POST/DELETE require auth.
    if (path === '/api/armageddon' && method === 'GET') {
        let state = await getArmageddonState(env);
        if (state?.expiresAt && Date.now() > state.expiresAt) {
            await saveArmageddonState(env, null);
            state = null;
        }
        return noStore(state ? { active: true, ...state } : { active: false });
    }

    if (path === '/api/armageddon' && method === 'POST') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        let body;
        try { body = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
        const { title = '', text, type = 'emergency', duration = 0 } = body;
        if (!text?.trim()) return json({ error: 'text is required' }, 400);
        const durationMs = Math.max(0, parseInt(duration) || 0) * 60 * 1000;
        const state = {
            title: title.trim(), text: text.trim(), type,
            activatedAt: Date.now(),
            expiresAt: durationMs > 0 ? Date.now() + durationMs : null,
        };
        await saveArmageddonState(env, state);
        await saveAuditLog(env, 'Activated Armageddon', request.headers.get('cf-connecting-ip') || 'unknown', text.slice(0, 50));
        return json({ ok: true, ...state });
    }

    if (path === '/api/armageddon' && method === 'DELETE') {
        if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        await saveArmageddonState(env, null);
        await saveAuditLog(env, 'Deactivated Armageddon', request.headers.get('cf-connecting-ip') || 'unknown');
        return json({ ok: true });
    }

    // ── SPC Outlook Proxy ────────────────────────────────────────
    // Proxies NOAA SPC categorical outlook GeoJSON to avoid browser CORS restrictions.
    if (path === '/api/spc-outlook' && method === 'GET') {
        const day = url.searchParams.get('day') || '1';
        const validFiles = {
            '1': 'day1otlk_cat.nolyr.geojson',
            '2': 'day2otlk_cat.nolyr.geojson',
            '3': 'day3otlk_cat.nolyr.geojson',
        };
        const file = validFiles[day];
        if (!file) return json({ error: 'Invalid day parameter. Use 1, 2, or 3.' }, 400);

        const spcUrl = `https://www.spc.noaa.gov/products/outlook/${file}`;
        try {
            const upstream = await fetch(spcUrl, {
                headers: { 'User-Agent': 'S.H.E.L.L.Y.-WeatherClient/1.0 (weather display)' },
                signal: AbortSignal.timeout(10000),
            });
            if (!upstream.ok) {
                return json({ error: `SPC returned ${upstream.status}` }, 502);
            }
            const data = await upstream.json();
            return new Response(JSON.stringify(data), {
                status: 200,
                headers: {
                    ...CORS,
                    'Cache-Control': 'public, max-age=900',
                },
            });
        } catch (err) {
            return json({ error: 'Failed to fetch SPC outlook data' }, 502);
        }
    }

    return json({ error: 'Not found' }, 404);
}
}
