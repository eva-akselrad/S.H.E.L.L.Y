// Lightning push to the Android app (L4). Pure and tested.
// Like alerts, the server only knows NWS zones, never where a phone is: when a fresh flash lands within
// 10 mi of a zone's outline, it sends ONE small data message to that zone's topic ("z_PAC091") carrying
// the flash point and time. The phone checks its own GPS and decides whether to notify.
import { MIN, type Flash } from "./lightning";
import type { PolygonGeom, Ring } from "./types";

/** a flash this close to a zone's outline reaches the zone's phones */
export const PUSH_RADIUS_MI = 10;
/** one message per zone per 30 minutes */
export const PUSH_COOLDOWN_MS = 30 * MIN;
/** never push a flash older than this: it isn't news */
export const PUSH_MAX_AGE_MS = 10 * MIN;

export interface ZoneOutline {
  zone: string;
  geometry: PolygonGeom;
}

/** zone id → when we last sent to it (ms). Stored in one KV key. */
export type LightningSent = Record<string, number>;

export interface LightningPush {
  zone: string;
  flash: Flash;
}

const MI_PER_DEG = 69.0;

/** Distance in miles from a point to the closest edge of a polygon; 0 when the point is inside. */
export function distanceToRingMi(lat: number, lon: number, ring: Ring): number {
  // local flat projection around the point, fine at the 10 to 30 mile scale
  const kx = MI_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const px = (p: readonly number[]) => ((p[0] as number) - lon) * kx;
  const py = (p: readonly number[]) => ((p[1] as number) - lat) * MI_PER_DEG;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    const ax = px(a), ay = py(a), bx = px(b), by = py(b);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / len2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}

function insideRing(lat: number, lon: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Miles from a point to a zone's outline: 0 when inside the zone. */
export function distanceToGeometryMi(lat: number, lon: number, g: PolygonGeom): number {
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as unknown as Ring[][];
  let best = Infinity;
  for (const rings of polys) {
    const [outer, ...holes] = rings;
    if (!outer) continue;
    if (insideRing(lat, lon, outer) && !holes.some((h) => insideRing(lat, lon, h))) return 0;
    best = Math.min(best, distanceToRingMi(lat, lon, outer));
  }
  return best;
}

/** Cheap pre-check so we only walk the outline of zones a flash could be near. */
function nearBox(lat: number, lon: number, g: PolygonGeom, mi: number): boolean {
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as unknown as Ring[][];
  let s = 90, n = -90, w = 180, e = -180;
  for (const rings of polys) for (const p of rings[0] ?? []) {
    if (p[1]! < s) s = p[1]!;
    if (p[1]! > n) n = p[1]!;
    if (p[0]! < w) w = p[0]!;
    if (p[0]! > e) e = p[0]!;
  }
  const dLat = mi / MI_PER_DEG;
  const dLon = mi / (MI_PER_DEG * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return lat >= s - dLat && lat <= n + dLat && lon >= w - dLon && lon <= e + dLon;
}

/**
 * Which zones get a message now. `fresh` is the flashes that just arrived (not the whole 45-minute list), so a
 * quiet pass costs nothing. A zone is skipped if it was messaged in the last 30 minutes. Each message carries
 * the newest flash within 10 mi of that zone's outline.
 */
export function decideLightningPush(
  fresh: Flash[],
  zones: ZoneOutline[],
  sent: LightningSent,
  now: number,
): { pushes: LightningPush[]; next: LightningSent } {
  const next: LightningSent = {};
  for (const [z, t] of Object.entries(sent)) if (now - t < PUSH_COOLDOWN_MS) next[z] = t;
  const recent = fresh.filter((f) => now - f[2] <= PUSH_MAX_AGE_MS && now - f[2] >= -MIN);
  const pushes: LightningPush[] = [];
  if (!recent.length) return { pushes, next };
  for (const { zone, geometry } of zones) {
    if (next[zone] !== undefined) continue;
    let pick: Flash | null = null;
    for (const f of recent) {
      if (pick && f[2] <= pick[2]) continue;
      if (!nearBox(f[0], f[1], geometry, PUSH_RADIUS_MI)) continue;
      if (distanceToGeometryMi(f[0], f[1], geometry) <= PUSH_RADIUS_MI) pick = f;
    }
    if (pick) pushes.push({ zone, flash: pick });
  }
  return { pushes, next };
}

/** Add the zones we actually delivered to, so only successes start a cooldown (failures retry next pass). */
export function markPushed(next: LightningSent, delivered: LightningPush[], now: number): LightningSent {
  const out = { ...next };
  for (const p of delivered) out[p.zone] = now;
  return out;
}

/** The FCM data message. Numbers as strings (FCM data values are strings). */
export function lightningData(p: LightningPush): Record<string, string> {
  return { type: "lightning", zone: p.zone, lat: p.flash[0].toFixed(2), lon: p.flash[1].toFixed(2), t: String(p.flash[2]) };
}
