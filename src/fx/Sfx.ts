// Tiny procedural chiptune SFX (WebAudio, no asset files).
//
//   import { sfx } from '../fx/Sfx';
//   sfx.play('hit');            // fire-and-forget; silently no-ops before unlock / when muted
//   sfx.toggleMute();           // persisted in localStorage
//
// Browsers only allow audio after a user gesture: `installAudioUnlock()` (called from main.ts)
// resumes the AudioContext on the first pointerdown/keydown. Sounds are short square/triangle
// blips + a shared noise buffer, rate-limited per sound so a burst of events can't stack up.

export type SfxName =
  | 'click' | 'draw' | 'summon' | 'set' | 'spell' | 'attack' | 'hit' | 'crit' | 'ko'
  | 'lp' | 'heal' | 'destroy' | 'victory' | 'defeat';

const MUTE_KEY = 'yugiconcept.muted';
const MIN_GAP_MS: Partial<Record<SfxName, number>> = { draw: 45, hit: 40, click: 30, lp: 120 };

type Osc = OscillatorType;

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<SfxName, number>();
  muted: boolean;
  volume = 0.35;

  constructor() {
    let m = false;
    try { m = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* storage blocked */ }
    this.muted = m;
  }

  get unlocked(): boolean { return !!this.ctx && this.ctx.state === 'running'; }

  /** Create/resume the context. Must run inside a user gesture the first time. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.4);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    } catch { this.ctx = null; }
  }

  /** Pause/resume output (app backgrounded). */
  suspend(): void { if (this.ctx?.state === 'running') void this.ctx.suspend().catch(() => {}); }
  resume(): void { if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => {}); }

  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* ignore */ }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }

  toggleMute(): boolean { this.setMuted(!this.muted); return this.muted; }

  play(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const now = performance.now();
    const gap = MIN_GAP_MS[name] ?? 25;
    if (now - (this.last.get(name) ?? -1e9) < gap) return;
    this.last.set(name, now);
    const t = ctx.currentTime + 0.005;
    try {
      switch (name) {
        case 'click': this.tone(t, 'square', 880, 660, 0.04, 0.25); break;
        case 'draw': this.tone(t, 'triangle', 520, 900, 0.06, 0.35); this.hiss(t, 0.05, 0.08, 4000); break;
        case 'set': this.tone(t, 'triangle', 300, 220, 0.08, 0.4); break;
        case 'summon':
          this.arp(t, 'square', [392, 523, 659, 784], 0.045, 0.3);
          this.hiss(t + 0.16, 0.12, 0.15, 1200);
          break;
        case 'spell': this.arp(t, 'triangle', [660, 880, 1175, 1568], 0.04, 0.35); break;
        case 'attack': this.tone(t, 'sawtooth', 200, 520, 0.09, 0.22); this.hiss(t, 0.08, 0.12, 2500); break;
        case 'hit': this.hiss(t, 0.07, 0.35, 1800); this.tone(t, 'square', 180, 70, 0.06, 0.3); break;
        case 'crit': this.hiss(t, 0.12, 0.5, 1200); this.tone(t, 'square', 260, 50, 0.14, 0.4); break;
        case 'ko': this.tone(t, 'square', 440, 40, 0.45, 0.4); this.hiss(t, 0.3, 0.4, 700); break;
        case 'destroy': this.hiss(t, 0.22, 0.4, 900); this.tone(t, 'square', 220, 55, 0.22, 0.3); break;
        case 'lp': this.tone(t, 'square', 330, 110, 0.18, 0.3); this.tone(t + 0.07, 'square', 247, 82, 0.18, 0.25); break;
        case 'heal': this.arp(t, 'triangle', [523, 659, 784], 0.05, 0.3); break;
        case 'victory': this.arp(t, 'square', [523, 659, 784, 1047, 784, 1047], 0.09, 0.3, 0.16); break;
        case 'defeat': this.arp(t, 'triangle', [392, 349, 311, 262], 0.16, 0.4, 0.22); break;
      }
    } catch { /* never let audio break the game */ }
  }

  // ---------------------------------------------------------------- primitives
  private env(t: number, dur: number, peak: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master!);
    return g;
  }

  private tone(t: number, type: Osc, f0: number, f1: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    o.connect(this.env(t, dur, vol));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private arp(t: number, type: Osc, notes: number[], step: number, vol: number, last = step * 1.5): void {
    notes.forEach((f, i) => this.tone(t + i * step, type, f, f, i === notes.length - 1 ? last : step * 0.95, vol));
  }

  private hiss(t: number, dur: number, vol: number, cutoff: number): void {
    const ctx = this.ctx!;
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.2), t + dur);
    src.connect(f);
    f.connect(this.env(t, dur, vol));
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}

export const sfx = new SfxEngine();

/** Resume audio on the first user gesture (and every later one, in case the OS suspended it). */
export function installAudioUnlock(target: EventTarget = window): void {
  const go = () => sfx.unlock();
  target.addEventListener('pointerdown', go, { passive: true });
  target.addEventListener('touchend', go, { passive: true });
  target.addEventListener('keydown', go);
}
