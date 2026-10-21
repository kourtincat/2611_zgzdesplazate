// Carga la red (generada por scripts/build-network.mjs) y prepara la geometría de cada sentido:
//   3D -> trazado real por la calle (GTFS shapes)
//   2D -> recta de parada a parada entre las posiciones REALES de las paradas (más legible, no sigue la calle)
import { cumulative, pointAt, haversine } from "./geo.js";

export async function loadNetwork() {
  const net = await (await fetch("/data/network.json")).json();
  for (const r of net.routes) for (const d of r.dirs) prepareDir(net, d);
  net.byId = Object.fromEntries(net.routes.map((r) => [r.id, r]));
  return net;
}

function prepareDir(net, d) {
  const cum = cumulative(d.shape);
  const k = cum[cum.length - 1] / (d.length || 1);
  d.real = { coords: d.shape, at: (a) => pointAt(d.shape, cum, a * k) };
  const pts = d.stops.map((id) => net.stops[id].p);
  d.flat = {
    coords: pts,
    at(a) {
      const al = d.along;
      if (a <= al[0]) return pts[0];
      for (let i = 1; i < al.length; i++) if (a <= al[i]) {
        const t = (a - al[i - 1]) / (al[i] - al[i - 1] || 1);
        return [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])];
      }
      return pts[pts.length - 1];
    },
  };
  d.end = d.offsets[d.offsets.length - 1];
}

// Parada más cercana a un punto para un sentido concreto.
export function nearestStop(net, dir, p) {
  let best = null;
  dir.stops.forEach((id, i) => {
    const d = haversine(p, net.stops[id].p);
    if (!best || d < best.d) best = { i, id, d };
  });
  return best;
}

// Líneas cerca de un punto: una entrada por línea con su parada más cercana (cualquier sentido).
export function routesNear(net, p, radius = 700) {
  const out = [];
  for (const r of net.routes) {
    const best = r.dirs.map((d) => ({ dir: d, ...nearestStop(net, d, p) })).sort((a, b) => a.d - b.d)[0];
    if (best.d <= radius) out.push({ route: r, ...best });
  }
  return out.sort((a, b) => a.d - b.d);
}

// Origen -> destino legible de un sentido: el destino del sentido contrario es nuestro origen.
export function dirLabel(net, route, d) {
  const other = route.dirs.find((x) => x !== d);
  return { from: other?.headsign || net.stops[d.stops[0]].name, to: d.headsign };
}

export const dayType = (date = new Date()) => ({ 0: "D", 6: "S" })[date.getDay()] || "L";
export const secOfDay = (date = new Date()) => date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
const TYPE_NAMES = { L: "laborables", S: "sábados", D: "domingos" };

// Horario de servicio de una línea hoy: rango, si está activa ahora y cuándo empieza si no.
export function serviceInfo(route, type, nowSec) {
  let first = Infinity, last = -Infinity, active = false, next = Infinity;
  for (const d of route.dirs) {
    const s = d.starts[type] || [];
    if (!s.length) continue;
    first = Math.min(first, s[0]);
    last = Math.max(last, s[s.length - 1] + d.end);
    for (const st of s) {
      for (const n of [nowSec, nowSec + 86400]) if (n >= st && n <= st + d.end) active = true;
      if (st > nowSec) next = Math.min(next, st);
    }
  }
  if (first === Infinity) {
    const other = ["L", "S", "D"].filter((t) => route.dirs.some((d) => d.starts[t]?.length));
    return { active: false, today: false, text: `Hoy sin servicio · sólo ${other.map((t) => TYPE_NAMES[t]).join(", ")}` };
  }
  return { active, today: true, first, last, next: next === Infinity ? null : next };
}
