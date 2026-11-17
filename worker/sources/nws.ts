import type { Alert, AlertParams, Place, PolygonGeom } from "../../shared/types";

const BASE = "https://api.weather.gov";

export async function nwsFetch(env: Env, path: string): Promise<unknown> {
  const res = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
    headers: { "User-Agent": env.NWS_USER_AGENT, Accept: "application/geo+json" },
  });
  if (!res.ok) throw new Error(`NWS ${res.status} for ${path}`);
  return res.json();
}

interface RawAlertFeature {
  id?: string;
  geometry: PolygonGeom | null;
  properties: {
    id?: string;
    event?: string;
    senderName?: string;
    severity?: string;
    urgency?: string;
    certainty?: string;
    headline?: string | null;
    description?: string | null;
    instruction?: string | null;
    sent?: string;
    onset?: string | null;
    ends?: string | null;
    expires?: string | null;
    areaDesc?: string;
    geocode?: { UGC?: string[] };
    parameters?: Record<string, string[] | undefined>;
    references?: { identifier?: string }[];
  };
}

const first = (v: string[] | undefined): string | undefined => v?.[0];

export function normalizeAlert(f: RawAlertFeature): Alert {
  const p = f.properties;
  const par = p.parameters ?? {};
  const params: AlertParams = {};
  const t = first(par.tornadoDetection);
  if (t) params.tornadoDetection = t;
  const td = first(par.tornadoDamageThreat);
  if (td) params.tornadoDamageThreat = td;
  const sd = first(par.thunderstormDamageThreat);
  if (sd) params.thunderstormDamageThreat = sd;
  const fd = first(par.flashFloodDamageThreat);
  if (fd) params.flashFloodDamageThreat = fd;
  const hs = first(par.maxHailSize);
  if (hs) params.maxHailSize = hs;
  const wg = first(par.maxWindGust);
  if (wg) params.maxWindGust = wg;
  const em = first(par.eventMotionDescription);
  if (em) params.eventMotionDescription = em.slice(0, 400);

  const sevRaw = p.severity ?? "Unknown";
  const severity = (["Extreme", "Severe", "Moderate", "Minor"].includes(sevRaw) ? sevRaw : "Unknown") as Alert["severity"];

  return {
    id: p.id ?? f.id ?? crypto.randomUUID(),
    event: p.event ?? "Alert",
    ...(p.senderName ? { senderName: p.senderName.slice(0, 80) } : {}),
    severity,
    urgency: p.urgency ?? "Unknown",
    certainty: p.certainty ?? "Unknown",
    headline: p.headline ?? "",
    description: p.description ?? "",
    instruction: p.instruction ?? "",
    sent: p.sent ?? new Date().toISOString(),
    onset: p.onset ?? null,
    expires: p.ends ?? p.expires ?? null,
    areaDesc: p.areaDesc ?? "",
    zones: p.geocode?.UGC ?? [],
    geometry: f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon") ? f.geometry : null,
    params,
    ...(p.references?.length
      ? { references: p.references.map((r) => r.identifier).filter((x): x is string => !!x).slice(0, 10) }
      : {}),
  };
}

/** All active US alerts (actual, non-test). */
export async function fetchActiveAlerts(env: Env): Promise<Alert[]> {
  const data = (await nwsFetch(env, "/alerts/active?status=actual&message_type=alert,update")) as {
    features?: RawAlertFeature[];
  };
  return (data.features ?? []).map(normalizeAlert);
}

const lastSeg = (url: string | undefined | null): string | null => (url ? (url.split("/").pop() ?? null) : null);

/** NWS /points lookup. Throws for non-US coordinates (404). */
export async function fetchPoint(env: Env, lat: number, lon: number): Promise<Place> {
  const d = (await nwsFetch(env, `/points/${lat.toFixed(4)},${lon.toFixed(4)}`)) as {
    properties: {
      gridId?: string;
      gridX?: number;
      gridY?: number;
      timeZone?: string;
      forecastZone?: string;
      county?: string;
      fireWeatherZone?: string;
      relativeLocation?: { properties?: { city?: string; state?: string } };
    };
  };
  const p = d.properties;
  const rel = p.relativeLocation?.properties;
  return {
    lat,
    lon,
    name: rel?.city ?? `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
    state: rel?.state ?? null,
    tz: p.timeZone ?? "America/New_York",
    office: p.gridId ?? null,
    gridX: p.gridX ?? null,
    gridY: p.gridY ?? null,
    forecastZone: lastSeg(p.forecastZone),
    countyZone: lastSeg(p.county),
    fireZone: lastSeg(p.fireWeatherZone),
  };
}

export async function fetchForecastText(
  env: Env,
  office: string,
  x: number,
  y: number,
): Promise<{ name: string; detailed: string }[]> {
  const d = (await nwsFetch(env, `/gridpoints/${office}/${x},${y}/forecast`)) as {
    properties?: { periods?: { name: string; detailedForecast: string }[] };
  };
  return (d.properties?.periods ?? []).map((p) => ({ name: p.name, detailed: p.detailedForecast }));
}
