/**
 * Future radar: estimate where today's echoes will be, by moving them along the motion seen
 * between two recent frames. Pure functions on plain RGBA buffers (no DOM), so Node can test them
 * and a Web Worker can run them. It can't see storms forming or dying; the UI says so.
 */
import type { Motion } from "./live/track";

export interface Field {
  /** per-block motion in field pixels per `intervalMin` minutes (u = right, v = down) */
  u: Float32Array;
  v: Float32Array;
  bw: number;
  bh: number;
  /** block size in field pixels */
  block: number;
  /** image pixels per field pixel (1 unless the field was measured on a downsampled image) */
  scale: number;
  /** blocks that had real echo to match (before filling) */
  measured: number;
}

export interface FieldOptions {
  block?: number;
  search?: number;
  /** speed cap in field pixels per interval (see mphToPx) */
  maxSpeedPx?: number;
  /** used when there is too little echo to measure: one vector in field pixels per interval */
  fallback?: { u: number; v: number } | null;
}

export const MIN_ECHO_SHARE = 0.05;
const BLOCK_ECHO = 0.02; // mean intensity a block needs before we try to match it

/** alpha × luminance, 0..1. Dark-blue light rain still counts as echo (floor of 0.25 on the luminance). */
export function intensity(rgba: Uint8ClampedArray): Float32Array {
  const n = rgba.length >> 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3]! / 255;
    if (a === 0) continue;
    const lum = (0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!) / 255;
    out[i] = a * Math.max(lum, 0.25);
  }
  return out;
}

/** 2×2 average, for measuring motion on a half-size image (4× cheaper). */
export function downsample(src: Float32Array, w: number, h: number): { data: Float32Array; w: number; h: number } {
  const nw = w >> 1;
  const nh = h >> 1;
  const data = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const i = y * 2 * w + x * 2;
      data[y * nw + x] = (src[i]! + src[i + 1]! + src[i + w]! + src[i + w + 1]!) / 4;
    }
  }
  return { data, w: nw, h: nh };
}

export function metersPerPixel(zoom: number, latDeg: number): number {
  return (156543.03392 * Math.cos((latDeg * Math.PI) / 180)) / 2 ** zoom;
}

/** a speed in mph as pixels moved in `minutes` */
export function mphToPx(mph: number, metersPerPx: number, minutes: number): number {
  return (mph * 0.44704 * minutes * 60) / metersPerPx;
}

/** Storm motion from an active warning (parseMotion) as a one-vector fallback, in image pixels per interval. */
export function fallbackFromMotion(m: Motion | null, metersPerPx: number, intervalMin: number): { u: number; v: number } | null {
  if (!m) return null;
  const px = (m.speedKt * 0.514444 * intervalMin * 60) / metersPerPx;
  const rad = (m.toDeg * Math.PI) / 180; // bearing: 0 = north, clockwise
  return { u: Math.sin(rad) * px, v: -Math.cos(rad) * px };
}

/** Block matching: for each block of `curr` with echo, find the shift of `prev` that matches it best (sum of absolute differences). */
export function motionField(prev: Float32Array, curr: Float32Array, w: number, h: number, opts: FieldOptions = {}): Field {
  const block = opts.block ?? 16;
  const search = opts.search ?? 12;
  const maxSpeed = opts.maxSpeedPx ?? Infinity;
  const bw = Math.max(1, Math.floor(w / block));
  const bh = Math.max(1, Math.floor(h / block));
  const u = new Float32Array(bw * bh);
  const v = new Float32Array(bw * bh);
  const ok = new Uint8Array(bw * bh);
  let measured = 0;

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const x0 = bx * block;
      const y0 = by * block;
      let mass = 0;
      for (let y = y0; y < y0 + block; y++) for (let x = x0; x < x0 + block; x++) mass += curr[y * w + x]!;
      if (mass / (block * block) < BLOCK_ECHO) continue;

      let best = Infinity;
      let bu = 0;
      let bv = 0;
      for (let dy = -search; dy <= search; dy++) {
        for (let dx = -search; dx <= search; dx++) {
          // curr(x) ≈ prev(x - d): the echo moved by +d
          let sad = 0;
          for (let y = y0; y < y0 + block && sad < best; y++) {
            const py = y - dy;
            for (let x = x0; x < x0 + block; x++) {
              const px = x - dx;
              const p = px < 0 || py < 0 || px >= w || py >= h ? 0 : prev[py * w + px]!;
              sad += Math.abs(curr[y * w + x]! - p);
            }
          }
          sad += 1e-4 * (Math.abs(dx) + Math.abs(dy)); // prefer the smaller move on a tie
          if (sad < best) {
            best = sad;
            bu = dx;
            bv = dy;
          }
        }
      }
      const i = by * bw + bx;
      u[i] = bu;
      v[i] = bv;
      ok[i] = 1;
      measured++;
    }
  }

  const field: Field = { u, v, bw, bh, block, scale: 1, measured };
  if (measured < MIN_ECHO_SHARE * bw * bh) {
    // too little echo to trust a map of motion: one vector for everything
    let su = 0;
    let sv = 0;
    for (let i = 0; i < ok.length; i++) if (ok[i]) { su += u[i]!; sv += v[i]!; }
    const g = measured > 0 ? { u: su / measured, v: sv / measured } : (opts.fallback ?? { u: 0, v: 0 });
    u.fill(g.u);
    v.fill(g.v);
  } else {
    fillEmpty(u, v, ok, bw, bh);
    smooth(u, bw, bh);
    smooth(v, bw, bh);
  }
  clampSpeed(field, maxSpeed);
  return field;
}

/** empty blocks take the average of their measured neighbours, spreading outward until everything is filled */
function fillEmpty(u: Float32Array, v: Float32Array, ok: Uint8Array, bw: number, bh: number): void {
  const have = Uint8Array.from(ok);
  for (let pass = 0; pass < bw + bh; pass++) {
    const add: number[] = [];
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        if (have[y * bw + x]) continue;
        let su = 0, sv = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= bw || ny >= bh || !have[ny * bw + nx]) continue;
            su += u[ny * bw + nx]!; sv += v[ny * bw + nx]!; n++;
          }
        }
        if (n) { u[y * bw + x] = su / n; v[y * bw + x] = sv / n; add.push(y * bw + x); }
      }
    }
    if (!add.length) break;
    for (const i of add) have[i] = 1;
  }
}

/** 3×3 median, then 3×3 mean */
function smooth(a: Float32Array, bw: number, bh: number): void {
  const tmp = new Float32Array(a.length);
  const win: number[] = [];
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      win.length = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < bw && ny < bh) win.push(a[ny * bw + nx]!);
      }
      win.sort((p, q) => p - q);
      tmp[y * bw + x] = win[win.length >> 1]!;
    }
  }
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < bw && ny < bh) { s += tmp[ny * bw + nx]!; n++; }
      }
      a[y * bw + x] = s / n;
    }
  }
}

/** cap every vector at `maxPx` pixels per interval (80 mph via mphToPx) */
export function clampSpeed(f: Field, maxPx: number): void {
  for (let i = 0; i < f.u.length; i++) {
    const m = Math.hypot(f.u[i]!, f.v[i]!);
    if (m > maxPx) { f.u[i] = (f.u[i]! * maxPx) / m; f.v[i] = (f.v[i]! * maxPx) / m; }
    if (!Number.isFinite(f.u[i]!) || !Number.isFinite(f.v[i]!)) { f.u[i] = 0; f.v[i] = 0; }
  }
}

/** a field measured on a half-size image, expressed for the full-size one */
export function withScale(f: Field, scale: number): Field {
  return { ...f, scale };
}

/** how much of the echo we keep at a given lead: 0.9 at +10 min down to 0.55 at +60, so far-out frames look less certain */
export function fadeFactor(leadMin: number): number {
  const t = Math.min(1, Math.max(0, (leadMin - 10) / 50));
  return 0.9 - t * 0.35;
}

const STEP_MIN = 10;

/**
 * Backward semi-Lagrangian advection in 10 minute steps: each output pixel looks back along the motion
 * vector and takes a bilinear sample (premultiplied, so edges don't darken). Alpha is faded by lead time.
 */
export function advect(
  curr: Uint8ClampedArray,
  field: Field,
  minutes: number,
  size: { w: number; h: number },
  opts: { intervalMin?: number; fade?: boolean } = {},
): Uint8ClampedArray {
  const { w, h } = size;
  const intervalMin = opts.intervalMin ?? 10;
  const steps = Math.max(0, Math.round(minutes / STEP_MIN));
  let src = new Float32Array(w * h * 4); // premultiplied 0..255
  for (let i = 0; i < w * h; i++) {
    const a = curr[i * 4 + 3]! / 255;
    src[i * 4] = curr[i * 4]! * a;
    src[i * 4 + 1] = curr[i * 4 + 1]! * a;
    src[i * 4 + 2] = curr[i * 4 + 2]! * a;
    src[i * 4 + 3] = curr[i * 4 + 3]!;
  }
  const k = (STEP_MIN / intervalMin) * field.scale; // image pixels moved per field pixel in one step
  for (let s = 0; s < steps; s++) {
    const dst = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [mu, mv] = sampleField(field, x, y);
        const sx = x - mu * k;
        const sy = y - mv * k;
        bilinear(src, w, h, sx, sy, dst, (y * w + x) * 4);
      }
    }
    src = dst;
  }
  const f = opts.fade === false ? 1 : fadeFactor(minutes);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = src[i * 4 + 3]!;
    if (a <= 0) continue;
    const un = 255 / a;
    out[i * 4] = src[i * 4]! * un;
    out[i * 4 + 1] = src[i * 4 + 1]! * un;
    out[i * 4 + 2] = src[i * 4 + 2]! * un;
    out[i * 4 + 3] = a * f;
  }
  return out;
}

function sampleField(f: Field, x: number, y: number): [number, number] {
  const fx = Math.min(f.bw - 1, Math.max(0, (x / f.scale) / f.block - 0.5));
  const fy = Math.min(f.bh - 1, Math.max(0, (y / f.scale) / f.block - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(f.bw - 1, x0 + 1), y1 = Math.min(f.bh - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const at = (a: Float32Array) =>
    (a[y0 * f.bw + x0]! * (1 - tx) + a[y0 * f.bw + x1]! * tx) * (1 - ty) + (a[y1 * f.bw + x0]! * (1 - tx) + a[y1 * f.bw + x1]! * tx) * ty;
  return [at(f.u), at(f.v)];
}

function bilinear(src: Float32Array, w: number, h: number, sx: number, sy: number, dst: Float32Array, o: number): void {
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const tx = sx - x0, ty = sy - y0;
  for (let c = 0; c < 4; c++) {
    const g = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : src[(yy * w + xx) * 4 + c]!);
    dst[o + c] = (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
  }
}

export interface FutureOptions {
  /** minutes between `prev` and `curr` */
  intervalMin: number;
  metersPerPx: number;
  leads: number[];
  fallbackMotion?: Motion | null;
}

/** the whole job: motion from two frames, then one advected frame per lead time */
export function computeFuture(
  prev: Uint8ClampedArray,
  curr: Uint8ClampedArray,
  w: number,
  h: number,
  o: FutureOptions,
): { field: Field; frames: { lead: number; rgba: Uint8ClampedArray }[] } {
  const a = downsample(intensity(prev), w, h);
  const b = downsample(intensity(curr), w, h);
  const fieldMpp = o.metersPerPx * 2;
  const fb = fallbackFromMotion(o.fallbackMotion ?? null, fieldMpp, o.intervalMin);
  const field = withScale(
    motionField(a.data, b.data, a.w, a.h, { block: 16, search: 12, maxSpeedPx: mphToPx(80, fieldMpp, o.intervalMin), fallback: fb }),
    2,
  );
  return { field, frames: o.leads.map((lead) => ({ lead, rgba: advect(curr, field, lead, { w, h }, { intervalMin: o.intervalMin }) })) };
}
