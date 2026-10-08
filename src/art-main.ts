// Dev entry that boots only the procedural art gallery: open /art.html with `npm run dev`.
import Phaser from 'phaser';
import { ArtGalleryScene } from './scenes/ArtGalleryScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 480,
  height: 270,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#140c1c',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [ArtGalleryScene],
});
(window as unknown as { __game: Phaser.Game }).__game = game;
