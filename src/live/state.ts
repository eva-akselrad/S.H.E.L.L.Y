import { computed, signal } from "@preact/signals";
import type { Rundown, RundownItem } from "../../shared/live/rundown";
import type { StudioProduct } from "../../shared/studio";
import type { RadarFrames } from "../../shared/types";
import { dropPlayed, pickIndex } from "./player";

export const viewerKey = (): string => new URLSearchParams(location.search).get("key") ?? "";

export const rundown = signal<Rundown | null>(null);
export const index = signal(0);
/** bumps on every advance so the playback effect re-runs even for a one-item rundown */
export const epoch = signal(0);
export const status = signal<"loading" | "ok" | "offline" | "disabled" | "forbidden">("loading");
export const radar = signal<RadarFrames | null>(null);
export const clock = signal(Date.now());
/** 0..1 mouth openness while the host speaks (from audio amplitude, or a synthetic flap) */
export const products = signal<StudioProduct[]>([]);
export const mouth = signal(0);
export const speaking = signal(false);

export const current = computed<RundownItem | null>(() => {
  const r = rundown.value;
  return r ? (r.items[index.value % Math.max(1, r.items.length)] ?? null) : null;
});

export const upNext = computed<RundownItem[]>(() => {
  const r = rundown.value;
  if (!r || r.items.length < 2) return [];
  const n = r.items.length;
  return [1, 2, 3].map((d) => r.items[(index.value + d) % n]!).filter((i) => i.key !== current.value?.key);
});

/** forecaster one-shots (say, play next) this page has already played; never again, even if a rebuild keeps them */
export const playedOneShots = new Set<string>();

/** last forecaster jump command seen; the first rundown only records it */
let lastCmd: string | null | undefined;

export async function pollRundown(): Promise<void> {
  try {
    const res = await fetch(`/api/live/rundown?key=${encodeURIComponent(viewerKey())}`);
    if (res.status === 404) status.value = "disabled";
    else if (res.status === 403) status.value = "forbidden";
    else if (res.ok) {
      const next = dropPlayed((await res.json()) as Rundown, playedOneShots);
      let i = pickIndex(rundown.value, index.value, next);
      let jumped = false;
      const cmd = next.cmd ?? null;
      if (lastCmd !== undefined && cmd && cmd.id !== lastCmd) {
        // the forecaster pressed something in the admin: play it now
        i = cmd.kind === "skip" ? (i + 1) % Math.max(1, next.items.length) : 0;
        jumped = true;
      }
      lastCmd = cmd?.id ?? null;
      if (jumped || i !== index.value || !rundown.value) epoch.value++;
      index.value = i;
      rundown.value = next;
      status.value = "ok";
    } else if (!rundown.value) status.value = "loading";
  } catch {
    // keep playing the last rundown; the stream never goes dark because the network blinked
    if (!rundown.value) status.value = "offline";
  }
}

export async function pollRadar(): Promise<void> {
  try {
    const res = await fetch("/api/radar");
    if (res.ok) radar.value = (await res.json()) as RadarFrames;
  } catch {
    /* keep the last frames */
  }
}

export function advance(): void {
  const n = rundown.value?.items.length ?? 0;
  if (n > 0) index.value = (index.value + 1) % n;
  epoch.value++;
}

export async function pollProducts(): Promise<void> {
  try {
    const res = await fetch("/api/studio");
    if (res.ok) products.value = (await res.json()) as StudioProduct[];
  } catch {
    /* keep the last list */
  }
}
