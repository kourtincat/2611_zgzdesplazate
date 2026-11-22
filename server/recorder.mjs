// Grabador de tiempos de espera.
//  - Guarda TODO lo que se pide a Avanza (cada consulta de un usuario y las del propio grabador): cada 30 s un
//    snapshot en data/snapshots/AAAA-MM-DD.ndjson (un archivo por día, una línea JSON por snapshot).
//  - Barrido: recorre todos los postes de bus de la red cada SWEEP_MINUTES (30 por defecto) mientras hay servicio,
//    repartido en ticks de 30 s. Además, los postes que alguien está mirando se consultan en cada tick durante
//    30 min (ahí es donde se mide bien cuándo pasa el bus). COLLECT_BUDGET fija un máximo por tick si hace falta.
//  - Detecta "pasos" de bus por poste (el ETA llega a 0-1 min y luego salta hacia arriba) y los guarda en
//    data/snapshots/AAAA-MM-DD.passes.ndjson. Con los últimos 28 días se construye el modelo de hábitos
//    (data/model/habits.json): "en este poste la 36 suele pasar a las 08:35 los laborables".
//  - Puntualidad: cuando se detecta un paso, se compara con lo que Avanza había anunciado antes para ese bus
//    («dijo 10 min y pasó a los 7») → data/snapshots/AAAA-MM-DD.punct.ndjson y modelo data/model/punctuality.json.
//    Las subidas «He subido» con predicción también alimentan el modelo.
import fs from "node:fs";
import path from "node:path";
import { poste, onObservation, healthStatus } from "./avanza.mjs";

const DIR = path.resolve(process.cwd(), "data");
const SNAP = path.join(DIR, "snapshots");
const MODEL = path.join(DIR, "model", "habits.json");
const PUNCT = path.join(DIR, "model", "punctuality.json");
const TICK = 30000;
const SWEEP_MIN = +(process.env.SWEEP_MINUTES ?? 30);
const MAX_BUDGET = +(process.env.COLLECT_BUDGET ?? 40);

const latest = new Map();   // poste -> { at, rows }
const prevMin = new Map();  // "poste|line" -> { min, t } última lectura
const pending = new Map();  // "poste|line" -> [{ t, m }] predicciones del próximo bus desde el último paso
export let punct = {};      // modelo: "line|poste|bucket" y "line|*|bucket" -> { n, med, p25, p75 }
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
    if (before && before.min <= 1 && min >= before.min + 3) {
      // Pasó: hora estimada = la última lectura «≤ 1 min» + ese minuto (si la lectura es reciente; si no, la de ahora).
      const tp = at - before.t < 3 * 60000 ? before.t + before.min * 60000 : at;
      append(`${day(at)}.passes.ndjson`, { t: tp, poste: p, line });
      for (const o of pending.get(k) || []) {
        if (o.t >= tp || o.m > 45) continue;
        const err = Math.round(((tp - o.t) / 60000 - o.m) * 10) / 10; // + = llegó más tarde de lo anunciado; - = antes
        if (Math.abs(err) <= 30) { const e = { t: o.t, poste: p, line, m: o.m, err }; append(`${day(at)}.punct.ndjson`, e); learn(e); }
      }
      pending.delete(k);
    }
    // Predicción para el próximo bus (una cada 2 min como mucho, para no sobrerrepresentar postes muy consultados).
    const q = pending.get(k) || [];
    if (min > 1 && (!q.length || at - q[q.length - 1].t >= 120000)) { q.push({ t: at, m: min }); pending.set(k, q.filter((o) => at - o.t < 60 * 60000)); }
    prevMin.set(k, { min, t: at });
  }
});

function snapshot() {
  const now = Date.now(), postes = {};
  for (const [p, v] of latest) if (v.at > lastSnap - 1000) postes[p] = v.rows.map((r) => [r.line, r.min]);
  lastSnap = now;
  const h = healthStatus();
  append(`${day(now)}.ndjson`, { t: now, up: h.up, n: Object.keys(postes).length, postes });
}

// Sin servicio (aprox. 01:30-05:30) no se barre la red: sólo los postes que alguien mire.
const quiet = (t = Date.now()) => { const s = secOfDay(t); return s >= 5400 && s < 19800; };
async function poll() {
  const now = Date.now();
  const hot = [...watched].filter(([, t]) => now - t < 30 * 60000).map(([p]) => p);
  const perTick = quiet(now) ? 0 : Math.ceil(sample.length / ((SWEEP_MIN * 60000) / TICK));
  const picks = hot.slice(0, MAX_BUDGET);
  for (let i = 0; i < perTick && picks.length < MAX_BUDGET && sample.length; i++) picks.push(sample[cursor++ % sample.length]);
  // De 5 en 5 para no lanzar decenas de peticiones a la vez contra Avanza.
  const list = [...new Set(picks)];
  for (let i = 0; i < list.length; i += 5) await Promise.all(list.slice(i, i + 5).map((p) => poste(p).catch(() => null)));
}

// ---------- Modelo de puntualidad ----------
// Tramos de lo que anunciaba Avanza (min): el error no es igual a 2 min que a 20.
export const bucket = (m) => (m <= 2 ? "0-2" : m <= 5 ? "3-5" : m <= 10 ? "6-10" : m <= 20 ? "11-20" : "21+");
const errs = new Map(); // clave -> errores recientes (máx. 300)
function learn(e) {
  for (const k of [`${e.line}|${e.poste}|${bucket(e.m)}`, `${e.line}|*|${bucket(e.m)}`]) {
    const a = errs.get(k) || []; a.push(e.err); if (a.length > 300) a.shift(); errs.set(k, a);
    punct[k] = stats(a);
  }
}
const stats = (a) => { const s = [...a].sort((x, y) => x - y), q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))]; return { n: s.length, med: q(0.5), p25: q(0.25), p75: q(0.75) }; };
// Corrección para lo que anuncia Avanza ahora: primero del propio poste; si hay pocos datos, de la línea.
export function punctualityFor(line, p, m) {
  const b = bucket(m), own = punct[`${line}|${p}|${b}`], all = punct[`${line}|*|${b}`];
  const x = own?.n >= 5 ? { ...own, scope: "poste" } : all?.n >= 8 ? { ...all, scope: "línea" } : null;
  return x && { ...x, real: Math.max(0, Math.round(m + x.med)) };
}
// Una subida «He subido» con predicción: Avanza dijo pred.min y tardó pred.real.
export function learnBoarding(line, p, pred) {
  if (!pred || pred.min > 45 || pred.real == null) return;
  const e = { t: Date.now() - pred.real * 60000, poste: p, line: String(line).toUpperCase(), m: pred.min, err: Math.round((pred.real - pred.min) * 10) / 10, src: "user" };
  if (Math.abs(e.err) > 30) return;
  append(`${day()}.punct.ndjson`, e); learn(e);
}
// Reconstrucción con los últimos 28 días (al arrancar y cada día).
export function buildPunctuality() {
  errs.clear(); punct = {};
  if (!fs.existsSync(SNAP)) return punct;
  const since = Date.now() - 28 * 864e5;
  for (const f of fs.readdirSync(SNAP).filter((f) => f.endsWith(".punct.ndjson")).sort())
    for (const l of fs.readFileSync(path.join(SNAP, f), "utf8").split("\n").filter(Boolean)) { try { const e = JSON.parse(l); if (e.t >= since) learn(e); } catch {} }
  fs.mkdirSync(path.dirname(PUNCT), { recursive: true });
  fs.writeFileSync(PUNCT, JSON.stringify({ built: Date.now(), model: punct }));
  return punct;
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
  // Barrido: todos los postes de bus (el tranvía no tiene tiempos en Avanza), en orden de recorrido.
  const set = new Set();
  for (const r of network.routes) if (r.live) for (const d of r.dirs) d.stops.forEach((id) => set.add(network.stops[id].code));
  sample = [...set].filter(Boolean);
  buildPunctuality();
  try { habits = JSON.parse(fs.readFileSync(MODEL, "utf8")).habits; } catch { buildHabits(); }
  let today = day();
  setInterval(async () => {
    if (MAX_BUDGET > 0) await poll().catch(() => {});
    snapshot();
    if (day() !== today) { today = day(); buildHabits(); buildPunctuality(); } // cambio de día: se recalculan los modelos
  }, TICK);
  console.log(`[recorder] snapshots cada 30 s · barrido de ${sample.length} postes cada ${SWEEP_MIN} min (${Math.ceil(sample.length / ((SWEEP_MIN * 60000) / TICK))}/tick) · máx. ${MAX_BUDGET}/tick`);
}
