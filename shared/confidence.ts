// Forecast confidence from an ensemble (many slightly different model runs).
// When the runs agree, confidence is high; when they spread out, we show the range instead of fake precision.

export type ConfidenceLevel = "high" | "medium" | "low";

export interface Band {
  p10: number;
  p50: number;
  p90: number;
}

export interface Rating {
  level: ConfidenceLevel;
  why: string;
}

/** What the confidence is about. The day's overall level is the worst of these. */
export type ConfidencePart = "temp" | "rain" | "snow" | "wind" | "dew";

export interface DayConfidence {
  date: string;
  hi: Band;
  lo: Band;
  /** inches, 10th..90th percentile of the members */
  precip: Band;
  snow: Band;
  /** strongest gust, mph (missing in data cached before it was added) */
  gust?: Band;
  /** daily mean dew point, °F */
  dew?: Band;
  /** share of members with at least 0.01 in, 0..100 */
  wetChance: number;
  level: ConfidenceLevel;
  /** short reason, e.g. "Models disagree on the high by 9°" */
  why: string;
  /** one rating per weather element */
  parts?: Record<ConfidencePart, Rating>;
}

export interface Confidence {
  fetchedAt: string;
  members: number;
  model: string;
  days: DayConfidence[];
}

export function percentile(values: number[], p: number): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const idx = (v.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo]! + (v[hi]! - v[lo]!) * (idx - lo);
}

const band = (v: number[], digits = 0) => {
  const f = 10 ** digits;
  const r = (x: number) => Math.round(x * f) / f;
  return { p10: r(percentile(v, 0.1)), p50: r(percentile(v, 0.5)), p90: r(percentile(v, 0.9)) };
};

const HIGH: Rating = { level: "high", why: "Models agree" };
const RANK: Record<ConfidenceLevel, number> = { high: 0, medium: 1, low: 2 };

const spread = (b: Band) => b.p90 - b.p10;

/**
 * Rate each weather element of one day from how far the ensemble runs spread.
 * Temperature and dew point spread grow with lead time, so their cut-offs widen too.
 */
export function rateParts(d: { hi: Band; precip: Band; snow: Band; gust?: Band; dew?: Band; wetChance: number }, lead: number): Record<ConfidencePart, Rating> {
  const hiS = spread(d.hi);
  const temp: Rating =
    hiS > 8 + lead ? { level: "low", why: `Models disagree on the high by ${Math.round(hiS)}°` }
    : hiS > 4 + lead * 0.6 ? { level: "medium", why: `High could vary by ${Math.round(hiS)}°` }
    : HIGH;

  const snS = spread(d.snow);
  const snow: Rating = snS >= 3 ? { level: "low", why: "Snow totals range widely" } : snS >= 1 ? { level: "medium", why: "Snow totals are uncertain" } : HIGH;

  const prS = spread(d.precip);
  const rain: Rating =
    prS >= 1 ? { level: "low", why: "Rain totals range widely" }
    : d.wetChance >= 30 && d.wetChance <= 70 ? { level: "medium", why: `Models split on rain (${d.wetChance}% of runs)` }
    : prS >= 0.4 ? { level: "medium", why: "Rain totals are uncertain" }
    : HIGH;

  // gust spread only matters once it could get windy
  const g = d.gust;
  const gS = g ? spread(g) : 0;
  const wind: Rating =
    !g || g.p90 < 25 ? HIGH
    : gS >= 25 ? { level: "low", why: `Gusts could be ${Math.round(g.p10)} to ${Math.round(g.p90)} mph` }
    : gS >= 15 ? { level: "medium", why: `Gusts could vary by ${Math.round(gS)} mph` }
    : HIGH;

  const dS = d.dew ? spread(d.dew) : 0;
  const dew: Rating =
    dS > 10 + lead ? { level: "low", why: `Models disagree on humidity (dew point by ${Math.round(dS)}°)` }
    : dS > 6 + lead * 0.6 ? { level: "medium", why: `Dew point could vary by ${Math.round(dS)}°` }
    : HIGH;

  return { temp, rain, snow, wind, dew };
}

/** The day's overall rating: the least sure element (temperature first on ties, so the old wording stays). */
export function worstPart(parts: Record<ConfidencePart, Rating>): Rating {
  const order: ConfidencePart[] = ["temp", "snow", "rain", "wind", "dew"];
  return order.map((k) => parts[k]).reduce((a, b) => (RANK[b.level] > RANK[a.level] ? b : a), HIGH);
}

/** Overall rating for one day (kept for callers that only have the spreads). */
export function rateDay(hiSpread: number, precipSpread: number, snowSpread: number, wetChance: number, lead: number): Rating {
  const b = (s: number): Band => ({ p10: 0, p50: s / 2, p90: s });
  return worstPart(rateParts({ hi: b(hiSpread), precip: b(precipSpread), snow: b(snowSpread), wetChance }, lead));
}

/**
 * Build per-day confidence from Open-Meteo ensemble daily output (one series per member, plus the control).
 * @param daily Open-Meteo `daily` object: time + temperature_2m_max[_memberNN] etc.
 */
export function buildConfidence(daily: Record<string, (number | string | null)[]>, model: string, fetchedAt: string): Confidence {
  const dates = (daily.time ?? []) as string[];
  const series = (base: string) =>
    Object.keys(daily)
      .filter((k) => k === base || k.startsWith(`${base}_member`))
      .map((k) => daily[k]!);
  const hiS = series("temperature_2m_max");
  const loS = series("temperature_2m_min");
  const prS = series("precipitation_sum");
  const snS = series("snowfall_sum");
  const guS = series("wind_gusts_10m_max");
  const dwS = series("dew_point_2m_mean");
  const at = (s: (number | string | null)[][], i: number) =>
    s.map((m) => m[i]).filter((x): x is number => typeof x === "number" && Number.isFinite(x));

  const days: DayConfidence[] = dates.map((date, i) => {
    const pr = at(prS, i);
    const gu = at(guS, i);
    const dw = at(dwS, i);
    const wetChance = pr.length ? Math.round((pr.filter((x) => x >= 0.01).length / pr.length) * 100) : 0;
    const d = {
      hi: band(at(hiS, i)),
      lo: band(at(loS, i)),
      precip: band(pr, 2),
      snow: band(at(snS, i), 1),
      ...(gu.length ? { gust: band(gu) } : {}),
      ...(dw.length ? { dew: band(dw) } : {}),
      wetChance,
    };
    const parts = rateParts(d, i);
    const r = worstPart(parts);
    return { date, ...d, level: r.level, why: r.why, parts };
  });
  return { fetchedAt, members: hiS.length, model, days };
}

/** "72°" when tight, "68–75°" when not. */
export function rangeText(b: { p10: number; p90: number; p50: number }, unit = "°"): string {
  if (!Number.isFinite(b.p50)) return "--";
  return b.p90 - b.p10 <= 2 ? `${Math.round(b.p50)}${unit}` : `${Math.round(b.p10)}–${Math.round(b.p90)}${unit}`;
}

/** "0.1–0.6 in", "40% of runs" or "" when it looks dry. */
export function rainText(b: Band, wetChance: number): string {
  if (!(b.p90 >= 0.05) && wetChance < 30) return "";
  if (wetChance >= 30 && wetChance <= 70) return `${wetChance}% of runs`;
  const f = (x: number) => (x < 0.05 ? "0" : x.toFixed(1));
  return b.p90 - b.p10 < 0.1 ? `about ${f(b.p50)} in` : `${f(b.p10)}–${f(b.p90)} in`;
}

/** "1–6 in" for snow, "" when no snow expected. */
export function snowText(b: { p10: number; p50: number; p90: number }): string {
  if (!(b.p90 >= 0.5)) return "";
  const lo = Math.max(0, Math.floor(b.p10));
  const hi = Math.max(1, Math.ceil(b.p90));
  return lo === hi ? `about ${hi} in` : `${lo}–${hi} in`;
}
