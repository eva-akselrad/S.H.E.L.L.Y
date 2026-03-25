/* ════════════════════════════════════════════════════════════════
   radar.js – Leaflet map with animated radar via RainViewer API

   Why RainViewer instead of IEM WMS:
   - IEM nexrad-n0q WMS ignores the TIME parameter and always returns
     the current composite, so all animation frames were identical.
   - setParams()+redraw() re-fetches tiles on every 700ms step; WMS
     tiles take 1-3 s to load so the overlay was perpetually blank.
   - RainViewer's public API returns Unix-timestamped tile cache paths
     (no API key required).  Each frame has a unique URL so the browser
     fetches and caches distinct images, and the opacity-toggle
     animation is smooth because tiles are pre-loaded in the background.
   ════════════════════════════════════════════════════════════════ */

const RadarMap = (() => {
  let map = null;
  let frames = []; // [{dt, layer}]
  let currentFrame = 0;
  let animating = true;
  let animTimer = null;
  let initialized = false;
  let pendingLat = null;
  let pendingLon = null;
  let refreshTimer = null;
  let building = false; // in-flight guard for buildFrames

  const FRAME_COUNT = 6;
  const ANIM_INTERVAL = 700; // ms per animation step
  const RADAR_OPACITY = 0.7;

  // RainViewer public API – no key required
  const RV_API = "https://api.rainviewer.com/public/weather-maps.json";
  // Tile URL template filled in per-frame from the API response
  // path = e.g. "/v2/radar/1699999800"
  // color 6 = RAINBOW @ SELEX-SI (primarily green for light/moderate precip), smooth+snow flags = 1_1
  const RV_TILE = (path) =>
    `https://tilecache.rainviewer.com${path}/256/{z}/{x}/{y}/6/1_1.png`;
