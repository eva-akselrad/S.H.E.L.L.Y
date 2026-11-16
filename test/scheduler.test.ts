import { expect, test } from "vitest";
import { buildLoop, type SegmentCtx } from "../shared/scheduler";
import type { Forecast } from "../shared/types";

const fc = (precip = 0): Forecast => ({
  fetchedAt: "",
  current: {
    temp: 70, feelsLike: 70, humidity: 50, dewPoint: 50, windSpeed: 5, windGust: 8, windDir: 90, pressure: 30,
    visibilityMi: 10, uv: 3, cloud: 10, code: 0, isDay: true, precip, time: "",
  },
  hourly: [], daily: [], nowcast: [], text: [],
});
const base = (over: Partial<SegmentCtx>): SegmentCtx => ({
  forecast: fc(), aq: { aqi: 30, pm25: 5, ozone: 30, pollen: [] }, outlook: null, level: "CALM", ...over,
});

test("calm loop is relaxed and includes filler", () => {
  const ids = buildLoop(base({})).map((i) => i.id);
  expect(ids).toContain("now");
  expect(ids).toContain("daily");
  expect(ids).toContain("almanac");
});

test("elevated drops filler and adds radar and outlook", () => {
  const ids = buildLoop(
    base({ level: "ELEVATED", outlook: { fetchedAt: "", days: [{ day: 1, category: "ENH", label: "" }] } }),
  ).map((i) => i.id);
  expect(ids).toContain("radar");
  expect(ids).toContain("outlook");
  expect(ids).not.toContain("almanac");
  expect(ids).not.toContain("air");
});

test("elevated loop is shorter per segment than calm", () => {
  const calm = buildLoop(base({})).find((i) => i.id === "now")!;
  const el = buildLoop(base({ level: "ELEVATED" })).find((i) => i.id === "now")!;
  expect(el.seconds).toBeLessThan(calm.seconds);
});

test("high pollen makes the air segment relevant", () => {
  const ids = buildLoop(
    base({ level: "ELEVATED", aq: { aqi: 40, pm25: 5, ozone: 30, pollen: [{ type: "Grass", value: 120 }] } }),
  ).map((i) => i.id);
  expect(ids).toContain("air");
});

test("never returns an empty loop", () => {
  expect(buildLoop(base({ forecast: null, aq: null, level: "WARNING" })).length).toBeGreaterThan(0);
});
