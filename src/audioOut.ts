// "Play sound on…": send SHELLY's own audio (music + spoken warnings) to a chosen speaker,
// e.g. a Roku used as a wireless display, while the rest of the computer stays on headphones.
// Uses HTMLMediaElement.setSinkId. The choice is remembered per browser.
import { signal } from "@preact/signals";

export interface Output {
  id: string;
  label: string;
}

const LS_KEY = "shelly.v2.sink";
type SinkEl = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

/** "" = system default */
export const sinkId = signal<string>(load());
/** the label of the chosen speaker, for the button */
export const sinkLabel = signal<string>("");
export const outputs = signal<Output[]>([]);
/** the speaker list is only readable after the browser grants access */
export const outputsUnlocked = signal(false);

const elements = new Set<SinkEl>();

function load(): string {
  try {
    return localStorage.getItem(LS_KEY) ?? "";
  } catch {
    return "";
  }
}
function save(id: string): void {
  try {
    if (id) localStorage.setItem(LS_KEY, id);
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* storage blocked */
  }
}

export function sinkSupported(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype && !!navigator.mediaDevices?.enumerateDevices;
}

/** The id to actually use: the saved speaker if it's connected right now, otherwise the default. */
function effectiveId(): string {
  const id = sinkId.value;
  if (!id) return "";
  // before we've listed devices we can't know; try it (a failure falls back to default below)
  if (!outputs.value.length) return id;
  return outputs.value.some((o) => o.id === id) ? id : "";
}

async function applyTo(el: SinkEl): Promise<void> {
  if (!el.setSinkId) return;
  const want = effectiveId();
  try {
    await el.setSinkId(want);
  } catch {
    // speaker gone (Roku disconnected) or not allowed: never go silent, use the default speaker
    await el.setSinkId("").catch(() => undefined);
  }
}

/** Every audio element SHELLY plays through registers here so it follows the chosen speaker. */
export function routeAudio(el: HTMLMediaElement): Promise<void> {
  const s = el as SinkEl;
  elements.add(s);
  return applyTo(s);
}

export function unrouteAudio(el: HTMLMediaElement): void {
  elements.delete(el as SinkEl);
}

function applyAll(): void {
  for (const el of elements) void applyTo(el);
}

export async function refreshOutputs(): Promise<void> {
  if (!sinkSupported()) return;
  const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
  // without permission, browsers return blank ids/labels
  const named = list.filter((d) => d.deviceId && d.label && d.deviceId !== "default" && d.deviceId !== "communications");
  outputsUnlocked.value = named.length > 0;
  outputs.value = named.map((d) => ({ id: d.deviceId, label: d.label }));
  sinkLabel.value = outputs.value.find((o) => o.id === sinkId.value)?.label ?? "";
  applyAll();
}

/**
 * Ask the browser for the speaker list. Firefox has a proper speaker chooser; Chrome and Edge only
 * reveal speaker names after microphone permission, so we ask for it once and immediately release it.
 * SHELLY never records anything.
 */
export async function unlockOutputs(): Promise<void> {
  const md = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
  if (md.selectAudioOutput) {
    const d = await md.selectAudioOutput();
    await refreshOutputs();
    choose(d.deviceId, d.label);
    return;
  }
  const stream = await md.getUserMedia({ audio: true });
  for (const t of stream.getTracks()) t.stop();
  await refreshOutputs();
}

export function choose(id: string, label?: string): void {
  sinkId.value = id;
  save(id);
  sinkLabel.value = label ?? outputs.value.find((o) => o.id === id)?.label ?? "";
  applyAll();
}

let wired = false;
export function initAudioOut(): void {
  if (wired || !sinkSupported()) return;
  wired = true;
  void refreshOutputs();
  // Roku connects/disconnects: switch over (or fall back to the default) automatically
  navigator.mediaDevices.addEventListener("devicechange", () => void refreshOutputs());
}
