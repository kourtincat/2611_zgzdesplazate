// Favoritos y recientes (sólo en este navegador, localStorage).
//   { t: "poste", id }                         -> un poste con todas sus líneas
//   { t: "linea", routeId, dirIdx, board }     -> una línea en un sentido, opcionalmente en tu parada (board = índice)
const KEY_FAV = "pw-favs", KEY_RECENT = "pw-recent";
const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const keyOf = (x) => (x.t === "poste" ? `p:${x.id}` : `l:${x.routeId}:${x.dirIdx}:${x.board ?? ""}`);
const clean = (x) => (x.t === "poste" ? { t: "poste", id: x.id } : { t: "linea", routeId: x.routeId, dirIdx: x.dirIdx ?? 0, board: x.board ?? null });

// Tras actualizar el GTFS pueden desaparecer paradas o líneas: se descartan las entradas que ya no existen.
export function valid(net, x) {
  if (x.t === "poste") return !!net.byStop[x.id];
  const r = net.byId[x.routeId], d = r?.dirs[x.dirIdx];
  return !!d && (x.board == null || x.board < d.stops.length);
}

export const favs = (net) => read(KEY_FAV).filter((x) => !net || valid(net, x));
export const isFav = (x) => read(KEY_FAV).some((f) => keyOf(f) === keyOf(x));
export function toggleFav(x) {
  const list = read(KEY_FAV), k = keyOf(x), i = list.findIndex((f) => keyOf(f) === k);
  if (i >= 0) list.splice(i, 1); else list.unshift(clean(x));
  write(KEY_FAV, list.slice(0, 12));
  return i < 0;
}

export const recents = (net) => read(KEY_RECENT).filter((x) => !net || valid(net, x));
// Una línea sólo aparece una vez por sentido en recientes: gana la última parada elegida.
export function addRecent(x) {
  const k = keyOf(x);
  const list = read(KEY_RECENT).filter((r) => keyOf(r) !== k && !(x.t === "linea" && r.t === "linea" && r.routeId === x.routeId && r.dirIdx === x.dirIdx));
  list.unshift(clean(x));
  write(KEY_RECENT, list.slice(0, 8));
}
