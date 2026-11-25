// Lightning proximity: cron ingest of GOES-19 GLM flashes for the Live region, and GET /api/lightning.
// Region-only on purpose (keeps KV and CPU small). One KV key, at most one write per cron pass.
import { emptyState, flashesWithin, inBbox, isStale, lightningNear, pruneFlashes, type BboxLike, type Flash, type LightningResponse, type LightningStore } from "../shared/lightning";
import type { ZoneOutline } from "../shared/lightningPush";
import { cached } from "./cache";
import { coords, loadPlace } from "./loaders";
import { fetchGlm, listNewFiles } from "./sources/glm";
import { fetchZoneGeometry } from "./sources/nws";
import { readConfig } from "./store";

export const LIGHTNING_KEY = "lightning:recent";
/** the region bbox plus this many degrees, so the 30 mi ring map at the edge still fills in */
const BUFFER_DEG = 0.5;
const MAX_FILES = 6;
const LOOKBACK_MS = 45 * 60_000;

export async function readLightning(env: Env): Promise<LightningStore | null> {
  return env.STATE.get<LightningStore>(LIGHTNING_KEY, { type: "json", cacheTtl: 30 });
}

export interface IngestResult {
  files: number;
  flashes: number;
  /** the region flashes that arrived in this pass (not the whole 45 minutes), for the Android push */
  fresh: Flash[];
  wrote: boolean;
  /** ms of wall time spent (CPU is far lower: most of it is waiting on the network) */
  ms: number;
}

const bufferBox = (b: BboxLike): BboxLike => ({ south: b.south - BUFFER_DEG, north: b.north + BUFFER_DEG, west: b.west - BUFFER_DEG, east: b.east + BUFFER_DEG });

/**
 * Read any new GLM files, keep region flashes, write `lightning:recent` once if something changed.
 * Runs after the alert push fan-outs; the caller wraps it in its own catch so a GLM failure never blocks alerts.
 */
export async function ingestLightning(env: Env, now = Date.now(), fetcher: typeof fetch = fetch, region?: BboxLike): Promise<IngestResult> {
  const t0 = Date.now();
  const box = bufferBox(region ?? (await readConfig(env)).live.region.bbox);
  const prev = await env.STATE.get<LightningStore>(LIGHTNING_KEY, "json");
  const after = prev?.lastFile ?? null;

  const all = await listNewFiles(now, after, LOOKBACK_MS, fetcher);
  // behind by more than a few files: take the newest ones rather than never catching up
  const files = all.slice(-MAX_FILES);
  const fresh: Flash[] = [];
  let last = prev?.lastFile ?? null;
  let fileAt = prev?.fileAt ?? 0;
  let read = 0;
  for (const f of files) {
    const g = await fetchGlm(f.key, box, fetcher);
    fresh.push(...g.flashes);
    last = f.key;
    fileAt = Math.max(fileAt, f.endMs);
    read++;
  }

  const before = prev?.flashes ?? [];
  const kept = pruneFlashes([...before, ...fresh], now);
  // no new file and nothing aged out: no write. A dry day still writes when a file arrives (the file time is the
  // "is the feed alive" heartbeat), so at most one write per cron pass, about 86k a month.
  if (!read && kept.length === before.length && prev) return { files: 0, flashes: 0, fresh: [], wrote: false, ms: Date.now() - t0 };

  const store: LightningStore = { lastFile: last, fileAt, updated: now, flashes: kept };
  await env.STATE.put(LIGHTNING_KEY, JSON.stringify(store), { expirationTtl: 3 * 3600 });
  return { files: read, flashes: fresh.length, fresh, wrote: true, ms: Date.now() - t0 };
}

/** Pure part of the API: what to answer for a point, given the stored value. */
export function lightningResponse(store: LightningStore | null, bbox: BboxLike, lat: number, lon: number, now: number): LightningResponse {
  // inside the region, with a small margin (the ingest buffer covers the rest of the ring)
  if (!inBbox(bbox, lat, lon, 0.25)) return { available: false, stale: false, updated: null, state: null, flashes: [], reason: "outside_region" };
  if (!store) return { available: false, stale: true, updated: null, state: emptyState(true), flashes: [], reason: "no_data" };
  const stale = isStale(store.fileAt, now);
  return {
    available: true,
    stale,
    updated: store.fileAt,
    state: lightningNear(store.flashes, lat, lon, now, { stale }),
    flashes: flashesWithin(store.flashes, lat, lon, 30, now),
  };
}

/** GET /api/lightning?lat=&lon= */
export async function handleLightning(env: Env, url: URL): Promise<Response> {
  const c = coords(url);
  if (!c) return Response.json({ error: "bad_location" }, { status: 400, headers: { "cache-control": "no-store" } });
  const cfg = await readConfig(env);
  const body = lightningResponse(await readLightning(env), cfg.live.region.bbox, c.lat, c.lon, Date.now());
  return Response.json(body, { headers: { "cache-control": "public, max-age=30" } });
}

/** County zones of the Live region's cities, with outlines (cached for a week, shared with /api/alerts). Phones hold these topics. */
export async function regionZoneOutlines(env: Env, ctx: ExecutionContext): Promise<ZoneOutline[]> {
  const cfg = await readConfig(env);
  const zones = new Set<string>();
  for (const c of cfg.live.region.cities) {
    try {
      const p = await loadPlace(env, ctx, c.lat, c.lon);
      if (p.countyZone) zones.add(p.countyZone);
    } catch {
      /* a city that won't resolve just adds no zone */
    }
  }
  const out: ZoneOutline[] = [];
  for (const zone of zones) {
    const g = await cached(ctx, `zone:${zone}`, 7 * 86400, async () => {
      const shape = await fetchZoneGeometry(env, zone);
      if (!shape) throw new Error("no zone shape"); // so a failure is not cached
      return shape;
    }).then((r) => r.data, () => null);
    if (g) out.push({ zone, geometry: g });
  }
  return out;
}
