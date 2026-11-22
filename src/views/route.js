// Vista de línea (Localizador modo metro): explorar la línea con sus dos sentidos y seguirla en directo en la misma
// pantalla. Sin parada elegida se ve la línea entera con sus buses; al tocar una parada se calcula cuándo llega,
// subida/bajada, tiempo de trayecto, otras líneas del poste y funciones sociales.
import { app, $, esc, go, fly, fitTo, snap, topbar, badge, posteLabel, cooled, toast, serviceChip, syncUrl, placeLabel } from "../app.js";
import { plan } from "../planner.js";
import { nearestStop, dirLabel, dayType, secOfDay, connections, stopDone, feedLabel } from "../network.js";
import { setLine, setStops, setTrip, setBuses, animateArrows, showPopup, setMarker, setData, fc, line } from "../map.js";
import { liveEstimate, busesFromScan, scheduledBuses, scheduledPasses, alongFromT, stopIndexFromT, stopIndexFromAlong, tFromAlong, fmtEta, fmtClock, CALIB_BACK } from "../prediction.js";
import { renderStops, renderTimeline } from "../diagram.js";
import { fetchLive, fetchHabits, passesAt, tentative, mergeHabits, liveSignals } from "../crowd.js";
import { trip, startGps, checkIn, board, endRide, cancelCheckin } from "../trip.js";
import { haversine } from "../geo.js";
import { connChips } from "./explore.js";
import { lineTimes } from "./find.js";
import { isFav, toggleFav } from "../saved.js";
import { wait, isWaiting, startWait, stopWait, setAlert, boarded, retryPush, lastBoarded, undoBoarded } from "../wait.js";

const ALERTS = [1, 2, 3, 5, 8, 10];

const POLL_EVERY = 20000, SCAN_FRESH = 180000;
const vehicle = (r) => (r.tram ? "tranvía" : "bus");
const walkSec = (m) => (m * 1.3) / 1.2;
const walkMin = (m) => Math.max(1, Math.round(walkSec(m) / 60));

export default {
  name: "route",
  snap: "half",
  // keepView: no mover la cámara (al saltar a otra línea desde una correspondencia).
  enter({ routeId, dirIdx = 0, board: b = null, dest = null, to = null, keepView = false }) {
    this.to = to; // destino final («Quiero ir aquí»): { p, label }
    this.route = app.net.byId[routeId];
    this.dirIdx = dirIdx;
    this.open = null;
    this.dest = dest;
    this.board = b;
    this.snap = keepView ? null : b == null ? "low" : "half";
    this.renderShell();
    this.change(keepView ? "keep" : b == null ? "line" : "board");
  },
  dir() { return this.route.dirs[this.dirIdx]; },
  geom() { return app.flat ? this.dir().flat : this.dir().real; },

  renderShell() {
    const r = this.route;
    $("sheet-body").innerHTML = `
      <div class="line-meta">${serviceChip(r)}</div>
      ${r.dirs.length > 1 ? `<div class="label seg-title">Dirección</div>
      <div class="dir-seg">${r.dirs.map((d, i) => { const l = dirLabel(app.net, r, d); return `<button data-dir="${i}"><small>${esc(l.from)}</small><b>→ ${esc(l.to)}</b></button>`; }).join("")}</div>` : ""}
      <div id="api-banner" class="banner" hidden>Avanza no responde. Mostramos la previsión por hábito (lo observado otros días) y el horario.</div>
      <p id="pick-hint" class="pick-hint">Toca una parada en el recorrido o en el mapa para ver cuándo llega el ${vehicle(r)} y marcar dónde subes.</p>
      <div class="stop-part">
      <div id="eta-card">
        <div class="eta-stop"><span class="label">Subes en</span><strong id="stop-name">—</strong><span id="stop-meta" class="meta"></span>
          <button class="star-line" id="line-fav" aria-pressed="false">☆ Guardar en favoritos</button></div>
        <div class="eta-big"><span id="eta-value">—</span><span id="eta-sub" class="meta"></span></div>
      </div>
      <div id="wait-box" class="wait-box"></div>
      <div id="to-box" class="to-box" hidden></div>
      <div id="trip-sum" class="trip-sum" hidden></div>
      <div class="others"><div class="block-title">Otras líneas en este poste</div><div id="others" class="poste-card flat"></div></div>
      <p id="signal-note" class="note" hidden></p>
      </div>
      <div class="actions-row">
        <button id="refresh-btn" class="pill cool stop-only" data-cool="10" ${r.live ? "" : "hidden"}>↻ Actualizar poste</button>
        <button id="scan-btn" class="pill cool" data-cool="30" ${r.live ? "" : "hidden"}>Revisar línea</button>
        <span id="scan-meta" class="meta"></span>
      </div>
      <div id="extra" class="extra"></div>
      <div class="block">
        <div class="block-title">Recorrido <span class="meta">· toca una parada para subir o bajar · círculos de color = correspondencias</span></div>
        <div id="stops"></div>
      </div>
      <div class="block stop-part">
        <div class="block-title">Próxima hora en tu parada</div>
        <div id="timeline"></div>
        <p id="habit-note" class="meta"></p>
      </div>
      <p class="foot meta" id="foot"></p>`;
    cooled($("refresh-btn"), () => { this.poll(); toast("Actualizando poste…"); });
    cooled($("scan-btn"), () => this.scan());
    $("stops").onclick = (e) => this.onStopsClick(e);
    $("sheet-body").querySelector(".dir-seg")?.addEventListener("click", (e) => { const b = e.target.closest("[data-dir]"); if (b) this.switchDir(+b.dataset.dir); });
    $("others").onclick = (e) => { const row = e.target.closest(".lt-row"); if (row) go("route", { routeId: row.dataset.route, dirIdx: +row.dataset.dir, board: +row.dataset.idx, keepView: true }); };
    $("extra").onclick = (e) => this.onExtraClick(e);
    $("wait-box").onclick = (e) => this.onWaitClick(e);
    $("to-box").onclick = (e) => this.onToClick(e);
    $("wait-box").onchange = (e) => { if (e.target.id === "wait-alert") setAlert(+e.target.value); };
    $("line-fav").onclick = () => { toggleFav(this.favItem()); this.paintFav(); };
  },

  // Cabecera: siempre a la vista el nombre de la línea y el sentido elegido.
  renderTop() {
    const r = this.route;
    topbar(`<button class="icon-btn" data-nav="back" aria-label="Volver">←</button>
      <div class="route-id">${badge(r, "lg")}
        <div class="route-dir"><span class="label">${r.tram ? "Tranvía" : "Línea " + esc(r.short)} · ${esc(r.long)}</span>
          <span class="dir-text"><span class="dir-arrow">→</span> <b>${esc(this.dir().headsign)}</b></span></div></div>
      <button class="icon-btn" data-nav="home" aria-label="Menú principal">☰</button>`);
    for (const b of document.querySelectorAll(".dir-seg button")) { b.classList.toggle("on", +b.dataset.dir === this.dirIdx); b.disabled = !!trip.ride; }
  },
  // Cambio de sentido sin mover la cámara: la parada elegida pasa a la más cercana del otro sentido.
  switchDir(i) {
    if (i === this.dirIdx || trip.ride) return;
    const p = this.board != null ? app.net.stops[this.dir().stops[this.board]].p : null;
    this.dirIdx = i;
    this.board = p ? nearestStop(app.net, this.dir(), p).i : null;
    this.dest = null; this.open = null;
    this.change("keep");
  },

  change(mode) {
    const r = this.route, d = this.dir();
    if (trip.ride && trip.ride.route === r.id && trip.ride.dir === d.dir) { this.board = trip.ride.board; this.dest = trip.ride.dest; }
    else this.computeTo();
    Object.assign(app.params, { routeId: r.id, dirIdx: this.dirIdx, board: this.board, dest: this.dest, to: this.to });
    syncUrl();
    this.poll_ = null; this.scan_ = null; this.habits = []; this.live = { reports: [], trackers: [] };
    this.renderTop();
    this.redraw();
    if (mode === "board") { if (this.to) this.fitTo(); else this.center(); }
    if (mode === "line") this.fitLine();
    this.load(true);
  },
  redraw() {
    const r = this.route, d = this.dir(), g = this.geom();
    setLine(app.map, r, r.dirs.map((x) => (app.flat ? x.flat : x.real)), this.dirIdx);
    const type = dayType(), now = secOfDay();
    setStops(app.map, app.net, d, g, { board: this.board, dest: this.dest, xfer: (id) => connections(app.net, id, r.id).length > 0, off: (j) => stopDone(d, type, j, now) });
    setTrip(app.map, d, g, this.board, this.dest);
    animateArrows(app.map, r, d, g);
    this.drawTo();
    const has = this.board != null;
    $("sheet-body").classList.toggle("no-stop", !has);
    if (has) {
      const s = app.net.stops[d.stops[this.board]];
      $("stop-name").textContent = s.name;
      $("stop-meta").textContent = `${posteLabel(app.net, d.stops[this.board])} · parada ${this.board + 1} de ${d.stops.length}`;
      this.paintFav();
    }
    this.frame();
  },
  // Favorito = esta línea, en este sentido, en tu parada (en el inicio se ve su próximo bus).
  favItem() { return { t: "linea", routeId: this.route.id, dirIdx: this.dirIdx, board: this.board }; },
  paintFav() {
    const on = isFav(this.favItem()), b = $("line-fav");
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
    b.textContent = on ? "★ En favoritos" : "☆ Guardar en favoritos";
  },
  center() {
    if (this.board == null) return this.fitLine();
    const p = app.net.stops[this.dir().stops[this.board]].p;
    fly({ center: p, zoom: 15, pitch: app.flat ? 0 : 55, bearing: app.flat ? 0 : -18, duration: 1000 });
  },
  fitLine() {
    const c = this.geom().coords, lons = c.map((p) => p[0]), lats = c.map((p) => p[1]);
    if (innerWidth < 900) snap("low");
    fitTo([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { duration: 900 });
  },

  setBoard(i) {
    if (trip.ride) return toast("Tienes un viaje en curso");
    this.board = i;
    if (this.dest != null && this.dest <= i) this.dest = null;
    this.open = null;
    this.computeTo();
    Object.assign(app.params, { board: this.board, dest: this.dest });
    syncUrl();
    this.redraw();
    this.poll_ = null; this.habits = [];
    this.load(false);
  },
  setDest(i) {
    this.dest = i; this.open = null;
    if (trip.ride) trip.ride.dest = i;
    app.params.dest = i;
    syncUrl();
    this.redraw();
  },

  async load(withScan) {
    const r = this.route, d = this.dir(), code = this.board != null ? app.net.stops[d.stops[this.board]].code : null;
    const [live, habits] = await Promise.all([fetchLive(r, d), r.live && code ? fetchHabits(r, [code], dayType()) : {}]);
    if (!this.alive(r, d)) return;
    this.live = live; this.habits = habits[code] || [];
    await this.poll();
    if (withScan && r.live) this.scan();
  },
  alive(r, d) { return app.view === this && this.route === r && this.dir() === d; },

  async poll() {
    clearTimeout(this.timer);
    const r = this.route, d = this.dir(), u = this.board;
    if (r.live && u != null) {
      const c = Math.max(0, u - CALIB_BACK);
      const get = (i) => fetch(`/api/arrivals?poste=${app.net.stops[d.stops[i]].code}`).then((x) => x.json());
      try {
        const [U, C] = await Promise.all([get(u), c < u ? get(c) : Promise.resolve(null)]);
        this.health = U.health || this.health;
        if (this.alive(r, d) && u === this.board) this.poll_ = { U, C, c, at: Date.now() };
        // Primera predicción vista en esta parada (para comparar luego con la subida real).
        const m0 = U.ok ? U.rows.filter((x) => x.line === r.short.toUpperCase() && x.min != null).map((x) => x.min).sort((a, b) => a - b)[0] : undefined;
        if (m0 != null && this.firstSeen?.u !== u) this.firstSeen = { u, min: m0, at: Date.now() };
      } catch { this.health = { up: false }; }
    }
    if (app.social) fetchLive(r, d).then((l) => { if (this.alive(r, d)) this.live = l; });
    this.frame();
    if (app.view === this) this.timer = setTimeout(() => this.poll(), POLL_EVERY);
  },
  async scan() {
    const r = this.route, d = this.dir();
    $("scan-meta").textContent = "revisando…";
    try {
      const res = await (await fetch(`/api/scan?linea=${encodeURIComponent(r.short)}&postes=${d.stops.map((id) => app.net.stops[id].code).join(",")}`)).json();
      if (!this.alive(r, d)) return;
      if (!res.ok) { this.health = { up: false }; toast("Avanza no responde ahora mismo"); }
      this.scan_ = res.ok ? res : null;
    } catch { this.health = { up: false }; }
    this.frame();
  },

  frame() {
    if (app.view !== this || !$("stops")) return;
    const r = this.route, d = this.dir(), u = this.board, now = Date.now(), nowSec = secOfDay(), type = dayType(), net = app.net;
    const apiDown = r.live && this.health && !this.health.up;

    const has = u != null;
    const pollBuses = has && this.poll_?.U?.ok ? liveEstimate(r, d, u, this.poll_.U.rows, this.poll_.c, this.poll_.C?.rows, this.poll_.at, now) : [];
    const scanBuses = this.scan_ && now - this.scan_.at < SCAN_FRESH ? busesFromScan(net, r, d, this.scan_, now) : [];
    const live = scanBuses.length ? scanBuses : pollBuses;
    const users = app.social ? this.live.trackers.filter((t) => !trip.ride || t.along !== trip.ride.along).map((t) => ({ T: tFromAlong(d, t.along), along: t.along, kind: "user" })) : [];
    const ghosts = live.length || users.length ? [] : scheduledBuses(d, type, nowSec).map((b) => ({ ...b, kind: "schedule" }));
    const me = trip.ride && trip.ride.route === r.id && trip.ride.dir === d.dir && trip.ride.along != null ? [{ along: trip.ride.along, kind: "me", label: "TÚ" }] : [];
    const etaU = (b) => (d.offsets[u] - b.T) * (b.f || 1);
    const all = [...live.map((b) => ({ ...b, kind: "live" })), ...users, ...ghosts].map((b) => ({ ...b, along: b.along ?? alongFromT(d, b.T) }));
    if (has) for (const b of all) if (b.kind === "live" && b.T <= d.offsets[u]) { const e = etaU(b); b.label = e < 45 ? "YA" : `${Math.round(e / 60)}'`; }
    setBuses(app.map, this.geom(), [...all, ...me]);

    const etas = d.stops.map((_, j) => {
      const e = live.filter((b) => b.T <= d.offsets[j]).map((b) => (d.offsets[j] - b.T) * (b.f || 1));
      return e.length ? `${Math.max(0, Math.round(Math.min(...e) / 60))}'` : "";
    });
    renderStops($("stops"), net, r, d, {
      board: u, dest: this.dest, etas, open: this.open, locked: !!trip.ride, off: d.stops.map((_, j) => stopDone(d, type, j, nowSec)),
      conns: d.stops.map((id) => connChips(id, r.id)),
      buses: [...all, ...me].map((b) => ({ idx: b.T != null ? stopIndexFromT(d, b.T) : stopIndexFromAlong(d, b.along), kind: b.kind, label: b.kind === "me" ? "TÚ" : "" })),
    });
    $("scan-meta").textContent = this.scan_ ? `revisada hace ${Math.round((now - this.scan_.at) / 1000)} s · ${scanBuses.length} ${vehicle(r)}${scanBuses.length === 1 ? "" : "es"}` : "";
    $("api-banner").hidden = !apiDown;
    if (!has) {
      $("foot").textContent = `${feedLabel(net, r)} · ${r.live ? "buses según la última revisión de la línea" : "Tranvía: sólo horario"}`;
      return this.renderExtra();
    }

    // Otras líneas que paran en este mismo poste, con sus tiempos (Avanza devuelve todas las líneas del poste).
    const others = lineTimes(net, d.stops[u], this.poll_?.U?.rows).filter((x) => x.route.id !== r.id);
    $("others").parentElement.hidden = !others.length;
    $("others").innerHTML = others.map((x) => x.html).join("");

    const passes = app.social ? passesAt(this.live.reports, d, u) : [];
    const habit = mergeHabits(this.habits, tentative(passes, type));
    const signals = app.social ? liveSignals(passes, u, now) : [];

    // Tarjeta principal
    const pollNext = pollBuses[0];
    const liveNext = pollNext ? pollNext.eta : Math.min(...live.filter((b) => b.T <= d.offsets[u]).map(etaU), Infinity);
    const schedNext = scheduledPasses(d, type, u, nowSec, 3 * 3600)[0];
    const habitNext = habit.find((h) => h.sec >= nowSec - 60);
    let wait = null, sub;
    if (liveNext !== Infinity) {
      wait = liveNext;
      $("eta-value").textContent = fmtEta(liveNext);
      const away = Math.max(0, Math.ceil(u - stopIndexFromT(d, d.offsets[u] - liveNext)));
      sub = `${pollNext?.atHead ? "aún en cabecera" : away ? `a ${away} parada${away > 1 ? "s" : ""}` : "en tu parada"} · Avanza${pollNext ? `: ${pollNext.raw === 0 ? "en parada" : pollNext.raw + " min"}` : " (revisión)"}`;
    } else if (apiDown && habitNext) {
      wait = habitNext.sec - nowSec;
      $("eta-value").textContent = fmtEta(wait);
      sub = `previsión por hábito · suele pasar ${fmtClock(habitNext.sec)}`;
    } else if (schedNext !== undefined) {
      wait = schedNext - nowSec;
      $("eta-value").textContent = fmtEta(wait);
      sub = `${r.live ? (apiDown ? "Avanza caída" : "sin bus en vivo") : "tranvía · sin dato en vivo"} · horario ${fmtClock(schedNext)}`;
    } else { $("eta-value").textContent = "—"; sub = serviceChip(r).replace(/<[^>]+>/g, ""); }
    $("eta-sub").textContent = sub;
    this.renderWait();

    // Tiempo estimado de trayecto (subida -> bajada)
    const ts = $("trip-sum");
    ts.hidden = this.dest == null;
    if (this.dest != null) {
      const f = pollNext?.calibrated && !pollNext.atHead ? pollNext.f : 1;
      const ride = (d.offsets[this.dest] - d.offsets[u]) * f, stops = this.dest - u;
      const t = this.toPlan, walkEnd = t && !t.second && t.endWalk != null ? walkSec(t.endWalk) : 0;
      const arrive = wait != null ? nowSec + wait + ride + walkEnd : null;
      ts.innerHTML = `<div><span class="label">Trayecto</span><b>≈ ${Math.max(1, Math.round(ride / 60))} min</b> en el ${vehicle(r)} · ${stops} parada${stops > 1 ? "s" : ""}</div>
        <div class="meta">${wait != null ? `+ ${Math.max(0, Math.round(wait / 60))} min de espera · llegas a <b>${esc(net.stops[d.stops[this.dest]].name)}</b> hacia las <b>${fmtClock(arrive)}</b>` : "sin servicio previsto ahora"}${walkEnd ? ` + ${walkMin(t.endWalk)} min andando` : ""}${f !== 1 ? ` · ritmo real ×${f.toFixed(2)}` : ""}</div>`;
    }

    const sig = signals[0];
    $("signal-note").hidden = !sig;
    if (sig) {
      const diff = liveNext !== Infinity ? Math.round((now + liveNext * 1000 - sig.at) / 60000) : 0;
      $("signal-note").innerHTML = `<b>Señal de usuario:</b> alguien subió en ${esc(net.stops[d.stops[sig.k]].name)} → aquí hacia las ${fmtClock(secOfDay(new Date(sig.at)))}` +
        (diff ? ` · ${Math.abs(diff)} min ${diff > 0 ? "antes" : "después"} de lo que marca Avanza` : "");
    }

    renderTimeline($("timeline"), r, nowSec, 3600, {
      live: live.filter((b) => b.T <= d.offsets[u]).map((b) => nowSec + etaU(b)),
      sched: scheduledPasses(d, type, u, nowSec, 3600),
      habit,
      users: app.social ? [...signals.map((s) => secOfDay(new Date(s.at))), ...users.filter((b) => b.T <= d.offsets[u]).map((b) => nowSec + etaU(b))] : null,
    });
    $("habit-note").textContent = habit.length
      ? `Hábito observado en esta parada: ${habit.slice(0, 8).map((h) => fmtClock(h.sec)).join(" · ")}${habit.length > 8 ? "…" : ""}`
      : "Aún no hay hábito observado aquí (el sistema aprende con los snapshots diarios).";
    $("foot").textContent = `${feedLabel(net, r)} · ${this.poll_?.U?.ok ? `poste actualizado hace ${Math.round((now - this.poll_.at) / 1000)} s` : r.live ? "sin datos de Avanza" : "Tranvía: sólo horario"}`;
    this.renderExtra();
  },

  onStopsClick(e) {
    const j = e.target.closest("[data-jump]");
    if (j) { const [rid, di, idx] = j.dataset.jump.split("|"); return go("route", { routeId: rid, dirIdx: +di, board: +idx, keepView: true }); }
    const act = e.target.closest("[data-act]");
    if (act) {
      const i = +act.dataset.i;
      if (act.dataset.act === "board") this.setBoard(i);
      if (act.dataset.act === "dest") this.setDest(i);
      if (act.dataset.act === "nodest") this.setDest(null);
      return;
    }
    const row = e.target.closest(".row"); if (!row) return;
    const i = +row.dataset.i;
    if (trip.ride) { if (i > trip.ride.board) this.setDest(i); }
    else if (this.board == null) this.setBoard(i); // la primera parada tocada es la subida
    else { this.open = this.open === i ? null : i; this.frame(); }
  },
  // Subo / Bajo aquí también desde el mapa
  onFeature(f) {
    if (f.layer.id !== "stops") return false;
    const i = f.properties.i, d = this.dir(), s = app.net.stops[d.stops[i]];
    if (trip.ride) { if (i > trip.ride.board) this.setDest(i); return true; }
    if (this.board == null) { this.setBoard(i); return true; }
    showPopup(app.map, s.p, `<b>${esc(s.name)}</b><span>${posteLabel(app.net, d.stops[i])}</span>
      <div class="pop-actions"><button data-pop="board">Subo aquí</button>${i > this.board ? `<button data-pop="dest" class="red">Bajo aquí</button>` : ""}</div>`,
      (a) => (a === "board" ? this.setBoard(i) : this.setDest(i)));
    return true;
  },

  // ---------- «Quiero ir aquí»: destino final desde tu parada ----------
  // Con un destino, la línea propone dónde bajarte (y el transbordo si hace falta), dibuja el tramo a pie y sugiere
  // alternativas desde tu poste (otras líneas que te dejan antes, con o sin transbordo).
  canPickGo() { return this.board != null && !trip.ride; },
  pickGo(k) {
    this.to = { p: k.p, label: placeLabel(app.net, k.p) };
    this.dest = null;
    this.computeTo();
    Object.assign(app.params, { dest: this.dest, to: this.to });
    syncUrl();
    this.redraw();
    this.fitTo();
  },
  computeTo() {
    this.toPlan = null;
    if (!this.to || this.board == null) return;
    const net = app.net, r = this.route, d = this.dir(), from = net.stops[d.stops[this.board]].p;
    const opts = plan(net, from, this.to.p).options;
    const mine = opts.find((o) => o.legs[0].route === r && o.legs[0].dirIdx === this.dirIdx && o.legs[0].to > this.board) || null;
    let dest = null, endWalk = null;
    if (mine) { dest = mine.legs[0].to; endWalk = mine.endWalk; }
    else { // el planificador prefiere otras líneas: aun así, la parada de esta línea más cercana al destino
      let bd = Infinity;
      for (let j = this.board + 1; j < d.stops.length; j++) { const x = haversine(net.stops[d.stops[j]].p, this.to.p); if (x < bd) { bd = x; dest = j; } }
      if (bd > 900) dest = null; else endWalk = bd;
    }
    this.dest = dest;
    this.toPlan = { opts, mine, second: mine?.legs[1] || null, endWalk, direct: haversine(from, this.to.p) };
  },
  fitTo() {
    const net = app.net, d = this.dir(), pts = [net.stops[d.stops[this.board]].p, this.to.p];
    if (this.dest != null) pts.push(net.stops[d.stops[this.dest]].p);
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    fitTo([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { duration: 900, maxZoom: 16 });
  },
  drawTo() {
    const net = app.net, t = this.toPlan, d = this.dir(), box = $("to-box");
    setMarker(app.map, "B", this.to?.p || null, { className: "pin-ab b", text: "B" });
    box.hidden = !this.to || this.board == null;
    if (box.hidden || !t) { setData(app.map, "plan"); return; }
    // Mapa: (transbordo) + tramo a pie hasta el destino.
    const feats = [];
    let last = this.dest != null ? net.stops[d.stops[this.dest]].p : null;
    if (t.second) {
      const l = t.second, d2 = l.route.dirs[l.dirIdx], g = d2.real, pts = [];
      feats.push(line([last, net.stops[d2.stops[l.from]].p], { kind: "walk" }));
      for (let a = d2.along[l.from]; a < d2.along[l.to]; a += 25) pts.push(g.at(a));
      pts.push(g.at(d2.along[l.to]));
      feats.push(line(pts, { kind: "ride", color: l.route.color }));
      last = net.stops[d2.stops[l.to]].p;
    }
    if (last) feats.push(line([last, this.to.p], { kind: "walk" }));
    setData(app.map, "plan", fc(feats));
    // Panel: cómo llegas con esta línea y alternativas desde tu poste.
    const r = this.route, boardId = d.stops[this.board];
    const destName = this.dest != null ? esc(net.stops[d.stops[this.dest]].name) : "";
    let how;
    if (t.second) {
      const l = t.second, d2 = l.route.dirs[l.dirIdx];
      how = `Bajas en <b>${destName}</b>, coges la ${badge(l.route, "xs")} hasta <b>${esc(net.stops[d2.stops[l.to]].name)}</b> y andas ${walkMin(t.endWalk)} min · ≈ ${Math.round(t.mine.total / 60)} min en total`;
    } else if (this.dest != null) how = `Bajas en <b>${destName}</b> y andas ${walkMin(t.endWalk)} min (${Math.round(t.endWalk / 10) * 10} m)`;
    else how = `La ${esc(r.short)} no te acerca a ese punto desde aquí: mira las alternativas.`;
    const alts = t.opts.filter((o) => o !== t.mine).slice(0, 3);
    const best = t.mine?.total ?? t.opts[0]?.total ?? Infinity, walkBetter = walkSec(t.direct) <= best;
    const altRow = (o) => {
      const i = t.opts.indexOf(o), l0 = o.legs[0], off = l0.fromStop !== boardId;
      return `<button class="alt-row" data-alt="${i}"><span class="alt-legs">${o.legs.map((l, k) => `${k ? "<small>⇄</small>" : ""}${badge(l.route, "xs")}`).join("")}</span>
        <span class="alt-main"><b>≈ ${Math.round(o.total / 60)} min · llegas ~${fmtClock(o.arrive)}</b>
        <small>${o.legs.length > 1 ? "1 transbordo" : "directo"}${off ? ` · desde ${esc(net.stops[l0.fromStop].name)} (${Math.round(l0.walk)} m)` : " · desde tu poste"}</small></span><span aria-hidden="true">›</span></button>`;
    };
    box.innerHTML = `<div class="to-head"><span class="od-dot dest">B</span><span class="to-main"><small>Vas a</small><b>${esc(this.to.label)}</b></span>
        <button class="link-btn" data-to="clear">Quitar</button></div>
      <p class="to-how">${walkBetter ? `<b>Te compensa ir andando: ≈ ${walkMin(t.direct)} min</b> (${Math.round(t.direct * 1.3 / 10) * 10} m). ` : ""}${how}${!walkBetter && t.direct < 1200 ? ` · o andando ≈ ${walkMin(t.direct)} min` : ""}</p>
      ${alts.length ? `<div class="block-title">Alternativas desde aquí</div>${alts.map(altRow).join("")}` : ""}`;
  },
  onToClick(e) {
    if (e.target.closest("[data-to=clear]")) {
      this.to = null; this.toPlan = null;
      Object.assign(app.params, { to: null });
      syncUrl(); this.redraw(); return;
    }
    const a = e.target.closest("[data-alt]");
    if (!a) return;
    const o = this.toPlan.opts[+a.dataset.alt], l = o.legs[0];
    go("route", { routeId: l.route.id, dirIdx: l.dirIdx, board: l.from, dest: l.to, to: this.to });
  },

  // ---------- «Estoy esperando» y «He subido» ----------
  // Sólo se repinta al cambiar de estado (para no cerrar el desplegable del aviso). La cuenta atrás es el tiempo grande.
  renderWait() {
    const el = $("wait-box"), r = this.route, on = isWaiting(r.id, this.dirIdx, this.board), w = wait.cur;
    const lb = lastBoarded(), here = lb && lb.routeId === r.id && lb.dir === this.dir().dir && lb.stopId === this.dir().stops[this.board];
    const key = [r.live, on, w?.push, w?.alertMin, app.social, !!trip.ride, w && !on ? w.routeId : "", here ? lb.id : ""].join("|");
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      const pushMsg = !on ? "" : { on: "Te avisaremos con una notificación aunque cambies de app.", denied: "Notificaciones bloqueadas: sólo te avisaremos con la app abierta. Actívalas en los ajustes del navegador para este sitio.",
        unsupported: "Este navegador no permite notificaciones aquí (en iPhone, añade la web a la pantalla de inicio). Te avisaremos con la app abierta.",
        error: "No se pudieron activar las notificaciones.", off: "Activando notificaciones…" }[w.push] || "";
      // «He subido» → gris «Subido ✓» (viaje empezado). Otro toque = «Entrada incorrecta»: se borra y vuelve a rojo.
      const boardBtn = !app.social ? "" : here
        ? `<button class="board done" data-w="undo" aria-pressed="true">Subido ✓<small>¿error? toca para deshacer</small></button>`
        : trip.ride ? "" : `<button class="board" data-w="boarded" aria-pressed="false">He subido</button>`;
      el.innerHTML = !r.live ? boardBtn && `<div class="wait-row">${boardBtn}</div>` : on
        ? `<div class="wait-on"><div class="wait-head"><span class="live-dot"></span><b>Esperando</b><span class="meta">· la cuenta atrás te sigue en las demás pantallas</span></div>
            <label class="wait-alert">Avisarme cuando falten <select id="wait-alert">${ALERTS.map((m) => `<option value="${m}" ${m === w.alertMin ? "selected" : ""}>${m} min</option>`).join("")}</select></label>
            <span class="meta ${w.push === "on" ? "" : "warn"}">${pushMsg}${w.push === "error" ? ` <button class="link-btn" data-w="retry">Reintentar</button>` : ""}</span>
            <div class="wait-row">${boardBtn}<button class="ghost-btn" data-w="stop">Ya no espero</button></div></div>`
        : `<div class="wait-row"><button class="board alt" data-w="start">⏱ Esperar y avisarme</button>${boardBtn}</div>
           ${w ? `<span class="meta">Ahora esperas la ${esc(w.line)} en ${esc(w.stopName)}; empezar aquí la sustituye.</span>` : ""}`;
    }
  },
  async onWaitClick(e) {
    const b = e.target.closest("[data-w]"); if (!b) return;
    const r = this.route, d = this.dir(), a = b.dataset.w;
    try {
      if (a === "start") {
        const st = await startWait(app.net, r, this.dirIdx, this.board);
        toast(st === "on" ? "Te avisaremos cuando llegue" : "Esperando: te avisaremos con la app abierta");
      }
      if (a === "stop") stopWait();
      if (a === "retry") retryPush();
      if (a === "boarded") await this.onBoarded();
      if (a === "undo") {
        await undoBoarded();
        if (trip.ride) { await endRide(); this.renderTop(); }
        toast("Entrada incorrecta: subida borrada");
      }
    } catch (err) { toast(err.message); }
    this.frame();
  },
  // Un toque: se guarda la subida (y lo que marcaba Avanza). Si las funciones extra están activas y estás en la
  // parada, además arranca el viaje verificado por GPS de siempre.
  async onBoarded() {
    const r = this.route, d = this.dir(), u = this.board, stopId = d.stops[u];
    const res = await boarded({ route: r, dir: d, stopId, gps: trip.gps, waitedSince: wait.cur?.stopId === stopId ? wait.cur.since : null, first: this.firstSeen?.u === u ? this.firstSeen : null });
    if (trip.unlocked && trip.gps) { try { await checkIn(r, d, u); await board(r, d, this.dest); this.renderTop(); } catch { /* lejos de la parada: queda sólo la subida */ } }
    const m = res.avanzaMin;
    toast(m == null ? "Subida anotada, ¡gracias!" : m <= 1 ? "Subida anotada · Avanza acertó" : `Subida anotada · Avanza aún marcaba ${m} min`);
  },

  // ---------- Funciones sociales ----------
  renderExtra() {
    const el = $("extra"), r = this.route, d = this.dir(), net = app.net;
    if (!app.social) { el.innerHTML = ""; return; }
    if (trip.ride) {
      const rd = trip.ride, mine = rd.route === r.id && rd.dir === d.dir;
      const destId = rd.dest != null ? net.byId[rd.route].dirs.find((x) => x.dir === rd.dir).stops[rd.dest] : null;
      el.innerHTML = `<div class="extra-box ride"><div class="ride-head"><span class="live-dot"></span><b>En ruta${mine ? "" : ` · línea ${esc(net.byId[rd.route].short)}`}</b>
        <span class="badge-status ${rd.status}">${rd.status === "confirmed" ? "Verificado ✓" : "Validando con tu GPS…"}</span></div>
        <span class="meta">${destId ? `Bajas en <b>${esc(net.stops[destId].name)}</b>. Te avisaremos al llegar.` : "Marca en el recorrido o en el mapa dónde te bajas (opcional)."}</span>
        <button class="board" data-x="end">Me he bajado</button></div>`;
      return;
    }
    // «He subido» está junto al tiempo de llegada; aquí sólo se ofrece verificarlo con la ubicación.
    if (!trip.unlocked) {
      el.innerHTML = this.board == null ? "" : `<div class="extra-wall"><div><b>Verifica tus subidas</b><span class="meta">Con tu ubicación comprobamos que subes de verdad y seguimos el bus contigo. Anónimo.</span></div><button class="cta small" data-x="wall">Ver</button></div>`;
      return;
    }
    el.innerHTML = trip.gps ? "" : `<div class="extra-box"><span class="meta">${trip.gpsError || "Buscando tu ubicación…"} Sin ubicación tus subidas cuentan como no verificadas.</span>
      <button class="ghost-btn" data-x="gps">Reintentar ubicación</button></div>`;
  },
  async onExtraClick(e) {
    const b = e.target.closest("[data-x]"); if (!b) return;
    const r = this.route, d = this.dir();
    try {
      if (b.dataset.x === "wall") $("extra-dlg").showModal();
      if (b.dataset.x === "gps") await startGps();
      if (b.dataset.x === "checkin") { this.setBoard(+b.dataset.i); await checkIn(r, d, +b.dataset.i); toast("Anotado: estás en la parada"); }
      if (b.dataset.x === "board") { await board(r, d, this.dest); toast(`Buen viaje. Validamos con tu GPS que vas en el ${vehicle(r)}`); this.renderTop(); }
      if (b.dataset.x === "cancel") cancelCheckin();
      if (b.dataset.x === "end") { const res = await endRide(); toast(res?.status === "confirmed" ? "¡Gracias! Tu viaje ayuda a predecir el bus" : "Viaje no verificado: no se ha guardado"); this.renderTop(); }
    } catch (err) { toast(err.message); }
    this.frame();
  },
  leave() { clearTimeout(this.timer); setMarker(app.map, "B", null); },
};
