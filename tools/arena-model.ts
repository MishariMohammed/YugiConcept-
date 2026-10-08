// Quick Monte-Carlo model of an arena fight, built on src/core/combat/Formulas.ts.
// Not the real ArenaSim: movement is abstracted to an engage delay, and skill is a single
// hit-rate per side (player aim+dodging folded into "my hits land" vs "enemy hits land").
//
// Run: npx tsx tools/arena-model.ts [trials]

import type { ArenaStyle, CardDef, Position } from '../src/core/types';
import {
  TUNING, arenaStats, hitDamage, suddenDeathDps, defaultAbilityForStyle, type ArenaStats,
} from '../src/core/combat/Formulas';

// ---- tiny seeded RNG (mulberry32) so runs are reproducible ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seconds before a style lands its first basic attack (closing distance). */
const ENGAGE: Record<ArenaStyle, number> = { melee: 1.0, bruiser: 1.2, swift: 0.6, ranged: 0.3 };
/** Hit-rate modifiers: projectiles are more dodgeable; swift monsters are harder to hit. */
const ACC_MOD: Record<ArenaStyle, number> = { melee: 1.0, bruiser: 1.0, swift: 1.0, ranged: 0.95 };
const EVADE_MOD: Record<ArenaStyle, number> = { melee: 0, bruiser: 0, swift: 0.05, ranged: 0.03 };

export interface Fighter {
  label: string;
  atk: number;
  def: number;
  style: ArenaStyle;
  position?: Position;
  hitRate: number;
}

interface Live {
  st: ArenaStats;
  hp: number;
  nextAtk: number;
  nextAbility: number;
  stunUntil: number;
  hitRate: number;
}

function mkCard(style: ArenaStyle): CardDef {
  return { id: 'm', name: 'm', kind: 'monster', text: '', arenaStyle: style };
}

const DT = 0.05;

/** One fight. Returns winner ('A' | 'B' | 'draw') and duration. */
export function fight(A: Fighter, B: Fighter, rnd: () => number): { winner: 'A' | 'B' | 'draw'; t: number; hpFracWinner: number } {
  const mk = (f: Fighter): Live => {
    const st = arenaStats(mkCard(f.style), f.atk, f.def, f.position ?? 'attack');
    return { st, hp: st.maxHp, nextAtk: ENGAGE[f.style] + rnd() * 0.4, nextAbility: ENGAGE[f.style] + 2 + rnd() * 2, stunUntil: 0, hitRate: f.hitRate };
  };
  const a = mk(A), b = mk(B);
  const ab = { a: defaultAbilityForStyle(a.st.style), b: defaultAbilityForStyle(b.st.style) };
  let t = 0;
  const strike = (src: Live, dst: Live, mult: number) => {
    const p = src.hitRate * ACC_MOD[src.st.style] * (1 - EVADE_MOD[dst.st.style]);
    if (rnd() < p) dst.hp -= hitDamage(src.st.power, mult, dst.st) * (0.9 + rnd() * 0.2);
  };
  while (t < TUNING.arena.hardCapSec) {
    t += DT;
    for (const [src, dst, abl] of [[a, b, ab.a], [b, a, ab.b]] as const) {
      if (t < src.stunUntil) continue;
      if (t >= src.nextAtk) { strike(src, dst, 1); src.nextAtk = t + src.st.attackInterval * (0.9 + rnd() * 0.2); }
      if (t >= src.nextAbility) { strike(src, dst, abl.power); src.nextAbility = t + abl.cooldown; }
    }
    const sd = suddenDeathDps(t);
    if (sd > 0) { a.hp -= sd * a.st.maxHp * DT; b.hp -= sd * b.st.maxHp * DT; }
    const aDead = a.hp <= 0, bDead = b.hp <= 0;
    if (aDead && bDead) return { winner: 'draw', t, hpFracWinner: 0 };
    if (bDead) return { winner: 'A', t, hpFracWinner: a.hp / a.st.maxHp };
    if (aDead) return { winner: 'B', t, hpFracWinner: b.hp / b.st.maxHp };
  }
  const fa = a.hp / a.st.maxHp, fb = b.hp / b.st.maxHp;
  if (fa === fb) return { winner: 'draw', t, hpFracWinner: fa };
  return fa > fb ? { winner: 'A', t, hpFracWinner: fa } : { winner: 'B', t, hpFracWinner: fb };
}

export function run(A: Fighter, B: Fighter, trials: number, seed = 1) {
  const rnd = mulberry32(seed);
  let winA = 0, draws = 0, sd = 0;
  const ts: number[] = [];
  for (let i = 0; i < trials; i++) {
    const r = fight(A, B, rnd);
    if (r.winner === 'A') winA++;
    if (r.winner === 'draw') draws++;
    if (r.t > TUNING.arena.suddenDeathAtSec) sd++;
    ts.push(r.t);
  }
  ts.sort((x, y) => x - y);
  return {
    winA: winA / trials,
    draw: draws / trials,
    median: ts[Math.floor(trials / 2)],
    p10: ts[Math.floor(trials * 0.1)],
    p90: ts[Math.floor(trials * 0.9)],
    suddenDeath: sd / trials,
  };
}

// ---------------------------------------------------------------------------
const isMain = typeof process !== 'undefined' && process.argv[1] && /arena-model/.test(process.argv[1]);
if (isMain) {
  const trials = Number(process.argv[2] ?? 4000);
  const P = TUNING.playerModel, AI = TUNING.ai;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6);
  const s = (x: number) => `${x.toFixed(1)}s`.padStart(6);

  interface Row { name: string; A: Omit<Fighter, 'hitRate'>; B: Omit<Fighter, 'hitRate'> }
  const rows: Row[] = [
    { name: '1200/1200 vs 1200/1200 (mirror)', A: { label: 'A', atk: 1200, def: 1200, style: 'melee' }, B: { label: 'B', atk: 1200, def: 1200, style: 'melee' } },
    { name: '1700/1200 vs 1200/1200 (-500)', A: { label: 'A', atk: 1700, def: 1200, style: 'melee' }, B: { label: 'B', atk: 1200, def: 1200, style: 'melee' } },
    { name: '1800/1000 vs 1300/2000 (-500, hi DEF)', A: { label: 'A', atk: 1800, def: 1000, style: 'melee' }, B: { label: 'B', atk: 1300, def: 2000, style: 'melee' } },
    { name: '2500/2100 vs 2000/2100 (-500, big)', A: { label: 'A', atk: 2500, def: 2100, style: 'ranged' }, B: { label: 'B', atk: 2000, def: 2100, style: 'ranged' } },
    { name: '2500/2000 vs 2000/2000 (-500, bruisers)', A: { label: 'A', atk: 2500, def: 2000, style: 'bruiser' }, B: { label: 'B', atk: 2000, def: 2000, style: 'bruiser' } },
    { name: '1500/1200 vs 1300/1100 (-200)', A: { label: 'A', atk: 1500, def: 1200, style: 'swift' }, B: { label: 'B', atk: 1300, def: 1100, style: 'melee' } },
    { name: '3000/2500 vs DEF-pos 1400 DEF', A: { label: 'A', atk: 3000, def: 2500, style: 'bruiser' }, B: { label: 'B', atk: 1000, def: 1400, style: 'melee', position: 'defense' } },
    { name: '1800/1000 vs DEF-pos 2000 DEF', A: { label: 'A', atk: 1800, def: 1000, style: 'melee' }, B: { label: 'B', atk: 0, def: 2000, style: 'bruiser', position: 'defense' } },
    { name: '3000/2500 vs 1200/1000 (stomp)', A: { label: 'A', atk: 3000, def: 2500, style: 'bruiser' }, B: { label: 'B', atk: 1200, def: 1000, style: 'swift' } },
  ];

  // Scenarios: who is the human and how good, vs which AI.
  // "B" is always the weaker side in each row; we report P(stronger A wins) and P(weaker B wins).
  const scenarios: { name: string; a: number; b: number }[] = [
    { name: 'equal skill (avg vs avg)', a: P.average, b: P.average },
    { name: 'weaker=GOOD player vs NORMAL AI', a: AI.normal.modelHitRate, b: P.good },
    { name: 'weaker=GOOD player vs HARD AI', a: AI.hard.modelHitRate, b: P.good },
    { name: 'weaker=EXPERT player vs EASY AI', a: AI.easy.modelHitRate, b: P.expert },
    { name: 'stronger=NOVICE player vs NORMAL AI', a: P.novice, b: AI.normal.modelHitRate },
  ];

  console.log(`Arena model, ${trials} trials per cell. Columns: P(weaker B wins) | median duration [p10-p90] | sudden death rate\n`);
  for (const sc of scenarios) {
    console.log(`== ${sc.name}  (A hit ${sc.a}, B hit ${sc.b})`);
    for (const r of rows) {
      const res = run({ ...r.A, hitRate: sc.a }, { ...r.B, hitRate: sc.b }, trials, 12345);
      console.log(`${r.name.padEnd(40)} upset ${pct(1 - res.winA - res.draw)} draw ${pct(res.draw)} | ${s(res.median)} [${s(res.p10)} -${s(res.p90)}] | SD ${pct(res.suddenDeath)}`);
    }
    console.log('');
  }

  console.log('== Style cross-table at equal stats 1500/1200, equal skill 0.72 (P row-style wins)');
  const styles: ArenaStyle[] = ['melee', 'ranged', 'bruiser', 'swift'];
  console.log(''.padEnd(10) + styles.map(x => x.padStart(9)).join(''));
  for (const sa of styles) {
    let line = sa.padEnd(10);
    for (const sb of styles) {
      const res = run({ label: 'A', atk: 1500, def: 1200, style: sa, hitRate: 0.72 }, { label: 'B', atk: 1500, def: 1200, style: sb, hitRate: 0.72 }, trials, 777);
      line += pct(res.winA).padStart(9);
    }
    console.log(line);
  }
}
