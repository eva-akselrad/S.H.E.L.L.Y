'use strict';

// ── Constants ─────────────────────────────────────────────────
const RV_API         = 'https://api.rainviewer.com/public/weather-maps.json';
const FRAME_COUNT    = 6;
const ANIM_MS        = 600;
const RADAR_OPACITY  = 0.65;
const WS_RECONNECT_MS = 3000;

const RADAR_REGIONS = {
    'national':            { lat: 38.0,  lon: -96.0,   zoom: 4 },
    'northeast':           { lat: 43.0,  lon: -73.5,   zoom: 5 },
    'southeast':           { lat: 32.5,  lon: -85.5,   zoom: 5 },
    'midwest':             { lat: 42.5,  lon: -89.0,   zoom: 5 },
    'south':               { lat: 31.5,  lon: -97.5,   zoom: 5 },
    'great-plains':        { lat: 39.0,  lon: -100.0,  zoom: 5 },
    'west-coast':          { lat: 37.5,  lon: -121.0,  zoom: 5 },
    'pacific-northwest':   { lat: 47.5,  lon: -121.5,  zoom: 5 },
    // legacy aliases from overlay.js regions
    'central us':          { lat: 35.5,  lon: -97.5,   zoom: 5 },
    'southwest':           { lat: 34.0,  lon: -112.0,  zoom: 5 },
    'northwest':           { lat: 47.0,  lon: -120.0,  zoom: 5 },
};

const WMO = {
    0:  ['Clear',          '☀️'],
    1:  ['Mainly Clear',   '🌤️'],
    2:  ['Partly Cloudy',  '⛅'],
    3:  ['Overcast',       '☁️'],
    45: ['Fog',            '🌫️'],
    48: ['Rime Fog',       '🌫️'],
    51: ['Light Drizzle',  '🌦️'],
    53: ['Drizzle',        '🌦️'],
    55: ['Heavy Drizzle',  '🌧️'],
    61: ['Light Rain',     '🌧️'],
    63: ['Rain',           '🌧️'],
    65: ['Heavy Rain',     '🌧️'],
    71: ['Light Snow',     '🌨️'],
    73: ['Snow',           '❄️'],
    75: ['Heavy Snow',     '❄️'],
    80: ['Showers',        '🌦️'],
    81: ['Showers',        '🌧️'],
    82: ['Heavy Showers',  '🌧️'],
    95: ['Thunderstorm',   '⛈️'],
    96: ['T-storm/Hail',   '⛈️'],
    99: ['Severe T-storm', '⛈️'],
};

const ALERT_ICONS = {
    tornado:   '🌪️',
    storm:     '⛈️',
    flood:     '🌊',
    fire:      '🔥',
    emergency: '🚨',
    info:      'ℹ️',
};

const ALERT_LABELS = {
    tornado:   'TORNADO WARNING',
    storm:     'SEVERE THUNDERSTORM WARNING',
    flood:     'FLASH FLOOD WARNING',
    fire:      'FIRE WEATHER WARNING',
    emergency: 'EMERGENCY ALERT',
    info:      'WEATHER STATEMENT',
};

// ── Mutable state ─────────────────────────────────────────────
let radarMap         = null;
let radarLayers      = [];
let radarFrame       = 0;
let radarAnimTimer   = null;
let radarBuilding    = false;
let ws               = null;
let wsReconnectTimer = null;
let firstStateReceived = false;
let audioCtx         = null;
const soundCache     = {};

// ── DOM helpers ───────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Clock ─────────────────────────────────────────────────────
function initClock() {
    function tick() {
        const el = $('header-clock');
        if (el) el.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
    }
    tick();
    setInterval(tick, 1000);
}

// ── Connection status dot ─────────────────────────────────────
function setConnStatus(status) {
    const el = $('conn-status');
    if (!el) return;
    el.className = 'connection-status connection-status--' + status;
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
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(radarMap);

    buildRadarFrames();
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

        const newLayers = past.map(f =>
            L.tileLayer(`https://tilecache.rainviewer.com${f.path}/256/{z}/{x}/{y}/6/1_1.png`, {
                tileSize: 256, opacity: 0, zIndex: 200,
                maxNativeZoom: 6,
                attribution: '<a href="https://rainviewer.com" target="_blank" rel="noopener noreferrer">RainViewer</a>',
            })
        );

        radarLayers.forEach(l => l.remove());
        radarLayers = newLayers;
        radarLayers.forEach(l => l.addTo(radarMap));
        radarFrame = radarLayers.length - 1;
        showRadarFrame(radarFrame);
        startRadarAnimation();
    } catch (e) {
        console.warn('[StreamDisplay] Radar build failed:', e.message);
    } finally {
        radarBuilding = false;
    }
}

function showRadarFrame(idx) {
    radarLayers.forEach((l, i) => l.setOpacity(i === idx ? RADAR_OPACITY : 0));
}

function startRadarAnimation() {
    if (radarAnimTimer) clearInterval(radarAnimTimer);
    radarAnimTimer = setInterval(() => {
        radarFrame = (radarFrame + 1) % radarLayers.length;
        showRadarFrame(radarFrame);
    }, ANIM_MS);
}

function setRadarRegion(radar) {
    const key    = (radar.region || 'national').toLowerCase().replace(/\s+/g, '-');
    const region = RADAR_REGIONS[key] || RADAR_REGIONS['national'];
    const lat    = typeof radar.lat === 'number' ? radar.lat : region.lat;
    const lon    = typeof radar.lon === 'number' ? radar.lon : region.lon;
    const zoom   = typeof radar.zoom === 'number' ? radar.zoom : region.zoom;
    if (radarMap) radarMap.setView([lat, lon], zoom);
}

// ── Slide management ──────────────────────────────────────────
function showSlide(id) {
    document.querySelectorAll('.slide').forEach(s => s.classList.remove('active'));
    const el = $(id);
    if (el) el.classList.add('active');
}

// ── Forecast ──────────────────────────────────────────────────
function renderForecast(forecast) {
    const el = $('forecast-content');
    if (!el) return;
    if (!forecast?.location) {
        el.innerHTML = '<div class="forecast-placeholder">No forecast location configured.</div>';
        return;
    }
    el.innerHTML = `<div class="forecast-loading">Loading forecast for ${forecast.location}…</div>`;
    if (forecast.lat && forecast.lon) {
        fetchForecastData(forecast.lat, forecast.lon, el);
    }
}

async function fetchForecastData(lat, lon, container) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
            `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum` +
            `&temperature_unit=fahrenheit&timezone=auto&forecast_days=7`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        renderForecastCards(await r.json(), container);
    } catch (e) {
        const loading = container.querySelector('.forecast-loading');
        if (loading) loading.textContent = 'Forecast data unavailable.';
    }
}

function renderForecastCards(data, container) {
    const { daily } = data;
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    container.innerHTML = daily.time.map((date, i) => {
        const dt   = new Date(date + 'T12:00:00');
        const label = i === 0 ? 'Today' : DAY_NAMES[dt.getDay()];
        const [desc, icon] = WMO[daily.weathercode[i]] ?? ['Unknown', '🌡️'];
        return `<div class="forecast-card">
            <div class="forecast-day">${label}</div>
            <div class="forecast-icon">${icon}</div>
            <div class="forecast-desc">${desc}</div>
            <div class="forecast-temps">
                <span class="forecast-high">${Math.round(daily.temperature_2m_max[i])}°</span>
                <span class="forecast-low">${Math.round(daily.temperature_2m_min[i])}°</span>
            </div>
            <div class="forecast-precip">💧 ${(daily.precipitation_sum[i] ?? 0).toFixed(1)} in</div>
        </div>`;
    }).join('');
}

// ── Lower third ───────────────────────────────────────────────
function applyLowerThird(lt) {
    const el = $('lower-third');
    if (!el) return;
    if (!lt?.visible) {
        el.classList.add('hidden');
        el.classList.remove('visible');
        return;
    }
    el.className = `lower-third lower-third--${lt.style || 'info'} visible`;
    el.classList.remove('hidden');
    const text = $('lower-third-text');
    if (text) text.textContent = lt.text || '';
}

// ── Alert takeover ────────────────────────────────────────────
function applyAlertTakeover(alert) {
    const el = $('alert-takeover');
    if (!el) return;
    if (!alert?.active) {
        el.className = 'alert-takeover hidden';
        return;
    }
    el.className = `alert-takeover alert-takeover--${alert.type || 'info'}`;
    $('takeover-icon').textContent     = ALERT_ICONS[alert.type] ?? '⚠️';
    $('takeover-type').textContent     = ALERT_LABELS[alert.type] ?? 'WEATHER ALERT';
    $('takeover-headline').textContent = alert.headline || '';
    $('takeover-county').textContent   = alert.county || '';
    const exp = $('takeover-expires');
    if (exp) {
        exp.textContent = alert.expires
            ? `Expires: ${new Date(alert.expires).toLocaleTimeString()}`
            : '';
    }
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
        if (content) content.textContent = ticker.custom;
    }
}

// ── Apply full state ──────────────────────────────────────────
function applyState(state) {
    if (!firstStateReceived) {
        firstStateReceived = true;
        $('slide-waiting')?.classList.remove('active');
    }

    const modeEl = $('mode-label');
    if (modeEl) modeEl.textContent = (state.mode || 'radar').toUpperCase().replace('-', ' ');

    const locEl = $('header-location');
    if (locEl && state.forecast?.location) locEl.textContent = state.forecast.location;

    switch (state.mode) {
        case 'forecast':
            showSlide('slide-forecast');
            const label = $('forecast-label');
            if (label && state.forecast?.location) label.textContent = `FORECAST – ${state.forecast.location}`;
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
            initRadar();
            setRadarRegion(state.radar || {});
            break;
    }

    applyLowerThird(state.lowerThird);
    applyAlertTakeover(state.alert);
    applyTicker(state.ticker);
}

// ── NWS alerts ────────────────────────────────────────────────
function applyNwsAlerts(alerts) {
    updateTicker(alerts);
    updateSidePanel(alerts);
    updateAlertsSlide(alerts);
}

function updateTicker(alerts) {
    const el = $('ticker-content');
    if (!el || el.dataset.customOverride === 'true') return;
    el.textContent = alerts?.length
        ? alerts.map(a => `⚠ ${a.event}${a.areaDesc ? ' – ' + a.areaDesc : ''}`).join('   •   ')
        : 'No active NWS alerts at this time.';
}

function severityClass(alert) {
    const s = (alert.severity || '').toLowerCase();
    if (s === 'extreme')  return 'extreme';
    if (s === 'severe')   return 'severe';
    if (s === 'moderate') return 'moderate';
    return 'minor';
}

function updateSidePanel(alerts) {
    const el = $('side-alerts');
    if (!el) return;
    if (!alerts?.length) {
        el.innerHTML = '<div class="side-alert-none">No active alerts</div>';
        return;
    }
    el.innerHTML = alerts.slice(0, 6).map(a => `
        <div class="side-alert-item side-alert-item--${severityClass(a)}">
            <div class="side-alert-event">${a.event || 'Alert'}</div>
            <div class="side-alert-area">${a.areaDesc || ''}</div>
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
                <span class="alert-detail-event">${a.event || 'Alert'}</span>
                <span class="alert-detail-severity">${a.severity || ''}</span>
            </div>
            <div class="alert-detail-headline">${a.headline || ''}</div>
            <div class="alert-detail-area">📍 ${a.areaDesc || ''}</div>
        </div>`).join('');
}

// ── TTS ───────────────────────────────────────────────────────
function speakTTS(msg) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utt    = new SpeechSynthesisUtterance(msg.text || '');
    utt.rate     = Math.max(0.5, Math.min(2, msg.rate   ?? 1));
    utt.pitch    = Math.max(0,   Math.min(2, msg.pitch  ?? 1));
    utt.volume   = Math.max(0,   Math.min(1, msg.volume ?? 1));
    if (msg.voice) {
        const v = speechSynthesis.getVoices().find(
            v => v.name === msg.voice || v.lang === msg.voice
        );
        if (v) utt.voice = v;
    }
    window.speechSynthesis.speak(utt);
}

// ── Sound alerts ──────────────────────────────────────────────
const SOUND_TONES = {
    'tornado-warning':     { freq: 1040, dur: 3.0, type: 'sawtooth', ramp: true  },
    'severe-thunderstorm': { freq: 800,  dur: 2.0, type: 'square',   ramp: false },
    'flash-flood':         { freq: 440,  dur: 1.5, type: 'sine',     ramp: false },
    'special-weather':     { freq: 660,  dur: 1.0, type: 'sine',     ramp: false },
    'test-tone':           { freq: 440,  dur: 1.0, type: 'sine',     ramp: false },
    'chime':               { freq: 523,  dur: 0.8, type: 'sine',     ramp: false },
};

function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

function playGeneratedTone(name, volume) {
    const ctx    = getAudioCtx();
    const cfg    = SOUND_TONES[name] ?? SOUND_TONES['chime'];
    const osc    = ctx.createOscillator();
    const gain   = ctx.createGain();
    osc.type = cfg.type;
    osc.frequency.setValueAtTime(cfg.freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    if (cfg.ramp) {
        gain.gain.linearRampToValueAtTime(volume * 0.4, ctx.currentTime + cfg.dur * 0.6);
    }
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + cfg.dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + cfg.dur + 0.05);
}

function playSound(name, volume) {
    const vol = Math.max(0, Math.min(1, volume ?? 0.8));
    if (!soundCache[name]) soundCache[name] = new Audio(`/sounds/${name}.mp3`);
    const audio = soundCache[name];
    audio.volume = vol;
    audio.currentTime = 0;
    audio.play().catch(() => playGeneratedTone(name, vol));
}

// ── Message dispatch ──────────────────────────────────────────
function handleMessage(raw) {
    try {
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        switch (msg.type) {
            case 'state':      applyState(msg.state);                   break;
            case 'nws-alerts': applyNwsAlerts(msg.alerts);              break;
            case 'tts':        speakTTS(msg);                           break;
            case 'sound':      playSound(msg.sound, msg.volume);        break;
        }
    } catch (e) {
        console.warn('[StreamDisplay] Message error:', e);
    }
}

// ── WebSocket connection ──────────────────────────────────────
function connectWS() {
    const proto  = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${proto}//${location.host}/api/stream/ws`);
    ws = socket;

    socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'register', role: 'display' }));
        setConnStatus('connected');
        const statusEl = $('waiting-status');
        if (statusEl) statusEl.textContent = 'Connected – awaiting broadcast…';
        if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    });

    socket.addEventListener('message', e => handleMessage(e.data));

    socket.addEventListener('close', () => {
        ws = null;
        setConnStatus('disconnected');
        wsReconnectTimer = setTimeout(() => {
            setConnStatus('connecting');
            connectWS();
        }, WS_RECONNECT_MS);
    });

    socket.addEventListener('error', () => socket.close());
}

// ── SSE fallback ──────────────────────────────────────────────
function connectSSE() {
    const src = new EventSource('/api/stream/events');
    src.onopen    = () => setConnStatus('connected');
    src.onmessage = e => handleMessage(JSON.parse(e.data));
    src.onerror   = () => setConnStatus('connecting');
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initClock();
    setConnStatus('connecting');
    initRadar();

    if (typeof WebSocket !== 'undefined') {
        connectWS();
    } else {
        connectSSE();
    }
});
