// Duel-side effect hook system. Pure TS.
//
// A card references an effect via CardDef.effect = { id, params }. The handler
// registered under that id is invoked by the DuelEngine at the relevant hooks.
// Handlers never touch DuelState directly for mutations: they use ctx.ops so
// the engine can emit events, keep the log and check win conditions.
//
// Wave 2 (Card Designer): add new handlers in src/core/cards/effects/*.ts and
// import them from src/core/cards/effects/index.ts (the engine imports that file).
import type {
  CardDef, CardInstance, DuelState, MonsterSlot, PlayerId, Position,
} from '../types';

export type EffectTrigger =
  | 'activate'        // manual activation from hand or from a Set zone
  | 'attackDeclared'  // opponent declared an attack (traps)
  | 'summon'          // a monster was Normal Summoned (traps like Trap Hole)
  | 'selfSummon';     // this monster itself was summoned face-up

export interface AttackInfo {
  attackerUid: number;
  attackerPlayer: PlayerId;
  /** null = direct attack */
  targetUid: number | null;
}

export interface SummonInfo {
  uid: number;
  player: PlayerId;
  faceDown: boolean;
}

/** Mutating helpers provided by the engine. All emit DuelEvents + log lines. */
export interface EffectOps {
  draw(player: PlayerId, n: number): void;
  /** Inflict LP damage to `player`. */
  damage(player: PlayerId, n: number): void;
  heal(player: PlayerId, n: number): void;
  /** Destroy a card on the field (monster or spell/trap) by uid. Returns false if not found. */
  destroy(uid: number): boolean;
  /** Permanent ATK/DEF modifiers on a monster slot (MonsterSlot.atkMod/defMod). */
  modifyAtk(uid: number, delta: number): void;
  modifyDef(uid: number, delta: number): void;
  /** Special Summon a card from `player`'s graveyard. Returns false if impossible. */
  specialSummonFromGY(player: PlayerId, uid: number, position?: Position): boolean;
  /** Special Summon a card from `player`'s hand. Returns false if impossible. */
  specialSummonFromHand(player: PlayerId, uid: number, position?: Position): boolean;
  /** During onAttackDeclared: stop the current attack (it still counts as the monster's attack). */
  negateAttack(): void;
  log(text: string): void;
  /** Deterministic RNG for effects. */
  random(): number;
  // read helpers
  findMonster(uid: number): { player: PlayerId; zone: number; slot: MonsterSlot } | null;
  getEffectiveAtk(uid: number): number;
  getEffectiveDef(uid: number): number;
  cardDef(uid: number): CardDef | null;
}

export interface EffectContext {
  /** Read-only view of the state. Mutate only through ops. */
  state: Readonly<DuelState>;
  /** Controller of the source card. */
  player: PlayerId;
  opponent: PlayerId;
  source: CardInstance;
  sourceDef: CardDef;
  params: Record<string, number | string | boolean>;
  trigger: EffectTrigger;
  targetUid?: number;
  attack?: AttackInfo;
  summon?: SummonInfo;
  ops: EffectOps;
}

/** Context passed to statMod for every monster on the field. */
export interface StatModTarget {
  uid: number;
  controller: PlayerId;
  slot: MonsterSlot;
  def: CardDef;
}

export interface EffectHandler {
  /** Resolution when activated (spell from hand/Set, trap from Set). */
  onActivate?(ctx: EffectContext): void;
  /** Trap hook: opponent declared an attack. Use ctx.ops.negateAttack() to stop it. */
  onAttackDeclared?(ctx: EffectContext): void;
  /** Trap hook: opponent Normal Summoned a monster (ctx.summon). */
  onSummon?(ctx: EffectContext): void;
  /** Monster's own effect when it is summoned face-up (or flipped by changePosition). */
  onSelfSummon?(ctx: EffectContext): void;
  /**
   * Validation for every trigger (check ctx.trigger). Default: true.
   * For 'attackDeclared'/'summon' this is the trigger condition.
   */
  canActivate?(ctx: EffectContext): boolean;
  /** If defined, activation requires a targetUid chosen from this list. */
  getTargets?(ctx: EffectContext): number[];
  /**
   * Continuous stat modification applied by this card while it is face-up on the
   * field (equip / continuous / field spells). Called for every monster on the field.
   */
  statMod?(ctx: EffectContext, target: StatModTarget): { atk?: number; def?: number } | null;
  // TODO(arena): arenaSpellEffect metadata — how an arenaUsable spell behaves when
  // fired during an arena fight (e.g. { kind: 'aoe', power: 2 }). Owned by Arena Dev.
  arenaSpellEffect?: unknown;
}

const handlers = new Map<string, EffectHandler>();

export function registerEffect(id: string, handler: EffectHandler): void {
  handlers.set(id, handler);
}

export function getEffect(id: string | undefined): EffectHandler | undefined {
  return id ? handlers.get(id) : undefined;
}

export function hasEffect(id: string): boolean {
  return handlers.has(id);
}

export function allEffectIds(): string[] {
  return [...handlers.keys()];
}

// ---------------------------------------------------------------------------
// Helpers for handlers
// ---------------------------------------------------------------------------

export function num(ctx: EffectContext, key: string, fallback = 0): number {
  const v = ctx.params[key];
  return typeof v === 'number' ? v : fallback;
}

/** uids of monsters controlled by `player` (optionally only face-up / attack position). */
export function monsterUids(
  state: Readonly<DuelState>, player: PlayerId,
  filter?: (slot: MonsterSlot) => boolean,
): number[] {
  const out: number[] = [];
  for (const s of state.players[player].monsters) {
    if (s && (!filter || filter(s))) out.push(s.card.uid);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generic reference effects (wave 1). The Card Designer adds the rest.
// ---------------------------------------------------------------------------

/** 'draw' {n}: controller draws n cards. */
registerEffect('draw', {
  onActivate: (ctx) => ctx.ops.draw(ctx.player, num(ctx, 'n', 1)),
});

/** 'damage' {n}: inflict n damage to the opponent. */
registerEffect('damage', {
  onActivate: (ctx) => ctx.ops.damage(ctx.opponent, num(ctx, 'n', 500)),
});

/** 'heal' {n}: controller gains n LP. */
registerEffect('heal', {
  onActivate: (ctx) => ctx.ops.heal(ctx.player, num(ctx, 'n', 500)),
});

/** 'destroyAllOpponentMonsters' (Raigeki). */
registerEffect('destroyAllOpponentMonsters', {
  canActivate: (ctx) => monsterUids(ctx.state, ctx.opponent).length > 0,
  onActivate: (ctx) => {
    for (const uid of monsterUids(ctx.state, ctx.opponent)) ctx.ops.destroy(uid);
  },
});

/** 'destroyTargetMonster' {side?: 'opponent'|'any'} (Fissure-like, targeted). */
registerEffect('destroyTargetMonster', {
  getTargets: (ctx) => {
    const side = ctx.params.side === 'any' ? 'any' : 'opponent';
    const opp = monsterUids(ctx.state, ctx.opponent);
    return side === 'any' ? [...monsterUids(ctx.state, ctx.player), ...opp] : opp;
  },
  onActivate: (ctx) => {
    if (ctx.targetUid !== undefined) ctx.ops.destroy(ctx.targetUid);
  },
});

/**
 * 'equipAtk' {atk, def, types?}: equip spell; target any face-up monster
 * (optionally only of the comma-separated MonsterTypes in `types`).
 */
registerEffect('equipAtk', {
  getTargets: (ctx) => {
    const types = typeof ctx.params.types === 'string'
      ? ctx.params.types.split(',').map((t) => t.trim()).filter(Boolean) : null;
    const ok = (s: MonsterSlot) => {
      if (s.faceDown) return false;
      if (!types) return true;
      const d = ctx.ops.cardDef(s.card.uid);
      return !!d?.monsterType && types.includes(d.monsterType);
    };
    return [...monsterUids(ctx.state, ctx.player, ok), ...monsterUids(ctx.state, ctx.opponent, ok)];
  },
  statMod: (ctx, target) => {
    const own = findSpellTrapSlot(ctx.state, ctx.source.uid);
    if (!own || own.equippedTo !== target.uid) return null;
    return { atk: num(ctx, 'atk', 0), def: num(ctx, 'def', 0) };
  },
});

/** 'destroyAttacker' (Sakuretsu Armor-like trap): destroy the attacking monster. */
registerEffect('destroyAttacker', {
  canActivate: (ctx) => ctx.trigger === 'attackDeclared' && !!ctx.attack,
  onAttackDeclared: (ctx) => {
    if (!ctx.attack) return;
    ctx.ops.destroy(ctx.attack.attackerUid);
    ctx.ops.negateAttack();
  },
});

/** 'negateAttack' (Negate Attack-like trap): stop the attack. */
registerEffect('negateAttack', {
  canActivate: (ctx) => ctx.trigger === 'attackDeclared' && !!ctx.attack,
  onAttackDeclared: (ctx) => ctx.ops.negateAttack(),
});

/** 'destroyAttackPosition' (Mirror Force-like trap): destroy all opponent attack-position monsters. */
registerEffect('destroyAttackPosition', {
  canActivate: (ctx) => ctx.trigger === 'attackDeclared' && !!ctx.attack,
  onAttackDeclared: (ctx) => {
    for (const uid of monsterUids(ctx.state, ctx.opponent, (s) => s.position === 'attack')) {
      ctx.ops.destroy(uid);
    }
    ctx.ops.negateAttack();
  },
});

/** 'destroySummoned' {minAtk} (Trap Hole-like): destroy a monster the opponent summoned. */
registerEffect('destroySummoned', {
  canActivate: (ctx) =>
    ctx.trigger === 'summon' && !!ctx.summon && !ctx.summon.faceDown &&
    ctx.ops.getEffectiveAtk(ctx.summon.uid) >= num(ctx, 'minAtk', 1000),
  onSummon: (ctx) => {
    if (ctx.summon) ctx.ops.destroy(ctx.summon.uid);
  },
});

function findSpellTrapSlot(state: Readonly<DuelState>, uid: number) {
  for (const p of state.players) {
    for (const s of p.spellTraps) if (s && s.card.uid === uid) return s;
  }
  return null;
}
