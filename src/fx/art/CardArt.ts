// Procedural Balatro-style card faces. Deterministic per card id; drawn once per card into
// two textures (hand size + inspect size). PNG overrides: preload `card-sm-<id>` /
// `card-lg-<id>` / `card-back-sm` / `card-back-lg` and the generator leaves them alone.

import Phaser from 'phaser';
import type { Attribute, CardDef } from '../../core/types';
import { creatureSpec, drawCreatureOutlined, pose, Rig, REST, Shape } from './Creature';
import {
  Color, PixelCanvas, Ramp, addGridFrames, bayer, ensureTexture, hash2, hashString, hex, mix, ramp, shift, withAlpha,
} from './PixelCanvas';
import { ATTRIBUTE_COLOR, PAL, frameColor } from './Palette';
import { drawText, fitText, measureText, wrapText } from './PixelFont';

export const CARD_SM = { w: 48, h: 68 } as const;
export const CARD_LG = { w: 96, h: 136 } as const;
export const FOIL_FRAMES = 12;

export interface CardTextureKeys {
  /** 48x68 face */
  small: string;
  /** 96x136 face for the inspect / zoom view */
  large: string;
  /** 48x68 back */
  back: string;
  /** 96x136 back */
  backLarge: string;
}

export function cardKeys(id: string): CardTextureKeys {
  return { small: `card-sm-${id}`, large: `card-lg-${id}`, back: 'card-back-sm', backLarge: 'card-back-lg' };
}

/** Ensure both face textures and the shared backs exist. Cheap if already generated. */
export function ensureCardTextures(scene: Phaser.Scene, def: CardDef): CardTextureKeys {
  const keys = cardKeys(def.id);
  if (!scene.textures.exists(keys.small)) drawCardFace(def, 'sm').toTexture(scene, keys.small);
  if (!scene.textures.exists(keys.large)) drawCardFace(def, 'lg').toTexture(scene, keys.large);
  ensureCardBacks(scene);
  return keys;
}

export function ensureCardBacks(scene: Phaser.Scene): void {
  ensureTexture(scene, 'card-back-sm', CARD_SM.w, CARD_SM.h, (pc) => drawCardBack(pc, 'sm'));
  ensureTexture(scene, 'card-back-lg', CARD_LG.w, CARD_LG.h, (pc) => drawCardBack(pc, 'lg'));
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------
const INK = hex(PAL.ink);
const CREAM = hex(PAL.cream);

function nameColor(def: CardDef): Color {
  switch (def.rarity) {
    case 'rare': return hex('#dfe6f4');
    case 'super': return hex('#bff0ff');
    case 'ultra': return hex('#ffd34a');
    default: return CREAM;
  }
}

/** Card silhouette: thick ink outline + bevelled frame. Returns the frame ramp. */
function cardBody(pc: PixelCanvas, size: 'sm' | 'lg', base: Color, ultra: boolean): Ramp {
  const { w, h } = size === 'sm' ? CARD_SM : CARD_LG;
  const o = size === 'sm' ? 1 : 2;
  const r = size === 'sm' ? 3 : 5;
  const fr = ramp(base);
  pc.roundRect(0, 0, w, h, r, INK);
  pc.roundRect(o, o, w - o * 2, h - o * 2, r - 1, fr[2]);
  // subtle frame texture
  const tex = shift(fr[2], -0.08);
  for (let y = o; y < h - o; y++) for (let x = o; x < w - o; x++) {
    if (pc.get(x, y) === fr[2] && ((x + y) % 4 === 0) && hash2(x, y, 7) < 0.5) pc.set(x, y, tex);
  }
  // bevel: light top-left, dark bottom-right (only on frame pixels)
  const isFrame = (x: number, y: number) => pc.get(x, y) !== INK && pc.opaque(x, y);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!isFrame(x, y)) continue;
    if (!isFrame(x, y - 1) || !isFrame(x - 1, y)) pc.set(x, y, fr[3]);
    else if (!isFrame(x, y + 1) || !isFrame(x + 1, y)) pc.set(x, y, fr[1]);
  }
  if (ultra) {
    const g = hex(PAL.gold);
    const i = o + (size === 'sm' ? 1 : 2);
    pc.hline(i + 2, w - i - 3, i, g); pc.hline(i + 2, w - i - 3, h - i - 1, withAlpha(shift(g, -0.2), 255));
    pc.vline(i, i + 2, h - i - 3, g); pc.vline(w - i - 1, i + 2, h - i - 3, shift(g, -0.2));
  }
  return fr;
}

function plate(pc: PixelCanvas, x: number, y: number, w: number, h: number, fr: Ramp, light = false): void {
  const bg = light ? hex(PAL.paper) : mix(fr[0], INK, 0.55);
  pc.rect(x, y, w, h, bg);
  pc.hline(x, x + w - 1, y, light ? shift(bg, -0.25) : mix(bg, INK, 0.6));
  pc.hline(x, x + w - 1, y + h - 1, light ? shift(bg, 0.2) : shift(fr[2], 0.25));
}

function star(pc: PixelCanvas, x: number, y: number, big: boolean): void {
  const g = hex('#ffcf3a'), d = hex('#d0661c'), l = hex('#fff6b0');
  const rows = big
    ? ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '.#...#.']
    : ['..#..', '.###.', '#####', '.###.', '.#.#.'];
  if (big) {
    // outline
    for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) if (rows[j][i] === '#') {
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + a, jj = j + b;
        if (!(rows[jj]?.[ii] === '#')) pc.set(x + ii, y + jj, INK);
      }
    }
  }
  for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
    if (rows[j][i] !== '#') continue;
    pc.set(x + i, y + j, j >= rows.length - 2 ? d : (j <= 1 && big ? l : g));
  }
}

function orb(pc: PixelCanvas, cx: number, cy: number, r: number, attr: Attribute): void {
  const c = hex(ATTRIBUTE_COLOR[attr]);
  pc.circle(cx, cy, r + 1, INK);
  pc.circle(cx, cy, r, shift(c, -0.3));
  pc.circle(cx - 0.6, cy - 0.6, r - 1, c);
  pc.circle(cx - r * 0.35, cy - r * 0.35, Math.max(1, r * 0.35), shift(c, 0.6));
  if (r >= 4) {
    // tiny attribute icon
    const icons: Record<Attribute, string[]> = {
      DARK: ['.##..', '#....', '#....', '#....', '.##..'],
      LIGHT: ['#.#.#', '.###.', '##.##', '.###.', '#.#.#'],
      EARTH: ['.....', '..#..', '.###.', '#####', '.....'],
      WATER: ['..#..', '.###.', '#####', '#####', '.###.'],
      FIRE: ['..#..', '.##..', '.###.', '#####', '.###.'],
      WIND: ['.###.', '#...#', '..###', '.....', '####.'],
      DIVINE: ['..#..', '#####', '.###.', '.#.#.', '.....'],
    };
    const ic = icons[attr];
    const ink = attr === 'LIGHT' || attr === 'DIVINE' ? shift(c, -0.65) : hex(PAL.white);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) if (ic[j][i] === '#') pc.set(Math.round(cx - 2 + i), Math.round(cy - 2 + j), ink);
  }
}

// ---------------------------------------------------------------------------
// Art box backdrops
// ---------------------------------------------------------------------------
function backdrop(pc: PixelCanvas, x: number, y: number, w: number, h: number, def: CardDef, seed: number): void {
  const big = w > 60;
  const sky = (a: string, b: string, c: string) => pc.gradientV(x, y, w, h, [hex(a), hex(b), hex(c)]);
  const dots = (col: Color, n: number, maxY = 1) => {
    for (let i = 0; i < n; i++) {
      const px = x + Math.floor(hash2(i, 1, seed) * w), py = y + Math.floor(hash2(i, 2, seed) * h * maxY);
      pc.set(px, py, col);
      if (big && hash2(i, 3, seed) > 0.7) { pc.set(px + 1, py, col); pc.set(px - 1, py, col); pc.set(px, py + 1, col); pc.set(px, py - 1, col); }
    }
  };
  const ground = (top: Color, bot: Color, gy: number) => pc.gradientV(x, y + gy, w, h - gy, [top, bot]);
  const rays = (col: Color, cx: number, cy: number, n: number) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const a = Math.atan2(y + j - cy, x + i - cx);
      if (Math.floor(((a + Math.PI) / (Math.PI * 2)) * n * 2) % 2 === 0 && bayer(i, j) < 0.5) pc.set(x + i, y + j, col);
    }
  };
  if (def.kind === 'spell' || def.kind === 'trap') {
    const sp = def.kind === 'spell';
    sky(sp ? '#0f3a3c' : '#3a0f34', sp ? '#1f6a62' : '#6a1f5a', sp ? '#3aa08a' : '#a03a84');
    const cx = x + w / 2, cy = y + h / 2, R = Math.min(w, h) * 0.44;
    const ring = withAlpha(hex(sp ? '#9ff0d8' : '#ffb0e0'), 255);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const dx = x + i + 0.5 - cx, dy = y + j + 0.5 - cy, d = Math.sqrt(dx * dx + dy * dy);
      const onRing = Math.abs(d - R) < 0.6 || Math.abs(d - R * 0.82) < 0.5;
      if (onRing && bayer(i, j) < 0.75) pc.set(x + i, y + j, ring);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      pc.set(Math.round(cx + Math.cos(a) * R * 0.91), Math.round(cy + Math.sin(a) * R * 0.91), ring);
    }
    dots(withAlpha(hex(PAL.white), 200), big ? 14 : 5);
    return;
  }
  const attr = def.attribute ?? 'EARTH';
  const gy = Math.round(h * 0.78);
  switch (attr) {
    case 'DARK':
      sky('#120a22', '#2a1450', '#4a2470');
      dots(hex('#c8b0ff'), big ? 22 : 8, 0.6);
      pc.circle(x + w * 0.8, y + h * 0.22, big ? 6 : 3, hex('#e8dcff'));
      pc.circle(x + w * 0.8 + (big ? 3 : 1.5), y + h * 0.22 - 1, big ? 5 : 2.6, hex('#2a1450'));
      ground(hex('#2a1838'), hex('#140c1c'), gy);
      break;
    case 'LIGHT':
    case 'DIVINE':
      sky('#fff4c8', '#ffe08a', '#f0b860');
      rays(withAlpha(hex('#fffbe8'), 255), x + w / 2, y + h * 0.4, 9);
      ground(hex('#e8c070'), hex('#c08a40'), gy);
      break;
    case 'EARTH':
      sky('#a8d8e8', '#e8e0b0', '#e0c890');
      for (let i = 0; i < 3; i++) pc.ellipse(x + w * (0.15 + i * 0.4), y + gy + 2, w * 0.35, h * 0.22, hex(i % 2 ? '#7a9a4a' : '#8aa858'));
      ground(hex('#9a7a48'), hex('#6a4e2e'), gy);
      break;
    case 'WATER':
      sky('#1a3a7a', '#3a7ac8', '#7ac0e8');
      for (let j = 0; j < h; j += big ? 7 : 4) for (let i = 0; i < w; i++) {
        if (Math.round(Math.sin((i + j * 1.7 + seed % 7) * 0.45) * 1.2) === 0 && (i + j) % 3 !== 0) pc.set(x + i, y + j, hex('#a8e0ff'));
      }
      ground(hex('#2a6aa8'), hex('#1a3a6a'), gy);
      break;
    case 'FIRE':
      sky('#2a0a10', '#8a2018', '#e86a28');
      dots(hex('#ffd060'), big ? 18 : 7);
      ground(hex('#4a1a10'), hex('#1e0a0a'), gy);
      break;
    case 'WIND':
      sky('#b8f0e0', '#78d0a8', '#48a878');
      for (let s = 0; s < (big ? 4 : 2); s++) {
        const sy = y + h * (0.15 + s * 0.17), sx = x + hash2(s, 9, seed) * w * 0.5;
        for (let i = 0; i < w * 0.45; i++) pc.set(Math.round(sx + i), Math.round(sy + Math.sin(i * 0.3) * 1.5), hex('#e8fff4'));
      }
      ground(hex('#5a9a48'), hex('#3a6a30'), gy);
      break;
  }
}

// ---------------------------------------------------------------------------
// Spell / trap glyphs (32x32 design space, drawn via the creature Rig for shading)
// ---------------------------------------------------------------------------
type GlyphKind = 'vortex' | 'bolt' | 'heart' | 'cards' | 'sword' | 'shield' | 'ankh' | 'swords3' | 'mirror' |
  'chain' | 'flame' | 'eye' | 'mountain' | 'star' | 'jaws' | 'potion';

export function glyphFor(def: CardDef): GlyphKind {
  const s = `${def.name} ${def.effect?.id ?? ''}`.toLowerCase();
  const rules: [RegExp, GlyphKind][] = [
    [/raigeki|thunder|lightning|spark|bolt|quick/, 'bolt'],
    [/trap hole|pitfall|hole|jaw|bear/, def.kind === 'trap' ? 'jaws' : 'vortex'],
    [/dark hole|void|vortex|black/, 'vortex'],
    [/reborn|revive|resurrect|call of|premature|soul|rebirth/, 'ankh'],
    [/revealing|light|prison/, 'swords3'],
    [/mirror|reflect|force|magic cylinder|cylinder/, 'mirror'],
    [/pot|draw|greed|graceful|card/, 'cards'],
    [/heal|recover|life|dian|potion|medicine|restore|goblin/, 'potion'],
    [/sword|blade|axe|equip|power|horn|attack|strength|fang/, 'sword'],
    [/barrier|shield|wall|protect|defen|guard|negate/, 'shield'],
    [/chain|bind|spellbind|shadow/, 'chain'],
    [/fire|burn|hinotama|flame|ookazi|blast|bomb|explo/, 'flame'],
    [/eye|see|reveal/, 'eye'],
    [/fissure|earth|crack|quake|mountain|field|forest|umi|sogen|yami|wasteland/, 'mountain'],
    [/love|heart|charm/, 'heart'],
  ];
  for (const [re, g] of rules) if (re.test(s)) return g;
  if (def.kind === 'trap') return def.speed === 'continuous' ? 'chain' : 'jaws';
  switch (def.speed) {
    case 'quick': return 'bolt';
    case 'continuous': return 'chain';
    case 'equip': return 'sword';
    case 'field': return 'mountain';
    default: return 'star';
  }
}

const E = (cx: number, cy: number, rx: number, ry: number, rot = 0): Shape => {
  const c = Math.cos(rot), s = Math.sin(rot), r = Math.max(rx, ry);
  return { t: (x, y) => { const dx = x - cx, dy = y - cy; const u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry; return u * u + v * v <= 1; }, b: [cx - r, cy - r, cx + r, cy + r] };
};
const P = (...p: number[]): Shape => {
  const xs = p.filter((_, i) => i % 2 === 0), ys = p.filter((_, i) => i % 2 === 1);
  return {
    t: (x, y) => {
      let inside = false;
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
    b: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
};
const L = (x0: number, y0: number, x1: number, y1: number, r0: number, r1 = r0): Shape => {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1e-6, rm = Math.max(r0, r1);
  return {
    t: (x, y) => { let t = ((x - x0) * dx + (y - y0) * dy) / l2; t = Math.max(0, Math.min(1, t)); const px = x0 + dx * t - x, py = y0 + dy * t - y, r = r0 + (r1 - r0) * t; return px * px + py * py <= r * r; },
    b: [Math.min(x0, x1) - rm, Math.min(y0, y1) - rm, Math.max(x0, x1) + rm, Math.max(y0, y1) + rm],
  };
};
const Dif = (a: Shape, b: Shape): Shape => ({ t: (x, y) => a.t(x, y) && !b.t(x, y), b: a.b });
const Uni = (...s: Shape[]): Shape => ({
  t: (x, y) => s.some((q) => q.t(x, y)),
  b: [Math.min(...s.map((q) => q.b[0])), Math.min(...s.map((q) => q.b[1])), Math.max(...s.map((q) => q.b[2])), Math.max(...s.map((q) => q.b[3]))],
});
const rot = (cx: number, cy: number, x: number, y: number, a: number): [number, number] =>
  [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)];

function drawGlyph(pc: PixelCanvas, ox: number, oy: number, k: number, kind: GlyphKind, def: CardDef): void {
  const layer = new PixelCanvas(pc.w, pc.h);
  const g = new Rig(layer, ox, oy, k, REST);
  const pal = (def.palette ?? []).map((h) => hex(h));
  const gold = ramp(PAL.gold), silver = ramp('#d8e0ec'), red = ramp('#e4433c'), wood = ramp(PAL.wood);
  const main = ramp(pal[0] ?? (def.kind === 'spell' ? hex('#5ad8c0') : hex('#f070c0')));
  const acc = ramp(pal[2] ?? pal[1] ?? hex(PAL.gold));
  const sword = (x0: number, y0: number, x1: number, y1: number) => {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l;
    g.part(L(x0 + ux * 5, y0 + uy * 5, x1, y1, 1.6, 0.8), silver);
    g.part(L(x0 + ux * 5 - uy * 4, y0 + uy * 5 + ux * 4, x0 + ux * 5 + uy * 4, y0 + uy * 5 - ux * 4, 1.1), gold);
    g.part(L(x0, y0, x0 + ux * 4, y0 + uy * 4, 1.1), wood);
    g.part(E(x0, y0, 1.6, 1.6), gold);
  };
  switch (kind) {
    case 'vortex': {
      g.part(E(16, 16, 12, 12), ramp('#2a1450'));
      for (let a = 0; a < 3; a++) {
        const parts: Shape[] = [];
        for (let t = 0; t < 1; t += 0.06) {
          const ang = a * 2.094 + t * 4.2, r = 2 + t * 10;
          parts.push(E(16 + Math.cos(ang) * r, 16 + Math.sin(ang) * r, 1.2 + t * 1.2, 1.2 + t * 1.2));
        }
        g.part(Uni(...parts), ramp('#9a5ae0'), { edge: false });
      }
      g.part(E(16, 16, 3, 3), ramp('#08040e'), { shade: false });
      break;
    }
    case 'bolt': g.part(P(19, 2, 7, 18, 15, 18, 11, 30, 26, 12, 18, 12, 23, 2), ramp('#ffd84a')); break;
    case 'heart': g.part(Uni(E(11, 12, 6, 6), E(21, 12, 6, 6), P(5.3, 14, 26.7, 14, 16, 27)), red); break;
    case 'potion':
      g.part(Uni(E(16, 20, 8, 8), P(13, 6, 19, 6, 19, 14, 13, 14)), ramp('#bfe8f0'));
      g.part(Dif(E(16, 20.5, 6.6, 6.6), P(0, 0, 32, 0, 32, 18, 0, 18)), red, { edge: false });
      g.part(P(12.5, 3, 19.5, 3, 19.5, 6.5, 12.5, 6.5), wood);
      break;
    case 'cards':
      for (let i = 0; i < 3; i++) {
        const a = (i - 1) * 0.35, c: number[] = [];
        for (const [x, y] of [[10, 6], [22, 6], [22, 28], [10, 28]]) c.push(...rot(16, 26, x, y, a));
        g.part(P(...c), i === 1 ? ramp(PAL.cream) : ramp('#e0c890'));
      }
      g.part(E(16, 15, 3, 4), acc);
      break;
    case 'sword': sword(8, 25, 26, 5); break;
    case 'swords3': sword(16, 3, 16, 29); sword(6, 7, 24, 27); sword(26, 7, 8, 27); break;
    case 'shield':
      g.part(P(6, 4, 26, 4, 26, 15, 16, 29, 6, 15), main);
      g.part(P(9, 7, 23, 7, 23, 15, 16, 25, 9, 15), acc);
      g.part(E(16, 14, 3, 3), gold);
      break;
    case 'ankh':
      g.part(Uni(Dif(E(16, 9, 5.2, 6.4), E(16, 9, 2.4, 3.6)), P(14.2, 14, 17.8, 14, 18.5, 30, 13.5, 30), P(6, 15, 26, 15, 26, 18.5, 6, 18.5)), gold);
      break;
    case 'mirror':
      g.part(E(16, 15, 9.5, 12), gold);
      g.part(E(16, 15, 7, 9.5), ramp('#8ad8f8'), { edge: false });
      g.part(P(11, 13, 15, 8, 17, 9, 12, 16), ramp('#f4fcff'), { shade: false, edge: false });
      break;
    case 'chain':
      for (let i = 0; i < 4; i++) {
        const cx = 6 + i * 6.7, cy = 22 - i * 4.5, r = i % 2 ? 0.6 : -0.6 + 0.6;
        g.part(Dif(E(cx, cy, 5, 3, r - 0.6), E(cx, cy, 3, 1.2, r - 0.6)), silver);
      }
      break;
    case 'flame':
      g.part(P(8, 22, 9, 13, 13, 16, 14, 4, 19, 12, 21, 7, 25, 18, 23, 27, 16, 30, 10, 28), ramp('#e8562a'));
      g.part(P(12, 24, 13, 18, 16, 20, 17, 12, 21, 20, 20, 27, 16, 28), ramp('#ffc040'), { edge: false });
      break;
    case 'eye':
      g.part(E(16, 16, 13, 7), ramp(PAL.cream));
      g.part(E(16, 16, 5.5, 5.5), main, { edge: false });
      g.part(E(16, 16, 2.2, 3.4), ramp('#140c1c'), { shade: false, edge: false });
      break;
    case 'mountain':
      g.part(P(1, 28, 11, 9, 15, 15, 20, 6, 31, 28), ramp('#9a7a58'));
      g.part(P(17.5, 9.5, 20, 6, 22.6, 10.5, 20, 12), ramp(PAL.white), { edge: false });
      break;
    case 'jaws': {
      const teethTop: number[] = [4, 12];
      for (let i = 0; i < 6; i++) teethTop.push(6 + i * 4, 12, 8 + i * 4, 18);
      teethTop.push(28, 12, 28, 10, 4, 10);
      g.part(Dif(E(16, 14, 13, 9), E(16, 15.5, 10, 7)), silver);
      g.part(P(...teethTop), silver);
      g.part(Dif(E(16, 24, 13, 6), E(16, 22, 10, 5)), dkR(silver));
      g.part(E(16, 28, 4, 1.6), main);
      break;
    }
    case 'star':
    default: {
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 5.5 : 13;
        pts.push(16 + Math.cos(a) * r, 17 + Math.sin(a) * r);
      }
      g.part(P(...pts), gold);
      break;
    }
  }
  layer.outline(INK);
  pc.blit(layer, 0, 0);
}
const dkR = (r: Ramp): Ramp => r.map((c) => shift(c, -0.15)) as Ramp;

// ---------------------------------------------------------------------------
// Face
// ---------------------------------------------------------------------------
const SPEED_LABEL: Record<string, string> = { normal: 'NORMAL', quick: 'QUICK-PLAY', continuous: 'CONTINUOUS', equip: 'EQUIP', field: 'FIELD' };

function drawArt(pc: PixelCanvas, x: number, y: number, w: number, h: number, def: CardDef): void {
  const seed = hashString(def.id);
  const art = new PixelCanvas(pc.w, pc.h);
  art.clip = [x, y, x + w, y + h];
  backdrop(art, x, y, w, h, def, seed);
  if (def.kind === 'monster') {
    const spec = creatureSpec(def);
    const k = (h / 32) * 0.98;
    const ox = Math.round(x + (w - 32 * k) / 2), oy = Math.round(y + h - 31 * k);
    const sy = Math.round(y + h - 1.6 * k);
    art.ellipse(x + w / 2, sy, 9 * k, 1.8 * k, withAlpha(INK, 110));
    drawCreatureOutlined(art, ox, oy, k, spec, pose({ flap: -0.5, bob: 0 }));
  } else {
    const k = (Math.min(w, h) / 32) * 0.86;
    drawGlyph(art, Math.round(x + (w - 32 * k) / 2), Math.round(y + (h - 32 * k) / 2), k, glyphFor(def), def);
  }
  pc.blit(art, 0, 0);
}

export function drawCardFace(def: CardDef, size: 'sm' | 'lg'): PixelCanvas {
  const lg = size === 'lg';
  const { w, h } = lg ? CARD_LG : CARD_SM;
  const pc = new PixelCanvas(w, h);
  const fr = cardBody(pc, size, hex(frameColor(def.kind, def.isEffect)), def.rarity === 'ultra');
  const nc = nameColor(def);
  const isMon = def.kind === 'monster';
  const dim = mix(fr[0], INK, 0.3);

  if (!lg) {
    // name plate
    plate(pc, 3, 3, 42, 8, fr);
    drawText(pc, fitText(def.name, 'tiny', 39), 5, 5, nc, { font: 'tiny', shadow: INK });
    // art box
    pc.rect(3, 12, 42, 32, INK);
    drawArt(pc, 4, 13, 40, 30, def);
    if (isMon && def.attribute) orb(pc, 40, 17, 3, def.attribute);
    // level / kind row
    if (isMon) {
      const n = Math.min(def.level ?? 0, 8);
      for (let i = 0; i < n; i++) star(pc, 40 - i * 5, 45, false);
      if ((def.level ?? 0) > 8) drawText(pc, String(def.level), 4, 45, INK, { font: 'tiny' });
      drawText(pc, fitText((def.monsterType ?? '').replace('Winged Beast', 'Winged'), 'tiny', 40), 4, 51, dim, { font: 'tiny' });
    } else {
      drawText(pc, fitText(SPEED_LABEL[def.speed ?? 'normal'] ?? '', 'tiny', 40), 24, 49, dim, { font: 'tiny', align: 'center' });
    }
    // stats plate
    plate(pc, 3, 57, 42, 8, fr);
    if (isMon) {
      drawText(pc, `{${def.atk ?? 0}`, 5, 59, CREAM, { font: 'tiny' });
      tinyIcon(pc, 5, 59, 'sword');
      const d = `}${def.def ?? 0}`;
      const dx = 44 - measureText(d, 'tiny') - 1;
      drawText(pc, d, dx, 59, CREAM, { font: 'tiny' });
      tinyIcon(pc, dx, 59, 'shield');
    } else {
      drawText(pc, def.kind === 'spell' ? 'SPELL CARD' : 'TRAP CARD', 24, 59, hex(def.kind === 'spell' ? '#8af0d8' : '#ff9ad8'), { font: 'tiny', align: 'center' });
    }
    return pc;
  }

  // ---------------- large ----------------
  plate(pc, 5, 5, 86, 12, fr);
  const nameMax = isMon ? 70 : 82;
  if (measureText(def.name, 'big') <= nameMax) drawText(pc, def.name, 8, 8, nc, { font: 'big', shadow: INK });
  else drawText(pc, fitText(def.name, 'tiny', nameMax), 8, 9, nc, { font: 'tiny', shadow: INK });
  if (isMon && def.attribute) orb(pc, 84, 10.5, 4.5, def.attribute);
  if (isMon) {
    const n = Math.min(def.level ?? 0, 12);
    for (let i = 0; i < n; i++) star(pc, 84 - i * 7, 19, true);
  } else {
    const label = `${def.kind === 'spell' ? 'SPELL' : 'TRAP'} CARD`;
    drawText(pc, label, 89, 20, INK, { font: 'tiny', align: 'right' });
  }
  pc.rect(6, 27, 84, 62, INK);
  pc.rect(7, 28, 82, 60, shift(fr[2], 0.3));
  drawArt(pc, 8, 29, 80, 58, def);
  // type line
  const typeLine = isMon
    ? `[${(def.monsterType ?? '?')}${def.isEffect ? ' / EFFECT' : ''}]`
    : `[${SPEED_LABEL[def.speed ?? 'normal'] ?? ''} ${def.kind.toUpperCase()}]`;
  drawText(pc, fitText(typeLine, 'tiny', 84), 7, 91, dim, { font: 'tiny' });
  // rules text
  plate(pc, 6, 97, 84, 26, fr, true);
  pc.strokeRect(6, 97, 84, 26, mix(fr[0], INK, 0.4));
  const lines = wrapText(def.text || (isMon ? 'A NORMAL MONSTER.' : ''), 'tiny', 80);
  const maxLines = 4;
  lines.slice(0, maxLines).forEach((ln, i) => {
    const t = i === maxLines - 1 && lines.length > maxLines ? fitText(ln + ' ...', 'tiny', 80) : ln;
    drawText(pc, t, 8, 99 + i * 6, hex('#3a2a20'), { font: 'tiny' });
  });
  // stats
  plate(pc, 5, 124, 86, 10, fr);
  if (isMon) {
    const a = String(def.atk ?? 0), d = String(def.def ?? 0);
    drawText(pc, `{`, 8, 126, hex(PAL.red), { font: 'big' });
    drawText(pc, a, 15, 126, CREAM, { font: 'big', shadow: INK });
    const dw = measureText(d, 'big');
    drawText(pc, d, 88 - dw, 126, CREAM, { font: 'big', shadow: INK });
    drawText(pc, `}`, 88 - dw - 7, 126, hex(PAL.blue), { font: 'big' });
  } else {
    drawText(pc, def.arenaUsable ? 'ARENA ^ USABLE' : (def.kind === 'spell' ? 'SPELL' : 'TRAP'), 48, 127, hex(def.kind === 'spell' ? '#8af0d8' : '#ff9ad8'), { font: 'tiny', align: 'center' });
  }
  return pc;
}

/** Colour the 3x5 sword/shield icon pixels already drawn at (x,y). */
function tinyIcon(pc: PixelCanvas, x: number, y: number, which: 'sword' | 'shield'): void {
  const c = hex(which === 'sword' ? PAL.red : PAL.blue);
  const rows2 = which === 'sword' ? ['..#', '.##', '##.', '#..', '...'] : ['###', '###', '###', '.#.', '...'];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (rows2[j][i] === '#') pc.set(x + i, y + j, c);
}

// ---------------------------------------------------------------------------
// Back
// ---------------------------------------------------------------------------
export function drawCardBack(pc: PixelCanvas, size: 'sm' | 'lg'): void {
  const lg = size === 'lg';
  const { w, h } = lg ? CARD_LG : CARD_SM;
  const fr = cardBody(pc, size, hex('#5a2a3a'), false);
  const o = lg ? 5 : 3;
  // checker panel
  const a = hex('#2c1838'), b = hex('#3a2048');
  for (let y = o; y < h - o; y++) for (let x = o; x < w - o; x++) {
    const cell = lg ? 6 : 4;
    const dia = (Math.floor((x + y) / cell) + Math.floor((x - y + 200) / cell)) % 2;
    pc.set(x, y, dia ? a : b);
  }
  pc.strokeRect(o - 1, o - 1, w - 2 * o + 2, h - 2 * o + 2, hex(PAL.goldDark));
  // central swirl oval
  const cx = w / 2, cy = h / 2, rx = w * 0.34, ry = h * 0.3;
  pc.ellipse(cx, cy, rx + (lg ? 3 : 2), ry + (lg ? 3 : 2), INK);
  pc.ellipse(cx, cy, rx + (lg ? 2 : 1), ry + (lg ? 2 : 1), hex(PAL.gold));
  pc.ellipse(cx, cy, rx, ry, hex('#3a1420'));
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry, d = Math.sqrt(u * u + v * v);
    if (d > 1) continue;
    const ang = Math.atan2(v, u) + d * 5.5;
    const band = (Math.sin(ang * 3) + 1) / 2;
    const t = band * (1 - d * 0.6);
    const col = t > 0.62 ? hex('#ff8a3a') : t > 0.4 ? hex('#c8402a') : t > 0.22 ? hex('#7a1e2a') : hex('#3a1420');
    if (t > 0.22 || bayer(x, y) < 0.3) pc.set(x, y, col);
  }
  pc.ellipse(cx, cy, lg ? 4 : 2, lg ? 4 : 2, hex('#ffe08a'));
  // corner gems
  const gem = (gx: number, gy: number) => {
    pc.poly([gx, gy - 3, gx + 3, gy, gx, gy + 3, gx - 3, gy], hex(PAL.gold));
    pc.set(gx - 1, gy - 1, hex(PAL.white));
  };
  if (lg) { gem(14, 14); gem(w - 14, 14); gem(14, h - 14); gem(w - 14, h - 14); }
  void fr;
}

// ---------------------------------------------------------------------------
// Foil shine strips (shared by every card of a size); frames '0'..'11'.
// ---------------------------------------------------------------------------
export function ensureFoilTexture(scene: Phaser.Scene, size: 'sm' | 'lg', style: 'white' | 'rainbow'): string {
  const key = `card-foil-${size}-${style}`;
  if (scene.textures.exists(key)) return key;
  const { w, h } = size === 'sm' ? CARD_SM : CARD_LG;
  const o = size === 'sm' ? 1 : 2;
  const mask = new PixelCanvas(w, h);
  mask.roundRect(o, o, w - o * 2, h - o * 2, size === 'sm' ? 2 : 4, 0xffffffff);
  const sheet = new PixelCanvas(w * FOIL_FRAMES, h);
  const bandW = 0.16;
  for (let f = 0; f < FOIL_FRAMES; f++) {
    const c = -0.25 + (1.5 * f) / (FOIL_FRAMES - 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask.opaque(x, y)) continue;
      const d = (x / w) * 0.55 + (y / h) * 0.45;
      const dist = Math.abs(d - c);
      const dist2 = Math.abs(d - (c - 0.22));
      let a = 0;
      if (dist < bandW) a = dist < bandW * 0.35 ? 170 : dist < bandW * 0.7 ? 110 : (bayer(x, y) < 0.5 ? 70 : 0);
      else if (dist2 < bandW * 0.3) a = 70;
      if (!a) continue;
      let col: number;
      if (style === 'rainbow') {
        const hue = ((x + y) * 6 + f * 20) % 360;
        col = hslHex(hue);
      } else col = hex('#e8f4ff');
      sheet.set(f * w + x, y, withAlpha(col, a));
    }
  }
  const tex = sheet.toTexture(scene, key);
  addGridFrames(tex, w, h, FOIL_FRAMES, FOIL_FRAMES);
  return key;
}
function hslHex(hue: number): number {
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (0.75 - 0.25 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (255 << 24 | f(4) << 16 | f(8) << 8 | f(0)) >>> 0;
}
