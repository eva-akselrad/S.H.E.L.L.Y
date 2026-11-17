import { expect, test } from "vitest";
import { countdown } from "../shared/countdown";

const now = Date.parse("2026-11-17T00:00:00Z");
const plus = (s: number) => new Date(now + s * 1000).toISOString();

test("under an hour: m:ss", () => {
  expect(countdown(plus(25 * 60 - 1), now)).toBe("24:59");
});
test("under a day: hours and minutes", () => {
  expect(countdown(plus(5 * 3600 + 2 * 60 + 30), now)).toBe("5h 02m");
});
test("multi-day warnings show the end time instead of thousands of minutes", () => {
  expect(countdown("2026-11-20T12:00:00Z", now, "America/Los_Angeles")).toBe("Until Fri 4 AM");
  expect(countdown("2026-11-20T12:30:00Z", now, "America/Los_Angeles")).toBe("Until Fri 4:30 AM");
});
test("no expiry, no countdown", () => {
  expect(countdown(null, now)).toBe("");
});
