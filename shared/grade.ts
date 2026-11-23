// SHELLY grades itself: store what we forecast, compare with what a real NWS weather station measured.
// Graded: highs/lows, dew point, wind, gusts, rain (amount and the rain/no-rain call), and hour by hour.
import { localDate } from "./nowcast";

/** One forecast hour, saved for the hour-by-hour grade. `t` is epoch seconds (top of the hour). */
export interface HourPrediction {
  t: number;
  temp: number;
  dew: number;
  wind: number;
  gust: number;
  /** inches in the hour ending at `t` */
  precip: number;
  pop: number;
}

/** What SHELLY forecast for one target date, at one lead time. Fields after `lo` were added later and may be missing in old records. */
export interface Prediction {
  /** local date the forecast was made */
  issued: string;
  /** days ahead (1 = forecast for tomorrow) */
  lead: number;
  hi: number;
  lo: number;
  /** daily mean dew point, °F */
  dew?: number;
  /** strongest sustained wind and gust, mph */
  wind?: number;
  gust?: number;
  /** inches */
  precip?: number;
  /** chance of rain, 0..100 */
  pop?: number;
}

/** One station reading, already in °F / mph / inches. `routine` marks the hourly report that carries the last hour's rain. */
export interface Obs {
  time: string;
  tempC: number | null;
  dewC?: number | null;
  windKmh?: number | null;
  gustKmh?: number | null;
  /** rain since the last routine hourly report, mm (null = none reported) */
  precipMm?: number | null;
  routine?: boolean;
}

export interface DayObs {
  hi: number;
  lo: number;
  n: number;
  dew: number | null;
  wind: number | null;
  gust: number | null;
  /** inches, null when the station sent too few hourly reports */
  precip: number | null;
}

export interface LeadGrade {
  hi: number;
  lo: number;
  hiErr: number;
  loErr: number;
  dew?: number;
  dewErr?: number;
  wind?: number;
  windErr?: number;
  gust?: number;
  gustErr?: number;
  precip?: number;
  precipErr?: number;
  pop?: number;
  /** did the rain / no-rain call (pop ≥ 50%) match what happened */
  rainRight?: boolean;
  /** Brier score of the rain chance, 0 = perfect, 1 = worst */
  brier?: number;
}

export interface HourlyGrade {
  /** hours compared */
  n: number;
  /** mean absolute miss per hour */
  temp: number | null;
  dew: number | null;
  wind: number | null;
  /** hours where the rain / no-rain call matched, 0..100 */
  rainRight: number | null;
  /** hours that actually had rain, and hours the forecast had rain */
  wetObs: number;
  wetFc: number;
}

/** One graded day. Errors are forecast minus observed (°F, mph, inches). */
export interface GradedDay {
  date: string;
  station: string;
  obsHi: number;
  obsLo: number;
  obs?: { dew: number | null; wind: number | null; gust: number | null; precip: number | null };
  /** keyed by lead time in days */
  leads: Record<string, LeadGrade>;
  hourly?: HourlyGrade;
}

export interface Stat {
  n: number;
  mae: number | null;
  /** positive = forecast runs high */
  bias: number | null;
}

export interface GradeSummary {
  station: string | null;
  /** the most recent graded day, for "yesterday's high was 2° off" */
  latest: GradedDay | null;
  /** last 30 graded days, lead 1 */
  days30: number;
  /** share of highs within 3°, 0..100 */
  hiWithin3: number | null;
  /** mean absolute error of highs / lows, °F */
  hiMae: number | null;
  loMae: number | null;
  /** positive = SHELLY runs warm */
  hiBias: number | null;
  dew: Stat;
  wind: Stat;
  gust: Stat;
  /** rain amount, inches */
  precip: Stat;
  /** rain / no-rain calls */
  rain: { n: number; right: number | null; brier: number | null };
  /** averages of the hour-by-hour grades */
  hourly: { n: number; temp: number | null; dew: number | null; wind: number | null; rainRight: number | null };
  /** forecasts made 3 days ahead */
  lead3: { n: number; hiMae: number | null; loMae: number | null };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const cToF = (c: number) => (c * 9) / 5 + 32;
const kmhToMph = (k: number) => k / 1.609344;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** A wet hour or day: at least 0.01 in. */
export const WET_IN = 0.01;

/** Highest and lowest temperature (°F) from NWS observations for one local day. Null when too sparse. */
export function dayExtremes(obs: { time: string; tempC: number | null }[], minCount = 16): { hi: number; lo: number; n: number } | null {
  const temps = obs.map((o) => o.tempC).filter(finite);
  if (temps.length < minCount) return null;
  return { hi: Math.round(cToF(Math.max(...temps))), lo: Math.round(cToF(Math.min(...temps))), n: temps.length };
}

const HOUR = 3_600_000;

/**
 * Rain per reporting hour, in mm. A routine report (around :51 to :56) holds the rain since the previous one;
 * a special report in between holds the rain so far in that same hour. So the largest value in each hour
 * is that hour's total, and a missing value means none fell. Bucket `k` covers about (k-1):55 to k:55 UTC.
 */
export function rainBuckets(obs: Obs[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const o of obs) {
    if (!o.routine) continue;
    const ms = Date.parse(o.time);
    if (!Number.isFinite(ms)) continue;
    const k = Math.floor((ms + 5 * 60_000) / HOUR);
    const mm = finite(o.precipMm) && o.precipMm > 0 ? o.precipMm : 0;
    out.set(k, Math.max(out.get(k) ?? 0, mm));
  }
  return out;
}

/** Rain total (inches) for the day. Null when the station sent too few hourly reports to trust. */
export function rainTotal(obs: Obs[], minHours = 18): number | null {
  const b = rainBuckets(obs);
  if (b.size < minHours) return null;
  return r2([...b.values()].reduce((s, x) => s + x, 0) / 25.4);
}

/** Everything one local day measured: extremes, mean dew point, strongest wind and gust, rain. */
export function dayObs(obs: Obs[], minCount = 16): DayObs | null {
  const ext = dayExtremes(obs, minCount);
  if (!ext) return null;
  const dews = obs.map((o) => o.dewC).filter(finite);
  const winds = obs.map((o) => o.windKmh).filter(finite);
  const gusts = obs.map((o) => o.gustKmh).filter(finite);
  const dew = dews.length >= minCount ? Math.round(cToF(mean(dews)!)) : null;
  const wind = winds.length >= minCount ? Math.round(kmhToMph(Math.max(...winds))) : null;
  // a station only reports a gust when there is one; on a calm day the strongest wind stands in
  const gust = wind === null ? null : Math.max(wind, gusts.length ? Math.round(kmhToMph(Math.max(...gusts))) : 0);
  return { ...ext, dew, wind, gust, precip: rainTotal(obs) };
}

/** Hour by hour: compare each forecast hour with the reading closest to it (within 20 min). */
export function gradeHours(hours: HourPrediction[], obs: Obs[]): HourlyGrade | null {
  const timed = obs.map((o) => ({ ...o, ms: Date.parse(o.time) })).filter((o) => Number.isFinite(o.ms));
  const near = (ms: number, list: typeof timed) => {
    let best: (typeof timed)[number] | null = null;
    for (const o of list) if (Math.abs(o.ms - ms) <= 20 * 60_000 && (!best || Math.abs(o.ms - ms) < Math.abs(best.ms - ms))) best = o;
    return best;
  };
  const rain = rainBuckets(obs);
  const tErr: number[] = [];
  const dErr: number[] = [];
  const wErr: number[] = [];
  let rainN = 0;
  let rainOk = 0;
  let wetObs = 0;
  let wetFc = 0;
  for (const h of hours) {
    const ms = h.t * 1000;
    const o = near(ms, timed);
    if (o && finite(o.tempC)) tErr.push(Math.abs(h.temp - cToF(o.tempC)));
    if (o && finite(o.dewC)) dErr.push(Math.abs(h.dew - cToF(o.dewC)));
    if (o && finite(o.windKmh)) wErr.push(Math.abs(h.wind - kmhToMph(o.windKmh)));
    // Open-Meteo's rain at hour t fell in the hour before t; the station's bucket ending near t covers the same span
    const mm = rain.get(Math.floor(ms / HOUR) - 1);
    if (mm !== undefined) {
      const wet = mm / 25.4 >= WET_IN;
      const fcWet = h.precip >= WET_IN;
      rainN++;
      if (wet === fcWet) rainOk++;
      if (wet) wetObs++;
      if (fcWet) wetFc++;
    }
  }
  if (!tErr.length) return null;
  const m = (xs: number[]) => (xs.length ? r1(mean(xs)!) : null);
  return { n: tErr.length, temp: m(tErr), dew: m(dErr), wind: m(wErr), rainRight: rainN ? Math.round((rainOk / rainN) * 100) : null, wetObs, wetFc };
}

export function gradeDay(date: string, station: string, obs: Pick<DayObs, "hi" | "lo"> & Partial<DayObs>, preds: Prediction[], hourly?: HourlyGrade | null): GradedDay {
  const leads: GradedDay["leads"] = {};
  for (const p of preds) {
    const g: LeadGrade = { hi: p.hi, lo: p.lo, hiErr: Math.round(p.hi - obs.hi), loErr: Math.round(p.lo - obs.lo) };
    if (finite(p.dew) && finite(obs.dew)) Object.assign(g, { dew: p.dew, dewErr: Math.round(p.dew - obs.dew) });
    if (finite(p.wind) && finite(obs.wind)) Object.assign(g, { wind: p.wind, windErr: Math.round(p.wind - obs.wind) });
    if (finite(p.gust) && finite(obs.gust)) Object.assign(g, { gust: p.gust, gustErr: Math.round(p.gust - obs.gust) });
    if (finite(p.precip) && finite(obs.precip)) Object.assign(g, { precip: p.precip, precipErr: r2(p.precip - obs.precip) });
    if (finite(p.pop) && finite(obs.precip)) {
      const wet = obs.precip >= WET_IN ? 1 : 0;
      Object.assign(g, { pop: p.pop, rainRight: (p.pop >= 50 ? 1 : 0) === wet, brier: r2((p.pop / 100 - wet) ** 2) });
    }
    leads[String(p.lead)] = g;
  }
  const day: GradedDay = { date, station, obsHi: obs.hi, obsLo: obs.lo, leads };
  if ("dew" in obs || "precip" in obs) day.obs = { dew: obs.dew ?? null, wind: obs.wind ?? null, gust: obs.gust ?? null, precip: obs.precip ?? null };
  if (hourly) day.hourly = hourly;
  return day;
}

function stat(errs: (number | undefined)[], digits = 1): Stat {
  const e = errs.filter(finite);
  const f = digits === 2 ? r2 : r1;
  const mae = mean(e.map(Math.abs));
  const bias = mean(e);
  return { n: e.length, mae: mae === null ? null : f(mae), bias: bias === null ? null : f(bias) };
}

export function summarize(history: GradedDay[], lead = 1): GradeSummary {
  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  const withLead = sorted.filter((d) => d.leads[String(lead)]).slice(0, 30);
  const errs = withLead.map((d) => d.leads[String(lead)]!);
  const hiMae = mean(errs.map((e) => Math.abs(e.hiErr)));
  const loMae = mean(errs.map((e) => Math.abs(e.loErr)));
  const bias = mean(errs.map((e) => e.hiErr));
  const calls = errs.filter((e) => typeof e.rainRight === "boolean");
  const briers = errs.map((e) => e.brier).filter(finite);
  const hrs = sorted.slice(0, 30).map((d) => d.hourly).filter((h): h is HourlyGrade => !!h);
  const hmean = (xs: (number | null)[]) => {
    const v = xs.filter(finite);
    return v.length ? r1(mean(v)!) : null;
  };
  const l3 = sorted.filter((d) => d.leads["3"]).slice(0, 30).map((d) => d.leads["3"]!);
  const l3hi = mean(l3.map((e) => Math.abs(e.hiErr)));
  const l3lo = mean(l3.map((e) => Math.abs(e.loErr)));
  return {
    station: sorted[0]?.station ?? null,
    latest: withLead[0] ?? null,
    days30: withLead.length,
    hiWithin3: errs.length ? Math.round((errs.filter((e) => Math.abs(e.hiErr) <= 3).length / errs.length) * 100) : null,
    hiMae: hiMae === null ? null : r1(hiMae),
    loMae: loMae === null ? null : r1(loMae),
    hiBias: bias === null ? null : r1(bias),
    dew: stat(errs.map((e) => e.dewErr)),
    wind: stat(errs.map((e) => e.windErr)),
    gust: stat(errs.map((e) => e.gustErr)),
    precip: stat(errs.map((e) => e.precipErr), 2),
    rain: {
      n: calls.length,
      right: calls.length ? Math.round((calls.filter((e) => e.rainRight).length / calls.length) * 100) : null,
      brier: briers.length ? r2(mean(briers)!) : null,
    },
    hourly: { n: hrs.length, temp: hmean(hrs.map((h) => h.temp)), dew: hmean(hrs.map((h) => h.dew)), wind: hmean(hrs.map((h) => h.wind)), rainRight: hmean(hrs.map((h) => h.rainRight)) },
    lead3: { n: l3.length, hiMae: l3hi === null ? null : r1(l3hi), loMae: l3lo === null ? null : r1(l3lo) },
  };
}

/** "Yesterday's forecast high was 2° too warm (54° vs 52°)." */
export function latestLine(d: GradedDay, lead = 1): string {
  const e = d.leads[String(lead)];
  if (!e) return "";
  const off = Math.abs(e.hiErr);
  const dir = e.hiErr > 0 ? "too warm" : "too cool";
  const head = off === 0 ? "Nailed it: the forecast high was exactly right" : `The forecast high was ${off}° ${dir}`;
  return `${head} (${Math.round(e.hi)}° forecast, ${d.obsHi}° measured).`;
}

const inches = (v: number) => (v < WET_IN ? "none" : `${v.toFixed(2)} in`);

/** "Rain: 40% chance, and 0.32 in fell." or "" when not graded. */
export function rainLine(d: GradedDay, lead = 1): string {
  const e = d.leads[String(lead)];
  const got = d.obs?.precip;
  if (!e || !finite(e.pop) || !finite(got)) return "";
  const wet = got >= WET_IN;
  const verdict = e.rainRight ? (wet ? "Right call" : "Right call, it stayed dry") : wet ? "Missed: rain fell" : "Missed: it stayed dry";
  const amount = finite(e.precip) && (wet || e.precip >= WET_IN) ? ` (${inches(e.precip)} forecast, ${inches(got)} measured)` : "";
  return `Rain: ${verdict}${amount}.`;
}

/** "Gusts: 30 mph forecast, 38 mph measured." or "". */
export function windLine(d: GradedDay, lead = 1): string {
  const e = d.leads[String(lead)];
  if (!e || !finite(e.gust) || !finite(d.obs?.gust)) return "";
  return `Gusts: ${e.gust} mph forecast, ${d.obs!.gust} mph measured.`;
}

/** Shape of the Open-Meteo request the grader makes (timeformat=unixtime, mph, °F, inches). */
export interface GradeForecastRaw {
  hourly?: Record<string, (number | null)[]>;
  daily?: Record<string, (number | null)[]>;
}

/** Turn the grader's Open-Meteo response into one Prediction per lead, plus the hours of the lead-1 day. */
export function predictionsFrom(raw: GradeForecastRaw, tz: string, today: string, leads: number[]): { preds: (Prediction & { target: string })[]; hours: Record<string, HourPrediction[]> } {
  const h = raw.hourly ?? {};
  const d = raw.daily ?? {};
  const num = (v: unknown) => (finite(v) ? v : 0);
  const hoursAll: HourPrediction[] = ((h.time ?? []) as number[]).map((t, i) => ({
    t,
    temp: Math.round(num(h.temperature_2m?.[i])),
    dew: Math.round(num(h.dew_point_2m?.[i])),
    wind: Math.round(num(h.wind_speed_10m?.[i])),
    gust: Math.round(num(h.wind_gusts_10m?.[i])),
    precip: r2(num(h.precipitation?.[i])),
    pop: Math.round(num(h.precipitation_probability?.[i])),
  }));
  const byDate = new Map<string, HourPrediction[]>();
  for (const x of hoursAll) {
    const k = localDate(tz, new Date(x.t * 1000));
    byDate.set(k, [...(byDate.get(k) ?? []), x]);
  }
  const dates = ((d.time ?? []) as number[]).map((t) => localDate(tz, new Date(t * 1000 + 12 * 3_600_000)));
  const preds: (Prediction & { target: string })[] = [];
  const hours: Record<string, HourPrediction[]> = {};
  for (const lead of leads) {
    const target = addDays(today, lead);
    const i = dates.indexOf(target);
    if (i < 0 || !finite(d.temperature_2m_max?.[i]) || !finite(d.temperature_2m_min?.[i])) continue;
    const dayHours = byDate.get(target) ?? [];
    const dew = dayHours.length ? Math.round(mean(dayHours.map((x) => x.dew))!) : undefined;
    preds.push({
      target,
      issued: today,
      lead,
      hi: Math.round(d.temperature_2m_max![i]!),
      lo: Math.round(d.temperature_2m_min![i]!),
      ...(dew === undefined ? {} : { dew }),
      wind: Math.round(num(d.wind_speed_10m_max?.[i])),
      gust: Math.round(num(d.wind_gusts_10m_max?.[i])),
      precip: r2(num(d.precipitation_sum?.[i])),
      pop: Math.round(num(d.precipitation_probability_max?.[i])),
    });
    if (lead === 1 && dayHours.length) hours[target] = dayHours;
  }
  return { preds, hours };
}

/** "YYYY-MM-DD" plus n days. */
export function addDays(date: string, n: number): string {
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
