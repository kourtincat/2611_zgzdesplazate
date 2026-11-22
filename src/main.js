// ZGZ Movilidad Hecha Fácil — arranque, bienvenida y eventos globales.
// Al cargar (F5 incluido) se abre la pantalla de la URL (/poste/262, /linea/35…) o el inicio; la bienvenida sólo la
// primera vez y nunca al entrar por un enlace directo.
import { loadNetwork } from "./network.js";
import { createMap, setMarker, setMapTheme } from "./map.js";
import { app, $, go, back, home, start, fly, fitTo, initSheet, setPick, usePick, pref, toast, paintCooldowns, locate, myPos } from "./app.js";
import { trip, startGps, unlock, endRide } from "./trip.js";
import { haversine } from "./geo.js";
import { wait, remaining, fmtCount, resumeWait } from "./wait.js";
import { onBiziClick } from "./bizi.js";
import "@fontsource/inter-tight/latin-500.css";
import "@fontsource/inter-tight/latin-700.css";
import "@fontsource/inter-tight/latin-900.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import menu from "./views/menu.js";
import find from "./views/find.js";
import poste from "./views/poste.js";
import { explore } from "./views/explore.js";
import route from "./views/route.js";
import plan from "./views/plan.js";
import bizi from "./views/bizi.js";
import info from "./views/info.js";

app.views = { menu, find, poste, explore, route, plan, bizi, info };

const deepLink = location.pathname !== "/";
if (!pref.get("pw-welcomed") && !deepLink) document.body.dataset.view = "welcome";

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
  if (n) n.dataset.nav === "info" ? go("info", {}) : (n.dataset.nav === "home" ? home : back)();
});
$("start-here").onclick = () => usePick("origin");
$("go-here").onclick = () => usePick("dest");
// Tema claro / oscuro (interfaz y mapa). Se recuerda en este navegador.
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]').content = t === "light" ? "#f4f4f2" : "#000000";
  $("theme-btn").textContent = t === "light" ? "☾" : "☀";
  $("theme-btn").setAttribute("aria-label", t === "light" ? "Cambiar a tema oscuro" : "Cambiar a tema claro");
  setMapTheme(map, t);
}
applyTheme(pref.get("pw-theme", "dark"));
$("theme-btn").onclick = () => { const t = document.documentElement.dataset.theme === "light" ? "dark" : "light"; pref.set("pw-theme", t); applyTheme(t); };

// Funciones sociales («Estoy en la parada», «He cogido el bus», señales de otros usuarios).
function paintSocial() { $("social-btn").setAttribute("aria-pressed", String(app.social)); $("social-btn").classList.toggle("on", app.social); }
paintSocial();
$("social-btn").onclick = () => {
  app.social = !app.social;
  pref.set("pw-social", app.social ? "1" : "0");
  paintSocial();
  toast(app.social ? "Funciones sociales activadas" : "Funciones sociales ocultas");
  app.view?.redraw?.();
};
$("gps-btn").onclick = async () => { const fix = await locate(); if (fix) { fly({ center: fix.p, zoom: 16 }); setPick(fix.p, "Mi ubicación"); } };

map.on("click", (e) => {
  const layers = ["stops", "postes", ...["places", "bizi"].filter((id) => map.getLayoutProperty(id, "visibility") === "visible")];
  const f = map.queryRenderedFeatures(e.point, { layers })[0];
  if (f && app.view?.onFeature?.(f)) return;
  if (f?.layer.id === "bizi" && onBiziClick(f)) return;
  const p = [e.lngLat.lng, e.lngLat.lat];
  if (app.view?.onMapClick?.(p)) return;
  setPick(p, "Punto elegido"); // aparece "Empezar aquí"
});
for (const l of ["stops", "postes", "bizi", "places"]) {
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

// ---------- «Estoy esperando» ----------
// Barra fija con la cuenta atrás; tocarla vuelve a la línea. En la propia línea se ve en la tarjeta, no aquí.
function paintWaitBar() {
  const w = wait.cur, bar = $("wait-bar");
  const here = app.view?.name === "route" && app.params?.routeId === w?.routeId && app.params?.dirIdx === w?.dirIdx && app.params?.board === w?.board;
  bar.hidden = !w || here || document.body.dataset.view === "welcome";
  if (bar.hidden) return;
  const r = net.byId[w.routeId], s = remaining();
  bar.innerHTML = `<span class="lb" style="--c:${r.color};--t:${r.text}">${r.short}</span>
    <span class="wb-main"><b>${w.stopName.replace(/[<&]/g, "")}</b><small>esperando · aviso a ${w.alertMin}'${w.push === "on" ? " 🔔" : ""}</small></span>
    <span class="wb-count ${s != null && s <= w.alertMin * 60 ? "soon" : ""}">${fmtCount(s)}</span>`;
}
$("wait-bar").onclick = () => { const w = wait.cur; if (w) go("route", { routeId: w.routeId, dirIdx: w.dirIdx, board: w.board }); };
wait.onChange = () => { paintWaitBar(); app.view?.frame?.(); };
wait.onAlert = (msg) => toast(msg);

// Service worker: notificaciones y apertura rápida. Al tocar una notificación se abre la pantalla de la línea.
if ("serviceWorker" in navigator && isSecureContext) {
  navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("sw", e));
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "open" && e.data.url && e.data.url !== location.pathname + location.search) {
      history.pushState(null, "", e.data.url);
      dispatchEvent(new PopStateEvent("popstate", { state: null }));
    }
  });
}

// ---------- Arranque ----------
markReady();
if (pref.get("pw-welcomed") || deepLink) {
  start();
  if (pref.get("pw-gps") === "1" || trip.unlocked) startGps();
}
resumeWait();
setInterval(() => { paintCooldowns(); paintWaitBar(); app.view?.frame?.(); }, 1000);
