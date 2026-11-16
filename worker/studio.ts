import { geomBbox, bboxOverlap } from "../shared/live/region";
import { normalizeProducts, productActive, type RiskArea, type RiskLevel, type SevenDayDay, type StudioProduct } from "../shared/studio";
import type { Bbox, PolygonGeom } from "../shared/types";
import { gridPoints } from "../shared/contour";
import { buildTimeline } from "../shared/timeline";
import { fetchCitiesDaily, fetchCitiesHourly, fetchOpenMeteo, fetchTotals, normalizeForecast } from "./sources/openmeteo";
import { fetchDay } from "./sources/spc";
import { readConfig, readProducts, writeProducts } from "./store";

const json = (data: unknown, status = 200, maxAge = 0): Response =>
  Response.json(data, { status, headers: { "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store" } });

const WEEK = 7 * 86400_000;

/** Public: published products that are valid right now. */
export async function publicProducts(env: Env): Promise<StudioProduct[]> {
  const now = Date.now();
  return (await readProducts(env)).filter((p) => productActive(p, now));
}

const SPC_LEVEL: Record<string, RiskLevel> = { MRGL: "low", SLGT: "some", ENH: "moderate", MDT: "high", HIGH: "extreme" };

/** Admin Studio routes. Returns null for paths it doesn't own. Caller has already checked the session. */
export async function handleStudioAdmin(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;
  if (!path.startsWith("/api/admin/studio")) return null;

  if (path === "/api/admin/studio" && method === "GET") return json(await readProducts(env));

  if (path === "/api/admin/studio" && method === "PUT") {
    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return json({ error: "bad_body" }, 400);
    const id = typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID();
    const [product] = normalizeProducts([{ ...raw, id, updated: new Date().toISOString() }]);
    if (!product) return json({ error: "invalid_product" }, 400);
    const now = Date.now();
    const list = (await readProducts(env)).filter((p) => p.id !== id && Date.parse(p.validTo) > now - WEEK);
    await writeProducts(env, [product, ...list]);
    return json(product);
  }

  if (path === "/api/admin/studio" && method === "DELETE") {
    const id = url.searchParams.get("id");
    await writeProducts(env, (await readProducts(env)).filter((p) => p.id !== id));
    return json({ ok: true });
  }

  const cfg = await readConfig(env);
  const region = cfg.live.region;

  // 7-day from the model, for the forecaster to start from
  if (path === "/api/admin/studio/model-7day" && method === "GET") {
    const c = region.cities.find((x) => x.name === url.searchParams.get("city")) ?? region.cities[0];
    if (!c) return json({ error: "no_city" }, 400);
    const f = normalizeForecast(await fetchOpenMeteo(c.lat, c.lon));
    const days: SevenDayDay[] = f.daily.slice(0, 7).map((d) => ({ date: d.date, hi: Math.round(d.hi), lo: Math.round(d.lo), pop: Math.round(d.pop), code: d.code }));
    return json({ place: c.name, days });
  }

  // city temperature map values for tomorrow (or today)
  if (path === "/api/admin/studio/city-temps" && method === "GET") {
    const metric = url.searchParams.get("metric") === "low" ? "low" : url.searchParams.get("metric") === "feelsLike" ? "feelsLike" : "high";
    const day = url.searchParams.get("day") === "0" ? 0 : 1;
    const wx = await fetchCitiesDaily(region.cities);
    const cities = region.cities.map((c, i) => {
      const w = wx[i];
      const v = metric === "low" ? w?.low[day] : metric === "feelsLike" ? w?.feelsHigh[day] : w?.high[day];
      return { name: c.name, lat: c.lat, lon: c.lon, value: Math.round(v ?? 0) };
    });
    return json({ metric, cities });
  }

  // model snow/rain totals on a grid; the browser contours it so the forecaster can nudge it
  if (path === "/api/admin/studio/totals" && method === "GET") {
    const kind = url.searchParams.get("kind") === "rain" ? "rain" : "snow";
    const days = Math.min(5, Math.max(1, Number(url.searchParams.get("days")) || 2));
    const w = 15;
    const h = 15;
    const values = await fetchTotals(gridPoints(region.bbox, w, h), kind, days);
    return json({ grid: { w, h, values, bbox: region.bbox } });
  }

  // storm timeline across the first cities, from the hourly model
  if (path === "/api/admin/studio/timeline" && method === "GET") {
    const cs = region.cities.slice(0, 8);
    const hourly = await fetchCitiesHourly(cs);
    const now = localHour(region.tz);
    return json(buildTimeline(cs.map((c, i) => ({ name: c.name, ...(hourly[i] ?? { time: [], code: [], precip: [] }) })), now));
  }

  // SPC day-1/2/3 categories as editable starting polygons
  if (path === "/api/admin/studio/spc" && method === "GET") {
    const d = Number(url.searchParams.get("day"));
    const day = (d === 2 ? 2 : d === 3 ? 3 : 1) as 1 | 2 | 3;
    const fc = await fetchDay(day);
    if (!fc) return json({ error: "spc_unavailable" }, 502);
    return json({ areas: spcAreas(fc, region.bbox) });
  }

  return json({ error: "not_found" }, 404);
}

export function spcAreas(fc: { features?: { properties?: { LABEL?: string }; geometry?: PolygonGeom | null }[] }, bbox: Bbox): RiskArea[] {
  const out: RiskArea[] = [];
  for (const f of fc.features ?? []) {
    const level = SPC_LEVEL[f.properties?.LABEL ?? ""];
    if (!level || !f.geometry) continue;
    const gb = geomBbox(f.geometry);
    if (gb && bboxOverlap(gb, bbox)) out.push({ level, hazard: "wind", geometry: f.geometry });
  }
  return out;
}

/** "YYYY-MM-DDTHH:00" for the current hour in `tz`, to compare with Open-Meteo local times. */
export function localHour(tz: string, at = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}
