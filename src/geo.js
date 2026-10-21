// Utilidades geométricas sencillas (sin dependencias).
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Distancia acumulada (m) de cada punto de la polilínea.
export function cumulative(coords) {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + haversine(coords[i - 1], coords[i]));
  return out;
}

// Proyecta p sobre la polilínea: { along (m), dist (m al trazado) }.
export function project(coords, cum, p) {
  let best = { dist: Infinity, along: 0 };
  const k = Math.cos(rad(p[1]));
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i], [bx, by] = coords[i + 1];
    const dx = (bx - ax) * k, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * k * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    const q = [ax + t * (bx - ax), ay + t * (by - ay)];
    const d = haversine(p, q);
    if (d < best.dist) best = { dist: d, along: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  return best;
}

// Punto de la polilínea a una distancia dada (m).
export function pointAt(coords, cum, along) {
  const a = Math.max(0, Math.min(cum[cum.length - 1], along));
  for (let i = 0; i < cum.length - 1; i++) {
    if (a <= cum[i + 1]) {
      const t = (a - cum[i]) / (cum[i + 1] - cum[i] || 1);
      return [coords[i][0] + t * (coords[i + 1][0] - coords[i][0]),
              coords[i][1] + t * (coords[i + 1][1] - coords[i][1])];
    }
  }
  return coords[coords.length - 1];
}

// Rumbo (grados, 0 = norte) del tramo de la polilínea en una distancia dada.
export function bearingAt(coords, cum, along) {
  let i = cum.findIndex((c) => c > along) - 1;
  if (i < 0) i = coords.length - 2;
  const [a, b] = [coords[i], coords[i + 1]];
  return (Math.atan2((b[0] - a[0]) * Math.cos(rad(a[1])), b[1] - a[1]) * 180) / Math.PI;
}

// Douglas-Peucker en metros (plano local). Devuelve los índices conservados.
export function simplifyIdx(pts, tol) {
  if (pts.length < 3) return pts.map((_, i) => i);
  const k = Math.cos(rad(pts[0][1])) * 111320, m = 110540;
  const P = pts.map(([x, y]) => [x * k, y * m]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let idx = -1, max = tol;
    const [ax, ay] = P[a], [bx, by] = P[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * P[i][0] - dx * P[i][1] + bx * ay - by * ax) / L;
      if (d > max) { max = d; idx = i; }
    }
    if (idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return [...keep.keys()].filter((i) => keep[i]);
}
