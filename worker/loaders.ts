// Cached loaders shared by the website API and the Android app endpoints.
import type { Forecast, Place } from "../shared/types";
import { cached, round } from "./cache";
import { fetchForecastText, fetchPoint } from "./sources/nws";
import { fetchOpenMeteo, normalizeForecast } from "./sources/openmeteo";

export function coords(url: URL): { lat: number; lon: number } | null {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < 17 || lat > 72 || lon < -180 || lon > -64) return null; // US + territories bounding box
  return { lat: round(lat, 4), lon: round(lon, 4) };
}

export async function loadPlace(env: Env, ctx: ExecutionContext, lat: number, lon: number): Promise<Place> {
  const { data } = await cached<Place>(ctx, `loc:${round(lat, 3)}:${round(lon, 3)}`, 86400, () => fetchPoint(env, lat, lon));
  return data;
}

export async function loadForecast(
  env: Env,
  ctx: ExecutionContext,
  c: { lat: number; lon: number },
  grid: { office: string | null; x: number | null; y: number | null },
): Promise<Forecast> {
  const { data } = await cached<Forecast>(ctx, `fc:${round(c.lat, 2)}:${round(c.lon, 2)}`, 300, async () => {
    const [raw, text] = await Promise.all([
      fetchOpenMeteo(c.lat, c.lon),
      grid.office && grid.x && grid.y ? fetchForecastText(env, grid.office, grid.x, grid.y).catch(() => []) : Promise.resolve([]),
    ]);
    return { fetchedAt: new Date().toISOString(), ...normalizeForecast(raw), text };
  });
  return data;
}
