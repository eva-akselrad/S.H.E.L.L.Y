import { alertScript, isSpokenAlert } from "../shared/script";
import type { Alert, ThreatLevel } from "../shared/types";
import { playAlertChime } from "./alertSound";
import { routeAudio, unrouteAudio } from "./audioOut";

export { alertScript };

export interface VoiceOpts {
  /** use the server-generated voice (falls back to the browser voice on any failure) */
  ai: boolean;
  lat: number;
  lon: number;
}

const spoken = new Set<string>();
let repeatTimer: ReturnType<typeof setInterval> | undefined;
let current: HTMLAudioElement | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en-us") || v.lang.toLowerCase() === "en_us");
  const pool = en.length ? en : voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  // Prefer the natural/neural voices browsers ship over the old robotic defaults.
  const rank = (v: SpeechSynthesisVoice): number => {
    const n = v.name.toLowerCase();
    if (/natural|neural|online/.test(n)) return 0;
    if (/google us english|samantha|ava|allison|zira|aria|jenny/.test(n)) return 1;
    if (!v.localService) return 2;
    return 3;
  };
  return [...pool].sort((a, b) => rank(a) - rank(b))[0] ?? voices[0] ?? null;
}

function browserSay(text: string, onEnd?: () => void): void {
  if (!("speechSynthesis" in window) || !text) return onEnd?.();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 0.95;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  speechSynthesis.speak(u);
}

async function speak(a: Alert, emergency: boolean, voice?: VoiceOpts): Promise<void> {
  await playAlertChime(emergency ? "emergency" : "warning"); // notification sound first, then the words
  const fallback = (): void => browserSay(alertScript(a, emergency));
  if (!voice?.ai || typeof Audio === "undefined") return fallback();
  try {
    const q = new URLSearchParams({ alert: a.id, lat: String(voice.lat), lon: String(voice.lon) });
    const res = await fetch(`/api/tts?${q}`);
    if (!res.ok) return fallback();
    const url = URL.createObjectURL(await res.blob());
    current?.pause();
    const audio = new Audio(url);
    current = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      unrouteAudio(audio);
    };
    await routeAudio(audio); // same speaker as the music
    await audio.play();
  } catch {
    fallback();
  }
}

export function stopSpeaking(): void {
  if (repeatTimer) clearInterval(repeatTimer);
  repeatTimer = undefined;
  current?.pause();
  current = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

/**
 * Announce newly-seen alerts once (WARNING level and up). While the level is
 * EMERGENCY the primary alert is repeated every 90 seconds.
 */
export function announce(
  level: ThreatLevel,
  active: Alert[],
  primary: Alert | null,
  enabled: boolean,
  voice?: VoiceOpts,
): void {
  if (!enabled) return;
  if (level === "CALM" || level === "ELEVATED") {
    stopSpeaking();
    return;
  }
  const fresh = active.filter((a) => !spoken.has(a.id) && isSpokenAlert(a)).slice(0, 3);
  for (const a of fresh) {
    spoken.add(a.id);
    void speak(a, level === "EMERGENCY" && a.id === primary?.id, voice);
  }
  if (level === "EMERGENCY" && primary && !repeatTimer) {
    repeatTimer = setInterval(() => void speak(primary, true, voice), 90_000);
  }
  if (level !== "EMERGENCY" && repeatTimer) {
    clearInterval(repeatTimer);
    repeatTimer = undefined;
  }
}
