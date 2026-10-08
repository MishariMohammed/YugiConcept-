// Low-level pixel-art drawing helpers used by every procedural art generator.
// Everything draws into a Uint32 RGBA buffer (no anti-aliasing) and is uploaded to a
// Phaser texture exactly once, so there are no per-frame canvas redraws.

import Phaser from 'phaser';

// ---------------------------------------------------------------------------
// Seeded hashing / RNG
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit string hash. Deterministic across platforms. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG -> function returning floats in [0,1). */
export function seededRandom(seed: number | string): () => number {
  let a = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap 2D integer hash -> [0,1). Handy for per-tile/per-pixel noise. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Colour helpers. Colours are packed little-endian ABGR uint32 (ImageData order).
// ---------------------------------------------------------------------------

export type Color = number;
export const CLEAR: Color = 0;

export function rgba(r: number, g: number, b: number, a = 255): Color {
  return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}
export function hex(h: string, a = 255): Color {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s.slice(0, 6), 16) || 0;
  return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}
export function chan(c: Color): [number, number, number, number] {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, (c >>> 24) & 255];
}
/** Packed colour -> 0xRRGGBB for Phaser tints. */
export function toTint(c: Color): number {
  const [r, g, b] = chan(c);
  return (r << 16) | (g << 8) | b;
}
export function toHex(c: Color): string {
  return '#' + toTint(c).toString(16).padStart(6, '0');
}
export function mix(a: Color, b: Color, t: number): Color {
  const A = chan(a), B = chan(b);
  return rgba(
    Math.round(A[0] + (B[0] - A[0]) * t),
    Math.round(A[1] + (B[1] - A[1]) * t),
    Math.round(A[2] + (B[2] - A[2]) * t),
    Math.round(A[3] + (B[3] - A[3]) * t),
  );
}
export function withAlpha(c: Color, a: number): Color {
  return ((c & 0x00ffffff) | ((a & 255) << 24)) >>> 0;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function hueToward(h: number, target: number, amt: number): number {
  let d = target - h;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return h + Math.sign(d) * Math.min(Math.abs(d), amt);
}

/**
 * Shift a colour in lightness with pixel-art style hue shifting: shadows drift toward
 * blue-purple, highlights toward warm yellow. `amount` in [-1, 1].
 */
export function shift(c: Color, amount: number): Color {
  const [r, g, b, a] = chan(c);
  let [h, s, l] = rgbToHsl(r, g, b);
  if (amount < 0) {
    h = hueToward(h, 255, 22 * -amount * (s > 0.08 ? 1 : 0));
    l = l + amount * 0.55;
    s = Math.min(1, s * (1 + -amount * 0.25));
  } else {
    h = hueToward(h, 50, 18 * amount * (s > 0.08 ? 1 : 0));
    l = l + (1 - l) * amount * 0.75;
    s = s * (1 - amount * 0.15);
  }
  const [R, G, B] = hslToRgb(h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
  return rgba(R, G, B, a);
}

/** 4-step ramp: [dark edge, shadow, base, highlight]. */
export type Ramp = [Color, Color, Color, Color];
export function ramp(base: Color | string): Ramp {
  const c = typeof base === 'string' ? hex(base) : base;
  return [shift(c, -0.62), shift(c, -0.3), c, shift(c, 0.38)];
}

// ---------------------------------------------------------------------------
// Ordered dithering
// ---------------------------------------------------------------------------
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Returns threshold in [0,1) for a 4x4 Bayer matrix. */
export function bayer(x: number, y: number): number {
  return (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

// ---------------------------------------------------------------------------
// PixelCanvas
// ---------------------------------------------------------------------------

export class PixelCanvas {
  readonly w: number;
  readonly h: number;
  readonly data: Uint32Array;
  /** Optional clip rect (inclusive x0,y0 exclusive x1,y1). */
  clip: [number, number, number, number] | null = null;

  constructor(w: number, h: number) {
    this.w = w | 0;
    this.h = h | 0;
    this.data = new Uint32Array(this.w * this.h);
  }

  inBounds(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const c = this.clip;
    return !c || (x >= c[0] && y >= c[1] && x < c[2] && y < c[3]);
  }
  get(x: number, y: number): Color {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x];
  }
  opaque(x: number, y: number): boolean {
    return (this.get(x, y) >>> 24) > 0;
  }
  /** Set pixel. Alpha < 255 blends over the existing pixel. */
  set(x: number, y: number, c: Color): void {
    x |= 0; y |= 0;
    if (!this.inBounds(x, y)) return;
    const a = c >>> 24;
    const i = y * this.w + x;
    if (a === 255 || a === 0) {
      if (a === 255) this.data[i] = c;
      return;
    }
    const d = this.data[i];
    if ((d >>> 24) === 0) { this.data[i] = c; return; }
    const out = mix(d, c | 0xff000000, a / 255);
    this.data[i] = withAlpha(out, Math.max(d >>> 24, a));
  }
  /** Overwrite pixel including alpha (used to punch holes). */
  put(x: number, y: number, c: Color): void {
    x |= 0; y |= 0;
    if (!this.inBounds(x, y)) return;
    this.data[y * this.w + x] = c;
  }

  fill(c: Color): this { this.data.fill(c); return this; }

  rect(x: number, y: number, w: number, h: number, c: Color): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }
  strokeRect(x: number, y: number, w: number, h: number, c: Color): this {
    this.hline(x, x + w - 1, y, c); this.hline(x, x + w - 1, y + h - 1, c);
    this.vline(x, y, y + h - 1, c); this.vline(x + w - 1, y, y + h - 1, c);
    return this;
  }
  hline(x0: number, x1: number, y: number, c: Color): this {
    for (let x = x0; x <= x1; x++) this.set(x, y, c);
    return this;
  }
  vline(x: number, y0: number, y1: number, c: Color): this {
    for (let y = y0; y <= y1; y++) this.set(x, y, c);
    return this;
  }
  /** Rounded rect with pixel "chamfer" corners of radius r (1..4). */
  roundRect(x: number, y: number, w: number, h: number, r: number, c: Color): this {
    for (let j = 0; j < h; j++) {
      let inset = 0;
      const dy = j < r ? r - j : j >= h - r ? j - (h - r - 1) : 0;
      if (dy > 0) inset = r - Math.round(Math.sqrt(Math.max(0, r * r - (dy - 0.5) * (dy - 0.5)))) ;
      this.hline(x + inset, x + w - 1 - inset, y + j, c);
    }
    return this;
  }
  line(x0: number, y0: number, x1: number, y1: number, c: Color): this {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color): this {
    const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
      if (u * u + v * v <= 1) this.set(x, y, c);
    }
    return this;
  }
  circle(cx: number, cy: number, r: number, c: Color): this { return this.ellipse(cx, cy, r, r, c); }

  /** Fill polygon (even-odd) given flat [x,y,...] points. */
  poly(pts: number[], c: Color): this {
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < pts.length; i += 2) { minY = Math.min(minY, pts[i]); maxY = Math.max(maxY, pts[i]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const py = y + 0.5;
      const xs: number[] = [];
      for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const yi = pts[i + 1], yj = pts[j + 1];
        if ((yi > py) !== (yj > py)) xs.push(pts[i] + ((py - yi) / (yj - yi)) * (pts[j] - pts[i]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) this.set(x, y, c);
      }
    }
    return this;
  }

  /** Vertical gradient between colours using ordered dithering for the pixel look. */
  gradientV(x: number, y: number, w: number, h: number, stops: Color[], dither = true): this {
    const n = stops.length - 1;
    for (let j = 0; j < h; j++) {
      const t = h <= 1 ? 0 : (j / (h - 1)) * n;
      const k = Math.min(n - 1, Math.floor(t));
      const f = t - k;
      for (let i = 0; i < w; i++) {
        const c = dither ? (f > bayer(x + i, y + j) ? stops[k + 1] : stops[k]) : mix(stops[k], stops[k + 1], f);
        this.set(x + i, y + j, c);
      }
    }
    return this;
  }

  /** Dither pattern fill: draws `c` where hash/bayer < density. */
  ditherRect(x: number, y: number, w: number, h: number, c: Color, density: number): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (bayer(i, j) < density) this.set(i, j, c);
    return this;
  }

  /** Copy another canvas onto this one (alpha aware). */
  blit(src: PixelCanvas, dx: number, dy: number, opts: { flipX?: boolean; tint?: Color } = {}): this {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const c = src.data[y * src.w + (opts.flipX ? src.w - 1 - x : x)];
      if ((c >>> 24) === 0) continue;
      this.set(dx + x, dy + y, opts.tint !== undefined ? withAlpha(opts.tint, c >>> 24) : c);
    }
    return this;
  }

  /**
   * Add a 1px outline around all opaque pixels (4-neighbour). With `diagonal` it uses
   * 8 neighbours for a chunkier look.
   */
  outline(c: Color, diagonal = false): this {
    const w = this.w, h = this.h, src = this.data.slice();
    const op = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && (src[y * w + x] >>> 24) > 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (op(x, y)) continue;
      if (op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1) ||
        (diagonal && (op(x - 1, y - 1) || op(x + 1, y - 1) || op(x - 1, y + 1) || op(x + 1, y + 1)))) {
        this.data[y * w + x] = c;
      }
    }
    return this;
  }

  /** Recolour every opaque pixel (keeps alpha). Used for silhouettes, shadows, flashes. */
  silhouette(c: Color): PixelCanvas {
    const out = new PixelCanvas(this.w, this.h);
    for (let i = 0; i < this.data.length; i++) {
      const a = this.data[i] >>> 24;
      if (a) out.data[i] = withAlpha(c, a);
    }
    return out;
  }

  /** Map every pixel through fn. */
  map(fn: (c: Color, x: number, y: number) => Color): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = y * this.w + x;
      this.data[i] = fn(this.data[i], x, y);
    }
    return this;
  }

  toCanvas(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);
    new Uint32Array(img.data.buffer).set(this.data);
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  /**
   * Upload as a Phaser texture. If the key already exists (e.g. a hand-drawn PNG was
   * preloaded from public/assets) the existing texture is kept untouched.
   */
  toTexture(scene: Phaser.Scene, key: string): Phaser.Textures.Texture {
    const tm = scene.textures;
    if (tm.exists(key)) return tm.get(key);
    const tex = tm.addCanvas(key, this.toCanvas());
    return tex as Phaser.Textures.Texture;
  }
}

/** Generate (once) a texture with `draw`, honouring PNG overrides already in the cache. */
export function ensureTexture(
  scene: Phaser.Scene, key: string, w: number, h: number, draw: (pc: PixelCanvas) => void,
): string {
  if (scene.textures.exists(key)) return key;
  const pc = new PixelCanvas(w, h);
  draw(pc);
  pc.toTexture(scene, key);
  return key;
}

/** Add numbered frames (0..n-1) laid out in a horizontal strip / grid to a texture. */
export function addGridFrames(tex: Phaser.Textures.Texture, fw: number, fh: number, count: number, cols: number): void {
  for (let i = 0; i < count; i++) {
    if (tex.has(String(i))) continue;
    tex.add(i, 0, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh);
  }
}
