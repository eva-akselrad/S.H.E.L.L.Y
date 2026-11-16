import { beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG } from "../shared/config";
import { produceRundown } from "../worker/live";
import worker from "../worker/index";
import { readRundown } from "../worker/store";

type Req = Parameters<typeof worker.fetch>[0];

function fakeKv(): KVNamespace & { puts: number } {
  const m = new Map<string, string>();
  const kv = {
    puts: 0,
    get: async (k: string, type?: string) => {
      const v = m.get(k);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    put: async (k: string, v: string) => {
      kv.puts++;
      m.set(k, v);
    },
    delete: async (k: string) => void m.delete(k),
  };
  return kv as unknown as KVNamespace & { puts: number };
}

vi.stubGlobal("fetch", () => Promise.reject(new Error("offline in tests")));
const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
let env: Env;
const call = (path: string) => worker.fetch(new Request(`https://x${path}`) as Req, env, ctx);
const enable = async (token = "") =>
  env.STATE.put("config", JSON.stringify({ ...DEFAULT_CONFIG, live: { ...DEFAULT_CONFIG.live, enabled: true, viewerToken: token } }));

beforeEach(() => {
  env = { STATE: fakeKv() } as Env;
});

describe("live producer and API", () => {
  test("disabled by default: no rundown, API says so", async () => {
    expect(await produceRundown(env)).toBeNull();
    expect((await call("/api/live/rundown")).status).toBe(404);
  });

  test("with every upstream down it still produces a calm rundown", async () => {
    await enable();
    const r = await produceRundown(env);
    expect(r?.level).toBe("CALM");
    expect(r?.items.length).toBeGreaterThan(0);
    const res = await call("/api/live/rundown");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { level: string }).level).toBe("CALM");
  });

  test("KV is only written when the content changes", async () => {
    await enable();
    await produceRundown(env);
    const kv = env.STATE as unknown as { puts: number };
    const before = kv.puts;
    await produceRundown(env);
    // the failed-upstream retries write nothing; the unchanged rundown is not rewritten
    expect(kv.puts).toBe(before);
  });

  test("a simulated tornado warning flips the rundown to WARNING within one tick", async () => {
    await enable();
    const now = Date.now();
    await env.STATE.put(
      "sim-alerts",
      JSON.stringify([{ id: "sim-1", preset: "tornado-warning", created: new Date(now).toISOString(), expires: new Date(now + 600_000).toISOString() }]),
    );
    const r = await produceRundown(env);
    expect(r?.level).toBe("WARNING");
    expect(r?.items[0]?.kind).toBe("alert");
    expect((await readRundown(env))?.level).toBe("WARNING");
  });

  test("the viewer token gates the rundown and is hidden from public config", async () => {
    await enable("tok-1234567890abcdef");
    await produceRundown(env);
    expect((await call("/api/live/rundown")).status).toBe(403);
    expect((await call("/api/live/rundown?key=wrong")).status).toBe(403);
    expect((await call("/api/live/rundown?key=tok-1234567890abcdef")).status).toBe(200);
    const cfg = (await (await call("/api/config")).json()) as { live: { viewerToken: string } };
    expect(cfg.live.viewerToken).toBe("");
  });
});
