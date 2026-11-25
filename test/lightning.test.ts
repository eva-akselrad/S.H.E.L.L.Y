import { describe, expect, test } from "vitest";
import { DEFAULT_LIVE } from "../shared/config";
import {
  ALL_CLEAR_MS,
  flashesWithin,
  inBbox,
  lightningActive,
  lightningAdvice,
  lightningForRegion,
  lightningHeadline,
  lightningNear,
  lightningRelevance,
  liveLightningLine,
  MIN,
  pruneFlashes,
  type Flash,
} from "../shared/lightning";
import { buildLoop } from "../shared/scheduler";
import { computeIntensity, LIGHTNING_CAP } from "../shared/live/intensity";
import { buildRundown } from "../shared/live/rundown";
import type { Alert } from "../shared/types";

const NOW = Date.parse("2026-07-10T23:00:00Z");
const LAT = 40.12; // Norristown-ish
const LON = -75.34;
/** a flash `mi` miles due north of the point, `agoMin` minutes ago */
const north = (mi: number, agoMin: number): Flash => [LAT + mi / 69, LON, NOW - agoMin * MIN];

describe("lightningNear", () => {
  test("no flashes: clear, nothing to wait for, no chip", () => {
    const s = lightningNear([], LAT, LON, NOW);
    expect(s.level).toBe("clear");
    expect(s.nearestMi).toBeNull();
    expect(s.allClearAt).toBeNull();
    expect(s.trend).toBeNull();
    expect(lightningActive(s)).toBe(false);
    expect(lightningRelevance(s)).toBe(0);
  });

  test("one flash at 6 mi two minutes ago: danger, all clear 30 min after it", () => {
    const f = north(6, 2);
    const s = lightningNear([f], LAT, LON, NOW);
    expect(s.level).toBe("danger");
    expect(s.nearestMi).toBe(6);
    expect(s.allClearAt).toBe(f[2] + ALL_CLEAR_MS);
    expect(s.count10).toBe(1);
    expect(lightningHeadline(s, NOW)).toBe("Lightning about 6 mi away, 2 min ago");
    expect(lightningRelevance(s)).toBe(1);
  });

  test("a new flash within 10 mi resets the all-clear", () => {
    const a = north(6, 20);
    const b = north(8, 1);
    expect(lightningNear([a], LAT, LON, NOW).allClearAt).toBe(a[2] + ALL_CLEAR_MS);
    expect(lightningNear([a, b], LAT, LON, NOW).allClearAt).toBe(b[2] + ALL_CLEAR_MS);
  });

  test("a flash 16 min ago within 10 mi: no longer danger, but the 30-minute wait still holds", () => {
    const s = lightningNear([north(5, 16)], LAT, LON, NOW);
    expect(s.level).toBe("clear");
    expect(s.holding).toBe(true);
    expect(lightningActive(s)).toBe(true);
    expect(lightningRelevance(s)).toBe(0.6);
    expect(lightningAdvice(s, "America/New_York")).toMatch(/^Stay inside a little longer\. All clear at /);
  });

  test("after 30 quiet minutes the chip goes away", () => {
    const s = lightningNear([north(5, 31)], LAT, LON, NOW);
    expect(s.holding).toBe(false);
    expect(lightningActive(s)).toBe(false);
  });

  test("flashes 20 mi away: nearby, and no all-clear countdown (it only counts within 10 mi)", () => {
    const s = lightningNear([north(20, 3), north(21, 4)], LAT, LON, NOW);
    expect(s.level).toBe("nearby");
    expect(s.count25).toBe(2);
    expect(s.allClearAt).toBeNull();
    expect(lightningRelevance(s)).toBe(0.6);
  });

  test("flashes beyond 25 mi stay clear", () => {
    expect(lightningNear([north(40, 1)], LAT, LON, NOW).level).toBe("clear");
  });

  test("trend: closer, away, steady", () => {
    const closer = lightningNear([north(30, 10), north(30, 8), north(12, 2), north(12, 1)], LAT, LON, NOW);
    expect(closer.trend).toBe("closer");
    const away = lightningNear([north(8, 10), north(8, 9), north(24, 2), north(24, 1)], LAT, LON, NOW);
    expect(away.trend).toBe("away");
    const steady = lightningNear([north(15, 10), north(15.5, 2)], LAT, LON, NOW);
    expect(steady.trend).toBe("steady");
    expect(lightningNear([north(15, 2)], LAT, LON, NOW).trend).toBeNull();
  });

  test("stale data: never an all-clear, shows data delayed", () => {
    const s = lightningNear([north(5, 12)], LAT, LON, NOW, { stale: true });
    expect(s.stale).toBe(true);
    expect(s.allClearAt).toBeNull();
    expect(s.holding).toBe(false);
    expect(lightningHeadline(s, NOW)).toBe("Lightning data delayed");
    expect(lightningAdvice(s)).not.toMatch(/all clear/i);
    // a dry stale feed shows no chip either (the stale-alerts banner is separate)
    expect(lightningActive(lightningNear([], LAT, LON, NOW, { stale: true }))).toBe(false);
  });

  test("wording: whole miles, about, and overhead under 3 mi", () => {
    expect(lightningHeadline(lightningNear([north(2, 0)], LAT, LON, NOW), NOW)).toBe("Lightning overhead, just now");
    expect(lightningHeadline(lightningNear([north(6.4, 1)], LAT, LON, NOW), NOW)).toMatch(/about 6 mi/);
  });

  test("ignores flashes older than 30 minutes and ones far in the future", () => {
    expect(lightningNear([north(5, 40), [LAT, LON, NOW + 10 * MIN]], LAT, LON, NOW).level).toBe("clear");
  });
});

describe("helpers", () => {
  test("prune drops old flashes and caps the count, keeping the newest", () => {
    const list: Flash[] = [north(1, 50), north(1, 10), north(1, 1)];
    expect(pruneFlashes(list, NOW)).toHaveLength(2);
    const many: Flash[] = Array.from({ length: 10 }, (_, i) => north(1, i));
    expect(pruneFlashes(many, NOW, 3).map((f) => f[2])).toEqual([NOW, NOW - MIN, NOW - 2 * MIN]);
  });
  test("flashesWithin and inBbox", () => {
    expect(flashesWithin([north(5, 1), north(40, 1)], LAT, LON, 30, NOW)).toHaveLength(1);
    expect(inBbox(DEFAULT_LIVE.region.bbox, LAT, LON)).toBe(true);
    expect(inBbox(DEFAULT_LIVE.region.bbox, 35, -90)).toBe(false);
  });
  test("lightning segment shows only while there is lightning", () => {
    const base = { forecast: null, aq: null, outlook: null, level: "CALM" as const };
    expect(buildLoop({ ...base, lightning: 0 }).some((i) => i.id === "lightning")).toBe(false);
    expect(buildLoop({ ...base, lightning: 1 }).some((i) => i.id === "lightning")).toBe(true);
    expect(buildLoop({ ...base, level: "ELEVATED", lightning: 0.6 }).some((i) => i.id === "lightning")).toBe(true);
  });
});

describe("Live", () => {
  const cities = [
    { name: "Norristown", lat: LAT, lon: LON },
    { name: "Wilmington", lat: 39.74, lon: -75.55 },
  ];
  const warning = (): Alert => ({
    id: "w1", event: "Tornado Warning", senderName: "NWS Mount Holly NJ", severity: "Extreme", urgency: "Immediate", certainty: "Observed",
    headline: "x", description: "x", instruction: "x", sent: new Date(NOW - 5 * MIN).toISOString(), onset: null, expires: new Date(NOW + 30 * MIN).toISOString(),
    areaDesc: "Montgomery, PA", zones: [], geometry: null, params: {},
  });

  test("the region line names the hit city and is a template", () => {
    const r = lightningForRegion([north(6, 1), north(6, 2), north(30, 9)], cities, NOW, false);
    expect(r?.city).toBe("Norristown");
    expect(liveLightningLine(r!)).toMatch(/^Lightning about 6 miles from Norristown(, moving (closer|away)|, holding steady)?\.$/);
  });
  test("nothing for a stale feed or a dry day", () => {
    expect(lightningForRegion([north(6, 1)], cities, NOW, true)).toBeNull();
    expect(lightningForRegion([], cities, NOW, false)).toBeNull();
  });

  test("intensity: lightning nudges calm weather but is capped below the warning floor", () => {
    const calm = computeIntensity({ alerts: [], spc: "NONE", now: NOW });
    const near = computeIntensity({ alerts: [], spc: "NONE", now: NOW, lightning: "danger" });
    expect(near.score).toBeGreaterThan(calm.score);
    expect(near.level).toBe("CALM"); // never raises the threat level
    // stack everything calm weather can have: still under 0.5, the floor any warning gets
    const stacked = computeIntensity({ alerts: [], spc: "ENH", cape: 3000, now: NOW, lightning: "danger" });
    const stackedNo = computeIntensity({ alerts: [], spc: "ENH", cape: 3000, now: NOW });
    expect(stacked.score).toBeLessThanOrEqual(Math.max(stackedNo.score, LIGHTNING_CAP));
    // a warning outranks any lightning, and lightning adds nothing on top of it
    const w = computeIntensity({ alerts: [warning()], spc: "NONE", now: NOW });
    const wl = computeIntensity({ alerts: [warning()], spc: "NONE", now: NOW, lightning: "danger" });
    expect(wl.score).toBe(w.score);
    expect(wl.level).toBe("WARNING");
    expect(w.score).toBeGreaterThan(near.score);
    expect(near.score).toBeLessThanOrEqual(LIGHTNING_CAP);
  });

  test("rundown carries a deterministic lightning item in calm weather, none on a dry day", () => {
    const lt = lightningForRegion([north(6, 1)], cities, NOW, false);
    const cityWx = cities.map((c) => ({ ...c, state: "PA", temp: 80, desc: "Humid" }));
    const live = { ...DEFAULT_LIVE, playlist: [] };
    const intensity = computeIntensity({ alerts: [], spc: "NONE", now: NOW, lightning: lt!.state.level });
    const r = buildRundown(intensity, { alerts: [], spc: "NONE", cities: cityWx, studio: [], cams: [], lightning: lt }, live, NOW);
    const item = r.items.find((i) => i.kind === "host" && i.headline.startsWith("LIGHTNING"));
    expect(item).toBeTruthy();
    expect(item?.kind === "host" ? item.text : "").toMatch(/Lightning about 6 miles from Norristown/);
    expect(item?.kind === "host" ? item.source : "").toBe("template");
    const dry = buildRundown(computeIntensity({ alerts: [], spc: "NONE", now: NOW }), { alerts: [], spc: "NONE", cities: cityWx, studio: [], cams: [], lightning: null }, live, NOW);
    expect(dry.items.some((i) => i.headline.startsWith("LIGHTNING"))).toBe(false);
  });
});
