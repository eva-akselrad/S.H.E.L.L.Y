import type { Alert, ThreatLevel } from "../shared/types";

/** Spoken text for an alert. Pure so it can be tested. */
export function alertScript(a: Alert, emergency = false): string {
  const area = a.areaDesc.split(";").map((s) => s.trim()).filter(Boolean).slice(0, 3).join(", ") || "your area";
  const intro = emergency
    ? `Attention. This is an emergency. A ${a.event} is in effect for ${area}.`
    : `Attention. The National Weather Service has issued a ${a.event} for ${area}.`;
  const body = (a.instruction || a.description).replace(/\s+/g, " ").trim().slice(0, 450);
  return `${intro} ${body}`.trim();
}

const spoken = new Set<string>();
let repeatTimer: ReturnType<typeof setInterval> | undefined;

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  for (const pref of ["Google US English", "Microsoft David", "Alex", "Daniel", "en-US"]) {
    const v = voices.find((x) => x.name.includes(pref) || x.lang === pref);
    if (v) return v;
  }
  return voices.find((v) => v.lang.startsWith("en")) ?? voices[0] ?? null;
}

function say(text: string, onEnd?: () => void): void {
  if (!("speechSynthesis" in window) || !text) return onEnd?.();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 0.9;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (repeatTimer) clearInterval(repeatTimer);
  repeatTimer = undefined;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

/**
 * Announce newly-seen alerts once (WARNING level and up). While the level is
 * EMERGENCY the primary alert is repeated every 90 seconds.
 */
export function announce(level: ThreatLevel, active: Alert[], primary: Alert | null, enabled: boolean): void {
  if (!enabled || !("speechSynthesis" in window)) return;
  if (level === "CALM" || level === "ELEVATED") {
    stopSpeaking();
    return;
  }
  const fresh = active.filter((a) => !spoken.has(a.id) && /warning|emergency/i.test(a.event)).slice(0, 3);
  for (const a of fresh) {
    spoken.add(a.id);
    say(alertScript(a, level === "EMERGENCY" && a.id === primary?.id));
  }
  if (level === "EMERGENCY" && primary && !repeatTimer) {
    repeatTimer = setInterval(() => say(alertScript(primary, true)), 90_000);
  }
  if (level !== "EMERGENCY" && repeatTimer) {
    clearInterval(repeatTimer);
    repeatTimer = undefined;
  }
}
