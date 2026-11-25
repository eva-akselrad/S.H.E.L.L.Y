import { pointInGeometry } from "./geo";
import type { Alert, Outlook, SpcCategory, ThreatLevel, ThreatState } from "./types";

export interface ThreatInput {
  alerts: Alert[];
  point: { lat: number; lon: number; zones: string[] };
  outlook?: Outlook | null;
  /** 15-minute precip (mm) for the next couple of hours */
  nowcast?: { time: string; precip: number }[];
  /** peak CAPE in the next 6 h, J/kg */
  cape?: number;
  now?: Date;
}

const RANK: Record<ThreatLevel, 0 | 1 | 2 | 3> = { CALM: 0, ELEVATED: 1, WARNING: 2, EMERGENCY: 3 };
const SPC_ORDER: SpcCategory[] = ["NONE", "TSTM", "MRGL", "SLGT", "ENH", "MDT", "HIGH"];

export function alertCoversPoint(a: Alert, p: ThreatInput["point"]): boolean {
  if (a.geometry) return pointInGeometry(p.lon, p.lat, a.geometry);
  return a.zones.some((z) => p.zones.includes(z));
}

export function isEmergency(a: Alert): boolean {
  const e = a.event.toLowerCase();
  const h = `${a.headline} ${a.description}`.toLowerCase();
  if (e.includes("tornado emergency") || e.includes("flash flood emergency")) return true;
  if (h.includes("tornado emergency") || h.includes("flash flood emergency")) return true;
  if (h.includes("particularly dangerous situation")) return true;
  const p = a.params;
  if (p.tornadoDetection?.toUpperCase() === "OBSERVED" && e.includes("tornado warning")) return true;
  if (p.thunderstormDamageThreat?.toUpperCase() === "DESTRUCTIVE") return true;
  if (p.tornadoDamageThreat?.toUpperCase() === "CATASTROPHIC") return true;
  if (p.flashFloodDamageThreat?.toUpperCase() === "CATASTROPHIC") return true;
  return false;
}

/** Warnings about danger in the next minutes to an hour. Only these take over the screen. Long-lasting warnings
 *  (high wind, coastal flood, winter storm, hurricane, ...) are real but not urgent, so they rank as ELEVATED. */
const URGENT_WARNING = /tornado|severe thunderstorm|flash flood|extreme wind|snow squall|dust storm|special marine|tsunami|shelter in place|civil danger|evacuation|nuclear|radiological|hazardous materials|avalanche|earthquake|volcano|ashfall/;
export const isUrgentWarning = (a: Alert): boolean => {
  const e = a.event.toLowerCase();
  return e.endsWith("warning") && URGENT_WARNING.test(e);
};

export function alertLevel(a: Alert): ThreatLevel {
  if (isEmergency(a)) return "EMERGENCY";
  const e = a.event.toLowerCase();
  if (isUrgentWarning(a)) return "WARNING";
  if (e.endsWith("warning")) return "ELEVATED"; // long-lasting: shown on the page and map, but no takeover
  if (e.endsWith("watch") || e.endsWith("advisory") || e.endsWith("statement")) return "ELEVATED";
  return a.severity === "Extreme" || a.severity === "Severe" ? "ELEVATED" : "CALM";
}

export function spcMax(o: Outlook | null | undefined): SpcCategory {
  if (!o) return "NONE";
  const d1 = o.days.find((d) => d.day === 1);
  return d1?.category ?? "NONE";
}

export function stormsNearby(nowcast: ThreatInput["nowcast"], cape = 0, now = new Date()): boolean {
  if (!nowcast?.length) return false;
  const horizon = now.getTime() + 60 * 60 * 1000;
  const heavy = nowcast.some((n) => {
    const t = new Date(n.time).getTime();
    return t <= horizon && n.precip >= 2.5; // mm per 15 min: intense convective rain
  });
  return heavy && cape >= 1000;
}

function sev(a: Alert): number {
  return { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 }[a.severity];
}

export function computeThreat(input: ThreatInput): ThreatState {
  const now = input.now ?? new Date();
  const active = input.alerts
    .filter((a) => !a.expires || new Date(a.expires).getTime() > now.getTime())
    .filter((a) => alertCoversPoint(a, input.point));

  let level: ThreatLevel = "CALM";
  let primary: Alert | null = null;
  const reasons: string[] = [];

  for (const a of active) {
    const l = alertLevel(a);
    if (RANK[l] > RANK[level]) {
      level = l;
      primary = a;
    } else if (RANK[l] === RANK[level] && l !== "CALM" && primary && sev(a) > sev(primary)) {
      primary = a;
    }
    if (l !== "CALM") reasons.push(a.event);
  }

  if (level === "CALM" || level === "ELEVATED") {
    if (SPC_ORDER.indexOf(spcMax(input.outlook)) >= SPC_ORDER.indexOf("SLGT")) {
      level = "ELEVATED";
      reasons.push(`SPC ${spcMax(input.outlook)} risk today`);
    }
    if (stormsNearby(input.nowcast, input.cape, now)) {
      level = "ELEVATED";
      reasons.push("Storms in nowcast");
    }
  }

  return {
    level,
    rank: RANK[level],
    reasons: [...new Set(reasons)],
    primary,
    active,
    expiresAt: primary?.expires ?? null,
  };
}
