import Phaser from 'phaser';
import { SCENES, type DuelSceneData, type ResultSceneData } from './SceneBus';
import { addSwirlBackground, SWIRL_PRESETS } from '../ui/Background';
import { pixelText } from '../ui/PixelText';
import { PixelButton, panelTexture } from '../ui/Widgets';
import { burst, ensureFxTextures } from '../fx/Juice';
import { PALT } from '../fx/art/Palette';

/** Extra fields the DuelScene passes along (optional so the base contract still works). */
export interface ResultStats {
  fightsWon: number;
  fightsTotal: number;
  damageDealt: number;
  damageTaken: number;
}
export type ResultData = ResultSceneData & { stats?: ResultStats; deck0?: string; deck1?: string; difficulty?: string };

export class ResultScene extends Phaser.Scene {
  constructor() { super(SCENES.Result); }

  create(data: ResultData): void {
    const { width: W, height: H } = this.scale;
    ensureFxTextures(this);
    const won = data.winner === data.humanPlayer;
    const draw = data.winner === 'draw';
    addSwirlBackground(this, { colors: won ? SWIRL_PRESETS.victory : draw ? SWIRL_PRESETS.duel : SWIRL_PRESETS.defeat });
    const title = draw ? 'DRAW' : won ? 'VICTORY!' : 'DEFEAT';
    const color = draw ? PALT.cream : won ? PALT.gold : PALT.red;
    const t = pixelText(this, W / 2, 48, title, 4, color, { originX: 0.5, originY: 0.5 }).setScale(0.2);
    this.tweens.add({ targets: t, scale: 1, duration: 420, ease: 'Back.Out' });
    if (won) {
      this.time.addEvent({ delay: 350, repeat: 5, callback: () => burst(this, Phaser.Math.Between(80, W - 80), Phaser.Math.Between(30, 90), {
        count: 18, texture: 'px-star', colors: [PALT.gold, PALT.cream, PALT.orange], speed: 110, gravity: 120, lifespan: 800,
      }) });
    }

    const s = data.stats;
    const rows: [string, string, number][] = [
      ['TURNS', String(data.turns), PALT.cream],
      ['FIGHTS WON', s ? `${s.fightsWon} / ${s.fightsTotal}` : '-', PALT.gold],
      ['DAMAGE DEALT', s ? String(s.damageDealt) : '-', PALT.red],
      ['DAMAGE TAKEN', s ? String(s.damageTaken) : '-', PALT.blue],
      ['FINAL LP', `${data.lp[data.humanPlayer]} - ${data.lp[data.humanPlayer === 0 ? 1 : 0]}`, PALT.cream],
    ];
    const pw = 200, ph = rows.length * 14 + 16;
    this.add.image(W / 2, 86 + ph / 2, panelTexture(this, pw, ph));
    rows.forEach(([k, v, c], i) => {
      const y = 94 + i * 14;
      const a = pixelText(this, W / 2 - pw / 2 + 12, y, k, 1, PALT.haze);
      const b = pixelText(this, W / 2 + pw / 2 - 12, y, v, 1, c, { originX: 1 });
      [a, b].forEach((o) => { o.setAlpha(0); this.tweens.add({ targets: o, alpha: 1, delay: 300 + i * 90, duration: 150 }); });
    });

    new PixelButton(this, W / 2 - 60, H - 34, 100, 28, 'REMATCH', PALT.orange, () => {
      const d: DuelSceneData & { difficulty?: string } = {
        deck0: data.deck0 ?? 'yugi', deck1: data.deck1 ?? 'kaiba', seed: Date.now() & 0x7fffffff, difficulty: data.difficulty,
      };
      this.scene.start(SCENES.Duel, d);
    }, { size: 1 });
    new PixelButton(this, W / 2 + 60, H - 34, 100, 28, 'TITLE', PALT.blue, () => this.scene.start(SCENES.Title));
  }
}
