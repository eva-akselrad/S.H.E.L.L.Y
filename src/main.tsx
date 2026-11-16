import { render } from "preact";
import { App } from "./app";
import { detectMode } from "./mode";
import "./styles/main.css";
import "./styles/scene.css";

const root = document.getElementById("app")!;

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
