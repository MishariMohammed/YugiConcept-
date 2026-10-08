// Master palette (see docs/ART.md). Hex strings so they can be used by Phaser and the
// pixel generators alike. `PALT` has the same colours as 0xRRGGBB numbers for tints.

import type { Attribute, CardDef, CardKind, MonsterType } from '../../core/types';

export const PAL = {
  // --- Balatro-dark UI -----------------------------------------------------
  ink: '#140c1c',        // outlines, deepest shadow
  night: '#1e1630',      // background base
  plum: '#2c2140',       // panels
  violet: '#3d2f5b',     // panel highlight / swirl band
  dusk: '#5a4a7a',       // muted UI line
  haze: '#8a7aa8',       // disabled text
  cream: '#f4ead2',      // primary text
  paper: '#e2d2b0',      // card text box
  red: '#e4433c',        // ATK, damage, "mult"
  redDark: '#8c1f2a',
  blue: '#3b8fe0',       // DEF, "chips"
  blueDark: '#1d4a8a',
  gold: '#f2b33d',       // rarity, LP, highlights
  goldDark: '#a8641e',
  orange: '#f08a3a',
  green: '#5fbf4a',      // heal / positive
  // --- Card frames ---------------------------------------------------------
  frameNormal: '#d9b26a',
  frameEffect: '#d8763c',
  frameSpell: '#2a9a84',
  frameTrap: '#b8448e',
  // --- Stardew-warm arena -------------------------------------------------
  grassDark: '#3f7a3a',
  grass: '#5ea546',
  grassLight: '#8cc85a',
  dirt: '#b07a48',
  dirtDark: '#7a4e2e',
  sand: '#e0b878',
  stone: '#9a948a',
  stoneDark: '#5e5a58',
  stoneLight: '#c8c0b0',
  wood: '#a0643a',
  woodDark: '#5c3420',
  water: '#4aa0d8',
  moss: '#6b8a3a',
  dungeon: '#3a3448',
  torch: '#ffd060',
  skin: '#f2c69b',
  white: '#fff8ec',
} as const;

export type PalKey = keyof typeof PAL;
export const PALT = Object.fromEntries(
  Object.entries(PAL).map(([k, v]) => [k, parseInt(v.slice(1), 16)]),
) as Record<PalKey, number>;

export const ATTRIBUTE_COLOR: Record<Attribute, string> = {
  DARK: '#8a44d0',
  LIGHT: '#f4dc6a',
  EARTH: '#a87a44',
  WATER: '#3c8ce0',
  FIRE: '#e4503a',
  WIND: '#4cc070',
  DIVINE: '#f0c040',
};

export function frameColor(kind: CardKind, isEffect?: boolean): string {
  if (kind === 'spell') return PAL.frameSpell;
  if (kind === 'trap') return PAL.frameTrap;
  return isEffect ? PAL.frameEffect : PAL.frameNormal;
}

/** Fallback creature palettes when a CardDef has no `palette`. [body, secondary, accent, skin/metal] */
const ATTR_PALETTES: Record<Attribute, string[]> = {
  DARK: ['#5b3a8c', '#2e2350', '#e65cff', '#c8b8e8'],
  LIGHT: ['#eae4d8', '#7aa8d8', '#ffd75e', '#f2c69b'],
  EARTH: ['#9a6a3c', '#5e7a3a', '#f0c060', '#f2c69b'],
  WATER: ['#3a7ac8', '#a8e0f0', '#ffe070', '#88c8c8'],
  FIRE: ['#d84a30', '#f0a040', '#ffe070', '#f2c69b'],
  WIND: ['#4aa060', '#e0f0a0', '#f07060', '#f2c69b'],
  DIVINE: ['#e8c050', '#f8f0d0', '#e04040', '#f2c69b'],
};
const TYPE_PALETTES: Partial<Record<MonsterType, string[]>> = {
  Machine: ['#8a94a8', '#4a5468', '#ff5a3a', '#c8d0dc'],
  Rock: ['#8a8278', '#5a5450', '#7ad0e8', '#b8b0a0'],
  Plant: ['#4a9a40', '#e05a4a', '#ffd84a', '#8ac858'],
  Insect: ['#6a9a30', '#c8d878', '#e04a3a', '#a8c8e8'],
  Zombie: ['#7a9a6a', '#5a4a3a', '#e0d040', '#9ab88a'],
  Thunder: ['#e8d040', '#4a7ae0', '#ffffff', '#fff0a0'],
  Pyro: ['#e85a28', '#ffc040', '#fff0a0', '#a02818'],
  Fish: ['#3a8ad0', '#e8f0f8', '#ffb040', '#a8d8f0'],
  Aqua: ['#3aa0b8', '#c0f0e0', '#ff8a5a', '#80c8d0'],
  'Sea Serpent': ['#2a7a9a', '#d0e8a0', '#ffd040', '#80c0c0'],
};

export function creaturePalette(def: CardDef): string[] {
  const p = def.palette && def.palette.length >= 3 ? def.palette.slice() : null;
  const base = p ?? (def.monsterType && TYPE_PALETTES[def.monsterType]) ??
    ATTR_PALETTES[def.attribute ?? 'EARTH'];
  const out = base.slice();
  while (out.length < 5) {
    if (out.length === 3) out.push(PAL.skin);
    else out.push(PAL.cream);
  }
  return out;
}
