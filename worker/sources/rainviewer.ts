import type { RadarFrames } from "../../shared/types";

export async function fetchRadarFrames(): Promise<RadarFrames> {
  const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
  if (!res.ok) throw new Error(`RainViewer ${res.status}`);
  const d = (await res.json()) as { host?: string; radar?: { past?: { time: number; path: string }[] } };
  return {
    host: d.host ?? "https://tilecache.rainviewer.com",
    frames: (d.radar?.past ?? []).slice(-8),
  };
}
