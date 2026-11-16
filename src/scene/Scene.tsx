import { useEffect, useRef } from "preact/hooks";
import type { SceneId } from "../../shared/scene";
import { scene } from "./state";

const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

type Kind = "rain" | "drizzle" | "storm" | "snow" | "sleet";
const PRECIP: Partial<Record<SceneId, Kind>> = { rain: "rain", drizzle: "drizzle", storm: "storm", snow: "snow", sleet: "sleet" };

interface P { x: number; y: number; v: number; l: number; s: number; snow: boolean }

/** Falling rain/snow on a canvas. Particle count scales with screen area and is capped for weak TVs. */
function Precip({ kind }: { kind: Kind }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const still = reduced();
    let w = 0;
    let h = 0;
    let parts: P[] = [];
    const density = { drizzle: 6000, rain: 3200, storm: 1900, snow: 5200, sleet: 4200 }[kind];
    const make = (snow: boolean): P => ({
      x: Math.random() * w,
      y: Math.random() * h,
      v: snow ? 0.6 + Math.random() * 1.4 : 9 + Math.random() * 9 + (kind === "storm" ? 6 : 0),
      l: snow ? 1.2 + Math.random() * 2.6 : 10 + Math.random() * 16,
      s: Math.random() * Math.PI * 2,
      snow,
    });
    const resize = (): void => {
      w = c.width = innerWidth;
      h = c.height = innerHeight;
      const n = Math.min(260, Math.round((w * h) / density));
      parts = Array.from({ length: n }, (_, i) => make(kind === "snow" || (kind === "sleet" && i % 2 === 0)));
    };
    resize();
    addEventListener("resize", resize);
    let raf = 0;
    const wind = kind === "storm" ? 5 : kind === "rain" ? 2.5 : 1;
    const frame = (): void => {
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        if (p.snow) {
          p.s += 0.02;
          p.x += Math.sin(p.s) * 0.6 + wind * 0.15;
          p.y += p.v;
          ctx.fillStyle = "rgba(255,255,255,.85)";
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.l, 0, Math.PI * 2);
          ctx.fill();
        } else {
          p.x += wind;
          p.y += p.v;
          ctx.strokeStyle = kind === "drizzle" ? "rgba(190,215,255,.35)" : "rgba(190,215,255,.55)";
          ctx.lineWidth = kind === "storm" ? 1.6 : 1.1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - wind * 1.4, p.y - p.l);
          ctx.stroke();
        }
        if (p.y > h + 20 || p.x > w + 20) {
          p.y = -20;
          p.x = Math.random() * w;
        }
      }
      if (!still) raf = requestAnimationFrame(frame);
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
    };
  }, [kind]);
  return <canvas class="scene-precip" ref={ref} aria-hidden="true" />;
}

/** Full-screen ambient background that follows the weather. Pure decoration. */
export function Scene() {
  const s = scene.value;
  useEffect(() => {
    const root = document.documentElement;
    if (s) {
      root.dataset.scene = s;
      root.classList.add("scenes-on");
    } else {
      delete root.dataset.scene;
      root.classList.remove("scenes-on");
    }
  }, [s]);
  if (!s) return null;
  const kind = PRECIP[s];
  const clouds = ["partly-day", "partly-night", "cloudy", "rain", "drizzle", "storm", "sleet", "snow", "fog"].includes(s);
  const sky = s === "clear-day" || s === "heat" || s === "partly-day";
  const night = s === "clear-night" || s === "partly-night";
  return (
    <div class="scene" data-s={s} aria-hidden="true">
      {night && <div class="scene-stars" />}
      {night && <div class="scene-moon" />}
      {sky && <div class="scene-sun" />}
      {clouds && (
        <div class="scene-clouds">
          <i /><i /><i /><i /><i />
        </div>
      )}
      {s === "fog" && <div class="scene-fog"><i /><i /><i /></div>}
      {kind && <Precip kind={kind} />}
      {s === "storm" && <div class="scene-flash" />}
    </div>
  );
}
