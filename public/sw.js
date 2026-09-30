/*
 * Service worker mínimo: guarda la app (HTML, JS, CSS, íconos) para que abra sin conexión en el
 * celular. Red primero y, si falla, lo guardado. La API (/api) y las fotos (/uploads) no se
 * guardan: los datos sin conexión los maneja la cola del parte diario (IndexedDB).
 * Solo corre en https o localhost (los navegadores no registran service workers en http).
 */
const CACHE = "infratrack-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add("/")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api") || url.pathname.startsWith("/uploads")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "/" : req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req.mode === "navigate" ? "/" : req).then((r) => r || Response.error()))
  );
});
