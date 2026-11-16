import { useEffect, useRef } from "preact/hooks";
import type { Bbox, PolygonGeom } from "../../shared/types";
import { radar } from "./state";

/** Animated RainViewer radar framed on the region, or locked onto a warning polygon. */
export function LiveRadar({ bbox, polygon }: { bbox: Bbox; polygon?: PolygonGeom | null }) {
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
        map.fitBounds(poly.getBounds().pad(0.8));
      } else {
        map.fitBounds([[bbox.south, bbox.west], [bbox.north, bbox.east]]);
      }

      const layers = (frames?.frames ?? []).map((fr) =>
        L.tileLayer(`${frames!.host}${fr.path}/256/{z}/{x}/{y}/6/1_1.png`, { opacity: 0, maxNativeZoom: 6, zIndex: 200 }).addTo(map),
      );
      let i = Math.max(0, layers.length - 1);
      const show = () => layers.forEach((l, n) => l.setOpacity(n === i ? 0.78 : 0));
      show();
      if (layers.length > 1) {
        timer = setInterval(() => {
          i = (i + 1) % layers.length;
          show();
        }, 600);
      }
      cleanup = () => map.remove();
    })();

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      cleanup();
    };
  }, [bbox.south, bbox.west, bbox.north, bbox.east, frames, polygon]);

  return <div class="bc-radar" ref={el} role="img" aria-label="Animated weather radar" />;
}
