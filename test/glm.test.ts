import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG } from "../shared/config";
import { lightningActive } from "../shared/lightning";
import { ingestLightning, lightningResponse, LIGHTNING_KEY } from "../worker/lightning";
import { glmFileEnd, hourPrefix, listNewFiles, parseGlm, parseListing } from "../worker/sources/glm";

// A real GOES-19 GLM L2 LCFA file (2026-11-25 21:00:00 to 21:00:20 UTC), 453 flashes over South America and
// the Atlantic. Recorded once; no test touches the network.
const KEY = "GLM-L2-LCFA/2026/329/21/OR_GLM-L2-LCFA_G19_s20263292100000_e20263292100200_c20263292100215.nc";
const raw = readFileSync(new URL("./fixtures/glm-sample.nc", import.meta.url));
const bytes = (): ArrayBuffer => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;

const START = Date.UTC(2026, 10, 25, 21, 0, 0);
const NOW = START + 3 * 60_000;
const WORLD = { south: -90, north: 90, west: -180, east: 180 };
// the fixture's busiest cell: a real storm over Bolivia/Peru, standing in for "a storm in the region"
const STORM = { south: -14, north: -11, west: -70, east: -66 };
// stand right where one of its flashes landed
const STORM_PT = (() => {
  const f = parseGlm(bytes(), STORM).flashes[0]!;
  return { lat: f[0], lon: f[1] };
})();
const PHILLY = DEFAULT_CONFIG.live.region.bbox;

function fakeKv() {
  const m = new Map<string, string>();
  let puts = 0;
  const kv = {
    get: async (k: string, opt?: string | { type?: string }) => {
      const type = typeof opt === "string" ? opt : opt?.type;
      const v = m.get(k);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    put: async (k: string, v: string) => {
      puts++;
      m.set(k, v);
    },
    delete: async (k: string) => void m.delete(k),
  };
  return { kv: kv as unknown as KVNamespace, puts: () => puts, m };
}

const envWith = (kv: KVNamespace) => ({ STATE: kv }) as unknown as Env;

/** S3 stand-in: a listing that honors start-after, and the one file */
function fakeS3(keys: string[] = [KEY]): { fetcher: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("list-type=2")) {
      const u = new URL(url);
      const prefix = u.searchParams.get("prefix") ?? "";
      const after = u.searchParams.get("start-after") ?? "";
      const hits = keys.filter((k) => k.startsWith(prefix) && k > after);
      return new Response(`<ListBucketResult>${hits.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`);
    }
    return new Response(bytes());
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("GLM parser (real recorded file)", () => {
  test("reads the flashes: variables, quality flag, time window", () => {
    const all = parseGlm(bytes(), WORLD);
    expect(all.total).toBe(453);
    expect(all.flashes.length).toBe(450); // 3 have a degraded quality flag
    expect(all.startMs).toBe(START);
    for (const [lat, lon, t] of all.flashes) {
      expect(lat).toBeGreaterThan(-90);
      expect(lon).toBeLessThan(0);
      // each flash starts inside the file's window, give or take a few seconds
      expect(t).toBeGreaterThan(START - 5_000);
      expect(t).toBeLessThan(START + 21_000);
    }
  });

  test("keeps only region flashes: the Philly region is empty today, the storm cell is not", () => {
    expect(parseGlm(bytes(), PHILLY).flashes).toEqual([]);
    const storm = parseGlm(bytes(), STORM).flashes;
    expect(storm.length).toBeGreaterThan(40);
    for (const [lat, lon] of storm) {
      expect(lat).toBeGreaterThanOrEqual(STORM.south);
      expect(lon).toBeLessThanOrEqual(STORM.east);
    }
  });

  test("CPU: one file parses in well under the 30 s cron budget", () => {
    parseGlm(bytes(), PHILLY); // warm up
    const c0 = process.cpuUsage();
    for (let i = 0; i < 6; i++) parseGlm(bytes(), PHILLY); // a full 6-file cron run
    const u = process.cpuUsage(c0);
    const ms = (u.user + u.system) / 1000;
    console.log(`glm parse, 6 files: ${ms.toFixed(0)} ms CPU`);
    expect(ms).toBeLessThan(2000);
  });
});

describe("S3 helpers", () => {
  test("hour prefix, file end time, listing", () => {
    expect(hourPrefix(START)).toBe("GLM-L2-LCFA/2026/329/21/");
    expect(glmFileEnd(KEY)).toBe(START + 20_000);
    expect(parseListing(`<a><Key>${KEY}</Key></a><Key>x/readme.txt</Key>`)).toEqual([KEY]);
  });
  test("lists only files newer than the last one seen", async () => {
    const k2 = KEY.replace("s20263292100000_e20263292100200", "s20263292100200_e20263292100400");
    const s3 = fakeS3([KEY, k2]);
    expect((await listNewFiles(NOW, null, 45 * 60_000, s3.fetcher)).map((f) => f.key)).toEqual([KEY, k2]);
    expect((await listNewFiles(NOW, KEY, 45 * 60_000, s3.fetcher)).map((f) => f.key)).toEqual([k2]);
    expect(await listNewFiles(NOW + 2 * 3_600_000, null, 45 * 60_000, s3.fetcher)).toEqual([]);
  });
});

describe("ingest", () => {
  test("dry day (Philly region, no flashes): API says clear, chip stays hidden, one write", async () => {
    const { kv, puts } = fakeKv();
    const env = envWith(kv);
    const r = await ingestLightning(env, NOW, fakeS3().fetcher);
    expect(r).toMatchObject({ files: 1, flashes: 0, wrote: true });
    expect(puts()).toBe(1);
    const store = JSON.parse((await kv.get(LIGHTNING_KEY)) as string);
    expect(store.flashes).toEqual([]);
    expect(store.lastFile).toBe(KEY);
    const res = lightningResponse(store, PHILLY, 40.12, -75.34, NOW);
    expect(res.available).toBe(true);
    expect(res.stale).toBe(false);
    expect(res.state?.level).toBe("clear");
    expect(lightningActive(res.state)).toBe(false);
    expect(res.flashes).toEqual([]);
  });

  test("a storm in the region: flashes stored, danger at the storm, one write", async () => {
    const { kv, puts } = fakeKv();
    const env = envWith(kv);
    const r = await ingestLightning(env, NOW, fakeS3().fetcher, STORM);
    expect(r.wrote).toBe(true);
    expect(r.flashes).toBeGreaterThan(40);
    expect(puts()).toBe(1);
    const store = JSON.parse((await kv.get(LIGHTNING_KEY)) as string);
    const res = lightningResponse(store, STORM, STORM_PT.lat, STORM_PT.lon, NOW);
    expect(res.state?.level).toBe("danger");
    expect(res.state?.allClearAt).not.toBeNull();
    expect(res.flashes.length).toBeGreaterThan(10);
    expect(lightningActive(res.state)).toBe(true);
  });

  test("a second pass with nothing new reads nothing and writes nothing", async () => {
    const { kv, puts } = fakeKv();
    const env = envWith(kv);
    const s3 = fakeS3();
    await ingestLightning(env, NOW, s3.fetcher, STORM);
    const before = puts();
    const again = await ingestLightning(env, NOW + 30_000, s3.fetcher, STORM);
    expect(again).toMatchObject({ files: 0, wrote: false });
    expect(puts()).toBe(before);
    expect(s3.calls.filter((u) => !u.includes("list-type=2"))).toHaveLength(1); // the file was fetched once
  });

  test("outside the region the API says not tracked; no store means data delayed, not clear", () => {
    expect(lightningResponse(null, PHILLY, 35, -90, NOW)).toMatchObject({ available: false, reason: "outside_region" });
    const none = lightningResponse(null, PHILLY, 40.12, -75.34, NOW);
    expect(none.available).toBe(false);
    expect(none.state?.stale).toBe(true);
  });

  test("a feed that stopped 6 minutes ago is stale and never promises an all-clear", () => {
    const store = { lastFile: KEY, fileAt: NOW - 6 * 60_000, updated: NOW - 6 * 60_000, flashes: [[40.12 + 0.05, -75.34, NOW - 8 * 60_000]] as [number, number, number][] };
    const res = lightningResponse(store, PHILLY, 40.12, -75.34, NOW);
    expect(res.stale).toBe(true);
    expect(res.state?.allClearAt).toBeNull();
  });
});
