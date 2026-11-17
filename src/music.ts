import { signal } from "@preact/signals";
import type { ThreatLevel } from "../shared/types";
import { routeAudio } from "./audioOut";

export interface Track {
  title: string;
  file: string;
}

const LS_KEY = "shelly.v2.music";
function loadOn(): boolean {
  try {
    return localStorage.getItem(LS_KEY) !== "0";
  } catch {
    return true;
  }
}
function saveOn(on: boolean): void {
  try {
    localStorage.setItem(LS_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked */
  }
}

/** Visitor's own on/off toggle. Remembered on this device, so "off" stays off after a reload. */
export const musicOn = signal(loadOn());
/** Admin switch: when false there is no music at all and the control is hidden. */
export const musicAllowed = signal(true);
export const nowPlaying = signal<string>("");

let tracks: Track[] = [];
let audio: HTMLAudioElement | null = null;
let order: number[] = [];
let pos = 0;
let baseVolume = 0.35;
let disabled = new Set<string>();
let level: ThreatLevel = "CALM";
let ducked = false;
/** TVs/kiosks keep playing when the page is in the background; phones and desktops don't. */
let backgroundPlay = false;
/** Pause events we cause ourselves (hidden page, track change) must not count as "the user paused". */
let ignorePauseUntil = 0;

function setOn(on: boolean): void {
  if (musicOn.value === on) return;
  musicOn.value = on;
  saveOn(on);
}

function hiddenNow(): boolean {
  return typeof document !== "undefined" && document.hidden && !backgroundPlay;
}

function ourPause(): void {
  if (!audio || audio.paused) return;
  ignorePauseUntil = Date.now() + 1000;
  audio.pause();
}

export function titleFromFile(file: string): string {
  return file.replace(/\.mp3$/i, "").replace(/_/g, "/");
}

function shuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const FACTOR: Record<ThreatLevel, number> = { CALM: 1, ELEVATED: 0.57, WARNING: 0.17, EMERGENCY: 0 };

function apply(): void {
  if (!audio) return;
  const silent = !musicAllowed.value || !musicOn.value || level === "EMERGENCY" || hiddenNow();
  audio.volume = silent ? 0 : Math.min(1, baseVolume * FACTOR[level] * (ducked ? 0.35 : 1));
  if (silent) ourPause();
  else if (audio.paused && audio.src) void audio.play().catch(() => undefined);
  syncMediaSession();
}

function playCurrent(): void {
  if (!audio || order.length === 0) return;
  const t = tracks[order[pos % order.length]!]!;
  ignorePauseUntil = Date.now() + 1000;
  audio.src = `/music/${encodeURIComponent(t.file)}`;
  nowPlaying.value = t.title;
  if ("mediaSession" in navigator && typeof MediaMetadata !== "undefined") {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: "SHELLY", artwork: [{ src: "/favicon.png", sizes: "512x512", type: "image/png" }] });
  }
  apply();
}

/** Admin settings: volume, master switch and which tracks are allowed. */
export function configureMusic(cfg: { enabled: boolean; volume: number; disabledTracks: string[] }): void {
  musicAllowed.value = cfg.enabled;
  baseVolume = cfg.volume;
  const changed = [...cfg.disabledTracks].sort().join("|") !== [...disabled].sort().join("|");
  disabled = new Set(cfg.disabledTracks);
  if (changed && tracks.length) rebuildOrder();
  apply();
}

function rebuildOrder(): void {
  const allowed = tracks.map((_, i) => i).filter((i) => !disabled.has(tracks[i]!.file));
  order = shuffle(allowed.length).map((i) => allowed[i]!);
  pos = 0;
  if (audio && order.length) playCurrent();
  else if (audio) audio.pause();
}

export async function startMusic(): Promise<void> {
  if (audio || !musicAllowed.value) return;
  try {
    const res = await fetch("/music/playlist.json");
    tracks = ((await res.json()) as { tracks?: Track[] }).tracks ?? [];
  } catch {
    return;
  }
  if (tracks.length === 0) return;
  audio = new Audio();
  await routeAudio(audio); // follows "Play sound on…" (e.g. a Roku), default speaker otherwise
  // If autoplay was blocked (no gesture yet), the first interaction unlocks it.
  const unlock = (): void => apply();
  addEventListener("pointerdown", unlock, { once: true });
  addEventListener("keydown", unlock, { once: true });
  audio.addEventListener("ended", () => {
    pos += 1;
    playCurrent();
  });
  // Paused from outside the app (lock screen, notification, headphones, Bluetooth): respect it.
  audio.addEventListener("pause", () => {
    if (!audio || audio.ended || Date.now() < ignorePauseUntil || hiddenNow()) return;
    setOn(false);
  });
  wireMediaSession();
  rebuildOrder();
}

export function nextTrack(): void {
  pos += 1;
  playCurrent();
}

export function toggleMusic(): void {
  setOn(!musicOn.value);
  if (musicOn.value && !audio) void startMusic();
  apply();
}

/** Phone/desktop: stop when the visitor leaves the page. Kiosk/TV: keep playing. */
export function setBackgroundPlay(allowed: boolean): void {
  backgroundPlay = allowed;
  apply();
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => apply());

// ── system media controls (lock screen, notification, headphone buttons) ──
function wireMediaSession(): void {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (action: MediaSessionAction, fn: () => void) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* action not supported on this browser */
    }
  };
  set("play", () => {
    setOn(true);
    apply();
  });
  set("pause", () => {
    setOn(false);
    apply();
  });
  set("stop", () => {
    setOn(false);
    apply();
  });
  set("nexttrack", () => nextTrack());
}

function syncMediaSession(): void {
  if (!audio || !("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
}

/** Music policy: calm=on, elevated=low, warning=ducked, emergency=off. */
export function applyThreatToMusic(next: ThreatLevel): void {
  level = next;
  apply();
}

/** Re-evaluate after the visitor toggles music. */
export function refreshMusic(): void {
  apply();
}

/** Lower the music while the host talks. */
export function setDucked(on: boolean): void {
  ducked = on;
  apply();
}
