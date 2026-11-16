import { expect, test } from "vitest";
import { aqiLabel, heatIndex, moonPhase, pollenLevel, uvLabel, windChill, windDir, wmoToWeather } from "../shared/wx";

test("windDir wraps and rounds", () => {
  expect(windDir(0)).toBe("N");
  expect(windDir(359)).toBe("N");
  expect(windDir(90)).toBe("E");
  expect(windDir(225)).toBe("SW");
  expect(windDir(-45)).toBe("NW");
});

test("heatIndex only applies when hot", () => {
  expect(heatIndex(70, 50)).toBeNull();
  expect(heatIndex(95, 60)).toBeGreaterThan(95);
});

test("windChill only applies when cold and windy", () => {
  expect(windChill(60, 10)).toBeNull();
  expect(windChill(30, 2)).toBeNull();
  expect(windChill(20, 15)).toBeLessThan(20);
});

test("aqi and pollen and uv labels", () => {
  expect(aqiLabel(30).label).toBe("Good");
  expect(aqiLabel(180).label).toBe("Unhealthy");
  expect(pollenLevel(0).label).toBe("None");
  expect(pollenLevel(300).label).toBe("Very high");
  expect(uvLabel(9)).toContain("Very high");
});

test("wmo maps night clear to moon", () => {
  expect(wmoToWeather(0, true).icon).toBe("sun");
  expect(wmoToWeather(0, false).icon).toBe("moon");
  expect(wmoToWeather(95).icon).toBe("storm");
  expect(wmoToWeather(12345).icon).toBe("unknown");
});

test("moon phase is deterministic", () => {
  expect(moonPhase(new Date("2024-01-11T12:00:00Z")).name).toBe("New moon");
  expect(moonPhase(new Date("2024-01-26T12:00:00Z")).name).toBe("Full moon");
});
