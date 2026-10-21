// Predicción de la posición del bus.
//
// Avanza sólo da minutos enteros por poste ("7 minutos", "En la parada"). Con el GTFS sabemos cuánto
// tarda, según horario, en ir de la cabecera a cada parada (dir.offsets). Combinando ambas cosas:
//   1. ETA en mi parada u  ->  el bus está a E segundos "de horario" de u, corregidos por un factor f
//      (f > 1: va más lento que el horario).  T = offsets[u] - E / f  es su "posición en horario".
//   2. f se calibra con una segunda parada c aguas arriba: si allí el mismo bus tiene ETA Ec,
//      f = (E - Ec) / (offsets[u] - offsets[c]). Si en c no aparece, es que ya la ha pasado.
//   3. Entre refrescos el ETA se descuenta con el reloj, para que no salte de 5 a 4 a "inminente".
//   4. T se convierte en metros sobre el trazado interpolando offsets -> along.

export const CALIB_BACK = 5; // paradas aguas arriba para calibrar la velocidad

// Distancia a lo largo del trazado (m) para una "posición en horario" T (s desde cabecera).
export function alongFromT(dir, T) {
  const o = dir.offsets, a = dir.along;
  if (T <= o[0]) return a[0];
  for (let i = 1; i < o.length; i++) {
    if (T <= o[i]) return a[i - 1] + ((T - o[i - 1]) / (o[i] - o[i - 1] || 1)) * (a[i] - a[i - 1]);
  }
  return a[a.length - 1];
}

// Índice fraccionario de parada (para el diagrama tipo metro).
export function stopIndexFromT(dir, T) {
  const o = dir.offsets;
  if (T <= o[0]) return 0;
  for (let i = 1; i < o.length; i++) if (T <= o[i]) return i - 1 + (T - o[i - 1]) / (o[i] - o[i - 1] || 1);
  return o.length - 1;
}

const matchLine = (route) => (row) => row.line === route.short.toUpperCase();

// rowsU / rowsC: filas de /api/arrivals en mi parada (u) y en la de calibración (c).
export function liveEstimate(route, dir, u, rowsU, c, rowsC, fetchedAt, now = Date.now()) {
  const elapsed = (now - fetchedAt) / 1000;
  const etasU = rowsU.filter(matchLine(route)).map((r) => r.min).filter((m) => m !== null);
  const etasC = (rowsC || []).filter(matchLine(route)).map((r) => r.min).filter((m) => m !== null);
  const usedC = new Set();
  const span = dir.offsets[u] - dir.offsets[c];
  const buses = etasU.map((min) => {
    // Minutos enteros: asumimos el punto medio del minuto.
    const E = min === 0 ? 0 : min * 60 + 30;
    let f = 1, calibrated = false;
    if (c < u && span > 0) {
      let best = null;
      etasC.forEach((mc, k) => {
        if (usedC.has(k)) return;
        const Ec = mc === 0 ? 0 : mc * 60 + 30;
        const fk = (E - Ec) / span;
        if (fk >= 0.7 && fk <= 2 && (!best || Math.abs(fk - 1) < Math.abs(best.f - 1))) best = { f: fk, k };
      });
      if (best) { f = best.f; usedC.add(best.k); calibrated = true; }
      else if (E < span) f = Math.max(0.7, E / span); // no aparece en c: ya la pasó, va al menos así de rápido
    }
    const eta = Math.max(0, E - elapsed);
    // T < 0: aún no ha salido de cabecera (o viene de la vuelta anterior); lo dejamos en cabecera.
    const T = dir.offsets[u] - eta / f;
    return { eta, T: Math.max(0, T), f, calibrated, atHead: T < 0, raw: min, source: "live" };
  });
  return buses.sort((a, b) => a.eta - b.eta);
}

// "Revisar línea": con el ETA de TODOS los postes localizamos cada bus. Si en la parada i el ETA mínimo
// es menor que en la parada anterior, hay un bus entre i-1 e i (el de i-1 ya es el siguiente bus).
export function busesFromScan(net, route, dir, scan, now = Date.now()) {
  const byPoste = Object.fromEntries(scan.stops.map((s) => [s.poste, s.rows.map((r) => r.min).filter((m) => m !== null)]));
  const elapsed = (now - scan.at) / 1000;
  const buses = [];
  let prev = Infinity;
  dir.stops.forEach((id, i) => {
    const mins = byPoste[net.stops[id].code];
    if (!mins?.length) { prev = Infinity; return; }
    const m = Math.min(...mins);
    if (m < prev) {
      const E = m === 0 ? 0 : m * 60 + 30;
      const T = Math.max(i ? dir.offsets[i - 1] : 0, dir.offsets[i] - E) + elapsed;
      if (T <= dir.end) buses.push({ T, f: 1, source: "live", fromScan: true });
    }
    prev = m;
  });
  return buses;
}

// Índice fraccionario de parada a partir de metros sobre el trazado.
export function stopIndexFromAlong(dir, a) {
  const al = dir.along;
  if (a <= al[0]) return 0;
  for (let i = 1; i < al.length; i++) if (a <= al[i]) return i - 1 + (a - al[i - 1]) / (al[i] - al[i - 1] || 1);
  return al.length - 1;
}
export function tFromAlong(dir, a) {
  const x = stopIndexFromAlong(dir, a), i = Math.floor(x), o = dir.offsets;
  return i >= o.length - 1 ? o[o.length - 1] : o[i] + (x - i) * (o[i + 1] - o[i]);
}

// ETA desde un bus (posición T, factor f) a cualquier parada j del sentido.
export const etaToStop = (dir, bus, j) => (dir.offsets[j] - bus.T) * bus.f;

// Buses "de horario": los que según el GTFS deberían estar en ruta ahora mismo.
export function scheduledBuses(dir, type, nowSec) {
  const starts = dir.starts[type] || [];
  const end = dir.offsets[dir.offsets.length - 1];
  const out = [];
  for (const s of starts) for (const n of [nowSec, nowSec + 86400]) {
    const T = n - s;
    if (T >= 0 && T <= end) out.push({ T, f: 1, source: "schedule" });
  }
  return out;
}

// Horas de paso programadas por una parada en una ventana [from, from+span] (s del día).
export function scheduledPasses(dir, type, j, from, span) {
  const out = [];
  for (const s of dir.starts[type] || []) {
    let t = s + dir.offsets[j];
    if (t >= 86400 && from < 6 * 3600) t -= 86400;
    if (t >= from && t <= from + span) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

export function fmtEta(sec) {
  if (sec == null) return "—";
  if (sec < 45) return "llegando";
  const m = Math.floor(sec / 60), s = Math.round((sec % 60) / 15) * 15;
  return m < 10 && s ? `${m}:${String(s % 60).padStart(2, "0")}` : `${Math.round(sec / 60)} min`;
}
export const fmtClock = (sec) => {
  const t = ((Math.round(sec / 60) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
