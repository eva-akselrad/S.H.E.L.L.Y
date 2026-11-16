import { normalizeConfig, SPEAKERS, type Speaker } from "../shared/config";
import { filterText } from "../shared/live/llm";
import { callLlm, llmUsed } from "./llm";
import { produceRundown } from "./live";
import { isSimPreset, SIM_PRESETS, type SimEntry } from "../shared/simulate";
import type { Announcement } from "../shared/types";
import { isAuthed, login, logout } from "./auth";
import { pollAlerts } from "./poll";
import {
  audit,
  readAlerts,
  readAnnouncements,
  readAudit,
  readConfig,
  readRundown,
  readSim,
  writeAnnouncements,
  writeConfig,
  writeSim,
} from "./store";
import { handleStudioAdmin } from "./studio";
import { handleTtsPreview, ttsUsage } from "./tts";

const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

const iso = (v: unknown): string | null =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;

/** Handles /api/admin/* and announcement writes. Returns null for routes it doesn't own. */
export async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;

  // ── session ──
  if (path === "/api/admin/login" && method === "POST") return login(request, env);
  if (path === "/api/admin/logout" && method === "POST") return logout();
  if (path === "/api/admin/session") return json({ authed: await isAuthed(request, env) });

  const isAnnouncementWrite = path === "/api/announcements" && method !== "GET";
  if (!path.startsWith("/api/admin/") && !isAnnouncementWrite) return null;
  if (!(await isAuthed(request, env))) return json({ error: "unauthorized" }, 401);

  const body = async (): Promise<Record<string, unknown>> => {
    const b = await request.json().catch(() => null);
    return typeof b === "object" && b !== null && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  };

  // ── overview ──
  if (path === "/api/admin/status" && method === "GET") {
    const [{ updated, alerts }, sim, anns, config, log, ttsUsed] = await Promise.all([
      readAlerts(env),
      readSim(env),
      readAnnouncements(env, true),
      readConfig(env),
      readAudit(env),
      ttsUsage(env),
    ]);
    const ageSeconds = updated ? Math.round((Date.now() - new Date(updated).getTime()) / 1000) : null;
    const events = new Map<string, number>();
    for (const a of alerts) events.set(a.event, (events.get(a.event) ?? 0) + 1);
    return json({
      version: "2.0.0",
      poller: { updated, ageSeconds, count: alerts.length, top: [...events].sort((a, b) => b[1] - a[1]).slice(0, 6) },
      simulated: sim.length,
      announcements: anns.length,
      defaultLocation: config.defaultLocation?.name ?? null,
      voice: { engine: config.voice.engine, speaker: config.voice.speaker, used: ttsUsed, cap: config.voice.dailyCharCap },
      lastAction: log[0] ?? null,
    });
  }

  // ── announcements (list incl. scheduled; create; delete) ──
  if (path === "/api/admin/announcements" && method === "GET") return json(await readAnnouncements(env, true));

  if (path === "/api/announcements" && method === "POST") {
    const b = await body();
    const text = typeof b.text === "string" ? b.text.trim().slice(0, 500) : "";
    if (!text) return json({ error: "text_required" }, 400);
    const item: Announcement = {
      id: crypto.randomUUID(),
      text,
      level: b.level === "warn" ? "warn" : "info",
      created: new Date().toISOString(),
      starts: iso(b.starts),
      expires: iso(b.expires),
    };
    await writeAnnouncements(env, [item, ...(await readAnnouncements(env, true))]);
    await audit(env, "announcement.add", text.slice(0, 80));
    return json(item, 201);
  }

  if (path === "/api/announcements" && method === "DELETE") {
    const id = url.searchParams.get("id");
    const list = await readAnnouncements(env, true);
    await writeAnnouncements(env, list.filter((a) => a.id !== id));
    await audit(env, "announcement.remove", list.find((a) => a.id === id)?.text.slice(0, 80) ?? String(id));
    return json({ ok: true });
  }

  // ── display config ──
  if (path === "/api/admin/config" && method === "GET") return json(await readConfig(env));
  if (path === "/api/admin/config" && method === "PUT") {
    const next = normalizeConfig(await body());
    await writeConfig(env, next);
    await audit(env, "config.save", "display settings");
    return json(next);
  }

  // ── alert simulator ──
  if (path === "/api/admin/simulate" && method === "GET") return json(await readSim(env));
  if (path === "/api/admin/simulate" && method === "POST") {
    const b = await body();
    if (!isSimPreset(b.preset)) return json({ error: "bad_preset", presets: Object.keys(SIM_PRESETS) }, 400);
    const minutes = Math.min(120, Math.max(1, Math.round(Number(b.minutes) || 5)));
    const now = Date.now();
    const entry: SimEntry = {
      id: `sim-${crypto.randomUUID()}`,
      preset: b.preset,
      created: new Date(now).toISOString(),
      expires: new Date(now + minutes * 60_000).toISOString(),
    };
    await writeSim(env, [entry, ...(await readSim(env))]);
    await audit(env, "simulate.start", `${SIM_PRESETS[b.preset].label} for ${minutes} min`);
    return json(entry, 201);
  }
  if (path === "/api/admin/simulate" && method === "DELETE") {
    const id = url.searchParams.get("id");
    const list = await readSim(env);
    await writeSim(env, id ? list.filter((s) => s.id !== id) : []);
    await audit(env, "simulate.stop", id ? "one" : "all");
    return json({ ok: true });
  }

  // ── voice preview ──
  if (path === "/api/admin/tts-preview" && method === "POST") {
    const b = await body();
    const speaker = (SPEAKERS as readonly unknown[]).includes(b.speaker) ? (b.speaker as Speaker) : "athena";
    return handleTtsPreview(env, speaker, (await readConfig(env)).voice.dailyCharCap);
  }

  const studio = await handleStudioAdmin(request, env, url);
  if (studio) return studio;

  // ── SHELLY Live ──
  if (path === "/api/admin/live" && method === "GET") {
    const c = await readConfig(env);
    return json({ keySet: !!env.LLM_API_KEY, used: await llmUsed(env), cap: c.live.llm.dailyRequestCap, rundown: await readRundown(env) });
  }
  if (path === "/api/admin/live/refresh" && method === "POST") {
    const r = await produceRundown(env);
    return json({ ok: !!r, rundown: r }, r ? 200 : 409);
  }
  if (path === "/api/admin/live/token" && method === "POST") {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const c = await readConfig(env);
    const next = { ...c, live: { ...c.live, viewerToken: token } };
    await writeConfig(env, next);
    await audit(env, "live.token", "new viewer token");
    return json({ viewerToken: token });
  }
  if (path === "/api/admin/live/llm-test" && method === "POST") {
    const c = await readConfig(env);
    const r = await callLlm(
      env,
      c.live.llm,
      [
        { role: "system", content: `You are ${c.live.host.name}, a friendly weather host. Reply with one short, friendly sentence.` },
        { role: "user", content: "Say hello to the viewers of the stream." },
      ],
      { timeoutMs: 20_000 },
    );
    await audit(env, "live.llm-test", r.ok ? `ok ${r.ms}ms ${r.model ?? ""}` : `failed: ${r.error}`);
    return json({ ...r, filtered: r.text ? filterText(r.text, 240) : null, used: await llmUsed(env), cap: c.live.llm.dailyRequestCap });
  }

  // ── tools ──
  if (path === "/api/admin/refresh-alerts" && method === "POST") {
    const ok = await pollAlerts(env); // keeps the old snapshot if NWS is unreachable
    await audit(env, "alerts.refresh", ok ? "repolled NWS" : "repoll failed");
    return json({ ok }, ok ? 200 : 502);
  }

  if (path === "/api/admin/audit" && method === "GET") return json(await readAudit(env));

  return json({ error: "not_found" }, 404);
}
