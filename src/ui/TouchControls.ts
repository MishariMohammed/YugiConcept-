// Virtual joystick + on-screen buttons for the arena (multitouch).
//
//  - Floating joystick: touch anywhere in the left half (outside a button) to plant the base;
//    drag to steer. `vector` is the normalised direction (length 0..1, dead zone applied).
//  - Buttons: circles (abilities) or rects (pills like AUTO/SKIP). Pressed on pointerdown so a
//    thumb tap feels instant; buttons win over the joystick when both could take a touch.
//  - Works with mouse too (desktop testing). Uses scene.input.addPointer(2) => 3 touch pointers.
//
// Visuals are deliberately simple shapes drawn with Graphics so the owning scene can restyle
// them; the scene draws icons/cooldowns on top via the returned handles.

import Phaser from 'phaser';

export interface TouchButtonOpts {
  x: number;
  y: number;
  /** Circle radius (circle buttons). */
  radius?: number;
  /** Rect size (rect buttons). Rect buttons are centred on x/y. */
  width?: number;
  height?: number;
  /** Extra forgiving touch slop in px around the visual. */
  slop?: number;
  onPress: () => void;
  /** Called when the touch is released (optional). */
  onRelease?: () => void;
  depth?: number;
}

export interface TouchButton {
  readonly opts: TouchButtonOpts;
  enabled: boolean;
  visible: boolean;
  /** true while a pointer holds it */
  held: boolean;
  /** Seconds since last press (for press animations). */
  pressedAt: number;
}

export interface TouchControlsOpts {
  /** Joystick radius in px (base). */
  radius?: number;
  /** 0..1 dead zone fraction. */
  deadZone?: number;
  /** Only pointers starting with x < this start the joystick (default: half the width). */
  joystickMaxX?: number;
  /** Ignore pointers starting above this y (e.g. the HUD). */
  joystickMinY?: number;
  depth?: number;
}

export class TouchControls {
  readonly scene: Phaser.Scene;
  /** Normalised move vector (0 when no stick). */
  readonly vector = { x: 0, y: 0 };
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly buttons: TouchButton[] = [];
  private readonly radius: number;
  private readonly deadZone: number;
  private readonly joyMaxX: number;
  private readonly joyMinY: number;
  private joyPointer: number | null = null;
  private base = { x: 0, y: 0 };
  private knob = { x: 0, y: 0 };
  private held = new Map<number, TouchButton>();
  private enabledInput = true;
  /** Whether a touch device was used (to show the stick hint). */
  touchSeen = false;

  constructor(scene: Phaser.Scene, opts: TouchControlsOpts = {}) {
    this.scene = scene;
    this.radius = opts.radius ?? 22;
    this.deadZone = opts.deadZone ?? 0.18;
    this.joyMaxX = opts.joystickMaxX ?? scene.scale.width / 2;
    this.joyMinY = opts.joystickMinY ?? 0;
    scene.input.addPointer(2);
    this.gfx = scene.add.graphics().setDepth(opts.depth ?? 5000).setScrollFactor(0);
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  addButton(opts: TouchButtonOpts): TouchButton {
    const b: TouchButton = { opts, enabled: true, visible: true, held: false, pressedAt: -99 };
    this.buttons.push(b);
    return b;
  }

  /** Disable all input (e.g. during intro/outro). Releases the stick. */
  setInputEnabled(on: boolean): void {
    this.enabledInput = on;
    if (!on) this.releaseStick();
  }

  get stickActive(): boolean { return this.joyPointer !== null; }

  private hit(b: TouchButton, x: number, y: number): boolean {
    if (!b.visible) return false;
    const o = b.opts;
    const slop = o.slop ?? 4;
    if (o.radius !== undefined) return Math.hypot(x - o.x, y - o.y) <= o.radius + slop;
    const w = (o.width ?? 20) / 2 + slop, h = (o.height ?? 12) / 2 + slop;
    return Math.abs(x - o.x) <= w && Math.abs(y - o.y) <= h;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (p.wasTouch) this.touchSeen = true;
    if (!this.enabledInput) return;
    // buttons first (topmost = last added)
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const b = this.buttons[i];
      if (!this.hit(b, p.x, p.y)) continue;
      if (b.enabled) {
        b.held = true;
        b.pressedAt = this.scene.time.now;
        this.held.set(p.id, b);
        b.opts.onPress();
      }
      return;
    }
    if (this.joyPointer === null && p.x < this.joyMaxX && p.y >= this.joyMinY) {
      this.joyPointer = p.id;
      this.base = { x: p.x, y: p.y };
      this.knob = { x: p.x, y: p.y };
      this.updateVector();
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (p.id !== this.joyPointer || !p.isDown) return;
    const dx = p.x - this.base.x, dy = p.y - this.base.y;
    const d = Math.hypot(dx, dy);
    const r = this.radius;
    if (d > r * 1.6) {
      // drag the base along so the thumb never "loses" the stick
      const k = (d - r * 1.6) / d;
      this.base.x += dx * k; this.base.y += dy * k;
    }
    this.knob = { x: p.x, y: p.y };
    this.updateVector();
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const b = this.held.get(p.id);
    if (b) {
      b.held = false;
      this.held.delete(p.id);
      b.opts.onRelease?.();
    }
    if (p.id === this.joyPointer) this.releaseStick();
  }

  private releaseStick(): void {
    this.joyPointer = null;
    this.vector.x = 0; this.vector.y = 0;
  }

  private updateVector(): void {
    let dx = this.knob.x - this.base.x, dy = this.knob.y - this.base.y;
    const d = Math.hypot(dx, dy);
    const r = this.radius;
    const mag = Math.min(1, d / r);
    if (mag < this.deadZone || d === 0) { this.vector.x = 0; this.vector.y = 0; return; }
    dx /= d; dy /= d;
    const m = (mag - this.deadZone) / (1 - this.deadZone);
    this.vector.x = dx * m; this.vector.y = dy * m;
  }

  /** Redraw the joystick (call every frame). Buttons are drawn by the owner. */
  draw(): void {
    const g = this.gfx;
    g.clear();
    if (this.joyPointer === null) return;
    const r = this.radius;
    const bx = Math.round(this.base.x), by = Math.round(this.base.y);
    let kx = this.knob.x - bx, ky = this.knob.y - by;
    const d = Math.hypot(kx, ky);
    if (d > r) { kx = (kx / d) * r; ky = (ky / d) * r; }
    g.fillStyle(0x140c1c, 0.35).fillCircle(bx, by, r + 2);
    g.lineStyle(2, 0xf4ead2, 0.55).strokeCircle(bx, by, r);
    g.fillStyle(0xf4ead2, 0.85).fillCircle(Math.round(bx + kx), Math.round(by + ky), 8);
    g.lineStyle(1, 0x140c1c, 0.9).strokeCircle(Math.round(bx + kx), Math.round(by + ky), 8);
  }

  destroy(): void {
    const inp = this.scene.input;
    inp.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    inp.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    inp.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    inp.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    if (this.gfx.scene) this.gfx.destroy();
    this.buttons.length = 0;
    this.held.clear();
  }
}
