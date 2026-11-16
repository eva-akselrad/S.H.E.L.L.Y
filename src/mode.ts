export type Mode = "kiosk" | "web" | "phone";

/** ?mode= override wins; otherwise guess from viewport and input capabilities. */
export function detectMode(search = location.search, w = innerWidth): Mode {
  const forced = new URLSearchParams(search).get("mode");
  if (forced === "kiosk" || forced === "web" || forced === "phone") return forced;
  if (w < 700) return "phone";
  const canHover = matchMedia("(hover: hover)").matches;
  if (!canHover && w >= 1280) return "kiosk";
  return "web";
}
