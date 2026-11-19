// @vitest-environment happy-dom
import { render } from "preact";
import { describe, expect, test } from "vitest";
import { AREA_LIMITS, normalizeAreaShape, normalizeBody, normalizeProducts, type AreaMap, type StudioProduct } from "../shared/studio";
import { ProductView } from "../src/studio/ProductView";
import { labelSpot } from "../src/studio/views/AreaMap";

const ring = [[-75.2, 39.5], [-74.6, 39.5], [-74.6, 40.1], [-75.2, 40.1]];
const shape = { ring, fill: "#7B4BC4", fillOpacity: 0.55, stroke: "#ffffff", line: "dashed", label: "Coastal flooding", labelAt: "right", note: "High tide" };
const base = {
  id: "a1", kind: "areaMap", title: "Affected Area", validFrom: "2026-11-17T08:00:00Z", validTo: "2026-11-18T08:00:00Z",
  region: { south: 38.4, west: -76.4, north: 41.4, east: -73.8 }, published: true, author: "forecaster",
};
const body = (b: unknown) => normalizeBody("areaMap", b) as AreaMap;

describe("areaMap normalizing", () => {
  test("keeps a good shape and lower-cases its colours", () => {
    const s = normalizeAreaShape(shape)!;
    expect(s).toMatchObject({ fill: "#7b4bc4", fillOpacity: 0.55, stroke: "#ffffff", line: "dashed", labelAt: "right", label: "Coastal flooding" });
    expect(s.ring).toHaveLength(4);
  });

  test("drops the repeated closing corner", () => {
    expect(normalizeAreaShape({ ...shape, ring: [...ring, ring[0]] })!.ring).toHaveLength(4);
  });

  test("rejects bad shapes", () => {
    expect(normalizeAreaShape(null)).toBeNull();
    expect(normalizeAreaShape({ ...shape, ring: "nope" })).toBeNull();
    expect(normalizeAreaShape({ ...shape, ring: ring.slice(0, 2) })).toBeNull();
    expect(normalizeAreaShape({ ...shape, ring: [...ring.slice(0, 3), ["x", 40]] })).toBeNull();
    expect(normalizeAreaShape({ ...shape, ring: [...ring.slice(0, 3), [-75, 95]] })).toBeNull();
    expect(normalizeAreaShape({ ...shape, ring: [...ring.slice(0, 3), [Infinity, 40]] })).toBeNull();
    // three corners that repeat the first one leave only two
    expect(normalizeAreaShape({ ...shape, ring: [ring[0], ring[1], ring[0]] })).toBeNull();
  });

  test("rejects a shape with too many points", () => {
    const many = Array.from({ length: AREA_LIMITS.points + 1 }, (_, i) => [-75 + Math.cos(i / 10) * 0.3, 40 + Math.sin(i / 10) * 0.3]);
    expect(normalizeAreaShape({ ...shape, ring: many })).toBeNull();
    expect(normalizeAreaShape({ ...shape, ring: many.slice(0, AREA_LIMITS.points) })!.ring).toHaveLength(AREA_LIMITS.points);
  });

  test("bad style values fall back to defaults and opacity is clamped", () => {
    const s = normalizeAreaShape({ ring, fill: "purple", stroke: "#fff", fillOpacity: 7, line: "dotted", labelAt: "nowhere" })!;
    expect(s).toMatchObject({ fill: "#7b4bc4", stroke: "#ffffff", fillOpacity: 1, line: "dashed", labelAt: "inside", label: "", note: "" });
    expect(normalizeAreaShape({ ring, fillOpacity: -2 })!.fillOpacity).toBe(0);
  });

  test("over-long text is clamped", () => {
    const long = "x".repeat(1000);
    const s = normalizeAreaShape({ ...shape, label: long, note: long })!;
    expect(s.label).toHaveLength(AREA_LIMITS.label);
    expect(s.note).toHaveLength(AREA_LIMITS.note);
    const b = body({ caption: long, shapes: [], markers: [{ lon: -75, lat: 40, icon: "star", text: long }] });
    expect(b.caption).toHaveLength(AREA_LIMITS.caption);
    expect(b.markers[0]!.text).toHaveLength(AREA_LIMITS.marker);
  });

  test("caps the number of shapes and markers, and drops bad markers", () => {
    const b = body({
      shapes: [...Array.from({ length: AREA_LIMITS.shapes + 5 }, () => shape), { ring: [] }],
      markers: [
        ...Array.from({ length: AREA_LIMITS.markers + 3 }, (_, i) => ({ lon: -75, lat: 40, icon: "dot", text: `m${i}` })),
      ],
    });
    expect(b.shapes).toHaveLength(AREA_LIMITS.shapes);
    expect(b.markers).toHaveLength(AREA_LIMITS.markers);
    const m = body({ markers: [{ lon: "x", lat: 40 }, { lon: -75, lat: 40, icon: "none", text: "  " }, { lon: -75, lat: 40, icon: "bogus", text: "Trenton" }] }).markers;
    expect(m).toEqual([{ lon: -75, lat: 40, icon: "star", text: "Trenton" }]);
  });

  test("a bad shape is dropped but the product survives; a junk body drops the product", () => {
    const list = normalizeProducts([
      { ...base, body: { caption: "Hi", shapes: [shape, { ring: [[0, 0]] }], markers: [] } },
      { ...base, id: "a2", body: "junk" },
    ]);
    expect(list.map((p) => p.id)).toEqual(["a1"]);
    expect((list[0]!.body as AreaMap).shapes).toHaveLength(1);
  });
});

test("labels sit inside or beside the shape", () => {
  const pts: [number, number][] = [[100, 100], [300, 100], [300, 200], [100, 200]];
  expect(labelSpot(pts, "inside")).toMatchObject({ x: 200, anchor: "middle" });
  expect(labelSpot(pts, "right")).toMatchObject({ x: 316, anchor: "start" });
  expect(labelSpot(pts, "left")).toMatchObject({ x: 84, anchor: "end" });
  expect(labelSpot(pts, "above").y).toBeLessThan(100);
  expect(labelSpot(pts, "below").y).toBeGreaterThan(200);
});

test("renders shapes, labels, markers and caption in both sizes, never as an NWS product", () => {
  const p = normalizeProducts([{ ...base, body: { caption: "Flooding at high tide.", shapes: [shape], markers: [{ lon: -75.16, lat: 39.95, icon: "star", text: "Philadelphia" }] } }])[0] as StudioProduct;
  const host = document.createElement("div");
  for (const fmt of ["wide", "portrait"] as const) {
    render(<ProductView product={p} fmt={fmt} forecaster="Eva" />, host);
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe(fmt === "wide" ? "0 0 1920 1080" : "0 0 1080 1350");
    for (const t of ["Affected Area", "Coastal flooding", "Philadelphia", "Flooding at high tide.", "High tide", "not an official NWS product"]) expect(svg.textContent).toContain(t);
    expect(svg.querySelector('path[stroke-dasharray][fill="#7b4bc4"]')).not.toBeNull();
  }
  render(null, host);
});
