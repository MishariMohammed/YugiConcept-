// Balatro-like animated paint-swirl background.
// WebGL: a tiny fragment shader rendered at game resolution, posterised + Bayer-dithered so it
// reads as pixel art. Canvas renderer (or mode 'canvas'): a 120x68 canvas recomputed at ~10 fps
// and scaled up (blocky). 'static' draws one frame and never updates.

import Phaser from 'phaser';
import { PixelCanvas, bayer, chan, hex, mix } from '../fx/art/PixelCanvas';
import { PAL } from '../fx/art/Palette';

export interface SwirlOptions {
  /** three colours: deep, mid, bright. Default: Balatro-dark violet. */
  colors?: [string, string, string];
  /** rotation speed multiplier (default 1) */
  speed?: number;
  mode?: 'auto' | 'shader' | 'canvas' | 'static';
  depth?: number;
  /** size in game pixels (defaults to the camera size) */
  width?: number;
  height?: number;
  /** chunky pixel size of the swirl (default 2) */
  pixel?: number;
}

export const SWIRL_PRESETS = {
  duel: ['#1a1228', '#2c2046', '#45305f'] as [string, string, string],
  menu: ['#1c1030', '#4a1f3a', '#8c2f3e'] as [string, string, string],
  victory: ['#14202a', '#1f4a4a', '#3a8a6a'] as [string, string, string],
  defeat: ['#1a0c12', '#3a1420', '#6a1f2a'] as [string, string, string],
};

const FRAG = `
precision mediump float;
uniform float time;
uniform vec2 resolution;
uniform vec3 colA;
uniform vec3 colB;
uniform vec3 colC;
uniform float speed;
uniform float pix;
varying vec2 fragCoord;

float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float x = q.x, y = q.y;
  float v = 0.0;
  if (y < 1.0) v = x < 1.0 ? 0.0 : x < 2.0 ? 8.0 : x < 3.0 ? 2.0 : 10.0;
  else if (y < 2.0) v = x < 1.0 ? 12.0 : x < 2.0 ? 4.0 : x < 3.0 ? 14.0 : 6.0;
  else if (y < 3.0) v = x < 1.0 ? 3.0 : x < 2.0 ? 11.0 : x < 3.0 ? 1.0 : 9.0;
  else v = x < 1.0 ? 15.0 : x < 2.0 ? 7.0 : x < 3.0 ? 13.0 : 5.0;
  return (v + 0.5) / 16.0;
}

void main() {
  vec2 cell = floor(fragCoord / pix);
  vec2 p = cell * pix;
  vec2 uv = (p - 0.5 * resolution) / length(resolution);
  float t = time * speed;
  float r = length(uv);
  float a = atan(uv.y, uv.x) - t * 0.12 + r * 6.0;
  uv = vec2(cos(a), sin(a)) * r * 22.0;
  vec2 w = vec2(uv.x + uv.y);
  for (int i = 0; i < 4; i++) {
    w += sin(max(uv.x, uv.y)) + uv;
    uv += 0.5 * vec2(cos(4.7 + 0.37 * w.y + t * 0.21), sin(w.x - 0.17 * t));
    uv -= cos(uv.x + uv.y) - sin(uv.x * 0.69 - uv.y);
  }
  float d = bayer4(cell) - 0.5;
  float v = clamp(length(uv) / 12.0 + d * 0.12, 0.0, 1.0);
  v += (1.0 - smoothstep(0.0, 0.75, r)) * 0.08;
  vec3 col = v < 0.45 ? colA : v < 0.68 ? colB : colC;
  float vig = smoothstep(0.85, 0.3, r);
  col *= mix(0.55, 1.0, vig + d * 0.15);
  gl_FragColor = vec4(col, 1.0);
}
`;

function vec3(h: string): { x: number; y: number; z: number } {
  const [r, g, b] = chan(hex(h));
  return { x: r / 255, y: g / 255, z: b / 255 };
}

export class SwirlBackground {
  readonly go: Phaser.GameObjects.Shader | Phaser.GameObjects.Image;
  private timer?: Phaser.Time.TimerEvent;
  private canvasKey?: string;
  private colors: [string, string, string];

  constructor(private scene: Phaser.Scene, opts: SwirlOptions = {}) {
    const cam = scene.cameras.main;
    const w = opts.width ?? cam.width, h = opts.height ?? cam.height;
    this.colors = opts.colors ?? SWIRL_PRESETS.duel;
    const speed = opts.speed ?? 1;
    const webgl = scene.game.renderer.type === Phaser.WEBGL;
    const mode = opts.mode ?? 'auto';
    if ((mode === 'auto' || mode === 'shader') && webgl) {
      const key = 'swirl-shader';
      const base = (scene.cache.shader.get(key) as Phaser.Display.BaseShader | undefined) ??
        new Phaser.Display.BaseShader(key, FRAG, undefined, {
          colA: { type: '3f', value: vec3(this.colors[0]) },
          colB: { type: '3f', value: vec3(this.colors[1]) },
          colC: { type: '3f', value: vec3(this.colors[2]) },
          speed: { type: '1f', value: speed },
          pix: { type: '1f', value: opts.pixel ?? 2 },
        });
      if (!scene.cache.shader.exists(key)) scene.cache.shader.add(key, base);
      const sh = scene.add.shader(base, 0, 0, w, h).setOrigin(0).setScrollFactor(0);
      sh.setUniform('colA.value', vec3(this.colors[0]));
      sh.setUniform('colB.value', vec3(this.colors[1]));
      sh.setUniform('colC.value', vec3(this.colors[2]));
      sh.setUniform('speed.value', speed);
      sh.setUniform('pix.value', opts.pixel ?? 2);
      this.go = sh;
    } else {
      const cw = 120, ch = Math.round((120 * h) / w);
      this.canvasKey = `swirl-canvas-${Math.floor(Math.random() * 1e9)}`;
      const tex = scene.textures.createCanvas(this.canvasKey, cw, ch)!;
      const img = scene.add.image(0, 0, this.canvasKey).setOrigin(0).setScrollFactor(0).setDisplaySize(w, h);
      this.go = img;
      let t = 0;
      const draw = () => {
        const pc = new PixelCanvas(cw, ch);
        swirlCpu(pc, t * speed, this.colors);
        const ctx = tex.getContext();
        const id = ctx.createImageData(cw, ch);
        new Uint32Array(id.data.buffer).set(pc.data);
        ctx.putImageData(id, 0, 0);
        tex.refresh();
      };
      draw();
      if (mode !== 'static') {
        this.timer = scene.time.addEvent({ delay: 100, loop: true, callback: () => { t += 0.1; draw(); } });
      }
    }
    if (opts.depth !== undefined) this.go.setDepth(opts.depth);
    else this.go.setDepth(-1000);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** Change the swirl colours (e.g. red tint when LP is low). */
  setColors(colors: [string, string, string]): void {
    this.colors = colors;
    if (this.go instanceof Phaser.GameObjects.Shader) {
      this.go.setUniform('colA.value', vec3(colors[0]));
      this.go.setUniform('colB.value', vec3(colors[1]));
      this.go.setUniform('colC.value', vec3(colors[2]));
    }
  }

  destroy(): void {
    this.timer?.remove();
    this.timer = undefined;
    if (this.go.scene) this.go.destroy();
    if (this.canvasKey && this.scene.textures.exists(this.canvasKey)) this.scene.textures.remove(this.canvasKey);
    this.canvasKey = undefined;
  }
}

/** CPU version (used for the canvas fallback). Cheap: ~8k pixels. */
function swirlCpu(pc: PixelCanvas, t: number, colors: [string, string, string]): void {
  const A = hex(colors[0]), B = hex(colors[1]), C = hex(colors[2]);
  const ink = hex(PAL.ink);
  const cx = pc.w / 2, cy = pc.h / 2, L = Math.hypot(pc.w, pc.h);
  for (let y = 0; y < pc.h; y++) for (let x = 0; x < pc.w; x++) {
    const ux = (x - cx) / L, uy = (y - cy) / L;
    const r = Math.hypot(ux, uy);
    const a = Math.atan2(uy, ux) - t * 0.12 + r * 6;
    let px = Math.cos(a) * r * 22, py = Math.sin(a) * r * 22;
    let wx = px + py, wy = px + py;
    for (let i = 0; i < 3; i++) {
      const m = Math.sin(Math.max(px, py));
      wx += m + px; wy += m + py;
      px += 0.5 * Math.cos(4.7 + 0.37 * wy + t * 0.21);
      py += 0.5 * Math.sin(wx - 0.17 * t);
      const q = Math.cos(px + py) - Math.sin(px * 0.69 - py);
      px -= q; py -= q;
    }
    const d = bayer(x, y) - 0.5;
    const v = Math.max(0, Math.min(1, Math.hypot(px, py) / 12 + d * 0.12));
    let col = v < 0.45 ? A : v < 0.68 ? B : C;
    const vig = Math.max(0, Math.min(1, (0.85 - r * 2.2) / 0.55));
    if (vig < 0.6) col = mix(col, ink, (0.6 - vig) * 0.7);
    pc.put(x, y, col);
  }
}

/** Convenience wrapper. */
export function addSwirlBackground(scene: Phaser.Scene, opts: SwirlOptions = {}): SwirlBackground {
  return new SwirlBackground(scene, opts);
}
