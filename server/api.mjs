// API mínima (sin dependencias) montada en el dev server de Vite.
//   GET  /api/health                         -> estado de la API de Avanza
//   GET  /api/arrivals?poste=688             -> tiempos en vivo de un poste (pasobus, caché 15 s)
//   GET  /api/scan?linea=36&postes=15,606…   -> "Revisar": tiempos de todos los postes de la línea (como la web de Avanza)
//   GET  /api/habits?line=36&postes=…&type=L -> pasos habituales observados por el grabador
//   GET  /api/live?route=36&dir=0            -> avisos confirmados (60 días) + usuarios en ruta ahora
//   POST /api/checkin | /api/board | /api/trip/:id/progress | /api/trip/:id/end   (ver server/trips.mjs)
import fs from "node:fs";
import path from "node:path";
import { poste, scanLine, healthStatus } from "./avanza.mjs";
import { startRecorder, watch, habits } from "./recorder.mjs";
import { initTrips, checkin, board, progress, end, liveTrackers, loadReports } from "./trips.mjs";

let started = false;
function boot() {
  if (started) return; started = true;
  const net = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public", "data", "network.json"), "utf8"));
  net.byId = Object.fromEntries(net.routes.map((r) => [r.id, r]));
  initTrips(net);
  startRecorder(net);
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
      return json(res, 200, { ...(await poste(p)), health: healthStatus() });
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
    if (url.pathname === "/api/live") {
      const route = q("route"), dir = +q("dir"), since = Date.now() - 60 * 864e5;
      const reports = loadReports().filter((r) => r.ts > since && r.route === route && r.dir === dir && r.status === "confirmed")
        .map(({ route, dir, stop, ts }) => ({ route, dir, stop, ts }));
      return json(res, 200, { reports, trackers: liveTrackers(route, dir) });
    }
    if (req.method === "POST") {
      const b = await readBody(req);
      if (url.pathname === "/api/checkin") return json(res, 200, checkin(b));
      if (url.pathname === "/api/board") return json(res, 201, board(b));
      const m = url.pathname.match(/^\/api\/trip\/([\w-]+)\/(progress|end)$/);
      if (m) return json(res, 200, m[2] === "progress" ? progress(m[1], b) : end(m[1]));
    }
    json(res, 404, { error: "no encontrado" });
  } catch (e) {
    json(res, e.code && e.code < 600 ? e.code : 502, { error: String(e.message || e) });
  }
}
