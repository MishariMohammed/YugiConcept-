// Minimal greedy NPC so the loop is playable before the real DuelAI (wave 2,
// src/core/ai/DuelAI.ts) lands. Pure TS. Replace usages with DuelAI when ready.
import type { DuelAction, PlayerId } from '../types';
import type { DuelEngine } from '../duel/DuelEngine';
import { getCard } from '../cards/CardDB';

export function placeholderChooseAction(engine: DuelEngine, player: PlayerId): DuelAction | null {
  const acts = engine.legalActions(player);
  if (acts.length === 0) return null;
  const atkOfHand = (uid: number) => getCard(engine.state.players[player].hand.find((c) => c.uid === uid)!.defId).atk ?? 0;

  // 1) Summon the strongest monster in attack position (prefer fewer tributes on ties).
  const summons = acts.filter((a): a is Extract<DuelAction, { type: 'normalSummon' }> => a.type === 'normalSummon' && !a.faceDown);
  if (summons.length) {
    summons.sort((a, b) => atkOfHand(b.handUid) - atkOfHand(a.handUid) || a.tributeUids.length - b.tributeUids.length);
    const best = summons[0];
    const tributeAtk = best.tributeUids.reduce((s, u) => s + engine.getEffectiveAtk(u), 0);
    if (best.tributeUids.length === 0 || atkOfHand(best.handUid) > tributeAtk) return best;
  }
  // 2) Activate untargeted spells / set traps.
  const spell = acts.find((a) => a.type === 'activateSpell');
  if (spell) return spell;
  const set = acts.find((a) => a.type === 'setSpellTrap' && getCard(handDef(engine, player, a.handUid)).kind === 'trap');
  if (set) return set;
  // 3) Battle.
  const battle = acts.find((a) => a.type === 'enterBattle');
  if (battle && engine.state.players[player].monsters.some((m) => m && m.position === 'attack')) return battle;
  // 4) Attacks that look favourable.
  for (const a of acts) {
    if (a.type !== 'declareAttack') continue;
    if (a.targetUid === null) return a;
    const atk = engine.getEffectiveAtk(a.attackerUid);
    const loc = engine.state.players[player === 0 ? 1 : 0].monsters.find((m) => m?.card.uid === a.targetUid)!;
    const stat = loc.position === 'attack' ? engine.getEffectiveAtk(a.targetUid) : engine.getEffectiveDef(a.targetUid);
    if (atk > stat) return a;
  }
  return acts.find((a) => a.type === 'endTurn') ?? acts[0];
}

function handDef(engine: DuelEngine, player: PlayerId, uid: number): string {
  return engine.state.players[player].hand.find((c) => c.uid === uid)!.defId;
}
