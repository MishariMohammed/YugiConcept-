// Runtime-generated pixel bitmap fonts registered as Phaser RetroFonts (BitmapText).
//
//   'px'      5x7 proportional, plain white glyphs (tint to colour)
//   'px-o'    5x7 with a baked 1px ink outline (readable over anything; tint affects fill only
//             visually because the outline is near-black)
//   'px-tiny' 3x5 proportional, plain
//   'px-tiny-o' 3x5 with outline
//
// Icon glyphs: '^' star, '~' heart, '{' sword (ATK), '}' shield (DEF), '`' arrow.

import Phaser from 'phaser';
import { PixelCanvas, hex } from '../fx/art/PixelCanvas';
import { FONT_BIG, FONT_TINY, FontFace, normaliseText } from '../fx/art/PixelFont';
import { PAL } from '../fx/art/Palette';

export type PixelFontKey = 'px' | 'px-o' | 'px-tiny' | 'px-tiny-o';

const CHARSET = (() => {
  const set = new Set<string>([' ']);
  for (const k of Object.keys(FONT_BIG.glyphs)) set.add(k);
  for (const k of Object.keys(FONT_TINY.glyphs)) set.add(k);
  return Array.from(set).join('');
})();

const COLS = 16;

function buildFont(scene: Phaser.Scene, key: PixelFontKey, face: FontFace, outlined: boolean): void {
  if (scene.cache.bitmapFont.exists(key)) return;
  const pad = outlined ? 1 : 0;
  const maxW = Math.max(...Object.values(face.glyphs).map((g) => g.w));
  const cw = maxW + pad * 2 + 1;
  const ch = face.h + pad * 2;
  const rows = Math.ceil(CHARSET.length / COLS);
  const tm = scene.textures;
  if (!tm.exists(key)) {
    const pc = new PixelCanvas(cw * COLS, ch * rows);
    const white = hex('#ffffff');
    const ink = hex(PAL.ink);
    [...CHARSET].forEach((c, i) => {
      const g = face.glyphs[c];
      if (!g) return;
      const ox = (i % COLS) * cw + pad, oy = Math.floor(i / COLS) * ch + pad;
      const on = (x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < face.h && g.rows[y][x] === '#';
      for (let y = -pad; y < face.h + pad; y++) for (let x = -pad; x < g.w + pad; x++) {
        if (on(x, y)) pc.set(ox + x, oy + y, white);
        else if (outlined && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1) ||
          on(x - 1, y - 1) || on(x + 1, y - 1) || on(x - 1, y + 1) || on(x + 1, y + 1))) pc.set(ox + x, oy + y, ink);
      }
    });
    pc.toTexture(scene, key);
  }
  const entry = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: key, width: cw, height: ch, chars: CHARSET, charsPerRow: COLS,
    spacing: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, lineSpacing: 2,
  } as unknown as Phaser.Types.GameObjects.BitmapText.RetroFontConfig) as unknown as {
    data: { chars: Record<number, { xAdvance: number }>; size: number };
  };
  // Make it proportional: advance = glyph width + 1 gap (outlined glyphs overlap their outline).
  for (const c of CHARSET) {
    const info = entry.data.chars[c.charCodeAt(0)];
    if (!info) continue;
    info.xAdvance = c === ' ' ? face.space + face.gap : (face.glyphs[c]?.w ?? 3) + face.gap;
  }
  // Size reported by the font = glyph height so `fontSize` is in "pixel rows".
  entry.data.size = face.h;
  scene.cache.bitmapFont.add(key, entry);
}

/** Register all pixel fonts (idempotent). Call once in a boot/preload or before first use. */
export function ensurePixelFonts(scene: Phaser.Scene): void {
  buildFont(scene, 'px', FONT_BIG, false);
  buildFont(scene, 'px-o', FONT_BIG, true);
  buildFont(scene, 'px-tiny', FONT_TINY, false);
  buildFont(scene, 'px-tiny-o', FONT_TINY, true);
}

export interface PixelTextOpts {
  /** default true */
  outline?: boolean;
  /** use the 3x5 face */
  tiny?: boolean;
  /** 0..1 origin; default 0,0 */
  originX?: number;
  originY?: number;
  align?: 'left' | 'center' | 'right';
  /** wrap width in *unscaled* pixels */
  maxWidth?: number;
}

/**
 * Create crisp pixel text. `size` is an integer scale multiplier (1 = 7px tall caps,
 * 2 = 14px, ...). `color` is a 0xRRGGBB tint or a '#hex' string. Lowercase is upper-cased.
 */
export function pixelText(
  scene: Phaser.Scene, x: number, y: number, text: string, size = 1, color: number | string = 0xf4ead2,
  opts: PixelTextOpts = {},
): Phaser.GameObjects.BitmapText {
  ensurePixelFonts(scene);
  const tiny = opts.tiny ?? false;
  const outline = opts.outline ?? true;
  const font: PixelFontKey = tiny ? (outline ? 'px-tiny-o' : 'px-tiny') : (outline ? 'px-o' : 'px');
  const face = tiny ? FONT_TINY : FONT_BIG;
  const scale = Math.max(1, Math.round(size));
  const bt = scene.add.bitmapText(x, y, font, normaliseText(text, face), face.h * scale);
  bt.setTint(typeof color === 'string' ? parseInt(color.replace('#', ''), 16) : color);
  bt.setOrigin(opts.originX ?? 0, opts.originY ?? 0);
  if (opts.maxWidth) bt.setMaxWidth(opts.maxWidth * scale);
  if (opts.align === 'center') bt.setCenterAlign();
  else if (opts.align === 'right') bt.setRightAlign();
  else if (opts.align === 'left') bt.setLeftAlign();
  return bt;
}

/** Set text on an existing pixelText object, normalising unsupported characters. */
export function setPixelText(bt: Phaser.GameObjects.BitmapText, text: string): void {
  const tiny = bt.font.startsWith('px-tiny');
  bt.setText(normaliseText(text, tiny ? FONT_TINY : FONT_BIG));
}
