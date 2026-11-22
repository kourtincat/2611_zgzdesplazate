// Indicar a dónde voy: origen (GPS, mapa o buscador) -> "Selecciona a dónde vas" -> opciones con hasta 1 transbordo.
import { app, $, esc, go, fly, fitTo, simpleTop, locate, badge, posteLabel, arrivals, snap } from "../app.js";
import { plan } from "../planner.js";
import { routesNear } from "../network.js";
import { setNetwork, setMarker, setData, fc, line, setPostes } from "../map.js";
import { fmtClock } from "../prediction.js";
import { PLACES, DISTRICTS } from "../places.js";
import { setPlaces, showLayers } from "../map.js";
import { loadBizi, showBizi, biziState } from "../bizi.js";
import { haversine } from "../geo.js";

const WALK = 1.2, DETOUR = 1.3;
const walkMin = (d) => Math.max(1, Math.round((d * DETOUR) / WALK / 60));
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default {
  name: "plan",
  snap: "half",
  enter(params) {
    simpleTop("Indicar a dónde voy", "Localizador");
    this.sel = params.sel ?? null;
    this.render();
  },
  get stage() { const p = app.params; return !p.origin ? "origin" : !p.dest ? "dest" : "results"; },

  // Lugares que se pueden elegir con un toque (lista y mapa) mientras se elige origen o destino.
  quickPlaces(which) {
    return `<div class="block-title">${which === "origin" ? "Salir de un lugar conocido" : "Destinos populares"}</div>
      <div class="places">${PLACES.map((x) => `<button class="place-chip" data-place="${x.id}"><span aria-hidden="true">${x.icon}</span>${esc(x.name)}</button>`).join("")}</div>
      <label class="field barrio"><select id="pl-barrio" aria-label="Ir a un barrio"><option value="">${which === "origin" ? "Salir de un barrio…" : "Ir a un barrio…"}</option>
        ${DISTRICTS.map((d, i) => `<option value="${i}">${esc(d.name)}</option>`).join("")}</select></label>
      <p class="meta">En el mapa también puedes tocar un destino (punto blanco y rojo) o una estación Bizi (azul).</p>`;
  },
  showPickers(on) {
    showLayers(app.map, ["places", "place-labels"], on);
    showBizi(on);
    if (on) { setPlaces(app.map, PLACES); loadBizi(); }
  },
  render() {
    const p = app.params, body = $("sheet-body");
    this.showPickers(this.stage !== "results");
    setMarker(app.map, "A", p.origin?.p, { className: "pin-ab", text: "A" });
    setMarker(app.map, "B", p.dest?.p, { className: "pin-ab b", text: "B" });
    setData(app.map, "plan");
    setPostes(app.map, []);
    const chip = (k, v) => `<button class="od-chip" data-edit="${k}"><span class="od-dot ${k}">${k === "origin" ? "A" : "B"}</span><span><small>${k === "origin" ? "Desde" : "Hasta"}</small><b>${esc(v.label)}</b></span><span class="od-edit">cambiar</span></button>`;
    if (this.stage === "origin") {
      setNetwork(app.map, app.net, null, true);
      body.innerHTML = `<h3 class="step-title">¿Desde dónde sales?</h3>
        <button class="cta" id="pl-gps">📍 Desde mi ubicación</button>
        ${this.searchBox("Busca una calle y número o una parada")}
        <p class="meta center">o toca el mapa para elegir el punto de partida</p>
        ${p.dest ? `<p class="meta">Destino ya elegido: <b>${esc(p.dest.label)}</b></p>` : ""}
        ${this.quickPlaces("origin")}`;
      $("pl-gps").onclick = async () => { const fix = await locate(); if (fix) this.set("origin", { p: fix.p, label: "Mi ubicación" }); };
    } else if (this.stage === "dest") {
      const near = routesNear(app.net, p.origin.p, 700);
      setNetwork(app.map, app.net, new Set(near.map((n) => n.route.id)), true);
      fly({ center: p.origin.p, zoom: 14.2, pitch: app.flat ? 0 : 45 });
      body.innerHTML = `${chip("origin", p.origin)}
        <h3 class="step-title">Selecciona a dónde vas</h3>
        ${this.searchBox("Calle y número, lugar o parada de destino")}
        <p class="meta">Toca el mapa en tu destino. Resaltadas: las ${near.length} líneas que pasan cerca del origen
        ${near.slice(0, 12).map((n) => badge(n.route, "xs")).join("")}</p>
        ${this.quickPlaces("dest")}`;
    } else this.renderResults();
    body.onclick = (e) => this.onClick(e);
    const sel = $("pl-barrio");
    if (sel) sel.onchange = () => { const d = DISTRICTS[+sel.value]; if (d) this.set(this.stage, { p: d.p, label: `Barrio ${d.name}` }); };
    this.bindSearch();
  },

  searchBox(ph) {
    return `<label class="field search"><input id="pl-q" placeholder="${esc(ph)}" autocomplete="off"></label><div id="pl-res" class="res-list"></div>`;
  },
  bindSearch() {
    const input = $("pl-q"); if (!input) return;
    let t;
    input.oninput = () => {
      clearTimeout(t);
      const q = input.value.trim();
      if (q.length < 3) { $("pl-res").innerHTML = ""; return; }
      // Paradas locales al instante + calles/números (OSM) con un pequeño retardo.
      const n = norm(q), net = app.net;
      const stops = Object.keys(net.byStop).filter((id) => norm(net.stops[id].name).includes(n) || String(net.stops[id].code) === q).slice(0, 4)
        .map((id) => ({ title: net.stops[id].name, sub: posteLabel(net, id), p: net.stops[id].p, stop: true }));
      const draw = (geo) => {
        this.results = [...geo, ...stops];
        $("pl-res").innerHTML = this.results.map((r, i) => `<button class="res-item" data-res="${i}"><b>${r.stop ? "🚏 " : "📍 "}${esc(r.title)}</b><span class="meta">${esc(r.sub || "")}</span></button>`).join("") || `<p class="meta">Sin resultados</p>`;
      };
      draw([]);
      t = setTimeout(async () => {
        try { const geo = await (await fetch(`/api/geocode?q=${encodeURIComponent(q)}`)).json(); if (input.value.trim() === q) draw(geo); } catch { /* sin buscador externo */ }
      }, 350);
    };
  },

  set(which, val) {
    app.params[which] = val;
    this.sel = null; app.params.sel = null;
    this.render();
  },

  renderResults() {
    const p = app.params, net = app.net;
    const res = plan(net, p.origin.p, p.dest.p);
    this.options = res.options;
    const dist = haversine(p.origin.p, p.dest.p);
    const lons = [p.origin.p[0], p.dest.p[0]], lats = [p.origin.p[1], p.dest.p[1]];
    fitTo([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { maxZoom: 16 });
    setNetwork(app.map, app.net, null, false);
    const chips = ["origin", "dest"].map((k) => `<button class="od-chip" data-edit="${k}"><span class="od-dot ${k}">${k === "origin" ? "A" : "B"}</span><span><small>${k === "origin" ? "Desde" : "Hasta"}</small><b>${esc(p[k].label)}</b></span><span class="od-edit">cambiar</span></button>`).join("");
    if (this.sel != null && this.options[this.sel]) return this.renderDetail(chips);
    const walkOnly = dist < 1500 ? `<div class="opt walk"><b>🚶 Andando ≈ ${walkMin(dist)} min</b><span class="meta">${Math.round(dist * DETOUR)} m aprox.</span></div>` : "";
    $("sheet-body").innerHTML = `${chips}<h3 class="step-title">Cómo llegar</h3>${walkOnly}
      ${this.options.map((o, i) => `<div class="opt" data-opt="${i}" role="button" tabindex="0">
        <div class="opt-head"><b>≈ ${Math.round(o.total / 60)} min</b><span class="meta">llegas ~${fmtClock(o.arrive)} · ${o.legs.length > 1 ? "1 transbordo" : "directo"}</span></div>
        <div class="opt-legs">🚶 ${walkMin(o.legs[0].walk)}' ${o.legs.map((l, k) => `${k ? `<span class="xfer">⇄ ${walkMin(l.walk)}'</span>` : ""}<span class="leg">${badge(l.route, "xs")}<small>${l.to - l.from} par.</small></span>`).join(" ")} 🚶 ${walkMin(o.endWalk)}'</div>
        <div class="opt-foot"><button class="opt-go" data-opt="${i}">Iniciar →</button></div>
      </div>`).join("") || `<p class="meta">No encontramos una combinación con ≤ 1 transbordo y paradas a menos de 750 m. Prueba a mover el origen o el destino.</p>`}
      <p class="meta">Estimación con frecuencias del horario y tiempos entre paradas del GTFS; el primer bus se confirma con Avanza al abrir la opción.</p>`;
    if (this.options[0]) this.drawOption(this.options[0]);
  },

  renderDetail(chips) {
    const o = this.options[this.sel], net = app.net, p = app.params;
    this.drawOption(o);
    const steps = [`<li class="st-walk">🚶 Anda ${walkMin(o.legs[0].walk)} min (${Math.round(o.legs[0].walk * DETOUR)} m) hasta <b>${esc(net.stops[o.legs[0].fromStop].name)}</b></li>`];
    o.legs.forEach((l, k) => {
      const d = l.route.dirs[l.dirIdx], a = d.stops[l.from], b = d.stops[l.to];
      if (k) steps.push(`<li class="st-walk">⇄ Transbordo: anda ${walkMin(l.walk)} min hasta <b>${esc(net.stops[a].name)}</b></li>`);
      steps.push(`<li class="st-ride" style="--c:${l.route.color}">
        <div>${badge(l.route)} <b>hacia ${esc(d.headsign)}</b></div>
        <div class="meta">Subes en <b>${esc(net.stops[a].name)}</b> (${posteLabel(net, a)}) · espera ${k ? "aprox." : ""} <span id="wait-${k}">~${Math.round(l.wait / 60)} min</span></div>
        <div class="meta">${l.to - l.from} paradas · ≈ ${Math.max(1, Math.round((d.offsets[l.to] - d.offsets[l.from]) / 60))} min · bajas en <b>${esc(net.stops[b].name)}</b></div>
        <button class="pill" data-live="${k}">Seguir este ${l.route.tram ? "tranvía" : "bus"} en directo</button></li>`);
    });
    steps.push(`<li class="st-walk">🚶 Anda ${walkMin(o.endWalk)} min hasta <b>${esc(p.dest.label)}</b></li>`);
    $("sheet-body").innerHTML = `${chips}<button class="link-btn" data-back-opts>← Todas las opciones</button>
      <h3 class="step-title">≈ ${Math.round(o.total / 60)} min · llegas ~${fmtClock(o.arrive)}</h3><ol class="itinerary">${steps.join("")}</ol>`;
    // Primer bus: tiempo real de Avanza en el poste de subida.
    const l0 = o.legs[0], st = net.stops[l0.route.dirs[l0.dirIdx].stops[l0.from]];
    if (l0.route.live) arrivals(st.code).then((r) => {
      const mins = (r.rows || []).filter((x) => x.line === l0.route.short.toUpperCase()).map((x) => x.min).filter((m) => m !== null).sort((a, b) => a - b);
      const el = $("wait-0"); if (el && mins.length) el.innerHTML = `<b class="live">Avanza: ${mins.slice(0, 2).map((m) => (m === 0 ? "YA" : m + "'")).join(" · ")}</b>`;
    });
  },

  drawOption(o) {
    const net = app.net, p = app.params, feats = [];
    let prev = p.origin.p;
    for (const l of o.legs) {
      const d = l.route.dirs[l.dirIdx], g = app.flat ? d.flat : d.real;
      feats.push(line([prev, net.stops[d.stops[l.from]].p], { kind: "walk" }));
      const pts = [];
      for (let a = d.along[l.from]; a < d.along[l.to]; a += 25) pts.push(g.at(a));
      pts.push(g.at(d.along[l.to]));
      feats.push(line(pts, { kind: "ride", color: l.route.color }));
      prev = net.stops[d.stops[l.to]].p;
    }
    feats.push(line([prev, p.dest.p], { kind: "walk" }));
    setData(app.map, "plan", fc(feats));
    setPostes(app.map, o.legs.flatMap((l) => { const d = l.route.dirs[l.dirIdx]; return [d.stops[l.from], d.stops[l.to]]; })
      .map((id) => ({ id, p: net.stops[id].p, label: net.stops[id].name })));
  },

  onClick(e) {
    const t = e.target;
    const pl = t.closest("[data-place]");
    if (pl) { const x = PLACES.find((y) => y.id === pl.dataset.place); return this.set(this.stage, { p: x.p, label: x.name }); }
    const res = t.closest("[data-res]");
    if (res) { const r = this.results[+res.dataset.res]; return this.set(this.stage === "origin" ? "origin" : this.stage === "dest" ? "dest" : "dest", { p: r.p, label: r.title }); }
    const edit = t.closest("[data-edit]");
    if (edit) { const k = edit.dataset.edit; app.params[k] = null; this.sel = null; return this.render(); }
    const opt = t.closest("[data-opt]");
    if (opt) { this.sel = +opt.dataset.opt; app.params.sel = this.sel; return this.render(); }
    if (t.closest("[data-back-opts]")) { this.sel = null; app.params.sel = null; return this.render(); }
    const live = t.closest("[data-live]");
    if (live) {
      const l = this.options[this.sel].legs[+live.dataset.live];
      go("route", { routeId: l.route.id, dirIdx: l.dirIdx, board: l.from, dest: l.to });
    }
  },
  // Tocar un destino popular o una estación Bizi en el mapa = elegirlo como origen/destino.
  onFeature(f) {
    if (this.stage === "results") return false;
    if (f.layer.id === "places") { const x = PLACES.find((y) => y.id === f.properties.id); if (x) this.set(this.stage, { p: x.p, label: x.name }); return !!x; }
    if (f.layer.id === "bizi") { const s = biziState.stations.find((y) => String(y.id) === String(f.properties.id)); if (s) this.set(this.stage, { p: s.p, label: `Bizi · ${s.name}` }); return !!s; }
    return false;
  },
  onMapClick(p) {
    const label = `Punto en el mapa`;
    if (this.stage === "origin") this.set("origin", { p, label });
    else this.set("dest", { p, label: this.stage === "dest" ? label : "Punto en el mapa" });
    snap("half");
    return true;
  },
  center() {
    const p = app.params;
    if (p.origin && p.dest) this.render();
    else if (p.origin) fly({ center: p.origin.p, zoom: 14.5 });
  },
  leave() { setMarker(app.map, "A", null); setMarker(app.map, "B", null); this.showPickers(false); },
};
