# YugiConcept

A Yu-Gi-Oh!-style 1v1 card duel against an NPC. When one monster attacks another, the battle is not settled by comparing numbers: it becomes a **short real-time pixel-art arena fight** (8–15 s).
- ATK drives damage output and DEF drives toughness.
- Card effects become arena abilities.
- Some spells can be fired mid-fight.

The stats still dominate, but good play swings close fights.

The game uses Balatro-style chunky pixel cards and Stardew-style arenas. Phaser 3 + TypeScript + Vite render it, and Capacitor wraps it for Android.

> **Private, personal-use prototype. Not for distribution.**
> - Real Yu-Gi-Oh! card names and stats are the intellectual property of Konami. They are used here as text data for a personal project only.
> - This project must **not** be published, shared as an APK, or uploaded to the Google Play Store or any other store.
> - No official card artwork is used. **All art (cards, monsters, arenas, fonts, icons) is generated procedurally** in code at runtime (`src/fx/art/*`, `tools/gen-icons.mjs`).

---

## Quick start (web)

Requirements: Node.js 20+ (22 recommended).

```bash
npm i
npm run dev          # Vite dev server, also listening on your LAN (--host)
```

Open the `Local:` URL on your computer.

To **play on your phone**, put the phone on the same Wi-Fi and open the `Network:` URL that Vite prints (for example `http://192.168.1.23:5173`).

On a phone browser, the first tap switches to fullscreen and locks landscape. Holding the phone upright shows a "rotate your phone" screen.

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` | Serve `dist/` (also on the LAN) |
| `npm test` | Unit tests (vitest) for the pure-TS core |
| `npm run sim` | Headless balance simulation (match length, fairness) |
| `npm run e2e` | Playwright smoke test (see [Testing](#testing)) |
| `npm run sweep` | Playwright bug sweep: fuzzed matches at every difficulty + layout screenshots |
| `npm run perf` | FPS probe (desktop, phone, phone with 4× / 6× CPU throttling) |
| `npm run icons` | Regenerate the pixel app icon, PWA icons and Android launcher/splash images |
| `npm run android:sync` | Build the web app and copy it into the Android project |
| `npm run android:open` | Open the Android project in Android Studio |
| `npm run android:apk` | Build a debug APK with Gradle (needs the Android SDK) |
| `npm run android:install` | `adb install` the debug APK onto a USB-connected phone |

---

## How to play

1. **Title**: pick EASY / NORMAL / HARD, then tap **DUEL!**
2. **Duel board**:
   - Tap any card to inspect it in the right panel.
   - The panel shows the actions that card can take right now: SUMMON, SET, ACTIVATE, TO DEF/TO ATK, FLIP, EFFECT and ATTACK.
3. **Tribute summon** (Level 5+):
   1. Tap SUMMON.
   2. Tap the monster(s) to tribute.
   3. Tap CONFIRM.
4. **Battle**:
   1. Tap **BATTLE**.
   2. Tap one of your monsters (it glows blue when it can attack).
   3. Tap the red-highlighted target, or **DIRECT ATTACK!** if the opponent has no monsters.
5. Tap **END** to pass the turn. If you hold more than 6 cards, you choose what to discard.
6. **Hold anywhere** to fast-forward animations. The **||** button opens the pause menu: Resume, AUTO (the AI plays for you), Sound on/off, Restart, Quit.

### Arena controls

| | Desktop | Touch |
|---|---|---|
| Move | WASD / arrow keys | Floating joystick: touch and drag anywhere on the left half |
| Basic attack | automatic when in range | automatic |
| Abilities | J, K (or 1, 2) | Round buttons, bottom right |
| Arena spells ("orange cards") | Q, E | Card buttons above the abilities |
| Skip the intro/outro banner | Space / Enter / click | Tap |
| AUTO (AI fights for you) / SKIP (resolve instantly) | click the pills | tap the pills (top centre) |
| Pause / sound | Esc or P, or the **\|\|** pill | **\|\|** pill |

Multitouch is supported: you can steer with one thumb and tap abilities with the other.

The game pauses automatically when the tab or app goes to the background. On Android, the hardware **Back** button opens the pause menu, and exits from the title screen.

### Sound
Short chiptune effects are generated with WebAudio in `src/fx/Sfx.ts`. Browsers only allow audio after a first tap or keypress. You can mute it in either pause menu, and the setting is remembered.

---

## Android

There are three ways to get the game onto an Android phone.

### Easiest: download the ready-made APK

Every push to `main` or `claude/serene-sagan-y1h36q` runs a GitHub Actions workflow (`.github/workflows/android-apk.yml`) that builds a debug-signed APK and attaches it to the rolling **`apk-latest`** release:

<https://github.com/MishariMohammed/YugiConcept-/releases/tag/apk-latest>

1. On your phone, open that link and download **`YugiConcept-debug.apk`**.
2. Open the downloaded file. If Android asks, allow your browser or Files app to **Install unknown apps**.
3. Tap **Install**, then launch **YugiConcept**.

Every build is signed with the CI runner's temporary debug key, which changes between builds. If installing a newer build fails with "App not installed", uninstall the old version first. You can also re-run the build manually from the repo's **Actions** tab (*Android APK → Run workflow*).

### Option A: no SDK needed, "Add to Home Screen" (quickest)

The web build ships a PWA manifest (fullscreen, landscape, pixel icon) and a small offline service worker.

1. Run `npm run dev` (or `npm run build && npm run preview`) on your computer.
2. In **Chrome on Android**, open the `Network:` URL.
3. Open the **⋮** menu and choose **Add to Home Screen**.
4. Launch the game from the new home-screen icon.

Chrome only installs a real **fullscreen standalone** web app from a *secure* origin (https or localhost). Over a plain `http://192.168.x.x` LAN address, the shortcut still works and the game still enters fullscreen on the first tap, but it opens inside a Chrome tab. To get the full app experience over the LAN:
1. Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure` on the phone.
2. Add your `http://192.168.x.x:5173` URL to the list.
3. Relaunch Chrome, then use **Add to Home Screen** / **Install app**.

Alternatively, serve `dist/` from any HTTPS host you control (keep it private).

### Option B: build a real APK on your own machine

The Capacitor project lives in `android/` (app id `com.yugiconcept.app`, landscape-locked, fullscreen immersive, screen kept on, pixel launcher icon). The APK has to be built on your machine, because this repo's dev container has no Android SDK.

1. **Install Android Studio** (Koala or newer) from <https://developer.android.com/studio>.
   - On first launch, let the setup wizard install the **Android SDK**, **SDK Platform 36** (Android 16), **Build-Tools** and **Platform-Tools** (`adb`).
   - Or install them later from *Settings → Languages & Frameworks → Android SDK*.
2. **JDK 21**: Android Studio bundles a JDK ("jbr"), which is the easiest choice.
   - If you build from a terminal, point `JAVA_HOME` at a JDK 21 (17 also works with this Gradle/AGP version).
     - macOS: `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`
     - Windows: `set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr`
     - Linux: `export JAVA_HOME=~/android-studio/jbr`
3. **Point Gradle at the SDK**. Either set `ANDROID_HOME` (for example `~/Library/Android/sdk`, `%LOCALAPPDATA%\Android\Sdk` or `~/Android/Sdk`), or create `android/local.properties` containing `sdk.dir=/absolute/path/to/Android/sdk`. Android Studio creates this file for you when you open the project.
4. **Build the web app and copy it into the native project:**
   ```bash
   npm i
   npm run android:sync        # = npm run build && npx cap sync android
   ```
   Run this again every time you change the game code.
5. **Build the APK**, using one of these:
   - **Android Studio**: run `npm run android:open` (or `npx cap open android`) and wait for the Gradle sync. Then choose *Build → Build App Bundle(s) / APK(s) → Build APK(s)*, or press ▶ Run with your phone plugged in.
   - **Terminal**:
     ```bash
     npm run android:apk         # = cd android && ./gradlew assembleDebug
     # Windows: cd android && gradlew.bat assembleDebug
     ```
   The first build downloads Gradle and the Android Gradle Plugin, which takes a few minutes.
6. **Find the APK** at `android/app/build/outputs/apk/debug/app-debug.apk`.
7. **Install it on the phone**, using one of these:
   - **USB + adb**:
     1. On the phone, enable *Developer options*: go to *Settings → About phone* and tap *Build number* 7×.
     2. Turn on *USB debugging*.
     3. Plug the phone in and accept the prompt.
     4. Run `npm run android:install` (= `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`).
   - **Copy the file**:
     1. Copy `app-debug.apk` to the phone (USB file transfer, or your own cloud drive or email).
     2. Open it with the Files app.
     3. Android asks you to allow **"Install unknown apps"** for that app (*Settings → Apps → Special app access → Install unknown apps*). Allow it, go back and tap **Install**.
     4. Play Protect may warn about an unknown developer. That is expected for a self-built debug APK, so choose *Install anyway*.

A debug APK is signed with your local debug key, which is all you need for personal use. Again: **do not publish it.**

**Regenerating icons**: `npm run icons` redraws the 32×32 pixel design in `tools/gen-icons.mjs` and writes:
- `public/icons/*` (PWA).
- `android/app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground}.png`.
- The splash PNGs.

The adaptive-icon background colour is set in `android/app/src/main/res/values/ic_launcher_background.xml`.

**Native tweaks** live in:
- `android/app/src/main/AndroidManifest.xml`: `screenOrientation="sensorLandscape"`.
- `android/app/src/main/java/com/yugiconcept/app/MainActivity.java`: immersive fullscreen, keep-screen-on and display-cutout mode.

Notch insets reach the page as `env(safe-area-inset-*)` / `--safe-area-inset-*` (Capacitor SystemBars). `index.html` shrinks the game container to the safe area.

---

## Testing

```bash
npx tsc --noEmit && npx vitest run && npx vite build   # static checks + unit tests + build
npm run e2e        # ~3-4 min. SKIP_BUILD=1 reuses dist/, HEADED=1 shows the browser, --only=match|touch|hooks
npm run sweep      # bug sweep: -- --matches=3 --parallel=3
npm run perf       # FPS table
```

The e2e/sweep/perf scripts need Playwright with Chromium. They use a global install if one exists; otherwise run:
```bash
npm i -D playwright && npx playwright install chromium
```
The scripts emulate a 20:9 Android phone in landscape (851×393 @2.75×, touch only). Screenshots land in `tests/e2e/out/` (gitignored).

`npm run e2e` covers:
- Title → tap HARD → DUEL! → a full autoplay match. The first arena fight must start and finish by itself, and the rest are SKIPped by tapping the pill.
- A soft-lock watchdog, then Result → Title.
- A hands-on **touch** pass: tap-to-inspect, summon via the panel, pause on backgrounding, END, tribute summon, BATTLE → tap attacker → tap target. In the arena: joystick drag plus a second finger on an ability button (multitouch), then pause/resume.
- The `?arena=` dev hook and `art.html`.
- It fails on any console error, page error or `[Duel] illegal action` warning.

### Test hooks
- `window.__YUGI__` is the Phaser game:
  - `__YUGI__.scene.getScene('Duel').engine` is the duel engine (state, `legalActions`, ...).
  - `getScene('Duel').autoplay = true` lets the AI play your side; it is also available as *AUTO* in the pause menu.
- **Arena only**: `/?arena=dark-magician,blue-eyes-white-dragon` jumps straight into a fight. Optional parameters:
  - `&auto=1`: AI drives your monster.
  - `&ai=easy|normal|hard`
  - `&side=1`: you defend.
  - `&pos=defense`
  - `&seed=N`
  - `&spells=fissure,...` (yours) and `&espells=...` (the NPC's).

  The same match-up restarts with seed+1 after each fight.
- **Art gallery**: `/art.html` shows every generated card, sprite and arena.

---

## Project structure

```
src/
  main.ts            Phaser config (480x270, pixelArt, FIT + centre, 3 touch pointers)
  mobile.ts          gestures off, pause-on-background, Android back button, fullscreen/landscape, audio unlock, PWA SW
  core/              pure TypeScript, no Phaser (unit-tested, used headless by the sims)
    duel/            DuelEngine (turn machine, rules, actions)
    combat/          ArenaSim (fixed-step real-time fight) + Formulas (TUNING)
    cards/           CardDB + EffectRegistry + effects/*
    ai/              DuelAI, ArenaAI, HumanAutoplay
  data/              cards.json (real names/stats as text) + decks
  scenes/            Boot, Title, Duel, Arena, Result, ArtGallery, SceneBus (scene glue)
  ui/                CardView (Balatro tilt/foil), widgets, card picker, touch controls, swirl background, pixel fonts
  fx/                Juice (shake, hit-stop, particles), Sfx (WebAudio chiptune), art/ (procedural cards, sprites, arenas)
public/              PWA manifest, service worker, generated icons
android/             Capacitor Android project (build outputs are gitignored)
tools/               balance-sim, arena-model, validate-cards, gen-icons
tests/               vitest unit tests; e2e/ Playwright smoke, sweep and perf scripts
docs/                GDD.md (rules + balance), ART.md (style guide), CARDS.md
capacitor.config.ts  appId com.yugiconcept.app, webDir dist
```

---

## Who built it: the agent team

Claude built the game as a coordinated team of subagents. Each agent owned one area of the code, and a lead integrated their work:

| Role | Owned |
|---|---|
| **Game Mechanics Specialist** | Rules, arena formulas, pacing and balance: `docs/GDD.md`, `Formulas.ts`, `tools/balance-sim.ts` |
| **Lead Architect / Engine** | Vite/TS/Phaser scaffold, `core/duel` turn machine, scene flow, seeded RNG, vitest setup |
| **Arena Combat Developer** | `ArenaSim`, `ArenaScene`, hitboxes, abilities, hit-stop/juice, sudden death, touch controls |
| **Card Data & Effects Designer** | `cards.json`, decks, `EffectRegistry` and card effects, arena ability mapping |
| **AI Developer** | `DuelAI` (3 difficulties, trap timing), `ArenaAI` (reaction delay and handicaps) |
| **Pixel Art, UI & VFX Artist** | Procedural card art, sprites, arenas, fonts, Balatro-style UI and juice (`docs/ART.md`) |
| **Mobile & QA Engineer** | Capacitor Android wrapper, safe areas/landscape/fullscreen, pause handling, SFX, performance passes, Playwright e2e/sweep/perf, this README |
