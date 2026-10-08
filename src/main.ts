import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { DuelScene } from './scenes/DuelScene';
import { ArenaScene } from './scenes/ArenaScene';
import { ResultScene } from './scenes/ResultScene';
import { ArtGalleryScene } from './scenes/ArtGalleryScene';
import { installMobile } from './mobile';

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
  // FIT letterboxes the fixed 16:9 canvas inside #game, which index.html shrinks to the
  // notch-free safe area; on 18:9-20:9 phones the spare width becomes side pillars.
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  // 3 touch points: joystick thumb + 2 ability/spell taps at once.
  input: { activePointers: 3, touch: { capture: true } },
  disableContextMenu: true,
  scene: [BootScene, TitleScene, DuelScene, ArenaScene, ResultScene, ArtGalleryScene],
};

const game = new Phaser.Game(config);
// Gestures, pause-on-background, Android back button, fullscreen/landscape, audio unlock.
installMobile(game);

export default game;

// Debug/QA handle (Playwright smoke tests): window.__YUGI__.scene.getScene('Duel').engine
(window as unknown as { __YUGI__: Phaser.Game }).__YUGI__ = game;
