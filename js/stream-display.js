'use strict';

/* ════════════════════════════════════════════════════════════════
   S.H.E.L.L.Y. – Stream Display v2
   Complete rewrite: warning polygons, auto-focus, alert banner,
   TTS, generated sounds, WebSocket + SSE.
   ════════════════════════════════════════════════════════════════ */

// ── Constants ─────────────────────────────────────────────────
const RV_API          = 'https://api.rainviewer.com/public/weather-maps.json';
const FRAME_COUNT     = 8;
const ANIM_MS_DEFAULT = 600;
const RADAR_OPACITY   = 0.65;
const WS_RECONNECT_MS = 3000;
const WS_PING_MS      = 20000; // heartbeat interval

// Default cities – Philly metro + key regional cities
const DEFAULT_CITIES = [
    { name: 'Philadelphia',   state: 'PA', lat: 39.95, lon: -75.16 },
    { name: 'Camden',         state: 'NJ', lat: 39.93, lon: -75.12 },
    { name: 'Wilmington',     state: 'DE', lat: 39.74, lon: -75.55 },
    { name: 'Trenton',        state: 'NJ', lat: 40.22, lon: -74.76 },
    { name: 'King of Prussia',state: 'PA', lat: 40.09, lon: -75.38 },
    { name: 'Allentown',      state: 'PA', lat: 40.60, lon: -75.47 },
    { name: 'Reading',        state: 'PA', lat: 40.34, lon: -75.93 },
    { name: 'Doylestown',     state: 'PA', lat: 40.31, lon: -75.13 },
    { name: 'Atlantic City',  state: 'NJ', lat: 39.37, lon: -74.43 },
    { name: 'Cherry Hill',    state: 'NJ', lat: 39.93, lon: -74.96 },
    { name: 'Bethlehem',      state: 'PA', lat: 40.63, lon: -75.37 },
    { name: 'Norristown',     state: 'PA', lat: 40.12, lon: -75.34 },
    { name: 'West Chester',   state: 'PA', lat: 39.96, lon: -75.60 },
    { name: 'Media',          state: 'PA', lat: 39.91, lon: -75.38 },
    { name: 'Phoenixville',   state: 'PA', lat: 40.13, lon: -75.52 },
    { name: 'Lansdale',       state: 'PA', lat: 40.24, lon: -75.28 },
    { name: 'Quakertown',     state: 'PA', lat: 40.44, lon: -75.34 },
    { name: 'Pottstown',      state: 'PA', lat: 40.24, lon: -75.64 },
    { name: 'Lancaster',      state: 'PA', lat: 40.03, lon: -76.30 },
    { name: 'Coatesville',    state: 'PA', lat: 39.98, lon: -75.82 },
    { name: 'Mount Holly',    state: 'NJ', lat: 39.99, lon: -74.78 },
    { name: 'Vineland',       state: 'NJ', lat: 39.48, lon: -75.02 },
    { name: 'Dover',          state: 'DE', lat: 39.15, lon: -75.52 },
    { name: 'Newark',         state: 'DE', lat: 39.68, lon: -75.75 },
    { name: 'New York',       state: 'NY', lat: 40.71, lon: -74.01 },
    { name: 'Baltimore',      state: 'MD', lat: 39.29, lon: -76.61 },
    { name: 'Washington',     state: 'DC', lat: 38.91, lon: -77.04 },
];
const BANNER_DURATION = 30; // seconds auto-dismiss

const RADAR_REGIONS = {
    'national':          { lat: 38.0,  lon: -96.0,  zoom: 4 },
    'northeast':         { lat: 43.0,  lon: -73.5,  zoom: 5 },
    'southeast':         { lat: 32.5,  lon: -85.5,  zoom: 5 },
    'midwest':           { lat: 42.5,  lon: -89.0,  zoom: 5 },
    'south':             { lat: 31.5,  lon: -97.5,  zoom: 5 },
    'great-plains':      { lat: 39.0,  lon: -100.0, zoom: 5 },
    'west-coast':        { lat: 37.5,  lon: -121.0, zoom: 5 },
    'pacific-northwest': { lat: 47.5,  lon: -121.5, zoom: 5 },
    'central us':        { lat: 35.5,  lon: -97.5,  zoom: 5 },
    'southwest':         { lat: 34.0,  lon: -112.0, zoom: 5 },
    'northwest':         { lat: 47.0,  lon: -120.0, zoom: 5 },
};

const WMO = {
    0:  ['Clear',          '☀️'], 1:  ['Mainly Clear','🌤️'], 2:  ['Partly Cloudy','⛅'],
    3:  ['Overcast',       '☁️'], 45: ['Fog',          '🌫️'], 48: ['Rime Fog',    '🌫️'],
    51: ['Light Drizzle',  '🌦️'], 53: ['Drizzle',      '🌦️'], 55: ['Heavy Drizzle','🌧️'],
    61: ['Light Rain',     '🌧️'], 63: ['Rain',         '🌧️'], 65: ['Heavy Rain',  '🌧️'],
    71: ['Light Snow',     '🌨️'], 73: ['Snow',         '❄️'],  75: ['Heavy Snow',  '❄️'],
    80: ['Showers',        '🌦️'], 81: ['Showers',      '🌧️'], 82: ['Heavy Showers','🌧️'],
    95: ['Thunderstorm',   '⛈️'], 96: ['T-storm/Hail', '⛈️'], 99: ['Severe T-storm','⛈️'],
};

const ALERT_ICONS = {
    tornado: '🌪️', storm: '⛈️', flood: '🌊',
    fire: '🔥', emergency: '🚨', info: 'ℹ️',
    watch: '👁️', advisory: '📡',
};

const ALERT_LABELS = {
    tornado:   'TORNADO WARNING',
    storm:     'SEVERE THUNDERSTORM WARNING',
    flood:     'FLASH FLOOD WARNING',
    fire:      'FIRE WEATHER WARNING',
    emergency: 'EMERGENCY ALERT',
    info:      'WEATHER STATEMENT',
    watch:     'WEATHER WATCH',
    advisory:  'WEATHER ADVISORY',
};

// Category → polygon style
const POLY_STYLES = {
    tornado:   { color: '#ef4444', fillColor: 'rgba(239,68,68,.25)',  weight: 2.5 },
    storm:     { color: '#f97316', fillColor: 'rgba(249,115,22,.2)',  weight: 2   },
    flood:     { color: '#22c55e', fillColor: 'rgba(34,197,94,.2)',   weight: 2   },
    fire:      { color: '#eab308', fillColor: 'rgba(234,179,8,.2)',   weight: 2   },
    watch:     { color: '#3b82f6', fillColor: 'rgba(59,130,246,.15)', weight: 1.5 },
    advisory:  { color: '#3b82f6', fillColor: 'rgba(59,130,246,.12)', weight: 1   },
};

// SPC outlook category colors
const SPC_COLORS = {
    'TSTM':   { color: '#00cc00', fill: 'rgba(0,204,0,.12)'    },
    'MRGL':   { color: '#5ac85a', fill: 'rgba(90,200,90,.15)'  },
    'SLGT':   { color: '#ffff00', fill: 'rgba(255,255,0,.15)'  },
    'ENH':    { color: '#ff9900', fill: 'rgba(255,153,0,.2)'   },
    'MDT':    { color: '#ff0000', fill: 'rgba(255,0,0,.22)'    },
    'HIGH':   { color: '#ff00ff', fill: 'rgba(255,0,255,.25)'  },
};

// ── State ─────────────────────────────────────────────────────
let radarMap         = null;
let radarLayers      = [];   // current active set
let radarPending     = [];   // next set being built (pre-loaded)
let radarFrame       = 0;
let radarAnimTimer   = null;
let radarBuilding    = false;
let radarAnimSpeed   = ANIM_MS_DEFAULT;
let radarOpacity     = RADAR_OPACITY;
let polyLayer        = null;   // Leaflet GeoJSON layer for NWS alerts
let spcLayer         = null;   // Leaflet GeoJSON layer for SPC outlook
let spcVisible       = false;
let snowLayer        = null;
let snowVisible      = false;
let radarCursor      = null;
let polyVisibility   = { tornado: true, storm: true, flood: true, fire: true, watch: true, advisory: true };
let ws               = null;
let wsReconnectTimer = null;
let wsPingTimer      = null;
let firstState       = false;
let autonomousDone   = false;
let audioCtx         = null;
let cachedAlerts     = [];
let citiesLoaded     = false;

// Banner state
let bannerTimer      = null;
let bannerCountdown  = 0;
let bannerTick       = null;

// Auto-behavior flags (from server state)
let autoFocus  = true;
let autoTTS    = true;
let autoBanner = true;

// ── DOM helpers ───────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Clock ─────────────────────────────────────────────────────
function initClock() {
    function tick() {
        const now = new Date();
        const cl  = $('header-clock');
        const dt  = $('header-date');
        if (cl) cl.textContent = now.toLocaleTimeString('en-US', { hour12: false });
        if (dt) dt.textContent = now.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
        });
    }
    tick();
    setInterval(tick, 1000);
}

// ── Connection status ─────────────────────────────────────────
function setConnStatus(s) {
    const el = $('conn-status');
    if (!el) return;
    el.className = s === 'ok' ? 'ok' : s === 'error' ? 'error' : '';
}

// ── Radar ─────────────────────────────────────────────────────
function initRadar() {
    if (radarMap || typeof L === 'undefined') return;
    const el = $('radar-map');
    if (!el) return;

    radarMap = L.map('radar-map', {
        center: [38, -96], zoom: 4,
        zoomControl: false, attributionControl: true,
        scrollWheelZoom: false, dragging: false,
        touchZoom: false, doubleClickZoom: false,
        boxZoom: false, keyboard: false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd', maxZoom: 19,
    }).addTo(radarMap);

    // Warning polygon layer (empty until alerts arrive)
    polyLayer = L.geoJSON(null, {
        style: feature => {
            const cat   = feature.properties?.category || 'advisory';
            const style = POLY_STYLES[cat] || POLY_STYLES.advisory;
            return {
                color:       style.color,
                fillColor:   style.fillColor,
                fillOpacity: 1,
                weight:      style.weight,
                opacity:     0.9,
            };
        },
        onEachFeature: (feature, layer) => {
            const p = feature.properties || {};
            layer.bindTooltip(
                `<strong>${p.event || 'Alert'}</strong><br>${p.area || ''}`,
                { permanent: false, direction: 'center', className: 'poly-tooltip' }
            );
        },
    }).addTo(radarMap);

    buildRadarFrames();

    // Broadcast map position to server whenever user (or code) moves the map
    radarMap.on('moveend zoomend', () => {
        const c = radarMap.getCenter();
        const z = radarMap.getZoom();
        sendWS({ type: 'map-moved', lat: c.lat, lon: c.lng, zoom: z });
    });
}

async function buildRadarFrames() {
    if (radarBuilding || !radarMap) return;
    radarBuilding = true;
    try {
        const r = await fetch(RV_API);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        const past = (data.radar?.past ?? []).slice(-FRAME_COUNT);
        if (!past.length) return;

        // Pre-build all new layers at opacity 0 — don't swap yet
        radarPending = past.map(f =>
            L.tileLayer(`https://tilecache.rainviewer.com${f.path}/256/{z}/{x}/{y}/6/1_1.png`, {
                tileSize: 256, opacity: 0, zIndex: 200, maxNativeZoom: 6,
                attribution: '<a href="https://rainviewer.com" target="_blank" rel="noopener">RainViewer</a>',
            })
        );
        // Add pending layers to map but invisible
        radarPending.forEach(l => l.addTo(radarMap));

        // Wait for first tile of first frame to load before swapping
        await new Promise(resolve => {
            const firstLayer = radarPending[0];
            if (!firstLayer) { resolve(); return; }
            firstLayer.once('load', resolve);
            setTimeout(resolve, 3000); // max wait 3s
        });

        // Now atomically swap: remove old layers, show new
        radarLayers.forEach(l => l.remove());
        radarLayers = radarPending;
        radarPending = [];
        if (polyLayer) polyLayer.bringToFront();
        radarFrame = 0;
        showRadarFrame(radarFrame);
        startRadarAnimation();
    } catch (e) {
        console.warn('[Display] Radar build failed:', e.message);
        // Clean up any pending layers
        radarPending.forEach(l => { try { l.remove(); } catch {} });
        radarPending = [];
    } finally {
        radarBuilding = false;
    }
}

// Rebuild frames every 5 min
setInterval(() => buildRadarFrames(), 5 * 60 * 1000);

function showRadarFrame(idx) {
    if (!radarLayers.length) return;
    radarLayers.forEach((l, i) => {
        // Use setOpacity for smooth cross-fade
        const target = (i === idx) ? radarOpacity : 0;
        l.setOpacity(target);
    });
}

function startRadarAnimation() {
    if (radarAnimTimer) clearInterval(radarAnimTimer);
    if (!radarLayers.length) return;
    radarAnimTimer = setInterval(() => {
        radarFrame = (radarFrame + 1) % radarLayers.length;
        showRadarFrame(radarFrame);
    }, radarAnimSpeed);
}

function setRadarRegion(radar) {
    if (!radarMap) return;
    const key    = (radar.region || 'national').toLowerCase().replace(/\s+/g, '-');
    const region = RADAR_REGIONS[key] || RADAR_REGIONS['national'];
    const lat    = typeof radar.lat  === 'number' ? radar.lat  : region.lat;
    const lon    = typeof radar.lon  === 'number' ? radar.lon  : region.lon;
    const zoom   = typeof radar.zoom === 'number' ? radar.zoom : region.zoom;
    radarMap.setView([lat, lon], zoom, { animate: true });

    // Update animation speed if changed
    const newSpeed = radar.animSpeed || ANIM_MS_DEFAULT;
    if (newSpeed !== radarAnimSpeed) {
        radarAnimSpeed = newSpeed;
        startRadarAnimation();
    }
    // Update opacity if changed
    if (typeof radar.opacity === 'number' && radar.opacity !== radarOpacity) {
        radarOpacity = radar.opacity;
        showRadarFrame(radarFrame);
    }
}

// ── Warning Polygons ──────────────────────────────────────────
function updatePolygons(alerts) {
    if (!polyLayer || !radarMap) return;
    polyLayer.clearLayers();

    const features = alerts
        .filter(a => a.geometry && polyVisibility[a.category || 'advisory'])
        .map(a => ({
            type: 'Feature',
            id: a.id,
            geometry: a.geometry,
            properties: {
                event:    a.event,
                headline: a.headline,
                area:     a.area,
                severity: a.severity,
                category: a.category || alertCategory(a.event),
            },
        }));

    if (features.length) {
        polyLayer.addData({ type: 'FeatureCollection', features });
        polyLayer.bringToFront();
    }
}

function alertCategory(event) {
    const e = (event || '').toLowerCase();
    if (e.includes('tornado'))                    return 'tornado';
    if (e.includes('thunderstorm'))               return 'storm';
    if (e.includes('flash flood'))                return 'flood';
    if (e.includes('fire') || e.includes('red flag')) return 'fire';
    if (e.includes('watch'))                      return 'watch';
    return 'advisory';
}

// Auto-focus map to bbox of given alert(s)
function autoFocusAlerts(alerts) {
    if (!radarMap || !autoFocus) return;
    const withGeo = alerts.filter(a => a.geometry);
    if (!withGeo.length) return;

    try {
        const bounds = L.geoJSON({ type: 'FeatureCollection', features: withGeo.map(a => ({
            type: 'Feature', geometry: a.geometry, properties: {}
        }))}).getBounds();
        if (bounds.isValid()) {
            radarMap.flyToBounds(bounds, { padding: [60, 60], maxZoom: 8, duration: 1.2 });
        }
    } catch (e) {
        console.warn('[Display] autoFocusAlerts failed:', e);
    }
}

// Focus on a specific alert polygon by id
function focusPolygon(alertId, bbox) {
    if (!radarMap) return;
    if (bbox && bbox.length === 4) {
        const [w, s, e, n] = bbox;
        radarMap.flyToBounds([[s, w], [n, e]], { padding: [60, 60], maxZoom: 8, duration: 1.2 });
        return;
    }
    const alert = cachedAlerts.find(a => a.id === alertId);
    if (alert?.geometry) {
        autoFocusAlerts([alert]);
    }
}

// ── Alert Banner ──────────────────────────────────────────────
const BANNER_TYPE_MAP = {
    tornado:   { label: 'TORNADO WARNING',    icon: '🌪️', cls: 'tornado' },
    storm:     { label: 'SEVERE T-STORM',     icon: '⛈️',  cls: 'storm'   },
    flood:     { label: 'FLASH FLOOD WARNING',icon: '🌊',  cls: 'flood'   },
    fire:      { label: 'FIRE WEATHER',       icon: '🔥',  cls: 'fire'    },
    watch:     { label: 'WATCH IN EFFECT',    icon: '👁️',  cls: 'storm'   },
    advisory:  { label: 'WEATHER ADVISORY',   icon: 'ℹ️',  cls: 'flood'   },
};

function showAlertBanner(alert) {
    if (!autoBanner) return;
    const cat = alert.category || alertCategory(alert.event);
    const info = BANNER_TYPE_MAP[cat] || BANNER_TYPE_MAP.advisory;
    const el   = $('alert-banner');

    $('banner-icon').textContent     = info.icon;
    $('banner-type').textContent     = info.label;
    $('banner-type').className       = `banner-type ${info.cls}`;
    $('banner-headline').textContent = alert.headline || alert.event || '';
    $('banner-area').textContent     = alert.area || '';

    const stripe = $('banner-stripe');
    stripe.className = `banner-stripe ${info.cls}`;

    // Handle banner progress via JS interval
    el.classList.remove('visible');
    void el.offsetWidth; // Force reflow
    el.classList.add('visible');

    const bar = $('banner-progress');
    if (bar) {
        const catColors = { tornado:'#ef4444', storm:'#f97316', flood:'#22c55e', fire:'#eab308', watch:'#3b82f6', advisory:'#3b82f6' };
        bar.style.background = catColors[cat] || '#ef4444';
        bar.style.width = '100%';
    }

    if (bannerTimer) clearTimeout(bannerTimer);
    if (bannerTick) clearInterval(bannerTick);

    let msRemaining = BANNER_DURATION * 1000;
    const intervalMs = 50;
    
    bannerTick = setInterval(() => {
        msRemaining -= intervalMs;
        if (bar) bar.style.width = `${Math.max(0, (msRemaining / (BANNER_DURATION * 1000)) * 100)}%`;
        if (msRemaining <= 0) {
            clearInterval(bannerTick);
            dismissBanner();
        }
    }, intervalMs);
}

function dismissBanner() {
    const el = $('alert-banner');
    if (el) el.classList.remove('visible');
    if (bannerTimer) clearTimeout(bannerTimer);
    if (bannerTick) clearInterval(bannerTick);
}

window.dismissBanner = dismissBanner;

// ── Severity Ambient Glow ─────────────────────────────────────
const SEV_PRIORITY = ['tornado', 'storm', 'flood', 'fire', 'watch', 'advisory'];

function updateSeverityAmbient(alerts) {
    const root = document.getElementById('root');
    if (!root) return;
    // Remove all severity classes first
    root.classList.remove('sev-tornado', 'sev-storm', 'sev-flood', 'sev-fire', 'sev-watch', 'sev-advisory');
    if (!alerts?.length) return;
    // Find highest priority category present
    for (const cat of SEV_PRIORITY) {
        const found = alerts.some(a => (a.category || alertCategory(a.event)) === cat);
        if (found) {
            root.classList.add(`sev-${cat}`);
            break;
        }
    }
}

// ── SPC Outlook Overlay ────────────────────────────────────
async function fetchSPCOutlook() {
    if (!radarMap) return;
    try {
        // SPC Day 1 convective outlook GeoJSON (public, CORS-ok)
        const now = new Date();
        const yyyymmdd = now.toISOString().slice(0,10).replace(/-/g,'');
        // Try multiple times (SPC updates at 06z, 13z, 16.30z, 20z, 01z)
        const urls = [
            `https://www.spc.noaa.gov/products/outlook/day1otlk_${yyyymmdd}_2000_cat.nolyr.geojson`,
            `https://www.spc.noaa.gov/products/outlook/day1otlk_${yyyymmdd}_1630_cat.nolyr.geojson`,
            `https://www.spc.noaa.gov/products/outlook/day1otlk_${yyyymmdd}_1300_cat.nolyr.geojson`,
            `https://www.spc.noaa.gov/products/outlook/day1otlk_${yyyymmdd}_0600_cat.nolyr.geojson`,
        ];
        let geojson = null;
        for (const url of urls) {
            try {
                const r = await fetch(url);
                if (r.ok) { geojson = await r.json(); break; }
            } catch {}
        }
        if (!geojson) throw new Error('No SPC data available today');
        if (spcLayer) { spcLayer.clearLayers(); }
        else {
            spcLayer = L.geoJSON(null, {
                style: f => {
                    const cat = (f.properties?.LABEL2 || f.properties?.LABEL || '').toUpperCase();
                    const col = SPC_COLORS[cat] || { color: '#aaa', fill: 'rgba(170,170,170,.1)' };
                    return { color: col.color, fillColor: col.fill, fillOpacity: 1, weight: 1.5, opacity: 0.9 };
                },
                onEachFeature: (f, layer) => {
                    const cat = f.properties?.LABEL2 || f.properties?.LABEL || 'General';
                    layer.bindTooltip(`SPC Day 1 Outlook: <strong>${cat}</strong>`, { className: 'poly-tooltip' });
                },
            }).addTo(radarMap);
        }
        spcLayer.addData(geojson);
        spcLayer.bringToBack(); // behind NWS polygons
        console.log('[Display] SPC outlook loaded');
    } catch (e) {
        console.warn('[Display] SPC fetch failed:', e.message);
    }
}

function setSPCVisible(visible) {
    spcVisible = visible;
    if (!spcLayer) {
        if (visible) fetchSPCOutlook();
        return;
    }
    if (visible) spcLayer.addTo(radarMap);
    else         spcLayer.remove();
}
window.setSPCVisible = setSPCVisible;

function setSnowVisible(visible) {
    snowVisible = visible;
    if (!radarMap) return;
    if (visible) {
        if (!snowLayer) {
            snowLayer = L.tileLayer.wms('https://mesonet.agron.iastate.edu/cgi-bin/wms/us/snowdepth.cgi', {
                layers: 'snowdepth',
                format: 'image/png',
                transparent: true,
                opacity: 0.6,
                zIndex: 100
            });
        }
        snowLayer.addTo(radarMap);
        console.log('[Display] Snow layout layer added');
    } else {
        if (snowLayer) snowLayer.remove();
    }
}

function updateRadarCursor(msg) {
    if (!radarMap) return;
    if (!msg.visible) {
        if (radarCursor) {
            radarCursor.remove();
            radarCursor = null;
        }
        return;
    }
    
    const latlng = [msg.lat, msg.lon];
    if (!radarCursor) {
        radarCursor = L.marker(latlng, {
            icon: L.divIcon({
                className: 'radar-cursor-icon',
                html: '<div class="radar-cursor-crosshair"></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            }),
            interactive: false
        }).addTo(radarMap);
    } else {
        radarCursor.setLatLng(latlng);
    }
}

// ── Slides ────────────────────────────────────────────────────
function showSlide(id) {
    document.querySelectorAll('.slide').forEach(s => s.classList.remove('active'));
    const el = $(id);
    if (el) el.classList.add('active');
    if (id === 'slide-radar')   initRadar();
    if (id === 'slide-cities')  loadCitiesSlide();
    if (id === 'slide-forecast') {} // renderForecast called separately
}

// ── Forecast ──────────────────────────────────────────────────
async function renderForecast(forecast) {
    const el = $('forecast-content');
    if (!el) return;

    let lat = forecast?.lat, lon = forecast?.lon;
    let location = forecast?.location || '';

    // If we have a location name but no lat/lon, geocode it
    if (location && (!lat || !lon)) {
        try {
            const gr = await fetch(
                `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`
            );
            const gd = await gr.json();
            if (gd.results?.length) {
                lat = gd.results[0].latitude;
                lon = gd.results[0].longitude;
                location = gd.results[0].name + ', ' + (gd.results[0].admin1 || '');
            }
        } catch {}
    }

    // Autonomous: if still nothing, use a default
    if (!lat || !lon) {
        el.innerHTML = '<div class="forecast-placeholder">Set a forecast location in the dashboard.</div>';
        return;
    }

    const lbl = $('forecast-label');
    if (lbl) lbl.textContent = `7-DAY FORECAST – ${location.toUpperCase()}`;
    el.innerHTML = '<div class="forecast-loading">Loading forecast…</div>';
    fetchForecastData(lat, lon, el);
}

async function fetchForecastData(lat, lon, container) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
            `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max` +
            `&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto&forecast_days=7`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        renderForecastCards(await r.json(), container);
    } catch (e) {
        const l = container.querySelector('.forecast-loading');
        if (l) l.textContent = 'Forecast data unavailable.';
    }
}

function renderForecastCards(data, container) {
    const { daily, current_weather: cur } = data;
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let html = '';
    if (cur) {
        const [curDesc, curIcon] = WMO[cur.weathercode] ?? ['Unknown', '🌡️'];
        html += `<div class="forecast-card forecast-card--current">
            <div class="forecast-day">NOW</div>
            <div class="forecast-icon" style="font-size:3rem">${curIcon}</div>
            <div class="forecast-desc">${curDesc}</div>
            <div class="forecast-temps"><span class="forecast-high" style="font-size:2rem">${Math.round(cur.temperature)}°</span></div>
            <div class="forecast-precip">💨 ${Math.round(cur.windspeed)} mph</div>
        </div>`;
    }
    html += daily.time.map((date, i) => {
        const dt  = new Date(date + 'T12:00:00');
        const lbl = i === 0 ? 'Today' : DAYS[dt.getDay()];
        const [desc, icon] = WMO[daily.weathercode[i]] ?? ['Unknown', '🌡️'];
        return `<div class="forecast-card">
            <div class="forecast-day">${lbl}</div>
            <div class="forecast-icon">${icon}</div>
            <div class="forecast-desc">${desc}</div>
            <div class="forecast-temps">
                <span class="forecast-high">${Math.round(daily.temperature_2m_max[i])}°</span>
                <span class="forecast-low">${Math.round(daily.temperature_2m_min[i])}°</span>
            </div>
            <div class="forecast-precip">💧 ${(daily.precipitation_sum[i] ?? 0).toFixed(1)} in</div>
        </div>`;
    }).join('');
    container.innerHTML = html;
}

// ── Cities Slide ──────────────────────────────────────────────
async function loadCitiesSlide() {
    if (citiesLoaded) return; // only load once per session
    const el = $('cities-content');
    if (!el) return;
    el.innerHTML = '<div class="city-loading">Loading city forecasts…</div>';
    try {
        // Batch all cities in one Open-Meteo request using latitude/longitude arrays
        const lats = DEFAULT_CITIES.map(c => c.lat).join(',');
        const lons = DEFAULT_CITIES.map(c => c.lon).join(',');
        const url  = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
            `&current_weather=true&daily=temperature_2m_max,temperature_2m_min,weathercode` +
            `&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`;
        const r    = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const raw  = await r.json();
        // API returns array when multiple locations
        const results = Array.isArray(raw) ? raw : [raw];
        el.innerHTML = results.map((d, i) => {
            const city = DEFAULT_CITIES[i] || {};
            const cur  = d.current_weather || {};
            const hi   = d.daily?.temperature_2m_max?.[0];
            const lo   = d.daily?.temperature_2m_min?.[0];
            const code = cur.weathercode ?? d.daily?.weathercode?.[0];
            const [desc, icon] = WMO[code] ?? ['—', '🌡️'];
            return `<div class="city-row">
                <div class="city-icon">${icon}</div>
                <div style="flex:1">
                    <div style="display:flex;align-items:baseline;gap:6px">
                        <span class="city-name">${city.name || ''}</span>
                        <span class="city-state">${city.state || ''}</span>
                    </div>
                    <div class="city-cond">${desc}</div>
                </div>
                <div class="city-temps">
                    <span class="city-high">${hi != null ? Math.round(hi) + '°' : '—'}</span>
                    <span class="city-low"> / ${lo != null ? Math.round(lo) + '°' : '—'}</span>
                </div>
            </div>`;
        }).join('');
        citiesLoaded = true;
    } catch (e) {
        const l = el.querySelector('.city-loading');
        if (l) l.textContent = 'City data unavailable.';
        console.warn('[Display] Cities load failed:', e.message);
    }
}

// ── Lower third ───────────────────────────────────────────────
function applyLowerThird(lt) {
    const el = $('lower-third');
    if (!el) return;
    if (!lt?.visible) {
        el.classList.remove('visible');
        return;
    }
    el.className = `lt-${lt.style || 'info'} visible`;
    el.id = 'lower-third'; // keep id
    const text = $('lower-third-text');
    if (text) text.textContent = lt.text || '';
}

// Fix: ensure id is preserved when we set className
// The lower-third element's id is always 'lower-third'

// ── Alert Takeover ────────────────────────────────────────────
function applyAlertTakeover(alert) {
    const el = $('alert-takeover');
    if (!el) return;
    if (!alert?.active) {
        el.className = '';
        el.removeAttribute('data-type');
        return;
    }
    const type = alert.type || 'info';
    el.className   = 'active';
    el.dataset.type = type;

    $('takeover-icon').textContent     = ALERT_ICONS[type] ?? '⚠️';
    $('takeover-type').textContent     = ALERT_LABELS[type] ?? 'WEATHER ALERT';
    $('takeover-headline').textContent = alert.headline || '';
    $('takeover-county').textContent   = alert.county   || '';
    const exp = $('takeover-expires');
    if (exp) exp.textContent = alert.expires
        ? `Expires: ${new Date(alert.expires).toLocaleTimeString()}`
        : '';
}

// ── Ticker ────────────────────────────────────────────────────
function applyTicker(ticker) {
    const el = $('alert-ticker');
    if (!el) return;
    if (ticker?.visible === false) {
        el.classList.add('hidden');
    } else {
        el.classList.remove('hidden');
    }
    if (ticker?.custom) {
        const content = $('ticker-content');
        if (content) {
            content.textContent = ticker.custom;
            content.dataset.customOverride = 'true';
        }
    }
}

function updateTicker(alerts) {
    const content = $('ticker-content');
    if (!content || content.dataset.customOverride === 'true') return;
    if (!alerts?.length) {
        content.textContent = 'No active NWS alerts at this time.';
        return;
    }

    // Color ticker label based on highest severity
    const hasExtreme = alerts.some(a => (a.severity || '').toLowerCase() === 'extreme');
    const hasSevere  = alerts.some(a => (a.severity || '').toLowerCase() === 'severe');
    const lbl = $('ticker-label');
    if (lbl) {
        lbl.className = (hasExtreme || hasSevere) ? 'ticker-label warning' : 'ticker-label';
    }

    content.textContent = alerts
        .map(a => `⚠ ${a.event}${a.area ? ' – ' + a.area : ''}`)
        .join('   •   ');

    // Recalculate animation duration based on content length
    const charCount = content.textContent.length;
    const duration  = Math.max(20, charCount * 0.15);
    content.style.animationDuration = `${duration}s`;
}

// ── NWS Alerts Handler ────────────────────────────────────────
function severityClass(alert) {
    const s = (alert.severity || '').toLowerCase();
    if (s === 'extreme')  return 'extreme';
    if (s === 'severe')   return 'severe';
    if (s === 'moderate') return 'moderate';
    return 'minor';
}

function applyNwsAlerts(alerts) {
    cachedAlerts = alerts || [];
    updateSeverityAmbient(cachedAlerts);
    updateTicker(cachedAlerts);
    updateSidePanel(cachedAlerts);
    updateAlertsSlide(cachedAlerts);
    updatePolygons(cachedAlerts);
}

function updateSidePanel(alerts) {
    const el = $('side-alerts');
    if (!el) return;
    if (!alerts?.length) {
        el.innerHTML = '<div class="side-alert-none">No active alerts</div>';
        return;
    }
    el.innerHTML = alerts.slice(0, 8).map(a => `
        <div class="side-alert-item side-alert-item--${severityClass(a)}">
            <div class="side-alert-event">${a.event || 'Alert'}</div>
            <div class="side-alert-area">${(a.area || '').slice(0, 50)}</div>
        </div>`).join('');
}

function updateAlertsSlide(alerts) {
    const el = $('alerts-content');
    if (!el) return;
    if (!alerts?.length) {
        el.innerHTML = '<div class="alert-none">No active alerts at this time.</div>';
        return;
    }
    el.innerHTML = alerts.map(a => `
        <div class="alert-detail-card alert-detail-card--${severityClass(a)}">
            <div class="alert-detail-header">
                <span class="alert-detail-event">${ALERT_ICONS[a.category || 'advisory'] || '⚠'} ${a.event || 'Alert'}</span>
                <span class="alert-detail-severity">${a.severity || ''}</span>
            </div>
            <div class="alert-detail-headline">${a.headline || ''}</div>
            <div class="alert-detail-area">📍 ${a.area || ''}</div>
        </div>`).join('');
}

// ── New Alerts Handler (auto-actions) ─────────────────────────
function handleNewAlerts(alerts) {
    if (!alerts?.length) return;

    // Show banner for the most severe new alert
    const primary = alerts[0];
    showAlertBanner(primary);

    // TTS announcement
    if (autoTTS) {
        const ttsText = alerts.map(a =>
            `${a.event} issued for ${a.area || 'your area'}.`
        ).join(' ');
        speakTTS({ text: ttsText, rate: 0.95, pitch: 1, volume: 1 });
    }

    // Play sound
    const cat = primary.category || alertCategory(primary.event);
    const soundMap = {
        tornado: 'tornado-warning',
        storm:   'severe-thunderstorm',
        flood:   'flash-flood',
        fire:    'special-weather',
    };
    playSound(soundMap[cat] || 'chime', 0.8);

    // Auto-focus map
    if (autoFocus) {
        autoFocusAlerts(alerts);
    }
}

// ── Full state apply ──────────────────────────────────────────
function applyState(state) {
    if (!firstState) {
        firstState = true;
        $('slide-waiting')?.classList.remove('active');
    }

    // Sync auto-behavior flags
    autoFocus  = state.autoFocus  !== false;
    autoTTS    = state.autoTTS    !== false;
    autoBanner = state.autoBanner !== false;

    // Sync polygon visibility
    if (state.polygonVisibility) {
        polyVisibility = { ...polyVisibility, ...state.polygonVisibility };
        updatePolygons(cachedAlerts);
    }

    // Mode label
    const modeEl = $('mode-label');
    if (modeEl) modeEl.textContent = (state.mode || 'radar').toUpperCase().replace('-', ' ');

    // Location label
    const locEl = $('header-location');
    if (locEl && state.forecast?.location) locEl.textContent = state.forecast.location;

    switch (state.mode) {
        case 'forecast':
            showSlide('slide-forecast');
            renderForecast(state.forecast || {});
            break;
        case 'alerts':
            showSlide('slide-alerts');
            break;
        case 'cities':
            showSlide('slide-cities');
            break;
        default: // radar
            showSlide('slide-radar');
            setRadarRegion(state.radar || {});
            break;
    }

    applyLowerThird(state.lowerThird);
    applyAlertTakeover(state.alert);
    applyTicker(state.ticker);

    // Radar anim speed / opacity
    if (state.radar?.animSpeed && state.radar.animSpeed !== radarAnimSpeed) {
        radarAnimSpeed = state.radar.animSpeed;
        startRadarAnimation();
    }
    if (typeof state.radar?.opacity === 'number' && state.radar.opacity !== radarOpacity) {
        radarOpacity = state.radar.opacity;
        showRadarFrame(radarFrame);
    }
}

// ── TTS ───────────────────────────────────────────────────────
function speakTTS(msg) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utt    = new SpeechSynthesisUtterance(msg.text || '');
    utt.rate     = Math.max(0.5, Math.min(2,   msg.rate   ?? 1));
    utt.pitch    = Math.max(0,   Math.min(2,   msg.pitch  ?? 1));
    utt.volume   = Math.max(0,   Math.min(1,   msg.volume ?? 1));
    if (msg.voice) {
        const v = speechSynthesis.getVoices().find(
            v => v.name === msg.voice || v.lang === msg.voice
        );
        if (v) utt.voice = v;
    }
    window.speechSynthesis.speak(utt);
}

// ── Sound alerts (Web Audio generated) ───────────────────────
function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

const SOUND_DEFS = {
    'tornado-warning':     () => playSiren(),
    'severe-thunderstorm': () => playBurst(800, 'square',   2.0, false),
    'flash-flood':         () => playDescend(480, 220, 'sine', 2.0),
    'special-weather':     () => playBurst(660, 'sine',    1.0, false),
    'chime':               () => playChord([523, 659, 784], 0.9),
    'test-tone':           () => playBurst(440, 'sine',    1.0, false),
};

function playSound(name, volume = 0.8) {
    const vol = Math.max(0, Math.min(1, volume));
    // Try MP3 first, fall back to generated
    const audio = new Audio(`/sounds/${name}.mp3`);
    audio.volume = vol;
    audio.play().catch(() => {
        // No MP3 – generate tone
        const fn = SOUND_DEFS[name] || SOUND_DEFS['chime'];
        try { fn(vol); } catch(e) { console.warn('[Display] Sound gen failed:', e); }
    });
}

function playBurst(freq, type, dur, ramp) {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    if (ramp) gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + dur * 0.6);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + dur + 0.05);
}

function playDescend(startFreq, endFreq, type, dur) {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(endFreq, ctx.currentTime + dur);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + dur + 0.05);
}

function playChord(freqs, dur) {
    const ctx = getAudioCtx();
    freqs.forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.05);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.05);
        osc.stop(ctx.currentTime + dur + 0.05);
    });
}

// ── WebSocket ──────────────────────────────────────────────────
function sendWS(msg) {
    if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
}

function connectWS() {
    const proto  = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${proto}//${location.host}/api/stream/ws`);
    ws = socket;

    socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'register', role: 'display' }));
        setConnStatus('ok');
        const statusEl = $('waiting-status');
        if (statusEl) statusEl.textContent = 'Connected – awaiting broadcast…';
        if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }

        // Start heartbeat ping
        if (wsPingTimer) clearInterval(wsPingTimer);
        wsPingTimer = setInterval(() => {
            if (socket.readyState === 1) {
                socket.send(JSON.stringify({ type: 'ping' }));
            }
        }, WS_PING_MS);
    });

    socket.addEventListener('message', e => handleMessage(e.data));

    socket.addEventListener('close', () => {
        ws = null;
        setConnStatus('error');
        if (wsPingTimer) { clearInterval(wsPingTimer); wsPingTimer = null; }
        // Exponential-ish backoff: 3s first, then 6s, then 10s
        const delay = wsReconnectTimer ? 6000 : WS_RECONNECT_MS;
        wsReconnectTimer = setTimeout(() => {
            setConnStatus('');
            wsReconnectTimer = null;
            connectWS();
        }, delay);
    });

    socket.addEventListener('error', () => socket.close());
}
function playSiren() {
    const ctx = getAudioCtx();
    const t   = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800,  t);
    osc.frequency.linearRampToValueAtTime(1200, t + 0.5);
    osc.frequency.linearRampToValueAtTime(800,  t + 1.0);
    osc.frequency.linearRampToValueAtTime(1200, t + 1.5);
    osc.frequency.linearRampToValueAtTime(800,  t + 2.0);
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 1.5);
    gain.gain.linearRampToValueAtTime(0, t + 2.0);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(t + 2.1);
}

// ── Message dispatch ──────────────────────────────────────────
function handleMessage(raw) {
    try {
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        switch (msg.type) {
            case 'state':          applyState(msg.state);           break;
            case 'nws-alerts':     applyNwsAlerts(msg.alerts);       break;
            case 'new-alerts':     handleNewAlerts(msg.alerts);      break;
            case 'tts':            speakTTS(msg);                    break;
            case 'sound':          playSound(msg.sound, msg.volume); break;
            case 'focus-polygon':  focusPolygon(msg.alertId, msg.bbox); break;
            case 'dismiss-banner': dismissBanner();                  break;
            case 'overlay-toggle':
                if (msg.overlay === 'spc') setSPCVisible(msg.visible);
                if (msg.overlay === 'snow') setSnowVisible(msg.visible);
                break;
            case 'cursor-move':    updateRadarCursor(msg);           break;
        }
    } catch (e) {
        console.warn('[Display] Message error:', e);
    }
}

// ── SSE fallback ──────────────────────────────────────────────
function connectSSE() {
    const src = new EventSource('/api/stream/events');
    src.onopen    = () => setConnStatus('ok');
    src.onmessage = e => handleMessage(JSON.parse(e.data));
    src.onerror   = () => setConnStatus('error');
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initClock();
    setConnStatus('');
    initRadar();

    if (typeof WebSocket !== 'undefined') {
        connectWS();
    } else {
        connectSSE();
    }

    // Autonomous: fetch current state + alerts without waiting for WS message
    fetch('/api/stream/state').then(r => r.ok ? r.json() : null).then(d => {
        if (d?.state)  applyState(d.state);
        if (d?.alerts) applyNwsAlerts(d.alerts);
    }).catch(() => {});
    fetch('/api/stream/alerts').then(r => r.ok ? r.json() : null).then(d => {
        if (d?.alerts) applyNwsAlerts(d.alerts);
    }).catch(() => {});

    // Bootstrap audio context on first user interaction
    document.addEventListener('click', () => {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }, { once: true });
});
