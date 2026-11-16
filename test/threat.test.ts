import { describe, expect, test } from "vitest";
import { computeThreat } from "../shared/threat";
import type { Alert } from "../shared/types";

const square = {
  type: "Polygon" as const,
  coordinates: [[[-98, 30], [-96, 30], [-96, 32], [-98, 32], [-98, 30]]],
};
const mk = (over: Partial<Alert>): Alert => ({
  id: "x", event: "Tornado Warning", severity: "Extreme", urgency: "Immediate", certainty: "Observed",
  headline: "", description: "", instruction: "", sent: "2026-05-01T00:00:00Z", onset: null,
  expires: "2099-01-01T00:00:00Z", areaDesc: "", zones: [], geometry: square, params: {}, ...over,
});
const inside = { lat: 31, lon: -97, zones: ["TXZ1"] };
const outside = { lat: 40, lon: -80, zones: ["PAZ1"] };

describe("computeThreat", () => {
  test("no alerts is CALM", () => {
    expect(computeThreat({ alerts: [], point: inside }).level).toBe("CALM");
  });
  test("Tornado Warning polygon covering the point is WARNING", () => {
    const t = computeThreat({ alerts: [mk({})], point: inside });
    expect(t.level).toBe("WARNING");
    expect(t.primary?.event).toBe("Tornado Warning");
  });
  test("warning elsewhere is ignored", () => {
    expect(computeThreat({ alerts: [mk({})], point: outside }).level).toBe("CALM");
  });
  test("observed tornado escalates to EMERGENCY", () => {
    const a = mk({ params: { tornadoDetection: "OBSERVED" } });
    expect(computeThreat({ alerts: [a], point: inside }).level).toBe("EMERGENCY");
  });
  test("destructive thunderstorm escalates", () => {
    const a = mk({ event: "Severe Thunderstorm Warning", params: { thunderstormDamageThreat: "DESTRUCTIVE" } });
    expect(computeThreat({ alerts: [a], point: inside }).level).toBe("EMERGENCY");
  });
  test("watch by zone is ELEVATED", () => {
    const a = mk({ event: "Tornado Watch", geometry: null, zones: ["TXZ1"] });
    expect(computeThreat({ alerts: [a], point: inside }).level).toBe("ELEVATED");
  });
  test("expired alerts are dropped", () => {
    const a = mk({ expires: "2020-01-01T00:00:00Z" });
    expect(computeThreat({ alerts: [a], point: inside }).level).toBe("CALM");
  });
  test("SLGT outlook elevates", () => {
    const outlook = { fetchedAt: "", days: [{ day: 1 as const, category: "SLGT" as const, label: "" }] };
    expect(computeThreat({ alerts: [], point: inside, outlook }).level).toBe("ELEVATED");
  });
  test("MRGL outlook stays calm", () => {
    const outlook = { fetchedAt: "", days: [{ day: 1 as const, category: "MRGL" as const, label: "" }] };
    expect(computeThreat({ alerts: [], point: inside, outlook }).level).toBe("CALM");
  });
});
