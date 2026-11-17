// SHELLY grades itself: store what we forecast, compare with what a real NWS weather station measured.

/** What SHELLY forecast for one target date, at one lead time. */
export interface Prediction {
  /** local date the forecast was made */
  issued: string;
  /** days ahead (1 = forecast for tomorrow) */
  lead: number;
  hi: number;
  lo: number;
}

/** One graded day. Errors are forecast minus observed, in °F. */
export interface GradedDay {
  date: string;
  station: string;
  obsHi: number;
  obsLo: number;
  /** keyed by lead time in days */
  leads: Record<string, { hi: number; lo: number; hiErr: number; loErr: number }>;
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
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Highest and lowest temperature (°F) from NWS observations for one local day. Null when too sparse. */
export function dayExtremes(obs: { time: string; tempC: number | null }[], minCount = 16): { hi: number; lo: number; n: number } | null {
  const temps = obs.map((o) => o.tempC).filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  if (temps.length < minCount) return null;
  const f = (c: number) => (c * 9) / 5 + 32;
  return { hi: Math.round(f(Math.max(...temps))), lo: Math.round(f(Math.min(...temps))), n: temps.length };
}

export function gradeDay(date: string, station: string, obs: { hi: number; lo: number }, preds: Prediction[]): GradedDay {
  const leads: GradedDay["leads"] = {};
  for (const p of preds) {
    leads[String(p.lead)] = { hi: p.hi, lo: p.lo, hiErr: Math.round(p.hi - obs.hi), loErr: Math.round(p.lo - obs.lo) };
  }
  return { date, station, obsHi: obs.hi, obsLo: obs.lo, leads };
}

export function summarize(history: GradedDay[], lead = 1): GradeSummary {
  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  const withLead = sorted.filter((d) => d.leads[String(lead)]).slice(0, 30);
  const errs = withLead.map((d) => d.leads[String(lead)]!);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const hiMae = mean(errs.map((e) => Math.abs(e.hiErr)));
  const loMae = mean(errs.map((e) => Math.abs(e.loErr)));
  const bias = mean(errs.map((e) => e.hiErr));
  return {
    station: sorted[0]?.station ?? null,
    latest: withLead[0] ?? null,
    days30: withLead.length,
    hiWithin3: errs.length ? Math.round((errs.filter((e) => Math.abs(e.hiErr) <= 3).length / errs.length) * 100) : null,
    hiMae: hiMae === null ? null : r1(hiMae),
    loMae: loMae === null ? null : r1(loMae),
    hiBias: bias === null ? null : r1(bias),
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

/** "YYYY-MM-DD" plus n days. */
export function addDays(date: string, n: number): string {
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
