// Auto-play helpers built on DuelAI: drive the HUMAN side (tests, sims, an "Auto" button) and run
// whole headless AI-vs-AI duels with a stat-based arena stand-in. Pure TS, no Phaser.
import type { ArenaRequest, ArenaResult, DuelAction, PlayerId } from '../types';
import { DuelEngine } from '../duel/DuelEngine';
import { Rng } from '../rng';
import {
  arenaWinProbability, chooseAction, chooseTrapActivation, type AIDifficulty,
} from './DuelAI';

const HUMAN: PlayerId = 0;

/** Next action for the human seat (player 0), using the duel AI at `difficulty`. */
export function autoplayHuman(engine: DuelEngine, difficulty: AIDifficulty = 'normal'): DuelAction {
  return chooseAction(engine, HUMAN, difficulty);
}

/**
 * Stat-based arena stand-in (no real-time sim): the attacker wins with
 * P = logistic(battle-stat gap), the same curve the AI uses (fit of GDD 6.1).
 */
export function statArenaResolver(req: ArenaRequest, rng: Rng): ArenaResult {
  const stat = req.defender.position === 'attack' ? req.defender.atk : req.defender.defStat;
  const p = arenaWinProbability(req.attacker.atk - stat);
  const roll = rng.next();
  const hp = 0.15 + 0.7 * rng.next();
  const draw = Math.abs(req.attacker.atk - stat) < 1 && roll > 0.98;
  const winner: ArenaResult['winner'] = draw ? 'draw' : roll < p ? 'attacker' : 'defender';
  return {
    winner,
    attackerHpFrac: winner === 'attacker' ? hp : 0,
    defenderHpFrac: winner === 'defender' ? hp : 0,
    durationSec: 8 + 6 * rng.next(),
    spellsUsed: [[], []],
  };
}

export interface SimOptions {
  seed: number;
  deck0: string[];
  deck1: string[];
  difficulties: [AIDifficulty, AIDifficulty];
  firstPlayer?: PlayerId;
  /** Starting LP override (default TUNING.duel.startingLp). */
  startingLp?: number;
  /** Abort after this many turns (counted as a draw / timeout). Default 80. */
  maxTurns?: number;
  /** Arena stand-in. Default: statArenaResolver. */
  resolveArena?: (req: ArenaRequest, rng: Rng) => ArenaResult;
}

export interface SimResult {
  winner: PlayerId | 'draw' | null;
  /** Total turns played (both players). */
  turns: number;
  fights: number;
  directAttacks: number;
  actions: number;
  /** Decision timing (ms) of chooseAction. */
  maxDecisionMs: number;
  totalDecisionMs: number;
  decisions: number;
  timedOut: boolean;
  lp: [number, number];
}

/** Play a whole duel AI vs AI. Throws if the AI ever returns an action the engine rejects. */
export function simulateDuel(o: SimOptions): SimResult {
  const rng = new Rng(o.seed ^ 0x5bd1e995);
  const maxTurns = o.maxTurns ?? 80;
  let engine: DuelEngine | undefined;
  engine = new DuelEngine({
    deck0: o.deck0, deck1: o.deck1, seed: o.seed, firstPlayer: o.firstPlayer ?? 0, startingLp: o.startingLp,
    trapPolicy: (prompt) => (engine ? chooseTrapActivation(engine, prompt, o.difficulties[prompt.player]) : true),
  });
  const resolve = o.resolveArena ?? statArenaResolver;
  const res: SimResult = {
    winner: null, turns: 0, fights: 0, directAttacks: 0, actions: 0,
    maxDecisionMs: 0, totalDecisionMs: 0, decisions: 0, timedOut: false, lp: [0, 0],
  };
  let guard = 0;
  while (engine.state.winner === null) {
    if (engine.state.turn > maxTurns || ++guard > 5000) { res.timedOut = true; break; }
    if (engine.pendingArena) {
      res.fights++;
      engine.resolveArena(resolve(engine.pendingArena, rng));
      continue;
    }
    const p = engine.state.activePlayer;
    const t0 = now();
    const a = chooseAction(engine, p, o.difficulties[p]);
    const dt = now() - t0;
    res.decisions++;
    res.totalDecisionMs += dt;
    res.maxDecisionMs = Math.max(res.maxDecisionMs, dt);
    if (a.type === 'declareAttack' && a.targetUid === null) res.directAttacks++;
    engine.apply(a);
    res.actions++;
  }
  res.winner = engine.state.winner;
  res.turns = engine.state.turn;
  res.lp = [engine.state.players[0].lp, engine.state.players[1].lp];
  return res;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
