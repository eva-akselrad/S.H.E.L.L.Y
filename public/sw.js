// SHELLY service worker: app-shell cache so the display survives a network drop.
// API data is kept as last-good in localStorage by the app, not here.
const VERSION = "shelly-v2-2";

// ── push alerts (sent by the Worker only when a warning's area covers this device's place) ──
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: "SHELLY", body: event.data ? event.data.text() : "" };
  }
  const severe = d.level === "WARNING" || d.level === "EMERGENCY";
  event.waitUntil(
    self.registration.showNotification(d.title || "SHELLY weather alert", {
      body: d.body || "",
      tag: d.tag || "shelly",
      renotify: true,
      requireInteraction: severe,
      icon: "/favicon.png",
      badge: "/favicon.png",
      vibrate: d.level === "EMERGENCY" ? [500, 200, 500, 200, 500, 200, 500] : severe ? [300, 150, 300, 150, 300] : [200],
      data: { url: d.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === location.origin);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/music/") || url.pathname.startsWith("/admin")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          void caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit ?? caches.match("/"))),
  );
});
