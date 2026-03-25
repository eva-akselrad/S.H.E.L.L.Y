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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
    'Cache-Control': 'no-store',
};

const KV_MESSAGES_KEY = 'messages';
const KV_SUBSCRIPTIONS_KEY = 'push_subscriptions';
const KV_RELEASE_NOTES_KEY = 'release_notes';
const KV_CUSTOM_FORECAST_KEY = 'custom_forecast';
const KV_ARMAGEDDON_KEY = 'armageddon';
const KV_MSG_SEQ_KEY = 'msg_next_id'; // persistent counter — never resets on message delete
const KV_ACKS_KEY = 'msg_acks'; // { [msgId]: [visitorId, ...] }
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
        return json(await getCustomForecasts(env));
        const { periods = [], targeting = { mode: 'all' }, label: rawLabel = '' } = await request.json();
        const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
        if (!periods.length) return json({ error: 'periods required' }, 400);
        const forecasts = await getCustomForecasts(env);
        // Replace in-place if a non-empty label already exists, otherwise append
        const existing = label ? forecasts.findIndex(c => c.label === label) : -1;
        const nextId = forecasts.length ? Math.max(...forecasts.map(c => c.id ?? 0)) + 1 : 1;
        const entry = { id: existing >= 0 ? forecasts[existing].id : nextId, label, periods, targeting, updatedAt: Date.now() };
        if (existing >= 0) {
            forecasts[existing] = entry;
        } else {
            forecasts.push(entry);
        }
        await saveCustomForecasts(env, forecasts);
        return json(entry, 201);
    }

    const customFcMatch = path.match(/^\/api\/custom-forecast\/(\d+)$/);
    if (customFcMatch && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        const id = parseInt(customFcMatch[1], 10);
        const forecasts = await getCustomForecasts(env);
        const updated = forecasts.filter(c => c.id !== id);
        if (updated.length === forecasts.length) return json({ error: 'not found' }, 404);
        await saveCustomForecasts(env, updated);
        return json({ ok: true });
        await saveCustomForecasts(env, []);
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
        return json(state ? { active: true, ...state } : { active: false });
    }

    if (path === '/api/armageddon' && method === 'POST') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
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
        return json({ ok: true, ...state });
    }

    if (path === '/api/armageddon' && method === 'DELETE') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401);
        await saveArmageddonState(env, null);
