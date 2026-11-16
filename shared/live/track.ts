// Storm tracker: turn the NWS eventMotionDescription of a warning into "here is when it reaches you".
import type { LonLat } from "../types";
import type { Town } from "./towns";

export interface Motion {
  /** when the position was observed */
  at: string;
  /** NWS gives the direction the storm is moving FROM; toDeg is where it is heading */
  fromDeg: number;
  toDeg: number;
  speedKt: number;
  point: LonLat;
}

export interface TrackTown {
  name: string;
  state: string;
  lat: number;
  lon: number;
  etaMin: number;
}

export interface TrackInfo {
  /** storm position now (projected from the observation) */
  origin: LonLat;
  /** where it will be at the end of the line (about an hour out, or the warning's end) */
  end: LonLat;
  bearingDeg: number;
  speedMph: number;
  towns: TrackTown[];
}

const MI_PER_KT = 1.15078;
const MI_LAT = 69.0;
const MI_LON_EQ = 69.172;

/**
 * Parse "2026-05-01T18:00:00-00:00...storm...245DEG...35KT...39.9,-75.2" (several points allowed).
 * Returns null for anything unusable.
 */
export function parseMotion(s: string | undefined | null): Motion | null {
  if (!s) return null;
  const parts = s.split("...");
  if (parts.length < 5) return null;
  const deg = /(\d{1,3})DEG/i.exec(s);
  const kt = /(\d{1,3})KT/i.exec(s);
  const pair = /(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/.exec(parts[parts.length - 1]!);
  if (!deg || !kt || !pair) return null;
  const lat = Number(pair[1]);
  let lon = Number(pair[2]);
  if (lon > 0) lon = -lon; // some feeds drop the sign for the western hemisphere
  const speedKt = Number(kt[1]);
  const fromDeg = Number(deg[1]);
  if (!(lat >= 17 && lat <= 72) || !(lon >= -180 && lon <= -64) || speedKt <= 0 || fromDeg > 360) return null;
  const at = Number.isFinite(Date.parse(parts[0]!)) ? new Date(parts[0]!).toISOString() : "";
  return { at, fromDeg, toDeg: (fromDeg + 180) % 360, speedKt, point: [lon, lat] };
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Offset a point by miles along a bearing (flat-earth, accurate at storm scale). */
export function advance(p: LonLat, bearingDeg: number, miles: number): LonLat {
  const b = rad(bearingDeg);
  const dN = Math.cos(b) * miles;
  const dE = Math.sin(b) * miles;
  return [p[0] + dE / (MI_LON_EQ * Math.cos(rad(p[1]))), p[1] + dN / MI_LAT];
}

/**
 * Project the storm forward and list the towns in its path with ETAs in minutes.
 * A town is in the path when it is ahead of the storm (or right under it) and within a cone that
 * widens with distance. Only towns reached before the warning ends (plus 10 minutes) are kept.
 */
export function trackStorm(m: Motion, towns: Town[], now: number, expires: string | null, maxTowns = 6): TrackInfo {
  const mph = m.speedKt * MI_PER_KT;
  const elapsedMin = m.at ? Math.min(30, Math.max(0, (now - Date.parse(m.at)) / 60000)) : 0;
  const origin = advance(m.point, m.toDeg, (mph * elapsedMin) / 60);
  const minsLeft = expires ? Math.max(0, (Date.parse(expires) - now) / 60000) : 45;
  const horizonMin = Math.min(75, minsLeft + 10);
  const maxAlong = (mph * horizonMin) / 60;
  const b = rad(m.toDeg);
  const cosLat = Math.cos(rad(origin[1]));

  const hits: TrackTown[] = [];
  for (const t of towns) {
    const dx = (t.lon - origin[0]) * cosLat * MI_LON_EQ;
    const dy = (t.lat - origin[1]) * MI_LAT;
    const along = dx * Math.sin(b) + dy * Math.cos(b);
    const cross = Math.abs(dx * Math.cos(b) - dy * Math.sin(b));
    if (along < -3 || along > maxAlong) continue;
    if (cross > 6 + 0.12 * Math.max(0, along)) continue;
    hits.push({ name: t.name, state: t.state, lat: t.lat, lon: t.lon, etaMin: Math.max(0, Math.round(along / (mph / 60))) });
  }
  hits.sort((a, c) => a.etaMin - c.etaMin);
  return {
    origin,
    end: advance(origin, m.toDeg, maxAlong),
    bearingDeg: m.toDeg,
    speedMph: Math.round(mph),
    towns: hits.slice(0, maxTowns),
  };
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
export const compass = (deg: number): string => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
const ABBR = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const abbr = (deg: number): string => ABBR[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;

/** Deterministic spoken text for a storm track (built only from NWS motion data). */
export function trackScript(info: TrackInfo): string {
  const head = `The storm is moving ${compass(info.bearingDeg)} at ${info.speedMph} miles per hour.`;
  const list = info.towns.slice(0, 4).map((t) => (t.etaMin <= 1 ? `${t.name} right now` : `${t.name} in about ${t.etaMin} minutes`));
  if (!list.length) return head;
  return `${head} It could reach ${list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`}.`;
}

export function trackHeadline(info: TrackInfo): string {
  const first = info.towns[0];
  const base = `STORM MOVING ${abbr(info.bearingDeg)} AT ${info.speedMph} MPH`;
  return first ? `${base}: ${first.name.toUpperCase()} ${first.etaMin <= 1 ? "NOW" : `IN ${first.etaMin} MIN`}` : base;
}
