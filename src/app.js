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
  // Primero el Localizador a su altura: la cámara de la vista (fly/fitTo) se calcula con la zona de mapa visible.
  if (app.view.snap) snap(app.view.snap);
  app.view.enter(params);
  if (app.view.snap && app.view.snap !== current) snap(app.view.snap);
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

// URLs legibles, todo en la ruta (sin ?parámetros):
//   /poste/236/plaza-aragon-capitania          /parada/<id>/<nombre>   (tranvía, sin número de poste)
//   /linea/35/hacia-parque-goya/sube-236/baja-707/destino-ezjmgu4h
//   /cerca/linea-35/en-ezjmgu4h                /bizi/en-ezjmgu4h        /lineas   /ir   /info
// Los puntos del mapa van como geohash (8 letras ≈ 20 m): cortos, sin puntos ni comas.
// Se siguen entendiendo las URLs antiguas con ?sentido=&sube=&baja=&hasta=&linea=&en=.
export const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/n\.?\s*º/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const GH = "0123456789bcdefghjkmnpqrstuvwxyz";
export function geohash([lon, lat], len = 8) {
  let la = [-90, 90], lo = [-180, 180], h = "", bit = 0, ch = 0, even = true;
  while (h.length < len) {
    const r = even ? lo : la, v = even ? lon : lat, mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; }
    even = !even;
    if (++bit === 5) { h += GH[ch]; bit = 0; ch = 0; }
  }
  return h;
}
export function ungeohash(h) {
  let la = [-90, 90], lo = [-180, 180], even = true;
  for (const c of String(h)) {
    const v = GH.indexOf(c);
    if (v < 0) return null;
    for (let b = 4; b >= 0; b--) { const r = even ? lo : la, mid = (r[0] + r[1]) / 2; if ((v >> b) & 1) r[0] = mid; else r[1] = mid; even = !even; }
  }
  return [+((lo[0] + lo[1]) / 2).toFixed(6), +((la[0] + la[1]) / 2).toFixed(6)];
}
// Sentido de una línea como texto: «hacia-parque-goya» (si los dos sentidos se llaman igual, «sentido-2»).
const dirSlug = (r, i) => { const s = slug(r.dirs[i].headsign); return r.dirs.some((d, j) => j !== i && slug(d.headsign) === s) ? `sentido-${i + 1}` : `hacia-${s}`; };
const seg = (parts, prefix) => parts.find((x) => x.startsWith(prefix + "-"))?.slice(prefix.length + 1) ?? null;

export function toUrl(name, p = {}) {
  const net = app.net;
  if (name === "poste") {
    const st = net.stops[p.id];
    return st?.code ? `/poste/${st.code}/${slug(st.name)}` : `/parada/${encodeURIComponent(p.id)}/${slug(st?.name || "")}`;
  }
  if (name === "route") {
    const r = net.byId[p.routeId], dirIdx = p.dirIdx || 0, d = r.dirs[dirIdx], out = [`/linea/${encodeURIComponent(r.short.toLowerCase())}`, dirSlug(r, dirIdx)];
    if (p.board != null) out.push(`sube-${stopRef(net, d.stops[p.board])}`);
    if (p.board != null && p.dest != null) out.push(`baja-${stopRef(net, d.stops[p.dest])}`);
    if (p.board != null && p.to?.p) out.push(`destino-${geohash(p.to.p)}`);
    return out.join("/");
  }
  if (name === "find") {
    const out = ["/cerca"];
    if (p.line) out.push(`linea-${slug(p.line)}`);
    if (p.point) out.push(`en-${geohash(p.point)}`);
    return out.join("/");
  }
  if (name === "bizi") return p.point ? `/bizi/en-${geohash(p.point)}` : "/bizi";
  if (name === "explore") return "/lineas";
  if (name === "plan") {
    const out = ["/ir"];
    if (p.origin?.p) out.push(`desde-${geohash(p.origin.p)}`);
    if (p.dest?.p) out.push(`hasta-${geohash(p.dest.p)}`);
    if (p.origin && p.dest && p.sel != null) out.push(`opcion-${p.sel + 1}`);
    return out.join("/");
  }
  if (name === "info") return p.section ? `/info/${p.section}` : "/info";
  return "/";
}

export function fromUrl(loc = location) {
  const net = app.net, parts = loc.pathname.split("/").filter(Boolean).map(decodeURIComponent), q = new URLSearchParams(loc.search);
  const [a, b] = parts, rest = parts.slice(2);
  const pt = (v) => { if (!v) return null; if (/^[0-9b-hjkmnp-z]{5,12}$/.test(v)) return ungeohash(v); const x = v.split(",").map(Number); return x.length === 2 && x.every(Number.isFinite) ? x : null; };
  if (a === "poste" && net.byCode[b]) return { name: "poste", params: { id: net.byCode[b] } };
  if (a === "parada" && net.byStop[b]) return { name: "poste", params: { id: b } };
  if (a === "linea" && b) {
    const r = findRoute(net, b);
    if (!r) return null;
    const ds = rest.find((x) => x.startsWith("hacia-") || x.startsWith("sentido-"));
    let dirIdx = ds ? r.dirs.findIndex((_, i) => dirSlug(r, i) === ds) : -1;
    if (dirIdx < 0) dirIdx = Math.min(+q.get("sentido") || 0, r.dirs.length - 1);
    const d = r.dirs[dirIdx];
    const board = stopIdx(net, d, seg(rest, "sube") ?? q.get("sube")), dest = stopIdx(net, d, seg(rest, "baja") ?? q.get("baja"));
    const h = pt(seg(rest, "destino") ?? q.get("hasta")), to = h ? { p: h, label: placeLabel(net, h) } : null;
    return { name: "route", params: { routeId: r.id, dirIdx, board, dest: board != null && dest > board ? dest : null, to: board != null ? to : null } };
  }
  if (a === "cerca") {
    const all = parts.slice(1), line = seg(all, "linea") ?? q.get("linea");
    return { name: "find", params: { tab: "dist", line: line ? findRoute(net, line)?.short || null : null, point: pt(seg(all, "en") ?? q.get("en")) } };
  }
  if (a === "bizi") return { name: "bizi", params: { point: pt(seg(parts.slice(1), "en")) } };
  if (a === "lineas") return { name: "explore", params: {} };
  if (a === "ir") {
    const all = parts.slice(1), o = pt(seg(all, "desde")), d = pt(seg(all, "hasta")), n = +seg(all, "opcion");
    return { name: "plan", params: { origin: o ? { p: o, label: placeLabel(net, o) } : null, dest: d ? { p: d, label: placeLabel(net, d) } : null, sel: o && d && n > 0 ? n - 1 : null } };
  }
  if (a === "info") return { name: "info", params: { section: b || null } };
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
let current = "half", lastOpen = "half";
export const snapNow = () => current;
export function snap(name) {
  current = name;
  if (name !== "peek") lastOpen = name;
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
    if (Math.abs(moved) < 6) return toggleSheet(); // toque = plegar / desplegar
    snap(Object.entries(SNAPS).sort((a, b) => Math.abs(a[1] - frac) - Math.abs(b[1] - frac))[0][0]);
  };
  grip.addEventListener("pointerup", end);
  const g = grip.querySelector(".grip");
  g.setAttribute("role", "button"); g.tabIndex = 0; g.setAttribute("aria-label", "Plegar o desplegar el panel");
  g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSheet(); } });
  grip.addEventListener("pointercancel", end);
  snap("half");
  addEventListener("resize", () => padMap());
}

// Plegado <-> la última altura abierta (o media, si venía de pantalla completa: así se ve el mapa).
export function toggleSheet() {
  if (innerWidth >= 900) return;
  snap(current === "peek" ? (lastOpen === "full" ? "half" : lastOpen) : "peek");
}

// ---------- Punto tocado en el mapa ----------
// Por defecto ofrece «Empezar aquí» (origen de un trayecto). Si ya estás mirando un poste o tu parada de una línea,
// la vista lo cambia por «Quiero ir aquí» (pickGo): el punto pasa a ser el destino desde ese poste.
export function setPick(p, label = null) {
  app.pick = p ? { p, label } : null;
  setMarker(app.map, "pick", p, { className: "pin" });
  const b = $("start-here"), dest = !!(p && app.view?.pickGo && app.view.canPickGo?.() !== false);
  b.hidden = !p;
  b.textContent = dest ? "Quiero ir aquí →" : "Empezar aquí →";
  b.classList.toggle("dest", dest);
}
export function usePick() {
  const k = app.pick; if (!k) return;
  if (app.view?.pickGo && app.view.canPickGo?.() !== false) { setPick(null); return app.view.pickGo(k); }
  go("plan", { origin: { p: k.p, label: k.label || "Punto elegido" } });
}
// Nombre legible de un punto: la parada más cercana.
export function placeLabel(net, p) {
  let best = null, bd = 400;
  for (const id in net.byStop) { const d = Math.hypot((net.stops[id].p[0] - p[0]) * 74, (net.stops[id].p[1] - p[1]) * 111) * 1000; if (d < bd) { bd = d; best = id; } }
  return best ? `Cerca de ${net.stops[best].name}` : "Punto en el mapa";
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

// Versión corta para la cabecera de línea: «● 07:00–01:30» (verde si está en servicio).
export function serviceMini(route) {
  const s = serviceInfo(route, dayType(), secOfDay());
  if (!s.today) return `<span class="svc off">○ ${s.text}</span>`;
  const range = `${fmtClock(s.first)}–${fmtClock(s.last)}`;
  if (s.active) return `<span class="svc on" title="En servicio · salidas ${range}">● ${range}</span>`;
  if (s.next != null) return `<span class="svc off">○ empieza ${fmtClock(s.next)}</span>`;
  return `<span class="svc off">○ terminó por hoy</span>`;
}
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
  <button class="icon-btn close-btn" data-nav="home" aria-label="Cerrar y volver al inicio">✕</button>`);

export async function arrivals(code) {
  try { return await (await fetch(`/api/arrivals?poste=${code}`)).json(); } catch { return { ok: false, rows: [] }; }
}
