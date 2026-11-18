import { beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG } from "../shared/config";
import { buildPackPrompt, cleanPack, filterText, parsePack } from "../shared/live/llm";
import { callLlm } from "../worker/llm";
import { produceRundown } from "../worker/live";

function fakeKv(): KVNamespace {
  const m = new Map<string, string>();
  return {
    get: async (k: string, t?: string) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)!) : m.get(k)) : null),
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  } as unknown as KVNamespace;
}

describe("output filter", () => {
  test("blocks fake alert and shelter language from the LLM", () => {
    expect(filterText("TORNADO WARNING FOR PHILADELPHIA", 80)).toBeNull();
    expect(filterText("A tornado watch is in effect", 80)).toBeNull();
    expect(filterText("Take shelter now", 80)).toBeNull();
    expect(filterText("Flash flood emergency downtown", 80)).toBeNull();
    expect(filterText("Seek cover immediately", 80)).toBeNull();
    expect(filterText("Sunny skies and a light breeze", 80)).toBe("Sunny skies and a light breeze");
  });
  test("strips urls, markdown and emoji and caps length", () => {
    expect(filterText("**Nice** day see https://evil.example/x now", 80)).toBe("Nice day see now");
    expect(filterText("Hello ☀️ there", 80)).toBe("Hello there");
    expect((filterText("word ".repeat(40), 30) ?? "").length).toBeLessThanOrEqual(30);
  });
  test("cleanPack drops bad lines and needs enough good ones", () => {
    const good = ["Mild and breezy in Philly", "Clouds roll in this evening", "A quiet night ahead", "Cool morning on the Shore"];
    expect(cleanPack({ headlines: [...good, "TORNADO WARNING NOW"], talkBreak: "Enjoy the evening." })?.headlines).toEqual(good);
    expect(cleanPack({ headlines: ["TORNADO WARNING", ...good.slice(0, 2)], talkBreak: "Hi" })).toBeNull();
    expect(cleanPack({ headlines: good, talkBreak: "Take shelter!" })).toBeNull();
    expect(cleanPack({ headlines: good, talkBreak: "Chat about politics." }, ["politics"])).toBeNull();
  });
});

describe("json guard", () => {
  const body = '{"headlines":["a one","b two","c three"],"talkBreak":"hello"}';
  test("accepts plain, fenced and chatty replies", () => {
    expect(parsePack(body)?.talkBreak).toBe("hello");
    expect(parsePack("```json\n" + body + "\n```")?.headlines).toHaveLength(3);
    expect(parsePack("Sure! Here you go: " + body + " Hope that helps")?.talkBreak).toBe("hello");
  });
  test("rejects broken or wrong-shaped output", () => {
    expect(parsePack("{not json")).toBeNull();
    expect(parsePack("no braces")).toBeNull();
    expect(parsePack('{"headlines":"x","talkBreak":1}')).toBeNull();
    expect(parsePack('{"headlines":["a"],"talkBreak":"b"}')).toBeNull();
  });
});

test("the prompt forbids alerts and carries only data", () => {
  const p = buildPackPrompt({
    now: new Date("2026-11-16T18:00:00Z"), region: "Philadelphia region", tone: 0.1, hostName: "SHELLY", bannedTopics: ["gossip"],
    conditions: ["Trenton: 50F, cloudy"], spcPhrase: "", activeEvents: [], level: "CALM",
  });
  expect(p.system).toContain("Never write or mention any alert");
  expect(p.system).toContain("gossip");
  expect(p.user).toContain("Trenton: 50F, cloudy");
});

describe("LLM client and producer fallbacks", () => {
  let env: Env;
  const live = { ...DEFAULT_CONFIG.live, enabled: true, llm: { ...DEFAULT_CONFIG.live.llm, enabled: true, models: ["a:free", "b:free"], dailyRequestCap: 3 } };
  const cfg = { ...DEFAULT_CONFIG, live };
  const reply = (content: string) => new Response(JSON.stringify({ model: "a:free", choices: [{ message: { content } }] }));
  const good =
    '{"headlines":["Mild afternoon in Philly","Clouds thicken tonight","Breezy along the Shore","Quiet weather continues"],"talkBreak":"Glad you are here."}';

  beforeEach(() => {
    env = { STATE: fakeKv(), LLM_API_KEY: "k" } as unknown as Env;
  });

  test("valid JSON from the model reaches the rundown", async () => {
    vi.stubGlobal("fetch", async (u: string) => (String(u).includes("chat/completions") ? reply(good) : Promise.reject(new Error("offline"))));
    const r = await produceRundown(env, cfg);
    expect(r?.headlines).toContain("Mild afternoon in Philly");
    expect(r?.items.some((i) => i.kind === "host" && i.source === "llm")).toBe(true);
  });

  test.each([
    ["broken JSON", () => reply("{oops")],
    ["a 429", () => new Response("{}", { status: 429 })],
    ["a timeout/network error", () => Promise.reject(new Error("aborted"))],
    ["unsafe text", () => reply('{"headlines":["TORNADO WARNING NOW","Take shelter","Seek cover"],"talkBreak":"Take cover!"}')],
  ])("%s still yields a working template rundown", async (_n, make) => {
    vi.stubGlobal("fetch", async (u: string) => (String(u).includes("chat/completions") ? make() : Promise.reject(new Error("offline"))));
    const r = await produceRundown(env, cfg);
    expect(r?.level).toBe("CALM");
    expect(r?.headlines).toEqual([]);
    expect(r?.items.some((i) => i.kind === "host" && i.source === "template")).toBe(true);
  });

  test("no key, no models, or the daily cap reached never call out", async () => {
    const f = vi.fn(async () => reply(good));
    vi.stubGlobal("fetch", f);
    expect((await callLlm({ STATE: fakeKv() } as unknown as Env, live.llm, [])).error).toBe("no_api_key");
    expect((await callLlm(env, { ...live.llm, models: [] }, [])).error).toBe("no_models");
    for (let i = 0; i < 3; i++) expect((await callLlm(env, live.llm, [])).ok).toBe(true);
    expect((await callLlm(env, live.llm, [])).error).toBe("daily_cap_reached");
    expect(f).toHaveBeenCalledTimes(3);
  });

  test("sends the fallback list, auth and OpenRouter headers", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => reply(good));
    vi.stubGlobal("fetch", f);
    await callLlm(env, live.llm, [{ role: "user", content: "x" }], { json: true });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const h = init!.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer k");
    expect(h["X-Title"]).toBe("SHELLY");
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: "a:free", models: ["a:free", "b:free"], response_format: { type: "json_object" } });
  });
});

import { needsNoThink, stripThinking } from "../shared/live/llm";
describe("reasoning-model output", () => {
  test("strips <think> blocks", () => {
    expect(stripThinking('<think>let me see\nthe weather</think>{"a":1}')).toBe('{"a":1}');
    expect(stripThinking('{"a":1}')).toBe('{"a":1}');
    expect(stripThinking("thinking aloud</think> done")).toBe("done");
  });
  test("only Qwen3 gets the no-think switch", () => {
    expect(needsNoThink("qwen3:8b")).toBe(true);
    expect(needsNoThink("meta-llama/llama-3.3-70b:free")).toBe(false);
  });
});

describe("local provider request", () => {
  test("asks a local model not to think", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    }));
    const env = { LLM_API_KEY: "k".repeat(32), STATE: { get: async () => null, put: async () => undefined } } as unknown as Env;
    const cfg = { ...DEFAULT_CONFIG.live.llm, enabled: true, provider: "openai-compatible" as const, baseUrl: "https://llm.test/v1", models: ["shelly-qwen3"] };
    await callLlm(env, cfg, [{ role: "user", content: "hi" }], { json: true });
    expect(sent.reasoning_effort).toBe("none");
    await callLlm(env, { ...cfg, provider: "openrouter" }, [{ role: "user", content: "hi" }], { json: true });
    expect(sent.reasoning_effort).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
