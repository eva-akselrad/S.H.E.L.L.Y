// Video capture stage (dev only, never built or deployed): mounts ONE real SHELLY visual on black,
// so headless Chrome can screenshot product pixels for the launch videos.
// No rundown, no voice, no network: the host's state is plain signals, and the scene is forced by ?scene=.
//
//   /video/stage/?shot=storm&scene=storm         the real storm sky (clouds + rain + flash layer)
//   /video/stage/?shot=eyes&lid=0.04..1           the turtle's eyes, extreme close-up (1 = open)
//   /video/stage/?shot=host&host=<words>         the whole turtle, centred (uses the ?host= switch)
//   /video/stage/?shot=studio&id=demo-note       one demo Forecaster Studio graphic (video/stage/fixtures.json), 1920x1080
import { render } from "preact";
import { Host } from "../../src/live/host/Host";
import { Scene } from "../../src/scene/Scene";
import { ProductView } from "../../src/studio/ProductView";
import type { StudioProduct } from "../../shared/studio";
import fixtures from "./fixtures.json";
import "../../src/styles/main.css";
import "../../src/styles/scene.css";
import "../../src/styles/live.css";

const q = new URLSearchParams(location.search);
const shot = q.get("shot") ?? "host";
const lid = Math.min(1, Math.max(0.04, Number(q.get("lid") ?? "1"))); // eyelid: 1 open, 0.04 shut
const zoom = Number(q.get("zoom") ?? "16");

// eye centre in the host SVG's own units (viewBox 0 0 340 270)
const EYE_X = 89;
const EYE_Y = 122;

const css = `
  html, body { margin: 0; background: #000 !important; overflow: hidden; }
  #stage { position: fixed; inset: 0; background: #000; }
  .stage-host { position: absolute; left: 50%; top: 50%; width: 1020px; height: 810px; transform: translate(-50%, -50%); }
  .stage-eyes { position: absolute; width: ${340 * zoom}px; height: ${270 * zoom}px;
    left: calc(50% - ${EYE_X * zoom}px); top: calc(50% - ${EYE_Y * zoom}px); }
  .stage-eyes .host-bubble, .stage-eyes .host-shadow { display: none; }
  .stage-eyes .host, .stage-eyes .host * { animation: none !important; transition: none !important; }
  .host .host-eye { transform: scaleY(${lid}) !important; }
`;

function demoProduct(id: string | null): StudioProduct | null {
  const p = fixtures.products.find((x) => x.id === id);
  if (!p) return null;
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const body = p.kind === "dayPlanner" ? { ...p.body, date: iso(now + 86400e3).slice(0, 10) } : p.body;
  return { ...p, validFrom: iso(now - 3600e3), validTo: iso(now + 3 * 86400e3), updated: iso(now), body } as unknown as StudioProduct;
}

function Stage() {
  const product = shot === "studio" ? demoProduct(q.get("id")) : null;
  return (
    <>
      <style>{css}</style>
      {shot === "storm" && <Scene />}
      {shot === "eyes" && (
        <div class="stage-eyes">
          <Host level="CALM" />
        </div>
      )}
      {product && (
        <div style={{ position: "absolute", inset: 0 }}>
          <ProductView product={product} fmt={(q.get("fmt") as "wide" | "portrait") ?? "wide"} forecaster={q.get("by") ?? ""} />
        </div>
      )}
      {shot === "host" && (
        <div class="stage-host">
          <Host level="CALM" />
        </div>
      )}
    </>
  );
}

render(<Stage />, document.getElementById("stage")!);
document.documentElement.dataset.ready = "1";
