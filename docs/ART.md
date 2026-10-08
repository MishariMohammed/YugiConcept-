# YugiConcept: Art & UI Style Guide

**Direction:** The duel table uses Balatro-style cards. The cards are chunky pixel art with thick ink outlines, and they float, tilt and bounce. A dark CRT-like paint swirl sits behind the table. Real-time fights take place in arenas drawn like Stardew Valley: warm, soft, top-down/¾ tiles with cute, chunky creatures.

**Base resolution:** 480×270, `pixelArt: true`, `Scale.FIT`, landscape. Everything is authored at 1× game pixels.

There are **no art files**. Everything below is generated at runtime by `src/fx/art/*`, deterministically per card id. Each piece can be replaced with a hand-drawn PNG without changing any code (see *Overrides*).

---

## 1. Master palette (35 colours)

The palette is defined in `src/fx/art/Palette.ts`. `PAL` holds the colours as hex strings and `PALT` holds the same colours as `0xRRGGBB` tint numbers.

### Balatro-dark UI
| key | hex | use |
|---|---|---|
| ink | `#140c1c` | every outline, deepest shadow, text outline |
| night | `#1e1630` | scene background base |
| plum | `#2c2140` | panels |
| violet | `#3d2f5b` | panel highlight, swirl band |
| dusk | `#5a4a7a` | muted lines |
| haze | `#8a7aa8` | secondary / disabled text |
| cream | `#f4ead2` | primary text |
| paper | `#e2d2b0` | card rules-text box |
| red / redDark | `#e4433c` / `#8c1f2a` | ATK, damage, "mult" |
| blue / blueDark | `#3b8fe0` / `#1d4a8a` | DEF, shields, "chips" |
| gold / goldDark | `#f2b33d` / `#a8641e` | LP, rarity, stars, highlights |
| orange | `#f08a3a` | warnings, fire |
| green | `#5fbf4a` | heal / positive |

### Card frames
| kind | hex |
|---|---|
| Normal monster (tan/yellow) | `#d9b26a` |
| Effect monster (orange) | `#d8763c` |
| Spell (teal-green) | `#2a9a84` |
| Trap (magenta) | `#b8448e` |

### Stardew-warm arena
`grassDark #3f7a3a`, `grass #5ea546`, `grassLight #8cc85a`, `dirt #b07a48`, `dirtDark #7a4e2e`, `sand #e0b878`, `stone #9a948a`, `stoneDark #5e5a58`, `stoneLight #c8c0b0`, `wood #a0643a`, `woodDark #5c3420`, `water #4aa0d8`, `moss #6b8a3a`, `dungeon #3a3448`, `torch #ffd060`, `skin #f2c69b`, `white #fff8ec`.

### Attribute colours
`DARK #8a44d0`, `LIGHT #f4dc6a`, `EARTH #a87a44`, `WATER #3c8ce0`, `FIRE #e4503a`, `WIND #4cc070`, `DIVINE #f0c040`.

### Ramps and hue shifting
Every base colour expands into a 4-step ramp: dark edge, shadow, base, highlight (`ramp()` in `PixelCanvas.ts`). The steps are hue-shifted: shadows drift toward blue-violet and highlights toward warm yellow. This gives the Stardew look without hand-picking each step.

### Creature palettes
`CardDef.palette` holds 3–5 hex colours, used in this order:
1. **[0]** Main body, fur or robe.
2. **[1]** Secondary: belly, cloth, wings or petals.
3. **[2]** Accent: eyes that glow, horns, gems, weapon orb, crystals.
4. **[3]** (optional) Skin or metal. For spellcasters, fairies and psychics it is skin. For warriors and machines it is armour or metal.
5. **[4]** (optional) Spare.

When `palette` is missing, a default is chosen by monster type, then by attribute.

---

## 2. Card anatomy (native pixels)

### Hand / field card: 48×68 (shown at 1×, or 2× when zoomed in a hand)
```
 y  0  ink outline (1px), corner radius 3, bevel: light top-left / dark bottom-right
 y  3-10  name plate (dark), 3x5 font, truncated with "."   rarity colours the name
 y 12-43  art box 40x30 (+1px ink border)  - creature portrait or spell/trap glyph
          attribute orb (7px) badge at the art box's top-right
 y 45-49  level stars (5x5, gold, right-aligned, max 8 drawn)  | spells/traps: speed label
 y 51-55  monster type (3x5, dimmed)
 y 57-64  stat plate: red sword icon + ATK, blue shield icon + DEF
```

### Inspect card: 96×136 (shown at 1× on the right side of the duel screen, or 2× in a modal)
```
 y  0-1  2px ink outline, corner radius 5; ultra rarity adds a gold inner trim
 y  5-16  name plate: 5x7 font (falls back to 3x5 if the name is long) + 9px attribute orb
 y 19-25  7x7 outlined stars (up to 12)  | spells/traps: "SPELL CARD" / "TRAP CARD"
 y 27-88  art box 80x58 (+ border)
 y 91-95  type line  [DRAGON / EFFECT]  or  [QUICK-PLAY SPELL]
 y 97-122 parchment rules box, 3x5 font, 4 wrapped lines, "..." on overflow
 y 124-133 stat plate: big 5x7 digits, red sword / blue shield icons
```

### Card back (48×68 and 96×136)
The back is a plum diamond checker inside a gold rule. In the middle is a gold-ringed oval with an orange/red spiral, which nods to the classic swirl. Large backs also have corner gems.

### Rarity
| rarity | name colour | foil |
|---|---|---|
| common | cream | none |
| rare | silver `#dfe6f4` | none |
| super | icy `#bff0ff` | white diagonal shine band |
| ultra | gold `#ffd34a` | rainbow shine band + gold inner frame trim |

The foil is a 12-frame overlay strip, pre-clipped to the card silhouette and drawn with ADD blend. When the card is idle, the shine sweeps across it every 2.4 s. When the card is hovered, the shine follows the pointer tilt.

### Spell/trap glyphs
The glyph is picked by keywords in the name or `effect.id`:
- vortex (dark hole)
- bolt (raigeki, quick-play)
- ankh (reborn)
- three swords (revealing light)
- mirror (mirror force, cylinder)
- cards (pot, draw)
- potion (heal)
- sword (equip, power)
- shield (barrier, negate)
- chain (continuous, bind)
- flame (burn)
- eye
- mountain (field)
- heart
- jaws (trap hole, default trap)
- star (default spell)

---

## 3. Creatures

A creature is described once, in a 32×32 design space: facing right, feet on y=30, built from ellipses, polygons and tapered capsules. The renderer draws it at any scale *k* and shades it automatically:
- a highlight rim toward the top-left light;
- a shadow band at the bottom-right;
- dark *selective outlines* where a front part overlaps a back part;
- a global 1px outline in a near-black version of the body hue.

The same rig is used in two places:
- **Card portraits:** k≈0.92 on hand cards and k≈1.8 on inspect cards.
- **Arena spritesheets:** 32×32, or **48×48 when level ≥ 7**.

So the creature on the card is the same creature that fights in the arena.

### Families by MonsterType

| MonsterType | Family |
|---|---|
| Dragon | winged dragon |
| Dinosaur | big-headed, wingless |
| Reptile | low lizard |
| Sea Serpent | coiled serpent |
| Spellcaster | robed mage with hat and orb staff |
| Psychic | hooded, hovering, forehead gem |
| Fairy | halo and wings, hovering |
| Zombie | hunched, arms out |
| Warrior | helmet, sword and shield |
| Beast-Warrior | beast head and axe |
| Beast | quadruped with optional mane |
| Fiend, level ≤ 2 | fluffy puff ball (Kuriboh) |
| Fiend, level ≥ 3 | horned imp with bat wings and spade tail |
| Machine | boxy, visor eye, arm cannon, treads or legs |
| Aqua | frog-like with fin crest |
| Fish | floating fish |
| Insect | segmented, 6 legs, wings, mandibles |
| Plant | flower or bulb head with a face, vine arms |
| Rock | boulder golem with crystals |
| Winged Beast | bird |
| Thunder | spiky electric orb |
| Pyro | living flame |
| anything else | slime blob |

Per-id seeded variation changes horn length, ears, mane, spikes, wings and similar details.

### Spritesheet layout (contract for PNG overrides)
The spritesheet is one horizontal strip of **15 frames**, named `0`–`14`. Sprites face RIGHT; the left side uses `flipX`.

| anim key | frames | fps | loop |
|---|---|---|---|
| `${id}-idle` | 0-3 | 5 | yes |
| `${id}-walk` | 4-7 | 10 | yes |
| `${id}-attack` | 8-10 (wind-up, strike, recover) | 14 | no (~0.21 s) |
| `${id}-hit` | 11 | - | no |
| `${id}-ko` | 12-14 | 8 | no |

---

## 4. Arenas

`buildArenaBackground(scene, kind, w, h)` bakes the whole arena into **one texture** and returns the walkable `floor` rect. The arena is not a tilemap at runtime.

| Arena | Details |
|---|---|
| **meadow** | Noise-dithered grass, tufts and flowers, an oval dirt clearing, a tree line and wooden fence at the back, a fence in front, bushes and rocks. |
| **ruins** | A cracked stone-slab floor with moss, a brick back wall with grass overhang and ivy, broken pillars. |
| **dungeon** | A brick floor, a back wall with torches and a banner, side walls, puddles and bones, warm light pools, a strong vignette. |

Props have a dark-brown outline (`#2a1e1a`), not pure black, to stay warm. Arena sprites look best at 1.5× or 2× scale on top of the background, with an `fx-shadow` under each one.

---

## 5. Fonts

The fonts are hand-authored bitmap glyphs in `src/fx/art/PixelFont.ts`. They are drawn into textures at runtime and registered as Phaser RetroFonts with proportional advances by `src/ui/PixelText.ts`.

| key | glyph | notes |
|---|---|---|
| `px` | 5×7 | names, UI, damage numbers |
| `px-o` | 5×7 + baked 1px ink outline | readable on anything (default for `pixelText`) |
| `px-tiny` | 3×5 | card rules text, small labels |
| `px-tiny-o` | 3×5 + outline | |

The fonts are uppercase only; lowercase is upper-cased. The icon glyphs are:
- `^` star
- `~` heart
- `{` sword (ATK)
- `}` shield (DEF)
- `` ` `` arrow

Glyphs are white, so they can be tinted. Use integer sizes only (`pixelText(..., size=1|2|3)`).

---

## 6. Motion and timings (fast pace: every duel animation ≤ 0.6 s)

The timings are exported as `TIMING` from `src/fx/Juice.ts`.

| action | ms | easing |
|---|---|---|
| hover lift/scale (critically-damped lerp) | ~90 | exp lerp |
| card move hand→field, return home | 220 | Back.Out |
| flip | 180 (90+90) | Quad In/Out |
| summon bounce (drop, squash 1.3×0.72, rebound, settle) + dust and ring | 420 | keyed |
| attack lunge | 260 | Quad.Out |
| hit-stop | 70 (crit 110) | — |
| screen shake | 140 | — |
| damage number pop, rise and fade | 650 (non-blocking) | Back/Cubic |
| particle burst | 450 | — |
| LP counter tick | 500 | linear |

**Idle motion:** cards float ±1.2 px at 1.7 rad/s. Small cards wobble ±0.012 rad; large cards don't rotate, because rotation smears pixel text. Pointer tilt foreshortens the card by up to 10% on X and 6% on Y, rotates it up to 0.07 rad, and moves the shadow the opposite way.

**Arena:** the intro takes 1.5 s and the outro 1 s (skippable). Both are owned by the arena developer.

---

## 7. Overrides (dropping in hand-drawn art)

Every generator first checks `scene.textures.exists(key)`. Preload a PNG under the same key and the generator keeps it:

| key | file suggestion | size |
|---|---|---|
| `card-sm-<id>` | `public/assets/cards/sm/<id>.png` | 48×68 |
| `card-lg-<id>` | `public/assets/cards/lg/<id>.png` | 96×136 |
| `card-back-sm` / `card-back-lg` | `public/assets/cards/back-*.png` | |
| `mon-<id>` (spritesheet) | `public/assets/sprites/<id>.png` | 15×32 or 15×48 strip; load with `load.spritesheet(key, url, {frameWidth, frameHeight})` |
| `arena-<kind>` | `public/assets/tiles/arena-<kind>.png` | 480×270 |
| `fx-shadow`, `px-dot`, `px-spark`, `px-dust`, `px-star`, `px-ring`, `px-slash`, `proj-<ATTR>` | `public/assets/fx/` | |

Animations (`<id>-idle`, etc.) are still registered on top of an overridden spritesheet.

---

## 8. Performance notes (Android)

- Textures are generated once and uploaded once. There are no per-frame canvas redraws. The only exception is the optional canvas fallback of the background swirl: a 120×68 canvas at 10 fps.
- Typical cost on desktop: about 8 ms per card (both faces), 13 ms per spritesheet and 40 ms per arena. Expect 4–5× that on mid-range phones. Use `prewarmArt(scene, defs, {sprites, onProgress})` from `src/fx/art/index.ts` in Boot; it time-slices the work across frames.
- Texture memory: each card is about 17 KB of RGBA (both sizes), a 48 px sheet is 138 KB, and an arena is 518 KB.
- The background shader runs at 480×270 with 2 px cells, four iterations and no texture fetches.
