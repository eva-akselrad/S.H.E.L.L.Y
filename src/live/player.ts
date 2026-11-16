import type { Rundown } from "../../shared/live/rundown";
import { isWarning } from "../../shared/live/rundown";

/**
 * Where to resume when a new rundown arrives.
 * - first load, or the threat level changed, or a brand-new warning appeared: start at the top
 * - otherwise keep playing the same item (matched by key, then headline), else keep the position
 */
export function pickIndex(prev: Rundown | null, prevIdx: number, next: Rundown): number {
  if (!prev || next.items.length === 0) return 0;
  if (prev.level !== next.level) return 0;
  const seen = new Set(prev.alerts.map((a) => a.id));
  if (next.alerts.some((a) => isWarning(a) && !seen.has(a.id))) return 0;
  const cur = prev.items[prevIdx];
  if (cur) {
    const byKey = next.items.findIndex((i) => i.key === cur.key);
    if (byKey >= 0) return byKey;
    const byHead = next.items.findIndex((i) => i.headline === cur.headline);
    if (byHead >= 0) return byHead;
  }
  return prevIdx % next.items.length;
}

/** Convert a lon/lat to 0..1 inside a bbox (y flipped), for the locator mini-map. */
export function project(lon: number, lat: number, b: { south: number; west: number; north: number; east: number }): { x: number; y: number } {
  return { x: (lon - b.west) / (b.east - b.west), y: 1 - (lat - b.south) / (b.north - b.south) };
}
