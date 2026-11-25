import type * as Leaflet from "leaflet";
import type { Motion } from "../../shared/live/track";
import type { RadarFrames } from "../../shared/types";
import { buildFuture } from "./FutureRadar";
import { addFutureControl } from "./futureRadarUi";

export const IEM_CREDIT = "Radar: Iowa Environmental Mesonet";

export interface LoopOptions {
  opacity: number;
  intervalMs: number;
  /** future frames (minutes ahead); empty or null = past only (the warning takeover map never shows future frames) */
  leads: number[] | null;
  motion: Motion | null;
  explain: "button" | "line";
  /** shown on the map (Leaflet attribution) */
  attribution?: string;
}

/** Past radar frames straight from IEM, then (when allowed) our estimated future frames. Returns a cleanup. */
export function startRadarLoop(L: typeof Leaflet, map: Leaflet.Map, frames: RadarFrames | null, o: LoopOptions): () => void {
  type Slot = { set(opacity: number): void; future: boolean };
  const slots: Slot[] = [];
  const past = frames?.frames ?? [];
  // sponsor slot (a "presented by" line would go with the credit, later)
  for (const fr of past) {
    // IEM's /c/ tiles are cached for two weeks and send CORS headers
    const layer = L.tileLayer(`${frames!.host}${fr.path}/{z}/{x}/{y}.png`, {
      opacity: 0,
      maxNativeZoom: 7,
      zIndex: 200,
      attribution: o.attribution,
    }).addTo(map);
    slots.push({ set: (op) => layer.setOpacity(op), future: false });
  }
  const ctl = o.leads?.length ? addFutureControl(L, map, past.length, o.explain) : null;
  let i = Math.max(0, past.length - 1);
  let disposed = false;
  const extras: { remove(): void }[] = [];
  let box: Leaflet.Rectangle | null = null;

  const show = () => {
    slots.forEach((s, n) => s.set(n === i ? (s.future ? o.opacity * 0.8 : o.opacity) : 0));
    box?.setStyle({ opacity: slots[i]?.future ? 0.7 : 0 });
    ctl?.update(i);
  };
  show();

  let timer: ReturnType<typeof setInterval> | undefined;
  if (slots.length > 1) {
    timer = setInterval(() => {
      i = (i + 1) % slots.length;
      show();
    }, o.intervalMs);
  }

  if (o.leads?.length && frames && past.length >= 3 && ctl) {
    const b = map.getBounds();
    void buildFuture(frames, { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast(), zoom: map.getZoom() }, o.leads, o.motion).then((set) => {
      if (disposed || !set?.frames.length) return;
      box = L.rectangle(set.bounds, { color: "#ffd54f", weight: 1.5, dashArray: "6 6", fill: false, opacity: 0, interactive: false }).addTo(map);
      extras.push(box);
      for (const f of set.frames) {
        const img = L.imageOverlay(f.url, set.bounds, { opacity: 0, zIndex: 210, interactive: false }).addTo(map);
        extras.push(img);
        slots.push({ set: (op) => img.setOpacity(op), future: true });
      }
      ctl.setLeads(set.frames.map((f) => f.lead));
      show();
    });
  }

  return () => {
    disposed = true;
    if (timer) clearInterval(timer);
    ctl?.destroy();
    for (const x of extras) x.remove();
  };
}
