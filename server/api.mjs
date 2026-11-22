// API mínima (sin dependencias) montada en el dev server de Vite.
//   GET  /api/health                         -> estado de la API de Avanza
//   GET  /api/arrivals?poste=688             -> tiempos en vivo de un poste (pasobus, caché 15 s)
//   GET  /api/scan?linea=36&postes=15,606…   -> "Revisar": tiempos de todos los postes de la línea (como la web de Avanza)
//   GET  /api/habits?line=36&postes=…&type=L -> pasos habituales observados por el grabador
//   GET  /api/live?route=36&dir=0            -> avisos confirmados (60 días) + usuarios en ruta ahora
//   POST /api/checkin | /api/board | /api/trip/:id/progress | /api/trip/:id/end   (ver server/trips.mjs)
//   GET  /api/push/key                       -> clave pública VAPID para suscribirse a notificaciones
//   POST /api/wait | /api/wait/:id (cambiar aviso) | DELETE /api/wait/:id   -> «Estoy esperando» (server/push.mjs)
//   POST /api/boarded                        -> «He subido» (guarda lo que marcaba Avanza; server/boardings.mjs)
//   POST /api/boarded/:id/undo               -> «Entrada incorrecta» (borra esa subida, 30 min máx.)
//   POST /api/feedback · GET /api/feedback (Authorization: Bearer FEEDBACK_TOKEN) -> buzón anónimo
//   GET  /api/boardings?code=262[&line=35]   -> resumen de subidas en un poste (por línea si no se indica)
//   GET  /api/activity?days=30               -> mapa de actividad: subidas por poste vs lo que marcaba Avanza
//   GET  /api/bizi                           -> estaciones Bizi con bicis y anclajes libres (caché 60 s)
//   GET  /api/alerts?linea=35                -> alteraciones del servicio de Avanza (RSS, caché 15 min)
import fs from "node:fs";
import path from "node:path";
import { poste, scanLine, healthStatus, posteStatus } from "./avanza.mjs";
import { startRecorder, watch, habits, punctualityFor, learnBoarding } from "./recorder.mjs";
import { initTrips, checkin, board, progress, end, liveTrackers, loadReports } from "./trips.mjs";
import { vapidPublicKey, addWait, updateWait, removeWait } from "./push.mjs";
import { initBoardings, recordBoarding, undoBoarding, boardingStats, activity, posteActivity } from "./boardings.mjs";
import { addFeedback, listFeedback } from "./feedback.mjs";
import { bizi } from "./bizi.mjs";
import { alerts } from "./alerts.mjs";

let started = false;
// Arranca red, viajes y grabador. En dev se llama en la primera petición /api; en producción, al arrancar (server/index.mjs).
export function boot() {
  if (started) return; started = true;
  const net = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public", "data", "network.json"), "utf8"));
  net.byId = Object.fromEntries(net.routes.map((r) => [r.id, r]));
  initTrips(net);
  initBoardings(net);
  // Bizi precargado y al día (1 petición/min al Ayuntamiento): su API a veces tarda, así nadie espera.
  bizi(); setInterval(bizi, 60000).unref?.();
  // Alteraciones de Avanza precargadas (su web puede tardar): RSS cada 15 min.
  const al = () => alerts().catch(() => {});
  al(); setInterval(al, 15 * 60e3).unref?.();
  startRecorder(net);
}

// Buscador de calles y números (OpenStreetMap vía Photon), limitado al área de Zaragoza. Caché 1 h.
const GEO_BBOX = "-1.12,41.52,-0.70,41.80";
const geoCache = new Map();
async function geocode(text) {
  const key = text.toLowerCase();
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.t < 3600000) return hit.v;
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(text + " Zaragoza")}&bbox=${GEO_BBOX}&limit=8`, {
    headers: { "User-Agent": "ZGZ-Movilidad-dev/0.3" }, signal: AbortSignal.timeout(8000),
  });
  const data = await res.json();
  const v = (data.features || []).map((f) => {
    const p = f.properties;
    const street = [p.street || p.name, p.housenumber].filter(Boolean).join(" ");
    const title = p.name && p.street ? p.name : street || p.name;
    return { title, sub: [p.name && p.street ? street : null, p.district || p.locality, p.city].filter(Boolean).join(" · "), p: f.geometry.coordinates };
  }).filter((x, i, a) => x.title && a.findIndex((y) => y.title === x.title && y.sub === x.sub) === i);
  geoCache.set(key, { t: Date.now(), v });
  return v;
}

const json = (res, code, body) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); });

export async function handleApi(req, res, next) {
  const url = new URL(req.url, "http://x");
  if (!url.pathname.startsWith("/api/")) return next?.();
  boot();
  const q = (k) => url.searchParams.get(k);
  try {
    if (url.pathname === "/api/health") return json(res, 200, healthStatus());
    if (url.pathname === "/api/arrivals") {
      const p = parseInt(q("poste"));
      if (!p) return json(res, 400, { error: "poste requerido" });
      watch(p);
      const r = await poste(p);
      // «Avanza dice 10 min, pero por lo visto otros días suele estar en ~7»: corrección por fila si hay datos.
      const rows = (r.rows || []).map((x) => (x.min != null ? { ...x, adj: punctualityFor(x.line, p, x.min) } : x));
      return json(res, 200, { ...r, rows, health: healthStatus(), posteFails: posteStatus(p).fails });
    }
    if (url.pathname === "/api/scan") {
      const postes = (q("postes") || "").split(",").map(Number).filter(Boolean);
      postes.forEach(watch);
      return json(res, 200, await scanLine(q("linea"), postes));
    }
    if (url.pathname === "/api/habits") {
      const line = (q("line") || "").toUpperCase(), type = q("type") || "L";
      const out = {};
      for (const p of (q("postes") || "").split(",")) if (habits[`${line}|${p}|${type}`]) out[p] = habits[`${line}|${p}|${type}`];
      return json(res, 200, out);
    }
    if (url.pathname === "/api/geocode") {
      const text = (q("q") || "").trim();
      if (text.length < 3) return json(res, 200, []);
      return json(res, 200, await geocode(text));
    }
    if (url.pathname === "/api/live") {
      const route = q("route"), dir = +q("dir"), since = Date.now() - 60 * 864e5;
      const reports = loadReports().filter((r) => r.ts > since && r.route === route && r.dir === dir && r.status === "confirmed")
        .map(({ route, dir, stop, ts }) => ({ route, dir, stop, ts }));
      return json(res, 200, { reports, trackers: liveTrackers(route, dir) });
    }
    if (url.pathname === "/api/feedback" && req.method === "GET") return json(res, 200, listFeedback(req.headers.authorization));
    if (url.pathname === "/api/push/key") return json(res, 200, { key: vapidPublicKey() });
    if (url.pathname === "/api/boardings") return json(res, 200, q("line") ? boardingStats(q("code"), q("line")) : posteActivity(q("code")));
    if (url.pathname === "/api/activity") return json(res, 200, activity(Math.min(90, Math.max(1, +q("days") || 30))));
    if (url.pathname === "/api/bizi") return json(res, 200, await bizi());
    if (url.pathname === "/api/alerts") return json(res, 200, await alerts(q("linea") || null));
    const w = url.pathname.match(/^\/api\/wait\/([\w-]+)$/);
    if (w && req.method === "DELETE") return json(res, 200, removeWait(w[1]));
    if (req.method === "POST") {
      const b = await readBody(req);
      if (url.pathname === "/api/checkin") return json(res, 200, checkin(b));
      if (url.pathname === "/api/board") return json(res, 201, board(b));
      if (url.pathname === "/api/wait") return json(res, 201, addWait(b));
      if (w) return json(res, 200, updateWait(w[1], b));
      if (url.pathname === "/api/boarded") {
        const out = await recordBoarding(b);
        if (out.pred && out.code) learnBoarding(out.line, out.code, out.pred);
        return json(res, 201, { ok: out.ok, id: out.id, avanzaMin: out.avanzaMin, verified: out.verified });
      }
      const u = url.pathname.match(/^\/api\/boarded\/([\w-]+)\/undo$/);
      if (u) return json(res, 200, undoBoarding(u[1], b));
      if (url.pathname === "/api/feedback") return json(res, 201, addFeedback(b));
      const m = url.pathname.match(/^\/api\/trip\/([\w-]+)\/(progress|end)$/);
      if (m) return json(res, 200, m[2] === "progress" ? progress(m[1], b) : end(m[1]));
    }
    json(res, 404, { error: "no encontrado" });
  } catch (e) {
    json(res, Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : 502, { error: String(e.message || e) });
  }
}
