// Bizi Zaragoza: estaciones con bicis y anclajes libres (API abierta del Ayuntamiento, WGS84).
// La API es irregular (a veces responde en 2 s, a veces se cuelga), así que:
//  - cada intento tiene 9 s y se reintenta hasta 3 veces;
//  - una sola petición a la vez aunque pidan varios móviles;
//  - con datos de hace > 60 s se sirve lo último conocido al instante y se actualiza por detrás.
const URL_BIZI = "https://www.zaragoza.es/sede/servicio/urbanismo-infraestructuras/estacion-bicicleta.json?srsname=wgs84&rows=500";
let cache = { at: 0, v: null }, inflight = null;

export async function bizi() {
  if (cache.v && Date.now() - cache.at < 60000) return cache.v;
  const job = (inflight ||= load().finally(() => (inflight = null)));
  if (cache.v) return { ...cache.v, stale: Date.now() - cache.at > 5 * 60000 }; // lo último conocido mientras se actualiza
  return job;
}

async function load() {
  let err;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(URL_BIZI, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const stations = (data.result || []).filter((s) => s.geometry?.coordinates?.length === 2).map((s) => {
        const m = String(s.title || "").match(/^\s*(\d+)\s*-\s*(.*)$/);
        return {
          id: s.id, num: m ? +m[1] : null, name: (m ? m[2] : s.title || "").trim(),
          p: s.geometry.coordinates.map((x) => Math.round(x * 1e6) / 1e6),
          bikes: s.bicisDisponibles ?? null, docks: s.anclajesDisponibles ?? null,
          on: s.estado === "IN_SERVICE", updated: s.lastUpdated || null,
        };
      });
      cache = { at: Date.now(), v: { ok: true, at: Date.now(), stations } };
      return cache.v;
    } catch (e) { err = e; }
  }
  if (cache.v) return { ...cache.v, stale: true, error: String(err?.message || err) };
  return { ok: false, error: String(err?.message || err), stations: [] };
}
