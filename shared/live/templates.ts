// Deterministic on-air text. Alert wording is NEVER written by an LLM: it comes from here.
import type { Alert, SpcCategory } from "../types";

const TIME = (iso: string | null, tz: string): string => {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  } catch {
    return "";
  }
};

export function shortArea(a: Alert, max = 2): string {
  const parts = a.areaDesc.split(";").map((s) => s.trim()).filter(Boolean);
  const head = parts.slice(0, max).join(", ");
  return parts.length > max ? `${head} +${parts.length - max} more` : head || "the area";
}

/** "TORNADO WARNING FOR BUCKS, PA UNTIL 4:15 PM" */
export function alertHeadline(a: Alert, tz: string): string {
  const until = TIME(a.expires, tz);
  return `${a.event} for ${shortArea(a)}${until ? ` until ${until}` : ""}`.toUpperCase();
}

/** What the host says for a watch or advisory. Calm and short; built only from NWS fields, never an LLM. */
export function watchScript(a: Alert, tz: string): string {
  const until = TIME(a.expires, tz);
  const tail = /watch$/i.test(a.event) ? " Conditions could develop, so keep an eye on the forecast." : "";
  return `The National Weather Service has a ${a.event} in effect for ${shortArea(a, 3)}${until ? ` until ${until}` : ""}.${tail}`;
}

export const SPC_PHRASE: Record<SpcCategory, string> = {
  NONE: "", TSTM: "General thunderstorms", MRGL: "Marginal risk", SLGT: "Slight risk", ENH: "Enhanced risk", MDT: "Moderate risk", HIGH: "High risk",
};

export function topAlertLine(top: Alert | null, regionName: string, tz: string): string {
  return top ? alertHeadline(top, tz) : `NO ACTIVE WARNINGS IN THE ${regionName.toUpperCase()}`;
}

export function statusLine(warnings: number, watches: number): string {
  if (warnings) return `${warnings} active warning${warnings > 1 ? "s" : ""}`;
  if (watches) return `${watches} active watch${watches > 1 ? "es" : ""}`;
  return "Awaiting new alerts";
}

/** Calm, fixed talk-break lines. The LLM may replace these (L2); these always work. */
export const TALK_BREAKS = [
  "You're watching SHELLY, keeping an eye on the sky over the {region} around the clock.",
  "Quick reminder: if a warning is ever issued for your area, I'll break in right away with what the National Weather Service says to do.",
  "Radar, forecasts and alerts for the {region}, all day and all night. I'm SHELLY, and I'm glad you're here.",
  "Everything you see here comes straight from National Weather Service data, updated every minute.",
  "Thanks for staying with us. Whatever the weather does next, SHELLY will be here to tell you about it.",
];

export function talkBreak(i: number, region: string): string {
  return TALK_BREAKS[i % TALK_BREAKS.length]!.replace("{region}", region);
}

export function cityHeadline(name: string, temp: number, desc: string): string {
  return `${name}: ${Math.round(temp)}° AND ${desc}`.toUpperCase();
}

export function citySpeak(name: string, temp: number, desc: string): string {
  return `In ${name}, it's ${Math.round(temp)} degrees and ${desc.toLowerCase()}.`;
}
