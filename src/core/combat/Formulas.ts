// Combat & duel formulas for YugiConcept. PURE functions, no Phaser, no randomness.
// Every tunable number lives in TUNING so balance passes only touch one object.
// Design rationale: docs/GDD.md ("Arena rules", "Battle damage table").
// Balance model: tools/arena-model.ts (npx tsx tools/arena-model.ts).

import type {
  ArenaAbility,
  ArenaResult,
  ArenaStyle,
  CardDef,
  MonsterType,
  Position,
} from '../types';

export interface StyleProfile {
  /** Movement speed in arena px/s (arena is 480x270 base resolution). */
  speed: number;
  /** Basic-attack reach in px (melee contact ~ 28, projectile ~ 150). */
  range: number;
  /** Seconds between basic attacks. */
  attackInterval: number;
  /** Multiplier on max HP. */
  hpMult: number;
  /** Multiplier on Power (damage per basic hit). */
  powerMult: number;
}

export const TUNING = {
  // ---------------- Duel ----------------
  duel: {
    startingLp: 4000,
    deckSize: 30,
    openingHand: 5,
    handLimit: 6,
    monsterZones: 5,
    spellTrapZones: 5,
    /** Level thresholds for tributes: lvl >= key needs value tributes. */
    tributes: { level5: 1, level7: 2 },
    /** Player going first skips their first draw and cannot attack on turn 1. */
    firstPlayerSkipsDraw: true,
    firstTurnNoAttack: true,
  },

  // ---------------- Arena stats ----------------
  arena: {
    /**
     * Stats are scaled super-linearly so the damage race depends on the stat RATIO raised to
     * ~2*statExp (both HP and Power grow with ATK). This makes a -500 ATK gap decisive at every level
     * while keeping mirror-match durations roughly level-independent.
     *   S      = hpAtkWeight*ATK + hpDefWeight*DEF
     *   maxHp  = (hpBase + hpScale * (S/1000)^statExp) * style.hpMult
     *   power  = (powerBase + powerScale * (ATK/1000)^statExp) * style.powerMult
     */
    statExp: 1.4,
    hpBase: 50,
    hpScale: 480,
    hpAtkWeight: 0.7,
    hpDefWeight: 0.3,
    powerBase: 2,
    powerScale: 60,
    /** Resistance: dmg * resK / (resK + DEF). DEF 0 -> 100%, DEF 2000 -> 80%, DEF 4000 -> 67%. */
    resK: 8000,
    /** No single hit (basic or ability) may exceed this fraction of the target's max HP. Keeps stomps >= ~6 s. */
    maxHitFrac: 0.16,
    /** Minimum damage of any landed hit (keeps 0-ATK monsters able to chip). */
    minHit: 4,
    /** A Defense-Position defender fights with its DEF as its offensive stat (it is its battle stat). */
    defensePosUsesDefAsAtk: true,

    // timing
    introSec: 1.5,
    outroSec: 1.0,
    /** Soft target window for a fight. */
    targetMinSec: 8,
    targetMaxSec: 15,
    /** Sudden death begins here. */
    suddenDeathAtSec: 20,
    /** Absolute cap: if both still stand, higher HP fraction wins; exact tie = draw. */
    hardCapSec: 30,
    /** Sudden-death DPS as a fraction of max HP: base + ramp * secondsIntoSuddenDeath. */
    suddenDeathBaseFrac: 0.04,
    suddenDeathRampFrac: 0.04,
    /** Simultaneous KOs within this window count as a draw. */
    drawWindowSec: 0.1,
  },

  styles: {
    melee:   { speed: 95,  range: 30,  attackInterval: 0.9, hpMult: 1.0,  powerMult: 1.03 },
    ranged:  { speed: 80,  range: 150, attackInterval: 1.2, hpMult: 0.95, powerMult: 1.3 },
    bruiser: { speed: 65,  range: 36,  attackInterval: 1.4, hpMult: 1.15, powerMult: 1.3 },
    swift:   { speed: 130, range: 26,  attackInterval: 0.6, hpMult: 0.85, powerMult: 0.76 },
  } satisfies Record<ArenaStyle, StyleProfile>,

  // ---------------- Battle resolution ----------------
  battle: {
    /** Performance multiplier on LP damage = min + (max-min) * winnerHpFrac. */
    perfMin: 0.75,
    perfMax: 1.5,
    /** If the arena winner had the equal stat (gap 0), LP damage base is this. */
    minBattleDamage: 100,
    /** If the arena winner had the LOWER battle stat (an upset), base = |gap| * this (>= minBattleDamage). */
    upsetDamageFactor: 0.5,
    /** LP damage is rounded to this step. */
    roundTo: 10,
  },

  // ---------------- Abilities ----------------
  abilities: {
    /** Max total "ability value" (see abilityValue) per monster, by level bracket. */
    budgetByLevel: [
      { minLevel: 1, maxLevel: 4, budget: 0.30, minCooldown: 6 },
      { minLevel: 5, maxLevel: 6, budget: 0.38, minCooldown: 5 },
      { minLevel: 7, maxLevel: 8, budget: 0.45, minCooldown: 4 },
      { minLevel: 9, maxLevel: 12, budget: 0.50, minCooldown: 4 },
    ],
    /** Hard limits regardless of level. */
    maxPower: 3.0,
    maxStunSec: 1.0,
    maxShield: 0.6,
    maxHealFrac: 0.3,
    maxBuffMult: 1.5,
    /** A heal of 1.0 max HP is worth this many basic hits (for value accounting). */
    healHitEquivalent: 8,
    /** Arena spell (fired from hand, once per fight): one-shot value in basic hits. */
    spellHitEquivalent: 3,
    /** Spell burst damage multiplier (x user's Power) for damaging arena spells. */
    spellPower: 3.0,
  },

  // ---------------- NPC arena handicap ----------------
  ai: {
    easy:   { reactionMs: 450, aimErrorDeg: 20, abilityUseChance: 0.5, dodgeChance: 0.15, modelHitRate: 0.55 },
    normal: { reactionMs: 300, aimErrorDeg: 12, abilityUseChance: 0.75, dodgeChance: 0.3, modelHitRate: 0.68 },
    hard:   { reactionMs: 180, aimErrorDeg: 6,  abilityUseChance: 0.95, dodgeChance: 0.45, modelHitRate: 0.78 },
  },
  /** Abstract player hit rates used by tools/arena-model.ts. */
  playerModel: { novice: 0.6, average: 0.72, good: 0.82, expert: 0.88 },
} as const;

export type Difficulty = keyof typeof TUNING.ai;

// ---------------------------------------------------------------------------
// Style / type mapping
// ---------------------------------------------------------------------------

const TYPE_STYLE: Record<MonsterType, ArenaStyle> = {
  Spellcaster: 'ranged', Fairy: 'ranged', Thunder: 'ranged', Psychic: 'ranged', Pyro: 'ranged', Aqua: 'ranged',
  Warrior: 'melee', 'Beast-Warrior': 'melee', Fiend: 'melee', Zombie: 'melee',
  Dragon: 'bruiser', Machine: 'bruiser', Rock: 'bruiser', Dinosaur: 'bruiser', 'Sea Serpent': 'bruiser', Plant: 'bruiser',
  Beast: 'swift', 'Winged Beast': 'swift', Insect: 'swift', Reptile: 'swift', Fish: 'swift',
};

/** Default arena style for a monster type. CardDef.arenaStyle overrides it. */
export function styleForType(type: MonsterType): ArenaStyle {
  return TYPE_STYLE[type] ?? 'melee';
}

/** Resolved arena style of a card: explicit override, else from monsterType, else melee. */
export function styleForCard(card: CardDef): ArenaStyle {
  if (card.arenaStyle) return card.arenaStyle;
  if (card.monsterType) return styleForType(card.monsterType);
  return 'melee';
}

// ---------------------------------------------------------------------------
// Arena stats
// ---------------------------------------------------------------------------

export interface ArenaStats {
  maxHp: number;
  /** Damage per basic hit before the target's resistance. */
  power: number;
  /** px/s */
  speed: number;
  /** px */
  range: number;
  /** seconds between basic attacks */
  attackInterval: number;
  style: ArenaStyle;
  /** The DEF used for resistance when this monster is hit. */
  def: number;
}

/**
 * Arena stats for a monster with its CURRENT (modified) atk/def.
 * If `position` is 'defense' (a Defense-Position defender), the DEF is its battle stat and
 * is used as the offensive stat too (TUNING.arena.defensePosUsesDefAsAtk), mirroring YGO's ATK-vs-DEF check.
 */
export function arenaStats(card: CardDef, atk: number, def: number, position: Position = 'attack'): ArenaStats {
  const a = TUNING.arena;
  const style = styleForCard(card);
  const s = TUNING.styles[style];
  const A = Math.max(0, position === 'defense' && a.defensePosUsesDefAsAtk ? def : atk);
  const D = Math.max(0, def);
  const S = a.hpAtkWeight * A + a.hpDefWeight * D;
  return {
    maxHp: Math.round((a.hpBase + a.hpScale * Math.pow(S / 1000, a.statExp)) * s.hpMult),
    power: (a.powerBase + a.powerScale * Math.pow(A / 1000, a.statExp)) * s.powerMult,
    speed: s.speed,
    range: s.range,
    attackInterval: s.attackInterval,
    style,
    def: D,
  };
}

/** Raw damage reduced by the defender's DEF: raw * resK / (resK + DEF). */
export function damageAfterResistance(raw: number, defenderDef: number): number {
  const k = TUNING.arena.resK;
  return (Math.max(0, raw) * k) / (k + Math.max(0, defenderDef));
}

/**
 * Final damage of one landed hit: power * multiplier, minus resistance, floored at minHit,
 * capped at maxHitFrac of the target's max HP. Use for basic attacks, abilities and spells.
 */
export function hitDamage(attackerPower: number, multiplier: number, target: { maxHp: number; def: number }): number {
  const a = TUNING.arena;
  const d = damageAfterResistance(attackerPower * multiplier, target.def);
  return Math.min(Math.max(d, a.minHit), target.maxHp * a.maxHitFrac * Math.max(1, multiplier));
}

/**
 * Sudden-death damage per second as a FRACTION of max HP, applied to both fighters.
 * 0 before TUNING.arena.suddenDeathAtSec; then base + ramp * (t - start).
 */
export function suddenDeathDps(tSec: number): number {
  const a = TUNING.arena;
  if (tSec < a.suddenDeathAtSec) return 0;
  return a.suddenDeathBaseFrac + a.suddenDeathRampFrac * (tSec - a.suddenDeathAtSec);
}

// ---------------------------------------------------------------------------
// Battle resolution (arena -> duel)
// ---------------------------------------------------------------------------

/** LP-damage multiplier from the winner's remaining HP fraction (0..1) -> 0.75..1.5, linear. */
export function performanceMultiplier(winnerHpFrac: number): number {
  const b = TUNING.battle;
  const f = Math.min(1, Math.max(0, Number.isFinite(winnerHpFrac) ? winnerHpFrac : 0));
  return b.perfMin + (b.perfMax - b.perfMin) * f;
}

export interface BattleOutcome {
  attackerDestroyed: boolean;
  defenderDestroyed: boolean;
  /** [damage to the attacking player, damage to the defending player], both >= 0. */
  lpDamage: [number, number];
}

function roundLp(x: number): number {
  const r = TUNING.battle.roundTo;
  return Math.max(0, Math.round(x / r) * r);
}

/**
 * Base LP damage before the performance multiplier.
 * winnerStat/loserStat are the YGO battle stats (attacker ATK vs defender ATK or DEF).
 */
export function baseBattleDamage(winnerStat: number, loserStat: number): number {
  const b = TUNING.battle;
  const gap = winnerStat - loserStat;
  if (gap > 0) return gap;
  if (gap === 0) return b.minBattleDamage;
  return Math.max(b.minBattleDamage, -gap * b.upsetDamageFactor);
}

/**
 * Map an arena result back to the duel. Cases (see GDD "Battle damage table"):
 *  - Attack Position defender: loser destroyed; loser's controller takes base * perf(winner HP).
 *  - Defense Position defender: loser destroyed; the defender's controller NEVER takes damage;
 *    if the attacker loses, the attacker's controller takes base * perf(defender HP).
 *  - Draw, Attack Position: both destroyed, no damage (YGO equal-ATK rule).
 *  - Draw, Defense Position: neither destroyed, no damage (YGO ATK == DEF rule).
 * Direct attacks never reach this function (they skip the arena).
 */
export function resolveBattle(
  attackerAtk: number,
  defender: { atk: number; def: number; position: Position },
  arena: ArenaResult,
): BattleOutcome {
  const defStat = defender.position === 'attack' ? defender.atk : defender.def;
  if (arena.winner === 'draw') {
    const both = defender.position === 'attack';
    return { attackerDestroyed: both, defenderDestroyed: both, lpDamage: [0, 0] };
  }
  if (arena.winner === 'attacker') {
    const dmg = defender.position === 'attack'
      ? roundLp(baseBattleDamage(attackerAtk, defStat) * performanceMultiplier(arena.attackerHpFrac))
      : 0;
    return { attackerDestroyed: false, defenderDestroyed: true, lpDamage: [0, dmg] };
  }
  const dmg = roundLp(baseBattleDamage(defStat, attackerAtk) * performanceMultiplier(arena.defenderHpFrac));
  return { attackerDestroyed: true, defenderDestroyed: false, lpDamage: [dmg, 0] };
}

/** Direct attack: full ATK to the defending player, no arena, no multiplier. */
export function directAttackDamage(attackerAtk: number): number {
  return Math.max(0, attackerAtk);
}

// ---------------------------------------------------------------------------
// Tribute rules
// ---------------------------------------------------------------------------

/** Tributes needed to Normal Summon/Set a monster of this level. */
export function tributesRequired(level: number): number {
  if (level >= 7) return TUNING.duel.tributes.level7;
  if (level >= 5) return TUNING.duel.tributes.level5;
  return 0;
}

// ---------------------------------------------------------------------------
// Ability budgets
// ---------------------------------------------------------------------------

/**
 * Value of an ability in "basic hits per second" equivalents. Used to keep card designers
 * inside the per-level budget (abilityBudget). Roughly: how much extra damage-race advantage
 * the ability gives per second, measured in base-Power hits.
 */
export function abilityValue(ab: ArenaAbility, style: ArenaStyle = 'melee'): number {
  const t = TUNING.abilities;
  const cd = Math.max(0.5, ab.cooldown);
  const interval = TUNING.styles[style].attackInterval;
  const dur = ab.duration ?? 0;
  const mag = ab.magnitude ?? 0;
  switch (ab.kind) {
    case 'projectile':
    case 'dash':
      return ab.power / cd;
    case 'aoe':
      return (ab.power * 1.1) / cd; // harder to dodge
    case 'stun':
      // the damage plus enemy hits denied during the stun
      return (ab.power + dur / interval) / cd;
    case 'shield':
      // incoming hits negated over the duration (assume enemy ~1 hit/s)
      return (mag * dur) / cd;
    case 'heal':
      return (mag * t.healHitEquivalent) / cd;
    case 'buff':
      // extra fraction of basic hits over the duration
      return (Math.max(0, mag - 1) * (dur / interval)) / cd;
    default:
      return 0;
  }
}

/** Ability budget and minimum cooldown for a monster level. */
export function abilityBudget(level: number): { budget: number; minCooldown: number } {
  const rows = TUNING.abilities.budgetByLevel;
  const row = rows.find(r => level >= r.minLevel && level <= r.maxLevel) ?? (level < 1 ? rows[0] : rows[rows.length - 1]);
  return { budget: row.budget, minCooldown: row.minCooldown };
}

/** Validation helper for card data: returns a list of human-readable problems (empty = OK). */
export function validateAbilities(card: CardDef): string[] {
  const problems: string[] = [];
  const abs = card.arenaAbilities ?? [];
  if (card.kind !== 'monster') return problems;
  if (abs.length > 2) problems.push(`${card.id}: more than 2 arena abilities`);
  const { budget, minCooldown } = abilityBudget(card.level ?? 4);
  const t = TUNING.abilities;
  const style = styleForCard(card);
  let total = 0;
  for (const ab of abs) {
    total += abilityValue(ab, style);
    if (ab.cooldown < minCooldown) problems.push(`${card.id}/${ab.id}: cooldown ${ab.cooldown}s < ${minCooldown}s`);
    if (ab.power > t.maxPower) problems.push(`${card.id}/${ab.id}: power ${ab.power} > ${t.maxPower}`);
    if (ab.kind === 'stun' && (ab.duration ?? 0) > t.maxStunSec) problems.push(`${card.id}/${ab.id}: stun too long`);
    if (ab.kind === 'shield' && (ab.magnitude ?? 0) > t.maxShield) problems.push(`${card.id}/${ab.id}: shield too strong`);
    if (ab.kind === 'heal' && (ab.magnitude ?? 0) > t.maxHealFrac) problems.push(`${card.id}/${ab.id}: heal too strong`);
    if (ab.kind === 'buff' && (ab.magnitude ?? 1) > t.maxBuffMult) problems.push(`${card.id}/${ab.id}: buff too strong`);
  }
  if (total > budget + 1e-9) problems.push(`${card.id}: ability value ${total.toFixed(2)} > budget ${budget}`);
  return problems;
}

/** Signature move every monster gets when it has no arenaAbilities (Normal monsters, or data missing). */
export function defaultAbilityForStyle(style: ArenaStyle): ArenaAbility {
  switch (style) {
    case 'ranged':
      return { id: 'default-ranged', name: 'Arcane Bolt', kind: 'projectile', power: 1.8, cooldown: 7, description: 'A heavy bolt.' };
    case 'bruiser':
      return { id: 'default-bruiser', name: 'Quake Slam', kind: 'aoe', power: 1.6, cooldown: 7, description: 'Slam the ground around you.' };
    case 'swift':
      return { id: 'default-swift', name: 'Pounce', kind: 'dash', power: 1.5, cooldown: 6, description: 'Lunge at the enemy.' };
    case 'melee':
    default:
      return { id: 'default-melee', name: 'Power Strike', kind: 'dash', power: 1.8, cooldown: 7, description: 'A charging strike.' };
  }
}
