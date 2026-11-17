// "Rain likely in about 15 min": a plain sentence from Open-Meteo's 15-minute precipitation.
// Open-Meteo (timezone=auto) returns local wall times with no offset, and each 15-minute value is the
// total for the 15 minutes BEFORE its timestamp. All the maths here is done in local wall time.
import type { HourPoint } from "./types";

/** mm per 15 min that counts as "it's raining" (a light shower is ~0.25 mm) */
export const WET_MM = 0.1;

export interface RainNowcast {
  kind: "none" | "dry" | "starting" | "ending" | "steady" | "on_off";
  type: "rain" | "snow" | "mix";
  /** minutes until it starts (starting) or stops (ending / on_off) */
  inMin: number | null;
  sentence: string;
  /** one value per 15-min step, 0..1, for the bar strip */
  bars: { time: string; level: number; wet: boolean }[];
  hours: number;
}

const SNOW = new Set([71, 73, 75, 77, 85, 86]);
const MIX = new Set([56, 57, 66, 67]);
const W = { rain: "Rain", snow: "Snow", mix: "Wintry mix" } as const;
const MIN = 60_000;

function typeAt(hourly: HourPoint[] | undefined, localIso: string): RainNowcast["type"] {
  if (!hourly?.length) return "rain";
  const t = Date.parse(localIso);
  const h = hourly.reduce((best, x) => (Math.abs(Date.parse(x.time) - t) < Math.abs(Date.parse(best.time) - t) ? x : best), hourly[0]!);
  if (SNOW.has(h.code)) return "snow";
  if (MIX.has(h.code)) return "mix";
  return h.temp <= 31 ? "snow" : "rain";
}

/** Never claim more precision than 15-minute data has. */
const round15 = (m: number) => Math.max(15, Math.round(m / 15) * 15);

/**
 * @param nowLocal current local wall time, "YYYY-MM-DDTHH:mm" (see localNow)
 */
export function rainNowcast(nowcast: { time: string; precip: number }[], nowLocal: string, hourly?: HourPoint[]): RainNowcast {
  const nowT = Date.parse(nowLocal);
  const steps = nowcast.filter((s) => Date.parse(s.time) > nowT); // intervals that end after now
  const bars = steps.map((s) => ({ time: s.time, level: Math.min(1, s.precip / 2.5), wet: s.precip >= WET_MM }));
  const hours = Math.round((steps.length * 15) / 60);
  if (!steps.length) return { kind: "none", type: "rain", inMin: null, sentence: "", bars, hours };

  const wet = bars.map((b) => b.wet);
  const nowWet = wet[0]!;
  const change = wet.findIndex((w) => w !== nowWet);

  if (!nowWet) {
    if (change === -1) return { kind: "dry", type: "rain", inMin: null, sentence: `No rain or snow for the next ${hours} hours.`, bars, hours };
    const type = typeAt(hourly, steps[change]!.time);
    const startMs = Date.parse(steps[change]!.time) - 15 * MIN; // the wet interval begins 15 min before its stamp
    const mins = round15((startMs - nowT) / MIN);
    const lasts = wet.slice(change).findIndex((w) => !w);
    const shower = lasts !== -1 && lasts <= 2 && type === "rain";
    return { kind: "starting", type, inMin: mins, sentence: `${shower ? "A shower" : W[type]} likely in about ${mins} min.`, bars, hours };
  }

  const type = typeAt(hourly, steps[0]!.time);
  if (change === -1) return { kind: "steady", type, inMin: null, sentence: `${W[type]} for at least the next ${hours} hours.`, bars, hours };
  const endMs = Date.parse(steps[change - 1]!.time);
  const mins = round15((endMs - nowT) / MIN);
  if (wet.slice(change).some(Boolean)) {
    return { kind: "on_off", type, inMin: mins, sentence: `${W[type]} on and off. A break in about ${mins} min, then more.`, bars, hours };
  }
  return { kind: "ending", type, inMin: mins, sentence: `${W[type]} ending in about ${mins} min.`, bars, hours };
}

/** Current local wall time in a zone as "YYYY-MM-DDTHH:mm" (same format as Open-Meteo's timezone=auto times). */
export function localNow(tz: string, now = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Local hour 0..23 in a zone. */
export function localHour(tz: string, now = new Date()): number {
  return Number(localNow(tz, now).slice(11, 13));
}

/** Local calendar date "YYYY-MM-DD" in a zone. */
export function localDate(tz: string, now = new Date()): string {
  return localNow(tz, now).slice(0, 10);
}
