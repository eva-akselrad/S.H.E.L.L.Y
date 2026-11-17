// Push subscriptions + the per-minute fan-out after each alert poll.
// Off (fail-closed) until VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set as Worker secrets.
import { localHour } from "../shared/nowcast";
import { decidePushes, pushPayload, updateSentLog, validEndpoint, type PushSub, type SentLog } from "../shared/push";
import type { Alert } from "../shared/types";
import { sendPush, type VapidKeys } from "./webpush";

const SUBS_KEY = "push:subs";
const SENT_KEY = "push:sent";
const MAX_SUBS = 500;

export function vapid(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_EMAIL || "mailto:nws@evaakselrad.com" };
}

export async function readSubs(env: Env): Promise<PushSub[]> {
  return (await env.STATE.get<PushSub[]>(SUBS_KEY, "json")) ?? [];
}
async function writeSubs(env: Env, list: PushSub[]): Promise<void> {
  await env.STATE.put(SUBS_KEY, JSON.stringify(list.slice(0, MAX_SUBS)));
}

async function subId(endpoint: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  return [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (data: unknown, status = 200): Response => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const hour = (v: unknown): number | null => (v === null ? null : Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23 ? (v as number) : null);

/** /api/push/* — public, rate of change is tiny (one write per subscribe). */
export async function handlePush(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/push/")) return null;
  const keys = vapid(env);

  if (url.pathname === "/api/push/key") {
    // 200 either way so browsers don't log an error on every page load when push is off
    return json({ key: keys?.publicKey ?? null });
  }
  if (!keys) return json({ error: "push_not_configured" }, 404);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const b = await request.json().catch(() => null);
  if (!isObj(b)) return json({ error: "bad_request" }, 400);

  if (url.pathname === "/api/push/unsubscribe") {
    if (typeof b.endpoint !== "string") return json({ error: "bad_request" }, 400);
    const id = await subId(b.endpoint);
    const list = await readSubs(env);
    if (list.some((s) => s.id === id)) await writeSubs(env, list.filter((s) => s.id !== id));
    return json({ ok: true });
  }

  if (url.pathname === "/api/push/subscribe") {
    const sub = isObj(b.subscription) ? b.subscription : {};
    const k = isObj(sub.keys) ? sub.keys : {};
    const place = isObj(b.place) ? b.place : {};
    const prefs = isObj(b.prefs) ? b.prefs : {};
    if (!validEndpoint(sub.endpoint)) return json({ error: "bad_endpoint" }, 400);
    if (typeof k.p256dh !== "string" || typeof k.auth !== "string" || k.p256dh.length > 200 || k.auth.length > 100) {
      return json({ error: "bad_keys" }, 400);
    }
    const lat = Number(place.lat);
    const lon = Number(place.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 17 || lat > 72 || lon < -180 || lon > -64) {
      return json({ error: "bad_location" }, 400);
    }
    const zones = Array.isArray(place.zones)
      ? place.zones.filter((z): z is string => typeof z === "string" && /^[A-Z]{2}[CZ]\d{3}$/.test(z)).slice(0, 4)
      : [];
    const id = await subId(sub.endpoint);
    const record: PushSub = {
      id,
      endpoint: sub.endpoint,
      keys: { p256dh: k.p256dh, auth: k.auth },
      lat: Math.round(lat * 1000) / 1000,
      lon: Math.round(lon * 1000) / 1000,
      zones,
      name: typeof place.name === "string" ? place.name.slice(0, 60) : "your location",
      tz: typeof place.tz === "string" && place.tz.length < 60 ? place.tz : "America/New_York",
      prefs: {
        watches: prefs.watches === true,
        quietStart: hour(prefs.quietStart ?? 22),
        quietEnd: hour(prefs.quietEnd ?? 7),
      },
      created: new Date().toISOString(),
    };
    const list = (await readSubs(env)).filter((s) => s.id !== id);
    if (list.length >= MAX_SUBS) return json({ error: "too_many_subscribers" }, 503);
    await writeSubs(env, [record, ...list]);
    return json({ ok: true, id });
  }
  return json({ error: "not_found" }, 404);
}

/** After each successful poll: push new or upgraded alerts that cover each subscriber's point. */
export async function fanOutPushes(env: Env, alerts: Alert[], now = Date.now()): Promise<{ sent: number; failed: number; removed: number }> {
  const keys = vapid(env);
  const result = { sent: 0, failed: 0, removed: 0 };
  if (!keys) return result;
  const subs = await readSubs(env);
  if (!subs.length) return result;
  const sentAll = (await env.STATE.get<Record<string, SentLog>>(SENT_KEY, "json")) ?? {};
  const nextAll: Record<string, SentLog> = {};
  const gone = new Set<string>();
  let changed = false;

  await Promise.all(
    subs.map(async (sub) => {
      const prev = sentAll[sub.id] ?? {};
      const hr = localHour(sub.tz, new Date(now));
      const todo = decidePushes(alerts, sub, prev, hr, now);
      const delivered = [];
      for (const d of todo) {
        try {
          const r = await sendPush(sub, pushPayload(d, sub, hr, now), keys, {
            ttl: d.level === "ELEVATED" ? 3 * 3600 : 1800,
            urgency: d.level === "ELEVATED" ? "normal" : "high",
          });
          if (r.ok) {
            delivered.push(d);
            result.sent++;
          } else {
            result.failed++;
            if (r.gone) gone.add(sub.id);
            console.error(JSON.stringify({ msg: "push_failed", status: r.status }));
          }
        } catch (err) {
          result.failed++;
          console.error(JSON.stringify({ msg: "push_error", err: String(err) }));
        }
      }
      const next = updateSentLog(prev, alerts, delivered);
      if (JSON.stringify(next) !== JSON.stringify(prev)) changed = true;
      nextAll[sub.id] = next;
    }),
  );

  if (gone.size) {
    result.removed = gone.size;
    await writeSubs(env, subs.filter((s) => !gone.has(s.id)));
  }
  if (changed || gone.size) await env.STATE.put(SENT_KEY, JSON.stringify(nextAll));
  return result;
}

/** Admin: send a test notification to every subscriber. */
export async function sendTestPush(env: Env): Promise<{ sent: number; failed: number; total: number }> {
  const keys = vapid(env);
  if (!keys) return { sent: 0, failed: 0, total: 0 };
  const subs = await readSubs(env);
  let sent = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (s) => {
      const r = await sendPush(s, { title: "SHELLY test alert", body: `Push alerts work for ${s.name}. This is only a test.`, tag: "shelly-test", level: "CALM", url: "/" }, keys, { ttl: 600 }).catch(() => null);
      if (r?.ok) sent++;
      else failed++;
    }),
  );
  return { sent, failed, total: subs.length };
}

/** Admin: an announcement with admin-written text to every web subscriber. */
export async function sendCustomPush(env: Env, title: string, body: string): Promise<{ sent: number; failed: number; total: number }> {
  const keys = vapid(env);
  if (!keys) return { sent: 0, failed: 0, total: 0 };
  const subs = await readSubs(env);
  let sent = 0;
  let failed = 0;
  const tag = `shelly-note-${Date.now()}`;
  await Promise.all(
    subs.map(async (s) => {
      const r = await sendPush(s, { title, body, tag, level: "CALM", url: "/" }, keys, { ttl: 3600 }).catch(() => null);
      if (r?.ok) sent++;
      else failed++;
    }),
  );
  return { sent, failed, total: subs.length };
}
