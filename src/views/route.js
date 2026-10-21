// Vista de línea en directo (Localizador modo metro): buses, tiempo en tu parada, subida/bajada,
// tiempo estimado de trayecto, correspondencias y funciones sociales.
import { app, $, esc, go, fly, topbar, badge, posteLabel, cooled, toast, serviceChip } from "../app.js";
import { nearestStop, dirLabel, dayType, secOfDay, connections } from "../network.js";
import { setLine, setStops, setTrip, setBuses, animateArrows, showPopup } from "../map.js";
import { liveEstimate, busesFromScan, scheduledBuses, scheduledPasses, alongFromT, stopIndexFromT, stopIndexFromAlong, tFromAlong, fmtEta, fmtClock, CALIB_BACK } from "../prediction.js";
import { renderStops, renderTimeline } from "../diagram.js";
import { fetchLive, fetchHabits, passesAt, tentative, mergeHabits, liveSignals } from "../crowd.js";
import { trip, startGps, checkIn, board, endRide, cancelCheckin } from "../trip.js";
import { haversine } from "../geo.js";
import { connChips } from "./explore.js";

const POLL_EVERY = 20000, SCAN_FRESH = 180000;
const vehicle = (r) => (r.tram ? "tranvía" : "bus");

export default {
  name: "route",
  snap: "half",
  enter({ routeId, dirIdx = 0, board: b = null, dest = null }) {
    this.route = app.net.byId[routeId];
    this.dirIdx = dirIdx;
    this.open = null;
    this.dest = dest;
    const pos = app.pick?.p || trip.gps?.p;
    this.board = b ?? (pos ? nearestStop(app.net, this.dir(), pos).i : 0);
    this.renderShell();
    this.change(true);
  },
  dir() { return this.route.dirs[this.dirIdx]; },
  geom() { return app.flat ? this.dir().flat : this.dir().real; },

  renderShell() {
    const r = this.route;
    $("sheet-body").innerHTML = `
      <div id="api-banner" class="banner" hidden>Avanza no responde. Mostramos la previsión por hábito (lo observado otros días) y el horario.</div>
      <div id="eta-card">
        <div class="eta-stop"><span class="label">Subes en</span><strong id="stop-name">—</strong><span id="stop-meta" class="meta"></span></div>
        <div class="eta-big"><span id="eta-value">—</span><span id="eta-sub" class="meta"></span></div>
      </div>
      <div class="actions-row">
        <button id="refresh-btn" class="pill cool" data-cool="10" ${r.live ? "" : "hidden"}>↻ Actualizar</button>
        <button id="scan-btn" class="pill cool" data-cool="30" ${r.live ? "" : "hidden"}>Revisar línea</button>
        <span id="scan-meta" class="meta"></span>
      </div>
      <div id="trip-sum" class="trip-sum" hidden></div>
      <p id="signal-note" class="note" hidden></p>
      <div id="extra" class="extra"></div>
      <div class="block">
        <div class="block-title">Recorrido <span class="meta">· toca una parada para subir o bajar · círculos de color = correspondencias</span></div>
        <div id="stops"></div>
      </div>
      <div class="block">
        <div class="block-title">Próxima hora en tu parada</div>
        <div id="timeline"></div>
        <p id="habit-note" class="meta"></p>
      </div>
      <p class="foot meta" id="foot"></p>`;
    cooled($("refresh-btn"), () => { this.poll(); toast("Actualizando poste…"); });
    cooled($("scan-btn"), () => this.scan());
    $("stops").onclick = (e) => this.onStopsClick(e);
    $("extra").onclick = (e) => this.onExtraClick(e);
  },

  renderTop() {
    const r = this.route, l = dirLabel(app.net, r, this.dir());
    topbar(`<button class="icon-btn" data-nav="back" aria-label="Volver">←</button>
      <div class="route-id">${badge(r, "lg")}
        <div class="route-dir"><span class="label">${r.tram ? "Tranvía" : "Línea " + esc(r.short)} · sentido</span>
          <span class="dir-text">${esc(l.from)} <span class="dir-arrow">→</span> <b>${esc(l.to)}</b></span></div></div>
      <button id="swap-btn" class="swap" aria-label="Invertir sentido" ${r.dirs.length < 2 || trip.ride ? "disabled" : ""}><span>⇅</span><small>Invertir</small></button>`);
    $("swap-btn").onclick = () => {
      const p = app.net.stops[this.dir().stops[this.board]].p;
      this.dirIdx = (this.dirIdx + 1) % r.dirs.length;
      this.board = nearestStop(app.net, this.dir(), p).i; this.dest = null; this.open = null;
      this.change(false);
      toast(`Sentido invertido: hacia ${this.dir().headsign}`);
    };
  },

  change(fly) {
    const r = this.route, d = this.dir();
    if (trip.ride && trip.ride.route === r.id && trip.ride.dir === d.dir) { this.board = trip.ride.board; this.dest = trip.ride.dest; }
    Object.assign(app.params, { routeId: r.id, dirIdx: this.dirIdx, board: this.board, dest: this.dest });
    this.poll_ = null; this.scan_ = null; this.habits = []; this.live = { reports: [], trackers: [] };
    this.renderTop();
    this.redraw();
    if (fly) this.center();
    this.load(true);
  },
  redraw() {
    const r = this.route, d = this.dir(), g = this.geom();
    setLine(app.map, r, [g], 0);
    setStops(app.map, app.net, d, g, { board: this.board, dest: this.dest, xfer: (id) => connections(app.net, id, r.id).length > 0 });
    setTrip(app.map, d, g, this.board, this.dest);
    animateArrows(app.map, r, d, g);
    const s = app.net.stops[d.stops[this.board]];
    $("stop-name").textContent = s.name;
    $("stop-meta").textContent = `${posteLabel(app.net, d.stops[this.board])} · parada ${this.board + 1} de ${d.stops.length}`;
    this.frame();
  },
  center() {
    const p = app.net.stops[this.dir().stops[this.board]].p;
    fly({ center: p, zoom: 15, pitch: app.flat ? 0 : 55, bearing: app.flat ? 0 : -18, duration: 1000 });
  },

  setBoard(i) {
    if (trip.ride) return toast("Tienes un viaje en curso");
    this.board = i;
    if (this.dest != null && this.dest <= i) this.dest = null;
    this.open = null;
    Object.assign(app.params, { board: this.board, dest: this.dest });
    this.redraw();
    this.poll_ = null; this.habits = [];
    this.load(false);
  },
  setDest(i) {
    this.dest = i; this.open = null;
    if (trip.ride) trip.ride.dest = i;
    app.params.dest = i;
    this.redraw();
  },

  async load(withScan) {
    const r = this.route, d = this.dir(), code = app.net.stops[d.stops[this.board]].code;
    const [live, habits] = await Promise.all([fetchLive(r, d), r.live ? fetchHabits(r, [code], dayType()) : {}]);
    if (!this.alive(r, d)) return;
    this.live = live; this.habits = habits[code] || [];
    await this.poll();
    if (withScan && r.live) this.scan();
  },
  alive(r, d) { return app.view === this && this.route === r && this.dir() === d; },

  async poll() {
    clearTimeout(this.timer);
    const r = this.route, d = this.dir(), u = this.board;
    if (r.live) {
      const c = Math.max(0, u - CALIB_BACK);
      const get = (i) => fetch(`/api/arrivals?poste=${app.net.stops[d.stops[i]].code}`).then((x) => x.json());
      try {
        const [U, C] = await Promise.all([get(u), c < u ? get(c) : Promise.resolve(null)]);
        this.health = U.health || this.health;
        if (this.alive(r, d) && u === this.board) this.poll_ = { U, C, c, at: Date.now() };
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

    const pollBuses = this.poll_?.U?.ok ? liveEstimate(r, d, u, this.poll_.U.rows, this.poll_.c, this.poll_.C?.rows, this.poll_.at, now) : [];
    const scanBuses = this.scan_ && now - this.scan_.at < SCAN_FRESH ? busesFromScan(net, r, d, this.scan_, now) : [];
    const live = scanBuses.length ? scanBuses : pollBuses;
    const users = app.social ? this.live.trackers.filter((t) => !trip.ride || t.along !== trip.ride.along).map((t) => ({ T: tFromAlong(d, t.along), along: t.along, kind: "user" })) : [];
    const ghosts = live.length || users.length ? [] : scheduledBuses(d, type, nowSec).map((b) => ({ ...b, kind: "schedule" }));
    const me = trip.ride && trip.ride.route === r.id && trip.ride.dir === d.dir && trip.ride.along != null ? [{ along: trip.ride.along, kind: "me", label: "TÚ" }] : [];
    const etaU = (b) => (d.offsets[u] - b.T) * (b.f || 1);
    const all = [...live.map((b) => ({ ...b, kind: "live" })), ...users, ...ghosts].map((b) => ({ ...b, along: b.along ?? alongFromT(d, b.T) }));
    for (const b of all) if (b.kind === "live" && b.T <= d.offsets[u]) { const e = etaU(b); b.label = e < 45 ? "YA" : `${Math.round(e / 60)}'`; }
    setBuses(app.map, this.geom(), [...all, ...me]);

    const etas = d.stops.map((_, j) => {
      const e = live.filter((b) => b.T <= d.offsets[j]).map((b) => (d.offsets[j] - b.T) * (b.f || 1));
      return e.length ? `${Math.max(0, Math.round(Math.min(...e) / 60))}'` : "";
    });
    renderStops($("stops"), net, r, d, {
      board: u, dest: this.dest, etas, open: this.open, locked: !!trip.ride,
      conns: d.stops.map((id) => connChips(id, r.id)),
      buses: [...all, ...me].map((b) => ({ idx: b.T != null ? stopIndexFromT(d, b.T) : stopIndexFromAlong(d, b.along), kind: b.kind, label: b.kind === "me" ? "TÚ" : "" })),
    });

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
    $("api-banner").hidden = !apiDown;

    // Tiempo estimado de trayecto (subida -> bajada)
    const ts = $("trip-sum");
    ts.hidden = this.dest == null;
    if (this.dest != null) {
      const f = pollNext?.calibrated && !pollNext.atHead ? pollNext.f : 1;
      const ride = (d.offsets[this.dest] - d.offsets[u]) * f, stops = this.dest - u;
      const arrive = wait != null ? nowSec + wait + ride : null;
      ts.innerHTML = `<div><span class="label">Trayecto</span><b>≈ ${Math.max(1, Math.round(ride / 60))} min</b> en el ${vehicle(r)} · ${stops} parada${stops > 1 ? "s" : ""}</div>
        <div class="meta">${wait != null ? `+ ${Math.max(0, Math.round(wait / 60))} min de espera · llegas a <b>${esc(net.stops[d.stops[this.dest]].name)}</b> hacia las <b>${fmtClock(arrive)}</b>` : "sin servicio previsto ahora"}${f !== 1 ? ` · ritmo real ×${f.toFixed(2)}` : ""}</div>`;
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
    $("scan-meta").textContent = this.scan_ ? `revisada hace ${Math.round((now - this.scan_.at) / 1000)} s · ${scanBuses.length} ${vehicle(r)}${scanBuses.length === 1 ? "" : "es"}` : "";
    $("foot").textContent = `GTFS ${net.feed} · ${this.poll_?.U?.ok ? `poste actualizado hace ${Math.round((now - this.poll_.at) / 1000)} s` : r.live ? "sin datos de Avanza" : "Tranvía: sólo horario"}`;
    this.renderExtra();
  },

  onStopsClick(e) {
    const j = e.target.closest("[data-jump]");
    if (j) { const [rid, di, idx] = j.dataset.jump.split("|"); return go("route", { routeId: rid, dirIdx: +di, board: +idx }); }
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
    else { this.open = this.open === i ? null : i; this.frame(); }
  },
  // Subo / Bajo aquí también desde el mapa
  onFeature(f) {
    if (f.layer.id !== "stops") return false;
    const i = f.properties.i, d = this.dir(), s = app.net.stops[d.stops[i]];
    if (trip.ride) { if (i > trip.ride.board) this.setDest(i); return true; }
    showPopup(app.map, s.p, `<b>${esc(s.name)}</b><span>${posteLabel(app.net, d.stops[i])}</span>
      <div class="pop-actions"><button data-pop="board">Subo aquí</button>${i > this.board ? `<button data-pop="dest" class="red">Bajo aquí</button>` : ""}<button data-pop="poste" class="ghost">Tiempos</button></div>`,
      (a) => (a === "board" ? this.setBoard(i) : a === "dest" ? this.setDest(i) : go("poste", { id: d.stops[i] })));
    return true;
  },

  // ---------- Funciones sociales ----------
  renderExtra() {
    const el = $("extra"), r = this.route, d = this.dir(), v = vehicle(r), net = app.net;
    if (!app.social) { el.innerHTML = ""; return; }
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
      const rd = trip.ride, mine = rd.route === r.id && rd.dir === d.dir;
      const destId = rd.dest != null ? net.byId[rd.route].dirs.find((x) => x.dir === rd.dir).stops[rd.dest] : null;
      el.innerHTML = `<div class="extra-box ride"><div class="ride-head"><span class="live-dot"></span><b>En ruta${mine ? "" : ` · línea ${esc(net.byId[rd.route].short)}`}</b>
        <span class="badge-status ${rd.status}">${rd.status === "confirmed" ? "Verificado ✓" : "Validando con tu GPS…"}</span></div>
        <span class="meta">${destId ? `Bajas en <b>${esc(net.stops[destId].name)}</b>. Te avisaremos al llegar.` : "Marca en el recorrido o en el mapa dónde te bajas (opcional)."}</span>
        <button class="board" data-x="end">Me he bajado</button></div>`;
      return;
    }
    const near = nearestStop(net, d, trip.gps.p), tol = 60 + Math.min(trip.gps.acc, 40);
    if (trip.checkin && trip.checkin.route === r.id && trip.checkin.dir === d.dir) {
      const s = net.stops[d.stops[trip.checkin.stop]];
      const still = haversine(trip.gps.p, s.p) <= 120 + Math.min(trip.gps.acc, 40);
      el.innerHTML = `<div class="extra-box"><span class="meta">Esperando en <b>${esc(s.name)}</b>${this.dest != null ? ` · bajas en <b>${esc(net.stops[d.stops[this.dest]].name)}</b>` : " · marca dónde te bajas"}</span>
        <button class="board" data-x="board" ${still ? "" : "disabled"}>He cogido el ${v}</button>
        ${still ? "" : `<span class="meta warn">Te has alejado de la parada; vuelve para avisar.</span>`}
        <button class="ghost-btn" data-x="cancel">Ya no espero</button></div>`;
      return;
    }
    const ok = near.d <= tol && trip.gps.acc <= 100;
    el.innerHTML = `<div class="extra-box">
      <button class="board alt" data-x="checkin" data-i="${near.i}" ${ok ? "" : "disabled"}>Estoy en ${esc(net.stops[near.id].name)}</button>
      <span class="meta ${ok ? "" : "warn"}">${ok ? "Avisa cuando estés en la parada; después podrás marcar que has subido." : trip.gps.acc > 100 ? `Precisión del GPS baja (${Math.round(trip.gps.acc)} m). Espera unos segundos.` : `Estás a ${Math.round(near.d)} m de la parada más cercana de esta línea. Acércate para avisar.`}</span>
      <button class="board" disabled title="Primero indica que estás en la parada">He cogido el ${v}</button></div>`;
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
  leave() { clearTimeout(this.timer); },
};
