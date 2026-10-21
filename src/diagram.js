// Infografías del panel: recorrido vertical tipo metro (subida/bajada, buses) y línea temporal de próximos pasos.
import { fmtClock } from "./prediction.js";
import { TRIP_RED } from "./map.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const ROW = 46;

// Recorrido vertical. buses: [{ idx (fraccional), kind: live|user|schedule|me, label }]
// conns: HTML de correspondencias por parada; simple: sin subida/bajada (explorador).
export function renderStops(el, net, route, dir, { board = null, dest = null, buses = [], etas = [], open = null, locked = false, conns = [], simple = false }) {
  const n = dir.stops.length, H = n * ROW, y = (i) => i * ROW + ROW / 2;
  let rail = `<div class="rail" style="top:${y(0)}px;height:${y(n - 1) - y(0)}px;background:${route.color}"></div>`;
  if (!simple && dest != null && dest > board) rail += `<div class="rail trip" style="top:${y(board)}px;height:${y(dest) - y(board)}px;background:${TRIP_RED}"></div>`;
  const rows = dir.stops.map((id, i) => {
    const s = net.stops[id], tag = simple ? "" : i === board ? "SUBES" : i === dest ? "BAJAS" : "";
    const between = !simple && dest != null && i > board && i < dest;
    return `<div class="row${tag ? " key" : ""}${between ? " on-trip" : ""}${!simple && i < board ? " past" : ""}${open === i ? " open" : ""}" data-i="${i}" style="height:${ROW}px">
      <span class="dot${tag ? " big" : ""}"></span>
      <span class="name">${esc(s.name)}${tag ? ` <em class="tag">${tag}</em>` : ""}${conns[i] ? `<span class="xchips">${conns[i]}</span>` : ""}</span>
      <span class="poste">${s.tram ? "" : `<small>poste</small>${s.code ?? ""}`}</span>
      <span class="eta-mini">${etas[i] ?? ""}</span>
    </div>`;
  });
  // Acciones de la fila tocada: flotan sobre la lista para no mover el recorrido.
  const actions = open != null && !locked && !simple
    ? `<div class="row-actions" style="top:${y(open) + ROW / 2 + 4}px"><button data-act="board" data-i="${open}">Subo aquí</button>${open > board ? `<button data-act="dest" data-i="${open}">Bajo aquí</button>` : ""}${open === dest ? `<button data-act="nodest" data-i="${open}">Quitar bajada</button>` : ""}</div>` : "";
  const balls = buses.map((b) => `<span class="ball ${b.kind}" style="top:${y(b.idx)}px">${b.label ? `<b>${esc(b.label)}</b>` : ""}</span>`).join("");
  el.innerHTML = `<div class="stops-wrap" style="height:${H + 50}px">${rail}${rows.join("")}${balls}${actions}</div>`;
}

// Línea temporal de los próximos `span` segundos en tu parada. users = null oculta la fila social.
export function renderTimeline(el, route, nowSec, span, { live = [], sched = [], habit = [], users = [] }) {
  const W = 320, L = 66, R = 10, rows = [["Avanza", 20], ["Horario", 44], ["Hábito", 68], ...(users ? [["Usuarios", 92]] : [])], H = users ? 104 : 80;
  const x = (t) => L + ((t - nowSec) / span) * (W - L - R);
  const inWin = (t) => t >= nowSec - 30 && t <= nowSec + span;
  let s = `<svg viewBox="0 0 ${W} ${H + 12}" width="100%" role="img" aria-label="Próximos pasos">`;
  rows.forEach(([name, yy]) => (s += `<text x="0" y="${yy + 4}" class="tl-label">${name}</text><line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" class="tl-axis"/>`));
  for (let m = 0; m <= span / 60; m += 10) {
    s += `<line x1="${x(nowSec + m * 60)}" y1="8" x2="${x(nowSec + m * 60)}" y2="${H - 4}" class="tl-grid"/>`;
    s += `<text x="${x(nowSec + m * 60)}" y="${H + 10}" text-anchor="middle" class="tl-tick">${m ? `+${m}'` : "ahora"}</text>`;
  }
  live.filter(inWin).forEach((t) => (s += `<circle cx="${x(t)}" cy="20" r="7" fill="#ffd400" stroke="#000" stroke-width="2.5"/>`));
  sched.filter(inWin).forEach((t) => (s += `<rect x="${x(t) - 1.5}" y="37" width="3" height="14" fill="#8a8f98"/>`));
  habit.filter((h) => inWin(h.sec)).forEach((h) => {
    s += `<circle cx="${x(h.sec)}" cy="68" r="${Math.min(8, 3 + h.n / 2)}" fill="none" stroke="#ffd400" stroke-width="2" stroke-dasharray="3 2"/>`;
    s += `<text x="${x(h.sec)}" y="60" text-anchor="middle" class="tl-crowd">${fmtClock(h.sec)}</text>`;
  });
  (users || []).filter(inWin).forEach((t) => (s += `<circle cx="${x(t)}" cy="92" r="6" fill="#ffd400" stroke="#fff" stroke-width="2.5"/>`));
  el.innerHTML = s + "</svg>";
}
