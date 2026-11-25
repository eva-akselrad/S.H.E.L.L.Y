// NOAA GOES-19 (GOES-East) Geostationary Lightning Mapper, Level 2 "LCFA" files: public domain, no key.
// Three files a minute (20 s each). Files are netCDF-4 (HDF5), read with the pure-JS jsfive reader
// (about 16 ms of CPU for a 330 KB file, measured in the L0 spike).
import { File } from "jsfive";
import type { BboxLike, Flash } from "../../shared/lightning";

export const GLM_BUCKET = "https://noaa-goes19.s3.amazonaws.com";
const PREFIX = "GLM-L2-LCFA";
/** seconds from 2000-01-01T12:00:00Z (the netCDF time epoch) to the Unix epoch */
const J2000 = 946_728_000;
/** flash_time_offset_of_first_event is stored as unsigned 16-bit: seconds = raw * 0.0003814756 - 5 (read from the file's attributes) */
const T_SCALE = 0.0003814756;
const T_ADD = -5;

export interface GlmFile {
  key: string;
  /** end of the file's 20-second window, ms */
  endMs: number;
}

/** OR_GLM-L2-LCFA_G19_s20263292100000_e20263292100200_c20263292100215.nc: sYYYYDDDHHMMSSt */
export function parseGlmStamp(stamp: string): number | null {
  const m = /^(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})\d$/.exec(stamp);
  if (!m) return null;
  const [, y, doy, hh, mm, ss] = m;
  return Date.UTC(Number(y), 0, Number(doy), Number(hh), Number(mm), Number(ss));
}

export function glmFileEnd(key: string): number | null {
  const m = /_e(\d{14})_c/.exec(key);
  return m ? parseGlmStamp(m[1]!) : null;
}

/** The S3 key prefix for an hour: GLM-L2-LCFA/YYYY/DDD/HH/ */
export function hourPrefix(ms: number): string {
  const d = new Date(ms);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const doy = Math.floor((ms - start) / 86_400_000) + 1;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${PREFIX}/${d.getUTCFullYear()}/${p(doy, 3)}/${p(d.getUTCHours())}/`;
}

export function parseListing(xml: string): string[] {
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!).filter((k) => k.endsWith(".nc"));
}

/** Files newer than `afterKey` (keys sort by time), looking back at most `lookbackMs`. */
export async function listNewFiles(now: number, afterKey: string | null, lookbackMs: number, fetcher: typeof fetch = fetch): Promise<GlmFile[]> {
  const hours = new Set([hourPrefix(now - lookbackMs), hourPrefix(now)]);
  const keys: string[] = [];
  for (const prefix of [...hours].sort()) {
    const start = afterKey && afterKey.startsWith(prefix) ? `&start-after=${encodeURIComponent(afterKey)}` : "";
    const res = await fetcher(`${GLM_BUCKET}/?list-type=2&prefix=${prefix}${start}`);
    if (!res.ok) throw new Error(`glm list ${res.status}`);
    keys.push(...parseListing(await res.text()));
  }
  return keys
    .filter((k) => !afterKey || k > afterKey)
    .sort()
    .map((key) => ({ key, endMs: glmFileEnd(key) ?? 0 }))
    .filter((f) => f.endMs >= now - lookbackMs);
}

export interface ParsedGlm {
  /** start of the 20 s window, ms */
  startMs: number;
  /** good-quality flashes inside the bbox, lat/lon rounded to 0.01 degrees */
  flashes: Flash[];
  /** all flashes in the file, before filtering */
  total: number;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Read one GLM L2 LCFA file and keep good-quality flashes inside `bbox`. */
export function parseGlm(buf: ArrayBuffer, bbox: BboxLike): ParsedGlm {
  const f = new File(buf, "glm.nc");
  const get = (name: string) => {
    const d = f.get(name);
    if (!d) throw new Error(`glm: missing ${name}`);
    return d.value;
  };
  const lat = get("flash_lat");
  const lon = get("flash_lon");
  const off = get("flash_time_offset_of_first_event");
  const q = get("flash_quality_flag");
  const pt = get("product_time");
  const startMs = (J2000 + Number(pt[0])) * 1000;
  const flashes: Flash[] = [];
  for (let i = 0; i < lat.length; i++) {
    const la = lat[i]!;
    const lo = lon[i]!;
    if (q[i] !== 0) continue; // 0 = good; anything else is a degraded flash
    if (la < bbox.south || la > bbox.north || lo < bbox.west || lo > bbox.east) continue;
    const sec = (off[i]! & 0xffff) * T_SCALE + T_ADD;
    flashes.push([r2(la), r2(lo), Math.round(startMs + sec * 1000)]);
  }
  return { startMs, flashes, total: lat.length };
}

export async function fetchGlm(key: string, bbox: BboxLike, fetcher: typeof fetch = fetch): Promise<ParsedGlm> {
  const res = await fetcher(`${GLM_BUCKET}/${key}`);
  if (!res.ok) throw new Error(`glm file ${res.status}`);
  return parseGlm(await res.arrayBuffer(), bbox);
}
