// Forecaster Studio product shapes (docs/LIVE_PLAN.md, Part B). Types plus a
// tolerant normalizer for the product list; the editors and views come in L4+.
import type { Bbox, LonLat, PolygonGeom } from "./types";

export type StudioProductId = string;
export const STUDIO_KINDS = ["riskMap", "totalsMap", "cityTemps", "sevenDay", "timeline", "discussion", "stormTrack"] as const;
export type StudioKind = (typeof STUDIO_KINDS)[number];
export const MAX_STUDIO_PRODUCTS = 50;

/** SHELLY's own risk names, deliberately not SPC's labels. */
export const RISK_LEVELS = ["low", "some", "moderate", "high", "extreme"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const HAZARDS = ["tornado", "wind", "hail", "flood", "winter", "heat"] as const;
export type Hazard = (typeof HAZARDS)[number];

export interface RiskArea {
  level: RiskLevel;
  hazard: Hazard;
  geometry: PolygonGeom;
}
export interface RiskMap {
  areas: RiskArea[];
}

export interface TotalsBand {
  min: number;
  max: number | null;
  geometry: PolygonGeom;
}
export interface TotalsMap {
  kind: "snow" | "rain";
  mode: "draw" | "model";
  bands: TotalsBand[];
}

export interface CityTemp {
  name: string;
  lat: number;
  lon: number;
  value: number;
}
export interface CityTemps {
  metric: "high" | "low" | "feelsLike";
  cities: CityTemp[];
}

export interface SevenDayDay {
  date: string;
  hi: number;
  lo: number;
  pop: number;
  /** WMO weather code; picks the icon */
  code: number;
  note?: string;
  /** the forecaster changed this day from the model, so the graphic marks it */
  edited?: boolean;
}
export interface SevenDay {
  place: string;
  days: SevenDayDay[];
}

export interface TimelineBlock {
  hour: string;
  hazard: Hazard | "none";
  intensity: 0 | 1 | 2 | 3;
}
export interface Timeline {
  rows: { city: string; blocks: TimelineBlock[] }[];
}

export interface Discussion {
  text: string;
  /** an LLM draft is never published until the forecaster edits and approves it */
  draft: boolean;
}

export interface StormTrack {
  alertId: string;
  origin: LonLat;
  bearingDeg: number;
  speedKt: number;
  at: string;
  towns: { name: string; etaMin: number }[];
}

export type StudioBody = RiskMap | TotalsMap | CityTemps | SevenDay | Timeline | Discussion | StormTrack;

export interface StudioProduct {
  id: StudioProductId;
  kind: StudioKind;
  title: string;
  validFrom: string;
  validTo: string;
  region: Bbox;
  published: boolean;
  /** "auto" = generated from model data rather than hand-drawn */
  author: "forecaster" | "auto";
  body: StudioBody;
  updated: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const iso = (v: unknown): string | null => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);


const num = (v: unknown, d = 0): number => (v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const txt = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

function validGeom(g: unknown): PolygonGeom | null {
  if (!isObj(g) || (g.type !== "Polygon" && g.type !== "MultiPolygon") || !Array.isArray(g.coordinates)) return null;
  let points = 0;
  const ok = (c: unknown, depth: number): boolean => {
    if (!Array.isArray(c)) return false;
    if (depth === 0) {
      points++;
      return c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);
    }
    return c.every((x) => ok(x, depth - 1));
  };
  const depth = g.type === "Polygon" ? 2 : 3;
  return ok(g.coordinates, depth) && points >= 3 && points <= 5000 ? (g as unknown as PolygonGeom) : null;
}

/** Coerce an untrusted body into the right shape for its kind, or null if unusable. */
export function normalizeBody(kind: StudioKind, raw: unknown): StudioBody | null {
  if (!isObj(raw)) return null;
  switch (kind) {
    case "riskMap": {
      const areas: RiskArea[] = [];
      for (const a of Array.isArray(raw.areas) ? raw.areas.slice(0, 60) : []) {
        if (!isObj(a)) continue;
        const geometry = validGeom(a.geometry);
        if (!geometry || !(RISK_LEVELS as readonly unknown[]).includes(a.level)) continue;
        areas.push({ level: a.level as RiskLevel, hazard: (HAZARDS as readonly unknown[]).includes(a.hazard) ? (a.hazard as Hazard) : "wind", geometry });
      }
      return { areas };
    }
    case "totalsMap": {
      const bands: TotalsBand[] = [];
      for (const b of Array.isArray(raw.bands) ? raw.bands.slice(0, 40) : []) {
        if (!isObj(b)) continue;
        const geometry = validGeom(b.geometry);
        if (!geometry) continue;
        bands.push({ min: num(b.min), max: b.max === null || b.max === undefined ? null : num(b.max), geometry });
      }
      return { kind: raw.kind === "rain" ? "rain" : "snow", mode: raw.mode === "model" ? "model" : "draw", bands };
    }
    case "cityTemps": {
      const cities: CityTemp[] = [];
      for (const c of Array.isArray(raw.cities) ? raw.cities.slice(0, 60) : []) {
        if (!isObj(c) || !txt(c.name, 40)) continue;
        const lat = Number(c.lat), lon = Number(c.lon), value = Number(c.value);
        if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(value)) cities.push({ name: txt(c.name, 40), lat, lon, value });
      }
      return { metric: raw.metric === "low" || raw.metric === "feelsLike" ? raw.metric : "high", cities };
    }
    case "sevenDay": {
      const days: SevenDayDay[] = [];
      for (const d of Array.isArray(raw.days) ? raw.days.slice(0, 10) : []) {
        if (!isObj(d) || !txt(d.date, 10)) continue;
        days.push({
          date: txt(d.date, 10), hi: Math.round(num(d.hi)), lo: Math.round(num(d.lo)), pop: Math.min(100, Math.max(0, Math.round(num(d.pop)))),
          code: Math.round(num(d.code)), ...(txt(d.note, 80) ? { note: txt(d.note, 80) } : {}), ...(d.edited === true ? { edited: true } : {}),
        });
      }
      return { place: txt(raw.place, 60), days };
    }
    case "timeline": {
      const rows: Timeline["rows"] = [];
      for (const r of Array.isArray(raw.rows) ? raw.rows.slice(0, 20) : []) {
        if (!isObj(r) || !txt(r.city, 40)) continue;
        const blocks: TimelineBlock[] = [];
        for (const b of Array.isArray(r.blocks) ? r.blocks.slice(0, 48) : []) {
          if (!isObj(b)) continue;
          const i = Math.round(num(b.intensity));
          blocks.push({
            hour: txt(b.hour, 30),
            hazard: (HAZARDS as readonly unknown[]).includes(b.hazard) ? (b.hazard as Hazard) : "none",
            intensity: (i < 0 ? 0 : i > 3 ? 3 : i) as 0 | 1 | 2 | 3,
          });
        }
        rows.push({ city: txt(r.city, 40), blocks });
      }
      return { rows };
    }
    case "discussion":
      return { text: txt(raw.text, 4000), draft: raw.draft !== false };
    case "stormTrack": {
      const o = Array.isArray(raw.origin) ? raw.origin : [];
      const towns = (Array.isArray(raw.towns) ? raw.towns.slice(0, 20) : [])
        .filter(isObj)
        .map((t) => ({ name: txt(t.name, 40), etaMin: Math.round(num(t.etaMin)) }))
        .filter((t) => t.name);
      return { alertId: txt(raw.alertId, 120), origin: [num(o[0]), num(o[1])] as LonLat, bearingDeg: num(raw.bearingDeg), speedKt: num(raw.speedKt), at: txt(raw.at, 40), towns };
    }
  }
}

/** Validate the stored product list. Drops malformed entries, caps the size, never throws. */
export function normalizeProducts(raw: unknown): StudioProduct[] {
  if (!Array.isArray(raw)) return [];
  const out: StudioProduct[] = [];
  for (const p of raw) {
    if (!isObj(p) || typeof p.id !== "string" || !p.id) continue;
    if (!(STUDIO_KINDS as readonly unknown[]).includes(p.kind)) continue;
    const validFrom = iso(p.validFrom);
    const validTo = iso(p.validTo);
    const body = validFrom && validTo ? normalizeBody(p.kind as StudioKind, p.body) : null;
    if (!validFrom || !validTo || !body) continue;
    const r = isObj(p.region) ? p.region : {};
    const n = (x: unknown, d: number) => (Number.isFinite(Number(x)) && x !== undefined && x !== null ? Number(x) : d);
    out.push({
      id: p.id.slice(0, 64),
      kind: p.kind as StudioKind,
      title: typeof p.title === "string" ? p.title.slice(0, 120) : "",
      validFrom,
      validTo,
      region: { south: n(r.south, 38.4), west: n(r.west, -76.4), north: n(r.north, 41.4), east: n(r.east, -73.8) },
      published: p.published === true,
      author: p.author === "auto" ? "auto" : "forecaster",
      body,
      updated: iso(p.updated) ?? validFrom,
    });
    if (out.length >= MAX_STUDIO_PRODUCTS) break;
  }
  return out;
}

/** Published and valid at `now`. */
export function productActive(p: StudioProduct, now = Date.now()): boolean {
  return p.published && Date.parse(p.validFrom) <= now && Date.parse(p.validTo) > now;
}
