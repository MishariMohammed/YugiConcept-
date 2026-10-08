#!/usr/bin/env node
// FPS probe: Title, Duel (idle + autoplay) and Arena (auto fight) on desktop and on an emulated
// mid-range phone with CPU throttling.  npm run perf  [-- --quick]
//
// Note: headless Chromium renders WebGL with SwiftShader (software GL) inside the container, so
// absolute numbers are pessimistic vs a real phone GPU; compare runs relative to each other.
import { PHONE, activeScenes, loadPlaywright, log, measureFps, sleep, startPreview, waitFor, watchConsole } from './harness.mjs';

const quick = process.argv.includes('--quick');
const SAMPLE = quick ? 3000 : 5000;

const PROFILES = [
  { name: 'desktop 1280x720', ctx: { viewport: { width: 1280, height: 720 } }, throttle: 1 },
  { name: 'phone 851x393 @2.75x', ctx: PHONE, throttle: 1 },
  { name: 'phone + 4x CPU throttle', ctx: PHONE, throttle: 4 },
  { name: 'phone + 6x CPU throttle', ctx: PHONE, throttle: 6 },
];

async function run() {
  const { chromium } = await loadPlaywright();
  const srv = await startPreview();
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const rows = [];
  try {
    for (const prof of quick ? [PROFILES[0], PROFILES[2]] : PROFILES) {
      const ctx = await browser.newContext(prof.ctx);
      const page = await ctx.newPage();
      const problems = watchConsole(page);
      const cdp = await ctx.newCDPSession(page);
      await page.goto(srv.url);
      await waitFor(page, () => window.__YUGI__?.scene.isActive('Title'), null, { timeout: 30000, what: 'Title' });
      const renderer = await page.evaluate(() => (window.__YUGI__.renderer.type === 2 ? 'WebGL' : 'Canvas'));
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.throttle });
      const r = { profile: prof.name, renderer };
      await sleep(500);
      r.title = await measureFps(page, SAMPLE);

      // Duel: idle on the human's first main phase
      await page.evaluate(() => window.__YUGI__.scene.getScene('Title').scene.start('Duel', { deck0: 'yugi', deck1: 'kaiba', seed: 7, difficulty: 'normal' }));
      await waitFor(page, () => { const d = window.__YUGI__.scene.getScene('Duel'); return d?.sys.isActive() && d.canInput?.(); }, null, { timeout: 30000, what: 'duel input' });
      await sleep(300);
      r.duelIdle = await measureFps(page, SAMPLE);
      // Duel: autoplay (animations, NPC turns; arena fights are skipped so we stay on the board)
      await page.evaluate(() => {
        const d = window.__YUGI__.scene.getScene('Duel');
        d.autoplay = true; d.afterChange();
        window.__skipArena = setInterval(() => {
          const a = window.__YUGI__.scene.getScene('Arena');
          if (a?.sys.isActive() && a.phase === 'fight') a.skipFight();
        }, 50);
      });
      r.duelAuto = await measureFps(page, SAMPLE);
      await page.evaluate(() => clearInterval(window.__skipArena));

      // Arena: auto fight through the dev hook
      await page.goto(`${srv.url}?arena=dark-magician,blue-eyes-white-dragon&auto=1&ai=hard`);
      await waitFor(page, () => { const a = window.__YUGI__?.scene.getScene('Arena'); return a?.sys.isActive() && a.phase === 'fight'; }, null, { timeout: 30000, what: 'arena fight' });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.throttle });
      r.arena = await measureFps(page, SAMPLE * 1.4);
      r.scenes = (await activeScenes(page)).join(',');
      r.problems = problems.length;
      if (problems.length) console.log(problems.join('\n'));
      rows.push(r);
      const f = (m) => `${m.fps} fps (p95 ${m.p95ms} ms, worst ${m.worstMs} ms)`;
      log(`${prof.name} [${renderer}]\n   title ${f(r.title)}\n   duel idle ${f(r.duelIdle)}\n   duel auto ${f(r.duelAuto)}\n   arena ${f(r.arena)}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.stop();
  }
  console.log('\n| profile | title | duel idle | duel auto | arena |\n|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.profile} | ${r.title.fps} | ${r.duelIdle.fps} | ${r.duelAuto.fps} | ${r.arena.fps} |`);
}

run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
