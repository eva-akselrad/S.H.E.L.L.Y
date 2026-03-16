/* ════════════════════════════════════════════════════════════════
   overlay.js – S.H.E.L.L.Y. Streaming Overlay (Y'allbot Auto Mode)
   Full-screen 1920×1080 OBS Browser Source weather display.
   Connects to /api/stream/ws and auto-cycles weather data.
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────
  const SLIDE_INTERVAL_MS  = 30_000;       // rotate main slides every 30 s
  const WEATHER_REFRESH_MS = 5 * 60_000;  // refresh weather every 5 min
  const ALERT_REFRESH_MS   = 2 * 60_000;  // refresh alerts every 2 min
  const WS_RECONNECT_MS    = 5_000;
  const TICKER_NO_ALERTS   = 'No active severe weather alerts at this time';
  const RV_API             = 'https://api.rainviewer.com/public/weather-maps.json';
  const FRAME_COUNT        = 6;
  const ANIM_MS            = 700;
  const RADAR_OPACITY      = 0.7;

  const CITIES = [
    { name: 'New York',    state: 'NY', lat: 40.7128,  lon: -74.0060  },
    { name: 'Los Angeles', state: 'CA', lat: 34.0522,  lon: -118.2437 },
    { name: 'Chicago',     state: 'IL', lat: 41.8781,  lon: -87.6298  },
    { name: 'Houston',     state: 'TX', lat: 29.7604,  lon: -95.3698  },
    { name: 'Phoenix',     state: 'AZ', lat: 33.4484,  lon: -112.0740 },
    { name: 'Denver',      state: 'CO', lat: 39.7392,  lon: -104.9903 },
    { name: 'Miami',       state: 'FL', lat: 25.7617,  lon: -80.1918  },
    { name: 'Seattle',     state: 'WA', lat: 47.6062,  lon: -122.3321 },
  ];

  const RADAR_REGIONS = [
    { name: 'National',   lat: 38.0, lon: -96.0,  zoom: 4 },
    { name: 'Central US', lat: 35.5, lon: -97.5,  zoom: 5 },
    { name: 'Southeast',  lat: 32.0, lon: -86.0,  zoom: 5 },
    { name: 'Northeast',  lat: 42.0, lon: -74.0,  zoom: 5 },
    { name: 'Southwest',  lat: 34.0, lon: -112.0, zoom: 5 },
    { name: 'Northwest',  lat: 47.0, lon: -120.0, zoom: 5 },
  ];

  // WMO weather-code → [description, emoji]
  const WMO = {
    0:  ['Clear Sky',            '☀️'],
    1:  ['Mainly Clear',         '🌤️'],
    2:  ['Partly Cloudy',        '⛅'],
    3:  ['Overcast',             '☁️'],
    45: ['Fog',                  '🌫️'],
    48: ['Rime Fog',             '🌫️'],
    51: ['Light Drizzle',        '🌦️'],
    53: ['Drizzle',              '🌦️'],
    55: ['Heavy Drizzle',        '🌧️'],
    61: ['Light Rain',           '🌧️'],
    63: ['Rain',                 '🌧️'],
    65: ['Heavy Rain',           '🌧️'],
    71: ['Light Snow',           '🌨️'],
    73: ['Snow',                 '❄️'],
    75: ['Heavy Snow',           '❄️'],
    80: ['Rain Showers',         '🌦️'],
    81: ['Showers',              '🌧️'],
    82: ['Heavy Showers',        '🌧️'],
    95: ['Thunderstorm',         '⛈️'],
    96: ['Thunderstorm w/ Hail', '⛈️'],
    99: ['Severe Thunderstorm',  '⛈️'],
  };

  function wmo(code) {
    return WMO[code] ?? ['Unknown', '🌡️'];
  }

  // ── Mutable state ──────────────────────────────────────────────
  let userLat      = 35.4676;
  let userLon      = -97.5164;
  let userLocation = 'Oklahoma City, OK';

  let currentSlide    = 0;
  let slides          = [];
  let slideTimer      = null;
  let ws              = null;
  let wsReconnTimer   = null;
  let activeAlerts    = [];
  let radarMap        = null;
  let radarLayers     = [];
  let radarFrame      = 0;
  let radarAnimTimer  = null;
  let radarBuilding   = false;
  let radarRegionIdx  = 0;

  // ── Clock ──────────────────────────────────────────────────────
  function startClock() {
    const el = document.getElementById('header-clock');
    function tick() {
      const now = new Date();
      const hh  = String(now.getHours()).padStart(2, '0');
      const mm  = String(now.getMinutes()).padStart(2, '0');
      const ss  = String(now.getSeconds()).padStart(2, '0');
      el.textContent = `${hh}:${mm}:${ss}`;
    }
    tick();
    setInterval(tick, 1000);
  }

  // ── WebSocket ─────────────────────────────────────────────────
  function connectWS() {
    if (wsReconnTimer) { clearTimeout(wsReconnTimer); wsReconnTimer = null; }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      ws = new WebSocket(`${proto}//${location.host}/api/stream/ws`);
    } catch {
      scheduleWsReconnect();
      return;
    }

    ws.addEventListener('open', () => {
      setConnStatus('connected');
      ws.send(JSON.stringify({ type: 'register', role: 'overlay' }));
    });

    ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleWsMessage(msg);
    });

    ws.addEventListener('close', () => {
      setConnStatus('disconnected');
      scheduleWsReconnect();
    });

    ws.addEventListener('error', () => setConnStatus('error'));
  }

  function scheduleWsReconnect() {
    wsReconnTimer = setTimeout(connectWS, WS_RECONNECT_MS);
  }

  function setConnStatus(state) {
    const el = document.getElementById('conn-status');
    if (!el) return;
    el.className = `connection-status connection-status--${state}`;
    const labels = { connected: '● LIVE', disconnected: '○ OFFLINE', error: '✕ ERROR', connecting: '◌ …' };
    el.textContent = labels[state] ?? state;
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'state':      applyStreamState(msg.state);         break;
      case 'nws-alerts': applyNwsAlerts(msg.alerts ?? []);    break;
      case 'tts':        handleTTS(msg);                      break;
    }
  }

  function applyStreamState(state) {
    if (!state) return;

    const modeEl = document.getElementById('mode-label');
    if (modeEl) {
      const label = (state.mode ?? 'auto').toUpperCase();
      modeEl.textContent = `${label} MODE`;
    }

    if (state.alert?.active) {
      showTakeover(state.alert, 'dashboard');
    } else {
      const takeover = document.getElementById('alert-takeover');
      if (takeover?.dataset.source === 'dashboard') hideTakeover();
    }

    if (state.ticker?.custom) {
      setTickerItems([state.ticker.custom]);
    }

    if (state.radar?.region) {
      const idx = RADAR_REGIONS.findIndex(r =>
        r.name.toLowerCase() === state.radar.region.toLowerCase()
      );
      if (idx >= 0) setRadarRegion(idx);
    }
  }

  // ── NWS Alerts ────────────────────────────────────────────────
  function applyNwsAlerts(alerts) {
    activeAlerts = alerts ?? [];
    updateTicker(activeAlerts);
    updateSideAlerts(activeAlerts);
    updateAlertsSlide(activeAlerts);
    checkTornadoTakeover(activeAlerts);
  }

  async function fetchAlerts() {
    try {
      const r = await fetch('/api/stream/alerts');
      if (!r.ok) return;
      const data = await r.json();
      applyNwsAlerts(data.alerts ?? []);
    } catch { /* silent */ }
  }

  function checkTornadoTakeover(alerts) {
    const tornado = alerts.find(a => {
      const e = (a.event ?? '').toLowerCase();
      return e.includes('tornado warning') || e.includes('tornado emergency');
    });
    const el = document.getElementById('alert-takeover');
    if (tornado && el?.classList.contains('hidden')) {
      showTakeover({
        type:     tornado.event?.toLowerCase().includes('emergency') ? 'emergency' : 'tornado',
        headline: tornado.headline ?? tornado.event ?? '',
        county:   tornado.area ?? '',
        expires:  tornado.expires ?? null,
      }, 'auto');
    } else if (!tornado && el?.dataset.source === 'auto') {
      hideTakeover();
    }
  }

  function showTakeover(alert, source = 'dashboard') {
    const el = document.getElementById('alert-takeover');
    if (!el) return;

    el.dataset.source = source;

    const typeIcons  = { tornado: '🌪️', storm: '⛈️', flood: '🌊', fire: '🔥', emergency: '🚨', info: 'ℹ️' };
    const typeLabels = {
      tornado:   'TORNADO WARNING',
      storm:     'SEVERE THUNDERSTORM WARNING',
      flood:     'FLASH FLOOD WARNING',
      fire:      'FIRE WEATHER WARNING',
      emergency: 'TORNADO EMERGENCY',
      info:      'WEATHER ALERT',
    };

    const type = alert.type ?? 'info';
    el.querySelector('#takeover-icon').textContent     = typeIcons[type]  ?? '⚠️';
    el.querySelector('#takeover-type').textContent     = typeLabels[type] ?? escHtml(alert.headline ?? 'ALERT');
    el.querySelector('#takeover-headline').textContent = alert.headline   ?? '';
    el.querySelector('#takeover-county').textContent   = alert.county     ?? '';

    const expiresEl = el.querySelector('#takeover-expires');
    if (expiresEl) {
      expiresEl.textContent = alert.expires
        ? `Expires: ${new Date(alert.expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : '';
    }

    el.className = `alert-takeover alert-takeover--${type}`;
  }

  function hideTakeover() {
    const el = document.getElementById('alert-takeover');
    if (el) el.classList.add('hidden');
  }

  // ── Alert type helpers ────────────────────────────────────────
  function alertTypeClass(event) {
    if (!event) return 'info';
    const e = event.toLowerCase();
    if (e.includes('tornado'))      return 'tornado';
    if (e.includes('thunderstorm')) return 'storm';
    if (e.includes('flood'))        return 'flood';
    if (e.includes('fire'))         return 'fire';
    return 'info';
  }

  function alertIcon(event) {
    return { tornado: '🌪️', storm: '⛈️', flood: '🌊', fire: '🔥', info: '⚠️' }[alertTypeClass(event)] ?? '⚠️';
  }

  // ── Alert ticker ──────────────────────────────────────────────
  function updateTicker(alerts) {
    if (!alerts?.length) {
      setTickerItems([TICKER_NO_ALERTS]);
      return;
    }
    setTickerItems(alerts.map(a => `⚠ ${a.event ?? 'Alert'}: ${a.headline ?? a.area ?? ''}`));
  }

  function setTickerItems(items) {
    const el = document.getElementById('ticker-content');
    if (!el) return;
    const text = items.join('    ●    ');
    el.textContent = text + '    ●    ' + text;

    // Scale animation duration so ticker scrolls at a consistent ~160 px/s
    const px = el.scrollWidth / 2;
    el.style.animationDuration = `${Math.max(10, Math.round(px / 160))}s`;
  }

  // ── Side alerts ───────────────────────────────────────────────
  function updateSideAlerts(alerts) {
    const el = document.getElementById('side-alerts');
    if (!el) return;
    if (!alerts?.length) {
      el.innerHTML = '<div class="no-alerts">✅ No active alerts</div>';
      return;
    }
    el.innerHTML = alerts.slice(0, 5).map(a => `
      <div class="side-alert-item side-alert--${alertTypeClass(a.event)}">
        <div class="side-alert-event">${escHtml(a.event ?? 'Alert')}</div>
        <div class="side-alert-area">${escHtml(a.area ?? '')}</div>
      </div>
    `).join('');
  }

  // ── Alerts detail slide ───────────────────────────────────────
  function updateAlertsSlide(alerts) {
    const el = document.getElementById('alerts-content');
    if (!el) return;
    if (!alerts?.length) {
      el.innerHTML = '<div class="no-data-msg">✅ No active severe weather alerts</div>';
      return;
    }
    el.innerHTML = alerts.slice(0, 6).map(a => `
      <div class="alert-card alert-card--${alertTypeClass(a.event)}">
        <div class="alert-card-header">
          <span class="alert-card-icon">${alertIcon(a.event)}</span>
          <span class="alert-card-event">${escHtml(a.event ?? 'Alert')}</span>
        </div>
        <div class="alert-card-area">${escHtml(a.area ?? '')}</div>
        <div class="alert-card-headline">${escHtml(a.headline ?? '')}</div>
      </div>
    `).join('');
  }

  // ── City Forecasts ────────────────────────────────────────────
  async function fetchCityForecasts() {
    const lats = CITIES.map(c => c.lat).join(',');
    const lons = CITIES.map(c => c.lon).join(',');
    const url  = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${lats}&longitude=${lons}`
      + '&current=temperature_2m,weather_code'
      + '&daily=temperature_2m_max,temperature_2m_min,weather_code'
      + '&temperature_unit=fahrenheit&timezone=auto&forecast_days=1';
    try {
      const r    = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      renderCityList(Array.isArray(data) ? data : [data]);
    } catch (e) {
      console.warn('[Overlay] City forecasts error:', e.message);
    }
  }

  function renderCityList(responses) {
    const el = document.getElementById('city-list');
    if (!el) return;
    el.innerHTML = CITIES.map((city, i) => {
      const r = responses[i];
      if (!r?.current) {
        return `<div class="city-item city-item--error">
          <div class="city-left">
            <span class="city-icon">❓</span>
            <div class="city-name-group">
              <span class="city-name">${escHtml(city.name)}</span>
              <span class="city-state">${escHtml(city.state)}</span>
            </div>
          </div>
          <div class="city-right"><span class="city-temp">--°</span></div>
        </div>`;
      }
      const temp         = Math.round(r.current.temperature_2m);
      const [, icon]     = wmo(r.current.weather_code);
      const hi           = Math.round(r.daily.temperature_2m_max[0]);
      const lo           = Math.round(r.daily.temperature_2m_min[0]);
      return `
        <div class="city-item">
          <div class="city-left">
            <span class="city-icon">${icon}</span>
            <div class="city-name-group">
              <span class="city-name">${escHtml(city.name)}</span>
              <span class="city-state">${escHtml(city.state)}</span>
            </div>
          </div>
          <div class="city-right">
            <span class="city-temp">${temp}°</span>
            <span class="city-hilow">H:${hi}° L:${lo}°</span>
          </div>
        </div>`;
    }).join('');
  }

  // ── Current Conditions ────────────────────────────────────────
  async function fetchConditions() {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${userLat}&longitude=${userLon}`
      + '&current=temperature_2m,apparent_temperature,weather_code,'
      + 'wind_speed_10m,wind_direction_10m,relative_humidity_2m,surface_pressure'
      + '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto';
    try {
      const r    = await fetch(url);
      if (!r.ok) return;
      const data = await r.json();
      renderConditions(data.current);
      const locEl = document.getElementById('header-location');
      if (locEl) locEl.textContent = userLocation;
    } catch { /* silent */ }
  }

  function renderConditions(c) {
    const el = document.getElementById('conditions-content');
    if (!el || !c) return;
    const [desc, icon] = wmo(c.weather_code);
    const windDir      = degToCompass(c.wind_direction_10m ?? 0);
    const inHg         = ((c.surface_pressure ?? 1013) / 33.864).toFixed(2);
    el.innerHTML = `
      <div class="cond-main">
        <div class="cond-icon">${icon}</div>
        <div class="cond-temp">${Math.round(c.temperature_2m)}°F</div>
        <div class="cond-desc">${escHtml(desc)}</div>
      </div>
      <div class="cond-grid">
        <div class="cond-item">
          <span class="cond-label">Feels Like</span>
          <span class="cond-value">${Math.round(c.apparent_temperature)}°F</span>
        </div>
        <div class="cond-item">
          <span class="cond-label">Humidity</span>
          <span class="cond-value">${c.relative_humidity_2m}%</span>
        </div>
        <div class="cond-item">
          <span class="cond-label">Wind</span>
          <span class="cond-value">${windDir} ${Math.round(c.wind_speed_10m)} mph</span>
        </div>
        <div class="cond-item">
          <span class="cond-label">Pressure</span>
          <span class="cond-value">${inHg} inHg</span>
        </div>
      </div>
      <div class="cond-location">${escHtml(userLocation)}</div>`;
  }

  // ── Extended Forecast ─────────────────────────────────────────
  async function fetchExtended() {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${userLat}&longitude=${userLon}`
      + '&daily=temperature_2m_max,temperature_2m_min,weather_code'
      + '&temperature_unit=fahrenheit&timezone=auto&forecast_days=7';
    try {
      const r    = await fetch(url);
      if (!r.ok) return;
      const data = await r.json();
      renderExtended(data.daily);
    } catch { /* silent */ }
  }

  function renderExtended(daily) {
    const el = document.getElementById('extended-content');
    if (!el || !daily) return;
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    el.innerHTML = daily.time.map((dateStr, i) => {
      const d          = new Date(dateStr + 'T12:00:00');
      const dow        = i === 0 ? 'Today' : DOW[d.getDay()];
      const [desc, icon] = wmo(daily.weather_code[i]);
      const hi         = Math.round(daily.temperature_2m_max[i]);
      const lo         = Math.round(daily.temperature_2m_min[i]);
      return `
        <div class="fcst-day">
          <div class="fcst-dow">${escHtml(dow)}</div>
          <div class="fcst-icon">${icon}</div>
          <div class="fcst-desc">${escHtml(desc)}</div>
          <div class="fcst-temps">
            <span class="fcst-hi">${hi}°</span>
            <span class="fcst-lo">${lo}°</span>
          </div>
        </div>`;
    }).join('');
  }

  // ── Radar ─────────────────────────────────────────────────────
  function initRadar() {
    if (radarMap || typeof L === 'undefined') return;
    const mapEl = document.getElementById('radar-map');
    if (!mapEl) return;

    radarMap = L.map('radar-map', {
      center:           [userLat, userLon],
      zoom:             5,
      zoomControl:      false,
      attributionControl: true,
      scrollWheelZoom:  false,
      dragging:         false,
      touchZoom:        false,
      doubleClickZoom:  false,
      boxZoom:          false,
      keyboard:         false,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains:  'abcd',
      maxZoom:     19,
    }).addTo(radarMap);

    buildRadarFrames();
  }

  async function buildRadarFrames() {
    if (radarBuilding || !radarMap) return;
    radarBuilding = true;
    try {
      const r    = await fetch(RV_API);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const past = (data.radar?.past ?? []).slice(-FRAME_COUNT);
      if (!past.length) return;

      const newLayers = past.map(f =>
        L.tileLayer(`https://tilecache.rainviewer.com${f.path}/256/{z}/{x}/{y}/6/1_1.png`, {
          tileSize:       256,
          opacity:        0,
          zIndex:         200,
          maxNativeZoom:  6,
          attribution:    '<a href="https://rainviewer.com" target="_blank" rel="noopener noreferrer">RainViewer</a>',
        })
      );

      radarLayers.forEach(l => l.remove());
      radarLayers = newLayers;
      radarLayers.forEach(l => l.addTo(radarMap));
      radarFrame = radarLayers.length - 1;
      showRadarFrame(radarFrame);
      startRadarAnimation();
    } catch (e) {
      console.warn('[Overlay] Radar build failed:', e.message);
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

  function setRadarRegion(idx) {
    radarRegionIdx = ((idx % RADAR_REGIONS.length) + RADAR_REGIONS.length) % RADAR_REGIONS.length;
    const r = RADAR_REGIONS[radarRegionIdx];
    const nameEl = document.getElementById('radar-region-name');
    if (nameEl) nameEl.textContent = r.name;
    if (radarMap) radarMap.setView([r.lat, r.lon], r.zoom);
  }

  // ── Carousel ──────────────────────────────────────────────────
  function initCarousel() {
    slides = Array.from(document.querySelectorAll('.slide'));
    const indicatorsEl = document.getElementById('carousel-indicators');
    if (indicatorsEl) {
      indicatorsEl.innerHTML = slides.map((_, i) =>
        `<button class="carousel-dot${i === 0 ? ' active' : ''}" data-idx="${i}"></button>`
      ).join('');
      indicatorsEl.addEventListener('click', ev => {
        const btn = ev.target.closest('[data-idx]');
        if (btn) goToSlide(parseInt(btn.dataset.idx, 10));
      });
    }
    slideTimer = setInterval(() => goToSlide((currentSlide + 1) % slides.length), SLIDE_INTERVAL_MS);
  }

  function goToSlide(idx) {
    if (!slides.length || idx === currentSlide) return;
    slides[currentSlide].classList.remove('active');
    currentSlide = idx;
    slides[currentSlide].classList.add('active');

    document.querySelectorAll('.carousel-dot').forEach((dot, i) =>
      dot.classList.toggle('active', i === currentSlide)
    );

    if (slides[currentSlide].id === 'slide-radar') {
      setTimeout(initRadar, 100);
    }
  }

  // ── TTS passthrough ───────────────────────────────────────────
  function handleTTS(msg) {
    if (!msg.text || !window.speechSynthesis) return;
    const utt    = new SpeechSynthesisUtterance(msg.text);
    utt.rate     = msg.rate   ?? 1;
    utt.pitch    = msg.pitch  ?? 1;
    utt.volume   = msg.volume ?? 1;
    window.speechSynthesis.speak(utt);
  }

  // ── Utilities ─────────────────────────────────────────────────
  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function degToCompass(deg) {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  // Try to reuse location set in the main S.H.E.L.L.Y. app
  function loadSavedLocation() {
    try {
      const raw = localStorage.getItem('shelly-location')
                ?? localStorage.getItem('weathernow-location');
      if (!raw) return;
      const p = JSON.parse(raw);
      if (typeof p.lat === 'number' && typeof p.lon === 'number') {
        userLat      = p.lat;
        userLon      = p.lon;
        userLocation = p.label ?? p.name ?? `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`;
      }
    } catch { /* use defaults */ }
  }

  // ── Bootstrap ─────────────────────────────────────────────────
  function init() {
    loadSavedLocation();
    startClock();
    connectWS();
    initCarousel();

    document.getElementById('radar-prev')
      ?.addEventListener('click', () => setRadarRegion(radarRegionIdx - 1));
    document.getElementById('radar-next')
      ?.addEventListener('click', () => setRadarRegion(radarRegionIdx + 1));

    // Radar initialises on first slide (slide-radar is already .active)
    setTimeout(initRadar, 400);

    // Initial data pulls
    fetchConditions();
    fetchExtended();
    fetchCityForecasts();
    fetchAlerts();

    // Periodic refresh
    setInterval(fetchConditions,    WEATHER_REFRESH_MS);
    setInterval(fetchExtended,      WEATHER_REFRESH_MS);
    setInterval(fetchCityForecasts, WEATHER_REFRESH_MS);
    setInterval(fetchAlerts,        ALERT_REFRESH_MS);
    setInterval(buildRadarFrames,   WEATHER_REFRESH_MS);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
