// Explorador de rutas: lista global de líneas (la línea se abre en la vista unificada de views/route.js).
import { app, $, esc, go, simpleTop, badge, serviceChip, pref } from "../app.js";
import { connections, serviceInfo, dayType, secOfDay } from "../network.js";

const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Lista de líneas con buscador y "Ver sólo activas" (activas primero, luego las que no están en servicio).
export function lineList(el, { placeholder = "Buscar línea o barrio (ej. 35, Delicias)" } = {}) {
  const onlyActive = pref.get("pw-only-active", "0") === "1";
  el.innerHTML = `<label class="field"><input id="line-q" placeholder="${esc(placeholder)}" autocomplete="off"></label>
    <div class="list-tools"><label class="toggle"><input type="checkbox" id="only-active" ${onlyActive ? "checked" : ""}> Ver sólo activas</label><span class="meta" id="lines-count"></span></div>
    <div id="lines-list"></div>`;
  const chip = (r, inactive) => `<button class="line-chip${inactive ? " inactive" : ""}" data-id="${r.id}">${badge(r)}<span><span class="lc-name">${esc(r.long)}</span>${serviceChip(r)}</span></button>`;
  const draw = () => {
    const q = norm($("line-q").value.trim()), only = $("only-active").checked;
    const list = app.net.routes.filter((r) => !q || norm(`${r.short} ${r.long}`).includes(q));
    const type = dayType(), now = secOfDay();
    if (!only) { $("lines-list").innerHTML = list.map((r) => chip(r, false)).join(""); $("lines-count").textContent = `${list.length} líneas`; return; }
    const act = list.filter((r) => serviceInfo(r, type, now).active), rest = list.filter((r) => !act.includes(r));
    $("lines-count").textContent = `${act.length} en servicio ahora`;
    $("lines-list").innerHTML = act.map((r) => chip(r, false)).join("") + (rest.length ? `<div class="list-sep">Sin servicio ahora</div>${rest.map((r) => chip(r, true)).join("")}` : "");
  };
  $("line-q").oninput = draw;
  $("only-active").onchange = (e) => { pref.set("pw-only-active", e.target.checked ? "1" : "0"); draw(); };
  $("lines-list").onclick = (e) => { const b = e.target.closest(".line-chip"); if (b) go("route", { routeId: b.dataset.id, dirIdx: 0 }); };
  draw();
}

export const explore = {
  name: "explore",
  snap: "full",
  enter() {
    simpleTop("Explorar rutas", "Localizador");
    lineList($("sheet-body"));
  },
};

// Chips de correspondencia de una parada (otras líneas a ≤ 150 m).
export function connChips(stopId, routeId) {
  return connections(app.net, stopId, routeId).slice(0, 6)
    .map((c) => `<button class="xchip" data-jump="${c.route.id}|${c.dirIdx}|${c.idx}" style="--c:${c.route.color};--t:${c.route.text}" title="Correspondencia con ${esc(c.route.short)}">${esc(c.route.short)}</button>`).join("");
}
