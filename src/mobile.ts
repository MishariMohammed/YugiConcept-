// Mobile / Android glue: gesture suppression, pause-on-background, Android back button,
// browser fullscreen + landscape lock, audio unlock and the PWA service worker.
//
// Scenes listen for `PAUSE_EVENT` on game.events and open their pause menu (DuelScene) or
// freeze the fight (ArenaScene). Phaser itself already stops its loop while the tab is hidden;
// the pause menu makes sure the player comes back to a paused game instead of a running fight.
import Phaser from 'phaser';
import { Capacitor } from '@capacitor/core';
import { installAudioUnlock, sfx } from './fx/Sfx';

export const PAUSE_EVENT = 'yugi:pause';

const isNative = (): boolean => { try { return Capacitor.isNativePlatform(); } catch { return false; } };

export function installMobile(game: Phaser.Game): void {
  const doc = document;

  // ---- no page scroll / pinch zoom / long-press menu / double-tap zoom / text selection
  doc.addEventListener('contextmenu', (e) => e.preventDefault());
  doc.addEventListener('gesturestart', (e) => e.preventDefault()); // iOS Safari pinch
  doc.addEventListener('dblclick', (e) => e.preventDefault());
  doc.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || e.target === doc.body) e.preventDefault(); }, { passive: false });
  doc.addEventListener('selectstart', (e) => e.preventDefault());

  installAudioUnlock();

  // ---- pause when hidden (tab switch, screen off, app backgrounded)
  const requestPause = (reason: string) => game.events.emit(PAUSE_EVENT, reason);
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) { requestPause('hidden'); sfx.suspend(); } else sfx.resume();
  });
  window.addEventListener('blur', () => requestPause('blur'));

  if (isNative()) {
    // Capacitor App plugin: pause/resume + hardware back button.
    void import('@capacitor/app').then(({ App }) => {
      void App.addListener('pause', () => { requestPause('app-pause'); sfx.suspend(); });
      void App.addListener('resume', () => sfx.resume());
      void App.addListener('backButton', () => {
        const sm = game.scene;
        if (sm.isActive('Title')) { void App.exitApp(); return; }
        if (sm.isActive('Result')) { sm.getScenes(true).forEach((s) => s.scene.stop()); sm.start('Title'); return; }
        requestPause('back');
      });
    }).catch(() => {});
  } else {
    // ---- mobile browser: go fullscreen + lock landscape on the first tap (needs a user gesture)
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const standalone = window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches;
    if (coarse && !standalone) {
      const goFull = () => {
        const el = doc.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
        if (doc.fullscreenElement) return;
        const p = el.requestFullscreen?.({ navigationUI: 'hide' }) ?? (el.webkitRequestFullscreen?.(), undefined);
        Promise.resolve(p).then(() => lockLandscape()).catch(() => {});
      };
      doc.addEventListener('pointerup', goFull, { once: true });
    } else lockLandscape();

    // ---- PWA offline cache (secure contexts only: https or localhost; not in `vite dev`)
    if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
      window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
    }
  }
}

function lockLandscape(): void {
  try {
    const o = screen.orientation as unknown as { lock?: (o: string) => Promise<void> };
    o.lock?.('landscape')?.catch(() => {});
  } catch { /* unsupported (desktop, iOS) */ }
}
