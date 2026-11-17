import { appBridge } from "./native";

export interface DeviceFix {
  lat: number;
  lon: number;
}

/** The device's position. Inside the app this goes through the app's own location code (WebView GPS is unreliable); in a browser it uses the standard prompt. */
export function getDeviceLocation(timeoutMs = 25_000): Promise<DeviceFix> {
  const app = appBridge();
  if (app?.requestLocation) {
    return new Promise((resolve, reject) => {
      const done = (fn: () => void) => {
        window.removeEventListener("shelly-location", onLoc);
        clearTimeout(timer);
        fn();
      };
      const onLoc = (e: Event) => {
        const d = (e as CustomEvent<{ lat?: number; lon?: number; error?: string }>).detail;
        if (typeof d?.lat === "number" && typeof d?.lon === "number") done(() => resolve({ lat: d.lat as number, lon: d.lon as number }));
        else done(() => reject(new Error(d?.error ?? "unavailable")));
      };
      const timer = setTimeout(() => done(() => reject(new Error("timeout"))), timeoutMs);
      window.addEventListener("shelly-location", onLoc);
      app.requestLocation?.();
    });
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("unavailable"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => reject(new Error("denied")),
      { maximumAge: 60_000, timeout: 15_000 },
    );
  });
}
