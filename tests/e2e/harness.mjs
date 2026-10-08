// Shared Playwright helpers for the e2e smoke test and the perf probe.
//
// Playwright is resolved from the project (npm i -D playwright) or, failing that, from the
// global npm root (e.g. /opt/node22/lib/node_modules/playwright).
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GAME_W = 480;
export const GAME_H = 270;

export async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* not installed locally */ }
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const req = createRequire(join(globalRoot, 'noop.js'));
    return req('playwright');
  } catch {
    throw new Error('Playwright not found. Install it with: npm i -D playwright && npx playwright install chromium');
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function log(...a) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}]`, ...a);
}

/** `vite build` (unless SKIP_BUILD=1) then `vite preview` on a free-ish port. Returns {url, stop}. */
export async function startPreview({ build = process.env.SKIP_BUILD !== '1', port = 4319 } = {}) {
  if (build) {
    log('vite build...');
    execSync('npx vite build --logLevel error', { cwd: ROOT, stdio: 'inherit' });
  }
  const proc = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url); if (r.ok) break; } catch { /* not up yet */ }
    if (proc.exitCode !== null) throw new Error(`vite preview exited:\n${out}`);
    await sleep(150);
  }
  const stop = () => {
    try { process.platform === 'win32' ? proc.kill() : process.kill(-proc.pid, 'SIGTERM'); } catch { /* gone */ }
  };
  process.on('exit', stop);
  return { url, stop };
}

/** Mid-range Android phone in landscape (Pixel-5-ish CSS viewport, 20:9). */
export const PHONE = {
  viewport: { width: 851, height: 393 },
  deviceScaleFactor: 2.75,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
};

/**
 * Collect console errors / page errors / suspicious warnings. `problems` fills up as they happen.
 * Warnings from the duel glue ("illegal action", "animation error") count as failures too.
 */
export function watchConsole(page, label = '') {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`${label}pageerror: ${e.message}\n${e.stack ?? ''}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') problems.push(`${label}console.error: ${t}`);
    else if (m.type() === 'warning' && /illegal action|animation error|\[Arena\]|\[Duel\]/i.test(t)) problems.push(`${label}console.warn: ${t}`);
  });
  return problems;
}

/** Map game coordinates (480x270) to page CSS pixels using the canvas rect. */
export async function toPage(page, gx, gy) {
  const r = await page.evaluate(() => {
    const c = document.querySelector('#game canvas');
    const b = c.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  });
  return { x: r.x + (gx / 480) * r.w, y: r.y + (gy / 270) * r.h };
}

/** Tap at game coordinates (touch if the context has touch, else mouse click). */
export async function tap(page, gx, gy, { touch = true } = {}) {
  const p = await toPage(page, gx, gy);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  await sleep(60);
}

/**
 * Raw multitouch via CDP. `points` = every finger currently down ([{id, gx, gy}]); CDP diffs it
 * against the previous call, so dropping a finger from the list releases just that finger.
 * touchEnd releases all fingers.
 */
export async function touchRaw(page, cdp, type, points) {
  const tps = [];
  for (const p of points) {
    const q = await toPage(page, p.gx, p.gy);
    tps.push({ x: q.x, y: q.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 });
  }
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : tps });
}

/** Wait until fn() (evaluated in the page) is truthy. */
export async function waitFor(page, fn, arg, { timeout = 20000, interval = 100, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg).catch((e) => { throw new Error(`${what}: ${e.message}`); });
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`Timed out after ${timeout} ms waiting for ${what}`);
    await sleep(interval);
  }
}

export const activeScenes = (page) => page.evaluate(() => {
  const g = window.__YUGI__;
  return g ? g.scene.getScenes(true).map((s) => s.scene.key) : [];
});

/** Sample real rAF frame times in the page for `ms`. Returns {fps, p95ms, worstMs, frames}. */
export function measureFps(page, ms = 5000) {
  return page.evaluate((dur) => new Promise((res) => {
    const times = [];
    let last = performance.now();
    const t0 = last;
    const tick = (now) => {
      times.push(now - last); last = now;
      if (now - t0 < dur) requestAnimationFrame(tick);
      else {
        times.shift();
        const sorted = [...times].sort((a, b) => a - b);
        const avg = times.reduce((s, x) => s + x, 0) / times.length;
        res({
          fps: Math.round((1000 / avg) * 10) / 10,
          p95ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
          worstMs: Math.round(sorted[sorted.length - 1] * 10) / 10,
          frames: times.length,
        });
      }
    };
    requestAnimationFrame(tick);
  }), ms);
}
