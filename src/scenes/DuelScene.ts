import Phaser from 'phaser';
import { getCard, getDecks } from '../core/cards/CardDB';
import { DuelEngine } from '../core/duel/DuelEngine';
import { describeAction } from '../core/duel/Actions';
import { placeholderChooseAction } from '../core/ai/PlaceholderAI';
import type { CardInstance, DuelAction, MonsterSlot, PlayerId, SpellTrapSlot } from '../core/types';
import { SCENES, runArena, type DuelSceneData, type ResultSceneData } from './SceneBus';
import { button, label } from './ui';

const HUMAN: PlayerId = 0;
const NPC: PlayerId = 1;
const NPC_STEP_MS = 450;

/**
 * PLACEHOLDER duel board: text boxes + buttons so the loop is playable end-to-end.
 * The Pixel Artist replaces rendering with src/ui/* (CardView, Hand, Field...).
 * The engine glue (apply -> afterChange -> arena/NPC/result) is the part to keep.
 */
export class DuelScene extends Phaser.Scene {
  engine!: DuelEngine;
  private view!: Phaser.GameObjects.Container;
  private selected: number | null = null;
  private busy = false; // arena running or NPC thinking
  private ended = false;

  constructor() { super(SCENES.Duel); }

  create(data: DuelSceneData): void {
    const decks = getDecks();
    this.engine = new DuelEngine({
      deck0: decks[data.deck0],
      deck1: decks[data.deck1],
      seed: data.seed ?? 1,
      firstPlayer: HUMAN,
    });
    this.selected = null;
    this.busy = false;
    this.ended = false;
    this.view = this.add.container(0, 0);
    this.refresh();
  }

  // ---------------------------------------------------------------- glue ----

  /** Single entry point for every action (human UI or NPC). */
  private act(action: DuelAction): void {
    try {
      this.engine.apply(action);
    } catch (e) {
      console.warn('[Duel] illegal action', action, e);
    }
    this.selected = null;
    this.afterChange();
  }

  private afterChange(): void {
    this.refresh();
    const e = this.engine;
    if (e.state.winner !== null) {
      if (this.ended) return;
      this.ended = true;
      const data: ResultSceneData = {
        winner: e.state.winner,
        humanPlayer: HUMAN,
        turns: e.state.turn,
        lp: [e.state.players[0].lp, e.state.players[1].lp],
      };
      this.time.delayedCall(800, () => this.scene.start(SCENES.Result, data));
      return;
    }
    if (e.pendingArena) {
      this.busy = true;
      runArena(this, { request: e.pendingArena, humanPlayer: HUMAN }).then((result) => {
        e.resolveArena(result);
        this.busy = false;
        this.afterChange();
      });
      return;
    }
    if (e.state.activePlayer === NPC) {
      this.busy = true;
      this.time.delayedCall(NPC_STEP_MS, () => {
        this.busy = false;
        const a = placeholderChooseAction(this.engine, NPC);
        if (a) this.act(a);
      });
    }
  }

  // -------------------------------------------------------------- render ----

  private refresh(): void {
    this.view.removeAll(true);
    const s = this.engine.state;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.view.add(o); return o; };

    const info = (p: PlayerId) => {
      const ps = s.players[p];
      return `${p === HUMAN ? 'YOU' : 'NPC'}  LP ${ps.lp}  Hand ${ps.hand.length}  Deck ${ps.deck.length}  GY ${ps.graveyard.length}`;
    };
    add(label(this, 4, 3, info(NPC), { color: '#ff9e9e' }));
    this.spellRow(NPC, 14).forEach(add);
    this.monsterRow(NPC, 34).forEach(add);
    add(label(this, 4, 70, `Turn ${s.turn} - ${s.activePlayer === HUMAN ? 'YOUR' : 'NPC'} ${s.phase.toUpperCase()} phase`, { color: '#ffd166' }));
    this.monsterRow(HUMAN, 82).forEach(add);
    this.spellRow(HUMAN, 116).forEach(add);
    add(label(this, 4, 137, info(HUMAN), { color: '#9ee6ff' }));
    this.handRow(150).forEach(add);
    this.actionPanel(322, 4).forEach(add);
    // log
    const lines = s.log.slice(-9);
    add(label(this, 322, 196, lines.join('\n'), { color: '#b8aecb', wordWrap: { width: 154 }, fontSize: '7px' }));
  }

  private cardBox(x: number, y: number, w: number, h: number, text: string, uid: number | null, color: number) {
    const objs: Phaser.GameObjects.GameObject[] = [];
    const sel = uid !== null && uid === this.selected;
    const r = this.add.rectangle(x, y, w, h, color).setOrigin(0).setStrokeStyle(1, sel ? 0xffd166 : 0x6b6378);
    objs.push(r);
    objs.push(label(this, x + 2, y + 2, text, { wordWrap: { width: w - 4 }, fontSize: '7px' }));
    if (uid !== null) {
      r.setInteractive({ useHandCursor: true });
      r.on('pointerup', () => { this.selected = this.selected === uid ? null : uid; this.refresh(); });
    }
    return objs;
  }

  private monsterText(m: MonsterSlot, owner: PlayerId): string {
    if (m.faceDown && owner !== HUMAN) return '(set)\n???';
    const d = getCard(m.card.defId);
    const atk = this.engine.getEffectiveAtk(m.card.uid);
    const def = this.engine.getEffectiveDef(m.card.uid);
    return `${d.name.slice(0, 18)}\n${atk}/${def}\n${m.faceDown ? 'SET ' : ''}${m.position === 'attack' ? 'ATK' : 'DEF'}`;
  }

  private monsterRow(p: PlayerId, y: number) {
    const out: Phaser.GameObjects.GameObject[] = [];
    this.engine.state.players[p].monsters.forEach((m, i) => {
      const x = 4 + i * 63;
      if (!m) { out.push(...this.cardBox(x, y, 60, 30, '', null, 0x241c33)); return; }
      out.push(...this.cardBox(x, y, 60, 30, this.monsterText(m, p), m.card.uid, m.position === 'attack' ? 0x5a2f2f : 0x2f3f5a));
    });
    return out;
  }

  private spellText(st: SpellTrapSlot, owner: PlayerId): string {
    if (st.faceDown && owner !== HUMAN) return '(set)';
    const d = getCard(st.card.defId);
    return `${st.faceDown ? 'SET: ' : ''}${d.name.slice(0, 16)}`;
  }

  private spellRow(p: PlayerId, y: number) {
    const out: Phaser.GameObjects.GameObject[] = [];
    this.engine.state.players[p].spellTraps.forEach((st, i) => {
      const x = 4 + i * 63;
      if (!st) { out.push(...this.cardBox(x, y, 60, 18, '', null, 0x1e1a2a)); return; }
      out.push(...this.cardBox(x, y, 60, 18, this.spellText(st, p), st.card.uid, 0x2f5a3f));
    });
    return out;
  }

  private handRow(y: number) {
    const out: Phaser.GameObjects.GameObject[] = [];
    const hand = this.engine.state.players[HUMAN].hand;
    const w = Math.min(52, Math.floor(314 / Math.max(1, hand.length)) - 2);
    hand.forEach((c: CardInstance, i) => {
      const d = getCard(c.defId);
      const stats = d.kind === 'monster' ? `\nL${d.level} ${d.atk}/${d.def}` : `\n${d.kind}${d.speed ? ` (${d.speed})` : ''}`;
      const color = d.kind === 'monster' ? 0x6b4a2a : d.kind === 'spell' ? 0x2a6b5a : 0x6b2a5a;
      out.push(...this.cardBox(4 + i * (w + 2), y, w, 44, `${d.name}${stats}`, c.uid, color));
    });
    return out;
  }

  private actionPanel(x: number, y: number) {
    const out: Phaser.GameObjects.GameObject[] = [];
    const e = this.engine;
    const myTurn = e.state.activePlayer === HUMAN && !this.busy && e.state.winner === null;
    const acts = myTurn ? e.legalActions(HUMAN) : [];
    out.push(label(this, x, y, myTurn ? 'Select a card:' : 'Opponent / arena...', { color: '#9b8fb0' }));
    const sel = this.selected;
    const related = sel === null ? [] : acts.filter((a) => involves(a, sel));
    let yy = y + 12;
    for (const a of related.slice(0, 9)) {
      out.push(button(this, x, yy, describeAction(e.state, a).slice(0, 34), () => this.act(a)));
      yy += 15;
    }
    const battle = acts.find((a) => a.type === 'enterBattle');
    const end = acts.find((a) => a.type === 'endTurn');
    if (battle) out.push(button(this, x, 172, 'Battle', () => this.act(battle)));
    if (end) out.push(button(this, x + 50, 172, 'End Turn', () => this.act(end)));
    return out;
  }
}

function involves(a: DuelAction, uid: number): boolean {
  switch (a.type) {
    case 'normalSummon': case 'activateSpell': case 'setSpellTrap': return a.handUid === uid;
    case 'activateSet': case 'changePosition': return a.uid === uid;
    case 'declareAttack': return a.attackerUid === uid;
    default: return false;
  }
}
