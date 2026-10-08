// NPC duel brain: heuristic board evaluation + shallow (one-ply) search. Pure TS, no Phaser.
//
//   chooseAction(engine, player, difficulty)  -> next DuelAction (call repeatedly until it returns endTurn)
//   chooseTrapActivation(engine, prompt, d)   -> engine `trapPolicy` hook for the AI's own Set traps
//   makeTrapPolicy(getEngine, aiPlayer, d)    -> ready-made trapPolicy (AI decides its traps, others always fire)
//   chooseDiscard(engine, player, count?)     -> uids to discard down to the hand limit
//
// How it decides
//  * Every candidate action is applied to a SANDBOX copy of the engine (DuelEngine restored from the
//    current state with traps disabled, so the AI never peeks at the opponent's face-down traps), and
//    the resulting position is scored by `evaluate()`.
//  * Attacks pause the sandbox at `pendingArena`; instead of running the real-time arena we fork the
//    sandbox into "attacker wins" / "defender wins" and weight them by P(win) = logistic(statGap / 140),
//    a fit of the GDD 6.1 model table (equal stats 50%, -200 ~ 12-30%, -500 ~ 1-11%).
//  * evaluate(): LP (low LP weighs more), monster values (super-linear in ATK so tribute summons pay
//    off), card advantage (hand + set cards), threats (my monsters the opponent's best attacker can
//    kill next turn, open-board exposure) and, on my own turn, the "attack opportunity" still on the
//    table (greedy attacker->target assignment, direct damage once blockers are gone, lethal bonus).
//
// Difficulty
//  * easy:   no look-ahead terms (no threats/opportunity), naive attacks (ATK > visible stat),
//            ~35% of decisions pick a random non-catastrophic candidate instead of the best.
//  * normal: greedy one-ply over all candidates with the full evaluation.
//  * hard:   normal + expectimax attack-sequence search (ordering, lethal lines, bait attacks into
//            possible face-down traps) + trap-aware activation timing (holds Mirror Force for 2+ attackers).
//
// Safety: every returned action is checked against engine.legalActions(player); any internal error
// falls back to a legal endTurn. Clone count per decision is capped (AI_TUNING.maxClones).
import type {
  ArenaResult, CardDef, DuelAction, DuelState, MonsterSlot, PlayerId, Position,
} from '../types';
import { DuelEngine, type TrapPrompt } from '../duel/DuelEngine';
import { getCard } from '../cards/CardDB';
import { getEffect } from '../cards/EffectRegistry';
import { baseBattleDamage, performanceMultiplier, TUNING } from '../combat/Formulas';
import { Rng } from '../rng';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

/** Every AI knob in one place (tuned with tests/ai.test.ts self-play). */
export const AI_TUNING = {
  /** P(attacker wins arena) = 1 / (1 + exp(-gap / k)). Fit to GDD 6.1 (equal-skill column). */
  arenaLogisticK: 140,
  /** Assumed stats of an opponent's face-down monster (hidden information). */
  faceDownGuess: { atk: 1200, def: 1500 },
  /** Value of a card in hand / a Set spell-trap, in LP-equivalents. */
  handCard: 350,
  mySetCard: 380,
  oppSetCard: { easy: 300, normal: 320, hard: 450 } as Record<AIDifficulty, number>,
  /** Face-up persistent spell/trap (Swords, field spells...) not otherwise captured by stats. */
  faceUpPersistent: 200,
  /** Weight of the not-yet-realised attack opportunity during my main / battle phase. */
  opportunityMain: 0.8,
  opportunityBattle: 0.9,
  lethalBonus: 3000,
  /** Opponent's possible fresh summon next turn (if they hold cards): assumed ATK and probability weight. */
  virtualAttacker: { atk: 1600, weight: 0.5 },
  /** Minimum gain over "go to battle / end turn" for a main-phase action to be worth doing. */
  minGain: 25,
  /** Heal spells are held (kept for the arena) while LP is above this. */
  healBelowLp: 2000,
  /** Sandbox clones per decision (each ~50us desktop, ~0.3-0.5ms phone): keeps a decision < ~3ms desktop. */
  maxClones: 32,
  /** Safety valve: after this many actions in one turn the AI just ends the turn. */
  maxActionsPerTurn: 40,
  easyRandomChance: 0.35,
  /** Easy's random pick ignores candidates worse than best - this. */
  easyRandomWindow: 1500,
  /** Hard: expectimax node budget for the attack-sequence search. */
  searchNodeBudget: 4000,
  /** Hard: per-attack risk that a face-down card stops/punishes it (per opponent set card, capped). */
  trapRiskPerSetCard: 0.1,
  trapRiskCap: 0.3,
} as const;

const WIN = 1e6;
const NO_TRAPS = (): boolean => false;
const EXPECTED_PERF = performanceMultiplier(0.5);
/** Direct attacks deal ATK x this (TUNING.battle.directAttackMult, Mechanics wave 3). */
const DIRECT_MULT = TUNING.battle.directAttackMult;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ChooseOptions {
  /** RNG for easy-mode randomness. Default: derived deterministically from the duel state. */
  rng?: Rng;
}

/**
 * Pick the next action for `player`. Call repeatedly until it returns `endTurn`.
 * If `player` has no legal action right now (not their turn, arena pending, duel over) this returns
 * `{ type: 'endTurn' }`, which the caller must not apply.
 */
export function chooseAction(
  engine: DuelEngine, player: PlayerId, difficulty: AIDifficulty = 'normal', opts: ChooseOptions = {},
): DuelAction {
  let legal: DuelAction[] = [];
  try {
    legal = engine.legalActions(player);
  } catch {
    return { type: 'endTurn' };
  }
  if (legal.length === 0) return { type: 'endTurn' };
  try {
    if (bumpActionCount(engine) > AI_TUNING.maxActionsPerTurn) return endTurnAction(engine, player, legal);
    const brain = new Brain(engine, player, difficulty, legal, opts.rng ?? stateRng(engine.state, player));
    const a = brain.decide();
    return ensureLegal(a, legal, engine, player);
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[DuelAI] decision failed, ending turn', err);
    return endTurnAction(engine, player, legal);
  }
}

/**
 * Trap policy for the AI's own Set traps (DuelEngineOptions.trapPolicy). Returns true to activate.
 * Called synchronously by the engine at the trap's trigger (attack declaration / opponent summon).
 */
export function chooseTrapActivation(engine: DuelEngine, prompt: TrapPrompt, difficulty: AIDifficulty = 'normal'): boolean {
  try {
    return trapDecision(engine, prompt, difficulty);
  } catch {
    return true;
  }
}

/**
 * Convenience: a full `trapPolicy` for an engine where `aiPlayer` is the NPC. The other player's
 * traps always activate (the UI may replace that with a prompt). `getEngine` is lazy because the
 * policy has to be passed to the engine's constructor.
 */
export function makeTrapPolicy(
  getEngine: () => DuelEngine | undefined, aiPlayer: PlayerId, difficulty: AIDifficulty = 'normal',
): (prompt: TrapPrompt) => boolean {
  return (prompt) => {
    if (prompt.player !== aiPlayer) return true;
    const e = getEngine();
    return e ? chooseTrapActivation(e, prompt, difficulty) : true;
  };
}

/** Cards `player` should discard at End Phase (lowest value first). `count` defaults to the excess over the hand limit. */
export function chooseDiscard(engine: DuelEngine, player: PlayerId, count?: number): number[] {
  const hand = engine.state.players[player].hand;
  const n = Math.max(0, Math.min(hand.length, count ?? hand.length - TUNING.duel.handLimit));
  if (n === 0) return [];
  return hand
    .map((c) => ({ uid: c.uid, v: safe(() => handCardValue(engine, player, getCard(c.defId)), 0) }))
    .sort((a, b) => a.v - b.v || a.uid - b.uid)
    .slice(0, n)
    .map((x) => x.uid);
}

/** P(attacker wins the arena) from the battle-stat gap (attacker ATK - defender battle stat). */
export function arenaWinProbability(gap: number): number {
  return 1 / (1 + Math.exp(-gap / AI_TUNING.arenaLogisticK));
}

// ---------------------------------------------------------------------------
// Decision core
// ---------------------------------------------------------------------------

interface Scored { action: DuelAction; score: number }

class Brain {
  private clonesLeft: number = AI_TUNING.maxClones;
  private readonly opp: PlayerId;

  constructor(
    private readonly engine: DuelEngine,
    private readonly me: PlayerId,
    private readonly diff: AIDifficulty,
    private readonly legal: DuelAction[],
    private readonly rng: Rng,
  ) {
    this.opp = me === 0 ? 1 : 0;
  }

  decide(): DuelAction {
    const lethal = this.openBoardLethal();
    if (lethal) return lethal;
    const phase = this.engine.state.phase;
    if (phase === 'battle') return this.decideBattle();
    return this.decideMain();
  }

  /** Every difficulty takes an obvious open-board lethal (sum of ready attackers >= opponent LP). */
  private openBoardLethal(): DuelAction | null {
    const s = this.engine.state;
    if (s.players[this.opp].monsters.some(Boolean)) return null;
    const ready = s.players[this.me].monsters.filter((m): m is MonsterSlot =>
      !!m && m.position === 'attack' && !m.faceDown && !m.attackedThisTurn);
    const total = ready.reduce((sum, m) => sum + this.engine.getEffectiveAtk(m.card.uid), 0) * DIRECT_MULT;
    if (total < s.players[this.opp].lp) return null;
    if (s.phase === 'main') return this.legal.find((a) => a.type === 'enterBattle') ?? null;
    const direct = this.legal
      .filter((a): a is Extract<DuelAction, { type: 'declareAttack' }> => a.type === 'declareAttack' && a.targetUid === null)
      .sort((a, b) => this.engine.getEffectiveAtk(b.attackerUid) - this.engine.getEffectiveAtk(a.attackerUid));
    return direct[0] ?? null;
  }

  // ---- main phase ---------------------------------------------------------

  private decideMain(): DuelAction {
    const e = this.engine;
    const endScore = evaluate(e, this.me, this.diff, true);
    const canBattle = this.legal.some((a) => a.type === 'enterBattle');
    const battleScore = canBattle ? evaluate(e, this.me, this.diff, false) : -Infinity;
    const baseline = Math.max(endScore, battleScore);

    const scored: Scored[] = [];
    for (const a of this.mainCandidates()) {
      const sc = this.scoreBySandbox(a);
      if (sc === null) continue;
      scored.push({ action: a, score: sc + this.ruleAdjust(a) });
    }
    scored.sort((x, y) => y.score - x.score);

    const hasAttacker = e.state.players[this.me].monsters.some((m) => m && m.position === 'attack' && !m.faceDown);
    const wantsBattle = this.diff === 'easy' ? hasAttacker : battleScore > endScore + 1;
    const pass: DuelAction = wantsBattle && canBattle
      ? { type: 'enterBattle' }
      : endTurnAction(e, this.me, this.legal);

    if (this.diff === 'easy' && scored.length && this.rng.next() < AI_TUNING.easyRandomChance) {
      const pool = scored.filter((s) => s.score >= scored[0].score - AI_TUNING.easyRandomWindow);
      if (pool.length) return this.rng.pick(pool).action;
    }
    if (scored.length && scored[0].score > baseline + AI_TUNING.minGain) return scored[0].action;
    return pass;
  }

  /** Main-phase candidates, pruned: one tribute set per summon (the cheapest), traps only are Set. */
  private mainCandidates(): DuelAction[] {
    const e = this.engine;
    const out: DuelAction[] = [];
    const bestSummon = new Map<string, { a: DuelAction; cost: number }>();
    for (const a of this.legal) {
      switch (a.type) {
        case 'enterBattle': case 'endTurn': case 'declareAttack':
          break;
        case 'normalSummon': {
          const key = `${a.handUid}:${a.faceDown ? 'set' : 'atk'}`;
          const cost = a.tributeUids.reduce((s, u) => s + this.ownMonsterValue(u), 0);
          const prev = bestSummon.get(key);
          if (!prev || cost < prev.cost) bestSummon.set(key, { a, cost });
          break;
        }
        case 'setSpellTrap': {
          const def = safeDef(e, a.handUid);
          // Traps are Set; spells stay in hand (activate later, or fire them in the arena).
          if (def && def.kind === 'trap') out.push(a);
          break;
        }
        default:
          out.push(a); // activateSpell / activateSet / changePosition / activateMonster / unknown types
      }
    }
    // Summons first (most impactful), then everything else, capped by the clone budget.
    return [...[...bestSummon.values()].map((x) => x.a), ...out];
  }

  /** Rule-based nudges the evaluation can't see. */
  private ruleAdjust(a: DuelAction): number {
    if (a.type !== 'activateSpell' && a.type !== 'activateSet') return 0;
    const def = a.type === 'activateSpell' ? safeDef(this.engine, a.handUid) : safeDef(this.engine, a.uid);
    if (!def) return 0;
    const id = def.effect?.id ?? '';
    // Heal only when low: otherwise keep it (it doubles as an arena heal).
    if (/heal|cure/i.test(id) && this.engine.state.players[this.me].lp > AI_TUNING.healBelowLp) return -5000;
    // Attack locks (Swords of Revealing Light): the evaluation can't see them, so value the
    // opponent's attack pressure they shut off.
    const h = safe(() => getEffect(id), undefined);
    if (h?.canAttack && def.kind === 'spell') {
      const s = this.engine.state;
      const O = s.players[this.opp];
      let pressure = O.hand.length > 0 ? AI_TUNING.virtualAttacker.atk * AI_TUNING.virtualAttacker.weight : 0;
      for (const m of O.monsters) if (m) pressure += seenMonster(this.engine, m.card.uid, this.me)?.atk ?? 0;
      return 0.7 * Math.min(pressure, s.players[this.me].lp) + 150;
    }
    return 0;
  }

  // ---- battle phase -------------------------------------------------------

  private decideBattle(): DuelAction {
    const e = this.engine;
    const endScore = evaluate(e, this.me, this.diff, true);
    const attacks = this.legal.filter((a): a is Extract<DuelAction, { type: 'declareAttack' }> => a.type === 'declareAttack');
    const others = this.legal.filter((a) => a.type !== 'declareAttack' && a.type !== 'endTurn' && a.type !== 'enterBattle');
    const end = endTurnAction(e, this.me, this.legal);

    // Quick spells / set cards / unknown actions in the battle phase: one-ply.
    const curScore = evaluate(e, this.me, this.diff, false);
    let bestOther: Scored | null = null;
    if (this.diff !== 'easy') {
      for (const a of others) {
        const sc = this.scoreBySandbox(a);
        if (sc === null) continue;
        const s = sc + this.ruleAdjust(a);
        if (!bestOther || s > bestOther.score) bestOther = { action: a, score: s };
      }
      if (bestOther && bestOther.score > Math.max(curScore, endScore) + AI_TUNING.minGain && attacks.length) {
        return bestOther.action;
      }
    }
    if (attacks.length === 0) return end;

    if (this.diff === 'easy') return this.easyAttack(attacks) ?? end;
    if (this.diff === 'hard') {
      const plan = this.searchAttacks(attacks);
      if (plan) return plan;
      return end;
    }
    // normal: greedy one-ply via sandbox + expected arena outcome.
    let best: Scored | null = null;
    for (const a of this.prioritizeAttacks(attacks)) {
      const sc = this.scoreAttack(a);
      if (sc === null) continue;
      if (!best || sc > best.score) best = { action: a, score: sc };
    }
    if (best && best.score > endScore + 1) return best.action;
    return end;
  }

  /** Easy: attack anything whose visible stat is lower than the attacker's ATK; else maybe a random swing. */
  private easyAttack(attacks: Extract<DuelAction, { type: 'declareAttack' }>[]): DuelAction | null {
    const e = this.engine;
    const good = attacks.filter((a) => {
      if (a.targetUid === null) return true;
      const t = seenMonster(e, a.targetUid, this.me);
      return !!t && e.getEffectiveAtk(a.attackerUid) > t.stat;
    });
    if (this.rng.next() < AI_TUNING.easyRandomChance * 0.5) return this.rng.pick(attacks);
    if (good.length === 0) return null;
    const direct = good.find((a) => a.targetUid === null);
    return direct ?? this.rng.pick(good);
  }

  /** Order attacks so the clone budget is spent on the plausible ones first. */
  private prioritizeAttacks(attacks: Extract<DuelAction, { type: 'declareAttack' }>[]) {
    const e = this.engine;
    const ev = (a: Extract<DuelAction, { type: 'declareAttack' }>) => {
      const atk = e.getEffectiveAtk(a.attackerUid);
      if (a.targetUid === null) return atk;
      const t = seenMonster(e, a.targetUid, this.me);
      if (!t) return -Infinity;
      return attackEV(atk, this.ownMonsterValue(a.attackerUid), t);
    };
    return attacks.map((a) => ({ a, v: ev(a) })).sort((x, y) => y.v - x.v).map((x) => x.a);
  }

  /** Expected score of an attack: sandbox it, fork the arena into win/lose and weight by P(win). */
  private scoreAttack(a: Extract<DuelAction, { type: 'declareAttack' }>): number | null {
    const e = this.engine;
    const atk = e.getEffectiveAtk(a.attackerUid);
    const target = a.targetUid === null ? null : seenMonster(e, a.targetUid, this.me);
    const sb = this.sandbox(e);
    if (!sb) return null;
    try {
      sb.apply(a);
    } catch {
      return null;
    }
    if (!sb.pendingArena) return evaluate(sb, this.me, this.diff, false);
    const p = target ? arenaWinProbability(atk - target.stat) : 0.5;
    const lose = sb;
    const win = this.forkClone(sb);
    if (!win) return null;
    try {
      win.resolveArena(arenaResult('attacker'));
      lose.resolveArena(arenaResult('defender'));
    } catch {
      return null;
    }
    return p * evaluate(win, this.me, this.diff, false) + (1 - p) * evaluate(lose, this.me, this.diff, false);
  }

  // ---- hard: attack-sequence expectimax -------------------------------------

  private searchAttacks(attacks: Extract<DuelAction, { type: 'declareAttack' }>[]): DuelAction | null {
    const e = this.engine;
    const s = e.state;
    const attackerUids = [...new Set(attacks.map((a) => a.attackerUid))];
    const A: SAttacker[] = attackerUids.map((uid) => ({ uid, atk: e.getEffectiveAtk(uid), mv: this.ownMonsterValue(uid) }));
    const T: STarget[] = [];
    for (const slot of s.players[this.opp].monsters) {
      if (!slot) continue;
      const t = seenMonster(e, slot.card.uid, this.me);
      if (t) T.push(t);
    }
    const setCount = s.players[this.opp].spellTraps.filter((x) => x && x.faceDown).length;
    const risk = Math.min(AI_TUNING.trapRiskCap, setCount * AI_TUNING.trapRiskPerSetCard);
    const search = new AttackSearch(risk, AI_TUNING.searchNodeBudget);
    const res = search.best(A, T, s.players[this.opp].lp, s.players[this.me].lp, 0);
    if (!res.move || res.value <= 1) return null;
    const { attackerUid, targetUid } = res.move;
    const found = attacks.find((a) => a.attackerUid === attackerUid && a.targetUid === targetUid);
    return found ?? null;
  }

  // ---- helpers --------------------------------------------------------------

  private scoreBySandbox(a: DuelAction): number | null {
    const sb = this.sandbox(this.engine);
    if (!sb) return null;
    try {
      sb.apply(a);
    } catch {
      return null; // engine rejected it (should not happen for legal actions) -> skip
    }
    if (sb.pendingArena) {
      // Unknown action that started a fight: assume a coin flip.
      const w = this.forkClone(sb);
      if (!w) return null;
      try {
        w.resolveArena(arenaResult('attacker'));
        sb.resolveArena(arenaResult('defender'));
      } catch {
        return null;
      }
      return 0.5 * evaluate(w, this.me, this.diff, false) + 0.5 * evaluate(sb, this.me, this.diff, false);
    }
    return evaluate(sb, this.me, this.diff, false);
  }

  private sandbox(e: DuelEngine): DuelEngine | null {
    if (this.clonesLeft <= 0) return null;
    this.clonesLeft--;
    return makeSandbox(e);
  }

  private forkClone(sb: DuelEngine): DuelEngine | null {
    if (this.clonesLeft <= 0) return null;
    this.clonesLeft--;
    return sb.clone(); // sb was built with NO_TRAPS, and clone() keeps that
  }

  private ownMonsterValue(uid: number): number {
    const t = seenMonster(this.engine, uid, this.me);
    return t ? t.mv : 0;
  }
}

/** Independent engine on a copy of the state, with every trap disabled (hidden information). */
function makeSandbox(e: DuelEngine): DuelEngine {
  try {
    const st = e.state;
    return new DuelEngine({
      deck0: [], deck1: [], seed: st.seed,
      trapPolicy: NO_TRAPS,
      restore: { state: { ...st, log: [] }, pendingArena: e.pendingArena },
    });
  } catch {
    return e.clone();
  }
}

function arenaResult(winner: 'attacker' | 'defender'): ArenaResult {
  return {
    winner,
    attackerHpFrac: winner === 'attacker' ? 0.5 : 0,
    defenderHpFrac: winner === 'defender' ? 0.5 : 0,
    durationSec: 10,
    spellsUsed: [[], []],
  };
}

// ---------------------------------------------------------------------------
// Board evaluation
// ---------------------------------------------------------------------------

export interface SeenMonster {
  uid: number;
  atk: number;
  def: number;
  position: Position;
  /** Battle stat when attacked: ATK in attack position, DEF in defense position. */
  stat: number;
  /** Value of the monster on the field (LP-equivalents). */
  mv: number;
  faceDown: boolean;
  /** True if `viewer` knows the real stats. */
  known: boolean;
}

/** Monster as seen by `viewer` (opponent face-down monsters use AI_TUNING.faceDownGuess). */
export function seenMonster(e: DuelEngine, uid: number, viewer: PlayerId): SeenMonster | null {
  const s = e.state;
  for (const p of s.players) {
    const slot = p.monsters.find((m) => m?.card.uid === uid);
    if (!slot) continue;
    return seenSlot(e, slot, p.id, viewer);
  }
  return null;
}

function seenSlot(e: DuelEngine, slot: MonsterSlot, owner: PlayerId, viewer: PlayerId): SeenMonster {
  const hidden = slot.faceDown && owner !== viewer;
  const atk = hidden ? AI_TUNING.faceDownGuess.atk : e.getEffectiveAtk(slot.card.uid);
  const def = hidden ? AI_TUNING.faceDownGuess.def : e.getEffectiveDef(slot.card.uid);
  const cardDef = hidden ? null : safe(() => getCard(slot.card.defId), null);
  return {
    uid: slot.card.uid, atk, def, position: slot.position,
    stat: slot.position === 'attack' ? atk : def,
    mv: monsterValue(atk, def, slot.position, !!cardDef?.isEffect),
    faceDown: slot.faceDown, known: !hidden,
  };
}

/** Super-linear in ATK so that one big monster is worth more than the two small tributes it costs. */
function atkPower(atk: number): number {
  return 800 * Math.pow(Math.max(0, atk) / 1500, 1.5);
}

export function monsterValue(atk: number, def: number, position: Position, isEffect = false): number {
  const base = 200 + (isEffect ? 80 : 0);
  return position === 'attack'
    ? base + atkPower(atk) + 0.15 * def
    : base + 0.85 * atkPower(atk) + 0.25 * def;
}

/** LP utility: losing LP hurts more when low. */
function lpUtil(lp: number): number {
  return lp - 0.4 * Math.max(0, 1500 - lp);
}

const perfFor = (gap: number) => performanceMultiplier(0.45 + 0.25 * Math.tanh(gap / 1000));

/** Expected value (LP-equivalents) of attacking `t` with an attacker of `atk` and value `attackerMv`. */
function attackEV(atk: number, attackerMv: number, t: { stat: number; position: Position; mv: number }): number {
  const gap = atk - t.stat;
  const p = arenaWinProbability(gap);
  const winGain = t.mv + (t.position === 'attack' ? baseBattleDamage(atk, t.stat) * perfFor(gap) : 0);
  const loseCost = attackerMv + baseBattleDamage(t.stat, atk) * perfFor(-gap);
  return p * winGain - (1 - p) * loseCost;
}

/**
 * Score `e.state` from `me`'s point of view. `turnOver` = my turn is finished (no attacks left).
 * Easy difficulty ignores threats and opportunities (no look-ahead).
 */
export function evaluate(e: DuelEngine, me: PlayerId, diff: AIDifficulty, turnOver: boolean): number {
  const s = e.state;
  const opp: PlayerId = me === 0 ? 1 : 0;
  if (s.winner !== null) return s.winner === me ? WIN : s.winner === 'draw' ? -WIN / 4 : -WIN;
  const P = s.players[me];
  const O = s.players[opp];

  let score = lpUtil(P.lp) - lpUtil(O.lp);
  score += (P.hand.length - O.hand.length) * AI_TUNING.handCard;
  if (P.deck.length === 0) score -= 3000; // next draw loses

  for (const st of P.spellTraps) if (st) score += st.faceDown ? AI_TUNING.mySetCard : AI_TUNING.faceUpPersistent * persistentWeight(st.card.defId);
  for (const st of O.spellTraps) if (st) score -= st.faceDown ? AI_TUNING.oppSetCard[diff] : AI_TUNING.faceUpPersistent * persistentWeight(st.card.defId);

  const mine: SeenMonster[] = [];
  const theirs: SeenMonster[] = [];
  for (const m of P.monsters) if (m) mine.push(seenSlot(e, m, me, me));
  for (const m of O.monsters) if (m) theirs.push(seenSlot(e, m, opp, me));
  for (const m of mine) score += m.mv;
  for (const m of theirs) score -= m.mv;

  if (diff === 'easy') return score;

  // ---- threats: the opponent's best attacker on their next turn ----
  // Besides the monsters on the board, the opponent may Normal Summon a fresh attacker from hand.
  const oppBest = theirs.reduce((mx, t) => Math.max(mx, t.atk), 0);
  const virtualAtk = O.hand.length > 0 ? AI_TUNING.virtualAttacker.atk : 0;
  const vw = AI_TUNING.virtualAttacker.weight;
  if (mine.length === 0) {
    const total = (theirs.reduce((sum, t) => sum + t.atk, 0) + vw * virtualAtk) * DIRECT_MULT;
    score -= 0.6 * Math.min(total, P.lp) + (total >= P.lp ? 4000 : 0);
  } else if (oppBest > 0 || virtualAtk > 0) {
    const penAgainst = (m: SeenMonster, atk: number): number => {
      if (atk <= 0) return 0;
      if (m.position === 'attack') {
        const pl = arenaWinProbability(atk - m.atk);
        return pl * (0.55 * m.mv + baseBattleDamage(atk, m.atk) * EXPECTED_PERF);
      }
      return arenaWinProbability(atk - m.def) * 0.5 * m.mv;
    };
    const pens = mine.map((m) => Math.max(penAgainst(m, oppBest), vw * penAgainst(m, virtualAtk))).sort((a, b) => b - a);
    // One best attacker can only hit one monster; secondary attackers are weaker -> half weight.
    pens.forEach((pen, i) => { score -= i === 0 ? pen : pen * 0.4; });
  }

  // ---- my attack opportunity this turn ----
  if (!turnOver && s.activePlayer === me && s.turn > 1 && (s.phase === 'main' || s.phase === 'battle')
      && P.flags?.battleEnded !== s.turn) {
    const w = s.phase === 'battle' ? AI_TUNING.opportunityBattle : AI_TUNING.opportunityMain;
    const attackers = P.monsters
      .filter((m): m is MonsterSlot => !!m && m.position === 'attack' && !m.faceDown && !m.attackedThisTurn)
      .map((m) => seenSlot(e, m, me, me));
    score += w * opportunity(attackers, theirs, O.lp);
  }
  return score;
}

function persistentWeight(defId: string): number {
  const d = safe(() => getCard(defId), null);
  // Equip stats are already counted on the monster.
  return d?.speed === 'equip' ? 0 : 1;
}

/** Greedy attacker->target assignment value; leftover attackers hit directly once blockers are gone. */
function opportunity(attackers: SeenMonster[], targets: SeenMonster[], oppLp: number): number {
  let A = [...attackers];
  let T = [...targets];
  let total = 0;
  while (A.length && T.length) {
    let best: { a: SeenMonster; t: SeenMonster; ev: number } | null = null;
    for (const a of A) {
      for (const t of T) {
        const ev = attackEV(a.atk, a.mv, t);
        // Prefer the weakest attacker that does the job (keeps big ones for direct damage).
        if (!best || ev > best.ev + 1 || (Math.abs(ev - best.ev) <= 1 && a.atk < best.a.atk)) best = { a, t, ev };
      }
    }
    if (!best || best.ev <= 0) break;
    total += best.ev;
    A = A.filter((x) => x !== best!.a);
    if (arenaWinProbability(best.a.atk - best.t.stat) >= 0.5) T = T.filter((x) => x !== best!.t);
  }
  if (T.length === 0 && A.length) {
    const direct = A.reduce((s, a) => s + a.atk, 0) * DIRECT_MULT;
    total += Math.min(direct, oppLp) + (direct >= oppLp ? AI_TUNING.lethalBonus : 0);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Hard: expectimax over attack sequences (abstract model, no engine clones)
// ---------------------------------------------------------------------------

interface SAttacker { uid: number; atk: number; mv: number }
type STarget = SeenMonster;
interface SearchResult { value: number; move: { attackerUid: number; targetUid: number | null } | null }

class AttackSearch {
  private nodes = 0;
  constructor(private readonly risk: number, private readonly budget: number) {}

  best(A: SAttacker[], T: STarget[], oppLp: number, myLp: number, depth: number): SearchResult {
    this.nodes++;
    if (A.length === 0) return { value: 0, move: null };
    if (T.length === 0) {
      // All direct: order doesn't matter; strongest first (lethal ASAP).
      const total = A.reduce((s, a) => s + a.atk, 0) * DIRECT_MULT;
      const first = [...A].sort((x, y) => y.atk - x.atk)[0];
      const r = depth === 0 ? this.risk : this.risk * 0.5;
      const v = Math.min(total, oppLp) + (total >= oppLp ? WIN / 10 : 0);
      return { value: (1 - r) * v, move: { attackerUid: first.uid, targetUid: null } };
    }
    let best: SearchResult = { value: 0, move: null };
    // Candidate moves, pre-sorted by immediate EV, pruned when the budget runs thin.
    const moves: { a: SAttacker; t: STarget; ev: number }[] = [];
    for (const a of A) for (const t of T) moves.push({ a, t, ev: attackEV(a.atk, a.mv, t) });
    moves.sort((x, y) => y.ev - x.ev);
    const limit = this.nodes > this.budget ? 1 : this.nodes > this.budget / 2 ? 3 : 8;
    const r = depth === 0 ? this.risk : this.risk * 0.5;
    for (const { a, t } of moves.slice(0, limit)) {
      const gap = a.atk - t.stat;
      let p = arenaWinProbability(gap);
      if (p > 0.97) p = 1; else if (p < 0.03) p = 0;
      let v = 0;
      const restA = A.filter((x) => x !== a);
      if (p > 0) {
        const dmg = t.position === 'attack' ? baseBattleDamage(a.atk, t.stat) * perfFor(gap) : 0;
        const oLp = oppLp - dmg;
        const gain = t.mv + Math.min(dmg, oppLp) + (oLp <= 0 ? WIN / 10 : 0);
        const sub = oLp <= 0 ? 0 : this.best(restA, T.filter((x) => x !== t), oLp, myLp, depth + 1).value;
        v += p * (gain + sub);
      }
      if (p < 1) {
        const dmg = baseBattleDamage(t.stat, a.atk) * perfFor(-gap);
        const mLp = myLp - dmg;
        const cost = a.mv + Math.min(dmg, myLp) + (mLp <= 0 ? WIN / 10 : 0);
        const sub = mLp <= 0 ? 0 : this.best(restA, T, oppLp, mLp, depth + 1).value;
        v += (1 - p) * (sub - cost);
      }
      // A face-down trap may stop this attack (and maybe destroy the attacker): bait with cheap monsters.
      v = (1 - r) * v - r * 0.5 * a.mv;
      if (v > best.value + 1 || (best.move && Math.abs(v - best.value) <= 1 && a.mv < (A.find((x) => x.uid === best.move!.attackerUid)?.mv ?? Infinity))) {
        best = { value: v, move: { attackerUid: a.uid, targetUid: t.uid } };
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// Traps
// ---------------------------------------------------------------------------

function trapDecision(e: DuelEngine, prompt: TrapPrompt, diff: AIDifficulty): boolean {
  const def = e.getDef(prompt.trapUid);
  const id = def?.effect?.id ?? '';
  const me = prompt.player;
  const opp: PlayerId = me === 0 ? 1 : 0;
  const s = e.state;
  const myLp = s.players[me].lp;

  if (prompt.trigger === 'summon' && prompt.summon) {
    if (diff === 'easy') return true;
    const sm = seenMonster(e, prompt.summon.uid, me);
    if (!sm) return true;
    const myBest = s.players[me].monsters.reduce((mx, m) => (m ? Math.max(mx, m.position === 'attack' ? e.getEffectiveAtk(m.card.uid) : e.getEffectiveDef(m.card.uid)) : mx), 0);
    const lvl = e.getDef(prompt.summon.uid)?.level ?? 4;
    if (diff === 'normal') return sm.atk >= 1500 || sm.atk > myBest;
    return sm.atk >= 1900 || sm.atk > myBest || lvl >= 5;
  }

  if (prompt.attack) {
    const { attackerUid, targetUid } = prompt.attack;
    const atk = e.getEffectiveAtk(attackerUid);
    const attacker = seenMonster(e, attackerUid, me);
    const attackerMv = attacker?.mv ?? 0;
    // Expected loss for me if the attack goes through.
    let threat: number;
    let lethal = false;
    if (targetUid === null) {
      threat = atk * DIRECT_MULT;
      lethal = threat >= myLp;
    } else {
      const t = seenMonster(e, targetUid, me);
      if (!t) threat = 0;
      else {
        const gap = atk - t.stat;
        const p = arenaWinProbability(gap);
        const dmg = t.position === 'attack' ? baseBattleDamage(atk, t.stat) * perfFor(gap) : 0;
        threat = p * (t.mv + dmg) - (1 - p) * 0.3 * attackerMv;
        lethal = p > 0.3 && dmg >= myLp;
      }
    }
    if (lethal) return true;
    if (diff === 'easy') return true;

    const oppAttackPos = s.players[opp].monsters.filter((m): m is MonsterSlot => !!m && m.position === 'attack' && !m.faceDown);
    const pending = oppAttackPos.filter((m) => !m.attackedThisTurn && m.card.uid !== attackerUid).length;
    const swept = oppAttackPos.reduce((sum, m) => sum + (seenMonster(e, m.card.uid, me)?.mv ?? 0), 0);

    switch (id) {
      case 'destroyAttackPosition': // Mirror Force
        if (diff === 'normal') return threat > 150 || oppAttackPos.length >= 2 || swept >= 1500;
        if (threat >= 0.35 * myLp) return true;
        if (pending > 0 && threat < 600) return false; // let more attackers commit first
        return oppAttackPos.length >= 2 || threat > 300 || swept >= 1800;
      case 'destroyAttacker': // Sakuretsu Armor
        if (diff === 'normal') return threat > 150 || attackerMv > 1200;
        return threat > 250 || attackerMv >= 1500;
      case 'negateAttack':
        if (diff === 'normal') return threat > 200;
        return threat > 400 || (targetUid === null && atk >= 1000);
      case 'magicCylinder':
        return threat > 100 || atk >= 1500;
      case 'waboku':
        return threat > (diff === 'hard' ? 400 : 250);
      default:
        return threat > 200;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Card values (discard choice) and misc helpers
// ---------------------------------------------------------------------------

function handCardValue(e: DuelEngine, player: PlayerId, def: CardDef): number {
  const s = e.state;
  if (def.kind === 'monster') {
    const need = def.level && def.level >= 7 ? 2 : def.level && def.level >= 5 ? 1 : 0;
    const have = s.players[player].monsters.filter(Boolean).length;
    const v = atkPower(def.atk ?? 0) + 0.2 * (def.def ?? 0);
    return need > have ? v * 0.6 : v;
  }
  if (def.kind === 'trap') return 800;
  const id = def.effect?.id ?? '';
  const table: Record<string, number> = {
    draw: 1500, destroyAllOpponentMonsters: 2500, destroyAllMonsters: 1500, monsterReborn: 1400,
    damage: 700, equipAtk: 600, destroyTargetMonster: 1200, destroyLowestAtkOpponent: 1000,
  };
  if (/heal|cure/i.test(id)) return s.players[player].lp < AI_TUNING.healBelowLp ? 1200 : 500;
  return table[id] ?? 700;
}

function endTurnAction(e: DuelEngine, player: PlayerId, legal: DuelAction[]): DuelAction {
  if (!legal.some((a) => a.type === 'endTurn')) return legal[0] ?? { type: 'endTurn' };
  const discards = chooseDiscard(e, player);
  return discards.length ? { type: 'endTurn', discardUids: discards } : { type: 'endTurn' };
}

function actionKey(a: DuelAction): string {
  if (a.type === 'normalSummon') return JSON.stringify({ ...a, tributeUids: [...a.tributeUids].sort((x, y) => x - y) });
  if (a.type === 'endTurn') return 'endTurn';
  return JSON.stringify(a, Object.keys(a).sort());
}

function ensureLegal(a: DuelAction, legal: DuelAction[], e: DuelEngine, player: PlayerId): DuelAction {
  if (a.type === 'endTurn' && legal.some((x) => x.type === 'endTurn')) {
    // Validate discards: each must be in hand, count <= excess.
    const hand = e.state.players[player].hand;
    const excess = Math.max(0, hand.length - TUNING.duel.handLimit);
    const d = [...new Set(a.discardUids ?? [])].filter((u) => hand.some((c) => c.uid === u)).slice(0, excess);
    return d.length ? { type: 'endTurn', discardUids: d } : { type: 'endTurn' };
  }
  const k = actionKey(a);
  const match = legal.find((x) => actionKey(x) === k);
  if (match) return match;
  return endTurnAction(e, player, legal);
}

function safeDef(e: DuelEngine, uid: number): CardDef | null {
  return safe(() => e.getDef(uid), null);
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Deterministic per-decision RNG derived from the duel state (keeps seeded sims reproducible). */
function stateRng(s: DuelState, player: PlayerId): Rng {
  const seed = ((s.rngState ?? s.seed) ^ Math.imul(s.turn + 1, 0x9e3779b1) ^ Math.imul(s.log.length + 7, 0x85ebca6b) ^ (player * 0x27d4eb2d)) >>> 0;
  return new Rng(seed);
}

const actionCounts = new WeakMap<DuelEngine, { turn: number; n: number }>();
function bumpActionCount(e: DuelEngine): number {
  const turn = e.state.turn;
  const c = actionCounts.get(e);
  if (!c || c.turn !== turn) {
    actionCounts.set(e, { turn, n: 1 });
    return 1;
  }
  c.n += 1;
  return c.n;
}
