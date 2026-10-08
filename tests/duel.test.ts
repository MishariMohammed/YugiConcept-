import { describe, expect, it } from 'vitest';
import { getCard, registerCards } from '../src/core/cards/CardDB';
import { DuelEngine, type ResolveBattleFn } from '../src/core/duel/DuelEngine';
import { Rng } from '../src/core/rng';
import { RULES } from '../src/core/duel/Rules';
import { directAttackDamage } from '../src/core/combat/Formulas';

const LP0 = RULES.startingLp;
import type { ArenaResult, CardDef, DuelAction, DuelEvent } from '../src/core/types';

// ---- fixtures -------------------------------------------------------------
const M = (id: string, level: number, atk: number, def: number): CardDef => ({
  id, name: id, kind: 'monster', text: '', level, atk, def, attribute: 'DARK', monsterType: 'Warrior',
});
const FIX: CardDef[] = [
  M('t-low', 4, 1000, 1000),
  M('t-mid', 4, 1500, 1200),
  M('t-wall', 4, 0, 2000),
  M('t-lv5', 5, 2300, 2000),
  M('t-lv7', 7, 2500, 2100),
  { id: 't-pot', name: 'Pot', kind: 'spell', speed: 'normal', text: '', effect: { id: 'draw', params: { n: 2 } } },
  { id: 't-burn', name: 'Burn', kind: 'spell', speed: 'quick', text: '', effect: { id: 'damage', params: { n: 500 } } },
  { id: 't-raigeki', name: 'Raigeki', kind: 'spell', speed: 'normal', text: '', effect: { id: 'destroyAllOpponentMonsters' } },
  { id: 't-fissure', name: 'Fissure', kind: 'spell', speed: 'normal', text: '', effect: { id: 'destroyTargetMonster' } },
  { id: 't-sword', name: 'Sword', kind: 'spell', speed: 'equip', text: '', effect: { id: 'equipAtk', params: { atk: 700, def: 0 } } },
  { id: 't-armor', name: 'Armor', kind: 'trap', speed: 'normal', text: '', effect: { id: 'destroyAttacker' } },
  { id: 't-hole', name: 'Hole', kind: 'trap', speed: 'normal', text: '', effect: { id: 'destroySummoned', params: { minAtk: 1000 } } },
  { id: 't-arena-spell', name: 'Zap', kind: 'spell', speed: 'quick', text: '', arenaUsable: true },
];
registerCards(FIX);

// Deterministic stand-in for core/combat/Formulas.resolveBattle so these tests only check engine wiring.
const fakeResolve: ResolveBattleFn = (atk, d, arena) => {
  if (arena.winner === 'attacker') {
    return { attackerDestroyed: false, defenderDestroyed: true, lpDamage: [0, d.position === 'attack' ? atk - d.atk : 0] };
  }
  if (arena.winner === 'defender') {
    const stat = d.position === 'attack' ? d.atk : d.def;
    return { attackerDestroyed: true, defenderDestroyed: false, lpDamage: [Math.max(100, stat - atk), 0] };
  }
  return { attackerDestroyed: true, defenderDestroyed: true, lpDamage: [0, 0] };
};

/** Deck where `top` cards are drawn first (engine draws with pop()). */
function deck(top: string[], filler = 't-low', size = 30): string[] {
  const rest = Array(Math.max(0, size - top.length)).fill(filler);
  return [...rest, ...[...top].reverse()];
}

function mk(top0: string[], top1: string[], extra: Partial<ConstructorParameters<typeof DuelEngine>[0]> = {}) {
  return new DuelEngine({
    deck0: deck(top0), deck1: deck(top1), seed: 42, shuffle: false, resolveBattle: fakeResolve, ...extra,
  });
}

const handUid = (e: DuelEngine, p: 0 | 1, id: string) => e.state.players[p].hand.find((c) => c.defId === id)!.uid;
const summon = (e: DuelEngine, uid: number, tributes: number[] = []): DuelEvent[] =>
  e.apply({ type: 'normalSummon', handUid: uid, position: 'attack', faceDown: false, tributeUids: tributes });
const endTurn = (e: DuelEngine) => e.apply({ type: 'endTurn' });
const win = (w: ArenaResult['winner']): ArenaResult => ({
  winner: w, attackerHpFrac: 0.5, defenderHpFrac: 0.5, durationSec: 10, spellsUsed: [[], []],
});
const monsterUids = (e: DuelEngine, p: 0 | 1) =>
  e.state.players[p].monsters.filter(Boolean).map((m) => m!.card.uid);

// ---- tests ----------------------------------------------------------------
describe('rng', () => {
  it('is deterministic and in range', () => {
    const a = new Rng(7), b = new Rng(7);
    for (let i = 0; i < 100; i++) {
      const x = a.int(1, 6);
      expect(x).toBe(b.int(1, 6));
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(6);
    }
    expect(new Rng(1).shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('turn flow', () => {
  it('sets up hands, first player skips draw and has no battle on turn 1', () => {
    const e = mk([], []);
    expect(e.state.turn).toBe(1);
    expect(e.state.phase).toBe('main');
    expect(e.state.players[0].hand).toHaveLength(5);
    expect(e.state.players[1].hand).toHaveLength(5);
    expect(e.state.players[0].lp).toBe(LP0);
    const acts = e.legalActions(0);
    expect(acts.some((a) => a.type === 'enterBattle')).toBe(false);
    expect(e.legalActions(1)).toEqual([]);
    expect(() => e.apply({ type: 'enterBattle' })).toThrow();
  });

  it('end turn passes to the opponent, who draws and enters main', () => {
    const e = mk([], []);
    const evs = endTurn(e);
    expect(e.state.turn).toBe(2);
    expect(e.state.activePlayer).toBe(1);
    expect(e.state.phase).toBe('main');
    expect(e.state.players[1].hand).toHaveLength(6);
    expect(evs.some((v) => v.type === 'draw' && v.player === 1)).toBe(true);
    expect(e.legalActions(1).some((a) => a.type === 'enterBattle')).toBe(true);
  });

  it('first player cannot attack on turn 1 even with a monster', () => {
    const e = mk(['t-mid'], []);
    summon(e, handUid(e, 0, 't-mid'));
    expect(e.legalActions(0).some((a) => a.type === 'declareAttack')).toBe(false);
  });

  it('only one normal summon per turn; set must be face-down defense', () => {
    const e = mk(['t-low', 't-mid'], []);
    expect(() => e.apply({ type: 'normalSummon', handUid: handUid(e, 0, 't-low'), position: 'defense', faceDown: false, tributeUids: [] })).toThrow();
    e.apply({ type: 'normalSummon', handUid: handUid(e, 0, 't-low'), position: 'defense', faceDown: true, tributeUids: [] });
    expect(() => summon(e, handUid(e, 0, 't-mid'))).toThrow(/already/);
    expect(e.legalActions(0).some((a) => a.type === 'normalSummon')).toBe(false);
  });

  it('illegal actions do not corrupt state', () => {
    const e = mk([], []);
    const before = e.cloneState();
    expect(() => e.apply({ type: 'declareAttack', attackerUid: 999, targetUid: null })).toThrow();
    expect(e.state).toEqual(before);
  });
});

describe('tribute summon', () => {
  it('level 5 needs 1 tribute, level 7 needs 2; legalActions enumerates combos', () => {
    const e = mk(['t-low', 't-mid', 't-lv7', 't-lv5', 't-wall', 't-low', 't-low', 't-low'], []);
    const lv7 = handUid(e, 0, 't-lv7');
    expect(() => summon(e, lv7)).toThrow(/tribute/);
    summon(e, handUid(e, 0, 't-low'));
    endTurn(e); endTurn(e); // back to P0, turn 3
    summon(e, handUid(e, 0, 't-mid'));
    endTurn(e); endTurn(e); // turn 5
    const mons = monsterUids(e, 0);
    expect(mons).toHaveLength(2);
    const acts = e.legalActions(0).filter((a): a is Extract<DuelAction, { type: 'normalSummon' }> => a.type === 'normalSummon');
    const lv7Acts = acts.filter((a) => a.handUid === lv7);
    expect(lv7Acts).toHaveLength(2); // attack + set, one 2-combo
    const lv5Acts = acts.filter((a) => a.handUid === handUid(e, 0, 't-lv5'));
    expect(lv5Acts).toHaveLength(4); // 2 single tributes x (attack, set)
    expect(() => summon(e, lv7, [mons[0]])).toThrow();
    summon(e, lv7, mons);
    expect(monsterUids(e, 0)).toEqual([lv7]);
    expect(e.state.players[0].graveyard).toHaveLength(2);
  });
});

describe('hand limit', () => {
  it('auto-discards the highest-index card(s) at end of turn', () => {
    const e = mk([], []);
    endTurn(e); // P1 has 6
    endTurn(e); // P0 draws to 6
    // Give P0 extra cards via a draw spell setup: just push from deck to simulate an effect draw.
    const p0 = e.state.players[0];
    p0.hand.push(p0.deck.pop()!, p0.deck.pop()!); // 8 cards
    const last = p0.hand[p0.hand.length - 1].uid;
    endTurn(e);
    expect(p0.hand).toHaveLength(6);
    expect(p0.graveyard.map((c) => c.uid)).toContain(last);
  });

  it('honours discardUids', () => {
    const e = mk([], []);
    endTurn(e);
    endTurn(e);
    const p0 = e.state.players[0];
    p0.hand.push(p0.deck.pop()!);
    const first = p0.hand[0].uid;
    expect(() => e.apply({ type: 'endTurn', discardUids: [first, p0.hand[1].uid] })).toThrow();
    e.apply({ type: 'endTurn', discardUids: [first] });
    expect(p0.graveyard.map((c) => c.uid)).toEqual([first]);
    expect(p0.hand).toHaveLength(6);
  });
});

describe('battle', () => {
  function setupBattle(attackerId = 't-mid', defenderId = 't-low', extra = {}) {
    const e = mk([attackerId], [defenderId], extra);
    endTurn(e); // turn 2: P1
    summon(e, handUid(e, 1, defenderId));
    endTurn(e); // turn 3: P0
    summon(e, handUid(e, 0, attackerId));
    e.apply({ type: 'enterBattle' });
    return e;
  }

  it('monster attack pauses with pendingArena, resolveArena applies result', () => {
    const e = setupBattle();
    const att = monsterUids(e, 0)[0];
    const def = monsterUids(e, 1)[0];
    expect(e.legalActions(0).some((a) => a.type === 'declareAttack' && a.targetUid === null)).toBe(false);
    const evs = e.apply({ type: 'declareAttack', attackerUid: att, targetUid: def });
    const arenaEv = evs.find((v) => v.type === 'arena');
    expect(arenaEv).toBeTruthy();
    expect(e.pendingArena).not.toBeNull();
    expect(e.pendingArena!.attacker.atk).toBe(1500);
    expect(e.pendingArena!.defender.position).toBe('attack');
    expect(e.legalActions(0)).toEqual([]);
    expect(() => e.apply({ type: 'endTurn' })).toThrow(/Arena/);

    const out = e.resolveArena(win('attacker'));
    expect(e.pendingArena).toBeNull();
    expect(monsterUids(e, 1)).toEqual([]);
    expect(e.state.players[1].lp).toBe(LP0 - 500);
    expect(out.some((v) => v.type === 'destroy' && v.uid === def)).toBe(true);
    // attacker already attacked
    expect(e.legalActions(0).some((a) => a.type === 'declareAttack')).toBe(false);
  });

  it('defender win destroys the attacker', () => {
    const e = setupBattle('t-low', 't-mid');
    e.apply({ type: 'declareAttack', attackerUid: monsterUids(e, 0)[0], targetUid: monsterUids(e, 1)[0] });
    e.resolveArena(win('defender'));
    expect(monsterUids(e, 0)).toEqual([]);
    expect(monsterUids(e, 1)).toHaveLength(1);
    expect(e.state.players[0].lp).toBe(LP0 - 500);
  });

  it('arena spells used go to the graveyard', () => {
    const e = mk(['t-mid', 't-arena-spell'], ['t-low']);
    endTurn(e);
    summon(e, handUid(e, 1, 't-low'));
    endTurn(e);
    summon(e, handUid(e, 0, 't-mid'));
    e.apply({ type: 'enterBattle' });
    e.apply({ type: 'declareAttack', attackerUid: monsterUids(e, 0)[0], targetUid: monsterUids(e, 1)[0] });
    const zap = e.pendingArena!.usableSpells[0];
    expect(zap).toHaveLength(1);
    e.resolveArena({ ...win('attacker'), spellsUsed: [[zap[0].uid], []] });
    expect(e.state.players[0].graveyard.map((c) => c.uid)).toContain(zap[0].uid);
  });

  it('direct attack resolves immediately and can win the duel', () => {
    const D = directAttackDamage(1000); // t-low has 1000 ATK; direct attacks deal ATK x directAttackMult
    const e = mk(['t-lv5'], [], { startingLp: 2 * D });
    endTurn(e);
    endTurn(e);
    // put a level-5 down without tributes is illegal; use a low monster instead
    summon(e, handUid(e, 0, 't-low'));
    e.apply({ type: 'enterBattle' });
    const att = monsterUids(e, 0)[0];
    const evs = e.apply({ type: 'declareAttack', attackerUid: att, targetUid: null });
    expect(e.pendingArena).toBeNull();
    expect(e.state.players[1].lp).toBe(D);
    expect(evs.some((v) => v.type === 'lp' && v.delta === -D)).toBe(true);
    endTurn(e); endTurn(e);
    e.apply({ type: 'enterBattle' });
    e.apply({ type: 'declareAttack', attackerUid: att, targetUid: null });
    expect(e.state.winner).toBe(0);
    expect(e.legalActions(0)).toEqual([]);
  });

  it('face-down defender is flipped and reported in defense position', () => {
    const e = mk(['t-mid'], ['t-wall']);
    endTurn(e);
    e.apply({ type: 'normalSummon', handUid: handUid(e, 1, 't-wall'), position: 'defense', faceDown: true, tributeUids: [] });
    endTurn(e);
    summon(e, handUid(e, 0, 't-mid'));
    e.apply({ type: 'enterBattle' });
    const def = monsterUids(e, 1)[0];
    e.apply({ type: 'declareAttack', attackerUid: monsterUids(e, 0)[0], targetUid: def });
    expect(e.pendingArena!.defender.position).toBe('defense');
    expect(e.pendingArena!.defender.defStat).toBe(2000);
    expect(e.state.players[1].monsters.find((m) => m?.card.uid === def)!.faceDown).toBe(false);
    e.resolveArena(win('attacker'));
    expect(e.state.players[1].lp).toBe(LP0); // no damage through defense
  });

  it('uses Formulas.resolveBattle by default', () => {
    const e = new DuelEngine({ deck0: deck(['t-mid']), deck1: deck(['t-low']), seed: 1, shuffle: false });
    endTurn(e);
    summon(e, handUid(e, 1, 't-low'));
    endTurn(e);
    summon(e, handUid(e, 0, 't-mid'));
    e.apply({ type: 'enterBattle' });
    e.apply({ type: 'declareAttack', attackerUid: monsterUids(e, 0)[0], targetUid: monsterUids(e, 1)[0] });
    e.resolveArena(win('attacker'));
    expect(monsterUids(e, 1)).toEqual([]);
    expect(e.state.players[1].lp).toBeLessThan(LP0);
  });
});

describe('deck-out', () => {
  it('a player who must draw from an empty deck loses', () => {
    const e = new DuelEngine({ deck0: deck([], 't-low', 6), deck1: deck([], 't-low', 5), seed: 3, resolveBattle: fakeResolve });
    expect(e.state.players[1].deck).toHaveLength(0);
    const evs = endTurn(e);
    expect(e.state.winner).toBe(0);
    expect(evs.some((v) => v.type === 'gameOver' && v.winner === 0)).toBe(true);
  });
});

describe('spells', () => {
  it('draw spell resolves and goes to the graveyard', () => {
    const e = mk(['t-pot'], []);
    const pot = handUid(e, 0, 't-pot');
    e.apply({ type: 'activateSpell', handUid: pot });
    expect(e.state.players[0].hand).toHaveLength(6);
    expect(e.state.players[0].graveyard.map((c) => c.uid)).toEqual([pot]);
  });

  it('quick spell usable in battle phase, normal spell is not', () => {
    const e = mk(['t-burn', 't-pot'], []);
    endTurn(e); endTurn(e);
    e.apply({ type: 'enterBattle' });
    const acts = e.legalActions(0);
    expect(acts.some((a) => a.type === 'activateSpell' && a.handUid === handUid(e, 0, 't-burn'))).toBe(true);
    expect(acts.some((a) => a.type === 'activateSpell' && a.handUid === handUid(e, 0, 't-pot'))).toBe(false);
    e.apply({ type: 'activateSpell', handUid: handUid(e, 0, 't-burn') });
    expect(e.state.players[1].lp).toBe(LP0 - 500);
  });

  it('Raigeki needs opponent monsters; Fissure needs a valid target', () => {
    const e = mk(['t-raigeki', 't-fissure'], ['t-low']);
    expect(e.legalActions(0).some((a) => a.type === 'activateSpell')).toBe(false);
    endTurn(e);
    summon(e, handUid(e, 1, 't-low'));
    endTurn(e);
    const target = monsterUids(e, 1)[0];
    const fis = handUid(e, 0, 't-fissure');
    expect(e.legalActions(0)).toContainEqual({ type: 'activateSpell', handUid: fis, targetUid: target });
    expect(() => e.apply({ type: 'activateSpell', handUid: fis })).toThrow(/target/);
    e.apply({ type: 'activateSpell', handUid: fis, targetUid: target });
    expect(monsterUids(e, 1)).toEqual([]);
  });

  it('equip spell raises effective ATK and leaves with the monster', () => {
    const e = mk(['t-mid', 't-sword', 't-raigeki'], ['t-raigeki']);
    summon(e, handUid(e, 0, 't-mid'));
    const m = monsterUids(e, 0)[0];
    e.apply({ type: 'activateSpell', handUid: handUid(e, 0, 't-sword'), targetUid: m });
    expect(e.getEffectiveAtk(m)).toBe(2200);
    expect(e.state.players[0].spellTraps.filter(Boolean)).toHaveLength(1);
    endTurn(e);
    e.apply({ type: 'activateSpell', handUid: handUid(e, 1, 't-raigeki') });
    expect(monsterUids(e, 0)).toEqual([]);
    expect(e.state.players[0].spellTraps.filter(Boolean)).toHaveLength(0);
  });
});

describe('traps', () => {
  it('trap cannot be activated the turn it is set; destroyAttacker stops an attack', () => {
    const e = mk(['t-mid'], ['t-armor', 't-low']);
    endTurn(e);
    const armor = handUid(e, 1, 't-armor');
    e.apply({ type: 'setSpellTrap', handUid: armor });
    summon(e, handUid(e, 1, 't-low'));
    endTurn(e);
    summon(e, handUid(e, 0, 't-mid'));
    e.apply({ type: 'enterBattle' });
    const att = monsterUids(e, 0)[0];
    const evs = e.apply({ type: 'declareAttack', attackerUid: att, targetUid: monsterUids(e, 1)[0] });
    expect(e.pendingArena).toBeNull();
    expect(monsterUids(e, 0)).toEqual([]);
    expect(evs.some((v) => v.type === 'activate' && v.uid === armor)).toBe(true);
    expect(e.state.players[1].graveyard.map((c) => c.uid)).toContain(armor);
    expect(monsterUids(e, 1)).toHaveLength(1);
  });

  it('trapPolicy can decline a trap', () => {
    const e = mk(['t-mid'], ['t-armor', 't-low'], { trapPolicy: () => false });
    endTurn(e);
    e.apply({ type: 'setSpellTrap', handUid: handUid(e, 1, 't-armor') });
    summon(e, handUid(e, 1, 't-low'));
    endTurn(e);
    summon(e, handUid(e, 0, 't-mid'));
    e.apply({ type: 'enterBattle' });
    e.apply({ type: 'declareAttack', attackerUid: monsterUids(e, 0)[0], targetUid: monsterUids(e, 1)[0] });
    expect(e.pendingArena).not.toBeNull();
  });

  it('Trap Hole-like trap destroys a summoned monster', () => {
    const e = mk(['t-hole'], ['t-mid']);
    e.apply({ type: 'setSpellTrap', handUid: handUid(e, 0, 't-hole') });
    endTurn(e);
    summon(e, handUid(e, 1, 't-mid'));
    expect(monsterUids(e, 1)).toEqual([]);
    // a trap with only triggered hooks is never a manual activation
    expect(e.legalActions(1).some((a) => a.type === 'activateSet')).toBe(false);
  });
});

describe('clone', () => {
  it('cloned engine is independent and deterministic', () => {
    const e = mk(['t-pot'], []);
    const c = e.clone();
    c.apply({ type: 'activateSpell', handUid: handUid(c, 0, 't-pot') });
    expect(e.state.players[0].hand).toHaveLength(5);
    expect(c.state.players[0].hand).toHaveLength(6);
  });

  it('on() receives events', () => {
    const e = mk([], []);
    const got: string[] = [];
    e.on((v) => got.push(v.type));
    endTurn(e);
    expect(got).toContain('draw');
    expect(got).toContain('phase');
  });
});

describe('real card data + random playouts', () => {
  it('loads src/data via loadDefaultCards and plays random legal games to completion', async () => {
    const { loadDefaultCards, getDecks } = await import('../src/core/cards/CardDB');
    expect(loadDefaultCards()).toBe(true);
    const decks = Object.values(getDecks());
    expect(decks.length).toBeGreaterThanOrEqual(2);
    for (let seed = 1; seed <= 30; seed++) {
      const e = new DuelEngine({ deck0: decks[0], deck1: decks[1], seed });
      const r = new Rng(seed * 7919);
      let steps = 0;
      while (e.state.winner === null && steps++ < 5000) {
        if (e.pendingArena) {
          e.resolveArena({ ...win(r.pick(['attacker', 'defender', 'draw'] as const)), attackerHpFrac: r.next(), defenderHpFrac: r.next() });
          continue;
        }
        const acts = e.legalActions(e.state.activePlayer);
        expect(acts.length).toBeGreaterThan(0);
        const me = e.state.players[e.state.activePlayer];
        if (e.state.phase === 'main' && !me.normalSummonUsed && me.monsters.some((m) => !m)
          && me.hand.some((c) => { const d = getCard(c.defId); return d.kind === 'monster' && (d.level ?? 0) <= 4; })) {
          expect(acts.some((a) => a.type === 'normalSummon' && a.tributeUids.length === 0)).toBe(true);
        }
        // bias towards progress: end turn 15% of the time
        const end = acts.find((a) => a.type === 'endTurn')!;
        e.apply(r.next() < 0.15 ? end : r.pick(acts));
      }
      expect(e.state.winner).not.toBeNull();
      // No card lost or duplicated. Count by OWNER: Monster Reborn can take control of the opponent's card.
      const all = e.state.players.flatMap((p) => [
        ...p.deck, ...p.hand, ...p.graveyard,
        ...p.monsters.filter(Boolean).map((m) => m!.card), ...p.spellTraps.filter(Boolean).map((st) => st!.card),
      ]);
      expect(new Set(all.map((c) => c.uid)).size).toBe(60);
      for (const owner of [0, 1]) expect(all.filter((c) => c.owner === owner)).toHaveLength(30);
    }
  });
});
