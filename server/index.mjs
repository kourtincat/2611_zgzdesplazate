// Servidor de producción (sin dependencias): sirve la web compilada (dist/) y la API, y deja el grabador
// funcionando desde el arranque, sin esperar a la primera visita.
//   npm run build && npm start      (o `npm run serve`, que hace las dos cosas)
//   PORT (por defecto 8080) · HOST (por defecto 0.0.0.0) · COLLECT_BUDGET (postes por tick del grabador)
// Debe ejecutarse desde la raíz del proyecto: los datos se leen/escriben en ./data y ./public/data.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { handleApi, boot } from "./api.mjs";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("Falta dist/: ejecuta `npm run build` antes de `npm start` (o usa `npm run serve`).");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  res.setHeader("Content-Type", TYPES[ext] || "application/octet-stream");
  // Los ficheros de assets/ llevan hash en el nombre: se pueden cachear para siempre. El resto se revalida.
  res.setHeader("Cache-Control", file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
  fs.createReadStream(file).pipe(res);
}

function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") { res.statusCode = 405; return res.end(); }
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.statusCode = 400; return res.end(); }
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
  fs.stat(file, (err, st) => {
    if (!err && st.isFile()) return sendFile(res, file);
    // La navegación es de una sola página: cualquier ruta desconocida sin extensión vuelve a index.html.
    if (!path.extname(rel)) return sendFile(res, path.join(DIST, "index.html"));
    res.statusCode = 404; res.end("no encontrado");
  });
}

boot();
http.createServer((req, res) => {
  handleApi(req, res, () => serveStatic(req, res)).catch?.((e) => { res.statusCode = 500; res.end(String(e)); });
}).listen(PORT, HOST, () => console.log(`ZGZ Movilidad -> http://localhost:${PORT}`));
