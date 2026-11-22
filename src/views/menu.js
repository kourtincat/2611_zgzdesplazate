// Inicio: un buscador único (poste, línea o calle), accesos rápidos y tus favoritos/recientes con el próximo bus.
// Lo más habitual al abrir la app es "quiero mi poste" o "el poste más cercano de la línea X": las dos cosas se
// resuelven escribiendo en el buscador, sin pasar por menús.
import { app, $, esc, go, topbar, pref, snap, fitTo, badge, posteLabel, arrivals, myPos, locate } from "../app.js";
import { setPostes } from "../map.js";
import { nearestStop } from "../network.js";
import { haversine } from "../geo.js";
import { nextByLine } from "./find.js";
import { favs, recents, toggleFav, isFav, keyOf } from "../saved.js";

const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
// Coincidencia por palabras, sin artículos: "plaza españa" encuentra "Plaza De España".
const STOP = new Set(["de", "del", "la", "las", "el", "los", "y", "a"]);
const words = (s) => norm(s).split(/[^a-z0-9ñ]+/).filter((w) => w && !STOP.has(w));
const matches = (name, qw) => { const nw = words(name); return qw.every((w) => nw.some((x) => x.startsWith(w))); };
const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const LIVE_EVERY = 30000;

export default {
  name: "menu",
  snap: "half",
  enter() {
    topbar(`<div class="brand"><span class="brand-mark"></span><span>ZGZ <b>Desplázate</b></span></div>`);
    $("sheet-body").innerHTML = `
      <div class="home">
        <div class="search">
          <span class="search-ico" aria-hidden="true">⌕</span>
          <input id="home-q" type="search" enterkeyhint="search" autocomplete="off" spellcheck="false"
            placeholder="Nº de poste, línea o calle" aria-label="Buscar poste, línea o calle">
          <button id="home-clear" class="search-clear" aria-label="Borrar búsqueda" hidden>✕</button>
        </div>
        <div class="quick" id="home-quick">
          <button class="qchip" data-act="near"><span aria-hidden="true">◎</span>Cerca de mí</button>
          <button class="qchip" data-act="lines"><span aria-hidden="true">≡</span>Líneas</button>
          <button class="qchip" data-act="plan"><span aria-hidden="true">⇢</span>Cómo llegar</button>
        </div>
        <div id="home-res" hidden></div>
        <div id="home-saved"></div>
        <label class="switch-row"><span><b>Opciones sociales</b><small>«Estoy en la parada», «He cogido el bus» y señales de otros usuarios.</small></span>
          <input type="checkbox" id="social-sw" ${app.social ? "checked" : ""}><span class="switch"></span></label>
      </div>`;
    this.live = this.live || {};
    this.items = new Map();
    const input = $("home-q");
    input.value = app.params.q || "";
    input.oninput = () => this.onQuery();
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("home-res").querySelector("[data-open]")?.click(); input.blur(); } };
    input.onfocus = () => { if (innerWidth < 900) snap("full"); };
    $("home-clear").onclick = () => { input.value = ""; this.onQuery(); input.focus(); };
    $("home-quick").onclick = (e) => this.onQuick(e.target.closest("[data-act]")?.dataset.act);
    $("home-res").onclick = (e) => this.onOpen(e);
    $("home-saved").onclick = (e) => this.onOpen(e);
    $("social-sw").onchange = (e) => { app.social = e.target.checked; pref.set("pw-social", app.social ? "1" : "0"); };
    if (input.value) this.onQuery(); else this.renderSaved();
    this.loadLive();
    this.timer = setInterval(() => this.loadLive(), LIVE_EVERY);
    this.center();
  },
  leave() { clearInterval(this.timer); clearTimeout(this.geoT); },
  // Zaragoza entera, vista cenital.
  center() { snap("half"); fitTo(app.net.core, { maxZoom: 13, duration: 1200 }); },

  async onQuick(act) {
    if (act === "lines") return go("explore", {});
    if (act === "plan") return go("plan", {});
    if (act === "near") { if (!myPos()) await locate(); go("find", { tab: "dist" }); }
  },

  // ---------- Buscador ----------
  onQuery() {
    const q = $("home-q").value.trim();
    app.params.q = q;
    $("home-clear").hidden = !q;
    $("home-res").hidden = !q;
    $("home-saved").hidden = !!q;
    $("home-quick").hidden = !!q;
    clearTimeout(this.geoT);
    if (!q) { this.renderSaved(); return; }
    this.streets = null;
    this.renderResults(q);
    // Calles y números (OpenStreetMap). Sólo si no es un número puro, que casi siempre es un poste o una línea.
    if (q.length >= 3 && !/^\d+$/.test(q)) this.geoT = setTimeout(async () => {
      try {
        const res = await (await fetch(`/api/geocode?q=${encodeURIComponent(q)}`)).json();
        if (app.view === this && $("home-q")?.value.trim() === q) { this.streets = res.slice(0, 4); this.renderResults(q); }
      } catch {}
    }, 350);
  },

  search(q) {
    const net = app.net, n = norm(q), digits = /^\d+$/.test(q);
    const lineExact = net.routes.filter((r) => norm(r.short) === n);
    const lineOther = net.routes.filter((r) => norm(r.short) !== n && (norm(r.short).startsWith(n) || (n.length >= 3 && norm(r.long).includes(n)))).slice(0, 4);
    let postes = [];
    if (digits) postes = Object.keys(net.byCode).filter((c) => c.startsWith(q)).sort((a, b) => a.length - b.length || a - b).slice(0, 6).map((c) => net.byCode[c]);
    else if (n.length >= 3) { const qw = words(q); if (qw.length) postes = Object.keys(net.byStop).filter((id) => matches(net.stops[id].name, qw)).slice(0, 8); }
    return { lineExact, lineOther, postes };
  },

  renderResults(q) {
    const net = app.net, { lineExact, lineOther, postes } = this.search(q), me = myPos();
    this.items = new Map();
    const add = (item) => { const k = keyOf(item); this.items.set(k, item); return k; };
    const sec = (title, html) => (html ? `<div class="res-sec"><div class="block-title">${title}</div>${html}</div>` : "");

    // "Poste más cercano de la línea X": un resultado por sentido, ya con la parada elegida.
    let nearHtml = "";
    for (const r of lineExact) {
      if (!me) { nearHtml += `<button class="res-item near-ask" data-locate="1"><b>◎ Poste más cercano de la ${esc(r.short)}</b><span class="meta">Usa tu ubicación para encontrarlo</span></button>`; continue; }
      r.dirs.forEach((d, dirIdx) => {
        const s = nearestStop(net, d, me);
        const k = add({ t: "linea", routeId: r.id, dirIdx, board: s.i });
        nearHtml += `<button class="res-item res-row" data-open="${k}">${badge(r)}<span class="rr-main"><b>→ ${esc(d.headsign)}</b>
          <span class="meta">${esc(net.stops[s.id].name)} · ${posteLabel(net, s.id)} · ${fmtDist(s.d)}</span></span></button>`;
      });
    }
    const lineBtn = (r) => `<button class="res-item res-row" data-open="${add({ t: "linea", routeId: r.id, dirIdx: 0, board: null })}">${badge(r)}<span class="rr-main"><b>${r.tram ? "Tranvía" : "Línea " + esc(r.short)}</b><span class="meta">${esc(r.long)}</span></span></button>`;
    const posteBtn = (id) => `<button class="res-item" data-open="${add({ t: "poste", id })}"><b>${esc(net.stops[id].name)}</b>
      <span class="meta">${posteLabel(net, id)}${me ? ` · ${fmtDist(haversine(me, net.stops[id].p))}` : ""} · ${net.byStop[id].map((x) => badge(x.route, "xs")).join("")}</span></button>`;
    const exactPoste = postes.filter((id) => String(net.stops[id].code) === q), restPostes = postes.filter((id) => !exactPoste.includes(id));
    const streets = (this.streets || []).map((s, i) => `<button class="res-item" data-street="${i}"><b>${esc(s.title)}</b><span class="meta">${esc(s.sub || "")}</span></button>`).join("");

    const html = [
      sec(me ? `Más cerca de ti · línea ${esc(lineExact.map((r) => r.short).join(", "))}` : "Más cerca de ti", nearHtml),
      sec("Poste", exactPoste.map(posteBtn).join("")),
      sec("Líneas", [...lineExact, ...lineOther].map(lineBtn).join("")),
      sec(exactPoste.length ? "Otros postes" : "Postes", restPostes.map(posteBtn).join("")),
      sec("Calles y lugares", streets),
    ].join("");
    $("home-res").innerHTML = html || `<p class="meta">Sin resultados para «${esc(q)}». Prueba con el número del poste (está en la marquesina), una línea o una calle.</p>`;
    setPostes(app.map, postes.map((id) => ({ id, p: net.stops[id].p, label: net.stops[id].tram ? net.stops[id].name : String(net.stops[id].code) })));
  },

  async onOpen(e) {
    const star = e.target.closest("[data-star]");
    if (star) { toggleFav(this.items.get(star.dataset.star)); this.renderSaved(); this.loadLive(); return; }
    if (e.target.closest("[data-locate]")) { if (await locate()) this.renderResults($("home-q").value.trim()); return; }
    const st = e.target.closest("[data-street]");
    if (st) return go("find", { tab: "dist", point: this.streets[+st.dataset.street].p });
    const b = e.target.closest("[data-open]");
    if (!b) return;
    const x = this.items.get(b.dataset.open);
    if (x.t === "poste") go("poste", { id: x.id });
    else go("route", { routeId: x.routeId, dirIdx: x.dirIdx, board: x.board });
  },

  // ---------- Favoritos y recientes ----------
  renderSaved() {
    const net = app.net, F = favs(net), R = recents(net).filter((r) => !isFav(r)).slice(0, 5);
    this.items = new Map([...F, ...R].map((x) => [keyOf(x), x]));
    const fav = F.map((x) => this.card(x)).join("");
    const rec = R.map((x) => this.recentRow(x)).join("");
    $("home-saved").innerHTML = (fav ? `<div class="block-title">Favoritos</div>${fav}` : "")
      + (rec ? `<div class="block-title rec-title">Recientes</div>${rec}` : "")
      + (!fav ? `<p class="meta hint">Marca <b>☆</b> en un poste o en tu parada de una línea y aparecerá aquí con su próximo bus.</p>` : "");
    const pins = F.map((x) => (x.t === "poste" ? x.id : x.board != null ? net.byId[x.routeId].dirs[x.dirIdx].stops[x.board] : null)).filter(Boolean);
    setPostes(app.map, [...new Set(pins)].map((id) => ({ id, p: net.stops[id].p, label: net.stops[id].tram ? net.stops[id].name : String(net.stops[id].code) })));
  },
  card(x) {
    const net = app.net, k = keyOf(x), starBtn = `<button class="star on" data-star="${k}" aria-label="Quitar de favoritos">★</button>`;
    if (x.t === "poste") {
      const st = net.stops[x.id];
      const chips = nextByLine(net, x.id, this.live[st.code]).map((n) => `<span class="nb">${badge(n.route, "xs")}<b class="${n.live ? "live" : "sched"}">${n.txt}</b></span>`).join("");
      return `<div class="fav-card" data-open="${k}"><div class="fc-main"><strong>${esc(st.name)}</strong><span class="meta">${posteLabel(net, x.id)}</span><div class="nb-row">${chips}</div></div>${starBtn}</div>`;
    }
    const r = net.byId[x.routeId], d = r.dirs[x.dirIdx];
    if (x.board == null) return `<div class="fav-card" data-open="${k}">${badge(r, "lg")}<div class="fc-main"><strong>→ ${esc(d.headsign)}</strong><span class="meta">Línea completa</span></div>${starBtn}</div>`;
    const stopId = d.stops[x.board], st = net.stops[stopId];
    const n = nextByLine(net, stopId, this.live[st.code]).find((y) => y.route === r && y.dirIdx === x.dirIdx);
    return `<div class="fav-card" data-open="${k}">${badge(r, "lg")}<div class="fc-main"><strong>→ ${esc(d.headsign)}</strong><span class="meta">${esc(st.name)} · ${posteLabel(net, stopId)}</span></div>
      <div class="fc-eta ${n?.live ? "live" : "sched"}">${n?.txt ?? "—"}</div>${starBtn}</div>`;
  },
  recentRow(x) {
    const net = app.net, k = keyOf(x), starBtn = `<button class="star" data-star="${k}" aria-label="Añadir a favoritos">☆</button>`;
    if (x.t === "poste") return `<div class="rec-row" data-open="${k}"><span class="rr-main"><b>${esc(net.stops[x.id].name)}</b><span class="meta">${posteLabel(net, x.id)} · ${net.byStop[x.id].map((y) => badge(y.route, "xs")).join("")}</span></span>${starBtn}</div>`;
    const r = net.byId[x.routeId], d = r.dirs[x.dirIdx];
    const where = x.board != null ? `${esc(net.stops[d.stops[x.board]].name)} · ${posteLabel(net, d.stops[x.board])}` : "Línea completa";
    return `<div class="rec-row" data-open="${k}">${badge(r)}<span class="rr-main"><b>→ ${esc(d.headsign)}</b><span class="meta">${where}</span></span>${starBtn}</div>`;
  },
  // Tiempos en vivo de los postes favoritos (una petición por poste; el servidor cachea 15 s).
  async loadLive() {
    const net = app.net, codes = new Set();
    for (const x of favs(net)) {
      const id = x.t === "poste" ? x.id : x.board != null ? net.byId[x.routeId].dirs[x.dirIdx].stops[x.board] : null;
      if (id && net.stops[id].code && !net.stops[id].tram) codes.add(net.stops[id].code);
    }
    await Promise.all([...codes].slice(0, 6).map(async (c) => { const r = await arrivals(c); if (r.ok) this.live[c] = r.rows; }));
    if (app.view === this && !$("home-q")?.value.trim()) this.renderSaved();
  },
};
