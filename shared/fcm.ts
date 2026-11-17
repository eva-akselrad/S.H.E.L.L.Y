// Firebase Cloud Messaging fan-out decisions for the Android app. Pure and tested.
// Phones subscribe to topics named after their NWS zones ("z_PAZ106"); the Worker never stores a location.
// A send is a tiny data message ({type, id, level}); the app then asks /api/glance what to show.
import { alertLevel } from "./threat";
import type { Alert, ThreatLevel } from "./types";

const RANK: Record<ThreatLevel, number> = { CALM: 0, ELEVATED: 1, WARNING: 2, EMERGENCY: 3 };
const ZONE_RE = /^[A-Z]{2}[CZ]\d{3}$/;
/** FCM allows at most 5 topics in one condition */
export const MAX_TOPICS_PER_CONDITION = 5;
const KEEP_AFTER_EXPIRY_MS = 3600_000;

export const zoneTopic = (zone: string): string => `z_${zone}`;

/** Condition strings (each at most 5 topics) that together reach every given zone once. */
export function topicConditions(zones: string[]): string[] {
  const topics = [...new Set(zones.filter((z) => ZONE_RE.test(z)))].map(zoneTopic);
  const out: string[] = [];
  for (let i = 0; i < topics.length; i += MAX_TOPICS_PER_CONDITION) {
    out.push(topics.slice(i, i + MAX_TOPICS_PER_CONDITION).map((t) => `'${t}' in topics`).join(" || "));
  }
  return out;
}

/** alert id → what we already sent for it */
export type FcmSent = Record<string, { rank: number; exp: number }>;

export interface FcmDecision {
  alert: Alert;
  level: ThreatLevel;
  kind: "new" | "upgrade";
}

/** Alerts to send this minute: ELEVATED or higher, not expired, not already sent (updates only on an upgrade). */
export function decideFcmSends(alerts: Alert[], sent: FcmSent, now: number): FcmDecision[] {
  const out: FcmDecision[] = [];
  for (const a of alerts) {
    if (a.expires && Date.parse(a.expires) <= now) continue;
    if (!a.zones.some((z) => ZONE_RE.test(z))) continue; // nothing to target
    const level = alertLevel(a);
    const rank = RANK[level];
    if (rank === 0) continue;
    const prior = Math.max(sent[a.id]?.rank ?? -1, ...(a.references ?? []).map((r) => sent[r]?.rank ?? -1));
    if (prior >= rank) continue;
    out.push({ alert: a, level, kind: prior >= 0 ? "upgrade" : "new" });
  }
  return out.sort((x, y) => RANK[y.level] - RANK[x.level]);
}

/** Record what was sent; drop entries that expired more than an hour ago. */
export function updateFcmSent(sent: FcmSent, sentNow: FcmDecision[], alerts: Alert[], now: number): FcmSent {
  const next: FcmSent = {};
  for (const [id, v] of Object.entries(sent)) if (v.exp + KEEP_AFTER_EXPIRY_MS > now) next[id] = v;
  const expOf = (a: Alert) => (a.expires ? Date.parse(a.expires) : now + 24 * 3600_000);
  for (const d of sentNow) {
    const exp = expOf(d.alert);
    next[d.alert.id] = { rank: RANK[d.level], exp };
    for (const r of d.alert.references ?? []) next[r] = { rank: Math.max(next[r]?.rank ?? 0, RANK[d.level]), exp };
  }
  // a plain re-issue of an alert we already sent stays quiet
  for (const a of alerts) {
    if (next[a.id]) continue;
    const prior = Math.max(-1, ...(a.references ?? []).map((r) => next[r]?.rank ?? -1));
    if (prior >= 0) next[a.id] = { rank: prior, exp: expOf(a) };
  }
  return next;
}
