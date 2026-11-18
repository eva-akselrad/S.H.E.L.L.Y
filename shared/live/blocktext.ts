// Deterministic headlines and spoken lines for the data blocks. No LLM text.
import { moonPhase, wmoToWeather } from "../wx";
import type { BlockId, CityFull, RegionWx } from "./blocks";

const r = (n: number) => Math.round(n);
const lowCase = (s: string) => s.toLowerCase();

export function pickCity(wx: RegionWx, name?: string): CityFull | undefined {
  return (name && wx.cities.find((c) => c.name.toLowerCase() === name.toLowerCase())) || wx.cities[0];
}

const extreme = (wx: RegionWx, f: (c: CityFull) => number): { hi: CityFull; lo: CityFull } | null => {
  if (!wx.cities.length) return null;
  const sorted = [...wx.cities].sort((a, b) => f(b) - f(a));
  return { hi: sorted[0]!, lo: sorted[sorted.length - 1]! };
};

/** Saturday and Sunday indexes in the daily list (skips today if it's Sunday evening, keeps it otherwise). */
export function weekendDays(c: CityFull): number[] {
  const out: number[] = [];
  c.daily.forEach((d, i) => {
    const wd = new Date(`${d.date}T12:00:00Z`).getUTCDay();
    if ((wd === 6 || wd === 0) && out.length < 2) out.push(i);
  });
  return out;
}

export function blockText(block: BlockId, wx: RegionWx | null, city?: string, regionName = "region", now = Date.now()): { headline: string; speak?: string } | null {
  if (!wx || !wx.cities.length) return null;
  const c = pickCity(wx, city)!;
  switch (block) {
    case "tempsNow": {
      const e = extreme(wx, (x) => x.now.temp)!;
      return { headline: "TEMPERATURES RIGHT NOW", speak: `Around the ${regionName} right now, ${e.hi.name} is warmest at ${r(e.hi.now.temp)} degrees, and ${e.lo.name} is coolest at ${r(e.lo.now.temp)}.` };
    }
    case "feelsNow": {
      const e = extreme(wx, (x) => x.now.feels)!;
      return { headline: "WHAT IT FEELS LIKE", speak: `Factoring in wind and humidity, it feels like ${r(e.lo.now.feels)} in ${e.lo.name} and ${r(e.hi.now.feels)} in ${e.hi.name}.` };
    }
    case "highs": {
      const e = extreme(wx, (x) => x.daily[0]?.hi ?? 0)!;
      return { headline: "TODAY'S HIGHS", speak: `Highs today range from ${r(e.lo.daily[0]?.hi ?? 0)} in ${e.lo.name} to ${r(e.hi.daily[0]?.hi ?? 0)} in ${e.hi.name}.` };
    }
    case "lows": {
      const e = extreme(wx, (x) => x.daily[1]?.lo ?? 0)!;
      return { headline: "TONIGHT'S LOWS", speak: `Tonight, lows drop to ${r(e.lo.daily[1]?.lo ?? 0)} in ${e.lo.name}, with ${e.hi.name} holding near ${r(e.hi.daily[1]?.lo ?? 0)}.` };
    }
    case "tomorrow": {
      const e = extreme(wx, (x) => x.daily[1]?.hi ?? 0)!;
      return { headline: "TOMORROW'S HIGHS", speak: `Tomorrow, highs reach ${r(e.hi.daily[1]?.hi ?? 0)} in ${e.hi.name} and ${r(e.lo.daily[1]?.hi ?? 0)} in ${e.lo.name}.` };
    }
    case "sevenDay": {
      const d = c.daily.slice(0, 7);
      if (!d.length) return null;
      const warm = d.reduce((a, b) => (b.hi > a.hi ? b : a));
      const day = new Date(`${warm.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      return { headline: `7-DAY FORECAST: ${c.name}`.toUpperCase(), speak: `Here's the seven day forecast for ${c.name}. The warmest day looks like ${day}, with a high near ${r(warm.hi)}.` };
    }
    case "hourly": {
      const h = c.hourly.slice(0, 12);
      if (!h.length) return null;
      const wet = h.reduce((a, b) => (b.pop > a.pop ? b : a));
      const temps = h.map((x) => x.temp);
      const rain = wet.pop >= 30 ? ` Rain chances peak near ${r(wet.pop)} percent.` : " It stays mostly dry.";
      return { headline: `NEXT 12 HOURS: ${c.name}`.toUpperCase(), speak: `Over the next twelve hours in ${c.name}, temperatures run from ${r(Math.min(...temps))} to ${r(Math.max(...temps))}.${rain}` };
    }
    case "rainChance": {
      const e = extreme(wx, (x) => x.daily[0]?.pop ?? 0)!;
      const top = r(e.hi.daily[0]?.pop ?? 0);
      return { headline: "CHANCE OF RAIN TODAY", speak: top < 15 ? "Rain chances are low across the region today." : `The best chance of rain today is around ${e.hi.name}, at ${top} percent.` };
    }
    case "wind": {
      const e = extreme(wx, (x) => x.now.gust)!;
      return { headline: "WIND RIGHT NOW", speak: e.hi.now.gust >= 20 ? `It's breezy. ${e.hi.name} has gusts to ${r(e.hi.now.gust)} miles per hour.` : "Winds are fairly light around the region right now." };
    }
    case "humidity": {
      const e = extreme(wx, (x) => x.now.dew)!;
      const dew = e.hi.now.dew;
      const feel = dew >= 70 ? "oppressive" : dew >= 65 ? "sticky" : dew >= 55 ? "a little humid" : dew >= 40 ? "comfortable" : "dry";
      return { headline: "DEW POINTS: HOW MUGGY IS IT?", speak: `Dew points top out near ${r(dew)} in ${e.hi.name}, so it feels ${feel}.` };
    }
    case "extremes": {
      const e = extreme(wx, (x) => x.now.temp)!;
      return { headline: "WARMEST AND COOLEST RIGHT NOW", speak: `${e.hi.name} leads the board at ${r(e.hi.now.temp)} degrees. ${e.lo.name} is the cool spot at ${r(e.lo.now.temp)}.` };
    }
    case "sun": {
      const fmt = (iso: string) => (iso ? new Date(`${iso}:00Z`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) : "");
      const moon = moonPhase(new Date(now)).name;
      return { headline: `SUN AND MOON: ${c.name}`.toUpperCase(), speak: `In ${c.name}, the sun rises at ${fmt(c.sunrise)} and sets at ${fmt(c.sunset)}. Tonight's moon is a ${lowCase(moon)}.` };
    }
    case "weekend": {
      const idx = weekendDays(c);
      if (!idx.length) return null;
      const parts = idx.map((i) => {
        const d = c.daily[i]!;
        const name = new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
        return `${name}, ${lowCase(wmoToWeather(d.code).desc)} with a high of ${r(d.hi)}`;
      });
      return { headline: `WEEKEND OUTLOOK: ${c.name}`.toUpperCase(), speak: `For the weekend in ${c.name}: ${parts.join(". ")}.` };
    }
    default:
      return null;
  }
}
