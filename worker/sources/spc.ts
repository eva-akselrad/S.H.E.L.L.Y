import { pointInGeometry } from "../../shared/geo";
import type { Outlook, PolygonGeom, SpcCategory } from "../../shared/types";

const ORDER: SpcCategory[] = ["NONE", "TSTM", "MRGL", "SLGT", "ENH", "MDT", "HIGH"];
export const SPC_LABELS: Record<SpcCategory, string> = {
  NONE: "No risk",
  TSTM: "General thunder",
  MRGL: "Marginal",
  SLGT: "Slight",
  ENH: "Enhanced",
  MDT: "Moderate",
  HIGH: "High",
};

export interface SpcCollection {
  features?: { properties?: { LABEL?: string }; geometry?: PolygonGeom | null }[];
}

export function riskAtPoint(fc: SpcCollection | null, lat: number, lon: number): SpcCategory {
  let max = 0;
  for (const f of fc?.features ?? []) {
    const label = f.properties?.LABEL as SpcCategory | undefined;
    const idx = label ? ORDER.indexOf(label) : -1;
    if (idx <= max || !f.geometry) continue;
    if (pointInGeometry(lon, lat, f.geometry)) max = idx;
  }
  return ORDER[max]!;
}

export async function fetchDay(day: 1 | 2 | 3): Promise<SpcCollection | null> {
  try {
    const res = await fetch(`https://www.spc.noaa.gov/products/outlook/day${day}otlk_cat.nolyr.geojson`);
    return res.ok ? ((await res.json()) as SpcCollection) : null;
  } catch {
    return null;
  }
}

export async function fetchOutlook(lat: number, lon: number): Promise<Outlook> {
  const days = await Promise.all(([1, 2, 3] as const).map(fetchDay));
  return {
    fetchedAt: new Date().toISOString(),
    days: days.map((fc, i) => {
      const category = riskAtPoint(fc, lat, lon);
      return { day: (i + 1) as 1 | 2 | 3, category, label: SPC_LABELS[category] };
    }),
  };
}

/** Highest SPC day-1 category over several points (one download, many point tests). */
export async function fetchRegionSpc(points: { lat: number; lon: number }[]): Promise<SpcCategory> {
  const fc = await fetchDay(1);
  if (!fc) throw new Error("SPC unavailable");
  let max = 0;
  for (const p of points) max = Math.max(max, ORDER.indexOf(riskAtPoint(fc, p.lat, p.lon)));
  return ORDER[max]!;
}
