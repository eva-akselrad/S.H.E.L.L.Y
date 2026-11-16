import type { SegmentId } from "./scheduler";
import type { Place } from "./types";

export const SEGMENT_IDS: SegmentId[] = ["now", "radar", "hourly", "daily", "text", "outlook", "air", "almanac", "note"];
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

export interface SiteConfig {
  defaultLocation: Place | null;
  defaultMode: (typeof MODES)[number];
  defaultTheme: (typeof THEMES)[number];
  hiddenSegments: SegmentId[];
  segmentSeconds: Partial<Record<SegmentId, number>>;
  tts: boolean;
  voice: VoiceConfig;
  music: { enabled: boolean; volume: number; disabledTracks: string[] };
  note: ForecasterNote;
}

export const DEFAULT_CONFIG: SiteConfig = {
  defaultLocation: null,
  defaultMode: "auto",
  defaultTheme: "auto",
  hiddenSegments: [],
  segmentSeconds: {},
  tts: true,
  voice: { engine: "ai", speaker: "athena", dailyCharCap: 20000 },
  music: { enabled: true, volume: 0.35, disabledTracks: [] },
  note: { enabled: false, title: "", body: "", expires: null },
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
  };
}

export function noteActive(c: SiteConfig, now = Date.now()): boolean {
  const n = c.note;
  if (!n.enabled || !n.body.trim()) return false;
  return !n.expires || new Date(n.expires).getTime() > now;
}
