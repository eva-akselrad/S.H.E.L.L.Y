import { signal } from "@preact/signals";
import type { ThreatLevel } from "../shared/types";

export interface Track {
  title: string;
  file: string;
}

/** Visitor's own on/off toggle. */
export const musicOn = signal(true);
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
  const silent = !musicAllowed.value || !musicOn.value || level === "EMERGENCY";
  audio.volume = silent ? 0 : Math.min(1, baseVolume * FACTOR[level]);
  if (silent) audio.pause();
  else if (audio.paused && audio.src) void audio.play().catch(() => undefined);
}

function playCurrent(): void {
  if (!audio || order.length === 0) return;
  const t = tracks[order[pos % order.length]!]!;
  audio.src = `/music/${encodeURIComponent(t.file)}`;
  nowPlaying.value = t.title;
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
    tracks = ((await res.json()) as { tracks: Track[] }).tracks;
  } catch {
    return;
  }
  if (tracks.length === 0) return;
  audio = new Audio();
  audio.addEventListener("ended", () => {
    pos += 1;
    playCurrent();
  });
  rebuildOrder();
}

export function nextTrack(): void {
  pos += 1;
  playCurrent();
}

export function toggleMusic(): void {
  musicOn.value = !musicOn.value;
  if (musicOn.value && !audio) void startMusic();
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
