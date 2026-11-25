import { useEffect, useRef } from "preact/hooks";
import { reportTitle } from "../../shared/reports";
import { alertLevel } from "../../shared/threat";
import { nearby, place, radar, reportsNearby, threat } from "../state/store";

const REPORT_COLOR = { tornado: "#ff3b3b", wind: "#5ec2ff", hail: "#3ecf9a" } as const;

/** Animated RainViewer radar. When a warning covers the user, the map locks on its polygon. */
export function Radar() {
  const el = useRef<HTMLDivElement>(null);
  const p = place.value;
  const frames = radar.value;
  const primary = threat.value.rank >= 2 ? threat.value.primary : null;
  // every active alert that covers you and isn't the urgent one: drawn in amber so you can see where it is
  const others = threat.value.active.filter((a) => a.geometry && a.id !== primary?.id && alertLevel(a) !== "CALM");
  const othersKey = others.map((a) => a.id).join("|");
  const reps = reportsNearby.value;
  const near = nearby.value;
  const repKey = reps.map((r) => r.time).join("|");
  const nearKey = near.map((n) => n.alert.id).join("|");

  useEffect(() => {
    if (!el.current || !p) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cleanup = () => {};

    void (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (disposed || !el.current) return;

      const map = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([p.lat, p.lon], 7);
      // Esri Dark Gray canvas (CARTO's free tiles now require an API key)
      const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
      L.tileLayer(`${esri}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
        attribution: "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors",
        maxNativeZoom: 16,
        maxZoom: 12,
      }).addTo(map);
      L.tileLayer(`${esri}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, {
        maxNativeZoom: 16,
        maxZoom: 12,
        zIndex: 300,
      }).addTo(map);

      L.circleMarker([p.lat, p.lon], { radius: 6, color: "#fff", fillColor: "#ff7a59", fillOpacity: 1, weight: 2 }).addTo(map);

      // warnings close by that don't cover you: dashed outline
      for (const n of near) {
        if (!n.alert.geometry) continue;
        L.geoJSON(n.alert.geometry as never, { style: { color: "#ffb020", weight: 2, dashArray: "6 6", fillOpacity: 0.05 } })
          .bindTooltip(n.alert.event)
          .addTo(map);
      }

      // storm reports (NOAA SPC): small coloured dots
      for (const r of reps) {
        L.circleMarker([r.lat, r.lon], { radius: 5, color: "#0b1220", weight: 1, fillColor: REPORT_COLOR[r.kind], fillOpacity: 0.95, pane: "markerPane" })
          .bindTooltip(`${reportTitle(r)}: ${r.location}, ${r.state}`)
          .addTo(map);
      }

      for (const a of others) {
        L.geoJSON(a.geometry as never, { style: { color: "#ffb020", weight: 2, fillColor: "#ffb020", fillOpacity: 0.1 } })
          .bindTooltip(a.event)
          .addTo(map);
      }

      if (primary?.geometry) {
        const poly = L.geoJSON(primary.geometry as never, {
          style: { color: "#ff3b3b", weight: 3, fillColor: "#ff3b3b", fillOpacity: 0.12 },
        }).addTo(map);
        map.fitBounds(poly.getBounds().pad(0.6));
      }

      const layers = (frames?.frames ?? []).map((fr) =>
        L.tileLayer(`${frames!.host}${fr.path}/256/{z}/{x}/{y}/6/1_1.png`, {
          opacity: 0,
          maxNativeZoom: 6,
          zIndex: 200,
        }).addTo(map),
      );
      let i = Math.max(0, layers.length - 1);
      const show = () => layers.forEach((l, n) => l.setOpacity(n === i ? 0.75 : 0));
      show();
      if (layers.length > 1) {
        timer = setInterval(() => {
          i = (i + 1) % layers.length;
          show();
        }, 700);
      }
      cleanup = () => map.remove();
    })();

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      cleanup();
    };
  }, [p?.lat, p?.lon, frames, primary?.id, repKey, nearKey, othersKey]);

  return <div class="radar" ref={el} role="img" aria-label="Animated weather radar map" />;
}
