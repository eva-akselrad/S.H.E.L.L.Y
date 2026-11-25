import { alertLevel, isEmergency } from "../threat";
import type { LightningLevel } from "../lightning";
import type { Alert, SpcCategory, ThreatLevel } from "../types";

export interface IntensityInput {
  /** active alerts already filtered to the region */
  alerts: Alert[];
  spc: SpcCategory;
  /** peak CAPE (J/kg) over the region in the next few hours, if known */
  cape?: number;
  /** when the last warning in the region ended (decay window), ISO or null */
  lastWarningEndedAt?: string | null;
  now?: number;
  /** worst lightning level over the region (GLM satellite). Only nudges the score; never changes the level. */
  lightning?: LightningLevel;
}

export interface Counters {
  tor: number;
  svr: number;
  ffw: number;
  watch: number;
}

export interface Intensity {
  score: number; // 0..1
  level: ThreatLevel;
  drivers: string[];
  counters: Counters;
}

/** Lightning is not an NWS alert: it can add a little to the score, but never past this, which sits below the warning floor (0.5). */
export const LIGHTNING_NUDGE: Record<LightningLevel, number> = { clear: 0, nearby: 0.03, danger: 0.06 };
export const LIGHTNING_CAP = 0.45;
export const DECAY_MS = 30 * 60 * 1000;
const FRESH_MS = 10 * 60 * 1000;
const SPC_WEIGHT: Record<SpcCategory, number> = { NONE: 0, TSTM: 0.02, MRGL: 0.05, SLGT: 0.15, ENH: 0.3, MDT: 0.5, HIGH: 0.7 };
const SPC_NAME: Record<SpcCategory, string> = {
  NONE: "", TSTM: "general thunder", MRGL: "a marginal risk", SLGT: "a slight risk", ENH: "an enhanced risk", MDT: "a moderate risk", HIGH: "a high risk",
};

const ev = (a: Alert) => a.event.toLowerCase();
export const isTor = (a: Alert) => ev(a).includes("tornado warning");
export const isSvr = (a: Alert) => ev(a).includes("severe thunderstorm warning");
export const isFfw = (a: Alert) => ev(a).includes("flash flood warning");
export const isWatch = (a: Alert) => ev(a).endsWith("watch");

/** How much one watch (or advisory) adds to the score: a Tornado Watch matters far more than a High Wind Watch. */
export function watchWeight(a: Alert): number {
  const e = ev(a);
  if (e.includes("tornado")) return 0.25;
  if (e.includes("severe thunderstorm")) return 0.15;
  if (/flash flood|hurricane|tropical storm|storm surge|blizzard|winter storm|ice storm|tsunami/.test(e)) return 0.1;
  if (e.endsWith("watch")) return 0.02; // high wind, flood, heat, cold, fire weather, etc.
  return 0.01; // advisories and statements
}

export function countAlerts(alerts: Alert[]): Counters {
  return {
    tor: alerts.filter(isTor).length,
    svr: alerts.filter(isSvr).length,
    ffw: alerts.filter(isFfw).length,
    watch: alerts.filter(isWatch).length,
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeIntensity(input: IntensityInput): Intensity {
  const now = input.now ?? Date.now();
  const active = input.alerts.filter((a) => !a.expires || Date.parse(a.expires) > now);
  const counters = countAlerts(active);
  const drivers: string[] = [];

  let score = 0;
  let level = "CALM" as ThreatLevel;
  const rank: Record<ThreatLevel, number> = { CALM: 0, ELEVATED: 1, WARNING: 2, EMERGENCY: 3 };
  const raise = (l: ThreatLevel) => {
    if (rank[l] > rank[level]) level = l;
  };

  let emergency = false;
  let newestWarning = 0;
  // watches and advisories are low-level: a pile of them must not look like a storm day
  let watchScore = 0;
  let minorScore = 0;
  let otherWarnScore = 0;
  for (const a of active) {
    const l = alertLevel(a);
    raise(l);
    if (isEmergency(a)) emergency = true;
    if (isTor(a)) score += 0.25;
    else if (isSvr(a) || isFfw(a)) {
      score += 0.08;
    } else if (l === "WARNING") score += 0.08; // other urgent warnings (snow squall, special marine, ...)
    else if (ev(a).endsWith("warning")) otherWarnScore += 0.03; // high wind, coastal flood, winter storm, etc.: real, but not urgent
    else if (isWatch(a)) watchScore += watchWeight(a);
    else if (l === "ELEVATED") minorScore += watchWeight(a);
    if (l === "WARNING" || l === "EMERGENCY") newestWarning = Math.max(newestWarning, Date.parse(a.sent) || 0);
  }
  score += Math.min(otherWarnScore, 0.15) + Math.min(watchScore, 0.3) + Math.min(minorScore, 0.04);
  if (counters.tor) drivers.push(`${counters.tor} tornado warning${counters.tor > 1 ? "s" : ""}`);
  if (counters.svr) drivers.push(`${counters.svr} severe thunderstorm warning${counters.svr > 1 ? "s" : ""}`);
  if (counters.ffw) drivers.push(`${counters.ffw} flash flood warning${counters.ffw > 1 ? "s" : ""}`);
  if (counters.watch) drivers.push(`${counters.watch} watch${counters.watch > 1 ? "es" : ""}`);

  const spcW = SPC_WEIGHT[input.spc];
  if (spcW > 0) {
    score += spcW;
    if (SPC_NAME[input.spc]) drivers.push(`${SPC_NAME[input.spc]} of severe weather today`);
    if (spcW >= SPC_WEIGHT.SLGT) raise("ELEVATED");
  }
  if ((input.cape ?? 0) >= 2000) {
    score += 0.05;
    drivers.push("a very unstable atmosphere");
  }

  // decay: the score eases down over 30 minutes after the last warning ends
  if (level !== "WARNING" && level !== "EMERGENCY" && input.lastWarningEndedAt) {
    const since = now - Date.parse(input.lastWarningEndedAt);
    if (since >= 0 && since < DECAY_MS) {
      score += 0.3 * (1 - since / DECAY_MS);
      drivers.push("warnings that just expired");
    }
  }

  // floors so the score always agrees with the level
  if (level === "WARNING") score = Math.max(score, 0.5);
  if (level === "ELEVATED") score = Math.max(score, 0.1);
  // a fresh warning spikes the score briefly (applied after the floor so it always shows)
  if (newestWarning && now - newestWarning < FRESH_MS) {
    score += 0.1;
    drivers.push("a newly issued warning");
  }
  // lightning nudge: calm and elevated only, small, and capped under the warning floor so it can't outrank a warning
  const lt = input.lightning ?? "clear";
  if (lt !== "clear" && level !== "WARNING" && level !== "EMERGENCY" && !emergency) {
    score = Math.min(score + LIGHTNING_NUDGE[lt], Math.max(score, LIGHTNING_CAP));
    drivers.push("lightning nearby");
  }
  if (emergency) {
    level = "EMERGENCY";
    score = 1;
  }
  return { score: r2(Math.min(1, score)), level, drivers, counters };
}
