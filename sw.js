/* ════════════════════════════════════════════════════════════════
   sw.js – S.H.E.L.L.Y. Service Worker
   • Caches app shell for offline use
   • Network-first for external APIs (caches last successful response)
   • Cache-first for static assets
   • Handles Web Push notifications
   ════════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'shelly-v1.4.2';
