// Storm arrival at YOUR address, and "the warning misses you by 3 mi".
// Built only from NWS data (warning polygon + eventMotionDescription).
import { pointInGeometry } from "./geo";
import { advance, compass, parseMotion } from "./live/track";
import { alertLevel } from "./threat";
import type { Alert, PolygonGeom, Ring } from "./types";

const MI_PER_KT = 1.15078;
const MI_LAT = 69.0;
const MI_LON_EQ = 69.172;
const rad = (d: number) => (d * Math.PI) / 180;

export interface PointEta {
  /** minutes until the storm reaches the point (0 = it's here) */
  etaMin: number;
  /** clock time of arrival, ISO */
  at: string;
  /** how far to the side of the storm's centre line the point is, miles */
  offsetMi: number;
  direction: string;
  speedMph: number;
}

/**
 * When does the storm in this warning reach the point? Null when the warning carries no motion,
 * the storm is moving away, or the point is outside its path cone.
 */
export function etaToPoint(a: Alert, lat: number, lon: number, now: number): PointEta | null {
  const m = parseMotion(a.params.eventMotionDescription);
  if (!m) return null;
  const mph = m.speedKt * MI_PER_KT;
  const elapsedMin = m.at ? Math.min(30, Math.max(0, (now - Date.parse(m.at)) / 60000)) : 0;
  const origin = advance(m.point, m.toDeg, (mph * elapsedMin) / 60);
  const cosLat = Math.cos(rad(origin[1]));
  const dx = (lon - origin[0]) * cosLat * MI_LON_EQ;
  const dy = (lat - origin[1]) * MI_LAT;
  const b = rad(m.toDeg);
  const along = dx * Math.sin(b) + dy * Math.cos(b);
  const cross = Math.abs(dx * Math.cos(b) - dy * Math.sin(b));
  if (along < -3) return null; // already passed
  if (along > 120) return null; // too far to call
  if (cross > 6 + 0.12 * Math.max(0, along)) return null;
  const etaMin = Math.max(0, Math.round(along / (mph / 60)));
  return {
    etaMin,
    at: new Date(now + etaMin * 60_000).toISOString(),
    offsetMi: Math.round(cross * 10) / 10,
    direction: compass(m.toDeg),
    speedMph: Math.round(mph),
  };
}

/** Shortest distance in miles from a point to the edge of a polygon (0 if inside). */
export function distanceToGeometryMi(lat: number, lon: number, g: PolygonGeom): number {
  if (pointInGeometry(lon, lat, g)) return 0;
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as unknown as Ring[][];
  const cosLat = Math.cos(rad(lat));
  const toXY = (p: [number, number]): [number, number] => [(p[0] - lon) * cosLat * MI_LON_EQ, (p[1] - lat) * MI_LAT];
  let best = Number.POSITIVE_INFINITY;
  for (const rings of polys) {
    const outer = rings[0];
    if (!outer) continue;
    for (let i = 0; i < outer.length - 1; i++) {
      const [ax, ay] = toXY(outer[i]!);
      const [bx, by] = toXY(outer[i + 1]!);
      const vx = bx - ax;
      const vy = by - ay;
      const len2 = vx * vx + vy * vy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len2)) : 0;
      const px = ax + t * vx;
      const py = ay + t * vy;
      best = Math.min(best, Math.hypot(px, py));
    }
  }
  return best;
}

/** Bearing (degrees) from the point to the polygon's centre, used for "to your west". */
function bearingTo(lat: number, lon: number, g: PolygonGeom): number {
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as unknown as Ring[][];
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const rings of polys) for (const p of rings[0] ?? []) {
    sx += (p[0] - lon) * Math.cos(rad(lat));
    sy += p[1] - lat;
    n++;
  }
  if (!n) return 0;
  return ((Math.atan2(sx / n, sy / n) * 180) / Math.PI + 360) % 360;
}

export interface NearbyWarning {
  alert: Alert;
  distanceMi: number;
  /** compass word for where the warning is, seen from you: "west" */
  side: string;
  /** set when the storm is heading your way */
  eta: PointEta | null;
}

/**
 * Warnings with a polygon that do NOT cover the point but are within `maxMi`.
 * Used for "Tornado Warning 4 mi to your west. It does not cover you."
 */
export function nearbyWarnings(alerts: Alert[], lat: number, lon: number, now: number, maxMi = 25): NearbyWarning[] {
  const out: NearbyWarning[] = [];
  for (const a of alerts) {
    if (!a.geometry) continue;
    if (a.expires && Date.parse(a.expires) <= now) continue;
    const lvl = alertLevel(a);
    if (lvl !== "WARNING" && lvl !== "EMERGENCY") continue;
    const d = distanceToGeometryMi(lat, lon, a.geometry);
    if (d === 0 || d > maxMi) continue;
    out.push({ alert: a, distanceMi: Math.round(d * 10) / 10, side: compass(bearingTo(lat, lon, a.geometry)), eta: etaToPoint(a, lat, lon, now) });
  }
  return out.sort((x, y) => x.distanceMi - y.distanceMi);
}

/** Short clock time in the viewer's zone, e.g. "7:42 PM". */
export function clock(iso: string, tz?: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) });
}

export function etaLine(e: PointEta, tz?: string): string {
  if (e.etaMin <= 1) return "The storm is over you now.";
  return `Storm reaches you in about ${e.etaMin} min (${clock(e.at, tz)}).`;
}

export function nearbyLine(n: NearbyWarning): string {
  const d = n.distanceMi < 1 ? "less than 1 mi" : `${Math.round(n.distanceMi)} mi`;
  const base = `${n.alert.event} ${d} to your ${n.side}. It does not cover you right now.`;
  return n.eta ? `${base} The storm is moving toward you: about ${n.eta.etaMin} min away.` : base;
}
