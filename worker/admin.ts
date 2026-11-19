import { normalizeConfig, SPEAKERS, type Speaker } from "../shared/config";
import { filterText } from "../shared/live/llm";
import { BLOCK_INFO, normalizeBulletin, normalizeEntry } from "../shared/live/blocks";
import { callLlm, llmUsed } from "./llm";
import { prepareVoice, produceRundown, type VoicePrep } from "./live";
import { bulletinSpeech } from "../shared/live/rundown";
import { isSimPreset, normalizeCustomSim, SIM_PRESETS, simLabel, type SimEntry } from "../shared/simulate";
import type { Announcement } from "../shared/types";
import { isAuthed, login, logout } from "./auth";
import { latencyStats, type LatencySample } from "../shared/health";
import { LATENCY_KEY, pollAlerts } from "./poll";
import { sendCustomFcm, serviceAccount, sendTestFcm } from "./fcm";
import { readSubs, sendCustomPush, sendTestPush, vapid } from "./push";
import {
  audit,
  readAlerts,
  readAnnouncements,
  readAudit,
  readConfig,
  readControl,
  readRundown,
  readSim,
  writeAnnouncements,
  writeConfig,
  writeControl,
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
    const [{ updated, alerts }, sim, anns, config, log, ttsUsed, samples, subs] = await Promise.all([
      readAlerts(env),
      readSim(env),
      readAnnouncements(env, true),
      readConfig(env),
      readAudit(env),
      ttsUsage(env),
      env.STATE.get<LatencySample[]>(LATENCY_KEY, "json"),
      readSubs(env),
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
      latency: latencyStats(samples ?? [], Date.now() - 7 * 86_400_000),
      push: { configured: !!vapid(env), subscribers: subs.length },
      fcm: { configured: !!serviceAccount(env) },
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
    const custom = b.preset === "custom" ? normalizeCustomSim(b.custom) : null;
    if (b.preset === "custom" ? !custom : !isSimPreset(b.preset)) return json({ error: "bad_preset", presets: [...Object.keys(SIM_PRESETS), "custom"] }, 400);
    const minutes = Math.min(120, Math.max(1, Math.round(Number(b.minutes) || 5)));
    const now = Date.now();
    const entry: SimEntry = {
      id: `sim-${crypto.randomUUID()}`,
      preset: b.preset as SimEntry["preset"],
      ...(custom ? { custom } : {}),
      created: new Date(now).toISOString(),
      expires: new Date(now + minutes * 60_000).toISOString(),
    };
    await writeSim(env, [entry, ...(await readSim(env))]);
    await audit(env, "simulate.start", `${simLabel(entry)} for ${minutes} min`);
    await produceRundown(env).catch(() => null); // on the broadcast now, not at the next cron tick
    return json(entry, 201);
  }
  if (path === "/api/admin/simulate" && method === "DELETE") {
    const id = url.searchParams.get("id");
    const list = await readSim(env);
    await writeSim(env, id ? list.filter((s) => s.id !== id) : []);
    await audit(env, "simulate.stop", id ? "one" : "all");
    await produceRundown(env).catch(() => null);
    return json({ ok: true });
  }

  // ── voice preview ──
  if (path === "/api/admin/tts-preview" && method === "POST") {
    const b = await body();
    const speaker = (SPEAKERS as readonly unknown[]).includes(b.speaker) ? (b.speaker as Speaker) : "athena";
    const vc = (await readConfig(env)).voice;
    return handleTtsPreview(env, speaker, vc.dailyCharCap, vc.local);
  }

  const studio = await handleStudioAdmin(request, env, url);
  if (studio) return studio;

  // ── SHELLY Live ──
  if (path === "/api/admin/live" && method === "GET") {
    const c = await readConfig(env);
    return json({ keySet: !!env.LLM_API_KEY, used: await llmUsed(env), cap: c.live.llm.dailyRequestCap, rundown: await readRundown(env), control: await readControl(env) });
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

  // on-air controls: play next, hold, release, skip, back to top, say something
  if (path === "/api/admin/live/control" && method === "POST") {
    const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b.action !== "string") return json({ error: "bad_body" }, 400);
    const c = await readControl(env);
    const id = crypto.randomUUID().slice(0, 8);
    const now = Date.now();
    let detail = "";
    let voice: VoicePrep | undefined;
    switch (b.action) {
      case "skip":
      case "top":
        c.cmd = { id, kind: b.action };
        break;
      case "cue":
      case "hold": {
        const e = normalizeEntry(b.entry);
        if (!e) return json({ error: "bad_entry" }, 400);
        const entry = { ...e, on: true };
        if (b.action === "cue") c.cue = { id, entry, at: new Date(now).toISOString() };
        else {
          const minutes = Math.min(240, Math.max(1, Math.round(Number(b.minutes) || 15)));
          c.hold = { entry, until: new Date(now + minutes * 60_000).toISOString() };
          detail = `${minutes} min`;
        }
        detail = `${BLOCK_INFO[entry.block].label} ${detail}`.trim();
        c.cmd = { id, kind: "top" };
        break;
      }
      case "release":
        c.hold = null;
        c.cmd = { id, kind: "top" };
        break;
      case "say": {
        const text = typeof b.text === "string" ? b.text.replace(/\s+/g, " ").trim().slice(0, 400) : "";
        if (!text) return json({ error: "empty_text" }, 400);
        // make the voice before it goes on air; reread the controls, which may have changed meanwhile
        voice = await prepareVoice(env, text);
        Object.assign(c, await readControl(env));
        c.say = { id, text, at: new Date(now).toISOString(), source: b.source === "ai" ? "ai" : "you" };
        c.cmd = { id, kind: "top" };
        detail = text.slice(0, 120);
        break;
      }
      default:
        return json({ error: "bad_action" }, 400);
    }
    await writeControl(env, c);
    await audit(env, `live.${b.action}`, detail);
    return json({ control: c, rundown: await produceRundown(env), ...(voice ? { voice } : {}) });
  }

  // your own bulletins: shown and (optionally) read on air, labelled as SHELLY's, never as NWS products
  if (path === "/api/admin/live/bulletin" && method === "POST") {
    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const hours = Math.min(48, Math.max(0.25, Number(raw?.hours) || 3));
    const bul = normalizeBulletin({ ...raw, id: `b${crypto.randomUUID().slice(0, 8)}`, issued: new Date().toISOString(), until: new Date(Date.now() + hours * 3600_000).toISOString() });
    if (!bul) return json({ error: "bulletin_needs_title_and_text" }, 400);
    // make the voice first, then put it on air: it plays straight from the cache instead of waiting
    const voice = await prepareVoice(env, bulletinSpeech(bul));
    const c = await readControl(env);
    c.bulletins = [bul, ...c.bulletins].slice(0, 8);
    c.cmd = { id: bul.id, kind: "top" };
    await writeControl(env, c);
    await audit(env, "live.bulletin", `${bul.level}: ${bul.title}`);
    return json({ control: c, rundown: await produceRundown(env), voice });
  }
  if (path === "/api/admin/live/bulletin" && method === "DELETE") {
    const c = await readControl(env);
    const bid = url.searchParams.get("id");
    c.bulletins = c.bulletins.filter((x) => x.id !== bid);
    await writeControl(env, c);
    await audit(env, "live.bulletin.remove", bid ?? "");
    return json({ control: c, rundown: await produceRundown(env) });
  }

  // an AI-written line for the forecaster to read over and approve. Never aired from here.
  if (path === "/api/admin/live/ai-line" && method === "POST") {
    const b = (await request.json().catch(() => null)) as { prompt?: unknown } | null;
    const ask = typeof b?.prompt === "string" ? b.prompt.trim().slice(0, 300) : "";
    if (!ask) return json({ error: "empty_prompt" }, 400);
    const c = await readConfig(env);
    const rd = await readRundown(env);
    const conditions = (rd?.wx?.cities ?? []).slice(0, 6).map((x) => `${x.name}: ${Math.round(x.now.temp)}F`).join(", ");
    const system = [
      `You are ${c.live.host.name}, the friendly on-air host of a 24/7 weather stream for the ${c.live.region.name}.`,
      "Write ONE or TWO short spoken sentences (under 300 characters) for the host to say, following the producer's request.",
      "Never write or mention any alert, watch, warning, advisory or emergency, never tell people to shelter or evacuate, and never invent weather numbers.",
      "No emoji, URLs, hashtags or markdown. Reply with only the sentences.",
      conditions ? `Current temperatures you may use: ${conditions}.` : "",
    ].filter(Boolean).join(" ");
    const res = await callLlm(env, c.live.llm, [{ role: "system", content: system }, { role: "user", content: ask }], { timeoutMs: 20_000 });
    if (!res.ok || !res.text) return json({ ok: false, error: res.error ?? "no_text", used: await llmUsed(env) });
    const text = filterText(res.text, 300);
    await audit(env, "live.ai-line", text ? "drafted" : "filtered");
    return json(text ? { ok: true, text, used: await llmUsed(env) } : { ok: false, error: "The reply mentioned alerts or safety actions, so it was thrown away. Try again.", used: await llmUsed(env) });
  }

  // ── tools ──
  if (path === "/api/admin/refresh-alerts" && method === "POST") {
    const ok = (await pollAlerts(env)) !== null; // keeps the old snapshot if NWS is unreachable
    await audit(env, "alerts.refresh", ok ? "repolled NWS" : "repoll failed");
    return json({ ok }, ok ? 200 : 502);
  }

  if (path === "/api/admin/push-test" && method === "POST") {
    if (!vapid(env)) return json({ error: "push_not_configured" }, 409);
    const r = await sendTestPush(env);
    await audit(env, "push.test", `${r.sent}/${r.total} delivered`);
    return json(r);
  }

  if (path === "/api/admin/fcm-test" && method === "POST") {
    if (!serviceAccount(env)) return json({ error: "fcm_not_configured" }, 409);
    const ok = await sendTestFcm(env).catch(() => false);
    await audit(env, "fcm.test", ok ? "sent to app topic" : "send failed");
    return json({ ok }, ok ? 200 : 502);
  }

  // ── custom announcement (admin-written text only) ──
  if (path === "/api/admin/notify" && method === "POST") {
    const b = await body();
    const title = typeof b.title === "string" ? b.title.trim().slice(0, 65) : "";
    const text = typeof b.body === "string" ? b.body.trim().slice(0, 240) : "";
    if (!title || !text) return json({ error: "title_and_body_required" }, 400);
    const toApp = b.app !== false;
    const toWeb = b.web !== false;
    const result: { app: boolean | null; web: { sent: number; failed: number; total: number } | null } = { app: null, web: null };
    if (toApp && serviceAccount(env)) result.app = await sendCustomFcm(env, title, text).catch(() => false);
    if (toWeb) result.web = await sendCustomPush(env, title, text);
    await audit(env, "notify.send", `"${title}" app=${result.app ?? "off"} web=${result.web ? result.web.sent : "off"}`);
    return json(result);
  }

  if (path === "/api/admin/audit" && method === "GET") return json(await readAudit(env));

  return json({ error: "not_found" }, 404);
}
