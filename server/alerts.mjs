// Alteraciones del servicio de Avanza (cortes, desvíos, paradas suprimidas): el RSS público de la categoría
// «Alteraciones del servicio» de su web (2 páginas, unas 20 entradas). Se lee cada 15 min y se sacan:
//  - las líneas afectadas («las líneas 22 y 32…», listas «21, 22, 23…», imágenes «Línea 35»), validadas contra el GTFS;
//  - si sigue vigente: la última fecha citada («del 11 al 13 de noviembre») aún no ha pasado, o es abierta
//    («desde el 9 de octubre», «hasta nuevo aviso»). Sin fechas, se muestran las de los últimos 30 días.
import fs from "node:fs";
import path from "node:path";

const FEED = "https://zaragoza.avanzagrupo.com/category/alteraciones-del-servicio/feed/";
const MAX_AGE = 90 * 86400e3, UNDATED_AGE = 30 * 86400e3;
const net = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "data", "network.json"), "utf8"));
const SHORTS = new Map(net.routes.filter((r) => !r.tram).map((r) => [r.short.toUpperCase(), r.short]));
let cache = { at: 0, items: [] }, inflight = null;

const ent = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const tag = (it, t) => (it.match(new RegExp("<" + t + "[^>]*>([^]*?)</" + t + ">")) || [, ""])[1].replace(/<!\[CDATA\[|\]\]>/g, "");
const text = (html) => ent(html.replace(/<(figure|script|style)[\s\S]*?<\/\1>/g, " ").replace(/<\/(p|li|h\d)>/g, ". ").replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ").replace(/\s+([.,;:])/g, "$1").replace(/\.{2,}/g, ".").replace(/(\. )+/g, ". ").trim();

// Líneas citadas: tras «línea/líneas» (hasta el final de la frase) y en las imágenes «Línea X».
export function linesIn(html) {
  const found = new Set(), plain = ent(html.replace(/<img[^>]*alt="L[ií]nea ([^"]+)"[^>]*>/gi, (_, l) => ` [[${l}]] `).replace(/<[^>]+>/g, " "));
  const add = (tok) => { const k = SHORTS.get(tok.toUpperCase()); if (k) found.add(k); };
  for (const m of plain.matchAll(/\[\[([^\]]+)\]\]/g)) add(m[1].trim());
  for (const m of plain.matchAll(/l[ií]neas?\s*:?\s*([^.;\n]{0,200})/gi))
    for (const t of m[1].matchAll(/\b(Ci\d|C\d|N\d|EM\d|TUR|\d{2})\b/gi)) add(t[1]);
  return [...found];
}

// Fin previsto: el último día citado, al final de ese día. null = abierta o sin fechas.
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DATE = /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?/.source;
export function endOf(s, pub) {
  s = s.toLowerCase();
  if (/hasta nuevo aviso|hasta su finalizaci|indefinid/.test(s)) return null;
  const y0 = new Date(pub).getFullYear(), m0 = new Date(pub).getMonth();
  let best = null;
  for (const m of s.matchAll(new RegExp(DATE, "g"))) {
    const mi = MONTHS.indexOf(m[2]), y = m[3] ? +m[3] : mi < m0 - 6 ? y0 + 1 : y0;
    if (y < y0 - 1) continue; // fechas de nombres de calle («21 de junio de 2009»)
    const t = new Date(y, mi, +m[1], 23, 59).getTime();
    if (!best || t > best) best = t;
  }
  // «desde el viernes 9 de octubre» sin «hasta / al …»: abierta.
  if (best && new RegExp(/desde (el )?([a-záéíóú]+ )?/.source + DATE).test(s) && !new RegExp(/(hasta|\bal) (el )?([a-záéíóú]+ )?/.source + DATE).test(s)) return null;
  // Resúmenes mensuales («Manifestaciones y eventos octubre 2026»): terminan con el mes, citen lo que citen.
  const mt = s.slice(0, 120).match(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(\d{4})/);
  if (mt) { const endM = new Date(+mt[2], MONTHS.indexOf(mt[1]) + 1, 0, 23, 59).getTime(); best = best ? Math.min(best, endM) : endM; }
  return best;
}

async function page(n) {
  const res = await fetch(FEED + (n > 1 ? `?paged=${n}` : ""), { headers: { "User-Agent": "Mozilla/5.0 (ZGZ Desplazate)", Accept: "application/rss+xml" }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).split("<item>").slice(1);
}

async function load() {
  const raw = [...(await page(1)), ...(await page(2).catch(() => []))], now = Date.now();
  const items = raw.map((it) => {
    const html = tag(it, "content:encoded") || tag(it, "description"), date = Date.parse(tag(it, "pubDate")), title = ent(tag(it, "title")).trim();
    const body = text(html).replace(/La entrada .* apareció primero en .*$/, "").trim(), until = endOf(title + ". " + body, date);
    return { title, url: tag(it, "link").trim(), date, until, lines: linesIn(html), text: body.length > 420 ? body.slice(0, 400).replace(/\s\S*$/, "") + "…" : body };
  }).filter((x) => x.title && x.date && now - x.date < MAX_AGE && (x.until ? x.until >= now : now - x.date < UNDATED_AGE || /desde/i.test(x.text)))
    .sort((a, b) => b.date - a.date);
  cache = { at: now, items: [...new Map(items.map((x) => [x.url, x])).values()] };
  return cache.items;
}

// Todas las alteraciones recientes, o sólo las de una línea. Si falla Avanza, lo último conocido.
export async function alerts(line) {
  if (!cache.at || Date.now() - cache.at > 15 * 60e3) {
    try { await (inflight ||= load().finally(() => (inflight = null))); } catch (e) { if (!cache.at) return { ok: false, error: String(e.message || e), items: [] }; }
  }
  const items = line ? cache.items.filter((x) => x.lines.includes(line)) : cache.items;
  return { ok: true, at: cache.at, items };
}
