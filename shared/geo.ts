import type { PolygonGeom, Ring } from "./types";

export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Point in Polygon/MultiPolygon, honouring holes. */
export function pointInGeometry(lon: number, lat: number, g: PolygonGeom): boolean {
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as unknown as Ring[][];
  return polys.some((rings) => {
    const [outer, ...holes] = rings;
    if (!outer || !pointInRing(lon, lat, outer)) return false;
    return !holes.some((h) => pointInRing(lon, lat, h));
  });
}

export function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
