import type { Alert, Announcement, Forecast, Place } from "../shared/types";
import { verifyAccess } from "./access";
import { cached, round } from "./cache";
import { fetchActiveAlerts, fetchForecastText, fetchPoint } from "./sources/nws";
import { fetchAirQuality, fetchOpenMeteo, normalizeForecast } from "./sources/openmeteo";
import { fetchRadarFrames } from "./sources/rainviewer";
import { fetchOutlook } from "./sources/spc";

const ALERTS_KEY = "alerts:active";
const ANN_KEY = "announcements";

const json = (data: unknown, status = 200, maxAge = 0): Response =>
  Response.json(data, {
    status,
    headers: { "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });

function coords(url: URL): { lat: number; lon: number } | null {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < 17 || lat > 72 || lon < -180 || lon > -64) return null; // US + territories bounding box
  return { lat: round(lat, 4), lon: round(lon, 4) };
}

async function geocode(q: string): Promise<{ lat: number; lon: number; name: string } | null> {
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&countryCode=US`,
  );
  if (!res.ok) return null;
  const d = (await res.json()) as { results?: { latitude: number; longitude: number; name: string }[] };
  const r = d.results?.[0];
  return r ? { lat: r.latitude, lon: r.longitude, name: r.name } : null;
}

async function readAlerts(env: Env): Promise<{ updated: string | null; alerts: Alert[] }> {
  const stored = await env.STATE.get<{ updated: string; alerts: Alert[] }>(ALERTS_KEY, "json");
  return stored ?? { updated: null, alerts: [] };
}

async function pollAlerts(env: Env): Promise<void> {
  try {
    const alerts = await fetchActiveAlerts(env);
    await env.STATE.put(ALERTS_KEY, JSON.stringify({ updated: new Date().toISOString(), alerts }));
  } catch (err) {
    console.error(JSON.stringify({ msg: "alert_poll_failed", err: String(err) }));
  }
}

async function readAnnouncements(env: Env): Promise<Announcement[]> {
  const list = (await env.STATE.get<Announcement[]>(ANN_KEY, "json")) ?? [];
  const now = Date.now();
  return list.filter((a) => !a.expires || new Date(a.expires).getTime() > now);
}

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/health") return json({ ok: true, app: "SHELLY", version: "2.0.0" });

  if (path === "/api/location") {
    let c = coords(url);
    let label: string | undefined;
    const q = url.searchParams.get("q");
    if (!c && q) {
      const g = await geocode(q.slice(0, 100));
      if (!g) return json({ error: "location_not_found" }, 404);
      c = { lat: round(g.lat, 4), lon: round(g.lon, 4) };
      label = g.name;
    }
    if (!c) return json({ error: "bad_location", detail: "US locations only" }, 400);
    const { lat, lon } = c;
    try {
      const { data } = await cached<Place>(ctx, `loc:${round(lat, 3)}:${round(lon, 3)}`, 86400, () =>
        fetchPoint(env, lat, lon),
      );
      return json(label ? { ...data, name: label } : data, 200, 3600);
    } catch {
      return json({ error: "outside_us" }, 404);
    }
  }

  if (path === "/api/forecast") {
    const c = coords(url);
    if (!c) return json({ error: "bad_location" }, 400);
    const office = url.searchParams.get("office");
    const gx = Number(url.searchParams.get("x"));
    const gy = Number(url.searchParams.get("y"));
    const { data } = await cached<Forecast>(ctx, `fc:${round(c.lat, 2)}:${round(c.lon, 2)}`, 300, async () => {
      const [raw, text] = await Promise.all([
        fetchOpenMeteo(c.lat, c.lon),
        office && gx && gy ? fetchForecastText(env, office, gx, gy).catch(() => []) : Promise.resolve([]),
      ]);
      return { fetchedAt: new Date().toISOString(), ...normalizeForecast(raw), text };
    });
    return json(data, 200, 60);
  }

  if (path === "/api/alerts") {
    const zones = (url.searchParams.get("zones") ?? "").split(",").filter(Boolean);
    const { updated, alerts } = await readAlerts(env);
    // Safety net: if the cron poller hasn't run recently, refresh in the background.
    if (!updated || Date.now() - new Date(updated).getTime() > 180_000) ctx.waitUntil(pollAlerts(env));
    // Return alerts that name one of the zones, or that carry a polygon (client does the exact test).
    const relevant = alerts.filter((a) => a.geometry || a.zones.some((z) => zones.includes(z)));
    return json({ updated, alerts: relevant }, 200, 15);
  }

  if (path === "/api/outlook") {
    const c = coords(url);
    if (!c) return json({ error: "bad_location" }, 400);
    const { data } = await cached(ctx, `spc:${round(c.lat, 1)}:${round(c.lon, 1)}`, 1800, () =>
      fetchOutlook(c.lat, c.lon),
    );
    return json(data, 200, 300);
  }

  if (path === "/api/airquality") {
    const c = coords(url);
    if (!c) return json({ error: "bad_location" }, 400);
    const { data } = await cached(ctx, `aq:${round(c.lat, 1)}:${round(c.lon, 1)}`, 1800, () =>
      fetchAirQuality(c.lat, c.lon),
    );
    return json(data, 200, 300);
  }

  if (path === "/api/radar") {
    const { data } = await cached(ctx, "radar", 120, fetchRadarFrames);
    return json(data, 200, 60);
  }

  if (path === "/api/announcements") {
    if (request.method === "GET") return json(await readAnnouncements(env), 200, 15);
    // Writes are protected by Cloudflare Access in front of this route.
    if (!(await verifyAccess(request, env))) return json({ error: "unauthorized" }, 401);
    if (request.method === "POST") {
      const body = (await request.json().catch(() => null)) as Partial<Announcement> | null;
      const text = typeof body?.text === "string" ? body.text.trim().slice(0, 500) : "";
      if (!text) return json({ error: "text_required" }, 400);
      const list = await readAnnouncements(env);
      const item: Announcement = {
        id: crypto.randomUUID(),
        text,
        level: body?.level === "warn" ? "warn" : "info",
        created: new Date().toISOString(),
        expires: typeof body?.expires === "string" ? body.expires : null,
      };
      await env.STATE.put(ANN_KEY, JSON.stringify([item, ...list].slice(0, 20)));
      return json(item, 201);
    }
    if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      const list = await readAnnouncements(env);
      await env.STATE.put(ANN_KEY, JSON.stringify(list.filter((a) => a.id !== id)));
      return json({ ok: true });
    }
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      return await handleApi(request, env, ctx);
    } catch (err) {
      console.error(JSON.stringify({ msg: "api_error", path: new URL(request.url).pathname, err: String(err) }));
      return json({ error: "upstream_failed" }, 502);
    }
  },

  async scheduled(_event, env, ctx): Promise<void> {
    ctx.waitUntil(pollAlerts(env));
  },
} satisfies ExportedHandler<Env>;
