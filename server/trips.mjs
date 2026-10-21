// Funciones extra anónimas con validación por ubicación (para que no sea fácil "engañar" al sistema):
//   1. check-in: "estoy en la parada X"  -> la posición debe estar a ≤ 80 m de la parada (precisión ≤ 100 m).
//   2. board:    "he cogido el bus"      -> requiere check-in de < 30 min y seguir cerca de la parada.
//                Se crea un aviso en estado "pending".
//   3. progress: posiciones durante el viaje. Pasa a "confirmed" cuando el usuario avanza ≥ 250 m
//                sobre el trazado de la línea, a ≤ 100 m de él y a velocidad plausible (< 25 m/s).
//   4. end:      si nunca se confirmó, el aviso se descarta.
// No se guarda identidad ni recorrido: sólo línea, sentido, parada y hora (y un id aleatorio del dispositivo
// para limitar abusos). Las posiciones en vivo de viajes activos se comparten 90 s como "bus visto por usuario".
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { haversine, cumulative, project } from "../src/geo.js";

const REPORTS = path.resolve(process.cwd(), "data", "reports.json");
let net = null;
const checkins = new Map(), trips = new Map();

export function initTrips(network) {
  net = network;
  for (const r of net.routes) for (const d of r.dirs) {
    const cum = cumulative(d.shape);
    d._cum = cum; d._k = cum[cum.length - 1] / (d.length || 1);
  }
}
export const loadReports = () => { try { return JSON.parse(fs.readFileSync(REPORTS, "utf8")); } catch { return []; } };
const saveReports = (all) => { fs.mkdirSync(path.dirname(REPORTS), { recursive: true }); fs.writeFileSync(REPORTS, JSON.stringify(all)); };
const err = (code, msg) => Object.assign(new Error(msg), { code });

function findDir(route, dir) {
  const d = net.byId[route]?.dirs.find((x) => x.dir === +dir);
  if (!d) throw err(400, "Línea o sentido desconocido");
  return d;
}
function checkPos(b, stopId, max) {
  if (![b.lon, b.lat].every(Number.isFinite)) throw err(400, "Ubicación requerida");
  if (!(b.acc <= 100)) throw err(422, "La precisión del GPS es baja; espera unos segundos");
  const d = haversine([b.lon, b.lat], net.stops[stopId].p);
  if (d > max + Math.min(b.acc, 40)) throw err(422, `Estás a ${Math.round(d)} m de la parada`);
  return d;
}

export function checkin(b) {
  const d = findDir(b.route, b.dir);
  if (!d.stops.includes(b.stop)) throw err(400, "La parada no es de esta línea");
  checkPos(b, b.stop, 80);
  const token = crypto.randomUUID();
  checkins.set(token, { route: b.route, dir: +b.dir, stop: b.stop, client: b.client, t: Date.now() });
  return { token, stop: b.stop };
}

export function board(b) {
  const c = checkins.get(b.token);
  if (!c || Date.now() - c.t > 30 * 60000) throw err(410, "Primero indica que estás en la parada");
  checkPos(b, c.stop, 120);
  for (const [id, t] of trips) if (t.client === c.client) trips.delete(id); // un viaje activo por dispositivo
  const d = findDir(c.route, c.dir);
  const start = project(d.shape, d._cum, net.stops[c.stop].p).along;
  const rep = { id: crypto.randomUUID(), route: c.route, dir: c.dir, stop: c.stop, dest: b.dest || null, ts: Date.now(), status: "pending" };
  const all = loadReports(); all.push(rep); saveReports(all);
  trips.set(rep.id, { ...rep, client: c.client, start, last: { along: start, t: Date.now() }, live: null });
  checkins.delete(b.token);
  return rep;
}

export function progress(id, b) {
  const t = trips.get(id);
  if (!t) throw err(404, "Viaje no encontrado");
  if (!(b.acc <= 150)) return { status: t.status, note: "precisión baja" };
  const d = findDir(t.route, t.dir);
  const pr = project(d.shape, d._cum, [b.lon, b.lat]);
  if (pr.dist > 100) return { status: t.status, note: "fuera de la ruta" };
  const now = Date.now(), speed = (pr.along - t.last.along) / ((now - t.last.t) / 1000 || 1);
  if (speed > 25) return { status: t.status, note: "velocidad no plausible" };
  t.last = { along: pr.along, t: now };
  const along = pr.along / d._k; // a unidades de la red (metros GTFS)
  t.live = { along, t: now };
  if (t.status === "pending" && pr.along - t.start >= 250 && now - t.ts >= 30000) {
    t.status = "confirmed";
    const all = loadReports(); const r = all.find((x) => x.id === id);
    if (r) { r.status = "confirmed"; saveReports(all); }
  }
  return { status: t.status, along };
}

export function end(id) {
  const t = trips.get(id);
  if (!t) return { ok: true };
  trips.delete(id);
  if (t.status !== "confirmed") saveReports(loadReports().filter((r) => r.id !== id));
  return { ok: true, status: t.status };
}

// Buses "vistos" por usuarios en ruta (últimos 90 s).
export const liveTrackers = (route, dir) => [...trips.values()]
  .filter((t) => t.route === route && t.dir === +dir && t.live && Date.now() - t.live.t < 90000)
  .map((t) => ({ along: t.live.along, at: t.live.t, status: t.status, stop: t.stop }));
