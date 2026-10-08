// Barrel + prewarm helper for the procedural art pipeline.
import Phaser from 'phaser';
import type { CardDef } from '../../core/types';
import { ensureCardTextures, ensureCardBacks, ensureFoilTexture } from './CardArt';
import { ensureMonsterSpritesheet, ensureShadowTexture } from './MonsterSprite';
import { ensureFxTextures } from '../Juice';
import { ensurePixelFonts } from '../../ui/PixelText';

export * from './CardArt';
export * from './MonsterSprite';
export * from './ArenaTiles';
export * from './Palette';
export { hashString, seededRandom } from './PixelCanvas';

/**
 * Generate every card face (+ monster spritesheet when `sprites`) time-sliced across frames so
 * a Boot/Loading scene stays responsive on phones (~8 ms desktop / ~40 ms mobile per card).
 * Resolves when done. onProgress receives 0..1.
 */
export function prewarmArt(
  scene: Phaser.Scene, defs: CardDef[],
  opts: { sprites?: boolean; budgetMs?: number; onProgress?: (p: number) => void } = {},
): Promise<void> {
  ensurePixelFonts(scene);
  ensureFxTextures(scene);
  ensureShadowTexture(scene);
  ensureCardBacks(scene);
  ensureFoilTexture(scene, 'sm', 'white'); ensureFoilTexture(scene, 'sm', 'rainbow');
  ensureFoilTexture(scene, 'lg', 'white'); ensureFoilTexture(scene, 'lg', 'rainbow');
  const jobs: (() => void)[] = [];
  for (const d of defs) {
    jobs.push(() => ensureCardTextures(scene, d));
    if (opts.sprites && d.kind === 'monster') jobs.push(() => ensureMonsterSpritesheet(scene, d));
  }
  const budget = opts.budgetMs ?? 12;
  let i = 0;
  return new Promise((resolve) => {
    const step = () => {
      const t0 = performance.now();
      while (i < jobs.length && performance.now() - t0 < budget) jobs[i++]();
      opts.onProgress?.(jobs.length ? i / jobs.length : 1);
      if (i >= jobs.length) resolve();
      else scene.time.delayedCall(0, step);
    };
    step();
  });
}
