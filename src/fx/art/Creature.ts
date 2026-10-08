// Parametric pixel-art creature drawer. Every creature is described in a 32x32 "design
// space" (facing right, feet on y=30) from simple shapes. The rig rasterises those shapes at
// any scale (k = pixels per design unit) with automatic Stardew-style shading: a highlight rim
// toward the top-left light, a shadow band bottom-right, dark selective outlines where a part
// overlaps another, and a global 1px dark outline. The same drawer feeds both the arena
// spritesheets (k = 1 or 1.5) and the card portraits (k ~0.9 / ~1.75), so the monster you see
// on the card is the one that fights in the arena.

import type { CardDef, MonsterType } from '../../core/types';
import { Color, PixelCanvas, Ramp, hex, mix, ramp, seededRandom, shift } from './PixelCanvas';
import { creaturePalette, PAL } from './Palette';

// ---------------------------------------------------------------------------
// Shapes (design space)
// ---------------------------------------------------------------------------
export interface Shape { t(x: number, y: number): boolean; b: [number, number, number, number] }

const E = (cx: number, cy: number, rx: number, ry: number, rot = 0): Shape => {
  const c = Math.cos(rot), s = Math.sin(rot), r = Math.max(rx, ry);
  return {
    t: (x, y) => {
      const dx = x - cx, dy = y - cy;
      const u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry;
      return u * u + v * v <= 1;
    },
    b: [cx - r, cy - r, cx + r, cy + r],
  };
};
const C = (cx: number, cy: number, r: number): Shape => E(cx, cy, r, r);
const R = (x0: number, y0: number, x1: number, y1: number): Shape => ({
  t: (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1, b: [x0, y0, x1, y1],
});
const P = (...p: number[]): Shape => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
  }
  return {
    t: (x, y) => {
      let inside = false;
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
    b: [x0, y0, x1, y1],
  };
};
/** Tapered capsule from (x0,y0,r0) to (x1,y1,r1). */
const L = (x0: number, y0: number, x1: number, y1: number, r0: number, r1 = r0): Shape => {
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1e-6, rm = Math.max(r0, r1);
  return {
    t: (x, y) => {
      let t = ((x - x0) * dx + (y - y0) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = x0 + dx * t - x, py = y0 + dy * t - y, r = r0 + (r1 - r0) * t;
      return px * px + py * py <= r * r;
    },
    b: [Math.min(x0, x1) - rm, Math.min(y0, y1) - rm, Math.max(x0, x1) + rm, Math.max(y0, y1) + rm],
  };
};
const U = (...s: Shape[]): Shape => ({
  t: (x, y) => s.some((q) => q.t(x, y)),
  b: [Math.min(...s.map((q) => q.b[0])), Math.min(...s.map((q) => q.b[1])), Math.max(...s.map((q) => q.b[2])), Math.max(...s.map((q) => q.b[3]))],
});
const D = (a: Shape, b: Shape): Shape => ({ t: (x, y) => a.t(x, y) && !b.t(x, y), b: a.b });
const I = (a: Shape, b: Shape): Shape => ({ t: (x, y) => a.t(x, y) && b.t(x, y), b: a.b });

// ---------------------------------------------------------------------------
// Pose
// ---------------------------------------------------------------------------
export type EyeState = 'open' | 'shut' | 'x' | 'angry';
export interface Pose {
  /** pixels the upper body is raised (idle breathing / walk bob) */
  bob: number;
  /** -1..1 walk leg phase */
  step: number;
  /** radians, positive = lean forward */
  lean: number;
  /** whole-sprite pixel offset */
  dx: number;
  dy: number;
  /** 0 rest, 1 wind-up, 2 strike */
  arm: number;
  /** -1..1 wing flap */
  flap: number;
  mouth: boolean;
  eyes: EyeState;
  sx: number;
  sy: number;
  /** frame seed for flicker (flames / sparks) */
  fx: number;
}
export const REST: Pose = { bob: 0, step: 0, lean: 0, dx: 0, dy: 0, arm: 0, flap: 0, mouth: false, eyes: 'open', sx: 1, sy: 1, fx: 0 };
export const pose = (p: Partial<Pose>): Pose => ({ ...REST, ...p });

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------
interface PartOpts { body?: boolean; edge?: boolean; shade?: boolean; glow?: boolean }

export class Rig {
  private cos: number;
  private sin: number;
  constructor(
    readonly pc: PixelCanvas, readonly ox: number, readonly oy: number, readonly k: number, readonly p: Pose,
  ) {
    this.cos = Math.cos(p.lean);
    this.sin = Math.sin(p.lean);
  }

  fwd(x: number, y: number, body = true): [number, number] {
    const p = this.p;
    if (body) y -= p.bob / this.k;
    let x2 = 16 + (x - 16) * p.sx, y2 = 30 + (y - 30) * p.sy;
    const rx = x2 - 16, ry = y2 - 30;
    x2 = 16 + rx * this.cos - ry * this.sin;
    y2 = 30 + rx * this.sin + ry * this.cos;
    return [this.ox + x2 * this.k + p.dx, this.oy + y2 * this.k + p.dy];
  }
  inv(px: number, py: number, body = true): [number, number] {
    const p = this.p;
    const x3 = (px - this.ox - p.dx) / this.k, y3 = (py - this.oy - p.dy) / this.k;
    const rx = x3 - 16, ry = y3 - 30;
    let x = 16 + rx * this.cos + ry * this.sin;
    let y = 30 - rx * this.sin + ry * this.cos;
    x = 16 + (x - 16) / p.sx;
    y = 30 + (y - 30) / p.sy;
    if (body) y += p.bob / this.k;
    return [x, y];
  }

  /** Rasterise a shape with automatic 4-tone shading. */
  part(s: Shape, r: Ramp, o: PartOpts = {}): void {
    const body = o.body ?? true;
    const pc = this.pc;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [cx, cy] of [[s.b[0], s.b[1]], [s.b[2], s.b[1]], [s.b[0], s.b[3]], [s.b[2], s.b[3]]]) {
      const [px, py] = this.fwd(cx, cy, body);
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
    const pad = 3;
    const bx = Math.max(0, Math.floor(x0) - pad), by = Math.max(0, Math.floor(y0) - pad);
    const ex = Math.min(pc.w, Math.ceil(x1) + pad), ey = Math.min(pc.h, Math.ceil(y1) + pad);
    const bw = ex - bx, bh = ey - by;
    if (bw <= 0 || bh <= 0) return;
    const m = new Uint8Array(bw * bh);
    let any = false;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const [u, v] = this.inv(bx + x + 0.5, by + y + 0.5, body);
      if (s.t(u, v)) { m[y * bw + x] = 1; any = true; }
    }
    if (!any) return;
    const inM = (x: number, y: number) => x >= 0 && y >= 0 && x < bw && y < bh && m[y * bw + x] === 1;
    const hs = Math.max(1, Math.round(this.k * 1.4));
    const hl = Math.max(1, Math.round(this.k * 0.7));
    const shade = o.shade ?? true;
    const edge = o.edge ?? true;
    const out: [number, number, Color][] = [];
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      if (!m[y * bw + x]) continue;
      const gx = bx + x, gy = by + y;
      let col = r[2];
      if (edge) {
        const nb: [number, number][] = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        let dark = false;
        for (const [nx, ny] of nb) if (!inM(nx, ny) && pc.opaque(bx + nx, by + ny)) { dark = true; break; }
        if (dark) { out.push([gx, gy, r[0]]); continue; }
      }
      if (shade) {
        if (!inM(x + hs, y + hs) || !inM(x, y + hs)) col = r[1];
        else if (!inM(x - hl, y - hl) || !inM(x, y - hl)) col = r[3];
      } else if (o.glow) {
        if (!inM(x - 1, y) || !inM(x + 1, y) || !inM(x, y - 1) || !inM(x, y + 1)) col = r[2];
        else col = r[3];
      }
      out.push([gx, gy, col]);
    }
    for (const [x, y, c] of out) pc.set(x, y, c);
  }

  /** A single crisp "pixel" (scaled to k) at a design point. */
  dot(x: number, y: number, c: Color, size = 1, body = true): void {
    const [px, py] = this.fwd(x, y, body);
    const n = Math.max(1, Math.round(this.k * size));
    const sx = Math.round(px - n / 2), sy = Math.round(py - n / 2);
    this.pc.rect(sx, sy, n, n, c);
  }

  /** Cute Stardew-style eye. */
  eye(x: number, y: number, glow?: Color): void {
    const [px, py] = this.fwd(x, y, true);
    const e = Math.max(1, Math.round(this.k));
    const ix = Math.round(px - e / 2), iy = Math.round(py - e);
    const ink = hex(PAL.ink);
    const st = this.p.eyes;
    if (st === 'shut') {
      this.pc.rect(ix - Math.floor(e / 2), iy + e, e * 2, Math.max(1, Math.floor(e / 2)), ink);
    } else if (st === 'x') {
      const n = e + 2;
      for (let i = 0; i < n; i++) { this.pc.set(ix - 1 + i, iy + i, ink); this.pc.set(ix - 1 + n - 1 - i, iy + i, ink); }
    } else if (glow !== undefined || st === 'angry') {
      const g = glow ?? hex('#ff4040');
      this.pc.rect(ix, iy, e + (e > 1 ? 1 : 0), e * 2 - (st === 'angry' ? 1 : 0), g);
      this.pc.set(ix, iy, shift(g, 0.6));
    } else {
      this.pc.rect(ix, iy, e, e * 2, ink);
      if (e >= 2) this.pc.rect(ix, iy, Math.max(1, e >> 1), Math.max(1, e >> 1), hex(PAL.white));
    }
  }
}

// ---------------------------------------------------------------------------
// Creature descriptor
// ---------------------------------------------------------------------------
export type Family =
  | 'dragon' | 'dino' | 'lizard' | 'serpent' | 'mage' | 'psychic' | 'fairy' | 'zombie' | 'warrior'
  | 'beastwarrior' | 'beast' | 'fiend' | 'puff' | 'machine' | 'aqua' | 'fish' | 'insect' | 'plant'
  | 'rock' | 'bird' | 'thunder' | 'pyro' | 'blob';

const TYPE_FAMILY: Record<MonsterType, Family> = {
  Spellcaster: 'mage', Dragon: 'dragon', Warrior: 'warrior', Beast: 'beast', 'Beast-Warrior': 'beastwarrior',
  Fiend: 'fiend', Zombie: 'zombie', Machine: 'machine', Aqua: 'aqua', Pyro: 'pyro', Rock: 'rock',
  'Winged Beast': 'bird', Plant: 'plant', Insect: 'insect', Thunder: 'thunder', Fairy: 'fairy', Fish: 'fish',
  'Sea Serpent': 'serpent', Reptile: 'lizard', Dinosaur: 'dino', Psychic: 'psychic',
};

export interface CreatureSpec {
  family: Family;
  /** ramps: body, secondary, accent, skin/metal, extra */
  r: [Ramp, Ramp, Ramp, Ramp, Ramp];
  outline: Color;
  v: number[];
  floats: boolean;
}

export function creatureSpec(def: CardDef): CreatureSpec {
  let family: Family = def.monsterType ? TYPE_FAMILY[def.monsterType] ?? 'blob' : 'blob';
  if (family === 'fiend' && (def.level ?? 4) <= 2) family = 'puff';
  const pal = creaturePalette(def).map((h) => hex(h));
  const rng = seededRandom('creature:' + def.id);
  const v = Array.from({ length: 12 }, () => rng());
  const r = pal.slice(0, 5).map((c) => ramp(c)) as CreatureSpec['r'];
  const outline = mix(shift(pal[0], -0.8), hex(PAL.ink), 0.6);
  const floats = ['fish', 'thunder', 'psychic', 'fairy', 'bird', 'pyro'].includes(family);
  return { family, r, outline, v, floats };
}

/** Draw a creature into `pc` with its design box at (ox,oy) scaled by k. No global outline. */
export function drawCreature(pc: PixelCanvas, ox: number, oy: number, k: number, spec: CreatureSpec, p: Pose): void {
  const g = new Rig(pc, ox, oy, k, p);
  FAMILY_DRAW[spec.family](g, spec, p);
}

/** Convenience: draw creature on its own layer, outline it, composite onto target. */
export function drawCreatureOutlined(
  target: PixelCanvas, ox: number, oy: number, k: number, spec: CreatureSpec, p: Pose,
): void {
  const layer = new PixelCanvas(target.w, target.h);
  drawCreature(layer, ox, oy, k, spec, p);
  layer.outline(spec.outline);
  target.blit(layer, 0, 0);
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------
type DrawFn = (g: Rig, s: CreatureSpec, p: Pose) => void;
const dk = (r: Ramp, a = 0.18): Ramp => r.map((c) => shift(c, -a)) as Ramp;
const lt = (r: Ramp, a = 0.2): Ramp => r.map((c) => shift(c, a)) as Ramp;
const flat = (c: Color): Ramp => [shift(c, -0.6), c, c, shift(c, 0.4)];
const INK = () => hex(PAL.ink);
const WHITE = () => hex(PAL.white);

/** Where a hand ends up for arm pose 0..2 given shoulder. Returns [hx, hy, weaponAngle]. */
function armPose(sx: number, sy: number, arm: number): [number, number, number] {
  // rest: hand low-forward, weapon up; windup: hand up/back; strike: hand forward
  const keys: [number, number, number][] = [[3.2, 4.5, -1.35], [0.5, -4.5, -2.3], [6.5, 1.5, -0.25]];
  const a = Math.max(0, Math.min(2, arm));
  const i = Math.min(1, Math.floor(a)), f = a - i;
  const A = keys[i], B = keys[i + 1];
  return [sx + A[0] + (B[0] - A[0]) * f, sy + A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
}

function legs(g: Rig, r: Ramp, xs: number[], top: number, rad: number, step: number, far = false): void {
  xs.forEach((x, i) => {
    const ph = (i % 2 === 0 ? 1 : -1) * step * (far ? -1 : 1);
    const fx = x + ph * 1.6;
    const lift = Math.max(0, ph) * 1.2;
    g.part(L(x, top, fx, 29.3 - lift, rad, rad * 0.9), r, { body: false });
    g.part(E(fx + 0.8, 29.6 - lift, rad + 0.6, 1.1), dk(r, 0.1), { body: false });
  });
}

const dragonLike = (kind: 'dragon' | 'dino' | 'lizard'): DrawFn => (g, s, p) => {
  const [B, S, A] = s.r;
  const v = s.v;
  const wings = kind === 'dragon';
  const big = kind === 'dino';
  const lunge = p.arm >= 1.5 ? 2.5 : p.arm >= 0.5 ? -1 : 0;
  const tipY = 2 - p.flap * 3;
  const wingR = dk(S, 0.15);
  const low = kind === 'lizard' ? 3 : 0;
  if (wings) g.part(P(17, 17, 10, tipY + 3, 12.5, tipY + 5, 14, tipY, 19.5, tipY + 6, 21, 15), dk(wingR, 0.15));
  legs(g, dk(B, 0.2), [11, 20], 23 + low * 0.3, 1.9, p.step, true);
  // tail
  g.part(U(L(10, 23 + low * 0.5, 5, 25.5, 2.8, 1.9), L(5, 25.5, 1.2, 21 - v[0] * 3, 1.9, 0.7)), B);
  if (v[1] > 0.4) g.part(P(0.2, 19.5 - v[0] * 3, 2.6, 20.5 - v[0] * 3, 1.2, 23 - v[0] * 3), A);
  // body
  g.part(E(15.5, 21.5 + low * 0.6, big ? 7 : 7.6, big ? 6.4 : 5.6 - low * 0.3), B);
  g.part(E(17, 24.2 + low * 0.4, 5, 2.6), S, { edge: false });
  if (v[2] > 0.35) for (let i = 0; i < 3; i++) g.part(P(10 + i * 3.2, 17.5 + i * -0.6 + low, 11.5 + i * 3.2, 13.8 + i * -0.6 + low, 13 + i * 3.2, 17 + i * -0.6 + low), A);
  legs(g, B, [13, 21], 24 + low * 0.3, 2.3, p.step);
  if (big) g.part(L(21, 20, 24 + lunge * 0.4, 21.5, 1.1, 0.9), B);
  // neck + head
  const hx = lunge + (kind === 'lizard' ? 2 : 0), hy = (kind === 'lizard' ? 9 : 0) + (big ? -0.5 : 0);
  g.part(L(20, 20 + low * 0.5, 23 + hx * 0.6, 13 + hy, 3.1, big ? 3.4 : 2.6), B);
  const hr = big ? 1.25 : 1;
  g.part(E(24.5 + hx, 10.5 + hy, 4.4 * hr, 3.5 * hr), B);
  if (p.mouth) {
    g.part(P(25 + hx, 12 + hy, 31.5 + hx, 13.8 + hy, 26 + hx, 15.8 + hy), dk(B, 0.1));
    g.part(E(28.3 + hx, 10.6 + hy, 3.3 * hr, 1.9 * hr, -0.25), B);
    g.part(P(26 + hx, 12.4 + hy, 31 + hx, 13.6 + hy, 26.4 + hx, 14.6 + hy), flat(hex('#5a1020')), { edge: false, shade: false });
    g.dot(28 + hx, 13 + hy, WHITE(), 0.9);
  } else {
    g.part(E(28.3 + hx, 12 + hy, 3.4 * hr, 2.2 * hr), B);
    g.dot(30.5 + hx, 11.6 + hy, s.r[0][0], 0.9);
  }
  // horns
  const hl = 2.5 + v[3] * 3;
  if (kind !== 'lizard') {
    g.part(P(21.5 + hx, 9 + hy, 18.5 - hl * 0.4 + hx, 7.5 - hl + hy, 23.6 + hx, 7.6 + hy), lt(A, 0.1));
    if (v[4] > 0.3) g.part(P(24 + hx, 7.6 + hy, 23.5 + hx, 4 - hl * 0.4 + hy, 26 + hx, 7.5 + hy), A);
  }
  if (wings) {
    g.part(P(14, 18, 6, tipY - 1, 9.5, tipY + 3, 11.5, tipY - 2.5, 16, tipY + 3, 18.5, tipY - 1, 20, 15.5), wingR);
    g.part(L(14, 18, 11.5, tipY - 2.5 + 0.5, 0.7), dk(B, 0.05));
  }
  g.eye(25.6 + hx, 10.4 + hy, kind === 'dragon' && v[5] > 0.6 ? s.r[2][3] : undefined);
};

const serpent: DrawFn = (g, s, p) => {
  const [B, S, A] = s.r;
  const sway = p.step * 1.2 + p.flap * 0.6;
  const lunge = p.arm >= 1.5 ? 3 : p.arm >= 0.5 ? -1 : 0;
  const pts: [number, number][] = [[2, 28], [7, 29], [12, 27.5], [14.5, 23 + sway * 0.5], [12.5, 18], [15, 13.5 + sway * 0.3], [20 + lunge * 0.5, 11]];
  for (let i = 0; i < pts.length - 1; i++) {
    const r0 = 1 + i * 0.55, r1 = 1 + (i + 1) * 0.55;
    g.part(L(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r0, r1), i % 2 ? B : dk(B, 0.05), { body: i > 2 });
  }
  g.part(E(13, 22, 1.6, 3.2), S, { edge: false });
  // fin crest
  g.part(P(14, 12, 13, 6, 17.5, 9.5, 18, 5.5, 20, 9.5), A);
  g.part(E(22.5 + lunge, 10.5, 4.6, 3.4, 0.15), B);
  if (p.mouth) g.part(P(23 + lunge, 12, 29 + lunge, 12.5, 23.5 + lunge, 14.5), flat(hex('#5a1020')), { shade: false, edge: false });
  g.eye(23.8 + lunge, 9.6);
};

function humanoid(kind: 'mage' | 'psychic' | 'fairy' | 'zombie' | 'warrior' | 'beastwarrior' | 'fiend'): DrawFn {
  return (g, s, p) => {
    const [B, S, A, K] = s.r;
    const v = s.v;
    const skin = kind === 'zombie' || kind === 'fiend' || kind === 'beastwarrior' ? B : kind === 'warrior' ? ramp(PAL.skin) : K;
    const cloth = kind === 'zombie' ? S : kind === 'fiend' ? dk(S, 0.1) : B;
    const cloth2 = kind === 'zombie' ? dk(S, 0.2) : S;
    const hover = kind === 'psychic' || kind === 'fairy';
    const hunch = kind === 'zombie' ? 1.5 : 0;
    // wings / back things
    if (kind === 'fairy') {
      const f = p.flap * 2;
      g.part(E(10.5, 13 - f, 6, 3, -0.7 - p.flap * 0.2), lt(S, 0.35), { glow: true, shade: false });
      g.part(E(10.5, 19 + f * 0.5, 4.5, 2.2, 0.5), lt(S, 0.3), { glow: true, shade: false });
    }
    if (kind === 'fiend') {
      const t = 2 - p.flap * 3;
      g.part(P(15, 15, 1.5, t, 4.5, t + 6, 0.5, t + 9, 6.5, t + 11, 4, t + 16, 13, 21), S);
      g.part(L(15, 15, 1.8, t + 0.4, 0.55), flat(dk(S, 0.45)[1]), { shade: false });
      g.part(L(14, 17, 4.5, t + 6, 0.45), flat(dk(S, 0.45)[1]), { shade: false });
      g.part(U(L(13, 25, 6, 27, 1.2, 0.8), L(6, 27, 3, 23, 0.8, 0.6)), skin);
      g.part(P(1.5, 23.5, 3, 20, 4.8, 23.5, 3, 24.6), A);
    }
    // back arm
    const ba = p.arm >= 1.5 ? 1.5 : 0;
    g.part(L(13.8, 16.5 + hunch, 12 + ba, 22.5 + hunch, 1.6, 1.4), dk(kind === 'warrior' ? K : cloth, 0.2));
    if (kind === 'warrior') {
      g.part(E(11.5 + ba, 20.5, 3.4, 4.6), S);
      g.dot(11.5 + ba, 20.5, A[3], 1.3);
    }
    // legs / robe
    if (kind === 'mage' || kind === 'psychic' || kind === 'fairy') {
      const hem = hover ? 26.5 : 29.4;
      g.part(P(12, 15.5, 20.5, 15.5, 23 + p.step * 0.5, hem, 9 - p.step * 0.5, hem), cloth, { body: hover });
      g.part(P(9.4 - p.step * 0.5, hem - 1.6, 22.6 + p.step * 0.5, hem - 1.6, 23 + p.step * 0.5, hem, 9 - p.step * 0.5, hem), A, { edge: false, body: hover });
      if (!hover) { g.dot(13 + p.step, 29.6, s.r[0][0], 1.5, false); g.dot(19.5 - p.step, 29.6, s.r[0][0], 1.5, false); }
    } else {
      legs(g, cloth2, [14, 18.5], 23, 1.8, p.step);
      g.part(E(16, 19.5 + hunch * 0.5, 4.8, 5.4), kind === 'warrior' ? K : cloth);
      g.part(R(11, 22 + hunch * 0.5, 21, 23.4 + hunch * 0.5), dk(A, 0.25), { shade: false });
    }
    if (kind === 'warrior') g.part(L(13.5, 16, 18.5, 16.2, 2.4, 2.4), dk(K, 0.05));
    // head
    const hx = kind === 'zombie' ? 2 : 0, hy = hunch;
    if (kind === 'beastwarrior') {
      g.part(P(13.5, 8, 14.5, 2.5, 17, 6.5), B);
      g.part(P(17, 6.5, 19.5, 2.5, 20.5, 8), B);
      g.part(C(17, 10.5, 4.5), B);
      g.part(E(21, 12, 2.8, 2), S, { edge: true });
      g.dot(23.4, 11.2, INK(), 0.9);
    } else {
      g.part(C(16.8 + hx, 10.5 + hy, 4.4), skin);
    }
    // hats / hair
    if (kind === 'mage') {
      const tip = v[0] * 4;
      g.part(U(E(13.8, 12, 2.4, 3.6), E(16, 9.6, 4.6, 1.8)), dk(S, 0.1));
      g.part(P(11, 9.5, 22.5, 9.5, 18.5, 3, 15 + tip, -0.5 + v[1] * 2, 14.5, 3.5), cloth);
      g.part(E(16.8, 9.6, 7.2, 1.7), dk(cloth, 0.05));
      g.part(R(12.5, 7.2, 21.5, 8.6), A, { edge: false, shade: false });
    } else if (kind === 'warrior') {
      g.part(D(C(16.8, 10.2, 4.9), R(12, 10.6, 22, 20)), K);
      g.part(R(18.5, 10.5, 22, 11.4), flat(s.r[3][0]), { shade: false, edge: false });
      g.part(U(L(15.5, 5.8, 11 - v[2] * 2, 5 + v[3] * 2, 1.6, 1)), A);
    } else if (kind === 'fairy') {
      g.part(U(E(15.5, 8, 5, 3.2), L(12.5, 9, 11.5, 15.5, 1.6, 1.2)), S);
      g.part(D(E(17, 3.2, 4, 1.4), E(17, 3.2, 2.6, 0.6)), flat(hex(PAL.gold)), { shade: false, edge: false });
    } else if (kind === 'psychic') {
      g.part(D(U(C(16.5, 9.5, 5.2), P(11.3, 9.5, 21.7, 9.5, 21, 15, 11.5, 15)), E(18.5, 11.5, 3.6, 3.4)), S);
      g.dot(18.8, 7.6, s.r[2][3], 1.3);
    } else if (kind === 'zombie') {
      for (let i = 0; i < 4; i++) g.part(P(13 + i * 2 + hx, 8.5 + hy, 13.5 + i * 2 + hx, 4.5 + hy + v[i] * 1.5, 15.5 + i * 2 + hx, 7.8 + hy), dk(S, 0.25));
      g.dot(19 + hx, 13 + hy, dk(B, 0.3)[1], 1);
    } else if (kind === 'fiend') {
      g.part(P(13.5, 8.5, 10 - v[0] * 2, 1 - v[1] * 2, 15.5, 6.5), lt(A, 0.1));
      g.part(P(18.5, 6.8, 21 + v[0] * 2, 0.5 - v[1] * 2, 20.5, 8.5), A);
    }
    // front arm + weapon
    const [hxp, hyp, ang] = armPose(18.3, 16.5 + hunch, kind === 'zombie' ? Math.max(p.arm, 0.9) + 0.6 : p.arm);
    const zx = kind === 'zombie' ? 3 : 0;
    if (kind === 'mage' || kind === 'psychic' || kind === 'fairy') {
      const len0 = kind === 'mage' ? 8 : 2, len1 = kind === 'mage' ? 11 : 5;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      if (kind === 'mage') g.part(L(hxp - ca * len0, hyp - sa * len0, hxp + ca * len1, hyp + sa * len1, 0.8), flat(hex(PAL.wood)));
      g.part(L(18.3, 16.5, hxp, hyp, 1.6, 1.4), cloth);
      g.part(C(hxp, hyp, 1.5), skin);
      const ox = hxp + ca * (len1 + 1.6), oy = hyp + sa * (len1 + 1.6);
      g.part(C(ox, oy, kind === 'mage' ? 2.3 : 2.6), A, { glow: true, shade: false });
      g.dot(ox - 0.6, oy - 0.6, WHITE(), 0.9);
    } else if (kind === 'warrior' || kind === 'beastwarrior') {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const bl = kind === 'warrior' ? 12 : 10;
      g.part(L(hxp - ca * 1.5, hyp - sa * 1.5, hxp + ca * bl, hyp + sa * bl, 0.95, 0.7), kind === 'warrior' ? flat(hex('#dfe6ee')) : flat(hex(PAL.wood)));
      if (kind === 'beastwarrior') {
        const ax = hxp + ca * bl, ay = hyp + sa * bl;
        const nx = -sa, ny = ca;
        g.part(P(ax - ca * 4, ay - sa * 4, ax + nx * 4.5 - ca * 5, ay + ny * 4.5 - sa * 5, ax + nx * 4.5 + ca * 1, ay + ny * 4.5 + sa * 1, ax), flat(hex('#c8d0dc')));
      } else {
        g.part(L(hxp + ca * 1.4 - sa * 2.2, hyp + sa * 1.4 + ca * 2.2, hxp + ca * 1.4 + sa * 2.2, hyp + sa * 1.4 - ca * 2.2, 0.8), A);
      }
      g.part(L(18.3, 16.5, hxp, hyp, 1.6, 1.5), kind === 'warrior' ? K : B);
      g.part(C(hxp, hyp, 1.5), kind === 'warrior' ? dk(S, 0.1) : B);
    } else {
      g.part(L(18.3 + zx * 0.3, 16.5 + hunch, hxp + zx, hyp, 1.6, 1.3), kind === 'zombie' ? skin : cloth);
      g.part(C(hxp + zx, hyp, 1.6), skin);
      if (kind === 'fiend') for (let i = 0; i < 3; i++) g.dot(hxp + zx + 1.6, hyp - 1 + i, A[3], 0.7);
    }
    // face
    if (kind === 'warrior') { g.eye(20, 12.2); }
    else if (kind === 'fiend') { g.eye(18.4, 10.8, s.r[2][3]); g.eye(20.8, 10.8, s.r[2][3]); }
    else if (kind === 'beastwarrior') { g.eye(19.2, 9.8); }
    else if (kind === 'zombie') { g.eye(18.6 + hx, 10.5 + hy); g.eye(21 + hx, 10.6 + hy); }
    else { g.eye(18.4 + hx, 10.8 + hy); g.eye(20.8 + hx, 10.8 + hy); }
    if (p.mouth && kind !== 'warrior') g.dot(20 + hx, 13.4 + hy, INK(), 1);
  };
}

const beast: DrawFn = (g, s, p) => {
  const [B, S, A] = s.r;
  const v = s.v;
  const lunge = p.arm >= 1.5 ? 2.5 : p.arm >= 0.5 ? -1 : 0;
  legs(g, dk(B, 0.22), [10, 21], 22.5, 1.8, p.step, true);
  const tw = p.flap * 1.5;
  g.part(U(L(8, 19.5, 4, 15 - tw, 1.8, 1.6), E(3.5, 13.5 - tw, 2, 3, -0.4)), B);
  g.part(E(15, 20.5, 8.2, 5), B);
  g.part(E(15.5, 23.4, 5.5, 2), S, { edge: false });
  legs(g, B, [12, 22], 23, 2.1, p.step);
  if (v[0] > 0.5) g.part(E(21 + lunge * 0.5, 16, 4.5, 6), A);
  const hx = lunge;
  g.part(C(24 + hx, 14.5, 4.3), B);
  // ears
  if (v[1] > 0.5) {
    g.part(P(21, 12, 21.8, 6.5, 24, 10.8), B);
    g.part(P(24.5, 10.8, 26.8, 6.5, 27.3, 12), B);
  } else {
    g.part(C(21.6, 10.6, 1.8), B);
    g.part(C(25.6, 10.2, 1.8), B);
  }
  g.part(E(27.6 + hx, 16.3, 2.7, 1.9), S);
  g.dot(29.8 + hx, 15.4, INK(), 0.9);
  if (p.mouth) { g.part(E(27.5 + hx, 18.4, 2, 0.9), flat(hex('#5a1020')), { shade: false }); g.dot(28.5 + hx, 17.8, WHITE(), 0.8); }
  g.eye(25.4 + hx, 13.6);
};

const puff: DrawFn = (g, s, p) => {
  const [B, S, A, K] = s.r;
  const sq = p.bob ? 0.4 : 0;
  // feet + hands
  g.part(E(12 + p.step, 29, 2.4, 1.3), K, { body: false });
  g.part(E(20.5 - p.step, 29, 2.4, 1.3), K, { body: false });
  // fluffy body: core + tufts
  const tufts: Shape[] = [E(16, 19.5, 9.5, 8.6 - sq)];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    tufts.push(C(16 + Math.cos(a) * 9, 19.5 + Math.sin(a) * 8, 1.9));
  }
  g.part(U(...tufts), B);
  const [hx, hy] = armPose(17, 22, p.arm);
  g.part(L(23, 22, hx + 4, hy + 1, 1, 0.9), K);
  g.part(L(9, 22, 6, 24, 1, 0.9), K);
  // big eyes
  for (const ex of [13.6, 20.2]) {
    g.part(E(ex, 18, 2.6, 3.2), flat(WHITE()), { shade: false });
    const shut = p.eyes === 'shut' || p.eyes === 'x';
    if (shut) g.part(R(ex - 2.2, 18, ex + 2.2, 19), flat(INK()), { shade: false, edge: false });
    else { g.part(E(ex + 0.8, 18.5, 1.6, 2.2), flat(dk(A, 0.3)[1]), { shade: false, edge: false }); g.dot(ex + 0.2, 17.3, WHITE(), 0.8); }
  }
  if (p.mouth) g.part(E(17, 23.5, 1.6, 1), flat(hex('#5a1020')), { shade: false });
  void S;
};

const machine: DrawFn = (g, s, p) => {
  const [B, S, A, K] = s.r;
  const v = s.v;
  const recoil = p.arm >= 1.5 ? -2 : 0;
  if (v[0] > 0.5) {
    g.part(R(7, 25, 25, 30), dk(S, 0.15), { body: false });
    for (const wx of [9.5, 16, 22.5]) {
      g.part(C(wx, 27.5, 2), K, { body: false });
      g.dot(wx + (p.step > 0 ? 0.6 : -0.6), 27.5, s.r[1][0], 0.8, false);
    }
  } else {
    legs(g, dk(S, 0.1), [12.5, 19.5], 23, 2.2, p.step);
  }
  g.part(R(9, 13, 23, 25.5), K);
  g.part(R(11, 16, 17, 22.5), dk(S, 0.1));
  g.dot(12.2, 17.2, A[3], 0.9);
  g.dot(15.6, 21.2, A[2], 0.9);
  for (const [rx, ry] of [[10, 14], [22, 14], [10, 24.5], [22, 24.5]]) g.dot(rx, ry, s.r[3][1], 0.8);
  // head
  g.part(R(11, 5.5, 21.5, 13), B);
  g.part(R(14, 8, 21.5, 10.5), A, { glow: true, shade: false });
  if (p.eyes === 'x' || p.eyes === 'shut') g.part(R(14, 8.8, 21.5, 9.6), flat(INK()), { shade: false, edge: false });
  g.part(L(13, 5.5, 12, 1.8, 0.5), dk(K, 0.2));
  g.dot(12, 1.4, A[3], 1.5);
  // cannon arm
  g.part(R(17, 16.5, 30.5 + recoil, 20.5), S);
  g.part(R(28.5 + recoil, 16, 31 + recoil, 21), dk(S, 0.2));
  if (p.arm >= 1.5) g.part(P(31, 18.5, 31.8, 15, 32, 18.5, 31.8, 22), flat(hex(PAL.torch)), { shade: false, edge: false });
};

const fish: DrawFn = (g, s, p) => {
  const [B, S, A] = s.r;
  const lunge = p.arm >= 1.5 ? 3 : p.arm >= 0.5 ? -1 : 0;
  const t = p.flap * 2 + p.step * 1.5;
  const y = 18 - 2;
  g.part(P(8.5 + lunge, y, 1.5 + lunge, y - 6 + t, 3.5 + lunge, y, 1.5 + lunge, y + 6 + t), dk(A, 0.05));
  g.part(P(11 + lunge, y - 5, 15.5 + lunge, y - 11, 20 + lunge, y - 5), A);
  g.part(E(16 + lunge, y, 9.5, 6.3), B);
  g.part(E(17.5 + lunge, y + 3, 6.5, 2.6), S, { edge: false });
  for (let i = 0; i < 3; i++) g.dot(12 + i * 3 + lunge, y - 1 + (i % 2), s.r[0][1], 0.8);
  g.part(P(15 + lunge, y + 1, 11 + lunge, y + 6 - t * 0.5, 16 + lunge, y + 4), A);
  g.part(C(21.5 + lunge, y - 1.2, 2), flat(WHITE()), { shade: false });
  g.eye(22 + lunge, y - 0.4);
  if (p.mouth) g.part(E(25.3 + lunge, y + 1.4, 1, 1), flat(hex('#5a1020')), { shade: false });
};

const aqua: DrawFn = (g, s, p) => {
  const [B, S, A] = s.r;
  const lunge = p.arm >= 1.5 ? 2 : 0;
  g.part(E(11 + p.step, 27.5, 4.2, 2.6, -0.2), dk(B, 0.12), { body: false });
  g.part(E(21 - p.step, 27.5, 4.2, 2.6, 0.2), dk(B, 0.12), { body: false });
  g.part(P(9, 18, 12, 10, 15, 15, 17, 9, 20, 15, 22.5, 10.5, 23, 18), A);
  g.part(E(16 + lunge, 21.5, 8.6, 7), B);
  g.part(E(17 + lunge, 25, 5.8, 3.2), S, { edge: false });
  for (const ex of [12.5, 20]) { g.part(C(ex + lunge, 15.5, 3), B); g.part(C(ex + lunge + 0.4, 15.3, 1.8), flat(WHITE()), { shade: false }); }
  g.eye(13 + lunge, 15.9); g.eye(20.6 + lunge, 15.9);
  g.part(L(13 + lunge, 21.5, 20 + lunge, 21.5, 0.4), flat(dk(B, 0.4)[1]), { shade: false, edge: false });
  if (p.mouth) g.part(E(16.5 + lunge, 22, 3, 1.3), flat(hex('#5a1020')), { shade: false });
  g.part(E(21 + lunge * 2, 24, 2, 1.4), dk(B, 0.05));
};

const insect: DrawFn = (g, s, p) => {
  const [B, S, A] = s.r;
  const v = s.v;
  const lunge = p.arm >= 1.5 ? 2 : p.arm >= 0.5 ? -1 : 0;
  const legR = flat(dk(B, 0.4)[1]);
  for (let i = 0; i < 3; i++) {
    const ph = (i % 2 ? 1 : -1) * p.step;
    g.part(L(15 + i * 2.5, 21, 13 + i * 3.5 + ph * 1.5, 29.4, 0.7, 0.6), legR, { body: false });
  }
  if (v[0] > 0.35) {
    const f = p.flap * 2;
    g.part(E(12, 12.5 - f, 6.5, 2.5, -0.55 - p.flap * 0.15), lt(S, 0.4), { glow: true, shade: false });
  }
  const abd = E(10.5, 21, 6.6, 4.6, -0.15);
  g.part(abd, B);
  for (let i = 0; i < 3; i++) g.part(I(abd, R(6.5 + i * 3, 10, 7.8 + i * 3, 30)), dk(A, 0.15), { edge: false, shade: false });
  g.part(C(17.5, 19.5, 3.3), B);
  g.part(C(22.5 + lunge, 17.5, 3.6), B);
  g.part(L(23 + lunge, 14.5, 25 + lunge, 9 - v[1] * 2, 0.5), legR);
  g.part(L(21.5 + lunge, 14.5, 21 + lunge, 9 - v[2] * 2, 0.5), legR);
  const m = p.mouth ? 1.2 : 0;
  g.part(P(25 + lunge, 19, 28.5 + lunge + m, 18 - m, 27 + lunge, 20.5), A);
  g.part(P(25 + lunge, 20, 28 + lunge + m, 22 + m, 25.5 + lunge, 21.5), A);
  for (let i = 0; i < 3; i++) {
    const ph = (i % 2 ? -1 : 1) * p.step;
    g.part(L(16 + i * 2.5, 22, 15.5 + i * 3.8 + ph * 1.5, 29.6, 0.8, 0.7), legR, { body: false });
  }
  g.part(C(24 + lunge, 16.6, 1.7), A, { glow: true, shade: false });
  if (p.eyes !== 'open') g.part(R(22.5 + lunge, 16.4, 25.6 + lunge, 17.2), flat(INK()), { shade: false, edge: false });
};

const plant: DrawFn = (g, s, p) => {
  const [B, S, A] = s.r;
  const v = s.v;
  const leaf = B;
  const sway = p.bob * 0.5 + p.step * 0.8 + (p.arm >= 1.5 ? 2 : p.arm >= 0.5 ? -1 : 0);
  g.part(E(10.5, 28, 5.5, 1.9, -0.35), leaf, { body: false });
  g.part(E(21.5, 28, 5.5, 1.9, 0.35), leaf, { body: false });
  g.part(L(16, 29.5, 16 + sway * 0.6, 18, 1.8, 1.5), dk(leaf, 0.05), { body: false });
  const [hx, hy] = armPose(18, 21, p.arm);
  g.part(L(16, 23, 9, 19 - p.flap, 0.9), leaf);
  g.part(E(8, 18.5 - p.flap, 2.6, 1.3, -0.5), leaf);
  g.part(L(17, 22, hx + 3, hy, 0.9), leaf);
  g.part(E(hx + 4, hy - 0.5, 2.6, 1.3, 0.5), leaf);
  const cx = 16 + sway, cy = 12.5;
  if (v[0] > 0.5) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + v[1];
      g.part(E(cx + Math.cos(a) * 6, cy + Math.sin(a) * 5.5, 3.2, 2.6, a), S);
    }
    g.part(C(cx, cy, 5), A);
  } else {
    g.part(E(cx, cy + 1, 7.5, 6.6), S);
    g.part(P(cx - 4, cy - 5, cx - 1, cy - 9, cx, cy - 5.5, cx + 2, cy - 9.5, cx + 4, cy - 5), leaf);
  }
  g.eye(cx + 1, cy);
  g.eye(cx + 3.6, cy);
  if (p.mouth || v[2] > 0.5) {
    const open = p.mouth ? 1.6 : 0.8;
    g.part(E(cx + 2.3, cy + 3, 2.6, open), flat(hex('#5a1020')), { shade: false });
    g.dot(cx + 1.4, cy + 2.4, WHITE(), 0.7);
    g.dot(cx + 3.2, cy + 2.4, WHITE(), 0.7);
  }
};

const rock: DrawFn = (g, s, p) => {
  const [B, , A] = s.r;
  const v = s.v;
  const crack = flat(dk(B, 0.4)[1]);
  g.part(E(11.5 - p.step, 28.3, 3.4, 2.4), dk(B, 0.15), { body: false });
  g.part(E(20.5 + p.step, 28.3, 3.4, 2.4), dk(B, 0.15), { body: false });
  g.part(C(8, 21, 3.4), dk(B, 0.15));
  g.part(U(E(15.5, 20.5, 8.4, 7.2), E(10, 16, 4.2, 3.6), E(21.5, 16.5, 4, 3.4)), B);
  g.part(P(7.5, 15, 8.5, 7.5 - v[0] * 2, 11, 14), A, { glow: true, shade: false });
  g.part(P(10.5, 14, 12.2, 9 - v[1] * 2, 13.5, 14.2), lt(A, 0.15), { glow: true, shade: false });
  g.part(E(17, 10.8, 4.6, 3.8), B);
  g.part(L(13, 22, 15, 25, 0.4), crack, { shade: false, edge: false });
  g.part(L(19, 19, 21.5, 21, 0.4), crack, { shade: false, edge: false });
  const [hx, hy] = armPose(21, 18, p.arm);
  g.part(C(hx + 2.5, hy + 2, 3.6), B);
  g.eye(17.6, 11, s.r[2][3]);
  g.eye(20.2, 11, s.r[2][3]);
};

const bird: DrawFn = (g, s, p) => {
  const [B, S, A] = s.r;
  const lunge = p.arm >= 1.5 ? 3 : p.arm >= 0.5 ? -1 : 0;
  const f = p.flap;
  g.part(P(15, 15, 5, 6 + f * 6, 8, 15, 14, 20), dk(B, 0.2));
  g.part(P(10, 20, 2, 24.5, 4.5, 20.5, 1.5, 18.5, 10, 17), dk(S, 0.05));
  g.part(L(15, 23, 14 + p.step, 28.5, 0.6), flat(hex(PAL.orange)));
  g.part(L(17.5, 23, 18.5 - p.step, 28.5, 0.6), flat(hex(PAL.orange)));
  g.part(E(15.5, 18.5, 6.5, 5.5), B);
  g.part(E(17.5, 20.5, 4, 3.2), S, { edge: false });
  g.part(C(21 + lunge, 12, 3.8), B);
  g.part(P(18.5 + lunge, 9, 16 + lunge, 5, 20 + lunge, 8.3, 20.5 + lunge, 4.5, 22 + lunge, 8.6), A);
  g.part(P(23.8 + lunge, 11, 29 + lunge, 12.8 + (p.mouth ? -0.6 : 0), 23.8 + lunge, 14), flat(hex(PAL.gold)));
  if (p.mouth) g.part(P(24 + lunge, 13.3, 28 + lunge, 14.8, 24 + lunge, 14.6), flat(hex(PAL.goldDark)));
  g.part(P(14, 15.5, 3, 5.5 + f * 7, 6, 12.5 + f * 3, 3.5, 16.5 + f * 2, 7.5, 18 + f, 11, 21, 17.5, 19), B);
  g.part(L(14, 16, 5, 7 + f * 7, 0.45), flat(lt(B, 0.2)[2]), { shade: false, edge: false });
  g.eye(22.2 + lunge, 11.4);
};

const thunder: DrawFn = (g, s, p) => {
  const [B, S, A] = s.r;
  const n = 10, pts: number[] = [];
  const rot = p.fx * 0.7;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + rot;
    const r = i % 2 ? 7.5 : 11 + ((p.fx + i) % 3) * 0.6;
    pts.push(16 + Math.cos(a) * r, 17 + Math.sin(a) * r * 0.9);
  }
  g.part(P(...pts), A, { glow: true, shade: false });
  g.part(C(16, 17, 7.2), B);
  g.part(E(16, 17, 4, 4.4), lt(B, 0.25), { edge: false, shade: false });
  const [hx, hy] = armPose(20, 17, p.arm);
  g.part(P(21, 18, hx + 3, hy - 1, hx + 2, hy + 0.5, hx + 5, hy + 1), A);
  g.part(P(11, 18, 7, 16, 8, 17.5, 5, 19), A);
  g.eye(15, 16); g.eye(18.4, 16);
  g.part(E(16.8, 20, p.mouth ? 2 : 1.6, p.mouth ? 1.4 : 0.5), flat(INK()), { shade: false, edge: false });
  void S;
};

const pyro: DrawFn = (g, s, p) => {
  const [B, S, A] = s.r;
  const j = (i: number) => (((p.fx * 7 + i * 13) % 5) / 5 - 0.5) * 2;
  const lunge = p.arm >= 1.5 ? 2 : 0;
  g.part(P(8 + lunge, 24, 7, 15, 10 + j(1), 9, 11, 14, 14 + j(2), 3, 16, 10, 20 + j(3), 4.5, 21, 12, 24 + j(4) + lunge, 10, 25 + lunge, 18, 23 + lunge, 26, 16, 28.5, 10, 27), B, { shade: true });
  g.part(P(11 + lunge, 24, 11, 17, 14 + j(5), 11, 16, 16, 19 + j(6), 11, 21 + lunge, 18, 20 + lunge, 25, 16, 26.5), S, { edge: false });
  g.part(E(16 + lunge, 22, 3.6, 3.2), lt(A, 0.1), { edge: false, shade: false });
  g.eye(16 + lunge, 19); g.eye(19.5 + lunge, 19);
  if (p.mouth) g.part(E(18 + lunge, 22.5, 1.6, 1.2), flat(hex('#5a1020')), { shade: false });
};

const blob: DrawFn = (g, s, p) => {
  const [B, S, A] = s.r;
  const v = s.v;
  const sq = p.bob ? 0.6 : 0;
  const lunge = p.arm >= 1.5 ? 2 : 0;
  g.part(D(E(16 + lunge, 22.5 + sq, 9.5 + sq, 8 - sq), R(0, 29.8, 40, 40)), B);
  g.part(E(12 + lunge, 18, 2.2, 1.6, -0.5), flat(lt(B, 0.4)[3]), { shade: false, edge: false });
  if (v[0] > 0.5) g.part(P(13 + lunge, 15.5, 14 + lunge, 11, 16 + lunge, 14, 18 + lunge, 10.5, 19 + lunge, 15.5), A);
  g.eye(17 + lunge, 21); g.eye(21 + lunge, 21);
  if (p.mouth) g.part(E(19 + lunge, 25, 1.8, 1.1), flat(hex('#5a1020')), { shade: false });
  void S;
};

const FAMILY_DRAW: Record<Family, DrawFn> = {
  dragon: dragonLike('dragon'), dino: dragonLike('dino'), lizard: dragonLike('lizard'), serpent,
  mage: humanoid('mage'), psychic: humanoid('psychic'), fairy: humanoid('fairy'), zombie: humanoid('zombie'),
  warrior: humanoid('warrior'), beastwarrior: humanoid('beastwarrior'), fiend: humanoid('fiend'),
  beast, puff, machine, aqua, fish, insect, plant, rock, bird, thunder, pyro, blob,
};
