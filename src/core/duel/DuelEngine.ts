// The duel state machine. Pure TS, no Phaser.
//
// Flow: Draw (auto) -> Main -> Battle -> End. Monster-vs-monster attacks pause
// the engine with `pendingArena`; the UI runs the arena fight and then calls
// `resolveArena(result)`. Direct attacks resolve immediately.
import type {
  ArenaRequest, ArenaResult, CardDef, CardInstance, DuelAction, DuelEvent, DuelState,
  MonsterSlot, Phase, PlayerId, PlayerState, Position,
} from '../types';
import { getCard } from '../cards/CardDB';
import {
  getEffect, type AttackInfo, type EffectContext, type EffectHandler, type EffectOps,
  type EffectTrigger, type SummonInfo,
} from '../cards/EffectRegistry';
import '../cards/effects/index';
import { resolveBattle as defaultResolveBattle } from '../combat/Formulas';
import { Rng } from '../rng';
import {
  RULES, combinations, countOccupied, findInHand, findMonster, findSpellTrap, freeZone, other,
  staysOnField, tributesRequired,
} from './Rules';

export type ResolveBattleFn = (
  attackerAtk: number,
  defender: { atk: number; def: number; position: 'attack' | 'defense' },
  arena: ArenaResult,
) => { attackerDestroyed: boolean; defenderDestroyed: boolean; lpDamage: [number, number] };

export interface TrapPrompt {
  player: PlayerId;
  trapUid: number;
  trigger: EffectTrigger;
  attack?: AttackInfo;
  summon?: SummonInfo;
}

export interface DuelEngineOptions {
  deck0: string[];
  deck1: string[];
  seed: number;
  /** Who takes turn 1 (default 0). */
  firstPlayer?: PlayerId;
  startingLp?: number;
  /** Shuffle decks at start (default true). Tests may disable to stack the deck (top = last element). */
  shuffle?: boolean;
  /**
   * Decide whether a Set trap with a triggered hook (attackDeclared/summon) is activated
   * when its condition is met. Default: always activate. Must be synchronous.
   */
  trapPolicy?: (prompt: TrapPrompt) => boolean;
  /** Override for battle resolution (defaults to core/combat/Formulas.resolveBattle). */
  resolveBattle?: ResolveBattleFn;
  /** Internal: restore from a snapshot instead of starting a new duel (see clone()). */
  restore?: { state: DuelState; pendingArena: ArenaRequest | null };
}

export type DuelListener = (ev: DuelEvent) => void;

export class DuelEngine {
  state: DuelState;
  pendingArena: ArenaRequest | null = null;
  /** Events produced while constructing the duel (opening hands, first phase). */
  readonly initialEvents: DuelEvent[];

  private readonly opts: DuelEngineOptions;
  private readonly listeners = new Set<DuelListener>();
  private buf: DuelEvent[] | null = null;
  private attackNegated = false;
  private readonly ops: EffectOps;

  constructor(opts: DuelEngineOptions) {
    this.opts = opts;
    this.ops = this.makeOps();
    if (opts.restore) {
      this.state = structuredClone(opts.restore.state);
      this.pendingArena = opts.restore.pendingArena ? structuredClone(opts.restore.pendingArena) : null;
      this.initialEvents = [];
      return;
    }
    const lp = opts.startingLp ?? RULES.startingLp;
    const first = opts.firstPlayer ?? 0;
    this.state = {
      seed: opts.seed,
      turn: 1,
      activePlayer: first,
      phase: 'draw',
      players: [this.emptyPlayer(0, lp), this.emptyPlayer(1, lp)],
      winner: null,
      log: [],
      nextUid: 1,
      rngState: opts.seed >>> 0,
    };
    this.initialEvents = this.run(() => {
      ([0, 1] as PlayerId[]).forEach((p) => {
        const ids = p === 0 ? opts.deck0 : opts.deck1;
        const deck = ids.map((id) => {
          getCard(id); // validate early
          return { uid: this.state.nextUid++, defId: id, owner: p } as CardInstance;
        });
        if (opts.shuffle !== false) this.withRng((r) => r.shuffle(deck));
        this.state.players[p].deck = deck;
      });
      for (const p of [first, other(first)]) {
        for (let i = 0; i < RULES.openingHand; i++) this.drawOne(p);
      }
      this.log(`Duel start. Player ${first} goes first.`);
      // Turn 1: the first player skips the draw.
      this.setPhase('main');
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Subscribe to every emitted event. Returns an unsubscribe function. */
  on(fn: DuelListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Deep copy of the current state (for AI lookahead / UI snapshots). */
  cloneState(): DuelState {
    return structuredClone(this.state);
  }

  /** Independent engine with the same state (no listeners). Useful for AI search. */
  clone(): DuelEngine {
    return new DuelEngine({
      ...this.opts,
      restore: { state: this.state, pendingArena: this.pendingArena },
    });
  }

  get isOver(): boolean {
    return this.state.winner !== null;
  }

  getDef(uid: number): CardDef | null {
    const c = this.findCard(uid);
    return c ? getCard(c.defId) : null;
  }

  getEffectiveAtk(uid: number): number {
    return this.effectiveStat(uid, 'atk');
  }

  getEffectiveDef(uid: number): number {
    return this.effectiveStat(uid, 'def');
  }

  /** Every legal action for `player` right now (empty if not their turn / arena pending / game over). */
  legalActions(player: PlayerId): DuelAction[] {
    const s = this.state;
    if (s.winner !== null || this.pendingArena || player !== s.activePlayer) return [];
    const me = s.players[player];
    const out: DuelAction[] = [];
    const phase = s.phase;

    if (phase === 'main') {
      // Normal Summon / Set (incl. every tribute combination)
      if (!me.normalSummonUsed) {
        const myMonsters = me.monsters.filter((m): m is MonsterSlot => !!m).map((m) => m.card.uid);
        for (const c of me.hand) {
          const def = getCard(c.defId);
          if (def.kind !== 'monster') continue;
          const k = tributesRequired(def.level);
          for (const combo of combinations(myMonsters, k)) {
            if (myMonsters.length - k >= RULES.zones) continue;
            out.push({ type: 'normalSummon', handUid: c.uid, position: 'attack', faceDown: false, tributeUids: combo });
            out.push({ type: 'normalSummon', handUid: c.uid, position: 'defense', faceDown: true, tributeUids: combo });
          }
        }
      }
      // Set spell/trap
      if (freeZone(me.spellTraps) >= 0) {
        for (const c of me.hand) {
          const def = getCard(c.defId);
          if (def.kind === 'spell' || def.kind === 'trap') out.push({ type: 'setSpellTrap', handUid: c.uid });
        }
      }
      // Change position
      for (const m of me.monsters) {
        if (m && !m.summonedThisTurn && !m.changedPositionThisTurn && !m.attackedThisTurn) {
          out.push({ type: 'changePosition', uid: m.card.uid });
        }
      }
      if (s.turn > 1) out.push({ type: 'enterBattle' });
    }

    if (phase === 'main' || phase === 'battle') {
      // Activate spell from hand
      for (const c of me.hand) {
        const def = getCard(c.defId);
        if (def.kind !== 'spell' || !this.spellSpeedOk(def, phase)) continue;
        if (staysOnField(def) && def.speed !== 'field' && freeZone(me.spellTraps) < 0) continue;
        if (def.speed === 'field' && freeZone(me.spellTraps) < 0 && !this.fieldSpellZone(player)) continue;
        for (const t of this.activationTargets(c, player)) {
          out.push(t === undefined ? { type: 'activateSpell', handUid: c.uid } : { type: 'activateSpell', handUid: c.uid, targetUid: t });
        }
      }
      // Activate Set card
      for (const st of me.spellTraps) {
        if (!st || !st.faceDown) continue;
        const def = getCard(st.card.defId);
        if (!this.setActivatable(def, st.setThisTurn, phase)) continue;
        for (const t of this.activationTargets(st.card, player)) {
          out.push(t === undefined ? { type: 'activateSet', uid: st.card.uid } : { type: 'activateSet', uid: st.card.uid, targetUid: t });
        }
      }
    }

    if (phase === 'battle') {
      const opp = s.players[other(player)];
      const targets = opp.monsters.filter((m): m is MonsterSlot => !!m).map((m) => m.card.uid);
      for (const m of me.monsters) {
        if (!m || m.position !== 'attack' || m.faceDown || m.attackedThisTurn) continue;
        if (targets.length === 0) out.push({ type: 'declareAttack', attackerUid: m.card.uid, targetUid: null });
        for (const t of targets) out.push({ type: 'declareAttack', attackerUid: m.card.uid, targetUid: t });
      }
    }

    out.push({ type: 'endTurn' });
    return out;
  }

  /** Validate and apply an action. Throws on illegal actions. */
  apply(action: DuelAction): DuelEvent[] {
    const s = this.state;
    if (s.winner !== null) throw new Error('Duel is over');
    if (this.pendingArena) throw new Error('Arena fight pending: call resolveArena() first');
    const player = s.activePlayer;
    return this.run(() => {
      switch (action.type) {
        case 'normalSummon': return this.doNormalSummon(player, action);
        case 'activateSpell': return this.doActivateSpell(player, action.handUid, action.targetUid);
        case 'setSpellTrap': return this.doSetSpellTrap(player, action.handUid);
        case 'activateSet': return this.doActivateSet(player, action.uid, action.targetUid);
        case 'changePosition': return this.doChangePosition(player, action.uid);
        case 'enterBattle': return this.doEnterBattle();
        case 'declareAttack': return this.doDeclareAttack(player, action.attackerUid, action.targetUid);
        case 'endTurn': return this.doEndTurn(player, action.discardUids);
        default: throw new Error(`Unknown action ${(action as { type: string }).type}`);
      }
    });
  }

  /** Apply the outcome of the arena fight requested by `pendingArena`. */
  resolveArena(result: ArenaResult): DuelEvent[] {
    const req = this.pendingArena;
    if (!req) throw new Error('No arena fight pending');
    return this.run(() => {
      this.pendingArena = null;
      // Spells consumed during the arena go to the graveyard.
      ([0, 1] as PlayerId[]).forEach((p) => {
        for (const uid of result.spellsUsed[p] ?? []) {
          const c = findInHand(this.state, p, uid);
          if (c) this.moveHandToGY(p, c);
        }
      });
      const atkLoc = findMonster(this.state, req.attacker.uid);
      const defLoc = findMonster(this.state, req.defender.uid);
      const resolve = this.opts.resolveBattle ?? defaultResolveBattle;
      const r = resolve(
        req.attacker.atk,
        { atk: req.defender.atk, def: req.defender.defStat, position: req.defender.position },
        result,
      );
      this.log(`Arena: ${result.winner} wins (${req.attacker.def.name} vs ${req.defender.def.name}).`);
      if (r.attackerDestroyed && atkLoc) this.destroyMonster(req.attacker.uid, 'battle');
      if (r.defenderDestroyed && defLoc) this.destroyMonster(req.defender.uid, 'battle');
      if (r.lpDamage[0] > 0) this.changeLp(req.attacker.player, -Math.round(r.lpDamage[0]));
      if (r.lpDamage[1] > 0) this.changeLp(req.defender.player, -Math.round(r.lpDamage[1]));
      this.emit({
        type: 'arenaResolved', result,
        attackerDestroyed: r.attackerDestroyed, defenderDestroyed: r.defenderDestroyed,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  private doNormalSummon(player: PlayerId, a: Extract<DuelAction, { type: 'normalSummon' }>): void {
    const s = this.state;
    const me = s.players[player];
    this.requirePhase('main');
    if (me.normalSummonUsed) throw new Error('Normal Summon already used this turn');
    const card = findInHand(s, player, a.handUid);
    if (!card) throw new Error('Card not in hand');
    const def = getCard(card.defId);
    if (def.kind !== 'monster') throw new Error('Not a monster');
    if (a.faceDown ? a.position !== 'defense' : a.position !== 'attack') {
      throw new Error('Normal Summon must be face-up Attack, or Set face-down Defense');
    }
    const need = tributesRequired(def.level);
    const tributes = [...new Set(a.tributeUids)];
    if (tributes.length !== need || a.tributeUids.length !== need) {
      throw new Error(`Level ${def.level} needs exactly ${need} tribute(s)`);
    }
    for (const uid of tributes) {
      const loc = findMonster(s, uid);
      if (!loc || loc.player !== player) throw new Error('Invalid tribute');
    }
    if (countOccupied(me.monsters) - need >= RULES.zones) throw new Error('No free monster zone');

    for (const uid of tributes) this.sendMonsterToGY(uid);
    me.hand = me.hand.filter((c) => c.uid !== card.uid);
    const zone = freeZone(me.monsters);
    me.monsters[zone] = this.newSlot(card, a.position, a.faceDown);
    me.normalSummonUsed = true;
    this.emit({ type: 'summon', player, uid: card.uid });
    this.log(a.faceDown ? `P${player} sets a monster.` : `P${player} summons ${def.name}${need ? ` (tributing ${need})` : ''}.`);
    this.afterSummon(player, card.uid, a.faceDown);
  }

  private doActivateSpell(player: PlayerId, handUid: number, targetUid?: number): void {
    const s = this.state;
    const me = s.players[player];
    const card = findInHand(s, player, handUid);
    if (!card) throw new Error('Card not in hand');
    const def = getCard(card.defId);
    if (def.kind !== 'spell') throw new Error('Only spells can be activated from hand');
    if (!this.spellSpeedOk(def, s.phase)) throw new Error(`Cannot activate a ${def.speed} spell in ${s.phase} phase`);
    this.validateActivation(card, player, targetUid);
    const oldField = def.speed === 'field' ? this.fieldSpellZone(player) : null;
    if (staysOnField(def) && freeZone(me.spellTraps) < 0 && !oldField) throw new Error('No free spell/trap zone');

    me.hand = me.hand.filter((c) => c.uid !== card.uid);
    if (staysOnField(def)) {
      // Only one face-up Field Spell per player: the old one is replaced.
      if (oldField) this.destroySpellTrap(oldField.card.uid);
      const zone = freeZone(me.spellTraps);
      me.spellTraps[zone] = {
        card, faceDown: false, setThisTurn: false,
        ...(def.speed === 'equip' && targetUid !== undefined ? { equippedTo: targetUid } : {}),
      };
    }
    this.resolveActivation(card, player, targetUid, staysOnField(def) ? 'field' : 'hand');
  }

  private doSetSpellTrap(player: PlayerId, handUid: number): void {
    const me = this.state.players[player];
    this.requirePhase('main');
    const card = findInHand(this.state, player, handUid);
    if (!card) throw new Error('Card not in hand');
    const def = getCard(card.defId);
    if (def.kind !== 'spell' && def.kind !== 'trap') throw new Error('Only spells/traps can be Set');
    const zone = freeZone(me.spellTraps);
    if (zone < 0) throw new Error('No free spell/trap zone');
    me.hand = me.hand.filter((c) => c.uid !== card.uid);
    me.spellTraps[zone] = { card, faceDown: true, setThisTurn: true };
    this.emit({ type: 'set', player, uid: card.uid });
    this.log(`P${player} sets a card.`);
  }

  private doActivateSet(player: PlayerId, uid: number, targetUid?: number): void {
    const loc = findSpellTrap(this.state, uid);
    if (!loc || loc.player !== player) throw new Error('Not your Set card');
    if (!loc.slot.faceDown) throw new Error('Card is already face-up');
    const def = getCard(loc.slot.card.defId);
    if (!this.setActivatable(def, loc.slot.setThisTurn, this.state.phase)) {
      throw new Error('This Set card cannot be activated now');
    }
    this.validateActivation(loc.slot.card, player, targetUid);
    loc.slot.faceDown = false;
    if (def.speed === 'equip' && targetUid !== undefined) loc.slot.equippedTo = targetUid;
    this.resolveActivation(loc.slot.card, player, targetUid, 'field');
  }

  private doChangePosition(player: PlayerId, uid: number): void {
    this.requirePhase('main');
    const loc = findMonster(this.state, uid);
    if (!loc || loc.player !== player) throw new Error('Not your monster');
    const m = loc.slot;
    if (m.summonedThisTurn) throw new Error('Cannot change position the turn it was summoned');
    if (m.changedPositionThisTurn) throw new Error('Position already changed this turn');
    if (m.attackedThisTurn) throw new Error('Cannot change position after attacking');
    const wasFaceDown = m.faceDown;
    if (m.faceDown) {
      m.faceDown = false;
      m.position = 'attack'; // flip summon
    } else {
      m.position = m.position === 'attack' ? 'defense' : 'attack';
    }
    m.changedPositionThisTurn = true;
    this.emit({ type: 'position', player, uid, position: m.position, faceDown: m.faceDown });
    this.log(`P${player} ${wasFaceDown ? 'flip summons' : 'changes position of'} ${getCard(m.card.defId).name}.`);
    if (wasFaceDown) this.triggerSelfSummon(player, uid);
  }

  private doEnterBattle(): void {
    this.requirePhase('main');
    if (this.state.turn === 1) throw new Error('No Battle Phase on the first turn');
    this.setPhase('battle');
  }

  private doDeclareAttack(player: PlayerId, attackerUid: number, targetUid: number | null): void {
    const s = this.state;
    this.requirePhase('battle');
    if (s.turn === 1) throw new Error('Cannot attack on the first turn');
    const aLoc = findMonster(s, attackerUid);
    if (!aLoc || aLoc.player !== player) throw new Error('Not your monster');
    const att = aLoc.slot;
    if (att.position !== 'attack' || att.faceDown) throw new Error('Only Attack Position monsters can attack');
    if (att.attackedThisTurn) throw new Error('This monster already attacked');
    const opp = other(player);
    const oppHasMonsters = countOccupied(s.players[opp].monsters) > 0;
    if (targetUid === null) {
      if (oppHasMonsters) throw new Error('Cannot attack directly while the opponent controls monsters');
    } else {
      const tLoc = findMonster(s, targetUid);
      if (!tLoc || tLoc.player !== opp) throw new Error('Invalid attack target');
    }

    att.attackedThisTurn = true;
    const attDef = getCard(att.card.defId);
    this.emit({ type: 'attack', player, attackerUid, targetUid });
    this.log(targetUid === null
      ? `${attDef.name} attacks directly!`
      : `${attDef.name} attacks ${this.describeMonster(targetUid)}.`);

    // Trap window (no chains: first trap that triggers and is accepted resolves).
    const attack: AttackInfo = { attackerUid, attackerPlayer: player, targetUid };
    this.attackNegated = false;
    this.checkTraps(opp, 'attackDeclared', { attack });
    const negated = this.attackNegated;
    this.attackNegated = false;
    if (negated || s.winner !== null) {
      this.emit({ type: 'attackNegated', player, attackerUid });
      this.log('The attack was stopped.');
      return;
    }
    if (!findMonster(s, attackerUid)) return; // attacker removed

    if (targetUid === null) {
      this.changeLp(opp, -this.getEffectiveAtk(attackerUid));
      return;
    }
    const tLoc = findMonster(s, targetUid);
    if (!tLoc) { this.log('The attack target is gone.'); return; }
    if (tLoc.slot.faceDown) {
      tLoc.slot.faceDown = false; // flipped by the attack, stays in Defense
      this.emit({ type: 'position', player: opp, uid: targetUid, position: tLoc.slot.position, faceDown: false });
      this.log(`${getCard(tLoc.slot.card.defId).name} is flipped face-up.`);
      this.triggerSelfSummon(opp, targetUid);
      if (!findMonster(s, targetUid) || !findMonster(s, attackerUid) || s.winner !== null) return;
    }

    const tSlot = findMonster(s, targetUid)!.slot;
    const usable = (p: PlayerId) =>
      s.players[p].hand.filter((c) => { const d = getCard(c.defId); return d.kind === 'spell' && !!d.arenaUsable; })
        .map((c) => ({ ...c }));
    const req: ArenaRequest = {
      attacker: {
        player, uid: attackerUid, def: attDef,
        atk: this.getEffectiveAtk(attackerUid), defStat: this.getEffectiveDef(attackerUid),
      },
      defender: {
        player: opp, uid: targetUid, def: getCard(tSlot.card.defId),
        atk: this.getEffectiveAtk(targetUid), defStat: this.getEffectiveDef(targetUid), position: tSlot.position,
      },
      usableSpells: [usable(0), usable(1)],
      seed: this.withRng((r) => r.int(0, 0x7fffffff)),
    };
    this.pendingArena = req;
    this.emit({ type: 'arena', request: req });
  }

  private doEndTurn(player: PlayerId, discardUids?: number[]): void {
    const s = this.state;
    if (s.phase !== 'main' && s.phase !== 'battle') throw new Error(`Cannot end turn in ${s.phase} phase`);
    const me = s.players[player];
    // Validate discards before mutating
    const excess = Math.max(0, me.hand.length - RULES.handLimit);
    const chosen = [...new Set(discardUids ?? [])];
    if (chosen.length > excess) throw new Error(`Only ${excess} card(s) must be discarded`);
    for (const uid of chosen) if (!findInHand(s, player, uid)) throw new Error('Discard card not in hand');

    this.setPhase('end');
    for (const uid of chosen) this.moveHandToGY(player, findInHand(s, player, uid)!);
    while (me.hand.length > RULES.handLimit) this.moveHandToGY(player, me.hand[me.hand.length - 1]);

    // Reset per-turn flags.
    for (const p of s.players) {
      for (const m of p.monsters) {
        if (m) { m.summonedThisTurn = false; m.attackedThisTurn = false; m.changedPositionThisTurn = false; }
      }
      for (const st of p.spellTraps) if (st) st.setThisTurn = false;
      p.normalSummonUsed = false;
    }
    // Next turn
    s.turn += 1;
    s.activePlayer = other(player);
    this.log(`--- Turn ${s.turn}: P${s.activePlayer} ---`);
    this.setPhase('draw');
    this.drawOne(s.activePlayer);
    if (s.winner === null) this.setPhase('main');
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  private makeCtx(
    source: CardInstance, player: PlayerId, trigger: EffectTrigger,
    extra: { targetUid?: number; attack?: AttackInfo; summon?: SummonInfo } = {},
  ): EffectContext {
    const sourceDef = getCard(source.defId);
    return {
      state: this.state,
      player,
      opponent: other(player),
      source,
      sourceDef,
      params: sourceDef.effect?.params ?? {},
      trigger,
      ops: this.ops,
      ...extra,
    };
  }

  /** Targets for activation: [undefined] if untargeted, [] if not activatable. */
  private activationTargets(card: CardInstance, player: PlayerId): (number | undefined)[] {
    const def = getCard(card.defId);
    const h = getEffect(def.effect?.id);
    if (!h) return [];
    if (!h.onActivate && !h.statMod) return [];
    const ctx = this.makeCtx(card, player, 'activate');
    if (h.getTargets) {
      return h.getTargets(ctx).filter((t) => this.canActivate(h, { ...ctx, targetUid: t }));
    }
    return this.canActivate(h, ctx) ? [undefined] : [];
  }

  private canActivate(h: EffectHandler, ctx: EffectContext): boolean {
    return h.canActivate ? h.canActivate(ctx) : true;
  }

  private validateActivation(card: CardInstance, player: PlayerId, targetUid?: number): void {
    const targets = this.activationTargets(card, player);
    if (targets.length === 0) throw new Error(`${getCard(card.defId).name} cannot be activated now`);
    if (targets[0] === undefined) {
      if (targetUid !== undefined) throw new Error('This card does not take a target');
    } else if (targetUid === undefined || !targets.includes(targetUid)) {
      throw new Error('Invalid or missing target');
    }
  }

  private resolveActivation(card: CardInstance, player: PlayerId, targetUid: number | undefined, from: 'hand' | 'field'): void {
    const def = getCard(card.defId);
    this.emit({ type: 'activate', player, uid: card.uid, defId: def.id });
    this.log(`P${player} activates ${def.name}.`);
    const h = getEffect(def.effect?.id);
    h?.onActivate?.(this.makeCtx(card, player, 'activate', { targetUid }));
    this.afterResolve(card, player, from);
  }

  /** Non-persistent spells/traps go to the graveyard after resolving. */
  private afterResolve(card: CardInstance, player: PlayerId, from: 'hand' | 'field'): void {
    const def = getCard(card.defId);
    if (staysOnField(def)) return;
    if (from === 'field') {
      const loc = findSpellTrap(this.state, card.uid);
      if (loc) {
        this.state.players[loc.player].spellTraps[loc.zone] = null;
        this.state.players[card.owner].graveyard.push(card);
        this.emit({ type: 'toGraveyard', player: loc.player, uid: card.uid, from: 'field' });
      }
    } else {
      this.state.players[card.owner].graveyard.push(card);
      this.emit({ type: 'toGraveyard', player, uid: card.uid, from: 'hand' });
    }
  }

  /** Check `player`'s Set traps for a triggered hook; activates at most one. */
  private checkTraps(player: PlayerId, trigger: 'attackDeclared' | 'summon', extra: { attack?: AttackInfo; summon?: SummonInfo }): void {
    const me = this.state.players[player];
    for (const st of [...me.spellTraps]) {
      if (!st || !st.faceDown || st.setThisTurn) continue;
      const def = getCard(st.card.defId);
      if (def.kind !== 'trap') continue;
      const h = getEffect(def.effect?.id);
      const hook = trigger === 'attackDeclared' ? h?.onAttackDeclared : h?.onSummon;
      if (!h || !hook) continue;
      const ctx = this.makeCtx(st.card, player, trigger, extra);
      if (!this.canActivate(h, ctx)) continue;
      const policy = this.opts.trapPolicy;
      if (policy && !policy({ player, trapUid: st.card.uid, trigger, ...extra })) continue;
      st.faceDown = false;
      this.emit({ type: 'activate', player, uid: st.card.uid, defId: def.id });
      this.log(`P${player} activates ${def.name}!`);
      hook.call(h, ctx);
      this.afterResolve(st.card, player, 'field');
      return;
    }
  }

  private afterSummon(player: PlayerId, uid: number, faceDown: boolean): void {
    this.checkTraps(other(player), 'summon', { summon: { uid, player, faceDown } });
    if (!faceDown && findMonster(this.state, uid)) this.triggerSelfSummon(player, uid);
  }

  private triggerSelfSummon(player: PlayerId, uid: number): void {
    const loc = findMonster(this.state, uid);
    if (!loc || this.state.winner !== null) return;
    const def = getCard(loc.slot.card.defId);
    const h = getEffect(def.effect?.id);
    if (!h?.onSelfSummon) return;
    const ctx = this.makeCtx(loc.slot.card, player, 'selfSummon');
    if (this.canActivate(h, ctx)) h.onSelfSummon(ctx);
  }

  private makeOps(): EffectOps {
    return {
      draw: (p, n) => { for (let i = 0; i < n && this.state.winner === null; i++) this.drawOne(p); },
      damage: (p, n) => { if (n > 0) this.changeLp(p, -Math.round(n)); },
      heal: (p, n) => { if (n > 0) this.changeLp(p, Math.round(n)); },
      destroy: (uid) => {
        if (findMonster(this.state, uid)) { this.destroyMonster(uid, 'effect'); return true; }
        if (findSpellTrap(this.state, uid)) { this.destroySpellTrap(uid); return true; }
        return false;
      },
      modifyAtk: (uid, d) => { const l = findMonster(this.state, uid); if (l) l.slot.atkMod += d; },
      modifyDef: (uid, d) => { const l = findMonster(this.state, uid); if (l) l.slot.defMod += d; },
      specialSummonFromGY: (p, uid, pos) => this.specialSummon(p, uid, 'graveyard', pos ?? 'attack'),
      specialSummonFromHand: (p, uid, pos) => this.specialSummon(p, uid, 'hand', pos ?? 'attack'),
      negateAttack: () => { this.attackNegated = true; },
      log: (t) => this.log(t),
      random: () => this.withRng((r) => r.next()),
      findMonster: (uid) => findMonster(this.state, uid),
      getEffectiveAtk: (uid) => this.getEffectiveAtk(uid),
      getEffectiveDef: (uid) => this.getEffectiveDef(uid),
      cardDef: (uid) => this.getDef(uid),
    };
  }

  private specialSummon(p: PlayerId, uid: number, from: 'graveyard' | 'hand', position: Position): boolean {
    const me = this.state.players[p];
    const list = from === 'graveyard' ? me.graveyard : me.hand;
    const idx = list.findIndex((c) => c.uid === uid);
    if (idx < 0) return false;
    const card = list[idx];
    if (getCard(card.defId).kind !== 'monster') return false;
    const zone = freeZone(me.monsters);
    if (zone < 0) return false;
    list.splice(idx, 1);
    me.monsters[zone] = this.newSlot(card, position, false);
    this.emit({ type: 'summon', player: p, uid });
    this.log(`P${p} Special Summons ${getCard(card.defId).name}.`);
    this.triggerSelfSummon(p, uid);
    return true;
  }

  // -------------------------------------------------------------------------
  // Low-level state ops
  // -------------------------------------------------------------------------

  private effectiveStat(uid: number, stat: 'atk' | 'def'): number {
    const loc = findMonster(this.state, uid);
    if (!loc) {
      const def = this.getDef(uid);
      return def?.[stat] ?? 0;
    }
    const def = getCard(loc.slot.card.defId);
    let v = (def[stat] ?? 0) + (stat === 'atk' ? loc.slot.atkMod : loc.slot.defMod);
    for (const p of this.state.players) {
      for (const st of p.spellTraps) {
        if (!st || st.faceDown) continue;
        const h = getEffect(getCard(st.card.defId).effect?.id);
        if (!h?.statMod) continue;
        const mod = h.statMod(this.makeCtx(st.card, p.id, 'activate'), {
          uid, controller: loc.player, slot: loc.slot, def,
        });
        if (mod) v += mod[stat] ?? 0;
      }
    }
    return Math.max(0, v);
  }

  private drawOne(p: PlayerId): void {
    const me = this.state.players[p];
    const card = me.deck.pop();
    if (!card) {
      this.log(`P${p} cannot draw: deck is empty!`);
      this.setWinner(other(p));
      return;
    }
    me.hand.push(card);
    this.emit({ type: 'draw', player: p, uid: card.uid });
  }

  private changeLp(p: PlayerId, delta: number): void {
    if (delta === 0) return;
    const me = this.state.players[p];
    me.lp = Math.max(0, me.lp + delta);
    this.emit({ type: 'lp', player: p, delta, lp: me.lp });
    this.log(delta < 0 ? `P${p} takes ${-delta} damage (LP ${me.lp}).` : `P${p} gains ${delta} LP (LP ${me.lp}).`);
    this.checkLpWin();
  }

  private checkLpWin(): void {
    if (this.state.winner !== null) return;
    const [a, b] = this.state.players;
    if (a.lp <= 0 && b.lp <= 0) this.setWinner('draw');
    else if (a.lp <= 0) this.setWinner(1);
    else if (b.lp <= 0) this.setWinner(0);
  }

  private setWinner(w: PlayerId | 'draw'): void {
    if (this.state.winner !== null) return;
    this.state.winner = w;
    this.pendingArena = null;
    this.log(w === 'draw' ? 'The duel is a draw.' : `Player ${w} wins the duel!`);
    this.emit({ type: 'gameOver', winner: w });
  }

  /** Remove a monster from the field to its owner's GY (+ attached equips). */
  private sendMonsterToGY(uid: number): void {
    const loc = findMonster(this.state, uid);
    if (!loc) return;
    this.state.players[loc.player].monsters[loc.zone] = null;
    this.state.players[loc.slot.card.owner].graveyard.push(loc.slot.card);
    this.emit({ type: 'toGraveyard', player: loc.player, uid, from: 'field' });
    this.detachEquips(uid);
  }

  private destroyMonster(uid: number, reason: 'battle' | 'effect'): void {
    const loc = findMonster(this.state, uid);
    if (!loc) return;
    this.state.players[loc.player].monsters[loc.zone] = null;
    this.state.players[loc.slot.card.owner].graveyard.push(loc.slot.card);
    this.emit({ type: 'destroy', player: loc.player, uid, reason });
    this.log(`${getCard(loc.slot.card.defId).name} is destroyed.`);
    this.detachEquips(uid);
  }

  private detachEquips(monsterUid: number): void {
    for (const p of this.state.players) {
      for (const st of p.spellTraps) {
        if (st && st.equippedTo === monsterUid) this.destroySpellTrap(st.card.uid);
      }
    }
  }

  private destroySpellTrap(uid: number): void {
    const loc = findSpellTrap(this.state, uid);
    if (!loc) return;
    this.state.players[loc.player].spellTraps[loc.zone] = null;
    this.state.players[loc.slot.card.owner].graveyard.push(loc.slot.card);
    this.emit({ type: 'destroy', player: loc.player, uid, reason: 'effect' });
    this.log(`${getCard(loc.slot.card.defId).name} is destroyed.`);
  }

  private moveHandToGY(p: PlayerId, card: CardInstance): void {
    const me = this.state.players[p];
    me.hand = me.hand.filter((c) => c.uid !== card.uid);
    this.state.players[card.owner].graveyard.push(card);
    this.emit({ type: 'toGraveyard', player: p, uid: card.uid, from: 'hand' });
  }

  private newSlot(card: CardInstance, position: Position, faceDown: boolean): MonsterSlot {
    return {
      card, position, faceDown,
      summonedThisTurn: true, attackedThisTurn: false, changedPositionThisTurn: false,
      atkMod: 0, defMod: 0,
    };
  }

  private emptyPlayer(id: PlayerId, lp: number): PlayerState {
    return {
      id, lp, deck: [], hand: [], graveyard: [],
      monsters: [null, null, null, null, null],
      spellTraps: [null, null, null, null, null],
      normalSummonUsed: false,
    };
  }

  private spellSpeedOk(def: CardDef, phase: Phase): boolean {
    if (phase === 'main') return true;
    if (phase === 'battle') return def.speed === 'quick';
    return false;
  }

  private setActivatable(def: CardDef, setThisTurn: boolean, phase: Phase): boolean {
    const h = getEffect(def.effect?.id);
    if (!h || (!h.onActivate && !h.statMod)) return false;
    if (def.kind === 'trap') return !setThisTurn && (phase === 'main' || phase === 'battle');
    if (def.speed === 'quick') return !setThisTurn && (phase === 'main' || phase === 'battle');
    return phase === 'main';
  }

  private fieldSpellZone(p: PlayerId) {
    return this.state.players[p].spellTraps.find(
      (st) => st && !st.faceDown && getCard(st.card.defId).speed === 'field',
    ) ?? null;
  }

  private requirePhase(phase: Phase): void {
    if (this.state.phase !== phase) throw new Error(`Only allowed in ${phase} phase (now ${this.state.phase})`);
  }

  private setPhase(phase: Phase): void {
    this.state.phase = phase;
    this.emit({ type: 'phase', phase, player: this.state.activePlayer });
  }

  private describeMonster(uid: number): string {
    const loc = findMonster(this.state, uid);
    if (!loc) return '?';
    return loc.slot.faceDown ? 'a face-down monster' : getCard(loc.slot.card.defId).name;
  }

  private findCard(uid: number): CardInstance | null {
    for (const p of this.state.players) {
      for (const list of [p.hand, p.deck, p.graveyard]) {
        const c = list.find((x) => x.uid === uid);
        if (c) return c;
      }
      for (const s of p.monsters) if (s?.card.uid === uid) return s.card;
      for (const s of p.spellTraps) if (s?.card.uid === uid) return s.card;
    }
    return null;
  }

  private withRng<T>(fn: (r: Rng) => T): T {
    const r = new Rng(this.state.rngState ?? this.state.seed);
    const v = fn(r);
    this.state.rngState = r.getState();
    return v;
  }

  private log(text: string): void {
    this.state.log.push(text);
    if (this.state.log.length > 200) this.state.log.splice(0, this.state.log.length - 200);
    this.emit({ type: 'log', text });
  }

  private emit(ev: DuelEvent): void {
    if (this.buf) this.buf.push(ev);
    else this.flush([ev]);
  }

  /** Run a mutation, collecting events; flush to listeners at the end. */
  private run(fn: () => void): DuelEvent[] {
    const outer = this.buf;
    const mine: DuelEvent[] = [];
    this.buf = mine;
    // Every action validates fully before mutating, so a thrown error leaves the
    // state untouched (and the state object identity stable for UI references).
    try {
      fn();
    } catch (e) {
      this.buf = outer;
      throw e;
    }
    this.buf = outer;
    if (outer) outer.push(...mine);
    else this.flush(mine);
    return mine;
  }

  private flush(evs: DuelEvent[]): void {
    for (const ev of evs) for (const l of this.listeners) l(ev);
  }
}

export { findInHand, findMonster, findSpellTrap } from './Rules';
