import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, noteActive, normalizeConfig } from "../shared/config";
import { buildLoop, type SegmentCtx } from "../shared/scheduler";
import { buildSimAlert, SIM_PRESETS, type SimPreset } from "../shared/simulate";
import { computeThreat } from "../shared/threat";

describe("normalizeConfig", () => {
  test("garbage input yields defaults", () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig("nope")).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig([1, 2])).toEqual(DEFAULT_CONFIG);
  });

  test("clamps durations and volume, drops unknown keys", () => {
    const c = normalizeConfig({
      segmentSeconds: { radar: 9999, daily: 1, bogus: 20, hourly: "30" },
      music: { volume: 7 },
      defaultMode: "hologram",
      hiddenSegments: ["now", "air", "nope"],
    });
    expect(c.segmentSeconds).toEqual({ radar: 120, daily: 5, hourly: 30 });
    expect(c.music.volume).toBe(1);
    expect(c.defaultMode).toBe("auto");
    expect(c.hiddenSegments).toEqual(["air"]); // "now" can never be hidden
  });

  test("rejects a non-US default location and keeps a valid one", () => {
    expect(normalizeConfig({ defaultLocation: { lat: 51.5, lon: -0.12, name: "London" } }).defaultLocation).toBeNull();
    const c = normalizeConfig({ defaultLocation: { lat: 31.5, lon: -97.1, name: "Waco", state: "TX" } });
    expect(c.defaultLocation?.name).toBe("Waco");
    expect(c.defaultLocation?.state).toBe("TX");
  });

  test("trims overlong text and bad dates", () => {
    const c = normalizeConfig({ note: { enabled: true, title: "x".repeat(500), body: "y".repeat(5000), expires: "not a date" } });
    expect(c.note.title).toHaveLength(80);
    expect(c.note.body).toHaveLength(1500);
    expect(c.note.expires).toBeNull();
  });

  test("tts defaults on and turns off only when false", () => {
    expect(normalizeConfig({}).tts).toBe(true);
    expect(normalizeConfig({ tts: false }).tts).toBe(false);
  });
});

describe("forecaster note", () => {
  const base = normalizeConfig({ note: { enabled: true, body: "hello" } });
  test("active when enabled with text", () => expect(noteActive(base)).toBe(true));
  test("inactive when disabled, empty or expired", () => {
    expect(noteActive({ ...base, note: { ...base.note, enabled: false } })).toBe(false);
    expect(noteActive({ ...base, note: { ...base.note, body: "  " } })).toBe(false);
    expect(noteActive({ ...base, note: { ...base.note, expires: "2020-01-01T00:00:00Z" } })).toBe(false);
  });
});

describe("simulated alerts drive the real threat engine", () => {
  const point = { lat: 40.2, lon: -75.0, zones: ["PAZ106"] };
  const level = (p: SimPreset) => {
    const entry = { id: "sim-1", preset: p, created: new Date().toISOString(), expires: new Date(Date.now() + 60_000).toISOString() };
    return computeThreat({ alerts: [buildSimAlert(entry, point)], point }).level;
  };
  test("each preset lands on its intended level", () => {
    expect(level("tornado-emergency")).toBe("EMERGENCY");
    expect(level("tornado-warning")).toBe("WARNING");
    expect(level("severe-thunderstorm-warning")).toBe("WARNING");
    expect(level("flash-flood-warning")).toBe("WARNING");
    expect(level("winter-storm-warning")).toBe("WARNING");
    expect(level("tornado-watch")).toBe("ELEVATED");
    expect(level("heat-advisory")).toBe("ELEVATED");
  });
  test("every preset is clearly labelled as a test", () => {
    for (const p of Object.keys(SIM_PRESETS) as SimPreset[]) {
      const a = buildSimAlert({ id: "s", preset: p, created: "", expires: "" }, point);
      expect(a.headline.startsWith("TEST:")).toBe(true);
      expect(a.description).toContain("THIS IS A TEST");
    }
  });
});

describe("scheduler options", () => {
  const ctx = (over: Partial<SegmentCtx>): SegmentCtx => ({ forecast: null, aq: null, outlook: null, level: "CALM", ...over });
  test("hidden segments are removed but now stays", () => {
    const ids = buildLoop(ctx({ hidden: ["now", "radar", "daily"] })).map((i) => i.id);
    expect(ids).toContain("now");
    expect(ids).not.toContain("radar");
    expect(ids).not.toContain("daily");
  });
  test("custom seconds apply and respect the 5s floor", () => {
    const loop = buildLoop(ctx({ seconds: { now: 40, daily: 6 } }));
    expect(loop.find((i) => i.id === "now")?.seconds).toBe(40);
    expect(loop.find((i) => i.id === "daily")?.seconds).toBe(6);
  });
  test("the note segment only appears when active, even in a warning loop", () => {
    expect(buildLoop(ctx({})).some((i) => i.id === "note")).toBe(false);
    expect(buildLoop(ctx({ note: true })).some((i) => i.id === "note")).toBe(true);
    expect(buildLoop(ctx({ note: true, level: "WARNING" })).some((i) => i.id === "note")).toBe(true);
  });
  test("a hidden radar stays out of an elevated loop", () => {
    const ids = buildLoop(ctx({ level: "ELEVATED", hidden: ["radar"] })).map((i) => i.id);
    expect(ids).not.toContain("radar");
  });
});
