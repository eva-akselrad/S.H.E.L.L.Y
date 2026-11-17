// Browser side of push alerts: subscribe this device for the current place.
import { signal } from "@preact/signals";
import type { Place } from "../shared/types";

export type PushState = "unsupported" | "unconfigured" | "denied" | "off" | "on" | "busy";
export const pushState = signal<PushState>("busy");
export const pushWatches = signal(false);

const LS = "shelly.v2.push";
let publicKey: string | null = null;

function b64ToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const t = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function supported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration()) ?? navigator.serviceWorker.register("/sw.js");
}

export async function initPush(): Promise<void> {
  if (!supported()) return void (pushState.value = "unsupported");
  try {
    pushWatches.value = localStorage.getItem(`${LS}.watches`) === "1";
  } catch {
    /* storage blocked */
  }
  const res = await fetch("/api/push/key").catch(() => null);
  publicKey = res?.ok ? ((await res.json()) as { key: string | null }).key : null;
  if (!publicKey) return void (pushState.value = "unconfigured");
  if (Notification.permission === "denied") return void (pushState.value = "denied");
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  pushState.value = sub ? "on" : "off";
}

function body(sub: PushSubscription, p: Place) {
  return JSON.stringify({
    subscription: sub.toJSON(),
    place: { lat: p.lat, lon: p.lon, name: p.name, tz: p.tz, zones: [p.forecastZone, p.countyZone, p.fireZone].filter(Boolean) },
    prefs: { watches: pushWatches.value, quietStart: 22, quietEnd: 7 },
  });
}

/** Ask permission (must run from a tap), subscribe, and tell SHELLY where this device wants alerts for. */
export async function enablePush(p: Place): Promise<void> {
  if (!publicKey) return;
  pushState.value = "busy";
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return void (pushState.value = perm === "denied" ? "denied" : "off");
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
    const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: body(sub, p) });
    pushState.value = r.ok ? "on" : "off";
  } catch {
    pushState.value = "off";
  }
}

/** Keep the server's copy current when the place or preferences change. */
export async function syncPush(p: Place): Promise<void> {
  if (pushState.value !== "on") return;
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (sub) await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: body(sub, p) }).catch(() => undefined);
}

export async function disablePush(): Promise<void> {
  pushState.value = "busy";
  try {
    const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/unsubscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
      await sub.unsubscribe();
    }
  } finally {
    pushState.value = "off";
  }
}

export function setPushWatches(on: boolean, p: Place | null): void {
  pushWatches.value = on;
  try {
    localStorage.setItem(`${LS}.watches`, on ? "1" : "0");
  } catch {
    /* storage blocked */
  }
  if (p) void syncPush(p);
}
