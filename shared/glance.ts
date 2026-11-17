// The tiny payload the SHELLY Android app (widget + notifications) reads. Pure and tested.
// Safety rule: alert wording comes only from NWS fields and the templates in actions.ts. Never an LLM.
import { actionFor, type SafetyPlan } from "./actions";
import { localHour, localNow, rainNowcast } from "./nowcast";
import { alertCoversPoint, alertLevel, computeThreat } from "./threat";
import type { Alert, Forecast, Place, ThreatLevel } from "./types";
import { wmoToWeather } from "./wx";

export interface GlanceAlert {
  /** this message's id, plus the ids it updates. NWS orders `refs` arbitrarily, so the app
   *  treats any shared id as "the same alert" instead of trusting an order. */
  id: string;
  refs: string[];
  event: string;
  level: ThreatLevel;
  expires: string | null;
  areaDesc: string;
  headline: string;
  action: { urgency: string; title: string; steps: string[] } | null;
}

export interface GlancePayload {
  v: 1;
  updated: string;
  alertsUpdated: string | null;
  place: { name: string; state: string | null; tz: string; zones: string[] };
  now: { temp: number; feels: number; code: number; isDay: boolean; desc: string; icon: string } | null;
  today: { hi: number; lo: number } | null;
  rain: string | null;
  level: ThreatLevel;
  alerts: GlanceAlert[];
}

export interface GlanceInput {
  now: Date;
  place: Pick<Place, "lat" | "lon" | "name" | "state" | "tz" | "forecastZone" | "countyZone" | "fireZone">;
  forecast: Forecast | null;
  alerts: Alert[];
  alertsUpdated: string | null;
  safety?: SafetyPlan;
}

const RANK: Record<ThreatLevel, number> = { CALM: 0, ELEVATED: 1, WARNING: 2, EMERGENCY: 3 };

export function placeZones(p: Pick<Place, "forecastZone" | "countyZone" | "fireZone">): string[] {
  return [...new Set([p.forecastZone, p.countyZone, p.fireZone].filter((z): z is string => !!z))];
}

export function buildGlance(input: GlanceInput): GlancePayload {
  const { now, place, forecast: fc } = input;
  const zones = placeZones(place);
  const point = { lat: place.lat, lon: place.lon, zones };
  const hour = localHour(place.tz, now);

  const covering = input.alerts
    .filter((a) => !a.expires || Date.parse(a.expires) > now.getTime())
    .filter((a) => alertCoversPoint(a, point))
    .filter((a) => alertLevel(a) !== "CALM");

  const alerts: GlanceAlert[] = covering
    .map((a) => {
      const card = actionFor(a, hour, input.safety);
      return {
        id: a.id,
        refs: (a.references ?? []).slice(0, 10),
        event: a.event,
        level: alertLevel(a),
        expires: a.expires,
        areaDesc: a.areaDesc.slice(0, 200),
        headline: a.headline.slice(0, 300),
        action: card ? { urgency: card.urgency, title: card.title, steps: card.steps.slice(0, 4) } : null,
      };
    })
    .sort((x, y) => RANK[y.level] - RANK[x.level]);

  const nowcast = fc?.nowcast ?? [];
  const cape = Math.max(0, ...(fc?.hourly.slice(0, 6).map((h) => h.cape) ?? []));
  const threat = computeThreat({ alerts: input.alerts, point, nowcast, cape, now });

  let nowBlock: GlancePayload["now"] = null;
  if (fc) {
    const w = wmoToWeather(fc.current.code, fc.current.isDay);
    nowBlock = { temp: Math.round(fc.current.temp), feels: Math.round(fc.current.feelsLike), code: fc.current.code, isDay: fc.current.isDay, desc: w.desc, icon: w.icon };
  }
  const day = fc?.daily[0];
  const rain = fc?.nowcast.length ? rainNowcast(fc.nowcast, localNow(place.tz, now), fc.hourly).sentence || null : null;

  return {
    v: 1,
    updated: now.toISOString(),
    alertsUpdated: input.alertsUpdated,
    place: { name: place.name, state: place.state, tz: place.tz, zones },
    now: nowBlock,
    today: day ? { hi: Math.round(day.hi), lo: Math.round(day.lo) } : null,
    rain,
    level: threat.level,
    alerts,
  };
}
