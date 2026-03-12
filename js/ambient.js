/* ════════════════════════════════════════════════════════════════
   ambient.js – Dynamic ambient soundscapes
   Plays a looping CC0 ambient audio track that matches current
   weather conditions (rain, storm, wind), simultaneously with
   background music. Both are ducked during TTS alert playback.
   ════════════════════════════════════════════════════════════════ */

const AmbientPlayer = (() => {

    // ── WMO weather code categories ───────────────────────────────
    // Source: Open-Meteo WMO interpretation codes
    const STORM_CODES = new Set([65, 82, 95, 96, 99]);         // heavy rain, heavy showers, thunderstorms
    const RAIN_MOD_CODES = new Set([53, 55, 63, 66, 67, 81]);  // moderate drizzle/rain/showers/freezing rain
    const RAIN_LIGHT_CODES = new Set([51, 61, 77, 80]);        // light drizzle, light rain, snow grains, light showers

    // Wind threshold: calibrated for mph. When the unit system is km/h, this value is still
    // used directly — 25 km/h (≈16 mph) is "breezy" but acceptable for ambient purposes.
    const WIND_THRESHOLD = 25;

    // ── Audio tracks (keyed by scenario) ─────────────────────────
    const TRACKS = {
        'storm-heavy':  'assets/ambient/storm-heavy.wav',
        'rain-moderate':'assets/ambient/rain-moderate.wav',
        'rain-light':   'assets/ambient/rain-light.wav',
        'wind':         'assets/ambient/wind.wav',
    };

    // ── State ─────────────────────────────────────────────────────
    let enabled = true;
    let volume = 0.35;         // default ambient volume (independent of music volume)
    let normalVolume = 0.35;
    let isDucked = false;
    let currentKey = null;     // which track is active (or null)
    let activeFadeTimers = []; // tracks in-progress fade timers so they can be cancelled

    const audios = {};         // HTMLAudioElement pool, keyed by track key

    // ── Lazily create / retrieve an audio element ─────────────────
    function getAudio(key) {
        if (!audios[key]) {
            const el = new Audio(TRACKS[key]);
            el.loop = true;
            el.volume = 0;
            el.preload = 'none';
            audios[key] = el;
        }
        return audios[key];
    }

    // ── Smooth volume transition ──────────────────────────────────
    function smoothVolume(el, from, to, ms, onDone) {
        const steps = 20;
        const stepMs = ms / steps;
        const delta = (to - from) / steps;
        let step = 0;
        const timer = setInterval(() => {
            step++;
            el.volume = Math.max(0, Math.min(1, el.volume + delta));
            if (step >= steps) {
                clearInterval(timer);
                el.volume = Math.max(0, Math.min(1, to));
                activeFadeTimers = activeFadeTimers.filter(t => t !== timer);
                onDone?.();
            }
        }, stepMs);
        activeFadeTimers.push(timer);
        return timer;
    }

    // ── Determine which scenario to play ─────────────────────────
    function categorize(weatherCode, windRaw) {
        if (STORM_CODES.has(weatherCode))    return 'storm-heavy';
        if (RAIN_MOD_CODES.has(weatherCode)) return 'rain-moderate';
        if (RAIN_LIGHT_CODES.has(weatherCode)) return 'rain-light';
        if (windRaw != null && windRaw >= WIND_THRESHOLD) return 'wind';
        return null;
    }

    // ── Cross-fade: fade out old track, fade in new one ───────────
    function crossFade(newKey) {
        if (newKey === currentKey) return;

        const outKey = currentKey;
        currentKey = newKey;

        // Fade out the old track (if any)
        if (outKey) {
            const outEl = audios[outKey];
            if (outEl && !outEl.paused) {
                smoothVolume(outEl, outEl.volume, 0, 1200, () => {
                    outEl.pause();
                    outEl.currentTime = 0;
                });
            }
        }

        // Fade in the new track (if any)
        if (newKey) {
            const inEl = getAudio(newKey);
            const targetVol = isDucked ? normalVolume * 0.15 : normalVolume;
            inEl.volume = 0;
            inEl.play().then(() => {
                smoothVolume(inEl, 0, targetVol, 1200);
            }).catch(err => {
                // Autoplay blocked — volume is set; playback will start on next user interaction
                inEl.volume = targetVol;
                console.warn('🌧 Ambient autoplay blocked:', err.name);
            });
        }
    }

    // ── Public: update based on current weather conditions ────────
    function update(conditions) {
        if (!enabled) return;
        if (!conditions) { crossFade(null); return; }
        const key = categorize(conditions.rawCode, conditions.windRaw);
        crossFade(key);
    }

    // ── Duck for TTS (mirrors MusicPlayer.duck) ───────────────────
    function duck() {
        if (isDucked) return;
        isDucked = true;
        if (currentKey && audios[currentKey] && !audios[currentKey].paused) {
            const el = audios[currentKey];
            smoothVolume(el, el.volume, el.volume * 0.15, 600);
        }
    }

    function unduck() {
        if (!isDucked) return;
        isDucked = false;
        if (currentKey && audios[currentKey] && !audios[currentKey].paused) {
            const el = audios[currentKey];
            smoothVolume(el, el.volume, normalVolume, 1000);
        }
    }

    // ── Volume control ────────────────────────────────────────────
    function setVolume(val) {
        volume = val;
        normalVolume = val;
        if (currentKey && audios[currentKey] && !isDucked) {
            audios[currentKey].volume = val;
        }
    }

    // ── Enable / disable ──────────────────────────────────────────
    function setEnabled(val) {
        enabled = val;
        if (!val) {
            crossFade(null);
        }
    }

    // ── Stop all ambient audio (e.g., on disable) ─────────────────
    function stop() {
        activeFadeTimers.forEach(t => clearInterval(t));
        activeFadeTimers = [];
        Object.values(audios).forEach(el => {
            el.pause();
            el.currentTime = 0;
            el.volume = 0;
        });
        currentKey = null;
    }

    return { update, duck, unduck, setVolume, setEnabled, stop };
})();
