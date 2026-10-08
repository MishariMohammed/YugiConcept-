// Trap effects (Card Designer). Pure TS. No chains: a trap's hook resolves immediately.
import { findSpellTrapSlot, monsterUids, registerEffect } from '../EffectRegistry';

/**
 * 'waboku' (on an opponent's attack): for the rest of this turn the controller takes no
 * battle damage and its monsters cannot be destroyed by battle. The attack (and arena) still happens.
 */
registerEffect('waboku', {
  canActivate: (ctx) => ctx.trigger === 'attackDeclared' && !!ctx.attack,
  onAttackDeclared: (ctx) => {
    ctx.ops.setFlag(ctx.player, 'noBattleDamage', ctx.state.turn);
    ctx.ops.setFlag(ctx.player, 'battleIndestructible', ctx.state.turn);
    ctx.ops.log('Waboku: no battle damage or battle destruction this turn.');
  },
});

/** 'magicCylinder' (on an opponent's attack): negate it and deal the attacker's ATK to its controller. */
registerEffect('magicCylinder', {
  canActivate: (ctx) => ctx.trigger === 'attackDeclared' && !!ctx.attack,
  onAttackDeclared: (ctx) => {
    if (!ctx.attack) return;
    const atk = ctx.ops.getEffectiveAtk(ctx.attack.attackerUid);
    ctx.ops.negateAttack();
    ctx.ops.damage(ctx.attack.attackerPlayer, atk);
  },
});

/**
 * 'spellbindingCircle' (continuous, manual activation with a target): the targeted opponent
 * monster cannot attack or change its battle position. The engine attaches the card to the
 * target (SpellTrapSlot.equippedTo), so it is destroyed when that monster leaves the field.
 */
registerEffect('spellbindingCircle', {
  getTargets: (ctx) => monsterUids(ctx.state, ctx.opponent),
  onActivate: (ctx) => {
    if (ctx.targetUid !== undefined) ctx.ops.log('Spellbinding Circle binds its target.');
  },
  canAttack: (ctx, uid) => findSpellTrapSlot(ctx.state, ctx.source.uid)?.equippedTo !== uid,
  canChangePosition: (ctx, uid) => findSpellTrapSlot(ctx.state, ctx.source.uid)?.equippedTo !== uid,
});
