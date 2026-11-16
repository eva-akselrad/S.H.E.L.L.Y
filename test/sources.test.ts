import { expect, test } from "vitest";
import { normalizeAlert } from "../worker/sources/nws";
import { normalizeAirQuality, normalizeForecast, type OpenMeteoRaw } from "../worker/sources/openmeteo";
import { riskAtPoint } from "../worker/sources/spc";

test("normalizeAlert pulls NWS threat parameters", () => {
  const a = normalizeAlert({
    id: "urn:1",
    geometry: null,
    properties: {
      event: "Tornado Warning",
      severity: "Extreme",
      ends: "2026-05-01T01:00:00Z",
      geocode: { UGC: ["TXC201"] },
      parameters: { tornadoDetection: ["OBSERVED"], maxHailSize: ["1.75"] },
    },
  });
  expect(a.params.tornadoDetection).toBe("OBSERVED");
  expect(a.params.maxHailSize).toBe("1.75");
  expect(a.zones).toEqual(["TXC201"]);
  expect(a.expires).toBe("2026-05-01T01:00:00Z");
});

test("normalizeAlert tolerates sparse input", () => {
  const a = normalizeAlert({ geometry: null, properties: {} });
  expect(a.event).toBe("Alert");
  expect(a.severity).toBe("Unknown");
});

test("riskAtPoint returns the highest category covering the point", () => {
  const sq = (min: number, max: number) => ({
    type: "Polygon" as const,
    coordinates: [[[min, min], [max, min], [max, max], [min, max], [min, min]]],
  });
  const fc = {
    features: [
      { properties: { LABEL: "MRGL" }, geometry: sq(-100, -90) },
      { properties: { LABEL: "ENH" }, geometry: sq(-97, -95) },
    ],
  };
  expect(riskAtPoint(fc, -96, -96)).toBe("ENH");
  expect(riskAtPoint(fc, -99, -99)).toBe("MRGL");
  expect(riskAtPoint(fc, 10, 10)).toBe("NONE");
  expect(riskAtPoint(null, 0, 0)).toBe("NONE");
});

test("normalizeForecast converts units and shapes", () => {
  const raw: OpenMeteoRaw = {
    current: { temperature_2m: 70, surface_pressure: 1000, visibility: 16093.44, is_day: 1, time: "t" },
    hourly: { time: ["a"], temperature_2m: [70], cape: [1200] },
    daily: { time: ["d"], temperature_2m_max: [80], temperature_2m_min: [60] },
    minutely_15: { time: ["m"], precipitation: [0.1] },
  };
  const f = normalizeForecast(raw);
  expect(f.current.pressure).toBeCloseTo(29.53, 1);
  expect(f.current.visibilityMi).toBeCloseTo(10, 1);
  expect(f.current.isDay).toBe(true);
  expect(f.hourly[0]?.cape).toBe(1200);
  expect(f.daily[0]?.hi).toBe(80);
  expect(f.nowcast[0]?.precip).toBeCloseTo(2.54, 2);
});

test("normalizeAirQuality drops zero pollen and tolerates null", () => {
  expect(normalizeAirQuality(null).aqi).toBeNull();
  const aq = normalizeAirQuality({ current: { us_aqi: 42, grass_pollen: 12, birch_pollen: 0 } });
  expect(aq.aqi).toBe(42);
  expect(aq.pollen).toEqual([{ type: "Grass", value: 12 }]);
});
