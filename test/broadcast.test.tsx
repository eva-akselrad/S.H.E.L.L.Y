// @vitest-environment happy-dom
import { render } from "preact";
import { afterEach, expect, test, vi } from "vitest";
import { DEFAULT_LIVE } from "../shared/config";
import { computeIntensity } from "../shared/live/intensity";
import { buildRundown, type Rundown } from "../shared/live/rundown";
import type { Alert } from "../shared/types";
import { pickIndex, project } from "../src/live/player";
import { index, rundown } from "../src/live/state";

vi.mock("../src/live/LiveRadar", () => ({ LiveRadar: () => <div class="radar-stub" /> }));
vi.mock("../src/music", () => ({ applyThreatToMusic: () => {}, configureMusic: () => {}, setDucked: () => {}, startMusic: async () => {} }));
vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 404 })));

const NOW = Date.parse("2026-11-16T18:00:00Z");
const iso = (m: number) => new Date(NOW + m * 60_000).toISOString();
let n = 0;
const alert = (event: string, over: Partial<Alert> = {}): Alert => ({
  id: `b${n++}`, event, senderName: "NWS Mount Holly NJ", severity: "Severe", urgency: "Immediate", certainty: "Likely", headline: event,
  description: "Take cover.", instruction: "Move indoors now.", sent: iso(-20), onset: null, expires: iso(40), areaDesc: "Bucks, PA", zones: [], geometry: null, params: {}, ...over,
});
const make = (alerts: Alert[], spc: "NONE" | "ENH" = "NONE"): Rundown => {
  const cities = DEFAULT_LIVE.region.cities.slice(0, 6).map((c) => ({ ...c, temp: 51, desc: "Cloudy" }));
  return buildRundown(computeIntensity({ alerts, spc, now: NOW }), { alerts, spc, cities, studio: [], cams: [] }, DEFAULT_LIVE, NOW);
};

const host = document.createElement("div");
document.body.append(host);
afterEach(() => {
  render(null, host);
  rundown.value = null;
  index.value = 0;
});

async function show(r: Rundown, at: number): Promise<string> {
  const { MainPanel, AlertCounters, LowerThird, HeadlineBar, IntensityGauge, Crawl, RightRail } = await import("../src/live/Panels");
  rundown.value = r;
  index.value = at;
  render(
    <div>
      <AlertCounters r={r} /><HeadlineBar r={r} /><IntensityGauge r={r} />
      <MainPanel r={r} region={DEFAULT_LIVE.region} /><RightRail r={r} region={DEFAULT_LIVE.region} /><LowerThird r={r} /><Crawl r={r} />
    </div>,
    host,
  );
  return host.textContent ?? "";
}

test("calm: city card, counters at zero, no-alert lower third", async () => {
  const r = make([]);
  const at = r.items.findIndex((i) => i.kind === "segment");
  const text = await show(r, at);
  expect(text).toContain("51°");
  expect(text).toContain("NO ACTIVE WARNINGS IN THE PHILADELPHIA REGION");
  expect(host.querySelector(".bc-crawl")).toBeNull();
  expect(host.querySelectorAll(".bc-count.on")).toHaveLength(0);
});

test("radar and outlook items render", async () => {
  const r = make([], "ENH");
  expect(await show(r, r.items.findIndex((i) => i.kind === "radar"))).toBeDefined();
  expect(host.querySelector(".radar-stub")).not.toBeNull();
  expect(await show(r, r.items.findIndex((i) => i.kind === "outlook"))).toContain("Enhanced risk");
});

test("warning: alert card shows the NWS instruction, counters light up and the crawl appears", async () => {
  const r = make([alert("Tornado Warning")]);
  const text = await show(r, 0);
  expect(text).toContain("Tornado Warning");
  expect(text).toContain("Move indoors now.");
  expect(host.querySelector(".bc-count.tor.on")).not.toBeNull();
  expect(host.querySelector(".bc-crawl")).not.toBeNull();
  expect(host.querySelector(".host-serious")).not.toBeNull();
});

test("emergency styles the card as an emergency", async () => {
  const r = make([alert("Tornado Warning", { headline: "PARTICULARLY DANGEROUS SITUATION" })]);
  await show(r, 0);
  expect(host.querySelector(".bc-alert.emergency")).not.toBeNull();
});

test("host talk break renders the text", async () => {
  const r = make([]);
  const text = await show(r, r.items.findIndex((i) => i.kind === "host"));
  expect(text).toContain("SHELLY");
});

test("headline bar prefers AI headlines in calm but never during a warning", async () => {
  const calm = { ...make([]), headlines: ["Mild afternoon in Philly", "Quiet night ahead", "Cool morning"] };
  await show(calm, 0);
  expect(host.querySelector(".bc-headline-text")?.textContent?.toLowerCase()).toMatch(/mild afternoon|quiet night|cool morning/);
  const warn = { ...make([alert("Tornado Warning")]), headlines: ["Mild afternoon in Philly", "a", "b"] };
  await show(warn, 0);
  expect(host.querySelector(".bc-headline-text")?.textContent).toContain("TORNADO WARNING");
});

test("pickIndex: starts at the top on level change or a new warning, otherwise keeps place", () => {
  const calm = make([]);
  expect(pickIndex(null, 3, calm)).toBe(0);
  expect(pickIndex(calm, 2, calm)).toBe(2);
  expect(pickIndex(calm, 2, make([alert("Tornado Warning")]))).toBe(0);
  const w1 = make([alert("Tornado Warning")]);
  const w2 = make([...w1.alerts, alert("Tornado Warning")]);
  expect(pickIndex(w1, 3, w2)).toBe(0);
  expect(pickIndex(w1, 3, w1)).toBe(3);
});

test("project maps lon/lat into the unit square with north up", () => {
  const b = { south: 38, west: -77, north: 42, east: -73 };
  expect(project(-77, 42, b)).toEqual({ x: 0, y: 0 });
  expect(project(-73, 38, b)).toEqual({ x: 1, y: 1 });
});
