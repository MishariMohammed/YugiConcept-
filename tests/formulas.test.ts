import { describe, it, expect } from 'vitest';
import type { ArenaResult, CardDef, MonsterType } from '../src/core/types';
import {
  TUNING, arenaStats, damageAfterResistance, hitDamage, performanceMultiplier, resolveBattle,
  styleForType, styleForCard, suddenDeathDps, baseBattleDamage, directAttackDamage, tributesRequired,
  abilityValue, abilityBudget, validateAbilities, defaultAbilityForStyle,
} from '../src/core/combat/Formulas';

const card = (over: Partial<CardDef> = {}): CardDef => ({
  id: 'x', name: 'X', kind: 'monster', text: '', monsterType: 'Warrior', level: 4, atk: 1500, def: 1200, ...over,
});

const arena = (winner: ArenaResult['winner'], aHp = 0.5, dHp = 0.5): ArenaResult => ({
  winner, attackerHpFrac: winner === 'attacker' ? aHp : 0, defenderHpFrac: winner === 'defender' ? dHp : 0,
  durationSec: 10, spellsUsed: [[], []],
});

describe('styleForType', () => {
  it('maps every MonsterType to a style', () => {
    const types: MonsterType[] = ['Spellcaster', 'Dragon', 'Warrior', 'Beast', 'Beast-Warrior', 'Fiend', 'Zombie',
      'Machine', 'Aqua', 'Pyro', 'Rock', 'Winged Beast', 'Plant', 'Insect', 'Thunder', 'Fairy', 'Fish',
      'Sea Serpent', 'Reptile', 'Dinosaur', 'Psychic'];
    for (const t of types) expect(['melee', 'ranged', 'bruiser', 'swift']).toContain(styleForType(t));
  });
  it('uses key examples', () => {
    expect(styleForType('Spellcaster')).toBe('ranged');
    expect(styleForType('Warrior')).toBe('melee');
    expect(styleForType('Dragon')).toBe('bruiser');
    expect(styleForType('Winged Beast')).toBe('swift');
  });
  it('respects arenaStyle override', () => {
    expect(styleForCard(card({ monsterType: 'Dragon', arenaStyle: 'swift' }))).toBe('swift');
    expect(styleForCard(card({ monsterType: undefined }))).toBe('melee');
  });
});

describe('arenaStats monotonicity', () => {
  const c = card();
  it('higher ATK -> more power (and HP)', () => {
    let prevP = -1, prevH = -1;
    for (let atk = 0; atk <= 4000; atk += 250) {
      const s = arenaStats(c, atk, 1200);
      expect(s.power).toBeGreaterThan(prevP);
      expect(s.maxHp).toBeGreaterThanOrEqual(prevH);
      prevP = s.power; prevH = s.maxHp;
    }
  });
  it('higher DEF -> more HP, same power', () => {
    let prevH = -1;
    const p0 = arenaStats(c, 1500, 0).power;
    for (let def = 0; def <= 4000; def += 250) {
      const s = arenaStats(c, 1500, def);
      // Below the HP DEF floor (ATK x hpDefFloorFrac) HP is flat; above it strictly increasing.
      if (def > 1500 * TUNING.arena.hpDefFloorFrac) expect(s.maxHp).toBeGreaterThan(prevH);
      else expect(s.maxHp).toBeGreaterThanOrEqual(prevH);
      expect(s.power).toBeCloseTo(p0);
      prevH = s.maxHp;
    }
  });
  it('glass cannons get the HP DEF floor but no resistance from it', () => {
    const spear = arenaStats(c, 1900, 0), floor = arenaStats(c, 1900, 1900 * TUNING.arena.hpDefFloorFrac);
    expect(spear.maxHp).toBe(floor.maxHp);
    expect(spear.def).toBe(0);
  });
  it('higher DEF -> more resistance', () => {
    let prev = Infinity;
    for (let def = 0; def <= 4000; def += 250) {
      const d = damageAfterResistance(100, def);
      expect(d).toBeLessThan(prev);
      expect(d).toBeGreaterThan(0);
      prev = d;
    }
    expect(damageAfterResistance(100, 0)).toBe(100);
    expect(damageAfterResistance(-5, 1000)).toBe(0);
  });
  it('defense position fights with DEF as offensive stat', () => {
    const wall = card({ atk: 0, def: 2000 });
    expect(arenaStats(wall, 0, 2000, 'defense').power).toBeCloseTo(arenaStats(wall, 2000, 2000).power);
    expect(arenaStats(wall, 0, 2000, 'defense').power).toBeGreaterThan(arenaStats(wall, 0, 2000).power);
  });
  it('style profile is applied', () => {
    const s = arenaStats(card({ monsterType: 'Spellcaster' }), 1500, 1200);
    expect(s.style).toBe('ranged');
    expect(s.range).toBe(TUNING.styles.ranged.range);
    expect(s.attackInterval).toBe(TUNING.styles.ranged.attackInterval);
    expect(s.speed).toBe(TUNING.styles.ranged.speed);
  });
  it('hitDamage is capped and floored', () => {
    const target = { maxHp: 500, def: 0 };
    expect(hitDamage(10000, 1, target)).toBeCloseTo(500 * TUNING.arena.maxHitFrac);
    expect(hitDamage(0, 1, target)).toBe(TUNING.arena.minHit);
  });
});

describe('performanceMultiplier', () => {
  it('maps 0..1 to 0.75..1.5, clamped and monotonic', () => {
    expect(performanceMultiplier(0)).toBeCloseTo(0.75);
    expect(performanceMultiplier(1)).toBeCloseTo(1.5);
    expect(performanceMultiplier(-1)).toBeCloseTo(0.75);
    expect(performanceMultiplier(2)).toBeCloseTo(1.5);
    expect(performanceMultiplier(NaN)).toBeCloseTo(0.75);
    expect(performanceMultiplier(0.6)).toBeGreaterThan(performanceMultiplier(0.4));
  });
});

describe('suddenDeathDps', () => {
  it('is zero before the start and ramps after', () => {
    const t0 = TUNING.arena.suddenDeathAtSec;
    expect(suddenDeathDps(0)).toBe(0);
    expect(suddenDeathDps(t0 - 0.01)).toBe(0);
    expect(suddenDeathDps(t0)).toBeCloseTo(TUNING.arena.suddenDeathBaseFrac);
    expect(suddenDeathDps(t0 + 2)).toBeGreaterThan(suddenDeathDps(t0 + 1));
  });
  it('kills a full-HP fighter before the hard cap', () => {
    let hp = 1, t = TUNING.arena.suddenDeathAtSec;
    while (hp > 0 && t < TUNING.arena.hardCapSec) { hp -= suddenDeathDps(t) * 0.05; t += 0.05; }
    expect(hp).toBeLessThanOrEqual(0);
  });
});

describe('resolveBattle: Attack Position defender', () => {
  const D = (atk: number, def = 1000) => ({ atk, def, position: 'attack' as const });

  it('attacker higher ATK wins: defender destroyed, defender takes gap * perf', () => {
    const r = resolveBattle(1800, D(1500), arena('attacker', 1));
    expect(r).toEqual({ attackerDestroyed: false, defenderDestroyed: true, lpDamage: [0, 450] });
    const r2 = resolveBattle(1800, D(1500), arena('attacker', 0));
    expect(r2.lpDamage).toEqual([0, 230]); // 300*0.75 = 225 -> rounded to 10
  });
  it('defender higher ATK wins: attacker destroyed, attacker side takes gap * perf', () => {
    const r = resolveBattle(1500, D(2000), arena('defender', 0.5, 0.5));
    expect(r.attackerDestroyed).toBe(true);
    expect(r.defenderDestroyed).toBe(false);
    expect(r.lpDamage).toEqual([Math.round((500 * 1.125) / 10) * 10, 0]);
  });
  it('equal ATK: winner deals minBattleDamage * perf', () => {
    const r = resolveBattle(1500, D(1500), arena('attacker', 1));
    expect(r.lpDamage).toEqual([0, TUNING.battle.minBattleDamage * 1.5]);
    const r2 = resolveBattle(1500, D(1500), arena('defender', 0, 1));
    expect(r2.lpDamage).toEqual([TUNING.battle.minBattleDamage * 1.5, 0]);
  });
  it('upset by attacker (lower ATK wins): defender destroyed, damage = |gap|*upsetFactor', () => {
    const r = resolveBattle(1200, D(2000), arena('attacker', 1));
    expect(r.defenderDestroyed).toBe(true);
    expect(r.attackerDestroyed).toBe(false);
    expect(r.lpDamage).toEqual([0, 800 * TUNING.battle.upsetDamageFactor * 1.5]);
  });
  it('upset by defender (lower ATK wins): attacker destroyed, attacker side takes reduced damage', () => {
    const r = resolveBattle(2000, D(1200), arena('defender', 0, 0));
    expect(r.attackerDestroyed).toBe(true);
    expect(r.lpDamage).toEqual([Math.round((800 * TUNING.battle.upsetDamageFactor * 0.75) / 10) * 10, 0]);
  });
  it('small upset floors at minBattleDamage', () => {
    expect(baseBattleDamage(1450, 1500)).toBe(TUNING.battle.minBattleDamage);
  });
  it('draw: both destroyed, no damage', () => {
    expect(resolveBattle(1500, D(1500), arena('draw'))).toEqual({ attackerDestroyed: true, defenderDestroyed: true, lpDamage: [0, 0] });
  });
  it('uses defender ATK, not DEF, in attack position', () => {
    const r = resolveBattle(1800, { atk: 1000, def: 3000, position: 'attack' }, arena('attacker', 1));
    expect(r.lpDamage[1]).toBe(1200);
  });
});

describe('resolveBattle: Defense Position defender', () => {
  const D = (def: number, atk = 0) => ({ atk, def, position: 'defense' as const });

  it('attacker wins: defender destroyed, NO LP damage (no piercing)', () => {
    expect(resolveBattle(2000, D(1000), arena('attacker', 1))).toEqual({ attackerDestroyed: false, defenderDestroyed: true, lpDamage: [0, 0] });
  });
  it('attacker wins as underdog: still no LP damage', () => {
    expect(resolveBattle(1000, D(2000), arena('attacker', 1)).lpDamage).toEqual([0, 0]);
  });
  it('defender wins with DEF > ATK: attacker destroyed, attacker side takes (DEF-ATK) * perf', () => {
    const r = resolveBattle(1800, D(2000), arena('defender', 0, 1));
    expect(r).toEqual({ attackerDestroyed: true, defenderDestroyed: false, lpDamage: [300, 0] });
  });
  it('defender wins as underdog (DEF < ATK): attacker side takes upset damage', () => {
    const r = resolveBattle(2000, D(1000), arena('defender', 0, 1));
    expect(r.lpDamage).toEqual([1000 * TUNING.battle.upsetDamageFactor * 1.5, 0]);
    expect(r.attackerDestroyed).toBe(true);
  });
  it('uses defender DEF, not ATK, in defense position', () => {
    const r = resolveBattle(1500, D(2000, 3000), arena('defender', 0, 0));
    expect(r.lpDamage[0]).toBe(Math.round((500 * 0.75) / 10) * 10);
  });
  it('draw: neither destroyed, no damage', () => {
    expect(resolveBattle(1500, D(1500), arena('draw'))).toEqual({ attackerDestroyed: false, defenderDestroyed: false, lpDamage: [0, 0] });
  });
  it('defending player never takes damage in any defense-position case', () => {
    for (const w of ['attacker', 'defender', 'draw'] as const)
      for (const atk of [500, 1500, 3000]) expect(resolveBattle(atk, D(1500), arena(w, 1, 1)).lpDamage[1]).toBe(0);
  });
});

describe('LP damage scales with performance', () => {
  it('more winner HP -> more LP damage', () => {
    const lo = resolveBattle(2500, { atk: 1500, def: 0, position: 'attack' }, arena('attacker', 0.1));
    const hi = resolveBattle(2500, { atk: 1500, def: 0, position: 'attack' }, arena('attacker', 0.9));
    expect(hi.lpDamage[1]).toBeGreaterThan(lo.lpDamage[1]);
    expect(lo.lpDamage[1] % TUNING.battle.roundTo).toBe(0);
  });
});

describe('duel helpers', () => {
  it('tribute rules', () => {
    expect(tributesRequired(1)).toBe(0);
    expect(tributesRequired(4)).toBe(0);
    expect(tributesRequired(5)).toBe(1);
    expect(tributesRequired(6)).toBe(1);
    expect(tributesRequired(7)).toBe(2);
    expect(tributesRequired(8)).toBe(2);
  });
  it('direct attack = ATK x directAttackMult, rounded', () => {
    expect(directAttackDamage(1800)).toBe(Math.round((1800 * TUNING.battle.directAttackMult) / 10) * 10);
    expect(directAttackDamage(3000)).toBeLessThanOrEqual(3000);
    expect(directAttackDamage(-5)).toBe(0);
  });
  it('starting values', () => {
    expect(TUNING.duel.startingLp).toBe(8000);
    expect(TUNING.duel.deckSize).toBe(30);
    expect(TUNING.duel.openingHand).toBe(5);
    expect(TUNING.duel.handLimit).toBe(6);
  });
});

describe('ability budgets', () => {
  it('default abilities fit every level budget', () => {
    for (const style of ['melee', 'ranged', 'bruiser', 'swift'] as const) {
      const ab = defaultAbilityForStyle(style);
      expect(abilityValue(ab, style)).toBeLessThanOrEqual(abilityBudget(1).budget);
    }
  });
  it('budget grows with level', () => {
    expect(abilityBudget(8).budget).toBeGreaterThan(abilityBudget(4).budget);
    expect(abilityBudget(0).budget).toBe(abilityBudget(1).budget);
    expect(abilityBudget(12).budget).toBe(abilityBudget(10).budget);
  });
  it('validateAbilities flags over-budget cards', () => {
    const ok = card({ level: 7, arenaAbilities: [{ id: 'a', name: 'A', kind: 'projectile', power: 2, cooldown: 6, description: '' }] });
    expect(validateAbilities(ok)).toEqual([]);
    const bad = card({ level: 4, arenaAbilities: [
      { id: 'a', name: 'A', kind: 'projectile', power: 3, cooldown: 4, description: '' },
      { id: 'b', name: 'B', kind: 'stun', power: 0, cooldown: 3, duration: 2, description: '' },
      { id: 'c', name: 'C', kind: 'heal', power: 0, cooldown: 10, magnitude: 0.2, description: '' },
    ] });
    expect(validateAbilities(bad).length).toBeGreaterThan(2);
  });
});
