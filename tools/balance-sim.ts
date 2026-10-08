// Headless balance simulation on the REAL arena sim (src/core/combat/ArenaSim.ts) with ArenaAI
// driving both sides, plus a full-match length estimate on the real duel engine.
//
// Run: npm run sim            (default N=400 fights per model cell)
//      npm run sim -- 1000    (more fights)
//      npm run sim -- 200 --quick   (skip the deck x deck pass and the duel estimate)
//
// Sections:
//  1. Model matchups (same rows as tools/arena-model.ts) x skill scenarios -> upset %, durations.
//  2. Style cross-table at equal stats.
//  3. Real deck cards: every monster in each deck vs every monster in the opposing deck.
//  4. Full-match estimate: 400 seeded duels per difficulty (simulateDuel: DuelAI on both seats), arena
//     fights resolved by ArenaSim; wall time = turns x turn overhead + fights x (intro+fight+outro).
//  5. GDD target checks (PASS/FAIL).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArenaRequest, ArenaResult, ArenaStyle, CardDef, CardInstance, PlayerId, Position } from '../src/core/types';
import { TUNING, resolveBattle } from '../src/core/combat/Formulas';
import { simulateArena, type ArenaController } from '../src/core/combat/ArenaSim';
import { ArenaAI, type ArenaSkill } from '../src/core/ai/ArenaAI';
import { getCard, registerCards, loadDefaultCards } from '../src/core/cards/CardDB';
import { simulateDuel } from '../src/core/ai/HumanAutoplay';
import type { AIDifficulty } from '../src/core/ai/DuelAI';
import { DECKS } from '../src/data/decks';
import { Rng } from '../src/core/rng';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!loadDefaultCards()) {
  registerCards(JSON.parse(readFileSync(resolve(root, 'src/data/cards.json'), 'utf8')) as CardDef[]);
}

const args = process.argv.slice(2);
const N = Number(args.find((a) => /^\d+$/.test(a)) ?? 400);
const QUICK = args.includes('--quick');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6);
const sec = (x: number) => `${x.toFixed(1)}s`.padStart(6);
const quant = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

interface Side { atk: number; def: number; style: ArenaStyle; position?: Position; level?: number; card?: CardDef }

function mkCard(s: Side, id: string): CardDef {
  return s.card ?? { id, name: id, kind: 'monster', text: '', level: s.level ?? 4, atk: s.atk, def: s.def, arenaStyle: s.style };
}

function mkRequest(A: Side, B: Side, seed: number, spells: [CardInstance[], CardInstance[]] = [[], []]): ArenaRequest {
  return {
    attacker: { player: 0, uid: 1, def: mkCard(A, 'A'), atk: A.atk, defStat: A.def },
    defender: { player: 1, uid: 2, def: mkCard(B, 'B'), atk: B.atk, defStat: B.def, position: B.position ?? 'attack' },
    usableSpells: spells,
    seed,
  };
}

interface CellStats { winA: number; winB: number; draw: number; median: number; p10: number; p90: number; sd: number; durations: number[]; inWindow: number }

function runCell(A: Side, B: Side, skillA: ArenaSkill, skillB: ArenaSkill, n: number, seed0: number,
  spells?: (i: number) => [CardInstance[], CardInstance[]]): CellStats {
  let winA = 0, winB = 0, draw = 0, sd = 0, inWindow = 0;
  const ts: number[] = [];
  for (let i = 0; i < n; i++) {
    const seed = (seed0 * 7919 + i * 104729) >>> 0;
    const ctrl: [ArenaController, ArenaController] = [new ArenaAI(skillA, seed + 1), new ArenaAI(skillB, seed + 2)];
    const r = simulateArena(mkRequest(A, B, seed, spells?.(i)), ctrl).result;
    if (r.winner === 'attacker') winA++; else if (r.winner === 'defender') winB++; else draw++;
    if (r.durationSec > TUNING.arena.suddenDeathAtSec) sd++;
    if (r.durationSec >= TUNING.arena.targetMinSec && r.durationSec <= TUNING.arena.targetMaxSec) inWindow++;
    ts.push(r.durationSec);
  }
  return {
    winA: winA / n, winB: winB / n, draw: draw / n, sd: sd / n, inWindow: inWindow / n,
    median: quant(ts, 0.5), p10: quant(ts, 0.1), p90: quant(ts, 0.9), durations: ts,
  };
}

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

// ---------------------------------------------------------------------------
// 1. Model matchups
// ---------------------------------------------------------------------------
interface Row { name: string; A: Side; B: Side; minus500?: boolean; equal?: boolean }
const rows: Row[] = [
  { name: '1200/1200 vs 1200/1200 (mirror)', A: { atk: 1200, def: 1200, style: 'melee' }, B: { atk: 1200, def: 1200, style: 'melee' }, equal: true },
  { name: '1700/1200 vs 1200/1200 (-500)', A: { atk: 1700, def: 1200, style: 'melee' }, B: { atk: 1200, def: 1200, style: 'melee' }, minus500: true },
  { name: '1800/1000 vs 1300/2000 (-500 hiDEF)', A: { atk: 1800, def: 1000, style: 'melee' }, B: { atk: 1300, def: 2000, style: 'melee' }, minus500: true },
  { name: '2500/2100 vs 2000/2100 (-500 rngd)', A: { atk: 2500, def: 2100, style: 'ranged', level: 7 }, B: { atk: 2000, def: 2100, style: 'ranged', level: 6 }, minus500: true },
  { name: '2500/2000 vs 2000/2000 (-500 brsr)', A: { atk: 2500, def: 2000, style: 'bruiser', level: 7 }, B: { atk: 2000, def: 2000, style: 'bruiser', level: 6 }, minus500: true },
  { name: '1500/1200 vs 1300/1100 (-200)', A: { atk: 1500, def: 1200, style: 'swift' }, B: { atk: 1300, def: 1100, style: 'melee' } },
  { name: '3000/2500 vs DEF-pos 1400 DEF', A: { atk: 3000, def: 2500, style: 'bruiser', level: 8 }, B: { atk: 1000, def: 1400, style: 'melee', position: 'defense' } },
  { name: '1800/1000 vs DEF-pos 2000 wall', A: { atk: 1800, def: 1000, style: 'melee' }, B: { atk: 0, def: 2000, style: 'bruiser', position: 'defense' } },
  { name: '3000/2500 vs 1200/1000 (stomp)', A: { atk: 3000, def: 2500, style: 'bruiser', level: 8 }, B: { atk: 1200, def: 1000, style: 'swift' } },
];

const scenarios: { name: string; a: ArenaSkill; b: ArenaSkill }[] = [
  { name: 'equal skill (average vs average)', a: 'average', b: 'average' },
  { name: 'weaker = GOOD player vs NORMAL AI', a: 'normal', b: 'good' },
  { name: 'weaker = GOOD player vs HARD AI', a: 'hard', b: 'good' },
  { name: 'weaker = EXPERT player vs EASY AI', a: 'easy', b: 'expert' },
  { name: 'stronger = NOVICE player vs NORMAL AI', a: 'novice', b: 'normal' },
];

console.log(`YugiConcept balance sim - real ArenaSim + ArenaAI, ${N} fights per cell\n`);
console.log('Columns: P(weaker B wins) | draws | median [p10 - p90] | in 8-15 s | sudden death\n');
const allDurationsEqual: number[] = [];
let maxUpsetGoodVsNormal = 0;
for (const sc of scenarios) {
  console.log(`== ${sc.name}  (A=${sc.a}, B=${sc.b})`);
  rows.forEach((r, ri) => {
    const s = runCell(r.A, r.B, sc.a, sc.b, N, 1000 + ri);
    console.log(`${r.name.padEnd(38)} upset ${pct(s.winB)} draw ${pct(s.draw)} | ${sec(s.median)} [${sec(s.p10)} -${sec(s.p90)}] | ${pct(s.inWindow)} | SD ${pct(s.sd)}`);
    if (sc.a === 'average' && sc.b === 'average') {
      allDurationsEqual.push(...s.durations);
      if (r.equal) check('equal stats ~50%', Math.abs(s.winA - s.winB) <= 0.12, `A ${pct(s.winA)} / B ${pct(s.winB)} / draw ${pct(s.draw)}`);
      if (r.equal) check('mirror median 8-15 s', s.median >= 8 && s.median <= 15, `median ${s.median.toFixed(1)} s`);
    }
    if (sc.a === 'normal' && sc.b === 'good' && r.minus500) maxUpsetGoodVsNormal = Math.max(maxUpsetGoodVsNormal, s.winB);
  });
  console.log('');
}
check('-500 upset <= 25% (good player vs normal AI)', maxUpsetGoodVsNormal <= 0.25, `worst ${pct(maxUpsetGoodVsNormal)}`);

// ---------------------------------------------------------------------------
// 2. Style cross-table
// ---------------------------------------------------------------------------
console.log('== Style cross-table: 1500/1200 vs 1500/1200, average vs average (P row style wins)');
const styles: ArenaStyle[] = ['melee', 'ranged', 'bruiser', 'swift'];
console.log(''.padEnd(10) + styles.map((x) => x.padStart(9)).join(''));
let styleMin = 1, styleMax = 0;
styles.forEach((sa, i) => {
  let line = sa.padEnd(10);
  styles.forEach((sb, j) => {
    const s = runCell({ atk: 1500, def: 1200, style: sa }, { atk: 1500, def: 1200, style: sb }, 'average', 'average', N, 50 + i * 4 + j);
    line += pct(s.winA).padStart(9);
    if (sa !== sb) { styleMin = Math.min(styleMin, s.winA); styleMax = Math.max(styleMax, s.winA); }
  });
  console.log(line);
});
check('style cross-table within 25-75% (RPS band)', styleMin >= 0.25 && styleMax <= 0.75, `range ${pct(styleMin)} - ${pct(styleMax)}`);
console.log('');

// ---------------------------------------------------------------------------
// 3. Real deck cards
// ---------------------------------------------------------------------------
let deckMedian = NaN;
if (!QUICK) {
  const deckIds = Object.keys(DECKS) as (keyof typeof DECKS)[];
  const monsters = (d: keyof typeof DECKS) => [...new Set(DECKS[d])].map(getCard).filter((c) => c.kind === 'monster');
  const arenaSpells = (d: keyof typeof DECKS) => DECKS[d].map(getCard).filter((c) => c.kind === 'spell' && c.arenaUsable);
  const perFight = Math.max(12, Math.round(N / 20));
  console.log(`== Real deck cards: every monster vs every opposing monster (attacker = row deck), ${perFight} fights each,`);
  console.log('   human (good) attacks vs NORMAL AI and NORMAL AI attacks vs human (average); 35% of fights give each side a random arena spell from its deck.');
  const buckets = new Map<string, { n: number; upset: number }>();
  const bucketOf = (gap: number) => gap >= 1000 ? '>= +1000' : gap >= 500 ? '+500..+999' : gap >= 200 ? '+200..+499' : gap > -200 ? '-199..+199' : gap > -500 ? '-499..-200' : gap > -1000 ? '-999..-500' : '<= -1000';
  const ds: number[] = [];
  let sdCount = 0, total = 0, inWin = 0;
  const outliers: { name: string; median: number; upset: number; gap: number }[] = [];
  let uid = 1000;
  for (const da of deckIds) for (const db of deckIds) {
    if (da === db) continue;
    const spA = arenaSpells(da), spB = arenaSpells(db);
    for (const a of monsters(da)) for (const b of monsters(db)) {
      for (const pos of ['attack', 'defense'] as Position[]) {
        const A: Side = { atk: a.atk ?? 0, def: a.def ?? 0, style: 'melee', card: a };
        const B: Side = { atk: b.atk ?? 0, def: b.def ?? 0, style: 'melee', card: b, position: pos };
        const gap = (a.atk ?? 0) - (pos === 'attack' ? b.atk ?? 0 : b.def ?? 0);
        const rng = new Rng(gap * 31 + (a.atk ?? 0) + uid);
        const spells = (): [CardInstance[], CardInstance[]] => [
          spA.length && rng.next() < 0.35 ? [{ uid: uid++, defId: rng.pick(spA).id, owner: 0 as PlayerId }] : [],
          spB.length && rng.next() < 0.35 ? [{ uid: uid++, defId: rng.pick(spB).id, owner: 1 as PlayerId }] : [],
        ];
        // half: human attacks; half: NPC attacks
        const s1 = runCell(A, B, 'good', 'normal', perFight >> 1, uid, spells);
        const s2 = runCell(A, B, 'normal', 'average', perFight - (perFight >> 1), uid + 1, spells);
        uid += 2;
        const n = perFight;
        const winA = (s1.winA * (perFight >> 1) + s2.winA * (n - (perFight >> 1))) / n;
        const winB = (s1.winB * (perFight >> 1) + s2.winB * (n - (perFight >> 1))) / n;
        const higherIsA = gap > 0;
        const upset = gap === 0 ? NaN : higherIsA ? winB : winA;
        const key = bucketOf(Math.abs(gap) < 200 ? gap : -Math.abs(gap));
        if (!Number.isNaN(upset)) {
          const bk = buckets.get(key) ?? { n: 0, upset: 0 };
          bk.n += n; bk.upset += upset * n;
          buckets.set(key, bk);
        }
        const durs = [...s1.durations, ...s2.durations];
        ds.push(...durs);
        sdCount += durs.filter((d) => d > TUNING.arena.suddenDeathAtSec).length;
        inWin += durs.filter((d) => d >= 8 && d <= 15).length;
        total += durs.length;
        outliers.push({ name: `${a.id} -> ${b.id}${pos === 'defense' ? ' (DEF)' : ''}`, median: quant(durs, 0.5), upset, gap });
      }
    }
  }
  deckMedian = quant(ds, 0.5);
  console.log(`   ${total} fights: median ${sec(deckMedian)} [p10 ${sec(quant(ds, 0.1))} - p90 ${sec(quant(ds, 0.9))}], in 8-15 s ${pct(inWin / total)}, sudden death ${pct(sdCount / total)}`);
  console.log('   Upset rate (weaker battle stat wins) by |gap| bucket:');
  for (const k of ['-199..+199', '-499..-200', '-999..-500', '<= -1000']) {
    const b = buckets.get(k);
    if (b) console.log(`     gap ${k.padEnd(12)} ${pct(b.upset / b.n)}   (${b.n} fights)`);
  }
  outliers.sort((x, y) => y.median - x.median);
  console.log('   Longest matchups (median):');
  for (const o of outliers.slice(0, 5)) console.log(`     ${o.name.padEnd(56)} ${sec(o.median)}  gap ${o.gap}`);
  console.log('   Shortest matchups (median):');
  for (const o of outliers.slice(-3)) console.log(`     ${o.name.padEnd(56)} ${sec(o.median)}  gap ${o.gap}`);
  const bigUpsets = outliers.filter((o) => Math.abs(o.gap) >= 500 && o.upset > 0.25).sort((x, y) => y.upset - x.upset);
  console.log(`   Matchups with gap >= 500 and upset > 25%: ${bigUpsets.length}`);
  for (const o of bigUpsets.slice(0, 6)) console.log(`     ${o.name.padEnd(56)} upset ${pct(o.upset)} gap ${o.gap}`);
  check('deck fights median 8-15 s', deckMedian >= 8 && deckMedian <= 15, `median ${deckMedian.toFixed(1)} s`);
  const b500 = buckets.get('-999..-500');
  if (b500) check('deck gap 500-999 upset <= 25%', b500.upset / b500.n <= 0.25, pct(b500.upset / b500.n));
  console.log('');
}

// ---------------------------------------------------------------------------
// 4. Full match estimate (DuelAI on both seats via simulateDuel, real ArenaSim fights)
// ---------------------------------------------------------------------------
if (!QUICK) {
  const DUELS = 400;
  const TURN_OVERHEAD_SEC = 20; // human decisions + duel animations per turn (GDD 4 pacing)
  const ARENA_FRAME = TUNING.arena.introSec + TUNING.arena.outroSec + 0.5; // + transition
  const LP0 = TUNING.duel.startingLp;
  const diffs: AIDifficulty[] = ['normal', 'easy', 'hard'];
  for (const diff of diffs) {
    const turnsA: number[] = [], fightsA: number[] = [], minutes: number[] = [], fightSecs: number[] = [], directA: number[] = [];
    let lpArena = 0, lpTotal = 0, kaibaWins = 0, decided = 0, timeouts = 0;
    for (let i = 0; i < DUELS; i++) {
      // Alternate seats (kaiba as player 0 / 1) and who goes first, so seat and tempo cancel out.
      const kaibaSeat = (i % 2) as PlayerId;
      const firstPlayer = ((i >> 1) % 2) as PlayerId;
      let fightTime = 0;
      const r = simulateDuel({
        seed: 9000 + i,
        deck0: kaibaSeat === 0 ? DECKS.kaiba : DECKS.yugi,
        deck1: kaibaSeat === 0 ? DECKS.yugi : DECKS.kaiba,
        difficulties: [diff, diff],
        firstPlayer,
        resolveArena: (req: ArenaRequest) => {
          // Seat 0 plays the "human" (average skill) side of the arena, seat 1 the NPC (normal).
          const skills: [ArenaSkill, ArenaSkill] = req.attacker.player === 0 ? ['average', 'normal'] : ['normal', 'average'];
          const res = simulateArena(req, [new ArenaAI(skills[0], req.seed + 1), new ArenaAI(skills[1], req.seed + 2)]).result;
          fightTime += res.durationSec; fightSecs.push(res.durationSec);
          const d = req.defender;
          const o = resolveBattle(req.attacker.atk, { atk: d.atk, def: d.defStat, position: d.position }, res);
          lpArena += o.lpDamage[0] + o.lpDamage[1];
          return res;
        },
      });
      if (r.timedOut) { timeouts++; continue; }
      lpTotal += Math.max(0, LP0 - r.lp[0]) + Math.max(0, LP0 - r.lp[1]);
      turnsA.push(r.turns); fightsA.push(r.fights); directA.push(r.directAttacks);
      minutes.push((r.turns * TURN_OVERHEAD_SEC + fightTime + r.fights * ARENA_FRAME) / 60);
      if (r.winner === 0 || r.winner === 1) { decided++; if (r.winner === kaibaSeat) kaibaWins++; }
    }
    console.log(`== Full match estimate: ${DUELS} duels yugi vs kaiba, DuelAI ${diff} on both seats (simulateDuel), arena = ArenaSim average vs normal`);
    console.log(`   LP ${LP0}, direct attacks x${TUNING.battle.directAttackMult}; wall time = turns x ${TURN_OVERHEAD_SEC}s + fights x (fight + ${ARENA_FRAME.toFixed(1)}s intro/outro/transition)`);
    console.log(`   turns (total, both players): median ${quant(turnsA, 0.5)} [p10 ${quant(turnsA, 0.1)} - p90 ${quant(turnsA, 0.9)}]`);
    console.log(`   arena fights per match:      median ${quant(fightsA, 0.5)} [p10 ${quant(fightsA, 0.1)} - p90 ${quant(fightsA, 0.9)}]`);
    console.log(`   direct attacks per match:    median ${quant(directA, 0.5)} [p10 ${quant(directA, 0.1)} - p90 ${quant(directA, 0.9)}]`);
    console.log(`   LP damage source (approx):   arena ${pct(lpArena / (lpTotal || 1))}, direct + effects ${pct(1 - lpArena / (lpTotal || 1))}`);
    console.log(`   arena fight duration:        median ${sec(quant(fightSecs, 0.5))}`);
    console.log(`   match length:                median ${quant(minutes, 0.5).toFixed(1)} min [p10 ${quant(minutes, 0.1).toFixed(1)} - p90 ${quant(minutes, 0.9).toFixed(1)}]  (target 8-12)`);
    console.log(`   deck balance:                kaiba wins ${pct(kaibaWins / (decided || 1))} of ${decided} decided duels${timeouts ? `, ${timeouts} timeouts` : ''}`);
    if (diff === 'normal') {
      const m = quant(minutes, 0.5);
      check('match length median 8-12 min (normal)', m >= 8 && m <= 12, `${m.toFixed(1)} min`);
    }
    const kw = kaibaWins / (decided || 1);
    // Easy AI makes ~35% random plays, which favours raw-stat beatdown (Kaiba): looser band, see GDD 7.
    const [lo, hi] = diff === 'easy' ? [0.4, 0.6] : [0.45, 0.55];
    check(`deck balance ${Math.round(lo * 100)}-${Math.round(hi * 100)}% (${diff})`, kw >= lo && kw <= hi, `kaiba ${pct(kw)}`);
    console.log('');
  }
}

// ---------------------------------------------------------------------------
// 5. Targets
// ---------------------------------------------------------------------------
const eqMedian = quant(allDurationsEqual, 0.5);
check('model fights median 8-15 s (equal skill, all rows)', eqMedian >= 8 && eqMedian <= 15, `median ${eqMedian.toFixed(1)} s`);
console.log('== GDD targets');
for (const c of checks) console.log(`   [${c.ok ? 'PASS' : 'FAIL'}] ${c.name.padEnd(50)} ${c.detail}`);
