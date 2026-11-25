import { describe, expect, test } from "vitest";
import { parseGridHours, parseDurationHours, type RawGridData, type SnowHour } from "../shared/gridpoint";
import {
  bandFor,
  computeSnowDay,
  displayPct,
  ensembleRange,
  snowDayRelevance,
  snowRecord,
  type SnowDayInput,
} from "../shared/snowday";
import { DEFAULT_CONFIG, normalizeConfig } from "../shared/config";
import grid from "./fixtures/nws-gridpoint-phi.json";

/** Hourly arrays for 2026-12-01 18:00 through 2026-12-02 18:00, all at one temperature. */
function hours(opts: { snow?: Record<string, number>; ice?: Record<string, number>; temp?: number; chill?: number } = {}): SnowHour[] {
  const out: SnowHour[] = [];
  for (let i = 0; i < 25; i++) {
    const t = new Date(Date.UTC(2026, 11, 1, 18 + i));
    const day = t.toISOString().slice(0, 10);
    const hh = String(t.getUTCHours()).padStart(2, "0");
    const key = `${day}T${hh}:00`;
    out.push({
      time: key,
      snow: opts.snow?.[key] ?? 0,
      ice: opts.ice?.[key] ?? 0,
      tempF: opts.temp ?? 30,
      windChillF: opts.chill ?? opts.temp ?? 30,
    });
  }
  return out;
}
/** spread `total` inches evenly over local hours [from, to) of one date */
function fall(date: string, from: number, to: number, total: number): Record<string, number> {
  const r: Record<string, number> = {};
  for (let h = from; h < to; h++) r[`${date}T${String(h).padStart(2, "0")}:00`] = total / (to - from);
  return r;
}

const NOW = "2026-12-01T21:00"; // a Tuesday night
const input = (over: Partial<SnowDayInput> = {}): SnowDayInput => ({
  hours: hours(),
  alerts: [],
  nowLocal: NOW,
  daysOff: [],
  district: { toughness: 0.5, coldWindChillF: -10 },
  range: null,
  ...over,
});

describe("snow day model", () => {
  test("1. no snow means none", () => {
    const o = computeSnowDay(input());
    expect(o.band).toBe("none");
    expect(o.forDate).toBe("2026-12-02");
    expect(o.closed).toBeLessThan(0.05);
  });

  test("2. one inch ending at 10 PM above freezing is low", () => {
    const o = computeSnowDay(input({ hours: hours({ snow: fall("2026-12-01", 20, 22, 1), temp: 34 }) }));
    expect(o.band).toBe("low");
  });

  test("3. six inches from midnight to 7 AM is high or very high", () => {
    const o = computeSnowDay(input({ hours: hours({ snow: fall("2026-12-02", 0, 7, 6), temp: 28 }) }));
    expect(["high", "very_high"]).toContain(o.band);
    expect(o.reasons.length).toBeGreaterThan(0);
    expect(o.reasons.length).toBeLessThanOrEqual(4);
  });

  test("4. a little ice at 6 AM with no snow is at least good", () => {
    const o = computeSnowDay(input({ hours: hours({ ice: { "2026-12-02T06:00": 0.2 }, temp: 30 }) }));
    expect(o.closed).toBeGreaterThanOrEqual(0.4);
    expect(o.reasons.join(" ")).toMatch(/ice/i);
  });

  test("5. a tougher district scores the same storm lower", () => {
    const h = hours({ snow: fall("2026-12-02", 1, 7, 4), temp: 29 });
    const soft = computeSnowDay(input({ hours: h, district: { toughness: 0, coldWindChillF: -10 } }));
    const tough = computeSnowDay(input({ hours: h, district: { toughness: 1, coldWindChillF: -10 } }));
    expect(tough.closed).toBeLessThan(soft.closed);
  });

  test("6. snow that starts at 11 AM is early dismissal, not a closure", () => {
    const o = computeSnowDay(input({ hours: hours({ snow: fall("2026-12-02", 11, 15, 2), temp: 30 }) }));
    expect(o.closed).toBeLessThan(0.2);
    expect(o.delayed).toBeLessThan(0.05);
    expect(o.reasons.join(" ")).toMatch(/early dismissal/);
  });

  test("7. a Friday night storm is about Monday", () => {
    const o = computeSnowDay(input({ nowLocal: "2026-12-04T21:00" }));
    expect(o.forDate).toBe("2026-12-07");
    expect(o.note).toMatch(/No school tomorrow anyway/);
  });

  test("8. a wide ensemble range means low confidence", () => {
    const o = computeSnowDay(input({ hours: hours({ snow: fall("2026-12-02", 1, 7, 5), temp: 29 }), range: [1, 9] }));
    expect(o.confidence).toBe("low");
    expect(o.range).toEqual([1, 9]);
  });
});

describe("snow day extras", () => {
  test("days off are skipped and say so", () => {
    const o = computeSnowDay(input({ daysOff: ["2026-12-02"] }));
    expect(o.forDate).toBe("2026-12-03");
    expect(o.note).toMatch(/No school tomorrow anyway/);
  });

  test("early morning counts today as the school day", () => {
    const o = computeSnowDay(input({ nowLocal: "2026-12-02T05:30" }));
    expect(o.forDate).toBe("2026-12-02");
  });

  test("a warning adds odds, two days out is never high confidence", () => {
    const h = hours({ snow: fall("2026-12-02", 1, 7, 3), temp: 29 });
    const a = computeSnowDay(input({ hours: h }));
    const b = computeSnowDay(input({ hours: h, alerts: ["Winter Storm Warning"] }));
    expect(b.closed).toBeGreaterThan(a.closed);
    const far = computeSnowDay(input({ hours: h, nowLocal: "2026-11-30T09:30", daysOff: ["2026-12-01"], range: [2.5, 3.5] }));
    expect(far.confidence).not.toBe("high");
  });

  test("bands and displayed percent", () => {
    expect(bandFor(0.01)).toBe("none");
    expect(bandFor(0.1)).toBe("low");
    expect(bandFor(0.3)).toBe("some");
    expect(bandFor(0.5)).toBe("good");
    expect(bandFor(0.7)).toBe("high");
    expect(bandFor(0.9)).toBe("very_high");
    expect(displayPct(0.01)).toBeNull();
    expect(displayPct(0.99)).toBeNull();
    expect(displayPct(0.7)).toBe(70);
  });

  test("ensemble range adds the evening before and the school morning", () => {
    const band = (p10: number, p90: number) => ({ p10, p50: (p10 + p90) / 2, p90 });
    const days = [
      { date: "2026-12-01", snow: band(0, 1) },
      { date: "2026-12-02", snow: band(2, 5) },
    ];
    expect(ensembleRange(days, "2026-12-02")).toEqual([2, 6]);
    expect(ensembleRange([], "2026-12-02")).toBeNull();
  });

  test("segment relevance follows the plan and the season", () => {
    const odds = computeSnowDay(input({ hours: hours({ snow: fall("2026-12-02", 0, 7, 6), temp: 28 }) }));
    expect(snowDayRelevance(odds, NOW)).toBe(1);
    expect(snowDayRelevance(odds, "2026-07-01T21:00")).toBe(0);
    expect(snowDayRelevance(null, NOW)).toBe(0);
    const light = computeSnowDay(input({ hours: hours({ snow: fall("2026-12-02", 3, 5, 0.3), temp: 28 }) }));
    expect(snowDayRelevance(light, NOW)).toBe(0.5);
    expect(snowDayRelevance(computeSnowDay(input()), NOW)).toBe(0);
  });

  test("the record counts outcomes per band", () => {
    const e = (band: string, actual: string | null) => ({
      id: band + actual,
      forDate: "2026-12-02",
      districtId: "d",
      districtName: "D",
      band,
      closed: 0.5,
      delayed: 0.1,
      actual,
    });
    const r = snowRecord([e("high", "closed"), e("high", "remote"), e("high", "open"), e("low", "open"), e("low", null)] as never);
    expect(r.find((x) => x.band === "high")).toMatchObject({ n: 3, closed: 2, open: 1 });
    expect(r.find((x) => x.band === "low")).toMatchObject({ n: 1, open: 1 });
  });
});

describe("NWS gridpoint parser", () => {
  test("durations", () => {
    expect(parseDurationHours("PT6H")).toBe(6);
    expect(parseDurationHours("P1DT6H")).toBe(30);
    expect(parseDurationHours("PT30M")).toBe(1);
    expect(parseDurationHours("junk")).toBeNull();
  });

  test("totals are spread evenly, temperatures hold, units convert", () => {
    const raw: RawGridData = {
      properties: {
        snowfallAmount: { uom: "wmoUnit:mm", values: [{ validTime: "2026-12-02T06:00:00+00:00/PT6H", value: 76.2 }] },
        iceAccumulation: { uom: "wmoUnit:mm", values: [{ validTime: "2026-12-02T06:00:00+00:00/PT2H", value: 5.08 }] },
        temperature: { uom: "wmoUnit:degC", values: [{ validTime: "2026-12-02T06:00:00+00:00/PT3H", value: -5 }] },
      },
    };
    const h = parseGridHours(raw, "America/New_York");
    expect(h[0]!.time).toBe("2026-12-02T01:00"); // 06 UTC is 1 AM in winter
    const snow = h.reduce((s, x) => s + x.snow, 0);
    expect(snow).toBeCloseTo(3, 2);
    expect(h[0]!.snow).toBeCloseTo(0.5, 2);
    expect(h.reduce((s, x) => s + x.ice, 0)).toBeCloseTo(0.2, 2);
    expect(h[0]!.tempF).toBeCloseTo(23, 1);
    expect(h[2]!.tempF).toBeCloseTo(23, 1);
    expect(h[3]!.tempF).toBeNull();
  });

  test("a recorded NWS response parses into sane hours", () => {
    const h = parseGridHours(grid as RawGridData, "America/New_York");
    expect(h.length).toBeGreaterThan(40);
    expect(h.every((x) => /^\d{4}-\d\d-\d\dT\d\d:00$/.test(x.time))).toBe(true);
    expect(h.some((x) => x.tempF !== null && x.tempF > -40 && x.tempF < 120)).toBe(true);
    expect(h.every((x) => x.snow >= 0 && x.ice >= 0)).toBe(true);
    expect(new Set(h.map((x) => x.time)).size).toBe(h.length);
  });
});

describe("snowDay config", () => {
  test("defaults give the two Bucks County districts", () => {
    const c = normalizeConfig({});
    expect(c.snowDay.enabled).toBe(true);
    expect(c.snowDay.districts.map((d) => d.name)).toEqual(["Council Rock", "Central Bucks"]);
    expect(c.snowDay.districts[1]!.toughness).toBeLessThan(c.snowDay.districts[0]!.toughness);
    expect(DEFAULT_CONFIG.snowDay.daysOff).toEqual([]);
  });

  test("bad input is clamped and cleaned", () => {
    const c = normalizeConfig({
      snowDay: {
        enabled: false,
        daysOff: ["2026-12-24", "nope", "2026-12-24"],
        districts: [
          { id: "a b!", name: "North", lat: 40.1, lon: -75.1, toughness: 7, coldWindChillF: -300 },
          { name: "", lat: 40, lon: -75 },
          { name: "Off the map", lat: 5, lon: 10 },
        ],
      },
    });
    expect(c.snowDay.enabled).toBe(false);
    expect(c.snowDay.daysOff).toEqual(["2026-12-24"]);
    expect(c.snowDay.districts).toHaveLength(1);
    expect(c.snowDay.districts[0]!.toughness).toBe(1);
    expect(c.snowDay.districts[0]!.coldWindChillF).toBeGreaterThanOrEqual(-60);
    expect(c.snowDay.districts[0]!.id).toMatch(/^[a-z0-9-]+$/);
  });
});
