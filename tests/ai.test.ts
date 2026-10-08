import { beforeAll, describe, expect, it } from 'vitest';
import { directAttackDamage } from '../src/core/combat/Formulas';
import { loadDefaultCards } from '../src/core/cards/CardDB';
import { DuelEngine } from '../src/core/duel/DuelEngine';
import {
  arenaWinProbability, chooseAction, chooseDiscard, chooseTrapActivation, type AIDifficulty,
} from '../src/core/ai/DuelAI';
import { simulateDuel, type SimResult } from '../src/core/ai/HumanAutoplay';
import { DECKS } from '../src/data/decks';
import type { ArenaResult, DuelAction, PlayerId, Position } from '../src/core/types';

beforeAll(() => {
  loadDefaultCards();
});

// ---------------------------------------------------------------------------
// Scenario helpers: build a board by hand on top of a fresh engine.
// ---------------------------------------------------------------------------

function blankDuel(): DuelEngine {
  const e = new DuelEngine({ deck0: DECKS.yugi, deck1: DECKS.kaiba, seed: 99, shuffle: false });
  for (const p of e.state.players) {
    p.graveyard.push(...p.hand);
    p.hand = [];
  }
  // NPC (player 1) to move, turn 3, main phase.
  e.state.turn = 3;
  e.state.activePlayer = 1;
  e.state.phase = 'main';
  return e;
}

function place(e: DuelEngine, p: PlayerId, defId: string, position: Position = 'attack', faceDown = false): number {
  const uid = e.state.nextUid++;
  const zones = e.state.players[p].monsters;
  const z = zones.findIndex((m) => m === null);
  zones[z] = {
    card: { uid, defId, owner: p }, position, faceDown,
    summonedThisTurn: false, attackedThisTurn: false, changedPositionThisTurn: false, atkMod: 0, defMod: 0,
  };
  return uid;
}

function toHand(e: DuelEngine, p: PlayerId, defId: string): number {
  const uid = e.state.nextUid++;
  e.state.players[p].hand.push({ uid, defId, owner: p });
  return uid;
}

function setTrap(e: DuelEngine, p: PlayerId, defId: string): number {
  const uid = e.state.nextUid++;
  const z = e.state.players[p].spellTraps.findIndex((s) => s === null);
  e.state.players[p].spellTraps[z] = { card: { uid, defId, owner: p }, faceDown: true, setThisTurn: false };
  return uid;
}

const win = (w: ArenaResult['winner']): ArenaResult => ({
  winner: w, attackerHpFrac: w === 'attacker' ? 0.6 : 0, defenderHpFrac: w === 'defender' ? 0.6 : 0,
  durationSec: 10, spellsUsed: [[], []],
});

/** Let the AI play out its turn; arena fights go to the higher stat. Returns the actions taken. */
function playTurn(e: DuelEngine, p: PlayerId, d: AIDifficulty): DuelAction[] {
  const taken: DuelAction[] = [];
  const turn = e.state.turn;
  for (let i = 0; i < 50 && e.state.winner === null && e.state.turn === turn; i++) {
    if (e.pendingArena) {
      const r = e.pendingArena;
      const stat = r.defender.position === 'attack' ? r.defender.atk : r.defender.defStat;
      e.resolveArena(win(r.attacker.atk > stat ? 'attacker' : 'defender'));
      continue;
    }
    const a = chooseAction(e, p, d);
    taken.push(a);
    e.apply(a);
  }
  return taken;
}

// ---------------------------------------------------------------------------
// Unit scenarios
// ---------------------------------------------------------------------------

describe('DuelAI scenarios', () => {
  it('takes lethal: clears the blocker with the small attacker, then swings big for game', () => {
    for (const d of ['normal', 'hard'] as AIDifficulty[]) {
      const e = blankDuel();
      const bewd = place(e, 1, 'blue-eyes-white-dragon');
      const xhead = place(e, 1, 'x-head-cannon');
      const guardian = place(e, 0, 'celtic-guardian', 'defense'); // 1400/1200 in DEF
      e.state.players[0].lp = directAttackDamage(3000) - 100; // BEWD direct = 3000 x directAttackMult
      const acts = playTurn(e, 1, d);
      const attacks = acts.filter((a) => a.type === 'declareAttack');
      expect(attacks[0], d).toEqual({ type: 'declareAttack', attackerUid: xhead, targetUid: guardian });
      expect(attacks[1], d).toEqual({ type: 'declareAttack', attackerUid: bewd, targetUid: null });
      expect(e.state.winner, d).toBe(1);
    }
  });

  it('takes an open-board lethal immediately', () => {
    for (const d of ['easy', 'normal', 'hard'] as AIDifficulty[]) {
      const e = blankDuel();
      place(e, 1, 'vorse-raider');
      place(e, 1, 'battle-ox');
      e.state.players[0].lp = directAttackDamage(1900) + directAttackDamage(1700) - 100;
      playTurn(e, 1, d);
      expect(e.state.winner, d).toBe(1);
    }
  });

  it('does not suicide into a bigger monster', () => {
    for (const d of ['normal', 'hard'] as AIDifficulty[]) {
      const e = blankDuel();
      place(e, 1, 'vorse-raider'); // 1900
      place(e, 0, 'dark-magician'); // 2500 ATK position
      const acts = playTurn(e, 1, d);
      expect(acts.some((a) => a.type === 'declareAttack'), d).toBe(false);
      expect(e.state.players[1].monsters.filter(Boolean).length, d).toBe(1);
    }
  });

  it('does not attack into a high-DEF wall but does hit a weaker attacker', () => {
    for (const d of ['normal', 'hard'] as AIDifficulty[]) {
      const e = blankDuel();
      const ox = place(e, 1, 'battle-ox'); // 1700
      place(e, 0, 'big-shield-gardna', 'defense'); // DEF 2600
      const silver = place(e, 0, 'silver-fang'); // 1200 ATK
      const acts = playTurn(e, 1, d).filter((a) => a.type === 'declareAttack');
      expect(acts, d).toEqual([{ type: 'declareAttack', attackerUid: ox, targetUid: silver }]);
    }
  });

  it('tributes the weakest monster', () => {
    for (const d of ['normal', 'hard'] as AIDifficulty[]) {
      const e = blankDuel();
      const saggi = place(e, 1, 'saggi-the-dark-clown'); // 600/1500
      place(e, 1, 'la-jinn'); // 1800
      const judge = toHand(e, 1, 'judge-man'); // Lv6, 2200
      const a = chooseAction(e, 1, d);
      expect(a, d).toMatchObject({ type: 'normalSummon', handUid: judge, faceDown: false, tributeUids: [saggi] });
    }
  });

  it('sets a monster that cannot beat the opponent\'s best attacker', () => {
    for (const d of ['normal', 'hard'] as AIDifficulty[]) {
      const e = blankDuel();
      place(e, 0, 'dark-magician'); // 2500
      const ox = toHand(e, 1, 'battle-ox');
      const a = chooseAction(e, 1, d);
      expect(a, d).toMatchObject({ type: 'normalSummon', handUid: ox, faceDown: true, position: 'defense' });
    }
  });

  it('plays Pot of Greed and sets traps; holds Dian Keto at high LP', () => {
    const e = blankDuel();
    e.state.activePlayer = 0;
    const pot = toHand(e, 0, 'pot-of-greed');
    const keto = toHand(e, 0, 'dian-keto-the-cure-master');
    const mf = toHand(e, 0, 'mirror-force');
    const acts = playTurn(e, 0, 'normal');
    expect(acts[0]).toEqual({ type: 'activateSpell', handUid: pot });
    expect(acts).toContainEqual({ type: 'setSpellTrap', handUid: mf });
    expect(acts.some((a) => a.type === 'activateSpell' && a.handUid === keto)).toBe(false);
  });

  it('heals when LP is low', () => {
    const e = blankDuel();
    e.state.players[1].lp = 900;
    const keto = toHand(e, 1, 'dian-keto-the-cure-master');
    expect(chooseAction(e, 1, 'normal')).toEqual({ type: 'activateSpell', handUid: keto });
  });

  it('uses Raigeki only when the opponent has monsters worth it', () => {
    const e = blankDuel();
    place(e, 0, 'dark-magician');
    place(e, 0, 'celtic-guardian');
    const rai = toHand(e, 1, 'raigeki');
    expect(chooseAction(e, 1, 'normal')).toEqual({ type: 'activateSpell', handUid: rai });
  });

  it('hard holds Mirror Force against a lone harmless attack, fires it on two attackers', () => {
    const e = blankDuel();
    e.state.activePlayer = 0;
    e.state.phase = 'battle';
    const mf = setTrap(e, 1, 'mirror-force');
    const wall = place(e, 1, 'big-shield-gardna', 'defense');
    const a1 = place(e, 0, 'silver-fang');
    const a2 = place(e, 0, 'celtic-guardian');
    const prompt = { player: 1 as PlayerId, trapUid: mf, trigger: 'attackDeclared' as const, attack: { attackerUid: a1, attackerPlayer: 0 as PlayerId, targetUid: wall } };
    // a2 has not attacked yet -> wait for it.
    expect(chooseTrapActivation(e, prompt, 'hard')).toBe(false);
    e.state.players[0].monsters.find((m) => m?.card.uid === a1)!.attackedThisTurn = true;
    const prompt2 = { ...prompt, attack: { attackerUid: a2, attackerPlayer: 0 as PlayerId, targetUid: wall } };
    expect(chooseTrapActivation(e, prompt2, 'hard')).toBe(true);
    // Direct lethal attack: always fire.
    e.state.players[1].lp = 1000;
    const prompt3 = { ...prompt, attack: { attackerUid: a2, attackerPlayer: 0 as PlayerId, targetUid: null } };
    expect(chooseTrapActivation(e, prompt3, 'easy')).toBe(true);
  });

  it('discards the least useful cards down to the hand limit', () => {
    const e = blankDuel();
    const keep = toHand(e, 1, 'pot-of-greed');
    const ids = ['blue-eyes-white-dragon', 'raigeki', 'trap-hole', 'vorse-raider', 'saggi-the-dark-clown', 'hitotsu-me-giant', 'krokodilus'];
    for (const id of ids) toHand(e, 1, id);
    const d = chooseDiscard(e, 1);
    expect(d).toHaveLength(2);
    expect(d).not.toContain(keep);
    const e2 = e.state.players[1].hand.filter((c) => d.includes(c.uid)).map((c) => c.defId).sort();
    expect(e2).toEqual(['krokodilus', 'saggi-the-dark-clown']);
  });

  it('returns endTurn (no throw) when it is not its turn or an arena is pending', () => {
    const e = blankDuel();
    expect(chooseAction(e, 0, 'hard')).toEqual({ type: 'endTurn' });
  });

  it('arena win probability follows the GDD model shape', () => {
    expect(arenaWinProbability(0)).toBeCloseTo(0.5);
    expect(arenaWinProbability(-500)).toBeLessThan(0.05);
    expect(arenaWinProbability(-200)).toBeGreaterThan(0.1);
    expect(arenaWinProbability(-200)).toBeLessThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// Self-play: 100 seeded full duels
// ---------------------------------------------------------------------------

describe('DuelAI self-play', () => {
  it('plays 100 seeded AI-vs-AI duels: legal, terminating, hard > easy', () => {
    const diffs: AIDifficulty[] = ['easy', 'normal', 'hard'];
    // 40 hard-vs-easy games (both seats, both decks), 60 spread over the other ordered pairings.
    const games: { d: [AIDifficulty, AIDifficulty] }[] = [];
    for (let i = 0; i < 20; i++) games.push({ d: ['hard', 'easy'] }, { d: ['easy', 'hard'] });
    const others: [AIDifficulty, AIDifficulty][] = [];
    for (const a of diffs) for (const b of diffs) if (!(a === 'hard' && b === 'easy') && !(a === 'easy' && b === 'hard')) others.push([a, b]);
    for (let i = 0; games.length < 100; i++) games.push({ d: others[i % others.length] });

    const results: (SimResult & { d: [AIDifficulty, AIDifficulty] })[] = [];
    games.forEach((g, i) => {
      const r = simulateDuel({
        seed: 1000 + i * 7919, deck0: DECKS.yugi, deck1: DECKS.kaiba, difficulties: g.d,
        firstPlayer: (i % 2) as PlayerId, maxTurns: 80,
      });
      results.push({ ...r, d: g.d });
    });

    for (const r of results) {
      expect(r.timedOut).toBe(false);
      expect(r.winner).not.toBeNull();
      expect(r.turns).toBeLessThanOrEqual(60);
    }

    // Win rates by difficulty pairing.
    const tally = new Map<string, { n: number; w0: number; w1: number; draws: number; turns: number; fights: number }>();
    let hardWins = 0, hardGames = 0;
    for (const r of results) {
      const k = `${r.d[0]}(yugi) vs ${r.d[1]}(kaiba)`;
      const t = tally.get(k) ?? { n: 0, w0: 0, w1: 0, draws: 0, turns: 0, fights: 0 };
      t.turns += r.turns; t.fights += r.fights;
      t.n++;
      if (r.winner === 0) t.w0++; else if (r.winner === 1) t.w1++; else t.draws++;
      tally.set(k, t);
      const hi = r.d.indexOf('hard'), ei = r.d.indexOf('easy');
      if (hi >= 0 && ei >= 0 && hi !== ei) {
        hardGames++;
        if (r.winner === hi) hardWins++;
      }
    }
    const avg = (f: (r: SimResult) => number) => results.reduce((s, r) => s + f(r), 0) / results.length;
    const decisions = results.reduce((s, r) => s + r.decisions, 0);
    const lines = [
      `games=${results.length}`,
      `avg turns/game=${avg((r) => r.turns).toFixed(1)} (per player ${(avg((r) => r.turns) / 2).toFixed(1)}), min=${Math.min(...results.map((r) => r.turns))}, max=${Math.max(...results.map((r) => r.turns))}`,
      `avg arena fights/game=${avg((r) => r.fights).toFixed(2)}, direct attacks/game=${avg((r) => r.directAttacks).toFixed(2)}`,
      `decision ms: avg=${(results.reduce((s, r) => s + r.totalDecisionMs, 0) / decisions).toFixed(3)}, max=${Math.max(...results.map((r) => r.maxDecisionMs)).toFixed(2)}`,
      `hard vs easy: hard won ${hardWins}/${hardGames} (${((100 * hardWins) / hardGames).toFixed(0)}%)`,
      ...[...tally.entries()].map(([k, t]) => `  ${k}: n=${t.n} P0=${t.w0} P1=${t.w1} draw=${t.draws} turns=${(t.turns / t.n).toFixed(1)} fights=${(t.fights / t.n).toFixed(1)}`),
    ];
    process.stdout.write(`\n[DuelAI self-play]\n${lines.join('\n')}\n`);

    expect(hardWins / hardGames).toBeGreaterThan(0.6);
  }, 120_000);
});
