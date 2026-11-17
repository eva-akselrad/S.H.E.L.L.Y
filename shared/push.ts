// Polygon-precise push alerts: decide which alerts to send to which subscriber. Pure and tested.
// Rules:
//  - an alert must cover the subscriber's point (warning POLYGON when it has one; zones only for alerts
//    NWS issues without a polygon, like most watches and advisories)
//  - warnings and emergencies always push, even in quiet hours
//  - watches/advisories push only if the subscriber opted in, and never in quiet hours
//  - one push per alert; NWS updates (which carry a new id + references) push again only on an upgrade
import { actionFor } from "./actions";
import { etaLine, etaToPoint } from "./eta";
import { alertCoversPoint, alertLevel } from "./threat";
import type { Alert, ThreatLevel } from "./types";

export interface PushPrefs {
  /** also send watches and advisories */
  watches: boolean;
  /** quiet hours for watches/advisories, local hours 0..23; null = never quiet */
  quietStart: number | null;
  quietEnd: number | null;
}

export interface PushSub {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  lat: number;
  lon: number;
  zones: string[];
  name: string;
  tz: string;
  prefs: PushPrefs;
  created: string;
}

/** alert id → threat rank we last pushed for it */
export type SentLog = Record<string, number>;

const RANK: Record<ThreatLevel, number> = { CALM: 0, ELEVATED: 1, WARNING: 2, EMERGENCY: 3 };

export function inQuietHours(prefs: PushPrefs, hour: number): boolean {
  const { quietStart: s, quietEnd: e } = prefs;
  if (s === null || e === null || s === e) return false;
  return s < e ? hour >= s && hour < e : hour >= s || hour < e;
}

export interface PushDecision {
  alert: Alert;
  level: ThreatLevel;
  kind: "new" | "upgrade";
}

/**
 * @param hour local hour at the subscriber's place
 */
export function decidePushes(alerts: Alert[], sub: PushSub, sent: SentLog, hour: number, now: number, max = 3): PushDecision[] {
  const out: PushDecision[] = [];
  const point = { lat: sub.lat, lon: sub.lon, zones: sub.zones };
  for (const a of alerts) {
    if (a.expires && Date.parse(a.expires) <= now) continue;
    if (!alertCoversPoint(a, point)) continue;
    const level = alertLevel(a);
    const rank = RANK[level];
    if (rank === 0) continue;
    if (rank === 1 && (!sub.prefs.watches || inQuietHours(sub.prefs, hour))) continue;
    const prior = Math.max(sent[a.id] ?? -1, ...(a.references ?? []).map((r) => sent[r] ?? -1));
    if (prior >= rank) continue;
    out.push({ alert: a, level, kind: prior >= 0 ? "upgrade" : "new" });
  }
  return out.sort((x, y) => RANK[y.level] - RANK[x.level]).slice(0, max);
}

/** Record what was sent and forget alerts that are no longer active. */
export function updateSentLog(sent: SentLog, alerts: Alert[], pushed: PushDecision[]): SentLog {
  const next: SentLog = {};
  const active = new Set(alerts.flatMap((a) => [a.id, ...(a.references ?? [])]));
  for (const [id, r] of Object.entries(sent)) if (active.has(id)) next[id] = r;
  for (const p of pushed) {
    next[p.alert.id] = RANK[p.level];
    // carry the rank to the ids this update replaces, so a later re-issue isn't "new" again
    for (const r of p.alert.references ?? []) next[r] = Math.max(next[r] ?? 0, RANK[p.level]);
  }
  // also mark updates of already-pushed alerts, so the plain re-issue of the same warning stays quiet
  for (const a of alerts) {
    const prior = Math.max(-1, ...(a.references ?? []).map((r) => next[r] ?? -1));
    if (prior >= 0 && next[a.id] === undefined) next[a.id] = prior;
  }
  return next;
}

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  level: ThreatLevel;
  url: string;
}

function untilText(expires: string | null, tz: string): string {
  if (!expires) return "";
  return ` Until ${new Date(expires).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })}.`;
}

/** Notification text. Deterministic templates from NWS data only (never LLM text). */
export function pushPayload(d: PushDecision, sub: PushSub, hour: number, now: number): PushPayload {
  const a = d.alert;
  const card = actionFor(a, hour);
  const eta = etaToPoint(a, sub.lat, sub.lon, now);
  const lines = [
    card ? card.title : a.headline || a.event,
    eta ? etaLine(eta, sub.tz) : "",
    card?.steps[0] ?? "",
  ].filter(Boolean);
  const prefix = d.level === "EMERGENCY" ? "EMERGENCY: " : d.kind === "upgrade" ? "Upgraded: " : "";
  return {
    title: `${prefix}${a.event} for ${sub.name}`.slice(0, 120),
    body: `${lines.join(" ")}${untilText(a.expires, sub.tz)}`.slice(0, 300),
    tag: (a.references?.[0] ?? a.id).slice(-60),
    level: d.level,
    url: "/",
  };
}

/** Push services browsers actually use. Anything else is refused (no open relay). */
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  ".push.apple.com",
  ".notify.windows.com",
  "push.services.mozilla.com",
];

export function validEndpoint(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 1000) return false;
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return false;
    return PUSH_HOSTS.some((h) => (h.startsWith(".") ? url.hostname.endsWith(h) : url.hostname === h));
  } catch {
    return false;
  }
}
