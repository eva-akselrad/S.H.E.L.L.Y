/**
 * Cloudflare Worker — standalone entry point
 * Storage: Workers KV (WEATHERNOW_KV binding)
 */

import xss from 'xss';

const CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-password',
    'Cache-Control': 'no-store',
};

const KV_MESSAGES_KEY = 'messages';
const KV_SUBSCRIPTIONS_KEY = 'push_subscriptions';
const KV_RELEASE_NOTES_KEY = 'release_notes';
const KV_APP_UPDATE_SETTINGS_KEY = 'app_update_settings';
const KV_CUSTOM_FORECAST_KEY = 'custom_forecast';
const KV_ARMAGEDDON_KEY = 'armageddon';
const KV_MSG_SEQ_KEY = 'msg_next_id';
const KV_ACKS_KEY = 'msg_acks';
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
        version: 'build-worker',
        autoUpdateEnabled: true,
        updatedAt: 0,
    };
}
async function saveAppUpdateSettings(env, settings) {
    await env.WEATHERNOW_KV.put(KV_APP_UPDATE_SETTINGS_KEY, JSON.stringify(settings));
}
async function getCustomForecasts(env) {
    return (await env.WEATHERNOW_KV.get(KV_CUSTOM_FORECAST_KEY, 'json')) ?? [];
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
    const pw = request.headers.get('x-admin-password');
    if (pw === (env.ADMIN_PASSWORD ?? 'weathernow')) return true;
    return false;
}

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), { status, headers: { ...CORS, ...extraHeaders } });
}

// ── VAPID / Web Push ───────────────────────────────────────────────
async function signVapidJwt(audience, privateKeyB64Url, email) {
    const now = Math.floor(Date.now() / 1000);
    const header = { typ: 'JWT', alg: 'ES256' };
    const payload = { aud: audience, exp: now + 12 * 3600, sub: email };
    const base64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const encode = obj => base64Url(new TextEncoder().encode(JSON.stringify(obj)));
    const headerPayload = `${encode(header)}.${encode(payload)}`;
    const keyBytes = Uint8Array.from(atob(privateKeyB64Url.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, new TextEncoder().encode(headerPayload));
    return `${headerPayload}.${base64Url(new Uint8Array(sig))}`;
}

async function fanOutPush(subs, payload, env) {
    let sent = 0, failed = 0;
    const stale = [];
    const vapidPublic = env.VAPID_PUBLIC_KEY;
    const vapidPrivate = env.VAPID_PRIVATE_KEY;
    const vapidEmail = env.VAPID_EMAIL || 'mailto:admin@shelly.local';
    if (!vapidPublic || !vapidPrivate) return { sent: 0, failed: subs.length, total: subs.length, error: 'VAPID keys missing' };

    await Promise.all(subs.map(async sub => {
        try {
            const endpoint = new URL(sub.endpoint);
            const jwt = await signVapidJwt(`${endpoint.protocol}//${endpoint.host}`, vapidPrivate, vapidEmail);
            const res = await fetch(sub.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream', 'Authorization': `vapid t=${jwt},k=${vapidPublic}`, 'TTL': '86400' },
                body: typeof payload === 'string' ? new TextEncoder().encode(payload) : payload,
            });
            if (res.status === 410 || res.status === 404) { stale.push(sub.endpoint); failed++; } else sent++;
        } catch { failed++; }
    }));
    const alive = subs.filter(s => !stale.includes(s.endpoint));
    if (stale.length) await saveSubscriptions(env, alive);
    return { sent, failed, total: alive.length };
}

// ── Main handler ───────────────────────────────────────────────────
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const { method } = request;

        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

        // Serve Assets if configured (requires Assets binding)
        if (env.ASSETS && !path.startsWith('/api/')) {
            return env.ASSETS.fetch(request);
        }

        // ── Health
        if (path === '/api/health' && method === 'GET') {
            const subs = await getSubscriptions(env);
            return json({ ok: true, pushSubscribers: subs.length });
        }

        // ── Security & Audit
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
                delete failed[ip]; await saveFailedLogins(env, failed);
                const token = await signToken(env);
                await saveSecurityLog(env, 'Login Success', ip);
                return json({ token });
            } else {
                const count = (status?.count || 0) + 1;
                const lockedUntil = count >= 5 ? Date.now() + 15 * 60 * 1000 : 0;
                failed[ip] = { count, lockedUntil };
                await saveFailedLogins(env, failed);
                await saveSecurityLog(env, 'Login Failed', ip, `Attempt ${count}/5`);
                if (lockedUntil > 0) await saveSecurityLog(env, 'IP Locked', ip, '15-minute lockout');
                return json({ error: 'Invalid password' }, 401);
            }
        }

        if (path === '/api/admin-backdoor' && method === 'GET') {
            const ip = request.headers.get('cf-connecting-ip') || 'unknown';
            await saveSecurityLog(env, 'Honeypot Triggered', ip, 'Accessed /api/admin-backdoor');
            const failed = await getFailedLogins(env);
            failed[ip] = { count: 5, lockedUntil: Date.now() + 60 * 60 * 1000 };
            await saveFailedLogins(env, failed);
            return json({ error: 'Access denied' }, 403);
        }

        // ── Messages
        if (path === '/api/messages' && method === 'GET') {
            const since = parseInt(url.searchParams.get('since') ?? '0') || 0;
            const [msgs, acks] = await Promise.all([getMessages(env), getAcks(env)]);
            return json(msgs.filter(m => m.id > since).map(m => ({ ...m, ackCount: (acks[m.id] ?? []).length })));
        }

        if (path === '/api/poll' && method === 'GET') {
            const since = parseInt(url.searchParams.get('since') ?? '0') || 0;
            const [msgs, armageddon] = await Promise.all([getMessages(env), getArmageddonState(env)]);
            let armState = armageddon;
            if (armState?.expiresAt && Date.now() > armState.expiresAt) { await saveArmageddonState(env, null); armState = null; }
            return json({ messages: msgs.filter(m => m.id > since), armageddon: armState ? { active: true, ...armState } : { active: false } });
        }

        if (path === '/api/verify' && method === 'GET') {
            if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
            return json({ ok: true });
        }

        if (path === '/api/announce' && method === 'POST') {
            if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
            const { text = '', title = '', type = 'info', display = 'banner', duration = 0, tts = false, push = false, targeting = { mode: 'all' } } = await request.json();
            if (!text.trim()) return json({ error: 'text is required' }, 400);
            const msgs = await getMessages(env);
            const stored = parseInt(await env.WEATHERNOW_KV.get(KV_MSG_SEQ_KEY) || '0', 10);
            const maxExisting = msgs.length ? Math.max(...msgs.map(m => m.id)) : 0;
            const nextId = Math.max(stored, maxExisting) + 1;
            await env.WEATHERNOW_KV.put(KV_MSG_SEQ_KEY, String(nextId));
            const msg = { id: nextId, text: xss(text.trim()), title: xss(title.trim()), type, display, duration: Math.max(0, parseInt(duration) || 0), tts: !!tts, push: !!push, targeting, created: Date.now() };
            msgs.push(msg); await saveMessages(env, msgs);
            await saveAuditLog(env, 'Created Announcement', request.headers.get('cf-connecting-ip') || 'unknown', text.slice(0, 50));
            if (push) {
                const subs = await getSubscriptions(env);
                if (subs.length > 0) {
                    const payload = JSON.stringify({ title: title.trim() || `S.H.E.L.L.Y. ${type.charAt(0).toUpperCase() + type.slice(1)}`, body: text.trim(), type, tag: `announce-${nextId}`, url: '/' });
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
            delete acks[id]; await saveAcks(env, acks);
            await saveAuditLog(env, 'Deleted Message', request.headers.get('cf-connecting-ip') || 'unknown', `ID: ${id}`);
            return json({ ok: true });
        }

        if (path === '/api/messages' && method === 'DELETE') {
            if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
            await Promise.all([saveMessages(env, []), saveAcks(env, {})]);
            await saveAuditLog(env, 'Cleared All Messages', request.headers.get('cf-connecting-ip') || 'unknown');
            return json({ ok: true });
        }

        const ackMatch = path.match(/^\/api\/messages\/(\d+)\/acknowledge$/);
        if (ackMatch && method === 'POST') {
            const id = parseInt(ackMatch[1]);
            const { visitorId } = await request.json();
            if (!visitorId || typeof visitorId !== 'string' || visitorId.length > 128 || !/^[\w\-]+$/.test(visitorId)) return json({ error: 'invalid visitorId' }, 400);
            const [msgs, acks] = await Promise.all([getMessages(env), getAcks(env)]);
            if (!msgs.find(m => m.id === id)) return json({ error: 'not found' }, 404);
            if (!Array.isArray(acks[id])) acks[id] = [];
            if (!acks[id].includes(visitorId)) acks[id].push(visitorId);
            await saveAcks(env, acks);
            return json({ ok: true, ackCount: acks[id].length });
        }

        // ── Push
        if (path === '/api/push/vapid-key' && method === 'GET') return json({ publicKey: env.VAPID_PUBLIC_KEY || '' });
        if (path === '/api/push/subscribe' && method === 'POST') {
            const sub = await request.json(); if (!sub?.endpoint) return json({ error: 'invalid subscription' }, 400);
            const subs = await getSubscriptions(env); const idx = subs.findIndex(s => s.endpoint === sub.endpoint);
            if (idx >= 0) subs[idx] = sub; else subs.push(sub);
            await saveSubscriptions(env, subs); return json({ ok: true, total: subs.length });
        }

        // ── App Settings
        if (path === '/api/app-update' && method === 'GET') return json(await getAppUpdateSettings(env));
        if (path === '/api/app-update' && method === 'PUT') {
            if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
            const { version, autoUpdateEnabled } = await request.json();
            const settings = { version: xss(String(version || '').trim().slice(0, 30)), autoUpdateEnabled: !!autoUpdateEnabled, updatedAt: Date.now() };
            await saveAppUpdateSettings(env, settings); return json(settings);
        }

        // ── Armageddon
        if (path === '/api/armageddon' && method === 'GET') {
            const state = await getArmageddonState(env);
            return json(state ? { active: true, ...state } : { active: false });
        }
        if (path === '/api/armageddon' && method === 'POST') {
            if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
            const { title = '', text = '', type = 'emergency', duration = 0 } = await request.json();
            const durationMs = Math.max(0, parseInt(duration) || 0) * 60 * 1000;
            const state = { title: xss(title.trim()), text: xss(text.trim()), type: xss(type), activatedAt: Date.now(), expiresAt: durationMs > 0 ? Date.now() + durationMs : null };
            await saveArmageddonState(env, state); return json({ ok: true, ...state });
        }
        if (path === '/api/armageddon' && method === 'DELETE') {
            if (!await checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
            await saveArmageddonState(env, null); return json({ ok: true });
        }

        // ── Demo
        if (path === '/api/security/demo/sanitize' && method === 'POST') {
            const { input } = await request.json();
            return json({ input, sanitized: xss(input || '') });
        }
        if (path === '/api/security/demo/reset' && method === 'POST') {
            await Promise.all([env.WEATHERNOW_KV.delete(KV_SECURITY_LOGS_KEY), env.WEATHERNOW_KV.delete(KV_AUDIT_LOGS_KEY), env.WEATHERNOW_KV.delete(KV_FAILED_LOGINS_KEY)]);
            return json({ ok: true });
        }

        return json({ error: 'Not found' }, 404);
    }
}
