// Local hazards: rivers (NWS National Water Prediction Service), tides (NOAA CO-OPS),
// tropical storms (NHC) and a winter "snow day" score. Shapes + pure helpers shared by Worker and app.
import { haversineMi } from "./geo";
import { compass } from "./live/track";
import type { Alert, Forecast } from "./types";

export type FloodCategory = "no_flooding" | "action" | "minor" | "moderate" | "major" | "unknown";

export interface RiverGauge {
  lid: string;
  name: string;
  stage: number | null;
  unit: string;
  category: FloodCategory;
  /** NWS river forecast, when the gauge has one */
  forecastStage: number | null;
  forecastCategory: FloodCategory;
  /** flood stage (minor), when defined */
  floodStage: number | null;
  time: string | null;
  distanceMi: number;
}

export interface TidePoint {
  time: string;
  type: "H" | "L";
  ft: number;
}

export interface Tides {
  station: string;
  name: string;
  distanceMi: number;
  next: TidePoint[];
}

export interface TropicalStorm {
  name: string;
  /** "Hurricane", "Tropical Storm", "Tropical Depression", ... */
  kind: string;
  windMph: number;
  category: number | null;
  distanceMi: number;
  /** where the storm is, from you: "south" */
  side: string;
  movement: string;
}

export interface Hazards {
  fetchedAt: string;
  rivers: RiverGauge[];
  tides: Tides | null;
  tropical: TropicalStorm[];
}

const CATS: FloodCategory[] = ["no_flooding", "action", "minor", "moderate", "major"];
export const catRank = (c: FloodCategory): number => Math.max(0, CATS.indexOf(c));
export function normCat(v: unknown): FloodCategory {
  return typeof v === "string" && (CATS as string[]).includes(v) ? (v as FloodCategory) : "unknown";
}

export function catLabel(c: FloodCategory): string {
  return { no_flooding: "Normal", action: "Near flood stage", minor: "Minor flooding", moderate: "Moderate flooding", major: "Major flooding", unknown: "No flood stage" }[c];
}

/** Coastal and tidal-river tide stations around the PHI area (NOAA CO-OPS ids). */
export const TIDE_STATIONS: { id: string; name: string; lat: number; lon: number }[] = [
  { id: "8545240", name: "Philadelphia (Pier 12)", lat: 39.9333, lon: -75.1417 },
  { id: "8534720", name: "Atlantic City", lat: 39.3567, lon: -74.4181 },
  { id: "8536110", name: "Cape May", lat: 38.9683, lon: -74.96 },
  { id: "8557380", name: "Lewes", lat: 38.7828, lon: -75.1192 },
  { id: "8531680", name: "Sandy Hook", lat: 40.4669, lon: -74.0094 },
  { id: "8533615", name: "Barnegat Inlet", lat: 39.7597, lon: -74.1086 },
  { id: "8551910", name: "Reedy Point", lat: 39.5583, lon: -75.5733 },
  { id: "8638610", name: "Sewells Point (Norfolk)", lat: 36.9467, lon: -76.33 },
  { id: "8518750", name: "The Battery (New York)", lat: 40.7006, lon: -74.0142 },
  { id: "8574680", name: "Baltimore", lat: 39.2667, lon: -76.5783 },
];

export function nearestTideStation(lat: number, lon: number, maxMi = 30) {
  let best: (typeof TIDE_STATIONS)[number] & { distanceMi: number } = { ...TIDE_STATIONS[0]!, distanceMi: Infinity };
  for (const s of TIDE_STATIONS) {
    const d = haversineMi(lat, lon, s.lat, s.lon);
    if (d < best.distanceMi) best = { ...s, distanceMi: Math.round(d) };
  }
  return best.distanceMi <= maxMi ? best : null;
}

/** CO-OPS hilo predictions → tide points. CO-OPS returns "YYYY-MM-DD HH:mm" in the requested zone (GMT here). */
export function parseTides(json: unknown): TidePoint[] {
  const p = (json as { predictions?: { t: string; v: string; type: string }[] })?.predictions ?? [];
  return p
    .map((x) => ({ time: new Date(`${x.t.replace(" ", "T")}:00Z`).toISOString(), type: (x.type === "H" ? "H" : "L") as "H" | "L", ft: Math.round(Number(x.v) * 10) / 10 }))
    .filter((x) => Number.isFinite(x.ft));
}

/** Saffir-Simpson category from sustained wind (mph). */
export function hurricaneCategory(mph: number): number | null {
  if (mph >= 157) return 5;
  if (mph >= 130) return 4;
  if (mph >= 111) return 3;
  if (mph >= 96) return 2;
  if (mph >= 74) return 1;
  return null;
}

const KIND: Record<string, string> = {
  HU: "Hurricane", TS: "Tropical Storm", TD: "Tropical Depression", STS: "Subtropical Storm", SD: "Subtropical Depression",
  PTC: "Potential Tropical Cyclone", PC: "Post-tropical Cyclone", TY: "Typhoon",
};

/** NHC CurrentStorms.json → storms within maxMi of the point. Intensity is in knots, movement speed in mph. */
export function parseNhc(json: unknown, lat: number, lon: number, maxMi = 800): TropicalStorm[] {
  const list = (json as { activeStorms?: Record<string, unknown>[] })?.activeStorms ?? [];
  const out: TropicalStorm[] = [];
  for (const s of list) {
    const sLat = Number(s.latitudeNumeric);
    const sLon = Number(s.longitudeNumeric);
    if (!Number.isFinite(sLat) || !Number.isFinite(sLon)) continue;
    const d = haversineMi(lat, lon, sLat, sLon);
    if (d > maxMi) continue;
    const windMph = Math.round(Number(s.intensity) * 1.15078) || 0;
    const kind = KIND[String(s.classification)] ?? "Tropical system";
    const brg = ((Math.atan2((sLon - lon) * Math.cos((lat * Math.PI) / 180), sLat - lat) * 180) / Math.PI + 360) % 360;
    const dir = Number(s.movementDir);
    const spd = Number(s.movementSpeed);
    out.push({
      name: String(s.name ?? "Unnamed").slice(0, 40),
      kind,
      windMph,
      category: kind === "Hurricane" ? hurricaneCategory(windMph) : null,
      distanceMi: Math.round(d),
      side: compass(brg),
      movement: Number.isFinite(dir) && Number.isFinite(spd) && spd > 0 ? `moving ${compass(dir)} at ${Math.round(spd)} mph` : "nearly stationary",
    });
  }
  return out.sort((a, b) => a.distanceMi - b.distanceMi);
}

/** How much the Local hazards segment deserves a spot in the loop (scheduler relevance, 0..1). */
export function hazardScore(h: Hazards | null, snow: SnowDay | null): number {
  const flooding = h?.rivers.some((g) => Math.max(catRank(g.category), catRank(g.forecastCategory)) >= 1) ?? false;
  const tropicalNear = h?.tropical.some((t) => t.distanceMi <= 500) ?? false;
  if (flooding || tropicalNear || (snow && snow.odds >= 25)) return 1;
  if (snow || h?.tropical.length) return 0.6;
  if (h && (h.rivers.length || h.tides)) return 0.3;
  return 0;
}

// ── winter: snow day odds ──

export interface SnowDay {
  /** 0..100. A fun estimate, not an official prediction. */
  odds: number;
  /** the school day the odds are for, "YYYY-MM-DD" */
  date: string;
  reasons: string[];
}

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const ICE_CODES = new Set([56, 57, 66, 67]);

/**
 * Odds that the next weekday is a snow day, from overnight-into-morning snow, ice and winter warnings.
 * Returns null when there's no winter weather worth mentioning.
 * @param nowLocal local wall time "YYYY-MM-DDTHH:mm"
 */
export function snowDayOdds(f: Forecast, alerts: Alert[], nowLocal: string): SnowDay | null {
  // the next school morning: tomorrow if it's after 9 AM, otherwise today; skip weekends
  const d = new Date(`${nowLocal.slice(0, 10)}T12:00:00Z`);
  if (Number(nowLocal.slice(11, 13)) >= 9) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  const date = d.toISOString().slice(0, 10);

  // snow that falls from 6 PM the evening before through 8 AM matters most
  const prev = new Date(d);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const from = `${prev.toISOString().slice(0, 10)}T18:00`;
  const to = `${date}T08:00`;
  const win = f.hourly.filter((h) => h.time >= from && h.time <= to);
  const day = f.daily.find((x) => x.date === date);
  const daySnow = day?.snow ?? 0;
  const prevSnow = f.daily.find((x) => x.date === prev.toISOString().slice(0, 10))?.snow ?? 0;
  const snowHours = win.filter((h) => SNOW_CODES.has(h.code)).length;
  const iceHours = win.filter((h) => ICE_CODES.has(h.code)).length;
  const coldMorning = win.length ? Math.min(...win.map((h) => h.temp)) : 99;
  const winterAlert = alerts.find((a) => /winter storm warning|blizzard warning|ice storm warning/i.test(a.event));
  const advisory = alerts.find((a) => /winter weather advisory|winter storm watch/i.test(a.event));

  if (!snowHours && !iceHours && daySnow < 0.5 && prevSnow < 1 && !winterAlert && !advisory) return null;

  // Snow amount: the window's share of the day totals, approximated by the bigger of the two totals.
  const inches = Math.max(daySnow * 0.6, prevSnow * 0.5) + snowHours * 0.15;
  let odds = 0;
  const reasons: string[] = [];
  if (inches >= 0.5) {
    odds += Math.min(55, inches * 10);
    reasons.push(`about ${Math.round(inches * 2) / 2} in of snow overnight into the morning`);
  }
  if (iceHours) {
    odds += Math.min(35, iceHours * 8);
    reasons.push("freezing rain or sleet before school");
  }
  if (winterAlert) {
    odds += 25;
    reasons.push(`${winterAlert.event} in effect`);
  } else if (advisory) {
    odds += 10;
    reasons.push(`${advisory.event} in effect`);
  }
  if (coldMorning <= 20 && odds > 0) {
    odds += 5;
    reasons.push("a very cold morning, so roads stay icy");
  }
  odds = Math.round(Math.min(95, Math.max(3, odds)));
  return { odds, date, reasons };
}
