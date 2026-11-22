// Carga la red (generada por scripts/build-network.mjs) y prepara la geometría de cada sentido:
//   3D -> trazado real por la calle (GTFS shapes)
//   2D -> recta de parada a parada entre las posiciones REALES de las paradas (más legible, no sigue la calle)
import { cumulative, pointAt, haversine } from "./geo.js";

export async function loadNetwork() {
  const net = await (await fetch("/data/network.json")).json();
  for (const r of net.routes) for (const d of r.dirs) prepareDir(net, d);
  net.byId = Object.fromEntries(net.routes.map((r) => [r.id, r]));
  buildIndexes(net);
  return net;
}

// Índices: líneas por parada, postes por código, vecinas a pie (correspondencias) y límites del mapa.
function buildIndexes(net) {
  net.byStop = {};
  net.byCode = {};
  for (const r of net.routes) r.dirs.forEach((d, dirIdx) => d.stops.forEach((id, idx) => {
    (net.byStop[id] ??= []).push({ route: r, dirIdx, idx });
    if (!r.tram && net.stops[id].code) net.byCode[net.stops[id].code] = id;
  }));
  const ids = Object.keys(net.byStop);
  for (const id of ids) net.stops[id].tram = net.byStop[id].every((x) => x.route.tram);
  // Vecinas a ≤ 200 m: sirven para transbordos y para mostrar correspondencias.
  net.walk = {};
  for (const a of ids) {
    const pa = net.stops[a].p;
    net.walk[a] = ids.map((b) => ({ id: b, d: haversine(pa, net.stops[b].p) })).filter((x) => x.d <= 200);
  }
  const lons = ids.map((id) => net.stops[id].p[0]), lats = ids.map((id) => net.stops[id].p[1]);
  // Margen amplio: con el Localizador abierto el mapa visible es pequeño y la cámara necesita espacio para encuadrar.
  net.bounds = [[Math.min(...lons) - 0.14, Math.min(...lats) - 0.12], [Math.max(...lons) + 0.14, Math.max(...lats) + 0.12]];
  // Núcleo urbano (percentiles 5–95 de las paradas): la vista general de Zaragoza sin los barrios rurales extremos.
  const q = (a, f) => [...a].sort((x, y) => x - y)[Math.floor(a.length * f)];
  net.core = [[q(lons, 0.05), q(lats, 0.05)], [q(lons, 0.95), q(lats, 0.95)]];
}

// Otras líneas que paran en la misma parada o en una a ≤ 150 m (correspondencias, como en el metro).
export function connections(net, stopId, exceptRouteId) {
  const seen = new Map();
  for (const n of net.walk[stopId] || []) if (n.d <= 150) for (const x of net.byStop[n.id]) {
    if (x.route.id === exceptRouteId) continue;
    if (!seen.has(x.route.id) || seen.get(x.route.id).d > n.d) seen.set(x.route.id, { route: x.route, stopId: n.id, dirIdx: x.dirIdx, idx: x.idx, d: n.d });
  }
  return [...seen.values()];
}

// Paradas cerca de un punto (ordenadas por distancia).
export function stopsNear(net, p, radius = 500, limit = 12) {
  return Object.keys(net.byStop).map((id) => ({ id, d: haversine(p, net.stops[id].p) }))
    .filter((x) => x.d <= radius).sort((a, b) => a.d - b.d).slice(0, limit);
}

// Frecuencia de paso aproximada (s) de un sentido alrededor de una hora; null si no hay servicio en la próxima hora.
export function headway(dir, type, nowSec) {
  const s = (dir.starts[type] || []).filter((t) => t >= nowSec - 3600 && t <= nowSec + 3600);
  if (!s.some((t) => t >= nowSec - dir.end)) return null;
  return Math.max(120, Math.min(3600, 7200 / Math.max(1, s.length)));
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

// Pie de vista: versión del GTFS y aviso si Avanza no ha publicado horario vigente de bus (se usa el último día con
// servicio). El tranvía viene en el mismo feed pero con calendario más largo, así que no se avisa en sus líneas.
export function feedLabel(net, route, now = new Date()) {
  const e = net.feedEnd;
  const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  if (route?.tram || !e || e >= today) return `GTFS ${net.feed}`;
  return `Horario oficial caducado el ${e.slice(6)}/${e.slice(4, 6)}/${e.slice(0, 4)}: usamos el último publicado`;
}

export const dayType = (date = new Date()) => ({ 0: "D", 6: "S" })[date.getDay()] || "L";
export const secOfDay = (date = new Date()) => date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
const TYPE_NAMES = { L: "laborables", S: "sábados", D: "domingos" };

// ¿Ya pasó hoy el último bus por la parada j? (sirve para "apagar" paradas)
export function stopDone(dir, type, j, nowSec) {
  const s = dir.starts[type] || [];
  if (!s.length) return true;
  const last = s[s.length - 1] + dir.offsets[j];
  return nowSec >= s[0] && nowSec > last; // antes de la primera salida (o de madrugada en líneas nocturnas) no está apagada
}

// Horario de servicio de una línea hoy: rango, si está activa ahora y cuándo empieza si no.
export function serviceInfo(route, type, nowSec) {
  let first = Infinity, last = -Infinity, active = false, next = Infinity;
  for (const d of route.dirs) {
    const s = d.starts[type] || [];
    if (!s.length) continue;
    first = Math.min(first, s[0]);
    last = Math.max(last, s[s.length - 1]); // última SALIDA de cabecera (horario oficial), no última llegada
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
