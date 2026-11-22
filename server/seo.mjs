// SEO servido desde el servidor (la app es de una sola página): cada URL recibe su propio <title>, descripción,
// enlace canónico, Open Graph, datos estructurados (schema.org) y un resumen en HTML con enlaces, que los buscadores
// leen sin ejecutar JavaScript y que la app sustituye en cuanto arranca. También sitemap.xml y robots.txt.
// SITE_URL (p. ej. https://zgzdesplazate.es) fija el dominio de los enlaces canónicos; si no, se usa el Host pedido.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const net = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "data", "network.json"), "utf8"));
const byCode = {}, byStop = {};
for (const r of net.routes) r.dirs.forEach((d, dirIdx) => d.stops.forEach((id, idx) => (byStop[id] ||= []).push({ r, dirIdx, idx })));
for (const [id, s] of Object.entries(net.stops)) if (s.code) byCode[s.code] = id;

const NAME = "ZGZ Desplázate";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// Igual que slug() de src/app.js: las URLs del servidor y de la app deben coincidir.
const slug = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/n\.?\s*º/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const dirSlug = (r, i) => { const s = slug(r.dirs[i].headsign); return r.dirs.some((d, j) => j !== i && slug(d.headsign) === s) ? `sentido-${i + 1}` : `hacia-${s}`; };
const lineUrl = (r) => `/linea/${encodeURIComponent(r.short.toLowerCase())}`;
const posteUrl = (id) => (net.stops[id].code ? `/poste/${net.stops[id].code}/${slug(net.stops[id].name)}` : `/parada/${encodeURIComponent(id)}/${slug(net.stops[id].name)}`);
const kind = (r) => (r.tram ? "Tranvía" : `Línea ${r.short}`);
const findRoute = (s) => net.routes.find((r) => r.short.toLowerCase() === String(s).toLowerCase());
const routesOf = (id) => [...new Map((byStop[id] || []).map((x) => [x.r.id, x.r])).values()];

const HOME_DESC = "Bus, tranvía y Bizi de Zaragoza: tu poste, el próximo bus en tiempo real, cuánto tarda de verdad, cómo llegar y avisos cuando llega. Gratis, anónimo y de código abierto.";

// Metadatos y resumen de una ruta de la web. status 404 = no existe (no se indexa).
export function pageFor(pathname) {
  const parts = pathname.split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  const [a, b] = parts;
  if (!a) return {
    title: `${NAME} · Bus, tranvía y Bizi de Zaragoza en tiempo real`, desc: HOME_DESC, canonical: "/",
    body: `<h1>${NAME}</h1><p>${esc(HOME_DESC)}</p><p><a href="/lineas">Todas las líneas</a> · <a href="/bizi">Bizi</a> · <a href="/ir">Cómo llegar</a> · <a href="/info">Información</a></p>`,
    ld: { "@context": "https://schema.org", "@type": "WebApplication", name: NAME, applicationCategory: "TravelApplication", operatingSystem: "Web", offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" }, inLanguage: "es" },
  };
  if (a === "linea") {
    const r = findRoute(b);
    if (!r) return null;
    const names = r.dirs.map((d) => d.headsign);
    const ends = `${net.stops[r.dirs[0].stops[0]].name} – ${r.dirs[0].headsign}`;
    return {
      title: `${kind(r)} de Zaragoza: ${r.long || ends} · paradas y próximo ${r.tram ? "tranvía" : "bus"} | ${NAME}`,
      desc: `${kind(r)} de Zaragoza en tiempo real: recorrido ${names.join(" ↔ ")}, ${r.dirs[0].stops.length} paradas, cuándo llega a cada poste y cuánto tarda de verdad.`,
      canonical: parts.length > 2 && parts[2].match(/^(hacia|sentido)-/) ? `${lineUrl(r)}/${parts[2]}` : lineUrl(r),
      body: `<h1>${esc(kind(r))} · ${esc(r.long)}</h1>` + r.dirs.map((d, i) => `<h2>Hacia ${esc(d.headsign)}</h2><ol>${d.stops.map((id) =>
        `<li><a href="${posteUrl(id)}">${esc(net.stops[id].name)}${net.stops[id].code ? ` (poste ${net.stops[id].code})` : ""}</a></li>`).join("")}</ol>
        <p><a href="${lineUrl(r)}/${dirSlug(r, i)}">Ver la línea hacia ${esc(d.headsign)} en directo</a></p>`).join(""),
      ld: { "@context": "https://schema.org", "@type": r.tram ? "TrainTrip" : "BusTrip", name: `${kind(r)} ${r.long}`, provider: { "@type": "Organization", name: r.tram ? "Tranvías de Zaragoza" : "Avanza Zaragoza" } },
    };
  }
  if (a === "poste" || a === "parada") {
    const id = a === "poste" ? byCode[b] : net.stops[b] ? b : null;
    if (!id) return null;
    const s = net.stops[id], rs = routesOf(id), label = s.code ? `Poste ${s.code}` : "Parada";
    return {
      title: `${label} ${s.name} · próximos buses ${rs.map((r) => r.short).join(", ")} en Zaragoza | ${NAME}`,
      desc: `${label} ${s.name} (Zaragoza): ${rs.map((r) => kind(r)).join(", ")}. Tiempo real del próximo ${rs.some((r) => !r.tram) ? "bus" : "tranvía"}, horarios y cómo llegar.`,
      canonical: posteUrl(id),
      body: `<h1>${esc(label)} · ${esc(s.name)}</h1><p>Líneas que paran aquí:</p><ul>${rs.map((r) => `<li><a href="${lineUrl(r)}">${esc(kind(r))} · ${esc(r.long)}</a></li>`).join("")}</ul>`,
      ld: { "@context": "https://schema.org", "@type": s.tram ? "TrainStation" : "BusStop", name: s.name, identifier: s.code ? String(s.code) : id, geo: { "@type": "GeoCoordinates", latitude: s.p[1], longitude: s.p[0] } },
    };
  }
  const simple = {
    lineas: ["Todas las líneas de bus y tranvía de Zaragoza", "Listado de todas las líneas de bus y tranvía de Zaragoza con su recorrido, paradas y tiempo real.",
      `<h1>Líneas de bus y tranvía de Zaragoza</h1><ul>${net.routes.map((r) => `<li><a href="${lineUrl(r)}">${esc(kind(r))} · ${esc(r.long)}</a></li>`).join("")}</ul>`],
    bizi: ["Bizi Zaragoza: estaciones con bicis y anclajes libres", "Estaciones Bizi de Zaragoza en tiempo real: bicis y anclajes libres cerca de ti o de cualquier calle.", "<h1>Bizi Zaragoza en tiempo real</h1>"],
    ir: ["Cómo llegar en bus y tranvía por Zaragoza", "Planifica tu trayecto en bus y tranvía por Zaragoza: opciones con transbordo, tiempo total y hora de llegada.", "<h1>Cómo llegar en bus y tranvía por Zaragoza</h1>"],
    cerca: ["Paradas de bus cerca de ti en Zaragoza", "Los postes de bus y tranvía más cercanos y cuándo llega el próximo, filtrando por línea.", "<h1>Paradas cerca de ti</h1>"],
    info: ["Información, privacidad y código abierto", "Para qué sirve ZGZ Desplázate, qué datos guarda (ninguno personal), buzón de sugerencias y código abierto.", "<h1>Información</h1>"],
  }[a];
  if (simple) return { title: `${simple[0]} | ${NAME}`, desc: simple[1], canonical: `/${a}${a === "info" && b ? `/${b}` : ""}`, body: simple[2], noindex: a === "cerca" && parts.length > 1 };
  return null;
}

let template = null;
export function renderHtml(dist, pathname, origin) {
  template ||= fs.readFileSync(path.join(dist, "index.html"), "utf8");
  const pg = pageFor(pathname);
  const p = pg || { title: `Página no encontrada | ${NAME}`, desc: HOME_DESC, canonical: "/", body: "<h1>Página no encontrada</h1><p><a href=\"/\">Ir al inicio</a></p>", noindex: true };
  const url = origin + p.canonical;
  const head = `<title>${esc(p.title)}</title>
  <meta name="description" content="${esc(p.desc)}" />
  <link rel="canonical" href="${esc(url)}" />
  ${p.noindex ? '<meta name="robots" content="noindex" />' : ""}
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${NAME}" />
  <meta property="og:locale" content="es_ES" />
  <meta property="og:title" content="${esc(p.title)}" />
  <meta property="og:description" content="${esc(p.desc)}" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:image" content="${esc(origin)}/icons/icon-512.png" />
  <meta name="twitter:card" content="summary" />
  ${p.ld ? `<script type="application/ld+json">${JSON.stringify(p.ld).replace(/</g, "\\u003c")}</script>` : ""}`;
  const html = template.replace(/<title>[^<]*<\/title>/, head)
    .replace(/<p class="meta center loading-msg">[^<]*<\/p>/, `<div class="seo-summary">${p.body}</div><p class="meta center loading-msg">Cargando mapa y red de transporte…</p>`);
  return { status: pg ? 200 : 404, html };
}

export function sitemap(origin) {
  const day = new Date().toISOString().slice(0, 10), urls = ["/", "/lineas", "/bizi", "/ir", "/info"];
  for (const r of net.routes) { urls.push(lineUrl(r)); r.dirs.forEach((_, i) => urls.push(`${lineUrl(r)}/${dirSlug(r, i)}`)); }
  for (const id of Object.keys(byStop)) urls.push(posteUrl(id));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(urls)].map((u) => `<url><loc>${esc(origin + u)}</loc><lastmod>${day}</lastmod></url>`).join("\n")}\n</urlset>\n`;
}
export const robots = (origin) => `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
