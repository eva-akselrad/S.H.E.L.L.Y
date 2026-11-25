import { DEFAULT_CONFIG, normalizeConfig, type SiteConfig } from "../shared/config";
import type { SimEntry } from "../shared/simulate";
import type { Rundown } from "../shared/live/rundown";
import { activeControl, type LiveControl } from "../shared/live/blocks";
import { normalizeProducts, type StudioProduct } from "../shared/studio";
import { normalizeSnowLog, SNOW_LOG_MAX, type SnowLogEntry } from "../shared/snowday";
import type { Alert, Announcement } from "../shared/types";

export const ALERTS_KEY = "alerts:active";
const ANN_KEY = "announcements";
const CONFIG_KEY = "config";
const SIM_KEY = "sim-alerts";
const AUDIT_KEY = "audit";
const RUNDOWN_KEY = "live:rundown";
const LIVE_STATE_KEY = "live:state";
const STUDIO_KEY = "studio:products";

export interface AuditEntry {
  t: string;
  action: string;
  detail: string;
}

export async function readAlerts(env: Env): Promise<{ updated: string | null; alerts: Alert[] }> {
  return (await env.STATE.get<{ updated: string; alerts: Alert[] }>(ALERTS_KEY, "json")) ?? { updated: null, alerts: [] };
}

export async function readAnnouncements(env: Env, includeScheduled = false): Promise<Announcement[]> {
  const list = (await env.STATE.get<Announcement[]>(ANN_KEY, "json")) ?? [];
  const now = Date.now();
  return list
    .map((a) => ({ ...a, starts: a.starts ?? null }))
    .filter((a) => !a.expires || new Date(a.expires).getTime() > now)
    .filter((a) => includeScheduled || !a.starts || new Date(a.starts).getTime() <= now);
}

export async function writeAnnouncements(env: Env, list: Announcement[]): Promise<void> {
  await env.STATE.put(ANN_KEY, JSON.stringify(list.slice(0, 30)));
}

export async function readConfig(env: Env): Promise<SiteConfig> {
  const raw = await env.STATE.get(CONFIG_KEY, "json");
  return raw ? normalizeConfig(raw) : DEFAULT_CONFIG;
}

export async function writeConfig(env: Env, c: SiteConfig): Promise<void> {
  await env.STATE.put(CONFIG_KEY, JSON.stringify(c));
}

export async function readSim(env: Env): Promise<SimEntry[]> {
  const list = (await env.STATE.get<SimEntry[]>(SIM_KEY, { type: "json", cacheTtl: 30 })) ?? [];
  const now = Date.now();
  return list.filter((s) => new Date(s.expires).getTime() > now);
}

export async function writeSim(env: Env, list: SimEntry[]): Promise<void> {
  await env.STATE.put(SIM_KEY, JSON.stringify(list.slice(0, 10)));
}

export async function readAudit(env: Env): Promise<AuditEntry[]> {
  return (await env.STATE.get<AuditEntry[]>(AUDIT_KEY, "json")) ?? [];
}

export async function audit(env: Env, action: string, detail = ""): Promise<void> {
  const list = await readAudit(env);
  list.unshift({ t: new Date().toISOString(), action, detail: detail.slice(0, 200) });
  await env.STATE.put(AUDIT_KEY, JSON.stringify(list.slice(0, 100)));
}

export interface LiveState {
  lastWarningEndedAt: string | null;
  hadWarning: boolean;
}

export async function readRundown(env: Env): Promise<Rundown | null> {
  return env.STATE.get<Rundown>(RUNDOWN_KEY, { type: "json", cacheTtl: 30 }); // 30 s is the shortest KV edge cache
}
export async function writeRundown(env: Env, r: Rundown): Promise<void> {
  await env.STATE.put(RUNDOWN_KEY, JSON.stringify(r));
}
export async function readLiveState(env: Env): Promise<LiveState> {
  return (await env.STATE.get<LiveState>(LIVE_STATE_KEY, "json")) ?? { lastWarningEndedAt: null, hadWarning: false };
}
export async function writeLiveState(env: Env, s: LiveState): Promise<void> {
  await env.STATE.put(LIVE_STATE_KEY, JSON.stringify(s));
}

export async function readProducts(env: Env): Promise<StudioProduct[]> {
  return normalizeProducts(await env.STATE.get(STUDIO_KEY, "json"));
}
export async function writeProducts(env: Env, list: StudioProduct[]): Promise<void> {
  await env.STATE.put(STUDIO_KEY, JSON.stringify(list.slice(0, 50)));
}

const CONTROL_KEY = "live:control";
export async function readControl(env: Env): Promise<LiveControl> {
  return activeControl(await env.STATE.get(CONTROL_KEY, "json"), Date.now());
}
export async function writeControl(env: Env, c: LiveControl): Promise<void> {
  await env.STATE.put(CONTROL_KEY, JSON.stringify(c));
}

const SNOW_LOG_KEY = "snowday:log";
export async function readSnowLog(env: Env): Promise<SnowLogEntry[]> {
  return normalizeSnowLog(await env.STATE.get(SNOW_LOG_KEY, "json"));
}
export async function writeSnowLog(env: Env, list: SnowLogEntry[]): Promise<void> {
  await env.STATE.put(SNOW_LOG_KEY, JSON.stringify(list.slice(0, SNOW_LOG_MAX)));
}
