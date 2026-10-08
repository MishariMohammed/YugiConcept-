# YugiConcept card list

Generated from `src/data/cards.json` (55 cards). Validate with `npx tsx tools/validate-cards.ts`.
Private, non-distributed project: real classic-era card names and stats; no official artwork.

Legend: **Deck** Y = Yugi (player), K = Kaiba (NPC), *pool* = in the card pool but not in a starter deck.
**Style** in italics = the type default from `Formulas.styleForType`; bold = explicit `arenaStyle` override.
Ability numbers: `pow` = multiplier on the monster's Power, `cd` = cooldown, `mag` = shield reduction / heal fraction / buff multiplier.
Every monster's ability set fits the per-level value budget in `TUNING.abilities` (`Formulas.validateAbilities`).

## Monsters

| Card | Deck | Attr / Type | Lv | ATK/DEF | Style | Arena abilities | Duel effect |
|---|---|---|---|---|---|---|---|
| Dark Magician (Normal) | Y×1 | DARK Spellcaster | 7 | 2500/2100 | *ranged* | **Dark Magic Attack** (projectile; pow 2.2, cd 5s) | — |
| Dark Magician Girl | Y×1 | DARK Spellcaster | 6 | 2000/1700 | *ranged* | **Dark Burning Attack** (projectile; pow 1.6, cd 6s)<br>**Master's Blessing** (buff; cd 8s, 3s, mag 1.3) | Gains 300 ATK for each "Dark Magician" in either player's Graveyard. — `atkPerNamedInGraveyards` {cardId:dark-magician,atk:300,scope:both} |
| Celtic Guardian (Normal) | Y×1 | EARTH Warrior | 4 | 1400/1200 | **swift** | **Elven Blade Flurry** (dash; pow 1.6, cd 6s) | — |
| Summoned Skull (Normal) | Y×1 | DARK Fiend | 6 | 2500/1200 | **bruiser** | **Lightning Strike** (aoe; pow 2.3, cd 7s) | — |
| Curse of Dragon (Normal) | Y×1 | DARK Dragon | 5 | 2000/1500 | **ranged** | **Dragon Flame** (projectile; pow 2, cd 5.5s) | — |
| Gaia The Fierce Knight (Normal) | Y×1 | EARTH Warrior | 7 | 2300/2100 | **swift** | **Spiral Spear Charge** (dash; pow 2, cd 4.5s) | — |
| Alpha The Magnet Warrior (Normal) | Y×1 | EARTH Rock | 4 | 1400/1700 | **melee** | **Magnet Sword Slash** (dash; pow 1.6, cd 6s) | — |
| Beta The Magnet Warrior (Normal) | Y×1 | EARTH Rock | 4 | 1700/1600 | *bruiser* | **Magnet Shield** (shield; cd 7s, 3s, mag 0.5) | — |
| Gamma The Magnet Warrior (Normal) | Y×1 | EARTH Rock | 4 | 1500/1800 | *bruiser* | **Magnetic Pulse** (stun; pow 0.8, cd 7s, 0.8s) | — |
| Giant Soldier of Stone (Normal) | Y×1 | EARTH Rock | 3 | 1300/2000 | *bruiser* | **Stone Wall** (shield; cd 7s, 3s, mag 0.5) | — |
| Kuriboh | Y×1 | DARK Fiend | 1 | 300/200 | **swift** | **Fuzzball Guard** (shield; cd 8s, 2s, mag 0.5)<br>**Kuri Burst** (aoe; pow 1.5, cd 10s) | If this card is destroyed by battle, you take no battle damage from that battle. — `noBattleDamageWhenDestroyed` |
| Big Shield Gardna | Y×1 | EARTH Warrior | 4 | 100/2600 | **bruiser** | **Big Shield** (shield; cd 8s, 3s, mag 0.5)<br>**Shield Bash** (stun; pow 0.5, cd 10s, 0.6s) | If this Defense Position card is attacked, change it to Attack Position after the battle. — `switchToAttackAfterAttacked` |
| Feral Imp (Normal) | Y×1 | DARK Fiend | 4 | 1300/1400 | **ranged** | **Horn Lightning** (projectile; pow 1.6, cd 6s) | — |
| Mystical Elf (Normal) | Y×1 | LIGHT Spellcaster | 4 | 800/2000 | *ranged* | **Elven Prayer** (heal; cd 8s, mag 0.2) | — |
| Silver Fang (Normal) | Y×1 | EARTH Beast | 3 | 1200/800 | *swift* | **Fang Pounce** (dash; pow 1.5, cd 6s) | — |
| Mammoth Graveyard (Normal) | Y×1 | EARTH Dinosaur | 3 | 1200/800 | *bruiser* | **Tusk Stampede** (dash; pow 1.7, cd 6s) | — |
| Breaker the Magical Warrior | Y×1 | DARK Spellcaster | 4 | 1600/1000 | **melee** | **Mana Blade** (dash; pow 1.2, cd 7s)<br>**Spell Break** (stun; pow 0.4, cd 10s, 0.6s) | When Normal Summoned: gains 300 ATK. Once while face-up, you can remove that bonus to destroy 1 Spell/Trap on the field. — `breakerCounter` {atk:300} |
| Blue-Eyes White Dragon (Normal) | K×3 | LIGHT Dragon | 8 | 3000/2500 | *bruiser* | **Burst Stream of Destruction** (projectile; pow 2.5, cd 6s) | — |
| Lord of D. | K×1 | DARK Spellcaster | 4 | 1200/1100 | *ranged* | **Dread Bolt** (projectile; pow 1, cd 8s)<br>**Dragon Ward** (shield; cd 7s, 2s, mag 0.4) | Dragon-Type monsters on the field cannot be targeted by card effects. — `protectTypeFromTargeting` {types:Dragon} |
| Battle Ox (Normal) | K×1 | EARTH Beast-Warrior | 4 | 1700/1000 | **bruiser** | **Axe Cleave** (aoe; pow 1.6, cd 6s) | — |
| La Jinn the Mystical Genie of the Lamp (Normal) | K×1 | DARK Fiend | 4 | 1800/1000 | **ranged** | **Genie Fist** (projectile; pow 1.7, cd 6s) | — |
| Vorse Raider (Normal) | K×1 | DARK Beast-Warrior | 4 | 1900/1200 | *melee* | **Raider Rampage** (dash; pow 1.7, cd 6s) | — |
| Rude Kaiser (Normal) | K×1 | EARTH Beast-Warrior | 5 | 1800/1600 | **bruiser** | **Twin Axe Spin** (aoe; pow 1.8, cd 6s) | — |
| Ryu-Kishin Powered (Normal) | K×1 | DARK Fiend | 4 | 1600/1200 | *melee* | **Talon Dive** (dash; pow 1.6, cd 6s) | — |
| Hitotsu-Me Giant (Normal) | K×1 | EARTH Beast-Warrior | 4 | 1200/1000 | **bruiser** | **Cyclops Punch** (stun; pow 0.8, cd 7s, 0.8s) | — |
| Saggi the Dark Clown (Normal) | K×1 | DARK Spellcaster | 3 | 600/1500 | *ranged* | **Clown's Hex** (stun; pow 0.5, cd 7s, 0.9s) | — |
| Kaiser Sea Horse | K×1 | LIGHT Sea Serpent | 4 | 1700/1650 | **melee** | **Trident Thrust** (dash; pow 1.2, cd 7s)<br>**Tide Ward** (shield; cd 7s, 2s, mag 0.3) | When you Tribute Summon a LIGHT monster, this card can count as 2 Tributes. — `doubleTribute` {attribute:LIGHT} |
| Judge Man (Normal) | K×1 | EARTH Warrior | 6 | 2200/1500 | **bruiser** | **Gavel Smash** (aoe; pow 2.2, cd 7s) | — |
| Swordstalker | pool | DARK Warrior | 6 | 2000/1600 | *melee* | **Vengeful Blade** (dash; pow 1.5, cd 6s)<br>**Grudge Surge** (buff; cd 10s, 3s, mag 1.3) | Gains 100 ATK for each monster in your Graveyard. — `atkPerOwnGraveyardMonster` {atk:100} |
| X-Head Cannon (Normal) | K×1 | LIGHT Machine | 4 | 1800/1500 | **ranged** | **Twin Cannons** (projectile; pow 1.7, cd 6s) | — |
| Y-Dragon Head | K×1 | LIGHT Machine | 4 | 1500/1600 | **ranged** | **Dragon Head Blaster** (projectile; pow 1.2, cd 7s)<br>**Union Link** (buff; cd 8s, 3s, mag 1.2) | Gains 400 ATK and DEF while you control "X-Head Cannon" (simplified Union). — `allyBoost` {ally:x-head-cannon,atk:400,def:400} |
| Z-Metal Tank | K×1 | LIGHT Machine | 4 | 1500/1300 | *bruiser* | **Tread Ram** (dash; pow 1.2, cd 7s)<br>**Armor Plating** (shield; cd 8s, 2.5s, mag 0.4) | Gains 400 ATK and DEF while you control "X-Head Cannon" (simplified Union). — `allyBoost` {ally:x-head-cannon,atk:400,def:400} |
| Krokodilus (Normal) | K×1 | WATER Reptile | 4 | 1100/1200 | *swift* | **Death Roll** (dash; pow 1.5, cd 6s) | — |
| Hyozanryu (Normal) | pool | LIGHT Dragon | 7 | 2100/2800 | *bruiser* | **Diamond Shard Storm** (aoe; pow 2.4, cd 6s) | — |
| Spear Dragon | K×1 | WIND Dragon | 4 | 1900/0 | **swift** | **Spear Drill Dive** (dash; pow 1.7, cd 6s) | Inflicts piercing battle damage to Defense Position monsters. After it attacks, change it to Defense Position. — `piercing` {defenseAfterAttack:true} |

## Spells and traps

| Card | Deck | Kind | Speed | Text | Effect id |
|---|---|---|---|---|---|
| Pot of Greed | Y×1 K×1 | spell | normal | Draw 2 cards. | `draw` {n:2} |
| Dark Hole | Y×1 | spell | normal | Destroy all monsters on the field. | `destroyAllMonsters` |
| Raigeki | K×1 | spell | normal | Destroy all monsters your opponent controls. | `destroyAllOpponentMonsters` |
| Monster Reborn | Y×1 K×1 | spell | normal | Special Summon 1 monster from either player's Graveyard. | `monsterReborn` {from:either} |
| Swords of Revealing Light ⚔ | Y×1 | spell | continuous | Your opponent's monsters cannot attack for 3 of their turns. ARENA: rain of light swords stuns the foe for 1 s. | `swordsOfRevealingLight` {turns:3} |
| Fissure ⚔ | K×1 | spell | normal | Destroy the face-up monster your opponent controls with the lowest ATK. ARENA: the ground splits under the foe. | `destroyLowestAtkOpponent` |
| Book of Secret Arts | Y×1 | spell | equip | Equip only to a Spellcaster: it gains 300 ATK and DEF. | `equipAtk` {atk:300,def:300,types:Spellcaster} |
| Dark Energy | K×1 | spell | equip | Equip only to a Fiend: it gains 300 ATK and DEF. | `equipAtk` {atk:300,def:300,types:Fiend} |
| Legendary Sword | Y×1 | spell | equip | Equip only to a Warrior: it gains 300 ATK and DEF. | `equipAtk` {atk:300,def:300,types:Warrior} |
| Rush Recklessly ⚔ | Y×1 K×1 | spell | quick | Target 1 face-up monster: it gains 700 ATK until the end of this turn. ARENA: +50% Power for 3 s. | `rushRecklessly` {atk:700} |
| Mystical Space Typhoon | Y×1 K×1 | spell | quick | Target 1 Spell/Trap on the field; destroy it. | `destroyTargetSpellTrap` |
| Dian Keto the Cure Master ⚔ | Y×1 | spell | normal | Gain 1000 LP. ARENA: restore 30% of your monster's max HP. | `heal` {n:1000} |
| Ookazi ⚔ | K×1 | spell | normal | Inflict 800 damage to your opponent. ARENA: hurl a huge fireball at the enemy. | `damage` {n:800} |
| Mirror Force | Y×1 | trap | normal | When an opponent's monster declares an attack: destroy all Attack Position monsters your opponent controls. | `destroyAttackPosition` |
| Trap Hole | K×2 | trap | normal | When your opponent Normal Summons a monster with 1000 or more ATK: destroy it. | `destroySummoned` {minAtk:1000} |
| Sakuretsu Armor | K×1 | trap | normal | When an opponent's monster declares an attack: destroy the attacking monster. | `destroyAttacker` |
| Negate Attack | K×1 | trap | normal | When an opponent's monster declares an attack: negate the attack and end the Battle Phase. | `negateAttack` {endBattlePhase:true} |
| Waboku | Y×1 | trap | normal | When an opponent's monster declares an attack: for the rest of this turn you take no battle damage and your monsters cannot be destroyed by battle. | `waboku` |
| Magic Cylinder | Y×1 | trap | normal | When an opponent's monster declares an attack: negate the attack and inflict damage to your opponent equal to its ATK. | `magicCylinder` |
| Spellbinding Circle | Y×1 | trap | continuous | Target 1 monster your opponent controls: it cannot attack or change its battle position. | `spellbindingCircle` |

⚔ = `arenaUsable`.

## Arena-usable spells

During an arena fight, each side can fire each `arenaUsable` spell in its hand **once per fight**. Firing it **uses up the card**: it goes to the Graveyard and its duel effect does **not** happen. Its arena behavior is stored as the single entry in that card's `arenaAbilities`, with `cooldown: 0` meaning one-shot. Power is a multiplier on the Power of the caster's monster. Damaging spells use `TUNING.abilities.spellPower`, which is 3.0.

| Spell | Arena behavior | Ability | Why it fits |
|---|---|---|---|
| Swords of Revealing Light | Swords of light pin the enemy: stun 1 s. | **Revealing Light** (stun; 1s) | "Cannot attack" lockdown → a brief stun. |
| Fissure | A shockwave of splitting earth bursts around the caster. | **Earth Split** (aoe; pow 3) | Earth-splitting removal → ground-shock burst around the caster. |
| Rush Recklessly | Your monster surges: +50% Power for 3 s. | **Reckless Rush** (buff; 3s, mag 1.5) | Quick-Play combat trick (+700 ATK) → short power surge. |
| Dian Keto the Cure Master | Dian Keto restores 30% max HP. | **Cure Master** (heal; mag 0.3) | Healing card → mid-fight heal. |
| Ookazi | A roaring fireball (2.5x your monster's Power). | **Great Fire** (projectile; pow 3) | Burn spell → the fire goes at the enemy monster instead of the player. |

## Duel effect ids

| Effect id | Params | Semantics | Used by |
|---|---|---|---|
| `allyBoost` | {ally, atk, def} | Continuous self stat mod: +atk/+def while controller has a face-up card with id `ally` (Y-Dragon Head, Z-Metal Tank). | Y-Dragon Head, Z-Metal Tank |
| `atkPerNamedInGraveyards` | {cardId, atk, scope: "both"|"own"} | Continuous self stat mod: +atk for each card with id cardId in the chosen graveyards (Dark Magician Girl). | Dark Magician Girl |
| `atkPerOwnGraveyardMonster` | {atk} | Continuous self stat mod: +atk per monster in controller's GY (Swordstalker). | Swordstalker |
| `breakerCounter` | {atk} | onSelfSummon (Normal Summon): +atk permanent mod and a counter. Ignition (activate from field, target S/T): remove the counter (−atk) to destroy the target. Once. | Breaker the Magical Warrior |
| `damage` | {n} | Inflict n damage to the opponent. Registered. | Ookazi |
| `destroyAllMonsters` | — | Destroy every monster on the field (both sides). | Dark Hole |
| `destroyAllOpponentMonsters` | — | Destroy every monster the opponent controls. Registered. | Raigeki |
| `destroyAttackPosition` | — | Trap (attack declared): destroy all opponent Attack Position monsters; negate the attack. Registered (Mirror Force). | Mirror Force |
| `destroyAttacker` | — | Trap (attack declared): destroy the attacker. Registered (Sakuretsu Armor). | Sakuretsu Armor |
| `destroyLowestAtkOpponent` | — | Destroy the opponent's face-up monster with the lowest ATK (non-targeting; tie → random via ops.random). Not activatable if none face-up. | Fissure |
| `destroySummoned` | {minAtk} | Trap (opponent Normal Summon): destroy it if ATK ≥ minAtk. Registered (Trap Hole). | Trap Hole |
| `destroyTargetSpellTrap` | — | Target 1 Spell/Trap on the field (either side, face-up or set); destroy it. Quick-Play. | Mystical Space Typhoon |
| `doubleTribute` | {attribute} | Tribute rule hook: when tributing for a monster of `attribute`, this card counts as 2 tributes (Kaiser Sea Horse). | Kaiser Sea Horse |
| `draw` | {n} | Controller draws n cards (Pot of Greed: n=2). Registered. | Pot of Greed |
| `equipAtk` | {atk, def, types?} | Equip to a face-up monster: +atk/+def. `types` (comma-separated MonsterType list) restricts legal targets — the registered handler does not check `types` yet. | Book of Secret Arts, Dark Energy, Legendary Sword |
| `heal` | {n} | Controller gains n LP. Registered. | Dian Keto the Cure Master |
| `magicCylinder` | — | Trap (attack declared): negate the attack and inflict damage to the attacker's controller equal to the attacker's current ATK. | Magic Cylinder |
| `monsterReborn` | {from: "either"} | Target a monster in either GY; Special Summon it under your control (face-up Attack by default). | Monster Reborn |
| `negateAttack` | {endBattlePhase?} | Trap (attack declared): negate the attack; if endBattlePhase, end the opponent's Battle Phase. Registered (does not end BP yet). | Negate Attack |
| `noBattleDamageWhenDestroyed` | — | If this monster is destroyed by battle, its controller takes 0 battle damage from that battle (Kuriboh). | Kuriboh |
| `piercing` | {defenseAfterAttack} | Battle hook: when this attacks a Defense Position monster and wins, inflict ATK−DEF to the opponent; if defenseAfterAttack, switch to Defense Position after attacking (Spear Dragon). | Spear Dragon |
| `protectTypeFromTargeting` | {types} | Continuous while face-up: monsters of `types` on the field cannot be chosen by getTargets of card effects (Lord of D.). | Lord of D. |
| `rushRecklessly` | {atk} | Target 1 face-up monster: +atk until end of turn (temporary mod, cleared at End Phase). | Rush Recklessly |
| `spellbindingCircle` | — | Continuous trap, manual activation with target (opponent monster): it cannot attack or change position while this card stays face-up. Destroyed if the target leaves the field. | Spellbinding Circle |
| `switchToAttackAfterAttacked` | — | If this monster was attacked while in Defense Position and survives, switch it to Attack Position after the battle (Big Shield Gardna). | Big Shield Gardna |
| `swordsOfRevealingLight` | {turns} | Continuous: opponent's monsters cannot declare attacks; flip opponent face-down monsters face-up on activation; self-destructs after `turns` opponent turns. | Swords of Revealing Light |
| `waboku` | — | Trap (attack declared): for the rest of the turn, controller takes 0 battle damage and its monsters cannot be destroyed by battle (arena still plays; loser survives). | Waboku |
