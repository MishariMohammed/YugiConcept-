import Phaser from 'phaser';
import { getCard, getDecks } from '../core/cards/CardDB';
import { DuelEngine } from '../core/duel/DuelEngine';
import { RULES, findMonster, findSpellTrap } from '../core/duel/Rules';
import { chooseAction, makeTrapPolicy, type AIDifficulty } from '../core/ai/DuelAI';
import { autoplayHuman } from '../core/ai/HumanAutoplay';
import type { ArenaRequest, CardDef, DuelAction, DuelEvent, Phase, PlayerId } from '../core/types';
import { SCENES, runArena, type DuelSceneData } from './SceneBus';
import type { ResultData } from './ResultScene';
import { CardView } from '../ui/CardView';
import { addSwirlBackground, SWIRL_PRESETS, type SwirlBackground } from '../ui/Background';
import { pixelText, setPixelText } from '../ui/PixelText';
import { LPBar, PixelButton, banner, dimmer, panelTexture, toast } from '../ui/Widgets';
import { pickCards, type PickItem } from '../ui/CardPicker';
import { burst, damageNumber, ensureFxTextures, flashWhite, ring, shake } from '../fx/Juice';
import { fitText } from '../fx/art/PixelFont';
import { PALT } from '../fx/art/Palette';
import { sfx } from '../fx/Sfx';
import { PAUSE_EVENT } from '../mobile';

const HUMAN: PlayerId = 0;
const NPC: PlayerId = 1;
/** NPC "think" delay between actions (ms). */
const NPC_STEP_MS = 350;

// ---------------------------------------------------------------------------- layout (480x270)
/** Zone index -> column x. Zones fill centre-out (engine uses the first free zone). */
const COL_X = [211, 165, 257, 119, 303];
const ROW = { oppHand: -6, oppST: 31, oppMon: 76, mid: 109, myMon: 142, myST: 187, hand: 237 };
const PILE_X = 345;
const MON_SCALE = 0.75;
const ST_SCALE = 0.5;
const PILE_SCALE = 0.5;
const PANEL_X = 362;
const INSPECT = { x: 420, y: 76 };
const BOARD_CX = 211;

interface Target { x: number; y: number; scale: number; angle: number; faceDown: boolean; depth: number; dim: boolean }
type Mode =
  | { kind: 'idle' }
  | { kind: 'tribute'; handUid: number; faceDown: boolean; chosen: Set<number> }
  | { kind: 'attack'; attackerUid: number };
interface PanelAction { label: string; color: number; run: () => void }

type DuelData = DuelSceneData & { difficulty?: string };

/**
 * Balatro-style duel board. Engine glue (act -> afterChange -> arena / NPC / result) is unchanged
 * in spirit; every engine event is animated through a sequential queue before the glue continues.
 */
export class DuelScene extends Phaser.Scene {
  engine!: DuelEngine;
  /** QA / "AUTO" toggle: the human side is played by the duel AI. */
  autoplay = false;
  private busy = false; // arena running or NPC thinking
  private animating = false;
  private ended = false;
  private difficulty: AIDifficulty = 'normal';
  private data0!: DuelData;

  private views = new Map<number, CardView>();
  private selected: number | null = null;
  private mode: Mode = { kind: 'idle' };
  private lastTurnBanner = -1;
  private lastArena: ArenaRequest | null = null;
  private stats = { fightsWon: 0, fightsTotal: 0, damageDealt: 0, damageTaken: 0 };

  // UI
  private bg!: SwirlBackground;
  private lp!: [LPBar, LPBar];
  private phaseTitle!: Phaser.GameObjects.BitmapText;
  private phaseTurn!: Phaser.GameObjects.BitmapText;
  private phaseSteps: Phaser.GameObjects.BitmapText[] = [];
  private ticker: Phaser.GameObjects.BitmapText[] = [];
  private hint!: Phaser.GameObjects.BitmapText;
  private inspect!: CardView;
  private inspectInfo!: Phaser.GameObjects.BitmapText;
  private inspectHint!: Phaser.GameObjects.BitmapText;
  private actionBtns: PixelButton[] = [];
  private battleBtn!: PixelButton;
  private endBtn!: PixelButton;
  private directBtn!: PixelButton;
  private piles: { deck: Phaser.GameObjects.Image; deckN: Phaser.GameObjects.BitmapText; gy: Phaser.GameObjects.Image; gyN: Phaser.GameObjects.BitmapText }[] = [];
  private zoneGfx!: Phaser.GameObjects.Graphics;
  /** effective ATK/DEF chips under field monsters (printed stats are unreadable at field scale) */
  private chips = new Map<number, Phaser.GameObjects.BitmapText>();
  /** pause menu currently open */
  private paused = false;

  constructor() { super(SCENES.Duel); }

  create(data: DuelData): void {
    this.data0 = data;
    const decks = getDecks();
    // NPC difficulty: scene data first, then the game registry, default 'normal'.
    const diff = data.difficulty ?? this.registry.get('difficulty');
    this.difficulty = diff === 'easy' || diff === 'hard' ? diff : 'normal';
    this.engine = new DuelEngine({
      deck0: decks[data.deck0],
      deck1: decks[data.deck1],
      seed: data.seed ?? 1,
      firstPlayer: HUMAN,
      // The NPC decides when its own Set traps fire; the human's traps always fire (for now).
      trapPolicy: makeTrapPolicy(() => this.engine, NPC, this.difficulty),
    });
    // Scene instances are reused by Phaser: AUTO must not leak into the next duel (rematch / new game).
    this.autoplay = false;
    this.views = new Map();
    this.selected = null;
    this.mode = { kind: 'idle' };
    this.busy = false;
    this.animating = false;
    this.ended = false;
    this.lastTurnBanner = -1;
    this.stats = { fightsWon: 0, fightsTotal: 0, damageDealt: 0, damageTaken: 0 };
    this.actionBtns = [];
    this.phaseSteps = [];
    this.ticker = [];
    this.piles = [];
    this.chips = new Map();
    ensureFxTextures(this);
    this.events.on(Phaser.Scenes.Events.UPDATE, this.updateChips, this);
    this.paused = false;
    // App backgrounded / tab hidden / Android back button -> open the pause menu.
    const onPause = () => this.onExternalPause();
    this.game.events.on(PAUSE_EVENT, onPause);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.UPDATE, this.updateChips, this);
      this.game.events.off(PAUSE_EVENT, onPause);
    });

    this.buildChrome(data);
    // Hold to fast-forward animations (2x).
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => this.setFast(true));
    this.input.on(Phaser.Input.Events.POINTER_UP, () => this.setFast(false));
    this.input.on(Phaser.Input.Events.GAME_OUT, () => this.setFast(false));

    this.cameras.main.fadeIn(200, 20, 12, 28);
    this.animating = true;
    this.play(this.engine.initialEvents, true).then(() => this.afterChange());
  }

  // ======================================================================= glue

  /** Single entry point for every action (human UI or NPC). */
  private async act(action: DuelAction): Promise<void> {
    if (this.ended) return;
    let events: DuelEvent[] = [];
    try {
      events = this.engine.apply(action);
    } catch (e) {
      console.warn('[Duel] illegal action', action, e);
    }
    this.selected = null;
    this.mode = { kind: 'idle' };
    await this.play(events);
    this.afterChange();
  }

  private afterChange(): void {
    this.refreshUI();
    const e = this.engine;
    if (e.state.winner !== null) {
      if (this.ended) return;
      this.ended = true;
      const data: ResultData = {
        winner: e.state.winner,
        humanPlayer: HUMAN,
        turns: e.state.turn,
        lp: [e.state.players[0].lp, e.state.players[1].lp],
        stats: { ...this.stats },
        deck0: this.data0.deck0,
        deck1: this.data0.deck1,
        difficulty: this.difficulty,
      };
      const won = e.state.winner === HUMAN;
      banner(this, ROW.mid, e.state.winner === 'draw' ? 'DRAW' : won ? 'YOU WIN!' : 'YOU LOSE', won ? PALT.gold : PALT.red, { hold: 700 });
      this.time.delayedCall(1100, () => {
        this.cameras.main.fadeOut(200, 20, 12, 28);
        this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start(SCENES.Result, data));
      });
      return;
    }
    if (e.pendingArena) {
      this.busy = true;
      this.lastArena = e.pendingArena;
      this.refreshUI();
      // ArenaScene also reads optional `difficulty` / `auto` (AUTO toggle carries into fights).
      const arenaData = { request: e.pendingArena, humanPlayer: HUMAN, difficulty: this.difficulty, auto: this.autoplay };
      // The arena is opaque: stop drawing the board underneath it (saves a full frame of fill).
      this.scene.setVisible(false);
      runArena(this, arenaData).then(async (result) => {
        this.scene.setVisible(true);
        const evs = e.resolveArena(result);
        await this.play(evs);
        this.busy = false;
        this.afterChange();
      });
      return;
    }
    if (e.state.activePlayer === NPC || this.autoplay) {
      const who = e.state.activePlayer;
      this.busy = true;
      this.refreshUI();
      this.time.delayedCall(NPC_STEP_MS, () => {
        this.busy = false;
        if (this.ended || this.engine.state.activePlayer !== who || this.engine.pendingArena) { this.afterChange(); return; }
        if (who === HUMAN && !this.autoplay) { this.afterChange(); return; }
        const a = who === NPC ? chooseAction(this.engine, NPC, this.difficulty) : autoplayHuman(this.engine, this.difficulty);
        this.act(a);
      });
    }
  }

  private canInput(): boolean {
    const e = this.engine;
    return !this.busy && !this.animating && !this.ended && !this.autoplay && !e.pendingArena &&
      e.state.activePlayer === HUMAN && e.state.winner === null;
  }

  private legal(): DuelAction[] {
    return this.canInput() ? this.engine.legalActions(HUMAN) : [];
  }

  private setFast(on: boolean): void {
    const s = on && this.animating ? 2 : 1;
    this.tweens.timeScale = s;
    this.time.timeScale = s;
  }

  // ======================================================================= chrome

  private buildChrome(data: DuelData): void {
    const W = this.scale.width, H = this.scale.height;
    this.bg = addSwirlBackground(this, { colors: SWIRL_PRESETS.duel });

    // board mat
    this.zoneGfx = this.add.graphics().setDepth(1);
    this.drawZones();

    // right panel
    this.add.image(PANEL_X, 2, panelTexture(this, W - PANEL_X - 2, H - 4)).setOrigin(0).setDepth(2);
    this.inspect = new CardView(this, INSPECT.x, INSPECT.y, getCard(getDecks()[data.deck0][0]), { large: true, faceDown: true, interactive: false });
    this.inspect.setDepth(500);
    this.inspectHint = pixelText(this, INSPECT.x, INSPECT.y + 8, 'TAP A CARD', 1, PALT.cream, { originX: 0.5, originY: 0.5 }).setDepth(501);
    this.inspectInfo = pixelText(this, INSPECT.x, 147, '', 1, PALT.cream, { originX: 0.5, tiny: true }).setDepth(501);
    this.battleBtn = new PixelButton(this, 392, 252, 54, 24, 'BATTLE', PALT.red, () => this.onBattle()).setDepth(600);
    this.endBtn = new PixelButton(this, 449, 252, 54, 24, 'END', PALT.blue, () => this.onEndTurn()).setDepth(600);

    // left column
    const pause = new PixelButton(this, 16, 16, 24, 24, '||', PALT.dusk, () => this.openPause()).setDepth(600);
    void pause;
    const deckName = (k: string) => k.toUpperCase();
    this.lp = [
      new LPBar(this, 4, 206, 86, `YOU - ${deckName(data.deck0)}`, PALT.blue, this.engine.state.players[0].lp),
      new LPBar(this, 4, 34, 86, `${deckName(data.deck1)} (${this.difficulty.toUpperCase()})`, PALT.red, this.engine.state.players[1].lp),
    ];
    this.lp.forEach((l) => l.setDepth(600));
    this.add.image(4, 90, panelTexture(this, 86, 44)).setOrigin(0).setDepth(2);
    this.phaseTurn = pixelText(this, 47, 95, 'TURN 1', 1, PALT.haze, { originX: 0.5, tiny: true }).setDepth(3);
    this.phaseTitle = pixelText(this, 47, 103, 'YOUR TURN', 1, PALT.cream, { originX: 0.5 }).setDepth(3);
    const steps: [Phase, string][] = [['draw', 'DRAW'], ['main', 'MAIN'], ['battle', 'BTL'], ['end', 'END']];
    steps.forEach(([, t], i) => this.phaseSteps.push(pixelText(this, 12 + i * 20, 119, t, 1, PALT.dusk, { tiny: true }).setDepth(3)));
    pixelText(this, 47, 150, 'HOLD TO', 1, PALT.dusk, { originX: 0.5, tiny: true }).setDepth(3);
    pixelText(this, 47, 157, 'SPEED UP', 1, PALT.dusk, { originX: 0.5, tiny: true }).setDepth(3);

    // piles
    for (const p of [HUMAN, NPC] as PlayerId[]) {
      const deckY = p === HUMAN ? ROW.myST : ROW.oppST;
      const gyY = p === HUMAN ? ROW.myMon : ROW.oppMon;
      const deck = this.add.image(PILE_X, deckY, 'card-back-sm').setScale(PILE_SCALE).setDepth(5);
      const deckN = pixelText(this, PILE_X, deckY + 10, '30', 1, PALT.cream, { originX: 0.5, tiny: true }).setDepth(6);
      const gy = this.add.image(PILE_X, gyY, 'card-back-sm').setScale(PILE_SCALE).setDepth(5).setAlpha(0.25);
      const gyN = pixelText(this, PILE_X, gyY + 10, 'GY 0', 1, PALT.cream, { originX: 0.5, tiny: true }).setDepth(6);
      gy.setInteractive().on('pointerup', () => this.showGraveyard(p));
      this.piles[p] = { deck, deckN, gy, gyN };
    }

    // ticker + mode hint
    for (let i = 0; i < 2; i++) this.ticker.push(pixelText(this, 98, 101 + i * 7, '', 1, PALT.haze, { tiny: true }).setDepth(4));
    this.hint = pixelText(this, BOARD_CX, ROW.mid, '', 1, PALT.gold, { originX: 0.5, originY: 0.5 }).setDepth(700).setVisible(false);
    this.directBtn = new PixelButton(this, BOARD_CX, ROW.oppMon, 118, 26, 'DIRECT ATTACK!', PALT.red, () => this.onDirect()).setDepth(800).setVisible(false);
  }

  private drawZones(): void {
    const g = this.zoneGfx;
    g.clear();
    // mat behind the board
    g.fillStyle(PALT.ink, 0.35).fillRoundedRect(94, 8, 264, 204, 6);
    const zone = (x: number, y: number, w: number, h: number, c: number) => {
      g.fillStyle(c, 0.18).fillRect(x - w / 2, y - h / 2, w, h);
      g.lineStyle(1, c, 0.45).strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
    };
    for (const x of COL_X) {
      zone(x, ROW.oppMon, 38, 53, PALT.dusk); zone(x, ROW.myMon, 38, 53, PALT.dusk);
      zone(x, ROW.oppST, 26, 36, PALT.violet); zone(x, ROW.myST, 26, 36, PALT.violet);
    }
    g.lineStyle(1, PALT.dusk, 0.6).lineBetween(96, ROW.mid - 9, 330, ROW.mid - 9).lineBetween(96, ROW.mid + 8, 330, ROW.mid + 8);
  }

  // ======================================================================= layout / sync

  private targets(): Map<number, Target> {
    const s = this.engine.state;
    const out = new Map<number, Target>();
    // human hand: fan
    const hand = s.players[HUMAN].hand;
    const n = hand.length;
    const spacing = n > 1 ? Math.min(50, 214 / (n - 1)) : 0;
    const mid = (n - 1) / 2;
    hand.forEach((c, i) => {
      const sel = this.selected === c.uid;
      out.set(c.uid, {
        x: BOARD_CX + (i - mid) * spacing, y: ROW.hand + Math.abs(i - mid) * 1.5 - (sel ? 14 : 0),
        scale: 1, angle: (i - mid) * 1.6, faceDown: false, depth: 100 + i + (sel ? 50 : 0), dim: false,
      });
    });
    const oh = s.players[NPC].hand;
    const os = oh.length > 1 ? Math.min(18, 150 / (oh.length - 1)) : 0;
    oh.forEach((c, i) => out.set(c.uid, {
      x: BOARD_CX + (i - (oh.length - 1) / 2) * os, y: ROW.oppHand, scale: 0.5, angle: 180, faceDown: true, depth: 60 + i, dim: false,
    }));
    for (const p of [HUMAN, NPC] as PlayerId[]) {
      s.players[p].monsters.forEach((m, z) => {
        if (!m) return;
        out.set(m.card.uid, {
          x: COL_X[z], y: p === HUMAN ? ROW.myMon : ROW.oppMon, scale: MON_SCALE,
          angle: m.position === 'defense' ? -90 : 0, faceDown: m.faceDown && p !== HUMAN, depth: 20 + z, dim: m.faceDown && p === HUMAN,
        });
      });
      s.players[p].spellTraps.forEach((st, z) => {
        if (!st) return;
        out.set(st.card.uid, {
          x: COL_X[z], y: p === HUMAN ? ROW.myST : ROW.oppST, scale: ST_SCALE, angle: 0,
          faceDown: st.faceDown && p !== HUMAN, depth: 10 + z, dim: st.faceDown && p === HUMAN,
        });
      });
    }
    return out;
  }

  private defOf(uid: number): CardDef | null { return this.engine.getDef(uid); }

  private viewFor(uid: number, at?: { x: number; y: number; scale?: number; faceDown?: boolean }): CardView | null {
    let v = this.views.get(uid);
    if (v) return v;
    const def = this.defOf(uid);
    if (!def) return null;
    const t = this.targets().get(uid);
    const p = at ?? t ?? { x: BOARD_CX, y: ROW.mid };
    v = new CardView(this, p.x, p.y, def, { faceDown: at?.faceDown ?? t?.faceDown ?? false, scale: at?.scale ?? t?.scale ?? 1, raiseOnHover: false });
    v.on('cardTap', () => this.onCardTap(uid));
    this.views.set(uid, v);
    return v;
  }

  private gyPos(p: PlayerId): { x: number; y: number } { return { x: PILE_X, y: p === HUMAN ? ROW.myMon : ROW.oppMon }; }
  private deckPos(p: PlayerId): { x: number; y: number } { return { x: PILE_X, y: p === HUMAN ? ROW.myST : ROW.oppST }; }

  private ownerOf(uid: number): PlayerId {
    for (const p of this.engine.state.players) {
      if ([...p.hand, ...p.deck, ...p.graveyard].some((c) => c.uid === uid)) return p.id;
      if (p.monsters.some((m) => m?.card.uid === uid) || p.spellTraps.some((s) => s?.card.uid === uid)) return p.id;
    }
    return HUMAN;
  }

  private graveOf(uid: number): PlayerId | null {
    for (const p of this.engine.state.players) if (p.graveyard.some((c) => c.uid === uid)) return p.id;
    return null;
  }

  /** Reconcile every card view with the engine state. */
  private sync(animate: boolean, duration = 200): Promise<void> {
    const ts = this.targets();
    const proms: Promise<void>[] = [];
    for (const [uid, t] of ts) {
      const v = this.viewFor(uid);
      if (!v) continue;
      this.applyTarget(v, t, animate ? duration : 0, proms);
    }
    for (const [uid, v] of [...this.views]) {
      if (ts.has(uid)) continue;
      this.views.delete(uid);
      const g = this.graveOf(uid);
      if (g !== null && animate) proms.push(this.flyAway(v, this.gyPos(g)));
      else v.destroy();
    }
    this.updatePiles();
    this.refreshHighlights();
    return Promise.all(proms).then(() => undefined);
  }

  private applyTarget(v: CardView, t: Target, duration: number, proms?: Promise<void>[]): void {
    if (v.faceDown !== t.faceDown) v.setFaceDown(t.faceDown);
    v.face.setTint(t.dim ? 0x8a80a8 : 0xffffff);
    v.setDepth(t.depth);
    // drawn opponent cards are upside-down backs; keep human cards upright
    if (duration <= 0) { v.setPosition(t.x, t.y).setScale(t.scale).setAngle(t.angle); return; }
    const p = new Promise<void>((res) => this.tweens.add({
      targets: v, x: t.x, y: t.y, scale: t.scale, angle: t.angle, duration, ease: 'Cubic.Out', onComplete: () => res(),
    }));
    proms?.push(p);
  }

  private flyAway(v: CardView, to: { x: number; y: number }): Promise<void> {
    v.setHighlight(null);
    return new Promise((res) => this.tweens.add({
      targets: v, x: to.x, y: to.y, scale: PILE_SCALE, angle: 0, alpha: 0.4, duration: 220, ease: 'Cubic.In',
      onComplete: () => { v.destroy(); this.updatePiles(); res(); },
    }));
  }

  private updatePiles(): void {
    const s = this.engine.state;
    for (const p of [HUMAN, NPC] as PlayerId[]) {
      const pl = s.players[p], pile = this.piles[p];
      if (!pile) continue;
      setPixelText(pile.deckN, String(pl.deck.length));
      pile.deck.setVisible(pl.deck.length > 0);
      setPixelText(pile.gyN, `GY ${pl.graveyard.length}`);
      const top = pl.graveyard[pl.graveyard.length - 1];
      if (top) { pile.gy.setTexture(`card-sm-${top.defId}`).setAlpha(1); }
      else pile.gy.setTexture('card-back-sm').setAlpha(0.2);
    }
  }

  /** Keep stat chips glued to their monster views. */
  private updateChips(): void {
    const s = this.engine?.state;
    if (!s) return;
    const seen = new Set<number>();
    for (const p of [HUMAN, NPC] as PlayerId[]) {
      for (const m of s.players[p].monsters) {
        if (!m) continue;
        const uid = m.card.uid;
        const v = this.views.get(uid);
        if (!v || (m.faceDown && p === NPC)) continue;
        seen.add(uid);
        let c = this.chips.get(uid);
        if (!c) { c = pixelText(this, 0, 0, '', 1, PALT.cream, { originX: 0.5, originY: 0.5, tiny: true }); this.chips.set(uid, c); }
        const atk = m.position === 'attack';
        const val = atk ? this.engine.getEffectiveAtk(uid) : this.engine.getEffectiveDef(uid);
        const base = this.defOf(uid);
        const orig = atk ? base?.atk ?? val : base?.def ?? val;
        const txt = `${atk ? '{' : '}'}${val}`;
        if (c.text !== txt) setPixelText(c, txt);
        c.setTint(val > orig ? PALT.green : val < orig ? PALT.red : atk ? 0xffb0a0 : 0xa8d0ff);
        const dy = atk ? 21 : 14;
        c.setPosition(Math.round(v.x), Math.round(v.y + dy * (v.scale / MON_SCALE)));
        c.setDepth(v.depth + 1).setVisible(v.visible).setAlpha(v.alpha);
      }
    }
    for (const [uid, c] of this.chips) if (!seen.has(uid)) { c.destroy(); this.chips.delete(uid); }
  }

  // ======================================================================= event animation

  private wait(ms: number): Promise<void> {
    return new Promise((res) => this.time.delayedCall(ms, () => res()));
  }

  /** Play engine events sequentially (each <= ~0.6 s), then reconcile with the final state. */
  private async play(events: DuelEvent[], opening = false): Promise<void> {
    this.animating = true;
    this.refreshUI();
    for (const ev of events) {
      if (!this.scene.isActive() && !this.scene.isPaused()) break;
      try {
        await this.animate(ev, opening);
      } catch (err) {
        console.warn('[Duel] animation error', ev, err);
      }
    }
    await this.sync(true, 180);
    this.animating = false;
    this.setFast(false);
  }

  private async animate(ev: DuelEvent, opening: boolean): Promise<void> {
    const s = this.engine.state;
    switch (ev.type) {
      case 'log': this.updateTicker(); return;
      case 'draw': {
        const d = this.deckPos(ev.player);
        const v = this.viewFor(ev.uid, { x: d.x, y: d.y, scale: PILE_SCALE, faceDown: true });
        const t = this.targets().get(ev.uid);
        if (v && t) {
          v.setDepth(t.depth + 200);
          this.tweens.add({ targets: v, x: t.x, y: t.y, scale: t.scale, angle: t.angle, duration: 240, ease: 'Cubic.Out',
            onComplete: () => { if (!t.faceDown && v.faceDown) v.flip(false); v.setDepth(t.depth); } });
        }
        this.updatePiles();
        sfx.play('draw');
        await this.wait(opening ? 55 : 110);
        return;
      }
      case 'summon': {
        let v = this.views.get(ev.uid);
        if (!v) {
          const g = this.graveOf(ev.uid) ?? ev.player;
          const from = findMonster(s, ev.uid) ? this.gyPos(g === null ? ev.player : g) : this.gyPos(ev.player);
          v = this.viewFor(ev.uid, { ...from, scale: PILE_SCALE }) ?? undefined;
        }
        const t = this.targets().get(ev.uid);
        if (!v) return;
        v.setHighlight(null);
        if (t) {
          if (v.faceDown !== t.faceDown) v.setFaceDown(t.faceDown);
          v.face.setTint(t.dim ? 0x8a80a8 : 0xffffff);
          v.setDepth(t.depth + 300);
          await new Promise<void>((res) => this.tweens.add({ targets: v, x: t.x, y: t.y, scale: t.scale, angle: t.angle, duration: 200, ease: 'Cubic.Out', onComplete: () => res() }));
          v.setDepth(t.depth);
        }
        v.playSummonBounce();
        sfx.play('summon');
        shake(this, 0.004, 100);
        await this.wait(260);
        return;
      }
      case 'set': {
        const v = this.views.get(ev.uid) ?? this.viewFor(ev.uid);
        const t = this.targets().get(ev.uid);
        if (!v || !t) return;
        if (v.faceDown !== t.faceDown) v.setFaceDown(t.faceDown);
        v.face.setTint(t.dim ? 0x8a80a8 : 0xffffff);
        await new Promise<void>((res) => this.tweens.add({ targets: v, x: t.x, y: t.y, scale: t.scale, angle: t.angle, duration: 200, ease: 'Cubic.Out', onComplete: () => res() }));
        ring(this, t.x, t.y, PALT.violet, 2, 200);
        sfx.play('set');
        await this.wait(60);
        return;
      }
      case 'activate': return this.animActivate(ev.uid, ev.player);
      case 'destroy': {
        const v = this.views.get(ev.uid);
        if (!v) return;
        this.views.delete(ev.uid);
        if (v.faceDown) v.setFaceDown(false);
        v.face.setTint(0xffffff);
        flashWhite(v.face, 90);
        sfx.play('destroy');
        v.shake(3);
        burst(this, v.x, v.y, { count: 14, texture: 'px-spark', colors: [PALT.white, PALT.red, PALT.orange], speed: 100 });
        shake(this, 0.005, 120);
        await this.wait(170);
        await this.flyAway(v, this.gyPos(this.graveOf(ev.uid) ?? ev.player));
        return;
      }
      case 'toGraveyard': {
        const v = this.views.get(ev.uid);
        if (!v) { this.updatePiles(); return; }
        this.views.delete(ev.uid);
        if (v.faceDown) await v.flip(false);
        await this.flyAway(v, this.gyPos(this.graveOf(ev.uid) ?? ev.player));
        return;
      }
      case 'lp': {
        const bar = this.lp[ev.player];
        if (ev.delta < 0) {
          if (ev.player === NPC) this.stats.damageDealt += -ev.delta; else this.stats.damageTaken += -ev.delta;
        }
        damageNumber(this, 70, ev.player === HUMAN ? 200 : 66, ev.delta, {
          prefix: ev.delta < 0 ? '-' : '+', color: ev.delta < 0 ? PALT.red : PALT.green, crit: Math.abs(ev.delta) >= 1000, depth: 3000,
        });
        if (ev.delta < 0) shake(this, Math.min(0.012, 0.003 + -ev.delta / 200000), 160);
        sfx.play(ev.delta < 0 ? 'lp' : 'heal');
        if (ev.player === HUMAN && ev.lp <= 1000) this.bg.setColors(SWIRL_PRESETS.defeat);
        await Promise.race([bar.setLP(ev.lp, 450), this.wait(320)]);
        return;
      }
      case 'position': {
        const v = this.views.get(ev.uid);
        const t = this.targets().get(ev.uid);
        if (!v || !t) return;
        if (v.faceDown !== t.faceDown) await v.flip(t.faceDown);
        v.face.setTint(t.dim ? 0x8a80a8 : 0xffffff);
        await new Promise<void>((res) => this.tweens.add({ targets: v, angle: t.angle, duration: 180, ease: 'Back.Out', onComplete: () => res() }));
        return;
      }
      case 'attack': {
        const a = this.views.get(ev.attackerUid);
        if (!a) return;
        const tv = ev.targetUid !== null ? this.views.get(ev.targetUid) : null;
        const tx = tv ? tv.x : BOARD_CX;
        const ty = tv ? tv.y : (ev.player === HUMAN ? ROW.oppHand + 20 : ROW.hand - 20);
        a.setDepth(400);
        a.setHighlight(PALT.red);
        tv?.setHighlight(PALT.red);
        const sx = a.x, sy = a.y;
        sfx.play('attack');
        await new Promise<void>((res) => this.tweens.add({
          targets: a, x: sx + (tx - sx) * 0.45, y: sy + (ty - sy) * 0.45, duration: 130, ease: 'Quad.In', yoyo: true,
          onYoyo: () => { if (tv) { flashWhite(tv.face, 80); tv.shake(2); } shake(this, 0.004, 90); },
          onComplete: () => res(),
        }));
        a.setHighlight(null); tv?.setHighlight(null);
        if (ev.targetUid === null) await this.wait(60);
        return;
      }
      case 'attackNegated': await banner(this, ROW.mid, 'ATTACK NEGATED', PALT.blue, { hold: 260, width: 240, x: BOARD_CX }); return;
      case 'phase': {
        this.updatePhase();
        if (ev.phase === 'main' && this.lastTurnBanner !== s.turn && ev.player === s.activePlayer) {
          this.lastTurnBanner = s.turn;
          if (ev.player === NPC) this.bg.setColors(['#1e1020', '#3a1a34', '#5a2a48']);
          else if (s.players[HUMAN].lp > 1000) this.bg.setColors(SWIRL_PRESETS.duel);
          if (!opening) await banner(this, ROW.mid, ev.player === HUMAN ? 'YOUR TURN' : 'OPPONENT TURN', ev.player === HUMAN ? PALT.blue : PALT.red, { hold: 240, width: 240, x: BOARD_CX });
        } else if (ev.phase === 'battle') {
          await banner(this, ROW.mid, 'BATTLE!', PALT.orange, { hold: 160, width: 240, x: BOARD_CX });
        }
        return;
      }
      case 'arena': {
        this.lastArena = ev.request;
        await banner(this, ROW.mid, 'ARENA FIGHT!', PALT.gold, { sub: `${ev.request.attacker.def.name}  VS  ${ev.request.defender.def.name}`, hold: 320, width: 260, x: BOARD_CX });
        return;
      }
      case 'arenaResolved': {
        const req = this.lastArena;
        this.stats.fightsTotal++;
        if (req) {
          const humanWon = (ev.result.winner === 'attacker' && req.attacker.player === HUMAN) ||
            (ev.result.winner === 'defender' && req.defender.player === HUMAN);
          if (humanWon) this.stats.fightsWon++;
        }
        return;
      }
      default: return;
    }
  }

  private async animActivate(uid: number, player: PlayerId): Promise<void> {
    const s = this.engine.state;
    const def = this.defOf(uid);
    if (!def) return;
    // Monster ignition effect: pulse in place.
    if (def.kind === 'monster') {
      const v = this.views.get(uid);
      if (v) {
        v.setHighlight(PALT.gold);
        ring(this, v.x, v.y, PALT.gold, 3, 260);
        this.tweens.add({ targets: v, scale: v.scale * 1.15, duration: 120, yoyo: true });
        await this.wait(300);
        v.setHighlight(null);
      }
      return;
    }
    const isTrap = def.kind === 'trap';
    let v = this.views.get(uid);
    if (!v) v = this.viewFor(uid, { x: BOARD_CX, y: player === HUMAN ? ROW.myST : ROW.oppST, scale: ST_SCALE, faceDown: true }) ?? undefined;
    if (!v) return;
    v.setDepth(2500);
    v.setHighlight(isTrap ? PALT.red : PALT.gold);
    v.face.setTint(0xffffff);
    const name = pixelText(this, BOARD_CX, ROW.mid + 40, def.name, 1, PALT.cream, { originX: 0.5, originY: 0.5 }).setDepth(2600).setAlpha(0);
    await new Promise<void>((res) => this.tweens.add({ targets: v, x: BOARD_CX, y: ROW.mid - 4, scale: 1, angle: 0, duration: 180, ease: 'Cubic.Out', onComplete: () => res() }));
    if (v.faceDown) await v.flip(false);
    ring(this, v.x, v.y, isTrap ? PALT.red : PALT.gold, 4, 280);
    sfx.play('spell');
    burst(this, v.x, v.y, { count: 10, texture: 'px-star', colors: [PALT.gold, PALT.cream], speed: 80, gravity: 0, lifespan: 400 });
    this.tweens.add({ targets: name, alpha: 1, duration: 100 });
    if (isTrap) {
      await banner(this, ROW.mid - 50, 'TRAP ACTIVATED!', 0xb8448e, { sub: def.name, hold: 300, width: 240, x: BOARD_CX });
    } else {
      await this.wait(330);
    }
    this.tweens.add({ targets: name, alpha: 0, duration: 120, onComplete: () => name.destroy() });
    // stays on field (continuous / equip / field)?
    const onField = findSpellTrap(s, uid);
    if (onField) {
      v.setHighlight(null);
      const t = this.targets().get(uid);
      if (t) this.applyTarget(v, t, 180);
    }
  }

  // ======================================================================= UI refresh

  private updateTicker(): void {
    const log = this.engine.state.log;
    const lines = log.slice(-2);
    while (lines.length < 2) lines.unshift('');
    lines.forEach((l, i) => {
      setPixelText(this.ticker[i], fitText(l.replace(/\bP0\b/g, this.data0.deck0).replace(/\bP1\b/g, this.data0.deck1).replace(/[Pp]layer 0/g, this.data0.deck0).replace(/[Pp]layer 1/g, this.data0.deck1), 'tiny', 226));
      this.ticker[i].setTint(i === 1 ? PALT.cream : PALT.haze);
    });
  }

  private updatePhase(): void {
    const s = this.engine.state;
    const mine = s.activePlayer === HUMAN;
    setPixelText(this.phaseTurn, `TURN ${s.turn}`);
    setPixelText(this.phaseTitle, mine ? 'YOUR TURN' : 'OPP TURN');
    this.phaseTitle.setTint(mine ? PALT.blue : PALT.red);
    const order: Phase[] = ['draw', 'main', 'battle', 'end'];
    this.phaseSteps.forEach((t, i) => t.setTint(order[i] === s.phase ? PALT.gold : PALT.dusk));
  }

  private refreshUI(): void {
    if (!this.inspect) return;
    this.updatePhase();
    this.updateTicker();
    this.updatePiles();
    const legal = this.legal();
    const battle = legal.find((a) => a.type === 'enterBattle');
    const end = legal.find((a) => a.type === 'endTurn');
    const myTurn = this.engine.state.activePlayer === HUMAN;
    this.battleBtn.setEnabled(!!battle);
    this.endBtn.setEnabled(!!end);
    this.endBtn.setText(this.engine.state.phase === 'battle' && myTurn ? 'END' : 'END');
    if (this.autoplay) { this.battleBtn.setEnabled(false); this.endBtn.setEnabled(false); }
    this.refreshPanel();
    this.refreshHighlights();
  }

  private refreshHighlights(): void {
    const legal = this.legal();
    const s = this.engine.state;
    for (const [uid, v] of this.views) {
      let c: number | null = null;
      if (this.mode.kind === 'tribute') {
        const m = findMonster(s, uid);
        if (m && m.player === HUMAN) c = this.mode.chosen.has(uid) ? PALT.red : PALT.gold;
      } else if (this.mode.kind === 'attack') {
        const atk = this.mode.attackerUid;
        if (uid === atk) c = PALT.gold;
        else if (legal.some((a) => a.type === 'declareAttack' && a.attackerUid === atk && a.targetUid === uid)) c = PALT.red;
      } else if (uid === this.selected) c = PALT.gold;
      else if (s.phase === 'battle' && legal.some((a) => a.type === 'declareAttack' && a.attackerUid === uid)) c = PALT.blue;
      v.setHighlight(c);
    }
    // hint / direct attack
    const direct = this.mode.kind === 'attack' &&
      legal.find((a) => a.type === 'declareAttack' && a.attackerUid === (this.mode as { attackerUid: number }).attackerUid && a.targetUid === null);
    this.directBtn.setVisible(!!direct);
    let hint = '';
    if (this.mode.kind === 'tribute') {
      const max = this.tributeMax();
      hint = `SELECT ${max} TRIBUTE${max > 1 ? 'S' : ''}`;
    } else if (this.mode.kind === 'attack') hint = direct ? '' : 'CHOOSE A TARGET';
    this.hint.setVisible(!!hint);
    this.ticker.forEach((t) => t.setVisible(!hint));
    if (hint) setPixelText(this.hint, hint);
  }

  // ----------------------------------------------------------------- inspect panel + actions

  private refreshPanel(): void {
    this.actionBtns.forEach((b) => b.destroy());
    this.actionBtns = [];
    const uid = this.selected;
    if (uid === null) {
      this.inspect.setVisible(false);
      this.inspectHint.setVisible(true);
      setPixelText(this.inspectHint, this.canInput() ? 'TAP A CARD' : this.busy || this.animating ? '...' : 'TAP A CARD');
      setPixelText(this.inspectInfo, '');
      return;
    }
    const def = this.defOf(uid);
    if (!def) return;
    this.inspectHint.setVisible(false);
    const s = this.engine.state;
    const hidden = this.isHidden(uid);
    if (this.inspect.def.id !== def.id) this.inspect.setCard(def);
    if (this.inspect.faceDown !== hidden) this.inspect.setFaceDown(hidden);
    this.inspect.setVisible(true);
    // info line
    const m = findMonster(s, uid);
    const st = findSpellTrap(s, uid);
    let info = '';
    if (hidden) info = 'FACE-DOWN';
    else if (m) {
      const atk = this.engine.getEffectiveAtk(uid), dff = this.engine.getEffectiveDef(uid);
      info = `{${atk} }${dff} ${m.slot.position === 'attack' ? 'ATK POS' : 'DEF POS'}${m.slot.faceDown ? ' SET' : ''}`;
    } else if (st) info = st.slot.faceDown ? 'SET' : 'FACE-UP';
    else if (def.kind === 'monster') info = `LV ${def.level}  ${def.attribute ?? ''}`;
    setPixelText(this.inspectInfo, info);
    // contextual actions
    const acts = this.panelActions(uid);
    const list = [...acts];
    if (this.mode.kind !== 'idle') list.push({ label: 'CANCEL', color: PALT.dusk, run: () => this.cancelMode() });
    list.slice(0, 4).forEach((a, i) => {
      const cols = list.length > 2 ? 2 : 1;
      const w = cols === 2 ? 54 : 110;
      const x = cols === 2 ? 392 + (i % 2) * 57 : INSPECT.x;
      const y = 166 + Math.floor(i / cols) * 28;
      const b = new PixelButton(this, x, y, w, 24, a.label, a.color, a.run, { tiny: w < 60 && a.label.length > 8 }).setDepth(600);
      this.actionBtns.push(b);
    });
  }

  private isHidden(uid: number): boolean {
    const s = this.engine.state;
    if (s.players[NPC].hand.some((c) => c.uid === uid)) return true;
    const m = findMonster(s, uid);
    if (m && m.player === NPC && m.slot.faceDown) return true;
    const st = findSpellTrap(s, uid);
    if (st && st.player === NPC && st.slot.faceDown) return true;
    return false;
  }

  private panelActions(uid: number): PanelAction[] {
    const legal = this.legal();
    if (!legal.length) return [];
    const s = this.engine.state;
    const out: PanelAction[] = [];
    if (this.mode.kind === 'tribute') {
      const ok = this.tributeAction();
      out.push({ label: ok ? 'CONFIRM' : `PICK ${this.tributeMax()}`, color: ok ? PALT.orange : PALT.dusk, run: () => { const a = this.tributeAction(); if (a) this.act(a); } });
      return out;
    }
    if (this.mode.kind === 'attack') return out;
    const inHand = s.players[HUMAN].hand.some((c) => c.uid === uid);
    if (inHand) {
      const sums = legal.filter((a): a is Extract<DuelAction, { type: 'normalSummon' }> => a.type === 'normalSummon' && a.handUid === uid);
      for (const fd of [false, true]) {
        const g = sums.filter((a) => a.faceDown === fd);
        if (!g.length) continue;
        const free = g.find((a) => a.tributeUids.length === 0);
        out.push({
          label: fd ? 'SET' : 'SUMMON', color: fd ? PALT.violet : PALT.orange,
          run: () => free ? this.act(free) : this.enterTribute(uid, fd),
        });
      }
      const spells = legal.filter((a): a is Extract<DuelAction, { type: 'activateSpell' }> => a.type === 'activateSpell' && a.handUid === uid);
      if (spells.length) out.push({ label: 'ACTIVATE', color: PALT.green, run: () => this.withTarget(spells, (a) => a.targetUid, 'CHOOSE A TARGET') });
      const set = legal.find((a) => a.type === 'setSpellTrap' && a.handUid === uid);
      if (set) out.push({ label: 'SET', color: PALT.violet, run: () => this.act(set) });
      return out;
    }
    const pos = legal.find((a) => a.type === 'changePosition' && a.uid === uid);
    if (pos) {
      const m = findMonster(s, uid);
      const lbl = m?.slot.faceDown ? 'FLIP' : m?.slot.position === 'attack' ? 'TO DEF' : 'TO ATK';
      out.push({ label: lbl, color: PALT.blue, run: () => this.act(pos) });
    }
    const eff = legal.filter((a): a is Extract<DuelAction, { type: 'activateMonster' }> => a.type === 'activateMonster' && a.uid === uid);
    if (eff.length) out.push({ label: 'EFFECT', color: PALT.gold, run: () => this.withTarget(eff, (a) => a.targetUid, 'EFFECT TARGET') });
    const flip = legal.filter((a): a is Extract<DuelAction, { type: 'activateSet' }> => a.type === 'activateSet' && a.uid === uid);
    if (flip.length) out.push({ label: 'ACTIVATE', color: PALT.green, run: () => this.withTarget(flip, (a) => a.targetUid, 'CHOOSE A TARGET') });
    if (legal.some((a) => a.type === 'declareAttack' && a.attackerUid === uid)) {
      out.push({ label: 'ATTACK', color: PALT.red, run: () => this.enterAttack(uid) });
    }
    return out;
  }

  /** Run one of `acts`; if they carry targets, ask the player to pick one first. */
  private async withTarget<A extends DuelAction>(acts: A[], tgt: (a: A) => number | undefined, title: string): Promise<void> {
    const targeted = acts.filter((a) => tgt(a) !== undefined);
    if (!targeted.length) { this.act(acts[0]); return; }
    const items: PickItem[] = [];
    for (const a of targeted) {
      const t = tgt(a)!;
      const def = this.defOf(t);
      if (!def || items.some((i) => i.uid === t)) continue;
      const g = this.graveOf(t);
      const owner = this.ownerOf(t);
      items.push({ uid: t, def, faceDown: this.isHidden(t), note: `${owner === HUMAN ? 'YOUR' : 'OPP'} ${g !== null ? 'GY' : 'FIELD'}` });
    }
    this.busy = true;
    const r = await pickCards(this, { title, items });
    this.busy = false;
    if (!r) { this.refreshUI(); return; }
    const a = targeted.find((x) => tgt(x) === r[0]);
    if (a) this.act(a);
  }

  // ----------------------------------------------------------------- modes

  private enterTribute(handUid: number, faceDown: boolean): void {
    this.mode = { kind: 'tribute', handUid, faceDown, chosen: new Set() };
    this.refreshUI();
  }

  private tributeCombos(): number[][] {
    if (this.mode.kind !== 'tribute') return [];
    const { handUid, faceDown } = this.mode;
    return this.legal()
      .filter((a): a is Extract<DuelAction, { type: 'normalSummon' }> => a.type === 'normalSummon' && a.handUid === handUid && a.faceDown === faceDown)
      .map((a) => a.tributeUids);
  }

  private tributeMax(): number {
    const c = this.tributeCombos();
    return c.length ? Math.min(...c.map((x) => x.length).filter((n) => n > 0)) : 0;
  }

  private tributeAction(): DuelAction | null {
    if (this.mode.kind !== 'tribute') return null;
    const { handUid, faceDown, chosen } = this.mode;
    return this.legal().find((a) => a.type === 'normalSummon' && a.handUid === handUid && a.faceDown === faceDown &&
      a.tributeUids.length === chosen.size && a.tributeUids.every((u) => chosen.has(u))) ?? null;
  }

  private enterAttack(uid: number): void {
    this.mode = { kind: 'attack', attackerUid: uid };
    this.selected = uid;
    this.refreshUI();
  }

  private cancelMode(): void {
    this.mode = { kind: 'idle' };
    this.refreshUI();
    this.sync(true, 120);
  }

  // ----------------------------------------------------------------- input

  private onCardTap(uid: number): void {
    if (this.busy) return;
    const s = this.engine.state;
    const legal = this.legal();
    if (this.mode.kind === 'tribute') {
      const m = findMonster(s, uid);
      if (m && m.player === HUMAN) {
        const ch = this.mode.chosen;
        if (ch.has(uid)) ch.delete(uid);
        else if (ch.size < Math.max(...this.tributeCombos().map((c) => c.length), 0)) ch.add(uid);
        this.refreshUI();
        // auto-confirm when exactly one way to finish
        return;
      }
      if (uid !== this.mode.handUid) { this.cancelMode(); }
      return;
    }
    if (this.mode.kind === 'attack') {
      const atk = this.mode.attackerUid;
      const a = legal.find((x) => x.type === 'declareAttack' && x.attackerUid === atk && x.targetUid === uid);
      if (a) { this.act(a); return; }
      if (legal.some((x) => x.type === 'declareAttack' && x.attackerUid === uid)) { this.enterAttack(uid); return; }
      this.mode = { kind: 'idle' };
    }
    // battle phase shortcut: tapping an attacker enters attack mode directly
    if (s.phase === 'battle' && legal.some((x) => x.type === 'declareAttack' && x.attackerUid === uid)) {
      this.enterAttack(uid);
      return;
    }
    this.selected = this.selected === uid && this.engine.state.players[HUMAN].hand.some((c) => c.uid === uid) ? null : uid;
    this.refreshUI();
    this.sync(true, 120);
  }

  private onDirect(): void {
    if (this.mode.kind !== 'attack') return;
    const atk = this.mode.attackerUid;
    const a = this.legal().find((x) => x.type === 'declareAttack' && x.attackerUid === atk && x.targetUid === null);
    if (a) this.act(a);
  }

  private onBattle(): void {
    const a = this.legal().find((x) => x.type === 'enterBattle');
    if (a) this.act(a);
  }

  private async onEndTurn(): Promise<void> {
    const legal = this.legal();
    const end = legal.find((x) => x.type === 'endTurn');
    if (!end) return;
    const hand = this.engine.state.players[HUMAN].hand;
    const excess = hand.length - RULES.handLimit;
    if (excess > 0) {
      this.busy = true;
      const r = await pickCards(this, {
        title: `HAND LIMIT: DISCARD ${excess}`, count: excess,
        items: hand.map((c) => ({ uid: c.uid, def: getCard(c.defId) })),
      });
      this.busy = false;
      if (!r) { this.refreshUI(); return; }
      this.act({ type: 'endTurn', discardUids: r });
      return;
    }
    this.act(end);
  }

  private showGraveyard(p: PlayerId): void {
    if (this.busy) return;
    const gy = this.engine.state.players[p].graveyard;
    if (!gy.length) { toast(this, PILE_X, this.gyPos(p).y - 22, 'EMPTY'); return; }
    this.busy = true;
    pickCards(this, {
      title: `${p === HUMAN ? 'YOUR' : 'OPPONENT'} GRAVEYARD`,
      items: gy.slice(-14).reverse().map((c) => ({ uid: c.uid, def: getCard(c.defId) })),
    }).then(() => { this.busy = false; this.refreshUI(); });
  }

  /** PAUSE_EVENT from mobile.ts (backgrounded / back button). Ignored while the arena owns the screen. */
  private onExternalPause(): void {
    if (this.paused || this.ended || !this.sys.isActive() || this.scene.isActive(SCENES.Arena)) return;
    this.openPause();
  }

  private openPause(): void {
    // Taps on the arena overlay fall through to this (hidden) scene: never pause underneath a fight.
    if (this.ended || this.paused || this.scene.isActive(SCENES.Arena)) return;
    this.paused = true;
    const W = this.scale.width, H = this.scale.height;
    const objs: Phaser.GameObjects.GameObject[] = [];
    const wasBusy = this.busy;
    this.busy = true;
    this.setFast(false);
    objs.push(dimmer(this, 0.75, 5000));
    objs.push(this.add.image(W / 2, H / 2, panelTexture(this, 150, 180)).setDepth(5001));
    objs.push(pixelText(this, W / 2, H / 2 - 78, 'PAUSED', 2, PALT.gold, { originX: 0.5 }).setDepth(5002));
    this.tweens.pauseAll();
    this.time.paused = true;
    const unpause = () => { this.tweens.resumeAll(); this.time.paused = false; this.paused = false; };
    const close = () => { objs.forEach((o) => o.destroy()); unpause(); this.busy = wasBusy; this.refreshUI(); };
    const btn = (y: number, t: string, c: number, fn: () => void) => {
      const b = new PixelButton(this, W / 2, y, 120, 24, t, c, fn).setDepth(5003);
      objs.push(b);
      return b;
    };
    btn(H / 2 - 46, 'RESUME', PALT.blue, close);
    btn(H / 2 - 18, this.autoplay ? 'AUTO: ON' : 'AUTO: OFF', PALT.violet, () => {
      this.autoplay = !this.autoplay; close(); if (!this.busy && !this.animating) this.afterChange();
    });
    const snd = btn(H / 2 + 10, sfx.muted ? 'SOUND: OFF' : 'SOUND: ON', PALT.green, () => {
      sfx.unlock();
      snd.setText(sfx.toggleMute() ? 'SOUND: OFF' : 'SOUND: ON');
    });
    btn(H / 2 + 38, 'RESTART', PALT.orange, () => { unpause(); this.scene.restart({ ...this.data0, seed: Date.now() & 0x7fffffff }); });
    btn(H / 2 + 66, 'QUIT', PALT.redDark, () => { unpause(); this.scene.start(SCENES.Title); });
  }
}
