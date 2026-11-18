import { describe, expect, test } from "vitest";
import { DEFAULT_LIVE, normalizeConfig } from "../shared/config";
import { activeControl, DEFAULT_PLAYLIST, EMPTY_CONTROL, normalizeBulletin, normalizePlaylist, type LiveControl, type RegionWx } from "../shared/live/blocks";
import { blockText, weekendDays } from "../shared/live/blocktext";
import { computeIntensity } from "../shared/live/intensity";
import { buildRundown, type CityWx } from "../shared/live/rundown";
import { moodFor, outfitFor, parseHostPreview, quipFor } from "../src/live/host/personality";
import { dropPlayed } from "../src/live/player";
import type { Alert, SpcCategory } from "../shared/types";

const NOW = Date.parse("2026-11-17T18:00:00Z");
const iso = (min: number) => new Date(NOW + min * 60_000).toISOString();

let seq = 0;
const mk = (event: string): Alert => ({
  id: `a${seq++}`, event, senderName: "NWS Mount Holly NJ", severity: "Severe", urgency: "Immediate", certainty: "Likely",
  headline: `${event} issued`, description: "d", instruction: "i", sent: iso(-30), onset: null, expires: iso(45), areaDesc: "Bucks, PA", zones: [], geometry: null, params: {},
});

const wx: RegionWx = {
  at: iso(0),
  cities: DEFAULT_LIVE.region.cities.slice(0, 5).map((c, i) => ({
    ...c,
    now: { temp: 40 + i * 3, feels: 35 + i * 3, rh: 60, dew: 30 + i * 5, wind: 8 + i, gust: 12 + i * 4, dir: 270, code: 0, isDay: true },
    daily: Array.from({ length: 7 }, (_, d) => ({ date: `2026-11-${String(17 + d).padStart(2, "0")}`, hi: 50 + i + d, lo: 30 + i, pop: 10 * d, code: 2 })),
    hourly: Array.from({ length: 24 }, (_, h) => ({ time: `2026-11-17T${String(h).padStart(2, "0")}:00`, temp: 40 + h / 2, pop: h * 2, code: 3 })),
    sunrise: "2026-11-17T06:52", sunset: "2026-11-17T16:43", uv: 2,
  })),
};
const cities: CityWx[] = wx.cities.map((c) => ({ name: c.name, state: c.state, lat: c.lat, lon: c.lon, temp: c.now.temp, desc: "Clear sky" }));

const run = (alerts: Alert[] = [], control: LiveControl | null = null, cfg = DEFAULT_LIVE, spc: SpcCategory = "NONE") =>
  buildRundown(computeIntensity({ alerts, spc, now: NOW }), { alerts, spc, cities, studio: [], cams: [], wx, control }, cfg, NOW);

describe("playlist", () => {
  test("normalizer keeps valid entries, drops junk, de-duplicates ids", () => {
    const l = normalizePlaylist([{ id: "x", block: "radar" }, { id: "x", block: "wind", seconds: 999 }, { block: "nope" }, 5]);
    expect(l.map((e) => e.block)).toEqual(["radar", "wind"]);
    expect(l[1]!.id).not.toBe("x");
    expect(l[1]!.seconds).toBe(180);
    expect(normalizePlaylist(undefined)).toBe(DEFAULT_PLAYLIST);
  });
  test("config round-trips the playlist", () => {
    const c = normalizeConfig({ live: { playlist: [{ id: "a", block: "message", title: "Hi", text: "Hello", speak: true }] } });
    expect(c.live.playlist).toEqual([{ id: "a", block: "message", on: true, title: "Hi", text: "Hello", speak: true }]);
  });
  test("calm rundown follows the playlist order and skips switched-off blocks", () => {
    const cfg = { ...DEFAULT_LIVE, playlist: [{ id: "1", block: "wind" as const, on: true }, { id: "2", block: "radar" as const, on: false }, { id: "3", block: "sevenDay" as const, on: true, city: "Trenton" }] };
    const r = run([], null, cfg);
    expect(r.items.map((i) => (i.kind === "block" ? i.block : i.kind))).toEqual(["wind", "sevenDay"]);
    expect(r.items[1]).toMatchObject({ city: "Trenton", headline: "7-DAY FORECAST: TRENTON" });
  });
  test("default playlist fills the calm rotation with many data blocks", () => {
    const kinds = new Set(run().items.map((i) => (i.kind === "block" ? i.block : i.kind)));
    for (const k of ["radar", "segment", "tempsNow", "sevenDay", "hourly", "highs", "rainChance", "wind", "extremes", "sun", "host", "ident"]) expect(kinds).toContain(k);
  });
  test("data blocks are skipped (not broken) when the weather data is missing", () => {
    const r = buildRundown(computeIntensity({ alerts: [], spc: "NONE", now: NOW }), { alerts: [], spc: "NONE", cities: [], studio: [], cams: [], wx: null }, DEFAULT_LIVE, NOW);
    expect(r.items.some((i) => i.kind === "block" && i.block === "tempsNow")).toBe(false);
    expect(r.items.length).toBeGreaterThan(0);
  });
});

describe("block wording", () => {
  test("deterministic headlines and spoken lines from the data", () => {
    expect(blockText("tempsNow", wx, undefined, "Philadelphia region")?.speak).toContain(`${wx.cities[4]!.name} is warmest at 52`);
    expect(blockText("sun", wx, "Philadelphia")?.speak).toMatch(/rises at 6:52 AM and sets at 4:43 PM/);
    expect(blockText("hourly", wx, "Philadelphia")?.headline).toBe("NEXT 12 HOURS: PHILADELPHIA");
    expect(blockText("wind", null)).toBeNull();
  });
  test("weekend finds Saturday and Sunday", () => {
    expect(weekendDays(wx.cities[0]!).map((i) => wx.cities[0]!.daily[i]!.date)).toEqual(["2026-11-21", "2026-11-22"]);
  });
});

describe("on-air control", () => {
  const ctl = (over: Partial<LiveControl>): LiveControl => ({ ...EMPTY_CONTROL, ...over });
  test("say goes first, spoken verbatim, with the source", () => {
    const r = run([], ctl({ say: { id: "s1", text: "Hello from the studio!", at: iso(0), source: "you" }, cmd: { id: "s1", kind: "top" } }));
    expect(r.items[0]).toMatchObject({ kind: "host", text: "Hello from the studio!", speak: "Hello from the studio!", source: "you" });
    expect(r.cmd).toEqual({ id: "s1", kind: "top" });
  });
  test("say and play-next items are marked one-shot so the page plays them once; nothing else is", () => {
    const r = run([], ctl({ say: { id: "s9", text: "Hi!", at: iso(0), source: "you" }, cue: { id: "c9", entry: { id: "c", block: "wind", on: true }, at: iso(0) } }));
    expect(r.items[0]).toMatchObject({ kind: "host", oneShot: "s9" });
    expect(r.items[1]).toMatchObject({ kind: "block", block: "wind", oneShot: "c9" });
    expect(r.items.slice(2).every((i) => i.oneShot === undefined)).toBe(true);
  });
  test("after two minutes a say is gone from rebuilt rundowns (a settings save cannot bring it back)", () => {
    const later = buildRundown(computeIntensity({ alerts: [], spc: "NONE", now: NOW + 3 * 60_000 }), { alerts: [], spc: "NONE", cities, studio: [], cams: [], wx, control: ctl({ say: { id: "s", text: "Hi!", at: iso(0), source: "you" } }) }, DEFAULT_LIVE, NOW + 3 * 60_000);
    expect(later.items.some((i) => i.oneShot)).toBe(false);
  });
  test("cue plays next; a hold replaces the rotation", () => {
    const cue = run([], ctl({ cue: { id: "c", entry: { id: "c", block: "extremes", on: true }, at: iso(0) } }));
    expect(cue.items[0]).toMatchObject({ kind: "block", block: "extremes" });
    const hold = run([], ctl({ hold: { entry: { id: "h", block: "wind", on: true }, until: iso(30) } }));
    expect(hold.items.every((i) => i.kind === "block" && i.block === "wind")).toBe(true);
    expect(hold.hold).toBe("Wind map");
  });
  test("a hold never hides an NWS warning", () => {
    const r = run([mk("Tornado Warning")], ctl({ hold: { entry: { id: "h", block: "wind", on: true }, until: iso(30) } }));
    expect(r.level).toBe("WARNING");
    expect(r.items[0]).toMatchObject({ kind: "alert" });
    expect(r.hold).toBeNull();
  });
  test("emergency ignores cues and bulletins but still lets the forecaster speak", () => {
    const pds = { ...mk("Tornado Warning"), headline: "PARTICULARLY DANGEROUS SITUATION" };
    const b = normalizeBulletin({ title: "Ice", body: "Roads icy" }, NOW)!;
    const r = run([pds], ctl({ cue: { id: "c", entry: { id: "c", block: "wind", on: true }, at: iso(0) }, bulletins: [b], say: { id: "s", text: "Stay with us.", at: iso(0), source: "you" } }));
    expect(r.level).toBe("EMERGENCY");
    expect(r.items.some((i) => i.kind === "block" || i.kind === "bulletin")).toBe(false);
    expect(r.items[0]).toMatchObject({ kind: "host", text: "Stay with us." });
  });
  test("bulletins lead, are labelled SHELLY, and repeat", () => {
    const b = normalizeBulletin({ level: "advisory", title: "Black ice", area: "Lehigh Valley", body: "Untreated roads will be icy.", speak: true }, NOW)!;
    const r = run([], ctl({ bulletins: [b] }));
    expect(r.items[0]).toMatchObject({ kind: "bulletin", headline: "SHELLY ADVISORY: BLACK ICE" });
    expect(r.items[0]!.speak).toMatch(/^A SHELLY advisory from the forecaster for Lehigh Valley\. Black ice\./);
    expect(r.items.filter((i) => i.kind === "bulletin").length).toBeGreaterThan(1);
    expect(r.bulletins).toHaveLength(1);
  });
  test("expired one-shots, holds and bulletins drop out", () => {
    const old = activeControl({
      ...EMPTY_CONTROL,
      cue: { id: "c", entry: { id: "c", block: "wind", on: true }, at: iso(-10) },
      say: { id: "s", text: "x", at: iso(-10), source: "you" },
      hold: { entry: { id: "h", block: "wind", on: true }, until: iso(-1) },
      bulletins: [{ ...normalizeBulletin({ title: "a", body: "b" }, NOW)!, until: iso(-1) }],
    }, NOW);
    expect(old).toMatchObject({ cue: null, say: null, hold: null, bulletins: [] });
  });
});

describe("mascot personality", () => {
  test("mood follows the threat level", () => {
    expect([moodFor("CALM"), moodFor("ELEVATED"), moodFor("WARNING"), moodFor("EMERGENCY")]).toEqual(["happy", "curious", "focused", "worried"]);
  });
  test("dresses for the weather, never during warnings", () => {
    expect(outfitFor({ temp: 80, code: 0, isDay: true }, 14, "CALM")).toBe("shades");
    expect(outfitFor({ temp: 30, code: 3, isDay: true }, 14, "CALM")).toBe("winter");
    expect(outfitFor({ temp: 55, code: 63, isDay: true }, 14, "CALM")).toBe("umbrella");
    expect(outfitFor({ temp: 55, code: 3, isDay: false }, 2, "CALM")).toBe("sleepy");
    expect(outfitFor({ temp: 55, code: 63, isDay: true }, 14, "WARNING")).toBe("none");
  });
  test("quips react to the screen and never to alerts", () => {
    expect(quipFor({ key: "k", kind: "segment", id: "now", city: DEFAULT_LIVE.region.cities[0]!, temp: 15, desc: "Clear", headline: "", durationSec: 5 }, "none")).toBe("Brrrr!");
    expect(quipFor({ key: "k", kind: "alert", alertId: "a", headline: "", durationSec: 5 }, "none")).toBeNull();
  });
});

describe("host filming preview", () => {
  test("reads outfit, mood and trick in any order", () => {
    expect(parseHostPreview("?host=winter,worried,wave")).toEqual({ outfit: "winter", mood: "worried", trick: "wave" });
    expect(parseHostPreview("?host=wave,shades")).toEqual({ outfit: "shades", trick: "wave" });
    expect(parseHostPreview("?host=sleepy")).toEqual({ outfit: "sleepy" });
  });
  test("ignores unknown words and a missing param", () => {
    expect(parseHostPreview("?host=tophat,,focused")).toEqual({ mood: "focused" });
    expect(parseHostPreview("?mode=broadcast")).toEqual({});
    expect(parseHostPreview("")).toEqual({});
  });
});

describe("page plays one-shots once", () => {
  test("a played say is dropped from every later rundown, e.g. the rebuild after a settings save", () => {
    const r = run([], { ...EMPTY_CONTROL, say: { id: "once", text: "Hello!", at: iso(0), source: "you" }, cmd: { id: "once", kind: "top" } });
    expect(dropPlayed(r, new Set()).items[0]?.oneShot).toBe("once");
    const after = dropPlayed(r, new Set(["once"]));
    expect(after.items.some((x) => x.oneShot === "once")).toBe(false);
    expect(after.items.length).toBe(r.items.length - 1);
  });
});
