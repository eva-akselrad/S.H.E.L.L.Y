// "Never fail silently": decide whether the alert data on a screen can be trusted right now.

/** Alerts older than this are called out on every screen. */
export const STALE_AFTER_MS = 3 * 60_000;

export interface AlertHealth {
  ok: boolean;
  /** why the data is not trustworthy, in plain words (empty when ok) */
  reason: "" | "never_loaded" | "feed_stale" | "unreachable";
  /** age of the newest alert data we have, ms (null when we have none) */
  ageMs: number | null;
}

/**
 * @param serverUpdated when the SHELLY server last pulled alerts from NWS (ISO), from /api/alerts
 * @param lastOkAt      when this screen last got an answer from /api/alerts (ms epoch), or null
 * @param now           ms epoch
 */
export function alertHealth(serverUpdated: string | null, lastOkAt: number | null, now: number): AlertHealth {
  if (lastOkAt === null) return { ok: false, reason: "never_loaded", ageMs: null };
  const fetchAge = now - lastOkAt;
  const serverAge = serverUpdated ? now - Date.parse(serverUpdated) : Number.POSITIVE_INFINITY;
  const ageMs = Math.max(fetchAge, Number.isFinite(serverAge) ? serverAge : fetchAge);
  if (fetchAge > STALE_AFTER_MS) return { ok: false, reason: "unreachable", ageMs };
  if (!Number.isFinite(serverAge) || serverAge > STALE_AFTER_MS) {
    return { ok: false, reason: "feed_stale", ageMs: Number.isFinite(serverAge) ? serverAge : null };
  }
  return { ok: true, reason: "", ageMs };
}

export function healthMessage(h: AlertHealth): string {
  if (h.ok) return "";
  const mins = h.ageMs === null ? null : Math.max(1, Math.round(h.ageMs / 60_000));
  const since = mins === null ? "" : ` Last good data is ${mins} min old.`;
  if (h.reason === "never_loaded") return "Alerts haven't loaded yet. Check a second source if weather is threatening.";
  if (h.reason === "unreachable") return `Can't reach SHELLY's alert feed. Alerts may be delayed.${since}`;
  return `The National Weather Service feed is delayed. Alerts may be late.${since}`;
}

// ── alert latency: NWS "sent" → SHELLY has it ──

export interface LatencySample {
  /** when SHELLY first saw it */
  t: string;
  event: string;
  /** ms from NWS "sent" to first seen */
  ms: number;
}

/** Samples for alerts that are new in this poll. Ignores clock skew and anything older than 30 min. */
export function latencySamples(prevIds: Set<string>, alerts: { id: string; event: string; sent: string }[], now: number): LatencySample[] {
  const out: LatencySample[] = [];
  for (const a of alerts) {
    if (prevIds.has(a.id)) continue;
    const ms = now - Date.parse(a.sent);
    if (!Number.isFinite(ms) || ms < -60_000 || ms > 30 * 60_000) continue;
    out.push({ t: new Date(now).toISOString(), event: a.event, ms: Math.max(0, ms) });
  }
  return out;
}

export interface LatencyStats {
  count: number;
  medianS: number | null;
  p90S: number | null;
  worstS: number | null;
  /** warnings only, which are the ones that matter */
  warningsMedianS: number | null;
}

export function latencyStats(samples: LatencySample[], since = 0): LatencyStats {
  const pick = (list: LatencySample[]) => list.map((s) => s.ms).sort((a, b) => a - b);
  const q = (v: number[], p: number) => (v.length ? Math.round(v[Math.min(v.length - 1, Math.floor((v.length - 1) * p + 0.5))]! / 1000) : null);
  const recent = samples.filter((s) => Date.parse(s.t) >= since);
  const all = pick(recent);
  const warn = pick(recent.filter((s) => /warning/i.test(s.event)));
  return { count: all.length, medianS: q(all, 0.5), p90S: q(all, 0.9), worstS: all.length ? Math.round(all[all.length - 1]! / 1000) : null, warningsMedianS: q(warn, 0.5) };
}

/** "3 min ago", "just now", "2 h ago" */
export function agoText(iso: string | number | null | undefined, now: number): string {
  if (iso === null || iso === undefined || iso === "") return "";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
