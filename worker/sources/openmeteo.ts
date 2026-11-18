import type { AirQuality, Current, DayPoint, HourPoint } from "../../shared/types";

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const AQ = "https://air-quality-api.open-meteo.com/v1/air-quality";

export interface OpenMeteoRaw {
  current: Record<string, number | string>;
  hourly: Record<string, (number | string | null)[]>;
  daily: Record<string, (number | string | null)[]>;
  minutely_15?: Record<string, (number | string | null)[]>;
}

export function forecastUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: [
      "temperature_2m", "apparent_temperature", "relative_humidity_2m", "dew_point_2m", "precipitation",
      "weather_code", "cloud_cover", "surface_pressure", "wind_speed_10m", "wind_direction_10m",
      "wind_gusts_10m", "visibility", "uv_index", "is_day",
    ].join(","),
    hourly: [
      "temperature_2m", "apparent_temperature", "weather_code", "precipitation_probability",
      "precipitation", "wind_speed_10m", "cape",
    ].join(","),
    daily: [
      "weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_probability_max",
      "precipitation_sum", "snowfall_sum", "sunrise", "sunset", "uv_index_max",
      "wind_speed_10m_max", "wind_gusts_10m_max",
    ].join(","),
    minutely_15: "precipitation",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
    forecast_days: "10",
    forecast_hours: "48",
    forecast_minutely_15: "16",
  });
  return `${FORECAST}?${params}`;
}

export function aqUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: [
      "us_aqi", "pm2_5", "ozone", "alder_pollen", "birch_pollen", "grass_pollen",
      "mugwort_pollen", "olive_pollen", "ragweed_pollen",
    ].join(","),
    timezone: "auto",
  });
  return `${AQ}?${params}`;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function normalizeForecast(raw: OpenMeteoRaw): {
  current: Current;
  hourly: HourPoint[];
  daily: DayPoint[];
  nowcast: { time: string; precip: number }[];
} {
  const c = raw.current;
  const current: Current = {
    temp: num(c.temperature_2m),
    feelsLike: num(c.apparent_temperature),
    humidity: num(c.relative_humidity_2m),
    dewPoint: num(c.dew_point_2m),
    windSpeed: num(c.wind_speed_10m),
    windGust: num(c.wind_gusts_10m),
    windDir: num(c.wind_direction_10m),
    pressure: num(c.surface_pressure) * 0.02953, // hPa -> inHg
    visibilityMi: typeof c.visibility === "number" ? c.visibility / 1609.344 : null,
    uv: num(c.uv_index),
    cloud: num(c.cloud_cover),
    code: num(c.weather_code),
    isDay: c.is_day === 1,
    precip: num(c.precipitation),
    time: str(c.time),
  };

  const h = raw.hourly;
  const times = (h.time ?? []) as string[];
  const hourly: HourPoint[] = times.map((time, i) => ({
    time,
    temp: num(h.temperature_2m?.[i]),
    feelsLike: num(h.apparent_temperature?.[i]),
    code: num(h.weather_code?.[i]),
    pop: num(h.precipitation_probability?.[i]),
    precip: num(h.precipitation?.[i]),
    wind: num(h.wind_speed_10m?.[i]),
    cape: num(h.cape?.[i]),
  }));

  const d = raw.daily;
  const dates = (d.time ?? []) as string[];
  const daily: DayPoint[] = dates.map((date, i) => ({
    date,
    code: num(d.weather_code?.[i]),
    hi: num(d.temperature_2m_max?.[i]),
    lo: num(d.temperature_2m_min?.[i]),
    pop: num(d.precipitation_probability_max?.[i]),
    precip: num(d.precipitation_sum?.[i]),
    snow: num(d.snowfall_sum?.[i]),
    sunrise: str(d.sunrise?.[i]),
    sunset: str(d.sunset?.[i]),
    uvMax: num(d.uv_index_max?.[i]),
    windMax: num(d.wind_speed_10m_max?.[i]),
    gustMax: num(d.wind_gusts_10m_max?.[i]),
  }));

  const m = raw.minutely_15;
  const nowcast = ((m?.time ?? []) as string[]).map((time, i) => ({
    time,
    // threat engine thresholds are in mm; convert from inches
    precip: num(m?.precipitation?.[i]) * 25.4,
  }));

  return { current, hourly, daily, nowcast };
}

export function normalizeAirQuality(raw: { current?: Record<string, number | null> } | null): AirQuality {
  const c = raw?.current ?? {};
  const pollenKeys: [string, string][] = [
    ["alder_pollen", "Alder"], ["birch_pollen", "Birch"], ["grass_pollen", "Grass"],
    ["mugwort_pollen", "Mugwort"], ["olive_pollen", "Olive"], ["ragweed_pollen", "Ragweed"],
  ];
  return {
    aqi: typeof c.us_aqi === "number" ? c.us_aqi : null,
    pm25: typeof c.pm2_5 === "number" ? c.pm2_5 : null,
    ozone: typeof c.ozone === "number" ? c.ozone : null,
    pollen: pollenKeys
      .map(([k, type]) => ({ type, value: typeof c[k] === "number" ? (c[k] as number) : 0 }))
      .filter((p) => p.value > 0),
  };
}

export async function fetchOpenMeteo(lat: number, lon: number): Promise<OpenMeteoRaw> {
  const res = await fetch(forecastUrl(lat, lon));
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return (await res.json()) as OpenMeteoRaw;
}

export async function fetchAirQuality(lat: number, lon: number): Promise<AirQuality> {
  try {
    const res = await fetch(aqUrl(lat, lon));
    if (!res.ok) return normalizeAirQuality(null);
    return normalizeAirQuality((await res.json()) as { current?: Record<string, number | null> });
  } catch {
    return normalizeAirQuality(null);
  }
}

export interface CityNow {
  temp: number;
  code: number;
  isDay: boolean;
}

/** Current temp + weather code for many points in ONE request (Open-Meteo multi-location). */
export async function fetchCitiesNow(points: { lat: number; lon: number }[]): Promise<CityNow[]> {
  if (!points.length) return [];
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(","),
    longitude: points.map((p) => p.lon.toFixed(3)).join(","),
    current: "temperature_2m,weather_code,is_day",
    temperature_unit: "fahrenheit",
    timezone: "auto",
  });
  const res = await fetch(`${FORECAST}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = (await res.json()) as { current?: Record<string, number> } | { current?: Record<string, number> }[];
  const list = Array.isArray(d) ? d : [d];
  return list.map((x) => ({
    temp: num(x.current?.temperature_2m),
    code: num(x.current?.weather_code),
    isDay: num(x.current?.is_day, 1) === 1,
  }));
}

export interface CityDaily {
  high: number[];
  low: number[];
  feelsHigh: number[];
  pop: number[];
  gust: number[];
}

/** Daily highs/lows for many points in one request. Index 0 = today. */
export async function fetchCitiesDaily(points: { lat: number; lon: number }[]): Promise<CityDaily[]> {
  if (!points.length) return [];
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(","),
    longitude: points.map((p) => p.lon.toFixed(3)).join(","),
    daily: "temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max,wind_gusts_10m_max",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto",
    forecast_days: "4",
  });
  const res = await fetch(`${FORECAST}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = (await res.json()) as { daily?: Record<string, number[]> } | { daily?: Record<string, number[]> }[];
  return (Array.isArray(d) ? d : [d]).map((x) => ({
    high: x.daily?.temperature_2m_max ?? [],
    low: x.daily?.temperature_2m_min ?? [],
    feelsHigh: x.daily?.apparent_temperature_max ?? [],
    pop: x.daily?.precipitation_probability_max ?? [],
    gust: x.daily?.wind_gusts_10m_max ?? [],
  }));
}

/** Total snow or rain (inches) over the next `days` days at many points, one request. */
export async function fetchTotals(points: { lat: number; lon: number }[], kind: "snow" | "rain", days: number): Promise<number[]> {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(","),
    longitude: points.map((p) => p.lon.toFixed(3)).join(","),
    daily: kind === "snow" ? "snowfall_sum" : "precipitation_sum",
    precipitation_unit: "inch",
    timezone: "auto",
    forecast_days: String(Math.min(7, Math.max(1, days))),
  });
  const res = await fetch(`${FORECAST}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = (await res.json()) as { daily?: Record<string, (number | null)[]> } | { daily?: Record<string, (number | null)[]> }[];
  const key = kind === "snow" ? "snowfall_sum" : "precipitation_sum";
  return (Array.isArray(d) ? d : [d]).map((x) => Math.round((x.daily?.[key] ?? []).reduce<number>((s, v) => s + (v ?? 0), 0) * 10) / 10);
}

export interface HourlyRaw {
  time: string[];
  code: number[];
  precip: number[];
}

/** Next ~36 hours of weather code and precipitation for several points. */
export async function fetchCitiesHourly(points: { lat: number; lon: number }[]): Promise<HourlyRaw[]> {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(","),
    longitude: points.map((p) => p.lon.toFixed(3)).join(","),
    hourly: "weather_code,precipitation",
    precipitation_unit: "inch",
    timezone: "auto",
    forecast_days: "3",
  });
  const res = await fetch(`${FORECAST}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = (await res.json()) as { hourly?: Record<string, (number | string)[]> } | { hourly?: Record<string, (number | string)[]> }[];
  return (Array.isArray(d) ? d : [d]).map((x) => ({
    time: (x.hourly?.time ?? []) as string[],
    code: (x.hourly?.weather_code ?? []) as number[],
    precip: (x.hourly?.precipitation ?? []) as number[],
  }));
}

/**
 * Everything SHELLY Live's data blocks need for every city, in ONE multi-location request:
 * current conditions, 7 days, the next 24 hours, sun times and UV.
 */
export async function fetchRegionWx(cities: { name: string; state: string; lat: number; lon: number }[]): Promise<import("../../shared/live/blocks").RegionWx> {
  if (!cities.length) return { at: new Date().toISOString(), cities: [] };
  const params = new URLSearchParams({
    latitude: cities.map((p) => p.lat.toFixed(3)).join(","),
    longitude: cities.map((p) => p.lon.toFixed(3)).join(","),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto",
    forecast_days: "7",
    forecast_hours: "24",
  });
  const res = await fetch(`${FORECAST}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = (await res.json()) as OpenMeteoRaw | OpenMeteoRaw[];
  const list = Array.isArray(d) ? d : [d];
  return {
    at: new Date().toISOString(),
    cities: cities.map((c, i) => {
      const x = list[i];
      const cur = x?.current ?? {};
      const dl = x?.daily ?? {};
      const hr = x?.hourly ?? {};
      return {
        ...c,
        now: {
          temp: num(cur.temperature_2m), feels: num(cur.apparent_temperature), rh: num(cur.relative_humidity_2m), dew: num(cur.dew_point_2m),
          wind: num(cur.wind_speed_10m), gust: num(cur.wind_gusts_10m), dir: num(cur.wind_direction_10m), code: num(cur.weather_code), isDay: cur.is_day !== 0,
        },
        daily: ((dl.time ?? []) as string[]).map((date, k) => ({
          date, hi: num(dl.temperature_2m_max?.[k]), lo: num(dl.temperature_2m_min?.[k]), pop: num(dl.precipitation_probability_max?.[k]), code: num(dl.weather_code?.[k]),
        })),
        hourly: ((hr.time ?? []) as string[]).map((time, k) => ({ time, temp: num(hr.temperature_2m?.[k]), pop: num(hr.precipitation_probability?.[k]), code: num(hr.weather_code?.[k]) })),
        sunrise: str(dl.sunrise?.[0]),
        sunset: str(dl.sunset?.[0]),
        uv: num(dl.uv_index_max?.[0]),
      };
    }),
  };
}
