import { metersPerPixel } from "../../shared/radarflow";
import type { Motion } from "../../shared/live/track";
import type { RadarFrames } from "../../shared/types";
import type { FutureJob, FutureResult } from "../workers/radarflow.worker";

export interface View {
  south: number;
  west: number;
  north: number;
  east: number;
  zoom: number;
}
export interface FutureSet {
  frames: { lead: number; url: string }[];
  /** [[south, west], [north, east]] of the stitched area */
  bounds: [[number, number], [number, number]];
}

const MAX_COLS = 5;
const MAX_ROWS = 4;
const MAX_WORKER_MS = 8000;
/** tiles + worker + encode: if it is not ready by now (a slow TV, a slow link) we show past radar only */
const MAX_TOTAL_MS = 10000;

/** minutes ahead to draw: phone and kiosk +10..+30, desktop and Live +10..+60 */
export function futureLeads(mode: string): number[] {
  return mode === "phone" || mode === "kiosk" ? [10, 20, 30] : [10, 20, 30, 40, 50, 60];
}

const tx = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const ty = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const lonOf = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const latOf = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/**
 * Which tiles to read: the view plus one tile of margin so echoes just off screen still move in, at the map's own zoom
 * (max 7). A wide screen gets a window centred on the view (5×4 tiles), not the whole screen: that keeps a TV fast and the
 * dashed box on the map shows where the estimate covers.
 */
export function tileGrid(v: View): { z: number; x0: number; y0: number; cols: number; rows: number } {
  const z = Math.min(7, Math.max(3, Math.floor(v.zoom)));
  const n = 2 ** z;
  const span = (lo: number, hi: number, max: number): [number, number] => {
    let a = Math.floor(lo) - 1;
    let b = Math.floor(hi) + 1;
    if (b - a + 1 > max) {
      a = Math.round((lo + hi) / 2 - max / 2);
      b = a + max - 1;
    }
    a = Math.max(0, a);
    b = Math.min(n - 1, b);
    return [a, b];
  };
  const [x0, x1] = span(tx(v.west, z), tx(v.east, z), MAX_COLS);
  const [y0, y1] = span(ty(v.north, z), ty(v.south, z), MAX_ROWS);
  return { z, x0, y0, cols: x1 - x0 + 1, rows: y1 - y0 + 1 };
}

async function stitch(time: number, g: ReturnType<typeof tileGrid>): Promise<ImageData> {
  const canvas = document.createElement("canvas");
  canvas.width = g.cols * 256;
  canvas.height = g.rows * 256;
  const c = canvas.getContext("2d", { willReadFrequently: true })!;
  const jobs: Promise<void>[] = [];
  for (let r = 0; r < g.rows; r++) {
    for (let k = 0; k < g.cols; k++) {
      jobs.push(
        fetch(`/api/radar/tile/${time}/${g.z}/${g.x0 + k}/${g.y0 + r}`)
          .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`tile ${res.status}`))))
          .then((b) => createImageBitmap(b))
          .then((bmp) => { c.drawImage(bmp, k * 256, r * 256); bmp.close(); }),
      );
    }
  }
  await Promise.all(jobs);
  return c.getImageData(0, 0, canvas.width, canvas.height);
}

let logged = false;
const memo = new Map<string, Promise<FutureSet | null>>();

/**
 * Future radar frames for the current view: read the last two frames (10 min apart) through the tile proxy,
 * estimate motion and advect in a Web Worker, hand back image URLs. Null when the device is too slow or anything fails.
 * Remembered per frame time and view, so rotating back to the radar doesn't recompute.
 */
export function buildFuture(frames: RadarFrames, view: View, leads: number[], motion: Motion | null): Promise<FutureSet | null> {
  const list = frames.frames;
  const curr = list.at(-1);
  const prev = list.at(-3); // 5 minute frames: 10 minutes earlier
  if (!curr || !prev || typeof Worker === "undefined" || (navigator.hardwareConcurrency ?? 4) < 2) return Promise.resolve(null);
  const g = tileGrid(view);
  const key = `${curr.time}:${g.z}:${g.x0}:${g.y0}:${g.cols}:${g.rows}:${leads.join(",")}`;
  let p = memo.get(key);
  if (!p) {
    p = Promise.race([run(curr.time, prev.time, g, leads, motion), new Promise<null>((r) => setTimeout(() => r(null), MAX_TOTAL_MS))]).catch((err) => { console.warn("[future-radar] skipped:", err); return null; });
    memo.set(key, p);
    for (const old of [...memo.keys()].slice(0, -2)) memo.delete(old);
  }
  return p;
}

async function run(currT: number, prevT: number, g: ReturnType<typeof tileGrid>, leads: number[], motion: Motion | null): Promise<FutureSet | null> {
  const t0 = performance.now();
  const [prev, curr] = await Promise.all([stitch(prevT, g), stitch(currT, g)]);
  const w = curr.width;
  const h = curr.height;
  const worker = new Worker(new URL("../workers/radarflow.worker.ts", import.meta.url), { type: "module" });
  try {
    const midLat = latOf(g.y0 + g.rows / 2, g.z);
    const job: FutureJob = {
      w,
      h,
      prev: prev.data.buffer as ArrayBuffer,
      curr: curr.data.buffer as ArrayBuffer,
      intervalMin: Math.round((currT - prevT) / 60),
      metersPerPx: metersPerPixel(g.z, midLat),
      leads,
      motion,
    };
    const out = await new Promise<FutureResult | null>((resolve, reject) => {
      const timer = setTimeout(() => resolve(null), MAX_WORKER_MS);
      worker.onmessage = (e: MessageEvent<FutureResult>) => { clearTimeout(timer); resolve(e.data); };
      worker.onerror = (e) => { clearTimeout(timer); reject(e.error ?? new Error("worker failed")); };
      worker.postMessage(job, [job.prev, job.curr]);
    });
    if (!out) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext("2d")!;
    const urls: { lead: number; url: string }[] = [];
    for (const f of out.frames) {
      c.putImageData(new ImageData(new Uint8ClampedArray(f.rgba), w, h), 0, 0);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (blob) urls.push({ lead: f.lead, url: URL.createObjectURL(blob) });
    }
    if (!logged) {
      logged = true;
      console.info(`[future-radar] worker ${out.ms} ms, tiles+stitch+encode ${Math.round(performance.now() - t0 - out.ms)} ms, ${g.cols}x${g.rows} tiles at z${g.z}, ${urls.length} frames`);
    }
    return {
      frames: urls,
      bounds: [[latOf(g.y0 + g.rows, g.z), lonOf(g.x0, g.z)], [latOf(g.y0, g.z), lonOf(g.x0 + g.cols, g.z)]],
    };
  } finally {
    worker.terminate();
  }
}
