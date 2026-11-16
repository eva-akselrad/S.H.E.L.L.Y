// Pure LLM helpers: prompt builders, JSON guard and the output filter.
// The LLM only writes "colour" (calm-period headlines and talk breaks). Alert, warning and
// instruction text always comes from shared/live/templates.ts.
import type { LiveConfig } from "../config";

export interface LlmPack {
  headlines: string[];
  talkBreak: string;
}

export interface PackContext {
  now: Date;
  region: string;
  tone: number;
  hostName: string;
  bannedTopics: string[];
  /** "Philadelphia: 54F, cloudy" */
  conditions: string[];
  spcPhrase: string;
  /** event names of alerts currently active in the region (names only, never text) */
  activeEvents: string[];
  level: string;
}

export function buildPackPrompt(c: PackContext): { system: string; user: string } {
  const tone = c.tone < 0.34 ? "calm and steady" : c.tone < 0.67 ? "warm with a light touch of wit" : "playful and upbeat";
  const system = [
    `You are ${c.hostName}, the on-air host of a 24/7 weather broadcast for the ${c.region}. Your tone is ${tone}.`,
    "You only write short colour text from the data you are given.",
    "HARD RULES: Never write or mention any alert, watch, warning, advisory or emergency, and never tell people to take shelter, evacuate or take cover. Alerts are handled by other systems.",
    "Never invent numbers, places or events that are not in the data. No URLs, hashtags, emoji or markdown.",
    c.bannedTopics.length ? `Never mention: ${c.bannedTopics.join(", ")}.` : "",
    'Reply with ONLY a JSON object: {"headlines": [8 strings, each under 70 characters], "talkBreak": "one or two friendly sentences, under 220 characters"}.',
  ]
    .filter(Boolean)
    .join(" ");
  const user = [
    `Time: ${c.now.toISOString()}`,
    `Threat level: ${c.level}`,
    `Severe outlook: ${c.spcPhrase || "no notable risk"}`,
    `Active alerts: ${c.activeEvents.length ? c.activeEvents.join(", ") : "none"}`,
    "Current conditions:",
    ...c.conditions.slice(0, 8).map((x) => `- ${x}`),
  ].join("\n");
  return { system, user };
}

/** Extract and validate the JSON pack. Returns null on anything malformed. */
export function parsePack(text: string): LlmPack | null {
  let t = text.trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(t.slice(a, b + 1));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.headlines) || typeof r.talkBreak !== "string") return null;
  const headlines = r.headlines.filter((h): h is string => typeof h === "string");
  if (headlines.length < 3) return null;
  return { headlines: headlines.slice(0, 12), talkBreak: r.talkBreak };
}

const SAFETY_PHRASES = [
  /\b(tornado|severe\s+thunderstorm|flash\s+flood|tsunami|hurricane|blizzard|winter\s+storm|ice\s+storm|excessive\s+heat|high\s+wind|flood)\s+(warning|watch|emergency|advisory)s?\b/i,
  /\b(take|seek)\s+(shelter|cover)\b/i,
  /\bevacuat/i,
  /\bwarning\b/i,
  /\bemergency\b/i,
  /\bpds\b|particularly dangerous/i,
];

/**
 * Clean one LLM string. Returns null when it must be discarded:
 * safety language is NEVER allowed from the LLM, whatever alerts are active.
 */
export function filterText(s: string, max: number): string | null {
  let t = s
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[*_`#>~[\]]/g, "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  if (SAFETY_PHRASES.some((re) => re.test(t))) return null;
  if (t.length > max) {
    const cut = t.slice(0, max);
    t = cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).trim();
  }
  return t || null;
}

export function cleanPack(p: LlmPack, bannedTopics: string[] = []): LlmPack | null {
  const banned = bannedTopics.map((b) => b.toLowerCase()).filter(Boolean);
  const ok = (s: string, max: number): string | null => {
    const t = filterText(s, max);
    return t && !banned.some((b) => t.toLowerCase().includes(b)) ? t : null;
  };
  const headlines = p.headlines.map((h) => ok(h, 80)).filter((h): h is string => !!h);
  const talkBreak = ok(p.talkBreak, 240);
  if (headlines.length < 3 || !talkBreak) return null;
  return { headlines, talkBreak };
}

export const utcDay = (d = new Date()): string => d.toISOString().slice(0, 10);

/** Small stable hash for cache keys. */
export function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export type LlmSettings = LiveConfig["llm"];
