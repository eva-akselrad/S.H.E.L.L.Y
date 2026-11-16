import type { Alert } from "./types";

/** Spoken text for an alert. Pure so the server and the browser fallback say the same thing. */
export function alertScript(a: Alert, emergency = false): string {
  const area = a.areaDesc.split(";").map((s) => s.trim()).filter(Boolean).slice(0, 3).join(", ") || "your area";
  const intro = emergency
    ? `Attention. This is an emergency. A ${a.event} is in effect for ${area}.`
    : `Attention. The National Weather Service has issued a ${a.event} for ${area}.`;
  const body = (a.instruction || a.description).replace(/\s+/g, " ").trim().slice(0, 450);
  return `${intro} ${body}`.trim();
}

/** Only warnings and emergencies are ever spoken. */
export const isSpokenAlert = (a: Alert): boolean => /warning|emergency/i.test(a.event);
