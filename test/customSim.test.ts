import { describe, expect, test } from "vitest";
import { buildSimAlert, normalizeCustomSim, simLabel, type SimEntry } from "../shared/simulate";
import { alertLevel } from "../shared/threat";

const pt = { lat: 40, lon: -75, zones: ["PAZ106"] };
const entry = (custom: unknown): SimEntry => ({ id: "s1", preset: "custom", custom: normalizeCustomSim(custom)!, created: "2026-11-17T00:00:00Z", expires: "2026-11-17T01:00:00Z" });

describe("custom simulated alerts", () => {
  test("needs an event name", () => {
    expect(normalizeCustomSim({ event: "  " })).toBeNull();
    expect(normalizeCustomSim(null)).toBeNull();
  });
  test("clips long text and fixes a bad severity", () => {
    const c = normalizeCustomSim({ event: "x".repeat(200), severity: "Huge", description: "d".repeat(900), instruction: "i".repeat(900) })!;
    expect(c.event).toHaveLength(80);
    expect(c.severity).toBe("Severe");
    expect(c.description).toHaveLength(600);
    expect(c.instruction).toHaveLength(400);
  });
  test("always labelled as a test and covers the viewer", () => {
    const a = buildSimAlert(entry({ event: "Tornado Warning", severity: "Extreme", description: "Big one.", instruction: "Hide." }), pt);
    expect(a.headline.startsWith("TEST:")).toBe(true);
    expect(a.description.startsWith("THIS IS A TEST.")).toBe(true);
    expect(a.instruction.startsWith("THIS IS A TEST.")).toBe(true);
    expect(a.zones).toEqual(["PAZ106"]);
    expect(simLabel(entry({ event: "Wind Advisory" }))).toBe("Custom: Wind Advisory");
  });
  test("severity and event drive the level", () => {
    expect(alertLevel(buildSimAlert(entry({ event: "Tornado Warning", severity: "Extreme" }), pt))).toBe("WARNING");
    expect(alertLevel(buildSimAlert(entry({ event: "Wind Advisory", severity: "Minor" }), pt))).not.toBe("EMERGENCY");
    expect(alertLevel(buildSimAlert(entry({ event: "Tornado Warning", severity: "Extreme", tornadoObserved: true }), pt))).toBe("EMERGENCY");
  });
});
