// Spell effects (Card Designer). Pure TS. See docs/CARDS.md for the card-to-effect mapping.
import { monsterUids, num, registerEffect, type EffectContext } from '../EffectRegistry';

/** All spell/trap uids on the field, excluding the activating card itself. */
function spellTrapUids(ctx: EffectContext): number[] {
  const out: number[] = [];
  for (const p of ctx.state.players) {
    for (const st of p.spellTraps) if (st && st.card.uid !== ctx.source.uid) out.push(st.card.uid);
  }
  return out;
}

/** 'destroyAllMonsters' (Dark Hole): destroy every monster on the field. */
registerEffect('destroyAllMonsters', {
  canActivate: (ctx) => ctx.state.players.some((p) => p.monsters.some(Boolean)),
  onActivate: (ctx) => {
    for (const uid of [...monsterUids(ctx.state, ctx.player), ...monsterUids(ctx.state, ctx.opponent)]) {
      ctx.ops.destroy(uid);
    }
  },
});

/**
 * 'destroyLowestAtkOpponent' (Fissure): destroy the opponent's face-up monster with the
 * lowest ATK. Does not target (ignores Lord of D.); ties are broken with the duel RNG.
 */
registerEffect('destroyLowestAtkOpponent', {
  canActivate: (ctx) => monsterUids(ctx.state, ctx.opponent, (s) => !s.faceDown).length > 0,
  onActivate: (ctx) => {
    const uids = monsterUids(ctx.state, ctx.opponent, (s) => !s.faceDown);
    if (!uids.length) return;
    const min = Math.min(...uids.map((u) => ctx.ops.getEffectiveAtk(u)));
    const lowest = uids.filter((u) => ctx.ops.getEffectiveAtk(u) === min);
    const pick = lowest[Math.min(lowest.length - 1, Math.floor(ctx.ops.random() * lowest.length))];
    ctx.ops.destroy(pick);
  },
});

/** 'destroyTargetSpellTrap' (Mystical Space Typhoon): destroy 1 target spell/trap on the field. */
registerEffect('destroyTargetSpellTrap', {
  getTargets: (ctx) => spellTrapUids(ctx),
  onActivate: (ctx) => {
    if (ctx.targetUid !== undefined) ctx.ops.destroy(ctx.targetUid);
  },
});

/** 'monsterReborn' {from: 'either'|'own'}: Special Summon a monster from a graveyard to your field. */
registerEffect('monsterReborn', {
  getTargets: (ctx) => {
    const players = ctx.params.from === 'own' ? [ctx.state.players[ctx.player]] : ctx.state.players;
    const out: number[] = [];
    for (const p of players) {
      for (const c of p.graveyard) if (ctx.ops.cardDef(c.uid)?.kind === 'monster') out.push(c.uid);
    }
    return out;
  },
  canActivate: (ctx) => ctx.state.players[ctx.player].monsters.some((m) => m === null),
  onActivate: (ctx) => {
    if (ctx.targetUid !== undefined) ctx.ops.specialSummonFromAnyGY(ctx.player, ctx.targetUid, 'attack');
  },
});

/**
 * 'swordsOfRevealingLight' {turns} (continuous): flips the opponent's face-down monsters
 * face-up; the opponent's monsters cannot attack. Destroyed after `turns` of the opponent's turns.
 */
registerEffect('swordsOfRevealingLight', {
  onActivate: (ctx) => {
    ctx.ops.setCounters(ctx.source.uid, num(ctx, 'turns', 3));
    for (const uid of monsterUids(ctx.state, ctx.opponent, (s) => s.faceDown)) ctx.ops.flipFaceUp(uid);
  },
  canAttack: (ctx, attackerUid) => ctx.ops.findMonster(attackerUid)?.player !== ctx.opponent,
  onTurnEnd: (ctx) => {
    if (ctx.state.activePlayer !== ctx.opponent) return;
    const left = ctx.ops.getCounters(ctx.source.uid) - 1;
    ctx.ops.setCounters(ctx.source.uid, left);
    if (left <= 0) {
      ctx.ops.log('Swords of Revealing Light fades away.');
      ctx.ops.destroy(ctx.source.uid);
    }
  },
});

/** 'rushRecklessly' {atk} (Quick-Play): 1 face-up monster gains `atk` until the end of the turn. */
registerEffect('rushRecklessly', {
  getTargets: (ctx) => [
    ...monsterUids(ctx.state, ctx.player, (s) => !s.faceDown),
    ...monsterUids(ctx.state, ctx.opponent, (s) => !s.faceDown),
  ],
  onActivate: (ctx) => {
    if (ctx.targetUid !== undefined) ctx.ops.modifyAtkTemp(ctx.targetUid, num(ctx, 'atk', 700));
  },
});
