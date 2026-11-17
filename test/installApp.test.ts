import { describe, expect, it } from "vitest";
import { formatMB, isAndroidBrowser, parseRelease, shouldShowAppBanner } from "../src/installApp";

const AND = "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120";
const now = 1_700_000_000_000;
describe("install banner", () => {
  it("shows on Android browsers", () => expect(shouldShowAppBanner({ ua: AND, mode: "phone", dismissedAt: null, now })).toBe(true));
  it("not on desktop or iPhone", () => {
    expect(shouldShowAppBanner({ ua: "Mozilla/5.0 (Windows NT 10.0)", mode: "web", dismissedAt: null, now })).toBe(false);
    expect(shouldShowAppBanner({ ua: "Mozilla/5.0 (iPhone)", mode: "phone", dismissedAt: null, now })).toBe(false);
  });
  it("not inside the app or on kiosk", () => {
    expect(isAndroidBrowser(AND + " SHELLYApp/1.0")).toBe(false);
    expect(shouldShowAppBanner({ ua: AND, mode: "kiosk", dismissedAt: null, now })).toBe(false);
  });
  it("stays hidden for 30 days after Not now", () => {
    expect(shouldShowAppBanner({ ua: AND, mode: "phone", dismissedAt: now - 29 * 86400_000, now })).toBe(false);
    expect(shouldShowAppBanner({ ua: AND, mode: "phone", dismissedAt: now - 31 * 86400_000, now })).toBe(true);
  });
  it("parses releases", () => {
    expect(parseRelease({ versionName: "1.0", size: 5242880, notes: "x" })).toEqual({ versionName: "1.0", size: 5242880, notes: "x" });
    expect(parseRelease({ versionName: "1.0" })).toBeNull();
    expect(parseRelease(null)).toBeNull();
    expect(formatMB(5242880)).toBe("5.0 MB");
  });
});

import { updateMessage } from "../src/installApp";
describe("update messages", () => {
  it("says what happened", () => {
    expect(updateMessage("UP_TO_DATE", "1.0.1").text).toContain("1.0.1");
    expect(updateMessage("NEEDS_PERMISSION", "1.0.1").needsPermission).toBe(true);
    expect(updateMessage("INSTALL_STARTED", "1.0.1").needsPermission).toBe(false);
    expect(updateMessage(undefined, "1.0.1").text).toContain("Couldn't reach");
  });
});
