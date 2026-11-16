import type { LiveRegion } from "../config";
import type { Alert, Bbox, PolygonGeom } from "../types";

/** Bounding box of a Polygon/MultiPolygon. */
export function geomBbox(g: PolygonGeom): Bbox | null {
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      west = Math.min(west, c[0]);
      east = Math.max(east, c[0]);
      south = Math.min(south, c[1]);
      north = Math.max(north, c[1]);
      return;
    }
    c.forEach(walk);
  };
  walk(g.coordinates);
  return Number.isFinite(south) ? { south, west, north, east } : null;
}

export const bboxOverlap = (a: Bbox, b: Bbox): boolean =>
  a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;

/**
 * An alert is "in region" if the region's office issued it, or its polygon overlaps the
 * region box (so a neighbouring office's warning near the edge still counts).
 */
export function alertInRegion(a: Alert, region: LiveRegion): boolean {
  if (a.senderName && region.senderMatch && a.senderName.toLowerCase().includes(region.senderMatch.toLowerCase())) return true;
  if (a.geometry) {
    const b = geomBbox(a.geometry);
    return b ? bboxOverlap(b, region.bbox) : false;
  }
  return false;
}

export function regionAlerts(alerts: Alert[], region: LiveRegion, now = Date.now()): Alert[] {
  return alerts
    .filter((a) => !a.expires || Date.parse(a.expires) > now)
    .filter((a) => alertInRegion(a, region));
}
