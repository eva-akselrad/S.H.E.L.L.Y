import { playAlertChime } from "../alertSound";
import { hashKey } from "../../shared/live/llm";
import type { RundownItem } from "../../shared/live/rundown";
import { mouth, speaking, viewerKey } from "./state";

let ctx: AudioContext | null = null;
let flapTimer: ReturnType<typeof setInterval> | undefined;
/** the AI voice clip that is playing now, so a new item can cut it off instead of talking over it */
let playing: { audio: HTMLAudioElement; done: () => void } | null = null;

function stopFlap(): void {
  if (flapTimer) clearInterval(flapTimer);
  flapTimer = undefined;
  mouth.value = 0;
  speaking.value = false;
}
function syntheticFlap(): void {
  speaking.value = true;
  flapTimer = setInterval(() => (mouth.value = 0.25 + Math.random() * 0.6), 120);
}

function browserSay(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === "undefined" || !text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    syntheticFlap();
    speechSynthesis.speak(u);
  });
}

async function aiSay(item: RundownItem): Promise<boolean> {
  try {
    const q = new URLSearchParams({ key: viewerKey(), item: item.key, h: hashKey(item.speak ?? "") });
    const res = await fetch(`/api/live/tts?${q}`);
    if (!res.ok) return false;
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    // drive the mascot's mouth from the real audio amplitude
    let analyser: AnalyserNode | null = null;
    try {
      ctx ??= new AudioContext();
      const src = ctx.createMediaElementSource(audio);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      if (ctx.state === "suspended") await ctx.resume();
    } catch {
      analyser = null;
    }
    speaking.value = true;
    const data = new Uint8Array(analyser?.frequencyBinCount ?? 0);
    let raf = 0;
    const tick = (): void => {
      if (analyser) {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        mouth.value = Math.min(1, peak / 60);
      } else mouth.value = 0.3 + Math.random() * 0.5;
      raf = requestAnimationFrame(tick);
    };
    tick();
    await new Promise<void>((resolve) => {
      playing = { audio, done: resolve };
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    });
    playing = null;
    cancelAnimationFrame(raf);
    URL.revokeObjectURL(url);
    stopFlap();
    return true;
  } catch {
    stopFlap();
    return false;
  }
}

/** Speak an item's text. Resolves when finished (or immediately if there is nothing to say). */
const chimed = new Set<string>();

export async function speakItem(item: RundownItem, ai: boolean): Promise<void> {
  // an alert item opens with the notification sound, once per item per page
  // (watches and advisories are read calmly, with no chime)
  if (item.kind === "alert" && item.speak && /warning|emergency/i.test(item.headline) && !chimed.has(item.key)) {
    chimed.add(item.key);
    await playAlertChime(item.headline.toUpperCase().includes("TORNADO") ? "emergency" : "warning");
  }
  if (!item.speak) return;
  if (ai && (await aiSay(item))) return;
  await browserSay(item.speak);
  stopFlap();
}

export function stopVoice(): void {
  if (playing) {
    playing.audio.pause();
    playing.done();
    playing = null;
  }
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  stopFlap();
}
