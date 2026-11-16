// @vitest-environment happy-dom
import { render } from "preact";
import { expect, test } from "vitest";
import { DEFAULT_LIVE } from "../shared/config";
import { makeProjector } from "../shared/projection";
import { normalizeBody, normalizeProducts, type StudioProduct } from "../shared/studio";
import { ProductView } from "../src/studio/ProductView";
import { placeLabels } from "../src/studio/views/CityTemps";

const region = DEFAULT_LIVE.region.bbox;
const sq = { type: "Polygon" as const, coordinates: [[[-75.5, 40], [-74.9, 40], [-74.9, 40.5], [-75.5, 40.5], [-75.5, 40]]] };
const base = { id: "p", validFrom: "2026-11-17T08:00:00Z", validTo: "2026-11-18T08:00:00Z", region, published: true, author: "forecaster" as const, updated: "" };

test("projection round-trips and keeps north up", () => {
  const p = makeProjector(region, { x: 0, y: 0, w: 1000, h: 800 });
  const [x, y] = p.xy(-75, 40);
  const [lon, lat] = p.lonlat(x, y);
  expect(lon).toBeCloseTo(-75, 6);
  expect(lat).toBeCloseTo(40, 6);
  expect(p.xy(-75, 41)[1]).toBeLessThan(p.xy(-75, 39)[1]);
  expect(p.fit.w).toBeLessThanOrEqual(1000);
  expect(p.fit.h).toBeLessThanOrEqual(800);
});

test("normalizeBody rejects junk and coerces numbers", () => {
  expect(normalizeBody("riskMap", null)).toBeNull();
  expect((normalizeBody("riskMap", { areas: [{ level: "nope", geometry: sq }, { level: "high", hazard: "hail", geometry: { type: "Polygon", coordinates: [[["x"]]] } }, { level: "some", hazard: "wind", geometry: sq }] }) as { areas: unknown[] }).areas).toHaveLength(1);
  const sd = normalizeBody("sevenDay", { place: "P", days: [{ date: "2026-11-17", hi: "55.4", lo: 40, pop: 250, code: 3 }, { hi: 1 }] }) as { days: { hi: number; pop: number }[] };
  expect(sd.days).toHaveLength(1);
  expect(sd.days[0]).toMatchObject({ hi: 55, pop: 100 });
  expect((normalizeBody("cityTemps", { cities: [{ name: "A", lat: 40, lon: -75, value: "61" }, { name: "B", lat: "x" }] }) as { cities: unknown[] }).cities).toHaveLength(1);
});

test("normalizeProducts drops products whose body is unusable", () => {
  const ok = { ...base, kind: "riskMap", title: "t", body: { areas: [] } };
  expect(normalizeProducts([ok, { ...ok, id: "q", body: 5 }]).map((p) => p.id)).toEqual(["p"]);
});

test("labels in a crowded cluster get different positions", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ c: { name: String(i), lat: 40, lon: -75, value: 50 }, xy: [500 + i * 3, 400] as [number, number] }));
  const placed = placeLabels(items);
  expect(new Set(placed.map((p) => `${p.bx},${p.by}`)).size).toBe(5);
});

const host = document.createElement("div");
test.each([
  ["sevenDay", { place: "Philadelphia", days: [{ date: "2026-11-17", hi: 52, lo: 38, pop: 20, code: 61, edited: true, note: "Wet start" }] }, ["Philadelphia", "52°", "SHELLY FORECAST", "Wet start"]],
  ["cityTemps", { metric: "high", cities: [{ name: "Trenton", lat: 40.2, lon: -74.7, value: 61 }] }, ["Trenton", "61°", "Forecast by Eva"]],
  ["riskMap", { areas: [{ level: "moderate", hazard: "tornado", geometry: sq }] }, ["Moderate", "Tornadoes", "Risk level"]],
])("%s renders a self-contained SVG in both sizes", (kind, body, texts) => {
  const p = { ...base, kind, title: "Test graphic", body } as unknown as StudioProduct;
  for (const fmt of ["wide", "portrait"] as const) {
    render(<ProductView product={p} fmt={fmt} forecaster="Eva" />, host);
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe(fmt === "wide" ? "0 0 1920 1080" : "0 0 1080 1350");
    for (const t of texts as string[]) if (fmt === "wide" || t !== "Risk level") expect(svg.textContent).toContain(t);
    // PNG export needs literal colors: nothing may depend on CSS variables
    expect(svg.outerHTML).not.toContain("var(--");
    expect(svg.querySelectorAll("foreignObject")).toHaveLength(0);
  }
});
