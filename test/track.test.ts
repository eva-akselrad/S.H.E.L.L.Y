import { expect, test } from "vitest";
import { advance, compass, parseMotion, trackHeadline, trackScript, trackStorm } from "../shared/live/track";
import { TOWNS } from "../shared/live/towns";

const AT = "2026-05-01T18:00:00-00:00";
const DESC = `${AT}...storm...270DEG...30KT...39.9,-75.2`;
const now = Date.parse(AT);

test("parses NWS motion text", () => {
  const m = parseMotion(DESC)!;
  expect(m.toDeg).toBe(90);
  expect(m.speedKt).toBe(30);
  expect(m.point).toEqual([-75.2, 39.9]);
  expect(parseMotion("junk")).toBeNull();
  expect(parseMotion(undefined)).toBeNull();
  expect(parseMotion(`${AT}...storm...270DEG...0KT...39.9,-75.2`)).toBeNull();
});

test("takes the last point and fixes a dropped longitude sign", () => {
  const m = parseMotion(`${AT}...storm...180DEG...20KT...40.1,75.3 39.9,75.2`)!;
  expect(m.point[0]).toBeLessThan(0);
  expect(m.toDeg).toBe(0);
});

test("ETA matches a hand calculation within 2 minutes", () => {
  // 10 mi due east at 30 kt (34.52 mph) is 17.4 min
  const lon = -75.2 + 10 / (69.172 * Math.cos((39.9 * Math.PI) / 180));
  const info = trackStorm(parseMotion(DESC)!, [{ name: "East", state: "PA", lat: 39.9, lon }, { name: "West", state: "PA", lat: 39.9, lon: -75.6 }, { name: "North", state: "PA", lat: 40.4, lon: -75.2 }], now, "2026-05-01T19:00:00Z");
  expect(info.towns.map((t) => t.name)).toEqual(["East"]);
  expect(Math.abs(info.towns[0]!.etaMin - 17.4)).toBeLessThanOrEqual(2);
  expect(info.speedMph).toBe(35);
});

test("the storm position advances with time since the observation", () => {
  const later = trackStorm(parseMotion(DESC)!, [], now + 10 * 60000, null);
  expect(later.origin[0]).toBeGreaterThan(-75.2);
});

test("real towns, sorted by ETA, capped, and limited by warning expiry", () => {
  const m = parseMotion(`${AT}...storm...250DEG...35KT...40.0,-75.9`)!;
  const info = trackStorm(m, TOWNS, now, "2026-05-01T19:00:00Z");
  const etas = info.towns.map((t) => t.etaMin);
  expect(etas).toEqual([...etas].sort((a, b) => a - b));
  expect(info.towns.length).toBeLessThanOrEqual(6);
  const short = trackStorm(m, TOWNS, now, "2026-05-01T18:05:00Z");
  expect(short.towns.every((t) => t.etaMin <= 15)).toBe(true);
});

test("advance and compass behave", () => {
  const p = advance([-75, 40], 0, 69);
  expect(p[1]).toBeCloseTo(41, 3);
  expect(compass(90)).toBe("east");
  expect(compass(359)).toBe("north");
});

test("script and headline come only from the track data", () => {
  const info = trackStorm(parseMotion(DESC)!, [{ name: "East", state: "PA", lat: 39.9, lon: -75.0 }], now, null);
  expect(trackScript(info)).toMatch(/moving east at 35 miles per hour/);
  expect(trackScript(info)).toContain("East in about");
  expect(trackHeadline(info)).toMatch(/^STORM MOVING E AT 35 MPH: EAST IN \d+ MIN$/);
  expect(trackScript({ ...info, towns: [] })).not.toContain("reach");
});
