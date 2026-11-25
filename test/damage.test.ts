import { describe, expect, test } from "vitest";
import {
  asosNetworks,
  bearingDeg,
  compassAbbr,
  buildDamageReport,
  dateProblem,
  dayWindow,
  dedupeLsrs,
  localMidnight,
  lsrsFromSpc,
  parseAsosGusts,
  parseIemLsr,
  parseIemSbw,
  type Lsr,
} from "../shared/damage";
import type { StormReport } from "../shared/reports";
import lsrJson from "./fixtures/iem-lsr-2023-09-07.json";
import sbwJson from "./fixtures/iem-sbw-2023-09-07.json";
import asosJson from "./fixtures/iem-asos-gust-2023-09-07.json";

const asosCsv = asosJson.csv;

const TZ = "America/New_York";
// Coatesville, Chester County PA: under several warnings and hail reports on 2023-09-07 (a real storm day)
const COATESVILLE = { lat: 39.9831, lon: -75.8238 };

const lsr = (over: Partial<Lsr>): Lsr => ({
  kind: "hail",
  time: "2023-09-07T22:00:00.000Z",
  lat: 40,
  lon: -75,
  magnitude: 1,
  measure: "unknown",
  place: "",
  remark: "",
  source: "Public",
  origin: "iem",
  ...over,
});

describe("IEM parsers (recorded 2023-09-07 storm)", () => {
  test("lsr keeps hail, wind and flood, with measured/estimated", () => {
    const list = parseIemLsr(lsrJson);
    expect(list.length).toBeGreaterThan(10);
    expect(new Set(list.map((r) => r.kind))).toContain("hail");
    expect(new Set(list.map((r) => r.kind))).toContain("wind");
    const hail = list.find((r) => r.kind === "hail" && r.place === "Coatesville")!;
    expect(hail.magnitude).toBe(1);
    expect(hail.measure).toBe("measured");
    expect(list.find((r) => r.kind === "hail" && r.measure === "estimated")).toBeTruthy();
  });

  test("sbw keeps warning polygons only", () => {
    const list = parseIemSbw(sbwJson);
    expect(list.length).toBeGreaterThan(5);
    expect(list.every((w) => w.name.includes("Warning"))).toBe(true);
  });

  test("asos gusts convert knots to mph, one per station", () => {
    const g = parseAsosGusts(asosCsv);
    const rdg = g.find((x) => x.station === "RDG")!;
    expect(rdg.mph).toBe(Math.round(39 * 1.15078));
    expect(new Set(g.map((x) => x.station)).size).toBe(g.length);
  });
});

describe("compass and distance", () => {
  test("eight points", () => {
    const o = { lat: 40, lon: -75 };
    const at = (dLat: number, dLon: number) => compassAbbr(bearingDeg(o.lat, o.lon, o.lat + dLat, o.lon + dLon));
    const k = 0.1;
    const kx = 0.1 / Math.cos((40 * Math.PI) / 180);
    expect([at(k, 0), at(k, kx), at(0, kx), at(-k, kx), at(-k, 0), at(-k, -kx), at(0, -kx), at(k, -kx)]).toEqual(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
  });

  test("distance is rounded to one decimal and sorted nearest first", () => {
    const rep = buildDamageReport({
      point: { lat: 40, lon: -75 },
      date: "2023-09-07",
      tz: TZ,
      lsrs: [lsr({ lat: 40.1, lon: -75 }), lsr({ lat: 40.03, lon: -75, time: "2023-09-07T22:05:00.000Z" })],
      warnings: [],
      gusts: [],
    });
    expect(rep.reports.map((r) => r.distanceMi)).toEqual([2.1, 6.9]);
    expect(rep.reports[0]!.direction).toBe("N");
  });
});

describe("dedupe", () => {
  test("same kind within 5 min and 1 mi is one report; IEM wins", () => {
    const iem = lsr({ origin: "iem", measure: "measured" });
    const spc = lsr({ origin: "spc", time: "2023-09-07T22:04:00.000Z", lat: 40.005 });
    const out = dedupeLsrs([spc, iem]);
    expect(out).toHaveLength(1);
    expect(out[0]!.origin).toBe("iem");
  });
  test("different kind, 6 minutes apart, or 2 miles apart stays separate", () => {
    const a = lsr({});
    expect(dedupeLsrs([a, lsr({ kind: "wind" })])).toHaveLength(2);
    expect(dedupeLsrs([a, lsr({ time: "2023-09-07T22:06:00.000Z" })])).toHaveLength(2);
    expect(dedupeLsrs([a, lsr({ lat: 40.03 })])).toHaveLength(2);
  });
  test("SPC rows convert", () => {
    const s: StormReport = { kind: "hail", time: "2023-09-07T22:00:00.000Z", magnitude: "1.75 in", location: "X", county: "", state: "PA", lat: 40, lon: -75, comments: "" };
    expect(lsrsFromSpc([s])[0]!.magnitude).toBe(1.75);
  });
});

describe("local day window", () => {
  test("midnight to midnight in the zone, not UTC", () => {
    const w = dayWindow("2023-09-07", TZ);
    expect(new Date(w.start).toISOString()).toBe("2023-09-07T04:00:00.000Z");
    expect(new Date(w.end).toISOString()).toBe("2023-09-08T04:00:00.000Z");
  });
  test("across DST: spring-forward day is 23 h, fall-back day is 25 h", () => {
    const spring = dayWindow("2023-03-12", TZ);
    expect((spring.end - spring.start) / 3_600_000).toBe(23);
    expect(new Date(spring.start).toISOString()).toBe("2023-03-12T05:00:00.000Z");
    const fall = dayWindow("2023-11-05", TZ);
    expect((fall.end - fall.start) / 3_600_000).toBe(25);
    expect(new Date(localMidnight("2023-11-06", TZ)).toISOString()).toBe("2023-11-06T05:00:00.000Z");
  });
  test("11:30 PM local counts for the day, 12:30 AM the next day does not", () => {
    const base = { point: COATESVILLE, date: "2023-09-07", tz: TZ, warnings: [], gusts: [] };
    const here = { lat: COATESVILLE.lat, lon: COATESVILLE.lon };
    const inside = buildDamageReport({ ...base, lsrs: [lsr({ ...here, time: "2023-09-08T03:30:00.000Z" })] });
    const outside = buildDamageReport({ ...base, lsrs: [lsr({ ...here, time: "2023-09-08T04:30:00.000Z" })] });
    expect(inside.reports).toHaveLength(1);
    expect(outside.reports).toHaveLength(0);
  });
  test("date limits", () => {
    expect(dateProblem("2002-12-31", "2026-11-25")).toBe("too_old");
    expect(dateProblem("2026-11-26", "2026-11-25")).toBe("future");
    expect(dateProblem("2026-13-01", "2026-11-25")).toBe("bad_date");
    expect(dateProblem("2023-09-07", "2026-11-25")).toBeNull();
  });
});

describe("buildDamageReport on the recorded storm", () => {
  const rep = buildDamageReport({
    point: COATESVILLE,
    date: "2023-09-07",
    tz: TZ,
    lsrs: parseIemLsr(lsrJson),
    warnings: parseIemSbw(sbwJson),
    gusts: parseAsosGusts(asosCsv),
  });

  test("finds warnings, hail, wind and gusts, and writes a template summary", () => {
    expect(rep.empty).toBe(false);
    expect(rep.warnings.length).toBeGreaterThan(0);
    expect(rep.reports.some((r) => r.kind === "hail")).toBe(true);
    expect(rep.reports.every((r) => r.distanceMi <= 10)).toBe(true);
    expect(rep.summary).toMatch(/Severe Thunderstorm Warning/);
    expect(rep.summary).toMatch(/hail was reported/);
    expect(rep.maxHailIn).toBe(1);
  });
  test("warnings are folded to one entry per event", () => {
    const ids = rep.warnings.map((w) => `${w.wfo}${w.eventid}`);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("nothing found", () => {
  test("still renders and says so plainly", () => {
    const rep = buildDamageReport({ point: { lat: 44.5, lon: -100.3 }, date: "2023-09-07", tz: "America/Chicago", lsrs: [], warnings: [], gusts: [] });
    expect(rep.empty).toBe(true);
    expect(rep.summary).toMatch(/^No warnings, storm reports or strong wind gusts were found/);
    expect(rep.reports).toEqual([]);
  });
  test("a failed source is recorded", () => {
    const rep = buildDamageReport({ point: COATESVILLE, date: "2023-09-07", tz: TZ, lsrs: [], warnings: [], gusts: [], missing: ["warnings"] });
    expect(rep.missing).toEqual(["warnings"]);
  });
  test("ASOS networks: own state plus neighbours", () => {
    expect(asosNetworks("PA")).toContain("NJ_ASOS");
    expect(asosNetworks(null)).toEqual([]);
  });
});
