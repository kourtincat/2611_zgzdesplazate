// Ficha de poste: todas las líneas que paran, su dirección y sus tiempos (Avanza en vivo o horario).
import { app, $, esc, go, fly, simpleTop, myPos, posteLabel, arrivals, cooled, badge } from "../app.js";
import { setPostes } from "../map.js";
import { haversine } from "../geo.js";
import { lineTimes } from "./find.js";

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
        ${st.tram ? "" : `<button class="pill icon-refresh" id="poste-refresh" data-cool="10" data-cool-key="p${st.code}" title="Actualizar tiempos" aria-label="Actualizar tiempos">↻</button>`}
      </div>
      <div id="poste-lines" class="poste-card flat"></div>
      <p class="meta" id="poste-at"></p>
      <button class="cta small wide" id="poste-plan">Empezar trayecto aquí</button>
      ${others.length ? `<div class="block"><div class="block-title">Postes al lado (otro sentido u otras líneas)</div>${others.map((n) =>
        `<button class="res-item" data-id="${n.id}"><b>${esc(net.stops[n.id].name)}</b><span class="meta">${posteLabel(net, n.id)} · ${Math.round(n.d)} m · ${net.byStop[n.id].map((x) => badge(x.route, "xs")).join("")}</span></button>`).join("")}</div>` : ""}
      <p class="meta">Toca una línea para ver dónde vienen sus buses y marcar dónde te bajas.</p>`;
    setPostes(app.map, [{ id, p: st.p, label: st.tram ? st.name : String(st.code), sel: true }, ...others.map((n) => ({ id: n.id, p: net.stops[n.id].p, label: String(net.stops[n.id].code || "") }))]);
    fly({ center: st.p, zoom: 16.5, pitch: app.flat ? 0 : 50 });
    $("sheet-body").onclick = (e) => {
      const row = e.target.closest(".lt-row");
      if (row) return go("route", { routeId: row.dataset.route, dirIdx: +row.dataset.dir, board: +row.dataset.idx });
      const other = e.target.closest(".res-item");
      if (other) go("poste", { id: other.dataset.id }, { replace: true });
    };
    $("poste-plan").onclick = () => go("plan", { origin: { p: st.p, label: st.name } });
    if (!st.tram) cooled($("poste-refresh"), () => this.load());
    this.render(null);
    this.load();
    this.timer = setInterval(() => this.load(), 30000);
  },
  render(r) {
    $("poste-lines").innerHTML = lineTimes(app.net, this.id, r?.rows).map((x) => x.html).join("");
    $("poste-at").textContent = r ? (r.ok ? `Avanza · actualizado ${new Date(r.at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : r.health?.up ? "Avanza no da tiempos de este poste ahora (¿desvío u obras?): mostrando horario" : "Avanza no responde: mostrando horario") : app.net.stops[this.id].tram ? "Tranvía: horario previsto" : "Consultando Avanza…";
  },
  async load() {
    const st = app.net.stops[this.id];
    if (st.tram) return;
    const r = await arrivals(st.code);
    if (app.view === this && this.id === app.params.id) this.render(r);
  },
  center() { fly({ center: app.net.stops[this.id].p, zoom: 16.5 }); },
  onFeature(f) { if (f.layer.id === "postes" && f.properties.id !== this.id) { go("poste", { id: f.properties.id }, { replace: true }); return true; } return false; },
  leave() { clearInterval(this.timer); },
};
