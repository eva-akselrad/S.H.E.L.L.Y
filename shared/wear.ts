// "What to wear": one friendly line for the day ahead. Calm-weather personality only; the app hides it
// during warnings.
import type { Forecast } from "./types";

export interface WearAdvice {
  line: string;
  /** the "feels like" range the advice was based on */
  low: number;
  high: number;
}

function layer(feels: number): string {
  if (feels < 10) return "your heaviest coat, a hat, gloves and a scarf";
  if (feels < 25) return "a heavy coat, hat and gloves";
  if (feels < 40) return "a warm coat";
  if (feels < 52) return "a jacket";
  if (feels < 62) return "a light jacket or sweater";
  if (feels < 75) return "long sleeves or a t-shirt";
  if (feels < 85) return "something light";
  return "light, loose clothes";
}

/**
 * @param nowLocal local wall time "YYYY-MM-DDTHH:mm" (matches the forecast's hourly times)
 * @param hours how much of the day ahead to cover (default 12)
 */
export function whatToWear(f: Forecast, nowLocal: string, hours = 12): WearAdvice | null {
  const t0 = Date.parse(nowLocal) - 30 * 60_000;
  const ahead = f.hourly.filter((h) => Date.parse(h.time) >= t0).slice(0, hours);
  if (!ahead.length) return null;
  const feels = ahead.map((h) => h.feelsLike);
  const low = Math.round(Math.min(...feels));
  const high = Math.round(Math.max(...feels));

  const parts: string[] = [];
  // dress for the coldest part of the time you'll be out, mention layers when it swings a lot
  const base = layer(low);
  parts.push(high - low >= 18 ? `Layers: ${base} now, ${layer(high)} later.` : `Wear ${base}.`);

  const wetHour = ahead.find((h) => h.pop >= 50 || h.precip >= 0.02);
  if (wetHour) {
    const snowy = [71, 73, 75, 77, 85, 86].includes(wetHour.code);
    const when = new Date(wetHour.time.length === 16 ? `${wetHour.time}:00` : wetHour.time);
    const hr = when.getHours();
    const label = `${hr % 12 || 12} ${hr < 12 ? "AM" : "PM"}`;
    const nowHr = new Date(nowLocal).getHours();
    const soon = hr === nowHr;
    parts.push(snowy ? `Boots for snow${soon ? "" : ` after ${label}`}.` : `Take an umbrella${soon ? "" : ` (rain after ${label})`}.`);
  }
  const windy = ahead.some((h) => h.wind >= 22);
  if (windy) parts.push(wetHour ? "It'll be windy too, so a hood beats an umbrella." : "It'll be windy, so zip up.");
  const uv = f.daily[0]?.uvMax ?? 0;
  if (uv >= 7 && high >= 60) parts.push("Sunscreen and sunglasses: the UV is high.");
  return { line: parts.join(" "), low, high };
}
