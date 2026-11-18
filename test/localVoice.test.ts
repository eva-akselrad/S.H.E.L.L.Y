import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig } from "../shared/config";
import { ttsAudio } from "../worker/tts";

describe("local voice settings", () => {
  test("off by default", () => expect(DEFAULT_CONFIG.voice.local.enabled).toBe(false));
  test("needs an https address to be enabled", () => {
    expect(normalizeConfig({ voice: { local: { enabled: true, baseUrl: "http://x.test/v1" } } }).voice.local.enabled).toBe(false);
    const ok = normalizeConfig({ voice: { local: { enabled: true, baseUrl: "https://llm.test/v1/", voice: "af_bella" } } }).voice.local;
    expect(ok).toEqual({ enabled: true, baseUrl: "https://llm.test/v1", voice: "af_bella" });
  });
  test("rejects odd voice names", () => {
    expect(normalizeConfig({ voice: { local: { enabled: true, baseUrl: "https://a.test", voice: "../etc" } } }).voice.local.voice).toBe("af_heart");
  });
});

function fakeEnv(ai: () => Promise<unknown>) {
  const kv = new Map<string, ArrayBuffer | string>();
  return {
    LLM_API_KEY: "k".repeat(32),
    STATE: {
      get: async (k: string, type?: string) => (kv.has(k) ? (type === "arrayBuffer" ? (kv.get(k) as ArrayBuffer) : kv.get(k)) : null),
      put: async (k: string, v: ArrayBuffer | string) => void kv.set(k, v),
    },
    AI: { run: ai },
  } as unknown as Env;
}
const LOCAL = { enabled: true, baseUrl: "https://llm.test/v1", voice: "af_heart" };

describe("ttsAudio with a local voice", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("uses the local server and does not count against the cap", async () => {
    const mp3 = new Uint8Array(500).fill(7).buffer;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(mp3)));
    const ai = vi.fn(async () => new Uint8Array(500).buffer);
    const env = fakeEnv(ai);
    const r = await ttsAudio(env, "athena", "Tornado warning for your area.", 0, LOCAL); // cap 0: Aura would refuse
    expect(r.ok).toBe(true);
    expect(ai).not.toHaveBeenCalled();
    expect(await env.STATE.get("tts-chars:" + new Date().toISOString().slice(0, 10))).toBeNull();
  });

  test("falls back to Aura when the local server is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const ai = vi.fn(async () => new Uint8Array(500).fill(1).buffer);
    const r = await ttsAudio(fakeEnv(ai), "athena", "Severe thunderstorm warning.", 20000, LOCAL);
    expect(r.ok).toBe(true);
    expect(ai).toHaveBeenCalledOnce();
  });

  test("the fallback still honours the cap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 502 })));
    const ai = vi.fn(async () => new Uint8Array(500).buffer);
    const r = await ttsAudio(fakeEnv(ai), "athena", "Flash flood warning.", 0, LOCAL);
    expect(r).toEqual({ ok: false, reason: "cap" });
    expect(ai).not.toHaveBeenCalled();
  });
});

describe("preview always makes a fresh sample", () => {
  afterEach(() => vi.unstubAllGlobals());
  test("a repeat plain request is cached, a fresh one calls the server again", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array(500).fill(3).buffer));
    vi.stubGlobal("fetch", fetcher);
    const env = fakeEnv(async () => new Uint8Array(500).buffer);
    await ttsAudio(env, "athena", "Preview sentence.", 1000, LOCAL);
    await ttsAudio(env, "athena", "Preview sentence.", 1000, LOCAL);
    expect(fetcher).toHaveBeenCalledTimes(1); // second came from the cache
    await ttsAudio(env, "athena", "Preview sentence.", 1000, LOCAL, { fresh: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
