// Helpers around DuelAction for UI/AI/debugging. Pure TS.
import type { DuelAction, DuelState } from '../types';
import { getCard } from '../cards/CardDB';
import { findCardAnywhere } from './Rules';

function name(state: Readonly<DuelState>, uid: number | null | undefined): string {
  if (uid === null || uid === undefined) return '';
  const c = findCardAnywhere(state, uid);
  return c ? getCard(c.defId).name : `#${uid}`;
}

/** Short human-readable label for an action (debug UI, logs). */
export function describeAction(state: Readonly<DuelState>, a: DuelAction): string {
  switch (a.type) {
    case 'normalSummon': {
      const verb = a.faceDown ? 'Set' : 'Summon';
      const trib = a.tributeUids.length ? ` (tribute ${a.tributeUids.map((u) => name(state, u)).join(', ')})` : '';
      return `${verb} ${name(state, a.handUid)}${trib}`;
    }
    case 'activateSpell':
      return `Activate ${name(state, a.handUid)}${a.targetUid !== undefined ? ` -> ${name(state, a.targetUid)}` : ''}`;
    case 'setSpellTrap': return `Set ${name(state, a.handUid)}`;
    case 'activateSet':
      return `Flip ${name(state, a.uid)}${a.targetUid !== undefined ? ` -> ${name(state, a.targetUid)}` : ''}`;
    case 'changePosition': return `Change pos. ${name(state, a.uid)}`;
    case 'enterBattle': return 'Battle Phase';
    case 'declareAttack':
      return `${name(state, a.attackerUid)} attacks ${a.targetUid === null ? 'directly' : name(state, a.targetUid)}`;
    case 'endTurn': return 'End Turn';
  }
}

/** Structural equality of two actions (tribute order-insensitive). */
export function sameAction(a: DuelAction, b: DuelAction): boolean {
  const norm = (x: DuelAction) =>
    JSON.stringify(x.type === 'normalSummon' ? { ...x, tributeUids: [...x.tributeUids].sort((p, q) => p - q) } : x);
  return norm(a) === norm(b);
}
