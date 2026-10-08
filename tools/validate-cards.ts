// Validates src/data/cards.json and src/data/decks.ts against the shared contract.
// Usage: npx tsx tools/validate-cards.ts   (exits 1 on any error)
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArenaAbility, ArenaAbilityKind, ArenaStyle, Attribute, CardDef, MonsterType, SpellSpeed,
} from '../src/core/types';
import { DECKS } from '../src/data/decks';
import { TUNING, abilityBudget, abilityValue, styleForCard, styleForType, validateAbilities } from '../src/core/combat/Formulas';
import { hasEffect } from '../src/core/cards/EffectRegistry';
import '../src/core/cards/effects/index';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cards: CardDef[] = JSON.parse(readFileSync(resolve(root, 'src/data/cards.json'), 'utf8'));

const ATTRIBUTES: Attribute[] = ['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'];
const MONSTER_TYPES: MonsterType[] = [
  'Spellcaster', 'Dragon', 'Warrior', 'Beast', 'Beast-Warrior', 'Fiend', 'Zombie', 'Machine', 'Aqua', 'Pyro',
  'Rock', 'Winged Beast', 'Plant', 'Insect', 'Thunder', 'Fairy', 'Fish', 'Sea Serpent', 'Reptile', 'Dinosaur', 'Psychic',
];
const STYLES: ArenaStyle[] = ['melee', 'ranged', 'bruiser', 'swift'];
const SPEEDS: SpellSpeed[] = ['normal', 'quick', 'continuous', 'equip', 'field'];
const TRAP_SPEEDS: SpellSpeed[] = ['normal', 'continuous'];
const RARITIES = ['common', 'rare', 'super', 'ultra'];

type Range = [number, number];
/** Structural sanity ranges per kind. The real per-level value budget + min cooldown come
 *  from Formulas.validateAbilities (Mechanics Specialist, TUNING.abilities). */
const KIND_LIMITS: Record<ArenaAbilityKind, { power: Range; duration?: Range; magnitude?: Range }> = {
  projectile: { power: [0.5, TUNING.abilities.maxPower] },
  dash: { power: [0.5, TUNING.abilities.maxPower] },
  aoe: { power: [0.5, TUNING.abilities.maxPower] },
  shield: { power: [0, 0], duration: [1, 4], magnitude: [0.1, TUNING.abilities.maxShield] },
  heal: { power: [0, 0], magnitude: [0.05, TUNING.abilities.maxHealFrac] },
  buff: { power: [0, 0], duration: [1, 4], magnitude: [1.05, TUNING.abilities.maxBuffMult] },
  stun: { power: [0, 1.0], duration: [0.3, TUNING.abilities.maxStunSec] },
};
const errors: string[] = [];
const warnings: string[] = [];
const err = (c: { id?: string }, m: string) => errors.push(`[${c.id ?? '?'}] ${m}`);
const inRange = (v: number | undefined, r: Range) => typeof v === 'number' && v >= r[0] - 1e-9 && v <= r[1] + 1e-9;
const HEX = /^#[0-9a-fA-F]{6}$/;

function checkAbility(c: CardDef, a: ArenaAbility, isSpell: boolean): void {
  const b = KIND_LIMITS[a.kind];
  if (!a.id || !a.name || !a.description) err(c, `ability missing id/name/description`);
  if (!b) { err(c, `ability ${a.id}: unknown kind "${a.kind}"`); return; }
  const tag = `ability ${a.id} (${a.kind})`;
  if (!inRange(a.power, b.power)) err(c, `${tag}: power ${a.power} outside [${b.power}]`);
  // Arena-usable spells are one-shot (once per fight), so cooldown must be 0.
  if (isSpell) { if (a.cooldown !== 0) err(c, `${tag}: spell abilities are one-shot, cooldown must be 0`); }
  else if (!(a.cooldown > 0)) err(c, `${tag}: cooldown must be > 0`);
  if (b.duration && !inRange(a.duration, b.duration)) err(c, `${tag}: duration ${a.duration} outside [${b.duration}]`);
  if (!b.duration && a.duration !== undefined) warnings.push(`[${c.id}] ${tag}: duration ignored for this kind`);
  if (b.magnitude && !inRange(a.magnitude, b.magnitude)) err(c, `${tag}: magnitude ${a.magnitude} outside [${b.magnitude}]`);
}

const ids = new Set<string>();
const abilityIds = new Map<string, string>();
for (const c of cards) {
  if (!c.id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)) err(c, 'id must be a lowercase slug');
  if (ids.has(c.id)) err(c, 'duplicate id');
  ids.add(c.id);
  if (!c.name) err(c, 'missing name');
  if (!c.text) err(c, 'missing text');
  if (c.rarity && !RARITIES.includes(c.rarity)) err(c, `bad rarity ${c.rarity}`);
  if (!c.palette || c.palette.length < 3 || c.palette.length > 5) err(c, 'palette must have 3-5 colors');
  else for (const p of c.palette) if (!HEX.test(p)) err(c, `bad palette color ${p}`);

  for (const a of c.arenaAbilities ?? []) {
    const prev = abilityIds.get(a.id);
    if (prev && prev !== c.id) err(c, `ability id ${a.id} already used by ${prev}`);
    abilityIds.set(a.id, c.id);
  }

  if (c.kind === 'monster') {
    if (!c.attribute || !ATTRIBUTES.includes(c.attribute)) err(c, `bad attribute ${c.attribute}`);
    if (!c.monsterType || !MONSTER_TYPES.includes(c.monsterType)) err(c, `bad monsterType ${c.monsterType}`);
    if (!Number.isInteger(c.level) || c.level! < 1 || c.level! > 12) err(c, `level ${c.level} not in 1..12`);
    for (const k of ['atk', 'def'] as const) {
      const v = c[k];
      if (!Number.isInteger(v) || v! < 0 || v! % 50 !== 0) err(c, `${k} ${v} must be a non-negative multiple of 50`);
    }
    if (typeof c.isEffect !== 'boolean') err(c, 'isEffect must be set');
    if (c.arenaStyle && !STYLES.includes(c.arenaStyle)) err(c, `bad arenaStyle ${c.arenaStyle}`);
    if (c.arenaStyle && c.monsterType && styleForType(c.monsterType) === c.arenaStyle)
      warnings.push(`[${c.id}] arenaStyle "${c.arenaStyle}" equals the type default; can be omitted`);
    const abil = c.arenaAbilities ?? [];
    if (c.isEffect) {
      if (abil.length < 1 || abil.length > 2) err(c, `effect monsters need 1-2 arena abilities (has ${abil.length})`);
      if (!c.effect?.id) err(c, 'effect monster needs effect.id');
    } else {
      if (abil.length !== 1) err(c, `normal monsters need exactly 1 signature ability (has ${abil.length})`);
      if (c.effect) err(c, 'normal monster must not have an effect');
    }
    for (const a of abil) checkAbility(c, a, false);
    for (const p of validateAbilities(c)) err(c, `budget: ${p}`);
    if (c.speed || c.arenaUsable) err(c, 'monster must not have speed/arenaUsable');
  } else if (c.kind === 'spell' || c.kind === 'trap') {
    if (!c.speed || !(c.kind === 'trap' ? TRAP_SPEEDS : SPEEDS).includes(c.speed)) err(c, `bad speed ${c.speed}`);
    if (!c.effect?.id) err(c, 'spell/trap needs effect.id');
    if (c.kind === 'spell' && c.effect?.id === 'equipAtk' && c.speed !== 'equip') err(c, 'equipAtk needs speed "equip"');
    for (const k of ['attribute', 'monsterType', 'level', 'atk', 'def', 'arenaStyle'] as const)
      if (c[k] !== undefined) err(c, `${c.kind} must not have ${k}`);
    if (c.arenaUsable) {
      if (c.kind !== 'spell') err(c, 'only spells can be arenaUsable');
      if (c.arenaAbilities?.length !== 1) err(c, 'arenaUsable spell needs exactly 1 arenaAbilities entry (its arena behavior)');
    } else if (c.arenaAbilities?.length) err(c, 'non-arenaUsable spell/trap must not have arenaAbilities');
    for (const a of c.arenaAbilities ?? []) checkAbility(c, a, true);
  } else {
    err(c, `bad kind ${(c as CardDef).kind}`);
  }
}

// Decks
const byId = new Map(cards.map((c) => [c.id, c]));
const deckRows: string[] = [];
for (const [deckId, list] of Object.entries(DECKS)) {
  if (list.length !== 30) errors.push(`[deck ${deckId}] has ${list.length} cards, expected 30`);
  const counts = new Map<string, number>();
  for (const id of list) {
    if (!byId.has(id)) errors.push(`[deck ${deckId}] unknown card id ${id}`);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, n] of counts) if (n > 3) errors.push(`[deck ${deckId}] ${id} x${n} exceeds 3 copies`);
  const defs = list.map((id) => byId.get(id)).filter((c): c is CardDef => !!c);
  const mons = defs.filter((c) => c.kind === 'monster');
  const low = mons.filter((c) => (c.level ?? 0) <= 4).length;
  const spells = defs.filter((c) => c.kind === 'spell').length;
  const traps = defs.filter((c) => c.kind === 'trap').length;
  const avgAtk = Math.round(mons.reduce((s, c) => s + (c.atk ?? 0), 0) / Math.max(1, mons.length));
  deckRows.push(`${deckId.padEnd(8)}${String(list.length).padStart(5)}${String(mons.length).padStart(6)}${String(low).padStart(6)}${String(mons.length - low).padStart(8)}${String(spells).padStart(7)}${String(traps).padStart(6)}${String(avgAtk).padStart(8)}`);
}

// Summary table
const pad = (s: string | number, n: number) => String(s).slice(0, n).padEnd(n);
console.log(`\n${pad('id', 38)}${pad('kind', 8)}${pad('lv', 4)}${pad('atk/def', 11)}${pad('style', 9)}${pad('value', 10)}abilities`);
console.log('-'.repeat(110));
for (const c of cards) {
  const style = c.kind === 'monster' ? (c.arenaStyle ?? `${styleForCard(c)}*`) : c.arenaUsable ? 'arena' : '';
  const value = c.kind === 'monster'
    ? `${(c.arenaAbilities ?? []).reduce((s, a) => s + abilityValue(a, styleForCard(c)), 0).toFixed(2)}/${abilityBudget(c.level ?? 4).budget}`
    : '';
  const stats = c.kind === 'monster' ? `${c.atk}/${c.def}` : c.speed ?? '';
  const ab = (c.arenaAbilities ?? []).map((a) => `${a.kind}:${a.name}`).join(', ');
  console.log(`${pad(c.id, 38)}${pad(c.kind, 8)}${pad(c.level ?? '', 4)}${pad(stats, 11)}${pad(style, 9)}${pad(value, 10)}${ab}`);
}
console.log('(* = type-default arena style)\n');
console.log(`${'deck'.padEnd(8)}${'size'.padStart(5)}${'mons'.padStart(6)}${'lv<=4'.padStart(6)}${'tribute'.padStart(8)}${'spells'.padStart(7)}${'traps'.padStart(6)}${'avgATK'.padStart(8)}`);
for (const r of deckRows) console.log(r);

const kinds = { monster: 0, spell: 0, trap: 0 } as Record<string, number>;
for (const c of cards) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
console.log(`\n${cards.length} cards (${kinds.monster} monsters, ${kinds.spell} spells, ${kinds.trap} traps); ` +
  `${cards.filter((c) => c.arenaUsable).length} arena-usable spells.`);
const effectIds = [...new Set(cards.map((c) => c.effect?.id).filter(Boolean))].sort();
console.log(`effect ids (${effectIds.length}): ${effectIds.join(', ')}`);
const missing = effectIds.filter((id) => !hasEffect(id!));
if (missing.length) console.log(`effect ids not yet registered in EffectRegistry (${missing.length}): ${missing.join(', ')}`);

for (const w of warnings) console.warn(`WARN  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`ERROR ${e}`);
  console.error(`\n${errors.length} error(s).`);
  process.exit(1);
}
console.log('\nOK: all cards and decks valid.');
