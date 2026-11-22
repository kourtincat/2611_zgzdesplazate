// Genera subidas DEMO («He subido») para ver el mapa de actividad sin usuarios reales. Llevan demo: true y la app
// lo indica. Uso: npm run seed:boardings  (sustituye las DEMO anteriores)  ·  npm run seed:boardings -- --remove  (sólo
// borra las DEMO). Las subidas reales nunca se tocan.
import fs from "node:fs";
import path from "node:path";

const remove = process.argv.includes("--remove");
const net = JSON.parse(fs.readFileSync("public/data/network.json", "utf8"));
const FILE = path.resolve("data", "boardings.ndjson");
const keep = fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8").split("\n").filter((l) => l && !l.includes('"demo":true')) : [];
const out = [...keep];
if (remove) { fs.writeFileSync(FILE, out.length ? out.join("\n") + "\n" : ""); console.log("Subidas DEMO borradas"); process.exit(0); }

// Postes con más líneas = más actividad. Cada poste tiene un «sesgo» propio de Avanza (0-6 min) para que el mapa
// muestre zonas donde acierta y zonas donde va por detrás.
const byStop = {};
for (const r of net.routes) if (r.live) for (const d of r.dirs) d.stops.forEach((id, idx) => (byStop[id] ||= []).push({ r, d, idx }));
const busy = Object.entries(byStop).filter(([id]) => net.stops[id].code).sort((a, b) => b[1].length - a[1].length).slice(0, 160);
const now = Date.now();
let n = 0;
for (const [id, lines] of busy) {
  const bias = Math.random() < 0.4 ? Math.random() * 1.2 : 1.5 + Math.random() * 4.5;
  const count = 2 + Math.floor(Math.random() * lines.length * 4);
  for (let k = 0; k < count; k++) {
    const { r, d } = lines[Math.floor(Math.random() * lines.length)];
    const first = Math.max(0, Math.round(bias + (Math.random() - 0.5) * 3));
    out.push(JSON.stringify({
      ts: now - Math.floor(Math.random() * 21 * 864e5), route: r.id, line: r.short, dir: d.dir, stop: id, code: net.stops[id].code,
      avanza: [first, first + 8 + Math.floor(Math.random() * 10)], waited: 60 + Math.floor(Math.random() * 600), shown: null,
      near: Math.floor(Math.random() * 60), verified: Math.random() < 0.6, demo: true,
    }));
    n++;
  }
}
fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, out.join("\n") + "\n");
console.log(`${n} subidas DEMO en ${busy.length} postes → ${FILE}`);
