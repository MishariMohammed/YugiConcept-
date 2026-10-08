// Stardew-style arena spritesheets generated from the shared creature rig.
//
// Sheet layout (a single horizontal strip, frames named 0..14) - hand-drawn PNG overrides
// must follow it (public/assets/sprites/mon-<id>.png loaded with load.spritesheet):
//   0-3  idle   4-7 walk   8-10 attack (wind-up, strike, recover)   11 hit   12-14 ko
// Frame size: 32x32, or 48x48 for level >= 7. Sprites face RIGHT; use flipX for the left side.

import Phaser from 'phaser';
import type { Attribute, CardDef } from '../../core/types';
import { creatureSpec, drawCreature, pose, Pose } from './Creature';
import { PixelCanvas, addGridFrames, ensureTexture, hex, mix, shift, withAlpha } from './PixelCanvas';
import { ATTRIBUTE_COLOR, PAL } from './Palette';

export const MON_FRAMES = { idle: [0, 1, 2, 3], walk: [4, 5, 6, 7], attack: [8, 9, 10], hit: [11], ko: [12, 13, 14] } as const;
export type MonAnim = keyof typeof MON_FRAMES;
const FRAME_COUNT = 15;

export interface MonsterSpriteInfo {
  /** texture key; frames are '0'..'14' */
  key: string;
  /** frame width/height in px */
  size: number;
  /** animation keys: `${id}-idle` etc. */
  anims: Record<MonAnim, string>;
  /** true for hovering creatures (draw the ground shadow a bit further below) */
  floats: boolean;
  /** pixel y of the feet inside the frame (for placing shadows) */
  footY: number;
}

export function monsterSpriteSize(def: CardDef): number {
  return (def.level ?? 4) >= 7 ? 48 : 32;
}

function framePoses(floats: boolean, k: number): Pose[] {
  const fb = floats ? [0, 1, 2, 1] : [0, 0, 1, 1];
  return [
    // idle
    pose({ bob: fb[0], flap: -1, fx: 0 }),
    pose({ bob: fb[1], flap: 0, fx: 1 }),
    pose({ bob: fb[2], flap: 1, fx: 2 }),
    pose({ bob: fb[3], flap: 0, fx: 3 }),
    // walk
    pose({ step: -1, bob: 0, flap: -1, fx: 4 }),
    pose({ step: 0, bob: 1, flap: 0, fx: 5 }),
    pose({ step: 1, bob: 0, flap: 1, fx: 6 }),
    pose({ step: 0, bob: 1, flap: 0, fx: 7 }),
    // attack
    pose({ arm: 1, lean: -0.1, dx: -1, flap: 1, fx: 8 }),
    pose({ arm: 2, lean: 0.14, dx: 2, mouth: true, flap: -1, fx: 9, eyes: 'angry' }),
    pose({ arm: 0.6, lean: 0.05, dx: 1, flap: 0, fx: 10 }),
    // hit
    pose({ lean: -0.2, dx: -2, eyes: 'shut', sx: 1.06, sy: 0.94, mouth: true, fx: 11 }),
    // ko
    pose({ lean: -0.35, dx: -1, eyes: 'shut', sy: 0.95, fx: 12 }),
    pose({ lean: -0.9, dx: 2, eyes: 'x', fx: 13 }),
    pose({ lean: -1.45, dx: 6, dy: 0, eyes: 'x', sy: 0.9, fx: 14 }),
  ].map((p) => ({ ...p, dx: Math.round(p.dx * k) }));
}

/**
 * Ensure the arena spritesheet + animations for a monster exist. Idempotent. If a texture
 * `mon-<id>` is already loaded (hand-drawn override), only the animations are registered.
 */
export function ensureMonsterSpritesheet(scene: Phaser.Scene, def: CardDef): MonsterSpriteInfo {
  const key = `mon-${def.id}`;
  const spec = creatureSpec(def);
  let size = monsterSpriteSize(def);
  const tm = scene.textures;
  if (!tm.exists(key)) {
    const k = size / 32;
    const sheet = new PixelCanvas(size * FRAME_COUNT, size);
    framePoses(spec.floats, k).forEach((p, i) => {
      const fr = new PixelCanvas(size, size);
      // keep 1px for the outline
      drawCreature(fr, 0, -1 * k, k * 0.97, spec, p);
      fr.outline(spec.outline);
      sheet.blit(fr, i * size, 0);
    });
    const tex = sheet.toTexture(scene, key);
    addGridFrames(tex, size, size, FRAME_COUNT, FRAME_COUNT);
  } else {
    const src = tm.get(key).getSourceImage() as { height: number };
    size = src.height;
  }
  const anims = {} as Record<MonAnim, string>;
  const rates: Record<MonAnim, [number, number]> = { idle: [5, -1], walk: [10, -1], attack: [14, 0], hit: [1, 0], ko: [8, 0] };
  (Object.keys(MON_FRAMES) as MonAnim[]).forEach((a) => {
    const ak = `${def.id}-${a}`;
    anims[a] = ak;
    if (!scene.anims.exists(ak)) {
      scene.anims.create({
        key: ak,
        frames: MON_FRAMES[a].map((f) => ({ key, frame: f })),
        frameRate: rates[a][0],
        repeat: rates[a][1],
      });
    }
  });
  return { key, size, anims, floats: spec.floats, footY: Math.round(size * 0.94) };
}

/** Soft oval ground shadow texture ('fx-shadow', 24x8). Scale it to the sprite width. */
export function ensureShadowTexture(scene: Phaser.Scene): string {
  return ensureTexture(scene, 'fx-shadow', 24, 8, (pc) => {
    pc.ellipse(12, 4, 12, 4, withAlpha(hex(PAL.ink), 70));
    pc.ellipse(12, 4, 9, 3, withAlpha(hex(PAL.ink), 60));
  });
}

/** 10x10 glowing projectile orb tinted by attribute: key `proj-<ATTRIBUTE>`. */
export function ensureProjectileTexture(scene: Phaser.Scene, attribute: Attribute = 'LIGHT'): string {
  const base = hex(ATTRIBUTE_COLOR[attribute]);
  return ensureTexture(scene, `proj-${attribute}`, 12, 12, (pc) => {
    pc.circle(6, 6, 6, withAlpha(base, 90));
    pc.circle(6, 6, 4.4, shift(base, -0.1));
    pc.circle(6, 6, 3.2, shift(base, 0.35));
    pc.circle(5.3, 5.3, 1.6, mix(hex(PAL.white), base, 0.15));
    pc.outline(withAlpha(shift(base, -0.6), 200));
  });
}
