import { buildSimAlert } from "../shared/simulate";
import type { Forecast, Place } from "../shared/types";
import { handleAdmin } from "./admin";
import { cached, round } from "./cache";
import { handleLiveTts, produceRundown } from "./live";
import { pollAlerts } from "./poll";
import { publicProducts } from "./studio";
import { fetchForecastText, fetchPoint } from "./sources/nws";
import { fetchAirQuality, fetchOpenMeteo, normalizeForecast } from "./sources/openmeteo";
import { fetchRadarFrames } from "./sources/rainviewer";
import { fetchOutlook } from "./sources/spc";
import { readAlerts, readAnnouncements, readConfig, readRundown, readSim } from "./store";
import { handleTts } from "./tts";

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

async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/health") return json({ ok: true, app: "SHELLY", version: "2.0.0" });

  const admin = await handleAdmin(request, env, url);
  if (admin) return admin;

  if (path === "/api/config") {
    const c = await readConfig(env);
    // the viewer token must never be served publicly
    return json({ ...c, live: { ...c.live, viewerToken: "" } }, 200, 15);
  }

  if (path === "/api/studio") return json(await publicProducts(env), 200, 30);

  if (path === "/api/live/tts" && request.method === "GET") return handleLiveTts(env, url);

  if (path === "/api/live/rundown") {
    const c = await readConfig(env);
    if (!c.live.enabled) return json({ error: "live_disabled" }, 404);
    if (c.live.viewerToken && url.searchParams.get("key") !== c.live.viewerToken) return json({ error: "forbidden" }, 403);
    const r = await readRundown(env);
    return r ? json(r, 200, 15) : json({ error: "no_rundown_yet" }, 503);
  }
  if (path === "/api/tts" && request.method === "GET") return handleTts(env, url);

  if (path === "/api/location") {
    let c = coords(url);
    let label: string | undefined;
    if (!c && url.searchParams.has("ip")) {
      // Approximate position from the visitor's IP (Cloudflare edge data). Never leaves Cloudflare.
      const cf = request.cf;
      const lat = Number(cf?.latitude);
      const lon = Number(cf?.longitude);
      if (cf?.country !== "US" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        return json({ error: "ip_location_unavailable" }, 404);
      }
      c = { lat: round(lat, 4), lon: round(lon, 4) };
      label = typeof cf.city === "string" ? cf.city : undefined;
    }
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
    // Admin-started test alerts, built around this viewer's location.
    const c = coords(url);
    const sim = c ? (await readSim(env)).map((s) => buildSimAlert(s, { ...c, zones })) : [];
    return json({ updated, alerts: [...sim, ...relevant] }, 200, 15);
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

  if (path === "/api/announcements" && request.method === "GET") return json(await readAnnouncements(env), 200, 15);

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
    ctx.waitUntil(
      pollAlerts(env)
        .then(() => produceRundown(env))
        .catch((err) => console.error(JSON.stringify({ msg: "producer_failed", err: String(err) }))),
    );
  },
} satisfies ExportedHandler<Env>;
