// Real-time arena fight renderer (Stardew-like) on top of the pure-TS ArenaSim.
//
// Contract: launched with ArenaSceneData {request, humanPlayer}; calls finishArena(this, result)
// exactly once. The human always controls their own monster (attacker or defender) and is always
// drawn on the LEFT; the other side is driven by ArenaAI at the NPC difficulty.
//
// Flow: intro 1.5 s ("VS" splash, tap to skip) -> fight (fixed 1/60 s sim steps) -> outro 1 s
// (result banner, tap to skip) -> finishArena.
//
// Controls
//   Keyboard: WASD / arrows move, J K L or 1 2 3 = abilities, Q / E = arena spells,
//             Space/Enter skips intro/outro, Esc/P pauses.
//   Touch:    floating virtual joystick on the left half, ability/spell buttons bottom-right.
//   Basic attacks are automatic when in reach (see ArenaSim header).
//   AUTO toggles ArenaAI ('good' player profile) for your monster; SKIP resolves the rest of the
//   fight instantly (headless, ArenaAI on both sides).
//
// Dev hook: open the game with  ?arena=<attackerId>,<defenderId>  to jump straight into a fight.
//   Optional: &pos=defense (defender in Defense Position), &side=1 (you are the defender),
//   &ai=easy|normal|hard, &seed=N, &spells=<id,id> (yours), &espells=<id,id> (NPC's),
//   &auto=1 (start with AUTO on). After the fight the same matchup restarts with seed+1.

import Phaser from 'phaser';
import type { ArenaAbility, ArenaRequest, ArenaResult, CardDef, CardInstance, PlayerId, Position } from '../core/types';
import { TUNING, type Difficulty } from '../core/combat/Formulas';
import {
  ArenaSim, IDLE_INPUT, SIM_DT, otherSide,
  type FighterInput, type SimEvent, type Side,
} from '../core/combat/ArenaSim';
import { ArenaAI } from '../core/ai/ArenaAI';
import { getCard, hasCard } from '../core/cards/CardDB';
import { SCENES, finishArena, type ArenaSceneData } from './SceneBus';
import { ensureMonsterSpritesheet, ensureProjectileTexture, ensureShadowTexture, type MonsterSpriteInfo } from '../fx/art/MonsterSprite';
import { buildArenaBackground, type ArenaKind } from '../fx/art/ArenaTiles';
import { ATTRIBUTE_COLOR, PALT } from '../fx/art/Palette';
import { burst, damageNumber, ensureFxTextures, flashWhite, hitStop, ring, shake, slash } from '../fx/Juice';
import { pixelText, setPixelText } from '../ui/PixelText';
import { fitText, measureText } from '../fx/art/PixelFont';
import { ensureCardTextures } from '../fx/art/CardArt';
import { TouchControls, type TouchButton } from '../ui/TouchControls';
import { PixelButton, dimmer, panelTexture } from '../ui/Widgets';
import { sfx } from '../fx/Sfx';
import { PAUSE_EVENT } from '../mobile';

type Phase = 'intro' | 'fight' | 'outro' | 'done';

const W = 480, H = 270;
const HUMAN_AUTO_SKILL = 'good' as const;

const KIND_GLYPH: Record<ArenaAbility['kind'], string> = {
  projectile: '*', dash: '`', aoe: '#', shield: '}', heal: '~', buff: '^', stun: '!',
};
const KIND_COLOR: Record<ArenaAbility['kind'], number> = {
  projectile: 0x9a6cff, dash: 0xf08a3a, aoe: 0xe4433c, shield: 0x3b8fe0, heal: 0x5fbf4a, buff: 0xf2b33d, stun: 0xf4dc6a,
};

interface FighterView {
  side: Side;
  info: MonsterSpriteInfo;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  stars: Phaser.GameObjects.Image[];
  anim: string;
  attackUntil: number;
  hitUntil: number;
  ghostHp: number;
  ghostHoldUntil: number;
  koShown: boolean;
  lastGhostAt: number;
}

interface AbilityButton {
  btn: TouchButton;
  kind: 'ability' | 'spell';
  index: number;
  ab: ArenaAbility;
  icon: Phaser.GameObjects.BitmapText;
  key: Phaser.GameObjects.BitmapText;
  cdText: Phaser.GameObjects.BitmapText;
  name?: Phaser.GameObjects.BitmapText;
}

export class ArenaScene extends Phaser.Scene {
  sim!: ArenaSim;
  private data0!: ArenaSceneData;
  private human: Side = 0;
  private npc: Side = 1;
  private difficulty: Difficulty = 'normal';
  private npcAI!: ArenaAI;
  private autoAI!: ArenaAI;
  private auto = false;
  private phase: Phase = 'intro';
  private phaseT = 0;
  private finished = false;
  private acc = 0;
  private freezeMs = 0;
  private slowMs = 0;
  private ox = 40;
  private oy = 61;
  private views!: [FighterView, FighterView];
  private projViews = new Map<number, Phaser.GameObjects.Image>();
  private ground!: Phaser.GameObjects.Graphics;
  private walls!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private hudRT!: Phaser.GameObjects.RenderTexture;
  private uiRT!: Phaser.GameObjects.RenderTexture;
  private ui!: Phaser.GameObjects.Graphics;
  private timerText!: Phaser.GameObjects.BitmapText;
  private autoText!: Phaser.GameObjects.BitmapText;
  private touch!: TouchControls;
  private abilityButtons: AbilityButton[] = [];
  private autoBtn!: TouchButton;
  private skipBtn!: TouchButton;
  private pauseBtn!: TouchButton;
  private paused = false;
  private pauseObjs: Phaser.GameObjects.GameObject[] = [];
  private queued: { ability: number | null; spell: number | null; at: number } = { ability: null, spell: null, at: 0 };
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private introObjs: Phaser.GameObjects.GameObject[] = [];
  private outroObjs: Phaser.GameObjects.GameObject[] = [];
  private result: ArenaResult | null = null;
  private realNow = 0;

  constructor() { super(SCENES.Arena); }

  init(): void {
    // Scenes are reused: reset per-fight state.
    this.phase = 'intro';
    this.phaseT = 0;
    this.finished = false;
    this.acc = 0;
    this.freezeMs = 0;
    this.slowMs = 0;
    this.auto = false;
    this.projViews = new Map();
    this.abilityButtons = [];
    this.introObjs = [];
    this.outroObjs = [];
    this.result = null;
    this.queued = { ability: null, spell: null, at: 0 };
    this.paused = false;
    this.pauseObjs = [];
    this.hudSig = '';
    this.btnSig = '';
  }

  create(data: ArenaSceneData & { difficulty?: Difficulty; auto?: boolean }): void {
    this.data0 = data;
    const req = data.request;
    this.human = req.attacker.player === data.humanPlayer ? 0 : 1;
    this.npc = otherSide(this.human);
    const reg = this.registry.get('arenaDifficulty') as Difficulty | undefined;
    this.difficulty = data.difficulty ?? reg ?? 'normal';
    this.sim = new ArenaSim(req, { attackerOnLeft: this.human === 0 });
    this.npcAI = new ArenaAI(this.difficulty, req.seed + 101);
    this.autoAI = new ArenaAI(HUMAN_AUTO_SKILL, req.seed + 202);
    this.auto = !!data.auto;
    this.cameras.main.setBackgroundColor('#140c1c');
    ensureFxTextures(this);

    this.buildBackground(req);
    this.ground = this.add.graphics().setDepth(40);
    this.walls = this.add.graphics().setDepth(400);
    this.views = [this.buildFighter(0), this.buildFighter(1)];
    // HUD + buttons are drawn off-screen and baked into render textures (see drawHud).
    this.hud = this.make.graphics({}, false);
    this.ui = this.make.graphics({}, false);
    this.hudRT = this.add.renderTexture(0, 0, W, H).setOrigin(0).setDepth(3000);
    this.uiRT = this.add.renderTexture(0, 0, W, H).setOrigin(0).setDepth(4000);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.hud.destroy(); this.ui.destroy(); });
    this.buildHud();
    this.buildControls();
    this.buildIntro();
    this.syncFighters(0);
    this.drawHud();
    // App backgrounded / tab hidden / Android back button -> freeze the fight.
    const onPause = () => { if (this.phase === 'intro' || this.phase === 'fight') this.setPaused(true); };
    this.game.events.on(PAUSE_EVENT, onPause);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(PAUSE_EVENT, onPause));
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  private buildBackground(req: ArenaRequest): void {
    const attr = req.defender.def.attribute;
    const kind: ArenaKind = attr === 'DARK' ? 'dungeon' : attr === 'EARTH' || attr === 'FIRE' ? 'ruins' : 'meadow';
    let floor = { x: 24, y: 58, width: 432, height: 186 };
    try {
      const bg = buildArenaBackground(this, kind, W, H);
      this.add.image(0, 0, bg.key).setOrigin(0).setDepth(0);
      floor = bg.floor;
    } catch {
      // TODO(art): fallback only if ArenaTiles is unavailable.
      this.add.rectangle(0, 0, W, H, 0x3f7a3a).setOrigin(0);
      this.add.rectangle(floor.x, floor.y, floor.width, floor.height, 0xb07a48).setOrigin(0);
    }
    this.ox = Math.round(floor.x + (floor.width - this.sim.width) / 2);
    this.oy = Math.round(floor.y + (floor.height - this.sim.height) / 2);
  }

  private buildFighter(side: Side): FighterView {
    const f = this.sim.fighters[side];
    const info = ensureMonsterSpritesheet(this, f.def);
    ensureShadowTexture(this);
    const shadow = this.add.image(0, 0, 'fx-shadow').setDepth(45);
    shadow.setScale((info.size * 0.7) / 24, info.floats ? 0.8 : 1);
    const sprite = this.add.sprite(0, 0, info.key, 0).setOrigin(0.5, info.footY / info.size);
    sprite.play(info.anims.idle);
    const stars = [0, 1, 2].map(() => this.add.image(0, 0, 'px-star').setTint(PALT.gold).setVisible(false).setDepth(2000));
    return {
      side, info, sprite, shadow, stars, anim: info.anims.idle, attackUntil: 0, hitUntil: 0,
      ghostHp: f.hp, ghostHoldUntil: 0, koShown: false, lastGhostAt: 0,
    };
  }

  private buildHud(): void {
    this.timerText = pixelText(this, W / 2, 5, '20', 2, PALT.cream, { originX: 0.5 }).setDepth(3001);
    for (const side of [this.human, this.npc]) {
      const f = this.sim.fighters[side];
      const left = side === this.human;
      const x = left ? 8 : W - 8;
      const ox = left ? 0 : 1;
      pixelText(this, x, 6, fitText(f.def.name, 'big', 148), 1, PALT.cream, { originX: ox }).setDepth(3001);
      const statLabel = f.position === 'defense' && side === 1 ? 'DEF POS' : f.stats.style.toUpperCase();
      const atk = side === 0 ? this.sim.request.attacker.atk : this.sim.request.defender.atk;
      const def = side === 0 ? this.sim.request.attacker.defStat : this.sim.request.defender.defStat;
      pixelText(this, x, 27, `{${atk} }${def}  ${statLabel}`, 1, 0xe2d2b0, { tiny: true, originX: ox }).setDepth(3001);
      pixelText(this, left ? x + 2 : x - 2, 37, left ? 'YOU' : this.difficulty.toUpperCase() + ' AI', 1, left ? PALT.gold : 0xff8a7a, { tiny: true, originX: ox }).setDepth(3001);
    }
  }

  private buildControls(): void {
    this.touch = new TouchControls(this, { radius: 22, joystickMaxX: W * 0.55, joystickMinY: 50 });
    const me = this.sim.fighters[this.human];
    // abilities (bottom-right, J/K)
    const abPos = [{ x: 450, y: 236, r: 16 }, { x: 413, y: 250, r: 13 }];
    me.abilities.slice(0, 2).forEach((slot, i) => {
      const p = abPos[i];
      const btn = this.touch.addButton({ x: p.x, y: p.y, radius: p.r, slop: 5, onPress: () => this.pressAbility(i) });
      this.abilityButtons.push(this.makeButtonVisual(btn, 'ability', i, slot.ability, ['J', 'K'][i]));
    });
    // arena spells (orange cards above the abilities, Q/E)
    const spPos = [{ x: 452, y: 202 }, { x: 452, y: 174 }];
    me.spells.slice(0, 2).forEach((s, i) => {
      const p = spPos[i];
      const btn = this.touch.addButton({ x: p.x, y: p.y, width: 18, height: 24, slop: 3, onPress: () => this.pressSpell(i) });
      const v = this.makeButtonVisual(btn, 'spell', i, s.ability, ['Q', 'E'][i]);
      v.name = pixelText(this, p.x - 12, p.y + 4, fitText(s.def.name, 'tiny', 44), 1, 0xffd9a0, { tiny: true, originX: 1, originY: 0.5 }).setDepth(4002).setAlpha(0.9);
      this.abilityButtons.push(v);
    });
    // AUTO / SKIP pills (top centre)
    this.autoBtn = this.touch.addButton({ x: W / 2 - 20, y: 34, width: 34, height: 11, onPress: () => this.toggleAuto() });
    this.skipBtn = this.touch.addButton({ x: W / 2 + 20, y: 34, width: 34, height: 11, onPress: () => this.skipFight() });
    this.autoText = pixelText(this, W / 2 - 20, 34, 'AUTO', 1, PALT.cream, { tiny: true, originX: 0.5, originY: 0.5 }).setDepth(4002);
    pixelText(this, W / 2 + 20, 34, 'SKIP', 1, PALT.cream, { tiny: true, originX: 0.5, originY: 0.5 }).setDepth(4002);
    this.pauseBtn = this.touch.addButton({ x: W / 2 - 52, y: 34, width: 18, height: 11, slop: 5, onPress: () => this.setPaused(true) });
    pixelText(this, W / 2 - 52, 34, '||', 1, PALT.cream, { tiny: true, originX: 0.5, originY: 0.5 }).setDepth(4002);

    const kb = this.input.keyboard;
    if (kb) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      this.keys = kb.addKeys({
        W: K.W, A: K.A, S: K.S, D: K.D, UP: K.UP, LEFT: K.LEFT, DOWN: K.DOWN, RIGHT: K.RIGHT,
        J: K.J, K: K.K, L: K.L, ONE: K.ONE, TWO: K.TWO, THREE: K.THREE, Q: K.Q, E: K.E,
        SPACE: K.SPACE, ENTER: K.ENTER, ESC: K.ESC, P: K.P,
      }, false) as Record<string, Phaser.Input.Keyboard.Key>;
      const on = (k: string, fn: () => void) => this.keys[k].on('down', fn);
      on('J', () => this.pressAbility(0)); on('ONE', () => this.pressAbility(0));
      on('K', () => this.pressAbility(1)); on('TWO', () => this.pressAbility(1));
      on('L', () => this.pressAbility(2)); on('THREE', () => this.pressAbility(2));
      on('Q', () => this.pressSpell(0)); on('E', () => this.pressSpell(1));
      on('SPACE', () => this.skipBanner()); on('ENTER', () => this.skipBanner());
      on('ESC', () => this.setPaused(!this.paused)); on('P', () => this.setPaused(!this.paused));
    } else {
      this.keys = {};
    }
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => this.skipBanner());

    // one-time hint
    const touchUI = this.sys.game.device.input.touch && window.matchMedia?.('(pointer: coarse)').matches;
    const hintText = touchUI ? 'DRAG LEFT SIDE TO MOVE  TAP BUTTONS FOR ABILITIES  - ATTACKS ARE AUTO' : 'WASD/STICK MOVE  J K ABILITY  Q E SPELL  - ATTACKS ARE AUTO';
    const hint = pixelText(this, W / 2, H - 9, hintText, 1, PALT.cream, { tiny: true, originX: 0.5, originY: 0.5 }).setDepth(3002).setAlpha(0);
    this.tweens.add({ targets: hint, alpha: 0.9, delay: 1500, duration: 200, hold: 2800, yoyo: true, onComplete: () => hint.destroy() });
  }

  private makeButtonVisual(btn: TouchButton, kind: 'ability' | 'spell', index: number, ab: ArenaAbility, key: string): AbilityButton {
    const o = btn.opts;
    const icon = pixelText(this, o.x, o.y, KIND_GLYPH[ab.kind], kind === 'ability' && index === 0 ? 2 : 1, KIND_COLOR[ab.kind], { originX: 0.5, originY: 0.5 }).setDepth(4001);
    const kx = o.radius !== undefined ? o.x + o.radius * 0.7 : o.x + 7;
    const ky = o.radius !== undefined ? o.y + o.radius * 0.7 : o.y + 10;
    const keyT = pixelText(this, kx, ky, key, 1, PALT.cream, { tiny: true, originX: 0.5, originY: 0.5 }).setDepth(4003);
    const cdText = pixelText(this, o.x, o.y, '', 1, PALT.cream, { originX: 0.5, originY: 0.5 }).setDepth(4003);
    return { btn, kind, index, ab, icon, key: keyT, cdText };
  }

  private buildIntro(): void {
    const [hf, nf] = [this.sim.fighters[this.human], this.sim.fighters[this.npc]];
    const shade = this.add.rectangle(0, 0, W, H, 0x140c1c, 0.55).setOrigin(0).setDepth(6000);
    const bandL = this.add.rectangle(-W, 104, W, 26, 0x3b8fe0, 0.95).setOrigin(0, 0.5).setDepth(6001);
    const bandR = this.add.rectangle(W * 2, 146, W, 26, 0xe4433c, 0.95).setOrigin(1, 0.5).setDepth(6001);
    const sz = (n: string) => (measureText(n, 'big') * 2 <= W / 2 - 40 ? 2 : 1);
    const fit = (n: string) => fitText(n, 'big', W / 2 - 40);
    const nameL = pixelText(this, -200, 104, fit(hf.def.name), sz(hf.def.name), PALT.white, { originX: 1, originY: 0.5 }).setDepth(6002);
    const nameR = pixelText(this, W + 200, 146, fit(nf.def.name), sz(nf.def.name), PALT.white, { originX: 0, originY: 0.5 }).setDepth(6002);
    const role = (s: Side) => (s === 0 ? 'ATTACKER' : 'DEFENDER');
    const subL = pixelText(this, -200, 121, role(this.human), 1, 0xbfe0ff, { tiny: true, originX: 1, originY: 0.5 }).setDepth(6002);
    const subR = pixelText(this, W + 200, 163, role(this.npc), 1, 0xffc0b8, { tiny: true, originX: 0, originY: 0.5 }).setDepth(6002);
    const vs = pixelText(this, W / 2, 125, 'VS', 4, PALT.gold, { originX: 0.5, originY: 0.5 }).setDepth(6003).setScale(0);
    this.tweens.add({ targets: bandL, x: 0, duration: 220, ease: 'Cubic.Out' });
    this.tweens.add({ targets: bandR, x: W, duration: 220, ease: 'Cubic.Out' });
    this.tweens.add({ targets: [nameL, subL], x: W / 2 - 32, duration: 260, delay: 60, ease: 'Back.Out' });
    this.tweens.add({ targets: [nameR, subR], x: W / 2 + 32, duration: 260, delay: 60, ease: 'Back.Out' });
    this.tweens.add({ targets: vs, scale: 1, duration: 260, delay: 240, ease: 'Back.Out', onComplete: () => shake(this, 0.006, 120) });
    this.introObjs = [shade, bandL, bandR, nameL, nameR, subL, subR, vs];
    // monsters drop in
    for (const v of this.views) {
      v.sprite.setAlpha(0);
      this.tweens.add({ targets: v.sprite, alpha: 1, duration: 200, delay: 350 });
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private pressAbility(i: number): void {
    if (this.phase !== 'fight' || this.auto) return;
    if (i >= this.sim.fighters[this.human].abilities.length) return;
    this.queued.ability = i; this.queued.at = this.sim.t;
  }

  private pressSpell(i: number): void {
    if (this.phase !== 'fight' || this.auto) return;
    if (i >= this.sim.fighters[this.human].spells.length) return;
    this.queued.spell = i; this.queued.at = this.sim.t;
  }

  /** Freeze sim, tweens, timers and sprite anims behind a small pause panel. */
  private setPaused(on: boolean): void {
    if (on === this.paused) return;
    if (on && this.phase !== 'intro' && this.phase !== 'fight') return;
    this.paused = on;
    if (on) {
      this.touch.setInputEnabled(false);
      this.queued = { ability: null, spell: null, at: 0 };
      this.tweens.pauseAll();
      this.time.paused = true;
      this.anims.pauseAll();
      const objs: Phaser.GameObjects.GameObject[] = [];
      objs.push(dimmer(this, 0.7, 7000));
      objs.push(this.add.image(W / 2, H / 2, panelTexture(this, 140, 104)).setDepth(7001));
      objs.push(pixelText(this, W / 2, H / 2 - 38, 'PAUSED', 2, PALT.gold, { originX: 0.5 }).setDepth(7002));
      objs.push(new PixelButton(this, W / 2, H / 2 - 2, 110, 24, 'RESUME', PALT.blue, () => this.setPaused(false)).setDepth(7003));
      const snd: PixelButton = new PixelButton(this, W / 2, H / 2 + 28, 110, 24, sfx.muted ? 'SOUND: OFF' : 'SOUND: ON', PALT.green, () => {
        sfx.unlock();
        snd.setText(sfx.toggleMute() ? 'SOUND: OFF' : 'SOUND: ON');
      }).setDepth(7003);
      objs.push(snd);
      this.pauseObjs = objs;
    } else {
      this.pauseObjs.forEach((o) => o.destroy());
      this.pauseObjs = [];
      this.tweens.resumeAll();
      this.time.paused = false;
      this.anims.resumeAll();
      // re-enable on the next tick so the RESUME tap doesn't also plant the joystick
      setTimeout(() => { if (!this.paused && this.touch) this.touch.setInputEnabled(true); }, 0);
    }
  }

  private toggleAuto(): void {
    if (this.phase === 'outro' || this.phase === 'done') return;
    this.auto = !this.auto;
    this.queued = { ability: null, spell: null, at: 0 };
  }

  private skipBanner(): void {
    if (this.paused) return;
    if (this.phase === 'intro' && this.phaseT > 120) this.endIntro();
    else if (this.phase === 'outro' && this.phaseT > 200) this.finish();
  }

  private humanInput(): FighterInput {
    if (this.auto) return this.autoAI.input(this.sim, this.human);
    const k = this.keys;
    const down = (n: string) => !!k[n]?.isDown;
    let mx = (down('D') || down('RIGHT') ? 1 : 0) - (down('A') || down('LEFT') ? 1 : 0);
    let my = (down('S') || down('DOWN') ? 1 : 0) - (down('W') || down('UP') ? 1 : 0);
    if (this.touch.stickActive) { mx = this.touch.vector.x; my = this.touch.vector.y; }
    const input: FighterInput = { moveX: mx, moveY: my, attack: false, ability: null, spell: null };
    // input buffer: a press stays queued briefly so taps just before "ready" still fire
    const buffer = 0.2;
    if (this.queued.ability !== null) {
      if (this.sim.canUseAbility(this.human, this.queued.ability)) { input.ability = this.queued.ability; this.queued.ability = null; }
      else if (this.sim.t - this.queued.at > buffer) this.queued.ability = null;
    }
    if (this.queued.spell !== null) {
      if (this.sim.canUseSpell(this.human, this.queued.spell)) { input.spell = this.queued.spell; this.queued.spell = null; }
      else if (this.sim.t - this.queued.at > buffer) this.queued.spell = null;
    }
    return input;
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  update(_time: number, delta: number): void {
    if (this.paused) return;
    const dms = Math.min(100, delta);
    this.realNow += dms;
    this.phaseT += dms;
    if (this.phase === 'intro') {
      if (this.phaseT >= TUNING.arena.introSec * 1000) this.endIntro();
    } else if (this.phase === 'fight') {
      this.runSim(dms);
    } else if (this.phase === 'outro') {
      if (this.phaseT >= TUNING.arena.outroSec * 1000 + 250) this.finish();
    }
    this.syncFighters(dms);
    this.syncProjectiles();
    this.drawGround();
    this.drawWalls();
    this.drawHud();
    this.drawButtons();
    this.touch.draw();
  }

  private endIntro(): void {
    if (this.phase !== 'intro') return;
    this.phase = 'fight';
    this.phaseT = 0;
    for (const o of this.introObjs) {
      this.tweens.add({ targets: o, alpha: 0, duration: 160, onComplete: () => o.destroy() });
    }
    this.introObjs = [];
    for (const v of this.views) v.sprite.setAlpha(1);
    const go = pixelText(this, W / 2, 120, 'FIGHT!', 3, PALT.gold, { originX: 0.5, originY: 0.5 }).setDepth(6003).setScale(0.3);
    this.tweens.add({ targets: go, scale: 1, duration: 140, ease: 'Back.Out' });
    this.tweens.add({ targets: go, alpha: 0, delay: 420, duration: 200, onComplete: () => go.destroy() });
  }

  private runSim(dms: number): void {
    if (this.freezeMs > 0) { this.freezeMs -= dms; return; }
    let scale = 1;
    if (this.slowMs > 0) { this.slowMs -= dms; scale = 0.3; }
    this.acc += (dms / 1000) * scale;
    let steps = 0;
    while (this.acc >= SIM_DT && !this.sim.done && steps < 8) {
      this.acc -= SIM_DT;
      steps++;
      const inputs: [FighterInput, FighterInput] = [IDLE_INPUT, IDLE_INPUT];
      inputs[this.human] = this.humanInput();
      inputs[this.npc] = this.npcAI.input(this.sim, this.npc);
      const evs = this.sim.step(inputs);
      this.sim.drainEvents();
      for (const e of evs) this.onEvent(e);
      if (this.freezeMs > 0) break;
    }
    if (this.sim.done && this.phase === 'fight') this.startOutro();
  }

  /** Resolve the rest of the fight instantly with ArenaAI on both sides. */
  private skipFight(): void {
    if (this.phase === 'intro') this.endIntro();
    if (this.phase !== 'fight') return;
    const humanAI = this.autoAI;
    let guard = 0;
    while (!this.sim.done && guard++ < 4000) {
      const inputs: [FighterInput, FighterInput] = [IDLE_INPUT, IDLE_INPUT];
      inputs[this.human] = humanAI.input(this.sim, this.human);
      inputs[this.npc] = this.npcAI.input(this.sim, this.npc);
      this.sim.step(inputs);
    }
    const evs = this.sim.drainEvents();
    for (const e of evs) if (e.type === 'ko' || e.type === 'end') this.onEvent(e);
    this.freezeMs = 0;
    this.slowMs = 0;
    this.startOutro();
  }

  // ---------------------------------------------------------------------------
  // Events -> juice
  // ---------------------------------------------------------------------------

  private sx(x: number): number { return this.ox + x; }
  private sy(y: number): number { return this.oy + y; }

  private onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'attack': {
        const v = this.views[e.side];
        v.sprite.play(v.info.anims.attack, true);
        v.anim = v.info.anims.attack;
        v.attackUntil = this.realNow + 260;
        if (this.sim.fighters[e.side].stats.style === 'ranged') sfx.play('attack');
        else {
          // melee wind-up tell: warm flash + "!" over the attacker (the locked strike area is drawn on the ground)
          flashWhite(v.sprite, 70, e.side === this.human ? 0xcfe8ff : 0xffd27a);
          const f = this.sim.fighters[e.side];
          const bang = pixelText(this, this.sx(f.x), this.sy(f.y) - v.info.size - 2, '!', 1, e.side === this.human ? 0xbfe0ff : 0xffb347, { originX: 0.5, originY: 1 }).setDepth(2550);
          this.tweens.add({ targets: bang, y: bang.y - 4, alpha: 0, duration: 260, onComplete: () => bang.destroy() });
        }
        break;
      }
      case 'whiff': {
        const x = this.sx(e.x), y = this.sy(e.y);
        burst(this, x, y, { count: 6, texture: 'px-dust', colors: [PALT.cream, 0xb07a48], speed: 40, depth: 2300 });
        const miss = pixelText(this, x, y - 14, 'MISS', 1, e.side === this.human ? 0xff9a8a : PALT.cream, { tiny: true, originX: 0.5, originY: 1 }).setDepth(2600);
        this.tweens.add({ targets: miss, y: miss.y - 8, alpha: 0, delay: 250, duration: 300, onComplete: () => miss.destroy() });
        break;
      }
      case 'abilityCast': {
        const v = this.views[e.side];
        const f = this.sim.fighters[e.side];
        if (e.ability.kind !== 'shield' && e.ability.kind !== 'heal' && e.ability.kind !== 'buff') {
          v.sprite.play(v.info.anims.attack, true);
          v.anim = v.info.anims.attack;
          v.attackUntil = this.realNow + 320;
        }
        const color = e.isSpell ? 0xffb347 : e.side === this.human ? 0xbfe0ff : 0xffc0b8;
        const label = pixelText(this, this.sx(f.x), this.sy(f.y) - v.info.size - 12, e.ability.name, 1, color, { tiny: true, originX: 0.5, originY: 1 }).setDepth(2500);
        this.tweens.add({ targets: label, y: label.y - 10, alpha: 0, delay: 450, duration: 400, onComplete: () => label.destroy() });
        sfx.play(e.isSpell || e.ability.kind === 'buff' || e.ability.kind === 'shield' ? 'spell' : e.ability.kind === 'heal' ? 'heal' : 'attack');
        if (e.isSpell) {
          shake(this, 0.004, 120);
          this.spellFlash(e.side, this.sim.fighters[e.side].spells[e.index].def);
        }
        break;
      }
      case 'hit': {
        const v = this.views[e.target];
        const f = this.sim.fighters[e.target];
        const x = this.sx(f.x), y = this.sy(f.y) - v.info.size * 0.75;
        if (e.kind === 'suddenDeath') {
          damageNumber(this, x, y, e.amount, { color: 0xff5a5a, depth: 2600 });
          break;
        }
        const big = e.kind !== 'basic' && e.mult > 1;
        const toHuman = e.target === this.human;
        if (e.amount > 0) {
          damageNumber(this, x, y, e.amount, {
            color: e.shielded ? 0x8cc8ff : big ? PALT.gold : toHuman ? 0xff7a6a : PALT.cream, crit: big, depth: 2600,
          });
          flashWhite(v.sprite, big ? 110 : 70);
          sfx.play(big ? 'crit' : 'hit');
          v.hitUntil = this.realNow + (big ? 200 : 120);
          v.ghostHoldUntil = this.realNow + 350;
          burst(this, x, y + 6, { count: big ? 16 : 8, texture: 'px-spark', speed: big ? 110 : 70, colors: [PALT.white, big ? PALT.gold : PALT.orange, PALT.cream], depth: 2400 });
          if (e.source !== null && this.sim.fighters[e.source].stats.style !== 'ranged' && e.kind === 'basic') {
            slash(this, x, y + 4, this.sim.fighters[e.source].x > f.x).setDepth(2401);
          }
          this.freezeMs = Math.max(this.freezeMs, big ? 95 : 45);
          hitStop(this, big ? 95 : 45);
          shake(this, big ? 0.009 : toHuman ? 0.004 : 0.0025, big ? 160 : 90);
        }
        if (e.shielded) ring(this, x, y + 6, 0x8cc8ff, 1.6, 200).setDepth(2401);
        if (e.stun > 0) {
          burst(this, x, y - 4, { count: 10, texture: 'px-star', colors: [PALT.gold, PALT.white], speed: 60, depth: 2400 });
        }
        break;
      }
      case 'heal': {
        const f = this.sim.fighters[e.side];
        const v = this.views[e.side];
        const x = this.sx(f.x), y = this.sy(f.y) - v.info.size * 0.75;
        damageNumber(this, x, y, e.amount, { prefix: '+', color: PALT.green, depth: 2600 });
        burst(this, x, y + 10, { count: 14, texture: 'px-dust', colors: [PALT.green, 0xb8f0a0, PALT.white], gravity: -120, speed: 50, depth: 2400 });
        break;
      }
      case 'status': {
        const f = this.sim.fighters[e.side];
        const v = this.views[e.side];
        if (e.status === 'shield') ring(this, this.sx(f.x), this.sy(f.y) - v.info.size / 2, 0x8cc8ff, 2.2, 260).setDepth(2401);
        if (e.status === 'buff') burst(this, this.sx(f.x), this.sy(f.y) - 6, { count: 14, texture: 'px-dust', colors: [PALT.orange, PALT.gold], gravity: -160, speed: 40, depth: 2400 });
        break;
      }
      case 'burst': {
        const x = this.sx(e.x), y = this.sy(e.y);
        ring(this, x, y, e.side === this.human ? PALT.gold : 0xff6a5a, e.radius / 7, 300).setDepth(60);
        burst(this, x, y, { count: 18, texture: 'px-dust', colors: [0xb07a48, PALT.orange, PALT.cream], speed: 120, depth: 2300 });
        shake(this, 0.006, 140);
        break;
      }
      case 'projectileEnd': {
        if (!e.hit) burst(this, this.sx(e.x), this.sy(e.y), { count: 5, texture: 'px-dot', colors: [PALT.cream, PALT.haze ?? 0x8a7aa8], speed: 40, depth: 2300 });
        break;
      }
      case 'ko': {
        const f = this.sim.fighters[e.side];
        const v = this.views[e.side];
        v.sprite.play(v.info.anims.ko, true);
        v.anim = v.info.anims.ko;
        v.koShown = true;
        sfx.play('ko');
        burst(this, this.sx(f.x), this.sy(f.y) - v.info.size / 2, { count: 26, texture: 'px-star', colors: [PALT.white, PALT.gold, PALT.red], speed: 140, depth: 2500 });
        shake(this, 0.014, 260);
        this.freezeMs = Math.max(this.freezeMs, 140);
        hitStop(this, 140);
        this.slowMs = 600;
        break;
      }
      case 'suddenDeath': {
        shake(this, 0.008, 200);
        const t = pixelText(this, W / 2, 120, 'SUDDEN DEATH!', 2, 0xff5a5a, { originX: 0.5, originY: 0.5 }).setDepth(6003).setScale(0.4);
        this.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.Out' });
        this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 300, onComplete: () => t.destroy() });
        break;
      }
      case 'end':
        this.result = e.result;
        break;
      default:
        break;
    }
  }

  private spellFlash(side: Side, def: CardDef): void {
    const left = side === this.human;
    const keys = ensureCardTextures(this, def);
    const card = this.add.image(left ? 34 : W - 34, 96, keys.small).setDepth(5500).setScale(0.3).setAngle(left ? -8 : 8);
    const t = pixelText(this, left ? 62 : W - 62, 96, fitText(def.name, 'tiny', 120), 1, 0xffd9a0, { tiny: true, originX: left ? 0 : 1, originY: 0.5 }).setDepth(5501).setAlpha(0);
    this.tweens.add({ targets: card, scale: 1, angle: left ? -4 : 4, duration: 180, ease: 'Back.Out' });
    this.tweens.add({ targets: t, alpha: 1, duration: 120 });
    this.tweens.add({ targets: [card, t], alpha: 0, delay: 600, duration: 250, onComplete: () => { card.destroy(); t.destroy(); } });
  }

  // ---------------------------------------------------------------------------
  // Per-frame sync
  // ---------------------------------------------------------------------------

  private syncFighters(dms: number): void {
    const sim = this.sim;
    for (const v of this.views) {
      const f = sim.fighters[v.side];
      const x = Math.round(this.sx(f.x)), y = Math.round(this.sy(f.y));
      v.sprite.setPosition(x, y);
      v.sprite.setDepth(100 + y);
      v.shadow.setPosition(x, y + (v.info.floats ? 4 : 0));
      v.sprite.setFlipX(f.facing === -1);
      // crouch on dash wind-up / channel
      const act = f.action;
      const crouch = act && ((act.kind === 'dash' && sim.t < act.lungeAt) || act.kind === 'channel' || act.kind === 'melee');
      v.sprite.setScale(crouch ? 1.08 : 1, crouch ? 0.9 : 1);
      // whiff recovery: off-balance wobble (punish window)
      v.sprite.setAngle(act?.kind === 'recover' ? Math.sin(this.realNow / 40) * 7 : 0);
      // dash afterimages
      if (act?.kind === 'dash' && sim.t >= act.lungeAt && this.realNow - v.lastGhostAt > 30) {
        v.lastGhostAt = this.realNow;
        const g = this.add.image(x, y, v.info.key, v.sprite.frame.name).setOrigin(v.sprite.originX, v.sprite.originY)
          .setFlipX(v.sprite.flipX).setTintFill(v.side === this.human ? 0x8cc8ff : 0xff8a7a).setAlpha(0.6).setDepth(99 + y);
        this.tweens.add({ targets: g, alpha: 0, duration: 200, onComplete: () => g.destroy() });
      }
      // animation state
      if (f.koAt !== null) {
        if (!v.koShown) { v.sprite.play(v.info.anims.ko, true); v.koShown = true; }
      } else if (this.realNow < v.hitUntil) {
        if (v.anim !== v.info.anims.hit) { v.sprite.play(v.info.anims.hit, true); v.anim = v.info.anims.hit; }
      } else if (this.realNow < v.attackUntil) {
        // keep attack anim
      } else {
        const moving = Math.hypot(f.vx, f.vy) > 4 || act?.kind === 'dash';
        const want = moving ? v.info.anims.walk : v.info.anims.idle;
        if (v.anim !== want) { v.sprite.play(want, true); v.anim = want; }
      }
      // stun stars
      const stunned = sim.isStunned(v.side) && f.koAt === null;
      v.stars.forEach((s, i) => {
        s.setVisible(stunned);
        if (!stunned) return;
        const a = this.realNow / 180 + (i * Math.PI * 2) / 3;
        s.setPosition(x + Math.cos(a) * 9, y - v.info.size * 0.9 + Math.sin(a) * 3);
      });
      // HP ghost bar
      if (this.realNow > v.ghostHoldUntil) v.ghostHp = Math.max(f.hp, v.ghostHp - f.maxHp * 0.9 * (dms / 1000));
      if (v.ghostHp < f.hp) v.ghostHp = f.hp;
    }
  }

  private syncProjectiles(): void {
    const alive = new Set<number>();
    for (const p of this.sim.projectiles) {
      alive.add(p.id);
      let img = this.projViews.get(p.id);
      if (!img) {
        const owner = this.sim.fighters[p.owner];
        const key = ensureProjectileTexture(this, owner.def.attribute ?? 'LIGHT');
        img = this.add.image(0, 0, key);
        img.setScale(p.kind === 'spell' ? 1.6 : p.kind === 'ability' ? 1.2 : 0.8);
        img.setRotation(Math.atan2(p.vy, p.vx));
        this.projViews.set(p.id, img);
      }
      const x = Math.round(this.sx(p.x)), y = Math.round(this.sy(p.y));
      img.setPosition(x, y - 10).setDepth(100 + y + 2);
    }
    for (const [id, img] of this.projViews) {
      if (!alive.has(id)) { img.destroy(); this.projViews.delete(id); }
    }
  }

  private drawGround(): void {
    const g = this.ground;
    g.clear();
    const sim = this.sim;
    // projectile ground shadows
    for (const p of sim.projectiles) {
      g.fillStyle(0x140c1c, 0.3).fillEllipse(this.sx(p.x), this.sy(p.y), p.radius * 2 + 2, p.radius + 1);
    }
    // telegraphs
    for (const z of sim.zones) {
      const mine = z.owner === this.human;
      const col = mine ? 0xf2b33d : 0xe4433c;
      const prog = Phaser.Math.Clamp((sim.t - z.spawnT) / Math.max(0.01, z.at - z.spawnT), 0, 1);
      let x = this.sx(z.x), y = this.sy(z.y);
      if (z.lockOn) {
        const tf = sim.fighters[otherSide(z.owner)];
        x = this.sx(tf.x); y = this.sy(tf.y);
        // descending light swords
        for (let i = 0; i < 3; i++) {
          const ang = (i / 3) * Math.PI * 2 + 0.4;
          const bx = x + Math.cos(ang) * 12, by = y + Math.sin(ang) * 5;
          const top = by - 60 * (1 - prog);
          g.fillStyle(0xf4dc6a, 0.9).fillRect(bx - 1, top - 14, 3, 14);
          g.fillStyle(0xffffff, 0.9).fillRect(bx, top - 14, 1, 14);
        }
      }
      const pulse = 0.5 + 0.5 * Math.sin(this.realNow / 50);
      g.fillStyle(col, 0.12 + 0.22 * prog);
      g.fillEllipse(x, y, z.radius * 2, z.radius * 2 * 0.9);
      g.lineStyle(1, col, 0.6 + 0.4 * pulse).strokeEllipse(x, y, z.radius * 2, z.radius * 2 * 0.9);
      g.lineStyle(1, 0xffffff, 0.7).strokeEllipse(x, y, z.radius * 2 * prog, z.radius * 2 * 0.9 * prog);
    }
    // status auras (under the sprite)
    for (const v of this.views) {
      const f = sim.fighters[v.side];
      if (f.koAt !== null) continue;
      const x = this.sx(f.x), y = this.sy(f.y);
      if (sim.isBuffed(v.side)) {
        const a = 0.35 + 0.2 * Math.sin(this.realNow / 70);
        g.fillStyle(0xf08a3a, a).fillEllipse(x, y, v.info.size * 0.95, v.info.size * 0.35);
      }
      // dash wind-up direction tell
      const act = f.action;
      if (act?.kind === 'dash' && sim.t < act.lungeAt) {
        const l = Math.hypot(act.vx, act.vy) || 1;
        const len = TUNING.arena.sim.dashDistance;
        g.lineStyle(3, v.side === this.human ? 0x8cc8ff : 0xff6a5a, 0.5);
        g.lineBetween(x, y, x + (act.vx / l) * len, y + (act.vy / l) * len);
      }
      // locked melee strike tell: the capsule that will be hit, filling up until the strike lands
      if (act?.kind === 'melee' && sim.t < act.strikeAt) {
        const S = TUNING.arena.sim;
        const prog = Phaser.Math.Clamp((sim.t - act.start) / Math.max(0.01, act.strikeAt - act.start), 0, 1);
        const len = act.reach + S.meleeReachSlack + 8;
        const hw = act.halfWidth + 6;
        const px = -act.dy, py = act.dx;
        const ox = this.sx(act.ox), oy = this.sy(act.oy);
        const quad = (l: number) => [
          { x: ox + px * hw, y: oy + py * hw }, { x: ox + act.dx * l + px * hw, y: oy + act.dy * l + py * hw },
          { x: ox + act.dx * l - px * hw, y: oy + act.dy * l - py * hw }, { x: ox - px * hw, y: oy - py * hw },
        ];
        const col = v.side === this.human ? 0x8cc8ff : 0xff5a4a;
        g.fillStyle(col, 0.14).fillPoints(quad(len), true);
        g.fillStyle(col, 0.18 + 0.3 * prog).fillPoints(quad(len * prog), true);
        g.lineStyle(1, col, 0.55 + 0.45 * Math.sin(this.realNow / 30) ** 2).strokePoints(quad(len), true);
      }
    }
  }

  private drawWalls(): void {
    const g = this.walls;
    g.clear();
    const sim = this.sim;
    // shield bubbles (drawn above sprites)
    for (const v of this.views) {
      const f = sim.fighters[v.side];
      if (f.koAt !== null || !sim.isShielded(v.side)) continue;
      const x = this.sx(f.x), y = this.sy(f.y) - v.info.size * 0.45;
      const a = 0.25 + 0.15 * Math.sin(this.realNow / 90);
      g.fillStyle(0x8cc8ff, a * 0.5).fillEllipse(x, y, v.info.size * 1.05, v.info.size * 1.1);
      g.lineStyle(1, 0xcfe8ff, 0.5 + a).strokeEllipse(x, y, v.info.size * 1.05, v.info.size * 1.1);
    }
    if (!sim.suddenDeath) return;
    const B = sim.bounds;
    const x0 = this.sx(0), y0 = this.sy(0), x1 = this.sx(sim.width), y1 = this.sy(sim.height);
    const bx0 = this.sx(B.x0), by0 = this.sy(B.y0), bx1 = this.sx(B.x1), by1 = this.sy(B.y1);
    const a = 0.35 + 0.1 * Math.sin(this.realNow / 120);
    g.fillStyle(0x5a0f1a, a);
    g.fillRect(x0, y0, bx0 - x0, y1 - y0);
    g.fillRect(bx1, y0, x1 - bx1, y1 - y0);
    g.fillRect(bx0, y0, bx1 - bx0, by0 - y0);
    g.fillRect(bx0, by1, bx1 - bx0, y1 - by1);
    g.lineStyle(2, 0xff5a5a, 0.7 + 0.3 * Math.sin(this.realNow / 60)).strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
  }

  // Phaser re-tessellates a Graphics' whole command list on every render (rounded rects, circles,
  // cooldown slices), which was the main per-frame cost on throttled phones. The HUD and the
  // ability buttons are therefore drawn into off-screen Graphics and baked into RenderTextures,
  // only when a quantised state signature changes; each frame then just draws two quads.
  private hudSig = '';
  private btnSig = '';

  private drawHud(): void {
    const sim = this.sim;
    // timer (BitmapText.setText is a no-op when unchanged)
    const t = sim.t;
    const sd = TUNING.arena.suddenDeathAtSec;
    let txt: string, tcol: number;
    if (t < sd) { txt = String(Math.ceil(sd - t)); tcol = sd - t <= 5 ? 0xf08a3a : PALT.cream; }
    else { txt = String(Math.max(0, Math.ceil(TUNING.arena.hardCapSec - t))); tcol = 0xff5a5a; }
    setPixelText(this.timerText, txt);
    this.timerText.setTint(tcol);
    const showPills = this.phase === 'fight' || this.phase === 'intro';
    this.autoBtn.visible = showPills; this.skipBtn.visible = showPills; this.pauseBtn.visible = showPills;
    this.autoText.setVisible(true);

    const bw = 146;
    const state = ([this.human, this.npc] as Side[]).map((side) => {
      const f = sim.fighters[side];
      const v = this.views[side];
      return {
        side,
        fw: Math.round(bw * (Math.max(0, f.hp) / f.maxHp)),
        gw: Math.round(bw * (Math.max(0, v.ghostHp) / f.maxHp)),
        frac: Math.max(0, f.hp) / f.maxHp,
        sh: sim.isShielded(side), bf: sim.isBuffed(side), st: sim.isStunned(side),
      };
    });
    const sig = `${state.map((x) => `${x.fw},${x.gw},${+x.sh}${+x.bf}${+x.st}`).join('|')}|${+showPills}${+this.auto}`;
    if (sig === this.hudSig) return;
    this.hudSig = sig;

    const g = this.hud;
    g.clear();
    for (const st of state) {
      const left = st.side === this.human;
      const pw = 158, ph = 42;
      const px = left ? 3 : W - 3 - pw;
      g.fillStyle(0x140c1c, 0.75).fillRoundedRect(px, 2, pw, ph, 4);
      g.lineStyle(1, left ? 0x3b8fe0 : 0xe4433c, 0.9).strokeRoundedRect(px, 2, pw, ph, 4);
      // HP bar
      const bh = 7, bx = left ? px + 6 : px + pw - 6 - bw, by = 16;
      g.fillStyle(0x2c2140, 1).fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      g.fillStyle(0xffffff, 0.8);
      if (left) g.fillRect(bx, by, st.gw, bh); else g.fillRect(bx + bw - st.gw, by, st.gw, bh);
      const col = st.frac > 0.5 ? 0x5fbf4a : st.frac > 0.25 ? 0xf2b33d : 0xe4433c;
      g.fillStyle(col, 1);
      if (left) g.fillRect(bx, by, st.fw, bh); else g.fillRect(bx + bw - st.fw, by, st.fw, bh);
      g.fillStyle(0xffffff, 0.25);
      if (left) g.fillRect(bx, by, st.fw, 2); else g.fillRect(bx + bw - st.fw, by, st.fw, 2);
      // shield / buff / stun pips
      let ix = left ? px + pw - 10 : px + 6;
      const pip = (c: number) => { g.fillStyle(c, 1).fillRect(ix, 37, 5, 5); ix += left ? -7 : 7; };
      if (st.sh) pip(0x8cc8ff);
      if (st.bf) pip(0xf08a3a);
      if (st.st) pip(0xf4dc6a);
    }
    // AUTO / SKIP / pause pills
    const pill = (b: TouchButton, on: boolean) => {
      const o = b.opts;
      const w = o.width ?? 30, h = o.height ?? 11;
      g.fillStyle(on ? 0x5fbf4a : 0x2c2140, 0.95).fillRoundedRect(o.x - w / 2, o.y - h / 2, w, h, 3);
      g.lineStyle(1, on ? 0xb8f0a0 : 0x5a4a7a, 1).strokeRoundedRect(o.x - w / 2, o.y - h / 2, w, h, 3);
    };
    if (showPills) { pill(this.autoBtn, this.auto); pill(this.skipBtn, false); pill(this.pauseBtn, false); }
    this.hudRT.clear().draw(g);
  }

  private drawButtons(): void {
    const sim = this.sim;
    const me = sim.fighters[this.human];
    const fighting = this.phase === 'fight';
    const alpha = this.auto ? 0.45 : 1;
    const states = this.abilityButtons.map((b) => {
      let frac = 0, ready = false, cdLeft = 0, gone = false;
      if (b.kind === 'ability') {
        const slot = me.abilities[b.index];
        frac = slot.ability.cooldown > 0 ? slot.cd / slot.ability.cooldown : 0;
        cdLeft = slot.cd;
        ready = sim.canUseAbility(this.human, b.index);
      } else {
        const sp = me.spells[b.index];
        gone = sp.used;
        ready = sim.canUseSpell(this.human, b.index);
      }
      b.btn.visible = !gone;
      b.btn.enabled = fighting && !this.auto;
      b.icon.setVisible(!gone); b.key.setVisible(!gone); b.cdText.setVisible(!gone);
      b.name?.setVisible(!gone);
      if (!gone) {
        b.icon.setAlpha(ready ? alpha : 0.5 * alpha);
        setPixelText(b.cdText, b.btn.opts.radius !== undefined && cdLeft > 0 ? String(Math.ceil(cdLeft)) : '');
      }
      const period = b.btn.opts.radius !== undefined ? 140 : 120;
      // glow quantised to 5 steps, cooldown sweep to 48 steps
      const glow = ready && fighting ? Math.round((0.5 + 0.5 * Math.sin(this.realNow / period)) * 4) / 4 : 0;
      return { b, gone, glow, q: Math.ceil(frac * 48) };
    });
    const sig = `${alpha}|` + states.map((x) => (x.gone ? 'x' : `${x.glow},${x.q}`)).join('|');
    if (sig === this.btnSig) return;
    this.btnSig = sig;

    const g = this.ui;
    g.clear();
    for (const { b, gone, glow, q } of states) {
      if (gone) continue;
      const o = b.btn.opts;
      if (o.radius !== undefined) {
        const r = o.radius;
        g.fillStyle(0x140c1c, 0.75 * alpha).fillCircle(o.x, o.y, r + 2);
        g.fillStyle(0x2c2140, 0.95 * alpha).fillCircle(o.x, o.y, r);
        g.lineStyle(2, KIND_COLOR[b.ab.kind], (0.55 + 0.45 * glow) * alpha).strokeCircle(o.x, o.y, r);
        if (q > 0) {
          g.fillStyle(0x000000, 0.55);
          g.slice(o.x, o.y, r, Phaser.Math.DegToRad(-90), Phaser.Math.DegToRad(-90 + 360 * (q / 48)), false);
          g.fillPath();
        }
      } else {
        const w = o.width ?? 18, h = o.height ?? 24;
        g.fillStyle(0x140c1c, 0.8 * alpha).fillRoundedRect(o.x - w / 2 - 1, o.y - h / 2 - 1, w + 2, h + 2, 3);
        g.fillStyle(0x2a9a84, alpha).fillRoundedRect(o.x - w / 2, o.y - h / 2, w, h, 2);
        g.lineStyle(2, 0xffb347, (0.6 + 0.4 * glow) * alpha).strokeRoundedRect(o.x - w / 2, o.y - h / 2, w, h, 2);
      }
    }
    this.uiRT.clear().draw(g);
  }

  // ---------------------------------------------------------------------------
  // Outro / finish
  // ---------------------------------------------------------------------------

  private startOutro(): void {
    if (this.phase === 'outro' || this.phase === 'done') return;
    this.phase = 'outro';
    this.phaseT = 0;
    this.touch.setInputEnabled(true);
    const r = this.result ?? this.sim.result!;
    this.result = r;
    const humanWon = (r.winner === 'attacker' && this.human === 0) || (r.winner === 'defender' && this.human === 1);
    const title = r.winner === 'draw' ? 'DRAW' : humanWon ? 'VICTORY!' : 'DEFEAT';
    const col = r.winner === 'draw' ? PALT.cream : humanWon ? PALT.gold : 0xff6a5a;
    const winnerSide: Side | null = r.winner === 'draw' ? null : r.winner === 'attacker' ? 0 : 1;
    const hp = winnerSide === null ? null : Math.round(this.sim.hpFrac(winnerSide) * 100);
    const shade = this.add.rectangle(0, 0, W, H, 0x140c1c, 0).setOrigin(0).setDepth(5800);
    this.tweens.add({ targets: shade, fillAlpha: 0.45, duration: 200 });
    const band = this.add.rectangle(W / 2, 118, W, 46, humanWon ? 0x3d2f5b : 0x2c1420, 0.92).setDepth(5801).setScale(1, 0);
    this.tweens.add({ targets: band, scaleY: 1, duration: 160, ease: 'Cubic.Out' });
    const t = pixelText(this, W / 2, 110, title, 3, col, { originX: 0.5, originY: 0.5 }).setDepth(5802).setScale(0.3);
    this.tweens.add({ targets: t, scale: 1, duration: 200, ease: 'Back.Out' });
    const sub = winnerSide === null
      ? 'BOTH MONSTERS FELL'
      : `${fitText(this.sim.fighters[winnerSide].def.name, 'tiny', 240)} WINS - ${hp}% HP LEFT`;
    const s = pixelText(this, W / 2, 132, sub, 1, PALT.cream, { tiny: true, originX: 0.5, originY: 0.5 }).setDepth(5802);
    this.outroObjs = [shade, band, t, s];
    sfx.play(humanWon ? 'victory' : r.winner === 'draw' ? 'lp' : 'defeat');
    if (humanWon) burst(this, W / 2, 110, { count: 30, texture: 'px-star', colors: [PALT.gold, PALT.white, PALT.orange], speed: 160, depth: 5803 });
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.phase = 'done';
    const result = this.result ?? this.sim.result!;
    const dev = this.data0 as ArenaSceneData & { __dev?: DevArenaParams };
    finishArena(this, result);
    if (dev.__dev) restartDevArena(this.game, dev.__dev);
  }
}

// -----------------------------------------------------------------------------
// Dev hook: ?arena=attackerId,defenderId[&pos=defense&side=1&ai=hard&seed=7&spells=a,b&espells=c&auto=1]
// -----------------------------------------------------------------------------

interface DevArenaParams {
  ids: [string, string];
  pos: Position;
  humanSide: Side;
  ai: Difficulty;
  seed: number;
  spells: string[];
  espells: string[];
  auto: boolean;
}

function parseDevParams(): DevArenaParams | null {
  if (typeof window === 'undefined' || typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  const a = q.get('arena');
  if (!a) return null;
  const ids = a.split(',').map((s) => s.trim()).filter(Boolean);
  const list = (k: string) => (q.get(k) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    ids: [ids[0] ?? 'dark-magician', ids[1] ?? 'blue-eyes-white-dragon'],
    pos: q.get('pos') === 'defense' ? 'defense' : 'attack',
    humanSide: q.get('side') === '1' ? 1 : 0,
    ai: (['easy', 'normal', 'hard'].includes(q.get('ai') ?? '') ? q.get('ai') : 'normal') as Difficulty,
    seed: Number(q.get('seed') ?? 1) || 1,
    spells: list('spells'),
    espells: list('espells'),
    auto: q.get('auto') === '1',
  };
}

function devSceneData(p: DevArenaParams): ArenaSceneData & { difficulty: Difficulty; auto: boolean; __dev: DevArenaParams } {
  const defOf = (id: string): CardDef => (hasCard(id) ? getCard(id) : getCard('dark-magician'));
  const A = defOf(p.ids[0]), D = defOf(p.ids[1]);
  const humanPlayer: PlayerId = 0;
  const attackerPlayer: PlayerId = p.humanSide === 0 ? 0 : 1;
  const defenderPlayer: PlayerId = attackerPlayer === 0 ? 1 : 0;
  let uid = 900;
  const inst = (ids: string[], owner: PlayerId): CardInstance[] => ids.filter(hasCard).map((defId) => ({ uid: uid++, defId, owner }));
  const usable: [CardInstance[], CardInstance[]] = [inst(p.spells, 0), inst(p.espells, 1)];
  const request: ArenaRequest = {
    attacker: { player: attackerPlayer, uid: 1, def: A, atk: A.atk ?? 0, defStat: A.def ?? 0 },
    defender: { player: defenderPlayer, uid: 2, def: D, atk: D.atk ?? 0, defStat: D.def ?? 0, position: p.pos },
    usableSpells: usable,
    seed: p.seed,
  };
  return { request, humanPlayer, difficulty: p.ai, auto: p.auto, __dev: p };
}

function restartDevArena(game: Phaser.Game, p: DevArenaParams): void {
  const next = { ...p, seed: p.seed + 1 };
  setTimeout(() => {
    game.scene.start(SCENES.Arena, devSceneData(next));
  }, 400);
}

(function installDevHook() {
  const p = parseDevParams();
  if (!p) return;
  const iv = setInterval(() => {
    const game = (window as unknown as { __YUGI__?: Phaser.Game }).__YUGI__;
    if (!game || !game.scene || !game.scene.isActive(SCENES.Title)) return;
    clearInterval(iv);
    game.scene.stop(SCENES.Title);
    game.scene.start(SCENES.Arena, devSceneData(p));
  }, 50);
})();
