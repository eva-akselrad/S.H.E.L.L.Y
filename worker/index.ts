import { buildSimAlert } from "../shared/simulate";
import { handleAdmin } from "./admin";
import { handleAndroid } from "./android";
import { fanOutFcm } from "./fcm";
import { coords, loadForecast, loadPlace } from "./loaders";
import { cached, round } from "./cache";
import { handleDamage } from "./damage";
import { handleSnowDay } from "./snowday";
import { handleLiveTts, prepareRundownVoice, produceRundown } from "./live";
import { gradeSummary, runGrading } from "./grade";
import { pollAlerts } from "./poll";
import { fanOutPushes, handlePush } from "./push";
import { fetchZoneGeometry, unionGeometry } from "./sources/nws";
import { fetchConfidence, fetchHazards, fetchStormReports } from "./sources/extra";
import { nearbyReports, type StormReport } from "../shared/reports";
import { publicProducts } from "./studio";
import { fetchAirQuality } from "./sources/openmeteo";
import { fetchRadarFrames, tileUpstream } from "./sources/iemradar";
import { fetchOutlook } from "./sources/spc";
import { readAlerts, readAnnouncements, readConfig, readRundown, readSim } from "./store";
import { handleTts } from "./tts";

const json = (data: unknown, status = 200, maxAge = 0): Response =>
  Response.json(data, {
    status,
    headers: { "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });

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

  const admin = await handleAdmin(request, env, url, ctx);
  if (admin) return admin;

  const push = await handlePush(request, env, url);
  if (push) return push;

  const android = await handleAndroid(request, env, ctx, url);
  if (android) return android;

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
    return r ? json(r, 200, 2) : json({ error: "no_rundown_yet" }, 503);
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
      const data = await loadPlace(env, ctx, lat, lon);
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
    const data = await loadForecast(env, ctx, c, { office, x: gx, y: gy });
    return json(data, 200, 60);
  }

  if (path === "/api/alerts") {
    const zones = (url.searchParams.get("zones") ?? "").split(",").filter(Boolean);
    const { updated, alerts } = await readAlerts(env);
    // Safety net: if the cron poller hasn't run recently, refresh in the background.
    if (!updated || Date.now() - new Date(updated).getTime() > 180_000) ctx.waitUntil(pollAlerts(env));
    // Return alerts that name one of the zones, or that carry a polygon (client does the exact test).
    const relevant = alerts.filter((a) => a.geometry || a.zones.some((z) => zones.includes(z)));
    // Zone-based alerts (high wind, coastal flood, winter storm...) have no polygon from NWS: draw their zones instead.
    for (const a of relevant) {
      if (a.geometry || !a.zones.some((z) => zones.includes(z))) continue;
      const shapes = await Promise.all(
        a.zones.slice(0, 40).map((z) =>
          cached(ctx, `zone:${z}`, 7 * 86400, async () => {
            const g = await fetchZoneGeometry(env, z);
            if (!g) throw new Error("no zone shape"); // so a failure is not cached
            return g;
          }).then((r) => r.data, () => null),
        ),
      );
      a.geometry = unionGeometry(shapes);
    }
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
    const { data } = await cached(ctx, `aq:${round(c.lat, 1)}:${round(c.lon, 1)}`, 1800, async () => ({
      ...(await fetchAirQuality(c.lat, c.lon)),
      fetchedAt: new Date().toISOString(),
    }));
    return json(data, 200, 300);
  }

  if (path === "/api/confidence") {
    const c = coords(url);
    if (!c) return json({ error: "bad_location" }, 400);
    const { data } = await cached(ctx, `ens:${round(c.lat, 1)}:${round(c.lon, 1)}`, 3600, () => fetchConfidence(c.lat, c.lon));
    return json(data, 200, 900);
  }

  if (path === "/api/reports") {
    const c = coords(url);
    if (!c) return json({ error: "bad_location" }, 400);
    const { data } = await cached<{ fetchedAt: string; reports: StormReport[] }>(ctx, "spc-reports", 300, async () => ({
      fetchedAt: new Date().toISOString(),
      reports: await fetchStormReports(env.NWS_USER_AGENT),
    }));
    return json({ fetchedAt: data.fetchedAt, reports: nearbyReports(data.reports, c.lat, c.lon, Date.now()).slice(0, 60) }, 200, 120);
  }

  if (path === "/api/hazards") {
    const c = coords(url);
    if (!c) return json({ error: "bad_location" }, 400);
    const { data } = await cached(ctx, `hz:${round(c.lat, 2)}:${round(c.lon, 2)}`, 900, () => fetchHazards(env.NWS_USER_AGENT, c.lat, c.lon));
    return json(data, 200, 300);
  }

  if (path === "/api/snowday") return handleSnowDay(env, ctx, url);
  if (path === "/api/damage") return handleDamage(request, env, ctx, url);

  if (path === "/api/grade") return json(await gradeSummary(env), 200, 600);

  if (path === "/api/radar") {
    const { data } = await cached(ctx, "radar", 120, fetchRadarFrames);
    return json(data, 200, 60);
  }

  // same-origin radar tiles for the future-radar canvas (it reads pixels). Not an open proxy: known frames, z <= 7.
  const tile = /^\/api\/radar\/tile\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(path);
  if (tile && request.method === "GET") {
    const [, frame, z, x, y] = tile as unknown as [string, string, string, string, string];
    const upstream = tileUpstream(Math.floor(Date.now() / 1000), frame, z, x, y);
    if (!upstream) return json({ error: "bad_tile" }, 400);
    const cache = caches.default;
    const key = new Request(`https://cache.shelly.internal/radar-tile/${frame}/${z}/${x}/${y}`);
    const hit = await cache.match(key);
    if (hit) return hit;
    const res = await fetch(upstream);
    if (!res.ok) return json({ error: "upstream_failed" }, 502);
    const out = new Response(res.body, { headers: { "content-type": "image/png", "cache-control": "public, max-age=600" } });
    ctx.waitUntil(cache.put(key, out.clone()));
    return out;
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
    // cron fires once a minute; a second pass half a minute later halves the worst-case wait for a new warning
    const pass = async (): Promise<void> => {
      const alerts = await pollAlerts(env);
      // push first: it's the time-critical part (both fan-outs remember what they already sent)
      if (alerts) {
        await fanOutPushes(env, alerts).catch((err) => console.error(JSON.stringify({ msg: "push_fanout_failed", err: String(err) })));
        await fanOutFcm(env, alerts).catch((err) => console.error(JSON.stringify({ msg: "fcm_fanout_failed", err: String(err) })));
      }
      await produceRundown(env);
    };
    ctx.waitUntil(
      pass()
        .then(() => new Promise<void>((r) => setTimeout(r, 30_000)))
        .then(pass)
        .catch((err) => console.error(JSON.stringify({ msg: "producer_failed", err: String(err) }))),
    );
    // make the local voice's audio ahead for upcoming items, so nothing waits on it on air
    ctx.waitUntil(
      readRundown(env)
        .then((r) => prepareRundownVoice(env, r))
        .catch((err) => console.error(JSON.stringify({ msg: "voice_prep_failed", err: String(err) }))),
    );
    ctx.waitUntil(runGrading(env).catch((err) => console.error(JSON.stringify({ msg: "grading_failed", err: String(err) }))));
  },
} satisfies ExportedHandler<Env>;
