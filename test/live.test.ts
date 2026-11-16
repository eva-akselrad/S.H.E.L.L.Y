import { describe, expect, test } from "vitest";
import { DEFAULT_LIVE } from "../shared/config";
import { computeIntensity, type IntensityInput } from "../shared/live/intensity";
import { alertInRegion, regionAlerts } from "../shared/live/region";
import { buildRundown, type CityWx } from "../shared/live/rundown";
import { alertHeadline } from "../shared/live/templates";
import type { Alert, SpcCategory } from "../shared/types";

const NOW = Date.parse("2026-11-16T18:00:00Z");
const iso = (min: number) => new Date(NOW + min * 60_000).toISOString();

let seq = 0;
function mk(event: string, over: Partial<Alert> = {}): Alert {
  return {
    id: `a${seq++}`, event, senderName: "NWS Mount Holly NJ", severity: "Severe", urgency: "Immediate", certainty: "Likely",
    headline: `${event} issued`, description: "Take cover now.", instruction: "Move to an interior room.",
    sent: iso(-30), onset: null, expires: iso(45), areaDesc: "Bucks, PA; Montgomery, PA", zones: [], geometry: null, params: {}, ...over,
  };
}
const input = (alerts: Alert[], spc: SpcCategory = "NONE", over: Partial<IntensityInput> = {}): IntensityInput => ({ alerts, spc, now: NOW, ...over });

describe("region filter", () => {
  const region = DEFAULT_LIVE.region;
  const poly = (w: number, s: number, e: number, n: number) => ({
    type: "Polygon" as const, coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
  });
  test("matches the issuing office, case-insensitively", () => {
    expect(alertInRegion(mk("Flood Watch", { senderName: "nws mount holly nj" }), region)).toBe(true);
  });
  test("a neighbour office's polygon inside the box counts; far away does not", () => {
    const edge = mk("Tornado Warning", { senderName: "NWS Binghamton NY", geometry: poly(-75.2, 41.2, -74.9, 41.5) });
    const far = mk("Tornado Warning", { senderName: "NWS Binghamton NY", geometry: poly(-90, 35, -89, 36) });
    expect(alertInRegion(edge, region)).toBe(true);
    expect(alertInRegion(far, region)).toBe(false);
    expect(alertInRegion(mk("Tornado Warning", { senderName: "NWS Norman OK" }), region)).toBe(false);
  });
  test("expired alerts are dropped", () => {
    expect(regionAlerts([mk("Flood Watch", { expires: iso(-1) })], region, NOW)).toEqual([]);
  });
});

describe("computeIntensity", () => {
  test("calm", () => {
    const i = computeIntensity(input([]));
    expect(i).toMatchObject({ score: 0, level: "CALM", drivers: [] });
  });
  test("a fog advisory is elevated but low", () => {
    const i = computeIntensity(input([mk("Dense Fog Advisory")]));
    expect(i.level).toBe("ELEVATED");
    expect(i.score).toBeGreaterThanOrEqual(0.2);
    expect(i.score).toBeLessThan(0.35);
  });
  test("a slight-risk day is elevated", () => {
    const i = computeIntensity(input([], "SLGT"));
    expect(i.level).toBe("ELEVATED");
    expect(i.drivers.join(" ")).toContain("slight risk");
  });
  test("one tornado warning is a WARNING with a fresh-warning spike", () => {
    const old = computeIntensity(input([mk("Tornado Warning", { sent: iso(-40) })]));
    const fresh = computeIntensity(input([mk("Tornado Warning", { sent: iso(-2) })]));
    expect(old.level).toBe("WARNING");
    expect(old.score).toBe(0.5);
    expect(old.counters.tor).toBe(1);
    expect(fresh.score).toBeGreaterThan(old.score);
    expect(fresh.drivers).toContain("a newly issued warning");
  });
  test("an outbreak with a PDS tornado warning is an emergency at 1.0", () => {
    const alerts = [
      ...Array.from({ length: 7 }, () => mk("Tornado Warning")),
      mk("Tornado Warning", { headline: "Tornado Warning (PARTICULARLY DANGEROUS SITUATION)" }),
    ];
    const i = computeIntensity(input(alerts, "HIGH"));
    expect(i.level).toBe("EMERGENCY");
    expect(i.score).toBe(1);
    expect(i.counters.tor).toBe(8);
  });
  test("decays over 30 minutes after the last warning ends", () => {
    const at = (min: number) => computeIntensity(input([], "NONE", { lastWarningEndedAt: iso(-min) })).score;
    expect(at(0)).toBeCloseTo(0.3, 2);
    expect(at(15)).toBeCloseTo(0.15, 2);
    expect(at(29)).toBeLessThan(0.02);
    expect(at(31)).toBe(0);
  });
  test("score never exceeds 1", () => {
    const i = computeIntensity(input(Array.from({ length: 20 }, () => mk("Tornado Warning", { sent: iso(-1) })), "MDT", { cape: 4000 }));
    expect(i.score).toBeLessThanOrEqual(1);
  });
});

describe("buildRundown", () => {
  const cities: CityWx[] = DEFAULT_LIVE.region.cities.slice(0, 6).map((c, i) => ({ ...c, temp: 50 + i, desc: "Cloudy" }));
  const data = (alerts: Alert[], spc: SpcCategory = "NONE") => ({ alerts, spc, cities, studio: [], cams: [] });
  const run = (alerts: Alert[], spc: SpcCategory = "NONE") =>
    buildRundown(computeIntensity(input(alerts, spc)), data(alerts, spc), DEFAULT_LIVE, NOW);

  test("calm: cities, radar and a host break; no alerts; unique keys", () => {
    const r = run([]);
    expect(r.level).toBe("CALM");
    const kinds = r.items.map((i) => i.kind);
    expect(kinds).toContain("radar");
    expect(kinds).toContain("segment");
    expect(kinds).toContain("host");
    expect(kinds).not.toContain("alert");
    expect(new Set(r.items.map((i) => i.key)).size).toBe(r.items.length);
    expect(r.topAlert).toBe("NO ACTIVE WARNINGS IN THE PHILADELPHIA REGION");
    expect(r.status).toBe("Awaiting new alerts");
  });
  test("calm rotates cities as time passes", () => {
    const a = run([]).items.find((i) => i.kind === "segment");
    const b = buildRundown(computeIntensity(input([])), data([]), DEFAULT_LIVE, NOW + 10 * 60_000).items.find((i) => i.kind === "segment");
    expect(a).toBeDefined();
    expect(a && b && a.kind === "segment" && b.kind === "segment" && a.city.name !== b.city.name).toBe(true);
  });
  test("elevated: watch alert and outlook, radar interleaved", () => {
    const r = run([mk("Tornado Watch")], "ENH");
    expect(r.level).toBe("ELEVATED");
    expect(r.items.some((i) => i.kind === "alert" && !i.speak)).toBe(true);
    expect(r.items.some((i) => i.kind === "outlook")).toBe(true);
    expect(r.items.filter((i) => i.kind === "radar").length).toBeGreaterThan(1);
  });
  test("warning: leads with the tornado warning read-out and repeats it", () => {
    const tor = mk("Tornado Warning");
    const r = run([mk("Severe Thunderstorm Warning"), tor, mk("Flood Watch")]);
    expect(r.level).toBe("WARNING");
    expect(r.items[0]).toMatchObject({ kind: "alert", alertId: tor.id });
    expect(r.items[0]?.speak).toContain("Tornado Warning");
    expect(r.items.filter((i) => i.kind === "alert").length).toBeGreaterThan(1);
    expect(r.topAlert).toContain("TORNADO WARNING");
    expect(r.counters.tor).toBe(1);
  });
  test("warning radar carries a storm track with town ETAs from NWS motion data", () => {
    const motion = `${iso(0).replace("Z", "-00:00")}...storm...250DEG...35KT...40.0,-75.9`;
    const r = run([mk("Severe Thunderstorm Warning", { params: { eventMotionDescription: motion } })]);
    const radar = r.items.find((i) => i.kind === "radar" && i.view === "warning");
    expect(radar && radar.kind === "radar" && radar.track?.towns.length).toBeGreaterThan(0);
    expect(radar?.speak).toMatch(/moving (east|northeast)/);
    expect(radar?.headline).toMatch(/^STORM MOVING/);
    // without motion data it stays a plain radar item
    const plain = run([mk("Severe Thunderstorm Warning")]).items.find((i) => i.kind === "radar" && i.view === "warning");
    expect(plain?.speak).toBeUndefined();
  });
  test("emergency: only alerts and warning radar", () => {
    const r = run([mk("Tornado Warning", { headline: "PARTICULARLY DANGEROUS SITUATION" })]);
    expect(r.level).toBe("EMERGENCY");
    expect(r.items.every((i) => i.kind === "alert" || i.kind === "radar")).toBe(true);
    expect(r.items[0]?.speak).toMatch(/emergency/i);
  });
  test("alert text is the deterministic template, never free text", () => {
    expect(alertHeadline(mk("Tornado Warning"), "America/New_York")).toBe("TORNADO WARNING FOR BUCKS, PA, MONTGOMERY, PA UNTIL 1:45 PM");
  });
  test("durations honour config overrides", () => {
    const cfg = { ...DEFAULT_LIVE, itemSeconds: { radar: 33 } };
    const r = buildRundown(computeIntensity(input([])), data([]), cfg, NOW);
    expect(r.items.find((i) => i.kind === "radar")?.durationSec).toBe(33);
  });
});

describe("SPC to risk areas", () => {
  const box = (w: number, s: number, e: number, n: number) => ({ type: "Polygon" as const, coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
  test("maps categories to SHELLY levels and drops areas outside the region", async () => {
    const { spcAreas } = await import("../worker/studio");
    const fc = {
      features: [
        { properties: { LABEL: "SLGT" }, geometry: box(-75.5, 39.5, -74.5, 40.5) },
        { properties: { LABEL: "ENH" }, geometry: box(-75.2, 39.8, -74.9, 40.1) },
        { properties: { LABEL: "MRGL" }, geometry: box(-100, 35, -99, 36) },
        { properties: { LABEL: "TSTM" }, geometry: box(-75.5, 39.5, -74.5, 40.5) },
      ],
    };
    expect(spcAreas(fc, DEFAULT_LIVE.region.bbox).map((a) => a.level)).toEqual(["some", "moderate"]);
  });
});
