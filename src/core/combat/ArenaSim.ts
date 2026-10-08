// Real-time arena fight: deterministic fixed-step (1/60 s) simulation. PURE TS, no Phaser.
//
// The same class drives the rendered fight (src/scenes/ArenaScene.ts) and headless balance
// runs (tools/balance-sim.ts). Same request + seed + inputs => same events and same result.
//
// Design decisions (see docs/GDD.md section 3):
//  - Sides: 0 = attacker, 1 = defender (NOT PlayerId). Fighter.player maps back to the duel.
//  - Basic attacks are AUTOMATIC by default: whenever the enemy is in reach and the attack timer
//    is ready, the fighter swings (melee: short telegraphed wind-up, dodgeable) or fires a bolt
//    (ranged: aimed at the enemy's current position, dodgeable by moving). This keeps mobile
//    controls simple - the player moves/dodges and taps abilities. `opts.autoAttack` can turn it
//    off per side, then `input.attack` must be held to swing (still only when in reach).
//  - Every damage number goes through Formulas.hitDamage (resistance, floor, anti-one-shot cap),
//    then +-hitVariance, then the target's shield.
//  - Skill shots (ability/spell projectiles, dashes) aim along input.aimX/aimY when given
//    (the AI passes its aim incl. lead and aim error); otherwise they auto-target the enemy's
//    current position (the human UI).
//  - Sudden death after TUNING.arena.suddenDeathAtSec: both lose suddenDeathDps(t)*maxHp per
//    second (ignores shield and i-frames), healing is disabled and the walls close in.
//    Hard cap: higher HP fraction wins, exact tie = draw. KOs within drawWindowSec = draw.

import type { ArenaAbility, ArenaRequest, ArenaResult, CardDef, CardInstance, PlayerId, Position } from '../types';
import { getCard } from '../cards/CardDB';
import { Rng } from '../rng';
import {
  TUNING, arenaStats, defaultAbilityForStyle, hitDamage, suddenDeathDps, type ArenaStats,
} from './Formulas';

export const SIM_DT = 1 / 60;

export type Side = 0 | 1;
export const otherSide = (s: Side): Side => (s === 0 ? 1 : 0);

/** Per-fighter input for one tick. */
export interface FighterInput {
  /** Movement direction, each in -1..1 (clamped to unit length). */
  moveX: number;
  moveY: number;
  /** Swing/fire the basic attack (only needed when auto-attack is off for this side). */
  attack: boolean;
  /** Index into fighter.abilities to cast this tick, or null. */
  ability: number | null;
  /** Index into fighter.spells to fire this tick (once per fight), or null. */
  spell: number | null;
  /** Optional aim direction for skill shots; omitted = auto-target the enemy. */
  aimX?: number;
  aimY?: number;
}

export const IDLE_INPUT: Readonly<FighterInput> = Object.freeze({ moveX: 0, moveY: 0, attack: false, ability: null, spell: null });

export type HitSource = 'basic' | 'ability' | 'spell' | 'suddenDeath';

export type SimEvent =
  | { type: 'attack'; t: number; side: Side; ranged: boolean }
  | { type: 'hit'; t: number; source: Side | null; target: Side; amount: number; kind: HitSource; x: number; y: number; shielded: boolean; stun: number; mult: number }
  | { type: 'abilityCast'; t: number; side: Side; ability: ArenaAbility; index: number; isSpell: boolean; spellUid?: number }
  | { type: 'projectileSpawn'; t: number; id: number; side: Side; x: number; y: number; vx: number; vy: number; radius: number; kind: HitSource }
  | { type: 'projectileEnd'; t: number; id: number; hit: boolean; x: number; y: number }
  | { type: 'telegraph'; t: number; id: number; side: Side; x: number; y: number; radius: number; at: number; kind: HitSource; lockOn: boolean }
  | { type: 'burst'; t: number; id: number; side: Side; x: number; y: number; radius: number }
  | { type: 'dash'; t: number; side: Side; dx: number; dy: number }
  | { type: 'heal'; t: number; side: Side; amount: number }
  | { type: 'status'; t: number; side: Side; status: 'shield' | 'buff' | 'stun'; duration: number; magnitude: number }
  | { type: 'ko'; t: number; side: Side }
  | { type: 'suddenDeath'; t: number }
  | { type: 'end'; t: number; result: ArenaResult };

export interface AbilitySlot {
  ability: ArenaAbility;
  /** Seconds until ready (0 = ready). */
  cd: number;
}

export interface SpellSlot {
  uid: number;
  def: CardDef;
  ability: ArenaAbility;
  used: boolean;
}

/** In-progress action that locks out other attacks (wind-ups, dash, channel). */
export type FighterAction =
  | { kind: 'melee'; strikeAt: number; start: number; mult: number; reach: number; stun: number; source: HitSource }
  | { kind: 'dash'; start: number; lungeAt: number; until: number; vx: number; vy: number; mult: number; hit: boolean; source: HitSource }
  | { kind: 'channel'; start: number; until: number };

export interface Fighter {
  side: Side;
  player: PlayerId;
  uid: number;
  def: CardDef;
  position: Position;
  stats: ArenaStats;
  maxHp: number;
  hp: number;
  radius: number;
  x: number;
  y: number;
  /** Last movement velocity (for rendering walk anims / AI prediction). */
  vx: number;
  vy: number;
  /** Walking velocity of the previous tick (order-independent lead aim). */
  pvx: number;
  pvy: number;
  /** Knockback velocity, decays. */
  kx: number;
  ky: number;
  /** +1 facing right, -1 facing left. */
  facing: 1 | -1;
  basicCd: number;
  abilities: AbilitySlot[];
  spells: SpellSlot[];
  shieldMag: number;
  shieldUntil: number;
  buffPower: number;
  buffSpeed: number;
  buffUntil: number;
  stunUntil: number;
  iframesUntil: number;
  /** Movement locked until (ranged basic fire root). */
  rootUntil: number;
  action: FighterAction | null;
  koAt: number | null;
  /** Bookkeeping for stats/AI. */
  damageDealt: number;
  lastHitAt: number;
}

export interface Projectile {
  id: number;
  owner: Side;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mult: number;
  stun: number;
  kind: HitSource;
  traveled: number;
  maxRange: number;
  spawnT: number;
}

export interface Zone {
  id: number;
  owner: Side;
  x: number;
  y: number;
  radius: number;
  at: number;
  mult: number;
  stun: number;
  kind: HitSource;
  /** Lock-on zones always hit the enemy (stun spells). */
  lockOn: boolean;
  spawnT: number;
}

export interface ArenaSimOptions {
  /** Auto basic attacks per side (default both true). */
  autoAttack?: [boolean, boolean];
  /** Put the attacker on the left (default true). The UI puts the human on the left. */
  attackerOnLeft?: boolean;
  /** Monster was flipped face-up by this attack: its first ability starts ready (GDD 5.2). */
  flipped?: [boolean, boolean];
  /** Override spawn centre distance (tests). */
  spawnGap?: number;
  /** Resolve spell CardInstances to defs (default CardDB.getCard). */
  resolveCard?: (defId: string) => CardDef;
}

/** Arena behaviour of an arena-usable spell: arenaAbilities[0], else a default burst (GDD 3.7). */
export function spellAbility(def: CardDef): ArenaAbility {
  const ab = def.arenaAbilities?.[0];
  if (ab) {
    const damaging = ab.kind === 'projectile' || ab.kind === 'aoe' || ab.kind === 'dash';
    return damaging && !(ab.power > 0) ? { ...ab, power: TUNING.abilities.spellPower } : ab;
  }
  return {
    id: `${def.id}-arena`, name: def.name, kind: 'projectile', power: TUNING.abilities.spellPower, cooldown: 0,
    description: 'Arena burst.',
  };
}

/** True if the ability kind deals damage (needs the enemy). */
export function isDamaging(ab: ArenaAbility): boolean {
  return ab.kind === 'projectile' || ab.kind === 'dash' || ab.kind === 'aoe' || ab.kind === 'stun';
}

export class ArenaSim {
  readonly request: ArenaRequest;
  readonly fighters: [Fighter, Fighter];
  readonly projectiles: Projectile[] = [];
  readonly zones: Zone[] = [];
  /** Seconds since the fight began. */
  t = 0;
  tick = 0;
  done = false;
  result: ArenaResult | null = null;
  suddenDeath = false;
  /** Current walls (shrink during sudden death). */
  bounds: { x0: number; y0: number; x1: number; y1: number } = { x0: 0, y0: 0, x1: TUNING.arena.sim.width, y1: TUNING.arena.sim.height };
  readonly width: number = TUNING.arena.sim.width;
  readonly height: number = TUNING.arena.sim.height;

  private readonly rng: Rng;
  private readonly auto: [boolean, boolean];
  private nextId = 1;
  private endAt: number | null = null;
  private firstKoAt: number | null = null;
  private sdAccum: [number, number] = [0, 0];
  private sdNextEmit = 0;
  private events: SimEvent[] = [];

  constructor(request: ArenaRequest, opts: ArenaSimOptions = {}) {
    this.request = request;
    this.rng = new Rng((request.seed ^ 0x9e3779b9) >>> 0);
    this.auto = opts.autoAttack ?? [true, true];
    const S = TUNING.arena.sim;
    const gap = opts.spawnGap ?? S.spawnGap;
    const left = opts.attackerOnLeft ?? true;
    const cx = S.width / 2, cy = S.height / 2;
    const resolve = opts.resolveCard ?? getCard;
    const mk = (side: Side): Fighter => {
      const r = side === 0 ? request.attacker : request.defender;
      const position: Position = side === 0 ? 'attack' : request.defender.position;
      const stats = arenaStats(r.def, r.atk, r.defStat, position);
      const onLeft = (side === 0) === left;
      const abs = r.def.arenaAbilities?.length ? r.def.arenaAbilities : [defaultAbilityForStyle(stats.style)];
      const flipped = opts.flipped?.[side] ?? false;
      const spells: SpellSlot[] = (request.usableSpells[r.player] ?? []).map((c: CardInstance) => {
        const def = resolve(c.defId);
        return { uid: c.uid, def, ability: spellAbility(def), used: false };
      });
      return {
        side, player: r.player, uid: r.uid, def: r.def, position, stats,
        maxHp: stats.maxHp, hp: stats.maxHp,
        radius: (r.def.level ?? 4) >= 7 ? S.bodyRadiusBig : S.bodyRadius,
        x: cx + (onLeft ? -gap / 2 : gap / 2), y: cy, vx: 0, vy: 0, pvx: 0, pvy: 0, kx: 0, ky: 0,
        facing: onLeft ? 1 : -1,
        basicCd: S.firstAttackDelaySec,
        abilities: abs.slice(0, 2).map((ability, i) => ({
          ability, cd: flipped && i === 0 ? 0 : ability.cooldown * (S.abilityStartCdFrac + S.abilityStartJitter * (2 * this.rng.next() - 1)),
        })),
        spells,
        shieldMag: 0, shieldUntil: 0, buffPower: 1, buffSpeed: 1, buffUntil: 0, stunUntil: 0, iframesUntil: 0, rootUntil: 0,
        action: null, koAt: null, damageDealt: 0, lastHitAt: -99,
      };
    };
    this.fighters = [mk(0), mk(1)];
  }

  // -------------------------------------------------------------------------
  // Queries (used by the renderer and ArenaAI)
  // -------------------------------------------------------------------------

  get suddenDeathAt(): number { return TUNING.arena.suddenDeathAtSec; }
  get hardCap(): number { return TUNING.arena.hardCapSec; }

  hpFrac(side: Side): number {
    const f = this.fighters[side];
    return Math.max(0, f.hp) / f.maxHp;
  }

  isStunned(side: Side): boolean { return this.t < this.fighters[side].stunUntil; }
  isShielded(side: Side): boolean { return this.t < this.fighters[side].shieldUntil; }
  isBuffed(side: Side): boolean { return this.t < this.fighters[side].buffUntil; }
  isInvulnerable(side: Side): boolean {
    const f = this.fighters[side];
    const a = f.action;
    return (a?.kind === 'dash' && this.t >= a.lungeAt) || this.t < f.iframesUntil;
  }

  distance(): number {
    const [a, b] = this.fighters;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Could the fighter start this ability right now (cooldown, stun, lockouts, sudden-death heal ban)? */
  canUseAbility(side: Side, index: number): boolean {
    const f = this.fighters[side];
    const slot = f.abilities[index];
    if (!slot || slot.cd > 0) return false;
    return this.canCast(f, slot.ability);
  }

  canUseSpell(side: Side, index: number): boolean {
    const f = this.fighters[side];
    const s = f.spells[index];
    if (!s || s.used) return false;
    return this.canCast(f, s.ability);
  }

  private canCast(f: Fighter, ab: ArenaAbility): boolean {
    if (this.done || f.koAt !== null || this.t < f.stunUntil) return false;
    if (ab.kind === 'heal' && this.suddenDeath) return false;
    if (isDamaging(ab) && f.action) return false;
    if (isDamaging(ab) && this.fighters[otherSide(f.side)].koAt !== null) return false;
    return true;
  }

  /** Remove and return the events produced since the last call. */
  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // -------------------------------------------------------------------------
  // Step
  // -------------------------------------------------------------------------

  /** Advance one fixed tick (SIM_DT). Returns the events of this tick (also kept until drained). */
  step(inputs: readonly [FighterInput, FighterInput]): SimEvent[] {
    const before = this.events.length;
    if (this.done) return [];
    const dt = SIM_DT;
    this.tick++;
    this.t = this.tick * dt;
    const t = this.t;
    const A = TUNING.arena;

    if (!this.suddenDeath && t >= A.suddenDeathAtSec) {
      this.suddenDeath = true;
      this.emit({ type: 'suddenDeath', t });
    }
    this.updateBounds();

    // 1) status expiry & timers
    for (const f of this.fighters) {
      if (t >= f.buffUntil) { f.buffPower = 1; f.buffSpeed = 1; }
      if (t >= f.shieldUntil) f.shieldMag = 0;
      f.basicCd = Math.max(0, f.basicCd - dt);
      for (const s of f.abilities) s.cd = Math.max(0, s.cd - dt);
    }

    // 2) inputs: casts, movement, basic attacks
    for (const f of this.fighters) { f.pvx = f.vx; f.pvy = f.vy; }
    // Alternate processing order every tick so neither side systematically acts first.
    const order: Side[] = this.tick % 2 === 0 ? [0, 1] : [1, 0];
    for (const side of order) this.applyInput(this.fighters[side], inputs[side] ?? IDLE_INPUT);

    // 3) actions in progress (melee strikes, dashes, channels)
    for (const side of order) this.updateAction(this.fighters[side]);

    // 4) physics
    for (const f of this.fighters) this.integrate(f);
    this.separate();
    for (const f of this.fighters) this.clampToBounds(f);

    // 5) projectiles & zones
    this.updateProjectiles();
    this.updateZones();

    // 6) sudden death
    if (this.suddenDeath) this.applySuddenDeath();

    // 7) end conditions
    this.checkEnd();
    return this.events.slice(before);
  }

  /** Run until the fight ends using `controllers` (headless). Returns the result. */
  runToEnd(controllers: [ArenaController, ArenaController]): ArenaResult {
    const maxTicks = Math.ceil((TUNING.arena.hardCapSec + 1) / SIM_DT);
    while (!this.done && this.tick < maxTicks) {
      this.step([controllers[0].input(this, 0), controllers[1].input(this, 1)]);
      this.events.length = 0;
    }
    return this.result!;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private emit(e: SimEvent): void { this.events.push(e); }

  private enemy(f: Fighter): Fighter { return this.fighters[otherSide(f.side)]; }

  private updateBounds(): void {
    const S = TUNING.arena.sim;
    let shrink = 0;
    if (this.suddenDeath) {
      shrink = S.suddenDeathShrink * Math.min(1, (this.t - TUNING.arena.suddenDeathAtSec) / S.suddenDeathShrinkSec);
    }
    const mx = (S.width * shrink) / 2, my = (S.height * shrink) / 2;
    this.bounds = { x0: mx, y0: my, x1: S.width - mx, y1: S.height - my };
  }

  private applyInput(f: Fighter, input: FighterInput): void {
    const t = this.t;
    f.vx = 0; f.vy = 0;
    if (f.koAt !== null || this.done) return;
    const e = this.enemy(f);
    if (e.koAt === null) f.facing = e.x >= f.x ? 1 : -1;
    if (t < f.stunUntil) return;

    // Casts (spell first: it's the rarer, deliberate tap)
    if (input.spell !== null && input.spell !== undefined && this.canUseSpell(f.side, input.spell)) {
      const s = f.spells[input.spell];
      s.used = true;
      this.emit({ type: 'abilityCast', t, side: f.side, ability: s.ability, index: input.spell, isSpell: true, spellUid: s.uid });
      this.cast(f, s.ability, 'spell', input);
    }
    if (input.ability !== null && input.ability !== undefined && this.canUseAbility(f.side, input.ability)) {
      const slot = f.abilities[input.ability];
      slot.cd = slot.ability.cooldown;
      this.emit({ type: 'abilityCast', t, side: f.side, ability: slot.ability, index: input.ability, isSpell: false });
      this.cast(f, slot.ability, 'ability', input);
    }

    // Movement
    const act = f.action;
    if ((!act || act.kind === 'melee') && t >= f.rootUntil) {
      let mx = Number.isFinite(input.moveX) ? input.moveX : 0;
      let my = Number.isFinite(input.moveY) ? input.moveY : 0;
      const len = Math.hypot(mx, my);
      if (len > 1) { mx /= len; my /= len; }
      let sp = f.stats.speed * f.buffSpeed;
      if (act) sp *= TUNING.arena.sim.windupMoveMult;
      f.vx = mx * sp; f.vy = my * sp;
    }

    // Basic attack
    if ((this.auto[f.side] || input.attack) && f.basicCd <= 0 && !f.action && e.koAt === null) {
      const S = TUNING.arena.sim;
      const d = Math.hypot(e.x - f.x, e.y - f.y);
      const jitter = 1 + S.attackJitter * (2 * this.rng.next() - 1);
      if (f.stats.style === 'ranged') {
        if (d <= f.stats.range + S.rangedFireSlack) {
          f.basicCd = f.stats.attackInterval * jitter;
          f.rootUntil = t + S.rangedFireRootSec;
          f.vx = 0; f.vy = 0;
          this.emit({ type: 'attack', t, side: f.side, ranged: true });
          // lead the target's current walking velocity
          const tf = (d / S.basicProjectileSpeed) * S.basicLeadFrac;
          this.spawnProjectile(f, e.x + e.pvx * tf - f.x, e.y + e.pvy * tf - f.y, S.basicProjectileSpeed, S.projectileRadius, 1, 0, 'basic');
        }
      } else if (d <= f.stats.range + e.radius) {
        f.basicCd = f.stats.attackInterval * jitter;
        f.action = { kind: 'melee', start: t, strikeAt: t + S.meleeWindupSec, mult: 1, reach: f.stats.range, stun: 0, source: 'basic' };
        this.emit({ type: 'attack', t, side: f.side, ranged: false });
      }
    }
  }

  private aimDir(f: Fighter, input: FighterInput): [number, number] {
    let ax = input.aimX, ay = input.aimY;
    if (ax === undefined || ay === undefined || !Number.isFinite(ax) || !Number.isFinite(ay) || (ax === 0 && ay === 0)) {
      const e = this.enemy(f);
      ax = e.x - f.x; ay = e.y - f.y;
      if (ax === 0 && ay === 0) ax = f.facing;
    }
    const l = Math.hypot(ax, ay);
    return [ax / l, ay / l];
  }

  private cast(f: Fighter, ab: ArenaAbility, source: HitSource, input: FighterInput): void {
    const S = TUNING.arena.sim;
    const t = this.t;
    const e = this.enemy(f);
    const isSpell = source === 'spell';
    switch (ab.kind) {
      case 'projectile': {
        const [dx, dy] = this.aimDir(f, input);
        this.spawnProjectile(f, dx, dy,
          isSpell ? S.spellProjectileSpeed : S.abilityProjectileSpeed,
          isSpell ? S.spellProjectileRadius : S.projectileRadius + 1, ab.power, 0, source);
        break;
      }
      case 'dash': {
        const [dx, dy] = this.aimDir(f, input);
        const v = S.dashDistance / S.dashSec;
        const lungeAt = t + S.dashWindupSec;
        f.action = { kind: 'dash', start: t, lungeAt, until: lungeAt + S.dashSec, vx: dx * v, vy: dy * v, mult: ab.power, hit: false, source };
        this.emit({ type: 'dash', t, side: f.side, dx, dy });
        break;
      }
      case 'aoe': {
        if (isSpell) {
          this.spawnZone(f, e.x, e.y, S.spellAoeRadius, t + S.spellAoeWindupSec, ab.power, 0, source, false);
        } else {
          f.action = { kind: 'channel', start: t, until: t + S.aoeWindupSec };
          this.spawnZone(f, f.x, f.y, S.aoeRadius, t + S.aoeWindupSec, ab.power, 0, source, false);
        }
        break;
      }
      case 'stun': {
        const dur = Math.min(TUNING.abilities.maxStunSec, ab.duration ?? 0.6);
        if (isSpell) {
          this.spawnZone(f, e.x, e.y, e.radius + 6, t + S.spellStunDelaySec, ab.power, dur, source, true);
        } else if (f.stats.style === 'ranged') {
          const [dx, dy] = this.aimDir(f, input);
          this.spawnProjectile(f, dx, dy, S.abilityProjectileSpeed, S.projectileRadius + 1, ab.power, dur, source);
        } else {
          f.action = {
            kind: 'melee', start: t, strikeAt: t + S.stunWindupSec, mult: ab.power,
            reach: f.stats.range + S.stunReachBonus, stun: dur, source,
          };
        }
        break;
      }
      case 'shield': {
        const mag = Math.min(TUNING.abilities.maxShield, ab.magnitude ?? 0.4);
        const dur = ab.duration ?? 2;
        f.shieldMag = Math.max(f.shieldUntil > t ? f.shieldMag : 0, mag);
        f.shieldUntil = Math.max(f.shieldUntil, t + dur);
        this.emit({ type: 'status', t, side: f.side, status: 'shield', duration: dur, magnitude: mag });
        break;
      }
      case 'heal': {
        const frac = Math.min(TUNING.abilities.maxHealFrac, ab.magnitude ?? 0.2);
        const before = f.hp;
        f.hp = Math.min(f.maxHp, f.hp + frac * f.maxHp);
        this.emit({ type: 'heal', t, side: f.side, amount: f.hp - before });
        break;
      }
      case 'buff': {
        const mag = Math.min(TUNING.abilities.maxBuffMult, ab.magnitude ?? 1.3);
        const dur = ab.duration ?? 3;
        if (/speed|swift|fast/i.test(ab.description)) f.buffSpeed = mag;
        else f.buffPower = mag;
        f.buffUntil = Math.max(f.buffUntil, t + dur);
        this.emit({ type: 'status', t, side: f.side, status: 'buff', duration: dur, magnitude: mag });
        break;
      }
    }
  }

  private spawnProjectile(f: Fighter, dx: number, dy: number, speed: number, radius: number, mult: number, stun: number, kind: HitSource): void {
    const l = Math.hypot(dx, dy) || 1;
    const vx = (dx / l) * speed, vy = (dy / l) * speed;
    const p: Projectile = {
      id: this.nextId++, owner: f.side, x: f.x + (dx / l) * f.radius, y: f.y + (dy / l) * f.radius,
      vx, vy, radius, mult, stun, kind, traveled: 0, maxRange: TUNING.arena.sim.projectileMaxRange, spawnT: this.t,
    };
    this.projectiles.push(p);
    this.emit({ type: 'projectileSpawn', t: this.t, id: p.id, side: f.side, x: p.x, y: p.y, vx, vy, radius, kind });
  }

  private spawnZone(f: Fighter, x: number, y: number, radius: number, at: number, mult: number, stun: number, kind: HitSource, lockOn: boolean): void {
    const z: Zone = { id: this.nextId++, owner: f.side, x, y, radius, at, mult, stun, kind, lockOn, spawnT: this.t };
    this.zones.push(z);
    this.emit({ type: 'telegraph', t: this.t, id: z.id, side: f.side, x, y, radius, at, kind, lockOn });
  }

  private updateAction(f: Fighter): void {
    const a = f.action;
    if (!a) return;
    const t = this.t;
    if (f.koAt !== null) { f.action = null; return; }
    const e = this.enemy(f);
    if (a.kind === 'melee') {
      if (t >= a.strikeAt) {
        f.action = null;
        const d = Math.hypot(e.x - f.x, e.y - f.y);
        if (e.koAt === null && d <= a.reach + e.radius + TUNING.arena.sim.meleeReachSlack) {
          this.applyHit(f, e, a.mult, a.source, a.stun, e.x - f.x, e.y - f.y);
        }
      }
    } else if (a.kind === 'dash') {
      if (t < a.lungeAt) return;
      if (!a.hit && e.koAt === null) {
        const d = Math.hypot(e.x - f.x, e.y - f.y);
        if (d <= f.radius + e.radius + TUNING.arena.sim.dashContactSlack) {
          a.hit = true;
          this.applyHit(f, e, a.mult, a.source, 0, a.vx, a.vy);
        }
      }
      if (t >= a.until) f.action = null;
    } else if (a.kind === 'channel') {
      if (t >= a.until) f.action = null;
    }
  }

  private integrate(f: Fighter): void {
    const dt = SIM_DT;
    const a = f.action;
    let vx = f.vx, vy = f.vy;
    if (a?.kind === 'dash' && f.koAt === null) {
      if (this.t >= a.lungeAt) { vx = a.vx; vy = a.vy; } else { vx = 0; vy = 0; }
    }
    f.x += (vx + f.kx) * dt;
    f.y += (vy + f.ky) * dt;
    const decay = Math.exp(-TUNING.arena.sim.knockbackDecay * dt);
    f.kx *= decay; f.ky *= decay;
    if (Math.abs(f.kx) < 1) f.kx = 0;
    if (Math.abs(f.ky) < 1) f.ky = 0;
  }

  private separate(): void {
    const [a, b] = this.fighters;
    if (a.koAt !== null || b.koAt !== null) return;
    let dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    const min = a.radius + b.radius;
    if (d >= min) return;
    if (d < 1e-6) { dx = a.facing === 1 ? 1 : -1; dy = 0; d = 1; }
    const push = (min - d) / 2;
    const nx = dx / d, ny = dy / d;
    a.x -= nx * push; a.y -= ny * push;
    b.x += nx * push; b.y += ny * push;
  }

  private clampToBounds(f: Fighter): void {
    const B = this.bounds;
    const r = f.radius;
    f.x = Math.min(B.x1 - r, Math.max(B.x0 + r, f.x));
    f.y = Math.min(B.y1 - r, Math.max(B.y0 + r * 0.5, f.y));
  }

  private updateProjectiles(): void {
    const dt = SIM_DT;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.traveled += Math.hypot(p.vx, p.vy) * dt;
      const target = this.fighters[otherSide(p.owner)];
      let gone = false, hit = false;
      if (target.koAt === null && !this.isInvulnerable(target.side)) {
        const d = Math.hypot(target.x - p.x, target.y - p.y);
        if (d <= p.radius + target.radius) {
          this.applyHit(this.fighters[p.owner], target, p.mult, p.kind, p.stun, p.vx, p.vy);
          gone = true; hit = true;
        }
      }
      if (!gone && (p.traveled > p.maxRange || p.x < -20 || p.y < -20 || p.x > this.width + 20 || p.y > this.height + 20)) gone = true;
      if (gone) {
        this.projectiles.splice(i, 1);
        this.emit({ type: 'projectileEnd', t: this.t, id: p.id, hit, x: p.x, y: p.y });
      }
    }
  }

  private updateZones(): void {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (this.t < z.at) continue;
      this.zones.splice(i, 1);
      const src = this.fighters[z.owner];
      const target = this.fighters[otherSide(z.owner)];
      this.emit({ type: 'burst', t: this.t, id: z.id, side: z.owner, x: z.x, y: z.y, radius: z.radius });
      if (target.koAt !== null) continue;
      if (z.lockOn) {
        this.applyHit(src, target, z.mult, z.kind, z.stun, target.x - src.x, target.y - src.y, true);
      } else if (Math.hypot(target.x - z.x, target.y - z.y) <= z.radius + target.radius) {
        this.applyHit(src, target, z.mult, z.kind, z.stun, target.x - z.x, target.y - z.y);
      }
    }
  }

  /** Apply one landed hit. Returns false if the target was invulnerable. */
  private applyHit(src: Fighter, dst: Fighter, mult: number, kind: HitSource, stun: number, dirX: number, dirY: number, unavoidable = false): boolean {
    const t = this.t;
    if (dst.koAt !== null) return false;
    if (!unavoidable && this.isInvulnerable(dst.side)) return false;
    const S = TUNING.arena.sim;
    let amount = 0;
    const shielded = t < dst.shieldUntil && dst.shieldMag > 0;
    if (mult > 0) {
      const v = 1 + S.hitVariance * (2 * this.rng.next() - 1);
      amount = hitDamage(src.stats.power * src.buffPower, mult, { maxHp: dst.maxHp, def: dst.stats.def }) * v;
      if (shielded) amount *= 1 - dst.shieldMag;
      dst.hp -= amount;
      src.damageDealt += amount;
      dst.iframesUntil = t + S.iframeSec;
      dst.lastHitAt = t;
      const l = Math.hypot(dirX, dirY) || 1;
      const k = S.knockback * (kind === 'basic' ? S.basicKnockbackMult : Math.sqrt(Math.max(1, mult))) * (shielded ? 0.5 : 1);
      dst.kx += (dirX / l) * k; dst.ky += (dirY / l) * k;
    }
    if (stun > 0) {
      dst.stunUntil = Math.max(dst.stunUntil, t + stun);
      if (dst.action && dst.action.kind !== 'dash') dst.action = null; // interrupt wind-ups
      this.emit({ type: 'status', t, side: dst.side, status: 'stun', duration: stun, magnitude: 1 });
    }
    this.emit({
      type: 'hit', t, source: src.side, target: dst.side, amount, kind, x: dst.x, y: dst.y, shielded, stun, mult,
    });
    if (dst.hp <= 0) this.ko(dst);
    return true;
  }

  private applySuddenDeath(): void {
    const t = this.t;
    const frac = suddenDeathDps(t) * SIM_DT;
    for (const f of this.fighters) {
      if (f.koAt !== null) continue;
      const dmg = frac * f.maxHp;
      f.hp -= dmg;
      this.sdAccum[f.side] += dmg;
    }
    const emitNow = t >= this.sdNextEmit;
    for (const f of this.fighters) {
      if ((emitNow || f.hp <= 0) && this.sdAccum[f.side] > 0) {
        this.emit({ type: 'hit', t, source: null, target: f.side, amount: this.sdAccum[f.side], kind: 'suddenDeath', x: f.x, y: f.y, shielded: false, stun: 0, mult: 0 });
        this.sdAccum[f.side] = 0;
      }
      if (f.koAt === null && f.hp <= 0) this.ko(f);
    }
    if (emitNow) this.sdNextEmit = t + 0.5;
  }

  private ko(f: Fighter): void {
    f.hp = 0;
    f.koAt = this.t;
    f.action = null;
    f.vx = 0; f.vy = 0;
    this.emit({ type: 'ko', t: this.t, side: f.side });
    if (this.firstKoAt === null) {
      this.firstKoAt = this.t;
      this.endAt = this.t + TUNING.arena.drawWindowSec;
    }
  }

  private checkEnd(): void {
    const t = this.t;
    const [a, b] = this.fighters;
    let winner: ArenaResult['winner'] | null = null;
    let duration = t;
    if (this.endAt !== null && (t >= this.endAt - 1e-9 || (a.koAt !== null && b.koAt !== null))) {
      duration = this.firstKoAt ?? t;
      if (a.koAt !== null && b.koAt !== null) winner = 'draw';
      else winner = a.koAt !== null ? 'defender' : 'attacker';
    } else if (this.endAt === null && t >= TUNING.arena.hardCapSec - 1e-9) {
      const fa = this.hpFrac(0), fb = this.hpFrac(1);
      winner = fa === fb ? 'draw' : fa > fb ? 'attacker' : 'defender';
    }
    if (winner === null) return;
    const spellsUsed: [number[], number[]] = [[], []];
    for (const f of this.fighters) for (const s of f.spells) if (s.used) spellsUsed[f.player].push(s.uid);
    this.result = {
      winner,
      attackerHpFrac: this.hpFrac(0),
      defenderHpFrac: this.hpFrac(1),
      durationSec: Math.round(duration * 1000) / 1000,
      spellsUsed,
    };
    this.done = true;
    this.projectiles.length = 0;
    this.zones.length = 0;
    this.emit({ type: 'end', t, result: this.result });
  }
}

/** Anything that can produce a FighterInput each tick (ArenaAI, human input adapter, idle). */
export interface ArenaController {
  input(sim: ArenaSim, side: Side): FighterInput;
}

export const IDLE_CONTROLLER: ArenaController = { input: () => IDLE_INPUT };

/** Convenience: build and run a whole fight headless. */
export function simulateArena(
  request: ArenaRequest, controllers: [ArenaController, ArenaController], opts: ArenaSimOptions = {},
): { result: ArenaResult; sim: ArenaSim } {
  const sim = new ArenaSim(request, opts);
  const result = sim.runToEnd(controllers);
  return { result, sim };
}
