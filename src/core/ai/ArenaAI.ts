// Arena fighter controller. PURE TS, deterministic (own seeded RNG).
//
// Drives the NPC monster in the real-time arena, and also auto-plays the HUMAN side in headless
// balance sims / the in-fight "Auto" toggle at a player skill level (TUNING.arena.playerSkill).
//
// Fairness rules (GDD 3.8): the AI only reacts to what a player could see, and it sees it late:
//  - Perception lag: the enemy's position/velocity is read from `reactionMs` ago (ring buffer),
//    and projectiles / telegraphs / wind-ups are only noticed `reactionMs` after they appear.
//  - Dodging: each threat is rolled ONCE against dodgeChance; a failed roll means it never reacts.
//  - Abilities: when an ability becomes sensible, roll abilityUseChance; a failed roll makes it
//    hesitate ~1 s before reconsidering.
//  - Skill shots are aimed with partial lead (leadFrac) plus a uniform +-aimErrorDeg error.
// Behaviour: melee/bruiser/swift close in and trade; ranged keeps ~80% of its range and kites
// away from melee threats (sliding along walls); both strafe a little to dodge bolts.

import type { ArenaAbility } from '../types';
import { Rng } from '../rng';
import { TUNING, type Difficulty } from '../combat/Formulas';
import {
  IDLE_INPUT, SIM_DT, isDamaging, otherSide,
  type ArenaController, type ArenaSim, type Fighter, type FighterInput, type Side,
} from '../combat/ArenaSim';

export type PlayerSkill = keyof typeof TUNING.arena.playerSkill;
export type ArenaSkill = Difficulty | PlayerSkill;

export interface ArenaAIProfile {
  reactionMs: number;
  aimErrorDeg: number;
  abilityUseChance: number;
  dodgeChance: number;
  leadFrac: number;
}

export const NPC_DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];
export const PLAYER_SKILLS: PlayerSkill[] = ['novice', 'average', 'good', 'expert'];

export function arenaProfile(level: ArenaSkill): ArenaAIProfile {
  if (level in TUNING.ai) {
    const d = level as Difficulty;
    const a = TUNING.ai[d];
    return { reactionMs: a.reactionMs, aimErrorDeg: a.aimErrorDeg, abilityUseChance: a.abilityUseChance, dodgeChance: a.dodgeChance, leadFrac: TUNING.arena.aiLeadFrac[d] };
  }
  const p = TUNING.arena.playerSkill[level as PlayerSkill];
  return { ...p };
}

interface Seen { x: number; y: number; vx: number; vy: number }

const HESITATE_SEC = 1.0;

export class ArenaAI implements ArenaController {
  readonly profile: ArenaAIProfile;
  private readonly rng: Rng;
  private history: Seen[] = [];
  private decided = new Map<number, boolean>(); // threat id -> will dodge?
  private dodge: { dx: number; dy: number; until: number } | null = null;
  private hesitateAbility: number[] = [0, 0];
  private hesitateSpell: number[] = [];
  private strafeDir = 1;
  private strafeSwitchAt = 0;
  private lastTick = -1;
  private lastInput: FighterInput = { ...IDLE_INPUT };

  constructor(level: ArenaSkill | ArenaAIProfile, seed: number) {
    this.profile = typeof level === 'string' ? arenaProfile(level) : level;
    this.rng = new Rng((seed ^ 0x51ed270b) >>> 0);
  }

  input(sim: ArenaSim, side: Side): FighterInput {
    if (sim.tick === this.lastTick) return this.lastInput; // idempotent within a tick
    this.lastTick = sim.tick;
    const me = sim.fighters[side];
    const foe = sim.fighters[otherSide(side)];
    const t = sim.t;
    // perception ring buffer
    this.history.push({ x: foe.x, y: foe.y, vx: foe.vx + foe.kx, vy: foe.vy + foe.ky });
    const lagTicks = Math.max(0, Math.round(this.profile.reactionMs / 1000 / SIM_DT));
    if (this.history.length > lagTicks + 1) this.history.splice(0, this.history.length - lagTicks - 1);
    // Lagged snapshot, dead-reckoned to "now" with the lagged velocity: a player tracks steady
    // motion fine; it is direction CHANGES that they react to late.
    const lagged = this.history[0];
    const lagSec = (this.history.length - 1) * SIM_DT;
    const seen: Seen = { x: lagged.x + lagged.vx * lagSec, y: lagged.y + lagged.vy * lagSec, vx: lagged.vx, vy: lagged.vy };

    const out: FighterInput = { moveX: 0, moveY: 0, attack: false, ability: null, spell: null };
    if (sim.done || me.koAt !== null || foe.koAt !== null) return (this.lastInput = out);

    const seenT = t - this.profile.reactionMs / 1000;
    const dx = seen.x - me.x, dy = seen.y - me.y;
    const dist = Math.hypot(dx, dy) || 1;

    // ---- threats (projectiles, telegraphed zones, melee wind-ups) ----
    this.considerThreats(sim, me, foe, seenT, t);

    // ---- movement ----
    if (this.dodge && t < this.dodge.until) {
      out.moveX = this.dodge.dx; out.moveY = this.dodge.dy;
    } else {
      this.dodge = null;
      const [mx, my] = this.navigate(sim, me, foe, seen, dist, t);
      out.moveX = mx; out.moveY = my;
    }
    [out.moveX, out.moveY] = this.avoidWalls(sim, me, out.moveX, out.moveY);

    // ---- abilities & spells ----
    const threat = this.underThreat(sim, me, foe, seenT, dist);
    for (let i = 0; i < me.abilities.length; i++) {
      if (!sim.canUseAbility(side, i) || t < (this.hesitateAbility[i] ?? 0)) continue;
      const ab = me.abilities[i].ability;
      if (!this.sensible(sim, me, foe, ab, dist, threat, false)) continue;
      if (this.rng.next() < this.profile.abilityUseChance) {
        out.ability = i;
        if (isDamaging(ab)) this.aim(out, sim, me, seen, ab);
        break;
      }
      this.hesitateAbility[i] = t + HESITATE_SEC * (0.7 + 0.6 * this.rng.next());
    }
    if (out.ability === null) {
      for (let i = 0; i < me.spells.length; i++) {
        if (!sim.canUseSpell(side, i) || t < (this.hesitateSpell[i] ?? 0)) continue;
        const ab = me.spells[i].ability;
        if (!this.sensible(sim, me, foe, ab, dist, threat, true)) continue;
        if (this.rng.next() < this.profile.abilityUseChance) {
          out.spell = i;
          if (isDamaging(ab)) this.aim(out, sim, me, seen, ab);
          break;
        }
        this.hesitateSpell[i] = t + HESITATE_SEC * (0.7 + 0.6 * this.rng.next());
      }
    }
    return (this.lastInput = out);
  }

  // -------------------------------------------------------------------------

  private navigate(sim: ArenaSim, me: Fighter, foe: Fighter, seen: Seen, dist: number, t: number): [number, number] {
    const ux = (seen.x - me.x) / dist, uy = (seen.y - me.y) / dist;
    if (t >= this.strafeSwitchAt) {
      this.strafeDir = this.rng.next() < 0.5 ? -1 : 1;
      this.strafeSwitchAt = t + 0.8 + this.rng.next() * 1.2;
    }
    // perpendicular strafe direction
    const px = -uy * this.strafeDir, py = ux * this.strafeDir;
    if (me.stats.style === 'ranged') {
      const want = me.stats.range * 0.8;
      const foeMelee = foe.stats.style !== 'ranged';
      const tooClose = foeMelee ? want * 0.75 : want * 0.5;
      if (dist < tooClose) return [-ux * 0.9 + px * 0.45, -uy * 0.9 + py * 0.45];
      if (dist > me.stats.range) return [ux, uy];
      if (dist > want + 15) return [ux * 0.6 + px * 0.5, uy * 0.6 + py * 0.5];
      return [px * 0.6, py * 0.6];
    }
    // melee-ish: close to contact, with a slight arc so it doesn't walk straight into bolts
    const reach = me.stats.range * 0.7 + foe.radius;
    if (dist > reach + 40) return [ux + px * 0.25, uy + py * 0.25];
    if (dist > reach) return [ux, uy];
    return [px * 0.15, py * 0.15];
  }

  private avoidWalls(sim: ArenaSim, me: Fighter, mx: number, my: number): [number, number] {
    const B = sim.bounds;
    const m = me.radius + 8;
    const cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2;
    if ((me.x < B.x0 + m && mx < 0) || (me.x > B.x1 - m && mx > 0)) {
      // slide vertically toward the centre line instead
      const sy = my !== 0 ? Math.sign(my) : Math.sign(cy - me.y) || 1;
      mx = 0; my = sy;
    }
    if ((me.y < B.y0 + m && my < 0) || (me.y > B.y1 - m && my > 0)) {
      const sx = mx !== 0 ? Math.sign(mx) : Math.sign(cx - me.x) || 1;
      my = 0; mx = sx;
    }
    return [mx, my];
  }

  private roll(id: number): boolean {
    let r = this.decided.get(id);
    if (r === undefined) {
      r = this.rng.next() < this.profile.dodgeChance;
      this.decided.set(id, r);
      if (this.decided.size > 64) this.decided.delete(this.decided.keys().next().value as number);
    }
    return r;
  }

  private considerThreats(sim: ArenaSim, me: Fighter, foe: Fighter, seenT: number, t: number): void {
    if (this.dodge && t < this.dodge.until) return;
    // projectiles heading for me
    for (const p of sim.projectiles) {
      if (p.owner === me.side || p.spawnT > seenT) continue;
      const rx = me.x - p.x, ry = me.y - p.y;
      const sp2 = p.vx * p.vx + p.vy * p.vy;
      const tc = (rx * p.vx + ry * p.vy) / sp2; // time to closest approach
      if (tc < 0 || tc > 0.9) continue;
      const cxp = p.x + p.vx * tc - me.x, cyp = p.y + p.vy * tc - me.y;
      const miss = Math.hypot(cxp, cyp);
      if (miss > p.radius + me.radius + 6) continue;
      if (!this.roll(p.id)) continue;
      // sidestep perpendicular to the bolt, away from its line
      const sp = Math.sqrt(sp2);
      let nx = -p.vy / sp, ny = p.vx / sp;
      if (nx * -cxp + ny * -cyp < 0) { nx = -nx; ny = -ny; }
      const B = sim.bounds;
      if (me.y + ny * 20 > B.y1 - me.radius || me.y + ny * 20 < B.y0 + me.radius) { nx = -nx; ny = -ny; }
      this.dodge = { dx: nx, dy: ny, until: t + Math.min(0.5, tc + 0.15) };
      return;
    }
    // telegraphed zones
    for (const z of sim.zones) {
      if (z.owner === me.side || z.spawnT > seenT || z.lockOn) continue;
      const d = Math.hypot(me.x - z.x, me.y - z.y);
      if (d > z.radius + me.radius + 4) continue;
      if (!this.roll(z.id)) continue;
      const l = d || 1;
      let ax = (me.x - z.x) / l, ay = (me.y - z.y) / l;
      if (d < 1) { ax = -me.facing; ay = 0; }
      this.dodge = { dx: ax, dy: ay, until: z.at + 0.05 };
      return;
    }
    // dash crouch / lunge aimed at me: sidestep perpendicular to the lunge
    const a = foe.action;
    if (a && a.kind === 'dash' && a.start <= seenT && t < a.until) {
      const id = -Math.round(a.start * 1000) - 5e6 - foe.side * 1e7;
      if (!this.roll(id)) return;
      const sp = Math.hypot(a.vx, a.vy) || 1;
      let nx = -a.vy / sp, ny = a.vx / sp;
      if (nx * (me.x - foe.x) + ny * (me.y - foe.y) < 0) { nx = -nx; ny = -ny; }
      const B = sim.bounds;
      if (me.y + ny * 20 > B.y1 - me.radius || me.y + ny * 20 < B.y0 + me.radius) { nx = -nx; ny = -ny; }
      this.dodge = { dx: nx, dy: ny, until: a.until + 0.05 };
      return;
    }
    // melee wind-up in reach (step back)
    if (a && a.kind === 'melee' && a.start <= seenT && t < a.strikeAt) {
      const id = -Math.round(a.start * 1000) - 1 - foe.side * 1e7;
      if (!this.roll(id)) return;
      const l = Math.hypot(me.x - foe.x, me.y - foe.y) || 1;
      this.dodge = { dx: (me.x - foe.x) / l, dy: (me.y - foe.y) / l, until: a.strikeAt + 0.05 };
    }
  }

  private underThreat(sim: ArenaSim, me: Fighter, foe: Fighter, seenT: number, dist: number): boolean {
    for (const p of sim.projectiles) {
      if (p.owner === me.side || p.spawnT > seenT) continue;
      const d = Math.hypot(me.x - p.x, me.y - p.y);
      if (d < 90 && (p.vx * (me.x - p.x) + p.vy * (me.y - p.y)) > 0) return true;
    }
    for (const z of sim.zones) if (z.owner !== me.side && z.spawnT <= seenT) return true;
    if (foe.stats.style !== 'ranged' && dist < foe.stats.range + me.radius + 20) return true;
    return false;
  }

  private sensible(sim: ArenaSim, me: Fighter, foe: Fighter, ab: ArenaAbility, dist: number, threat: boolean, isSpell: boolean): boolean {
    const S = TUNING.arena.sim;
    const myHp = sim.hpFrac(me.side), foeHp = sim.hpFrac(foe.side);
    // Spells are once per fight: hold them until they matter (GDD 3.7: prefer when losing).
    if (isSpell) {
      const pressing = myHp < 0.5 || foeHp < 0.4 || sim.t > 12 || (myHp < foeHp - 0.15);
      if (!pressing && ab.kind !== 'heal') return false;
    }
    switch (ab.kind) {
      case 'projectile':
        return dist < 230;
      case 'dash':
        return dist < S.dashDistance + me.radius + foe.radius - 4 && dist > me.radius + foe.radius - 2;
      case 'aoe':
        return isSpell ? dist < 300 : dist < S.aoeRadius + foe.radius - 8;
      case 'stun':
        if (isSpell) return dist < me.stats.range + foe.radius + 30;
        if (me.stats.style === 'ranged') return dist < 200;
        return dist < me.stats.range + S.stunReachBonus + foe.radius - 4;
      case 'shield':
        return threat || (myHp < 0.6 && dist < 80);
      case 'heal':
        return !sim.suddenDeath && myHp < (isSpell ? 0.5 : 0.6) && 1 - myHp >= (ab.magnitude ?? 0.2) * 0.8;
      case 'buff':
        return dist < (me.stats.style === 'ranged' ? me.stats.range : me.stats.range + foe.radius + 40);
      default:
        return false;
    }
  }

  private aim(out: FighterInput, sim: ArenaSim, me: Fighter, seen: Seen, ab: ArenaAbility): void {
    const S = TUNING.arena.sim;
    let tx = seen.x, ty = seen.y;
    const d = Math.hypot(seen.x - me.x, seen.y - me.y);
    let tFlight = 0;
    if (ab.kind === 'projectile' || (ab.kind === 'stun' && me.stats.style === 'ranged')) tFlight = d / S.abilityProjectileSpeed;
    else if (ab.kind === 'dash') tFlight = S.dashWindupSec + (d / S.dashDistance) * S.dashSec;
    if (tFlight > 0) {
      tx += seen.vx * tFlight * this.profile.leadFrac;
      ty += seen.vy * tFlight * this.profile.leadFrac;
    }
    let ax = tx - me.x, ay = ty - me.y;
    const err = ((2 * this.rng.next() - 1) * this.profile.aimErrorDeg * Math.PI) / 180;
    const c = Math.cos(err), s = Math.sin(err);
    [ax, ay] = [ax * c - ay * s, ax * s + ay * c];
    if (ax === 0 && ay === 0) ax = me.facing;
    out.aimX = ax; out.aimY = ay;
  }
}
