// Mapa MapLibre: base vectorial oscura (OpenFreeMap) con edificios 3D, red de líneas tenue
// y la ruta seleccionada en primer plano: flechas de sentido animadas, buses como bolas amarillas
// y el tramo de tu viaje (subida -> bajada) en rojo.
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
    else if (l.type === "symbol" && !/^place_city|water_name/.test(l.id)) l.layout = { ...l.layout, visibility: "none" };
  }
  return style;
}

const fc = (features) => ({ type: "FeatureCollection", features });
const line = (coords, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } });
const point = (p, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: p } });

export async function createMap(container) {
  const map = new maplibregl.Map({
    container, style: await darkStyle(), center: [-0.889, 41.6488], zoom: 13, pitch: 55, bearing: -18, maxPitch: 75,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
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
  for (const id of ["net", "sel", "trip", "arrows", "stops", "buses"]) map.addSource(id, { type: "geojson", data: EMPTY });
  const round = { "line-cap": "round", "line-join": "round" };
  map.addLayer({ id: "net", type: "line", source: "net", layout: round, paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": ["get", "op"] } });
  map.addLayer({ id: "sel-glow", type: "line", source: "sel", layout: round, paint: { "line-color": ["get", "color"], "line-width": 22, "line-blur": 14, "line-opacity": 0.45 } });
  map.addLayer({ id: "sel-casing", type: "line", source: "sel", layout: round, paint: { "line-color": "#000", "line-width": 12 } });
  map.addLayer({ id: "sel-line", type: "line", source: "sel", layout: round, paint: { "line-color": ["get", "color"], "line-width": 8 } });
  map.addLayer({ id: "trip-line", type: "line", source: "trip", layout: round, paint: { "line-color": TRIP_RED, "line-width": 5, "line-dasharray": [1, 0] } });
  map.addLayer({ id: "arrows", type: "symbol", source: "arrows",
    layout: { "icon-image": "chev", "icon-size": 0.42, "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-rotate": ["get", "r"] },
    paint: { "icon-color": ["get", "text"] } });
  map.addLayer({ id: "stops", type: "circle", source: "stops",
    paint: {
      "circle-radius": ["case", ["any", ["get", "board"], ["get", "dest"]], 9, 5],
      "circle-color": "#fff",
      "circle-stroke-color": ["case", ["any", ["get", "board"], ["get", "dest"]], TRIP_RED, "#000"],
      "circle-stroke-width": ["case", ["any", ["get", "board"], ["get", "dest"]], 5, 2.5],
      "circle-pitch-alignment": "map",
    } });
  map.addLayer({ id: "stop-labels", type: "symbol", source: "stops", minzoom: 14.5,
    layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top", "text-max-width": 9 },
    paint: { "text-color": "#e8e8e8", "text-halo-color": "#000", "text-halo-width": 1.5 } });
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

// Red completa (vista de rutas). `near` = ids de líneas cercanas, que se resaltan.
export function setNetwork(map, net, near = null) {
  map.getSource("net").setData(fc(net.routes.flatMap((r) => r.dirs.slice(0, 1).map((d) =>
    line(d.shape, { color: r.color, op: !near ? 0.35 : near.has(r.id) ? 0.9 : 0.1 })))));
}

export function setSelection(map, net, route, dir, geom, flat, boardIdx, destIdx) {
  const has = !!route;
  map.setLayoutProperty("net", "visibility", has ? "none" : "visible");
  map.setLayoutProperty("buildings-3d", "visibility", flat ? "none" : "visible");
  if (!has) {
    for (const s of ["sel", "trip", "stops", "buses", "arrows"]) map.getSource(s).setData(EMPTY);
    return;
  }
  map.getSource("sel").setData(line(geom.coords, { color: route.color, text: route.text }));
  map.getSource("stops").setData(fc(dir.stops.map((id, i) => point(geom.at(dir.along[i]), { i, name: net.stops[id].name, board: i === boardIdx, dest: i === destIdx }))));
  // Tramo de viaje: se muestrea el trazado entre la parada de subida y la de bajada.
  if (destIdx != null && destIdx > boardIdx) {
    const a0 = dir.along[boardIdx], a1 = dir.along[destIdx], pts = [];
    for (let a = a0; a < a1; a += 20) pts.push(geom.at(a));
    pts.push(geom.at(a1));
    map.getSource("trip").setData(line(pts));
  } else map.getSource("trip").setData(EMPTY);
}

export function setBuses(map, geom, buses) {
  map.getSource("buses").setData(fc(buses.map((b) => point(geom.at(b.along), { kind: b.kind, label: b.label || "" }))));
}

// Flechas que avanzan en el sentido de la ruta.
let anim = null;
export function animateArrows(map, route, dir, geom) {
  cancelAnimationFrame(anim?.raf);
  if (!route) { map.getSource("arrows").setData(EMPTY); return; }
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
    map.getSource("arrows").setData(fc(feats));
  };
  anim = { raf: requestAnimationFrame(step) };
}

let me = null, pin = null;
export function setUser(map, p) {
  if (!me) { const el = document.createElement("div"); el.className = "me"; me = new maplibregl.Marker({ element: el }); }
  if (p) me.setLngLat(p).addTo(map); else me.remove();
}
export function setPin(map, p) {
  if (!pin) { const el = document.createElement("div"); el.className = "pin"; pin = new maplibregl.Marker({ element: el, anchor: "bottom" }); }
  if (p) pin.setLngLat(p).addTo(map); else pin.remove();
}
