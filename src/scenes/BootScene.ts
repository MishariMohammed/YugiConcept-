import Phaser from 'phaser';
import { allCards, getDecks, loadDefaultCards } from '../core/cards/CardDB';
import { SCENES } from './SceneBus';
import { prewarmArt } from '../fx/art';
import { ensurePixelFonts, pixelText, setPixelText } from '../ui/PixelText';
import { panelTexture } from '../ui/Widgets';
import { PALT } from '../fx/art/Palette';

/** Loads card data, bakes all procedural card art (time-sliced) behind a pixel loading bar. */
export class BootScene extends Phaser.Scene {
  constructor() { super(SCENES.Boot); }

  create(): void {
    ensurePixelFonts(this);
    const { width: W, height: H } = this.scale;
    const ok = loadDefaultCards();
    if (!ok || Object.keys(getDecks()).length < 2) {
      pixelText(this, 10, 10, 'CARD DATA MISSING (SRC/DATA/CARDS.JSON)', 1, PALT.red);
      return;
    }
    if (!this.registry.has('difficulty')) this.registry.set('difficulty', 'normal');
    const cards = allCards();
    console.info(`[Boot] ${cards.length} cards, decks: ${Object.keys(getDecks()).join(', ')}`);

    pixelText(this, W / 2, H / 2 - 26, 'YUGI CONCEPT', 2, PALT.gold, { originX: 0.5, originY: 0.5 });
    const bw = 200, bh = 16;
    this.add.image(W / 2, H / 2 + 4, panelTexture(this, bw + 8, bh + 8));
    const bar = this.add.graphics();
    const label = pixelText(this, W / 2, H / 2 + 24, 'SHUFFLING ART... 0%', 1, PALT.haze, { originX: 0.5, tiny: true });
    const draw = (p: number) => {
      bar.clear();
      const x0 = W / 2 - bw / 2, y0 = H / 2 + 4 - bh / 2;
      const fw = Math.round((bw - 4) * p);
      bar.fillStyle(PALT.ink, 1).fillRect(x0 + 2, y0 + 2, bw - 4, bh - 4);
      // chunky segments
      for (let x = 0; x < fw; x += 6) {
        bar.fillStyle(x % 12 === 0 ? PALT.gold : PALT.orange, 1).fillRect(x0 + 2 + x, y0 + 2, Math.min(5, fw - x), bh - 4);
      }
      bar.fillStyle(0xffffff, 0.35).fillRect(x0 + 2, y0 + 2, fw, 2);
      setPixelText(label, `SHUFFLING ART... ${Math.round(p * 100)}%`);
    };
    draw(0);
    prewarmArt(this, cards, { onProgress: draw }).then(() => {
      this.time.delayedCall(120, () => this.scene.start(SCENES.Title));
    });
  }
}
