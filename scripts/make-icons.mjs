// Genera los iconos PNG de la PWA (sin dependencias): anillo blanco con centro rojo sobre negro, como la marca.
//   node scripts/make-icons.mjs
import fs from "node:fs";
import zlib from "node:zlib";

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };

function icon(size, maskable) {
  const raw = Buffer.alloc((size * 4 + 1) * size), c = size / 2, scale = maskable ? 0.62 : 0.8; // maskable: zona segura
  const R = (size / 2) * scale, ringIn = R * 0.62, red = R * 0.4;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c), aa = (edge) => Math.max(0, Math.min(1, edge - d + 0.5));
      let col = [0, 0, 0];
      const white = aa(R) * (1 - aa(ringIn)), r = aa(red);
      col = col.map((v, i) => v * (1 - white) + 255 * white);
      col = col.map((v, i) => v * (1 - r) + [227, 6, 19][i] * r);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
for (const [name, size, m] of [["icon-192.png", 192, false], ["icon-512.png", 512, false], ["maskable-512.png", 512, true]])
  fs.writeFileSync(`public/icons/${name}`, icon(size, m));
console.log("iconos en public/icons/");
