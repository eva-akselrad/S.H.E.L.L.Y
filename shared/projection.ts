import type { Bbox, PolygonGeom } from "./types";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Projector {
  /** lon/lat to pixel */
  xy(lon: number, lat: number): [number, number];
  /** pixel back to lon/lat */
  lonlat(x: number, y: number): [number, number];
  /** the pixel box the bbox actually occupies (aspect preserved, centred in `box`) */
  fit: Box;
}

/**
 * Equirectangular projection with a cos(latitude) correction, fitted inside `box`
 * with the aspect ratio preserved. Plenty accurate at region scale.
 */
export function makeProjector(bbox: Bbox, box: Box): Projector {
  const k = Math.cos((((bbox.south + bbox.north) / 2) * Math.PI) / 180);
  const spanX = (bbox.east - bbox.west) * k;
  const spanY = bbox.north - bbox.south;
  const s = Math.min(box.w / spanX, box.h / spanY);
  const w = spanX * s;
  const h = spanY * s;
  const ox = box.x + (box.w - w) / 2;
  const oy = box.y + (box.h - h) / 2;
  return {
    xy: (lon, lat) => [ox + (lon - bbox.west) * k * s, oy + (bbox.north - lat) * s],
    lonlat: (x, y) => [bbox.west + (x - ox) / (k * s), bbox.north - (y - oy) / s],
    fit: { x: ox, y: oy, w, h },
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** SVG path for a list of rings given as [lon, lat] pairs. */
export function ringsPath(rings: number[][][], p: Projector): string {
  return rings
    .map((ring) => ring.map(([lon, lat], i) => `${i ? "L" : "M"}${r1(p.xy(lon!, lat!)[0])} ${r1(p.xy(lon!, lat!)[1])}`).join("") + "Z")
    .join("");
}

/** SVG path for a Polygon or MultiPolygon. */
export function geomPath(g: PolygonGeom, p: Projector): string {
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as unknown as number[][][][];
  return polys.map((rings) => ringsPath(rings, p)).join("");
}

/** Decode a flat [lon*1000, lat*1000, ...] ring from the bundled basemap. */
export function decodeRing(flat: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]! / 1000, flat[i + 1]! / 1000]);
  return out;
}

/** Point-in-bbox test. */
export const inBbox = (lon: number, lat: number, b: Bbox): boolean => lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
