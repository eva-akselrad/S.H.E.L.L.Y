import { describe, expect, test } from "vitest";
import { contourBands, gridPoints, type Grid } from "../shared/contour";
import { buildTimeline, hourHazard, hourLabel } from "../shared/timeline";

const bbox = { south: 0, west: 0, north: 2, east: 10 };
const area = (g: { coordinates: unknown }): number => {
  let total = 0;
  for (const poly of g.coordinates as number[][][][]) {
    const ring = poly[0]!;
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) a += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
    total += Math.abs(a) / 2;
  }
  return total;
};
const full = 10 * 2;

/** value = longitude, so the region >= t is exactly the strip east of lon t */
function ramp(): Grid {
  const w = 11, h = 3;
  return { w, h, bbox, values: gridPoints(bbox, w, h).map((p) => p.lon) };
}

describe("contourBands", () => {
  test("a linear ramp gives the exact analytical area for each threshold", () => {
    const bands = contourBands(ramp(), [2, 5, 8]);
    expect(bands.map((b) => b.min)).toEqual([2, 5, 8]);
    expect(area(bands[0]!.geometry)).toBeCloseTo(full * 0.8, 3);
    expect(area(bands[1]!.geometry)).toBeCloseTo(full * 0.5, 3);
    expect(area(bands[2]!.geometry)).toBeCloseTo(full * 0.2, 3);
  });
  test("band ranges link to the next threshold; the last is open-ended", () => {
    const bands = contourBands(ramp(), [2, 5, 8]);
    expect(bands.map((b) => b.max)).toEqual([5, 8, null]);
  });
  test("nothing reaches the threshold: no bands; everything does: the whole region", () => {
    expect(contourBands(ramp(), [50])).toEqual([]);
    const all = contourBands(ramp(), [-1]);
    expect(area(all[0]!.geometry)).toBeCloseTo(full, 3);
  });
  test("a single hot spot yields a small closed shape around it", () => {
    const g: Grid = { w: 5, h: 5, bbox: { south: 0, west: 0, north: 4, east: 4 }, values: Array(25).fill(0) };
    g.values[12] = 10;
    const [b] = contourBands(g, [5]);
    const a = area(b!.geometry);
    expect(a).toBeGreaterThan(0.1);
    expect(a).toBeLessThan(2);
  });
  test("gridPoints runs north to south, west to east", () => {
    const p = gridPoints(bbox, 3, 2);
    expect(p[0]).toEqual({ lon: 0, lat: 2 });
    expect(p[2]).toEqual({ lon: 10, lat: 2 });
    expect(p[3]).toEqual({ lon: 0, lat: 0 });
  });
});

describe("timeline", () => {
  test("hazard rules", () => {
    expect(hourHazard(95, 0.2)).toEqual({ hazard: "wind", intensity: 2 });
    expect(hourHazard(75, 0.12)).toEqual({ hazard: "winter", intensity: 3 });
    expect(hourHazard(61, 0.35)).toEqual({ hazard: "flood", intensity: 3 });
    expect(hourHazard(3, 0)).toEqual({ hazard: "none", intensity: 0 });
  });
  test("collapses hours into blocks and keeps the worst hour", () => {
    const time = Array.from({ length: 12 }, (_, i) => `2026-11-17T${String(i).padStart(2, "0")}:00`);
    const code = time.map((_, i) => (i === 4 ? 95 : 3));
    const precip = time.map((_, i) => (i === 7 ? 0.4 : 0));
    const tl = buildTimeline([{ name: "Philadelphia", time, code, precip }], "2026-11-17T03:00", 6, 3);
    expect(tl.rows[0]!.blocks.map((b) => `${b.hazard}${b.intensity}`)).toEqual(["wind2", "flood3"]);
    expect(tl.rows[0]!.blocks[0]!.hour).toBe("2026-11-17T03:00");
  });
  test("hour labels", () => {
    expect(hourLabel("2026-11-17T00:00")).toBe("12a");
    expect(hourLabel("2026-11-17T15:00")).toBe("3p");
  });
});
