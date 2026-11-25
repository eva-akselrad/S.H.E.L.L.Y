// Iowa Environmental Mesonet (IEM): local storm reports, storm-based warning polygons and ASOS peak gusts.
// Free to use, public domain, attribution appreciated: https://mesonet.agron.iastate.edu/disclaimer.php
// Parameter names verified against each service's own ?help page on 2026-11-25:
//   /geojson/lsr.geojson  west,east,north,south + sts,ets (UTC ISO)
//   /geojson/sbw.geojson  wfo + sts,ets
//   /cgi-bin/request/asos.py  network (repeatable), data (repeatable), sts, ets, tz, latlon, format=onlycomma
// asos.py has a 1 second per-IP throttle, so it is called once per report.
import { parseAsosGusts, parseIemLsr, parseIemSbw, type Gust, type Lsr, type WarningRec } from "../../shared/damage";

const BASE = "https://mesonet.agron.iastate.edu";

async function get(url: string, ua: string): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": ua } });
  if (!res.ok) throw new Error(`IEM ${res.status}`);
  return res;
}

export async function fetchIemLsr(ua: string, lat: number, lon: number, startMs: number, endMs: number): Promise<Lsr[]> {
  const dLat = 0.3; // about 20 mi, comfortably past the 10 mi report radius
  const dLon = dLat / Math.max(0.3, Math.cos((lat * Math.PI) / 180));
  const q = new URLSearchParams({
    west: String(lon - dLon),
    east: String(lon + dLon),
    south: String(lat - dLat),
    north: String(lat + dLat),
    sts: new Date(startMs).toISOString(),
    ets: new Date(endMs).toISOString(),
  });
  return parseIemLsr(await (await get(`${BASE}/geojson/lsr.geojson?${q}`, ua)).json());
}

export async function fetchIemSbw(ua: string, wfo: string, startMs: number, endMs: number): Promise<WarningRec[]> {
  const q = new URLSearchParams({ wfo, sts: new Date(startMs).toISOString(), ets: new Date(endMs).toISOString() });
  return parseIemSbw(await (await get(`${BASE}/geojson/sbw.geojson?${q}`, ua)).json());
}

export async function fetchIemGusts(ua: string, networks: string[], startMs: number, endMs: number): Promise<Gust[]> {
  if (!networks.length) return [];
  const q = new URLSearchParams();
  for (const d of ["gust", "peak_wind_gust", "peak_wind_time"]) q.append("data", d);
  for (const n of networks) q.append("network", n);
  q.set("latlon", "yes");
  q.set("tz", "UTC");
  q.set("format", "onlycomma");
  q.set("missing", "empty");
  q.set("sts", new Date(startMs).toISOString());
  q.set("ets", new Date(endMs).toISOString());
  return parseAsosGusts(await (await get(`${BASE}/cgi-bin/request/asos.py?${q}`, ua)).text());
}
