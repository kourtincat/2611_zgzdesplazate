// Service worker de ZGZ Desplázate: notificaciones de «Estoy esperando» y arranque sin red de la interfaz.
// - push: el servidor avisa cuando el bus está a N minutos o llegando (aunque la pestaña esté en segundo plano).
// - notificationclick: abre o enfoca la app en la pantalla de la línea.
// - fetch: la página y sus assets se guardan para abrir rápido; /api y el mapa siempre van a la red.
const CACHE = "zgzd-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: "ZGZ Desplázate", body: e.data?.text() || "" }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || "ZGZ Desplázate", {
      body: d.body || "", tag: d.tag || "wait", renotify: true, requireInteraction: d.min != null && d.min <= 1,
      icon: "/icons/icon-192.png", vibrate: [200, 100, 200, 100, 300], data: { url: d.url || "/" },
    });
    for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "push", data: d });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const w = wins.find((c) => new URL(c.url).origin === self.location.origin);
    if (w) { await w.focus(); w.postMessage({ type: "open", url }); return; }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin || u.pathname.startsWith("/api/")) return;
  // Navegación: red primero (para tener la última versión), y la copia guardada si no hay red.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put("/", c)); return r; })
      .catch(() => caches.match("/")));
    return;
  }
  // Assets con hash, iconos y la red de transporte: caché y actualización en segundo plano.
  if (u.pathname.startsWith("/assets/") || u.pathname.startsWith("/icons/") || u.pathname === "/data/network.json") {
    e.respondWith(caches.open(CACHE).then(async (x) => {
      const hit = await x.match(e.request);
      const net = fetch(e.request).then((r) => { if (r.ok) x.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
