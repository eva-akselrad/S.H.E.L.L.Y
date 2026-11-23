import { describe, expect, test } from "vitest";
import { actionFor, urgencyRank } from "../shared/actions";
import { buildConfidence, percentile, rainText, rangeText, snowText } from "../shared/confidence";
import { normalizeConfig } from "../shared/config";
import { distanceToGeometryMi, etaLine, etaToPoint, nearbyLine, nearbyWarnings } from "../shared/eta";
import {
  addDays,
  dayExtremes,
  dayObs,
  gradeDay,
  gradeHours,
  latestLine,
  predictionsFrom,
  rainBuckets,
  rainLine,
  rainTotal,
  summarize,
  windLine,
  type GradedDay,
  type HourPrediction,
  type Obs,
} from "../shared/grade";
import { hazardScore, hurricaneCategory, nearestTideStation, parseNhc, parseTides, snowDayOdds, type Hazards } from "../shared/hazards";
import { agoText, alertHealth, healthMessage, latencySamples, latencyStats } from "../shared/health";
import { localDate, localHour, localNow, rainNowcast } from "../shared/nowcast";
import { decidePushes, inQuietHours, pushPayload, updateSentLog, validEndpoint, type PushSub } from "../shared/push";
import { convectiveDayStart, nearbyReports, parseSpcReports, reportTitle } from "../shared/reports";
import { buildLoop } from "../shared/scheduler";
import type { Alert, Forecast, HourPoint } from "../shared/types";
import { whatToWear } from "../shared/wear";

const square = (w: number, s: number, e: number, n: number) => ({
  type: "Polygon" as const,
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});
const mk = (over: Partial<Alert> = {}): Alert => ({
  id: "a1", event: "Tornado Warning", severity: "Extreme", urgency: "Immediate", certainty: "Observed",
  headline: "", description: "", instruction: "", sent: "2026-05-01T18:00:00Z", onset: null,
  expires: "2099-01-01T00:00:00Z", areaDesc: "", zones: [], geometry: square(-76.2, 39.9, -75.4, 40.1), params: {}, ...over,
});
const hour = (time: string, over: Partial<HourPoint> = {}): HourPoint => ({ time, temp: 50, feelsLike: 50, code: 3, pop: 0, precip: 0, wind: 5, cape: 0, ...over });
const fc = (over: Partial<Forecast> = {}): Forecast => ({
  fetchedAt: "",
  current: { temp: 50, feelsLike: 50, humidity: 50, dewPoint: 40, windSpeed: 5, windGust: 8, windDir: 90, pressure: 30, visibilityMi: 10, uv: 2, cloud: 50, code: 3, isDay: true, precip: 0, time: "" },
  hourly: [],
  daily: [],
  nowcast: [],
  text: [],
  ...over,
});

describe("alert health (never fail silently)", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  test("fresh data is ok", () => {
    expect(alertHealth(new Date(now - 60_000).toISOString(), now - 20_000, now).ok).toBe(true);
  });
  test("never loaded is not ok", () => {
    const h = alertHealth(null, null, now);
    expect(h.ok).toBe(false);
    expect(h.reason).toBe("never_loaded");
  });
  test("server feed older than 3 min is flagged", () => {
    const h = alertHealth(new Date(now - 6 * 60_000).toISOString(), now - 10_000, now);
    expect(h.reason).toBe("feed_stale");
    expect(healthMessage(h)).toMatch(/6 min old/);
  });
  test("screen that can't reach the server is flagged", () => {
    expect(alertHealth(new Date(now - 60_000).toISOString(), now - 5 * 60_000, now).reason).toBe("unreachable");
  });
  test("agoText", () => {
    expect(agoText(now - 10_000, now)).toBe("just now");
    expect(agoText(now - 3 * 60_000, now)).toBe("3 min ago");
    expect(agoText(null, now)).toBe("");
  });
  test("latency samples skip known and very old alerts", () => {
    const s = latencySamples(new Set(["old"]), [
      { id: "old", event: "X", sent: new Date(now - 60_000).toISOString() },
      { id: "new", event: "Tornado Warning", sent: new Date(now - 45_000).toISOString() },
      { id: "ancient", event: "Y", sent: new Date(now - 3_600_000).toISOString() },
    ], now);
    expect(s.map((x) => x.ms)).toEqual([45_000]);
    const st = latencyStats(s);
    expect(st.medianS).toBe(45);
    expect(st.warningsMedianS).toBe(45);
  });
});

describe("action card", () => {
  test("tornado warning tells you to take cover, using your shelter", () => {
    const c = actionFor(mk(), 14, { shelter: "the basement, under the stairs.", evacuation: "" })!;
    expect(c.urgency).toBe("now");
    expect(c.steps[0]).toBe("Go to the basement, under the stairs now.");
    expect(c.steps.join(" ")).not.toMatch(/Wake everyone/);
  });
  test("at night it says wake everyone up", () => {
    expect(actionFor(mk(), 2)!.steps.join(" ")).toMatch(/Wake everyone up/);
  });
  test("observed tornado is called out", () => {
    expect(actionFor(mk({ params: { tornadoDetection: "OBSERVED" } }), 12)!.title).toMatch(/on the ground/);
  });
  test("watch is prepare, flash flood says turn around", () => {
    expect(actionFor(mk({ event: "Tornado Watch" }), 12)!.urgency).toBe("prepare");
    expect(actionFor(mk({ event: "Flash Flood Warning" }), 12)!.steps[0]).toMatch(/Turn around/);
  });
  test("heat says check on relatives", () => {
    expect(actionFor(mk({ event: "Extreme Heat Warning" }), 12)!.steps.join(" ")).toMatch(/older relatives/);
  });
  test("unknown statements get no card", () => {
    expect(actionFor(mk({ event: "Hydrologic Outlook" }), 12)).toBeNull();
  });
  test("urgency ranks", () => {
    expect(urgencyRank("now")).toBeGreaterThan(urgencyRank("prepare"));
  });
});

describe("storm ETA at your address", () => {
  const at = Date.parse("2026-05-01T18:00:00Z");
  const moving = mk({ params: { eventMotionDescription: "2026-05-01T18:00:00-00:00...storm...270DEG...30KT...40.0,-76.0" } });
  test("eastbound storm reaches a point 26 mi east in about 46 min", () => {
    const e = etaToPoint(moving, 40.0, -75.5, at)!;
    expect(e.etaMin).toBeGreaterThanOrEqual(44);
    expect(e.etaMin).toBeLessThanOrEqual(48);
    expect(e.direction).toBe("east");
    expect(etaLine(e, "UTC")).toMatch(/about \d+ min \(6:4\d PM\)/);
  });
  test("a point behind the storm gets no ETA", () => {
    expect(etaToPoint(moving, 40.0, -76.5, at)).toBeNull();
  });
  test("a point far off the track gets no ETA", () => {
    expect(etaToPoint(moving, 40.6, -75.5, at)).toBeNull();
  });
  test("no motion, no ETA", () => {
    expect(etaToPoint(mk(), 40, -75.5, at)).toBeNull();
  });
  test("distance to polygon", () => {
    const g = square(-76.2, 39.9, -76.0, 40.1);
    expect(distanceToGeometryMi(40, -76.1, g)).toBe(0);
    const d = distanceToGeometryMi(40, -75.9, g);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(5.6);
  });
  test("nearby warning that misses you", () => {
    const a = mk({ geometry: square(-76.2, 39.9, -76.0, 40.1) });
    const list = nearbyWarnings([a, mk({ id: "w", event: "Tornado Watch" })], 40, -75.9, at);
    expect(list).toHaveLength(1);
    expect(list[0]!.side).toBe("west");
    expect(nearbyLine(list[0]!)).toMatch(/Tornado Warning 5 mi to your west\. It does not cover you/);
  });
  test("a warning covering you is not 'nearby'", () => {
    expect(nearbyWarnings([mk()], 40, -75.9, at)).toHaveLength(0);
  });
});

describe("rain nowcast", () => {
  const steps = (vals: number[]) => vals.map((p, i) => ({ time: `2026-11-16T${String(14 + Math.floor((i + 1) / 4)).padStart(2, "0")}:${String(((i + 1) % 4) * 15).padStart(2, "0")}`, precip: p }));
  test("dry", () => {
    const r = rainNowcast(steps([0, 0, 0, 0, 0, 0, 0, 0]), "2026-11-16T14:00");
    expect(r.kind).toBe("dry");
    expect(r.sentence).toBe("No rain or snow for the next 2 hours.");
  });
  test("starting in about 30 min", () => {
    const r = rainNowcast(steps([0, 0, 0.6, 0.8, 0.8, 0.6, 0.4, 0.3]), "2026-11-16T14:00");
    expect(r.kind).toBe("starting");
    expect(r.inMin).toBe(30);
    expect(r.sentence).toBe("Rain likely in about 30 min.");
  });
  test("short shower", () => {
    expect(rainNowcast(steps([0, 0.5, 0, 0, 0, 0, 0, 0]), "2026-11-16T14:00").sentence).toBe("A shower likely in about 15 min.");
  });
  test("ending", () => {
    const r = rainNowcast(steps([0.5, 0.5, 0.2, 0, 0, 0, 0, 0]), "2026-11-16T14:00");
    expect(r.kind).toBe("ending");
    expect(r.sentence).toBe("Rain ending in about 45 min.");
  });
  test("snow when the hourly code says snow", () => {
    const r = rainNowcast(steps([0, 0, 0.6, 0.8, 0.8, 0.6, 0.4, 0.3]), "2026-11-16T14:00", [hour("2026-11-16T14:00", { code: 73, temp: 28 })]);
    expect(r.sentence).toBe("Snow likely in about 30 min.");
  });
  test("local time helpers", () => {
    const d = new Date("2026-11-16T05:30:00Z");
    expect(localNow("America/New_York", d)).toBe("2026-11-16T00:30");
    expect(localHour("America/New_York", d)).toBe(0);
    expect(localDate("America/New_York", new Date("2026-11-16T03:00:00Z"))).toBe("2026-11-15");
  });
});

describe("what to wear", () => {
  test("cold morning, rain later", () => {
    const f = fc({
      hourly: [hour("2026-11-16T08:00", { feelsLike: 34 }), hour("2026-11-16T12:00", { feelsLike: 40 }), hour("2026-11-16T15:00", { feelsLike: 42, pop: 70, precip: 0.1, code: 61 })],
      daily: [{ date: "2026-11-16", code: 61, hi: 45, lo: 33, pop: 70, precip: 0.2, snow: 0, sunrise: "", sunset: "", uvMax: 2, windMax: 10, gustMax: 15 }],
    });
    const w = whatToWear(f, "2026-11-16T08:00")!;
    expect(w.line).toBe("Wear a warm coat. Take an umbrella (rain after 3 PM).");
  });
  test("big swing suggests layers", () => {
    const f = fc({ hourly: [hour("2026-11-16T07:00", { feelsLike: 38 }), hour("2026-11-16T14:00", { feelsLike: 70 })] });
    expect(whatToWear(f, "2026-11-16T07:00")!.line).toMatch(/^Layers:/);
  });
});

describe("storm reports", () => {
  const csv = [
    "Time,F_Scale,Location,County,State,Lat,Lon,Comments",
    "2215,EF1,3 N Doylestown,Bucks,PA,40.35,-75.13,Trees down. (PHI)",
    "Time,Speed,Location,County,State,Lat,Lon,Comments",
    "0130,UNK,Camden,Camden,NJ,39.93,-75.12,Wires down, road closed. (PHI)",
    "Time,Size,Location,County,State,Lat,Lon,Comments",
    "1945,175,Far Away,Dallas,TX,32.78,-96.8,(FWD)",
  ].join("\n");
  const start = Date.parse("2026-05-01T12:00:00Z");
  const list = parseSpcReports(csv, start);
  test("parses all three sections with times in the convective day", () => {
    expect(list.map((r) => r.kind)).toEqual(["tornado", "wind", "hail"]);
    expect(list[0]!.time).toBe("2026-05-01T22:15:00.000Z");
    expect(list[1]!.time).toBe("2026-05-02T01:30:00.000Z"); // after midnight UTC = next calendar day
    expect(list[1]!.comments).toBe("Wires down, road closed. (PHI)");
    expect(reportTitle(list[0]!)).toBe("Tornado (EF1)");
    expect(reportTitle(list[2]!)).toBe("Hail (1.75 in)");
    expect(reportTitle(list[1]!)).toBe("Wind damage");
  });
  test("nearby filter", () => {
    const near = nearbyReports(list, 39.95, -75.16, Date.parse("2026-05-02T03:00:00Z"));
    expect(near.map((r) => r.kind)).toEqual(["wind", "tornado"]);
  });
  test("convective day starts at 12Z", () => {
    expect(new Date(convectiveDayStart(Date.parse("2026-05-02T03:00:00Z"))).toISOString()).toBe("2026-05-01T12:00:00.000Z");
    expect(new Date(convectiveDayStart(Date.parse("2026-05-02T13:00:00Z"))).toISOString()).toBe("2026-05-02T12:00:00.000Z");
  });
});

describe("forecast confidence", () => {
  const members = (base: string, vals: number[]) => Object.fromEntries(vals.map((v, i) => [i === 0 ? base : `${base}_member${String(i).padStart(2, "0")}`, [v]]));
  test("tight agreement is high confidence", () => {
    const c = buildConfidence(
      { time: ["2026-11-17"], ...members("temperature_2m_max", [60, 61, 60, 59, 61, 60]), ...members("temperature_2m_min", [40, 41, 40, 40, 39, 40]), ...members("precipitation_sum", [0, 0, 0, 0, 0, 0]), ...members("snowfall_sum", [0, 0, 0, 0, 0, 0]) },
      "test",
      "",
    );
    expect(c.members).toBe(6);
    expect(c.days[0]!.level).toBe("high");
    expect(rangeText(c.days[0]!.hi)).toBe("60°");
  });
  test("wide spread is low confidence with a range", () => {
    const c = buildConfidence(
      { time: ["2026-11-17"], ...members("temperature_2m_max", [40, 55, 48, 60, 44, 52, 58, 42]), ...members("snowfall_sum", [0, 6, 2, 0, 8, 1, 4, 3]) },
      "test",
      "",
    );
    expect(c.days[0]!.level).toBe("low");
    expect(rangeText(c.days[0]!.hi)).toMatch(/^\d+–\d+°$/);
    expect(snowText(c.days[0]!.snow)).toMatch(/^\d+–\d+ in$/);
  });
  test("rain, wind and dew point get their own ratings", () => {
    const c = buildConfidence(
      {
        time: ["2026-11-17"],
        ...members("temperature_2m_max", [60, 61, 60, 59, 61, 60]),
        ...members("temperature_2m_min", [40, 41, 40, 40, 39, 40]),
        ...members("precipitation_sum", [0, 0.3, 0, 0.5, 0.2, 0]),
        ...members("snowfall_sum", [0, 0, 0, 0, 0, 0]),
        ...members("wind_gusts_10m_max", [20, 50, 25, 45, 30, 55]),
        ...members("dew_point_2m_mean", [40, 41, 40, 41, 40, 41]),
      },
      "test",
      "",
    );
    const d = c.days[0]!;
    expect(d.parts!.temp.level).toBe("high");
    expect(d.parts!.rain.level).toBe("medium");
    expect(d.parts!.wind.level).toBe("low");
    expect(d.parts!.dew.level).toBe("high");
    expect(d.level).toBe("low");
    expect(d.why).toMatch(/^Gusts could be/);
    expect(rainText(d.precip, d.wetChance)).toBe("50% of runs");
    expect(rainText({ p10: 0.2, p50: 0.5, p90: 1.1 }, 90)).toBe("0.2–1.1 in");
    expect(rainText({ p10: 0, p50: 0, p90: 0 }, 0)).toBe("");
  });
  test("percentile", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });
});

describe("SHELLY grades itself", () => {
  test("day extremes need enough readings", () => {
    expect(dayExtremes([{ time: "", tempC: 10 }], 16)).toBeNull();
    const obs = Array.from({ length: 24 }, (_, i) => ({ time: "", tempC: i === 5 ? 0 : i === 15 ? 20 : 10 }));
    expect(dayExtremes(obs)).toEqual({ hi: 68, lo: 32, n: 24 });
  });
  test("grading and summary", () => {
    const days: GradedDay[] = [
      gradeDay("2026-11-15", "KPHL", { hi: 52, lo: 38 }, [{ issued: "2026-11-14", lead: 1, hi: 54, lo: 37 }]),
      gradeDay("2026-11-14", "KPHL", { hi: 60, lo: 40 }, [{ issued: "2026-11-13", lead: 1, hi: 60, lo: 42 }]),
      gradeDay("2026-11-13", "KPHL", { hi: 50, lo: 30 }, [{ issued: "2026-11-12", lead: 1, hi: 56, lo: 31 }]),
    ];
    const s = summarize(days);
    expect(s.latest?.date).toBe("2026-11-15");
    expect(s.days30).toBe(3);
    expect(s.hiWithin3).toBe(67);
    expect(s.hiMae).toBeCloseTo(2.7, 1);
    expect(s.hiBias).toBeCloseTo(2.7, 1);
    expect(latestLine(days[0]!)).toBe("The forecast high was 2° too warm (54° forecast, 52° measured).");
    expect(latestLine(days[1]!)).toMatch(/^Nailed it/);
  });
  test("rain totals count each hour once, specials included", () => {
    const obs: Obs[] = [
      // 13:54 routine (0.5 mm), 14:20 special (1 mm so far), 14:54 routine (3 mm for the hour)
      { time: "2026-11-15T13:54:00Z", tempC: 5, routine: true, precipMm: 0.5 },
      { time: "2026-11-15T14:20:00Z", tempC: 5, routine: true, precipMm: 1 },
      { time: "2026-11-15T14:54:00Z", tempC: 5, routine: true, precipMm: 3 },
      { time: "2026-11-15T14:58:00Z", tempC: 5 },
    ];
    expect([...rainBuckets(obs).values()]).toEqual([0.5, 3]);
    expect(rainTotal(obs, 2)).toBeCloseTo(3.5 / 25.4, 2);
    expect(rainTotal(obs)).toBeNull(); // too few hourly reports
  });
  test("a full day of readings grades every element", () => {
    const start = Date.parse("2026-11-15T05:00:00Z");
    const obs: Obs[] = [];
    for (let h = 0; h < 24; h++) {
      const at = start + h * 3_600_000;
      // a 5-minute reading on the hour, and the routine report at :54
      obs.push({ time: new Date(at).toISOString(), tempC: 10, dewC: 5, windKmh: 16.09344, gustKmh: null });
      obs.push({ time: new Date(at + 54 * 60_000).toISOString(), tempC: 10, dewC: 5, windKmh: 16.09344, gustKmh: h === 12 ? 48.28 : null, routine: true, precipMm: h === 15 ? 5.08 : null });
    }
    const day = dayObs(obs)!;
    expect(day).toMatchObject({ hi: 50, lo: 50, dew: 41, wind: 10, gust: 30, precip: 0.2 });
    const g = gradeDay("2026-11-15", "KPHL", day, [{ issued: "2026-11-14", lead: 1, hi: 52, lo: 48, dew: 43, wind: 12, gust: 25, precip: 0.1, pop: 70 }]);
    expect(g.leads["1"]).toMatchObject({ hiErr: 2, loErr: -2, dewErr: 2, windErr: 2, gustErr: -5, precipErr: -0.1, rainRight: true, brier: 0.09 });
    expect(rainLine(g)).toBe("Rain: Right call (0.10 in forecast, 0.20 in measured).");
    expect(windLine(g)).toBe("Gusts: 25 mph forecast, 30 mph measured.");

    // hour by hour: forecast 1° warm all day, rain in the hour after the 15:54 local report... at t = 16:00 local
    const hours: HourPrediction[] = Array.from({ length: 24 }, (_, h) => ({
      t: (start + h * 3_600_000) / 1000,
      temp: 51,
      dew: 41,
      wind: 10,
      gust: 10,
      precip: h === 16 ? 0.2 : 0,
      pop: 0,
    }));
    const hg = gradeHours(hours, obs)!;
    expect(hg).toMatchObject({ n: 24, temp: 1, dew: 0, wind: 0, rainRight: 100, wetObs: 1, wetFc: 1 });

    const s = summarize([{ ...g, hourly: hg }]);
    expect(s.rain).toEqual({ n: 1, right: 100, brier: 0.09 });
    expect(s.gust.mae).toBe(5);
    expect(s.hourly.temp).toBe(1);
  });
  test("old records without the new fields still summarize", () => {
    const old: GradedDay = { date: "2026-11-01", station: "KPHL", obsHi: 50, obsLo: 40, leads: { "1": { hi: 52, lo: 40, hiErr: 2, loErr: 0 } } };
    const s = summarize([old]);
    expect(s.hiMae).toBe(2);
    expect(s.rain.right).toBeNull();
    expect(rainLine(old)).toBe("");
  });
  test("predictions come from the grader's Open-Meteo request", () => {
    const tz = "America/New_York";
    const mid = (d: string) => Date.parse(`${d}T05:00:00Z`) / 1000;
    const raw = {
      daily: {
        time: [mid("2026-11-15"), mid("2026-11-16"), mid("2026-11-17"), mid("2026-11-18")],
        temperature_2m_max: [50, 52.4, 55, 58],
        temperature_2m_min: [40, 41, 42, 43],
        wind_speed_10m_max: [10, 12, 14, 16],
        wind_gusts_10m_max: [20, 22, 24, 26],
        precipitation_sum: [0, 0.123, 0, 0.5],
        precipitation_probability_max: [0, 60, 10, 80],
      },
      hourly: {
        time: Array.from({ length: 48 }, (_, i) => mid("2026-11-16") + i * 3600),
        temperature_2m: Array(48).fill(50),
        dew_point_2m: Array(48).fill(40),
        wind_speed_10m: Array(48).fill(8),
        wind_gusts_10m: Array(48).fill(15),
        precipitation: Array(48).fill(0),
        precipitation_probability: Array(48).fill(20),
      },
    };
    const { preds, hours } = predictionsFrom(raw, tz, "2026-11-15", [1, 3]);
    expect(preds).toEqual([
      { target: "2026-11-16", issued: "2026-11-15", lead: 1, hi: 52, lo: 41, dew: 40, wind: 12, gust: 22, precip: 0.12, pop: 60 },
      { target: "2026-11-18", issued: "2026-11-15", lead: 3, hi: 58, lo: 43, wind: 16, gust: 26, precip: 0.5, pop: 80 },
    ]);
    expect(hours["2026-11-16"]).toHaveLength(24);
  });
  test("addDays crosses months", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("local hazards", () => {
  test("nearest tide station within 30 mi", () => {
    expect(nearestTideStation(39.95, -75.16)?.id).toBe("8545240");
    expect(nearestTideStation(40.6, -77.5)).toBeNull();
  });
  test("tides parse to ISO", () => {
    const t = parseTides({ predictions: [{ t: "2026-11-16 16:53", v: "3.971", type: "H" }] });
    expect(t).toEqual([{ time: "2026-11-16T16:53:00.000Z", type: "H", ft: 4 }]);
  });
  test("NHC storms near the point", () => {
    const list = parseNhc(
      { activeStorms: [{ name: "Ana", classification: "HU", intensity: "90", latitudeNumeric: 35.0, longitudeNumeric: -74.0, movementDir: 30, movementSpeed: 15 }, { name: "Far", classification: "TS", intensity: "40", latitudeNumeric: 15, longitudeNumeric: -40 }] },
      39.95,
      -75.16,
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Ana", kind: "Hurricane", windMph: 104, category: 2, side: "south", movement: "moving northeast at 15 mph" });
    expect(hurricaneCategory(73)).toBeNull();
  });
  test("snow day odds", () => {
    const f = fc({
      hourly: [hour("2026-11-16T22:00", { code: 73, temp: 25 }), hour("2026-11-17T02:00", { code: 75, temp: 22 }), hour("2026-11-17T06:00", { code: 73, temp: 19 })],
      daily: [
        { date: "2026-11-16", code: 73, hi: 30, lo: 22, pop: 90, precip: 0.5, snow: 2, sunrise: "", sunset: "", uvMax: 1, windMax: 10, gustMax: 20 },
        { date: "2026-11-17", code: 75, hi: 28, lo: 18, pop: 90, precip: 0.6, snow: 5, sunrise: "", sunset: "", uvMax: 1, windMax: 10, gustMax: 20 },
      ],
    });
    const s = snowDayOdds(f, [mk({ event: "Winter Storm Warning" })], "2026-11-16T19:00")!;
    expect(s.date).toBe("2026-11-17");
    expect(s.odds).toBeGreaterThanOrEqual(60);
    expect(snowDayOdds(fc(), [], "2026-11-16T19:00")).toBeNull();
  });
  test("hazard score", () => {
    const h: Hazards = { fetchedAt: "", rivers: [], tides: null, tropical: [] };
    expect(hazardScore(null, null)).toBe(0);
    expect(hazardScore({ ...h, tides: { station: "x", name: "x", distanceMi: 1, next: [] } }, null)).toBe(0.3);
    expect(hazardScore({ ...h, rivers: [{ lid: "X", name: "", stage: 9, unit: "ft", category: "minor", forecastStage: null, forecastCategory: "unknown", floodStage: 8.5, time: null, distanceMi: 2 }] }, null)).toBe(1);
  });
});

describe("push decisions", () => {
  const sub: PushSub = {
    id: "s", endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "", auth: "" },
    lat: 40, lon: -75.9, zones: ["PAZ070"], name: "Home", tz: "America/New_York",
    prefs: { watches: false, quietStart: 22, quietEnd: 7 }, created: "",
  };
  const now = Date.parse("2026-05-01T18:00:00Z");
  test("polygon covering the point pushes; county-wide polygon that misses does not", () => {
    const hit = mk({ id: "hit" });
    const miss = mk({ id: "miss", geometry: square(-76.5, 39.0, -76.3, 39.2), zones: ["PAZ070"] });
    expect(decidePushes([hit, miss], sub, {}, 14, now).map((d) => d.alert.id)).toEqual(["hit"]);
  });
  test("watches need opt-in and respect quiet hours", () => {
    const watch = mk({ id: "w", event: "Tornado Watch", geometry: null, zones: ["PAZ070"] });
    expect(decidePushes([watch], sub, {}, 14, now)).toHaveLength(0);
    const optIn = { ...sub, prefs: { ...sub.prefs, watches: true } };
    expect(decidePushes([watch], optIn, {}, 14, now)).toHaveLength(1);
    expect(decidePushes([watch], optIn, {}, 23, now)).toHaveLength(0);
  });
  test("warnings push in quiet hours", () => {
    expect(decidePushes([mk()], sub, {}, 3, now)).toHaveLength(1);
  });
  test("no repeat, and an NWS update only pushes on upgrade", () => {
    const first = mk({ id: "v1" });
    const d1 = decidePushes([first], sub, {}, 14, now);
    const log = updateSentLog({}, [first], d1);
    expect(decidePushes([first], sub, log, 14, now)).toHaveLength(0);
    const update = mk({ id: "v2", references: ["v1"] });
    expect(decidePushes([update], sub, log, 14, now)).toHaveLength(0);
    const upgraded = mk({ id: "v3", references: ["v1"], params: { tornadoDetection: "OBSERVED" } });
    const d3 = decidePushes([upgraded], sub, log, 14, now);
    expect(d3).toHaveLength(1);
    expect(d3[0]!.kind).toBe("upgrade");
    expect(pushPayload(d3[0]!, sub, 14, now).title).toBe("EMERGENCY: Tornado Warning for Home");
  });
  test("sent log forgets expired alerts", () => {
    expect(updateSentLog({ gone: 2 }, [], [])).toEqual({});
  });
  test("quiet hours wrap midnight", () => {
    const p = { watches: true, quietStart: 22, quietEnd: 7 };
    expect(inQuietHours(p, 23)).toBe(true);
    expect(inQuietHours(p, 6)).toBe(true);
    expect(inQuietHours(p, 7)).toBe(false);
    expect(inQuietHours({ ...p, quietStart: null }, 23)).toBe(false);
  });
  test("only real push services are allowed", () => {
    expect(validEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(validEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(validEndpoint("https://evil.example.com/abc")).toBe(false);
    expect(validEndpoint("http://fcm.googleapis.com/x")).toBe(false);
  });
});

describe("scheduler and config", () => {
  const base = { forecast: fc(), aq: null, outlook: null, level: "CALM" as const };
  test("new segments appear only when relevant", () => {
    const quiet = buildLoop(base).map((i) => i.id);
    expect(quiet).not.toContain("reports");
    expect(quiet).not.toContain("local");
    const busy = buildLoop({ ...base, reportsNearby: 3, hazards: 1, graded: true }).map((i) => i.id);
    expect(busy).toEqual(expect.arrayContaining(["reports", "local", "grade"]));
  });
  test("storm reports and active hazards stay in an elevated loop", () => {
    const ids = buildLoop({ ...base, level: "ELEVATED", reportsNearby: 2, hazards: 1, graded: true }).map((i) => i.id);
    expect(ids).toContain("reports");
    expect(ids).toContain("local");
    expect(ids).not.toContain("grade");
  });
  test("safety plan is clamped and trimmed", () => {
    const c = normalizeConfig({ safety: { shelter: `  basement ${"x".repeat(300)}`, evacuation: 5 }, wear: false });
    expect(c.safety.shelter.length).toBeLessThanOrEqual(120);
    expect(c.safety.shelter.startsWith("basement")).toBe(true);
    expect(c.safety.evacuation).toBe("");
    expect(c.wear).toBe(false);
    expect(normalizeConfig({}).wear).toBe(true);
  });
});
