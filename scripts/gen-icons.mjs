// Genera los iconos PNG de la PWA sin dependencias externas.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, { maskable }) {
  const bg = [4, 120, 87]; // emerald-700
  const fg = [255, 255, 255];
  const raw = Buffer.alloc(size * (1 + size * 4));
  const c = size / 2;
  const scale = maskable ? 0.62 : 0.8; // zona segura para iconos maskable
  const rOuter = (size * scale) / 2;
  const rInner = rOuter * 0.72;
  const corner = maskable ? 0 : size * 0.22;
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4;
      // esquinas redondeadas (solo icono normal)
      const dx = Math.max(corner - x, x - (size - 1 - corner), 0);
      const dy = Math.max(corner - y, y - (size - 1 - corner), 0);
      const inside = dx * dx + dy * dy <= corner * corner;
      // plato: anillo blanco + disco interior
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const ring = d <= rOuter && d >= rInner;
      const dot = d <= rInner * 0.55;
      const [r, g, b] = ring || dot ? fg : bg;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, { maskable: false }));
writeFileSync('public/icons/icon-512.png', png(512, { maskable: false }));
writeFileSync('public/icons/icon-maskable-512.png', png(512, { maskable: true }));
console.log('Iconos generados en public/icons');
