// Extra data sources: ensemble confidence, SPC storm reports, local hazards, NWS station observations.
import { buildConfidence, type Confidence } from "../../shared/confidence";
import { haversineMi } from "../../shared/geo";
import {
  catRank,
  nearestTideStation,
  normCat,
  parseNhc,
  parseTides,
  type Hazards,
  type RiverGauge,
  type Tides,
} from "../../shared/hazards";
import { convectiveDayStart, parseSpcReports, type StormReport } from "../../shared/reports";
import { nwsFetch } from "./nws";

const ENSEMBLE = "https://ensemble-api.open-meteo.com/v1/ensemble";
export const ENSEMBLE_MODEL = "gfs025";

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

/** GFS ensemble (31 members), daily max/min/precip/snow for 7 days. */
export async function fetchConfidence(lat: number, lon: number): Promise<Confidence> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    models: ENSEMBLE_MODEL,
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum",
    temperature_unit: "fahrenheit",
    precipitation_unit: "inch",
    timezone: "auto",
    forecast_days: "7",
  });
  const d = (await getJson(`${ENSEMBLE}?${params}`)) as { daily?: Record<string, (number | string | null)[]> };
  return buildConfidence(d.daily ?? {}, "GFS ensemble", new Date().toISOString());
}

/** Today's and yesterday's SPC preliminary reports (tornado / wind / hail) for the whole US. */
export async function fetchStormReports(ua: string): Promise<StormReport[]> {
  const start = convectiveDayStart(Date.now());
  const get = async (name: string, dayStart: number) => {
    const res = await fetch(`https://www.spc.noaa.gov/climo/reports/${name}.csv`, { headers: { "User-Agent": ua } });
    if (!res.ok) return [];
    return parseSpcReports(await res.text(), dayStart);
  };
  const [today, yesterday] = await Promise.all([get("today", start), get("yesterday", start - 86_400_000)]);
  return [...today, ...yesterday];
}

interface NwpsGauge {
  lid: string;
  name: string;
  latitude: number;
  longitude: number;
  status?: {
    observed?: { primary?: number; primaryUnit?: string; floodCategory?: string; validTime?: string };
    forecast?: { primary?: number; floodCategory?: string };
  };
}

const goodStage = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > -900 ? Math.round(v * 100) / 100 : null);

/** River gauges near the point from the NWS National Water Prediction Service. */
export async function fetchRivers(ua: string, lat: number, lon: number, max = 6): Promise<RiverGauge[]> {
  const pad = 0.45;
  const params = new URLSearchParams({
    "bbox.xmin": String(lon - pad),
    "bbox.ymin": String(lat - pad * 0.75),
    "bbox.xmax": String(lon + pad),
    "bbox.ymax": String(lat + pad * 0.75),
    srid: "EPSG_4326",
  });
  const d = (await getJson(`https://api.water.noaa.gov/nwps/v1/gauges?${params}`, { headers: { "User-Agent": ua } })) as { gauges?: NwpsGauge[] };
  const list: RiverGauge[] = (d.gauges ?? []).map((g) => ({
    lid: g.lid,
    name: g.name.replace(/\s*\(IN MLLW\)\s*/i, "").slice(0, 70),
    stage: goodStage(g.status?.observed?.primary),
    unit: g.status?.observed?.primaryUnit ?? "ft",
    category: normCat(g.status?.observed?.floodCategory),
    forecastStage: goodStage(g.status?.forecast?.primary),
    forecastCategory: normCat(g.status?.forecast?.floodCategory),
    floodStage: null,
    time: g.status?.observed?.validTime ?? null,
    distanceMi: Math.round(haversineMi(lat, lon, g.latitude, g.longitude)),
  }));
  // anything near or in flood first, then the closest ones that actually report a stage
  const worst = (g: RiverGauge) => Math.max(catRank(g.category), catRank(g.forecastCategory));
  const picked = list
    .filter((g) => g.stage !== null)
    .sort((a, b) => worst(b) - worst(a) || a.distanceMi - b.distanceMi)
    .slice(0, max);
  // flood stage needs one call per gauge; only for the few we show
  await Promise.all(
    picked.map(async (g) => {
      try {
        const det = (await getJson(`https://api.water.noaa.gov/nwps/v1/gauges/${encodeURIComponent(g.lid)}`, { headers: { "User-Agent": ua } })) as {
          flood?: { categories?: { minor?: { stage?: number } } };
        };
        g.floodStage = goodStage(det.flood?.categories?.minor?.stage);
      } catch {
        /* keep null */
      }
    }),
  );
  return picked;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Next high/low tides at the nearest NOAA tide station within 30 mi. */
export async function fetchTides(lat: number, lon: number): Promise<Tides | null> {
  const st = nearestTideStation(lat, lon);
  if (!st) return null;
  const params = new URLSearchParams({
    product: "predictions",
    station: st.id,
    datum: "MLLW",
    interval: "hilo",
    units: "english",
    time_zone: "gmt",
    format: "json",
    begin_date: ymd(new Date(Date.now() - 86_400_000)),
    range: "72",
    application: "SHELLY",
  });
  const d = await getJson(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`);
  const now = Date.now();
  return { station: st.id, name: st.name, distanceMi: st.distanceMi, next: parseTides(d).filter((t) => Date.parse(t.time) > now).slice(0, 4) };
}

export async function fetchHazards(ua: string, lat: number, lon: number): Promise<Hazards> {
  const [rivers, tides, nhc] = await Promise.all([
    fetchRivers(ua, lat, lon).catch(() => []),
    fetchTides(lat, lon).catch(() => null),
    getJson("https://www.nhc.noaa.gov/CurrentStorms.json", { headers: { "User-Agent": ua } }).catch(() => null),
  ]);
  return { fetchedAt: new Date().toISOString(), rivers, tides, tropical: parseNhc(nhc, lat, lon) };
}

/** Nearest NWS observation station id for a grid point, e.g. "KPHL". */
export async function fetchNearestStation(env: Env, office: string, x: number, y: number): Promise<string | null> {
  const d = (await nwsFetch(env, `/gridpoints/${office}/${x},${y}/stations?limit=1`)) as {
    features?: { properties?: { stationIdentifier?: string } }[];
  };
  return d.features?.[0]?.properties?.stationIdentifier ?? null;
}

/** Temperatures (°C) a station measured between two instants. */
export async function fetchObservations(env: Env, station: string, startIso: string, endIso: string): Promise<{ time: string; tempC: number | null }[]> {
  const d = (await nwsFetch(
    env,
    `/stations/${encodeURIComponent(station)}/observations?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`,
  )) as { features?: { properties?: { timestamp?: string; temperature?: { value?: number | null; qualityControl?: string } } }[] };
  return (d.features ?? []).map((f) => {
    const t = f.properties?.temperature;
    const bad = t?.qualityControl === "X" || t?.qualityControl === "Q";
    return { time: f.properties?.timestamp ?? "", tempC: !bad && typeof t?.value === "number" ? t.value : null };
  });
}
