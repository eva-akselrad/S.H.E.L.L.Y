import { beforeEach, describe, expect, test, vi } from "vitest";
import { ttsAudio, ttsUsage } from "../worker/tts";

function fakeKv(): KVNamespace {
  const m = new Map<string, unknown>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: unknown) => void m.set(k, v),
  } as unknown as KVNamespace;
}

const mp3 = () => new Response(new Uint8Array(400).fill(7)).body;

let run: ReturnType<typeof vi.fn>;
let env: Env;

beforeEach(() => {
  run = vi.fn(async () => mp3());
  env = { STATE: fakeKv(), AI: { run } } as unknown as Env;
});

describe("ttsAudio", () => {
  test("generates once, then serves the cache without charging again", async () => {
    const a = await ttsAudio(env, "athena", "Attention. Test.", 1000);
    const b = await ttsAudio(env, "athena", "Attention. Test.", 1000);
    expect(a.ok && !a.cached).toBe(true);
    expect(b.ok && b.cached).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await ttsUsage(env)).toBe("Attention. Test.".length);
  });

  test("a different speaker is a different clip", async () => {
    await ttsAudio(env, "athena", "Hello there.", 1000);
    await ttsAudio(env, "zeus", "Hello there.", 1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("refuses once the daily cap would be exceeded", async () => {
    const r = await ttsAudio(env, "athena", "x".repeat(50), 10);
    expect(r).toEqual({ ok: false, reason: "cap" });
    expect(run).not.toHaveBeenCalled();
  });

  test("model failure or empty output reports failed (client falls back)", async () => {
    run.mockRejectedValueOnce(new Error("boom"));
    expect(await ttsAudio(env, "athena", "one", 1000)).toEqual({ ok: false, reason: "failed" });
    run.mockResolvedValueOnce(new Response("").body);
    expect(await ttsAudio(env, "athena", "two", 1000)).toEqual({ ok: false, reason: "failed" });
    expect(await ttsUsage(env)).toBe(0);
  });

  test("empty text is rejected", async () => {
    expect(await ttsAudio(env, "athena", "   ", 1000)).toEqual({ ok: false, reason: "empty" });
  });
});
