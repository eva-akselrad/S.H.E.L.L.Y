import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig } from "../shared/config";
import { ALERT_LOCAL_TIMEOUT_MS, liveLocalTimeoutMs, ttsAudio } from "../worker/tts";

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

describe("local voice wait time", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  test("warnings wait 60 s; long on-air items get up to 90 s", () => {
    expect(ALERT_LOCAL_TIMEOUT_MS).toBe(60_000);
    expect(liveLocalTimeoutMs(40)).toBe(60_000);
    expect(liveLocalTimeoutMs(1000)).toBe(90_000);
    expect(liveLocalTimeoutMs(600)).toBe(60_000);
    expect(liveLocalTimeoutMs(5000)).toBe(90_000);
  });

  const clock = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  /** Let real async work (hashing) run until the request has gone out. */
  const sent = async (f: ReturnType<typeof vi.fn>) => { while (!f.mock.calls.length) await new Promise((r) => (globalThis as unknown as { setImmediate: (f: () => void) => void }).setImmediate(() => r(null))); };

  /** A local server that answers after `ms`, unless the request is aborted first. */
  const slowServer = (ms: number) => vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((res, rej) => {
    const t = setTimeout(() => res(new Response(new Uint8Array(500).fill(5).buffer)), ms);
    init?.signal?.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); });
  }));

  test("a long on-air item that takes 25 s still uses the local voice", async () => {
    clock();
    const f = slowServer(25_000);
    vi.stubGlobal("fetch", f);
    const ai = vi.fn(async () => new Uint8Array(500).buffer);
    const text = "x ".repeat(299);
    const p = ttsAudio(fakeEnv(ai), "athena", text, 20000, LOCAL, { localTimeoutMs: liveLocalTimeoutMs(text.length) });
    await sent(f);
    await vi.advanceTimersByTimeAsync(26_000);
    expect((await p).ok).toBe(true);
    expect(ai).not.toHaveBeenCalled();
  });

  test("a warning whose local voice takes 40 s still uses the local voice (no cloud quota)", async () => {
    clock();
    const f = slowServer(40_000);
    vi.stubGlobal("fetch", f);
    const ai = vi.fn(async () => new Uint8Array(500).buffer);
    const p = ttsAudio(fakeEnv(ai), "athena", "Tornado warning for your area.", 20000, LOCAL);
    await sent(f);
    await vi.advanceTimersByTimeAsync(41_000);
    expect((await p).ok).toBe(true);
    expect(ai).not.toHaveBeenCalled();
  });

  test("a warning waits up to 60 s, then falls back", async () => {
    clock();
    const f = slowServer(70_000);
    vi.stubGlobal("fetch", f);
    const ai = vi.fn(async () => new Uint8Array(500).fill(1).buffer);
    const p = ttsAudio(fakeEnv(ai), "athena", "Tornado warning for your area.", 20000, LOCAL);
    await sent(f);
    await vi.advanceTimersByTimeAsync(61_000);
    expect((await p).ok).toBe(true);
    expect(ai).toHaveBeenCalledOnce();
  });
});

describe("making audio ahead (localOnly)", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("caches the local audio, so the on-air request is a cache hit", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array(500).fill(9).buffer));
    vi.stubGlobal("fetch", fetcher);
    const env = fakeEnv(async () => new Uint8Array(500).buffer);
    const text = "A SHELLY bulletin from the forecaster. Tropical update. " + "Details. ".repeat(60);
    expect((await ttsAudio(env, "athena", text, 1000, LOCAL, { localOnly: true, localTimeoutMs: 60_000 })).ok).toBe(true);
    const onAir = await ttsAudio(env, "athena", text, 1000, LOCAL);
    expect(onAir).toMatchObject({ ok: true, cached: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("never falls back to the cloud voice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const ai = vi.fn(async () => new Uint8Array(500).fill(1).buffer);
    expect(await ttsAudio(fakeEnv(ai), "athena", "Bulletin text.", 20000, LOCAL, { localOnly: true })).toEqual({ ok: false, reason: "failed" });
    expect(await ttsAudio(fakeEnv(ai), "athena", "Bulletin text.", 20000, undefined, { localOnly: true })).toEqual({ ok: false, reason: "failed" });
    expect(ai).not.toHaveBeenCalled();
  });
});

describe("bulletin wording", () => {
  test("the words made ahead are the words the rundown speaks", async () => {
    const { bulletinSpeech } = await import("../shared/live/rundown");
    const b = { id: "b1", level: "advisory", title: "Tropical update", area: "the shore", body: "Rough surf.", speak: true, issued: "", until: "" } as never;
    expect(bulletinSpeech(b)).toBe("A SHELLY advisory from the forecaster for the shore. Tropical update. Rough surf.");
    expect(bulletinSpeech({ ...(b as object), speak: false } as never)).toBeUndefined();
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
