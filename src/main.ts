import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { DuelScene } from './scenes/DuelScene';
import { ArenaScene } from './scenes/ArenaScene';
import { ResultScene } from './scenes/ResultScene';
import { ArtGalleryScene } from './scenes/ArtGalleryScene';

export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#1a1423',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  input: { activePointers: 3 },
  scene: [BootScene, TitleScene, DuelScene, ArenaScene, ResultScene, ArtGalleryScene],
};

const game = new Phaser.Game(config);
// Lock to landscape where supported (Android/Capacitor); ignore failures on desktop.
try {
  (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape')?.catch(() => {});
} catch { /* not supported */ }

export default game;

// Debug/QA handle (Playwright smoke tests): window.__YUGI__.scene.getScene('Duel').engine
(window as unknown as { __YUGI__: Phaser.Game }).__YUGI__ = game;
