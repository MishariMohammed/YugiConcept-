import { afterEach, describe, expect, it } from 'vitest';
import type { ArenaRequest, CardDef, CardInstance, PlayerId, Position } from '../src/core/types';
import { TUNING } from '../src/core/combat/Formulas';
import {
  ArenaSim, IDLE_CONTROLLER, IDLE_INPUT, simulateArena, spellAbility,
  type ArenaController, type FighterInput, type SimEvent,
} from '../src/core/combat/ArenaSim';
import { ArenaAI, arenaProfile } from '../src/core/ai/ArenaAI';

// ---- fixtures --------------------------------------------------------------
const mon = (id: string, atk: number, def: number, extra: Partial<CardDef> = {}): CardDef => ({
  id, name: id, kind: 'monster', text: '', level: 4, atk, def, attribute: 'DARK', monsterType: 'Warrior', ...extra,
});
const SPELLS: Record<string, CardDef> = {
  'zap': {
    id: 'zap', name: 'Zap', kind: 'spell', text: '', arenaUsable: true,
    arenaAbilities: [{ id: 'zap', name: 'Zap', kind: 'projectile', power: 3, cooldown: 0, description: '' }],
  },
  'mend': {
    id: 'mend', name: 'Mend', kind: 'spell', text: '', arenaUsable: true,
    arenaAbilities: [{ id: 'mend', name: 'Mend', kind: 'heal', power: 0, cooldown: 0, magnitude: 0.3, description: '' }],
  },
  'bare': { id: 'bare', name: 'Bare', kind: 'spell', text: '', arenaUsable: true },
};
const resolveCard = (id: string) => SPELLS[id];

function request(
  a: CardDef, d: CardDef, seed = 1,
  opts: { pos?: Position; spells?: [string[], string[]]; attackerPlayer?: PlayerId } = {},
): ArenaRequest {
  const ap: PlayerId = opts.attackerPlayer ?? 0;
  const dp: PlayerId = ap === 0 ? 1 : 0;
  let uid = 100;
  const inst = (ids: string[], owner: PlayerId): CardInstance[] => ids.map((defId) => ({ uid: uid++, defId, owner }));
  const sp = opts.spells ?? [[], []];
  return {
    attacker: { player: ap, uid: 1, def: a, atk: a.atk ?? 0, defStat: a.def ?? 0 },
    defender: { player: dp, uid: 2, def: d, atk: d.atk ?? 0, defStat: d.def ?? 0, position: opts.pos ?? 'attack' },
    usableSpells: [inst(sp[0], 0), inst(sp[1], 1)],
    seed,
  };
}

const T = TUNING as unknown as { arena: Record<string, number> };
const saved = { base: TUNING.arena.suddenDeathBaseFrac, ramp: TUNING.arena.suddenDeathRampFrac };
afterEach(() => {
  T.arena.suddenDeathBaseFrac = saved.base;
  T.arena.suddenDeathRampFrac = saved.ramp;
});

function runCollect(sim: ArenaSim, ctrl: [ArenaController, ArenaController]): SimEvent[] {
  const all: SimEvent[] = [];
  let guard = 0;
  while (!sim.done && guard++ < 5000) all.push(...sim.step([ctrl[0].input(sim, 0), ctrl[1].input(sim, 1)]));
  return all;
}

// ---- tests -----------------------------------------------------------------
describe('ArenaSim determinism', () => {
  it('same seed + same inputs => identical result and event stream', () => {
    const run = () => {
      const req = request(mon('a', 1700, 1200, { arenaStyle: 'ranged' }), mon('b', 1500, 1500, { arenaStyle: 'swift' }), 42, { spells: [['zap'], ['mend']] });
      const sim = new ArenaSim(req, { resolveCard });
      const ev = runCollect(sim, [new ArenaAI('good', 7), new ArenaAI('normal', 9)]);
      return { result: sim.result, n: ev.length, last: JSON.stringify(ev.slice(-5)), pos: sim.fighters.map((f) => [f.x, f.y, f.hp]) };
    };
    const r1 = run(), r2 = run();
    expect(r1.result).not.toBeNull();
    expect(r2).toEqual(r1);
  });

  it('different seeds can produce different fights', () => {
    const durs = new Set<number>();
    for (let s = 1; s <= 6; s++) {
      const req = request(mon('a', 1500, 1200), mon('b', 1500, 1200), s);
      durs.add(simulateArena(req, [new ArenaAI('average', s), new ArenaAI('average', s + 50)]).result.durationSec);
    }
    expect(durs.size).toBeGreaterThan(1);
  });
});

describe('ArenaSim outcomes', () => {
  it('the stronger monster wins under idle inputs (in contact)', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const r1 = simulateArena(request(mon('strong', 1900, 1200), mon('weak', 1200, 1200), seed), [IDLE_CONTROLLER, IDLE_CONTROLLER], { spawnGap: 28 }).result;
      expect(r1.winner).toBe('attacker');
      expect(r1.durationSec).toBeLessThan(TUNING.arena.suddenDeathAtSec); // decided by the trade, not by sudden death
      expect(r1.attackerHpFrac).toBeGreaterThan(0);
      expect(r1.defenderHpFrac).toBe(0);
      const r2 = simulateArena(request(mon('weak', 1200, 1200), mon('strong', 1900, 1200), seed), [IDLE_CONTROLLER, IDLE_CONTROLLER], { spawnGap: 28 }).result;
      expect(r2.winner).toBe('defender');
      expect(r2.durationSec).toBeLessThan(TUNING.arena.suddenDeathAtSec);
    }
  });

  it('a Defense-Position wall fights back with its DEF', () => {
    const r = simulateArena(
      request(mon('atk', 1200, 800), mon('wall', 0, 2400), 3, { pos: 'defense' }),
      [IDLE_CONTROLLER, IDLE_CONTROLLER], { spawnGap: 28 },
    ).result;
    expect(r.winner).toBe('defender');
    expect(r.durationSec).toBeLessThan(TUNING.arena.suddenDeathAtSec);
  });

  it('AI vs AI fights end with a sane result and duration', () => {
    const { result } = simulateArena(request(mon('a', 1500, 1200), mon('b', 1300, 1100), 11), [new ArenaAI('normal', 1), new ArenaAI('normal', 2)]);
    expect(['attacker', 'defender', 'draw']).toContain(result.winner);
    expect(result.durationSec).toBeGreaterThan(2);
    expect(result.durationSec).toBeLessThanOrEqual(TUNING.arena.hardCapSec);
  });
});

describe('ArenaSim time limits', () => {
  it('sudden death terminates a fight where nobody can reach the other', () => {
    const sim = new ArenaSim(request(mon('a', 0, 0), mon('b', 0, 0), 5));
    const ev = runCollect(sim, [IDLE_CONTROLLER, IDLE_CONTROLLER]);
    expect(ev.some((e) => e.type === 'suddenDeath')).toBe(true);
    const r = sim.result!;
    expect(r.durationSec).toBeGreaterThan(TUNING.arena.suddenDeathAtSec);
    expect(r.durationSec).toBeLessThan(TUNING.arena.hardCapSec);
    // identical fractions burn down together: simultaneous KO = draw
    expect(r.winner).toBe('draw');
    // walls closed in
    expect(sim.bounds.x0).toBeGreaterThan(0);
  });

  it('hard cap decides by HP fraction', () => {
    T.arena.suddenDeathBaseFrac = 0;
    T.arena.suddenDeathRampFrac = 0;
    // 0-ATK ranged attacker chips (min hit) a melee defender that cannot reach it.
    const req = request(mon('sniper', 0, 3000, { arenaStyle: 'ranged' }), mon('target', 1000, 1000), 8);
    const sim = new ArenaSim(req, { spawnGap: 120 });
    runCollect(sim, [IDLE_CONTROLLER, IDLE_CONTROLLER]);
    const r = sim.result!;
    expect(r.durationSec).toBeCloseTo(TUNING.arena.hardCapSec, 1);
    expect(r.winner).toBe('attacker');
    expect(r.defenderHpFrac).toBeGreaterThan(0);
    expect(r.defenderHpFrac).toBeLessThan(1);
  });

  it('hard cap with equal HP fractions is a draw', () => {
    T.arena.suddenDeathBaseFrac = 0;
    T.arena.suddenDeathRampFrac = 0;
    const r = simulateArena(request(mon('a', 1000, 1000), mon('b', 1000, 1000), 2), [IDLE_CONTROLLER, IDLE_CONTROLLER]).result;
    expect(r.durationSec).toBeCloseTo(TUNING.arena.hardCapSec, 1);
    expect(r.winner).toBe('draw');
  });
});

describe('ArenaSim spells and statuses', () => {
  const spam = (spell: number): ArenaController => ({ input: (): FighterInput => ({ ...IDLE_INPUT, spell }) });

  it('an arena spell fires once and is reported in spellsUsed for its player', () => {
    const req = request(mon('a', 1500, 1200), mon('b', 1500, 1200), 4, { spells: [['zap', 'mend'], []] });
    const sim = new ArenaSim(req, { resolveCard });
    const ev = runCollect(sim, [spam(0), IDLE_CONTROLLER]);
    const casts = ev.filter((e) => e.type === 'abilityCast' && e.isSpell);
    expect(casts).toHaveLength(1);
    expect(sim.result!.spellsUsed).toEqual([[100], []]);
    expect(sim.canUseSpell(0, 0)).toBe(false);
    expect(sim.fighters[0].spells[1].used).toBe(false);
  });

  it('spellsUsed is indexed by PlayerId even when player 1 attacks', () => {
    const req = request(mon('a', 1500, 1200), mon('b', 1500, 1200), 4, { spells: [[], ['zap']], attackerPlayer: 1 });
    const sim = new ArenaSim(req, { resolveCard });
    runCollect(sim, [spam(0), IDLE_CONTROLLER]); // side 0 = attacker = player 1
    expect(sim.result!.spellsUsed).toEqual([[], [100]]);
  });

  it('a spell without arenaAbilities gets the default burst', () => {
    const ab = spellAbility(SPELLS.bare);
    expect(ab.kind).toBe('projectile');
    expect(ab.power).toBe(TUNING.abilities.spellPower);
  });

  it('a shield reduces incoming damage by its magnitude', () => {
    const firstHit = (shield: number) => {
      const sim = new ArenaSim(request(mon('a', 1600, 1200), mon('b', 1500, 1200), 9), { spawnGap: 28 });
      if (shield > 0) { sim.fighters[1].shieldMag = shield; sim.fighters[1].shieldUntil = 99; }
      let guard = 0;
      while (guard++ < 600) {
        const hit = sim.step([IDLE_INPUT, IDLE_INPUT]).find((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit' && e.target === 1);
        if (hit) return hit;
      }
      throw new Error('no hit');
    };
    const plain = firstHit(0), shielded = firstHit(0.5);
    expect(plain.shielded).toBe(false);
    expect(shielded.shielded).toBe(true);
    expect(shielded.amount).toBeCloseTo(plain.amount * 0.5, 5);
  });

  it('casting a shield ability applies the status', () => {
    const def = mon('b', 1500, 1200, {
      arenaAbilities: [{ id: 's', name: 'Guard', kind: 'shield', power: 0, cooldown: 7, duration: 3, magnitude: 0.5, description: '' }],
    });
    const sim = new ArenaSim(request(mon('a', 1500, 1200), def, 2), { spawnGap: 28 });
    const ctl: ArenaController = { input: (s) => ({ ...IDLE_INPUT, ability: s.canUseAbility(1, 0) ? 0 : null }) };
    const ev = runCollect(sim, [IDLE_CONTROLLER, ctl]);
    expect(ev.some((e) => e.type === 'status' && e.status === 'shield' && e.side === 1)).toBe(true);
    expect(ev.some((e) => e.type === 'hit' && e.target === 1 && e.shielded)).toBe(true);
  });

  it('heal is disabled during sudden death', () => {
    const req = request(mon('a', 0, 0), mon('b', 0, 0), 5, { spells: [['mend'], []] });
    const sim = new ArenaSim(req, { resolveCard });
    while (!sim.suddenDeath) sim.step([IDLE_INPUT, IDLE_INPUT]);
    expect(sim.canUseSpell(0, 0)).toBe(false);
  });

  it('abilities respect cooldowns', () => {
    const sim = new ArenaSim(request(mon('a', 1500, 1200, { arenaStyle: 'ranged' }), mon('b', 1500, 1200), 3));
    const ctl: ArenaController = { input: () => ({ ...IDLE_INPUT, ability: 0 }) };
    const ev = runCollect(sim, [ctl, IDLE_CONTROLLER]);
    const casts = ev.filter((e) => e.type === 'abilityCast' && !e.isSpell && e.side === 0).map((e) => e.t);
    expect(casts.length).toBeGreaterThan(1);
    const cd = sim.fighters[0].abilities[0].ability.cooldown;
    for (let i = 1; i < casts.length; i++) expect(casts[i] - casts[i - 1]).toBeGreaterThanOrEqual(cd - 1e-6);
  });
});

describe('ArenaAI', () => {
  it('profiles exist for NPC difficulties and player skills', () => {
    for (const k of ['easy', 'normal', 'hard', 'novice', 'average', 'good', 'expert'] as const) {
      const p = arenaProfile(k);
      expect(p.reactionMs).toBeGreaterThan(0);
      expect(p.dodgeChance).toBeGreaterThanOrEqual(0);
    }
    expect(arenaProfile('hard').reactionMs).toBeLessThan(arenaProfile('easy').reactionMs);
  });

  it('a hard AI beats an easy AI more often than not at equal stats (ranged)', () => {
    let hardWins = 0;
    const n = 30;
    for (let i = 0; i < n; i++) {
      const req = request(mon('a', 1500, 1200, { arenaStyle: 'ranged' }), mon('b', 1500, 1200, { arenaStyle: 'ranged' }), 500 + i);
      const r = simulateArena(req, [new ArenaAI('hard', i), new ArenaAI('easy', i + 99)]).result;
      if (r.winner === 'attacker') hardWins++;
    }
    expect(hardWins / n).toBeGreaterThan(0.5);
  });
});
