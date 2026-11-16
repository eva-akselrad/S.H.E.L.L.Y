import type { Hazard, Timeline, TimelineBlock } from "./studio";

export interface HourlyCity {
  name: string;
  /** hourly local ISO times, hourly weather codes and precipitation (inches per hour) */
  time: string[];
  code: number[];
  precip: number[];
}

const SNOW = new Set([71, 73, 75, 77, 85, 86]);
const STORM = new Set([95, 96, 99]);

/** Hazard and 0..3 intensity for one hour. */
export function hourHazard(code: number, precip: number): { hazard: Hazard | "none"; intensity: 0 | 1 | 2 | 3 } {
  if (STORM.has(code)) return { hazard: "wind", intensity: code === 99 || code === 96 ? 3 : 2 };
  if (SNOW.has(code)) return { hazard: "winter", intensity: precip >= 0.1 ? 3 : precip >= 0.03 ? 2 : 1 };
  if (precip >= 0.3) return { hazard: "flood", intensity: 3 };
  if (precip >= 0.1) return { hazard: "flood", intensity: 2 };
  if (precip >= 0.01 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { hazard: "flood", intensity: 1 };
  return { hazard: "none", intensity: 0 };
}

const RANK: (Hazard | "none")[] = ["none", "heat", "hail", "winter", "flood", "wind", "tornado"];

/** Collapse the next `hours` hours into blocks of `step` hours, keeping the worst hour in each block. */
export function buildTimeline(cities: HourlyCity[], fromIso: string, hours = 24, step = 3): Timeline {
  return {
    rows: cities.map((c) => {
      const start = Math.max(0, c.time.findIndex((t) => Date.parse(t) >= Date.parse(fromIso)));
      const blocks: TimelineBlock[] = [];
      for (let b = 0; b < hours; b += step) {
        let best: { hazard: Hazard | "none"; intensity: 0 | 1 | 2 | 3 } = { hazard: "none", intensity: 0 };
        for (let k = 0; k < step; k++) {
          const i = start + b + k;
          if (c.time[i] === undefined) continue;
          const h = hourHazard(c.code[i] ?? 0, c.precip[i] ?? 0);
          if (h.intensity > best.intensity || (h.intensity === best.intensity && RANK.indexOf(h.hazard) > RANK.indexOf(best.hazard))) best = h;
        }
        const label = c.time[start + b];
        blocks.push({ hour: label ?? "", hazard: best.hazard, intensity: best.intensity });
      }
      return { city: c.name, blocks };
    }),
  };
}

export function hourLabel(iso: string): string {
  const m = /T(\d{2}):/.exec(iso);
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
}
