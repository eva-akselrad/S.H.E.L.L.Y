// Snow day odds: gathers the NWS gridpoint numbers, the ensemble range and the active alerts,
// then hands them to the pure model in shared/snowday.ts. No LLM anywhere in this path.
import { pointInGeometry } from "../shared/geo";
import { localHourString, parseGridHours, type SnowHour } from "../shared/gridpoint";
import { pickDistrict, computeSnowDay, ensembleRange, hoursFromCodes, type SnowDayResponse } from "../shared/snowday";
import type { SnowDayConfig } from "../shared/config";
import type { Confidence } from "../shared/confidence";
import { cached, round } from "./cache";
import { coords, loadForecast, loadPlace } from "./loaders";
import { fetchConfidence } from "./sources/extra";
import { fetchGridData } from "./sources/nws";
import { readAlerts, readConfig } from "./store";

const rnd05 = (n: number): number => Math.round(n * 20) / 20;

/** Odds for one point and one district profile (or the defaults when there is no district). */
export async function snowDayAt(
  env: Env,
  ctx: ExecutionContext,
  c: { lat: number; lon: number },
  cfg: SnowDayConfig,
  forcedDistrictId?: string,
): Promise<SnowDayResponse> {
  const fetchedAt = new Date().toISOString();
  if (!cfg.enabled) return { fetchedAt, enabled: false, district: null, source: null, odds: null };

  const forced = forcedDistrictId ? cfg.districts.find((d) => d.id === forcedDistrictId) : undefined;
  const near = forced ? { district: forced, distanceMi: 0 } : pickDistrict(cfg.districts, c.lat, c.lon, 25);
  const at = near ? { lat: near.district.lat, lon: near.district.lon } : c;
  const profile = near ? { toughness: near.district.toughness, coldWindChillF: near.district.coldWindChillF } : { toughness: 0.5, coldWindChillF: -10 };

  const place = await loadPlace(env, ctx, at.lat, at.lon);
  const tz = place.tz || "America/New_York";

  let hours: SnowHour[] = [];
  let source: "nws" | "model" | null = null;
  if (place.office && place.gridX !== null && place.gridY !== null) {
    try {
      const { data } = await cached<SnowHour[]>(ctx, `grid:${place.office}:${place.gridX},${place.gridY}`, 900, async () =>
        parseGridHours(await fetchGridData(env, place.office!, place.gridX!, place.gridY!), tz),
      );
      if (data.length) {
        hours = data;
        source = "nws";
      }
    } catch {
      /* fall back to the model below */
    }
  }
  if (!hours.length) {
    try {
      const f = await loadForecast(env, ctx, at, { office: null, x: null, y: null });
      hours = hoursFromCodes(f.hourly);
      source = "model";
    } catch {
      return { fetchedAt, enabled: true, district: near ? { id: near.district.id, name: near.district.name, distanceMi: near.distanceMi } : null, source: null, odds: null };
    }
  }

  const nowLocal = `${localHourString(Date.now(), tz)}`;
  // the ensemble shares its cache with /api/confidence
  const conf = await cached<Confidence>(ctx, `ens:${round(at.lat, 1)}:${round(at.lon, 1)}`, 3600, () => fetchConfidence(at.lat, at.lon)).then(
    (r) => r.data,
    () => null,
  );

  const { alerts } = await readAlerts(env);
  const zones = new Set([place.forecastZone, place.countyZone, place.fireZone].filter((z): z is string => !!z));
  const covering = alerts
    .filter((a) => (a.geometry ? pointInGeometry(at.lon, at.lat, a.geometry) : a.zones.some((z) => zones.has(z))))
    .map((a) => a.event);

  const base = computeSnowDay({ hours, alerts: covering, nowLocal, daysOff: cfg.daysOff, district: profile, range: null });
  const odds = computeSnowDay({
    hours,
    alerts: covering,
    nowLocal,
    daysOff: cfg.daysOff,
    district: profile,
    range: conf ? ensembleRange(conf.days, base.forDate) : null,
  });
  return {
    fetchedAt,
    enabled: true,
    district: near ? { id: near.district.id, name: near.district.name, distanceMi: near.distanceMi } : null,
    source,
    odds,
  };
}

/** GET /api/snowday?lat=&lon= */
export async function handleSnowDay(env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const c = coords(url);
  if (!c) return Response.json({ error: "bad_location" }, { status: 400, headers: { "cache-control": "no-store" } });
  const cfg = (await readConfig(env)).snowDay;
  // key rounded to 0.05 degrees so neighbours share one answer
  const { data } = await cached(ctx, `snowday:${rnd05(c.lat)}:${rnd05(c.lon)}`, 900, () => snowDayAt(env, ctx, c, cfg));
  return Response.json(data, { headers: { "cache-control": "public, max-age=300" } });
}
