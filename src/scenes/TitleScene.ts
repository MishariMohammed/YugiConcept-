import Phaser from 'phaser';
import { getDecks, hasCard, getCard } from '../core/cards/CardDB';
import { SCENES, type DuelSceneData } from './SceneBus';
import { addSwirlBackground, SWIRL_PRESETS } from '../ui/Background';
import { pixelText } from '../ui/PixelText';
import { PixelButton } from '../ui/Widgets';
import { CardView } from '../ui/CardView';
import { PALT } from '../fx/art/Palette';

type Difficulty = 'easy' | 'normal' | 'hard';

export class TitleScene extends Phaser.Scene {
  constructor() { super(SCENES.Title); }

  create(): void {
    const { width: W, height: H } = this.scale;
    addSwirlBackground(this, { colors: SWIRL_PRESETS.menu });

    // Logo: per-letter bobbing pixel text
    const word = 'YUGI CONCEPT';
    const letters: Phaser.GameObjects.BitmapText[] = [];
    let x = 0;
    const scale = 3;
    const tmp = word.split('').map((ch) => {
      const t = pixelText(this, 0, 0, ch, scale, ch === ' ' ? PALT.gold : PALT.gold, { originX: 0, originY: 0.5 });
      const w = ch === ' ' ? 9 : t.width;
      const o = { t, w };
      return o;
    });
    const total = tmp.reduce((s, o) => s + o.w + 3, -3);
    x = W / 2 - total / 2;
    tmp.forEach((o, i) => {
      o.t.setPosition(x, 46);
      if (i >= 5) o.t.setTint(PALT.cream);
      letters.push(o.t);
      x += o.w + 3;
      this.tweens.add({ targets: o.t, y: 42, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: i * 70 });
    });
    pixelText(this, W / 2, 70, 'A DUEL OF CARDS AND CLAWS', 1, PALT.haze, { originX: 0.5, tiny: true });

    // Showcase cards
    const showcase = (id: string, x0: number, angle: number) => {
      if (!hasCard(id)) return;
      const v = new CardView(this, x0, 150, getCard(id), { large: true, scale: 0.75, interactive: true });
      v.setAngle(angle);
      v.on('cardTap', () => v.playSummonBounce());
    };
    showcase('dark-magician', 62, -6);
    showcase('blue-eyes-white-dragon', W - 62, 6);

    // Matchup line
    const decks = Object.keys(getDecks());
    const [d0, d1] = decks;
    pixelText(this, W / 2 - 12, 98, d0.toUpperCase(), 2, PALT.blue, { originX: 1, originY: 0.5 });
    pixelText(this, W / 2, 98, 'VS', 1, PALT.red, { originX: 0.5, originY: 0.5 });
    pixelText(this, W / 2 + 12, 98, d1.toUpperCase(), 2, PALT.red, { originX: 0, originY: 0.5 });

    // Difficulty picker
    pixelText(this, W / 2, 124, 'DIFFICULTY', 1, PALT.cream, { originX: 0.5, tiny: true });
    const diffs: Difficulty[] = ['easy', 'normal', 'hard'];
    const colors: Record<Difficulty, number> = { easy: PALT.green, normal: PALT.blue, hard: PALT.red };
    let cur = (this.registry.get('difficulty') as Difficulty) ?? 'normal';
    if (!diffs.includes(cur)) cur = 'normal';
    const btns = diffs.map((d, i) => new PixelButton(this, W / 2 + (i - 1) * 58, 144, 54, 22, d.toUpperCase(), PALT.dusk, () => {
      cur = d; this.registry.set('difficulty', d); refresh(); btns[i].pulse();
    }));
    const refresh = () => btns.forEach((b, i) => b.setColor(diffs[i] === cur ? colors[diffs[i]] : PALT.dusk));
    refresh();

    // Duel button
    const duel = new PixelButton(this, W / 2, 190, 124, 30, 'DUEL!', PALT.orange, () => {
      this.registry.set('difficulty', cur);
      const data: DuelSceneData & { difficulty: Difficulty } = { deck0: d0, deck1: d1, seed: Date.now() & 0x7fffffff, difficulty: cur };
      this.cameras.main.fadeOut(180, 20, 12, 28);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start(SCENES.Duel, data));
    }, { size: 2 });
    this.tweens.add({ targets: duel, scale: 1.05, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

    if (this.scene.get('ArtGallery')) {
      new PixelButton(this, W - 30, H - 18, 48, 20, 'ART', PALT.violet, () => this.scene.start('ArtGallery'), { tiny: true });
    }
    pixelText(this, W / 2, H - 10, 'PRIVATE PROTOTYPE - NOT FOR DISTRIBUTION', 1, PALT.dusk, { originX: 0.5, tiny: true });
    this.cameras.main.fadeIn(200, 20, 12, 28);
  }
}
