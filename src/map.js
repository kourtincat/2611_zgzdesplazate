// Mapa MapLibre: base vectorial oscura (OpenFreeMap) con edificios 3D, limitada al área de la red.
// Capas propias: red tenue, línea seleccionada (uno o ambos sentidos, en paralelo como en el metro),
// flechas de sentido animadas, paradas con SUBES/BAJAS, buses (bolas amarillas), postes buscados y trayectos planificados.
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLE = "https://tiles.openfreemap.org/styles/dark";
const EMPTY = { type: "FeatureCollection", features: [] };
export const TRIP_RED = "#ff2a2a";
const BUS_YELLOW = "#ffd400";

async function darkStyle() {
  const style = await (await fetch(STYLE)).json();
  for (const l of style.layers) {
    if (l.id === "background") l.paint = { "background-color": "#050506" };
    else if (l.id === "water") l.paint = { "fill-color": "#0a1018" };
    else if (l.id === "building") l.layout = { visibility: "none" };
    else if (/^(landuse|landcover|park)/.test(l.id)) l.paint = { ...l.paint, "fill-opacity": 0.25 };
    else if (/^highway|^road|^railway/.test(l.id) && l.type === "line") l.paint = { ...l.paint, "line-color": "#1b1d22" };
    else if (l.type === "symbol" && !/^place_|water_name|highway_name/.test(l.id)) l.layout = { ...l.layout, visibility: "none" };
  }
  return style;
}

export const fc = (features) => ({ type: "FeatureCollection", features });
export const line = (coords, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } });
export const point = (p, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: p } });

export async function createMap(container, bounds) {
  const map = new maplibregl.Map({
    container, style: await darkStyle(), center: [-0.889, 41.6488], zoom: 13, pitch: 55, bearing: -18, maxPitch: 75,
    maxBounds: bounds, minZoom: 9.5, attributionControl: { compact: true },
  });
  await new Promise((ok) => map.on("load", ok));

  // Chevron de sentido (SDF para poder colorearlo), apuntando al este.
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d");
  g.strokeStyle = "#fff"; g.lineWidth = 5; g.lineCap = g.lineJoin = "round";
  g.beginPath(); g.moveTo(11, 7); g.lineTo(21, 16); g.lineTo(11, 25); g.stroke();
  map.addImage("chev", { width: 32, height: 32, data: g.getImageData(0, 0, 32, 32).data }, { sdf: true });

  map.addLayer({
    id: "buildings-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13,
    paint: {
      "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8], 0, "#0d0e11", 60, "#1a1c22"],
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.85,
    },
  });
  for (const id of ["net", "sel", "trip", "plan", "arrows", "stops", "postes", "buses"]) map.addSource(id, { type: "geojson", data: EMPTY });
  const round = { "line-cap": "round", "line-join": "round" };
  map.addLayer({ id: "net", type: "line", source: "net", layout: round, paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": ["get", "op"] } });
  map.addLayer({ id: "sel-glow", type: "line", source: "sel", layout: round, filter: ["get", "active"],
    paint: { "line-color": ["get", "color"], "line-width": 22, "line-blur": 14, "line-opacity": 0.4, "line-offset": ["get", "off"] } });
  map.addLayer({ id: "sel-casing", type: "line", source: "sel", layout: round,
    paint: { "line-color": "#000", "line-width": ["case", ["get", "active"], 12, 8], "line-offset": ["get", "off"] } });
  map.addLayer({ id: "sel-line", type: "line", source: "sel", layout: round,
    paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "active"], 8, 4], "line-opacity": ["case", ["get", "active"], 1, 0.35], "line-offset": ["get", "off"] } });
  map.addLayer({ id: "plan-walk", type: "line", source: "plan", filter: ["==", ["get", "kind"], "walk"], layout: round,
    paint: { "line-color": "#fff", "line-width": 3, "line-dasharray": [0.5, 2] } });
  map.addLayer({ id: "plan-casing", type: "line", source: "plan", filter: ["==", ["get", "kind"], "ride"], layout: round, paint: { "line-color": "#000", "line-width": 12 } });
  map.addLayer({ id: "plan-ride", type: "line", source: "plan", filter: ["==", ["get", "kind"], "ride"], layout: round, paint: { "line-color": ["get", "color"], "line-width": 8 } });
  map.addLayer({ id: "trip-line", type: "line", source: "trip", layout: round, paint: { "line-color": TRIP_RED, "line-width": 5 } });
  map.addLayer({ id: "arrows", type: "symbol", source: "arrows",
    layout: { "icon-image": "chev", "icon-size": 0.42, "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-rotate": ["get", "r"] },
    paint: { "icon-color": ["get", "text"] } });
  const key = ["any", ["get", "board"], ["get", "dest"]];
  map.addLayer({ id: "stops", type: "circle", source: "stops",
    paint: {
      "circle-radius": ["case", key, 10, ["get", "xfer"], 7, 5],
      "circle-color": ["case", ["get", "off"], "#3a3c42", "#fff"],
      "circle-stroke-color": ["case", key, TRIP_RED, "#000"],
      "circle-stroke-width": ["case", key, 5, ["get", "xfer"], 3.5, 2.5],
      "circle-pitch-alignment": "map",
    } });
  map.addLayer({ id: "stop-labels", type: "symbol", source: "stops", minzoom: 14.5, filter: ["!", key],
    layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top", "text-max-width": 9 },
    paint: { "text-color": "#e8e8e8", "text-halo-color": "#000", "text-halo-width": 1.5 } });
  // SUBES / BAJAS, igual que en el recorrido vertical.
  map.addLayer({ id: "stop-marks", type: "symbol", source: "stops", filter: key,
    layout: { "text-field": ["case", ["get", "board"], "SUBES", "BAJAS"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, -1.8], "text-allow-overlap": true, "text-letter-spacing": 0.08 },
    paint: { "text-color": "#fff", "text-halo-color": TRIP_RED, "text-halo-width": 4 } });
  map.addLayer({ id: "postes", type: "circle", source: "postes",
    paint: { "circle-radius": ["case", ["get", "sel"], 10, 7], "circle-color": ["case", ["get", "sel"], BUS_YELLOW, "#fff"], "circle-stroke-color": "#000", "circle-stroke-width": 3, "circle-pitch-alignment": "map" } });
  map.addLayer({ id: "poste-labels", type: "symbol", source: "postes",
    layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 1.4], "text-anchor": "top", "text-max-width": 10 },
    paint: { "text-color": "#fff", "text-halo-color": "#000", "text-halo-width": 2 } });
  map.addLayer({ id: "buses-glow", type: "circle", source: "buses", filter: ["!=", ["get", "kind"], "schedule"],
    paint: { "circle-radius": 18, "circle-color": BUS_YELLOW, "circle-blur": 1, "circle-opacity": 0.6, "circle-pitch-alignment": "map" } });
  map.addLayer({ id: "buses", type: "circle", source: "buses",
    paint: {
      "circle-radius": 8,
      "circle-color": ["match", ["get", "kind"], "schedule", "rgba(0,0,0,0)", BUS_YELLOW],
      "circle-stroke-color": ["match", ["get", "kind"], "schedule", BUS_YELLOW, ["user", "me"], "#fff", "#000"],
      "circle-stroke-width": ["match", ["get", "kind"], "schedule", 2.5, 3],
      "circle-pitch-alignment": "map",
    } });
  map.addLayer({ id: "bus-labels", type: "symbol", source: "buses", filter: ["!=", ["get", "label"], ""],
    layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, -1.6], "text-allow-overlap": true },
    paint: { "text-color": BUS_YELLOW, "text-halo-color": "#000", "text-halo-width": 2 } });
  return map;
}

export const setData = (map, source, data) => map.getSource(source).setData(data || EMPTY);
export function clearLayers(map) { for (const s of ["sel", "trip", "plan", "stops", "postes", "buses"]) setData(map, s); animateArrows(map, null); }

// Red completa. `near` = ids de líneas a resaltar (null = todas por igual).
export function setNetwork(map, net, near = null, visible = true, dim = 0.08) {
  map.setLayoutProperty("net", "visibility", visible ? "visible" : "none");
  setData(map, "net", fc(net.routes.flatMap((r) => r.dirs.slice(0, 1).map((d) =>
    line(d.shape, { color: r.color, op: !near ? 0.35 : near.has(r.id) ? 0.9 : dim })))));
}

// Línea: todos los sentidos dibujados en paralelo (offset) y el activo resaltado.
export function setLine(map, route, geoms, activeIdx, { onlyActive = false } = {}) {
  setData(map, "sel", fc(geoms.map((g, i) => (onlyActive && i !== activeIdx ? null : line(g.coords, {
    color: route.color, text: route.text, active: i === activeIdx, off: geoms.length > 1 && !onlyActive ? (i === 0 ? -4 : 4) : 0,
  }))).filter(Boolean)));
}

export function setStops(map, net, dir, geom, { board = null, dest = null, xfer = () => false, off = () => false } = {}) {
  setData(map, "stops", fc(dir.stops.map((id, i) => point(geom.at(dir.along[i]), {
    i, id, name: net.stops[id].name, board: i === board, dest: i === dest, xfer: xfer(id), off: off(i),
  }))));
}

export function setTrip(map, dir, geom, board, dest) {
  if (dest == null || dest <= board) return setData(map, "trip");
  const a0 = dir.along[board], a1 = dir.along[dest], pts = [];
  for (let a = a0; a < a1; a += 20) pts.push(geom.at(a));
  pts.push(geom.at(a1));
  setData(map, "trip", line(pts));
}

export const setBuses = (map, geom, buses) => setData(map, "buses", fc(buses.map((b) => point(geom.at(b.along), { kind: b.kind, label: b.label || "" }))));
export const setPostes = (map, list) => setData(map, "postes", fc(list.map((x) => point(x.p, { id: x.id, label: x.label || "", sel: !!x.sel }))));

// Flechas que avanzan en el sentido de la ruta.
let anim = null;
export function animateArrows(map, route, dir, geom) {
  cancelAnimationFrame(anim?.raf);
  if (!route) { setData(map, "arrows"); return; }
  const SPACING = 160, SPEED = 40; // m entre flechas, m/s de desplazamiento visual
  const bearing = (a, b) => (Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI;
  let lastDraw = 0;
  const step = (t) => {
    anim.raf = requestAnimationFrame(step);
    if (t - lastDraw < 50) return; // ~20 fps
    lastDraw = t;
    const phase = ((t / 1000) * SPEED) % SPACING, feats = [];
    for (let a = phase; a < dir.length; a += SPACING) {
      const p = geom.at(a), q = geom.at(a + 6);
      feats.push(point(p, { r: bearing(p, q) - 90, text: route.text }));
    }
    setData(map, "arrows", fc(feats));
  };
  anim = { raf: requestAnimationFrame(step) };
}

// Marcadores DOM: tu ubicación, punto elegido y origen/destino del trayecto.
const markers = {};
export function setMarker(map, name, p, { className, text, onClick } = {}) {
  if (!markers[name]) {
    const el = document.createElement("div");
    el.className = className || name;
    if (text) el.textContent = text;
    if (onClick) el.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
    markers[name] = new maplibregl.Marker({ element: el, anchor: name === "me" ? "center" : "bottom" });
  }
  if (p) markers[name].setLngLat(p).addTo(map); else markers[name].remove();
}

let popup = null;
export function showPopup(map, p, html, onClick) {
  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: false, offset: 14, className: "stop-pop" }).setLngLat(p).setHTML(html).addTo(map);
  popup.getElement().addEventListener("click", (e) => { const b = e.target.closest("[data-pop]"); if (b) { onClick(b.dataset.pop); popup.remove(); } });
}
export const closePopup = () => popup?.remove();
