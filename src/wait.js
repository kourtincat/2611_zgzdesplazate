// «Estoy esperando»: sigue el próximo bus de una línea en tu poste con cuenta atrás y te avisa.
// - Con la app delante: consulta Avanza cada 20 s, cuenta atrás al segundo y vibra/avisa al llegar al umbral.
// - Con la app en segundo plano (saltas a otra app): el servidor vigila el poste y manda una notificación push
//   (server/push.mjs). Sin push (navegador sin soporte o permiso denegado) sólo se avisa mientras la página viva.
// «He subido»: un toque guarda la hora real y lo que marcaba Avanza en ese momento (server/boardings.mjs).
import { post } from "./crowd.js";

const KEY = "pw-wait", POLL = 20000, MAX_AGE = 75 * 60000;
const read = () => { try { const w = JSON.parse(localStorage.getItem(KEY)); return w && Date.now() - w.since < MAX_AGE ? w : null; } catch { return null; } };
const save = () => { try { wait.cur ? localStorage.setItem(KEY, JSON.stringify(wait.cur)) : localStorage.removeItem(KEY); } catch {} };

export const wait = {
  // { routeId, dirIdx, board, stopId, code, line, headsign, stopName, alertMin, since, eta: { min, next, at } | null,
  //   serverId, push: "on" | "off" | "denied" | "unsupported" | "error", fired: { alert, arrive } }
  cur: read(),
  onChange: () => {}, // la app repinta la barra y la tarjeta
  onAlert: () => {},  // aviso con la app delante (toast)
  _t: null,
};
const changed = () => { save(); wait.onChange(); };

export const isWaiting = (routeId, dirIdx, board) => !!wait.cur && wait.cur.routeId === routeId && wait.cur.dirIdx === dirIdx && wait.cur.board === board;

// Segundos que faltan según el último dato de Avanza (la cuenta atrás avanza sola entre consultas).
export function remaining(now = Date.now()) {
  const e = wait.cur?.eta;
  if (!e || e.min == null) return null;
  return Math.max(0, e.min * 60 - (now - e.at) / 1000);
}
export const fmtCount = (s) => (s == null ? "—" : s < 45 ? "YA" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);

export async function startWait(net, route, dirIdx, board, alertMin = 3) {
  const d = route.dirs[dirIdx], stopId = d.stops[board], st = net.stops[stopId];
  if (wait.cur) await stopWait();
  wait.cur = {
    routeId: route.id, dirIdx, board, stopId, code: st.code, line: route.short.toUpperCase(), headsign: d.headsign, stopName: st.name,
    alertMin, since: Date.now(), eta: null, serverId: null, push: "off", fired: { alert: false, arrive: false },
    url: location.pathname + location.search,
  };
  changed();
  run();
  await enablePush();
  return wait.cur?.push;
}

export async function stopWait() {
  const w = wait.cur;
  wait.cur = null; clearTimeout(wait._t);
  changed();
  if (w?.serverId) fetch(`/api/wait/${w.serverId}`, { method: "DELETE" }).catch(() => {});
}

export async function setAlert(min) {
  if (!wait.cur) return;
  wait.cur.alertMin = min; wait.cur.fired.alert = false;
  changed();
  if (wait.cur.serverId) post(`/api/wait/${wait.cur.serverId}`, { alertMin: min }).catch(() => {});
  check();
}

// ---------- Consulta en primer plano ----------
async function poll() {
  const w = wait.cur;
  if (!w) return;
  try {
    const r = await (await fetch(`/api/arrivals?poste=${w.code}`)).json();
    if (wait.cur !== w) return;
    if (r.ok) {
      const mins = r.rows.filter((x) => x.line === w.line && x.min != null).map((x) => x.min).sort((a, b) => a - b);
      const prev = remaining();
      w.eta = { min: mins[0] ?? null, next: mins[1] ?? null, at: Date.now() };
      if (!w.first && mins[0] != null) w.first = { min: mins[0], at: Date.now() }; // lo que dijo Avanza al empezar a esperar
      // El bus de antes ya pasó (el siguiente marca bastante más): rearmar avisos para el nuevo.
      if (prev != null && prev < 90 && mins[0] != null && mins[0] * 60 > prev + 240) w.fired = { alert: false, arrive: false };
    }
  } catch {}
  changed();
  check();
}
function run() {
  clearTimeout(wait._t);
  if (!wait.cur) return;
  poll().finally(() => { if (wait.cur) wait._t = setTimeout(run, document.hidden ? POLL * 3 : POLL); });
}

async function check() {
  const w = wait.cur, s = remaining();
  if (!w || s == null) return;
  let msg = null;
  if (s <= 60 && !w.fired.arrive) { w.fired.arrive = w.fired.alert = true; msg = `La ${w.line} está llegando a ${w.stopName}`; }
  else if (s <= w.alertMin * 60 && !w.fired.alert) { w.fired.alert = true; msg = `La ${w.line} llega en ${Math.max(1, Math.round(s / 60))} min`; }
  if (!msg) return;
  save();
  try { navigator.vibrate?.([200, 100, 200]); } catch {}
  // Con push activo el servidor ya manda la notificación; si no, la mandamos desde aquí mientras la página viva.
  if (document.hidden && w.push !== "on" && typeof Notification !== "undefined" && Notification.permission === "granted") {
    try { (await navigator.serviceWorker?.ready)?.showNotification(msg, { tag: "wait", icon: "/icons/icon-192.png", data: { url: w.url } }); } catch {}
  }
  wait.onAlert(msg);
}

// ---------- Push ----------
const b64ToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined" && isSecureContext;

async function enablePush() {
  const w = wait.cur;
  if (!w) return;
  if (!pushSupported()) { w.push = "unsupported"; return changed(); }
  try {
    const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (perm !== "granted") { w.push = "denied"; return changed(); }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { key } = await (await fetch("/api/push/key")).json();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    }
    const r = await post("/api/wait", { sub: sub.toJSON(), code: w.code, line: w.line, alertMin: w.alertMin, stopName: w.stopName, headsign: w.headsign, url: w.url });
    if (wait.cur !== w) return fetch(`/api/wait/${r.id}`, { method: "DELETE" }).catch(() => {});
    w.serverId = r.id; w.push = "on";
  } catch (e) { w.push = "error"; console.warn("push", e); }
  changed();
}
export const retryPush = () => enablePush();

// ---------- He subido ----------
// first = { min, at }: primera predicción de Avanza vista para este bus (de la espera o de la vista de línea).
export async function boarded({ route, dir, stopId, gps, waitedSince, first }) {
  const mine = wait.cur && wait.cur.stopId === stopId ? wait.cur : null;
  const shown = mine ? remaining() : null, pred = mine?.first || first || null;
  const r = await post("/api/boarded", {
    route: route.id, dir: dir.dir, stop: stopId,
    predMin: pred ? pred.min : null, predAgo: pred ? (Date.now() - pred.at) / 1000 : null,
    waited: waitedSince ? (Date.now() - waitedSince) / 1000 : null,
    shown: shown != null ? Math.round(shown / 60) : null,
    ...(gps ? { lon: gps.p[0], lat: gps.p[1], acc: gps.acc } : {}),
  });
  if (mine) await stopWait();
  saveBoarded({ id: r.id, routeId: route.id, dir: dir.dir, stopId, at: Date.now() });
  return r;
}

// Última subida (para poder deshacerla con un segundo toque durante 30 min).
const KEY_B = "pw-boarded";
export function lastBoarded() {
  try { const b = JSON.parse(localStorage.getItem(KEY_B)); return b && Date.now() - b.at < 30 * 60000 ? b : null; } catch { return null; }
}
function saveBoarded(b) { try { b ? localStorage.setItem(KEY_B, JSON.stringify(b)) : localStorage.removeItem(KEY_B); } catch {} }
export async function undoBoarded() {
  const b = lastBoarded();
  saveBoarded(null);
  if (b?.id) await post(`/api/boarded/${b.id}/undo`, {}).catch(() => {});
  return b;
}

// Al volver a la app: reanudar la espera guardada (si sigue vigente) y refrescar al instante.
export function resumeWait() { if (wait.cur) run(); }
document.addEventListener("visibilitychange", () => { if (!document.hidden && wait.cur) run(); });
