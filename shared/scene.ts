/** Weather "scenes": the look and mood of the whole display follows the conditions outside. */

export const SCENES = [
  { id: "clear-day", label: "Sunny" },
  { id: "heat", label: "Scorching" },
  { id: "partly-day", label: "Partly cloudy" },
  { id: "cloudy", label: "Overcast" },
  { id: "fog", label: "Fog" },
  { id: "drizzle", label: "Drizzle" },
  { id: "rain", label: "Rain" },
  { id: "storm", label: "Thunderstorm" },
  { id: "sleet", label: "Sleet / freezing rain" },
  { id: "snow", label: "Snow" },
  { id: "clear-night", label: "Clear night" },
  { id: "partly-night", label: "Cloudy night" },
] as const;

export type SceneId = (typeof SCENES)[number]["id"];
export const isSceneId = (v: unknown): v is SceneId => SCENES.some((s) => s.id === v);

/** Map an Open-Meteo WMO weather code (plus day/night and temperature) to a scene. */
export function pickScene(code: number, isDay: boolean, tempF = 70): SceneId {
  if (code >= 95 && code <= 99) return "storm";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([66, 67].includes(code)) return "sleet";
  if (code === 82) return "storm";
  if ([61, 63, 65, 81].includes(code) || code === 55) return "rain";
  if ([51, 53, 80].includes(code)) return "drizzle";
  if (code === 45 || code === 48) return "fog";
  if (code === 3) return isDay ? "cloudy" : "partly-night";
  if (code === 2) return isDay ? "partly-day" : "partly-night";
  // clear or mainly clear
  if (!isDay) return "clear-night";
  return tempF >= 95 ? "heat" : "clear-day";
}
