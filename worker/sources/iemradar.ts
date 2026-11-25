import type { RadarFrames } from "../../shared/types";

/** Iowa Environmental Mesonet NEXRAD national mosaic (N0Q), one frame every 5 minutes. Public domain. */
export const IEM_HOST = "https://mesonet.agron.iastate.edu";
const STEP_S = 300;
const FRAME_COUNT = 12; // 55 minutes of history

/** Frames are generated from the newest valid time in IEM's own list: every 5 min, oldest first. */
export function framesFromLatest(latestUnix: number): RadarFrames["frames"] {
  const end = Math.floor(latestUnix / STEP_S) * STEP_S;
  return Array.from({ length: FRAME_COUNT }, (_, n) => {
    const time = end - (FRAME_COUNT - 1 - n) * STEP_S;
    return { time, path: `/c/tile.py/1.0.0/${layerName(time)}` };
  });
}

/** `ridge::USCOMP-N0Q-YYYYMMDDHHMM` (UTC) */
export function layerName(unix: number): string {
  const d = new Date(unix * 1000).toISOString(); // 2026-11-25T20:55:00.000Z
  return `ridge::USCOMP-N0Q-${d.slice(0, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${d.slice(11, 13)}${d.slice(14, 16)}`;
}

export function parseLatest(json: unknown): number | null {
  const services = (json as { services?: { id?: string; utc_valid?: string }[] } | null)?.services;
  const n0q = services?.find((s) => s.id === "ridge_uscomp_n0q");
  const t = n0q?.utc_valid ? Date.parse(n0q.utc_valid) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

export async function fetchRadarFrames(): Promise<RadarFrames> {
  const res = await fetch(`${IEM_HOST}/json/tms.json`);
  if (!res.ok) throw new Error(`IEM ${res.status}`);
  const latest = parseLatest(await res.json());
  if (latest === null) throw new Error("IEM: no N0Q layer listed");
  return { host: IEM_HOST, frames: framesFromLatest(latest) };
}

/**
 * Tile proxy rules: only frame times IEM could have (on the 5 minute grid, within the last 2 hours), only z 0..7,
 * x/y inside the grid. Checked by arithmetic, so a tile request never waits on a second upstream call.
 */
export function tileUpstream(nowSec: number, frame: string, z: string, x: string, y: string): string | null {
  const t = Number(frame);
  if (!Number.isInteger(t) || t % STEP_S !== 0 || t > nowSec + STEP_S || t < nowSec - 7200) return null;
  if (![z, x, y].every((s) => /^\d{1,4}$/.test(s))) return null;
  const zn = Number(z);
  if (zn > 7) return null;
  if (Number(x) >= 2 ** zn || Number(y) >= 2 ** zn) return null;
  return `${IEM_HOST}/c/tile.py/1.0.0/${layerName(t)}/${z}/${x}/${y}.png`;
}
