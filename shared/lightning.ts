// Lightning proximity: pure logic over GOES-19 GLM flashes. No LLM, no network. Every sentence here is a
// deterministic template, and every distance is rounded and called "about": GLM sees total lightning from
// orbit with ~8 km pixels, so it is good for "go inside", not for exact strike points.
import { haversineMi } from "./geo";

/** [lat, lon, time in ms since epoch] */
export type Flash = [lat: number, lon: number, t: number];

export type LightningLevel = "danger" | "nearby" | "clear";
export type LightningTrend = "closer" | "steady" | "away" | null;

export interface LightningState {
  level: LightningLevel;
  /** distance of the closest flash in the last 30 min, whole miles; null when none */
  nearestMi: number | null;
  /** when that closest flash happened (ms) */
  nearestAt: number | null;
  /** most recent flash within 10 mi (ms), looking back 30 min */
  lastWithin10At: number | null;
  /** flashes within 10 mi in the last 10 min; within 25 mi in the last 15 min */
  count10: number;
  count25: number;
  trend: LightningTrend;
  /** 30-minute rule: last flash within 10 mi + 30 min. null when there's nothing to wait for, or data is stale */
  allClearAt: number | null;
  /** the 30-minute wait is still running (so the chip stays up even after the level drops to clear) */
  holding: boolean;
  /** the satellite feed is behind: never claim an all-clear */
  stale: boolean;
}

export const MIN = 60_000;
/** the 30-minute rule from NWS lightning safety guidance */
export const ALL_CLEAR_MS = 30 * MIN;
export const DANGER_MI = 10;
export const NEARBY_MI = 25;
export const DANGER_WINDOW_MS = 10 * MIN;
export const NEARBY_WINDOW_MS = 15 * MIN;
/** no new file for this long means the feed is behind; GOES outages happen */
export const STALE_MS = 5 * MIN;
/** how much history the server keeps */
export const KEEP_MS = 45 * MIN;

const whole = (n: number): number => Math.round(n);

export function emptyState(stale = false): LightningState {
  return { level: "clear", nearestMi: null, nearestAt: null, lastWithin10At: null, count10: 0, count25: 0, trend: null, allClearAt: null, holding: false, stale };
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** What the lightning around one point looks like right now. */
export function lightningNear(flashes: Flash[], lat: number, lon: number, now: number, opts: { stale?: boolean } = {}): LightningState {
  const stale = !!opts.stale;
  let nearest = Infinity;
  let nearestAt: number | null = null;
  let lastWithin10: number | null = null;
  let count10 = 0;
  let count25 = 0;
  const recent: number[] = []; // distances, last 5 min
  const before: number[] = []; // distances, 5 to 15 min ago

  for (const [flat, flon, t] of flashes) {
    const age = now - t;
    if (age < -MIN || age > ALL_CLEAR_MS) continue; // a minute of clock slack, then 30 min of history
    const d = haversineMi(lat, lon, flat, flon);
    if (d < nearest || (d === nearest && nearestAt !== null && t > nearestAt)) {
      nearest = d;
      nearestAt = t;
    }
    if (d <= DANGER_MI) {
      if (lastWithin10 === null || t > lastWithin10) lastWithin10 = t;
      if (age <= DANGER_WINDOW_MS) count10++;
    }
    if (d <= NEARBY_MI && age <= NEARBY_WINDOW_MS) count25++;
    if (d <= 40) {
      if (age <= 5 * MIN) recent.push(d);
      else if (age <= 15 * MIN) before.push(d);
    }
  }

  const dangerNow = lastWithin10 !== null && now - lastWithin10 <= DANGER_WINDOW_MS;
  const level: LightningLevel = dangerNow ? "danger" : count25 > 0 ? "nearby" : "clear";

  let trend: LightningTrend = null;
  if (recent.length && before.length) {
    const delta = mean(recent) - mean(before);
    trend = delta <= -2 ? "closer" : delta >= 2 ? "away" : "steady";
  }

  const clearAt = lastWithin10 === null ? null : lastWithin10 + ALL_CLEAR_MS;
  const holding = clearAt !== null && clearAt > now;
  return {
    level,
    nearestMi: nearest === Infinity ? null : whole(nearest),
    nearestAt,
    lastWithin10At: lastWithin10,
    count10,
    count25,
    trend,
    // stale data can't back an all-clear, so there is no time to promise
    allClearAt: stale || !holding ? null : clearAt,
    holding: holding && !stale,
    stale,
  };
}

/** Should the chip / segment show at all? */
export const lightningActive = (s: LightningState | null | undefined): boolean => !!s && (s.stale ? s.level !== "clear" : s.level !== "clear" || s.holding);

/** 0..1 for the kiosk segment: 1 at danger, 0.6 at nearby (or while the 30-minute wait runs), else 0 */
export function lightningRelevance(s: LightningState | null | undefined): number {
  if (!s || !lightningActive(s)) return 0;
  if (s.level === "danger") return 1;
  return 0.6;
}

/** "about 6 mi" / "overhead" */
export function distanceWords(mi: number): string {
  return mi < 3 ? "overhead" : `about ${whole(mi)} mi`;
}

export function agoWords(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / MIN);
  return m < 1 ? "just now" : m === 1 ? "1 min ago" : `${m} min ago`;
}

const TREND_WORDS = { closer: "moving closer", steady: "holding steady", away: "moving away" } as const;
export const trendWords = (t: LightningTrend): string | null => (t ? TREND_WORDS[t] : null);

export function clockTime(ms: number, tz?: string): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) });
}

/** The chip's main line. */
export function lightningHeadline(s: LightningState, now: number): string {
  if (s.stale) return "Lightning data delayed";
  if (s.nearestMi === null || s.nearestAt === null) return "Lightning nearby";
  const where = s.nearestMi < 3 ? "Lightning overhead" : `Lightning ${distanceWords(s.nearestMi)} away`;
  return `${where}, ${agoWords(now - s.nearestAt)}`;
}

/** The advice line. NWS: when thunder roars, go indoors. */
export function lightningAdvice(s: LightningState, tz?: string): string {
  if (s.stale) return "SHELLY can't see new lightning right now. If you hear thunder, go inside.";
  const wait = s.allClearAt ? ` All clear at ${clockTime(s.allClearAt, tz)} if no more lightning within 10 mi.` : "";
  if (s.level === "danger") return `Stay inside.${wait}`;
  if (s.holding) return `Stay inside a little longer.${wait}`;
  if (s.level === "nearby") {
    const t = trendWords(s.trend);
    return `It could reach you.${t ? ` The lightning is ${t}.` : ""} Be ready to go inside.`;
  }
  return "";
}

export const LIGHTNING_NOTE = "From satellite. Distances are about, not exact. This is not an NWS alert.";

// ── region (Live) ──

export interface RegionLightning {
  city: string;
  state: LightningState;
}

/** The region city with the most urgent lightning, or null when it's all clear (or the feed is behind). */
export function lightningForRegion(
  flashes: Flash[],
  cities: { name: string; lat: number; lon: number }[],
  now: number,
  stale: boolean,
): RegionLightning | null {
  if (stale) return null; // the Live page never talks about data it can't trust
  let best: RegionLightning | null = null;
  const score = (s: LightningState): number => (s.level === "danger" ? 2 : s.level === "nearby" ? 1 : 0);
  for (const c of cities) {
    const state = lightningNear(flashes, c.lat, c.lon, now);
    const sc = score(state);
    if (!sc) continue;
    if (!best || sc > score(best.state) || (sc === score(best.state) && (state.nearestMi ?? 99) < (best.state.nearestMi ?? 99))) best = { city: c.name, state };
  }
  return best;
}

/** "Lightning about 6 miles from Norristown, moving closer." (Live template, never the LLM) */
export function liveLightningLine(r: RegionLightning): string {
  const s = r.state;
  const mi = s.nearestMi ?? 0;
  const dist = mi < 3 ? `over ${r.city}` : `about ${mi} miles from ${r.city}`;
  const t = trendWords(s.trend);
  return `Lightning ${dist}${t ? `, ${t}` : ""}.`;
}

// ── geometry helpers ──

export interface BboxLike {
  south: number;
  west: number;
  north: number;
  east: number;
}

export const inBbox = (b: BboxLike, lat: number, lon: number, buffer = 0): boolean =>
  lat >= b.south - buffer && lat <= b.north + buffer && lon >= b.west - buffer && lon <= b.east + buffer;

/** Flashes within `mi` of a point, for the ring map. */
export function flashesWithin(flashes: Flash[], lat: number, lon: number, mi: number, now: number, maxAgeMs = KEEP_MS): Flash[] {
  return flashes.filter(([flat, flon, t]) => now - t <= maxAgeMs && now - t >= -MIN && haversineMi(lat, lon, flat, flon) <= mi);
}

// ── the stored value and API shape ──

export interface LightningStore {
  /** key of the newest GLM file read */
  lastFile: string | null;
  /** end time (ms) of that file's 20-second window */
  fileAt: number;
  /** when this value was written (ms) */
  updated: number;
  flashes: Flash[];
}

export interface LightningResponse {
  available: boolean;
  stale: boolean;
  /** end of the newest file read (ms), for "updated" labels */
  updated: number | null;
  state: LightningState | null;
  /** flashes within 30 mi of the point, for the ring map */
  flashes: Flash[];
  /** set when lightning isn't tracked here */
  reason?: "outside_region" | "no_data";
}

export const isStale = (fileAt: number, now: number): boolean => !fileAt || now - fileAt > STALE_MS;

/** Drop flashes older than the keep window and cap the count (newest win). */
export function pruneFlashes(flashes: Flash[], now: number, max = 6000): Flash[] {
  const kept = flashes.filter((f) => now - f[2] <= KEEP_MS);
  return kept.length > max ? kept.sort((a, b) => b[2] - a[2]).slice(0, max) : kept;
}

/** Accessible one-liner for the ring map. */
export function ringSummary(s: LightningState, now: number): string {
  if (s.stale) return "Lightning map: satellite data is delayed.";
  if (s.nearestMi === null || s.nearestAt === null) return "Lightning map: no recent lightning within 30 miles.";
  return `Lightning map: ${s.count25} flashes within about 25 miles in the last 15 minutes. Closest ${distanceWords(s.nearestMi)}, ${agoWords(now - s.nearestAt)}.`;
}
