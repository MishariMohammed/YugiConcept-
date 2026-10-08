import Phaser from 'phaser';
import { getDecks } from '../core/cards/CardDB';
import { SCENES, type DuelSceneData } from './SceneBus';
import { button, label } from './ui';

export class TitleScene extends Phaser.Scene {
  constructor() { super(SCENES.Title); }

  create(): void {
    const { width, height } = this.scale;
    label(this, width / 2, height / 3, 'YugiConcept', { fontSize: '24px', color: '#ffd166' }).setOrigin(0.5);
    label(this, width / 2, height / 3 + 22, 'private prototype - not for distribution', { color: '#9b8fb0' }).setOrigin(0.5);
    const deckIds = Object.keys(getDecks());
    const [d0, d1] = deckIds;
    button(this, width / 2, height * 0.65, `  DUEL  (${d0} vs ${d1})  `, () => {
      const data: DuelSceneData = { deck0: d0, deck1: d1, seed: (Date.now() & 0x7fffffff) };
      this.scene.start(SCENES.Duel, data);
    }).setOrigin(0.5);
  }
}
