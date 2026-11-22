// Contexto compartido por las vistas: red, mapa, navegación, Localizador (panel deslizable) y utilidades.
import { trip, startGps } from "./trip.js";
import { setMarker, clearLayers, setNetwork, closePopup } from "./map.js";
import { fmtClock } from "./prediction.js";
import { serviceInfo, dayType, secOfDay } from "./network.js";
import { addRecent } from "./saved.js";

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const pref = {
  get: (k, d = null) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

export const app = {
  net: null, map: null, views: {},
  view: null, params: null, stack: [],
  flat: false,
  social: pref.get("pw-social", "1") === "1",
  pick: null, // punto elegido en el mapa (o tu ubicación) para "Empezar aquí"
  cool: {},
};

// ---------- Navegación ----------
// Cada vista tiene su URL (/poste/262, /linea/35?sentido=1&sube=236…) y entra en el historial del navegador:
// el botón atrás del móvil funciona, y si el sistema cierra la pestaña al saltar a otra app, al volver se recupera
// la misma pantalla. history.state guarda los parámetros completos; la URL basta para reconstruir lo esencial.
export function go(name, params = {}, { replace = false } = {}) {
  enter(name, params, replace ? "replace" : "push");
}
export function back() {
  if ((history.state?.n || 0) > 0) history.back();
  else enter("menu", {}, "replace"); // entrada directa por enlace: no hay a dónde volver dentro de la app
}
export function home() { enter("menu", {}, "push"); }

function enter(name, params, mode = "push") {
  app.view?.leave?.();
  closePopup();
  clearLayers(app.map);
  setNetwork(app.map, app.net, null, true);
  setPick(null);
  app.view = app.views[name];
  app.params = params;
  document.body.dataset.view = name;
  $("sheet-body").scrollTop = 0;
  if (mode !== "none") {
    const n = (history.state?.n || 0) + (mode === "push" && history.state ? 1 : 0);
    history[mode === "push" && history.state ? "pushState" : "replaceState"]({ view: name, params: plain(params), n }, "", toUrl(name, params));
  }
  app.view.enter(params);
  if (app.view.snap) snap(app.view.snap);
  record(name, app.params);
}

// Las vistas cambian app.params sobre la marcha (sentido, parada elegida…): esto actualiza la URL sin apilar.
export function syncUrl() {
  if (!app.view) return;
  history.replaceState({ ...(history.state || { n: 0 }), view: app.view.name, params: plain(app.params) }, "", toUrl(app.view.name, app.params));
  record(app.view.name, app.params);
}
const plain = (p) => { try { return structuredClone(p); } catch { return {}; } };

function record(name, p) {
  if (name === "poste") addRecent({ t: "poste", id: p.id });
  if (name === "route") addRecent({ t: "linea", routeId: p.routeId, dirIdx: p.dirIdx || 0, board: p.board ?? null });
}

// Parada dentro de un sentido -> texto de URL (número de poste si lo tiene; si no, id GTFS) y vuelta.
const stopRef = (net, id) => (net.stops[id].code ? String(net.stops[id].code) : `s${id}`);
function stopIdx(net, dir, ref) {
  if (ref == null || ref === "") return null;
  const i = dir.stops.findIndex((id) => (ref.startsWith("s") ? id === ref.slice(1) : String(net.stops[id].code) === ref));
  return i >= 0 ? i : null;
}

export function toUrl(name, p = {}) {
  const net = app.net, q = new URLSearchParams();
  if (name === "poste") {
    const st = net.stops[p.id];
    return st?.code ? `/poste/${st.code}` : `/parada/${encodeURIComponent(p.id)}`;
  }
  if (name === "route") {
    const r = net.byId[p.routeId], dirIdx = p.dirIdx || 0, d = r.dirs[dirIdx];
    if (dirIdx) q.set("sentido", dirIdx);
    if (p.board != null) q.set("sube", stopRef(net, d.stops[p.board]));
    if (p.dest != null) q.set("baja", stopRef(net, d.stops[p.dest]));
    return `/linea/${encodeURIComponent(r.short)}${q.size ? `?${q}` : ""}`;
  }
  if (name === "find") {
    if (p.line) q.set("linea", p.line);
    if (p.point) q.set("en", p.point.map((x) => x.toFixed(5)).join(","));
    return `/cerca${q.size ? `?${q}` : ""}`;
  }
  if (name === "explore") return "/lineas";
  if (name === "plan") return "/ir";
  return "/";
}

export function fromUrl(loc = location) {
  const net = app.net, parts = loc.pathname.split("/").filter(Boolean).map(decodeURIComponent), q = new URLSearchParams(loc.search);
  const [a, b] = parts;
  if (a === "poste" && net.byCode[b]) return { name: "poste", params: { id: net.byCode[b] } };
  if (a === "parada" && net.byStop[b]) return { name: "poste", params: { id: b } };
  if (a === "linea" && b) {
    const r = findRoute(net, b);
    if (!r) return null;
    const dirIdx = Math.min(+q.get("sentido") || 0, r.dirs.length - 1), d = r.dirs[dirIdx];
    const board = stopIdx(net, d, q.get("sube")), dest = stopIdx(net, d, q.get("baja"));
    return { name: "route", params: { routeId: r.id, dirIdx, board, dest: board != null && dest > board ? dest : null } };
  }
  if (a === "cerca") {
    const en = q.get("en")?.split(",").map(Number);
    return { name: "find", params: { tab: "dist", line: q.get("linea") || null, point: en?.length === 2 && en.every(Number.isFinite) ? en : null } };
  }
  if (a === "lineas") return { name: "explore", params: {} };
  if (a === "ir") return { name: "plan", params: {} };
  return null;
}
export const findRoute = (net, short) => net.routes.find((r) => r.short.toLowerCase() === String(short).toLowerCase());

// Atrás/adelante del navegador (o del móvil).
addEventListener("popstate", (e) => {
  if (!app.net) return;
  const s = e.state, t = s?.view && app.views[s.view] ? { name: s.view, params: s.params || {} } : fromUrl() || { name: "menu", params: {} };
  enter(t.name, t.params, "none");
});

// Arranque: la URL manda (enlace compartido o pestaña recuperada); si no hay, menú.
export function start() {
  const t = (history.state?.view && app.views[history.state.view] && { name: history.state.view, params: history.state.params || {} }) || fromUrl() || { name: "menu", params: {} };
  if (!history.state) history.replaceState({ view: t.name, params: plain(t.params), n: 0 }, "", location.href);
  enter(t.name, t.params, "replace");
  return t.name;
}

// ---------- Localizador (panel inferior deslizable) ----------
const SNAPS = { peek: 0.17, low: 0.4, half: 0.55, full: 0.92 };
let current = "half";
export function snap(name) {
  current = name;
  document.documentElement.style.setProperty("--sheet-visible", `${SNAPS[name] * 100}dvh`);
  $("sheet").dataset.snap = name;
  document.body.dataset.snap = name;
  padMap(SNAPS[name] * innerHeight);
}
// Zona visible del mapa (por encima del Localizador, o a su derecha en escritorio).
let sheetH = 0;
export function padMap(h = $("sheet").getBoundingClientRect().height) { sheetH = h; }
const visible = () => (innerWidth >= 900 ? { top: 30, bottom: 20, left: 450, right: 70 } : { top: 30, bottom: sheetH + 20, left: 20, right: 70 });
// Cámara centrada en la zona visible. No se usa map.setPadding para que fitBounds no sume márgenes.
export function fly(opts) {
  const v = visible();
  app.map.flyTo({ ...opts, offset: [(v.left - v.right) / 2, (v.top - v.bottom) / 2] });
}
export function fitTo(bounds, opts = {}) {
  app.map.fitBounds(bounds, { pitch: 0, bearing: 0, maxZoom: 16.5, ...opts, padding: visible() });
}
export function initSheet() {
  const sheet = $("sheet"), grip = $("grip-zone");
  let startY = 0, startH = 0, dragging = false;
  grip.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    dragging = true; startY = e.clientY; startH = sheet.getBoundingClientRect().height;
    sheet.classList.add("dragging"); grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const h = Math.max(70, Math.min(innerHeight * 0.92, startH + (startY - e.clientY)));
    document.documentElement.style.setProperty("--sheet-visible", `${h}px`);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false; sheet.classList.remove("dragging");
    const moved = startY - e.clientY, frac = sheet.getBoundingClientRect().height / innerHeight;
    if (Math.abs(moved) < 6) return e.target.closest(".grip") && snap(current === "full" ? "peek" : current === "peek" ? "half" : "full"); // toque en el asa = alterna
    snap(Object.entries(SNAPS).sort((a, b) => Math.abs(a[1] - frac) - Math.abs(b[1] - frac))[0][0]);
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  snap("half");
  addEventListener("resize", () => padMap());
}

// ---------- "Empezar aquí" ----------
export function setPick(p, label = null) {
  app.pick = p ? { p, label } : null;
  setMarker(app.map, "pick", p, { className: "pin" });
  $("start-here").hidden = !p;
}

// ---------- GPS ----------
export async function locate() {
  const fix = await startGps();
  if (!fix) toast(trip.gpsError ? `${trip.gpsError}. Puedes tocar el mapa para elegir un punto.` : "Sin ubicación");
  return fix;
}
export const myPos = () => trip.gps?.p || null;

// ---------- Utilidades de UI ----------
export function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3000);
}

// Botones con enfriamiento (para no saturar a Avanza): data-cool="10" segundos.
export function cooled(btn, fn) {
  btn.addEventListener("click", () => {
    if ((app.cool[btn.dataset.coolKey || btn.id] || 0) > Date.now()) return;
    app.cool[btn.dataset.coolKey || btn.id] = Date.now() + +btn.dataset.cool * 1000;
    paintCooldowns();
    fn();
  });
}
export function paintCooldowns() {
  for (const btn of document.querySelectorAll("[data-cool]")) {
    const until = app.cool[btn.dataset.coolKey || btn.id] || 0, left = Math.ceil((until - Date.now()) / 1000);
    btn.disabled = left > 0;
    btn.style.setProperty("--p", left > 0 ? left / +btn.dataset.cool : 0);
    btn.dataset.left = left > 0 ? `${left}s` : "";
  }
}

export const badge = (r, cls = "") => `<span class="lb ${cls}" style="--c:${r.color};--t:${r.text}">${esc(r.short)}</span>`;
export const posteLabel = (net, id) => (net.stops[id].tram ? "Parada de tranvía" : `Poste ${net.stops[id].code ?? "—"}`);

export function serviceChip(route) {
  const s = serviceInfo(route, dayType(), secOfDay());
  if (!s.today) return `<span class="svc off">○ ${s.text}</span>`;
  // Rango = salidas oficiales desde cabecera (primera y última salida), no llegadas.
  const range = `salidas ${fmtClock(s.first)}–${fmtClock(s.last)}`;
  if (s.active) return `<span class="svc on">● En servicio · ${range}</span>`;
  if (s.next != null) return `<span class="svc off">○ Primera salida ${fmtClock(s.next)} · ${range}</span>`;
  return `<span class="svc off">○ Terminó por hoy · última salida ${fmtClock(s.last)}</span>`;
}

// Cabecera del Localizador (va dentro del panel): ← título ☰
export function topbar(html) { $("topbar").innerHTML = html; }
export const simpleTop = (title, sub = "") => topbar(`<button class="icon-btn" data-nav="back" aria-label="Volver">←</button>
  <div class="top-title"><span class="label">${esc(sub)}</span><strong>${esc(title)}</strong></div>
  <button class="icon-btn" data-nav="home" aria-label="Menú principal">☰</button>`);

export async function arrivals(code) {
  try { return await (await fetch(`/api/arrivals?poste=${code}`)).json(); } catch { return { ok: false, rows: [] }; }
}
