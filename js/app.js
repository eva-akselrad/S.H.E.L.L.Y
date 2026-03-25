/* ════════════════════════════════════════════════════════════════
   app.js – Main application controller
   Ties together: WeatherAPI, Displays, MusicPlayer, AlertsManager, Settings
   ════════════════════════════════════════════════════════════════ */

(() => {
    'use strict';

    // ── State ──────────────────────────────────────────────────────
    let slideIds = [];
    let currentSlide = 0;
    let cycleTimer = null;
    let progressTimer = null;
    let isPaused = false;
    let slideInterval = 12000;
    let progressStart = 0;
    let progressDuration = 0;
    let locationSet = false;
    let scrollRaf = null; // requestAnimationFrame handle for autoscroll

    const DEFAULT_LOCATION = 'New York, NY';

    // ── DOM refs ───────────────────────────────────────────────────
    const locationDisplay = document.getElementById('location-display');
    const locationInput = document.getElementById('location-input');
    const locationGo = document.getElementById('location-go');
    const locationGPS = document.getElementById('location-gps');
    const locationStatus = document.getElementById('location-status');
    const clockTime = document.getElementById('clock-time');
    const clockDate = document.getElementById('clock-date');
    const navPrev = document.getElementById('nav-prev');
    const navNext = document.getElementById('nav-next');
    const navPause = document.getElementById('nav-pause');
    const navRefresh = document.getElementById('nav-refresh');
    const loadingSlide = document.getElementById('slide-loading');
    const progressFill = document.getElementById('slide-progress');
    const dotsContainer = document.getElementById('slide-dots');

    // ── Clock ──────────────────────────────────────────────────────
    function startClock() {
        function tick() {
            const now = new Date();
            const h = now.getHours();
            const m = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = ((h % 12) || 12);
            if (clockTime) clockTime.textContent = `${h12}:${m}:${s} ${ampm}`;
            const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
            const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
            if (clockDate) clockDate.textContent = `${days[now.getDay()]} ${months[now.getMonth()]} ${now.getDate()}`;
        }
        tick();
        setInterval(tick, 1000);
    }

    // ── Build slide list from active displays ──────────────────────
    function buildSlideList() {
        const active = Settings.getActiveDisplays();
        const allSlides = [
            { id: 'slide-conditions', display: 'conditions', label: 'CONDITIONS' },
            { id: 'slide-observations', display: 'observations', label: 'OBSERVATIONS' },
            { id: 'slide-hourly', display: 'hourly', label: 'HOURLY' },
            { id: 'slide-extended', display: 'extended', label: 'EXTENDED' },
            { id: 'slide-precipchart', display: 'precipchart', label: 'PRECIPITATION' },
            { id: 'slide-almanac', display: 'almanac', label: 'ALMANAC' },
            { id: 'slide-climate', display: 'climate', label: 'ON THIS DAY' },
            { id: 'slide-airquality', display: 'airquality', label: 'AIR QUALITY' },
            { id: 'slide-pollen', display: 'pollen', label: 'POLLEN' },
            { id: 'slide-travel', display: 'travel', label: 'TRAVEL FORECAST' },
            { id: 'slide-regional-obs', display: 'regionalobs', label: 'REGIONAL OBSERVATIONS' },
            { id: 'slide-regional-fcst', display: 'regionalfcst', label: 'REGIONAL FORECAST' },
            { id: 'slide-spc', display: 'spc', label: 'SPC OUTLOOK' },
            { id: 'slide-radar', display: 'radar', label: 'RADAR' },
            { id: 'slide-alerts', display: 'alerts', label: 'ALERTS' },
            { id: 'slide-customforecast', display: 'customforecast', label: 'CUSTOM FORECAST' },
        ];

        slideIds = allSlides.filter(s => active.includes(s.display));
        buildDots();
    }

    // ── Navigation dots ────────────────────────────────────────────
    function buildDots() {
        if (!dotsContainer) return;
        dotsContainer.innerHTML = '';
        slideIds.forEach((s, i) => {
            const dot = document.createElement('div');
            dot.className = 'slide-dot' + (i === currentSlide ? ' active' : '');
            dot.addEventListener('click', () => goToSlide(i));
            dotsContainer.appendChild(dot);
        });
    }

    function updateDots() {
        dotsContainer?.querySelectorAll('.slide-dot').forEach((d, i) => {
            d.classList.toggle('active', i === currentSlide);
        });
    }

    // ── Auto-scroll ────────────────────────────────────────────────
    // Each slide that can overflow declares a primary scrollable container.
    // When a slide becomes active its container is smoothly scrolled so all
    // content is shown without user interaction.  The scroll resets to the
    // top/left when the slide is swapped out.
    const SCROLL_MAP = {
        'slide-hourly':       { id: 'hourly-container',  dir: 'x' },
        'slide-extended':     { id: 'extended-container', dir: 'y' },
        'slide-observations': { id: 'obs-grid',           dir: 'y' },
        'slide-alerts':       { id: 'alerts-container',   dir: 'y' },
        // travel, regional-obs, regional-fcst, spc all use fixed or map layouts
        // that manage their own sizing — no autoscroll needed
    };

    /** Stop any running autoscroll animation and reset the previous container. */
    function stopAutoScroll() {
        if (scrollRaf !== null) {
            cancelAnimationFrame(scrollRaf);
            scrollRaf = null;
        }
    }

    /**
     * Start a smooth autoscroll for the given slide element.
     * - 2 s initial pause so the viewer sees the beginning of the content.
     * - Scrolls at 40 px/s.
     * - At the end: 1.5 s pause, then jumps back to start and repeats.
     * - Skips silently if the container has no overflow.
     * - Pauses on mouse-enter, resumes on mouse-leave (kiosk-friendly).
     */
    function startAutoScroll(slideEl) {
        stopAutoScroll();
        if (!slideEl) return;

        const entry = SCROLL_MAP[slideEl.id];
        if (!entry) return;

        const container = document.getElementById(entry.id);
        if (!container) return;

        const isX = entry.dir === 'x';
        const PX_PER_S = 40;
        const INITIAL_DELAY_MS = 2000;
        const END_PAUSE_MS = 1500;

        // Reset position immediately when slide activates
        container.scrollLeft = 0;
        container.scrollTop = 0;

        let paused = false;
        let delayRemaining = INITIAL_DELAY_MS;
        let lastTs = null;
        let waitingAtEnd = false;

        function animate(ts) {
            if (paused) { scrollRaf = requestAnimationFrame(animate); return; }
            if (!lastTs) lastTs = ts;
            const dt = ts - lastTs;
            lastTs = ts;

            if (delayRemaining > 0) {
                delayRemaining -= dt;
                scrollRaf = requestAnimationFrame(animate);
                return;
            }

            if (waitingAtEnd) {
                scrollRaf = requestAnimationFrame(animate);
                return;
            }

            const px = (PX_PER_S * dt) / 1000;
            if (isX) {
                const maxScroll = container.scrollWidth - container.clientWidth;
                if (maxScroll <= 2) return; // nothing to scroll
                container.scrollLeft = Math.min(container.scrollLeft + px, maxScroll);
                if (container.scrollLeft >= maxScroll - 1) {
                    waitingAtEnd = true;
                    setTimeout(() => {
                        container.scrollLeft = 0;
                        delayRemaining = 800;
                        lastTs = null;
                        waitingAtEnd = false;
                    }, END_PAUSE_MS);
                }
            } else {
                const maxScroll = container.scrollHeight - container.clientHeight;
                if (maxScroll <= 2) return; // nothing to scroll
                container.scrollTop = Math.min(container.scrollTop + px, maxScroll);
                if (container.scrollTop >= maxScroll - 1) {
                    waitingAtEnd = true;
                    setTimeout(() => {
                        container.scrollTop = 0;
                        delayRemaining = 800;
                        lastTs = null;
                        waitingAtEnd = false;
                    }, END_PAUSE_MS);
                }
            }

            scrollRaf = requestAnimationFrame(animate);
        }

        // Pause on hover so users can read without the content sliding away
        container.addEventListener('mouseenter', () => { paused = true; }, { passive: true });
        container.addEventListener('mouseleave', () => { paused = false; lastTs = null; }, { passive: true });

        scrollRaf = requestAnimationFrame(animate);
    }

    // ── Slide transitions ──────────────────────────────────────────
    function showSlide(idx) {
        // Stop any running autoscroll before transitioning
        stopAutoScroll();

        // Hide all visible slides
        document.querySelectorAll('.slide.active').forEach(s => {
            s.classList.add('slide-exit');
            s.classList.remove('active');
            setTimeout(() => s.classList.remove('slide-exit'), 600);
        });

        const target = slideIds[idx];
        if (!target) return;
        const el = document.getElementById(target.id);
        if (!el) return;
        el.classList.remove('hidden', 'slide-exit');
        setTimeout(() => {
            el.classList.add('active');
            // Begin autoscroll once the slide has finished its enter animation
            startAutoScroll(el);
        }, 20);

        currentSlide = idx;
        updateDots();

        // Update ticker label
        Displays.updateTicker(WeatherAPI.getData(), target.label);

        // Update location display
        if (locationDisplay) locationDisplay.textContent = WeatherAPI.getLocation().label || 'Unknown';

        // Alerts slide behavior – skip via timeout to avoid re-entering showSlide mid-flight
        if (target.display === 'alerts') {
            const alerts = WeatherAPI.getAlerts();
            if (!alerts.length) {
                setTimeout(() => goToSlide((idx + 1) % slideIds.length), 50);
                return;
            }
        }

        // Custom Forecast slide – skip if no periods or viewer's location doesn't match targeting
        if (target.display === 'customforecast') {
            const forecasts = WeatherAPI.getData()?.customForecasts || [];
            const matching = forecasts.filter(cf => cf?.periods?.length && isInForecastArea(cf.targeting));
            if (!matching.length) {
