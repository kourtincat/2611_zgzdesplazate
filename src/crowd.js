// Señales que no vienen de Avanza:
//  - Hábito: pasos observados por el grabador del servidor (snapshots cada 30 s) + avisos confirmados de usuarios,
//    agrupados por hora del día ("suele pasar 08:35").
//  - Señal en vivo: un usuario confirmó que subió hace poco aguas arriba -> el bus llegará a mi parada hacia X,
//    que puede ser antes o después de lo que dice Avanza.
import { dayType } from "./network.js";

const CLIENT_KEY = "pw-client-id";
export function clientId() {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(CLIENT_KEY, id); }
    return id;
  } catch { return "anon"; }
}

const get = async (url, fallback) => { try { const r = await fetch(url); return r.ok ? await r.json() : fallback; } catch { return fallback; } };
export const fetchLive = (route, dir) => get(`/api/live?route=${route.id}&dir=${dir.dir}`, { reports: [], trackers: [] });
export const fetchHabits = (route, postes, type) => get(`/api/habits?line=${route.short}&postes=${postes.join(",")}&type=${type}`, {});

export async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, client: clientId() }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error");
  return data;
}

// Hora (s del día) a la que el bus de cada aviso pasó / pasaría por la parada j.
export function passesAt(reports, dir, j) {
  const idx = Object.fromEntries(dir.stops.map((id, i) => [id, i]));
  return reports.filter((r) => idx[r.stop] !== undefined).map((r) => {
    const d = new Date(r.ts);
    const sec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + (dir.offsets[j] - dir.offsets[idx[r.stop]]);
    return { sec, day: d.toDateString(), type: dayType(d), ts: r.ts, k: idx[r.stop] };
  });
}

// Agrupa pasos cercanos (±3 min) del mismo tipo de día. Tentativo si hay ≥3 avisos de ≥2 días distintos.
export function tentative(passes, type) {
  const xs = passes.filter((p) => p.type === type).sort((a, b) => a.sec - b.sec);
  const clusters = [];
  for (const p of xs) {
    const c = clusters[clusters.length - 1];
    if (c && p.sec - c.items[c.items.length - 1].sec <= 180) c.items.push(p);
    else clusters.push({ items: [p] });
  }
  return clusters.map((c) => {
    const secs = c.items.map((p) => p.sec).sort((a, b) => a - b);
    return { sec: secs[Math.floor(secs.length / 2)], n: c.items.length, days: new Set(c.items.map((p) => p.day)).size };
  }).filter((c) => c.n >= 3 && c.days >= 2);
}

// Une hábitos del grabador y de usuarios en una sola lista ordenada (sin duplicar pasos a < 2 min).
export function mergeHabits(a, b) {
  const all = [...a, ...b].sort((x, y) => x.sec - y.sec), out = [];
  for (const h of all) {
    const last = out[out.length - 1];
    if (last && h.sec - last.sec < 120) { last.n += h.n; last.days = Math.max(last.days, h.days); } else out.push({ ...h });
  }
  return out;
}

// Señales en vivo: avisos confirmados aguas arriba en los últimos 25 min que aún no han llegado a mi parada.
export function liveSignals(passes, u, now = Date.now()) {
  return passes.filter((p) => p.k < u && now - p.ts < 25 * 60000).map((p) => {
    const d = new Date(p.ts); d.setHours(0, 0, 0, 0);
    return { at: d.getTime() + p.sec * 1000, k: p.k };
  }).filter((s) => s.at > now - 60000);
}
