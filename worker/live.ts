import type { SiteConfig } from "../shared/config";
import { computeIntensity } from "../shared/live/intensity";
import { regionAlerts } from "../shared/live/region";
import { buildRundown, isWarning, type CityWx, type Rundown } from "../shared/live/rundown";
import { buildSimAlert } from "../shared/simulate";
import { productActive } from "../shared/studio";
import type { SpcCategory } from "../shared/types";
import { wmoToWeather } from "../shared/wx";
import { fetchCitiesNow } from "./sources/openmeteo";
import { fetchRegionSpc } from "./sources/spc";
import { readAlerts, readConfig, readLiveState, readProducts, readRundown, readSim, writeLiveState, writeRundown } from "./store";

interface Timed<T> {
  at: number;
  data: T;
}

/** KV-backed cache for slow-moving inputs so the every-minute cron stays cheap. */
async function kvCached<T>(env: Env, key: string, ttlMs: number, produce: () => Promise<T>, fallback: T): Promise<T> {
  const hit = await env.STATE.get<Timed<T>>(key, "json");
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  try {
    const data = await produce();
    await env.STATE.put(key, JSON.stringify({ at: Date.now(), data } satisfies Timed<T>), { expirationTtl: 86400 });
    return data;
  } catch (err) {
    console.error(JSON.stringify({ msg: "live_input_failed", key, err: String(err) }));
    return hit?.data ?? fallback;
  }
}

const sameContent = (a: Rundown | null, b: Rundown): boolean => {
  if (!a) return false;
  const strip = (r: Rundown) => JSON.stringify({ ...r, generatedAt: "" });
  return strip(a) === strip(b);
};

/** Compute the rundown from stored data and write it to KV only if it changed. */
export async function produceRundown(env: Env, cfgIn?: SiteConfig): Promise<Rundown | null> {
  const cfg = cfgIn ?? (await readConfig(env));
  const live = cfg.live;
  if (!live.enabled) return null;
  const now = Date.now();
  const { region } = live;

  const [{ alerts }, sims, products, state] = await Promise.all([readAlerts(env), readSim(env), readProducts(env), readLiveState(env)]);
  const centre = { lat: (region.bbox.south + region.bbox.north) / 2, lon: (region.bbox.west + region.bbox.east) / 2, zones: [] as string[] };
  const inRegion = regionAlerts([...sims.map((s) => buildSimAlert(s, centre)), ...alerts], region, now);

  const spc = await kvCached<SpcCategory>(env, "live:spc", 30 * 60_000, () => fetchRegionSpc(region.cities), "NONE");
  const cities = await kvCached<CityWx[]>(
    env,
    "live:cities",
    10 * 60_000,
    async () => {
      const wx = await fetchCitiesNow(region.cities);
      return region.cities.map((c, i) => ({ ...c, temp: wx[i]?.temp ?? 0, desc: wmoToWeather(wx[i]?.code ?? 0, wx[i]?.isDay ?? true).desc }));
    },
    [],
  );

  // track when the last warning ended so the score can decay
  const warningNow = inRegion.some(isWarning);
  const lastWarningEndedAt = state.hadWarning && !warningNow ? new Date(now).toISOString() : state.lastWarningEndedAt;
  if (warningNow !== state.hadWarning) await writeLiveState(env, { hadWarning: warningNow, lastWarningEndedAt });

  const intensity = computeIntensity({ alerts: inRegion, spc, lastWarningEndedAt, now });
  const rundown = buildRundown(
    intensity,
    { alerts: inRegion, spc, cities, studio: products.filter((p) => productActive(p, now)), cams: [] },
    live,
    now,
  );

  if (!sameContent(await readRundown(env), rundown)) await writeRundown(env, rundown);
  return rundown;
}
