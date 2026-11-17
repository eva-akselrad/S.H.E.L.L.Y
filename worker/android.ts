// Endpoints for the SHELLY Android app: /api/glance (widget + notification data) and the self-update feed.
import { buildGlance, placeZones } from "../shared/glance";
import { buildSimAlert } from "../shared/simulate";
import { coords, loadForecast, loadPlace } from "./loaders";
import { pollAlerts } from "./poll";
import { readAlerts, readConfig, readSim } from "./store";

const LATEST_KEY = "android:latest";
const apkKey = (code: number) => `android:apk:${code}`;

export interface AndroidRelease {
  versionCode: number;
  versionName: string;
  sha256: string;
  size: number;
  minSdk: number;
  notes: string;
  published: string;
}

const json = (data: unknown, status = 200, maxAge = 0): Response =>
  Response.json(data, { status, headers: { "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store" } });

export async function handleAndroid(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response | null> {
  const path = url.pathname;

  if (path === "/api/glance" && request.method === "GET") {
    const c = coords(url);
    if (!c) return json({ error: "bad_location", detail: "US locations only" }, 400);
    let place;
    try {
      place = await loadPlace(env, ctx, c.lat, c.lon);
    } catch {
      return json({ error: "outside_us" }, 404);
    }
    const [forecast, config, stored] = await Promise.all([
      loadForecast(env, ctx, c, { office: place.office, x: place.gridX, y: place.gridY }).catch(() => null),
      readConfig(env),
      readAlerts(env),
    ]);
    // same safety net as /api/alerts: refresh in the background if the cron poller is behind
    if (!stored.updated || Date.now() - Date.parse(stored.updated) > 180_000) ctx.waitUntil(pollAlerts(env));
    const zones = placeZones(place);
    // admin "test alert" entries, built around this phone, so the test button exercises the app too
    const sim = (await readSim(env)).map((s) => buildSimAlert(s, { ...c, zones }));
    const glance = buildGlance({
      now: new Date(),
      place,
      forecast,
      alerts: [...sim, ...stored.alerts],
      alertsUpdated: stored.updated,
      safety: config.safety,
    });
    return json(glance, 200, 15);
  }

  if (path === "/api/android/latest.json") {
    const latest = await env.STATE.get<AndroidRelease>(LATEST_KEY, "json");
    return latest ? json(latest, 200, 300) : json({ error: "no_release" }, 404);
  }

  if (path === "/api/android/shelly.apk") {
    const latest = await env.STATE.get<AndroidRelease>(LATEST_KEY, "json");
    if (!latest) return json({ error: "no_release" }, 404);
    const bytes = await env.STATE.get(apkKey(latest.versionCode), "arrayBuffer");
    if (!bytes) return json({ error: "apk_missing" }, 404);
    return new Response(bytes, {
      headers: {
        "content-type": "application/vnd.android.package-archive",
        "content-disposition": `attachment; filename="SHELLY-${latest.versionName.replace(/[^\w.-]/g, "")}.apk"`,
        "content-length": String(bytes.byteLength),
        "cache-control": "public, max-age=300",
      },
    });
  }

  return null;
}
