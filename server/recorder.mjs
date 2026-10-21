// Grabador de tiempos de espera.
//  - Cada 30 s guarda un snapshot de los tiempos conocidos (postes actualizados en el último minuto)
//    en data/snapshots/AAAA-MM-DD.ndjson (un archivo por día, una línea JSON por snapshot).
//  - En cada tick consulta activamente unos pocos postes (COLLECT_BUDGET, por defecto 8) en rotación:
//    primero los que miran los usuarios, luego una muestra de toda la red. Así no se satura a Avanza.
//  - Detecta "pasos" de bus por poste (el ETA llega a 0-1 min y luego salta hacia arriba) y los guarda en
//    data/snapshots/AAAA-MM-DD.passes.ndjson. Con los últimos 28 días se construye el modelo de hábitos
//    (data/model/habits.json): "en este poste la 36 suele pasar a las 08:35 los laborables".
import fs from "node:fs";
import path from "node:path";
import { poste, onObservation, healthStatus } from "./avanza.mjs";

const DIR = path.resolve(process.cwd(), "data");
const SNAP = path.join(DIR, "snapshots");
const MODEL = path.join(DIR, "model", "habits.json");
const TICK = 30000;
const BUDGET = +(process.env.COLLECT_BUDGET ?? 8);

const latest = new Map();   // poste -> { at, rows }
const prevMin = new Map();  // "poste|line" -> min ETA anterior
const watched = new Map();  // poste -> último acceso de un usuario
let sample = [], cursor = 0, lastSnap = Date.now();
export let habits = {};

const day = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const append = (file, obj) => { fs.mkdirSync(SNAP, { recursive: true }); fs.appendFileSync(path.join(SNAP, file), JSON.stringify(obj) + "\n"); };
const dayType = (t) => ({ 0: "D", 6: "S" })[new Date(t).getDay()] || "L";
const secOfDay = (t) => { const d = new Date(t); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); };

export const watch = (p) => watched.set(+p, Date.now());

onObservation((p, rows, at) => {
  latest.set(p, { at, rows });
  // Detección de paso por línea: mínimo ETA ≤ 1 min que en la siguiente lectura sube ≥ 3 min.
  const byLine = {};
  rows.forEach((r) => { if (r.min !== null) byLine[r.line] = Math.min(byLine[r.line] ?? 99, r.min); });
  for (const [line, min] of Object.entries(byLine)) {
    const k = `${p}|${line}`, before = prevMin.get(k);
    if (before !== undefined && before <= 1 && min >= before + 3) append(`${day(at)}.passes.ndjson`, { t: at, poste: p, line });
    prevMin.set(k, min);
  }
});

function snapshot() {
  const now = Date.now(), postes = {};
  for (const [p, v] of latest) if (v.at > lastSnap - 1000) postes[p] = v.rows.map((r) => [r.line, r.min]);
  lastSnap = now;
  const h = healthStatus();
  append(`${day(now)}.ndjson`, { t: now, up: h.up, n: Object.keys(postes).length, postes });
}

async function poll() {
  const now = Date.now();
  const hot = [...watched].filter(([, t]) => now - t < 30 * 60000).map(([p]) => p);
  const picks = hot.slice(0, BUDGET);
  while (picks.length < BUDGET && sample.length) picks.push(sample[cursor++ % sample.length]);
  await Promise.all([...new Set(picks)].map((p) => poste(p)));
}

// Modelo de hábitos: pasos observados de los últimos 28 días agrupados por línea|poste|tipo de día.
export function buildHabits() {
  if (!fs.existsSync(SNAP)) return (habits = {});
  const since = Date.now() - 28 * 864e5, groups = {};
  for (const f of fs.readdirSync(SNAP).filter((f) => f.endsWith(".passes.ndjson"))) {
    for (const line of fs.readFileSync(path.join(SNAP, f), "utf8").split("\n").filter(Boolean)) {
      const e = JSON.parse(line);
      if (e.t < since) continue;
      (groups[`${e.line}|${e.poste}|${dayType(e.t)}`] ??= []).push({ sec: secOfDay(e.t), day: day(e.t) });
    }
  }
  const out = {};
  for (const [k, xs] of Object.entries(groups)) {
    xs.sort((a, b) => a.sec - b.sec);
    const clusters = [];
    for (const x of xs) {
      const c = clusters[clusters.length - 1];
      if (c && x.sec - c[c.length - 1].sec <= 180) c.push(x); else clusters.push([x]);
    }
    const habit = clusters.map((c) => ({ sec: c[Math.floor(c.length / 2)].sec, n: c.length, days: new Set(c.map((x) => x.day)).size })).filter((c) => c.days >= 2);
    if (habit.length) out[k] = habit;
  }
  fs.mkdirSync(path.dirname(MODEL), { recursive: true });
  fs.writeFileSync(MODEL, JSON.stringify({ built: Date.now(), habits: out }));
  return (habits = out);
}

export function startRecorder(network) {
  // Muestra de la red: una de cada 3 paradas de cada línea/sentido (sólo bus: el tranvía no tiene tiempos en Avanza).
  const set = new Set();
  for (const r of network.routes) if (r.live) for (const d of r.dirs) d.stops.forEach((id, i) => { if (i % 3 === 0) set.add(network.stops[id].code); });
  sample = [...set].filter(Boolean);
  try { habits = JSON.parse(fs.readFileSync(MODEL, "utf8")).habits; } catch { buildHabits(); }
  let today = day();
  setInterval(async () => {
    if (BUDGET > 0) await poll().catch(() => {});
    snapshot();
    if (day() !== today) { today = day(); buildHabits(); } // cambio de día: se cierra el archivo y se recalcula el modelo
  }, TICK);
  console.log(`[recorder] snapshots cada 30 s en data/snapshots · ${sample.length} postes en rotación · ${BUDGET}/tick`);
}
