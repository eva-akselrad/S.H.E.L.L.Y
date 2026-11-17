import { describe, expect, test } from "vitest";
import { DEFAULT_APP_PREFS, inApp, parseAppPermissions, parseAppPrefs } from "../src/native";

describe("native bridge helpers", () => {
  test("a normal browser is not the app", () => expect(inApp).toBe(false));
  test("parses prefs and rejects bad hours", () => {
    expect(parseAppPrefs('{"watches":true,"quietStart":22,"quietEnd":7}')).toEqual({ watches: true, quietStart: 22, quietEnd: 7 });
    expect(parseAppPrefs('{"watches":false,"quietStart":null,"quietEnd":null}')).toEqual({ watches: false, quietStart: null, quietEnd: null });
    expect(parseAppPrefs('{"watches":true,"quietStart":99,"quietEnd":"x"}')).toEqual({ watches: true, quietStart: null, quietEnd: null });
  });
  test("garbage falls back to defaults", () => {
    expect(parseAppPrefs("nope")).toEqual(DEFAULT_APP_PREFS);
    expect(parseAppPrefs(undefined)).toEqual(DEFAULT_APP_PREFS);
    expect(parseAppPermissions("nope")).toEqual({ notifications: false, location: false, background: false });
    expect(parseAppPermissions('{"notifications":true,"location":true,"background":false}')).toEqual({ notifications: true, location: true, background: false });
  });
});
