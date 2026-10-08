// One or more tests per duel effect id used in src/data/cards.json (real card data).
import { describe, expect, it } from 'vitest';
import cardsJson from '../src/data/cards.json';
import { getCard, registerCards } from '../src/core/cards/CardDB';
import { allEffectIds } from '../src/core/cards/EffectRegistry';
import { DuelEngine, type ResolveBattleFn } from '../src/core/duel/DuelEngine';
import type { ArenaResult, CardDef, DuelAction, PlayerId, Position } from '../src/core/types';

const CARDS = cardsJson as CardDef[];
registerCards(CARDS);

// Deterministic battle resolution (same shape as Formulas.resolveBattle, without the perf multiplier).
const fakeResolve: ResolveBattleFn = (atk, d, arena) => {
  const stat = d.position === 'attack' ? d.atk : d.def;
  if (arena.winner === 'attacker') {
    return { attackerDestroyed: false, defenderDestroyed: true, lpDamage: [0, d.position === 'attack' ? Math.max(0, atk - stat) : 0] };
  }
  if (arena.winner === 'defender') {
    return { attackerDestroyed: true, defenderDestroyed: false, lpDamage: [Math.max(100, stat - atk), 0] };
  }
  return { attackerDestroyed: d.position === 'attack', defenderDestroyed: d.position === 'attack', lpDamage: [0, 0] };
};
const win = (w: ArenaResult['winner']): ArenaResult => ({
  winner: w, attackerHpFrac: 0.5, defenderHpFrac: 0.5, durationSec: 10, spellsUsed: [[], []],
});

// ---- fixture helpers (tests may set up state directly; the engine reads it fresh) ----
function mk(): DuelEngine {
  const filler = Array(30).fill('silver-fang');
  return new DuelEngine({ deck0: filler, deck1: filler, seed: 1, shuffle: false, resolveBattle: fakeResolve });
}
const lp = (e: DuelEngine, p: PlayerId) => e.state.players[p].lp;
function give(e: DuelEngine, p: PlayerId, id: string): number {
  getCard(id);
  const uid = e.state.nextUid++;
  e.state.players[p].hand.push({ uid, defId: id, owner: p });
  return uid;
}
function place(e: DuelEngine, p: PlayerId, id: string, position: Position = 'attack', faceDown = false): number {
  const uid = e.state.nextUid++;
  const zones = e.state.players[p].monsters;
  zones[zones.indexOf(null)] = {
    card: { uid, defId: id, owner: p }, position, faceDown,
    summonedThisTurn: false, attackedThisTurn: false, changedPositionThisTurn: false, atkMod: 0, defMod: 0,
  };
  return uid;
}
function setCard(e: DuelEngine, p: PlayerId, id: string): number {
  const uid = e.state.nextUid++;
  const zones = e.state.players[p].spellTraps;
  zones[zones.indexOf(null)] = { card: { uid, defId: id, owner: p }, faceDown: true, setThisTurn: false };
  return uid;
}
function toGY(e: DuelEngine, p: PlayerId, id: string): number {
  const uid = e.state.nextUid++;
  e.state.players[p].graveyard.push({ uid, defId: id, owner: p });
  return uid;
}
const onField = (e: DuelEngine, uid: number) =>
  e.state.players.some((p) => p.monsters.some((m) => m?.card.uid === uid) || p.spellTraps.some((s) => s?.card.uid === uid));
const slot = (e: DuelEngine, uid: number) =>
  e.state.players.flatMap((p) => p.monsters).find((m) => m?.card.uid === uid)!;
const endTurn = (e: DuelEngine) => e.apply({ type: 'endTurn' });
/** Advance to turn 3 (player 0, main phase) so attacks are legal. */
function turn3(e: DuelEngine): void { endTurn(e); endTurn(e); }
const attack = (e: DuelEngine, a: number, t: number | null) => e.apply({ type: 'declareAttack', attackerUid: a, targetUid: t });
const has = (acts: DuelAction[], pred: (a: DuelAction) => boolean) => acts.some(pred);
const activate = (e: DuelEngine, handUid: number, targetUid?: number) =>
  e.apply(targetUid === undefined ? { type: 'activateSpell', handUid } : { type: 'activateSpell', handUid, targetUid });

// ---------------------------------------------------------------------------

describe('effect registry coverage', () => {
  it('every effect id used by cards.json is registered', () => {
    const used = new Set(CARDS.map((c) => c.effect?.id).filter((x): x is string => !!x));
    const reg = new Set(allEffectIds());
    expect([...used].filter((id) => !reg.has(id))).toEqual([]);
  });
});

describe('spells', () => {
  it('draw (Pot of Greed) draws 2', () => {
    const e = mk();
    const pot = give(e, 0, 'pot-of-greed');
    const n = e.state.players[0].hand.length;
    activate(e, pot);
    expect(e.state.players[0].hand.length).toBe(n - 1 + 2);
  });

  it('damage (Ookazi) deals 800 to the opponent', () => {
    const e = mk();
    activate(e, give(e, 0, 'ookazi'));
    expect(lp(e, 1)).toBe(3200);
  });

  it('heal (Dian Keto) gains 1000 LP', () => {
    const e = mk();
    activate(e, give(e, 0, 'dian-keto-the-cure-master'));
    expect(lp(e, 0)).toBe(5000);
  });

  it('destroyAllOpponentMonsters (Raigeki) clears only the opponent', () => {
    const e = mk();
    const mine = place(e, 0, 'celtic-guardian');
    const a = place(e, 1, 'battle-ox'), b = place(e, 1, 'krokodilus', 'defense', true);
    activate(e, give(e, 0, 'raigeki'));
    expect(onField(e, mine)).toBe(true);
    expect(onField(e, a) || onField(e, b)).toBe(false);
  });

  it('destroyAllMonsters (Dark Hole) clears both sides; not activatable on an empty field', () => {
    const e = mk();
    const hole = give(e, 0, 'dark-hole');
    expect(has(e.legalActions(0), (a) => a.type === 'activateSpell' && a.handUid === hole)).toBe(false);
    const mine = place(e, 0, 'celtic-guardian');
    const theirs = place(e, 1, 'battle-ox');
    activate(e, hole);
    expect(onField(e, mine) || onField(e, theirs)).toBe(false);
  });

  it('destroyLowestAtkOpponent (Fissure) destroys the lowest-ATK face-up opponent monster', () => {
    const e = mk();
    const ox = place(e, 1, 'battle-ox');
    const krok = place(e, 1, 'krokodilus');
    const hidden = place(e, 1, 'saggi-the-dark-clown', 'defense', true); // face-down: ignored
    activate(e, give(e, 0, 'fissure'));
    expect(onField(e, krok)).toBe(false);
    expect(onField(e, ox)).toBe(true);
    expect(onField(e, hidden)).toBe(true);
  });

  it('destroyTargetSpellTrap (Mystical Space Typhoon) destroys a target spell/trap', () => {
    const e = mk();
    const trap = setCard(e, 1, 'mirror-force');
    const mst = give(e, 0, 'mystical-space-typhoon');
    activate(e, mst, trap);
    expect(onField(e, trap)).toBe(false);
    expect(e.state.players[1].graveyard.some((c) => c.uid === trap)).toBe(true);
  });

  it("monsterReborn revives from the opponent's graveyard under your control", () => {
    const e = mk();
    const bewd = toGY(e, 1, 'blue-eyes-white-dragon');
    activate(e, give(e, 0, 'monster-reborn'), bewd);
    const m = e.state.players[0].monsters.find((s) => s?.card.uid === bewd);
    expect(m?.position).toBe('attack');
    expect(m?.card.owner).toBe(1);
    expect(e.state.players[1].graveyard.some((c) => c.uid === bewd)).toBe(false);
  });

  it('swordsOfRevealingLight flips, stops attacks, and expires after 3 opponent turns', () => {
    const e = mk();
    const hidden = place(e, 1, 'vorse-raider', 'defense', true);
    const swords = give(e, 0, 'swords-of-revealing-light');
    activate(e, swords);
    expect(slot(e, hidden).faceDown).toBe(false);
    slot(e, hidden).position = 'attack';
    endTurn(e); // turn 2: P1
    e.apply({ type: 'enterBattle' });
    expect(has(e.legalActions(1), (a) => a.type === 'declareAttack')).toBe(false);
    expect(() => attack(e, hidden, null)).toThrow(/prevents/);
    endTurn(e); // 1 opponent turn done
    endTurn(e); endTurn(e); // 2
    expect(onField(e, swords)).toBe(true);
    endTurn(e); endTurn(e); // turn 6 (P1) ends -> 3
    expect(onField(e, swords)).toBe(false);
  });

  it('equipAtk (Book of Secret Arts) only equips a Spellcaster, +300/+300', () => {
    const e = mk();
    const dm = place(e, 0, 'dark-magician');
    const warrior = place(e, 0, 'celtic-guardian');
    const book = give(e, 0, 'book-of-secret-arts');
    const targets = e.legalActions(0).filter((a) => a.type === 'activateSpell' && a.handUid === book)
      .map((a) => (a as { targetUid?: number }).targetUid);
    expect(targets).toEqual([dm]);
    expect(() => activate(e, book, warrior)).toThrow();
    activate(e, book, dm);
    expect(e.getEffectiveAtk(dm)).toBe(2800);
    expect(e.getEffectiveDef(dm)).toBe(2400);
  });

  it('rushRecklessly gives +700 ATK until the end of the turn', () => {
    const e = mk();
    const m = place(e, 0, 'celtic-guardian');
    activate(e, give(e, 0, 'rush-recklessly'), m);
    expect(e.getEffectiveAtk(m)).toBe(2100);
    endTurn(e);
    expect(e.getEffectiveAtk(m)).toBe(1400);
  });
});

describe('traps', () => {
  it('destroyAttackPosition (Mirror Force) destroys all attack-position attackers', () => {
    const e = mk();
    const a = place(e, 0, 'celtic-guardian'), b = place(e, 0, 'feral-imp'), c = place(e, 0, 'mystical-elf', 'defense');
    setCard(e, 1, 'mirror-force');
    turn3(e);
    e.apply({ type: 'enterBattle' });
    attack(e, a, null);
    expect([onField(e, a), onField(e, b), onField(e, c)]).toEqual([false, false, true]);
    expect(lp(e, 1)).toBe(4000);
  });

  it('destroyAttacker (Sakuretsu Armor) destroys the attacker', () => {
    const e = mk();
    const a = place(e, 0, 'celtic-guardian');
    setCard(e, 1, 'sakuretsu-armor');
    turn3(e);
    e.apply({ type: 'enterBattle' });
    attack(e, a, null);
    expect(onField(e, a)).toBe(false);
    expect(lp(e, 1)).toBe(4000);
  });

  it('destroySummoned (Trap Hole) hits a summon with ATK >= 1000 only', () => {
    const e = mk();
    setCard(e, 1, 'trap-hole');
    const saggi = give(e, 0, 'saggi-the-dark-clown');
    e.apply({ type: 'normalSummon', handUid: saggi, position: 'attack', faceDown: false, tributeUids: [] });
    expect(onField(e, saggi)).toBe(true);
    turn3(e);
    const ox = give(e, 0, 'battle-ox');
    e.apply({ type: 'normalSummon', handUid: ox, position: 'attack', faceDown: false, tributeUids: [] });
    expect(onField(e, ox)).toBe(false);
  });

  it('negateAttack stops the attack and ends the Battle Phase', () => {
    const e = mk();
    const a = place(e, 0, 'celtic-guardian'), b = place(e, 0, 'feral-imp');
    setCard(e, 1, 'negate-attack');
    turn3(e);
    e.apply({ type: 'enterBattle' });
    attack(e, a, null);
    expect(lp(e, 1)).toBe(4000);
    expect(has(e.legalActions(0), (x) => x.type === 'declareAttack')).toBe(false);
    expect(() => attack(e, b, null)).toThrow(/Battle Phase/);
    endTurn(e); endTurn(e); // battle works again next turn
    e.apply({ type: 'enterBattle' });
    expect(has(e.legalActions(0), (x) => x.type === 'declareAttack')).toBe(true);
  });

  it('waboku: no battle damage and no battle destruction this turn', () => {
    const e = mk();
    const a = place(e, 0, 'vorse-raider'), b = place(e, 0, 'battle-ox');
    const d1 = place(e, 1, 'krokodilus');
    setCard(e, 1, 'waboku');
    turn3(e);
    e.apply({ type: 'enterBattle' });
    attack(e, a, d1);
    expect(e.pendingArena).not.toBeNull();
    e.resolveArena(win('attacker'));
    expect(onField(e, d1)).toBe(true);
    expect(lp(e, 1)).toBe(4000);
    attack(e, b, d1); // still protected for the rest of the turn
    e.resolveArena(win('attacker'));
    expect(onField(e, d1)).toBe(true);
    expect(lp(e, 1)).toBe(4000);
  });

  it("magicCylinder negates and deals the attacker's ATK to its controller", () => {
    const e = mk();
    const a = place(e, 0, 'vorse-raider');
    setCard(e, 1, 'magic-cylinder');
    turn3(e);
    e.apply({ type: 'enterBattle' });
    attack(e, a, null);
    expect(lp(e, 0)).toBe(4000 - 1900);
    expect(lp(e, 1)).toBe(4000);
  });

  it('spellbindingCircle locks the target and leaves with it', () => {
    const e = mk();
    const target = place(e, 1, 'battle-ox');
    const sbc = setCard(e, 0, 'spellbinding-circle');
    endTurn(e); endTurn(e); // turn 3: P0 can flip the set trap
    e.apply({ type: 'activateSet', uid: sbc, targetUid: target });
    endTurn(e); // P1's turn
    expect(has(e.legalActions(1), (a) => a.type === 'changePosition' && a.uid === target)).toBe(false);
    e.apply({ type: 'enterBattle' });
    expect(has(e.legalActions(1), (a) => a.type === 'declareAttack' && a.attackerUid === target)).toBe(false);
    endTurn(e);
    activate(e, give(e, 0, 'raigeki'));
    expect(onField(e, sbc)).toBe(false);
  });
});

describe('monster effects', () => {
  it('atkPerNamedInGraveyards (Dark Magician Girl) +300 per Dark Magician in either GY', () => {
    const e = mk();
    const dmg = place(e, 0, 'dark-magician-girl');
    expect(e.getEffectiveAtk(dmg)).toBe(2000);
    toGY(e, 0, 'dark-magician');
    toGY(e, 1, 'dark-magician');
    expect(e.getEffectiveAtk(dmg)).toBe(2600);
    slot(e, dmg).faceDown = true;
    slot(e, dmg).position = 'defense';
    expect(e.getEffectiveAtk(dmg)).toBe(2000); // face-down: no effect
  });

  it('atkPerOwnGraveyardMonster (Swordstalker) counts only own GY monsters', () => {
    const e = mk();
    const s = place(e, 1, 'swordstalker');
    toGY(e, 1, 'battle-ox'); toGY(e, 1, 'krokodilus'); toGY(e, 1, 'pot-of-greed'); toGY(e, 0, 'kuriboh');
    expect(e.getEffectiveAtk(s)).toBe(2200);
  });

  it('allyBoost (Y-Dragon Head) +400/+400 while X-Head Cannon is face-up', () => {
    const e = mk();
    const y = place(e, 1, 'y-dragon-head');
    expect(e.getEffectiveAtk(y)).toBe(1500);
    place(e, 1, 'x-head-cannon');
    expect(e.getEffectiveAtk(y)).toBe(1900);
    expect(e.getEffectiveDef(y)).toBe(2000);
  });

  it('noBattleDamageWhenDestroyed (Kuriboh) prevents battle damage when it dies', () => {
    const e = mk();
    const a = place(e, 0, 'vorse-raider');
    const k = place(e, 1, 'kuriboh');
    turn3(e);
    e.apply({ type: 'enterBattle' });
    attack(e, a, k);
    e.resolveArena(win('attacker'));
    expect(onField(e, k)).toBe(false);
    expect(lp(e, 1)).toBe(4000);
  });

  it('switchToAttackAfterAttacked (Big Shield Gardna) goes to Attack Position after surviving', () => {
    const e = mk();
    const a = place(e, 0, 'celtic-guardian');
    const g = place(e, 1, 'big-shield-gardna', 'defense', true);
    turn3(e);
    e.apply({ type: 'enterBattle' });
    attack(e, a, g);
    e.resolveArena(win('defender'));
    expect(onField(e, g)).toBe(true);
    expect(slot(e, g).position).toBe('attack');
  });

  it('piercing (Spear Dragon) deals ATK-DEF through defense, then switches to Defense', () => {
    const e = mk();
    const sd = place(e, 0, 'spear-dragon');
    const elf = place(e, 1, 'saggi-the-dark-clown', 'defense');
    turn3(e);
    e.apply({ type: 'enterBattle' });
    attack(e, sd, elf);
    e.resolveArena(win('attacker'));
    expect(lp(e, 1)).toBe(4000 - (1900 - 1500));
    expect(slot(e, sd).position).toBe('defense');
  });

  it('piercing: Spear Dragon also switches to Defense after a direct attack', () => {
    const e = mk();
    const sd = place(e, 0, 'spear-dragon');
    turn3(e);
    e.apply({ type: 'enterBattle' });
    attack(e, sd, null);
    expect(lp(e, 1)).toBe(2100);
    expect(slot(e, sd).position).toBe('defense');
  });

  it('breakerCounter: +300 on Normal Summon; ignition removes it to destroy a spell/trap', () => {
    const e = mk();
    const st = setCard(e, 1, 'mirror-force');
    const br = give(e, 0, 'breaker-the-magical-warrior');
    e.apply({ type: 'normalSummon', handUid: br, position: 'attack', faceDown: false, tributeUids: [] });
    expect(e.getEffectiveAtk(br)).toBe(1900);
    const acts = e.legalActions(0).filter((a) => a.type === 'activateMonster');
    expect(acts).toEqual([{ type: 'activateMonster', uid: br, targetUid: st }]);
    e.apply(acts[0]);
    expect(onField(e, st)).toBe(false);
    expect(e.getEffectiveAtk(br)).toBe(1600);
    setCard(e, 1, 'trap-hole');
    expect(has(e.legalActions(0), (a) => a.type === 'activateMonster')).toBe(false);
  });

  it('breakerCounter: no counter when Special Summoned', () => {
    const e = mk();
    const br = toGY(e, 0, 'breaker-the-magical-warrior');
    activate(e, give(e, 0, 'monster-reborn'), br);
    expect(e.getEffectiveAtk(br)).toBe(1600);
  });

  it('protectTypeFromTargeting (Lord of D.) stops targeting Dragons, not non-targeting effects', () => {
    const e = mk();
    place(e, 1, 'lord-of-d');
    const bewd = place(e, 1, 'blue-eyes-white-dragon');
    const ox = place(e, 1, 'battle-ox');
    const rush = give(e, 0, 'rush-recklessly');
    const targets = e.legalActions(0).filter((a) => a.type === 'activateSpell' && a.handUid === rush)
      .map((a) => (a as { targetUid?: number }).targetUid);
    expect(targets).not.toContain(bewd);
    expect(targets).toContain(ox);
    expect(() => activate(e, rush, bewd)).toThrow();
    activate(e, give(e, 0, 'raigeki'));
    expect(onField(e, bewd)).toBe(false);
  });

  it('doubleTribute (Kaiser Sea Horse) counts as 2 tributes for a LIGHT monster only', () => {
    const e = mk();
    const ksh = place(e, 1, 'kaiser-sea-horse');
    endTurn(e); // P1's turn 2
    const bewd = give(e, 1, 'blue-eyes-white-dragon');
    const dm = give(e, 1, 'dark-magician'); // DARK: needs 2 real tributes
    const acts = e.legalActions(1);
    expect(has(acts, (a) => a.type === 'normalSummon' && a.handUid === bewd && a.tributeUids.length === 1)).toBe(true);
    expect(has(acts, (a) => a.type === 'normalSummon' && a.handUid === dm)).toBe(false);
    expect(() => e.apply({ type: 'normalSummon', handUid: dm, position: 'attack', faceDown: false, tributeUids: [ksh] })).toThrow(/tribute/);
    e.apply({ type: 'normalSummon', handUid: bewd, position: 'attack', faceDown: false, tributeUids: [ksh] });
    expect(onField(e, bewd)).toBe(true);
  });
});
