/*
 * Service worker mínimo: guarda la app (HTML, JS, CSS, íconos) para que abra sin conexión en el
 * celular. Red primero y, si falla, lo guardado. La API (/api) y las fotos (/uploads) no se
 * guardan: los datos sin conexión los maneja la cola del parte diario (IndexedDB).
 * Solo corre en https o localhost (los navegadores no registran service workers en http).
 */
const CACHE = "infratrack-shell-v2";
// Las dos apps (ERP y ECMS) se guardan por separado, cada una bajo su ruta
const SHELLS = ["/erp", "/ecms"];
const shellKey = (req) => (req.mode === "navigate" ? new URL(req.url).pathname.replace(/\/+$/, "").split("/").slice(0, 2).join("/") || "/erp" : req);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELLS.map((s) => c.add(s).catch(() => undefined)))).then(() => self.skipWaiting()));
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
          caches.open(CACHE).then((c) => c.put(shellKey(req), copy));
        }
        return res;
      })
      .catch(() => caches.match(shellKey(req)).then((r) => r || Response.error()))
  );
});
