// Stardew-ish arena backgrounds baked once into a single texture (no tilemap at runtime).
// Override: preload `arena-<kind>` (e.g. public/assets/tiles/arena-meadow.png); the generator
// then returns it unchanged (the floor rect still uses the default margins).

import Phaser from 'phaser';
import { Color, PixelCanvas, bayer, hash2, hex, mix, ramp, shift, withAlpha } from './PixelCanvas';
import { PAL } from './Palette';

export type ArenaKind = 'meadow' | 'ruins' | 'dungeon';

export interface ArenaBackground {
  key: string;
  /** Walkable floor rectangle in texture pixels (keep fighters inside it). */
  floor: { x: number; y: number; width: number; height: number };
}

function vnoise(x: number, y: number, cell: number, seed: number): number {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  const fx = x / cell - gx, fy = y / cell - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(gx, gy, seed), b = hash2(gx + 1, gy, seed), c = hash2(gx, gy + 1, seed), d = hash2(gx + 1, gy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const OUT = () => hex('#2a1e1a');

// ---------------------------------------------------------------------------
// Ground fills
// ---------------------------------------------------------------------------
function grass(pc: PixelCanvas, seed: number, x0 = 0, y0 = 0, w = pc.w, h = pc.h): void {
  const g = [hex(PAL.grassDark), hex('#509841'), hex(PAL.grass), hex('#6cb24e')];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const n = vnoise(x, y, 28, seed) * 0.75 + vnoise(x, y, 9, seed + 1) * 0.25;
    let c = g[2];
    if (n < 0.42 && bayer(x, y) < (0.42 - n) * 6) c = g[1];
    else if (n > 0.6 && bayer(x, y) < (n - 0.6) * 5) c = g[3];
    pc.set(x, y, c);
  }
  // blades / tufts
  for (let i = 0; i < (w * h) / 140; i++) {
    const x = x0 + Math.floor(hash2(i, 1, seed) * w), y = y0 + Math.floor(hash2(i, 2, seed) * h);
    const c = hash2(i, 3, seed) < 0.5 ? g[0] : hex(PAL.grassLight);
    pc.set(x, y, c); pc.set(x - 1, y - 1, c); pc.set(x + 1, y - 1, c);
  }
}

function flowers(pc: PixelCanvas, seed: number, n: number, avoid?: (x: number, y: number) => boolean): void {
  const cols = ['#fff8ec', '#ffd84a', '#f07aa8', '#9ac8ff', '#ff7a5a'].map((c) => hex(c));
  for (let i = 0; i < n; i++) {
    const x = Math.floor(hash2(i, 11, seed) * pc.w), y = Math.floor(hash2(i, 12, seed) * pc.h);
    if (avoid && avoid(x, y)) continue;
    const c = cols[Math.floor(hash2(i, 13, seed) * cols.length)];
    pc.set(x, y + 1, hex(PAL.grassDark));
    pc.set(x - 1, y, c); pc.set(x + 1, y, c); pc.set(x, y - 1, c); pc.set(x, y + 1, c);
    pc.set(x, y, hex('#ffe070'));
  }
}

function dirtPatch(pc: PixelCanvas, cx: number, cy: number, rx: number, ry: number, seed: number, cols: Color[]): void {
  for (let y = Math.floor(cy - ry - 4); y <= cy + ry + 4; y++) for (let x = Math.floor(cx - rx - 4); x <= cx + rx + 4; x++) {
    const u = (x - cx) / rx, v = (y - cy) / ry;
    const d = Math.sqrt(u * u + v * v) + (vnoise(x, y, 6, seed) - 0.5) * 0.25;
    if (d > 1.04) continue;
    if (d > 0.94 && bayer(x, y) > (1.04 - d) * 10) continue;
    const n = vnoise(x, y, 14, seed + 3);
    let c = cols[1];
    if (n < 0.42 && bayer(x, y) < (0.42 - n) * 5) c = cols[0];
    else if (n > 0.6 && bayer(x, y) < (n - 0.6) * 4) c = cols[2];
    if (d > 0.9 && bayer(x, y) < 0.5) c = cols[0];
    pc.set(x, y, c);
  }
  // pebbles
  for (let i = 0; i < (rx * ry) / 60; i++) {
    const a = hash2(i, 5, seed) * Math.PI * 2, r = Math.sqrt(hash2(i, 6, seed)) * 0.9;
    const x = Math.round(cx + Math.cos(a) * rx * r), y = Math.round(cy + Math.sin(a) * ry * r);
    pc.set(x, y, shift(cols[2], 0.3)); pc.set(x + 1, y, shift(cols[0], -0.2));
  }
}

// ---------------------------------------------------------------------------
// Props (drawn on an overlay, outlined)
// ---------------------------------------------------------------------------
function shadow(pc: PixelCanvas, cx: number, cy: number, rx: number, ry: number): void {
  pc.ellipse(cx, cy, rx, ry, withAlpha(hex('#1a2a14'), 90));
}

function tree(pc: PixelCanvas, ov: PixelCanvas, x: number, y: number, s: number, seed: number): void {
  shadow(pc, x + 2, y + 1, 11 * s, 4 * s);
  const trunk = ramp(PAL.wood);
  ov.rect(x - 2 * s, y - 10 * s, 4 * s, 10 * s, trunk[2]);
  ov.rect(x + 1 * s, y - 10 * s, 1 * s, 10 * s, trunk[1]);
  const leaf = [hex('#2e5e30'), hex('#3f7a3a'), hex('#5ea546'), hex('#8cc85a')];
  const blobs: [number, number, number][] = [[0, -20, 10], [-8, -14, 7], [8, -14, 7], [-4, -26, 7], [5, -25, 7]];
  for (const [bx, by, r] of blobs) ov.circle(x + bx * s, y + by * s, r * s, leaf[1]);
  for (const [bx, by, r] of blobs) ov.circle(x + bx * s - 1, y + by * s - 1.5, r * s * 0.75, leaf[2]);
  for (const [bx, by, r] of blobs) ov.circle(x + bx * s - r * 0.35 * s, y + by * s - r * 0.4 * s, r * s * 0.32, leaf[3]);
  for (let i = 0; i < 12; i++) {
    const px = x + (hash2(i, 1, seed) - 0.5) * 18 * s, py = y - 12 * s - hash2(i, 2, seed) * 16 * s;
    if (ov.get(px, py) === leaf[2]) ov.set(px, py, leaf[0]);
  }
}

function bush(pc: PixelCanvas, ov: PixelCanvas, x: number, y: number, seed: number, berries = true): void {
  shadow(pc, x + 1, y, 9, 3);
  ov.ellipse(x, y - 5, 9, 6.5, hex('#3f7a3a'));
  ov.ellipse(x - 1, y - 6, 7, 5, hex(PAL.grass));
  ov.ellipse(x - 3, y - 8, 3, 2, hex(PAL.grassLight));
  if (berries) for (let i = 0; i < 4; i++) {
    ov.set(x - 5 + Math.floor(hash2(i, 3, seed) * 10), y - 8 + Math.floor(hash2(i, 4, seed) * 6), hex('#e4433c'));
  }
}

function rock(pc: PixelCanvas, ov: PixelCanvas, x: number, y: number, s: number, moss = false): void {
  shadow(pc, x + 1, y, 6 * s, 2.5 * s);
  ov.ellipse(x, y - 3 * s, 6 * s, 4.5 * s, hex(PAL.stoneDark));
  ov.ellipse(x - 0.5, y - 3.6 * s, 5 * s, 3.6 * s, hex(PAL.stone));
  ov.ellipse(x - 2 * s, y - 5 * s, 2 * s, 1.4 * s, hex(PAL.stoneLight));
  if (moss) ov.ellipse(x + 1, y - 6.5 * s, 3 * s, 1.2 * s, hex(PAL.moss));
}

function fenceRow(ov: PixelCanvas, x0: number, x1: number, y: number): void {
  const w = ramp(PAL.wood);
  for (let x = x0; x <= x1; x++) {
    ov.set(x, y - 9, w[3]); ov.set(x, y - 8, w[2]); ov.set(x, y - 7, w[1]);
    ov.set(x, y - 4, w[3]); ov.set(x, y - 3, w[2]); ov.set(x, y - 2, w[1]);
  }
  for (let x = x0; x <= x1; x += 16) {
    ov.rect(x, y - 12, 4, 12, w[2]);
    ov.vline(x, y - 12, y - 1, w[3]);
    ov.vline(x + 3, y - 12, y - 1, w[1]);
    ov.hline(x, x + 3, y - 12, w[3]);
  }
}

function stoneBricks(pc: PixelCanvas, x0: number, y0: number, w: number, h: number, seed: number, base: string, bw = 16, bh = 8): void {
  const r = ramp(base);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const row = Math.floor((y - y0) / bh), off = row % 2 ? bw / 2 : 0;
    const bx = Math.floor((x - x0 + off) / bw), lx = (x - x0 + off) % bw, ly = (y - y0) % bh;
    const tone = hash2(bx, row, seed);
    let c = tone < 0.3 ? shift(r[2], -0.08) : tone > 0.8 ? shift(r[2], 0.08) : r[2];
    if (lx === 0 || ly === 0) c = r[0];
    else if (ly === 1 || lx === 1) c = shift(c, 0.18);
    else if (ly === bh - 1) c = r[1];
    if (hash2(x, y, seed + 9) < 0.03) c = shift(c, -0.12);
    pc.set(x, y, c);
  }
}

function pillar(pc: PixelCanvas, ov: PixelCanvas, x: number, y: number, hgt: number, broken: boolean, seed: number): void {
  shadow(pc, x + 3, y, 12, 4);
  const r = ramp(PAL.stoneLight);
  ov.rect(x - 9, y - 6, 18, 6, r[1]);
  ov.hline(x - 9, x + 8, y - 6, r[3]);
  for (let j = 0; j < hgt; j++) {
    const yy = y - 6 - j;
    for (let i = -6; i <= 6; i++) {
      const c = i < -3 ? r[3] : i > 3 ? r[1] : (i % 3 === 0 ? shift(r[2], -0.08) : r[2]);
      ov.set(x + i, yy, c);
    }
  }
  const top = y - 6 - hgt;
  if (broken) {
    for (let i = -6; i <= 6; i++) {
      const cut = Math.floor(hash2(i, 1, seed) * 4);
      for (let k = 0; k < cut; k++) ov.put(x + i, top + k, 0);
    }
  } else {
    ov.rect(x - 8, top - 4, 16, 4, r[2]);
    ov.hline(x - 8, x + 7, top - 4, r[3]);
  }
  ov.ellipse(x - 2, y - 10, 3, 2, hex(PAL.moss));
}

function torch(pc: PixelCanvas, x: number, y: number): void {
  // glow halo (dithered)
  for (let j = -22; j <= 22; j++) for (let i = -22; i <= 22; i++) {
    const d = Math.sqrt(i * i + j * j) / 22;
    if (d < 1 && bayer(x + i, y + j) < (1 - d) * 0.55) pc.set(x + i, y + j, withAlpha(hex('#ffb040'), 70));
  }
  pc.rect(x - 1, y, 3, 7, hex(PAL.woodDark));
  pc.rect(x - 2, y - 1, 5, 2, hex('#5e5a58'));
  pc.poly([x - 2, y - 1, x + 0.5, y - 8, x + 3, y - 1], hex('#f08a3a'));
  pc.poly([x - 1, y - 1, x + 0.5, y - 5, x + 2, y - 1], hex(PAL.torch));
}

function vignette(pc: PixelCanvas, strength: number, col = hex(PAL.ink)): void {
  const cx = pc.w / 2, cy = pc.h / 2;
  for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) {
    const u = (x - cx) / cx, v = (y - cy) / cy;
    const d = Math.max(0, Math.sqrt(u * u * 0.8 + v * v) - 0.75) * strength;
    if (d > bayer(x, y) * 0.9 + 0.05) pc.set(x, y, withAlpha(col, Math.min(200, 60 + d * 120)));
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
function meadow(pc: PixelCanvas, ov: PixelCanvas, seed: number): ArenaBackground['floor'] {
  const { w, h } = pc;
  grass(pc, seed);
  const fy = 58, fb = h - 26;
  dirtPatch(pc, w / 2, (fy + fb) / 2 + 4, w * 0.36, (fb - fy) * 0.42, seed, [hex('#a2744a'), hex('#b8875a'), hex('#caa070')]);
  const inFloor = (x: number, y: number) => x > 30 && x < w - 30 && y > fy - 4 && y < fb + 2;
  flowers(pc, seed, Math.floor((w * h) / 400), (x, y) => {
    const u = (x - w / 2) / (w * 0.38), v = (y - ((fy + fb) / 2 + 4)) / ((fb - fy) * 0.46);
    return u * u + v * v < 1;
  });
  // top tree line + fence
  for (let x = -6; x < w + 20; x += 26) tree(pc, ov, x + Math.floor(hash2(x, 1, seed) * 8), 30 + Math.floor(hash2(x, 2, seed) * 6), 1, seed + x);
  fenceRow(ov, 0, w, 48);
  // bottom fence (front)
  fenceRow(ov, 0, w, h - 2);
  // side bushes and rocks
  bush(pc, ov, 12, 90, seed); bush(pc, ov, w - 14, 120, seed + 1); bush(pc, ov, 14, 190, seed + 2, false); bush(pc, ov, w - 12, 210, seed + 3);
  rock(pc, ov, 34, 236, 1, true); rock(pc, ov, w - 40, 76, 0.8); rock(pc, ov, w - 60, 246, 1.1);
  void inFloor;
  return { x: 24, y: fy, width: w - 48, height: fb - fy };
}

function ruins(pc: PixelCanvas, ov: PixelCanvas, seed: number): ArenaBackground['floor'] {
  const { w, h } = pc;
  grass(pc, seed);
  const fy = 62, fb = h - 24;
  // stone slab floor with gaps
  const slab = ramp('#b8ac98');
  for (let ty = fy - 6; ty < fb + 8; ty += 16) for (let tx = 16; tx < w - 16; tx += 16) {
    const ex = Math.abs((tx + 8 - w / 2) / (w * 0.42)), ey = Math.abs((ty + 8 - (fy + fb) / 2) / ((fb - fy) * 0.62));
    const keep = ex * ex + ey * ey < 1 - hash2(tx, ty, seed) * 0.35;
    if (!keep) continue;
    const tone = hash2(tx, ty, seed + 1);
    const base = tone < 0.33 ? shift(slab[2], -0.07) : tone > 0.75 ? shift(slab[2], 0.06) : slab[2];
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
      let c = base;
      if (i === 15 || j === 15) c = slab[0];
      else if (i === 0 || j === 0) c = slab[3];
      else if (j === 14 || i === 14) c = slab[1];
      pc.set(tx + i, ty + j, c);
    }
    if (hash2(tx, ty, seed + 2) < 0.14) {
      let cx = tx + 3 + Math.floor(hash2(tx, ty, 5) * 8), cy = ty + 2;
      for (let k = 0; k < 9; k++) { pc.set(cx, cy, slab[0]); cx += hash2(k, tx, ty) < 0.5 ? 1 : 0; cy += 1; }
    }
    if (hash2(tx, ty, seed + 3) < 0.25) pc.ditherRect(tx + 1, ty + 9, 7, 5, hex(PAL.moss), 0.5);
  }
  // back wall (3/4 view: wall face)
  stoneBricks(pc, 0, 0, w, 44, seed, '#8a8478', 16, 8);
  pc.rect(0, 0, w, 6, hex('#3a3448'));
  for (let x = 0; x < w; x++) {
    const top = 6 + Math.floor(vnoise(x, 0, 30, seed) * 22 * (hash2(Math.floor(x / 40), 3, seed) < 0.5 ? 1 : 0.2));
    for (let y = 0; y < top; y++) pc.set(x, y, mix(hex('#5ea546'), hex('#3f7a3a'), bayer(x, y)));
  }
  pc.hline(0, w, 44, hex('#4a4440'));
  for (let y = 45; y < 49; y++) pc.hline(0, w, y, withAlpha(hex('#1a1414'), 80));
  // ivy
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(hash2(i, 7, seed) * w);
    const len = 10 + Math.floor(hash2(i, 8, seed) * 26);
    for (let y = 6; y < 6 + len; y++) {
      const xx = x + Math.round(Math.sin(y * 0.5 + i) * 1.5);
      pc.set(xx, y, hex('#3f7a3a'));
      if (y % 3 === 0) { pc.set(xx + 1, y, hex(PAL.grass)); pc.set(xx - 1, y + 1, hex('#5ea546')); }
    }
  }
  pillar(pc, ov, 40, 74, 40, true, seed);
  pillar(pc, ov, w - 40, 74, 54, false, seed + 1);
  pillar(pc, ov, 24, h - 10, 22, true, seed + 2);
  pillar(pc, ov, w - 28, h - 8, 14, true, seed + 3);
  rock(pc, ov, 70, h - 12, 0.8, true); rock(pc, ov, w - 80, h - 14, 1, true); rock(pc, ov, w / 2 + 70, 58, 0.6);
  flowers(pc, seed, 40, (x, y) => y > fy - 8 && y < fb + 8 && x > 16 && x < w - 16);
  return { x: 28, y: fy, width: w - 56, height: fb - fy };
}

function dungeon(pc: PixelCanvas, ov: PixelCanvas, seed: number): ArenaBackground['floor'] {
  const { w, h } = pc;
  stoneBricks(pc, 0, 0, w, h, seed, '#4a4458', 16, 16);
  // floor tiles have a subtle cool cast in the centre (lit) and darker edges
  const fy = 64, fb = h - 24;
  // back wall
  stoneBricks(pc, 0, 0, w, 52, seed + 1, '#5a5268', 16, 8);
  pc.rect(0, 0, w, 8, hex('#140c1c'));
  pc.hline(0, w, 52, hex('#2a2436'));
  for (let y = 53; y < 58; y++) pc.hline(0, w, y, withAlpha(hex('#140c1c'), 110 - (y - 53) * 20));
  // side walls
  for (const sx of [0, w - 14]) {
    stoneBricks(pc, sx, 52, 14, h - 52, seed + 2, '#3a3448', 14, 8);
    pc.vline(sx === 0 ? 14 : sx - 1, 52, h, hex('#140c1c'));
  }
  // puddles, bones, cracks
  for (let i = 0; i < 4; i++) {
    const x = 50 + hash2(i, 1, seed) * (w - 100), y = fy + 10 + hash2(i, 2, seed) * (fb - fy - 20);
    pc.ellipse(x, y, 10 + hash2(i, 3, seed) * 8, 3 + hash2(i, 4, seed) * 2, withAlpha(hex('#2a3a5a'), 200));
    pc.hline(Math.round(x - 4), Math.round(x + 1), Math.round(y - 1), withAlpha(hex('#7a9ac8'), 200));
  }
  for (let i = 0; i < 3; i++) {
    const x = Math.round(30 + hash2(i, 5, seed) * (w - 60)), y = Math.round(fb - 4 - hash2(i, 6, seed) * 30);
    const b = hex('#e8dcc0');
    pc.hline(x - 3, x + 3, y, b); pc.set(x - 4, y - 1, b); pc.set(x - 4, y + 1, b); pc.set(x + 4, y - 1, b); pc.set(x + 4, y + 1, b);
  }
  // warm light pools on the floor + torches on the back wall
  for (let y = 58; y < h; y++) for (let x = 14; x < w - 14; x++) {
    const u = (x - w / 2) / (w * 0.42), v = (y - (fy + fb) / 2) / ((fb - fy) * 0.75);
    const d = u * u + v * v;
    if (d < 1 && bayer(x, y) < (1 - d) * 0.45) pc.set(x, y, withAlpha(hex('#d8a870'), 64));
  }
  for (let x = 48; x < w; x += 96) torch(pc, x, 24);
  // chains / banner
  const ban = ramp('#8c1f2a');
  for (const bx of [w / 2 - 10]) {
    pc.rect(bx, 10, 20, 30, ban[2]);
    pc.vline(bx, 10, 39, ban[3]); pc.vline(bx + 19, 10, 39, ban[1]);
    pc.poly([bx, 40, bx + 10, 34, bx + 20, 40, bx + 20, 44, bx + 10, 38, bx, 44], ban[2]);
    pc.circle(bx + 10, 22, 4, hex(PAL.gold));
    pc.circle(bx + 10, 22, 2, ban[1]);
  }
  rock(pc, ov, 26, h - 6, 1); rock(pc, ov, w - 30, 80, 0.8);
  vignette(pc, 1.6);
  void ov;
  return { x: 24, y: fy, width: w - 48, height: fb - fy };
}

const FLOORS = new Map<string, ArenaBackground['floor']>();

/**
 * Bake (once) an arena background of w x h px. Returns its texture key and the walkable
 * floor rect. Typical use: `scene.add.image(0, 0, bg.key).setOrigin(0)`.
 */
export function buildArenaBackground(scene: Phaser.Scene, kind: ArenaKind, w = 480, h = 270): ArenaBackground {
  const key = `arena-${kind}-${w}x${h}`;
  const override = `arena-${kind}`;
  const seed = { meadow: 11, ruins: 23, dungeon: 37 }[kind];
  const fallbackFloor = { x: 24, y: 60, width: w - 48, height: h - 84 };
  if (scene.textures.exists(override)) return { key: override, floor: fallbackFloor };
  const cached = FLOORS.get(key);
  if (cached && scene.textures.exists(key)) return { key, floor: cached };
  const pc = new PixelCanvas(w, h);
  const ov = new PixelCanvas(w, h);
  const floor = kind === 'meadow' ? meadow(pc, ov, seed) : kind === 'ruins' ? ruins(pc, ov, seed) : dungeon(pc, ov, seed);
  if (!scene.textures.exists(key)) {
    ov.outline(OUT());
    pc.blit(ov, 0, 0);
    if (kind !== 'dungeon') vignette(pc, 0.7, hex('#1a2a14'));
    pc.toTexture(scene, key);
  }
  FLOORS.set(key, floor);
  return { key, floor };
}
