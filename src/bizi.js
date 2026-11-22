// Bizi (cliente): estaciones en vivo desde /api/bizi, capa del mapa y búsqueda de las más cercanas.
// La capa sólo se ve en la pantalla Bizi; «Cerca de mí» usa biziNear() para su bloque «Bizi cerca».
import { app, esc, toast, go, myPos } from "./app.js";
import { setBizi, showLayers, showPopup } from "./map.js";

export const biziState = { stations: [], at: 0, stale: false };

export async function loadBizi(force = false) {
  if (!force && biziState.stations.length && Date.now() - biziState.at < 60000) return biziState.stations;
  try {
    const r = await (await fetch("/api/bizi")).json();
    if (r.stations?.length) { biziState.stations = r.stations; biziState.at = Date.now(); biziState.stale = !!r.stale; setBizi(app.map, r.stations); }
    if (!r.ok) toast("Bizi no responde ahora mismo");
  } catch { toast("Bizi no responde ahora mismo"); }
  return biziState.stations;
}
export const showBizi = (on) => showLayers(app.map, ["bizi", "bizi-labels"], on);

const dist = (a, b) => { const k = Math.cos((a[1] * Math.PI) / 180) * 111320; return Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 110540); };
export async function biziNear(p, max = 3, radius = 500) {
  const list = await loadBizi();
  return list.map((s) => ({ ...s, d: dist(s.p, p) })).filter((s) => s.d <= radius).sort((a, b) => a.d - b.d).slice(0, max);
}

export const biziClass = (s) => (!s.on ? "off" : s.bikes === 0 ? "none" : s.bikes < 5 ? "low" : "");
export const biziLegend = `<span class="bz-key"><span class="bz-dot"></span>5+ bicis <span class="bz-dot low"></span>1-4 <span class="bz-dot none"></span>ninguna <span class="bz-dot off"></span>fuera de servicio</span>`;
export function biziPopup(s) {
  showPopup(app.map, s.p, `<b>Bizi${s.num ? ` ${s.num}` : ""} · ${esc(s.name)}</b>
    <span>${s.on ? `<b class="live">${s.bikes}</b> bicis · ${s.docks} anclajes libres` : "Estación fuera de servicio"}</span>
    <span>${s.updated ? `actualizado ${s.updated.slice(11, 16)}` : ""}</span>
    <div class="pop-actions"><button data-pop="go" class="blue">Cómo llegar aquí</button></div>`, () => {
      const me = myPos();
      go("plan", { origin: me ? { p: me, label: "Mi ubicación" } : null, dest: { p: s.p, label: `Bizi · ${s.name}` } });
    });
}
export function onBiziClick(f) {
  if (f.layer.id !== "bizi") return false;
  const s = biziState.stations.find((x) => String(x.id) === String(f.properties.id));
  if (s) biziPopup(s);
  return !!s;
}
