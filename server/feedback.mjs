// Buzón de sugerencias anónimo: sólo se guarda el texto, la pantalla desde la que se envía y el día.
// Ni IP, ni identificador, ni hora exacta. data/feedback.ndjson (no se publica).
// Leerlo: GET /api/feedback con cabecera "Authorization: Bearer <FEEDBACK_TOKEN>" (variable de entorno),
// o directamente el fichero en el servidor.
import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.cwd(), "data", "feedback.ndjson");
const recent = new Map(); // dispositivo -> último envío (en memoria, sólo para frenar spam)
const err = (code, msg) => Object.assign(new Error(msg), { code });

export function addFeedback(b) {
  const text = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, 1500);
  if (text.length < 3) throw err(400, "Escribe algo más");
  const client = String(b.client || "").slice(0, 64), now = Date.now();
  if (client && now - (recent.get(client) || 0) < 60000) throw err(429, "Espera un minuto antes de enviar otra");
  if (client) recent.set(client, now);
  const kind = ["idea", "error", "otro"].includes(b.kind) ? b.kind : "otro";
  const rec = { day: new Date().toISOString().slice(0, 10), kind, view: String(b.view || "").slice(0, 20), text };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.appendFileSync(FILE, JSON.stringify(rec) + "\n");
  return { ok: true };
}

export function listFeedback(auth) {
  const token = process.env.FEEDBACK_TOKEN;
  if (!token || auth !== `Bearer ${token}`) throw err(401, "No autorizado");
  try { return fs.readFileSync(FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
