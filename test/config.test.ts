import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, noteActive, normalizeConfig } from "../shared/config";
import { MAX_STUDIO_PRODUCTS, normalizeProducts, productActive } from "../shared/studio";
import { normalizeAlert } from "../worker/sources/nws";
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

describe("live + studio config (L0)", () => {
  test("an old config with no live/studio keys loads with the Philly defaults", () => {
    const c = normalizeConfig({ tts: false, music: { volume: 0.5 } });
    expect(c.live).toEqual(DEFAULT_CONFIG.live);
    expect(c.live.region.office).toBe("PHI");
    expect(c.live.enabled).toBe(false);
    expect(c.studio.forecasterName).toBe("");
  });

  test("a normalized config round-trips unchanged", () => {
    const c = normalizeConfig({
      live: { enabled: true, viewerToken: "abcdefghijklmnop1234", host: { tone: 0.9, bannedTopics: ["x"] }, llm: { enabled: true, models: ["a:free"] } },
      studio: { forecasterName: "Eva" },
    });
    expect(normalizeConfig(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(c.live.llm.models).toEqual(["a:free"]);
  });

  test("clamps and rejects bad live values", () => {
    const c = normalizeConfig({
      live: {
        viewerToken: "short",
        region: { office: "philly", bbox: { south: 50, north: 40, west: -76, east: -74 }, cities: [{ name: "Paris", lat: 48, lon: 2 }, { name: "Trenton", state: "nj", lat: 40.2, lon: -74.7 }] },
        llm: { baseUrl: "javascript:alert(1)", dailyRequestCap: 99999, temperature: 9, provider: "x" },
        host: { tone: 5 },
        itemSeconds: { radar: 1, cam: 9999, "bad key": 20 },
      },
    });
    expect(c.live.viewerToken).toBe("");
    expect(c.live.region.office).toBe("PHI");
    expect(c.live.region.bbox).toEqual(DEFAULT_CONFIG.live.region.bbox);
    expect(c.live.region.cities).toEqual([{ name: "Trenton", state: "NJ", lat: 40.2, lon: -74.7 }]);
    expect(c.live.llm.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(c.live.llm.dailyRequestCap).toBe(5000);
    expect(c.live.llm.temperature).toBe(1.5);
    expect(c.live.llm.provider).toBe("openrouter");
    expect(c.live.host.tone).toBe(1);
    expect(c.live.itemSeconds).toEqual({ radar: 5, cam: 180 });
  });
});

describe("studio products", () => {
  const ok = { id: "p1", kind: "sevenDay", title: "t", validFrom: "2026-11-16T00:00:00Z", validTo: "2026-11-23T00:00:00Z", published: true, body: { overrides: [] } };
  test("drops malformed entries and fills the region", () => {
    const list = normalizeProducts([ok, { ...ok, id: "" }, { ...ok, id: "p2", kind: "bogus" }, { ...ok, id: "p3", validTo: "nope" }, null, "x"]);
    expect(list.map((p) => p.id)).toEqual(["p1"]);
    expect(list[0]?.region.north).toBe(41.4);
    expect(list[0]?.author).toBe("forecaster");
  });
  test("caps the list and tolerates non-arrays", () => {
    expect(normalizeProducts({})).toEqual([]);
    const many = Array.from({ length: 80 }, (_, i) => ({ ...ok, id: `p${i}` }));
    expect(normalizeProducts(many)).toHaveLength(MAX_STUDIO_PRODUCTS);
  });
  test("productActive needs published and inside the valid window", () => {
    const p = normalizeProducts([ok])[0]!;
    expect(productActive(p, Date.parse("2026-11-17T00:00:00Z"))).toBe(true);
    expect(productActive(p, Date.parse("2026-12-01T00:00:00Z"))).toBe(false);
    expect(productActive({ ...p, published: false }, Date.parse("2026-11-17T00:00:00Z"))).toBe(false);
  });
});

describe("NWS alert fields", () => {
  test("normalizeAlert keeps senderName and eventMotionDescription", () => {
    const a = normalizeAlert({
      geometry: null,
      properties: { id: "x", event: "Tornado Warning", senderName: "NWS Mount Holly NJ", parameters: { eventMotionDescription: ["2026-11-16T18:00:00-00:00...storm...245DEG...35KT...39.9,-75.2"] } },
    });
    expect(a.senderName).toBe("NWS Mount Holly NJ");
    expect(a.params.eventMotionDescription).toContain("245DEG");
    expect(normalizeAlert({ geometry: null, properties: { id: "y" } }).senderName).toBeUndefined();
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
