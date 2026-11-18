// SHELLY host personality rules: pure functions, no Preact, so tests and the worker typecheck can use them.
import type { RundownItem } from "../../../shared/live/rundown";
import type { ThreatLevel } from "../../../shared/types";

export type HostState = "idle" | "talking" | "serious" | "offair";
export type Mood = "happy" | "curious" | "focused" | "worried";
export type Outfit = "none" | "shades" | "winter" | "umbrella" | "sleepy";
export type Trick = "none" | "look" | "lookR" | "wave" | "tilt" | "hop" | "blink2" | "sparkle";

export function hostState(level: ThreatLevel, isSpeaking: boolean, offAir = false): HostState {
  if (offAir) return "offair";
  if (level === "WARNING" || level === "EMERGENCY") return "serious";
  return isSpeaking ? "talking" : "idle";
}

export function moodFor(level: ThreatLevel): Mood {
  return level === "EMERGENCY" ? "worried" : level === "WARNING" ? "focused" : level === "ELEVATED" ? "curious" : "happy";
}

/** Weather outfit from the first city's current conditions and the local hour. */
export function outfitFor(w: { temp: number; code: number; isDay: boolean } | null, hour: number, level: ThreatLevel): Outfit {
  if (!w || level === "WARNING" || level === "EMERGENCY") return "none";
  const wet = (w.code >= 51 && w.code <= 67) || (w.code >= 80 && w.code <= 82) || w.code >= 95;
  const snowy = (w.code >= 71 && w.code <= 77) || w.code === 85 || w.code === 86;
  if (wet) return "umbrella";
  if (snowy || w.temp <= 40) return "winter";
  if (w.isDay && w.code <= 1 && w.temp >= 68) return "shades";
  if (hour >= 23 || hour < 5) return "sleepy";
  return "none";
}

/** Short on-screen reaction to the current item. Colour only: never alert content. */
export function quipFor(it: RundownItem | null, outfit: Outfit): string | null {
  if (!it) return null;
  switch (it.kind) {
    case "segment":
      if (it.temp <= 20) return "Brrrr!";
      if (it.temp <= 38) return "Bundle up!";
      if (it.temp >= 90) return "Stay cool!";
      if (it.temp >= 72 && outfit === "shades") return "Beautiful!";
      if (/rain|drizzle|shower/i.test(it.desc)) return "Grab an umbrella!";
      return null;
    case "radar":
      return it.view === "region" ? "Radar check!" : null;
    case "map":
      return "Fresh from the forecaster!";
    case "block":
      return ({ sevenDay: "The week ahead!", hourly: "Hour by hour!", sun: "Look at that sky.", extremes: "Who's warmest?", weekend: "Weekend plans?", wind: "Hold onto your hat!", rainChance: "Umbrella check!", ident: "Hi, that's me!", tempsNow: "Temperature check!" } as Partial<Record<string, string>>)[it.block] ?? null;
    default:
      return null;
  }
}

export type HostPreview = { outfit?: Outfit; mood?: Mood; trick?: Trick };
const OUTFITS: readonly Outfit[] = ["none", "shades", "winter", "umbrella", "sleepy"];
const MOODS: readonly Mood[] = ["happy", "curious", "focused", "worried"];
const TRICK_IDS: readonly Trick[] = ["look", "lookR", "wave", "tilt", "hop", "blink2", "sparkle"];

/**
 * Preview-only look override for filming: /live?host=winter,worried,wave sets an outfit, a mood
 * and/or a repeating trick. Cosmetic only: it never changes the threat level, the glow, what airs
 * or whether the host goes serious. Unknown words are ignored.
 */
export function parseHostPreview(search: string): HostPreview {
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get("host");
  } catch {
    return {};
  }
  const out: HostPreview = {};
  for (const w of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if ((OUTFITS as readonly string[]).includes(w)) out.outfit = w as Outfit;
    else if ((MOODS as readonly string[]).includes(w)) out.mood = w as Mood;
    else if ((TRICK_IDS as readonly string[]).includes(w)) out.trick = w as Trick;
  }
  return out;
}
