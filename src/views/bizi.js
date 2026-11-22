// Voy en Bizi: estaciones cerca de mí, de una dirección escrita o de un punto tocado en el mapa,
// con bicis y anclajes libres en vivo (se refresca cada 60 s).
import { app, $, esc, simpleTop, locate, myPos, syncUrl, fly, setPick } from "../app.js";
import { setMarker } from "../map.js";
import { loadBizi, showBizi, biziClass, biziPopup, biziLegend } from "../bizi.js";

const fmtD = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const dist = (a, b) => { const k = Math.cos((a[1] * Math.PI) / 180) * 111320; return Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 110540); };

export default {
  name: "bizi",
  snap: "half",
  enter() {
    simpleTop("Bizi", "Voy en bici");
    showBizi(true);
    $("sheet-body").innerHTML = `
      <div class="bz-tools">
        <button class="board alt" id="bz-gps">◎ Cerca de mí</button>
        <label class="field search"><input id="bz-q" type="search" enterkeyhint="search" autocomplete="off" placeholder="o escribe una calle o lugar"></label>
        <div id="bz-res"></div>
        <p class="meta center">…o toca el mapa donde quieras</p>
        <p class="meta center">${biziLegend}</p>
      </div>
      <div id="bz-list"></div>
      <p class="foot meta" id="bz-foot"></p>`;
    $("bz-gps").onclick = async () => { const f = await locate(); if (f) this.setPoint(f.p, "Tu ubicación"); };
    this.bindSearch();
    $("bz-list").onclick = (e) => { const r = e.target.closest("[data-bz]"); if (!r) return; const s = this.near?.[+r.dataset.bz]; if (s) { fly({ center: s.p, zoom: 16.5 }); biziPopup(s); } };
    const p = app.params.point || myPos();
    if (p) this.setPoint(p, app.params.point ? "Punto elegido" : "Tu ubicación", true);
    else this.render();
    this.timer = setInterval(() => this.render(true), 60000);
  },
  setPoint(p, label, initial = false) {
    app.params.point = p; this.label = label;
    if (!initial || app.params.point) syncUrl();
    setMarker(app.map, "pick", p, { className: "pin" });
    fly({ center: p, zoom: 15.5, pitch: 0 });
    this.render();
  },
  async render(force = false) {
    const list = await loadBizi(force), p = app.params.point;
    if (app.view !== this) return;
    if (!list.length) { $("bz-list").innerHTML = `<p class="meta center">Cargando estaciones Bizi…</p>`; clearTimeout(this.retry); this.retry = setTimeout(() => this.render(true), 5000); return; }
    if (!p) { $("bz-list").innerHTML = ""; $("bz-foot").textContent = `${list.length} estaciones · datos del Ayuntamiento de Zaragoza`; return; }
    this.near = list.map((s) => ({ ...s, d: dist(s.p, p) })).sort((a, b) => a.d - b.d).slice(0, 8);
    $("bz-list").innerHTML = `<div class="block-title">Más cerca ${this.label === "Tu ubicación" ? "de ti" : "del punto"}</div>` + this.near.map((s, i) => `
      <button class="bizi-row" data-bz="${i}"><span class="bz-ico ${biziClass(s)}">${s.on ? s.bikes : "×"}</span>
        <span class="rr-main"><b>${esc(s.name)}</b><span class="meta">${fmtD(s.d)} · ${s.on ? `<b>${s.bikes}</b> bicis · <b>${s.docks}</b> anclajes libres` : "fuera de servicio"}</span></span></button>`).join("");
    $("bz-foot").textContent = `Bizi Zaragoza en vivo${list.length ? "" : " (sin datos ahora)"} · se actualiza cada minuto`;
  },
  bindSearch() {
    const input = $("bz-q"); let t;
    input.oninput = () => {
      clearTimeout(t);
      const q = input.value.trim();
      if (q.length < 3) { $("bz-res").innerHTML = ""; return; }
      t = setTimeout(async () => {
        try {
          const geo = (await (await fetch(`/api/geocode?q=${encodeURIComponent(q)}`)).json()).slice(0, 5);
          if (input.value.trim() !== q) return;
          this.geo = geo;
          $("bz-res").innerHTML = geo.map((g, i) => `<button class="res-item" data-g="${i}"><b>${esc(g.title)}</b><span class="meta">${esc(g.sub || "")}</span></button>`).join("") || `<p class="meta">Sin resultados</p>`;
        } catch {}
      }, 350);
    };
    $("bz-res").onclick = (e) => { const b = e.target.closest("[data-g]"); if (!b) return; const g = this.geo[+b.dataset.g]; $("bz-res").innerHTML = ""; input.value = g.title; input.blur(); this.setPoint(g.p, g.title); };
  },
  onMapClick(p) { this.setPoint(p, "Punto elegido"); return true; },
  center() { if (app.params.point) fly({ center: app.params.point, zoom: 15.5 }); },
  leave() { clearInterval(this.timer); clearTimeout(this.retry); showBizi(false); setMarker(app.map, "pick", null); },
};
