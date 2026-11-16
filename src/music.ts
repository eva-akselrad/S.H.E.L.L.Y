import { signal } from "@preact/signals";
import type { ThreatLevel } from "../shared/types";

export interface Track {
  title: string;
  file: string;
}

export const musicOn = signal(true);
export const nowPlaying = signal<string>("");

let tracks: Track[] = [];
let audio: HTMLAudioElement | null = null;
let order: number[] = [];
let pos = 0;

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

function playCurrent(): void {
  if (!audio || tracks.length === 0) return;
  const t = tracks[order[pos % order.length]!]!;
  audio.src = `/music/${encodeURIComponent(t.file)}`;
  nowPlaying.value = t.title;
  void audio.play().catch(() => {
    /* autoplay blocked until a gesture */
  });
}

export async function startMusic(): Promise<void> {
  if (audio) return;
  try {
    const res = await fetch("/music/playlist.json");
    tracks = ((await res.json()) as { tracks: Track[] }).tracks;
  } catch {
    return;
  }
  if (tracks.length === 0) return;
  audio = new Audio();
  audio.volume = 0.35;
  audio.addEventListener("ended", () => {
    pos += 1;
    playCurrent();
  });
  order = shuffle(tracks.length);
  playCurrent();
}

export function nextTrack(): void {
  pos += 1;
  playCurrent();
}

export function toggleMusic(): void {
  musicOn.value = !musicOn.value;
}

/** Music policy: calm=on, elevated=low, warning=ducked, emergency=off. */
export function applyThreatToMusic(level: ThreatLevel): void {
  if (!audio) return;
  const target = { CALM: 0.35, ELEVATED: 0.2, WARNING: 0.06, EMERGENCY: 0 }[level];
  audio.volume = musicOn.value ? target : 0;
  if (!musicOn.value || level === "EMERGENCY") audio.pause();
  else if (audio.paused) void audio.play().catch(() => undefined);
}
