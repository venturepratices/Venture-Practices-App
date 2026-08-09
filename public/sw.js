// Minimal service worker: enables "Add to Home Screen" install on iOS/Android
// and a bare offline fallback. Deliberately does NOT cache API responses or
// authenticated pages — this is a PM/CRM tool, so serving stale task/asset
// data while "offline" would be worse than a normal network error.
const OFFLINE_CACHE = "venture-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.open(OFFLINE_CACHE).then((cache) => cache.match(OFFLINE_URL))
    )
  );
});
