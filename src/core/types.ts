// Shared contract between all game modules. core/ is pure TypeScript (no Phaser).
// Change this file only with care: every subsystem depends on it.

export type Attribute = 'DARK' | 'LIGHT' | 'EARTH' | 'WATER' | 'FIRE' | 'WIND' | 'DIVINE';

export type MonsterType =
  | 'Spellcaster' | 'Dragon' | 'Warrior' | 'Beast' | 'Beast-Warrior' | 'Fiend' | 'Zombie'
  | 'Machine' | 'Aqua' | 'Pyro' | 'Rock' | 'Winged Beast' | 'Plant' | 'Insect' | 'Thunder'
  | 'Fairy' | 'Fish' | 'Sea Serpent' | 'Reptile' | 'Dinosaur' | 'Psychic';

export type CardKind = 'monster' | 'spell' | 'trap';
export type SpellSpeed = 'normal' | 'quick' | 'continuous' | 'equip' | 'field';

/** Archetype of movement/attack in the arena; derived from MonsterType unless overridden. */
export type ArenaStyle = 'melee' | 'ranged' | 'bruiser' | 'swift';

export type ArenaAbilityKind =
  | 'projectile'   // fires a bolt toward the enemy
  | 'dash'         // fast lunge that damages on contact
  | 'aoe'          // burst around self
  | 'shield'       // temporary damage reduction
  | 'heal'         // restore HP
  | 'buff'         // temporary power/speed up
  | 'stun';        // short stun on hit

export interface ArenaAbility {
  id: string;
  name: string;
  kind: ArenaAbilityKind;
  /** Damage multiplier relative to the monster's base Power (for damaging kinds). */
  power: number;
  /** Seconds. */
  cooldown: number;
  /** Seconds, for shield/buff/stun. */
  duration?: number;
  /** Generic magnitude: shield reduction (0..1), heal fraction of max HP, buff multiplier. */
  magnitude?: number;
  description: string;
}

/** Duel-side effect hook ids implemented in core/cards/EffectRegistry.ts */
export interface CardEffectRef {
  id: string;
  params?: Record<string, number | string | boolean>;
}

export interface CardDef {
  id: string;            // stable slug e.g. "dark-magician"
  name: string;
  kind: CardKind;
  text: string;          // short rules text shown on the card
  // monsters
  attribute?: Attribute;
  monsterType?: MonsterType;
  level?: number;
  atk?: number;
  def?: number;
  isEffect?: boolean;
  arenaStyle?: ArenaStyle;
  arenaAbilities?: ArenaAbility[];
  // spells/traps
  speed?: SpellSpeed;
  effect?: CardEffectRef;
  /** If true, this spell can be fired from hand during an arena fight (once per fight). */
  arenaUsable?: boolean;
  // visual
  palette?: string[];    // 3-5 hex colors used by the procedural sprite generator
  rarity?: 'common' | 'rare' | 'super' | 'ultra';
}

export type PlayerId = 0 | 1; // 0 = human, 1 = NPC
export type Position = 'attack' | 'defense';
export type Phase = 'draw' | 'main' | 'battle' | 'end';

export interface CardInstance {
  uid: number;
  defId: string;
  owner: PlayerId;
}

export interface MonsterSlot {
  card: CardInstance;
  position: Position;
  faceDown: boolean;
  summonedThisTurn: boolean;
  attackedThisTurn: boolean;
  changedPositionThisTurn: boolean;
  atkMod: number;
  defMod: number;
}

export interface SpellTrapSlot {
  card: CardInstance;
  faceDown: boolean;
  setThisTurn: boolean;
  equippedTo?: number; // uid of monster
}

export interface PlayerState {
  id: PlayerId;
  lp: number;
  deck: CardInstance[];
  hand: CardInstance[];
  graveyard: CardInstance[];
  monsters: (MonsterSlot | null)[];   // 5 zones
  spellTraps: (SpellTrapSlot | null)[]; // 5 zones
  normalSummonUsed: boolean;
}

export interface DuelState {
  seed: number;
  turn: number;            // 1-based
  activePlayer: PlayerId;
  phase: Phase;
  players: [PlayerState, PlayerState];
  winner: PlayerId | null | 'draw';
  log: string[];
  nextUid: number;
}

/** Actions a player (human UI or AI) can submit to the duel engine. */
export type DuelAction =
  | { type: 'normalSummon'; handUid: number; position: Position; faceDown: boolean; tributeUids: number[] }
  | { type: 'activateSpell'; handUid: number; targetUid?: number }
  | { type: 'setSpellTrap'; handUid: number }
  | { type: 'activateSet'; uid: number; targetUid?: number }
  | { type: 'changePosition'; uid: number }
  | { type: 'enterBattle' }
  | { type: 'declareAttack'; attackerUid: number; targetUid: number | null } // null = direct
  | { type: 'endTurn' };

/** Request emitted by the duel engine when an attack must be resolved in the arena. */
export interface ArenaRequest {
  attacker: { player: PlayerId; uid: number; def: CardDef; atk: number; defStat: number };
  defender: { player: PlayerId; uid: number; def: CardDef; atk: number; defStat: number; position: Position };
  /** Spells in the attacking/defending players' hands that are arenaUsable. */
  usableSpells: [CardInstance[], CardInstance[]];
  seed: number;
}

export interface ArenaResult {
  /** Which side won the fight; 'draw' if both KO'd / timeout tie. */
  winner: 'attacker' | 'defender' | 'draw';
  attackerHpFrac: number; // 0..1 remaining
  defenderHpFrac: number;
  durationSec: number;
  /** uids of spell cards consumed during the arena, per player. */
  spellsUsed: [number[], number[]];
}

export type DuelEvent =
  | { type: 'log'; text: string }
  | { type: 'draw'; player: PlayerId; uid: number }
  | { type: 'summon'; player: PlayerId; uid: number }
  | { type: 'destroy'; player: PlayerId; uid: number }
  | { type: 'lp'; player: PlayerId; delta: number; lp: number }
  | { type: 'phase'; phase: Phase; player: PlayerId }
  | { type: 'arena'; request: ArenaRequest }
  | { type: 'gameOver'; winner: PlayerId | 'draw' };
