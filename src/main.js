import { loadNetwork, nearestStop, routesNear, dirLabel, serviceInfo, dayType, secOfDay } from "./network.js";
import { createMap, setNetwork, setSelection, setBuses, animateArrows, setUser, setPin } from "./map.js";
import { liveEstimate, busesFromScan, scheduledBuses, scheduledPasses, alongFromT, stopIndexFromT, stopIndexFromAlong, tFromAlong, fmtEta, fmtClock, CALIB_BACK } from "./prediction.js";
import { renderStops, renderTimeline } from "./diagram.js";
import { fetchLive, fetchHabits, passesAt, tentative, mergeHabits, liveSignals } from "./crowd.js";
import { trip, startGps, unlock, checkIn, board, endRide, cancelCheckin } from "./trip.js";
import { haversine } from "./geo.js";

const $ = (id) => document.getElementById(id);
const FALLBACK = [-0.8803, 41.6488]; // Plaza España
const POLL_EVERY = 20000, SCAN_FRESH = 180000;
const pref = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

const state = {
  net: null, map: null, view: "welcome",
  origin: { p: FALLBACK, kind: "default" },
  route: null, dirIdx: 0, board: 0, dest: null, open: null,
  flat: false, poll: null, scan: null, health: { up: true }, live: { reports: [], trackers: [] }, habits: [],
  cool: {}, timer: null,
};
const dir = () => state.route.dirs[state.dirIdx];
const geom = () => (state.flat ? dir().flat : dir().real);
const vehicle = (r = state.route) => (r.tram ? "tranvía" : "bus");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3000);
}

// ---------- Horario de servicio ----------
function serviceChip(route) {
  const s = serviceInfo(route, dayType(), secOfDay());
  if (!s.today) return `<span class="svc off">○ ${s.text}</span>`;
  const range = `${fmtClock(s.first)}–${fmtClock(s.last)}`;
  if (s.active) return `<span class="svc on">● En servicio · ${range}</span>`;
  if (s.next != null) return `<span class="svc off">○ Empieza ${fmtClock(s.next)} · ${range}</span>`;
  return `<span class="svc off">○ Terminó por hoy · ${range}</span>`;
}

// ---------- Vistas ----------
function setView(v) {
  state.view = v;
  document.body.dataset.view = v;
  if (v !== "route") {
    clearTimeout(state.timer);
    state.route = null;
    setSelection(state.map, state.net, null, null, null, state.flat);
    setBuses(state.map, { at: () => [0, 0] }, []);
    animateArrows(state.map, null);
  }
}

// ---------- Gestor de rutas ----------
function setOrigin(p, kind) {
  state.origin = { p, kind };
  setPin(state.map, kind === "gps" ? null : p);
  if (state.view === "home") renderHome();
}

function renderHome() {
  let near = routesNear(state.net, state.origin.p, 700);
  if (near.length < 3) near = routesNear(state.net, state.origin.p, 1500);
  setNetwork(state.map, state.net, new Set(near.map((n) => n.route.id)));
  $("near-label").textContent = state.origin.kind === "gps" ? "Líneas cerca de ti" : state.origin.kind === "pin" ? "Líneas cerca del pin" : "Líneas cerca de Plaza España";
  $("near-place").textContent = near.length ? `${near.length} línea${near.length > 1 ? "s" : ""} a menos de ${near[near.length - 1].d > 700 ? "1,5 km" : "700 m"}` : "Ninguna línea cerca: prueba otro punto";
  $("near-list").innerHTML = near.map((n) => `
    <div class="route-card" style="--c:${n.route.color};--t:${n.route.text}">
      <div class="rc-top">
        <span class="line-badge sm">${esc(n.route.short)}</span>
        <div class="rc-info"><strong>${esc(n.route.long)}</strong>${serviceChip(n.route)}</div>
      </div>
      <div class="rc-stop meta">${n.route.tram ? "Parada" : "Poste"} más cercano: ${esc(state.net.stops[n.id].name)} · ${Math.round(n.d)} m</div>
      <div class="rc-dirs">${n.route.dirs.map((d, i) => `<button data-route="${n.route.id}" data-dir="${i}">→ ${esc(d.headsign)}</button>`).join("")}</div>
    </div>`).join("");
}

function buildLinesGrid() {
  $("lines-grid").innerHTML = state.net.routes.map((r) =>
    `<button class="line-chip" data-id="${r.id}" style="--c:${r.color};--t:${r.text}"><b>${esc(r.short)}</b><span><span class="lc-name">${esc(r.long)}</span>${serviceChip(r)}</span></button>`).join("");
}

// ---------- Ruta seleccionada ----------
function openRoute(route, dirIdx) {
  state.route = route; state.dirIdx = dirIdx; state.dest = null; state.open = null;
  state.board = nearestStop(state.net, dir(), state.origin.p).i;
  setView("route");
  onRouteChange(true);
}

function onRouteChange(fly) {
  const r = state.route, d = dir();
  if (trip.ride && trip.ride.route === r.id && trip.ride.dir === d.dir) { state.board = trip.ride.board; state.dest = trip.ride.dest; }
  document.documentElement.style.setProperty("--line", r.color);
  document.documentElement.style.setProperty("--line-text", r.text);
  const lbl = dirLabel(state.net, r, d);
  $("route-badge").textContent = r.short;
  $("route-kind").textContent = r.tram ? "Tranvía · sentido" : `Línea ${r.short} · sentido`;
  $("dir-from").textContent = lbl.from;
  $("dir-to").textContent = lbl.to;
  $("swap-btn").disabled = r.dirs.length < 2 || !!trip.ride;
  $("refresh-btn").hidden = $("scan-btn").hidden = !r.live;
  redrawSelection();
  animateArrows(state.map, r, d, geom());
  if (fly) {
    const p = state.net.stops[d.stops[state.board]].p;
    state.map.flyTo({ center: p, zoom: 15, pitch: state.flat ? 0 : 55, bearing: state.flat ? 0 : -18, duration: 1100 });
  }
  state.poll = null; state.scan = null; state.habits = [];
  loadRouteData();
}

function redrawSelection() {
  setSelection(state.map, state.net, state.route, dir(), geom(), state.flat, state.board, state.dest);
  const s = state.net.stops[dir().stops[state.board]];
  $("stop-name").textContent = s.name;
  $("stop-meta").textContent = `${state.route.tram ? "Parada" : "Poste " + (s.code ?? "—")} · ${state.board + 1}/${dir().stops.length}` +
    (state.dest != null ? ` · bajas en ${state.net.stops[dir().stops[state.dest]].name}` : "");
}

function setBoard(i) {
  if (trip.ride) return toast("Tienes un viaje en curso");
  state.board = i;
  if (state.dest != null && state.dest <= i) state.dest = null;
  state.open = null;
  redrawSelection();
  state.poll = null; state.habits = [];
  loadRouteData(false);
}

async function loadRouteData(withScan = true) {
  const r = state.route, d = dir(), poste = state.net.stops[d.stops[state.board]].code;
  const [live, habits] = await Promise.all([fetchLive(r, d), r.live ? fetchHabits(r, [poste], dayType()) : {}]);
  if (r !== state.route || d !== dir()) return;
  state.live = live;
  state.habits = habits[poste] || [];
  await poll();
  if (withScan && r.live) scan();
}

async function poll() {
  clearTimeout(state.timer);
  const r = state.route; if (!r) return;
  const d = dir(), u = state.board;
  if (r.live) {
    const c = Math.max(0, u - CALIB_BACK);
    const get = (i) => fetch(`/api/arrivals?poste=${state.net.stops[d.stops[i]].code}`).then((x) => x.json());
    try {
      const [U, C] = await Promise.all([get(u), c < u ? get(c) : Promise.resolve(null)]);
      state.health = U.health || state.health;
      if (r === state.route && d === dir() && u === state.board) state.poll = { U, C, c, at: Date.now() };
    } catch { state.health = { up: false }; }
  }
  fetchLive(r, d).then((l) => { if (r === state.route) state.live = l; });
  frame();
  state.timer = setTimeout(poll, POLL_EVERY);
}

async function scan() {
  const r = state.route, d = dir();
  $("scan-meta").textContent = "revisando…";
  try {
    const res = await (await fetch(`/api/scan?linea=${encodeURIComponent(r.short)}&postes=${d.stops.map((id) => state.net.stops[id].code).join(",")}`)).json();
    if (r !== state.route || d !== dir()) return;
    if (!res.ok) { state.health = { up: false }; toast("Avanza no responde ahora mismo"); }
    state.scan = res.ok ? res : null;
  } catch { state.health = { up: false }; }
  frame();
}

// Botones con enfriamiento (para no saturar a Avanza).
function cooldown(btn, fn) {
  btn.onclick = () => {
    const left = (state.cool[btn.id] || 0) - Date.now();
    if (left > 0) return;
    state.cool[btn.id] = Date.now() + +btn.dataset.cool * 1000;
    fn();
  };
}
function paintCooldowns() {
  for (const btn of document.querySelectorAll(".cool")) {
    const left = Math.ceil(((state.cool[btn.id] || 0) - Date.now()) / 1000);
    btn.disabled = left > 0;
    btn.style.setProperty("--p", left > 0 ? left / +btn.dataset.cool : 0);
    btn.dataset.left = left > 0 ? `${left}s` : "";
  }
}

// ---------- Render por segundo ----------
function frame() {
  paintCooldowns();
  if (state.view !== "route" || !state.route) return;
  const r = state.route, d = dir(), u = state.board, now = Date.now(), nowSec = secOfDay(), type = dayType();
  const apiDown = r.live && state.health && !state.health.up;

  const pollBuses = state.poll?.U?.ok ? liveEstimate(r, d, u, state.poll.U.rows, state.poll.c, state.poll.C?.rows, state.poll.at, now) : [];
  const scanFresh = state.scan && now - state.scan.at < SCAN_FRESH;
  const scanBuses = scanFresh ? busesFromScan(state.net, r, d, state.scan, now) : [];
  const live = scanBuses.length ? scanBuses : pollBuses;
  const users = state.live.trackers.filter((t) => !trip.ride || t.along !== trip.ride.along).map((t) => ({ T: tFromAlong(d, t.along), along: t.along, kind: "user", label: "usuario" }));
  const ghosts = live.length || users.length ? [] : scheduledBuses(d, type, nowSec).map((b) => ({ ...b, kind: "schedule" }));
  const me = trip.ride && trip.ride.route === r.id && trip.ride.dir === d.dir && trip.ride.along != null ? [{ along: trip.ride.along, kind: "me", label: "TÚ" }] : [];

  // ETA a mi parada de un bus en posición T
  const etaU = (b) => (d.offsets[u] - b.T) * (b.f || 1);
  const all = [...live.map((b) => ({ ...b, kind: "live" })), ...users, ...ghosts].map((b) => ({ ...b, along: b.along ?? alongFromT(d, b.T) }));
  for (const b of all) if (b.kind === "live" && b.T <= d.offsets[u]) { const e = etaU(b); b.label = e < 45 ? "YA" : `${Math.round(e / 60)}'`; }
  setBuses(state.map, geom(), [...all, ...me]);

  // ETA por parada (próximo bus en vivo que aún no ha pasado)
  const etas = d.stops.map((_, j) => {
    const e = live.filter((b) => b.T <= d.offsets[j]).map((b) => (d.offsets[j] - b.T) * (b.f || 1));
    return e.length ? `${Math.max(0, Math.round(Math.min(...e) / 60))}'` : "";
  });
  renderStops($("stops"), state.net, r, d, {
    board: u, dest: state.dest, etas, open: state.open, locked: !!trip.ride,
    buses: [...all, ...me].map((b) => ({ idx: b.T != null ? stopIndexFromT(d, b.T) : stopIndexFromAlong(d, b.along), kind: b.kind, label: b.kind === "me" ? "TÚ" : "" })),
  });

  // Hábito (grabador + usuarios) y señales en vivo de usuarios aguas arriba
  const passes = passesAt(state.live.reports, d, u);
  const habit = mergeHabits(state.habits, tentative(passes, type));
  const signals = liveSignals(passes, u, now);

  // Tarjeta principal
  const pollNext = pollBuses[0];
  const liveNext = pollNext ? pollNext.eta : Math.min(...live.filter((b) => b.T <= d.offsets[u]).map(etaU), Infinity);
  const schedNext = scheduledPasses(d, type, u, nowSec, 3 * 3600)[0];
  const habitNext = habit.find((h) => h.sec >= nowSec - 60);
  let sub;
  if (liveNext !== Infinity) {
    $("eta-value").textContent = fmtEta(liveNext);
    const T = d.offsets[u] - liveNext;
    const away = Math.max(0, Math.ceil(u - stopIndexFromT(d, T)));
    sub = `${pollNext?.atHead ? "aún en cabecera" : away ? `a ${away} parada${away > 1 ? "s" : ""}` : "en tu parada"} · Avanza${pollNext ? `: ${pollNext.raw === 0 ? "en parada" : pollNext.raw + " min"}` : " (revisión)"}`;
  } else if (apiDown && habitNext) {
    $("eta-value").textContent = fmtEta(habitNext.sec - nowSec);
    sub = `previsión por hábito · suele pasar ${fmtClock(habitNext.sec)}`;
  } else if (schedNext !== undefined) {
    $("eta-value").textContent = fmtEta(schedNext - nowSec);
    sub = `${r.live ? (apiDown ? "Avanza caída" : "sin bus en vivo") : "tranvía · sin dato en vivo"} · horario ${fmtClock(schedNext)}`;
  } else { $("eta-value").textContent = "—"; sub = serviceChip(r).replace(/<[^>]+>/g, ""); }
  $("eta-sub").textContent = sub;

  $("api-banner").hidden = !apiDown;
  $("api-banner").textContent = "Avanza no responde. Mostramos la previsión por hábito (lo que el sistema ha observado otros días) y el horario.";

  // Señal de usuarios: "igual llega antes/después"
  const sig = signals[0];
  $("signal-note").hidden = !sig;
  if (sig) {
    const diff = liveNext !== Infinity ? Math.round((now + liveNext * 1000 - sig.at) / 60000) : 0;
    $("signal-note").innerHTML = `<b>Señal de usuario:</b> alguien subió en ${esc(state.net.stops[d.stops[sig.k]].name)} → aquí hacia las ${fmtClock(secOfDay(new Date(sig.at)))}` +
      (diff ? ` · ${Math.abs(diff)} min ${diff > 0 ? "antes" : "después"} de lo que marca Avanza` : "");
  }

  renderTimeline($("timeline"), r, nowSec, 3600, {
    live: live.filter((b) => b.T <= d.offsets[u]).map((b) => nowSec + etaU(b)),
    sched: scheduledPasses(d, type, u, nowSec, 3600),
    habit,
    users: [...signals.map((s) => secOfDay(new Date(s.at))), ...users.filter((b) => b.T <= d.offsets[u]).map((b) => nowSec + etaU(b))],
  });
  $("habit-note").textContent = habit.length
    ? `Hábito observado en esta parada: ${habit.slice(0, 8).map((h) => fmtClock(h.sec)).join(" · ")}${habit.length > 8 ? "…" : ""}`
    : "Aún no hay hábito observado aquí (el sistema aprende con los snapshots diarios y los avisos).";
  $("scan-meta").textContent = state.scan ? `revisada hace ${Math.round((now - state.scan.at) / 1000)} s · ${scanBuses.length} ${vehicle()}${scanBuses.length === 1 ? "" : "es"}` : "";
  $("foot").textContent = `GTFS ${state.net.feed} · ${state.poll?.U?.ok ? `poste actualizado hace ${Math.round((now - state.poll.at) / 1000)} s` : r.live ? "sin datos de Avanza" : "Tranvía: sólo horario"}`;
  renderExtra();
}

// ---------- Funciones extra ----------
function renderExtra() {
  const el = $("extra"), r = state.route, d = dir(), v = vehicle();
  const cap = v[0].toUpperCase() + v.slice(1);
  if (!trip.unlocked) {
    el.innerHTML = `<div class="extra-wall"><div><b>Accede a funciones extra</b><span class="meta">Avisa de que estás en la parada y cuándo subes. Anónimo y verificado por ubicación.</span></div><button class="cta small" data-x="wall">Ver</button></div>`;
    return;
  }
  if (!trip.gps) {
    el.innerHTML = `<div class="extra-box"><span class="meta">${trip.gpsError || "Buscando tu ubicación…"} Sin ubicación no se pueden enviar avisos.</span>
      <button class="board" disabled>He cogido el ${v}</button><button class="ghost-btn" data-x="gps">Reintentar ubicación</button></div>`;
    return;
  }
  if (trip.ride) {
    const mine = trip.ride.route === r.id && trip.ride.dir === d.dir;
    const destName = trip.ride.dest != null ? state.net.byId[trip.ride.route].dirs.find((x) => x.dir === trip.ride.dir).stops[trip.ride.dest] : null;
    el.innerHTML = `<div class="extra-box ride"><div class="ride-head"><span class="live-dot"></span><b>En ruta${mine ? "" : ` · línea ${esc(state.net.byId[trip.ride.route].short)}`}</b>
      <span class="badge-status ${trip.ride.status}">${trip.ride.status === "confirmed" ? "Verificado ✓" : "Validando con tu GPS…"}</span></div>
      <span class="meta">${destName ? `Bajas en <b>${esc(state.net.stops[destName].name)}</b>. Te avisaremos al llegar.` : "Marca en el recorrido dónde te bajas (opcional)."}</span>
      <button class="board" data-x="end">Me he bajado</button></div>`;
    return;
  }
  const near = nearestStop(state.net, d, trip.gps.p);
  const tol = 60 + Math.min(trip.gps.acc, 40);
  if (trip.checkin && trip.checkin.route === r.id && trip.checkin.dir === d.dir) {
    const s = state.net.stops[d.stops[trip.checkin.stop]];
    const still = haversine(trip.gps.p, s.p) <= 120 + Math.min(trip.gps.acc, 40);
    el.innerHTML = `<div class="extra-box"><span class="meta">Esperando en <b>${esc(s.name)}</b>${state.dest != null ? ` · bajas en <b>${esc(state.net.stops[d.stops[state.dest]].name)}</b>` : " · toca en el recorrido dónde te bajas"}</span>
      <button class="board" data-x="board" ${still ? "" : "disabled"}>He cogido el ${v}</button>
      ${still ? "" : `<span class="meta warn">Te has alejado de la parada; vuelve para avisar.</span>`}
      <button class="ghost-btn" data-x="cancel">Ya no espero</button></div>`;
    return;
  }
  const ok = near.d <= tol && trip.gps.acc <= 100;
  el.innerHTML = `<div class="extra-box">
    <button class="board alt" data-x="checkin" data-i="${near.i}" ${ok ? "" : "disabled"}>Estoy en ${esc(state.net.stops[near.id].name)}</button>
    <span class="meta ${ok ? "" : "warn"}">${ok ? `${cap}: avisa cuando estés en la parada. Después podrás marcar que has subido.` : trip.gps.acc > 100 ? `Precisión del GPS baja (${Math.round(trip.gps.acc)} m). Espera unos segundos.` : `Estás a ${Math.round(near.d)} m de la parada más cercana de esta línea. Acércate para avisar.`}</span>
    <button class="board" disabled title="Primero indica que estás en la parada">He cogido el ${v}</button></div>`;
}

async function onExtraClick(e) {
  const b = e.target.closest("[data-x]"); if (!b) return;
  const r = state.route, d = dir();
  try {
    if (b.dataset.x === "wall") $("extra-dlg").showModal();
    if (b.dataset.x === "gps") await startGps();
    if (b.dataset.x === "checkin") {
      setBoard(+b.dataset.i);
      await checkIn(r, d, +b.dataset.i);
      toast("Anotado: estás en la parada");
    }
    if (b.dataset.x === "board") { await board(r, d, state.dest); toast(`Buen viaje. Validamos con tu GPS que vas en el ${vehicle()}`); redrawSelection(); $("swap-btn").disabled = true; }
    if (b.dataset.x === "cancel") cancelCheckin();
    if (b.dataset.x === "end") { const res = await endRide(); toast(res?.status === "confirmed" ? "¡Gracias! Tu viaje ayuda a predecir el bus" : "Viaje no verificado: no se ha guardado"); $("swap-btn").disabled = state.route.dirs.length < 2; }
  } catch (err) { toast(err.message); }
  frame();
}

// Al llegar a la parada de bajada se cierra el viaje.
trip.onChange = () => {
  if (trip.gps && state.origin.kind === "gps" && haversine(trip.gps.p, state.origin.p) > 50) setOrigin(trip.gps.p, "gps");
  if (trip.gps) setUser(state.map, trip.gps.p);
  const rd = trip.ride;
  if (rd?.dest != null && trip.gps) {
    const d = state.net.byId[rd.route].dirs.find((x) => x.dir === rd.dir);
    const s = state.net.stops[d.stops[rd.dest]];
    if (haversine(trip.gps.p, s.p) < 50) endRide().then((res) => toast(`Has llegado a ${s.name}${res?.status === "confirmed" ? " · viaje verificado ✓" : ""}`));
  }
  if (state.view === "route") frame();
};

// ---------- Bienvenida ----------
async function useGps() {
  const fix = await startGps();
  if (fix) { setOrigin(fix.p, "gps"); state.map.flyTo({ center: fix.p, zoom: 15 }); pref.set("pw-gps", "1"); }
  else { setOrigin(FALLBACK, "default"); toast(trip.gpsError ? `${trip.gpsError}: toca el mapa para elegir un punto` : "Toca el mapa para elegir un punto"); }
  return fix;
}

// La bienvenida responde aunque el mapa siga cargando: las acciones esperan a `ready`.
let markReady;
const ready = new Promise((ok) => (markReady = ok));
$("start-btn").onclick = () => { $("welcome").querySelector('[data-step="1"]').hidden = true; $("welcome").querySelector('[data-step="2"]').hidden = false; };
$("gps-yes").onclick = async () => { pref.set("pw-welcomed", "1"); pref.set("pw-gps", "1"); await ready; setView("home"); renderHome(); await useGps(); };
$("gps-no").onclick = async () => { pref.set("pw-welcomed", "1"); pref.set("pw-gps", "0"); await ready; setView("home"); setOrigin(FALLBACK, "default"); };

function bindUi() {

  $("near-list").onclick = (e) => { const b = e.target.closest("[data-route]"); if (b) openRoute(state.net.byId[b.dataset.route], +b.dataset.dir); };
  $("all-lines-btn").onclick = () => { buildLinesGrid(); $("lines-dlg").showModal(); };
  $("lines-close").onclick = () => $("lines-dlg").close();
  $("lines-grid").onclick = (e) => {
    const b = e.target.closest(".line-chip"); if (!b) return;
    $("lines-dlg").close();
    const r = state.net.byId[b.dataset.id];
    const near = r.dirs.map((d) => nearestStop(state.net, d, state.origin.p).d);
    openRoute(r, near.indexOf(Math.min(...near)));
  };

  $("back-btn").onclick = () => { setView("home"); renderHome(); };
  $("swap-btn").onclick = () => {
    const p = state.net.stops[dir().stops[state.board]].p;
    state.dirIdx = (state.dirIdx + 1) % state.route.dirs.length;
    state.board = nearestStop(state.net, dir(), p).i; state.dest = null; state.open = null;
    onRouteChange(false);
    toast(`Sentido invertido: hacia ${dir().headsign}`);
  };
  $("dim-btn").onclick = (e) => {
    state.flat = !state.flat;
    e.currentTarget.textContent = state.flat ? "3D" : "2D";
    state.map.easeTo({ pitch: state.flat ? 0 : 55, bearing: state.flat ? 0 : -18, duration: 800 });
    if (state.route) { redrawSelection(); animateArrows(state.map, state.route, dir(), geom()); frame(); }
    else setSelection(state.map, state.net, null, null, null, state.flat);
  };
  $("locate-btn").onclick = async () => {
    const fix = await useGps();
    if (fix && state.view === "route" && !trip.ride) setBoard(nearestStop(state.net, dir(), fix.p).i);
  };
  cooldown($("refresh-btn"), () => { poll(); toast("Poste actualizado"); });
  cooldown($("scan-btn"), () => scan());

  $("stops").onclick = (e) => {
    const act = e.target.closest("[data-act]");
    if (act) {
      const i = +act.dataset.i;
      if (act.dataset.act === "board") setBoard(i);
      if (act.dataset.act === "dest") { state.dest = i; state.open = null; redrawSelection(); }
      if (act.dataset.act === "nodest") { state.dest = null; state.open = null; redrawSelection(); }
      if (trip.ride) trip.ride.dest = state.dest;
      return frame();
    }
    const row = e.target.closest(".row"); if (!row) return;
    const i = +row.dataset.i;
    if (trip.ride) { if (i > trip.ride.board) { state.dest = trip.ride.dest = i; redrawSelection(); } }
    else state.open = state.open === i ? null : i;
    frame();
  };
  $("extra").onclick = onExtraClick;
  $("extra-dlg").addEventListener("close", async () => {
    if ($("extra-dlg").returnValue !== "ok") return;
    const fix = await unlock();
    toast(fix ? "Funciones extra activadas" : `${trip.gpsError || "Sin ubicación"}: no se pueden activar`);
    frame();
  });

  state.map.on("click", (e) => {
    if (state.view === "home") setOrigin([e.lngLat.lng, e.lngLat.lat], "pin");
  });
  state.map.on("click", "stops", (e) => { if (state.view === "route") setBoard(e.features[0].properties.i); });
  state.map.on("mouseenter", "stops", () => (state.map.getCanvas().style.cursor = "pointer"));
  state.map.on("mouseleave", "stops", () => (state.map.getCanvas().style.cursor = ""));
}

// ---------- Arranque ----------
const [net, map] = await Promise.all([loadNetwork(), createMap("map")]);
Object.assign(state, { net, map });
setNetwork(map, net);
bindUi();
markReady();
if (pref.get("pw-welcomed")) {
  setView("home");
  if (pref.get("pw-gps") === "1") { renderHome(); useGps(); } else setOrigin(FALLBACK, "default");
  if (trip.unlocked) startGps();
}
setInterval(frame, 1000);
setInterval(() => state.view === "home" && renderHome(), 60000); // estado de servicio "en servicio / empieza"
