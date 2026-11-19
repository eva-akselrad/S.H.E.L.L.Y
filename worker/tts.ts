import type { Speaker, VoiceConfig } from "../shared/config";
import { alertScript, isSpokenAlert } from "../shared/script";
import { buildSimAlert } from "../shared/simulate";
import { isEmergency } from "../shared/threat";
import type { Alert } from "../shared/types";
import { readAlerts, readConfig, readSim } from "./store";

const MODEL = "@cf/deepgram/aura-2-en";
const MAX_CHARS = 600;
const AUDIO_TTL = 2 * 24 * 3600;

export type TtsResult =
  | { ok: true; audio: ArrayBuffer; cached: boolean }
  | { ok: false; reason: "cap" | "failed" | "empty" };

const today = (): string => new Date().toISOString().slice(0, 10);
const usageKey = (): string => `tts-chars:${today()}`;

export async function ttsUsage(env: Env): Promise<number> {
  return Number((await env.STATE.get(usageKey())) ?? "0");
}

async function digest(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Turn whatever the AI binding returns into bytes. Handles streams, raw responses and base64 JSON. */
async function toBytes(out: unknown): Promise<ArrayBuffer | null> {
  if (out instanceof ReadableStream) return new Response(out).arrayBuffer();
  if (out instanceof Response) return out.arrayBuffer();
  if (out instanceof ArrayBuffer) return out;
  if (typeof out === "object" && out !== null && "audio" in out && typeof out.audio === "string") {
    const bin = atob(out.audio);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  return null;
}

// Best-effort: two viewers asking for the same new alert at once share one generation (per isolate).
const inflight = new Map<string, Promise<TtsResult>>();

/** How long to wait for the local voice before using the cloud voice. Warnings wait up to 60 s so a busy
 *  day doesn't burn through the cloud voice's daily quota (the owner's choice); a PC that is off fails at once,
 *  so the wait only applies when the voice is slow. Long on-air items get time to match their length
 *  (Kokoro on a CPU takes about 25 s for a 600-character bulletin). */
export const ALERT_LOCAL_TIMEOUT_MS = 60_000;
export function liveLocalTimeoutMs(chars: number): number {
  return Math.min(90_000, Math.max(ALERT_LOCAL_TIMEOUT_MS, 15_000 + chars * 75));
}

/** One call to the user's own Kokoro server (through the locked tunnel). Null on any failure. */
async function localAudio(env: Env, local: VoiceConfig["local"], text: string, timeoutMs: number): Promise<ArrayBuffer | null> {
  if (!local.enabled || !local.baseUrl || !env.LLM_API_KEY) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${local.baseUrl}/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_API_KEY}` },
      body: JSON.stringify({ input: text, voice: local.voice, response_format: "mp3" }),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const audio = await res.arrayBuffer();
    return audio.byteLength > 100 ? audio : null;
  } catch (e) {
    console.error(JSON.stringify({ msg: "tts_local_error", err: ctl.signal.aborted ? `timeout after ${timeoutMs} ms` : String(e), chars: text.length }));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Synthesize `text`. Tries the user's own voice server first (no daily cap); falls back to the
 * Aura-2 `speaker` voice, which is cached in KV and counts against the daily character cap.
 */
export function ttsAudio(
  env: Env, speaker: Speaker, text: string, cap: number, local?: VoiceConfig["local"],
  opts: { fresh?: boolean; localTimeoutMs?: number; localOnly?: boolean } = {},
): Promise<TtsResult> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  if (!clean) return Promise.resolve({ ok: false, reason: "empty" });
  const flightKey = `${opts.fresh ? "fresh:" : ""}${opts.localOnly ? "local:" : ""}${speaker}:${clean}`;
  const existing = inflight.get(flightKey);
  if (existing) return existing;

  const run = (async (): Promise<TtsResult> => {
    if (local?.enabled) {
      const lkey = `tts:${await digest(`local:${local.voice}:${clean}`)}`;
      const lhit = opts.fresh ? null : await env.STATE.get(lkey, "arrayBuffer");
      if (lhit) return { ok: true, audio: lhit, cached: true };
      const audio = await localAudio(env, local, clean, opts.localTimeoutMs ?? ALERT_LOCAL_TIMEOUT_MS);
      if (audio) {
        await env.STATE.put(lkey, audio, { expirationTtl: AUDIO_TTL });
        return { ok: true, audio, cached: false };
      }
      if (opts.localOnly) return { ok: false, reason: "failed" }; // making audio ahead never spends cloud credits
      console.error(JSON.stringify({ msg: "tts_local_unavailable_using_fallback" }));
    } else if (opts.localOnly) return { ok: false, reason: "failed" };
    const key = `tts:${await digest(`${speaker}:${clean}`)}`;
    const hit = opts.fresh ? null : await env.STATE.get(key, "arrayBuffer");
    if (hit) return { ok: true, audio: hit, cached: true };

    const used = await ttsUsage(env);
    if (used + clean.length > cap) return { ok: false, reason: "cap" };

    try {
      const out = await env.AI.run(MODEL, { text: clean, speaker, encoding: "mp3" });
      const audio = await toBytes(out);
      if (!audio || audio.byteLength < 100) return { ok: false, reason: "failed" };
      await env.STATE.put(key, audio, { expirationTtl: AUDIO_TTL });
      await env.STATE.put(usageKey(), String(used + clean.length), { expirationTtl: AUDIO_TTL });
      return { ok: true, audio, cached: false };
    } catch (err) {
      console.error(JSON.stringify({ msg: "tts_failed", err: String(err) }));
      return { ok: false, reason: "failed" };
    }
  })().finally(() => inflight.delete(flightKey));

  inflight.set(flightKey, run);
  return run;
}

const audioResponse = (audio: ArrayBuffer): Response =>
  new Response(audio, { headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=86400" } });

const err = (error: string, status: number): Response =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

/**
 * GET /api/tts?alert=<id>&lat=&lon=&zones=
 * Visitors never supply text: the server looks up a real active alert (or an admin test alert)
 * and builds the script itself, so this can't be used to synthesize arbitrary speech.
 */
export async function handleTts(env: Env, url: URL): Promise<Response> {
  const config = await readConfig(env);
  if (config.voice.engine !== "ai" || !config.tts) return err("tts_disabled", 404);

  const id = url.searchParams.get("alert") ?? "";
  if (!id) return err("alert_required", 400);

  let alert: Alert | undefined;
  if (id.startsWith("sim-")) {
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    const entry = (await readSim(env)).find((s) => s.id === id);
    if (entry && Number.isFinite(lat) && Number.isFinite(lon)) {
      const zones = (url.searchParams.get("zones") ?? "").split(",").filter(Boolean);
      alert = buildSimAlert(entry, { lat, lon, zones });
    }
  } else {
    alert = (await readAlerts(env)).alerts.find((a) => a.id === id);
  }
  if (!alert || !isSpokenAlert(alert)) return err("not_found", 404);

  const r = await ttsAudio(env, config.voice.speaker, alertScript(alert, isEmergency(alert)), config.voice.dailyCharCap, config.voice.local);
  if (r.ok) return audioResponse(r.audio);
  return err(`tts_${r.reason}`, r.reason === "cap" ? 429 : 502);
}

/** Admin: hear a voice. Counts toward the daily cap like any other synthesis. */
export async function handleTtsPreview(env: Env, speaker: Speaker, cap: number, local?: VoiceConfig["local"]): Promise<Response> {
  const text = "Attention. This is a test of the SHELLY alert voice. A Tornado Warning has been issued for your area. Move to an interior room now.";
  // fresh: always make a new sample so a changed voice or server is heard, not a cached one
  const r = await ttsAudio(env, speaker, text, cap, local, { fresh: true });
  if (r.ok) return new Response(r.audio, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  return err(`tts_${r.reason}`, r.reason === "cap" ? 429 : 502);
}
