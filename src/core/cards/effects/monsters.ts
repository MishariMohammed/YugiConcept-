// Monster effects (Card Designer). Pure TS. Monster hooks only run while the monster is face-up.
import { listParam, num, registerEffect, type EffectContext } from '../EffectRegistry';

const isSelf = (ctx: EffectContext, uid: number | null) => uid === ctx.source.uid;

/**
 * 'atkPerNamedInGraveyards' {cardId, atk, scope: 'both'|'own'} (Dark Magician Girl):
 * this card gains `atk` for each card with id `cardId` in the graveyard(s).
 */
registerEffect('atkPerNamedInGraveyards', {
  statMod: (ctx, target) => {
    if (target.uid !== ctx.source.uid) return null;
    const id = String(ctx.params.cardId ?? '');
    const players = ctx.params.scope === 'own' ? [ctx.state.players[ctx.player]] : ctx.state.players;
    const n = players.reduce((s, p) => s + p.graveyard.filter((c) => c.defId === id).length, 0);
    return n ? { atk: n * num(ctx, 'atk', 300) } : null;
  },
});

/** 'atkPerOwnGraveyardMonster' {atk} (Swordstalker): +atk for each monster in its controller's graveyard. */
registerEffect('atkPerOwnGraveyardMonster', {
  statMod: (ctx, target) => {
    if (target.uid !== ctx.source.uid) return null;
    const n = ctx.state.players[ctx.player].graveyard.filter((c) => ctx.ops.cardDef(c.uid)?.kind === 'monster').length;
    return n ? { atk: n * num(ctx, 'atk', 100) } : null;
  },
});

/** 'allyBoost' {ally, atk, def} (Y-Dragon Head, Z-Metal Tank): +atk/+def while you control a face-up `ally`. */
registerEffect('allyBoost', {
  statMod: (ctx, target) => {
    if (target.uid !== ctx.source.uid) return null;
    const ally = String(ctx.params.ally ?? '');
    const has = ctx.state.players[ctx.player].monsters.some(
      (m) => m && !m.faceDown && m.card.defId === ally && m.card.uid !== ctx.source.uid);
    return has ? { atk: num(ctx, 'atk', 0), def: num(ctx, 'def', 0) } : null;
  },
});

/** 'noBattleDamageWhenDestroyed' (Kuriboh): if this is destroyed by battle, its controller takes no battle damage. */
registerEffect('noBattleDamageWhenDestroyed', {
  modifyBattle: (ctx, b) => {
    if (isSelf(ctx, b.attackerUid) && b.outcome.attackerDestroyed) b.outcome.lpDamage[0] = 0;
    if (isSelf(ctx, b.defenderUid) && b.outcome.defenderDestroyed) b.outcome.lpDamage[1] = 0;
  },
});

/** 'switchToAttackAfterAttacked' (Big Shield Gardna): attacked in Defense Position and survived -> Attack Position. */
registerEffect('switchToAttackAfterAttacked', {
  afterBattle: (ctx, b) => {
    if (isSelf(ctx, b.defenderUid) && b.defenderPosition === 'defense') ctx.ops.setPosition(ctx.source.uid, 'attack');
  },
});

/**
 * 'piercing' {defenseAfterAttack} (Spear Dragon): when it destroys a Defense Position monster,
 * deal ATK - DEF to the opponent; afterwards (if defenseAfterAttack) it switches to Defense Position.
 */
registerEffect('piercing', {
  modifyBattle: (ctx, b) => {
    if (!isSelf(ctx, b.attackerUid) || b.defenderPosition !== 'defense' || !b.outcome.defenderDestroyed) return;
    b.outcome.lpDamage[1] = Math.max(b.outcome.lpDamage[1], b.attackerAtk - b.defenderDef);
  },
  afterBattle: (ctx, b) => {
    if (isSelf(ctx, b.attackerUid) && ctx.params.defenseAfterAttack) ctx.ops.setPosition(ctx.source.uid, 'defense');
  },
});

/**
 * 'breakerCounter' {atk} (Breaker the Magical Warrior): when Normal Summoned, gains `atk` and a counter.
 * Ignition: remove the counter (losing the `atk`) to destroy 1 target spell/trap on the field.
 */
registerEffect('breakerCounter', {
  onSelfSummon: (ctx) => {
    if (ctx.summon?.how !== 'normal') return;
    ctx.ops.setCounters(ctx.source.uid, 1);
    ctx.ops.modifyAtk(ctx.source.uid, num(ctx, 'atk', 300));
  },
  canActivate: (ctx) => ctx.trigger !== 'ignition' || ctx.ops.getCounters(ctx.source.uid) > 0,
  getTargets: (ctx) => {
    const out: number[] = [];
    for (const p of ctx.state.players) for (const st of p.spellTraps) if (st) out.push(st.card.uid);
    return out;
  },
  onIgnition: (ctx) => {
    if (ctx.targetUid === undefined || ctx.ops.getCounters(ctx.source.uid) <= 0) return;
    ctx.ops.setCounters(ctx.source.uid, 0);
    ctx.ops.modifyAtk(ctx.source.uid, -num(ctx, 'atk', 300));
    ctx.ops.destroy(ctx.targetUid);
  },
});

/** 'protectTypeFromTargeting' {types} (Lord of D.): card effects cannot target face-up field monsters of `types`. */
registerEffect('protectTypeFromTargeting', {
  protects: (ctx, uid) => {
    const loc = ctx.ops.findMonster(uid);
    if (!loc || loc.slot.faceDown) return false;
    const t = ctx.ops.cardDef(uid)?.monsterType;
    return !!t && listParam(ctx, 'types').includes(t);
  },
});

/** 'doubleTribute' {attribute} (Kaiser Sea Horse): counts as 2 tributes for a monster of `attribute`. */
registerEffect('doubleTribute', {
  tributeValue: (ctx, summoning) => (summoning.attribute === ctx.params.attribute ? 2 : 1),
});
