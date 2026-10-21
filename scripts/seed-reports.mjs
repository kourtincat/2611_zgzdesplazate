// Genera avisos DEMO "he cogido el bus" para probar el mapa de calor y la predicción tentativa.
// Uso: npm run seed:reports [-- --route 35 --dir 0 --clear]
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((a) => a.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true]));
const net = JSON.parse(fs.readFileSync("public/data/network.json", "utf8"));
const FILE = path.resolve("data", "reports.json");
let all = args.clear || !fs.existsSync(FILE) ? [] : JSON.parse(fs.readFileSync(FILE, "utf8"));
all = all.filter((r) => !r.demo);

const routes = args.route ? [net.routes.find((r) => r.short === String(args.route))] : net.routes.filter((r) => r.live).slice(0, 12);
const now = new Date();
for (const route of routes) {
  for (const dir of route.dirs) {
    if (args.dir !== undefined && dir.dir !== +args.dir) continue;
    // 4 "costumbres" por sentido: un bus a una hora fija que la gente coge varios días laborables.
    for (let h = 0; h < 4; h++) {
      const base = (7 * 60 + 20 + h * 47 + Math.floor(Math.random() * 30)) * 60;
      const stopIdx = Math.floor(Math.random() * (dir.stops.length - 1));
      for (let day = 1; day <= 14; day++) {
        const d = new Date(now); d.setDate(d.getDate() - day);
        if ([0, 6].includes(d.getDay()) || Math.random() < 0.35) continue;
        const i = Math.min(dir.stops.length - 1, stopIdx + Math.floor(Math.random() * 3));
        const sec = base + (dir.offsets[i] - dir.offsets[stopIdx]) + Math.round((Math.random() - 0.5) * 120);
        d.setHours(0, 0, sec, 0);
        const s = net.stops[dir.stops[i]];
        all.push({ route: route.id, dir: dir.dir, stop: dir.stops[i], lon: s.p[0], lat: s.p[1], id: "demo-" + Math.random().toString(36).slice(2), client: "demo" + day, ts: d.getTime(), status: "confirmed", demo: true });
      }
    }
  }
}
fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(all));
console.log(`OK: ${all.filter((r) => r.demo).length} avisos demo en ${path.relative(process.cwd(), FILE)}`);
