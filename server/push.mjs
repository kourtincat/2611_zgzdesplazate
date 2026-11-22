// Web Push sin dependencias (RFC 8291 aes128gcm + VAPID RFC 8292) y el vigilante de esperas:
// el móvil puede cerrar o congelar la pestaña al saltar a otra app, así que es el servidor quien consulta Avanza
// y avisa con una notificación cuando el bus está a N minutos y cuando llega.
// Las claves VAPID se generan la primera vez en data/vapid.json (no se publica).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { poste } from "./avanza.mjs";

const DATA = path.resolve(process.cwd(), "data");
const VAPID_FILE = path.join(DATA, "vapid.json");
const SUBJECT = "https://github.com/kourtincat/2611_zgzdesplazate";
const b64u = (buf) => Buffer.from(buf).toString("base64url");

let vapid = null;
function keys() {
  if (vapid) return vapid;
  try { vapid = JSON.parse(fs.readFileSync(VAPID_FILE, "utf8")); } catch {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" });
    vapid = { publicKey: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")])), privateJwk: privateKey.export({ format: "jwk" }) };
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid));
  }
  return vapid;
}
export const vapidPublicKey = () => keys().publicKey;

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

// Cifra el mensaje para la suscripción del navegador (un solo registro, sin relleno).
export function encrypt(sub, payload) {
  const uaPub = Buffer.from(sub.keys.p256dh, "base64url"), auth = Buffer.from(sub.keys.auth, "base64url");
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey(), shared = ecdh.computeSecret(uaPub), salt = crypto.randomBytes(16);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = asPub.length;
  return Buffer.concat([head, asPub, ct]);
}

function vapidAuth(endpoint) {
  const k = keys(), aud = new URL(endpoint).origin;
  const unsigned = `${b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }))}.${b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT }))}`;
  const key = crypto.createPrivateKey({ key: k.privateJwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${k.publicKey}`;
}

// Devuelve el código HTTP del servicio de push (201 = entregado; 404/410 = suscripción caducada).
export async function sendPush(sub, data) {
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "120", Urgency: "high", Authorization: vapidAuth(sub.endpoint) },
    body: encrypt(sub, JSON.stringify(data)),
    signal: AbortSignal.timeout(10000),
  });
  return res.status;
}

// ---------- Esperas ----------
// id -> { sub, code, line, alertMin, until, stopName, headsign, url, sent: { alert, arrive } }
const waits = new Map();
const MAX_WAIT = 75 * 60000, TICK = 20000;
const validSub = (s) => s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.keys?.p256dh && s.keys?.auth;

export function addWait(b) {
  if (!validSub(b.sub)) throw Object.assign(new Error("Suscripción de notificaciones no válida"), { code: 400 });
  if (!(+b.code > 0) || !b.line) throw Object.assign(new Error("Poste y línea requeridos"), { code: 400 });
  for (const [id, w] of waits) if (w.sub.endpoint === b.sub.endpoint) waits.delete(id); // una espera por dispositivo
  const id = crypto.randomUUID();
  waits.set(id, {
    sub: b.sub, code: +b.code, line: String(b.line).toUpperCase(), alertMin: Math.min(15, Math.max(1, +b.alertMin || 3)),
    until: Date.now() + MAX_WAIT, stopName: String(b.stopName || "").slice(0, 80), headsign: String(b.headsign || "").slice(0, 80),
    url: String(b.url || "/").startsWith("/") ? String(b.url || "/").slice(0, 200) : "/", sent: { alert: false, arrive: false },
  });
  start();
  return { id };
}
export function updateWait(id, b) {
  const w = waits.get(id);
  if (!w) throw Object.assign(new Error("Espera no encontrada"), { code: 404 });
  if (b.alertMin) { w.alertMin = Math.min(15, Math.max(1, +b.alertMin)); w.sent.alert = false; }
  return { ok: true };
}
export const removeWait = (id) => ({ ok: waits.delete(id) });

let timer = null;
function start() { if (!timer) timer = setInterval(tick, TICK); }
async function tick() {
  if (!waits.size) { clearInterval(timer); timer = null; return; }
  const now = Date.now(), byCode = new Map();
  for (const [id, w] of waits) {
    if (now > w.until) { waits.delete(id); continue; }
    if (!byCode.has(w.code)) byCode.set(w.code, poste(w.code).catch(() => null));
  }
  for (const [id, w] of waits) {
    const r = await byCode.get(w.code);
    if (!r?.ok) continue;
    const mins = r.rows.filter((x) => x.line === w.line && x.min != null).map((x) => x.min).sort((a, b) => a - b);
    if (!mins.length) continue;
    const m = mins[0], name = w.stopName || `poste ${w.code}`;
    let msg = null;
    if (m <= 1 && !w.sent.arrive) { w.sent.arrive = w.sent.alert = true; msg = { title: `${w.line} llegando`, body: `${m === 0 ? "Está en" : "A 1 min de"} ${name}${w.headsign ? ` · → ${w.headsign}` : ""}` }; }
    else if (m <= w.alertMin && !w.sent.alert) { w.sent.alert = true; msg = { title: `${w.line} en ${m} min`, body: `A ${name}${w.headsign ? ` · → ${w.headsign}` : ""}${mins[1] != null ? ` · el siguiente en ${mins[1]} min` : ""}` }; }
    if (!msg) continue;
    try {
      const st = await sendPush(w.sub, { ...msg, tag: `wait-${w.code}-${w.line}`, url: w.url, min: m });
      if (st === 404 || st === 410) waits.delete(id);
    } catch {}
    // Tras avisar de la llegada, la espera se cierra en 5 min (el usuario ya habrá subido o la renovará).
    if (w.sent.arrive) w.until = Math.min(w.until, now + 5 * 60000);
  }
}
