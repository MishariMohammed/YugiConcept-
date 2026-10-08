// Balatro-style UI widgets built from generated pixel textures: buttons, panels, LP bars,
// banners and toasts. Everything is touch-first (>= 24px tall targets at 480x270).

import Phaser from 'phaser';
import { PixelCanvas, ensureTexture, hex, mix, shift, toTint, withAlpha } from '../fx/art/PixelCanvas';
import { PAL, PALT } from '../fx/art/Palette';
import { pixelText, setPixelText } from './PixelText';
import { sfx } from '../fx/Sfx';

const INK = hex(PAL.ink);

/** Rounded, bevelled button face with a darker "lip" under it (Balatro button look). */
export function buttonTexture(scene: Phaser.Scene, w: number, h: number, color: number): string {
  const key = `btn-${w}x${h}-${color.toString(16)}`;
  return ensureTexture(scene, key, w, h + 2, (pc) => {
    const base = hex('#' + color.toString(16).padStart(6, '0'));
    const lip = shift(base, -0.45);
    pc.roundRect(0, 2, w, h, 3, INK);
    pc.roundRect(0, 0, w, h, 3, INK);
    pc.roundRect(1, 1, w - 2, h - 1, 2, lip);
    pc.roundRect(1, 1, w - 2, h - 3, 2, base);
    pc.hline(3, w - 4, 1, shift(base, 0.35));
    pc.hline(2, w - 3, 2, shift(base, 0.15));
  });
}

/** Dark rounded panel (side panels, LP boxes, modals). */
export function panelTexture(scene: Phaser.Scene, w: number, h: number, color = PAL.plum, border = PAL.violet): string {
  const key = `panel-${w}x${h}-${color}-${border}`;
  return ensureTexture(scene, key, w, h, (pc) => drawPanel(pc, 0, 0, w, h, hex(color), hex(border)));
}

export function drawPanel(pc: PixelCanvas, x: number, y: number, w: number, h: number, fill: number, border: number): void {
  pc.roundRect(x, y, w, h, 4, INK);
  pc.roundRect(x + 1, y + 1, w - 2, h - 2, 3, border);
  pc.roundRect(x + 2, y + 2, w - 4, h - 4, 2, fill);
  pc.hline(x + 4, x + w - 5, y + 2, withAlpha(shift(fill, 0.12), 255));
}

export interface ButtonOpts {
  /** pixel font scale for the label (default 1) */
  size?: number;
  tiny?: boolean;
  textColor?: number;
  /** extra transparent padding around the hit area */
  hitPad?: number;
}

/** Tappable pixel button. Emits onTap on pointer-up inside. */
export class PixelButton extends Phaser.GameObjects.Container {
  readonly bg: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.BitmapText;
  enabled = true;
  private color: number;
  private bw: number;
  private bh: number;
  private pressed = false;
  onTap: () => void;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, color: number, onTap: () => void, opts: ButtonOpts = {}) {
    super(scene, x, y);
    this.bw = w; this.bh = h; this.color = color; this.onTap = onTap;
    this.bg = scene.add.image(0, 0, buttonTexture(scene, w, h, color)).setOrigin(0.5, 0.5 - 1 / (h + 2));
    this.label = pixelText(scene, 0, -1, text, opts.size ?? 1, opts.textColor ?? PALT.white, { originX: 0.5, originY: 0.5, tiny: opts.tiny });
    this.add([this.bg, this.label]);
    const pad = opts.hitPad ?? 2;
    this.setSize(w + pad * 2, Math.max(24, h + pad * 2));
    this.setInteractive({ cursor: 'pointer' });
    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => { if (this.enabled) this.press(true); });
    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => this.press(false));
    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
      if (!this.enabled || !this.pressed) return;
      this.press(false);
      sfx.play('click');
      this.onTap();
    });
    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => { if (this.enabled) this.bg.setTint(0xffffff).setScale(1.04); });
    scene.add.existing(this);
  }

  private press(on: boolean): void {
    this.pressed = on;
    this.bg.y = on ? 1 : 0;
    this.label.y = on ? 0 : -1;
    if (!on) this.bg.setScale(1);
  }

  setText(t: string): this { setPixelText(this.label, t); return this; }

  setColor(color: number): this {
    if (color !== this.color) { this.color = color; this.bg.setTexture(buttonTexture(this.scene, this.bw, this.bh, color)); }
    return this;
  }

  setEnabled(on: boolean): this {
    this.enabled = on;
    this.setAlpha(on ? 1 : 0.4);
    return this;
  }

  /** Little attention pulse. */
  pulse(): void {
    this.scene.tweens.add({ targets: this, scale: { from: 1.12, to: 1 }, duration: 220, ease: 'Back.Out' });
  }
}

/** LP display: name, big animated number, segmented bar. */
export class LPBar extends Phaser.GameObjects.Container {
  private value: number;
  private max: number;
  private shown: number;
  private readonly num: Phaser.GameObjects.BitmapText;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly barW: number;
  private readonly color: number;
  private tween?: Phaser.Tweens.Tween;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, name: string, color: number, lp: number) {
    super(scene, x, y);
    this.value = lp; this.max = lp; this.shown = lp;
    this.barW = w - 10;
    this.color = color;
    const bg = scene.add.image(0, 0, panelTexture(scene, w, 34)).setOrigin(0);
    const nm = pixelText(scene, 6, 5, name, 1, color, { tiny: true });
    const lpTag = pixelText(scene, w - 6, 5, 'LP', 1, PALT.haze, { tiny: true, originX: 1 });
    this.num = pixelText(scene, 6, 12, String(lp), 1, PALT.cream);
    this.num.setScale(1);
    this.bar = scene.add.graphics();
    this.add([bg, nm, lpTag, this.num, this.bar]);
    this.drawBar();
    scene.add.existing(this);
  }

  get lp(): number { return this.value; }

  private drawBar(): void {
    const g = this.bar;
    g.clear();
    const x = 5, y = 24, h = 5;
    g.fillStyle(PALT.ink, 1).fillRect(x, y, this.barW, h);
    const frac = Math.max(0, Math.min(1, this.shown / this.max));
    const col = frac > 0.5 ? this.color : frac > 0.25 ? PALT.gold : PALT.red;
    g.fillStyle(col, 1).fillRect(x + 1, y + 1, Math.round((this.barW - 2) * frac), h - 2);
    g.fillStyle(0xffffff, 0.35).fillRect(x + 1, y + 1, Math.round((this.barW - 2) * frac), 1);
    // segment ticks every 1000 LP
    g.fillStyle(PALT.ink, 0.6);
    for (let v = 1000; v < this.max; v += 1000) g.fillRect(x + Math.round((this.barW * v) / this.max), y + 1, 1, h - 2);
  }

  /** Animate to a new LP value (~500 ms). */
  setLP(v: number, duration = 500): Promise<void> {
    this.value = v;
    this.tween?.stop();
    const down = v < this.shown;
    return new Promise((res) => {
      this.tween = this.scene.tweens.addCounter({
        from: this.shown, to: v, duration, ease: 'Cubic.Out',
        onUpdate: (tw) => { this.shown = Math.round(tw.getValue() ?? v); setPixelText(this.num, String(this.shown)); this.drawBar(); },
        onComplete: () => { this.shown = v; setPixelText(this.num, String(v)); this.drawBar(); res(); },
      });
      if (down) {
        this.num.setTint(PALT.red);
        this.scene.tweens.add({ targets: this, x: { from: this.x - 2, to: this.x }, duration: 60, repeat: 2, yoyo: true });
        this.scene.time.delayedCall(duration, () => this.num.setTint(PALT.cream));
      } else {
        this.num.setTint(PALT.green);
        this.scene.time.delayedCall(duration, () => this.num.setTint(PALT.cream));
      }
    });
  }
}

/** Slide-in banner across the board ("TRAP ACTIVATED", "YOUR TURN"...). Resolves when gone. */
export function banner(
  scene: Phaser.Scene, y: number, text: string, color: number, opts: { sub?: string; hold?: number; depth?: number; width?: number; x?: number } = {},
): Promise<void> {
  const w = opts.width ?? scene.scale.width;
  const cx = opts.x ?? scene.scale.width / 2;
  const h = opts.sub ? 30 : 22;
  const key = ensureTexture(scene, `banner-${w}x${h}-${color.toString(16)}`, w, h, (pc) => {
    const c = hex('#' + color.toString(16).padStart(6, '0'));
    pc.rect(0, 0, w, h, withAlpha(INK, 230));
    pc.rect(0, 2, w, h - 4, mix(c, INK, 0.55));
    pc.hline(0, w - 1, 2, c);
    pc.hline(0, w - 1, h - 3, c);
    for (let x = 0; x < w; x += 6) pc.set(x, 4, shift(c, 0.2));
  });
  const c = scene.add.container(cx, y).setDepth(opts.depth ?? 3000);
  const bg = scene.add.image(0, 0, key);
  const t = pixelText(scene, 0, opts.sub ? -5 : 0, text, 2, PALT.white, { originX: 0.5, originY: 0.5 });
  t.setTint(toTint(shift(hex('#' + color.toString(16).padStart(6, '0')), 0.55)));
  c.add([bg, t]);
  if (opts.sub) c.add(pixelText(scene, 0, 9, opts.sub, 1, PALT.cream, { originX: 0.5, originY: 0.5, tiny: true }));
  c.setScale(1, 0);
  const hold = opts.hold ?? 380;
  return new Promise((res) => {
    scene.tweens.chain({
      targets: c,
      tweens: [
        { scaleY: 1, duration: 90, ease: 'Back.Out' },
        { scaleY: 1, duration: hold },
        { scaleY: 0, alpha: 0, duration: 90, ease: 'Quad.In' },
      ],
      onComplete: () => { c.destroy(); res(); },
    });
    t.x = -12;
    scene.tweens.add({ targets: t, x: 0, duration: 140, ease: 'Cubic.Out' });
  });
}

/** Small transient toast (errors / hints). */
export function toast(scene: Phaser.Scene, x: number, y: number, text: string, color: number = PALT.cream): void {
  const t = pixelText(scene, x, y, text, 1, color, { originX: 0.5, originY: 0.5, tiny: true }).setDepth(3500);
  scene.tweens.add({ targets: t, y: y - 8, alpha: { from: 1, to: 0 }, delay: 700, duration: 300, onComplete: () => t.destroy() });
}

/** Full-screen dim layer that swallows input. */
export function dimmer(scene: Phaser.Scene, alpha = 0.7, depth = 4000): Phaser.GameObjects.Rectangle {
  const r = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, PALT.ink, alpha).setOrigin(0).setDepth(depth);
  r.setInteractive();
  return r;
}

export { PALT };
