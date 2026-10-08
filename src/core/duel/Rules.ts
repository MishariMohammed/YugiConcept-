// Static duel rules + pure state query helpers. Pure TS.
import type { CardDef, CardInstance, DuelState, MonsterSlot, PlayerId, SpellTrapSlot } from '../types';
import { TUNING, tributesRequired as tributesForLevel } from '../combat/Formulas';

/** Duel constants. Source of truth is TUNING.duel in core/combat/Formulas.ts (Mechanics). */
export const RULES = {
  startingLp: TUNING.duel.startingLp,
  deckSize: TUNING.duel.deckSize,
  openingHand: TUNING.duel.openingHand,
  handLimit: TUNING.duel.handLimit,
  zones: TUNING.duel.monsterZones,
} as const;

/** Tributes required for a Normal Summon/Set of a monster of this level. */
export function tributesRequired(level: number | undefined): number {
  return tributesForLevel(level ?? 0);
}

/** Spell/trap speeds that remain on the field after activation. */
export function staysOnField(def: CardDef): boolean {
  return def.speed === 'continuous' || def.speed === 'equip' || def.speed === 'field';
}

export function other(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** All k-combinations of arr (order-preserving). */
export function combinations<T>(arr: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}

export function freeZone<T>(zones: readonly (T | null)[]): number {
  return zones.findIndex((z) => z === null);
}

export function countOccupied<T>(zones: readonly (T | null)[]): number {
  return zones.reduce((n, z) => n + (z ? 1 : 0), 0);
}

export interface MonsterLoc { player: PlayerId; zone: number; slot: MonsterSlot }
export interface SpellTrapLoc { player: PlayerId; zone: number; slot: SpellTrapSlot }

export function findMonster(state: Readonly<DuelState>, uid: number): MonsterLoc | null {
  for (const p of state.players) {
    const zone = p.monsters.findIndex((s) => s?.card.uid === uid);
    if (zone >= 0) return { player: p.id, zone, slot: p.monsters[zone]! };
  }
  return null;
}

export function findSpellTrap(state: Readonly<DuelState>, uid: number): SpellTrapLoc | null {
  for (const p of state.players) {
    const zone = p.spellTraps.findIndex((s) => s?.card.uid === uid);
    if (zone >= 0) return { player: p.id, zone, slot: p.spellTraps[zone]! };
  }
  return null;
}

export function findInHand(state: Readonly<DuelState>, player: PlayerId, uid: number): CardInstance | null {
  return state.players[player].hand.find((c) => c.uid === uid) ?? null;
}

/** Find any card instance anywhere (hand, deck, GY, field). */
export function findCardAnywhere(state: Readonly<DuelState>, uid: number): CardInstance | null {
  for (const p of state.players) {
    for (const list of [p.hand, p.deck, p.graveyard]) {
      const c = list.find((x) => x.uid === uid);
      if (c) return c;
    }
    for (const s of p.monsters) if (s?.card.uid === uid) return s.card;
    for (const s of p.spellTraps) if (s?.card.uid === uid) return s.card;
  }
  return null;
}
