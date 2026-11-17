// SHELLY grades itself, for the site's default location:
//  1. each morning, save the forecast high/low for 1 and 3 days ahead
//  2. the day after a target date, compare with what the nearest NWS station measured
// Runs from the cron at most once an hour (cheap KV gate).
import { addDays, dayExtremes, gradeDay, summarize, type GradedDay, type GradeSummary, type Prediction } from "../shared/grade";
import { localDate, localHour } from "../shared/nowcast";
import { fetchNearestStation, fetchObservations } from "./sources/extra";
import { fetchOpenMeteo, normalizeForecast } from "./sources/openmeteo";
import { readConfig } from "./store";

const HISTORY_KEY = "grade:history";
const GATE_KEY = "grade:last";
const LEADS = [1, 3];

const predKey = (target: string) => `grade:pred:${target}`;

export async function readGradeHistory(env: Env): Promise<GradedDay[]> {
  return (await env.STATE.get<GradedDay[]>(HISTORY_KEY, "json")) ?? [];
}

export async function gradeSummary(env: Env): Promise<GradeSummary & { history: GradedDay[] }> {
  const history = await readGradeHistory(env);
  return { ...summarize(history), history: history.slice(0, 14) };
}

/** Offset of a zone from UTC at an instant, in ms (e.g. -5 h for New York in winter). */
function zoneOffsetMs(tz: string, at: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - at;
}

/** Local midnight of `date` in `tz`, as a UTC instant. */
function localMidnight(date: string, tz: string): number {
  const guess = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return guess - zoneOffsetMs(tz, guess);
}

export async function runGrading(env: Env, now = Date.now()): Promise<void> {
  const last = await env.STATE.get(GATE_KEY);
  if (last && now - Number(last) < 55 * 60_000) return;
  await env.STATE.put(GATE_KEY, String(now));

  const place = (await readConfig(env)).defaultLocation;
  if (!place) return;
  const tz = place.tz;
  const today = localDate(tz, new Date(now));

  // 1. snapshot today's forecast once, after 6 AM local (the "morning forecast")
  const snapKey = `grade:snap:${today}`;
  if (localHour(tz, new Date(now)) >= 6 && !(await env.STATE.get(snapKey))) {
    const f = normalizeForecast(await fetchOpenMeteo(place.lat, place.lon));
    for (const lead of LEADS) {
      const target = addDays(today, lead);
      const d = f.daily.find((x) => x.date === target);
      if (!d) continue;
      const list = (await env.STATE.get<Prediction[]>(predKey(target), "json")) ?? [];
      if (!list.some((p) => p.lead === lead)) {
        list.push({ issued: today, lead, hi: Math.round(d.hi), lo: Math.round(d.lo) });
        await env.STATE.put(predKey(target), JSON.stringify(list), { expirationTtl: 10 * 86400 });
      }
    }
    await env.STATE.put(snapKey, "1", { expirationTtl: 3 * 86400 });
  }

  // 2. grade yesterday once its observations are in (after 2 AM local today)
  const yesterday = addDays(today, -1);
  const history = await readGradeHistory(env);
  if (localHour(tz, new Date(now)) < 2 || history.some((h) => h.date === yesterday)) return;
  const preds = (await env.STATE.get<Prediction[]>(predKey(yesterday), "json")) ?? [];
  if (!preds.length || !place.office || place.gridX === null || place.gridY === null) return;

  const stationKey = `grade:station:${place.office}:${place.gridX},${place.gridY}`;
  let station = await env.STATE.get(stationKey);
  if (!station) {
    station = await fetchNearestStation(env, place.office, place.gridX, place.gridY);
    if (!station) return;
    await env.STATE.put(stationKey, station, { expirationTtl: 30 * 86400 });
  }
  const start = localMidnight(yesterday, tz);
  const obs = await fetchObservations(env, station, new Date(start).toISOString(), new Date(start + 86_400_000).toISOString());
  const ext = dayExtremes(obs);
  if (!ext) return; // too few readings; try again next hour
  const graded = gradeDay(yesterday, station, ext, preds);
  await env.STATE.put(HISTORY_KEY, JSON.stringify([graded, ...history].slice(0, 120)));
}
