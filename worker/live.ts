import type { SiteConfig } from "../shared/config";
import { computeIntensity } from "../shared/live/intensity";
import { buildPackPrompt, hashKey, type LlmPack } from "../shared/live/llm";
import { SPC_PHRASE } from "../shared/live/templates";
import { getPack } from "./llm";
import { liveLocalTimeoutMs, ttsAudio } from "./tts";
import { regionAlerts } from "../shared/live/region";
import { buildRundown, isWarning, type CityWx, type Rundown } from "../shared/live/rundown";
import { buildSimAlert } from "../shared/simulate";
import { productActive } from "../shared/studio";
import type { SpcCategory } from "../shared/types";
import { wmoToWeather } from "../shared/wx";
import { fetchRegionWx } from "./sources/openmeteo";
import type { RegionWx } from "../shared/live/blocks";
import { fetchRegionSpc } from "./sources/spc";
import { readAlerts, readConfig, readControl, readLiveState, readProducts, readRundown, readSim, writeLiveState, writeRundown } from "./store";

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

export type VoicePrep = "ready" | "fallback" | "off";

/**
 * Make the local voice's audio for `text` now, so it is already cached when it airs (a long bulletin takes
 * Kokoro about 25 s on a CPU). Never falls back to the cloud voice here: that would spend credits early.
 * "off": no local voice set up. "fallback": the local voice failed, so on air it will use the cloud voice.
 */
export async function prepareVoice(env: Env, text: string | undefined, cfgIn?: SiteConfig): Promise<VoicePrep> {
  const cfg = cfgIn ?? (await readConfig(env));
  if (!text || !cfg.live.enabled || cfg.voice.engine !== "ai" || !cfg.tts || !cfg.voice.local.enabled) return "off";
  const r = await ttsAudio(env, cfg.voice.speaker, text, cfg.voice.dailyCharCap, cfg.voice.local, {
    localTimeoutMs: liveLocalTimeoutMs(text.length),
    localOnly: true,
  });
  return r.ok ? "ready" : "fallback";
}

/** Cron: make audio ahead for what's coming up (a few new items per run; cached ones cost nothing). */
export async function prepareRundownVoice(env: Env, rundown: Rundown | null, maxNew = 2): Promise<number> {
  if (!rundown) return 0;
  const cfg = await readConfig(env);
  if (cfg.voice.engine !== "ai" || !cfg.tts || !cfg.voice.local.enabled) return 0;
  let made = 0;
  for (const it of rundown.items) {
    if (made >= maxNew) break;
    if (!it.speak || it.kind === "alert") continue; // warning audio is made on demand with the short wait
    const r = await ttsAudio(env, cfg.voice.speaker, it.speak, cfg.voice.dailyCharCap, cfg.voice.local, {
      localTimeoutMs: liveLocalTimeoutMs(it.speak.length),
      localOnly: true,
    });
    if (r.ok && !r.cached) made++;
    if (!r.ok) break; // local voice is down: stop, try again next minute
  }
  return made;
}

/** Compute the rundown from stored data and write it to KV only if it changed. */
export async function produceRundown(env: Env, cfgIn?: SiteConfig): Promise<Rundown | null> {
  const cfg = cfgIn ?? (await readConfig(env));
  const live = cfg.live;
  if (!live.enabled) return null;
  const now = Date.now();
  const { region } = live;

  const [{ alerts }, sims, products, state, control] = await Promise.all([readAlerts(env), readSim(env), readProducts(env), readLiveState(env), readControl(env)]);
  const centre = { lat: (region.bbox.south + region.bbox.north) / 2, lon: (region.bbox.west + region.bbox.east) / 2, zones: [] as string[] };
  const inRegion = regionAlerts([...sims.map((s) => buildSimAlert(s, centre)), ...alerts], region, now);

  const spc = await kvCached<SpcCategory>(env, "live:spc", 30 * 60_000, () => fetchRegionSpc(region.cities), "NONE");
  // one request feeds the city cards and every data block; keyed by the city list so edits refetch
  const wxKey = `live:wx:${hashKey(JSON.stringify(region.cities))}`;
  const wx = await kvCached<RegionWx | null>(env, wxKey, 10 * 60_000, () => fetchRegionWx(region.cities), null);
  const cities: CityWx[] = (wx?.cities ?? []).map((c) => ({ name: c.name, state: c.state, lat: c.lat, lon: c.lon, temp: c.now.temp, desc: wmoToWeather(c.now.code, c.now.isDay).desc }));

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
      wx,
      control,
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
  // match on the words too (h = hash of the text): a key whose text changed must never get the old audio
  const h = url.searchParams.get("h");
  const item = r?.items.find((i) => i.key === url.searchParams.get("item") && (!h || (i.speak && hashKey(i.speak) === h))) ?? (h ? r?.items.find((i) => i.speak && hashKey(i.speak) === h) : undefined);
  if (!item?.speak) return err("not_found", 404);
  // on-air items can be long bulletins: give the local voice time to match (warnings keep the short wait)
  const out = await ttsAudio(env, cfg.voice.speaker, item.speak, cfg.voice.dailyCharCap, cfg.voice.local, { localTimeoutMs: liveLocalTimeoutMs(item.speak.length) });
  if (!out.ok) return err(`tts_${out.reason}`, out.reason === "cap" ? 429 : 502);
  return new Response(out.audio, { headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=3600" } });
}
