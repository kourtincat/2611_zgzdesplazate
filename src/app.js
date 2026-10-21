// Contexto compartido por las vistas: red, mapa, navegación, Localizador (panel deslizable) y utilidades.
import { trip, startGps } from "./trip.js";
import { setMarker, clearLayers, setNetwork, closePopup } from "./map.js";
import { fmtClock } from "./prediction.js";
import { serviceInfo, dayType, secOfDay } from "./network.js";

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
export function go(name, params = {}, { replace = false } = {}) {
  if (app.view && !replace) app.stack.push({ name: app.view.name, params: app.params });
  enter(name, params);
}
export function back() {
  const prev = app.stack.pop();
  enter(prev ? prev.name : "menu", prev ? prev.params : {});
}
export function home() { app.stack = []; enter("menu", {}); }

function enter(name, params) {
  app.view?.leave?.();
  closePopup();
  clearLayers(app.map);
  setNetwork(app.map, app.net, null, true);
  setPick(null);
  app.view = app.views[name];
  app.params = params;
  document.body.dataset.view = name;
  $("sheet-body").scrollTop = 0;
  app.view.enter(params);
  if (app.view.snap) snap(app.view.snap);
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
