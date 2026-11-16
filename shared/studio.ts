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

export interface SevenDayOverride {
  date: string;
  hi?: number;
  lo?: number;
  pop?: number;
  code?: number;
  note?: string;
}
export interface SevenDay {
  overrides: SevenDayOverride[];
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

/** Validate the stored product list. Drops malformed entries, caps the size, never throws. */
export function normalizeProducts(raw: unknown): StudioProduct[] {
  if (!Array.isArray(raw)) return [];
  const out: StudioProduct[] = [];
  for (const p of raw) {
    if (!isObj(p) || typeof p.id !== "string" || !p.id) continue;
    if (!(STUDIO_KINDS as readonly unknown[]).includes(p.kind)) continue;
    const validFrom = iso(p.validFrom);
    const validTo = iso(p.validTo);
    if (!validFrom || !validTo || !isObj(p.body)) continue;
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
      body: p.body as unknown as StudioBody,
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
