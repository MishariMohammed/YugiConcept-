import Phaser from 'phaser';
import { allCards, getDecks, loadDefaultCards } from '../core/cards/CardDB';
import { SCENES } from './SceneBus';
import { label } from './ui';

/** Loads card data (and later: assets / generated placeholder art), then goes to the title. */
export class BootScene extends Phaser.Scene {
  constructor() { super(SCENES.Boot); }

  create(): void {
    const ok = loadDefaultCards();
    if (!ok || Object.keys(getDecks()).length < 2) {
      label(this, 10, 10, 'Card data missing (src/data/cards.json, src/data/decks.ts).', { color: '#ff6b6b' });
      return;
    }
    console.info(`[Boot] ${allCards().length} cards, decks: ${Object.keys(getDecks()).join(', ')}`);
    this.scene.start(SCENES.Title);
  }
}
