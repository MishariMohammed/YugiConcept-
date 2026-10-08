#!/usr/bin/env node
// Procedural pixel-art app icon + splash generator (no image libraries, no browser).
//
//   node tools/gen-icons.mjs
//
// Draws a 32x32 pixel design (two fanned duel cards + sparkles) and writes, nearest-neighbour
// scaled PNGs to:
//   public/icons/icon-{192,512}.png, icon-maskable-512.png, apple-touch-icon.png  (PWA)
//   android/app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground}.png    (if android/ exists)
//   android/app/src/main/res/drawable*/splash.png                                (same sizes as existing)
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ palette (matches docs/ART.md)
const C = {
  bg: [26, 20, 35],
  ink: [20, 12, 28],
  plum: [44, 33, 64],
  violet: [93, 74, 125],
  gold: [242, 179, 61],
  goldDk: [176, 112, 32],
  cream: [244, 234, 210],
  red: [228, 67, 60],
  redDk: [130, 30, 44],
  blue: [59, 143, 224],
  blueDk: [30, 70, 130],
  white: [255, 255, 255],
};

// ------------------------------------------------------------------ 32x32 design
const N = 32;
function design() {
  const g = Array.from({ length: N * N }, () => null);
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N) g[y * N + x] = c; };
  const rect = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c); };
  const card = (x0, y0, w, h, fill, fillDk) => {
    rect(x0 + 1, y0, w - 2, h, C.ink); rect(x0, y0 + 1, w, h - 2, C.ink);   // rounded outline
    rect(x0 + 1, y0 + 1, w - 2, h - 2, C.gold);                              // gold frame
    rect(x0 + 2, y0 + h - 3, w - 4, 1, C.goldDk);                            // frame shade
    rect(x0 + 2, y0 + 2, w - 4, h - 5, fill);                                // art panel
    for (let i = 0; i < w - 4; i += 2) set(x0 + 2 + i, y0 + h - 4, fillDk);  // dither bottom
    rect(x0 + 2, y0 + 2, w - 4, 1, C.cream);                                 // shine
  };
  // back card (red, Kaiba side) and front card (blue, Yugi side)
  card(14, 3, 14, 21, C.red, C.redDk);
  card(5, 8, 14, 21, C.blueDk, C.ink);
  // back card emblem: dragon-ish eye
  rect(20, 10, 4, 2, C.cream); set(21, 10, C.ink); set(22, 11, C.ink);
  // front card emblem: golden diamond "millennium eye"
  const cx = 11.5, cy = 17;
  for (let y = 11; y <= 23; y++) for (let x = 7; x <= 16; x++) {
    const d = Math.abs(x - cx) / 4.5 + Math.abs(y - cy) / 6;
    if (d <= 1) set(x, y, d > 0.72 ? C.gold : d > 0.45 ? C.goldDk : C.blue);
  }
  rect(10, 16, 4, 3, C.cream); rect(11, 16, 2, 3, C.ink); set(11, 16, C.white);
  // sword (ATK) poking over the cards
  for (let i = 0; i < 8; i++) set(22 + i, 28 - i, C.cream);
  for (let i = 0; i < 7; i++) set(22 + i, 27 - i, C.white);
  rect(21, 25, 4, 1, C.goldDk); set(22, 26, C.goldDk); set(21, 27, C.gold); set(20, 28, C.gold);
  // sparkles
  const star = (x, y, c) => { set(x, y, c); set(x - 1, y, c); set(x + 1, y, c); set(x, y - 1, c); set(x, y + 1, c); };
  star(4, 4, C.gold); star(28, 29, C.gold); set(29, 4, C.cream); set(2, 27, C.cream);
  return g;
}

// ------------------------------------------------------------------ raster + PNG
function render(size, { bg = 'square', content = 1, color = C.bg } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const g = design();
  // integer scale keeps pixels crisp
  const scale = Math.max(1, Math.floor((size * content) / N));
  const off = Math.floor((size - N * scale) / 2);
  const r = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    let col = null, a = 0;
    if (bg !== 'none') {
      let inside = true;
      if (bg === 'round') inside = Math.hypot(x + 0.5 - r, y + 0.5 - r) <= r;
      if (bg === 'square') {
        const k = Math.round(size * 0.18); // rounded corners
        const dx = Math.max(k - x - 0.5, x + 0.5 - (size - k), 0), dy = Math.max(k - y - 0.5, y + 0.5 - (size - k), 0);
        inside = Math.hypot(dx, dy) <= k;
      }
      if (inside) { col = color; a = 255; }
    }
    const gx = Math.floor((x - off) / scale), gy = Math.floor((y - off) / scale);
    if (gx >= 0 && gy >= 0 && gx < N && gy < N && g[gy * N + gx]) {
      if (bg !== 'round' || Math.hypot(x + 0.5 - r, y + 0.5 - r) <= r) { col = g[gy * N + gx]; a = 255; }
    }
    if (col) { px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = a; }
  }
  return { w: size, h: size, px };
}

function renderSplash(w, h) {
  const icon = render(Math.round(Math.min(w, h) * 0.42), { bg: 'none' });
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = C.bg[0]; px[i * 4 + 1] = C.bg[1]; px[i * 4 + 2] = C.bg[2]; px[i * 4 + 3] = 255; }
  const ox = Math.floor((w - icon.w) / 2), oy = Math.floor((h - icon.h) / 2);
  for (let y = 0; y < icon.h; y++) for (let x = 0; x < icon.w; x++) {
    const s = (y * icon.w + x) * 4;
    if (!icon.px[s + 3]) continue;
    const d = ((oy + y) * w + ox + x) * 4;
    icon.px.copy(px, d, s, s + 4);
  }
  return { w, h, px };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png({ w, h, px }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function write(path, img) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png(img));
  console.log(`  ${path.replace(ROOT + '/', '')}  ${img.w}x${img.h}`);
}
function pngSize(path) { const b = readFileSync(path); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; }

// ------------------------------------------------------------------ outputs
console.log('PWA icons:');
const pub = join(ROOT, 'public', 'icons');
write(join(pub, 'icon-192.png'), render(192));
write(join(pub, 'icon-512.png'), render(512));
write(join(pub, 'icon-maskable-512.png'), render(512, { bg: 'full', content: 0.72 }));
write(join(pub, 'apple-touch-icon.png'), render(180, { bg: 'full', content: 0.9 }));
write(join(ROOT, 'public', 'favicon.png'), render(64));

const res = join(ROOT, 'android', 'app', 'src', 'main', 'res');
if (existsSync(res)) {
  console.log('Android launcher icons:');
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const dir = join(res, `mipmap-${d}`);
    write(join(dir, 'ic_launcher.png'), render(Math.round(48 * k)));
    write(join(dir, 'ic_launcher_round.png'), render(Math.round(48 * k), { bg: 'round', content: 0.9 }));
    // adaptive foreground: 108dp canvas, keep art inside the 66dp safe circle
    write(join(dir, 'ic_launcher_foreground.png'), render(Math.round(108 * k), { bg: 'none', content: 0.6 }));
  }
  console.log('Android splash screens:');
  for (const dir of readdirSync(res).filter((d) => d.startsWith('drawable'))) {
    const p = join(res, dir, 'splash.png');
    if (!existsSync(p)) continue;
    const { w, h } = pngSize(p);
    write(p, renderSplash(w, h));
  }
}
