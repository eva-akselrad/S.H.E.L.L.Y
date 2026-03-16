'use strict';
/* ════════════════════════════════════════════════════════════════
   S.H.E.L.L.Y. – Stream Dashboard JS v2
   ════════════════════════════════════════════════════════════════ */

let adminPw = sessionStorage.getItem('shelly-admin-pw') || '';
let dashWS  = null;
let state   = null;
let selectedAlertType = 'tornado';
let selectedLTStyle   = 'info';
let audioCtx          = null;

// Manual radar state (mirrors what display shows)
let mapLat  = 38.0;
let mapLon  = -96.0;
let mapZoom = 4;
let panInterval = null;
const PAN_STEP  = 2.0; // degrees per pan tick

const $ = id => document.getElementById(id);


// ── Auth ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    $('login-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    if (adminPw) verifyAndShow(adminPw);
    populateVoices();
    if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.onvoiceschanged = populateVoices;
    }
});

function populateVoices() {
    const sel = $('tts-voice');
    if (!sel) return;
    const voices = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
    sel.innerHTML = '<option value="">Default voice</option>' +
        voices.map(v => `<option value="${v.name}">${v.name} (${v.lang})</option>`).join('');
}

async function doLogin() {
    const btn = $('login-btn'), err = $('login-err');
    const pw  = $('login-pw').value.trim();
    if (!pw) { err.textContent = 'Enter your password.'; return; }
    btn.disabled = true; btn.textContent = 'Verifying…'; err.textContent = '';
    try {
        const r = await fetch('/api/verify', { headers: { 'x-admin-password': pw } });
        if (r.ok) {
            adminPw = pw;
            sessionStorage.setItem('shelly-admin-pw', pw);
            showApp();
        } else {
            err.textContent = 'Incorrect password.';
        }
    } catch { err.textContent = 'Server unreachable.'; }
    finally { btn.disabled = false; btn.textContent = 'Unlock Dashboard'; }
}

async function verifyAndShow(pw) {
    try {
        const r = await fetch('/api/verify', { headers: { 'x-admin-password': pw } });
        if (r.ok) showApp();
        else { sessionStorage.removeItem('shelly-admin-pw'); adminPw = ''; }
    } catch {}
}

function doLogout() {
    sessionStorage.removeItem('shelly-admin-pw'); adminPw = '';
    if (dashWS) { dashWS.close(); dashWS = null; }
    $('app').classList.remove('show');
    $('login-screen').style.display = 'flex';
    $('login-pw').value = ''; $('login-err').textContent = '';
}
window.doLogout = doLogout;

function showApp() {
    $('login-screen').style.display = 'none';
    $('app').classList.add('show');
    connectWS();
    refreshConnections();
    setInterval(refreshConnections, 10000);
    refreshAlerts();
    setInterval(refreshAlerts, 60000);
    log('Dashboard unlocked', 'ok');
    fetch('/api/stream/state')
        .then(r => r.json())
        .then(d => { if (d.state) applyState(d.state); })
        .catch(() => {});
}

// ── WebSocket ─────────────────────────────────────────────────
let wsPingInterval = null;

function connectWS() {
    const proto  = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${proto}//${location.host}/api/stream/ws`);
    dashWS = socket;

    socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'register', role: 'dashboard' }));
        setWsDot('ok');
        if (wsPingInterval) clearInterval(wsPingInterval);
        wsPingInterval = setInterval(() => {
            if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'ping' }));
        }, 20000);
    });
    socket.addEventListener('message', e => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'state')      applyState(msg.state);
            if (msg.type === 'nws-alerts') renderNwsAlerts(msg.alerts || []);
            if (msg.type === 'new-alerts') { log(`🆕 New alert: ${msg.alerts?.[0]?.event || '?'}`, 'warn'); }
            if (msg.type === 'map-moved')  syncMapPosition(msg.lat, msg.lon, msg.zoom);
        } catch {}
    });
    socket.addEventListener('close', () => {
        setWsDot('err');
        if (wsPingInterval) { clearInterval(wsPingInterval); wsPingInterval = null; }
        setTimeout(connectWS, 3000);
    });
    socket.addEventListener('error', () => socket.close());
}

function setWsDot(s) {
    const dot = $('ws-dot'), lbl = $('ws-lbl');
    if (dot) dot.className = s === 'ok' ? 'ok' : s === 'err' ? 'err' : '';
    if (lbl) lbl.textContent = s === 'ok' ? 'Connected' : s === 'err' ? 'Disconnected' : 'Connecting…';
}

// ── Apply State ───────────────────────────────────────────────
function applyState(s) {
    state = s;
    const sb = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    sb('sb-mode',      s.mode || '—');
    sb('sb-lt',        s.lowerThird?.visible ? 'ON' : 'OFF');
    sb('sb-alert',     s.alert?.active ? '⚡ ACTIVE' : 'off');
    sb('sb-autofocus', s.autoFocus !== false ? 'ON' : 'OFF');
    sb('sb-autotts',   s.autoTTS   !== false ? 'ON' : 'OFF');

    // Mode tabs
    const mb = $('mode-badge');
    if (mb) mb.textContent = s.mode || '—';
    document.querySelectorAll('.mode-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === s.mode));

    // Radar
    const rb = $('radar-badge');
    if (rb) rb.textContent = s.radar?.region || '—';
    document.querySelectorAll('.region-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.region === s.radar?.region));

    // Alert takeover
    const tb = $('takeover-badge');
    if (tb) { tb.textContent = s.alert?.active ? '⚡ ACTIVE' : 'INACTIVE'; tb.style.color = s.alert?.active ? 'var(--red)' : ''; }

    // Lower third
    const lt = $('lt-toggle');
    if (lt) lt.checked = !!s.lowerThird?.visible;
    const lb = $('lt-badge');
    if (lb) lb.textContent = s.lowerThird?.visible ? 'ON' : 'OFF';

    // Ticker
    const tt = $('ticker-toggle');
    if (tt) tt.checked = s.ticker?.visible !== false;
    const tb2 = $('ticker-badge');
    if (tb2) tb2.textContent = s.ticker?.visible !== false ? 'VISIBLE' : 'HIDDEN';

    // Auto toggles
    const af = $('auto-focus');   if (af) af.checked = s.autoFocus  !== false;
    const at = $('auto-tts');     if (at) at.checked = s.autoTTS    !== false;
    const ab = $('auto-banner');  if (ab) ab.checked = s.autoBanner !== false;

    // Radar settings
    if (s.radar?.animSpeed) {
        const slider = $('anim-speed'), val = $('anim-speed-val');
        if (slider) slider.value = s.radar.animSpeed;
        if (val)    val.textContent = s.radar.animSpeed + 'ms';
    }
    if (typeof s.radar?.opacity === 'number') {
        const slider = $('radar-opacity'), val = $('opacity-val');
        if (slider) slider.value = s.radar.opacity;
        if (val)    val.textContent = s.radar.opacity.toFixed(2);
    }
}

// ── API helper ────────────────────────────────────────────────
async function cmd(action, data = {}) {
    try {
        const r = await fetch('/api/stream/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Password': adminPw },
            body: JSON.stringify({ action, data }),
        });
        const j = await r.json();
        if (j.ok) { log(`✓ ${action}`, 'ok'); if (j.state) applyState(j.state); }
        else       log(`✗ ${action}: ${j.error || r.status}`, 'err');
        return j;
    } catch (e) {
        log(`✗ ${action}: ${e.message}`, 'err');
        return null;
    }
}
window.cmd = cmd;

// ── Mode ──────────────────────────────────────────────────────
window.setMode = mode => cmd('set-mode', { mode });

// ── Radar ─────────────────────────────────────────────────────
window.setRadarRegion = region => cmd('set-radar', { region });

window.setRadarCustom = () => {
    const lat  = parseFloat($('custom-lat')?.value);
    const lon  = parseFloat($('custom-lon')?.value);
    const zoom = parseInt($('custom-zoom')?.value) || 5;
    if (isNaN(lat) || isNaN(lon)) { log('Invalid lat/lon', 'warn'); return; }
    cmd('set-radar', { lat, lon, zoom, region: 'custom' });
};

window.quickFocus = (lat, lon, zoom) => cmd('set-radar', { lat, lon, zoom, region: 'custom' });

// ── Polygon visibility ─────────────────────────────────────────
window.setPolyVisibility = (type, visible) => cmd('set-polygon-visibility', { type, visible });

// ── Alert takeover ────────────────────────────────────────────
window.selectAlertType = type => {
    selectedAlertType = type;
    document.querySelectorAll('.atype-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.atype === type));
};

window.triggerAlertTakeover = () => {
    const headline = $('alert-headline')?.value.trim();
    const county   = $('alert-county')?.value.trim();
    if (!headline) { log('Headline required', 'warn'); return; }
    cmd('trigger-alert', { type: selectedAlertType, headline, county });
};

// ── Lower third ───────────────────────────────────────────────
window.setLTStyle = style => {
    selectedLTStyle = style;
    document.querySelectorAll('[data-ltstyle]').forEach(b =>
        b.classList.toggle('active', b.dataset.ltstyle === style));
    setLowerThird();
};

window.setLowerThird = () => {
    const visible = $('lt-toggle')?.checked;
    const text    = $('lt-text')?.value || '';
    cmd('set-lower-third', { visible, text, style: selectedLTStyle });
};

// ── Ticker ────────────────────────────────────────────────────
window.setTicker = () => {
    const visible = $('ticker-toggle')?.checked;
    const custom  = $('ticker-custom')?.value.trim();
    cmd('toggle-ticker', { visible, custom });
};

// ── Forecast ─────────────────────────────────────────────────
window.setForecastLocation = () => {
    const location = $('forecast-location')?.value.trim();
    const lat = parseFloat($('forecast-lat')?.value) || null;
    const lon = parseFloat($('forecast-lon')?.value) || null;
    if (!location) { log('Location name required', 'warn'); return; }
    cmd('set-forecast', { visible: true, location, lat, lon });
};

// ── TTS ───────────────────────────────────────────────────────
window.sendTTS = async () => {
    const text   = $('tts-text')?.value.trim();
    const rate   = parseFloat($('tts-rate')?.value)   || 1;
    const pitch  = parseFloat($('tts-pitch')?.value)  || 1;
    const volume = parseFloat($('tts-volume')?.value) || 1;
    const voice  = $('tts-voice')?.value || '';
    if (!text) { log('TTS: text required', 'warn'); return; }
    try {
        await fetch('/api/stream/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Password': adminPw },
            body: JSON.stringify({ text, rate, pitch, volume, voice }),
        });
        log('TTS sent', 'ok');
    } catch (e) { log(`TTS error: ${e.message}`, 'err'); }
};

// Preview TTS locally (without sending to stream)
window.previewTTS = () => {
    if (!('speechSynthesis' in window)) { log('TTS not supported here', 'warn'); return; }
    const text  = $('tts-text')?.value.trim();
    if (!text) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate  = parseFloat($('tts-rate')?.value)   || 1;
    utt.pitch = parseFloat($('tts-pitch')?.value)  || 1;
    utt.volume= parseFloat($('tts-volume')?.value) || 1;
    const voiceName = $('tts-voice')?.value;
    if (voiceName) {
        const v = speechSynthesis.getVoices().find(v => v.name === voiceName);
        if (v) utt.voice = v;
    }
    speechSynthesis.speak(utt);
    log('TTS preview playing locally', 'info');
};

// ── Sounds ────────────────────────────────────────────────────
window.sendSound = async name => {
    const volume = parseFloat($('sound-vol')?.value) || 0.8;
    // Play locally in dashboard too
    playLocalSound(name, volume);
    try {
        await fetch('/api/stream/sound', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Password': adminPw },
            body: JSON.stringify({ sound: name, volume }),
        });
        log(`Sound: ${name}`, 'ok');
    } catch (e) { log(`Sound error: ${e.message}`, 'err'); }
};

function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

function playLocalSound(name, vol = 0.8) {
    try {
        const ctx = getAudioCtx();
        const t   = ctx.currentTime;
        if (name === 'tornado-warning') {
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(800, t);
            osc.frequency.linearRampToValueAtTime(1200, t + 0.5);
            osc.frequency.linearRampToValueAtTime(800,  t + 1.0);
            osc.frequency.linearRampToValueAtTime(1200, t + 1.5);
            osc.frequency.linearRampToValueAtTime(800,  t + 2.0);
            g.gain.setValueAtTime(vol * 0.5, t);
            g.gain.linearRampToValueAtTime(0, t + 2.0);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(); osc.stop(t + 2.1);
        } else if (name === 'severe-thunderstorm') {
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.type = 'square'; osc.frequency.value = 800;
            g.gain.setValueAtTime(vol * 0.4, t); g.gain.linearRampToValueAtTime(0, t + 2);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(); osc.stop(t + 2.05);
        } else if (name === 'flash-flood') {
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.type = 'sine'; osc.frequency.setValueAtTime(520, t);
            osc.frequency.linearRampToValueAtTime(220, t + 2);
            g.gain.setValueAtTime(vol * 0.5, t); g.gain.linearRampToValueAtTime(0, t + 2);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(); osc.stop(t + 2.05);
        } else if (name === 'chime') {
            [523, 659, 784].forEach((freq, i) => {
                const osc = ctx.createOscillator(), g = ctx.createGain();
                osc.type = 'sine'; osc.frequency.value = freq;
                g.gain.setValueAtTime(vol * 0.25, t + i * 0.05);
                g.gain.linearRampToValueAtTime(0, t + 0.9);
                osc.connect(g); g.connect(ctx.destination);
                osc.start(t + i * 0.05); osc.stop(t + 0.95);
            });
        } else {
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.type = 'sine'; osc.frequency.value = 660;
            g.gain.setValueAtTime(vol * 0.4, t); g.gain.linearRampToValueAtTime(0, t + 1);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(); osc.stop(t + 1.05);
        }
    } catch (e) { console.warn('[Dashboard] Sound gen failed:', e); }
}

// Bootstrap audio on first click
document.addEventListener('click', () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}, { once: true });

// ── NWS Alerts Panel ──────────────────────────────────────────
window.refreshAlerts = async () => {
    try {
        const r = await fetch('/api/stream/alerts');
        if (!r.ok) return;
        const d = await r.json();
        renderNwsAlerts(d.alerts || []);
    } catch {}
};

window.forceCheck = async () => {
    try {
        await fetch('/api/stream/alerts/force-check', {
            method: 'POST',
            headers: { 'X-Admin-Password': adminPw },
        });
        log('Forced NWS check', 'info');
        setTimeout(refreshAlerts, 1500);
    } catch (e) { log(`Force check error: ${e.message}`, 'err'); }
};

function severityClass(sev) {
    const s = (sev || '').toLowerCase();
    if (s === 'extreme')  return 'extreme';
    if (s === 'severe')   return 'severe';
    if (s === 'moderate') return 'moderate';
    return '';
}

function alertCategory(event) {
    const e = (event || '').toLowerCase();
    if (e.includes('tornado'))    return 'tornado';
    if (e.includes('thunderstorm')) return 'storm';
    if (e.includes('flash flood')) return 'flood';
    if (e.includes('fire') || e.includes('red flag')) return 'fire';
    if (e.includes('watch'))       return 'watch';
    return 'advisory';
}

const CATEGORY_SOUNDS = {
    tornado: 'tornado-warning', storm: 'severe-thunderstorm',
    flood: 'flash-flood', fire: 'special-weather',
    watch: 'chime', advisory: 'chime',
};

function renderNwsAlerts(alerts) {
    const el = $('nws-list');
    const badge = $('nws-count');
    if (!el) return;
    if (badge) badge.textContent = alerts.length ? `${alerts.length} active` : 'None';

    if (!alerts.length) {
        el.innerHTML = '<div style="color:var(--muted);font-size:.8rem;font-family:var(--font-m)">No active alerts.</div>';
        return;
    }

    el.innerHTML = alerts.map(a => {
        const cat   = a.category || alertCategory(a.event);
        const sev   = severityClass(a.severity);
        const sound = CATEGORY_SOUNDS[cat] || 'chime';
        const hasGeo = !!a.geometry;
        return `
        <div class="nws-item" style="margin-bottom:6px">
          <div class="nws-item__top">
            <span class="nws-item__event ${sev}">${a.event || 'Unknown Alert'}</span>
            <span style="font-family:var(--font-m);font-size:.6rem;color:var(--muted)">${a.severity || ''}</span>
          </div>
          <div class="nws-item__area">📍 ${(a.area || '').slice(0, 80)}</div>
          ${a.headline ? `<div class="nws-item__headline">${a.headline.slice(0, 120)}</div>` : ''}
          <div class="nws-item__btns">
            ${hasGeo ? `<button class="focus-btn" onclick="focusAlert('${a.id}')">📍 Focus Map</button>` : ''}
            <button class="tts-btn" onclick="ttsAlert('${JSON.stringify(a.event).slice(1,-1)}','${JSON.stringify(a.area || '').slice(1,-1)}')">🔊 Read Aloud</button>
            <button class="sound-tag-btn" onclick="sendSound('${sound}')">🎵 Sound</button>
          </div>
        </div>`;
    }).join('');
}

window.focusAlert = alertId => cmd('focus-polygon', { alertId });

window.ttsAlert = (event, area) => {
    const text = `${event} in effect for ${area || 'your area'}.`;
    const rate  = parseFloat($('tts-rate')?.value)   || 1;
    const pitch = parseFloat($('tts-pitch')?.value)  || 1;
    const vol   = parseFloat($('tts-volume')?.value) || 1;
    const voice = $('tts-voice')?.value || '';
    fetch('/api/stream/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Password': adminPw },
        body: JSON.stringify({ text, rate, pitch, volume: vol, voice }),
    }).then(() => log(`TTS: ${event}`, 'ok')).catch(e => log(`TTS err: ${e.message}`, 'err'));
};

// ── Connections ──────────────────────────────────────────────
async function refreshConnections() {
    try {
        const r = await fetch('/api/stream/connections');
        if (!r.ok) return;
        const d = await r.json();
        const sb = (id, v) => { const e = $(id); if (e) e.textContent = v; };
        sb('sb-displays',   d.display   ?? '—');
        sb('sb-dashboards', d.dashboard ?? '—');
    } catch {}
}

// ── Activity log ──────────────────────────────────────────────
function log(msg, type = 'info') {
    const el = $('activity-log');
    if (!el) return;
    const now  = new Date().toLocaleTimeString('en-US', { hour12: false });
    const row  = document.createElement('div');
    row.className = 'log-entry';
    row.innerHTML = `<span class="log-time">${now}</span><span class="log-msg ${type}">${msg}</span>`;
    el.prepend(row);
    // Keep max 60 entries
    while (el.children.length > 60) el.removeChild(el.lastChild);
}

window.clearLog = () => { const el = $('activity-log'); if (el) el.innerHTML = ''; };

// ── Interactive Mini-Map (Dashboard Radar Preview) ────────────
let miniMap      = null;
let miniMoving   = false; // prevent feedback loop
let miniSendTimer = null;

function initMiniMap() {
    const el = $('dash-minimap');
    if (!el || miniMap) return;

    miniMap = L.map('dash-minimap', {
        center: [mapLat, mapLon],
        zoom:   mapZoom,
        zoomControl: true,
        attributionControl: false,
    });

    // Dark base tile layer matching the display
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 13,
        subdomains: 'abcd',
    }).addTo(miniMap);

    // When mini-map moves, debounce-send to display
    miniMap.on('moveend zoomend', () => {
        if (miniMoving) return;
        const c = miniMap.getCenter();
        const z = miniMap.getZoom();
        mapLat = c.lat; mapLon = c.lng; mapZoom = z;
        updateCoordsDisplay();
        // Debounce rapid pans
        if (miniSendTimer) clearTimeout(miniSendTimer);
        miniSendTimer = setTimeout(() => {
            cmd('set-radar', { lat: mapLat, lon: mapLon, zoom: mapZoom, region: 'custom' });
        }, 120);
        // Update coords label
        const lbl = $('minimap-coords');
        if (lbl) lbl.textContent = `${mapLat.toFixed(2)}°, ${mapLon.toFixed(2)}° | z${mapZoom}`;
    });

    // Also relay mouse-move position as a live preview hint
    miniMap.on('mousemove', e => {
        const lbl = $('minimap-coords');
        if (lbl) lbl.textContent = `Cursor: ${e.latlng.lat.toFixed(2)}°, ${e.latlng.lng.toFixed(2)}°`;
        if (dashWS && dashWS.readyState === 1) {
            dashWS.send(JSON.stringify({
                type: 'cursor-move',
                lat: e.latlng.lat,
                lon: e.latlng.lng,
                visible: true
            }));
        }
    });
    miniMap.on('mouseout', () => {
        if (dashWS && dashWS.readyState === 1) {
            dashWS.send(JSON.stringify({ type: 'cursor-move', visible: false }));
        }
    });
}

window.syncMiniMapFromDisplay = () => {
    if (!miniMap) return;
    miniMoving = true;
    miniMap.setView([mapLat, mapLon], mapZoom, { animate: true });
    setTimeout(() => { miniMoving = false; }, 600);
};

window.resetMiniMap = () => {
    mapLat = 39.95; mapLon = -75.16; mapZoom = 8; // Default to Philly
    if (miniMap) {
        miniMoving = true;
        miniMap.setView([mapLat, mapLon], mapZoom, { animate: true });
        setTimeout(() => { miniMoving = false; }, 600);
    }
    cmd('set-radar', { lat: mapLat, lon: mapLon, zoom: mapZoom, region: 'custom' });
    updateCoordsDisplay();
};

// ── SPC / Snow Overlay Relay ──────────────────────────────────
window.toggleSPCLayer = (on) => {
    cmd('toggle-overlay', { overlay: 'spc', visible: on });
    log(`SPC outlook: ${on ? 'ON' : 'OFF'}`, 'info');
};

window.toggleSnowLayer = (on) => {
    cmd('toggle-overlay', { overlay: 'snow', visible: on });
    log(`Snow outlook: ${on ? 'ON' : 'OFF'}`, 'info');
};

// ── Manual Radar Controls (Joystick) ─────────────────────────
function updateCoordsDisplay() {
    const el = $('map-coords');
    if (el) el.textContent = `${mapLat.toFixed(2)}°, ${mapLon.toFixed(2)}° | z${mapZoom}`;
    const zs = $('map-zoom');
    const zv = $('map-zoom-val');
    if (zs) zs.value = mapZoom;
    if (zv) zv.textContent = mapZoom;
}

function sendMapView() {
    const zoom = parseInt($('map-zoom')?.value) || mapZoom;
    mapZoom = zoom;
    cmd('set-radar', { lat: mapLat, lon: mapLon, zoom: mapZoom, region: 'custom' });
    updateCoordsDisplay();
    // Sync mini-map if it's open
    if (miniMap) {
        miniMoving = true;
        miniMap.setView([mapLat, mapLon], mapZoom);
        setTimeout(() => { miniMoving = false; }, 400);
    }
}

function doPan(dir) {
    const step = Math.max(0.3, PAN_STEP / Math.pow(2, mapZoom - 4));
    if (dir === 'n') mapLat = Math.min(72, mapLat + step);
    if (dir === 's') mapLat = Math.max(-72, mapLat - step);
    if (dir === 'e') mapLon = Math.min(180, mapLon + step);
    if (dir === 'w') mapLon = Math.max(-180, mapLon - step);
    sendMapView();
}

window.startPan = dir => {
    if (panInterval) clearInterval(panInterval);
    doPan(dir);
    panInterval = setInterval(() => doPan(dir), 200);
};

window.stopPan = () => {
    if (panInterval) { clearInterval(panInterval); panInterval = null; }
};

window.zoomIn = () => {
    mapZoom = Math.min(12, mapZoom + 1);
    sendMapView();
};

window.zoomOut = () => {
    mapZoom = Math.max(3, mapZoom - 1);
    sendMapView();
};

window.resetMapView = () => {
    mapLat = 38.0; mapLon = -96.0; mapZoom = 4;
    cmd('set-radar', { lat: mapLat, lon: mapLon, zoom: mapZoom, region: 'national' });
    updateCoordsDisplay();
    if (miniMap) {
        miniMoving = true;
        miniMap.setView([mapLat, mapLon], mapZoom);
        setTimeout(() => { miniMoving = false; }, 400);
    }
};

// Sync map position from display (via map-moved WS event)
window.syncMapPosition = (lat, lon, zoom) => {
    if (lat != null) mapLat = lat;
    if (lon != null) mapLon = lon;
    if (zoom != null) mapZoom = zoom;
    updateCoordsDisplay();
    log(`Map: ${mapLat.toFixed(2)}, ${mapLon.toFixed(2)} z${mapZoom}`, 'info');
    // Keep mini-map in sync without firing send-on-move
    if (miniMap) {
        miniMoving = true;
        miniMap.setView([mapLat, mapLon], mapZoom);
        setTimeout(() => { miniMoving = false; }, 400);
    }
};

// Initialize mini-map once app is shown (called from showApp)
const _origShowApp = window.showApp ?? (() => {});
window.showApp = function() {
    _origShowApp();
    setTimeout(initMiniMap, 400); // wait for DOM layout
};

