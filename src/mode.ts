export type Mode = "kiosk" | "web" | "phone" | "broadcast";

/**
 * ?mode= override wins; otherwise guess from viewport and input capabilities.
 * "broadcast" (the SHELLY Live stage) is only ever explicit: ?mode=broadcast or the /live path.
 */
export function detectMode(search = location.search, w = innerWidth, path = location.pathname): Mode {
  const forced = new URLSearchParams(search).get("mode");
  if (forced === "kiosk" || forced === "web" || forced === "phone" || forced === "broadcast") return forced;
  if (path === "/live" || path.startsWith("/live/")) return "broadcast";
  if (w < 700) return "phone";
  const canHover = matchMedia("(hover: hover)").matches;
  if (!canHover && w >= 1280) return "kiosk";
  return "web";
}
