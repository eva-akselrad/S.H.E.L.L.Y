// Pure weather helpers ported from SHELLY v1 (legacy-v1:js/weather.js), typed.

export type IconKey = "sun" | "moon" | "partly" | "cloud" | "fog" | "drizzle" | "rain" | "snow" | "sleet" | "storm" | "unknown";

const WMO: Record<number, { desc: string; icon: IconKey }> = {
  0: { desc: "Clear sky", icon: "sun" },
  1: { desc: "Mainly clear", icon: "sun" },
  2: { desc: "Partly cloudy", icon: "partly" },
  3: { desc: "Overcast", icon: "cloud" },
  45: { desc: "Fog", icon: "fog" },
  48: { desc: "Icy fog", icon: "fog" },
  51: { desc: "Light drizzle", icon: "drizzle" },
  53: { desc: "Drizzle", icon: "drizzle" },
  55: { desc: "Heavy drizzle", icon: "rain" },
  61: { desc: "Light rain", icon: "rain" },
  63: { desc: "Rain", icon: "rain" },
  65: { desc: "Heavy rain", icon: "rain" },
  66: { desc: "Light freezing rain", icon: "sleet" },
  67: { desc: "Freezing rain", icon: "sleet" },
  71: { desc: "Light snow", icon: "snow" },
  73: { desc: "Snow", icon: "snow" },
  75: { desc: "Heavy snow", icon: "snow" },
  77: { desc: "Snow grains", icon: "snow" },
  80: { desc: "Light showers", icon: "drizzle" },
  81: { desc: "Showers", icon: "rain" },
  82: { desc: "Heavy showers", icon: "storm" },
  85: { desc: "Snow showers", icon: "snow" },
  86: { desc: "Heavy snow showers", icon: "snow" },
  95: { desc: "Thunderstorm", icon: "storm" },
  96: { desc: "Thunderstorm with hail", icon: "storm" },
  99: { desc: "Thunderstorm with heavy hail", icon: "storm" },
};

export function wmoToWeather(code: number, isDay = true): { desc: string; icon: IconKey } {
  const w = WMO[code] ?? { desc: "Unknown", icon: "unknown" as IconKey };
  if (!isDay && (code === 0 || code === 1)) return { ...w, icon: "moon" };
  return w;
}

const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export function windDir(deg: number): string {
  return DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]!;
}

export function aqiLabel(v: number): { label: string; color: string } {
  if (v <= 50) return { label: "Good", color: "#00c846" };
  if (v <= 100) return { label: "Moderate", color: "#ffd000" };
  if (v <= 150) return { label: "Unhealthy for sensitive groups", color: "#ff6600" };
  if (v <= 200) return { label: "Unhealthy", color: "#e03131" };
  if (v <= 300) return { label: "Very unhealthy", color: "#a61e4d" };
  return { label: "Hazardous", color: "#7d0023" };
}

export function pollenLevel(v: number): { label: string; rank: number } {
  if (v <= 0) return { label: "None", rank: 0 };
  if (v <= 10) return { label: "Low", rank: 1 };
  if (v <= 50) return { label: "Moderate", rank: 2 };
  if (v <= 200) return { label: "High", rank: 3 };
  return { label: "Very high", rank: 4 };
}

export function uvLabel(v: number): string {
  if (!Number.isFinite(v)) return "--";
  const s = v.toFixed(0);
  if (v <= 2) return `${s} · Low`;
  if (v <= 5) return `${s} · Moderate`;
  if (v <= 7) return `${s} · High`;
  if (v <= 10) return `${s} · Very high`;
  return `${s} · Extreme`;
}

/** NWS Rothfusz regression. Null unless it is warm enough to matter. */
export function heatIndex(tempF: number, rh: number): number | null {
  if (tempF < 80) return null;
  const hi =
    -42.379 + 2.04901523 * tempF + 10.14333127 * rh - 0.22475541 * tempF * rh - 0.00683783 * tempF * tempF -
    0.05481717 * rh * rh + 0.00122874 * tempF * tempF * rh + 0.00085282 * tempF * rh * rh -
    0.00000199 * tempF * tempF * rh * rh;
  return Math.round(hi);
}

/** NWS wind chill. Null unless cold and windy. */
export function windChill(tempF: number, windMph: number): number | null {
  if (tempF > 50 || windMph < 3) return null;
  const p = Math.pow(windMph, 0.16);
  return Math.round(35.74 + 0.6215 * tempF - 35.75 * p + 0.4275 * tempF * p);
}

const MOON: [string, number][] = [
  ["New moon", 1.85], ["Waxing crescent", 7.38], ["First quarter", 11.08], ["Waxing gibbous", 14.77],
  ["Full moon", 16.61], ["Waning gibbous", 22.15], ["Last quarter", 25.84], ["Waning crescent", 29.53],
];
export function moonPhase(date = new Date()): { name: string; age: number } {
  const days = (date.getTime() - Date.UTC(2024, 0, 11)) / 86400000;
  const age = ((days % 29.53059) + 29.53059) % 29.53059;
  const hit = MOON.find(([, max]) => age < max);
  return { name: hit ? hit[0] : "New moon", age };
}

export function fmtDayLength(sunrise: string, sunset: string): string {
  const ms = new Date(sunset).getTime() - new Date(sunrise).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

export function fmtTemp(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "--" : `${Math.round(v)}°`;
}
