# YugiConcept — Game Design Document

> **Private and personal use only.** It uses real Yu-Gi-Oh! card names and stats as text data and has no official artwork.
> The numbers in this document live in `src/core/combat/Formulas.ts` → `TUNING`. When the two disagree, the code wins.
> The balance tools are:
> - `npm run sim` (`tools/balance-sim.ts`): the real ArenaSim and ArenaAI, plus whole duels with DuelAI. It is the source of truth.
> - `npx tsx tools/arena-model.ts`: the original abstract model, kept for quick what-ifs.

## 1. Pitch
YugiConcept is a streamlined 1v1 Yu-Gi-Oh! duel against an NPC. When a monster attacks another monster, a **short real-time arena fight** (8–15 s) decides the battle:
- **ATK** drives damage output.
- **DEF** drives toughness.
- Card effects become arena abilities.
- Stats dominate the outcome, but skill can swing close fights.

A whole match lasts **8–12 minutes** and includes about **5–8 arena fights**. Measured in Wave 3: a median of 8.4 min with 7 fights (Section 7).

---

## 2. Duel rules

### 2.1 Setup
| Item | Value |
|---|---|
| Starting LP | **8000** (Wave 3: 4000 gave 3–4 min matches; see Section 7) |
| Deck | **30** cards (max 3 copies) |
| Opening hand | **5** |
| Hand limit | **6**: at End Phase, discard down to 6 |
| Zones | 5 monster and 5 spell/trap per player. No Extra Deck, no Field zone (Field spells use a spell/trap zone). |
| First player | Chosen by coin flip (seeded RNG). **Skips their first draw** and **cannot attack on turn 1**. |
| Win | Opponent LP ≤ 0, or the opponent must draw from an empty deck. Both reaching 0 LP at once = draw. |

There are no chains: each card resolves immediately when activated. A trap gets a single "response window" when it is triggered (see 2.4).

### 2.2 Turn flow
1. **Draw Phase**: draw 1 (skipped on turn 1 for the first player).
2. **Main Phase**: in any order:
   - **1 Normal Summon or Set** per turn.
     - Level 1–4: no tribute.
     - **Level 5–6: 1 tribute.**
     - **Level 7+: 2 tributes.**
   - Activate spells, or set spells/traps face-down (a set trap cannot be activated the turn it was set; a set Quick-Play spell can).
   - Change a monster's battle position, once per monster per turn. A monster cannot change position on the turn it was summoned or after it attacked.
   - Flip Summon: a face-down Defense monster becomes face-up Attack. This counts as its position change.
3. **Battle Phase**: each face-up Attack Position monster may attack once.
   - If the opponent controls no monsters, the attack is a **direct attack**: no arena, and the opponent loses LP equal to the attacker's ATK.
   - Otherwise the attacker must target a monster, and the fight goes to the **arena** (Section 3).
   - Attacking a **face-down** monster first flips it face-up in Defense Position (its flip effect resolves), then the arena starts.
4. **End Phase**: discard down to the hand limit, end-of-turn effects resolve, and the turn passes.

There is no second Main Phase, to save pacing time.

### 2.3 Positions
- **Attack Position**: can attack. Its battle stat is **ATK**.
- **Defense Position** (face-up or face-down): cannot attack. Its battle stat is **DEF**.
- A face-down set monster is always in Defense Position.

### 2.4 Traps (streamlined)
A set trap has an auto-prompt window at its trigger, for example "when an opponent's monster declares an attack" (Mirror Force-like or Negate Attack-like cards). The owner may activate it or decline it. The trap resolves immediately and may cancel the attack before the arena starts. The NPC decides by its AI heuristics.

### 2.5 Battle damage table
In the formulas below, `gap` is the real Yu-Gi-Oh! comparison:
- Attacker's ATK − defender's **ATK** when the defender is in Attack Position.
- Attacker's ATK − defender's **DEF** when the defender is in Defense Position.

`perf(h) = 0.75 + 0.75·h` is the performance multiplier, where `h` is the arena **winner's** remaining HP fraction (0..1). It gives **0.75–1.5**.

The base damage depends on which side won the arena:
- If the higher-stat side won: `|gap|`.
- If the stats were equal: `100` (`minBattleDamage`).
- If the lower-stat side won (an *upset*): `max(100, |gap| × 0.5)`.

Damage is rounded to the nearest 10.

| Defender position | Arena result | Attacker | Defender | LP damage |
|---|---|---|---|---|
| Attack | Attacker wins, ATK > ATK | survives | **destroyed** | defending player: `gap × perf(hA)` |
| Attack | Attacker wins, ATK = ATK | survives | destroyed | defending player: `100 × perf(hA)` |
| Attack | Attacker wins, ATK < ATK (upset) | survives | destroyed | defending player: `max(100, |gap|·0.5) × perf(hA)` |
| Attack | Defender wins, ATK < ATK | **destroyed** | survives | attacking player: `|gap| × perf(hD)` |
| Attack | Defender wins, ATK = ATK | destroyed | survives | attacking player: `100 × perf(hD)` |
| Attack | Defender wins, ATK > ATK (upset) | destroyed | survives | attacking player: `max(100, |gap|·0.5) × perf(hD)` |
| Attack | **Draw** | destroyed | destroyed | none (YGO equal-ATK rule) |
| Defense | Attacker wins (any stats) | survives | destroyed | **none** (no piercing by default) |
| Defense | Defender wins, DEF > ATK | **destroyed** | survives | attacking player: `gap × perf(hD)` |
| Defense | Defender wins, DEF = ATK | destroyed | survives | attacking player: `100 × perf(hD)` |
| Defense | Defender wins, DEF < ATK (upset) | destroyed | survives | attacking player: `max(100, |gap|·0.5) × perf(hD)` |
| Defense | **Draw** | survives | survives | none (YGO ATK = DEF rule) |
| — | Direct attack (no arena) | — | — | defending player: **ATK × 0.4** (`directAttackMult`), rounded to 10, no performance multiplier |

**The defending player never takes damage while their monster is in Defense Position.**

**Why direct attacks deal ×0.4.** With full-ATK direct attacks, 64% of all LP damage came from direct hits, and matches ended in 3 min. Softening direct attacks keeps matches in the target window. With 8000 LP, a Blue-Eyes direct attack deals 1200 (15% of LP). The real game's 3000 of 8000 is 37.5%. DuelAI's lethal and threat math uses the same multiplier.

This mapping is implemented by `resolveBattle(attackerAtk, {atk, def, position}, arenaResult)`. It returns `{attackerDestroyed, defenderDestroyed, lpDamage: [toAttackingPlayer, toDefendingPlayer]}`.

**Arena draw or timeout.** The arena returns `'draw'` in two cases:
- Both monsters are KO'd within 0.1 s of each other.
- The hard cap is reached with exactly equal HP fractions (very rare).

At the hard cap, the fighter with the higher HP fraction otherwise wins. Sudden death (3.6) makes a natural KO before the cap almost certain.

**Spells and arena use.** A spell fired inside the arena is consumed: it goes to the graveyard, and its uid is reported in `ArenaResult.spellsUsed`. It does **not** also trigger its duel-side effect.

---

## 3. Arena rules

### 3.1 Flow
1. **Intro (1.5 s, skippable)**: both sprites spawn, VS banner. During the intro, **ATK/DEF modifiers are locked in**, including equip spells and field effects.
2. **Fight (real time, target 8–15 s)**:
   - The player moves with the virtual stick or WASD.
   - Basic attacks are automatic when the enemy is in range, or bound to a button (Arena dev's choice; auto is recommended on mobile).
   - The player has 1–2 ability buttons and 1 spell button. The spell button appears only if they hold an arena-usable spell.
   - The NPC side is driven by ArenaAI.
3. **KO**: hit-stop and slow-mo, then a **1 s outro** that shows the winner and the HP left (skippable).
4. Return to the duel and call `resolveBattle`.

Either player's monster can be the "player-controlled" one: the human always controls their own monster, whether it is attacking or defending.

### 3.2 Stats (from current ATK/DEF, after modifiers)
`arenaStats(card, atk, def, position?)`:
```
S      = 0.7·ATK + 0.3·max(DEF, 0.5·ATK)                // HP DEF floor (Wave 3)
maxHp  = (50 + 640·(S/1000)^1.0)  × style.hpMult
power  = (2  + 60 ·(ATK/1000)^1.0) × style.powerMult      // damage per basic hit
hit    = power × mult × 8000/(8000+targetDEF)             // resistance from the REAL DEF
hit    = clamp(hit, 4, 0.16·target.maxHp·max(1,mult))     // floor and anti-oneshot cap
```
- A **Defense-Position defender uses its DEF as its offensive stat**: its "ATK" in the arena is its DEF, because DEF is its YGO battle stat. That is why a 0/2000 wall hits back hard.
- **Why `statExp` is 1.0 (it was 1.4 in Wave 1).**
  - The abstract model assumed hits land randomly (a per-side hit rate). In the real ArenaSim, melee trades land about 95% of the time, so the race is close to deterministic, and with exponent 1.4 any stat gap was absolute: −200 gaps almost never flipped.
  - At 1.0, HP and power are both linear in ATK, so the race still scales with roughly `(ATK ratio)^2`. A −500 gap remains decisive, while −200 gaps and DEF differences can now swing fights.
- **HP DEF floor (Wave 3).** For HP only, DEF counts as at least half of ATK. Spear Dragon (1900/0) used to lose 55–75% of its fights against 1400–1500 ATK monsters; resistance still uses its real DEF of 0.
- **DEF matters, but less than ATK**: about 1000 DEF is worth about 300 ATK in an Attack-Position fight.
- `hpScale` is 640, raised from 480 by the Arena developer, so real-sim fights land around 10 s.

Sample values (melee style; the last column is a basic hit against DEF 1200):

| ATK/DEF | maxHp | power | hit vs DEF 1200 |
|---|---|---|---|
| 0/2000 | 434 | 2 | 4 (floor) |
| 800/600 | 524 | 52 | 45 |
| 1200/1200 | 818 | 76 | 66 |
| 1500/1200 | 952 | 95 | 82 |
| 1700/1200 | 1042 | 107 | 93 |
| 1900/0 (Spear Dragon, floored) | 1084 | 119 | 104 |
| 2000/1500 | 1234 | 126 | 109 |
| 2500/2000 | 1554 | 157 | 136 |
| 3000/2500 | 1874 | 187 | 163 |

### 3.3 Styles
The values below were tuned by the Arena developer against the real sim. The arena floor is 400×180 world units inside the 480×270 screen.

| Style | Speed px/s | Range px | Attack interval s | hpMult | powerMult | Feel |
|---|---|---|---|---|---|---|
| melee | 95 | 30 | 0.9 | 1.00 | 1.03 | All-rounder that closes in and trades |
| ranged | 70 | 150 | 1.2 | 0.95 | 1.25 | Projectiles you can dodge; kites. The shooter is rooted for 0.45 s per shot. |
| bruiser | 82 | 36 | 1.4 | 1.15 | 1.38 | Slow, tanky, heavy hits |
| swift | 130 | 26 | 0.6 | 0.95 | 0.78 | Fast, chip damage |

The constants of the real-time sim live in `TUNING.arena.sim`: wind-ups, projectile speeds, dash and aoe sizes, knockback, i-frames, sudden-death shrink. Human skill profiles for headless sims are in `TUNING.arena.playerSkill`. At equal stats and equal skill, the cross-style win rates in the real sim stay between **36% and 63%** (Section 6.3).

### 3.4 MonsterType → ArenaStyle
`styleForType(type)`; `CardDef.arenaStyle` overrides it.

| Style | Types |
|---|---|
| ranged | Spellcaster, Fairy, Thunder, Psychic, Pyro, Aqua |
| melee | Warrior, Beast-Warrior, Fiend, Zombie |
| bruiser | Dragon, Machine, Rock, Dinosaur, Sea Serpent, Plant |
| swift | Beast, Winged Beast, Insect, Reptile, Fish |

### 3.5 Abilities (`ArenaAbility.kind` semantics)
`power` is a multiplier on the monster's Power. All damage goes through `hitDamage`, so the resistance and the cap still apply.

| Kind | Behaviour | Uses fields |
|---|---|---|
| projectile | Fires a bolt (speed of about 260 px/s) toward the aim direction. Damage = `power × Power`. It can be dodged. | power, cooldown |
| dash | Lunges about 90 px in 0.2 s and damages on contact. The monster is invulnerable during the lunge. | power, cooldown |
| aoe | Bursts in a radius of about 48 px around the monster after a 0.3 s windup with a tell. | power, cooldown |
| shield | Reduces incoming damage by `magnitude` (0..0.6) for `duration` s. | magnitude, duration, cooldown |
| heal | Restores `magnitude` × maxHp (≤ 0.30). It can be used once per fight if `cooldown` ≥ 20. | magnitude, cooldown |
| buff | Multiplies Power (or speed, per the description) by `magnitude` (≤ 1.5) for `duration` s. | magnitude, duration, cooldown |
| stun | A projectile or melee hit that deals `power` × Power and stuns for `duration` s (≤ 1.0). | power, duration, cooldown |

- A monster with no `arenaAbilities` gets a **style default** (`defaultAbilityForStyle`) so that every monster has one ability button:
  - Power Strike (dash 1.8, 7 s)
  - Arcane Bolt (projectile 1.8, 7 s)
  - Quake Slam (aoe 1.6, 7 s)
  - Pounce (dash 1.5, 6 s)
- Abilities start the fight on half cooldown, so the first one is usable at about 3 s.

### 3.6 Sudden death and caps
- **At 20 s**: "SUDDEN DEATH": the arena border closes in. Both fighters take `suddenDeathDps(t) = (0.04 + 0.04·(t−20))` × maxHp per second.
  - A full-HP monster dies by about 26 s.
  - Healing is disabled during sudden death.
- **Hard cap at 30 s**: the higher HP fraction wins. An exact tie gives `'draw'`.

### 3.7 Arena spells
- A spell with `arenaUsable: true` can be fired **once per fight per player** from hand, whether it is that player's turn or not. Doing so consumes the card.
- The spell's arena effect is its `arenaAbilities[0]` (on the spell's `CardDef`). If that is missing, these defaults apply:
  - Damage spells (e.g. Fissure-like, Dark Hole-like): a projectile or full-screen burst of `3.0 × Power`, capped at 3 × 16% of target max HP.
  - Equip or ATK-up spells: buff ×1.4 for 5 s.
  - Heal spells (Dian Keto-like): heal 25% maxHp, and the duel-side LP gain is skipped.
  - Stun or negation spells: stun 1.0 s.
- Budget: a one-shot effect worth about **3 basic hits** (`TUNING.abilities.spellHitEquivalent`).
- The NPC may fire its spell when the AI difficulty allows it (the abilityUseChance gate). It prefers to fire when it is losing below 50% HP.

### 3.8 NPC arena AI handicap (`TUNING.ai`)
| Difficulty | Reaction delay | Aim error | Ability use chance | Dodge chance | Model hit rate |
|---|---|---|---|---|---|
| easy | 450 ms | ±20° | 50% | 15% | 0.55 |
| normal | 300 ms | ±12° | 75% | 30% | 0.68 |
| hard | 180 ms | ±6° | 95% | 45% | 0.78 |

The terms in this table mean:
- **Reaction delay**: the lag between a change in the world (a projectile fired, the enemy entering range) and the AI's response.
- **Aim error**: a uniform random angular offset on projectiles.
- **Dodge chance**: the probability of trying to sidestep a telegraphed attack.

The AI never uses information that the player cannot see.

Assumed player hit rates for the model: novice 0.60, average 0.72, good 0.82, expert 0.88.

---

## 4. Pacing budget
| Step | Seconds |
|---|---|
| Draw animation | 0.5 |
| Summon or set animation | 0.6 (tap to skip) |
| Spell or trap activation | 0.6 (+ effect FX ≤ 0.6) |
| Attack declaration → arena transition | 0.5 |
| Arena intro / fight / outro | 1.5 / 8–15 / 1.0 |
| LP change tick | 0.6 |
| Direct attack | 0.8 |
| NPC "thinking" per action | 0.3–0.6 |
| Phase banner | 0.4 |

**Estimate:**
- The human's turn is about 25–40 s of decisions, plus about 13 s for each arena fight.
- The NPC's turn is about 6–10 s, plus its fights.
- Over 14–18 total turns with about 5–8 fights, the match takes **about 8–12 min**.

**LP economy (Wave 3, measured):**
- Starting LP is 8000.
- Direct attacks deal ATK × 0.4, about 500–1200 each.
- Arena fights deal gap × perf, about 200–700 each.
- In a normal-vs-normal match there are about 10 direct attacks and 7 fights. About 22% of LP damage comes from the arena and the rest from direct attacks and burn effects. See Section 7.

---

## 5. Ability mapping guidelines (for the card designer)
Each effect monster gets **1–2** `ArenaAbility` entries, derived from the card text. Normal monsters get none; the engine uses the style default for them.

### 5.1 Budget
`abilityValue(ab, style)` measures "extra basic hits per second". The total over all of a card's abilities must stay ≤ its level budget. `validateAbilities(card)` reports any violations; run it in a data test.

| Level | Budget (value) | Min cooldown |
|---|---|---|
| 1–4 | 0.30 | 6 s |
| 5–6 | 0.38 | 5 s |
| 7–8 | 0.45 | 4 s |
| 9+ | 0.50 | 4 s |

The value formulas per kind (cd = cooldown) are:

| Kind | Value |
|---|---|
| projectile, dash | `power/cd` |
| aoe | `1.1·power/cd` |
| stun | `(power + duration/attackInterval)/cd` |
| shield | `magnitude·duration/cd` |
| heal | `8·magnitude/cd` |
| buff | `(magnitude−1)·(duration/attackInterval)/cd` |

Hard caps: power ≤ 3.0, stun ≤ 1.0 s, shield ≤ 0.6, heal ≤ 30% maxHp, buff ≤ ×1.5.

**Worked examples:**
- Lv4, single ability: projectile power 1.8, cd 7 → 0.26 ✔
- Lv7, two abilities:
  - projectile 2.0 / cd 8 → 0.25
  - shield 0.5 × 3 s / cd 12 → 0.125
  - total 0.375 ✔
- Lv8, one ability: dash 2.5 / cd 6 → 0.42 ✔
- Lv4: heal 0.2 / cd 6 → 0.27 ✔ (but prefer cd ≥ 20 for "once per fight" flavour)

### 5.2 Text → kind
| Card text pattern | Arena ability |
|---|---|
| "inflict X damage", burn, "destroy 1 monster" | projectile (or aoe for "all monsters") |
| "attacks twice", "piercing", "gains ATK when it attacks" | dash, or buff (Power ×1.3–1.5) |
| "cannot be destroyed by battle", "negate attack", "battle damage becomes 0" | shield (0.4–0.6, 2–3 s) |
| "gain LP", "special summon from GY" (revival flavour) | heal (0.15–0.3, long cd) |
| "change to Defense Position", "cannot attack", "skip", paralysis or binding | stun (0.6–1.0 s) |
| "gains ATK/DEF", "equip", "power up allies" | buff |
| "all monsters / field wipe" | aoe |
| Flip effects | The first ability starts **ready** (cd 0 at fight start) if the monster was flipped by this attack. |
| Pure support or non-combat text (search, draw) | Use the style default; optionally swap the kind to match the theme. |

### 5.3 Rules of thumb
- Prefer **one strong signature ability** for Lv1–4. Use two only for Lv5+ "boss" monsters.
- A damaging ability should feel like about 2 basic hits. Never one-shot: the 16% cap handles that.
- Each ability must have a readable tell of ≥ 0.25 s for a windup or aoe, or a visible projectile, so that skill means dodging.
- Theme over math: pick the kind from the card's fantasy, then fit power and cooldown to the budget.
- Spells: give `arenaUsable: true` to Normal and Quick-Play spells whose effect maps cleanly to damage, buff, heal, shield or stun. Put the arena effect in `arenaAbilities[0]` with a one-shot value of about 3 basic hits.

---

## 6. Arena balance (real ArenaSim, Wave 3)
These numbers come from `npm run sim`: 400 fights per cell, with ArenaAI driving both sides and the "human" side using `TUNING.arena.playerSkill`. The Wave 1 abstract-model table is superseded; `tools/arena-model.ts` remains for quick what-ifs only.

**"Upset"** = the weaker side B wins.

### 6.1 Win rates and durations (Wave 3 TUNING)
| Matchup (A vs B) | Equal skill (avg/avg) | Weaker = good vs normal AI | Weaker = good vs hard AI | Weaker = expert vs easy AI | Median s (equal skill) |
|---|---|---|---|---|---|
| 1200/1200 vs 1200/1200 (mirror) | 50% | 52% | 49% | 59% | 10.3 |
| 1700/1200 vs 1200/1200 (−500 melee) | 0% | 0% | 0% | 0% | 7.5 |
| 1800/1000 vs 1300/2000 (−500, high DEF) | 8% | 9% | 8% | 10% | 9.7 |
| 2500/2100 vs 2000/2100 (−500 ranged) | 4% | **14%** | 4% | 36% | 10.2 |
| 2500/2000 vs 2000/2000 (−500 bruiser) | 0% | 0% | 0% | 0% | 10.8 |
| 1500/1200 vs 1300/1100 (−200) | 0% | 0% | 0% | 0% | 8.7 |
| 3000/2500 vs Defense-Position 1400 DEF | 0% | 0% | 0% | 0% | 7.0 |
| 1800/1000 vs 0/2000 Defense-Position wall | 100% (the wall should win) | 100% | 100% | 100% | 8.3 |
| 3000/2500 vs 1200/1000 (stomp) | 0% | 0% | 0% | 0% | 6.9 |

**Real deck cards** (every monster against every opposing monster, in both positions, 18,000 fights): median **9.0 s** (p10–p90 6.1–12.6 s), 62% inside 8–15 s, and 0.3% reach sudden death. Upset rate by battle-stat gap:

| Gap | Before Wave 3 | After Wave 3 |
|---|---|---|
| \|gap\| < 200 | 21.3% | 28.0% |
| 200–499 | 7.0% | 11.6% |
| 500–999 | 0.6% | 0.8% |
| ≥ 1000 | 0.0% | 0.0% |

Matchups with a gap ≥ 500 and more than 25% upsets: 3 before, 1 after. The one left is Alpha (1400) beating Spear Dragon at 45%, down from 75%, thanks to the HP DEF floor.

### 6.2 Fairness guard and skill expression
| Check | Result |
|---|---|
| −500 ATK with good play vs the normal AI | worst case 14% (ranged) ✔ ≤ 25% |
| Equal stats, equal skill | 50/50 ✔ |

**Known limitation: melee skill expression is low.**
- Melee and bruiser trades are close to a fixed damage race in the real sim:
  - Basic hits land about 95% of the time for every AI profile.
  - The 0.15 s melee wind-up is shorter than every reaction delay (180–480 ms), so the AI can never see it in time to step back.
- In Wave 3 I tried constant-only fixes:
  - A 0.3–0.45 s wind-up, with reach slack 0–2 and `windupMoveMult` 0–1.
  - Melee dodge rates rose by only 3–8 points, and some swift fights stretched to 15 s.
  - None of these were adopted.
- What did help was lowering `statExp` from 1.4 to 1.0:
  - The −200 deck bucket rose from 7% to 12% upsets.
  - The ranged −500 case reached 14% for a good player.
- The ArenaSim and ArenaAI need **logic** changes, not constants, to reach roughly 10–25% upsets at −500 in melee. Recommendations for the Arena developer:
  1. Lock a melee strike's direction at wind-up, so that a sidestep makes it whiff, the same way the dash already works.
  2. Let a fighter cancel its own wind-up by moving away (today `windupMoveMult` slows both fighters).
  3. Make ArenaAI sidestep melee wind-ups rather than back straight off.
  4. Lengthen the wind-up per style: bruiser about 0.35 s, melee about 0.25 s, swift 0.15 s.

  A real human can already dodge better than the AI proxy does, so measured skill expression is a lower bound.

### 6.3 Style cross-table
The table shows the row style's win %, at 1500/1200 and average vs average, in the real sim.

| | melee | ranged | bruiser | swift |
|---|---|---|---|---|
| melee | 51 | 37 | 36 | 42 |
| ranged | 57 | 50 | 60 | 40 |
| bruiser | 62 | 38 | 44 | 63 |
| swift | 54 | 59 | 37 | 52 |

### 6.4 Re-tuning checklist
1. If fights run long, scale `hpScale` (it changes duration linearly and leaves fairness unchanged).
2. If −500 upsets rise above 25%, raise `statExp` in steps of 0.1.
3. To change how much DEF matters, adjust `hpDefWeight` and `resK`. For glass cannons, adjust `hpDefFloorFrac`.
4. Re-run `npm run sim` and check the GDD targets block at the end.

---

## 7. Pacing results (Wave 3)
**Method.** `npm run sim` section 4 runs 400 seeded duels per difficulty:
- Yugi vs Kaiba, with `simulateDuel` (DuelAI on both seats). Seats and the first player alternate.
- Every attack on a monster is resolved by the real ArenaSim, with the "human" seat at average skill against the NPC at normal.
- Wall time per match = turns × **20 s** (decisions plus duel animations) + fights × (fight + 3 s for intro, outro and transition).

### 7.1 Match length: before and after
| Setting | Turns (total) | Fights | Direct attacks | Median min [p10–p90] |
|---|---|---|---|---|
| Wave 2 (`npm run sim`, PlaceholderAI, 4000 LP) | 8 | 2 | 2 | 3.0 [1.7–5.5] |
| Wave 2 (DuelAI normal, 4000 LP, direct ×1) | 9 | 3 | 3 | 3.5 [2.0–7.0] |
| 6000 LP | 12 | 4 | 4 | 4.7 |
| 8000 LP | 14 | 4 | 5 | 5.5 |
| 8000 LP, direct ×0.75 | 16 | 5 | 7 | 6.4 |
| 8000 LP, direct ×0.5 | 19 | 6 | 9 | 7.6 |
| **8000 LP, direct ×0.4 + new decks (shipped), DuelAI normal** | **21** | **7** | **10** | **8.4 [5.3–14.1]** |
| same, DuelAI hard | 21 | 7 | 10 | 8.5 [5.4–13.3] |
| same, DuelAI easy | 29 | 9 | 9 | 11.7 [7.1–18.6] |

The rows between the Wave 2 baselines and the shipped row are sweeps with the old decks. A smaller opening hand (4) made no difference.

**Fights:** about 7 per match, inside the 5–8 target. They take a median of 8.8 s (real deck cards, 9.0 s), and sudden death happens in 0.3% of fights.

### 7.2 Deck balance (Kaiba win %, equal difficulty)
| Difficulty | Before | After |
|---|---|---|
| normal, stat-arena stand-in (`statArenaResolver`) | 64% | 60%* |
| normal, real arena | 55% | **49.5%** |
| hard, real arena | 54% | **46.8%** |
| easy, real arena | 68–70% | 57.8% |

The deck changes (`src/data/decks.ts`) were:

| Deck | Removed | Added |
|---|---|---|
| Yugi | Silver Fang, Mammoth Graveyard (1200/800 vanillas) | Beta The Magnet Warrior, Breaker the Magical Warrior |
| Kaiba | Raigeki | Dark Hole (the one-sided wipe was the biggest swing card) |
| Kaiba | Krokodilus (1100/1200) | X-Head Cannon (keeps Kaiba's normal and hard rates in band after the other changes) |

\* `statArenaResolver` is the arena stand-in that tests use. It resolves fights with DuelAI's logistic (`arenaLogisticK` 140), which fits the real sim poorly at large gaps. Use the real-arena rows for balance.

The easy AI makes about 35% random plays, which favours raw-stat beatdown, so Kaiba still wins 58% at easy. The sim checks easy against a looser 40–60% band.

### 7.3 Open items
- The arena share of LP damage is only about 22%; direct attacks dominate once boards empty. If the arena should matter more, raise `battle.minBattleDamage` or the performance range. Doing so shortens matches, so lower `directAttackMult` to compensate (for example 0.35 with minBattleDamage 300 gives 8.9 min).
- The p90 match length is 13–14 min. Long games are mostly wall stalemates.
- Melee skill expression needs ArenaSim and ArenaAI logic changes (Section 6.2).
