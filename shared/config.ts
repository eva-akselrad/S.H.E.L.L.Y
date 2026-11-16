import type { SegmentId } from "./scheduler";
import type { Bbox, Place } from "./types";

export const SEGMENT_IDS: SegmentId[] = ["now", "radar", "hourly", "daily", "text", "outlook", "air", "almanac", "note", "studio"];
export const MODES = ["auto", "kiosk", "web", "phone"] as const;
export const THEMES = ["auto", "light", "dark"] as const;

export const SPEAKERS = [
  "amalthea", "andromeda", "apollo", "arcas", "aries", "asteria", "athena", "atlas", "aurora", "callista",
  "cora", "cordelia", "delia", "draco", "electra", "harmonia", "helena", "hera", "hermes", "hyperion",
  "iris", "janus", "juno", "jupiter", "luna", "mars", "minerva", "neptune", "odysseus", "ophelia",
  "orion", "orpheus", "pandora", "phoebe", "pluto", "saturn", "thalia", "theia", "vesta", "zeus",
] as const;
export type Speaker = (typeof SPEAKERS)[number];

export interface VoiceConfig {
  /** "ai" = server-generated Aura-2 voice (falls back to the browser voice on any failure) */
  engine: "ai" | "browser";
  speaker: Speaker;
  /** hard cap on characters synthesized per UTC day (~$0.03 per 1,000) */
  dailyCharCap: number;
}

export interface ForecasterNote {
  enabled: boolean;
  title: string;
  body: string;
  expires: string | null;
}

export interface LiveCity {
  name: string;
  state: string;
  lat: number;
  lon: number;
}

export interface LiveRegion {
  /** NWS office whose alerts count as "in region" */
  office: string;
  /** text matched against an alert's senderName, e.g. "Mount Holly" for PHI */
  senderMatch: string;
  /** on-air name, e.g. "Philadelphia region" */
  name: string;
  tz: string;
  bbox: Bbox;
  /** CALM-rotation cities, editable in the admin */
  cities: LiveCity[];
}

export interface LlmConfig {
  provider: "openrouter" | "openai-compatible";
  baseUrl: string;
  /** ordered fallbacks; the L2 phase fills in current ":free" ids */
  models: string[];
  dailyRequestCap: number;
  temperature: number;
}

export interface LiveConfig {
  enabled: boolean;
  region: LiveRegion;
  /** random value in the OBS URL (?key=...); keeps /live unadvertised, not secret-grade */
  viewerToken: string;
  llm: LlmConfig & { enabled: boolean };
  host: { name: string; /** 0 calm .. 1 playful */ tone: number; bannedTopics: string[] };
  /** seconds per rundown item kind overrides */
  itemSeconds: Record<string, number>;
}

export interface StudioConfig {
  forecasterName: string;
}

export interface SiteConfig {
  defaultLocation: Place | null;
  defaultMode: (typeof MODES)[number];
  defaultTheme: (typeof THEMES)[number];
  hiddenSegments: SegmentId[];
  segmentSeconds: Partial<Record<SegmentId, number>>;
  tts: boolean;
  /** weather-driven backgrounds and mood */
  scenes: boolean;
  voice: VoiceConfig;
  music: { enabled: boolean; volume: number; disabledTracks: string[] };
  note: ForecasterNote;
  live: LiveConfig;
  studio: StudioConfig;
}

export const DEFAULT_LIVE: LiveConfig = {
  enabled: false,
  region: {
    office: "PHI",
    senderMatch: "Mount Holly",
    name: "Philadelphia region",
    tz: "America/New_York",
    bbox: { south: 38.4, west: -76.4, north: 41.4, east: -73.8 },
    cities: [
      { name: "Philadelphia", state: "PA", lat: 39.9526, lon: -75.1652 },
      { name: "Trenton", state: "NJ", lat: 40.2206, lon: -74.7597 },
      { name: "Camden", state: "NJ", lat: 39.9259, lon: -75.1196 },
      { name: "Wilmington", state: "DE", lat: 39.7459, lon: -75.5466 },
      { name: "Allentown", state: "PA", lat: 40.6084, lon: -75.4902 },
      { name: "Reading", state: "PA", lat: 40.3356, lon: -75.9269 },
      { name: "Doylestown", state: "PA", lat: 40.31, lon: -75.13 },
      { name: "West Chester", state: "PA", lat: 39.9607, lon: -75.6055 },
      { name: "Norristown", state: "PA", lat: 40.1215, lon: -75.3399 },
      { name: "Mount Holly", state: "NJ", lat: 39.9926, lon: -74.7879 },
      { name: "Atlantic City", state: "NJ", lat: 39.3643, lon: -74.4229 },
      { name: "Cape May", state: "NJ", lat: 38.9351, lon: -74.906 },
      { name: "Toms River", state: "NJ", lat: 39.9537, lon: -74.1979 },
      { name: "Dover", state: "DE", lat: 39.1582, lon: -75.5244 },
    ],
  },
  viewerToken: "",
  llm: { enabled: false, provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", models: [], dailyRequestCap: 45, temperature: 0.7 },
  host: { name: "SHELLY", tone: 0.4, bannedTopics: [] },
  itemSeconds: {},
};

export const DEFAULT_STUDIO: StudioConfig = { forecasterName: "" };

export const DEFAULT_CONFIG: SiteConfig = {
  defaultLocation: null,
  defaultMode: "auto",
  defaultTheme: "auto",
  hiddenSegments: [],
  segmentSeconds: {},
  tts: true,
  scenes: true,
  voice: { engine: "ai", speaker: "athena", dailyCharCap: 20000 },
  music: { enabled: true, volume: 0.35, disabledTracks: [] },
  note: { enabled: false, title: "", body: "", expires: null },
  live: DEFAULT_LIVE,
  studio: DEFAULT_STUDIO,
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const isoOrNull = (v: unknown): string | null =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;

function normalizePlace(v: unknown): Place | null {
  if (!isObj(v)) return null;
  const lat = Number(v.lat);
  const lon = Number(v.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 17 || lat > 72 || lon < -180 || lon > -64) return null;
  const s = (x: unknown): string | null => (typeof x === "string" && x ? x.slice(0, 40) : null);
  const n = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return {
    lat,
    lon,
    name: str(v.name, 80) || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
    state: s(v.state),
    tz: str(v.tz, 60) || "America/New_York",
    office: s(v.office),
    gridX: n(v.gridX),
    gridY: n(v.gridY),
    forecastZone: s(v.forecastZone),
    countyZone: s(v.countyZone),
    fireZone: s(v.fireZone),
  };
}

const num = (v: unknown, d: number): number => (v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

function normalizeBbox(v: unknown, d: Bbox): Bbox {
  if (!isObj(v)) return d;
  const south = clamp(num(v.south, d.south), 17, 72);
  const north = clamp(num(v.north, d.north), 17, 72);
  const west = clamp(num(v.west, d.west), -180, -64);
  const east = clamp(num(v.east, d.east), -180, -64);
  return south < north && west < east ? { south, west, north, east } : d;
}

function normalizeLive(v: unknown): LiveConfig {
  const D = DEFAULT_LIVE;
  const r = isObj(v) ? v : {};
  const reg = isObj(r.region) ? r.region : {};
  const llm = isObj(r.llm) ? r.llm : {};
  const host = isObj(r.host) ? r.host : {};

  const cities: LiveCity[] = Array.isArray(reg.cities)
    ? reg.cities
        .filter(isObj)
        .map((c) => ({ name: str(c.name, 60), state: str(c.state, 2).toUpperCase(), lat: Number(c.lat), lon: Number(c.lon) }))
        .filter((c) => c.name && Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.lat >= 17 && c.lat <= 72 && c.lon >= -180 && c.lon <= -64)
        .slice(0, 40)
    : D.region.cities;

  const secs: Record<string, number> = {};
  if (isObj(r.itemSeconds)) {
    for (const [k, val] of Object.entries(r.itemSeconds).slice(0, 20)) {
      const n = Number(val);
      if (/^[a-z]{2,20}$/.test(k) && Number.isFinite(n) && n > 0) secs[k] = Math.round(clamp(n, 5, 180));
    }
  }

  const baseUrl = typeof llm.baseUrl === "string" && /^https?:\/\//.test(llm.baseUrl) ? llm.baseUrl.slice(0, 300) : D.llm.baseUrl;

  return {
    enabled: r.enabled === true,
    region: {
      office: /^[A-Z]{3,4}$/.test(String(reg.office)) ? String(reg.office) : D.region.office,
      senderMatch: str(reg.senderMatch, 40) || D.region.senderMatch,
      name: str(reg.name, 60) || D.region.name,
      tz: str(reg.tz, 60) || D.region.tz,
      bbox: normalizeBbox(reg.bbox, D.region.bbox),
      cities,
    },
    viewerToken: /^[A-Za-z0-9_-]{16,128}$/.test(String(r.viewerToken)) ? String(r.viewerToken) : "",
    llm: {
      enabled: llm.enabled === true,
      provider: llm.provider === "openai-compatible" ? "openai-compatible" : "openrouter",
      baseUrl,
      models: Array.isArray(llm.models)
        ? llm.models.filter((m): m is string => typeof m === "string" && m.length > 0).slice(0, 5).map((m) => m.slice(0, 100))
        : [],
      dailyRequestCap: Math.round(clamp(num(llm.dailyRequestCap, D.llm.dailyRequestCap), 0, 5000)),
      temperature: clamp(num(llm.temperature, D.llm.temperature), 0, 1.5),
    },
    host: {
      name: str(host.name, 30) || D.host.name,
      tone: clamp(num(host.tone, D.host.tone), 0, 1),
      bannedTopics: Array.isArray(host.bannedTopics)
        ? host.bannedTopics.filter((t): t is string => typeof t === "string" && t.trim() !== "").slice(0, 20).map((t) => t.slice(0, 60))
        : [],
    },
    itemSeconds: secs,
  };
}

/** Validate and clamp untrusted config JSON. Never throws; unknown input yields defaults. */
export function normalizeConfig(raw: unknown): SiteConfig {
  const r = isObj(raw) ? raw : {};
  const music = isObj(r.music) ? r.music : {};
  const note = isObj(r.note) ? r.note : {};
  const voice = isObj(r.voice) ? r.voice : {};

  const secs: Partial<Record<SegmentId, number>> = {};
  if (isObj(r.segmentSeconds)) {
    for (const id of SEGMENT_IDS) {
      const n = Number(r.segmentSeconds[id]);
      if (Number.isFinite(n) && n > 0) secs[id] = Math.round(clamp(n, 5, 120));
    }
  }

  const modeIn = (MODES as readonly unknown[]).includes(r.defaultMode);
  const themeIn = (THEMES as readonly unknown[]).includes(r.defaultTheme);

  return {
    defaultLocation: normalizePlace(r.defaultLocation),
    defaultMode: modeIn ? (r.defaultMode as SiteConfig["defaultMode"]) : "auto",
    defaultTheme: themeIn ? (r.defaultTheme as SiteConfig["defaultTheme"]) : "auto",
    // "now" can't be hidden: the loop must never be empty
    hiddenSegments: Array.isArray(r.hiddenSegments)
      ? SEGMENT_IDS.filter((id) => id !== "now" && (r.hiddenSegments as unknown[]).includes(id))
      : [],
    segmentSeconds: secs,
    tts: r.tts !== false,
    scenes: r.scenes !== false,
    voice: {
      engine: voice.engine === "browser" ? "browser" : "ai",
      speaker: (SPEAKERS as readonly unknown[]).includes(voice.speaker) ? (voice.speaker as Speaker) : "athena",
      dailyCharCap: Math.round(
        clamp(Number.isFinite(Number(voice.dailyCharCap)) && voice.dailyCharCap !== undefined ? Number(voice.dailyCharCap) : 20000, 0, 200000),
      ),
    },
    music: {
      enabled: music.enabled !== false,
      volume: clamp(Number.isFinite(Number(music.volume)) && music.volume !== undefined ? Number(music.volume) : 0.35, 0, 1),
      disabledTracks: Array.isArray(music.disabledTracks)
        ? music.disabledTracks.filter((t): t is string => typeof t === "string").slice(0, 200).map((t) => t.slice(0, 200))
        : [],
    },
    note: {
      enabled: note.enabled === true,
      title: str(note.title, 80),
      body: str(note.body, 1500),
      expires: isoOrNull(note.expires),
    },
    live: normalizeLive(r.live),
    studio: { forecasterName: str(isObj(r.studio) ? r.studio.forecasterName : "", 60) },
  };
}

export function noteActive(c: SiteConfig, now = Date.now()): boolean {
  const n = c.note;
  if (!n.enabled || !n.body.trim()) return false;
  return !n.expires || new Date(n.expires).getTime() > now;
}
