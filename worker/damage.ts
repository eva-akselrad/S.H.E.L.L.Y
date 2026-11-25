// GET /api/damage?lat=&lon=&date=YYYY-MM-DD[&days=1..3]: the data behind the printable storm report.
// Only coordinates reach the server (never the typed address) and nothing is stored: Cache API only.
import {
  MAX_RANGE_DAYS,
  addDays,
  asosNetworks,
  buildDamageReport,
  dateProblem,
  dayWindow,
  lsrsFromSpc,
  type DamageReport,
  type Gust,
  type Lsr,
  type WarningRec,
} from "../shared/damage";
import { localHourString } from "../shared/gridpoint";
import { cached, round } from "./cache";
import { isAuthed } from "./auth";
import { coords, loadPlace } from "./loaders";
import { fetchIemGusts, fetchIemLsr, fetchIemSbw } from "./sources/iem";
import { fetchStormReports } from "./sources/extra";

const bad = (error: string): Response => Response.json({ error }, { status: 400, headers: { "cache-control": "no-store" } });

/** Carries a partial report out of cached() so a report with a failed source is not cached for hours. */
class Partial extends Error {
  constructor(readonly report: DamageReport) {
    super("partial");
  }
}

// Admin-only for now (the user's call): needs the same session cookie as /api/admin/*.
export async function handleDamage(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  if (!(await isAuthed(request, env))) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
  const c = coords(url);
  if (!c) return bad("bad_location");
  const date = url.searchParams.get("date") ?? "";
  const days = Math.min(MAX_RANGE_DAYS, Math.max(1, Math.floor(Number(url.searchParams.get("days") ?? 1)) || 1));

  const place = await loadPlace(env, ctx, c.lat, c.lon);
  const tz = place.tz || "America/New_York";
  const today = localHourString(Date.now(), tz).slice(0, 10);
  const problem = dateProblem(date, today);
  if (problem) return bad(problem);
  const lastDay = addDays(date, days - 1);
  const isToday = lastDay >= today;

  const ttl = isToday ? 600 : 21_600;
  const key = `damage:${round(c.lat, 4)}:${round(c.lon, 4)}:${date}:${days}`;
  const ua = env.NWS_USER_AGENT;
  try {
    const { data } = await cached<DamageReport>(ctx, key, ttl, async () => {
      const win = dayWindow(date, tz, 0, days - 1);
      const missing: string[] = [];
      const [lsr, sbw, gust, spc] = await Promise.allSettled([
        fetchIemLsr(ua, c.lat, c.lon, win.start, win.end),
        place.office ? fetchIemSbw(ua, place.office, win.start, win.end) : Promise.resolve([] as WarningRec[]),
        fetchIemGusts(ua, asosNetworks(place.state), win.start, win.end),
        // SPC's live files cover only the last ~48 h; IEM lags a little behind real time, so merge them for recent days
        win.end > Date.now() - 2 * 86_400_000 ? fetchStormReports(ua) : Promise.resolve([]),
      ]);
      const lsrs: Lsr[] = [];
      if (lsr.status === "fulfilled") lsrs.push(...lsr.value);
      else missing.push("storm reports");
      if (spc.status === "fulfilled") lsrs.push(...lsrsFromSpc(spc.value));
      let warnings: WarningRec[] = [];
      if (sbw.status === "fulfilled") warnings = sbw.value;
      else missing.push("warnings");
      let gusts: Gust[] = [];
      if (gust.status === "fulfilled") gusts = gust.value;
      else missing.push("wind gusts");
      const report = buildDamageReport({ point: c, date, tz, lsrs, warnings, gusts, daysAfter: days - 1, missing });
      if (missing.length) throw new Partial(report);
      return report;
    });
    return Response.json(data, { headers: { "cache-control": `public, max-age=${Math.min(ttl, 300)}` } });
  } catch (e) {
    if (e instanceof Partial) return Response.json(e.report, { headers: { "cache-control": "no-store" } });
    throw e;
  }
}

