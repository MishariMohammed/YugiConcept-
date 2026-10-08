import Phaser from 'phaser';
import type { ArenaResult } from '../core/types';
import { SCENES, finishArena, type ArenaSceneData } from './SceneBus';
import { label } from './ui';

/**
 * PLACEHOLDER arena (Arena Combat Developer replaces this with the real-time fight).
 * Contract: receives ArenaSceneData via launch(); must call finishArena(this, result) once.
 * Here: shows both monsters and after 1.5 s the higher battle stat wins.
 */
export class ArenaScene extends Phaser.Scene {
  constructor() { super(SCENES.Arena); }

  create(data: ArenaSceneData): void {
    const { width, height } = this.scale;
    const { attacker, defender } = data.request;
    this.add.rectangle(0, 0, width, height, 0x0d0a14, 0.92).setOrigin(0);
    label(this, width / 2, 30, 'ARENA', { fontSize: '16px', color: '#ffd166' }).setOrigin(0.5);
    const defStat = defender.position === 'attack' ? defender.atk : defender.defStat;
    label(this, width * 0.25, height / 2, `${attacker.def.name}\nATK ${attacker.atk}`, { align: 'center' }).setOrigin(0.5);
    label(this, width / 2, height / 2, 'VS', { fontSize: '12px', color: '#ff6b6b' }).setOrigin(0.5);
    label(this, width * 0.75, height / 2,
      `${defender.def.name}\n${defender.position === 'attack' ? 'ATK' : 'DEF'} ${defStat}`, { align: 'center' }).setOrigin(0.5);

    this.time.delayedCall(1500, () => {
      const winner: ArenaResult['winner'] =
        attacker.atk > defStat ? 'attacker' : attacker.atk < defStat ? 'defender' : 'draw';
      finishArena(this, {
        winner,
        attackerHpFrac: winner === 'attacker' ? 0.5 : 0,
        defenderHpFrac: winner === 'defender' ? 0.5 : 0,
        durationSec: 1.5,
        spellsUsed: [[], []],
      });
    });
  }
}
