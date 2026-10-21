// Convierte el GTFS de Avanza Zaragoza (data/gtfs-raw) en un JSON compacto para el front:
//   public/data/network.json  ->  líneas, sentidos, trazado, paradas, tiempos entre paradas y salidas por tipo de día.
// Uso: npm run build:data   (descarga el GTFS si no está)
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const RAW = path.join(ROOT, "data", "gtfs-raw");
const OUT = path.join(ROOT, "public", "data", "network.json");
const GTFS_URL = "https://files.mobilitydatabase.org/mdb-2773/mdb-2773-202607010006/mdb-2773-202607010006.zip";

if (!fs.existsSync(path.join(RAW, "stop_times.txt"))) {
  fs.mkdirSync(RAW, { recursive: true });
  console.log("Descargando GTFS…");
  execSync(`curl -s -L -o "${path.join(RAW, "gtfs.zip")}" ${GTFS_URL}`, { stdio: "inherit" });
  execSync(`tar -xf gtfs.zip`, { cwd: RAW, stdio: "inherit" });
}

// --- CSV mínimo (soporta comillas) ---
function parseLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
async function eachRow(file, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(RAW, file), "utf8"), crlfDelay: Infinity });
  let head = null;
  for await (let line of rl) {
    if (!head) { head = parseLine(line.replace(/^﻿/, "")); continue; }
    if (!line.trim()) continue;
    const v = parseLine(line); const row = {};
    head.forEach((h, i) => (row[h] = v[i]));
    fn(row);
  }
}
const toSec = (t) => { const [h, m, s] = t.split(":").map(Number); return h * 3600 + m * 60 + s; };

// --- Geometría ---
const R = 6371000, rad = (d) => (d * Math.PI) / 180;
const hav = (a, b) => {
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
function cumulative(c) { const o = [0]; for (let i = 1; i < c.length; i++) o.push(o[i - 1] + hav(c[i - 1], c[i])); return o; }
function projectAlong(c, cum, p, minAlong = 0) {
  let best = { d: Infinity, a: 0 };
  const k = Math.cos(rad(p[1]));
  for (let i = 0; i < c.length - 1; i++) {
    if (cum[i + 1] < minAlong) continue;
    const ax = c[i][0] * k, ay = c[i][1], bx = c[i + 1][0] * k, by = c[i + 1][1];
    const dx = bx - ax, dy = by - ay, px = p[0] * k, py = p[1];
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const q = [c[i][0] + t * (c[i + 1][0] - c[i][0]), c[i][1] + t * (c[i + 1][1] - c[i][1])];
    const d = hav(p, q);
    if (d < best.d - 0.5) best = { d, a: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  return best.a;
}
function simplify(pts, tol) { // Douglas-Peucker en metros (aprox. plano local)
  if (pts.length < 3) return pts;
  const k = Math.cos(rad(pts[0][1])) * 111320, m = 110540;
  const P = pts.map(([x, y]) => [x * k, y * m]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let idx = -1, max = tol;
    const [ax, ay] = P[a], [bx, by] = P[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * P[i][0] - dx * P[i][1] + bx * ay - by * ax) / L;
      if (d > max) { max = d; idx = i; }
    }
    if (idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// --- Carga ---
const routes = {}, stops = {}, trips = {}, shapes = {}, services = {};
await eachRow("routes.txt", (r) => (routes[r.route_id] = r));
await eachRow("stops.txt", (r) => (stops[r.stop_id] = r));
await eachRow("trips.txt", (r) => (trips[r.trip_id] = { ...r, st: [] }));
await eachRow("shapes.txt", (r) => (shapes[r.shape_id] ??= []).push([+r.shape_pt_sequence, +r.shape_pt_lon, +r.shape_pt_lat]));
await eachRow("calendar_dates.txt", (r) => { if (r.exception_type === "1") (services[r.date] ??= new Set()).add(r.service_id); });
await eachRow("stop_times.txt", (r) => {
  const t = trips[r.trip_id]; if (t) t.st.push([+r.stop_sequence, r.stop_id, toSec(r.departure_time || r.arrival_time)]);
});
for (const s of Object.values(shapes)) s.sort((a, b) => a[0] - b[0]);

// Fechas representativas por tipo de día (L laborable = miércoles, S sábado, D domingo).
// Se eligen por línea: la próxima fecha con servicio desde hoy o, si el feed ya caducó
// para esa línea, la más reciente (los horarios de bus del feed acaban antes que los del tranvía).
const dates = Object.keys(services).sort();
const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const weekday = (d) => new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6)).getDay();
const typeOf = (d) => ({ 3: "L", 6: "S", 0: "D" })[weekday(d)];
function repDatesFor(list) {
  const svcIds = new Set(list.map((t) => t.service_id));
  const active = dates.filter((d) => typeOf(d) && [...services[d]].some((s) => svcIds.has(s)));
  const rep = {};
  for (const d of active) if (d >= today) rep[typeOf(d)] ??= d;
  for (const d of [...active].reverse()) rep[typeOf(d)] ??= d;
  return rep;
}
const repUsed = {};

// --- Patrones por línea y sentido ---
const groups = {};
for (const t of Object.values(trips)) {
  if (!t.st.length) continue;
  t.st.sort((a, b) => a[0] - b[0]);
  (groups[`${t.route_id}|${t.direction_id}`] ??= []).push(t);
}

const usedStops = new Set();
const outRoutes = {};
for (const [key, list] of Object.entries(groups)) {
  const [routeId, dir] = key.split("|");
  // Patrón canónico: la secuencia de paradas más repetida.
  const count = {};
  for (const t of list) { const k = t.st.map((x) => x[1]).join(">"); (count[k] ??= []).push(t); }
  const [seqKey, canonTrips] = Object.entries(count).sort((a, b) => b[1].length - a[1].length)[0];
  const seq = seqKey.split(">");
  const shapeCount = {};
  canonTrips.forEach((t) => (shapeCount[t.shape_id] = (shapeCount[t.shape_id] || 0) + 1));
  const shapeId = Object.entries(shapeCount).sort((a, b) => b[1] - a[1])[0][0];
  const shape = (shapes[shapeId] || []).map(([, x, y]) => [x, y]);
  const fallback = !shape.length;
  const coords = fallback ? seq.map((id) => [+stops[id].stop_lon, +stops[id].stop_lat]) : shape;
  const cum = cumulative(coords);

  // Distancia a lo largo del trazado de cada parada (monótona).
  let last = 0;
  const along = seq.map((id) => { const a = projectAlong(coords, cum, [+stops[id].stop_lon, +stops[id].stop_lat], last - 30); last = Math.max(last, a); return Math.round(last); });

  // Tiempo medio (mediana) desde la cabecera hasta cada parada.
  const idx = Object.fromEntries(seq.map((id, i) => [id, i]));
  const diffs = seq.map(() => []);
  for (const t of canonTrips) { const t0 = t.st[0][2]; t.st.forEach(([, , s], i) => diffs[i].push(s - t0)); }
  const offsets = diffs.map(median);

  // Salidas (segundos desde 00:00 en la cabecera canónica) por tipo de día.
  const starts = {};
  const repDate = repDatesFor(list);
  Object.values(repDate).forEach((d) => (repUsed[d] = true));
  for (const [type, d] of Object.entries(repDate)) {
    const svc = services[d];
    const arr = [];
    for (const t of list) {
      if (!svc.has(t.service_id)) continue;
      const first = t.st.find((x) => idx[x[1]] !== undefined);
      if (first) arr.push(Math.round(first[2] - offsets[idx[first[1]]]));
    }
    starts[type] = [...new Set(arr)].sort((a, b) => a - b);
  }

  const headsign = canonTrips[0].trip_headsign || stops[seq[seq.length - 1]].stop_name;
  // Simplificamos el trazado conservando la escala de "along" con el factor del trazado completo.
  const simp = simplify(coords, 4).map(([x, y]) => [r5(x), r5(y)]);
  seq.forEach((id) => usedStops.add(id));

  const r = routes[routeId];
  outRoutes[routeId] ??= {
    id: routeId, short: r.route_short_name, long: r.route_long_name.trim(),
    color: "#" + (r.route_color || "e30613"), text: "#" + (r.route_text_color || "ffffff"),
    tram: r.route_type === "0" || r.route_type === "900", live: r.agency_id === "1", dirs: [],
  };
  outRoutes[routeId].dirs.push({ dir: +dir, headsign, shape: simp, length: Math.round(cum[cum.length - 1]), stops: seq, along, offsets, starts, trips: list.length });
}

const outStops = {};
for (const id of usedStops) {
  const s = stops[id];
  outStops[id] = { code: +(s.stop_code || "").replace(/\D/g, "") || null, name: s.stop_name, p: [r5(+s.stop_lon), r5(+s.stop_lat)] };
}
const order = (r) => [r.tram ? 0 : 1, /^\d+$/.test(r.short) ? 0 : 1, parseInt(r.short.replace(/\D/g, "")) || 999, r.short];
const routeList = Object.values(outRoutes)
  .map((r) => ({ ...r, dirs: r.dirs.sort((a, b) => a.dir - b.dir) }))
  .sort((a, b) => { const x = order(a), y = order(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; });

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const feed = fs.readFileSync(path.join(RAW, "feed_info.txt"), "utf8").split(/\r?\n/)[1].split(",");
fs.writeFileSync(OUT, JSON.stringify({ feed: feed[5], repDates: Object.keys(repUsed).sort(), routes: routeList, stops: outStops }));
console.log(`OK -> ${path.relative(ROOT, OUT)} · ${routeList.length} líneas · ${usedStops.size} paradas · ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
