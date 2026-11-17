// Firebase Cloud Messaging (HTTP v1) for the Android app. Plain fetch + WebCrypto, no SDK.
// Off (a no-op) until the FCM_SERVICE_ACCOUNT secret is set. FCM only delivers; the Worker decides.
import { decideFcmSends, topicConditions, updateFcmSent, type FcmDecision, type FcmSent } from "../shared/fcm";
import type { Alert } from "../shared/types";
import { b64urlEncode } from "./webpush";

const SENT_KEY = "fcm:sent";
const TOKEN_KEY = "fcm:token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** requests per cron run; the rest go out next minute because they are not marked sent */
const MAX_REQUESTS_PER_RUN = 300;

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function serviceAccount(env: Env): ServiceAccount | null {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  try {
    const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT) as Partial<ServiceAccount>;
    if (!sa.project_id || !sa.client_email || !sa.private_key) return null;
    return { project_id: sa.project_id, client_email: sa.client_email, private_key: sa.private_key };
  } catch {
    return null;
  }
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** RS256 JWT that Google exchanges for an access token. */
export async function signServiceJwt(sa: ServiceAccount, now = Date.now()): Promise<string> {
  const enc = new TextEncoder();
  const iat = Math.floor(now / 1000);
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64urlEncode(sig)}`;
}

async function accessToken(env: Env, sa: ServiceAccount, now = Date.now()): Promise<string> {
  const hit = await env.STATE.get<{ token: string; exp: number }>(TOKEN_KEY, "json");
  if (hit && hit.exp > now + 60_000) return hit.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await signServiceJwt(sa, now) }),
  });
  if (!res.ok) throw new Error(`fcm_token_${res.status}`);
  const d = (await res.json()) as { access_token: string; expires_in?: number };
  const exp = now + Math.min(d.expires_in ?? 3600, 3000) * 1000; // refresh ~50 min in
  await env.STATE.put(TOKEN_KEY, JSON.stringify({ token: d.access_token, exp }), { expirationTtl: 3600 });
  return d.access_token;
}

interface Target {
  condition?: string;
  topic?: string;
}

async function send(token: string, sa: ServiceAccount, target: Target, data: Record<string, string>, high: boolean): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    // data only (no `notification` block) so the app decides what to show from /api/glance
    body: JSON.stringify({ message: { ...target, data, android: { priority: high ? "HIGH" : "NORMAL", ttl: high ? "1800s" : "10800s" } } }),
  });
  return { ok: res.ok, status: res.status };
}

/** After each poll: send new or upgraded alerts to the topics of the zones they cover. */
export async function fanOutFcm(env: Env, alerts: Alert[], now = Date.now()): Promise<{ sent: number; failed: number }> {
  const result = { sent: 0, failed: 0 };
  const sa = serviceAccount(env);
  if (!sa) return result;
  const sent = (await env.STATE.get<FcmSent>(SENT_KEY, "json")) ?? {};
  const todo = decideFcmSends(alerts, sent, now);
  if (!todo.length) {
    const pruned = updateFcmSent(sent, [], alerts, now);
    if (JSON.stringify(pruned) !== JSON.stringify(sent)) await env.STATE.put(SENT_KEY, JSON.stringify(pruned));
    return result;
  }
  const token = await accessToken(env, sa, now);
  const delivered: FcmDecision[] = [];
  let requests = 0;
  for (const d of todo) {
    const conditions = topicConditions(d.alert.zones);
    if (requests + conditions.length > MAX_REQUESTS_PER_RUN) break;
    let allOk = true;
    for (const condition of conditions) {
      requests++;
      try {
        const r = await send(token, sa, { condition }, { type: "alert", id: d.alert.id.slice(0, 200), level: d.level }, d.level !== "ELEVATED");
        if (r.ok) result.sent++;
        else {
          allOk = false;
          result.failed++;
          console.error(JSON.stringify({ msg: "fcm_failed", status: r.status }));
        }
      } catch (err) {
        allOk = false;
        result.failed++;
        console.error(JSON.stringify({ msg: "fcm_error", err: String(err) }));
      }
    }
    if (allOk) delivered.push(d);
  }
  await env.STATE.put(SENT_KEY, JSON.stringify(updateFcmSent(sent, delivered, alerts, now)));
  return result;
}

/** Admin: a test message to every phone running the app (topic "all"). */
export async function sendTestFcm(env: Env): Promise<boolean> {
  const sa = serviceAccount(env);
  if (!sa) return false;
  const token = await accessToken(env, sa);
  return (await send(token, sa, { topic: "all" }, { type: "test" }, true)).ok;
}
