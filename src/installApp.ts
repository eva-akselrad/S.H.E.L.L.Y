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
