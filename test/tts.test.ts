import { expect, test } from "vitest";
import { alertScript } from "../src/tts";
import { titleFromFile } from "../src/music";
import type { Alert } from "../shared/types";

const a = {
  event: "Tornado Warning", areaDesc: "Waco; McLennan; Bell; Coryell", instruction: "Take   cover.", description: "d",
} as Alert;

test("alert script names the event and trims the area", () => {
  const s = alertScript(a);
  expect(s).toContain("Tornado Warning");
  expect(s).toContain("Waco, McLennan, Bell");
  expect(s).not.toContain("Coryell");
  expect(s).toContain("Take cover.");
});

test("emergency script is distinct", () => {
  expect(alertScript(a, true)).toContain("This is an emergency");
});

test("track titles keep version suffixes", () => {
  expect(titleFromFile("Clouds in 3_4 Time (v2).mp3")).toBe("Clouds in 3/4 Time (v2)");
});
