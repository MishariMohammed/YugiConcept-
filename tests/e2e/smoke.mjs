#!/usr/bin/env node
// End-to-end smoke test (npm run e2e). Builds, serves `vite preview`, and drives the game in
// headless Chromium emulating an Android phone in landscape (touch events only):
//
//   1. Title -> tap HARD -> tap DUEL!  (touch)
//   2. Full match with autoplay: the first arena fight must start and finish on its own, later
//      fights are ended with the SKIP pill (touch). A watchdog fails on soft-locks.
//   3. Result screen reached.
//   4. Hands-on touch pass on a fresh duel: tap-to-inspect, summon via the panel, tribute
//      summon, BATTLE -> tap attacker -> tap target / DIRECT, joystick drag + ability button
//      (multitouch) in the arena, pause on "app backgrounded".
//   5. ?arena= dev hook (auto fight resolves + pause pill) and art.html.
//
// Any console error / page error / "[Duel] illegal action" warning fails the run.
// Options: SKIP_BUILD=1 (reuse dist/), HEADED=1, --only=match|touch|hooks
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  PHONE, ROOT, activeScenes, loadPlaywright, log, sleep, startPreview, tap, touchRaw, waitFor, watchConsole,
} from './harness.mjs';

const OUT = join(ROOT, 'tests', 'e2e', 'out');
mkdirSync(OUT, { recursive: true });
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7);
const want = (k) => !only || only.split(',').includes(k);

const failures = [];
function check(cond, msg) {
  if (!cond) { failures.push(msg); log(`FAIL ${msg}`); } else log(`ok   ${msg}`);
}

const isActive = (page, key) => page.evaluate((k) => !!window.__YUGI__?.scene.isActive(k), key);

async function bootTitle(page, url) {
  await page.goto(url);
  await waitFor(page, () => window.__YUGI__?.scene.isActive('Title'), null, { timeout: 40000, what: 'Title scene' });
  await sleep(400); // fade-in
}

const duelReady = (page) => waitFor(page, () => {
  const d = window.__YUGI__.scene.getScene('Duel');
  return d?.sys.isActive() && d.canInput();
}, null, { timeout: 60000, what: 'human input in Duel' });

/** Snapshot used by the soft-lock watchdog. */
const duelSig = (page) => page.evaluate(() => {
  const g = window.__YUGI__;
  const d = g.scene.getScene('Duel');
  const a = g.scene.getScene('Arena');
  const s = d?.engine?.state;
  if (!s) return null;
  return {
    sig: [s.turn, s.phase, s.activePlayer, s.log.length, s.players[0].lp, s.players[1].lp, a?.sys.isActive() ? `arena:${a.phase}:${Math.floor(a.sim?.t ?? 0)}` : ''].join('|'),
    turn: s.turn, winner: s.winner, arena: !!a?.sys.isActive(), arenaPhase: a?.sys.isActive() ? a.phase : null,
    busy: d.busy, animating: d.animating, pending: !!d.engine.pendingArena, log: s.log.slice(-4),
  };
});

// ---------------------------------------------------------------------------------------------
async function fullMatch(page) {
  log('--- full match (touch Title flow + autoplay) ---');
  // difficulty buttons at y=144: EASY x=182, NORMAL x=240, HARD x=298; DUEL! at (240,190)
  await tap(page, 298, 144);
  check(await page.evaluate(() => window.__YUGI__.registry.get('difficulty')) === 'hard', 'tapping HARD selects hard difficulty');
  await tap(page, 240, 190);
  await waitFor(page, () => window.__YUGI__.scene.isActive('Duel'), null, { what: 'Duel scene after DUEL! tap' });
  await duelReady(page);
  check(await page.evaluate(() => window.__YUGI__.scene.getScene('Duel').difficulty) === 'hard', 'Duel runs at the chosen difficulty');
  await page.screenshot({ path: join(OUT, 'duel-start.png') });

  await page.evaluate(() => { const d = window.__YUGI__.scene.getScene('Duel'); d.autoplay = true; d.afterChange(); });
  const t0 = Date.now();
  let lastSig = '', lastChange = Date.now();
  let arenas = 0, firstArenaNatural = null, inArena = false, arenaStartedAt = 0;
  for (;;) {
    const st = await duelSig(page);
    const scenes = await activeScenes(page);
    if (scenes.includes('Result')) break;
    if (!st) { await sleep(200); continue; }
    if (st.arena && !inArena) {
      inArena = true; arenas++; arenaStartedAt = Date.now();
      if (arenas === 1) {
        log('first arena fight started; letting it play out (AUTO)');
        await page.screenshot({ path: join(OUT, 'arena-first.png') });
      }
    }
    if (!st.arena && inArena) {
      inArena = false;
      if (arenas === 1) firstArenaNatural = (Date.now() - arenaStartedAt) / 1000;
    }
    if (st.arena && arenas > 1 && st.arenaPhase === 'fight') await tap(page, 260, 34); // SKIP pill
    if (st.arena && arenas === 1 && Date.now() - arenaStartedAt > 40000) {
      failures.push(`first arena fight did not finish within 40 s (${st.arenaPhase})`);
      await tap(page, 260, 34);
    }
    if (st.sig !== lastSig) { lastSig = st.sig; lastChange = Date.now(); }
    if (Date.now() - lastChange > 30000) {
      failures.push(`SOFT-LOCK: no duel progress for 30 s: ${JSON.stringify(st)}`);
      await page.screenshot({ path: join(OUT, 'softlock.png') });
      return;
    }
    if (Date.now() - t0 > 12 * 60000) { failures.push('match did not finish within 12 min'); return; }
    await sleep(150);
  }
  const res = await page.evaluate(() => {
    const r = window.__YUGI__.scene.getScene('Result');
    return { turns: r.sys.settings.data?.turns, winner: r.sys.settings.data?.winner, lp: r.sys.settings.data?.lp, stats: r.sys.settings.data?.stats };
  });
  log(`match finished in ${Math.round((Date.now() - t0) / 1000)} s: ${JSON.stringify(res)}`);
  check(arenas >= 1, `at least one arena fight happened (${arenas})`);
  check(firstArenaNatural !== null, `first arena fight started and resolved by itself (${firstArenaNatural?.toFixed(1)} s)`);
  check(res.turns > 1, 'Result screen reached with stats');
  await sleep(600);
  await page.screenshot({ path: join(OUT, 'result.png') });
  // Result -> TITLE button (W/2+60, H-34)
  await tap(page, 300, 236);
  await waitFor(page, () => window.__YUGI__.scene.isActive('Title'), null, { what: 'Title after Result' });
  check(true, 'Result -> TITLE works');
}

// ---------------------------------------------------------------------------------------------
async function touchPass(page, cdp) {
  log('--- hands-on touch pass ---');
  await page.evaluate((seed) => window.__YUGI__.scene.getScene('Title').scene.start('Duel', { deck0: 'yugi', deck1: 'kaiba', seed, difficulty: 'easy' }), Number(process.env.TOUCH_SEED ?? 4243));
  await duelReady(page);
  const D = (fn, arg) => page.evaluate(fn, arg);

  // 1. tap-to-inspect + summon via the panel
  const low = await D(() => {
    const d = window.__YUGI__.scene.getScene('Duel');
    const s = d.engine.state;
    const c = s.players[0].hand.find((h) => { const def = d.engine.getDef(h.uid); return def.kind === 'monster' && def.level <= 4; });
    if (!c) return null;
    const v = d.views.get(c.uid);
    return { uid: c.uid, x: v.x, y: v.y };
  });
  check(!!low, 'opening hand has a Level 1-4 monster');
  if (!low) return;
  await tap(page, low.x, low.y - 8);
  await sleep(250);
  check(await D((u) => window.__YUGI__.scene.getScene('Duel').selected === u, low.uid), 'tap on a hand card selects it (inspect panel)');
  check(await D(() => window.__YUGI__.scene.getScene('Duel').inspect.visible), 'inspect panel shows the card');
  const btn = await D(() => { const b = window.__YUGI__.scene.getScene('Duel').actionBtns[0]; return b && { x: b.x, y: b.y, label: b.label.text }; });
  check(btn?.label === 'SUMMON', `first panel action is SUMMON (${btn?.label})`);
  await tap(page, btn.x, btn.y);
  await duelReady(page);
  check(await D((u) => window.__YUGI__.scene.getScene('Duel').engine.state.players[0].monsters.some((m) => m?.card.uid === u), low.uid), 'monster summoned via tap');

  // 2. pause when the app is backgrounded, resume via the panel
  await D(() => window.__YUGI__.events.emit('yugi:pause', 'test'));
  await sleep(150);
  check(await D(() => window.__YUGI__.scene.getScene('Duel').paused), 'backgrounding opens the Duel pause menu');
  await page.screenshot({ path: join(OUT, 'pause.png') });
  await tap(page, 240, 135 - 46); // RESUME
  await sleep(150);
  check(!(await D(() => window.__YUGI__.scene.getScene('Duel').paused)), 'RESUME closes the pause menu');
  check(await D(() => window.__YUGI__.scene.getScene('Duel').canInput()), 'input re-enabled after resume');

  // 3. END turn by tap; NPC turn must not accept input
  await tap(page, 449, 252);
  await sleep(500);
  const npcTurn = await D(() => { const d = window.__YUGI__.scene.getScene('Duel'); return d.engine.state.activePlayer === 1 ? d.canInput() : 'skipped'; });
  check(npcTurn === false || npcTurn === 'skipped', 'no human input during the NPC turn');
  // the NPC may attack -> arena; skip any NPC-initiated fights
  const waitHumanTurn = async () => {
    for (let i = 0; i < 400; i++) {
      const st = await D(() => {
        const g = window.__YUGI__; const d = g.scene.getScene('Duel'); const a = g.scene.getScene('Arena');
        return { arena: a?.sys.isActive() ? a.phase : null, input: d.canInput(), winner: d.engine.state.winner };
      });
      if (st.winner !== null) return false;
      if (st.arena === 'fight') await tap(page, 260, 34);
      if (st.input) return true;
      await sleep(150);
    }
    throw new Error('human turn never came back');
  };
  if (!(await waitHumanTurn())) { log('duel ended early; stopping touch pass'); return; }

  // 4. tribute summon: put a Level 5-6 monster in hand (test-only state tweak) and tribute 1
  const trib = await D(() => {
    const d = window.__YUGI__.scene.getScene('Duel');
    const e = d.engine; const me = e.state.players[0];
    if (me.normalSummonUsed) return { skip: 'normal summon already used' };
    if (!me.monsters.some(Boolean)) {
      // our turn-1 monster died on the NPC turn: put a deck monster on the field (test-only tweak)
      const j = me.deck.findIndex((c) => { const def = e.getDef(c.uid); return def.kind === 'monster' && def.level <= 4; });
      if (j < 0) return { skip: 'no monster to tribute' };
      const [m] = me.deck.splice(j, 1);
      me.monsters[0] = { card: m, position: 'attack', faceDown: false, summonedThisTurn: false, attackedThisTurn: false, changedPositionThisTurn: false, atkMod: 0, defMod: 0 };
    }
    const onField = me.monsters.filter(Boolean);
    let i = me.deck.findIndex((c) => { const def = e.getDef(c.uid); return def.kind === 'monster' && (def.level === 5 || def.level === 6); });
    if (i < 0) return { skip: 'no Lv5-6 in deck' };
    const [c] = me.deck.splice(i, 1);
    me.hand.push(c);
    d.sync(false); d.refreshUI();
    const v = d.views.get(c.uid);
    const f = d.views.get(onField[0].card.uid);
    return { uid: c.uid, x: v.x, y: v.y, fx: f.x, fy: f.y, tribute: onField[0].card.uid };
  });
  if (trib.skip) log(`tribute flow skipped: ${trib.skip}`);
  else {
    await tap(page, trib.x, trib.y - 8);
    await sleep(200);
    const sb = await D(() => { const b = window.__YUGI__.scene.getScene('Duel').actionBtns.find((x) => x.label.text === 'SUMMON'); return b && { x: b.x, y: b.y }; });
    check(!!sb, 'Lv5+ monster offers SUMMON');
    await tap(page, sb.x, sb.y);
    await sleep(150);
    check(await D(() => window.__YUGI__.scene.getScene('Duel').mode.kind === 'tribute'), 'SUMMON on a Lv5+ monster enters tribute mode');
    await tap(page, trib.fx, trib.fy);
    await sleep(150);
    const cb = await D(() => { const b = window.__YUGI__.scene.getScene('Duel').actionBtns.find((x) => x.label.text === 'CONFIRM'); return b && { x: b.x, y: b.y }; });
    check(!!cb, 'CONFIRM appears once the tribute is chosen');
    if (cb) {
      await tap(page, cb.x, cb.y);
      await duelReady(page);
      const ok = await D((t) => {
        const d = window.__YUGI__.scene.getScene('Duel');
        const s = d.engine.state.players[0];
        const name = d.engine.getDef(t.uid).name;
        // the new monster may already be gone to a Trap Hole, so accept the summon log line too
        const summoned = s.monsters.some((m) => m?.card.uid === t.uid) || d.engine.state.log.some((l) => l.includes(`summons ${name} (tributing 1)`));
        return summoned && s.graveyard.some((c) => c.uid === t.tribute);
      }, trib);
      check(ok, 'tribute summon: new monster on field, tribute in graveyard');
    }
  }

  // 5. battle by tap: BATTLE -> tap attacker -> tap target (or DIRECT ATTACK)
  await tap(page, 392, 252);
  await sleep(700);
  const atk = await D(() => {
    const d = window.__YUGI__.scene.getScene('Duel');
    const la = d.engine.legalActions(0).filter((a) => a.type === 'declareAttack');
    if (!la.length) return null;
    const a = la.find((x) => x.targetUid !== null) ?? la[0];
    const v = d.views.get(a.attackerUid);
    const t = a.targetUid !== null ? d.views.get(a.targetUid) : null;
    return { phase: d.engine.state.phase, x: v.x, y: v.y, tx: t?.x, ty: t?.y, direct: a.targetUid === null };
  });
  check(await D(() => window.__YUGI__.scene.getScene('Duel').engine.state.phase === 'battle'), 'BATTLE tap enters the battle phase');
  if (!atk) log('no attacker available this turn; attack-by-tap skipped');
  if (atk) {
    await tap(page, atk.x, atk.y);
    await sleep(200);
    check(await D(() => window.__YUGI__.scene.getScene('Duel').mode.kind === 'attack'), 'tapping an attacker enters attack mode');
    if (atk.direct) await tap(page, 211, 76); // DIRECT ATTACK! button
    else await tap(page, atk.tx, atk.ty);
    if (!atk.direct) {
      await waitFor(page, () => { const a = window.__YUGI__.scene.getScene('Arena'); return a?.sys.isActive() && a.phase === 'fight'; }, null, { timeout: 15000, what: 'arena after attack tap' });
      check(true, 'attack by tap launches the arena');
      await arenaTouch(page, cdp);
      await waitFor(page, () => !window.__YUGI__.scene.isActive('Arena'), null, { timeout: 15000, what: 'arena end' });
      check(true, 'arena resolved back to the duel');
    } else {
      await sleep(1500);
      check(await D(() => window.__YUGI__.scene.getScene('Duel').engine.state.players[1].lp < 4000), 'direct attack by tap deals damage');
    }
  }
}

/** Joystick drag + simultaneous ability tap (multitouch), then SKIP. */
async function arenaTouch(page, cdp) {
  const before = await page.evaluate(() => {
    const a = window.__YUGI__.scene.getScene('Arena');
    const f = a.sim.fighters[a.human];
    return { x: f.x, y: f.y, abilities: f.abilities.length, cd: f.abilities[0]?.cd ?? 0 };
  });
  // finger 1: plant the stick at (90,190) and drag left (towards the wall) for ~0.6 s
  await touchRaw(page, cdp, 'touchStart', [{ id: 1, gx: 120, gy: 190 }]);
  for (let i = 1; i <= 6; i++) { await touchRaw(page, cdp, 'touchMove', [{ id: 1, gx: 120 - i * 4, gy: 190 + i * 2 }]); await sleep(40); }
  const stick = await page.evaluate(() => { const a = window.__YUGI__.scene.getScene('Arena'); return { on: a.touch.stickActive, vx: a.touch.vector.x }; });
  check(stick.on && stick.vx < -0.3, `joystick drag steers left (vx=${stick.vx.toFixed(2)})`);
  // finger 2: tap the main ability button while finger 1 keeps steering
  if (before.abilities > 0) {
    await touchRaw(page, cdp, 'touchStart', [{ id: 1, gx: 96, gy: 202 }, { id: 2, gx: 450, gy: 236 }]);
    await sleep(80);
    await touchRaw(page, cdp, 'touchMove', [{ id: 1, gx: 96, gy: 202 }]); // lift finger 2 only
  }
  await sleep(500);
  const after = await page.evaluate(() => {
    const a = window.__YUGI__.scene.getScene('Arena');
    const f = a.sim.fighters[a.human];
    return { x: f.x, y: f.y, cd: f.abilities[0]?.cd ?? 0, stick: a.touch.stickActive, hp: f.hp, done: a.sim.done };
  });
  check(after.x !== before.x || after.y !== before.y, `fighter moved under the joystick (${before.x.toFixed(0)},${before.y.toFixed(0)} -> ${after.x.toFixed(0)},${after.y.toFixed(0)})`);
  if (before.abilities > 0) check(after.cd > 0 || after.done, 'ability button fired while steering (multitouch)');
  check(after.stick || after.done, 'joystick survives the second finger');
  await touchRaw(page, cdp, 'touchEnd', []);
  await page.screenshot({ path: join(OUT, 'arena-touch.png') });
  // pause pill (W/2-52, 34) then RESUME (W/2, H/2-2)
  if (!after.done) {
    await tap(page, 188, 34);
    check(await page.evaluate(() => window.__YUGI__.scene.getScene('Arena').paused), 'arena pause pill pauses the fight');
    const t1 = await page.evaluate(() => window.__YUGI__.scene.getScene('Arena').sim.t);
    await sleep(400);
    check(t1 === await page.evaluate(() => window.__YUGI__.scene.getScene('Arena').sim.t), 'sim is frozen while paused');
    await tap(page, 240, 133);
    await sleep(100);
    check(!(await page.evaluate(() => window.__YUGI__.scene.getScene('Arena').paused)), 'RESUME unpauses the arena');
    await tap(page, 260, 34); // SKIP
  }
}

// ---------------------------------------------------------------------------------------------
async function hooks(browser, url) {
  log('--- ?arena= dev hook ---');
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  const problems = watchConsole(page, '[arena hook] ');
  await page.goto(`${url}?arena=dark-magician,blue-eyes-white-dragon&auto=1&ai=hard`);
  await waitFor(page, () => { const a = window.__YUGI__?.scene.getScene('Arena'); return a?.sys.isActive() && a.phase === 'fight'; }, null, { timeout: 40000, what: 'dev-hook arena fight' });
  const seed0 = await page.evaluate(() => window.__YUGI__.scene.getScene('Arena').data0.request.seed);
  await page.screenshot({ path: join(OUT, 'arena-hook.png') });
  await waitFor(page, (s) => { const a = window.__YUGI__.scene.getScene('Arena'); return a?.sys.isActive() && a.data0.request.seed !== s; }, seed0, { timeout: 45000, what: 'dev-hook fight to resolve and restart' });
  check(true, 'dev-hook auto fight resolved and restarted with seed+1');
  await ctx.close();
  failures.push(...problems);

  log('--- art.html ---');
  const ctx2 = await browser.newContext(PHONE);
  const p2 = await ctx2.newPage();
  const probs2 = watchConsole(p2, '[art] ');
  await p2.goto(`${url}art.html`);
  await waitFor(p2, () => window.__game?.scene.getScenes(true).length > 0, null, { timeout: 40000, what: 'art gallery' });
  await sleep(1500);
  await p2.screenshot({ path: join(OUT, 'art.png') });
  check(true, 'art.html boots');
  await ctx2.close();
  failures.push(...probs2);
}

// ---------------------------------------------------------------------------------------------
async function main() {
  const { chromium } = await loadPlaywright();
  const srv = await startPreview();
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const problems = watchConsole(page);
    await bootTitle(page, srv.url);
    check(await page.evaluate(() => !!window.__YUGI__.input.touch), 'touch input active on the phone profile');
    if (want('match')) await fullMatch(page);
    if (want('touch')) { if (!(await isActive(page, 'Title'))) await bootTitle(page, srv.url); await touchPass(page, cdp); }
    failures.push(...problems);
    await ctx.close();
    if (want('hooks')) await hooks(browser, srv.url);
  } catch (e) {
    failures.push(`exception: ${e.stack ?? e}`);
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log('');
  if (failures.length) {
    console.log(`E2E FAILED (${failures.length}):\n - ${failures.join('\n - ')}`);
    process.exit(1);
  }
  console.log(`E2E PASSED  (screenshots in tests/e2e/out/)`);
  process.exit(0);
}

main();
