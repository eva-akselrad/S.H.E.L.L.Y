// Forecast confidence from an ensemble (many slightly different model runs).
// When the runs agree, confidence is high; when they spread out, we show the range instead of fake precision.

export type ConfidenceLevel = "high" | "medium" | "low";

export interface DayConfidence {
  date: string;
  hi: { p10: number; p50: number; p90: number };
  lo: { p10: number; p50: number; p90: number };
  /** inches, 10th..90th percentile of the members */
  precip: { p10: number; p50: number; p90: number };
  snow: { p10: number; p50: number; p90: number };
  /** share of members with at least 0.01 in, 0..100 */
  wetChance: number;
  level: ConfidenceLevel;
  /** short reason, e.g. "Models disagree on the high by 9°" */
  why: string;
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

/** Rank the spread of one day. Temperature spread grows with lead time, so the cut-offs widen too. */
export function rateDay(hiSpread: number, precipSpread: number, snowSpread: number, wetChance: number, lead: number): { level: ConfidenceLevel; why: string } {
  const tHigh = 4 + lead * 0.6;
  const tLow = 8 + lead * 1.0;
  const reasons: { level: ConfidenceLevel; why: string }[] = [];
  if (hiSpread > tLow) reasons.push({ level: "low", why: `Models disagree on the high by ${Math.round(hiSpread)}°` });
  else if (hiSpread > tHigh) reasons.push({ level: "medium", why: `High could vary by ${Math.round(hiSpread)}°` });
  if (snowSpread >= 3) reasons.push({ level: "low", why: `Snow totals range widely` });
  else if (snowSpread >= 1) reasons.push({ level: "medium", why: `Snow totals are uncertain` });
  if (wetChance >= 30 && wetChance <= 70) reasons.push({ level: "medium", why: `Models split on rain (${wetChance}% of runs)` });
  if (precipSpread >= 1) reasons.push({ level: "low", why: `Rain totals range widely` });
  if (reasons.some((r) => r.level === "low")) return reasons.find((r) => r.level === "low")!;
  if (reasons.length) return reasons[0]!;
  return { level: "high", why: "Models agree" };
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
  const at = (s: (number | string | null)[][], i: number) =>
    s.map((m) => m[i]).filter((x): x is number => typeof x === "number" && Number.isFinite(x));

  const days: DayConfidence[] = dates.map((date, i) => {
    const hi = at(hiS, i);
    const lo = at(loS, i);
    const pr = at(prS, i);
    const sn = at(snS, i);
    const wetChance = pr.length ? Math.round((pr.filter((x) => x >= 0.01).length / pr.length) * 100) : 0;
    const hiB = band(hi);
    const prB = band(pr, 2);
    const snB = band(sn, 1);
    const r = rateDay(hiB.p90 - hiB.p10, prB.p90 - prB.p10, snB.p90 - snB.p10, wetChance, i);
    return { date, hi: hiB, lo: band(lo), precip: prB, snow: snB, wetChance, level: r.level, why: r.why };
  });
  return { fetchedAt, members: hiS.length, model, days };
}

/** "72°" when tight, "68–75°" when not. */
export function rangeText(b: { p10: number; p90: number; p50: number }, unit = "°"): string {
  if (!Number.isFinite(b.p50)) return "--";
  return b.p90 - b.p10 <= 2 ? `${Math.round(b.p50)}${unit}` : `${Math.round(b.p10)}–${Math.round(b.p90)}${unit}`;
}

/** "1–6 in" for snow, "" when no snow expected. */
export function snowText(b: { p10: number; p50: number; p90: number }): string {
  if (!(b.p90 >= 0.5)) return "";
  const lo = Math.max(0, Math.floor(b.p10));
  const hi = Math.max(1, Math.ceil(b.p90));
  return lo === hi ? `about ${hi} in` : `${lo}–${hi} in`;
}
