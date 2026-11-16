import type { SiteConfig } from "../shared/config";
import type { StudioProduct } from "../shared/studio";
import type { AirQuality, Alert, Announcement, Forecast, Outlook, Place, RadarFrames } from "../shared/types";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

const q = (p: Place) => `lat=${p.lat}&lon=${p.lon}`;

export const api = {
  locate: (lat: number, lon: number) => get<Place>(`/api/location?lat=${lat}&lon=${lon}`),
  whereami: () => get<Place>("/api/location?ip=1"),
  search: (query: string) => get<Place>(`/api/location?q=${encodeURIComponent(query)}`),
  forecast: (p: Place) =>
    get<Forecast>(`/api/forecast?${q(p)}${p.office ? `&office=${p.office}&x=${p.gridX}&y=${p.gridY}` : ""}`),
  alerts: (p: Place) => {
    const zones = [p.forecastZone, p.countyZone, p.fireZone].filter(Boolean).join(",");
    return get<{ updated: string | null; alerts: Alert[] }>(`/api/alerts?zones=${zones}&${q(p)}`);
  },
  outlook: (p: Place) => get<Outlook>(`/api/outlook?${q(p)}`),
  air: (p: Place) => get<AirQuality>(`/api/airquality?${q(p)}`),
  radar: () => get<RadarFrames>("/api/radar"),
  config: () => get<SiteConfig>("/api/config"),
  studio: () => get<StudioProduct[]>("/api/studio"),
  announcements: () => get<Announcement[]>("/api/announcements"),
};
