// Snow day odds: SHELLY's own guess at whether schools will close, delay or stay open.
// A transparent points model (not a black box): every input adds or removes points, a logistic curve
// turns points into a chance. All the weights are in WEIGHTS so they are easy to tune.
// This is an estimate. It is never the school's decision, and the UI must say so.

import type { DayConfidence } from "./confidence";
import { haversineMi } from "./geo";
import type { SnowHour } from "./gridpoint";

export type SnowBand = "none" | "low" | "some" | "good" | "high" | "very_high";
export type SnowConfidence = "low" | "medium" | "high";

export interface SnowDayOdds {
  /** the school day this is about (local YYYY-MM-DD) */
  forDate: string;
  /** 0..1, chance of no in-person school (closed or remote day) */
  closed: number;
  /** 0..1, chance of a 2-hour delay */
  delayed: number;
  band: SnowBand;
  /** plain bullets, at most 4 */
  reasons: string[];
  /** snowfall range in inches from the ensemble, when known */
  range: [number, number] | null;
  confidence: SnowConfidence;
  /** e.g. "No school tomorrow anyway." when the next day is a weekend or day off */
  note: string | null;
  /** what the icon row shows */
  facts: { snowIn: number; iceIn: number; coldF: number | null; rush: boolean; schoolDaySnowIn: number };
}

export interface DistrictProfile {
  /** 0 closes at the first flurry .. 1 hardly ever closes */
  toughness: number;
  /** wind chill (°F) at or below this adds cold points */
  coldWindChillF: number;
}

export interface SnowDayInput {
  /** hourly forecast, LOCAL time, covering the evening before through the school day */
  hours: SnowHour[];
  /** event names of alerts covering the district point */
  alerts: string[];
  /** local wall time "YYYY-MM-DDTHH:mm" */
  nowLocal: string;
  /** local dates with no school (holidays, in-service days) */
  daysOff: string[];
  district: DistrictProfile;
  /** ensemble snowfall range, inches */
  range: [number, number] | null;
}

/** Every tunable number lives here. Points are "inches of snow worth of trouble". */
export const WEIGHTS = {
  /** snow between 8 PM the night before and 7 AM: the decision window */
  snowDecision: 1.0,
  /** extra weight per inch that falls 5 to 7 AM, when buses roll */
  snowRush: 0.35,
  /** snow during the school day mostly means early dismissal, not closure */
  snowSchoolDay: 0.2,
  /** 0.1 in. of ice is about as bad as 3 in. of snow */
  iceDecision: 30,
  iceSchoolDay: 8,
  /** snow ends by 2 AM and stays above freezing: roads get treated */
  meltFactor: 0.7,
  /** wind chill at or below the district threshold */
  coldBase: 1.5,
  coldPerDegree: 0.1,
  coldMax: 4,
  alertWarning: 1.5,
  alertAdvisory: 0.6,
  alertExtremeCold: 1.0,
  /** logistic for closing */
  closeMid: 3.0,
  closeSpread: 1.5,
  /** logistic for any disruption (closed or delayed) */
  anyMid: 1.2,
  anySpread: 0.9,
  /** how far toughness 0 / 1 moves the curves (points) */
  toughnessShift: 3,
  /** ensemble range width (in.) at which confidence drops */
  widthMedium: 2.5,
  widthLow: 5,
  /** hours of lead time at which confidence is capped */
  leadMedium: 36,
  leadLow: 72,
} as const;

const BAND_EDGES: [number, SnowBand][] = [
  [0.05, "none"],
  [0.2, "low"],
  [0.4, "some"],
  [0.6, "good"],
  [0.8, "high"],
];

export function bandFor(closed: number): SnowBand {
  for (const [edge, band] of BAND_EDGES) if (closed < edge) return band;
  return "very_high";
}

export const BAND_LABEL: Record<SnowBand, string> = {
  none: "None",
  low: "Low",
  some: "Some",
  good: "Good",
  high: "High",
  very_high: "Very high",
};

/** The percent to show, to the nearest 5, or null where only the band words should be used (under 2%, over 95%). */
export function displayPct(closed: number): number | null {
  if (closed < 0.02 || closed > 0.95) return null;
  return Math.round(closed * 20) * 5;
}

const sig = (x: number): number => 1 / (1 + Math.exp(-x));
/** logistic that is exactly 0 at 0 points */
function curve(points: number, mid: number, spread: number): number {
  const floor = sig(-mid / spread);
  return Math.min(0.99, Math.max(0, (sig((points - mid) / spread) - floor) / (1 - floor)));
}

const DAY = 86_400_000;
const dateMs = (d: string): number => Date.parse(`${d}T12:00:00Z`);
const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const isSchoolDay = (d: string, off: Set<string>): boolean => {
  const dow = new Date(dateMs(d)).getUTCDay();
  return dow !== 0 && dow !== 6 && !off.has(d);
};
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Which school day is this about, and the note when "tomorrow" isn't one. */
export function schoolDayFor(nowLocal: string, daysOff: string[]): { forDate: string; note: string | null } {
  const off = new Set(daysOff);
  const today = nowLocal.slice(0, 10);
  const afterNine = Number(nowLocal.slice(11, 13)) >= 9;
  const first = afterNine ? ymd(dateMs(today) + DAY) : today;
  let d = first;
  for (let i = 0; i < 400 && !isSchoolDay(d, off); i++) d = ymd(dateMs(d) + DAY);
  const note = d === first ? null : `No school ${afterNine ? "tomorrow" : "today"} anyway.`;
  return { forDate: d, note };
}

/** Sum two ensemble days (the evening before and the school morning) into one range. */
export function ensembleRange(days: Pick<DayConfidence, "date" | "snow">[], forDate: string): [number, number] | null {
  const prev = ymd(dateMs(forDate) - DAY);
  const a = days.find((d) => d.date === prev);
  const b = days.find((d) => d.date === forDate);
  if (!b) return null;
  const lo = (a?.snow.p10 ?? 0) + b.snow.p10;
  const hi = (a?.snow.p90 ?? 0) + b.snow.p90;
  return Number.isFinite(lo) && Number.isFinite(hi) ? [round1(lo), round1(hi)] : null;
}

const fmtIn = (n: number): string => {
  if (n < 1) return "Under 1 in.";
  return `About ${Math.round(n * 2) / 2} in.`;
};

export function computeSnowDay(inp: SnowDayInput): SnowDayOdds {
  const W = WEIGHTS;
  const { forDate, note } = schoolDayFor(inp.nowLocal, inp.daysOff);
  const prevDate = ymd(dateMs(forDate) - DAY);
  const winStart = `${prevDate}T20:00`;
  const rushStart = `${forDate}T05:00`;
  const schoolStart = `${forDate}T07:00`;
  const schoolEnd = `${forDate}T15:00`;

  let snowDec = 0;
  let snowRush = 0;
  let snowSchool = 0;
  let iceDec = 0;
  let iceRush = 0;
  let iceSchool = 0;
  let lastSnowHour: string | null = null;
  let minChillRush: number | null = null;
  let minTempEarly: number | null = null; // 2 to 7 AM
  for (const h of inp.hours) {
    if (h.time >= winStart && h.time < schoolStart) {
      snowDec += h.snow;
      iceDec += h.ice;
      if (h.time >= rushStart) {
        snowRush += h.snow;
        iceRush += h.ice;
      }
      if (h.snow > 0.02 || h.ice > 0.005) lastSnowHour = h.time;
    } else if (h.time >= schoolStart && h.time < schoolEnd) {
      snowSchool += h.snow;
      iceSchool += h.ice;
    }
    if (h.time >= `${forDate}T05:00` && h.time <= `${forDate}T08:00`) {
      const c = Math.min(h.windChillF ?? Infinity, h.tempF ?? Infinity);
      if (Number.isFinite(c)) minChillRush = minChillRush === null ? c : Math.min(minChillRush, c);
    }
    if (h.time >= `${forDate}T02:00` && h.time <= `${forDate}T07:00` && h.tempF !== null) {
      minTempEarly = minTempEarly === null ? h.tempF : Math.min(minTempEarly, h.tempF);
    }
  }

  // roads get treated when the snow is over by 2 AM and it stays above freezing
  const endedEarly = lastSnowHour !== null && lastSnowHour < `${forDate}T02:00`;
  const treated = endedEarly && minTempEarly !== null && minTempEarly > 32 && iceDec < 0.01;
  const melt = treated ? W.meltFactor : 1;

  const snowPts = (snowDec + snowRush * W.snowRush) * W.snowDecision * melt;
  const icePts = (iceDec + iceRush * W.snowRush) * W.iceDecision;
  let cold = 0;
  if (minChillRush !== null && minChillRush <= inp.district.coldWindChillF) {
    cold = Math.min(W.coldMax, W.coldBase + (inp.district.coldWindChillF - minChillRush) * W.coldPerDegree);
  }
  const events = inp.alerts.map((a) => a.toLowerCase());
  let alertPts = 0;
  if (events.some((e) => /winter storm warning|ice storm warning|blizzard warning/.test(e))) alertPts = W.alertWarning;
  else if (events.some((e) => /winter weather advisory|winter storm watch|freezing rain advisory/.test(e))) alertPts = W.alertAdvisory;
  if (events.some((e) => /extreme cold warning|wind chill warning/.test(e))) alertPts += W.alertExtremeCold;

  const decisionPts = snowPts + icePts + cold + alertPts;
  const schoolPts = snowSchool * W.snowSchoolDay + iceSchool * W.iceSchoolDay;
  const total = decisionPts + schoolPts;

  const shift = (inp.district.toughness - 0.5) * W.toughnessShift;
  const closed = curve(total, W.closeMid + shift, W.closeSpread);
  // delays only come from trouble in the decision window; snow later in the day is early dismissal
  const any = curve(decisionPts, W.anyMid + shift / 2, W.anySpread);
  const delayed = Math.max(0, Math.min(0.6, any - curve(decisionPts, W.closeMid + shift, W.closeSpread)));

  // reasons, most important first, at most 4
  const reasons: string[] = [];
  if (iceDec >= 0.02) reasons.push(iceRush >= 0.01 ? "Ice on the roads at bus time" : "Ice expected overnight");
  if (snowDec >= 0.3) reasons.push(`${fmtIn(snowDec)} of snow overnight`);
  if (snowRush >= 0.3) reasons.push("Snow still falling around bus time");
  const ev = inp.alerts.find((a) => /winter storm warning|ice storm warning|blizzard warning|winter weather advisory|winter storm watch|extreme cold warning/i.test(a));
  if (ev) reasons.push(`${ev} in effect`);
  if (cold > 0 && minChillRush !== null) reasons.push(`Wind chill near ${Math.round(minChillRush)}°F at bus time`);
  if (treated && snowDec >= 0.3) reasons.push("Snow ends early and stays above freezing, so roads should be treated");
  if (snowSchool >= 0.5 || iceSchool >= 0.05) reasons.push("Snow during the school day may mean early dismissal");

  // confidence: ensemble spread and lead time
  const leadH = (Date.parse(`${forDate}T07:00:00Z`) - Date.parse(`${inp.nowLocal.slice(0, 16)}:00Z`)) / 3_600_000;
  const rank = { low: 0, medium: 1, high: 2 } as const;
  let c: SnowConfidence = "high";
  const worse = (x: SnowConfidence): void => {
    if (rank[x] < rank[c]) c = x;
  };
  if (leadH >= W.leadLow) worse("low");
  else if (leadH >= W.leadMedium) worse("medium");
  if (inp.range === null) worse("medium");
  else {
    const width = inp.range[1] - inp.range[0];
    if (width >= W.widthLow) worse("low");
    else if (width >= W.widthMedium) worse("medium");
  }

  return {
    forDate,
    closed: Math.round(closed * 1000) / 1000,
    delayed: Math.round(delayed * 1000) / 1000,
    band: bandFor(closed),
    reasons: reasons.slice(0, 4),
    range: inp.range,
    confidence: c,
    note,
    facts: {
      snowIn: round1(snowDec + snowSchool),
      iceIn: Math.round((iceDec + iceSchool) * 100) / 100,
      coldF: cold > 0 && minChillRush !== null ? Math.round(minChillRush) : null,
      rush: snowRush >= 0.3 || iceRush >= 0.01,
      schoolDaySnowIn: round1(snowSchool),
    },
  };
}

/** Segment relevance: only Nov 1 to Apr 15; 1 when closure is a real chance, 0.5 when any wintry weather is in the window. */
export function snowDayRelevance(odds: SnowDayOdds | null, nowLocal: string): number {
  if (!odds) return 0;
  const md = nowLocal.slice(5, 10);
  if (md > "04-15" && md < "11-01") return 0;
  if (odds.closed >= 0.2) return 1;
  return odds.facts.snowIn + odds.facts.iceIn > 0.05 ? 0.5 : 0;
}

/** Fallback when NWS grid data is down: rough hourly amounts from Open-Meteo weather codes. */
export function hoursFromCodes(hourly: { time: string; temp: number; feelsLike: number; code: number }[]): SnowHour[] {
  const SNOW: Record<number, number> = { 71: 0.1, 73: 0.25, 75: 0.5, 77: 0.1, 85: 0.2, 86: 0.5 };
  const ICE: Record<number, number> = { 56: 0.01, 57: 0.03, 66: 0.02, 67: 0.05 };
  return hourly.map((h) => ({
    time: `${h.time.slice(0, 13)}:00`,
    snow: SNOW[h.code] ?? 0,
    ice: ICE[h.code] ?? 0,
    tempF: h.temp,
    windChillF: h.feelsLike,
  }));
}

// ── calibration record (admin) ──

export type SnowOutcome = "open" | "delayed" | "closed" | "remote";
export const OUTCOMES: SnowOutcome[] = ["open", "delayed", "closed", "remote"];

export interface SnowLogEntry {
  id: string;
  forDate: string;
  districtId: string;
  districtName: string;
  band: SnowBand;
  closed: number;
  delayed: number;
  /** what actually happened; null until the admin fills it in */
  actual: SnowOutcome | null;
}

export const SNOW_LOG_MAX = 200;

export interface BandRecord {
  band: SnowBand;
  n: number;
  open: number;
  delayed: number;
  closed: number;
}

/** Outcomes per forecast band (closed counts remote days too). Only days with a known outcome. */
export function snowRecord(log: SnowLogEntry[]): BandRecord[] {
  const bands: SnowBand[] = ["none", "low", "some", "good", "high", "very_high"];
  return bands.map((band) => {
    const rows = log.filter((e) => e.band === band && e.actual !== null);
    return {
      band,
      n: rows.length,
      open: rows.filter((e) => e.actual === "open").length,
      delayed: rows.filter((e) => e.actual === "delayed").length,
      closed: rows.filter((e) => e.actual === "closed" || e.actual === "remote").length,
    };
  });
}

export function normalizeSnowLog(raw: unknown): SnowLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const bands = new Set<string>(["none", "low", "some", "good", "high", "very_high"]);
  const out: SnowLogEntry[] = [];
  for (const e of raw) {
    if (typeof e !== "object" || e === null) continue;
    const r = e as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.forDate !== "string" || !/^\d{4}-\d\d-\d\d$/.test(r.forDate)) continue;
    if (typeof r.band !== "string" || !bands.has(r.band)) continue;
    out.push({
      id: r.id.slice(0, 80),
      forDate: r.forDate,
      districtId: String(r.districtId ?? "").slice(0, 40),
      districtName: String(r.districtName ?? "").slice(0, 60),
      band: r.band as SnowBand,
      closed: Math.min(1, Math.max(0, Number(r.closed) || 0)),
      delayed: Math.min(1, Math.max(0, Number(r.delayed) || 0)),
      actual: OUTCOMES.includes(r.actual as SnowOutcome) ? (r.actual as SnowOutcome) : null,
    });
  }
  return out.slice(0, SNOW_LOG_MAX);
}

/** The configured district closest to a point, if one is within `maxMi` miles. */
export function pickDistrict<T extends { lat: number; lon: number }>(districts: T[], lat: number, lon: number, maxMi = 25): { district: T; distanceMi: number } | null {
  let best: { district: T; distanceMi: number } | null = null;
  for (const d of districts) {
    const mi = haversineMi(lat, lon, d.lat, d.lon);
    if (mi <= maxMi && (!best || mi < best.distanceMi)) best = { district: d, distanceMi: Math.round(mi * 10) / 10 };
  }
  return best;
}

/** What /api/snowday returns. */
export interface SnowDayResponse {
  fetchedAt: string;
  enabled: boolean;
  district: { id: string; name: string; distanceMi: number } | null;
  /** where the hourly numbers came from */
  source: "nws" | "model" | null;
  odds: SnowDayOdds | null;
}
