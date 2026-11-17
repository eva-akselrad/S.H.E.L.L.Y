export const APP_BANNER_KEY = "shelly.v2.appBanner";
const THIRTY_DAYS = 30 * 24 * 3600_000;

export interface AppRelease {
  versionName: string;
  size: number;
  notes: string;
}

export function isAndroidBrowser(ua: string): boolean {
  return /Android/i.test(ua) && !ua.includes("SHELLYApp/");
}

/** Show the install banner on Android browsers only, never in the app or on a kiosk, and not for 30 days after "Not now". */
export function shouldShowAppBanner(o: { ua: string; mode: string; dismissedAt: number | null; now: number }): boolean {
  if (!isAndroidBrowser(o.ua)) return false;
  if (o.mode === "kiosk" || o.mode === "broadcast") return false;
  if (o.dismissedAt !== null && o.now - o.dismissedAt < THIRTY_DAYS) return false;
  return true;
}

export function parseRelease(raw: unknown): AppRelease | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.versionName !== "string" || typeof r.size !== "number" || r.size <= 0) return null;
  return { versionName: r.versionName, size: r.size, notes: typeof r.notes === "string" ? r.notes : "" };
}

export const formatMB = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`;

const store = (): { getItem(k: string): string | null; setItem(k: string, v: string): void } | undefined =>
  (globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage;

export function readDismissed(): number | null {
  try {
    const v = Number(store()?.getItem(APP_BANNER_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function writeDismissed(now: number): void {
  try {
    store()?.setItem(APP_BANNER_KEY, String(now));
  } catch {
    /* private mode: banner just returns next visit */
  }
}

/** What to tell the user after an in-app update check. */
export function updateMessage(outcome: string | undefined, version: string): { text: string; needsPermission: boolean } {
  switch (outcome) {
    case "UP_TO_DATE":
      return { text: `You're up to date (version ${version}).`, needsPermission: false };
    case "INSTALL_STARTED":
      return { text: "Update found. Installing it now; SHELLY will restart.", needsPermission: false };
    case "NEEDS_PERMISSION":
      return { text: "Update found. Allow SHELLY to install updates (\"Allow from this source\"), then check again.", needsPermission: true };
    case "BLOCKED_BY_WARNING":
      return { text: "Update found, but a warning is active for your area. It will install once that ends.", needsPermission: false };
    case "DOWNLOAD_FAILED":
      return { text: "The update didn't download. Try again on a better connection.", needsPermission: false };
    case "REFUSED":
      return { text: "The update was refused because it wasn't signed by SHELLY.", needsPermission: false };
    default:
      return { text: "Couldn't reach the update server. Try again in a moment.", needsPermission: false };
  }
}
