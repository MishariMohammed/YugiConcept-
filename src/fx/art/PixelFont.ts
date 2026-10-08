// Hand-authored pixel fonts (no external assets). Two faces:
//   'big'  : 5x7 caps/digits/punctuation (proportional), used for names, UI, damage numbers
//   'tiny' : 3x5 caps/digits (proportional), used for card rules text / small card labels
// Special icon glyphs: '^' star, '~' heart, '{' sword (ATK), '}' shield (DEF), '|' bar, '`' arrow.

import { Color, PixelCanvas } from './PixelCanvas';

export interface Glyph { w: number; rows: string[] }
export interface FontFace { name: 'big' | 'tiny'; h: number; space: number; gap: number; glyphs: Record<string, Glyph> }

function face(name: 'big' | 'tiny', h: number, space: number, src: Record<string, string>): FontFace {
  const glyphs: Record<string, Glyph> = {};
  for (const ch of Object.keys(src)) {
    const rows = src[ch].split(' ').map((r) => r.replace(/_/g, '.'));
    while (rows.length < h) rows.push('');
    const w = Math.max(1, ...rows.map((r) => r.length));
    glyphs[ch] = { w, rows: rows.map((r) => r.padEnd(w, '.')) };
  }
  return { name, h, space, gap: 1, glyphs };
}

// Rows separated by spaces; '#' = ink.
export const FONT_BIG: FontFace = face('big', 7, 3, {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '### .#. .#. .#. .#. .#. ###',
  J: '..### ...#. ...#. ...#. #..#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# ##..# #.#.# #..## #...# #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# ##.## #...#',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
  '1': '.#. ##. .#. .#. .#. .#. ###',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####',
  '3': '####. ....# ....# .###. ....# ....# ####.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '.###. #.... #.... ####. #...# #...# .###.',
  '7': '##### ....# ...#. ..#.. .#... .#... .#...',
  '8': '.###. #...# #...# .###. #...# #...# .###.',
  '9': '.###. #...# #...# .#### ....# ....# .###.',
  '.': '. . . . . . #',
  ',': '.. .. .. .. .. .# #.',
  '!': '# # # # # . #',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  ':': '. # . . . # .',
  ';': '.. .# .. .. .. .# #.',
  "'": '# # . . . . .',
  '"': '#.# #.# ... ... ... ... ...',
  '-': '.... .... .... #### .... .... ....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  '=': '.... .... #### .... #### .... ....',
  '/': '....# ....# ...#. ..#.. .#... #.... #....',
  '(': '.# #. #. #. #. #. .#',
  ')': '#. .# .# .# .# .# #.',
  '[': '## #. #. #. #. #. ##',
  ']': '## .# .# .# .# .# ##',
  '<': '...# ..#. .#.. #... .#.. ..#. ...#',
  '>': '#... .#.. ..#. ...# ..#. .#.. #...',
  '%': '##..# ##..# ...#. ..#.. .#... #..## #..##',
  '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
  '*': '..... #.#.# .###. ##### .###. #.#.# .....',
  '&': '.##.. #..#. #.#.. .#... #.#.# #..#. .##.#',
  '_': '..... ..... ..... ..... ..... ..... #####',
  '@': '.###. #...# #.### #.#.# #.### #.... .####',
  '^': '..#.. ..#.. ##### .###. .###. ##.## #...#',
  '~': '..... ##.## ##### ##### .###. ..#.. .....',
  '{': '....# ...## ..##. #.#.. .#... #.#.. .....',
  '}': '##### ##### ##### ##### .###. ..#.. .....',
  '|': '# # # # # # #',
  '`': '..... ..#.. ...#. ##### ...#. ..#.. .....',
});

export const FONT_TINY: FontFace = face('tiny', 5, 2, {
  A: '.#. #.# ### #.# #.#',
  B: '##. #.# ##. #.# ##.',
  C: '.## #.. #.. #.. .##',
  D: '##. #.# #.# #.# ##.',
  E: '### #.. ##. #.. ###',
  F: '### #.. ##. #.. #..',
  G: '.## #.. #.# #.# .##',
  H: '#.# #.# ### #.# #.#',
  I: '### .#. .#. .#. ###',
  J: '..# ..# ..# #.# .#.',
  K: '#.# #.# ##. #.# #.#',
  L: '#.. #.. #.. #.. ###',
  M: '#...# ##.## #.#.# #...# #...#',
  N: '#..# ##.# #.## #..# #..#',
  O: '.#. #.# #.# #.# .#.',
  P: '##. #.# ##. #.. #..',
  Q: '.#. #.# #.# ##. .##',
  R: '##. #.# ##. #.# #.#',
  S: '.## #.. .#. ..# ##.',
  T: '### .#. .#. .#. .#.',
  U: '#.# #.# #.# #.# ###',
  V: '#.# #.# #.# #.# .#.',
  W: '#...# #...# #.#.# ##.## #...#',
  X: '#.# #.# .#. #.# #.#',
  Y: '#.# #.# .#. .#. .#.',
  Z: '### ..# .#. #.. ###',
  '0': '### #.# #.# #.# ###',
  '1': '.#. ##. .#. .#. ###',
  '2': '##. ..# .#. #.. ###',
  '3': '##. ..# .#. ..# ##.',
  '4': '#.# #.# ### ..# ..#',
  '5': '### #.. ##. ..# ##.',
  '6': '.## #.. ### #.# ###',
  '7': '### ..# .#. .#. .#.',
  '8': '### #.# ### #.# ###',
  '9': '### #.# ### ..# ##.',
  '.': '. . . . #',
  ',': '. . . # #',
  '!': '# # # . #',
  '?': '##. ..# .#. ... .#.',
  ':': '. # . # .',
  ';': '. # . # #',
  "'": '# # . . .',
  '"': '#.# #.# ... ... ...',
  '-': '.. .. ## .. ..',
  '+': '... .#. ### .#. ...',
  '=': '... ### ... ### ...',
  '/': '..# ..# .#. #.. #..',
  '(': '.# #. #. #. .#',
  ')': '#. .# .# .# #.',
  '[': '## #. #. #. ##',
  ']': '## .# .# .# ##',
  '<': '..# .#. #.. .#. ..#',
  '>': '#.. .#. ..# .#. #..',
  '%': '#.# ..# .#. #.. #.#',
  '*': '... #.# .#. #.# ...',
  '&': '.#. #.. .## #.# .##',
  '_': '... ... ... ... ###',
  '#': '#.# ### #.# ### #.#',
  '^': '.#. ### .#. #.# ...',
  '~': '#.# ### ### .#. ...',
  '{': '..# .#. #.. ... ...',
  '}': '### ### .#. ... ...',
  '|': '# # # # #',
  '`': '.#. ..# ### ..# .#.',
});

export function getFont(f: 'big' | 'tiny'): FontFace { return f === 'big' ? FONT_BIG : FONT_TINY; }

/** Normalise text to the glyph set (uppercase, unknown -> '?'). */
export function normaliseText(text: string, font: FontFace): string {
  let out = '';
  for (const raw of text.toUpperCase()) {
    let ch = raw;
    if (ch === '★') ch = '^';
    if (ch === '…') { out += '..'; continue; }
    if (ch === '’' || ch === '‘') ch = "'";
    if (ch === '“' || ch === '”') ch = '"';
    if (ch === '–' || ch === '—') ch = '-';
    if (ch === ' ' || ch === '\n' || font.glyphs[ch]) out += ch;
    else if (/[ÀÁÂÄ]/.test(ch)) out += 'A';
    else if (/[ÈÉÊË]/.test(ch)) out += 'E';
    else if (/[ÔÖÓ]/.test(ch)) out += 'O';
    else if (/[ÜÚ]/.test(ch)) out += 'U';
    else out += '?';
  }
  return out;
}

export function measureText(text: string, font: FontFace | 'big' | 'tiny'): number {
  const f = typeof font === 'string' ? getFont(font) : font;
  const s = normaliseText(text, f);
  let w = 0;
  for (const ch of s) w += (ch === ' ' ? f.space : f.glyphs[ch].w) + f.gap;
  return Math.max(0, w - f.gap);
}

/** Truncate so it fits in maxW pixels, appending '.' when cut. */
export function fitText(text: string, font: FontFace | 'big' | 'tiny', maxW: number): string {
  const f = typeof font === 'string' ? getFont(font) : font;
  let s = normaliseText(text, f);
  if (measureText(s, f) <= maxW) return s;
  while (s.length > 1 && measureText(s + '.', f) > maxW) s = s.slice(0, -1).trimEnd();
  return s + '.';
}

/** Word-wrap into lines no wider than maxW. */
export function wrapText(text: string, font: FontFace | 'big' | 'tiny', maxW: number): string[] {
  const f = typeof font === 'string' ? getFont(font) : font;
  const lines: string[] = [];
  for (const para of normaliseText(text, f).split('\n')) {
    let cur = '';
    for (const word of para.split(' ')) {
      const cand = cur ? cur + ' ' + word : word;
      if (measureText(cand, f) <= maxW || !cur) cur = cand;
      else { lines.push(cur); cur = word; }
    }
    lines.push(cur);
  }
  return lines;
}

/**
 * Draw text into a PixelCanvas. `shadow` draws a 1px drop shadow (down-right),
 * `outline` a full 1px outline around the glyphs.
 */
export function drawText(
  pc: PixelCanvas, text: string, x: number, y: number, color: Color,
  opts: { font?: 'big' | 'tiny'; shadow?: Color; outline?: Color; align?: 'left' | 'center' | 'right' } = {},
): number {
  const f = getFont(opts.font ?? 'big');
  const s = normaliseText(text, f);
  const w = measureText(s, f);
  let cx = x;
  if (opts.align === 'center') cx = Math.round(x - w / 2);
  else if (opts.align === 'right') cx = x - w;
  const plot = (dx: number, dy: number, c: Color) => {
    let px = cx;
    for (const ch of s) {
      if (ch === ' ') { px += f.space + f.gap; continue; }
      const g = f.glyphs[ch];
      for (let r = 0; r < f.h; r++) for (let i = 0; i < g.w; i++) {
        if (g.rows[r][i] === '#') pc.set(px + i + dx, y + r + dy, c);
      }
      px += g.w + f.gap;
    }
  };
  if (opts.outline !== undefined) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) plot(dx, dy, opts.outline);
  }
  if (opts.shadow !== undefined) plot(1, 1, opts.shadow);
  plot(0, 0, color);
  return w;
}
