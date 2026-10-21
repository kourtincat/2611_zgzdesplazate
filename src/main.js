// ZGZ Movilidad Hecha Fácil — arranque, bienvenida y eventos globales.
// Al cargar (F5 incluido) siempre se abre el menú principal; la bienvenida sólo la primera vez.
import { loadNetwork } from "./network.js";
import { createMap, setMarker } from "./map.js";
import { app, $, go, back, home, fly, fitTo, initSheet, setPick, pref, toast, paintCooldowns, locate, myPos } from "./app.js";
import { trip, startGps, unlock, endRide } from "./trip.js";
import { haversine } from "./geo.js";
import menu from "./views/menu.js";
import find from "./views/find.js";
import poste from "./views/poste.js";
import { explore, line } from "./views/explore.js";
import route from "./views/route.js";
import plan from "./views/plan.js";

app.views = { menu, find, poste, explore, line, route, plan };

if (!pref.get("pw-welcomed")) document.body.dataset.view = "welcome";

// La bienvenida responde aunque el mapa siga cargando: las acciones esperan a `ready`.
let markReady;
const ready = new Promise((ok) => (markReady = ok));
$("start-btn").onclick = () => { $("welcome").querySelector('[data-step="1"]').hidden = true; $("welcome").querySelector('[data-step="2"]').hidden = false; };
$("gps-yes").onclick = async () => { pref.set("pw-welcomed", "1"); pref.set("pw-gps", "1"); await ready; home(); const fix = await locate(); if (fix) fly({ center: fix.p, zoom: 15 }); };
$("gps-no").onclick = async () => { pref.set("pw-welcomed", "1"); pref.set("pw-gps", "0"); await ready; home(); };

const net = await loadNetwork();
const map = await createMap("map", net.bounds);
Object.assign(app, { net, map });
initSheet();

// ---------- Eventos globales ----------
$("topbar").addEventListener("click", (e) => {
  const n = e.target.closest("[data-nav]");
  if (n) (n.dataset.nav === "home" ? home : back)();
});
$("start-here").onclick = () => go("plan", { origin: { p: app.pick.p, label: app.pick.label || "Punto elegido" } });
$("dim-btn").onclick = (e) => {
  app.flat = !app.flat;
  e.currentTarget.textContent = app.flat ? "3D" : "2D";
  map.setLayoutProperty("buildings-3d", "visibility", app.flat ? "none" : "visible");
  map.easeTo({ pitch: app.flat ? 0 : 55, bearing: app.flat ? 0 : -18, duration: 800 });
  app.view?.redraw?.();
};
$("center-btn").onclick = () => {
  if (app.view?.center) return app.view.center();
  const me = myPos();
  if (me) fly({ center: me, zoom: 15.5 }); else fitTo(net.bounds, { maxZoom: 13 });
};
$("gps-btn").onclick = async () => { const fix = await locate(); if (fix) { fly({ center: fix.p, zoom: 16 }); setPick(fix.p, "Mi ubicación"); } };

map.on("click", (e) => {
  const f = map.queryRenderedFeatures(e.point, { layers: ["stops", "postes"] })[0];
  if (f && app.view?.onFeature?.(f)) return;
  const p = [e.lngLat.lng, e.lngLat.lat];
  if (app.view?.onMapClick?.(p)) return;
  setPick(p, "Punto elegido"); // aparece "Empezar aquí"
});
for (const l of ["stops", "postes"]) {
  map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
}

$("extra-dlg").addEventListener("close", async () => {
  if ($("extra-dlg").returnValue !== "ok") return;
  const fix = await unlock();
  toast(fix ? "Funciones extra activadas" : `${trip.gpsError || "Sin ubicación"}: no se pueden activar`);
  app.view?.frame?.();
});

// GPS: marcador propio (tocarlo = "Empezar aquí") y fin automático del viaje al llegar a la bajada.
trip.onChange = () => {
  if (trip.gps) setMarker(map, "me", trip.gps.p, { className: "me", onClick: () => setPick(trip.gps.p, "Mi ubicación") });
  const rd = trip.ride;
  if (rd?.dest != null && trip.gps) {
    const d = net.byId[rd.route].dirs.find((x) => x.dir === rd.dir), s = net.stops[d.stops[rd.dest]];
    if (haversine(trip.gps.p, s.p) < 50) endRide().then((res) => toast(`Has llegado a ${s.name}${res?.status === "confirmed" ? " · viaje verificado ✓" : ""}`));
  }
  app.view?.frame?.();
};

// ---------- Arranque ----------
markReady();
if (pref.get("pw-welcomed")) {
  home();
  if (pref.get("pw-gps") === "1" || trip.unlocked) startGps();
}
setInterval(() => { paintCooldowns(); app.view?.frame?.(); }, 1000);
