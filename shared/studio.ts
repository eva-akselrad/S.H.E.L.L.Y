// Forecaster Studio product shapes (docs/LIVE_PLAN.md, Part B). Types plus a
// tolerant normalizer for the product list; the editors and views come in L4+.
import type { Bbox, LonLat, PolygonGeom } from "./types";

export type StudioProductId = string;
export const STUDIO_KINDS = ["riskMap", "totalsMap", "cityTemps", "sevenDay", "timeline", "discussion", "stormTrack", "note", "impacts", "dayPlanner", "compare", "odds"] as const;
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

export const CITY_METRICS = ["high", "low", "feelsLike", "pop", "gust"] as const;
export type CityMetric = (typeof CITY_METRICS)[number];

export interface CityTemp {
  name: string;
  lat: number;
  lon: number;
  value: number;
}
export interface CityTemps {
  metric: CityMetric;
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


// ── more forecaster graphics ──

/** A headline card in the forecaster's own words. */
export const NOTE_ICONS = ["sun", "partly", "cloud", "rain", "snow", "storm", "fog", "wind", "heat", "cold"] as const;
export type NoteIcon = (typeof NOTE_ICONS)[number];
export interface NoteCard {
  headline: string;
  bullets: string[];
  icon: NoteIcon;
  /** 0 calm .. 3 high stakes; picks the accent colour */
  tone: 0 | 1 | 2 | 3;
}

/** Impact scale: how much an event will affect daily life. */
export const IMPACT_LEVELS = ["None", "Minor", "Moderate", "Major", "Extreme"] as const;
export interface Impacts {
  event: string;
  overall: 0 | 1 | 2 | 3 | 4;
  rows: { label: string; level: 0 | 1 | 2 | 3 | 4; note: string }[];
}

/** One city's day in four parts. */
export interface DayPlanner {
  place: string;
  date: string;
  parts: { label: string; temp: number; code: number; pop: number; note: string }[];
}

/** Today's high against tomorrow's for each city. */
export interface Compare {
  cities: { name: string; today: number; tomorrow: number }[];
}

/** Probabilities for possible outcomes, with the forecaster's confidence. */
export interface Odds {
  event: string;
  outcomes: { label: string; pct: number }[];
  confidence: "low" | "medium" | "high";
  note: string;
}

export type StudioBody = RiskMap | TotalsMap | CityTemps | SevenDay | Timeline | Discussion | StormTrack | NoteCard | Impacts | DayPlanner | Compare | Odds;

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
const lvl = (v: unknown, max: number): number => Math.min(max, Math.max(0, Math.round(num(v))));
const clampPct = (v: unknown): number => Math.min(100, Math.max(0, Math.round(num(v))));

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
      return { metric: (CITY_METRICS as readonly unknown[]).includes(raw.metric) ? (raw.metric as CityMetric) : "high", cities };
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
    case "note": {
      const bullets = (Array.isArray(raw.bullets) ? raw.bullets : []).map((b) => txt(b, 90).trim()).filter(Boolean).slice(0, 5);
      return {
        headline: txt(raw.headline, 90),
        bullets,
        icon: (NOTE_ICONS as readonly unknown[]).includes(raw.icon) ? (raw.icon as NoteIcon) : "partly",
        tone: lvl(raw.tone, 3) as NoteCard["tone"],
      };
    }
    case "impacts": {
      const rows = (Array.isArray(raw.rows) ? raw.rows : []).filter(isObj).slice(0, 6)
        .map((x) => ({ label: txt(x.label, 30), level: lvl(x.level, 4) as Impacts["overall"], note: txt(x.note, 80) }))
        .filter((x) => x.label);
      return { event: txt(raw.event, 80), overall: lvl(raw.overall, 4) as Impacts["overall"], rows };
    }
    case "dayPlanner": {
      const parts = (Array.isArray(raw.parts) ? raw.parts : []).filter(isObj).slice(0, 4)
        .map((x) => ({ label: txt(x.label, 20), temp: Math.round(num(x.temp)), code: Math.round(num(x.code)), pop: clampPct(x.pop), note: txt(x.note, 60) }))
        .filter((x) => x.label);
      return { place: txt(raw.place, 60), date: txt(raw.date, 10), parts };
    }
    case "compare": {
      const cities = (Array.isArray(raw.cities) ? raw.cities : []).filter(isObj).slice(0, 16)
        .map((c) => ({ name: txt(c.name, 40), today: Math.round(num(c.today)), tomorrow: Math.round(num(c.tomorrow)) }))
        .filter((c) => c.name);
      return { cities };
    }
    case "odds": {
      const outcomes = (Array.isArray(raw.outcomes) ? raw.outcomes : []).filter(isObj).slice(0, 6)
        .map((o) => ({ label: txt(o.label, 50), pct: clampPct(o.pct) }))
        .filter((o) => o.label);
      const confidence = raw.confidence === "low" || raw.confidence === "high" ? raw.confidence : "medium";
      return { event: txt(raw.event, 80), outcomes, confidence, note: txt(raw.note, 160) };
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
