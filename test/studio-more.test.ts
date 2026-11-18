import { describe, expect, test } from "vitest";
import { normalizeBody, normalizeProducts } from "../shared/studio";
import { dayParts } from "../worker/studio";

describe("new Studio graphics: validation", () => {
  test("forecast card keeps up to five non-empty points and a known icon", () => {
    expect(normalizeBody("note", { headline: "Snow!", bullets: ["a", "", " b ", "c", "d", "e", "f"], icon: "nope", tone: 9 })).toEqual({
      headline: "Snow!", bullets: ["a", "b", "c", "d", "e"], icon: "partly", tone: 3,
    });
  });
  test("impact levels are clamped to the 0..4 scale", () => {
    const b = normalizeBody("impacts", { event: "Ice", overall: 7, rows: [{ label: "Travel", level: -2, note: "slick" }, { label: "", level: 2 }] });
    expect(b).toEqual({ event: "Ice", overall: 4, rows: [{ label: "Travel", level: 0, note: "slick" }] });
  });
  test("odds clamp percentages and default the confidence", () => {
    expect(normalizeBody("odds", { outcomes: [{ label: "Any snow", pct: 140 }, { label: "x", pct: -5 }], confidence: "very" })).toMatchObject({
      outcomes: [{ label: "Any snow", pct: 100 }, { label: "x", pct: 0 }], confidence: "medium",
    });
  });
  test("compare and day planner round to whole degrees", () => {
    expect(normalizeBody("compare", { cities: [{ name: "Trenton", today: 51.6, tomorrow: 44.2 }] })).toEqual({ cities: [{ name: "Trenton", today: 52, tomorrow: 44 }] });
    expect(normalizeBody("dayPlanner", { place: "P", date: "2026-11-18", parts: [{ label: "Morning", temp: 40.4, code: 3, pop: 250, note: "" }] }))
      .toEqual({ place: "P", date: "2026-11-18", parts: [{ label: "Morning", temp: 40, code: 3, pop: 100, note: "" }] });
  });
  test("city maps accept rain chance and wind gusts", () => {
    expect(normalizeBody("cityTemps", { metric: "gust", cities: [] })).toEqual({ metric: "gust", cities: [] });
    expect(normalizeBody("cityTemps", { metric: "bogus", cities: [] })).toEqual({ metric: "high", cities: [] });
  });
  test("stored products of the new kinds survive normalization", () => {
    const list = normalizeProducts([{ id: "n1", kind: "note", title: "T", validFrom: "2026-11-17T00:00:00Z", validTo: "2026-11-18T00:00:00Z", published: true, body: { headline: "Hi", bullets: [] } }]);
    expect(list).toHaveLength(1);
    expect(list[0]!.kind).toBe("note");
  });
});

describe("day planner from the hourly model", () => {
  const hourly = Array.from({ length: 48 }, (_, h) => {
    const d = new Date(Date.UTC(2026, 10, 18, h));
    return { time: d.toISOString().slice(0, 16), temp: 30 + (h % 24), code: h % 24 === 15 ? 61 : 3, pop: h % 24 === 15 ? 60 : 10 };
  });
  test("splits a date into morning, afternoon, evening and overnight", () => {
    const p = dayParts("Philadelphia", hourly, "2026-11-18");
    expect(p.parts.map((x) => x.label)).toEqual(["Morning", "Afternoon", "Evening", "Overnight"]);
    const aft = p.parts[1]!;
    expect(aft.temp).toBe(30 + 17); // afternoon uses the peak
    expect(aft.code).toBe(61); // the most significant weather in the block
    expect(aft.pop).toBe(60);
    expect(p.parts[3]!.temp).toBe(30); // overnight uses the low (midnight next day)
  });
});
