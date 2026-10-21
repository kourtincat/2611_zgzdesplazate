// Ubicar parada: por distancia (GPS o punto del mapa), por número de poste / nombre, o por ruta.
import { app, $, esc, go, fly, simpleTop, locate, myPos, badge, posteLabel, arrivals, cooled, setPick, serviceChip } from "../app.js";
import { stopsNear, dayType, secOfDay } from "../network.js";
import { setPostes } from "../map.js";
import { scheduledPasses, fmtClock } from "../prediction.js";

const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Filas "línea → destino · tiempos" de un poste. rows = respuesta de Avanza (todas las líneas del poste).
export function lineTimes(net, stopId, rows) {
  const type = dayType(), now = secOfDay();
  return net.byStop[stopId].map(({ route, dirIdx, idx }) => {
    const d = route.dirs[dirIdx];
    const live = (rows || []).filter((r) => r.line === route.short.toUpperCase()).map((r) => r.min).filter((m) => m !== null).sort((a, b) => a - b);
    let t;
    if (live.length) t = live.slice(0, 2).map((m) => `<b class="live">${m === 0 ? "YA" : m + "'"}</b>`).join(" · ");
    else {
      const next = scheduledPasses(d, type, idx, now, 2 * 3600).slice(0, 2);
      t = next.length ? `<span class="sched">hor. ${next.map(fmtClock).join(" · ")}</span>` : `<span class="sched">sin servicio</span>`;
    }
    return { route, dirIdx, idx, html: `<div class="lt-row" data-route="${route.id}" data-dir="${dirIdx}" data-idx="${idx}">${badge(route)}<span class="lt-dest">→ ${esc(d.headsign)}</span><span class="lt-time">${t}</span></div>` };
  });
}

export default {
  name: "find",
  snap: "half",
  enter(params) {
    simpleTop("Ubicar parada", "Localizador");
    this.tab = params.tab || "dist";
    $("sheet-body").innerHTML = `
      <div class="tabs" role="tablist">
        <button data-tab="dist">Por distancia</button><button data-tab="code">Por código</button><button data-tab="route">Por ruta</button>
      </div>
      <div id="find-body"></div>`;
    $("sheet-body").querySelector(".tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) { this.tab = b.dataset.tab; app.params.tab = this.tab; this.render(); } };
    this.render();
  },
  render() {
    for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("on", b.dataset.tab === this.tab);
    setPostes(app.map, []);
    $("find-body").onclick = null;
    ({ dist: () => this.renderDist(), code: () => this.renderCode(), route: () => this.renderRoute() })[this.tab]();
  },

  // ---- Por distancia ----
  async renderDist() {
    const el = $("find-body"), p = app.params.point || myPos();
    if (!p) {
      el.innerHTML = `<div class="empty"><p>Usa tu ubicación o toca el mapa para ver los postes cercanos.</p><button class="cta" id="find-gps">Usar mi ubicación</button></div>`;
      $("find-gps").onclick = async () => { if (await locate()) this.render(); };
      return;
    }
    const near = stopsNear(app.net, p, 600, 10);
    const net = app.net;
    el.innerHTML = `<div class="list-head"><span class="meta">${near.length} postes a menos de 600 m ${app.params.point ? "del punto elegido" : "de ti"}</span>
      <button class="pill cool" id="find-refresh" data-cool="10">↻ Actualizar</button></div>
      <div id="near-postes">${near.map((s) => this.card(s, null)).join("") || `<p class="meta">No hay paradas cerca. Prueba otro punto.</p>`}</div>`;
    setPostes(app.map, near.map((s, i) => ({ id: s.id, p: net.stops[s.id].p, label: net.stops[s.id].tram ? net.stops[s.id].name : String(net.stops[s.id].code), sel: i === 0 })));
    if (!this._fitted) { fly({ center: p, zoom: 16, pitch: app.flat ? 0 : 50 }); this._fitted = true; }
    cooled($("find-refresh"), () => this.loadTimes(near));
    $("near-postes").onclick = (e) => this.onListClick(e);
    this.loadTimes(near);
  },
  card(s, rows) {
    const st = app.net.stops[s.id];
    return `<div class="poste-card" data-id="${s.id}">
      <div class="pc-head"><strong>${esc(st.name)}</strong><span class="meta">${posteLabel(app.net, s.id)} · ${Math.round(s.d)} m</span></div>
      ${lineTimes(app.net, s.id, rows).map((x) => x.html).join("")}</div>`;
  },
  async loadTimes(near) {
    // Tiempos en vivo de los 6 postes más cercanos (una petición por poste devuelve todas sus líneas).
    await Promise.all(near.slice(0, 6).map(async (s) => {
      const st = app.net.stops[s.id];
      if (st.tram) return;
      const r = await arrivals(st.code);
      const el = document.querySelector(`.poste-card[data-id="${s.id}"]`);
      if (el && app.view === this) el.outerHTML = this.card(s, r.rows);
    }));
  },
  onListClick(e) {
    const row = e.target.closest(".lt-row");
    if (row) return go("route", { routeId: row.dataset.route, dirIdx: +row.dataset.dir, board: +row.dataset.idx });
    const card = e.target.closest(".poste-card");
    if (card) go("poste", { id: card.dataset.id });
  },

  // ---- Por código o nombre ----
  renderCode() {
    $("find-body").innerHTML = `<label class="field"><span class="label">Número de poste (está en la marquesina) o nombre de la parada</span>
      <input id="code-in" inputmode="search" autocomplete="off" placeholder="Ej. 606 o Plaza España" value="${esc(app.params.q || "")}"></label>
      <div id="code-res"></div>`;
    const input = $("code-in");
    const run = () => {
      const q = input.value.trim(); app.params.q = q;
      const net = app.net;
      let ids = [];
      if (/^\d+$/.test(q)) ids = Object.keys(net.byCode).filter((c) => c.startsWith(q)).sort((a, b) => a.length - b.length || a - b).slice(0, 15).map((c) => net.byCode[c]);
      else if (q.length >= 3) { const n = norm(q); ids = Object.keys(net.byStop).filter((id) => norm(net.stops[id].name).includes(n)).slice(0, 20); }
      $("code-res").innerHTML = ids.map((id) => `<button class="res-item" data-id="${id}"><b>${esc(net.stops[id].name)}</b><span class="meta">${posteLabel(net, id)} · ${net.byStop[id].map((x) => badge(x.route, "xs")).join("")}</span></button>`).join("")
        || (q ? `<p class="meta">Sin resultados.</p>` : "");
      setPostes(app.map, ids.map((id) => ({ id, p: net.stops[id].p, label: net.stops[id].tram ? net.stops[id].name : String(net.stops[id].code) })));
    };
    input.oninput = run;
    input.onkeydown = (e) => { if (e.key === "Enter") { const first = $("code-res").querySelector("[data-id]"); if (first) go("poste", { id: first.dataset.id }); } };
    $("code-res").onclick = (e) => { const b = e.target.closest("[data-id]"); if (b) go("poste", { id: b.dataset.id }); };
    run();
    setTimeout(() => input.focus(), 50);
  },

  // ---- Por ruta ----
  renderRoute() {
    $("find-body").innerHTML = `<p class="meta">Elige la línea; luego toca la parada para ver sus tiempos.</p>` +
      app.net.routes.map((r) => `<button class="line-chip" data-id="${r.id}">${badge(r)}<span><span class="lc-name">${esc(r.long)}</span>${serviceChip(r)}</span></button>`).join("");
    $("find-body").onclick = (e) => { const b = e.target.closest(".line-chip"); if (b) go("line", { routeId: b.dataset.id, dirIdx: 0 }); };
  },

  onMapClick(p) {
    if (this.tab !== "dist") return false;
    app.params.point = p; this._fitted = true;
    setPick(p);
    this.render();
    return true;
  },
  onFeature(f) {
    if (f.layer.id === "postes") { go("poste", { id: f.properties.id }); return true; }
    return false;
  },
  leave() { this._fitted = false; },
};
