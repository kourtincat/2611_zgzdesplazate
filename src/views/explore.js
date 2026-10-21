// Explorador de rutas: lista global y ficha de línea con sus dos sentidos (uno resaltado, mapa centrado en él).
import { app, $, esc, go, simpleTop, topbar, badge, serviceChip, snap, fitTo } from "../app.js";
import { setLine, setStops, animateArrows } from "../map.js";
import { renderStops } from "../diagram.js";
import { connections, dirLabel } from "../network.js";

const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const explore = {
  name: "explore",
  snap: "full",
  enter() {
    simpleTop("Explorar rutas", "Localizador");
    $("sheet-body").innerHTML = `<label class="field"><input id="line-q" placeholder="Buscar línea o barrio (ej. 35, Delicias)" autocomplete="off"></label><div id="lines-list"></div>`;
    const draw = () => {
      const q = norm($("line-q").value.trim());
      $("lines-list").innerHTML = app.net.routes.filter((r) => !q || norm(`${r.short} ${r.long}`).includes(q))
        .map((r) => `<button class="line-chip" data-id="${r.id}">${badge(r)}<span><span class="lc-name">${esc(r.long)}</span>${serviceChip(r)}</span></button>`).join("");
    };
    $("line-q").oninput = draw;
    $("lines-list").onclick = (e) => { const b = e.target.closest(".line-chip"); if (b) go("line", { routeId: b.dataset.id, dirIdx: 0 }); };
    draw();
  },
};

// Chips de correspondencia de una parada (otras líneas a ≤ 150 m).
export function connChips(stopId, routeId) {
  return connections(app.net, stopId, routeId).slice(0, 6)
    .map((c) => `<button class="xchip" data-jump="${c.route.id}|${c.dirIdx}|${c.idx}" style="--c:${c.route.color};--t:${c.route.text}" title="Correspondencia con ${esc(c.route.short)}">${esc(c.route.short)}</button>`).join("");
}

export const line = {
  name: "line",
  snap: "half",
  enter({ routeId, dirIdx = 0 }) {
    this.route = app.net.byId[routeId];
    this.dirIdx = dirIdx;
    const r = this.route;
    topbar(`<button class="icon-btn" data-nav="back" aria-label="Volver">←</button>
      <div class="top-title row-title">${badge(r, "lg")}<span><span class="label">${r.tram ? "Tranvía" : "Línea " + esc(r.short)}</span><strong>${esc(r.long)}</strong></span></div>
      <button class="icon-btn" data-nav="home" aria-label="Menú principal">☰</button>`);
    $("sheet-body").innerHTML = `
      <div class="line-meta">${serviceChip(r)}</div>
      <div class="dir-seg">${r.dirs.map((d, i) => { const l = dirLabel(app.net, r, d); return `<button data-dir="${i}"><small>${esc(l.from)}</small><b>→ ${esc(l.to)}</b></button>`; }).join("")}</div>
      <button class="cta small wide" id="line-live">Ver buses en directo en este sentido</button>
      <div class="block"><div class="block-title">Paradas <span class="meta">· toca una para ver sus tiempos · los círculos de color son correspondencias</span></div><div id="stops"></div></div>`;
    $("sheet-body").querySelector(".dir-seg").onclick = (e) => { const b = e.target.closest("[data-dir]"); if (b) { this.dirIdx = +b.dataset.dir; app.params.dirIdx = this.dirIdx; this.draw(true); } };
    $("line-live").onclick = () => go("route", { routeId: r.id, dirIdx: this.dirIdx });
    $("stops").onclick = (e) => {
      const j = e.target.closest("[data-jump]");
      if (j) { const [rid, di] = j.dataset.jump.split("|"); return go("line", { routeId: rid, dirIdx: +di }); }
      const row = e.target.closest(".row");
      if (row) go("poste", { id: r.dirs[this.dirIdx].stops[+row.dataset.i] });
    };
    this.draw(true);
  },
  geoms() { return this.route.dirs.map((d) => (app.flat ? d.flat : d.real)); },
  draw(fit) {
    const r = this.route, d = r.dirs[this.dirIdx], g = this.geoms();
    for (const b of document.querySelectorAll(".dir-seg button")) b.classList.toggle("on", +b.dataset.dir === this.dirIdx);
    setLine(app.map, r, g, this.dirIdx);
    setStops(app.map, app.net, d, g[this.dirIdx], { xfer: (id) => connections(app.net, id, r.id).length > 0 });
    animateArrows(app.map, r, d, g[this.dirIdx]);
    renderStops($("stops"), app.net, r, d, { simple: true, conns: d.stops.map((id) => connChips(id, r.id)) });
    if (fit) this.center();
  },
  center() {
    const c = this.geoms()[this.dirIdx].coords;
    const lons = c.map((p) => p[0]), lats = c.map((p) => p[1]);
    if (innerWidth < 900) snap("half");
    fitTo([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { duration: 900 });
  },
  redraw() { this.draw(false); },
  onFeature(f) { if (f.layer.id === "stops") { go("poste", { id: f.properties.id }); return true; } return false; },
};
