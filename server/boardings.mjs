// «He subido» a un toque: guarda la hora real de subida y lo que Avanza marcaba en ese momento para ese poste y
// línea. Es la base del mapa de actividad (fase 3): si al subir Avanza aún decía "4 min", el bus llegó 4 min antes
// de lo anunciado. El servidor consulta Avanza él mismo (no se fía del dato del móvil).
// Sin identidad: línea, sentido, parada, hora, minutos de Avanza y si la ubicación lo respalda.
// data/boardings.ndjson (una línea por subida).
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { poste } from "./avanza.mjs";
import { haversine } from "../src/geo.js";

const FILE = path.resolve(process.cwd(), "data", "boardings.ndjson");
const COOLDOWN = 3 * 60000;
let net = null;
const lastByClient = new Map();
export function initBoardings(network) { net = network; }

const err = (code, msg) => Object.assign(new Error(msg), { code });
export function readBoardings(since = 0) {
  try {
    return fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && x.ts >= since);
  } catch { return []; }
}

export async function recordBoarding(b) {
  const r = net.byId[b.route], d = r?.dirs.find((x) => x.dir === +b.dir);
  if (!d || !d.stops.includes(b.stop)) throw err(400, "Línea, sentido o parada desconocidos");
  const now = Date.now(), client = String(b.client || "").slice(0, 64);
  if (client && now - (lastByClient.get(client) || 0) < COOLDOWN) throw err(429, "Ya registraste una subida hace poco");
  const st = net.stops[b.stop];
  // Ubicación opcional: si llega, debe estar cerca de la parada para contar como verificada.
  let near = null;
  if ([b.lon, b.lat].every(Number.isFinite)) near = Math.round(haversine([b.lon, b.lat], st.p));
  const verified = near != null && near <= 150 + Math.min(+b.acc || 0, 50);
  let avanza = null;
  if (r.live && st.code) {
    const res = await poste(st.code).catch(() => null);
    if (res?.ok) avanza = res.rows.filter((x) => x.line === r.short.toUpperCase() && x.min != null).map((x) => x.min).sort((a, c) => a - c);
  }
  // Predicción: lo que marcaba Avanza cuando el usuario empezó a mirar/esperar (min) y cuánto tardó de verdad.
  const predMin = b.predMin != null && Number.isFinite(+b.predMin) ? Math.max(0, Math.min(90, Math.round(+b.predMin))) : null;
  const predAgo = b.predAgo != null && Number.isFinite(+b.predAgo) ? Math.max(0, Math.min(7200, Math.round(+b.predAgo))) : null;
  const rec = {
    id: crypto.randomUUID(), // sólo sirve para poder deshacer («entrada incorrecta»); no identifica a nadie
    ts: Math.round(now / 1000) * 1000, route: r.id, line: r.short, dir: d.dir, stop: b.stop, code: st.code || null,
    avanza, // minutos que marcaba Avanza para esta línea al subir (el primero es "el bus que has cogido")
    waited: b.waited != null && Number.isFinite(+b.waited) && +b.waited > 0 ? Math.min(7200, Math.round(+b.waited)) : null,
    shown: b.shown != null && Number.isFinite(+b.shown) ? Math.round(+b.shown) : null, // lo que veía el usuario en la app (min)
    pred: predMin != null && predAgo != null ? { min: predMin, real: Math.round(predAgo / 6) / 10 } : null, // Avanza dijo X min, tardó Y
    near, verified,
  };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.appendFileSync(FILE, JSON.stringify(rec) + "\n");
  if (client) lastByClient.set(client, now);
  return { ok: true, id: rec.id, avanzaMin: avanza?.[0] ?? null, verified };
}

// «Entrada incorrecta»: el usuario se equivocó al pulsar. Se borra la subida (sólo en los 30 min siguientes).
export function undoBoarding(id, b) {
  let found = false;
  try {
    const keep = fs.readFileSync(FILE, "utf8").split("\n").filter((l) => {
      if (!l) return false;
      if (!l.includes(id)) return true;
      try { const x = JSON.parse(l); if (x.id === id && Date.now() - x.ts < 30 * 60000) { found = true; return false; } } catch {}
      return true;
    });
    if (found) fs.writeFileSync(FILE, keep.join("\n") + (keep.length ? "\n" : ""));
  } catch {}
  const client = String(b?.client || "").slice(0, 64);
  if (found && client) lastByClient.delete(client);
  return { ok: found };
}

// Resumen de un poste y línea (últimos 30 días): cuántas subidas y cuánto se desvía Avanza de media.
export function boardingStats(code, line) {
  const since = Date.now() - 30 * 864e5, L = String(line).toUpperCase();
  const rows = readBoardings(since).filter((x) => String(x.code) === String(code) && String(x.line).toUpperCase() === L && x.avanza?.length);
  if (!rows.length) return { n: 0 };
  const diffs = rows.map((x) => Math.min(x.avanza[0], 15)); // minutos que "le sobraban" a Avanza al llegar el bus
  return { n: rows.length, avgEarly: Math.round((diffs.reduce((a, c) => a + c, 0) / rows.length) * 10) / 10 };
}

// Mapa de actividad: subidas por poste en los últimos `days` días y cuánto «le sobraba» a Avanza de media
// (minutos que aún marcaba cuando la gente ya subía). Valores altos = Avanza va por detrás de la realidad.
export function activity(days = 30) {
  const since = Date.now() - days * 864e5, by = new Map();
  for (const x of readBoardings(since)) {
    const st = net.stops[x.stop];
    if (!st) continue;
    let a = by.get(x.stop);
    if (!a) by.set(x.stop, (a = { stop: x.stop, code: st.code || null, name: st.name, p: st.p, n: 0, verified: 0, demo: 0, sumEarly: 0, nAv: 0, lines: {} }));
    a.n++; if (x.verified) a.verified++; if (x.demo) a.demo++;
    a.lines[x.line] = (a.lines[x.line] || 0) + 1;
    if (x.avanza?.length) { a.sumEarly += Math.min(x.avanza[0], 15); a.nAv++; }
  }
  return [...by.values()].map(({ sumEarly, nAv, ...a }) => ({ ...a, early: nAv ? Math.round((sumEarly / nAv) * 10) / 10 : null, nAv }));
}

// Por poste, línea a línea (para la ficha de poste).
export function posteActivity(code, days = 30) {
  const since = Date.now() - days * 864e5, out = {};
  for (const x of readBoardings(since)) {
    if (String(x.code) !== String(code)) continue;
    const o = (out[x.line] ||= { n: 0, sum: 0, nAv: 0, demo: 0 });
    o.n++; if (x.demo) o.demo++;
    if (x.avanza?.length) { o.sum += Math.min(x.avanza[0], 15); o.nAv++; }
  }
  for (const k in out) { const o = out[k]; out[k] = { n: o.n, demo: o.demo, early: o.nAv ? Math.round((o.sum / o.nAv) * 10) / 10 : null }; }
  return out;
}
