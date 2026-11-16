import { render } from "preact";
import { App } from "./app";
import "./styles/main.css";

render(<App />, document.getElementById("app")!);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
