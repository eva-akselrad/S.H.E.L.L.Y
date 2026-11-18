import { render } from "preact";
import { App } from "./app";
import { detectMode } from "./mode";
import "./styles/main.css";
import "./styles/scene.css";

const root = document.getElementById("app")!;

// A page left open across a deploy still points at the old hashed files (the radar's map code is loaded on demand),
// and those are gone: the radar goes blank. Load the new version instead, at most once every 2 minutes.
addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  try {
    const last = Number(sessionStorage.getItem("shelly-reloaded") ?? 0);
    if (Date.now() - last < 120_000) return;
    sessionStorage.setItem("shelly-reloaded", String(Date.now()));
  } catch {
    /* storage blocked: reload anyway */
  }
  location.reload();
});

if (detectMode() === "broadcast") {
  // SHELLY Live stage: loaded on demand so normal visitors never download it
  void import("./live/Broadcast").then(({ Broadcast }) => render(<Broadcast />, root));
} else {
  render(<App />, root);
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    });
  }
}
