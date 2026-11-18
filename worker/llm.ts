import { cleanPack, hashKey, needsNoThink, parsePack, stripThinking, utcDay, type LlmPack, type LlmSettings } from "../shared/live/llm";

export interface LlmResult {
  ok: boolean;
  text?: string;
  model?: string;
  ms: number;
  error?: string;
}

const countKey = () => `llm-count:${utcDay()}`;

export async function llmUsed(env: Env): Promise<number> {
  return Number((await env.STATE.get(countKey())) ?? 0) || 0;
}

/** Reserve one request from today's budget. False when the cap is reached. */
async function reserve(env: Env, cap: number): Promise<boolean> {
  const n = await llmUsed(env);
  if (n >= cap) return false;
  await env.STATE.put(countKey(), String(n + 1), { expirationTtl: 2 * 86400 });
  return true;
}

/** One OpenAI-compatible chat completion. Never throws. Counts against the daily cap. */
export async function callLlm(
  env: Env,
  cfg: LlmSettings,
  messages: { role: "system" | "user"; content: string }[],
  opts: { json?: boolean; timeoutMs?: number } = {},
): Promise<LlmResult> {
  const t0 = Date.now();
  const fail = (error: string): LlmResult => ({ ok: false, ms: Date.now() - t0, error });
  if (!env.LLM_API_KEY) return fail("no_api_key");
  if (!cfg.models.length) return fail("no_models");
  if (!(await reserve(env, cfg.dailyRequestCap))) return fail("daily_cap_reached");

  // a local Qwen3 would otherwise spend the token budget "thinking" before it answers
  const sent = needsNoThink(cfg.models[0] ?? "") ? messages.map((m, i) => (i === messages.length - 1 ? { ...m, content: `${m.content}
/no_think` } : m)) : messages;
  const body: Record<string, unknown> = {
    model: cfg.models[0],
    messages: sent,
    temperature: cfg.temperature,
    max_tokens: 700,
  };
  // OpenRouter tries the listed models in order on rate limits and server errors
  if (cfg.provider === "openrouter" && cfg.models.length > 1) body.models = cfg.models.slice(0, 3);
  if (opts.json) body.response_format = { type: "json_object" };
  // a local reasoning model (Qwen3 on Ollama) otherwise spends the token budget thinking before it answers
  if (cfg.provider === "openai-compatible") body.reasoning_effort = "none";

  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${env.LLM_API_KEY}` };
  if (cfg.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://evaakselrad.com";
    headers["X-Title"] = "SHELLY";
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 25_000);
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) return fail(res.status === 429 ? "rate_limited" : `http_${res.status}`);
    const d = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
    const raw = d.choices?.[0]?.message?.content;
    const text = typeof raw === "string" ? stripThinking(raw) : "";
    if (!text) return fail("empty_response");
    return { ok: true, text, model: d.model, ms: Date.now() - t0 };
  } catch (err) {
    return fail(ctl.signal.aborted ? "timeout" : `network:${String(err).slice(0, 80)}`);
  } finally {
    clearTimeout(timer);
  }
}

interface StoredPack {
  at: number;
  level: string;
  inputHash: string;
  pack: LlmPack;
}

const PACK_KEY = "live:pack";
const HOUR = 60 * 60_000;

/**
 * Return a cleaned LLM pack, generating at most one per hour (or one per 5 min when the
 * threat level changes). Null means "use templates".
 */
export async function getPack(
  env: Env,
  cfg: LlmSettings,
  prompt: { system: string; user: string },
  level: string,
  banned: string[],
  now = Date.now(),
): Promise<LlmPack | null> {
  if (!cfg.enabled) return null;
  const stored = await env.STATE.get<StoredPack>(PACK_KEY, "json");
  const inputHash = hashKey(prompt.system + prompt.user.replace(/Time:[^\n]*\n/, ""));
  if (stored) {
    const age = now - stored.at;
    if (age < HOUR && !(stored.level !== level && age >= 5 * 60_000)) return stored.pack;
    if (age < HOUR && stored.inputHash === inputHash) return stored.pack; // same weather: no new call
  }
  const r = await callLlm(env, cfg, [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }], { json: true });
  const parsed = r.ok && r.text ? parsePack(r.text) : null;
  const pack = parsed ? cleanPack(parsed, banned) : null;
  if (!pack) {
    console.error(JSON.stringify({ msg: "llm_pack_unusable", error: r.error ?? "bad_json" }));
    // back off: keep the old pack (or none) and retry in ~5 minutes rather than hammering
    if (stored) await env.STATE.put(PACK_KEY, JSON.stringify({ ...stored, at: Math.max(stored.at, now - HOUR + 5 * 60_000) }));
    return stored?.pack ?? null;
  }
  await env.STATE.put(PACK_KEY, JSON.stringify({ at: now, level, inputHash, pack } satisfies StoredPack), { expirationTtl: 86400 });
  return pack;
}
