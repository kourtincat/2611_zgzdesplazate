// Funciones extra (anónimas): seguimiento GPS, "estoy en la parada", "he cogido el bus" y viaje en curso.
// La validación real está en el servidor (server/trips.mjs); aquí sólo se habilitan los botones
// cuando la ubicación lo permite, para que el usuario entienda por qué.
import { post } from "./crowd.js";

const KEY = "pw-extra";
const store = { get: () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } }, set: (v) => { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch {} } };

export const trip = {
  unlocked: store.get(),
  gps: null,        // { p:[lon,lat], acc, t } | null
  gpsError: null,
  checkin: null,    // { token, route, dir, stop (índice), t }
  ride: null,       // { id, route, dir, board, dest, status, along }
  onChange: () => {},
  _watch: null, _timer: null,
};
const changed = () => trip.onChange();

export function startGps() {
  if (trip._watch != null) return Promise.resolve(trip.gps);
  if (!navigator.geolocation) { trip.gpsError = "Este navegador no permite ubicación"; changed(); return Promise.resolve(null); }
  return new Promise((ok) => {
    let first = true;
    trip._watch = navigator.geolocation.watchPosition((pos) => {
      trip.gps = { p: [pos.coords.longitude, pos.coords.latitude], acc: pos.coords.accuracy, t: Date.now() };
      trip.gpsError = null;
      if (first) { first = false; ok(trip.gps); }
      changed();
    }, (e) => {
      trip.gpsError = e.code === 1 ? "Ubicación denegada" : "No se pudo obtener la ubicación";
      navigator.geolocation.clearWatch(trip._watch); trip._watch = null;
      if (first) { first = false; ok(null); }
      changed();
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  });
}

export async function unlock() {
  const fix = await startGps();
  trip.unlocked = !!fix; store.set(trip.unlocked);
  changed();
  return fix;
}

const gpsBody = () => ({ lon: trip.gps.p[0], lat: trip.gps.p[1], acc: trip.gps.acc });

export async function checkIn(route, dir, stopIdx) {
  const r = await post("/api/checkin", { route: route.id, dir: dir.dir, stop: dir.stops[stopIdx], ...gpsBody() });
  trip.checkin = { token: r.token, route: route.id, dir: dir.dir, stop: stopIdx, t: Date.now() };
  changed();
}

export async function board(route, dir, destIdx) {
  const c = trip.checkin;
  const r = await post("/api/board", { token: c.token, dest: destIdx != null ? dir.stops[destIdx] : null, ...gpsBody() });
  trip.ride = { id: r.id, route: route.id, dir: dir.dir, board: c.stop, dest: destIdx, status: r.status, along: null };
  trip.checkin = null;
  clearInterval(trip._timer);
  trip._timer = setInterval(sendProgress, 15000);
  changed();
}

async function sendProgress() {
  if (!trip.ride || !trip.gps) return;
  try {
    const r = await post(`/api/trip/${trip.ride.id}/progress`, gpsBody());
    trip.ride.status = r.status;
    if (r.along != null) trip.ride.along = r.along;
    changed();
  } catch { /* el viaje pudo expirar en el servidor */ }
}

export async function endRide() {
  if (!trip.ride) return null;
  clearInterval(trip._timer);
  const r = await post(`/api/trip/${trip.ride.id}/end`, {}).catch(() => ({}));
  trip.ride = null;
  changed();
  return r;
}

export const cancelCheckin = () => { trip.checkin = null; changed(); };
