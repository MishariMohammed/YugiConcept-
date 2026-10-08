#!/usr/bin/env node
// Bug sweep / fuzzer (npm run sweep [-- --matches=2 --parallel=3]).
//
// Plays N matches per difficulty. The human side picks RANDOM legal actions through the scene's
// own act() gate (only when the UI would accept input), arena fights are randomly left to the
// AI (AUTO), left idle (human stands still -> timeouts / sudden death) or SKIPped. Checks:
//   - console errors / page errors / illegal-action warnings
//   - soft-locks (no progress for 30 s), match length cap
//   - canInput() true while it is the NPC's turn, an arena is pending or the game is over
//   - resolveArena called without a pending fight (double finishArena)
//   - arena fights longer than the hard cap + intro/outro
// Also screenshots the board at several aspect ratios + the portrait "rotate" overlay.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PHONE, ROOT, loadPlaywright, log, sleep, startPreview, waitFor, watchConsole } from './harness.mjs';

const OUT = join(ROOT, 'tests', 'e2e', 'out');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => Number((process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=')[1]);
const MATCHES = arg('matches', 2);
const PARALLEL = arg('parallel', 3);

async function playMatch(browser, url, difficulty, seed) {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  const problems = watchConsole(page, `[${difficulty}#${seed}] `);
  const issues = [];
  await page.goto(url);
  await waitFor(page, () => window.__YUGI__?.scene.isActive('Title'), null, { timeout: 60000, what: 'Title' });
  await page.evaluate(({ difficulty, seed }) => {
    const g = window.__YUGI__;
    g.scene.getScene('Title').scene.start('Duel', { deck0: 'yugi', deck1: 'kaiba', seed, difficulty });
    window.__qa = { issues: [], arenas: 0, resolves: 0, mode: null, rng: seed };
  }, { difficulty, seed });
  await waitFor(page, () => window.__YUGI__.scene.getScene('Duel')?.engine, null, { what: 'duel engine' });
  // instrument resolveArena (double finishArena / resolve without pending)
  await page.evaluate(() => {
    const d = window.__YUGI__.scene.getScene('Duel');
    const e = d.engine;
    const orig = e.resolveArena.bind(e);
    e.resolveArena = (r) => {
      window.__qa.resolves++;
      if (!e.pendingArena) window.__qa.issues.push('resolveArena() without a pending arena (double finishArena?)');
      return orig(r);
    };
  });
  const t0 = Date.now();
  let lastSig = '', lastChange = Date.now();
  let res = null;
  for (;;) {
    const st = await page.evaluate(() => {
      const g = window.__YUGI__; const qa = window.__qa;
      const d = g.scene.getScene('Duel'); const a = g.scene.getScene('Arena');
      if (g.scene.isActive('Result')) return { done: true, data: g.scene.getScene('Result').sys.settings.data };
      if (!d?.engine) return { wait: true };
      const s = d.engine.state;
      const r = () => { qa.rng = (qa.rng * 1103515245 + 12345) & 0x7fffffff; return qa.rng / 0x7fffffff; };
      const arena = a?.sys.isActive() ? a : null;
      // invariants
      const input = d.canInput();
      if (input && (s.activePlayer !== 0 || d.engine.pendingArena || s.winner !== null || arena)) {
        qa.issues.push(`canInput() true while ${s.activePlayer !== 0 ? 'NPC turn' : arena ? 'arena running' : d.engine.pendingArena ? 'arena pending' : 'game over'} (turn ${s.turn})`);
      }
      if (arena) {
        if (arena.__req !== arena.data0.request) { // ArenaScene is reused: one request per fight
          arena.__req = arena.data0.request; arena.__t0 = performance.now(); arena.__slow = false; qa.arenas++;
          const k = r(); qa.mode = k < 0.4 ? 'skip' : k < 0.8 ? 'auto' : 'idle';
          if (qa.mode === 'auto' && !arena.auto) arena.toggleAuto();
        }
        const el = (performance.now() - arena.__t0) / 1000;
        if (el > 35 && !arena.__slow) { arena.__slow = true; qa.issues.push(`arena still running after ${el.toFixed(0)} s (phase ${arena.phase}, t=${arena.sim.t.toFixed(1)})`); }
        if (qa.mode === 'skip' && arena.phase === 'fight') arena.skipFight();
      } else if (input) {
        const legal = d.engine.legalActions(0);
        const non = legal.filter((x) => x.type !== 'endTurn');
        // mostly act, sometimes end the turn early
        const pick = non.length && r() < 0.85 ? non[Math.floor(r() * non.length)] : legal.find((x) => x.type === 'endTurn');
        if (pick?.type === 'enterBattle' && r() < 0.3) d.onBattle(); else d.act(pick);
      }
      return {
        sig: [s.turn, s.phase, s.activePlayer, s.log.length, s.players[0].lp, s.players[1].lp, arena ? `${arena.phase}:${Math.floor(arena.sim.t)}` : ''].join('|'),
        turn: s.turn, busy: d.busy, animating: d.animating, pending: !!d.engine.pendingArena, arena: arena?.phase ?? null, log: s.log.slice(-3),
      };
    });
    if (st.done) { res = st.data; break; }
    if (st.wait) { await sleep(200); continue; }
    if (st.sig !== lastSig) { lastSig = st.sig; lastChange = Date.now(); }
    if (Date.now() - lastChange > 30000) {
      issues.push(`SOFT-LOCK (30 s no progress): ${JSON.stringify(st)}`);
      await page.screenshot({ path: join(OUT, `softlock-${difficulty}-${seed}.png`) });
      break;
    }
    if (Date.now() - t0 > 15 * 60000) { issues.push('match exceeded 15 min wall clock'); break; }
    await sleep(120);
  }
  const qa = await page.evaluate(() => window.__qa);
  issues.push(...qa.issues.filter((x, i, a) => a.indexOf(x) === i), ...problems);
  if (qa.arenas !== qa.resolves) issues.push(`arena launches (${qa.arenas}) != resolveArena calls (${qa.resolves})`);
  await ctx.close();
  return { difficulty, seed, secs: Math.round((Date.now() - t0) / 1000), arenas: qa.arenas, turns: res?.turns, winner: res?.winner, lp: res?.lp, issues };
}

async function layouts(browser, url) {
  const shots = [
    { name: '16x9-1280x720', viewport: { width: 1280, height: 720 } },
    { name: '20x9-phone', ...PHONE },
    { name: '21x9-960x411', viewport: { width: 960, height: 411 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '4x3-1024x768', viewport: { width: 1024, height: 768 } },
    { name: 'portrait-phone', viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.75 },
  ];
  const out = [];
  for (const s of shots) {
    const { name, ...opts } = s;
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const problems = watchConsole(page, `[layout ${name}] `);
    await page.goto(url);
    await waitFor(page, () => window.__YUGI__?.scene.isActive('Title'), null, { timeout: 60000, what: 'Title' });
    await page.evaluate(() => window.__YUGI__.scene.getScene('Title').scene.start('Duel', { deck0: 'yugi', deck1: 'kaiba', seed: 3 }));
    await waitFor(page, () => window.__YUGI__.scene.getScene('Duel')?.canInput?.(), null, { timeout: 60000, what: 'duel input' });
    const m = await page.evaluate(() => {
      const c = document.querySelector('#game canvas').getBoundingClientRect();
      const rot = getComputedStyle(document.getElementById('rotate')).display !== 'none';
      return { canvas: [Math.round(c.width), Math.round(c.height)], scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight], vp: [innerWidth, innerHeight], rotateOverlay: rot };
    });
    await page.screenshot({ path: join(OUT, `layout-${name}.png`) });
    out.push({ name, ...m, problems });
    await ctx.close();
  }
  return out;
}

async function main() {
  const { chromium } = await loadPlaywright();
  const srv = await startPreview();
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const jobs = [];
  for (const d of ['easy', 'normal', 'hard']) for (let i = 0; i < MATCHES; i++) jobs.push([d, 1000 + i * 77 + d.length]);
  const results = [];
  let bad = 0;
  try {
    for (const l of await layouts(browser, srv.url)) {
      log(`layout ${l.name}: canvas ${l.canvas.join('x')} in ${l.vp.join('x')}, page scroll ${l.scroll.join('x')}, rotate overlay ${l.rotateOverlay}`);
      if (l.scroll[0] > l.vp[0] || l.scroll[1] > l.vp[1]) { bad++; log('  FAIL page overflows viewport'); }
      if (l.problems.length) { bad++; log(l.problems.join('\n')); }
    }
    const queue = [...jobs];
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      while (queue.length) {
        const [d, seed] = queue.shift();
        const r = await playMatch(browser, srv.url, d, seed).catch((e) => ({ difficulty: d, seed, issues: [`exception ${e.message}`] }));
        results.push(r);
        log(`${d} seed ${seed}: ${r.secs}s, turns ${r.turns}, arenas ${r.arenas}, winner ${r.winner}, lp ${JSON.stringify(r.lp)}${r.issues.length ? `\n   ISSUES:\n   - ${r.issues.join('\n   - ')}` : ''}`);
        if (r.issues.length) bad++;
      }
    }));
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log(bad ? `\nSWEEP found issues in ${bad} run(s)` : '\nSWEEP clean');
  process.exit(bad ? 1 : 0);
}

main();
