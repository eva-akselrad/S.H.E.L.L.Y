/* ════════════════════════════════════════════════════════════════
   pwa.js – S.H.E.L.L.Y. PWA Install + Push Subscription
   • Registers service worker
   • Manages install prompt for all browsers
   • Handles push subscription lifecycle
   • Prompts for push permission on PWA startup
   • Supports daily weather summary notifications
   ════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    let swRegistration = null;
    let deferredInstallPrompt = null;
    let guideShown = false;
    const PUSH_KEY_URL = '/api/push/vapid-key';
    const PUSH_SUB_URL = '/api/push/subscribe';
    const PUSH_PREFS_URL = '/api/push/prefs';

    // ── LocalStorage keys ────────────────────────────────────────
    const LS_PUSH_DECLINED = 'shelly-push-declined';
    const LS_NOTIF_PREFS   = 'shelly-notif-prefs';

    // ── Cookie helpers (install prompt throttle) ─────────────────
    const PROMPT_COOKIE = 'pwa-prompt-dismissed';
    const PROMPT_COOKIE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

    function setPromptCookie() {
        const expires = new Date(Date.now() + PROMPT_COOKIE_DURATION_MS).toUTCString();
        const secureAttr = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `${PROMPT_COOKIE}=1; expires=${expires}; path=/; SameSite=Lax${secureAttr}`;
    }

    function hasPromptCookie() {
        return document.cookie.split(';').some(c => c.trim().startsWith(`${PROMPT_COOKIE}=`));
    }

    // ── 1. Register Service Worker ──────────────────────────────
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => {
                    swRegistration = reg;
                    console.log('[PWA] Service Worker registered:', reg.scope);
                    initPush(reg);
                    // Show startup push prompt after a short delay (let app settle first)
                    if (isStandalone) {
                        setTimeout(() => maybeShowPushStartupPrompt(reg), 2500);
                    }
                })
                .catch(err => console.warn('[PWA] SW registration failed:', err));
        });
    }

    // ── 2. Install Prompt ────────────────────────────────────────

    // Already running as standalone? Hide all install UI.
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;

    if (!isStandalone) {
        // Chromium: capture the prompt (skip if already dismissed today)
        window.addEventListener('beforeinstallprompt', e => {
            e.preventDefault();
            deferredInstallPrompt = e;
            if (!hasPromptCookie()) showInstallBanner();
        });

        // If no prompt fires after 3 s, show a manual guide (skip if dismissed today)
        window.addEventListener('load', () => {
            setTimeout(() => {
                if (!deferredInstallPrompt && !guideShown && !hasPromptCookie()) {
                    showBrowserGuide();
                }
            }, 3000);
        });
    }

    function showInstallBanner() {
        if (document.body.classList.contains('kiosk-mode')) return;
        const banner = getOrCreateBanner();
        banner.classList.remove('pwa-hidden');
    }

    function hideBanner() {
        const banner = document.getElementById('pwa-install-banner');
        if (banner) banner.classList.add('pwa-hidden');
    }

    function getOrCreateBanner() {
        let banner = document.getElementById('pwa-install-banner');
        if (banner) return banner;

        banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.className = 'pwa-install-banner pwa-hidden';
        banner.innerHTML = `
            <span class="pwa-banner-icon">📲</span>
            <div class="pwa-banner-text">
                <strong>Install S.H.E.L.L.Y.</strong>
                <small>Add to home screen for the best experience</small>
            </div>
            <button id="pwa-install-btn" class="pwa-banner-btn">Install</button>
            <button id="pwa-dismiss-btn" class="pwa-banner-dismiss">✕</button>
        `;
        document.body.appendChild(banner);

        document.getElementById('pwa-install-btn').addEventListener('click', async () => {
            if (!deferredInstallPrompt) return;
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            console.log('[PWA] Install outcome:', outcome);
            deferredInstallPrompt = null;
            setPromptCookie();
            hideBanner();
        });

        document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
            setPromptCookie();
            hideBanner();
        });

        return banner;
    }

    // ── 3. Browser-specific manual guide ────────────────────────
    const UA = navigator.userAgent;
    const isIOS = /iP(hone|ad|od)/.test(UA);
    const isMacSafari = /Macintosh.*Safari/.test(UA) && !/Chrome/.test(UA);
    const isFirefox = /Firefox/.test(UA);
    const isSamsung = /SamsungBrowser/.test(UA);
    const isBrave = navigator.brave != null;

    function showBrowserGuide() {
        if (guideShown || isStandalone) return;
        if (document.body.classList.contains('kiosk-mode')) return;
        guideShown = true;

        let instructions = '';
        if (isIOS) {
            instructions = `<p>Tap the <strong>Share</strong> button <span style="font-size:1.3em">⎋</span> in Safari's toolbar, then choose <strong>"Add to Home Screen"</strong>.</p>`;
        } else if (isMacSafari) {
            instructions = `<p>In the menu bar, click <strong>File → Add to Dock…</strong> to install S.H.E.L.L.Y.</p>`;
        } else if (isFirefox) {
            instructions = `<p>Click the <strong>address bar menu (⋯)</strong> and select <strong>"Install"</strong> or <strong>"Add to Home Screen"</strong>.</p>`;
        } else if (isSamsung) {
            instructions = `<p>Tap the <strong>⋮ menu</strong> in Samsung Internet and choose <strong>"Add page to" → "Home screen"</strong>.</p>`;
        } else if (isBrave) {
            instructions = `<p>If Brave Shields are blocking the prompt, tap <strong>⋮ → Install app</strong> from the browser menu.</p>`;
        } else {
            return; // Desktop chrome/edge etc will auto-prompt; no guide needed
        }

        const modal = document.createElement('div');
        modal.id = 'pwa-guide-modal';
        modal.className = 'pwa-guide-modal';
        modal.innerHTML = `
            <div class="pwa-guide-inner">
                <div class="pwa-guide-header">
                    <span class="pwa-guide-icon">📲</span>
                    <span class="pwa-guide-title">Install S.H.E.L.L.Y.</span>
                    <button id="pwa-guide-close" class="pwa-guide-close">✕</button>
                </div>
                <div class="pwa-guide-body">${instructions}</div>
                <button id="pwa-guide-ok" class="pwa-guide-ok">Got it</button>
            </div>
        `;
        document.body.appendChild(modal);

        const close = () => { setPromptCookie(); modal.remove(); };
        document.getElementById('pwa-guide-close').addEventListener('click', close);
        document.getElementById('pwa-guide-ok').addEventListener('click', close);

        // Auto-dismiss after 12 s
        setTimeout(close, 12000);
    }

    // ── 4. Push Notifications ─────────────────────────────────────

    async function initPush(reg) {
        // Expose to push toggle in settings
        window.PWA = window.PWA || {};
        window.PWA.subscribeToNotifications = () => requestPushPermission(reg);
        window.PWA.unsubscribeFromNotifications = () => unsubscribePush(reg);
        window.PWA.getPushState = () => getPushState(reg);
        window.PWA.updateNotifPrefs = (prefs) => updateNotifPrefs(reg, prefs);
        window.PWA.getNotifPrefs = getNotifPrefs;
        // Called by app.js after each location fetch to keep push prefs in sync
        window.PWA.onLocationChanged = async (loc) => {
            const sub = await reg.pushManager.getSubscription().catch(() => null);
            if (!sub || !loc?.lat) return;
            const prefs = getNotifPrefs();
            // Only sync to server if location actually changed
            if (prefs.lat === loc.lat && prefs.lon === loc.lon) return;
            updateNotifPrefs(reg, { lat: loc.lat, lon: loc.lon, locationName: loc.label || '' });
        };

        // Restore previous state badge
        const state = await getPushState(reg);
        updatePushUI(state);

        // Sync saved notification preferences to settings UI
        syncNotifPrefsUI();
    }

    async function getPushState(reg) {
        if (!('PushManager' in window)) return 'unsupported';
        const perm = Notification.permission;
        if (perm === 'denied') return 'denied';
        if (perm === 'default') return 'prompt';
        // Granted — check if actually subscribed
        const sub = await reg.pushManager.getSubscription();
        return sub ? 'subscribed' : 'granted-not-subscribed';
    }

    async function requestPushPermission(reg) {
        if (!('PushManager' in window)) {
            alert('Push notifications are not supported in this browser.');
            return;
        }
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            updatePushUI('denied');
            return;
        }
        await subscribePush(reg);
    }

    async function subscribePush(reg) {
        try {
            // Get server's VAPID public key
            const keyRes = await fetch(PUSH_KEY_URL);
            if (!keyRes.ok) throw new Error(`VAPID key fetch failed: ${keyRes.status}`);
            const { publicKey } = await keyRes.json();

            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });

            // Serialize explicitly via toJSON so all fields (endpoint, keys) are included
            const subJSON = sub.toJSON();

            // Include notification preferences and location in subscription
            const notifPrefs = getNotifPrefs();
            const loc = typeof WeatherAPI !== 'undefined' ? WeatherAPI.getLocation() : null;
            if (loc?.lat != null) {
                notifPrefs.lat = loc.lat;
                notifPrefs.lon = loc.lon;
                notifPrefs.locationName = loc.label || '';
            }
            notifPrefs.tzOffsetMinutes = -new Date().getTimezoneOffset(); // minutes ahead of UTC (negative for west)

            const payload = { ...subJSON, notifPrefs };

            // Send subscription to server
            const saveRes = await fetch(PUSH_SUB_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!saveRes.ok) {
                const errData = await saveRes.json().catch(() => ({}));
                throw new Error(`Server rejected subscription: ${errData.error || saveRes.status}`);
            }

            console.log('[PWA] Push subscribed:', sub.endpoint);
            updatePushUI('subscribed');
        } catch (err) {
            console.error('[PWA] Push subscription failed:', err);
            updatePushUI('error');
        }
    }

    async function unsubscribePush(reg) {
        try {
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                await fetch(PUSH_SUB_URL, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: sub.endpoint })
                });
                await sub.unsubscribe();
            }
            updatePushUI('prompt');
        } catch (err) {
            console.error('[PWA] Unsubscribe failed:', err);
        }
    }

    // ── Notification preferences ─────────────────────────────────

    function getNotifPrefs() {
        try {
            return JSON.parse(localStorage.getItem(LS_NOTIF_PREFS) || '{}');
        } catch { return {}; }
    }

    function saveNotifPrefs(prefs) {
        try { localStorage.setItem(LS_NOTIF_PREFS, JSON.stringify(prefs)); } catch { }
    }

    async function updateNotifPrefs(reg, prefs) {
        // Merge with existing prefs
        const current = getNotifPrefs();
        const merged = { ...current, ...prefs };

        // Always include current location
        const loc = typeof WeatherAPI !== 'undefined' ? WeatherAPI.getLocation() : null;
        if (loc?.lat != null) {
            merged.lat = loc.lat;
            merged.lon = loc.lon;
            merged.locationName = loc.label || '';
        }
        merged.tzOffsetMinutes = -new Date().getTimezoneOffset();

        saveNotifPrefs(merged);

        // Sync to server if subscribed
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
            try {
                await fetch(PUSH_PREFS_URL, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: sub.endpoint, notifPrefs: merged })
                });
            } catch (err) {
                console.warn('[PWA] Failed to sync prefs to server:', err.message);
            }
        }
    }

    function syncNotifPrefsUI() {
        const prefs = getNotifPrefs();

        const alertsToggle = document.getElementById('notif-alerts-toggle');
        const dailyToggle = document.getElementById('notif-daily-toggle');
        const dailyTimeInput = document.getElementById('notif-daily-time');
        const dailyTimeRow = document.getElementById('notif-daily-time-row');

        if (alertsToggle) alertsToggle.checked = prefs.weatherAlerts !== false; // default on
        if (dailyToggle) {
            dailyToggle.checked = !!prefs.dailySummary;
            if (dailyTimeRow) dailyTimeRow.style.display = prefs.dailySummary ? '' : 'none';
        }
        if (dailyTimeInput) {
            const hour = prefs.dailyHour ?? 8;
            dailyTimeInput.value = String(hour).padStart(2, '0') + ':00';
        }
    }

    function updatePushUI(state) {
        const btn = document.getElementById('push-subscribe-btn');
        const status = document.getElementById('push-status-text');
        if (!btn || !status) return;

        const states = {
            unsupported: { label: '🔕 Not Supported', text: 'Push not available in this browser', disabled: true },
            denied: { label: '🚫 Blocked', text: 'Notifications blocked — enable in browser settings', disabled: true },
            prompt: { label: '🔔 Enable Notifications', text: 'Tap to subscribe to push alerts', disabled: false },
            'granted-not-subscribed': { label: '🔔 Enable Notifications', text: 'Tap to subscribe to push alerts', disabled: false },
            subscribed: { label: '🔕 Disable Notifications', text: '✓ Subscribed to push alerts', disabled: false },
            error: { label: '⚠ Retry', text: 'Subscription failed — try again', disabled: false },
        };
        const s = states[state] || states.prompt;
        btn.textContent = s.label;
        btn.disabled = s.disabled;
        status.textContent = s.text;

        // Show/hide notification options based on subscription state
        const optsSection = document.getElementById('notif-options-section');
        if (optsSection) {
            optsSection.style.display = state === 'subscribed' ? '' : 'none';
        }

        // Store state for the button's click handler
        btn.dataset.pushState = state;
    }

    // ── 4b. Startup push prompt (PWA only) ───────────────────────

    async function maybeShowPushStartupPrompt(reg) {
        // Don't prompt in kiosk mode
        if (document.body.classList.contains('kiosk-mode')) return;
        // Only if push is supported
        if (!('PushManager' in window) || !('Notification' in window)) return;
        // Only if permission not yet granted or denied
        if (Notification.permission !== 'default') return;
        // Don't prompt if user already declined via our UI
        if (localStorage.getItem(LS_PUSH_DECLINED) === '1') return;

        showPushPermissionModal(reg);
    }

    function showPushPermissionModal(reg) {
        if (document.getElementById('push-permission-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'push-permission-modal';
        modal.className = 'pwa-guide-modal';
        modal.innerHTML = `
            <div class="pwa-guide-inner">
                <div class="pwa-guide-header">
                    <span class="pwa-guide-icon">🔔</span>
                    <span class="pwa-guide-title">Enable Notifications?</span>
                    <button id="push-modal-close" class="pwa-guide-close">✕</button>
                </div>
                <div class="pwa-guide-body">
                    <p>S.H.E.L.L.Y. can send you push notifications for:</p>
                    <ul style="margin:8px 0 12px 18px;line-height:1.8">
                        <li>⚠️ Admin alerts &amp; weather warnings</li>
                        <li>🌤 Optional daily weather summaries</li>
                    </ul>
                    <p style="font-size:0.82rem;color:var(--text-secondary)">You can manage notification preferences in <strong>Settings → Push Notifications</strong>.</p>
                </div>
                <div style="display:flex;gap:10px">
                    <button id="push-modal-allow" class="pwa-guide-ok" style="flex:2">🔔 Enable Notifications</button>
                    <button id="push-modal-deny" class="pwa-guide-ok" style="flex:1;background:var(--bg-tertiary);color:var(--text-secondary)">No thanks</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const close = () => modal.remove();

        document.getElementById('push-modal-close').addEventListener('click', () => {
            close();
            // User dismissed without deciding — don't store, so we ask next time
        });

        document.getElementById('push-modal-allow').addEventListener('click', async () => {
            close();
            await requestPushPermission(reg);
        });

        document.getElementById('push-modal-deny').addEventListener('click', () => {
            localStorage.setItem(LS_PUSH_DECLINED, '1');
            close();
            showDeclinedTip();
        });
    }

    function showDeclinedTip() {
        const tip = document.createElement('div');
        tip.className = 'pwa-install-banner';
        tip.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);max-width:420px;z-index:2100;';
        tip.innerHTML = `
            <span class="pwa-banner-icon" style="font-size:1rem">🔕</span>
            <div class="pwa-banner-text">
                <strong>Notifications off</strong>
                <small>Re-enable anytime in <strong>Settings → Push Notifications</strong></small>
            </div>
            <button id="push-tip-dismiss" class="pwa-banner-dismiss">✕</button>
        `;
        document.body.appendChild(tip);

        const remove = () => tip.remove();
        document.getElementById('push-tip-dismiss').addEventListener('click', remove);
        setTimeout(remove, 7000);
    }

    // ── 5. Wire push button and notif option controls ─────────────
    window.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('push-subscribe-btn');
        if (btn) {
            btn.addEventListener('click', async () => {
                const state = btn.dataset.pushState;
                if (!swRegistration) return;
                if (state === 'subscribed') {
                    await unsubscribePush(swRegistration);
                } else {
                    await requestPushPermission(swRegistration);
                }
            });
        }

        // Weather alerts toggle
        const alertsToggle = document.getElementById('notif-alerts-toggle');
        if (alertsToggle) {
            alertsToggle.addEventListener('change', () => {
                if (!swRegistration) return;
                updateNotifPrefs(swRegistration, { weatherAlerts: alertsToggle.checked });
            });
        }

        // Daily summary toggle
        const dailyToggle = document.getElementById('notif-daily-toggle');
        const dailyTimeRow = document.getElementById('notif-daily-time-row');
        if (dailyToggle) {
            dailyToggle.addEventListener('change', () => {
                if (!swRegistration) return;
                if (dailyTimeRow) dailyTimeRow.style.display = dailyToggle.checked ? '' : 'none';
                const prefs = getNotifPrefs();
                const hour = prefs.dailyHour ?? 8;
                updateNotifPrefs(swRegistration, { dailySummary: dailyToggle.checked, dailyHour: hour });
            });
        }

        // Daily time picker
        const dailyTimeInput = document.getElementById('notif-daily-time');
        if (dailyTimeInput) {
            dailyTimeInput.addEventListener('change', () => {
                if (!swRegistration) return;
                const [hourStr] = dailyTimeInput.value.split(':');
                const hour = parseInt(hourStr, 10);
                if (!isNaN(hour)) updateNotifPrefs(swRegistration, { dailyHour: hour });
            });
        }
    });

    // ── Utility ──────────────────────────────────────────────────
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
    }
})();
