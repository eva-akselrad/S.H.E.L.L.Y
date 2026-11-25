import { useEffect, useRef } from "preact/hooks";
import type { Bbox, PolygonGeom } from "../../shared/types";
import { futureLeads } from "../components/FutureRadar";
import { startRadarLoop } from "../components/radarLoop";
import { radar } from "./state";

/** Animated radar (Iowa Environmental Mesonet, plus an estimated future) framed on the region, or locked onto a warning polygon. */
export interface RadarTrack {
  origin: [number, number];
  end: [number, number];
  towns: { name: string; lat: number; lon: number; etaMin: number }[];
}

export function LiveRadar({ bbox, polygon, track }: { bbox: Bbox; polygon?: PolygonGeom | null; track?: RadarTrack | null }) {
  const el = useRef<HTMLDivElement>(null);
  const frames = radar.value;

  useEffect(() => {
    if (!el.current) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cleanup = () => {};

    void (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (disposed || !el.current) return;
      const map = L.map(el.current, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, keyboard: false });
      const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
      L.tileLayer(`${esri}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16, maxZoom: 12 }).addTo(map);
      L.tileLayer(`${esri}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16, maxZoom: 12, zIndex: 300 }).addTo(map);

      if (polygon) {
        const poly = L.geoJSON(polygon as never, { style: { color: "#ff4d4d", weight: 4, fillColor: "#ff4d4d", fillOpacity: 0.14 } }).addTo(map);
        map.fitBounds(poly.getBounds().extend(track ? [[track.end[1], track.end[0]]] : []).pad(0.4));
        if (track) {
          L.polyline([[track.origin[1], track.origin[0]], [track.end[1], track.end[0]]], { color: "#ffd54f", weight: 5, dashArray: "12 10" }).addTo(map);
          for (const t of track.towns) {
            L.circleMarker([t.lat, t.lon], { radius: 7, color: "#fff", weight: 3, fillColor: "#ffd54f", fillOpacity: 1 })
              .bindTooltip(`${t.name} ${t.etaMin <= 1 ? "now" : `${t.etaMin} min`}`, { permanent: true, direction: "right", className: "bc-eta" })
              .addTo(map);
          }
        }
      } else {
        map.fitBounds([[bbox.south, bbox.west], [bbox.north, bbox.east]]);
      }

      const stop = startRadarLoop(L, map, frames, {
        opacity: 0.78,
        intervalMs: 600,
        leads: polygon ? null : futureLeads("broadcast"),
        motion: null,
        explain: "line",
      });
      cleanup = () => {
        stop();
        map.remove();
      };
    })();

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      cleanup();
    };
  }, [bbox.south, bbox.west, bbox.north, bbox.east, frames, polygon, track?.origin.join(), track?.towns.length]);

  return <div class="bc-radar" ref={el} role="img" aria-label="Animated weather radar" />;
}
