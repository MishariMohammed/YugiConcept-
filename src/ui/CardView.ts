// Balatro-style card game object.
//
//   const cv = new CardView(scene, x, y, def, { draggable: true });
//   cv.setHome(x, y);            // where returnHome() tweens back to
//   cv.on('cardDrop', (card, pointer) => { ... });  // emitted on drag end
//   cv.on('cardTap', (card) => { ... });            // tap without drag
//   await cv.playSummonBounce();
//
// The outer container is yours to position/tween (x, y, angle for defense position, depth).
// All "juice" (idle float, wobble, pointer tilt, hover lift, foil shine) is applied to an inner
// `inner` container, so it never fights with your layout tweens.

import Phaser from 'phaser';
import type { CardDef } from '../core/types';
import { CARD_LG, CARD_SM, FOIL_FRAMES, ensureCardTextures, ensureFoilTexture } from '../fx/art/CardArt';
import { ensureTexture, hex } from '../fx/art/PixelCanvas';
import { PAL, PALT } from '../fx/art/Palette';
import { TIMING, burst, ring } from '../fx/Juice';

export interface CardViewOptions {
  /** use the 96x136 inspect texture */
  large?: boolean;
  faceDown?: boolean;
  /** enable drag & drop (also enables input) */
  draggable?: boolean;
  /** pointer hover/tilt/tap (default true) */
  interactive?: boolean;
  /** idle float + wobble (default true) */
  idle?: boolean;
  /** extra uniform scale applied to the outer container (default 1) */
  scale?: number;
  /** raise depth by +1000 while hovered/dragged (default true) */
  raiseOnHover?: boolean;
  /** idle rotation wobble in radians (default 0.012 small, 0 large: rotation blurs pixel text) */
  wobble?: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class CardView extends Phaser.GameObjects.Container {
  def: CardDef;
  readonly inner: Phaser.GameObjects.Container;
  readonly face: Phaser.GameObjects.Image;
  readonly shadowImg: Phaser.GameObjects.Image;
  readonly glow: Phaser.GameObjects.Image;
  foil?: Phaser.GameObjects.Image;
  faceDown: boolean;
  large: boolean;
  hovered = false;
  dragging = false;
  idleEnabled: boolean;
  homeX: number;
  homeY: number;

  private t0 = Math.random() * 10;
  private tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  private lift = 0;
  private liftTarget = 0;
  private hoverScale = 1;
  private hoverScaleTarget = 1;
  private dragVel = 0;
  private lastDragX = 0;
  private foilClock = 0;
  private baseDepth = 0;
  private raiseOnHover: boolean;
  private bounceTween?: Phaser.Tweens.Tween;
  private squashX = 1;
  private squashY = 1;
  private wobbleAmp: number;

  constructor(scene: Phaser.Scene, x: number, y: number, def: CardDef, opts: CardViewOptions = {}) {
    super(scene, x, y);
    this.def = def;
    this.large = !!opts.large;
    this.faceDown = !!opts.faceDown;
    this.idleEnabled = opts.idle ?? true;
    this.raiseOnHover = opts.raiseOnHover ?? true;
    this.wobbleAmp = opts.wobble ?? (this.large ? 0 : 0.012);
    this.homeX = x;
    this.homeY = y;
    const { w, h } = this.dims();
    ensureCardTextures(scene, def);
    ensureGlowTextures(scene);

    this.shadowImg = scene.add.image(2, 3, this.texKey()).setTintFill(PALT.ink).setAlpha(0.45);
    this.glow = scene.add.image(0, 0, this.large ? 'card-glow-lg' : 'card-glow-sm').setVisible(false);
    this.face = scene.add.image(0, 0, this.texKey());
    this.inner = scene.add.container(0, 0, [this.glow, this.face]);
    this.add([this.shadowImg, this.inner]);
    this.refreshFoil();

    this.setSize(w, h);
    this.setScale(opts.scale ?? 1);
    scene.add.existing(this);

    if (opts.interactive ?? true) this.enableInput(!!opts.draggable);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this));
  }

  // ------------------------------------------------------------------ public API
  dims(): { w: number; h: number } { return this.large ? CARD_LG : CARD_SM; }

  setCard(def: CardDef): this {
    this.def = def;
    ensureCardTextures(this.scene, def);
    this.applyTexture();
    this.refreshFoil();
    return this;
  }

  setFaceDown(down: boolean): this {
    this.faceDown = down;
    this.applyTexture();
    this.refreshFoil();
    return this;
  }

  setLarge(large: boolean): this {
    this.large = large;
    const { w, h } = this.dims();
    this.setSize(w, h);
    if (this.input) this.input.hitArea.setTo(0, 0, w, h);
    this.glow.setTexture(large ? 'card-glow-lg' : 'card-glow-sm');
    this.applyTexture();
    this.refreshFoil();
    return this;
  }

  /** Flip with a quick scaleX squeeze (180 ms). */
  flip(faceDown = !this.faceDown): Promise<void> {
    return new Promise((res) => {
      this.scene.tweens.add({
        targets: this.inner, scaleX: 0, duration: TIMING.flip / 2, ease: 'Quad.In',
        onComplete: () => {
          this.setFaceDown(faceDown);
          this.scene.tweens.add({ targets: this.inner, scaleX: 1, duration: TIMING.flip / 2, ease: 'Quad.Out', onComplete: () => res() });
        },
      });
    });
  }

  /** Rotate to defense (90 deg) or attack (0) position. */
  setDefensePosition(defense: boolean, animate = true): this {
    const angle = defense ? -90 : 0;
    if (animate) this.scene.tweens.add({ targets: this, angle, duration: TIMING.cardMove, ease: 'Back.Out' });
    else this.setAngle(angle);
    return this;
  }

  /** Coloured selection glow (Balatro "selected" border). null to hide. */
  setHighlight(color: number | null): this {
    this.glow.setVisible(color !== null);
    if (color !== null) this.glow.setTint(color);
    return this;
  }

  setHome(x: number, y: number): this { this.homeX = x; this.homeY = y; return this; }

  returnHome(duration: number = TIMING.cardMove): Promise<void> {
    return new Promise((res) => this.scene.tweens.add({
      targets: this, x: this.homeX, y: this.homeY, duration, ease: 'Back.Out', onComplete: () => res(),
    }));
  }

  /** Juicy squash & bounce when a card hits the field (~420 ms). */
  playSummonBounce(withParticles = true): Promise<void> {
    this.bounceTween?.stop();
    // keyframes: [t, scaleX, scaleY, lift]
    const K: [number, number, number, number][] = [
      [0, 0.95, 1.05, 16], [0.26, 0.86, 1.2, 0], [0.42, 1.3, 0.72, 0], [0.62, 0.92, 1.1, 0], [0.8, 1.04, 0.97, 0], [1, 1, 1, 0],
    ];
    let landed = false;
    return new Promise((res) => {
      this.bounceTween = this.scene.tweens.addCounter({
        from: 0, to: 1, duration: TIMING.summon,
        onUpdate: (tw) => {
          const p = tw.getValue() ?? 0;
          let i = 0;
          while (i < K.length - 2 && p > K[i + 1][0]) i++;
          const A = K[i], B = K[i + 1];
          let f = clamp((p - A[0]) / (B[0] - A[0]), 0, 1);
          f = i === 0 ? f * f : f * f * (3 - 2 * f);
          this.squashX = A[1] + (B[1] - A[1]) * f;
          this.squashY = A[2] + (B[2] - A[2]) * f;
          this.lift = A[3] + (B[3] - A[3]) * f;
          if (!landed && p >= K[1][0]) {
            landed = true;
            if (withParticles) {
              const m = this.getWorldTransformMatrix();
              const by = m.ty + (this.dims().h / 2) * this.scaleY;
              burst(this.scene, m.tx, by, { count: 12, texture: 'px-dust', colors: [PALT.cream, PALT.paper, PALT.gold], speed: 70, gravity: 60, lifespan: 380 });
              ring(this.scene, m.tx, m.ty, PALT.gold, 3.5, 280);
            }
          }
        },
        onComplete: () => { this.squashX = 1; this.squashY = 1; this.lift = 0; res(); },
      });
    });
  }

  /** Short horizontal shake (damage / invalid action). */
  shake(intensity = 3): void {
    this.scene.tweens.add({ targets: this.inner, x: { from: -intensity, to: intensity }, duration: 40, yoyo: true, repeat: 2,
      onComplete: () => this.inner.setX(0) });
  }

  // ------------------------------------------------------------------ internals
  private texKey(): string {
    if (this.faceDown) return this.large ? 'card-back-lg' : 'card-back-sm';
    return `${this.large ? 'card-lg' : 'card-sm'}-${this.def.id}`;
  }

  private applyTexture(): void {
    const k = this.texKey();
    this.face.setTexture(k);
    this.shadowImg.setTexture(k).setTintFill(PALT.ink);
  }

  private refreshFoil(): void {
    const r = this.def.rarity;
    const wants = !this.faceDown && (r === 'super' || r === 'ultra');
    if (!wants) { this.foil?.setVisible(false); return; }
    const key = ensureFoilTexture(this.scene, this.large ? 'lg' : 'sm', r === 'ultra' ? 'rainbow' : 'white');
    if (!this.foil) {
      this.foil = this.scene.add.image(0, 0, key, 0).setBlendMode(Phaser.BlendModes.ADD);
      this.inner.add(this.foil);
    } else this.foil.setTexture(key, 0);
    this.foil.setVisible(true);
  }

  private enableInput(draggable: boolean): void {
    this.setInteractive({ draggable, cursor: 'pointer' });
    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.setHover(true));
    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => { if (!this.dragging) this.setHover(false); this.tilt.tx = 0; this.tilt.ty = 0; });
    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      const lp = this.getLocalPoint(p.worldX, p.worldY);
      const { w, h } = this.dims();
      this.tilt.tx = clamp(lp.x / (w / 2), -1, 1);
      this.tilt.ty = clamp(lp.y / (h / 2), -1, 1);
    });
    let downAt = 0;
    let moved = false;
    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => { downAt = this.scene.time.now; moved = false; });
    this.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
      if (!moved && this.scene.time.now - downAt < 400) this.emit('cardTap', this);
    });
    if (draggable) {
      this.on(Phaser.Input.Events.GAMEOBJECT_DRAG_START, () => {
        this.dragging = true; moved = false; this.lastDragX = this.x; this.setHover(true);
      });
      this.on(Phaser.Input.Events.GAMEOBJECT_DRAG, (_p: Phaser.Input.Pointer, dx: number, dy: number) => {
        if (Math.abs(dx - this.x) + Math.abs(dy - this.y) > 1) moved = true;
        this.x = dx; this.y = dy;
      });
      this.on(Phaser.Input.Events.GAMEOBJECT_DRAG_END, (p: Phaser.Input.Pointer) => {
        this.dragging = false;
        this.setHover(false);
        if (moved) this.emit('cardDrop', this, p);
      });
    }
  }

  private setHover(on: boolean): void {
    if (this.hovered === on) return;
    this.hovered = on;
    this.liftTarget = on ? (this.large ? 6 : 5) : 0;
    this.hoverScaleTarget = on ? 1.1 : 1;
    if (this.raiseOnHover) {
      if (on) { this.baseDepth = this.depth; this.setDepth(this.depth + 1000); } else this.setDepth(this.baseDepth);
    }
    this.emit(on ? 'cardHover' : 'cardUnhover', this);
  }

  private tick(_time: number, delta: number): void {
    if (!this.active) return;
    const dt = Math.min(delta, 50) / 1000;
    this.t0 += dt;
    const t = this.t0;
    const ease = 1 - Math.pow(0.0005, dt); // ~frame-rate independent lerp
    this.tilt.x += (this.tilt.tx - this.tilt.x) * ease;
    this.tilt.y += (this.tilt.ty - this.tilt.y) * ease;
    if (!this.bounceTween || !this.bounceTween.isPlaying()) this.lift += (this.liftTarget - this.lift) * ease;
    this.hoverScale += (this.hoverScaleTarget - this.hoverScale) * ease;

    // drag velocity -> swing
    if (this.dragging) {
      const v = (this.x - this.lastDragX) / Math.max(dt, 1e-3);
      this.dragVel += (v - this.dragVel) * 0.25;
      this.lastDragX = this.x;
    } else this.dragVel *= 0.85;

    const idle = this.idleEnabled && !this.dragging;
    const floatY = idle ? Math.sin(t * 1.7) * 1.2 : 0;
    const wobble = idle ? Math.sin(t * 1.1 + 1.3) * this.wobbleAmp : 0;
    const tx = this.tilt.x, ty = this.tilt.y;

    const b = this.inner;
    b.y = Math.round(floatY - this.lift);
    b.rotation = wobble + tx * 0.07 + clamp(this.dragVel * 0.0006, -0.35, 0.35);
    b.scaleX = this.hoverScale * (1 - Math.abs(tx) * 0.1) * this.squashX;
    b.scaleY = this.hoverScale * (1 - Math.abs(ty) * 0.06) * this.squashY;

    // shadow drifts opposite to the tilt, further when lifted
    const s = this.shadowImg;
    s.x = 2 - tx * 3 + this.lift * 0.3;
    s.y = 3 - ty * 2 + this.lift * 0.6;
    s.rotation = b.rotation;
    s.scaleX = b.scaleX; s.scaleY = b.scaleY;
    s.setAlpha(this.faceDown ? 0.35 : 0.45);

    // glow pulse
    if (this.glow.visible) this.glow.setAlpha(0.65 + Math.sin(t * 6) * 0.3);

    // foil: follow pointer tilt while hovered, otherwise sweep every ~2.4s
    if (this.foil && this.foil.visible) {
      let f: number;
      if (this.hovered) f = Math.round(((tx + ty * 0.5 + 1.5) / 3) * (FOIL_FRAMES - 1));
      else {
        this.foilClock += dt;
        const cyc = (this.foilClock % 2.4) / 0.9;
        f = cyc < 1 ? Math.floor(cyc * FOIL_FRAMES) : -1;
      }
      if (f < 0) this.foil.setAlpha(0);
      else { this.foil.setAlpha(1); this.foil.setFrame(clamp(f, 0, FOIL_FRAMES - 1)); }
    }
  }
}

/** Rounded white silhouettes 2px larger than a card, tinted for selection glow. */
function ensureGlowTextures(scene: Phaser.Scene): void {
  const white = hex('#ffffff');
  ensureTexture(scene, 'card-glow-sm', CARD_SM.w + 6, CARD_SM.h + 6, (pc) => pc.roundRect(0, 0, CARD_SM.w + 6, CARD_SM.h + 6, 5, white));
  ensureTexture(scene, 'card-glow-lg', CARD_LG.w + 8, CARD_LG.h + 8, (pc) => pc.roundRect(0, 0, CARD_LG.w + 8, CARD_LG.h + 8, 7, white));
  void PAL;
}
