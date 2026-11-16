// Filled contour bands from a regular lon/lat grid (marching squares, one clipped polygon per cell).
import type { Bbox, PolygonGeom } from "./types";

export interface Grid {
  w: number; // points across (west to east)
  h: number; // points down (north to south)
  /** row-major, row 0 is the northern edge */
  values: number[];
  bbox: Bbox;
}

export interface Band {
  min: number;
  max: number | null;
  geometry: PolygonGeom;
}

type Pt = [number, number];

/** Sample points for the grid: row-major, north row first. */
export function gridPoints(bbox: Bbox, w: number, h: number): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      out.push({ lon: bbox.west + ((bbox.east - bbox.west) * i) / (w - 1), lat: bbox.north - ((bbox.north - bbox.south) * j) / (h - 1) });
    }
  }
  return out;
}

/** The part of one grid cell where value >= t, as a polygon (or null if none). */
function cellPolygon(c: [Pt, number][], t: number): Pt[] | null {
  const poly: Pt[] = [];
  for (let k = 0; k < 4; k++) {
    const [a, va] = c[k]!;
    const [b, vb] = c[(k + 1) % 4]!;
    if (va >= t) poly.push(a);
    if (va >= t !== vb >= t) {
      const f = (t - va) / (vb - va);
      poly.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
  }
  return poly.length >= 3 ? poly : null;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Bands for ascending `thresholds`. Band k is every place where value >= thresholds[k];
 * paint them in order so higher bands cover lower ones. Returns [] if nothing reaches the first.
 */
export function contourBands(grid: Grid, thresholds: number[]): Band[] {
  const { w, h, values, bbox } = grid;
  const dx = (bbox.east - bbox.west) / (w - 1);
  const dy = (bbox.north - bbox.south) / (h - 1);
  const bands: Band[] = [];
  thresholds.forEach((t, k) => {
    const polys: number[][][][] = [];
    for (let j = 0; j < h - 1; j++) {
      for (let i = 0; i < w - 1; i++) {
        const x0 = bbox.west + i * dx;
        const y0 = bbox.north - j * dy;
        const cell: [Pt, number][] = [
          [[x0, y0], values[j * w + i]!],
          [[x0 + dx, y0], values[j * w + i + 1]!],
          [[x0 + dx, y0 - dy], values[(j + 1) * w + i + 1]!],
          [[x0, y0 - dy], values[(j + 1) * w + i]!],
        ];
        const p = cellPolygon(cell, t);
        if (p) polys.push([[...p, p[0]!].map(([x, y]) => [r4(x), r4(y)])]);
      }
    }
    if (polys.length) bands.push({ min: t, max: thresholds[k + 1] ?? null, geometry: { type: "MultiPolygon", coordinates: polys } });
  });
  return bands;
}

/** Thresholds and colors for the two total types, in inches. */
export const TOTAL_SCALES = {
  snow: { thresholds: [0.1, 1, 3, 6, 12, 18], colors: ["#bfe3ff", "#7fc2ff", "#3d8bff", "#6a5cff", "#b04dff", "#ff4dc8"], unit: "in" },
  rain: { thresholds: [0.05, 0.25, 0.5, 1, 2, 3], colors: ["#b5f0c4", "#6fe08a", "#2fbf71", "#1fa0a8", "#3d8bff", "#6a5cff"], unit: "in" },
} as const;

export const bandLabel = (b: { min: number; max: number | null }): string => (b.max === null ? `${b.min}"+` : `${b.min} to ${b.max}"`);
