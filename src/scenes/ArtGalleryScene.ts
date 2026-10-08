/// <reference types="vite/client" />
// Debug gallery for the procedural art (key 'ArtGallery'). Pages:
//   0 cards (hand size + inspect + back)   1 monster sprites   2-4 arenas (meadow/ruins/dungeon)
// Tap right/left half or use arrow keys to change page. URL ?page=N opens a page directly.

import Phaser from 'phaser';
import type { CardDef } from '../core/types';
import { CardView } from '../ui/CardView';
import { pixelText, ensurePixelFonts } from '../ui/PixelText';
import { addSwirlBackground, SWIRL_PRESETS } from '../ui/Background';
import { ensureMonsterSpritesheet, ensureShadowTexture, ensureProjectileTexture, MonAnim } from '../fx/art/MonsterSprite';
import { buildArenaBackground, ArenaKind } from '../fx/art/ArenaTiles';
import { burst, damageNumber, flashWhite, hitStop, shake, ensureFxTextures, slash } from '../fx/Juice';
import { PALT } from '../fx/art/Palette';

export const SAMPLE_CARDS: CardDef[] = [
  { id: 'sample-dark-magician', name: 'Dark Magician', kind: 'monster', text: 'The ultimate wizard in terms of attack and defense.', attribute: 'DARK', monsterType: 'Spellcaster', level: 7, atk: 2500, def: 2100, palette: ['#6a3aa8', '#3a2a7a', '#5ae0ff', '#f2c69b'], rarity: 'ultra' },
  { id: 'sample-blue-eyes', name: 'Blue-Eyes White Dragon', kind: 'monster', text: 'This legendary dragon is a powerful engine of destruction.', attribute: 'LIGHT', monsterType: 'Dragon', level: 8, atk: 3000, def: 2500, palette: ['#e8f0ff', '#8ab0e8', '#4ad0ff'], rarity: 'ultra' },
  { id: 'sample-celtic-guardian', name: 'Celtic Guardian', kind: 'monster', text: 'An elf who learned to wield a sword, he baffles enemies with lightning-swift attacks.', attribute: 'EARTH', monsterType: 'Warrior', level: 4, atk: 1400, def: 1200, palette: ['#4a8a4a', '#c8a050', '#e04a3a', '#b8c4d0'], rarity: 'common' },
  { id: 'sample-silver-fang', name: 'Silver Fang', kind: 'monster', text: 'A snow wolf that is beautiful to behold, but deadly.', attribute: 'EARTH', monsterType: 'Beast', level: 3, atk: 1200, def: 800, palette: ['#c8d0dc', '#f0f4f8', '#4a7ae0'], rarity: 'common' },
  { id: 'sample-kuriboh', name: 'Kuriboh', kind: 'monster', text: 'Discard this card: take no battle damage this turn.', attribute: 'DARK', monsterType: 'Fiend', level: 1, atk: 300, def: 200, isEffect: true, palette: ['#9a6a3a', '#5a3a2a', '#40c040', '#4a8a3a'], rarity: 'rare' },
  { id: 'sample-summoned-skull', name: 'Summoned Skull', kind: 'monster', text: 'A fiend with dark powers for confusing the enemy.', attribute: 'DARK', monsterType: 'Fiend', level: 6, atk: 2500, def: 1200, palette: ['#d8d0c0', '#5a3a6a', '#ff4a3a'], rarity: 'super' },
  { id: 'sample-x-head-cannon', name: 'X-Head Cannon', kind: 'monster', text: 'A monster with a mighty cannon barrel.', attribute: 'LIGHT', monsterType: 'Machine', level: 4, atk: 1800, def: 1500, palette: ['#3a6ac8', '#4a5468', '#ffd040', '#c8d0dc'] },
  { id: 'sample-harpie-lady', name: 'Harpie Lady', kind: 'monster', text: 'This human-shaped animal with wings is beautiful to watch.', attribute: 'WIND', monsterType: 'Winged Beast', level: 4, atk: 1300, def: 1400, palette: ['#7ac0e0', '#f0e0c0', '#e05a8a'] },
  { id: 'sample-man-eater-bug', name: 'Man-Eater Bug', kind: 'monster', text: 'FLIP: Target 1 monster on the field; destroy it.', attribute: 'EARTH', monsterType: 'Insect', level: 2, atk: 450, def: 600, isEffect: true, palette: ['#8a6ac0', '#e0d0a0', '#e04a3a'] },
  { id: 'sample-giant-soldier', name: 'Giant Soldier of Stone', kind: 'monster', text: 'A giant warrior made of stone.', attribute: 'EARTH', monsterType: 'Rock', level: 3, atk: 1300, def: 2000 },
  { id: 'sample-mystic-tomato', name: 'Mystic Tomato', kind: 'monster', text: 'When destroyed by battle: special summon 1 DARK monster with 1500 or less ATK.', attribute: 'DARK', monsterType: 'Plant', level: 4, atk: 1400, def: 1100, isEffect: true, palette: ['#4a9a40', '#e0402a', '#ffd84a'] },
  { id: 'sample-fortress-whale', name: 'Fortress Whale', kind: 'monster', text: 'A whale with a fortress on its back.', attribute: 'WATER', monsterType: 'Fish', level: 7, atk: 2350, def: 2150 },
  { id: 'sample-thunder-kid', name: 'Thunder Kid', kind: 'monster', text: 'A small thunder spirit.', attribute: 'LIGHT', monsterType: 'Thunder', level: 3, atk: 1200, def: 1000 },
  { id: 'sample-hinotama-soul', name: 'Hinotama Soul', kind: 'monster', text: 'A ball of fire.', attribute: 'FIRE', monsterType: 'Pyro', level: 2, atk: 600, def: 500 },
  { id: 'sample-baby-dragon', name: 'Baby Dragon', kind: 'monster', text: 'Small but powerful.', attribute: 'WIND', monsterType: 'Dragon', level: 3, atk: 1200, def: 700, palette: ['#f0a040', '#f8e0a0', '#e04a3a'] },
  { id: 'sample-mystical-elf', name: 'Mystical Elf', kind: 'monster', text: 'A delicate elf.', attribute: 'LIGHT', monsterType: 'Spellcaster', level: 4, atk: 800, def: 2000, palette: ['#3a8a6a', '#f0e8c0', '#ffd75e', '#f2c69b'] },
  { id: 'sample-dark-hole', name: 'Dark Hole', kind: 'spell', speed: 'normal', text: 'Destroy all monsters on the field.', effect: { id: 'destroyAllMonsters' }, rarity: 'rare' },
  { id: 'sample-monster-reborn', name: 'Monster Reborn', kind: 'spell', speed: 'normal', text: 'Target 1 monster in either GY; Special Summon it.', effect: { id: 'reborn' }, rarity: 'super' },
  { id: 'sample-pot-of-greed', name: 'Pot of Greed', kind: 'spell', speed: 'normal', text: 'Draw 2 cards.', effect: { id: 'draw' } },
  { id: 'sample-swords', name: 'Swords of Revealing Light', kind: 'spell', speed: 'continuous', text: 'Your opponent\'s monsters cannot declare an attack for 3 turns.' },
  { id: 'sample-rush-recklessly', name: 'Rush Recklessly', kind: 'spell', speed: 'quick', text: 'Target 1 face-up monster; it gains 700 ATK until the end of this turn.', arenaUsable: true },
  { id: 'sample-mirror-force', name: 'Mirror Force', kind: 'trap', speed: 'normal', text: 'When an opponent\'s monster declares an attack: destroy all their Attack Position monsters.', rarity: 'ultra' },
  { id: 'sample-trap-hole', name: 'Trap Hole', kind: 'trap', speed: 'normal', text: 'When your opponent Normal Summons a monster with 1000 or more ATK: destroy it.' },
];

function loadDataCards(): CardDef[] {
  try {
    const mods = import.meta.glob('../data/*.json', { eager: true }) as Record<string, { default?: unknown }>;
    for (const m of Object.values(mods)) {
      const d = (m.default ?? m) as unknown;
      const arr = Array.isArray(d) ? d : (d as { cards?: unknown[] })?.cards;
      if (Array.isArray(arr) && arr.length && typeof arr[0] === 'object' && arr[0] && 'kind' in (arr[0] as object)) return arr as CardDef[];
    }
  } catch { /* data not ready */ }
  return [];
}

const PAGES = ['CARDS', 'MONSTERS', 'MEADOW', 'RUINS', 'DUNGEON', 'ALL CARDS'] as const;

export class ArtGalleryScene extends Phaser.Scene {
  private page = 0;
  private cards: CardDef[] = SAMPLE_CARDS;
  private layer?: Phaser.GameObjects.Container;
  private timers: Phaser.Time.TimerEvent[] = [];

  constructor() { super('ArtGallery'); }

  create(): void {
    ensurePixelFonts(this);
    ensureFxTextures(this);
    ensureShadowTexture(this);
    const data = loadDataCards();
    if (data.length) this.cards = data;
    const q = new URLSearchParams(window.location.search).get('page');
    this.page = q ? Math.max(0, Math.min(PAGES.length - 1, parseInt(q, 10) || 0)) : 0;
    this.input.keyboard?.on('keydown-RIGHT', () => this.go(1));
    this.input.keyboard?.on('keydown-LEFT', () => this.go(-1));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: unknown[]) => {
      if (over.length) return;
      this.go(p.x > this.scale.width / 2 ? 1 : -1);
    });
    this.show();
  }

  private go(d: number): void {
    this.page = (this.page + d + PAGES.length) % PAGES.length;
    this.show();
  }

  private clear(): void {
    this.timers.forEach((t) => t.remove());
    this.timers = [];
    this.children.removeAll(true);
  }

  private header(title: string): void {
    pixelText(this, 6, 4, `ART GALLERY - ${title}`, 1, PALT.gold).setDepth(2000);
    pixelText(this, 474, 4, `${this.page + 1}/${PAGES.length}  < >`, 1, PALT.haze, { originX: 1, tiny: false }).setDepth(2000);
  }

  private show(): void {
    this.clear();
    switch (this.page) {
      case 0: this.pageCards(); break;
      case 1: this.pageMonsters(); break;
      case 2: this.pageArena('meadow'); break;
      case 3: this.pageArena('ruins'); break;
      case 4: this.pageArena('dungeon'); break;
      case 5: this.pageAllCards(); break;
    }
  }

  private pageCards(): void {
    addSwirlBackground(this, { colors: SWIRL_PRESETS.duel });
    this.header('CARDS');
    const pick = (id: string) => this.cards.find((c) => c.id === id) ?? this.cards[0];
    const sm = SAMPLE_CARDS;
    const row1 = [sm[0], sm[2], sm[4], sm[5], sm[6], sm[7]];
    const row2 = [sm[16], sm[17], sm[18], sm[20], sm[21], sm[22]];
    const views: CardView[] = [];
    row1.forEach((c, i) => views.push(new CardView(this, 36 + i * 54, 64, c, { draggable: true })));
    row2.forEach((c, i) => views.push(new CardView(this, 36 + i * 54, 150, c, { draggable: true })));
    views.forEach((v) => {
      v.setHome(v.x, v.y);
      v.on('cardDrop', () => v.returnHome());
      v.on('cardTap', () => { v.playSummonBounce(); });
    });
    const back = new CardView(this, 36, 232, sm[0], { faceDown: true });
    back.setHighlight(PALT.blue);
    pixelText(this, 66, 222, 'CARD BACK  /  TAP: SUMMON BOUNCE  /  DRAG ME', 1, PALT.cream, { tiny: true });
    pixelText(this, 66, 232, 'HOVER: TILT + LIFT  /  FOIL ON SUPER+ULTRA', 1, PALT.haze, { tiny: true });
    const big = new CardView(this, 410, 132, pick('sample-blue-eyes'), { large: true });
    big.setHome(big.x, big.y);
    let i = 0;
    const insp = [sm[1], sm[0], sm[20], sm[21], sm[4], sm[11]];
    this.timers.push(this.time.addEvent({ delay: 2600, loop: true, callback: () => {
      i = (i + 1) % insp.length;
      big.flip(true).then(() => { big.setCard(insp[i]); return big.flip(false); });
      const v = views[Math.floor(Math.random() * views.length)];
      v.playSummonBounce();
    } }));
  }

  private pageMonsters(): void {
    const bg = buildArenaBackground(this, 'meadow', 480, 270);
    this.add.image(0, 0, bg.key).setOrigin(0).setAlpha(0.55);
    this.add.rectangle(0, 0, 480, 270, PALT.night, 0.35).setOrigin(0);
    this.header('MONSTER SPRITES');
    const mons = SAMPLE_CARDS.filter((c) => c.kind === 'monster');
    const anims: MonAnim[] = ['idle', 'walk', 'attack', 'idle', 'hit', 'ko'];
    mons.forEach((def, i) => {
      const col = i % 8, row = Math.floor(i / 8);
      const x = 32 + col * 59, y = 92 + row * 112;
      const info = ensureMonsterSpritesheet(this, def);
      this.add.image(x, y + 1, 'fx-shadow').setScale(info.size / 32, 1);
      const spr = this.add.sprite(x, y, info.key, 0).setOrigin(0.5, info.footY / info.size).setScale(info.size > 32 ? 1 : 1.5);
      spr.play(info.anims.idle);
      // static strip of every frame below (scaled 1x)
      pixelText(this, x, y + 6, def.name.split(' ')[0], 1, PALT.cream, { tiny: true, originX: 0.5 });
      let a = i % anims.length;
      this.timers.push(this.time.addEvent({ delay: 1200, loop: true, callback: () => {
        a = (a + 1) % anims.length;
        const an = anims[a];
        spr.play(info.anims[an]);
        if (an === 'hit') flashWhite(spr, 90);
        if (an === 'attack') { spr.chain(info.anims.idle); }
        if (an === 'ko') spr.chain(info.anims.idle);
      } }));
    });
    // full frame strip of one monster
    const strip = ensureMonsterSpritesheet(this, mons[0]);
    for (let f = 0; f < 15; f++) this.add.image(14 + f * 32, 252, strip.key, f).setScale(0.62);
  }

  private pageArena(kind: ArenaKind): void {
    const bg = buildArenaBackground(this, kind, 480, 270);
    this.add.image(0, 0, bg.key).setOrigin(0);
    this.header(`ARENA ${kind.toUpperCase()}`);
    const f = bg.floor;
    const g = this.add.graphics().lineStyle(1, 0xffffff, 0.25).strokeRect(f.x, f.y, f.width, f.height);
    void g;
    const a = SAMPLE_CARDS[kind === 'meadow' ? 2 : kind === 'ruins' ? 0 : 1];
    const b = SAMPLE_CARDS[kind === 'meadow' ? 3 : kind === 'ruins' ? 5 : 11];
    const ia = ensureMonsterSpritesheet(this, a), ib = ensureMonsterSpritesheet(this, b);
    const ay = f.y + f.height * 0.6, by = f.y + f.height * 0.6;
    this.add.image(f.x + f.width * 0.32, ay + 2, 'fx-shadow').setScale(ia.size / 22, 1.2);
    this.add.image(f.x + f.width * 0.68, by + 2, 'fx-shadow').setScale(ib.size / 22, 1.2);
    const sa = this.add.sprite(f.x + f.width * 0.32, ay, ia.key, 0).setOrigin(0.5, ia.footY / ia.size).setScale(1.5).play(ia.anims.idle);
    const sb = this.add.sprite(f.x + f.width * 0.68, by, ib.key, 0).setOrigin(0.5, ib.footY / ib.size).setScale(1.5).setFlipX(true).play(ib.anims.idle);
    const proj = ensureProjectileTexture(this, a.attribute);
    let turn = 0;
    this.timers.push(this.time.addEvent({ delay: 1500, loop: true, callback: () => {
      const atk = turn % 2 === 0 ? sa : sb, def = turn % 2 === 0 ? sb : sa;
      const ai = turn % 2 === 0 ? ia : ib, di = turn % 2 === 0 ? ib : ia;
      turn++;
      atk.play(ai.anims.attack).chain(ai.anims.idle);
      if (turn % 3 === 0) {
        const p = this.add.image(atk.x, atk.y - 20, proj).setScale(1.5);
        this.tweens.add({ targets: p, x: def.x, duration: 260, onComplete: () => p.destroy() });
      }
      this.time.delayedCall(140, () => {
        def.play(di.anims.hit).chain(di.anims.idle);
        flashWhite(def, 90);
        hitStop(this, 70);
        shake(this, 0.006);
        const crit = turn % 4 === 0;
        slash(this, def.x, def.y - 20, atk.flipX);
        burst(this, def.x, def.y - 22, { count: crit ? 20 : 10, texture: 'px-spark', colors: [PALT.white, PALT.gold, PALT.orange] });
        damageNumber(this, def.x, def.y - 40, crit ? 312 : 120 + Math.floor(Math.random() * 60), { crit });
      });
    } }));
  }

  private pageAllCards(): void {
    addSwirlBackground(this, { colors: SWIRL_PRESETS.menu });
    this.header(`ALL CARDS (${this.cards.length})`);
    const list = this.cards.slice(0, 27);
    list.forEach((c, i) => {
      const col = i % 9, row = Math.floor(i / 9);
      new CardView(this, 30 + col * 52, 58 + row * 76, c, { idle: true });
    });
  }
}
