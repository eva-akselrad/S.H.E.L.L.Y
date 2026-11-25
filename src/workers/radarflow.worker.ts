import { computeFuture } from "../../shared/radarflow";
import type { Motion } from "../../shared/live/track";

export interface FutureJob {
  w: number;
  h: number;
  prev: ArrayBuffer;
  curr: ArrayBuffer;
  intervalMin: number;
  metersPerPx: number;
  leads: number[];
  motion: Motion | null;
}
export interface FutureResult {
  frames: { lead: number; rgba: ArrayBuffer }[];
  ms: number;
}

const ctx = self as unknown as { onmessage: ((e: MessageEvent<FutureJob>) => void) | null; postMessage(m: FutureResult, t: Transferable[]): void };

ctx.onmessage = (e) => {
  const j = e.data;
  const t0 = performance.now();
  const r = computeFuture(new Uint8ClampedArray(j.prev), new Uint8ClampedArray(j.curr), j.w, j.h, {
    intervalMin: j.intervalMin,
    metersPerPx: j.metersPerPx,
    leads: j.leads,
    fallbackMotion: j.motion,
  });
  const frames = r.frames.map((f) => ({ lead: f.lead, rgba: f.rgba.buffer as ArrayBuffer }));
  ctx.postMessage({ frames, ms: Math.round(performance.now() - t0) }, frames.map((f) => f.rgba));
};
