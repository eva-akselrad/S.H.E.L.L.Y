// NWS raw gridpoint data (/gridpoints/{office}/{x},{y}): the forecaster's own hourly numbers.
// Values come as ISO-8601 intervals ("2026-11-26T06:00:00+00:00/PT6H"). Verified against a live
// response (2026-11-25): snowfallAmount and iceAccumulation are wmoUnit:mm TOTALS per interval,
// temperature and windChill are wmoUnit:degC readings that hold for the whole interval.

export interface GridValue {
  validTime?: string;
  value?: number | null;
}
export interface GridSeries {
  uom?: string;
  values?: GridValue[];
}
export interface RawGridData {
  properties?: {
    snowfallAmount?: GridSeries;
    iceAccumulation?: GridSeries;
    temperature?: GridSeries;
    windChill?: GridSeries;
    probabilityOfPrecipitation?: GridSeries;
  };
}

/** One hour of the school-day forecast. `time` is LOCAL wall time, "YYYY-MM-DDTHH:00". */
export interface SnowHour {
  time: string;
  /** inches that fall in this hour */
  snow: number;
  /** inches of ice accumulation in this hour */
  ice: number;
  tempF: number | null;
  windChillF: number | null;
}

const HOUR = 3_600_000;
const MM_PER_IN = 25.4;
const cToF = (c: number): number => (c * 9) / 5 + 32;

/** "PT6H", "P1DT6H", "PT30M" to whole hours (at least 1). Null if it can't be read. */
export function parseDurationHours(d: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(d);
  if (!m) return null;
  const hours = Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60;
  return hours > 0 ? Math.max(1, Math.round(hours)) : null;
}

/** "start/duration" to the start (ms epoch) and a number of hourly steps. */
export function parseInterval(validTime: string): { start: number; hours: number } | null {
  const [s, d] = validTime.split("/");
  if (!s || !d) return null;
  const start = Date.parse(s);
  const hours = parseDurationHours(d);
  return Number.isFinite(start) && hours !== null ? { start, hours: Math.min(hours, 24 * 7) } : null;
}

/**
 * Spread a series over hourly steps (ms epoch of the hour start to value).
 * "total": the value is a sum over the interval, so each hour gets an even share.
 * "level": the value holds for every hour of the interval.
 */
export function spreadSeries(series: GridSeries | undefined, mode: "total" | "level"): Map<number, number> {
  const out = new Map<number, number>();
  for (const v of series?.values ?? []) {
    if (typeof v.value !== "number" || !Number.isFinite(v.value) || !v.validTime) continue;
    const iv = parseInterval(v.validTime);
    if (!iv) continue;
    const per = mode === "total" ? v.value / iv.hours : v.value;
    for (let i = 0; i < iv.hours; i++) {
      const t = Math.floor((iv.start + i * HOUR) / HOUR) * HOUR;
      out.set(t, mode === "total" ? (out.get(t) ?? 0) + per : per);
    }
  }
  return out;
}

/** Local wall time "YYYY-MM-DDTHH:00" for an instant in an IANA zone. */
export function localHourString(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const g = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
  const h = g("hour") === "24" ? "00" : g("hour");
  return `${g("year")}-${g("month")}-${g("day")}T${h}:00`;
}

/** Hourly snow/ice/temperature/wind chill from a raw gridpoint response, in local time and US units. */
export function parseGridHours(raw: RawGridData, tz: string): SnowHour[] {
  const p = raw.properties;
  if (!p) return [];
  const snow = spreadSeries(p.snowfallAmount, "total");
  const ice = spreadSeries(p.iceAccumulation, "total");
  const temp = spreadSeries(p.temperature, "level");
  const chill = spreadSeries(p.windChill, "level");
  const times = new Set<number>([...snow.keys(), ...ice.keys(), ...temp.keys(), ...chill.keys()]);
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => ({
      time: localHourString(t, tz),
      snow: Math.round(((snow.get(t) ?? 0) / MM_PER_IN) * 1000) / 1000,
      ice: Math.round(((ice.get(t) ?? 0) / MM_PER_IN) * 1000) / 1000,
      tempF: temp.has(t) ? Math.round(cToF(temp.get(t)!) * 10) / 10 : null,
      windChillF: chill.has(t) ? Math.round(cToF(chill.get(t)!) * 10) / 10 : null,
    }));
}
