import { describe, expect, test } from "vitest";
import { advect, computeFuture, downsample, fadeFactor, fallbackFromMotion, intensity, metersPerPixel, motionField, mphToPx } from "../shared/radarflow";
import { parseMotion } from "../shared/live/track";
import { framesFromLatest, layerName, parseLatest, tileUpstream } from "../worker/sources/iemradar";

const W = 96;
const H = 64;

/** a soft blob of green-ish echo centred at (cx, cy) */
function blob(cx: number, cy: number, w = W, h = H): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > 9) continue;
      const i = (y * w + x) * 4;
      const k = 1 - d / 10;
      px[i] = 40; px[i + 1] = 120 + 100 * k; px[i + 2] = 60; px[i + 3] = 255;
    }
  }
  return px;
}

function centroid(rgba: Uint8ClampedArray, w = W, h = H): { x: number; y: number } {
  let m = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = rgba[(y * w + x) * 4 + 3]!;
    m += a; sx += a * x; sy += a * y;
  }
  return { x: sx / m, y: sy / m };
}

describe("motion field", () => {
  test("a blob moving 5 px right per frame gives about (5, 0)", () => {
    const f = motionField(intensity(blob(30, 32)), intensity(blob(35, 32)), W, H, { block: 8, search: 8 });
    // the blocks that cover the blob
    const i = Math.floor(32 / 8) * f.bw + Math.floor(35 / 8);
    expect(f.u[i]).toBeGreaterThan(4);
    expect(f.u[i]).toBeLessThan(6);
    expect(Math.abs(f.v[i]!)).toBeLessThan(1);
    // and the filled-in blocks far from it agree
    expect(f.u[0]).toBeGreaterThan(3);
  });

  test("advecting one interval lands the blob within 1 px of where it should", () => {
    const prev = blob(30, 32);
    const curr = blob(35, 32);
    const f = motionField(intensity(prev), intensity(curr), W, H, { block: 8, search: 8 });
    const out = advect(curr, f, 10, { w: W, h: H }, { intervalMin: 10, fade: false });
    const c = centroid(out);
    expect(Math.abs(c.x - 40)).toBeLessThan(1);
    expect(Math.abs(c.y - 32)).toBeLessThan(1);
  });

  test("diagonal motion works too", () => {
    const f = motionField(intensity(blob(30, 20)), intensity(blob(33, 24)), W, H, { block: 8, search: 8 });
    const out = advect(blob(33, 24), f, 20, { w: W, h: H }, { fade: false });
    const c = centroid(out);
    expect(Math.abs(c.x - 39)).toBeLessThan(1.5);
    expect(Math.abs(c.y - 32)).toBeLessThan(1.5);
  });

  test("empty frames give a zero field and no NaN", () => {
    const empty = new Uint8ClampedArray(W * H * 4);
    const f = motionField(intensity(empty), intensity(empty), W, H, { block: 8, search: 8 });
    expect([...f.u, ...f.v].every((n) => n === 0)).toBe(true);
    const out = advect(empty, f, 30, { w: W, h: H });
    expect(out.every((n) => Number.isFinite(n) && n === 0)).toBe(true);
  });

  test("speeds are clamped (80 mph)", () => {
    const mpp = metersPerPixel(7, 40);
    const cap = mphToPx(80, mpp, 10);
    const f = motionField(intensity(blob(10, 32)), intensity(blob(40, 32)), W, H, { block: 8, search: 32, maxSpeedPx: 5 });
    expect(Math.max(...[...f.u].map((n, i) => Math.hypot(n, f.v[i]!)))).toBeLessThanOrEqual(5.0001);
    expect(cap).toBeGreaterThan(5); // 80 mph is many pixels at z7, so the test cap above is the tighter one
  });

  test("tiny echo falls back to one vector; none at all uses the warning's storm motion", () => {
    const warn = parseMotion("2026-05-01T20:00:00-00:00...storm...270DEG...30KT...40.00,-75.00");
    expect(warn).not.toBeNull();
    const fb = fallbackFromMotion(warn, 1000, 10);
    expect(fb!.u).toBeGreaterThan(0); // from 270 = heading east
    expect(Math.abs(fb!.v)).toBeLessThan(0.01);
    const empty = new Uint8ClampedArray(W * H * 4);
    const f = motionField(intensity(empty), intensity(empty), W, H, { block: 8, search: 4, fallback: fb });
    expect(f.u[5]).toBeCloseTo(fb!.u, 4);
    expect(f.measured).toBe(0);
  });
});

describe("fade and sampling", () => {
  test("fade runs 0.9 at +10 down to 0.55 at +60", () => {
    expect(fadeFactor(10)).toBeCloseTo(0.9);
    expect(fadeFactor(60)).toBeCloseTo(0.55);
    expect(fadeFactor(30)).toBeLessThan(fadeFactor(20));
    expect(fadeFactor(200)).toBeCloseTo(0.55);
  });

  test("advect fades alpha by lead and keeps colour", () => {
    const curr = blob(40, 32);
    const f = motionField(intensity(curr), intensity(curr), W, H, { block: 8, search: 4 });
    const out = advect(curr, f, 10, { w: W, h: H });
    const i = (32 * W + 40) * 4;
    expect(out[i + 3]).toBeCloseTo(255 * 0.9, -1);
    expect(Math.abs(out[i + 1]! - curr[i + 1]!)).toBeLessThan(3);
  });

  test("downsample and computeFuture keep sizes and finish", () => {
    expect(downsample(new Float32Array(16), 4, 4).w).toBe(2);
    const r = computeFuture(blob(30, 32), blob(35, 32), W, H, { intervalMin: 10, metersPerPx: 940, leads: [10, 20, 30] });
    expect(r.frames.map((x) => x.lead)).toEqual([10, 20, 30]);
    const c = centroid(r.frames[2]!.rgba);
    expect(c.x).toBeGreaterThan(44); // still moving right
  });
});

describe("IEM frames and tile proxy rules", () => {
  test("layer names are UTC, 5 minutes apart, oldest first", () => {
    expect(layerName(Date.parse("2026-11-25T20:55:00Z") / 1000)).toBe("ridge::USCOMP-N0Q-202611252055");
    const fr = framesFromLatest(Date.parse("2026-11-25T20:57:00Z") / 1000);
    expect(fr).toHaveLength(12);
    expect(fr[11]!.path).toContain("202611252055");
    expect(fr[10]!.time).toBe(fr[11]!.time - 300);
  });

  test("parseLatest reads IEM's tms.json shape", () => {
    const j = { services: [{ id: "ridge_uscomp_n0r", utc_valid: "2026-11-25T20:55:00Z" }, { id: "ridge_uscomp_n0q", layername: "x", utc_valid: "2026-11-25T20:55:00Z" }] };
    expect(parseLatest(j)).toBe(Date.parse("2026-11-25T20:55:00Z") / 1000);
    expect(parseLatest({ services: [] })).toBeNull();
    expect(parseLatest(null)).toBeNull();
  });

  test("the tile proxy only serves real frame times and z <= 7", () => {
    const now = Date.parse("2026-11-25T20:58:00Z") / 1000;
    const t = Date.parse("2026-11-25T20:55:00Z") / 1000;
    expect(tileUpstream(now, String(t), "7", "37", "48")).toContain(`/${layerName(t)}/7/37/48.png`);
    expect(tileUpstream(now, String(t + 1), "7", "37", "48")).toBeNull(); // off the 5 minute grid
    expect(tileUpstream(now, String(t - 3 * 3600), "7", "37", "48")).toBeNull(); // too old
    expect(tileUpstream(now, String(t + 3600), "7", "37", "48")).toBeNull(); // the future
    expect(tileUpstream(now, String(t), "8", "37", "48")).toBeNull(); // too deep
    expect(tileUpstream(now, String(t), "6", "64", "1")).toBeNull(); // off the grid
    expect(tileUpstream(now, String(t), "7", "../x", "1")).toBeNull();
  });
});
