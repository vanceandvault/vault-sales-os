// Minimal service worker: caches ONLY static, non-private assets. Authenticated pages and API responses are never cached.
const CACHE = "vault-static-v1";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/offline.html", "/icons/icon-192.png"]))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request; if (r.method !== "GET") return; const u = new URL(r.url);
  if (u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  if (u.pathname.startsWith("/_next/static/") || u.pathname.startsWith("/icons/")) {
    e.respondWith(caches.match(r).then((hit) => hit || fetch(r).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); return res; })));
  } else if (r.mode === "navigate") {
    e.respondWith(fetch(r).catch(() => caches.match("/offline.html")));
  }
});
