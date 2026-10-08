# YugiConcept — Game Design Document

> **Private and personal use only.** It uses real Yu-Gi-Oh! card names and stats as text data and has no official artwork.
> The numbers in this document live in `src/core/combat/Formulas.ts` → `TUNING`. When the two disagree, the code wins.
> The balance model is `npx tsx tools/arena-model.ts`.

## 1. Pitch
YugiConcept is a streamlined 1v1 Yu-Gi-Oh! duel against an NPC. When a monster attacks another monster, a **short real-time arena fight** (8–15 s) decides the battle:
- **ATK** drives damage output.
- **DEF** drives toughness.
- Card effects become arena abilities.
- Stats dominate the outcome, but skill can swing close fights.

A whole match lasts **8–12 minutes** and includes about **5–8 arena fights**.

---

## 2. Duel rules

### 2.1 Setup
| Item | Value |
|---|---|
| Starting LP | **4000** |
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
| — | Direct attack (no arena) | — | — | defending player: attacker's ATK, no multiplier |

**The defending player never takes damage while their monster is in Defense Position.**

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
S      = 0.7·ATK + 0.3·DEF
maxHp  = (50 + 480·(S/1000)^1.4)  × style.hpMult
power  = (2  + 60 ·(ATK/1000)^1.4) × style.powerMult   // damage per basic hit
hit    = power × mult × 8000/(8000+targetDEF)           // resistance from DEF
hit    = clamp(hit, 4, 0.16·target.maxHp·max(1,mult))   // floor and anti-oneshot cap
```
- A **Defense-Position defender uses its DEF as its offensive stat**: its "ATK" in the arena is its DEF, because DEF is its YGO battle stat. That is why a 0/2000 wall hits back hard.
- **Why the exponent 1.4?** Both HP and power grow with ATK, so the damage race scales with roughly `(ATK ratio)^2.8`. This keeps a −500 ATK gap decisive at *every* level, both 1700 vs 1200 and 2500 vs 2000. Mirror matches still take about the same time at every level, because HP and power scale together.
- **DEF matters, but less than ATK**: about 1000 DEF is worth about 250–300 ATK in an Attack-Position fight. This keeps arena outcomes consistent with YGO's ATK-vs-ATK rule.

Sample values (melee style; the last column is a basic hit against DEF 1200):

| ATK/DEF | maxHp | power | hit vs DEF 1200 |
|---|---|---|---|
| 0/2000 | 285 | 2 | 4 (floor) |
| 800/600 | 365 | 47 | 41 |
| 1200/1200 | 670 | 82 | 71 |
| 1500/1200 | 827 | 111 | 97 |
| 1700/1200 | 937 | 132 | 115 |
| 2000/1500 | 1186 | 165 | 144 |
| 2500/2000 | 1638 | 225 | 196 |
| 3000/2500 | 2130 | 290 | 252 |

### 3.3 Styles
The arena is 480×270 px.

| Style | Speed px/s | Range px | Attack interval s | hpMult | powerMult | Feel |
|---|---|---|---|---|---|---|
| melee | 95 | 30 | 0.9 | 1.00 | 1.03 | All-rounder that closes in and trades |
| ranged | 80 | 150 | 1.2 | 0.95 | 1.30 | Projectiles you can dodge; kites |
| bruiser | 65 | 36 | 1.4 | 1.15 | 1.30 | Slow, tanky, heavy hits |
| swift | 130 | 26 | 0.6 | 0.85 | 0.76 | Fast, hard to hit, chip damage |

At equal stats and equal skill, the cross-style win rates in the model stay between **42% and 57%** (see 6.3).

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

**LP economy:**
- Typical gap damage per fight is 200–700 × about 1.1.
- Direct attacks deal 1000–2500.
- So 4000 LP falls in about 2 direct hits plus 3–4 lost fights, which matches the target length.

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

## 6. Balance model results
These results come from `tools/arena-model.ts` (6000 fights per cell, seeded).

The model is an abstraction:
- Movement becomes an engage delay per style.
- Aim and dodging become one hit rate per side.
- Each side also uses its default ability on cooldown.
- Hits have ±10% variance and attack intervals have ±10% jitter.

**"Upset"** = the weaker side B wins.

### 6.1 Win rates and durations
| Matchup (A vs B) | Equal skill (0.72/0.72) | Weaker = good player vs normal AI (0.68/0.82) | Weaker = good vs hard AI (0.78/0.82) | Stronger = novice vs normal AI (0.60/0.68) |
|---|---|---|---|---|
| 1200/1200 vs 1200/1200 (mirror) | 49% (draw 1%) | 77% | 59% | 66% (novice A loses) |
| 1700/1200 vs 1200/1200 (−500) | 1% | 3% | 0% | 3% |
| 1800/1000 vs 1300/2000 (−500, high DEF) | 8% | 24% | 9% | 22% |
| 2500/2100 vs 2000/2100 (−500, ranged) | 11% | **25%** | 12% | 22% |
| 2500/2000 vs 2000/2000 (−500, bruisers) | 3% | 11% | 4% | 11% |
| 1500/1200 vs 1300/1100 (−200) | 12% | 30% | 14% | 25% |
| 3000/2500 vs Defense-Position 1400 DEF | 0% | 0% | 0% | 0% |
| 1800/1000 vs Defense-Position 2000 DEF wall | 91% (the wall should win) | 99% | 96% | 95% |
| 3000/2500 vs 1200/1000 (stomp) | 0% | 0% | 0% | 0% |

Median duration in seconds, with p10–p90 in brackets, at equal skill:

| Matchup | Median (p10–p90) |
|---|---|
| mirror | 9.8 (8.1–11.3) |
| −500 low | 7.0 (5.0–10.2) |
| −500 high DEF | 9.3 |
| −500 ranged | 9.1 |
| −500 bruisers | 11.0 |
| −200 | 7.8 |
| 3000 vs Defense 1400 | 10.3 (7.2–12.9) |
| wall | 10.3 |
| stomp | 10.7 (8.1–14.3) |

- Sudden death triggers in < 1% of fights, except for an easy AI in a stomp at 8%.
- Even fights land at **8–12 s**. Lopsided fights end at 6–11 s, which is intended: a stomp should be quick but still show a fight.
- Novice-vs-normal fights run about 1 s longer.

### 6.2 Fairness guard
| Check | Result |
|---|---|
| −500 ATK with good play vs the normal AI | ≤ 25% in every case (3–25%) ✔ |
| −500 ATK vs the hard AI | ≤ 12% ✔ |
| Equal stats, equal skill | 49% / 49% with 1–2% draws ✔ |

Skill still matters:
- A good player wins an equal-stat fight 77% of the time against the normal AI.
- A good player wins a −200 fight 30% of the time against the normal AI.
- An expert player against the easy AI can overturn −500 fights 21–57% of the time. This is intended for the easy difficulty, so new players can learn.

### 6.3 Style cross-table
The table shows the row style's win %, at 1500/1200 and equal skill 0.72.

| | melee | ranged | bruiser | swift |
|---|---|---|---|---|
| melee | 50 | 42 | 51 | 57 |
| ranged | 57 | 50 | 51 | 48 |
| bruiser | 49 | 48 | 51 | 46 |
| swift | 42 | 51 | 53 | 50 |

### 6.4 Re-tuning checklist
Use this checklist once the real `ArenaSim` exists:
1. Replace the model's `ENGAGE`, `ACC_MOD` and `EVADE_MOD` with values measured from the sim.
2. If fights run long, scale `hpScale` (it changes duration linearly and leaves fairness unchanged).
3. If upsets rise above 25%, raise `statExp` in steps of 0.1.
4. To change how much DEF matters, adjust `hpDefWeight` and `resK`.
