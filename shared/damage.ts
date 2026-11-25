// Storm damage report: pure logic. Parses the Iowa Environmental Mesonet (IEM) feeds, merges them with the
// SPC reports we already fetch, and builds the one-page report. The summary is a template: no LLM, ever.
import { haversineMi, pointInGeometry } from "./geo";
import { compass } from "./live/track";
import type { StormReport } from "./reports";
import type { PolygonGeom } from "./types";

// TODO(MRMS): radar-estimated hail size (MESH) needs a GRIB2 decoder, so it is not included yet.

export type DamageKind = "hail" | "wind" | "tornado" | "flood";
export type Measure = "measured" | "estimated" | "unknown";

/** One local storm report, from either IEM or SPC. */
export interface Lsr {
  kind: DamageKind;
  /** ISO time */
  time: string;
  lat: number;
  lon: number;
  /** hail inches, wind mph, tornado EF number; null when the report gave none */
  magnitude: number | null;
  measure: Measure;
  /** short place text from the reporter, e.g. "1 N Huffs Church" */
  place: string;
  remark: string;
  source: string;
  origin: "iem" | "spc";
}

export interface WarningRec {
  /** "Severe Thunderstorm Warning" */
  name: string;
  /** "SV", "TO", "FF" ... */
  phenomena: string;
  wfo: string;
  eventid: number;
  issue: string;
  expire: string;
  windTag: number | null;
  hailTag: number | null;
  geometry: PolygonGeom;
  /** when this polygon was in effect (a warning's polygon shrinks as it ages) */
  polyBegin: string;
  polyEnd: string;
}

export interface Gust {
  station: string;
  lat: number;
  lon: number;
  mph: number;
  time: string;
}

// ---------- limits ----------

export const REPORT_RADIUS_MI = { hail: 10, wind: 10, tornado: 10, flood: 5 } as const;
export const GUST_RADIUS_MI = 30;
export const MAX_GUST_STATIONS = 3;
/** how many reports the one-page printout lists; the rest are only counted */
export const MAX_LISTED = 12;
export const MIN_DATE = "2003-01-01";
export const MAX_RANGE_DAYS = 3;

// ---------- parsers (IEM) ----------

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

interface RawFeature {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown } | null;
}

/** IEM lsr.geojson. Rain, snow and other types are dropped: only hail, wind, tornado and flood matter here. */
export function parseIemLsr(json: unknown): Lsr[] {
  const out: Lsr[] = [];
  const feats = (json as { features?: RawFeature[] } | null)?.features ?? [];
  for (const f of feats) {
    const p = f.properties ?? {};
    const t = String(p.typetext ?? "").toUpperCase();
    let kind: DamageKind | null = null;
    if (t === "HAIL") kind = "hail";
    else if (t === "TSTM WND DMG" || t === "TSTM WND GST" || t === "NON-TSTM WND DMG" || t === "NON-TSTM WND GST") kind = "wind";
    else if (t === "TORNADO") kind = "tornado";
    else if (t === "FLOOD" || t === "FLASH FLOOD") kind = "flood";
    const lat = num(p.lat);
    const lon = num(p.lon);
    const time = typeof p.valid === "string" ? Date.parse(p.valid) : Number.NaN;
    if (!kind || lat === null || lon === null || !Number.isFinite(time)) continue;
    const q = String(p.qualifier ?? "").toUpperCase();
    out.push({
      kind,
      time: new Date(time).toISOString(),
      lat,
      lon,
      magnitude: kind === "flood" ? null : num(p.magnitude),
      measure: q === "M" ? "measured" : q === "E" ? "estimated" : "unknown",
      place: String(p.city ?? "").slice(0, 60),
      remark: String(p.remark ?? "").slice(0, 200),
      source: String(p.source ?? "").slice(0, 40),
      origin: "iem",
    });
  }
  return out;
}

/** IEM sbw.geojson: storm-based warning polygons. Only warnings (significance W) are kept. */
export function parseIemSbw(json: unknown): WarningRec[] {
  const out: WarningRec[] = [];
  const feats = (json as { features?: RawFeature[] } | null)?.features ?? [];
  for (const f of feats) {
    const p = f.properties ?? {};
    const g = f.geometry;
    if (p.significance !== "W" || !g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const issue = String(p.issue ?? "");
    const expire = String(p.expire_utc ?? p.expire ?? "");
    if (!Number.isFinite(Date.parse(issue)) || !Number.isFinite(Date.parse(expire))) continue;
    out.push({
      name: String(p.ps ?? "Warning"),
      phenomena: String(p.phenomena ?? ""),
      wfo: String(p.wfo ?? ""),
      eventid: num(p.eventid) ?? 0,
      issue,
      expire,
      windTag: num(p.max_windtag ?? p.windtag),
      hailTag: num(p.max_hailtag ?? p.hailtag),
      geometry: g as PolygonGeom,
      polyBegin: String(p.polygon_begin ?? issue),
      polyEnd: String(p.polygon_end ?? expire),
    });
  }
  return out;
}

const MPH_PER_KT = 1.15078;

/**
 * IEM asos.py CSV (`onlycomma`, tz=UTC, latlon=yes) with columns station,valid,lon,lat,gust,peak_wind_gust,peak_wind_time.
 * Speeds are knots; the result is mph, the highest value per station.
 */
export function parseAsosGusts(csv: string): Gust[] {
  const lines = csv.split(/\r?\n/);
  const head = (lines[0] ?? "").split(",");
  const col = (n: string) => head.indexOf(n);
  const [iSt, iValid, iLon, iLat, iGust, iPeak, iPeakT] = ["station", "valid", "lon", "lat", "gust", "peak_wind_gust", "peak_wind_time"].map(col);
  if ([iSt, iValid, iLon, iLat, iGust].some((i) => i === undefined || i < 0)) return [];
  const utc = (s: string | undefined): number => (s ? Date.parse(`${s.trim().replace(" ", "T")}Z`) : Number.NaN);
  const best = new Map<string, Gust>();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const c = line.split(",");
    const lat = num(c[iLat!]);
    const lon = num(c[iLon!]);
    if (lat === null || lon === null) continue;
    for (const [val, when] of [
      [c[iGust!], c[iValid!]],
      [iPeak! >= 0 ? c[iPeak!] : undefined, iPeakT! >= 0 ? c[iPeakT!] || c[iValid!] : c[iValid!]],
    ] as const) {
      const kt = num(val);
      const t = utc(when);
      if (kt === null || !Number.isFinite(t)) continue;
      const mph = Math.round(kt * MPH_PER_KT);
      const prev = best.get(c[iSt!]!);
      if (!prev || mph > prev.mph) best.set(c[iSt!]!, { station: c[iSt!]!, lat, lon, mph, time: new Date(t).toISOString() });
    }
  }
  return [...best.values()];
}

/** SPC reports (the live CSV feeds) in the same shape as IEM's. */
export function lsrsFromSpc(list: StormReport[]): Lsr[] {
  return list.map((r) => {
    const m = /[\d.]+/.exec(r.magnitude);
    return {
      kind: r.kind,
      time: r.time,
      lat: r.lat,
      lon: r.lon,
      magnitude: m ? Number(m[0]) : null,
      measure: "unknown" as const,
      place: r.location,
      remark: r.comments.slice(0, 200),
      source: "SPC preliminary report",
      origin: "spc" as const,
    };
  });
}

// ---------- dedupe ----------

/** Same kind, within 5 minutes and within 1 mile: the same report arriving from two sources. IEM wins (it has the qualifier). */
export function dedupeLsrs(list: Lsr[]): Lsr[] {
  const sorted = [...list].sort((a, b) => (a.origin === b.origin ? 0 : a.origin === "iem" ? -1 : 1));
  const kept: Lsr[] = [];
  for (const r of sorted) {
    const t = Date.parse(r.time);
    const dup = kept.some((k) => k.kind === r.kind && Math.abs(Date.parse(k.time) - t) <= 300_000 && haversineMi(k.lat, k.lon, r.lat, r.lon) <= 1);
    if (!dup) kept.push(r);
  }
  return kept;
}

// ---------- local day window ----------

/** UTC offset (ms) of a time zone at an instant. */
function tzOffsetMs(tz: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(at / 1000) * 1000;
}

/** The instant a local calendar day (YYYY-MM-DD) starts, in `tz`. Correct on DST days (23 or 25 hour days). */
export function localMidnight(date: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(tz, guess);
  t = guess - tzOffsetMs(tz, t); // re-check with the offset that applies at the result
  return t;
}

export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Local midnight to local midnight, `daysAfter` extra days on the end and `daysBefore` on the start. */
export function dayWindow(date: string, tz: string, daysBefore = 0, daysAfter = 0): { start: number; end: number } {
  return { start: localMidnight(addDays(date, -daysBefore), tz), end: localMidnight(addDays(date, daysAfter + 1), tz) };
}

/** Why a date can't be reported on, or null when it's fine. `today` is the local YYYY-MM-DD. */
export function dateProblem(date: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return "bad_date";
  if (date < MIN_DATE) return "too_old";
  if (date > today) return "future";
  return null;
}

// ---------- the report ----------

export interface ReportItem extends Omit<Lsr, "magnitude" | "origin"> {
  magnitude: number | null;
  /** miles from the address, 1 decimal */
  distanceMi: number;
  /** compass word from the address: "NW" */
  direction: string;
  /** "1.75 in hail", "60 mph wind gust", "wind damage" */
  label: string;
  origin: "iem" | "spc";
}

export interface WarningItem {
  name: string;
  wfo: string;
  eventid: number;
  issue: string;
  expire: string;
  windTag: number | null;
  hailTag: number | null;
}

export interface GustItem extends Gust {
  distanceMi: number;
  direction: string;
}

export interface DamageReport {
  point: { lat: number; lon: number };
  /** the local day asked for, YYYY-MM-DD */
  date: string;
  tz: string;
  windowStart: string;
  windowEnd: string;
  /** reports in range, nearest first (all of them) */
  reports: ReportItem[];
  warnings: WarningItem[];
  /** the polygons of the warnings that covered the point (for the map) */
  warningShapes: PolygonGeom[];
  gusts: GustItem[];
  summary: string;
  /** hail inches / wind mph maxima among the listed reports */
  maxHailIn: number | null;
  maxWindMph: number | null;
  empty: boolean;
  /** sources that failed to answer, so the page can say the report may be incomplete */
  missing: string[];
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const ABBR: Record<string, string> = { north: "N", northeast: "NE", east: "E", southeast: "SE", south: "S", southwest: "SW", west: "W", northwest: "NW" };

/** "NW" for a bearing in degrees (reuses the live tracker compass words). */
export const compassAbbr = (deg: number): string => ABBR[compass(deg)] ?? compass(deg);

function labelFor(r: Lsr): string {
  const m = r.magnitude;
  if (r.kind === "hail") return m !== null ? `${Number(m.toFixed(2))} in. hail` : "hail";
  if (r.kind === "wind") return m !== null ? `${Math.round(m)} mph wind${r.remark && /damage|down|tree|pole/i.test(r.remark) ? " (damage reported)" : ""}` : "wind damage";
  if (r.kind === "tornado") return m !== null ? `EF${m} tornado` : "tornado";
  return "flooding";
}

const clock = (iso: string | number, tz: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** "4:12 to 5:00 PM" when both end in the same half of the day, else "11:40 AM to 12:20 PM". */
export function clockRange(a: string | number, b: string | number, tz: string): string {
  const x = clock(a, tz);
  const y = clock(b, tz);
  const ap = (s: string) => s.slice(-2);
  return ap(x) === ap(y) ? `${x.slice(0, -3)} to ${y}` : `${x} to ${y}`;
}

export interface DamageInput {
  point: { lat: number; lon: number };
  /** local YYYY-MM-DD */
  date: string;
  tz: string;
  lsrs: Lsr[];
  warnings: WarningRec[];
  gusts: Gust[];
  daysBefore?: number;
  daysAfter?: number;
  missing?: string[];
}

export function buildDamageReport(input: DamageInput): DamageReport {
  const { point, date, tz } = input;
  const win = dayWindow(date, tz, input.daysBefore ?? 0, input.daysAfter ?? 0);
  const inWin = (iso: string) => {
    const t = Date.parse(iso);
    return t >= win.start && t < win.end;
  };

  const reports: ReportItem[] = dedupeLsrs(input.lsrs)
    .filter((r) => inWin(r.time))
    .map((r) => ({ r, d: haversineMi(point.lat, point.lon, r.lat, r.lon) }))
    .filter(({ r, d }) => d <= REPORT_RADIUS_MI[r.kind])
    .sort((a, b) => a.d - b.d)
    .map(({ r, d }) => ({
      ...r,
      distanceMi: r1(d),
      direction: d < 0.05 ? "here" : compassAbbr(bearingDeg(point.lat, point.lon, r.lat, r.lon)),
      label: labelFor(r),
    }));

  // A warning is re-issued as updates; fold them into one entry per event, keeping only polygons that held the point.
  const byEvent = new Map<string, { item: WarningItem; shape: PolygonGeom }>();
  for (const w of input.warnings) {
    if (!pointInGeometry(point.lon, point.lat, w.geometry)) continue;
    if (Date.parse(w.expire) < win.start || Date.parse(w.issue) >= win.end) continue;
    const key = `${w.wfo}:${w.phenomena}:${w.eventid}`;
    const cur = byEvent.get(key);
    const item: WarningItem = { name: w.name, wfo: w.wfo, eventid: w.eventid, issue: w.issue, expire: w.expire, windTag: w.windTag, hailTag: w.hailTag };
    if (!cur) byEvent.set(key, { item, shape: w.geometry });
    else {
      if (Date.parse(w.issue) < Date.parse(cur.item.issue)) cur.item.issue = w.issue;
      if (Date.parse(w.expire) > Date.parse(cur.item.expire)) cur.item.expire = w.expire;
    }
  }
  const covered = [...byEvent.values()].sort((a, b) => Date.parse(a.item.issue) - Date.parse(b.item.issue));
  const warnings = covered.map((c) => c.item);

  const gusts: GustItem[] = input.gusts
    .filter((g) => inWin(g.time))
    .map((g) => ({ g, d: haversineMi(point.lat, point.lon, g.lat, g.lon) }))
    .filter(({ d }) => d <= GUST_RADIUS_MI)
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_GUST_STATIONS)
    .map(({ g, d }) => ({ ...g, distanceMi: r1(d), direction: compassAbbr(bearingDeg(point.lat, point.lon, g.lat, g.lon)) }));

  const hails = reports.filter((r) => r.kind === "hail" && r.magnitude !== null);
  const winds = reports.filter((r) => r.kind === "wind" && r.magnitude !== null);
  const maxHail = hails.reduce<ReportItem | null>((m, r) => (!m || r.magnitude! > m.magnitude! ? r : m), null);
  const maxWind = winds.reduce<ReportItem | null>((m, r) => (!m || r.magnitude! > m.magnitude! ? r : m), null);

  const report: DamageReport = {
    point,
    date,
    tz,
    windowStart: new Date(win.start).toISOString(),
    windowEnd: new Date(win.end).toISOString(),
    reports,
    warnings,
    warningShapes: covered.map((c) => c.shape),
    gusts,
    summary: "",
    maxHailIn: maxHail?.magnitude ?? null,
    maxWindMph: maxWind?.magnitude ?? null,
    empty: !reports.length && !warnings.length && !gusts.length,
    missing: input.missing ?? [],
  };
  report.summary = summarize(report, maxHail, maxWind);
  return report;
}

function summarize(r: DamageReport, maxHail: ReportItem | null, maxWind: ReportItem | null): string {
  if (r.empty) {
    return "No warnings, storm reports or strong wind gusts were found for this address on this date. That does not prove nothing happened: storm reports come from spotters and the public, and many places never get one.";
  }
  const parts: string[] = [];
  if (r.warnings.length === 1) {
    const w = r.warnings[0]!;
    parts.push(`A ${w.name} covered this address from ${clockRange(w.issue, w.expire, r.tz)}.`);
  } else if (r.warnings.length > 1) {
    const list = r.warnings.map((w) => `${w.name} (${clockRange(w.issue, w.expire, r.tz)})`).join("; ");
    parts.push(`${r.warnings.length} warnings covered this address: ${list}.`);
  } else {
    parts.push("No NWS warning polygon covered this exact address on this date.");
  }
  const bits: string[] = [];
  if (maxHail) bits.push(`${maxHail.label} was reported ${maxHail.distanceMi} mi ${maxHail.direction} at ${clock(maxHail.time, r.tz)}`);
  if (maxWind) bits.push(`${maxWind.label} was reported ${maxWind.distanceMi} mi ${maxWind.direction} at ${clock(maxWind.time, r.tz)}`);
  const tor = r.reports.find((x) => x.kind === "tornado");
  if (tor) bits.push(`a ${tor.label} was reported ${tor.distanceMi} mi ${tor.direction} at ${clock(tor.time, r.tz)}`);
  const near = r.reports.find((x) => x !== maxHail && x !== maxWind && x !== tor && (x.kind === "wind" || x.kind === "flood"));
  if (near && !maxWind) bits.push(`${near.label} was reported ${near.distanceMi} mi ${near.direction} at ${clock(near.time, r.tz)}`);
  if (bits.length) parts.push(`${bits.map((b, i) => (i === 0 ? b[0]!.toUpperCase() + b.slice(1) : b)).join("; ")}.`);
  else if (r.reports.length) parts.push(`${r.reports.length} nearby storm ${r.reports.length === 1 ? "report was" : "reports were"} filed.`);
  else parts.push("No nearby hail, wind or flood reports were found.");
  const g = [...r.gusts].sort((a, b) => b.mph - a.mph)[0];
  if (g) parts.push(`The highest gust measured at a nearby station was ${g.mph} mph at ${g.station}, ${g.distanceMi} mi ${g.direction}, at ${clock(g.time, r.tz)}.`);
  if (r.missing.length) parts.push(`Some data was unavailable (${r.missing.join(", ")}), so this may be incomplete.`);
  return parts.join(" ");
}

// ---------- ASOS networks ----------

const NEIGHBORS: Record<string, string[]> = {
  PA: ["NJ", "DE", "MD", "NY", "OH", "WV"],
  NJ: ["PA", "DE", "NY", "MD"],
  DE: ["PA", "NJ", "MD"],
  MD: ["PA", "DE", "VA", "WV", "NJ"],
  NY: ["NJ", "PA", "CT", "MA", "VT"],
  CT: ["NY", "MA", "RI"],
  MA: ["NY", "CT", "RI", "NH", "VT"],
  VA: ["MD", "WV", "NC", "TN", "KY", "DE"],
  DC: ["MD", "VA"],
};

/** IEM ASOS network ids to ask for: the state itself and its neighbours (a station 20 miles away may be over the line). */
export function asosNetworks(state: string | null): string[] {
  if (!state || !/^[A-Z]{2}$/.test(state)) return [];
  return [state, ...(NEIGHBORS[state] ?? [])].map((s) => `${s}_ASOS`);
}
