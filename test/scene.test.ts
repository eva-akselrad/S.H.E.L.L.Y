import { describe, expect, test } from "vitest";
import { isSceneId, pickScene } from "../shared/scene";

describe("pickScene", () => {
  test("clear sky follows day/night and heat", () => {
    expect(pickScene(0, true, 75)).toBe("clear-day");
    expect(pickScene(1, false, 60)).toBe("clear-night");
    expect(pickScene(0, true, 99)).toBe("heat");
    expect(pickScene(0, false, 99)).toBe("clear-night");
  });
  test("clouds", () => {
    expect(pickScene(2, true)).toBe("partly-day");
    expect(pickScene(2, false)).toBe("partly-night");
    expect(pickScene(3, true)).toBe("cloudy");
    expect(pickScene(45, true)).toBe("fog");
  });
  test("precipitation", () => {
    expect(pickScene(53, true)).toBe("drizzle");
    expect(pickScene(63, false)).toBe("rain");
    expect(pickScene(67, true)).toBe("sleet");
    expect(pickScene(73, false)).toBe("snow");
    expect(pickScene(95, true)).toBe("storm");
    expect(pickScene(82, true)).toBe("storm");
  });
  test("unknown codes fall back to a calm sky", () => {
    expect(pickScene(999, true)).toBe("clear-day");
    expect(isSceneId("rain")).toBe(true);
    expect(isSceneId("nope")).toBe(false);
  });
});
