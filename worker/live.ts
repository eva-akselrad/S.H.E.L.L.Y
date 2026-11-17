import type { SiteConfig } from "../shared/config";
import { computeIntensity } from "../shared/live/intensity";
import { buildPackPrompt, type LlmPack } from "../shared/live/llm";
import { SPC_PHRASE } from "../shared/live/templates";
import { getPack } from "./llm";
import { ttsAudio } from "./tts";
import { regionAlerts } from "../shared/live/region";
import { buildRundown, isWarning, type CityWx, type Rundown } from "../shared/live/rundown";
import { buildSimAlert } from "../shared/simulate";
import { productActive } from "../shared/studio";
import type { SpcCategory } from "../shared/types";
import { wmoToWeather } from "../shared/wx";
import { fetchCitiesNow } from "./sources/openmeteo";
import { fetchRegionSpc } from "./sources/spc";
import { readAlerts, readConfig, readLiveState, readProducts, readRundown, readSim, writeLiveState, writeRundown } from "./store";

interface Timed<T> {
  at: number;
  data: T;
}

/** KV-backed cache for slow-moving inputs so the every-minute cron stays cheap. */
async function kvCached<T>(env: Env, key: string, ttlMs: number, produce: () => Promise<T>, fallback: T): Promise<T> {
  const hit = await env.STATE.get<Timed<T>>(key, "json");
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  try {
    const data = await produce();
    await env.STATE.put(key, JSON.stringify({ at: Date.now(), data } satisfies Timed<T>), { expirationTtl: 86400 });
    return data;
  } catch (err) {
    console.error(JSON.stringify({ msg: "live_input_failed", key, err: String(err) }));
    return hit?.data ?? fallback;
  }
}

const sameContent = (a: Rundown | null, b: Rundown): boolean => {
  if (!a) return false;
  const strip = (r: Rundown) => JSON.stringify({ ...r, generatedAt: "" });
  return strip(a) === strip(b);
};

/** Compute the rundown from stored data and write it to KV only if it changed. */
export async function produceRundown(env: Env, cfgIn?: SiteConfig): Promise<Rundown | null> {
  const cfg = cfgIn ?? (await readConfig(env));
  const live = cfg.live;
  if (!live.enabled) return null;
  const now = Date.now();
  const { region } = live;

  const [{ alerts }, sims, products, state] = await Promise.all([readAlerts(env), readSim(env), readProducts(env), readLiveState(env)]);
  const centre = { lat: (region.bbox.south + region.bbox.north) / 2, lon: (region.bbox.west + region.bbox.east) / 2, zones: [] as string[] };
  const inRegion = regionAlerts([...sims.map((s) => buildSimAlert(s, centre)), ...alerts], region, now);

  const spc = await kvCached<SpcCategory>(env, "live:spc", 30 * 60_000, () => fetchRegionSpc(region.cities), "NONE");
  const cities = await kvCached<CityWx[]>(
    env,
    "live:cities",
    10 * 60_000,
    async () => {
      const wx = await fetchCitiesNow(region.cities);
      return region.cities.map((c, i) => ({ ...c, temp: wx[i]?.temp ?? 0, desc: wmoToWeather(wx[i]?.code ?? 0, wx[i]?.isDay ?? true).desc }));
    },
    [],
  );

  // track when the last warning ended so the score can decay
  const warningNow = inRegion.some(isWarning);
  const lastWarningEndedAt = state.hadWarning && !warningNow ? new Date(now).toISOString() : state.lastWarningEndedAt;
  if (warningNow !== state.hadWarning) await writeLiveState(env, { hadWarning: warningNow, lastWarningEndedAt });

  const intensity = computeIntensity({ alerts: inRegion, spc, lastWarningEndedAt, now });
  // LLM colour for calm/elevated periods only; any failure means templates
  let pack: LlmPack | null = null;
  if (live.llm.enabled && (intensity.level === "CALM" || intensity.level === "ELEVATED")) {
    try {
      const prompt = buildPackPrompt({
        now: new Date(now),
        region: region.name,
        tone: live.host.tone,
        hostName: live.host.name,
        bannedTopics: live.host.bannedTopics,
        conditions: cities.slice(0, 8).map((c) => `${c.name}: ${Math.round(c.temp)}F, ${c.desc.toLowerCase()}`),
        spcPhrase: SPC_PHRASE[spc],
        activeEvents: [...new Set(inRegion.map((a) => a.event))],
        level: intensity.level,
      });
      pack = await getPack(env, live.llm, prompt, intensity.level, live.host.bannedTopics, now);
    } catch (err) {
      console.error(JSON.stringify({ msg: "llm_failed", err: String(err) }));
    }
  }
  const rundown = buildRundown(
    intensity,
    {
      alerts: inRegion,
      spc,
      cities,
      studio: products.filter((p) => productActive(p, now)),
      cams: [],
      ...(pack ? { talkBreak: pack.talkBreak, headlines: pack.headlines } : {}),
    },
    live,
    now,
  );

  if (!sameContent(await readRundown(env), rundown)) await writeRundown(env, rundown);
  return rundown;
}

/**
 * GET /api/live/tts?key=<viewer token>&item=<rundown item key>
 * Like /api/tts, callers never supply text: the server speaks only what the current rundown says.
 */
export async function handleLiveTts(env: Env, url: URL): Promise<Response> {
  const err = (error: string, status: number): Response => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
  const cfg = await readConfig(env);
  if (!cfg.live.enabled) return err("live_disabled", 404);
  if (cfg.live.viewerToken && url.searchParams.get("key") !== cfg.live.viewerToken) return err("forbidden", 403);
  if (cfg.voice.engine !== "ai" || !cfg.tts) return err("tts_disabled", 404);
  const r = await readRundown(env);
  const item = r?.items.find((i) => i.key === url.searchParams.get("item"));
  if (!item?.speak) return err("not_found", 404);
  const out = await ttsAudio(env, cfg.voice.speaker, item.speak, cfg.voice.dailyCharCap, cfg.voice.local);
  if (!out.ok) return err(`tts_${out.reason}`, out.reason === "cap" ? 429 : 502);
  return new Response(out.audio, { headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=3600" } });
}
