import Phaser from 'phaser';
import { SCENES, type ResultSceneData } from './SceneBus';
import { button, label } from './ui';

export class ResultScene extends Phaser.Scene {
  constructor() { super(SCENES.Result); }

  create(data: ResultSceneData): void {
    const { width, height } = this.scale;
    const text = data.winner === 'draw' ? 'DRAW' : data.winner === data.humanPlayer ? 'YOU WIN!' : 'YOU LOSE';
    label(this, width / 2, height / 3, text, { fontSize: '24px', color: '#ffd166' }).setOrigin(0.5);
    label(this, width / 2, height / 3 + 24, `Turns: ${data.turns}   LP ${data.lp[0]} - ${data.lp[1]}`).setOrigin(0.5);
    button(this, width / 2, height * 0.7, '  Back to title  ', () => this.scene.start(SCENES.Title)).setOrigin(0.5);
  }
}
