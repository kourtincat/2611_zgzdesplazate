// "Indicar dónde voy": planificador sencillo con hasta 1 transbordo.
// Modelo por frecuencias (no por horario exacto): andar hasta la parada + espera media (½ frecuencia)
// + tiempo en el vehículo según el GTFS + transbordo a pie (≤ 200 m) + andar al destino.
import { stopsNear, headway, dayType, secOfDay } from "./network.js";
import { haversine } from "./geo.js";

const WALK = 1.2;          // m/s
const DETOUR = 1.3;        // la calle no es una recta
const ACCESS = 750;        // m máximos andando al principio y al final
const TRANSFER_PENALTY = 120;
const walkT = (d) => (d * DETOUR) / WALK;

export function plan(net, origin, dest, now = new Date()) {
  const type = dayType(now), nowSec = secOfDay(now);
  const access = stopsNear(net, origin, ACCESS, 40), egress = stopsNear(net, dest, ACCESS, 40);
  const egressD = Object.fromEntries(egress.map((e) => [e.id, e.d]));
  const directWalk = walkT(haversine(origin, dest));
  const wait = new Map();
  const waitFor = (r, dirIdx) => {
    const k = `${r.id}|${dirIdx}`;
    if (!wait.has(k)) { const h = headway(r.dirs[dirIdx], type, nowSec); wait.set(k, h == null ? null : h / 2); }
    return wait.get(k);
  };

  // Ronda 1: mejor llegada a cada parada aguas abajo, por línea/sentido.
  const r1 = new Map(); // stopId -> Map(rdKey -> label)
  for (const a of access) for (const x of net.byStop[a.id]) {
    const w = waitFor(x.route, x.dirIdx); if (w == null) continue;
    const d = x.route.dirs[x.dirIdx], t0 = walkT(a.d) + w - d.offsets[x.idx];
    for (let j = x.idx + 1; j < d.stops.length; j++) {
      const t = t0 + d.offsets[j], key = `${x.route.id}|${x.dirIdx}`, id = d.stops[j];
      const m = r1.get(id) ?? new Map(); r1.set(id, m);
      if (!m.has(key) || m.get(key).t > t) m.set(key, { t, leg: { route: x.route, dirIdx: x.dirIdx, from: x.idx, to: j, wait: w, walk: a.d, fromStop: a.id } });
    }
  }

  const candidates = new Map(); // "rd1>rd2" -> itinerario
  const keep = (key, it) => { if (!candidates.has(key) || candidates.get(key).total > it.total) candidates.set(key, it); };
  for (const [id, m] of r1) if (egressD[id] != null) for (const [k, l] of m)
    keep(k, { total: l.t + walkT(egressD[id]), legs: [l.leg], endWalk: egressD[id] });

  // Ronda 2: transbordo a pie a una parada cercana y otra línea.
  for (const [s, m] of r1) for (const [k1, l1] of m) for (const n of net.walk[s]) for (const x of net.byStop[n.id]) {
    if (x.route.id === l1.leg.route.id) continue;
    const w = waitFor(x.route, x.dirIdx); if (w == null) continue;
    const d = x.route.dirs[x.dirIdx], t0 = l1.t + walkT(n.d) + TRANSFER_PENALTY + w - d.offsets[x.idx];
    for (let j = x.idx + 1; j < d.stops.length; j++) {
      const e = egressD[d.stops[j]]; if (e == null) continue;
      const total = t0 + d.offsets[j] + walkT(e);
      keep(`${k1}>${x.route.id}|${x.dirIdx}`, { total, endWalk: e, legs: [l1.leg, { route: x.route, dirIdx: x.dirIdx, from: x.idx, to: j, wait: w, walk: n.d, fromStop: n.id }] });
    }
  }

  // Mejores opciones, dando preferencia a los directos (un transbordo debe ahorrar ≥ 5 min).
  const list = [...candidates.values()].map((it) => ({ ...it, score: it.total + (it.legs.length - 1) * 300 })).sort((a, b) => a.score - b.score);
  const out = [], usedFirst = new Set();
  const bestDirect = Math.min(...list.filter((it) => it.legs.length === 1).map((it) => it.total), Infinity);
  for (const it of list) {
    if (it.legs.length > 1 && it.total > bestDirect - 300) continue; // transbordo sólo si ahorra ≥ 5 min
    const sig = it.legs.map((l) => l.route.id).join(">");
    if (usedFirst.has(sig)) continue;
    usedFirst.add(sig);
    out.push({ ...it, arrive: nowSec + it.total });
    if (out.length === 5) break;
  }
  return { options: out, walkOnly: directWalk, access: access.length, egress: egress.length };
}

