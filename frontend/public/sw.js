// Minimal service worker: enables "install to home screen" and caches the app
// shell for fast loads. API calls are always network-only (never cached) so the
// panel never shows stale backup data.
const CACHE = "repoark-shell-v1";
const SHELL = ["/", "/icon.svg", "/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return; // never cache the API
  // Network-first for navigations (fresh index.html), cache fallback offline.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/")));
    return;
  }
  // Cache-first for static assets.
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
