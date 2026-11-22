// Acceso a Avanza Zaragoza:
//  - poste(): página "pasobus" por poste (sin nonce, rápida). Se usa para el refresco automático de tu parada.
//  - scanLine(): lo mismo que hace zaragoza.avanzagrupo.com/lineas-y-horarios: lee la lista oficial de postes
//    de la línea/sentido y pide "tiempos_de_llegada" de cada uno (WordPress admin-ajax con nonce).
// Cada respuesta correcta se pasa al grabador (snapshots) y actualiza el estado de salud de la API.
const BASE = "https://zaragoza.avanzagrupo.com";
const PASOBUS = "https://zaragoza-pasobus.avanzagrupo.com/frm_esquemaparadatime.php?poste=";
const UA = { "User-Agent": "ProjectWeb-dev/0.2" };

export const health = { lastOk: 0, lastFail: 0, fails: 0, lastError: null };
// Fallos por poste: hay postes que Avanza no sirve durante días (desvíos, obras: p. ej. 262-265 dan HTTP 500 también
// en su web). Un poste roto no debe marcar como caída toda la API.
const posteFails = new Map(); // poste -> { fails, lastFail, lastError }
const listeners = [];
export const onObservation = (fn) => listeners.push(fn);

function ok(poste, rows) {
  health.lastOk = Date.now(); health.fails = 0;
  posteFails.delete(poste);
  listeners.forEach((fn) => fn(poste, rows, Date.now()));
}
function fail(e, p) {
  const now = Date.now(), msg = String(e.message || e);
  health.lastFail = now; health.fails++; health.lastError = msg;
  if (p != null) { const f = posteFails.get(p) || { fails: 0 }; posteFails.set(p, { fails: f.fails + 1, lastFail: now, lastError: msg }); }
}
// Caída global = varios fallos seguidos y ningún acierto en 2 min. El grabador consulta varios postes cada 30 s,
// así que mientras Avanza funcione habrá aciertos recientes aunque algún poste concreto falle.
export const healthStatus = () => ({
  ...health,
  up: health.fails < 3 || Date.now() - health.lastOk < 120000,
});
export const posteStatus = (p) => posteFails.get(p) || { fails: 0 };

const strip = (s) => s.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]*>/g, " ").replace(/&#8211;|&hyphen;/g, "-").replace(/\s+/g, " ").trim();
const toMin = (txt) => { const m = txt.match(/(\d+)\s*min/i); return m ? +m[1] : /parada/i.test(txt) ? 0 : null; };

export function parsePasobus(html) {
  const rows = [];
  for (const tr of html.match(/<tr>[\s\S]*?<\/tr>/g) || []) {
    const cells = [...tr.matchAll(/<td class="digital"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
    if (cells.length < 3 || !cells[0]) continue;
    rows.push({ line: cells[0].toUpperCase(), dest: cells[1], min: toMin(cells[2]), raw: cells[2].replace(/\.$/, "") });
  }
  return rows;
}

export function parseTiempos(html) {
  return [...html.matchAll(/info-linea">([^<]*)<[\s\S]*?info-sentido">([^<]*)<[\s\S]*?info-tiempo[^>]*>([^<]*)</g)]
    .map(([, line, dest, t]) => ({ line: line.trim().toUpperCase(), dest: dest.trim(), min: toMin(t), raw: t.trim() }));
}

const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

export function poste(p) {
  return cached(`p${p}`, 15000, async () => {
    try {
      const res = await fetch(PASOBUS + p, { headers: UA, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = parsePasobus(new TextDecoder("iso-8859-1").decode(await res.arrayBuffer()));
      ok(p, rows);
      return { poste: p, at: Date.now(), ok: true, rows };
    } catch (e) { fail(e, p); return { poste: p, at: Date.now(), ok: false, rows: [], error: String(e.message || e) }; }
  });
}

// Página oficial de la línea: lista ordenada de postes + nonce para admin-ajax.
function linePage(linea, sentido) {
  return cached(`l${linea}${sentido}`, 30 * 60000, async () => {
    const res = await fetch(`${BASE}/lineas-y-horarios/?selectLinea=${encodeURIComponent(linea)}&selectSentido=${sentido}`, { headers: UA, signal: AbortSignal.timeout(10000) });
    const html = await res.text();
    const nonce = html.match(/avz_bus_ajax_nonce" value="([^"]+)/)?.[1];
    const label = strip(html.match(/<option value="\s*-?\d+" selected\s*>([^<]*)/)?.[1] || "");
    const stops = [...html.matchAll(/class="container-stop" value="(\d+)">\s*<div class="stopName">([^<]*)/g)].map(([, p, n]) => ({ poste: +p, name: strip(n) }));
    return { nonce, label, stops };
  });
}

async function tiempos(p, sentido, nonce) {
  return cached(`t${p}`, 15000, async () => {
    const body = new URLSearchParams({ action: "tiempos_de_llegada", selectPoste: p, selectSentido: sentido, nonce });
    const res = await fetch(`${BASE}/wp-admin/admin-ajax.php`, { method: "POST", body, headers: UA, signal: AbortSignal.timeout(8000) });
    const rows = parseTiempos(await res.text());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ok(p, rows);
    return rows;
  });
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// Escanea todos los postes de una línea en el sentido que mejor encaja con los postes GTFS que manda el cliente.
export async function scanLine(linea, gtfsPostes) {
  try {
    const want = new Set(gtfsPostes);
    const pages = await Promise.all([-1, -2].map((s) => linePage(linea, s).then((p) => ({ ...p, sentido: s })).catch(() => null)));
    const page = pages.filter((p) => p?.stops.length)
      .sort((a, b) => b.stops.filter((s) => want.has(s.poste)).length - a.stops.filter((s) => want.has(s.poste)).length)[0];
    if (!page?.nonce) throw new Error("No se pudo leer la línea en Avanza");
    const stops = await pool(page.stops, 5, async (s) => {
      try { return { ...s, rows: (await tiempos(s.poste, page.sentido, page.nonce)).filter((r) => r.line === linea.toUpperCase()) }; }
      catch { const r = await poste(s.poste); return { ...s, rows: r.rows.filter((x) => x.line === linea.toUpperCase()), fallback: true }; }
    });
    return { ok: true, linea, sentido: page.sentido, label: page.label, at: Date.now(), stops };
  } catch (e) {
    fail(e);
    return { ok: false, linea, at: Date.now(), error: String(e.message || e), stops: [] };
  }
}
