// Ficha de poste: todas las líneas que paran, su dirección y sus tiempos (Avanza en vivo o horario).
import { app, $, esc, go, fly, simpleTop, myPos, posteLabel, arrivals, cooled, badge, placeLabel } from "../app.js";
import { plan } from "../planner.js";
import { setPostes, setNetwork } from "../map.js";
import { haversine } from "../geo.js";
import { lineTimes } from "./find.js";
import { isFav, toggleFav } from "../saved.js";

const starBtn = (on) => `<button class="star ${on ? "on" : ""}" id="poste-fav" aria-pressed="${on}" aria-label="${on ? "Quitar de favoritos" : "Añadir a favoritos"}">${on ? "★" : "☆"}</button>`;

export default {
  name: "poste",
  snap: "half",
  enter({ id }) {
    const net = app.net, st = net.stops[id];
    this.id = id;
    simpleTop(st.name, posteLabel(net, id));
    const me = myPos();
    const others = (net.walk[id] || []).filter((n) => n.id !== id && n.d <= 120).sort((a, b) => a.d - b.d);
    $("sheet-body").innerHTML = `
      <div class="poste-hero">
        <div><span class="label">${posteLabel(net, id)}</span><strong>${esc(st.name)}</strong>
          <span class="meta">${me ? `${Math.round(haversine(me, st.p))} m de ti · ` : ""}${net.byStop[id].length} línea${net.byStop[id].length > 1 ? "s" : ""}</span></div>
        <div class="hero-actions">${starBtn(isFav({ t: "poste", id }))}
        ${st.tram ? "" : `<button class="pill icon-refresh" id="poste-refresh" data-cool="10" data-cool-key="p${st.code}" title="Actualizar tiempos" aria-label="Actualizar tiempos">↻</button>`}</div>
      </div>
      <div id="poste-lines" class="poste-card flat"></div>
      <p class="meta" id="poste-at"></p>
      <div id="poste-act" class="poste-act" hidden></div>
      <button class="cta small wide" id="poste-plan">¿A dónde vas? Ver opciones desde aquí</button>
      ${others.length ? `<div class="block"><div class="block-title">Postes al lado (otro sentido u otras líneas)</div>${others.map((n) =>
        `<button class="res-item" data-id="${n.id}"><b>${esc(net.stops[n.id].name)}</b><span class="meta">${posteLabel(net, n.id)} · ${Math.round(n.d)} m · ${net.byStop[n.id].map((x) => badge(x.route, "xs")).join("")}</span></button>`).join("")}</div>` : ""}
      <p class="meta">Toca una línea para ver dónde vienen sus buses y marcar dónde te bajas.</p>`;
    setPostes(app.map, [{ id, p: st.p, label: st.tram ? st.name : String(st.code), sel: true }, ...others.map((n) => ({ id: n.id, p: net.stops[n.id].p, label: String(net.stops[n.id].code || "") }))]);
    // Sus líneas resaltadas (el resto de la red atenuada) para ver por dónde pasan.
    setNetwork(app.map, net, new Set(net.byStop[id].map((x) => x.route.id)), true, 0.05);
    this.center();
    $("sheet-body").onclick = (e) => {
      if (e.target.closest("#poste-fav")) { const on = toggleFav({ t: "poste", id }); e.target.closest("#poste-fav").outerHTML = starBtn(on); return; }
      const row = e.target.closest(".lt-row");
      if (row) return go("route", { routeId: row.dataset.route, dirIdx: +row.dataset.dir, board: +row.dataset.idx });
      const other = e.target.closest(".res-item[data-id]");
      if (other) go("poste", { id: other.dataset.id }, { replace: true });
    };
    $("poste-plan").onclick = () => go("plan", { origin: { p: st.p, label: `${posteLabel(net, id)} · ${st.name}` } });
    if (!st.tram) cooled($("poste-refresh"), () => this.load());
    this.render(null);
    this.load();
    this.loadActivity();
    this.timer = setInterval(() => this.load(), 30000);
  },
  render(r) {
    $("poste-lines").innerHTML = lineTimes(app.net, this.id, r?.rows).map((x) => x.html).join("");
    $("poste-at").textContent = r ? (r.ok ? `Avanza · actualizado ${new Date(r.at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : r.health?.up ? "Avanza no da tiempos de este poste ahora (¿desvío u obras?): mostrando horario" : "Avanza no responde: mostrando horario") : app.net.stops[this.id].tram ? "Tranvía: horario previsto" : "Consultando Avanza…";
  },
  // Subidas reales registradas aquí («He subido») y si Avanza acertaba (últimos 30 días, por línea).
  async loadActivity() {
    const st = app.net.stops[this.id], el = $("poste-act");
    if (!app.social || !st.code) return;
    try {
      const r = await (await fetch(`/api/boardings?code=${st.code}`)).json();
      if (app.view !== this || !el) return;
      const rows = Object.entries(r).sort((a, b) => b[1].n - a[1].n);
      if (!rows.length) return;
      const net = app.net, route = (l) => net.routes.find((x) => x.short.toUpperCase() === l.toUpperCase());
      const demo = rows.reduce((a, [, v]) => a + v.demo, 0);
      el.hidden = false;
      el.innerHTML = `<div class="block-title">Subidas reales aquí · 30 días${demo ? ` <span class="meta">(incluye ${demo} DEMO)</span>` : ""}</div>` + rows.map(([l, v]) => {
        const rt = route(l);
        const verdict = v.early == null ? "sin dato de Avanza" : v.early <= 1.5 ? "Avanza suele acertar" : `Avanza marcaba de media <b>${v.early} min</b> de más`;
        return `<div class="act-row">${rt ? badge(rt, "xs") : esc(l)}<span>${v.n} subida${v.n > 1 ? "s" : ""} · ${verdict}</span></div>`;
      }).join("");
    } catch {}
  },
  async load() {
    const st = app.net.stops[this.id];
    if (st.tram) return;
    const r = await arrivals(st.code);
    if (app.view === this && this.id === app.params.id) this.render(r);
  },
  center() { fly({ center: app.net.stops[this.id].p, zoom: 16.5, pitch: app.flat ? 0 : 45 }); },
  onFeature(f) { if (f.layer.id === "postes" && f.properties.id !== this.id) { go("poste", { id: f.properties.id }, { replace: true }); return true; } return false; },
  leave() { clearInterval(this.timer); },
  // «Quiero ir aquí» (punto tocado en el mapa): abre la línea que mejor te lleva desde este poste, con la bajada,
  // el tramo a pie y las alternativas. Si ninguna sale de aquí, la mejor cercana; si no hay ninguna, «Cómo llegar».
  canPickGo() { return true; },
  pickGo(k) {
    const net = app.net, id = this.id, st = net.stops[id], to = { p: k.p, label: placeLabel(net, k.p) };
    const opts = plan(net, st.p, to.p).options;
    for (const o of opts) {
      const l = o.legs[0], here = net.byStop[id].find((x) => x.route === l.route && x.dirIdx === l.dirIdx && x.idx < l.to);
      if (here) return go("route", { routeId: l.route.id, dirIdx: l.dirIdx, board: here.idx, dest: l.to, to });
    }
    const l = opts[0]?.legs[0];
    if (l) return go("route", { routeId: l.route.id, dirIdx: l.dirIdx, board: l.from, dest: l.to, to });
    go("plan", { origin: { p: st.p, label: posteLabel(net, id) + " · " + st.name }, dest: to });
  },
};
