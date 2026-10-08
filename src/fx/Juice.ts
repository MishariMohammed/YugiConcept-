// Game-feel helpers: screen shake, hit-stop, floating damage numbers, pixel particle bursts,
// white hit flashes and squash/stretch. All are fire-and-forget and clean up after themselves.

import Phaser from 'phaser';
import { ensureTexture, hex, withAlpha } from './art/PixelCanvas';
import { PAL, PALT } from './art/Palette';
import { pixelText } from '../ui/PixelText';

/** Animation timing budget (ms). Duel animations stay <= 600 ms. */
export const TIMING = {
  hover: 90,
  cardMove: 220,
  flip: 180,
  summon: 420,
  attackLunge: 260,
  damageNumber: 650,
  hitStop: 70,
  shake: 140,
  burst: 450,
  lpTick: 500,
} as const;

/** Generated particle textures: 'px-dot' (2x2), 'px-spark' (5x5 plus), 'px-dust' (4x4 round), 'px-star' (7x7). */
export function ensureFxTextures(scene: Phaser.Scene): void {
  const white = hex('#ffffff');
  ensureTexture(scene, 'px-dot', 2, 2, (pc) => pc.fill(white));
  ensureTexture(scene, 'px-spark', 5, 5, (pc) => {
    pc.hline(0, 4, 2, white); pc.vline(2, 0, 4, white);
  });
  ensureTexture(scene, 'px-dust', 4, 4, (pc) => {
    pc.rect(1, 0, 2, 4, white); pc.rect(0, 1, 4, 2, white);
  });
  ensureTexture(scene, 'px-star', 7, 7, (pc) => {
    pc.vline(3, 0, 6, white); pc.hline(0, 6, 3, white);
    pc.rect(2, 2, 3, 3, white);
  });
  ensureTexture(scene, 'px-ring', 16, 16, (pc) => {
    pc.circle(8, 8, 8, white);
    pc.circle(8, 8, 6, 0);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      pc.put(x, y, d <= 8 && d > 6.2 ? white : 0);
    }
  });
  ensureTexture(scene, 'px-slash', 16, 16, (pc) => {
    for (let i = 0; i < 16; i++) {
      const y = Math.round(13 - i * 0.8 - Math.sin((i / 15) * Math.PI) * 3);
      pc.set(i, y, white);
      if (i > 2 && i < 13) pc.set(i, y + 1, withAlpha(white, 160));
    }
  });
}

/** Camera shake. intensity is a fraction of the camera size (0.004 = subtle, 0.012 = big hit). */
export function shake(scene: Phaser.Scene, intensity = 0.006, duration: number = TIMING.shake): void {
  scene.cameras.main.shake(duration, intensity, true);
}

let hitStopUntil = 0;
/**
 * Freeze-frame: slows tweens, timers, animations and arcade physics of this scene to ~0 for
 * `ms` real milliseconds. Uses a real-time setTimeout so it always recovers.
 */
export function hitStop(scene: Phaser.Scene, ms: number = TIMING.hitStop, scale = 0.02): void {
  const now = performance.now();
  if (now < hitStopUntil) { hitStopUntil = Math.max(hitStopUntil, now + ms); return; }
  hitStopUntil = now + ms;
  const prev = { tw: scene.tweens.timeScale, tm: scene.time.timeScale, an: scene.anims.globalTimeScale };
  scene.tweens.timeScale = scale;
  scene.time.timeScale = scale;
  scene.anims.globalTimeScale = scale;
  const phys = (scene as unknown as { physics?: { world?: { timeScale: number } } }).physics?.world;
  const prevPhys = phys?.timeScale;
  if (phys) phys.timeScale = 1 / scale; // arcade timeScale is inverted (higher = slower)
  const restore = () => {
    if (performance.now() + 1 < hitStopUntil) { setTimeout(restore, hitStopUntil - performance.now()); return; }
    scene.tweens.timeScale = prev.tw;
    scene.time.timeScale = prev.tm;
    scene.anims.globalTimeScale = prev.an;
    if (phys && prevPhys !== undefined) phys.timeScale = prevPhys;
  };
  setTimeout(restore, ms);
}

/** Flash a sprite/image solid white (WebGL tint-fill) for `ms`. */
export function flashWhite(target: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Tint, ms = 80, color = 0xffffff): void {
  target.setTintFill(color);
  target.scene.time.delayedCall(ms, () => { if (target.scene) target.clearTint(); });
}

export interface DamageNumberOpts {
  color?: number;
  crit?: boolean;
  /** prefix like '-' or '+'; default '-' for numbers */
  prefix?: string;
  scale?: number;
  depth?: number;
}

/** Pop-up pixel damage number that bounces, drifts up and fades (~650 ms). */
export function damageNumber(scene: Phaser.Scene, x: number, y: number, value: number | string, opts: DamageNumberOpts = {}): Phaser.GameObjects.BitmapText {
  const text = typeof value === 'number' ? `${opts.prefix ?? '-'}${Math.round(Math.abs(value))}` : value;
  const base = opts.scale ?? (opts.crit ? 2 : 1);
  const color = opts.color ?? (opts.crit ? PALT.gold : PALT.cream);
  const t = pixelText(scene, Math.round(x), Math.round(y), text, base, color, { originX: 0.5, originY: 1 });
  t.setDepth(opts.depth ?? 1000);
  const dx = (Math.random() - 0.5) * 14;
  t.setScale(0.4);
  scene.tweens.add({ targets: t, scale: 1.25, duration: 90, ease: 'Back.Out', yoyo: false,
    onComplete: () => scene.tweens.add({ targets: t, scale: 1, duration: 80 }) });
  scene.tweens.add({ targets: t, x: x + dx, y: y - 18 - (opts.crit ? 6 : 0), duration: TIMING.damageNumber, ease: 'Cubic.Out' });
  scene.tweens.add({ targets: t, alpha: 0, delay: TIMING.damageNumber * 0.6, duration: TIMING.damageNumber * 0.4, onComplete: () => t.destroy() });
  return t;
}

export interface BurstOpts {
  count?: number;
  colors?: number[];
  speed?: number;
  lifespan?: number;
  texture?: 'px-dot' | 'px-spark' | 'px-dust' | 'px-star';
  gravity?: number;
  depth?: number;
  scale?: number;
}

/** One-shot pixel particle explosion. */
export function burst(scene: Phaser.Scene, x: number, y: number, opts: BurstOpts = {}): Phaser.GameObjects.Particles.ParticleEmitter {
  ensureFxTextures(scene);
  const life = opts.lifespan ?? TIMING.burst;
  const sp = opts.speed ?? 90;
  const em = scene.add.particles(x, y, opts.texture ?? 'px-dot', {
    speed: { min: sp * 0.35, max: sp },
    angle: { min: 0, max: 360 },
    lifespan: { min: life * 0.6, max: life },
    scale: { start: opts.scale ?? 1, end: 0 },
    gravityY: opts.gravity ?? 160,
    tint: opts.colors ?? [PALT.cream, PALT.gold, PALT.orange],
    emitting: false,
  });
  em.setDepth(opts.depth ?? 900);
  em.explode(opts.count ?? 14);
  scene.time.delayedCall(life + 100, () => em.destroy());
  return em;
}

/** Expanding ring shockwave. */
export function ring(scene: Phaser.Scene, x: number, y: number, color: number = PALT.cream, size = 3, ms = 260): Phaser.GameObjects.Image {
  ensureFxTextures(scene);
  const img = scene.add.image(x, y, 'px-ring').setTint(color).setScale(0.3).setDepth(899);
  scene.tweens.add({ targets: img, scale: size, alpha: 0, duration: ms, ease: 'Cubic.Out', onComplete: () => img.destroy() });
  return img;
}

/** Slash streak (melee hit) facing right unless flipX. */
export function slash(scene: Phaser.Scene, x: number, y: number, flipX = false, color: number = PALT.white): Phaser.GameObjects.Image {
  ensureFxTextures(scene);
  const img = scene.add.image(x, y, 'px-slash').setTint(color).setFlipX(flipX).setScale(1.6).setDepth(901);
  scene.tweens.add({ targets: img, scaleX: 2.2, alpha: 0, duration: 160, onComplete: () => img.destroy() });
  return img;
}

/** Squash & stretch pop on any scalable object (keeps its current base scale). */
export function squash(scene: Phaser.Scene, target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject, amount = 0.25, ms = 220): void {
  const sx = target.scaleX, sy = target.scaleY;
  scene.tweens.chain({
    targets: target,
    tweens: [
      { scaleX: sx * (1 + amount), scaleY: sy * (1 - amount), duration: ms * 0.3, ease: 'Quad.Out' },
      { scaleX: sx * (1 - amount * 0.5), scaleY: sy * (1 + amount * 0.5), duration: ms * 0.3, ease: 'Quad.InOut' },
      { scaleX: sx, scaleY: sy, duration: ms * 0.4, ease: 'Back.Out' },
    ],
  });
}

/** Big hit combo: hit-stop + shake + flash + burst + number. */
export function impact(
  scene: Phaser.Scene, target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, damage: number,
  opts: { crit?: boolean; color?: number } = {},
): void {
  hitStop(scene, opts.crit ? 110 : TIMING.hitStop);
  shake(scene, opts.crit ? 0.012 : 0.005);
  flashWhite(target, 90);
  burst(scene, target.x, target.y - target.displayHeight * 0.4, { count: opts.crit ? 22 : 12, texture: 'px-spark', colors: [PALT.white, opts.color ?? PALT.gold, PALT.orange] });
  damageNumber(scene, target.x, target.y - target.displayHeight * 0.8, damage, { crit: opts.crit, color: opts.color });
}

export { PAL };
