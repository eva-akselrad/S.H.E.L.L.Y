// The SHELLY Android app wraps this site in a WebView and adds window.ShellyApp (see android/.../Bridge.kt).
// In the app the UA ends with "SHELLYApp/<version>".

export interface ShellyAppBridge {
  isApp(): boolean;
  version(): string;
  openAppSettings(): void;
  openNotificationSettings(): void;
  runSetup(): void;
  /** JSON: {"notifications":bool,"location":bool,"background":bool} */
  permissionStatus(): string;
  /** JSON: {"watches":bool,"quietStart":number|null,"quietEnd":number|null} */
  /** Looks for a newer app now. Answers with a "shelly-update" window event, detail {outcome}. Newer builds answer; older ones only start a background check. */
  checkForUpdate?(): void;
  openInstallSettings?(): void;
  /** Newer app builds only: answers with a "shelly-location" window event. */
  requestLocation?(): void;
  getAlertPrefs(): string;
  setAlertPrefs(json: string): boolean;
}

declare global {
  interface Window {
    ShellyApp?: ShellyAppBridge;
  }
}

export const inApp: boolean = typeof navigator !== "undefined" && navigator.userAgent.includes("SHELLYApp/");

export const appBridge = (): ShellyAppBridge | null => (inApp ? ((globalThis as { ShellyApp?: ShellyAppBridge }).ShellyApp ?? null) : null);

export interface AppAlertPrefs {
  watches: boolean;
  quietStart: number | null;
  quietEnd: number | null;
}

export const DEFAULT_APP_PREFS: AppAlertPrefs = { watches: false, quietStart: 22, quietEnd: 7 };

function hourOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23 ? v : null;
}

/** Tolerant parse of what the bridge returns. */
export function parseAppPrefs(json: string | null | undefined): AppAlertPrefs {
  try {
    const o = JSON.parse(json ?? "") as Record<string, unknown>;
    return { watches: o.watches === true, quietStart: hourOrNull(o.quietStart), quietEnd: hourOrNull(o.quietEnd) };
  } catch {
    return DEFAULT_APP_PREFS;
  }
}

export interface AppPermissions {
  notifications: boolean;
  location: boolean;
  background: boolean;
}

export function parseAppPermissions(json: string | null | undefined): AppPermissions {
  try {
    const o = JSON.parse(json ?? "") as Record<string, unknown>;
    return { notifications: o.notifications === true, location: o.location === true, background: o.background === true };
  } catch {
    return { notifications: false, location: false, background: false };
  }
}
