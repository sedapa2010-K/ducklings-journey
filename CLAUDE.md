# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Duckling's Journey (귀여운 오리 가족 찾기): a portrait mobile 3D game written in plain browser JavaScript on Three.js r128 (vendored at `js/vendor/three.min.js`, so it runs offline). There is no bundler, no npm package, no linter and no test suite. The game ships as an Android APK by wrapping the web files with Capacitor. UI text and code comments are in Korean. README.md lists every gameplay feature and its rules.

## Commands

- Run locally (no-cache server): `python serve.py`, then open http://localhost:8123. `.claude/launch.json` has a `ducksway` preview config for the same server. Always check the game in the portrait phone view.
- Build the APK (Git Bash): `bash build-apk.sh` → `dist/DucklingsJourney.apk` (debug, for testing only).
- Build the Play Store bundle: `VERSION_CODE=<n> VERSION_NAME=<x.y> bash build-apk.sh release` → `dist/DucklingsJourney.aab`. Signing reads `C:\Users\leejj\android-build\keystore.properties` (outside the repo; never commit the keystore). The script also removes the INTERNET permission, writes the Korean app name (`values-ko`, '오리가족찾기'), the adaptive icon XML, and a tiny native `KeepAwake` plugin (`MainActivity.java` + `KeepAwakePlugin.java`) that game.js calls to keep the screen on during play (web Wake Lock is the browser fallback). The android/ project is generated, so native changes belong in build-apk.sh.
- Dev-only hooks (`window.__duck`, `?unlock=1`) exist only when the page is served over `http://` with a port (`DEV_BUILD` in game.js). The Android app (https://localhost) has them off.
  - It copies `index.html`, `css/`, `js/` and `fonts/` into `C:\Users\leejj\android-build\ducksway-app`. That English-only path avoids problems with the Korean OneDrive path.
  - It then runs `npx cap sync`, regenerates icons with `tools/make-icons.js`, and builds a debug APK with Gradle.
  - Icons are drawn procedurally by `tools/make-icons.js`, which writes PNGs directly with no image library. Preview one with `node tools/make-icons.js <out-res-dir> <preview.png>`.

## Architecture

Scripts load as plain globals in this order: `i18n.js` → `levels.js` → `audio.js` → `game.js` (see `index.html`). There are no modules. Anything defined at the top level is shared across files, and `game.js` reads `LEVELS`, `t()` and `Sfx` directly.

### `js/levels.js`: course definitions

- A course is a list of pieces:
  - `S(len, walls, w)` straight, `C(angleDeg, radius, walls, w)` corner (+ is a left turn).
  - `F(drop)` waterfall, `J()` jump.
  - `LJ` long jump with target, `SL` slide, `UP` water lift, `V` valley, `CL` cliff + pool, `LP` vertical loop, `MC` mine-cart rails (samples flagged `rail`, ridden in `cartStep` via `P.cart`).
  - `K` / `forkPiece` / `curveFork` fork.
  - Walls are `'both' | 'L' | 'R' | 'none'`. `'none'` means you can fall off there.
- Levels 1–5 are hand-made in the `LEVELS` array literal.
- Levels 6–60 come from `build(n, rng)` with fixed seeds, built lazily through a `Proxy` over `LEVELS`.
  - Rule (PRD): level N has exactly N corners.
  - Features are inserted at fractions of the corner count (falls, forks, dip, jumps, slide/helix, cliff, loop).
  - `courseOverlaps()` checks every candidate in 2D plus height (a crossing is allowed when the height difference is > 2.6). `generate()` retries with seeds and then with features turned off.
- Race stages live at `LEVELS[100..105]` (`RACE_BASE = 100`) and are built by `buildRace`.
- Changing generation logic or `frng` call order changes the shape of later levels, and players' saved best times then refer to the old course. Changing seeds or feature order does the same.

### `js/game.js`: everything else, about 4.7k lines in one file

Top-of-file constants hold the tuning values: `WATER_DRAG`, `INPUT_ACC`, `CAM_UP/BACK`, `LIMIT_1_5`, `lakeYFor`, and so on.

- **`sampleTrack(def)`** turns pieces into `samples` spaced 0.25 apart. Each sample has position, tangent `t`, left normal `n`, half-width `w` and flags: `fall`, `gap`, `ramp`, `jet`, `lift`, `slide`, `fork`/`ic`/`ih`/`fast`, `cliff`/`pool`, `loopIn`/`loopZone`, `wl`/`wr`, and more.
  - Gameplay works in sample space: index `idx`, distance `d`, lateral offset `lat`.
  - The helper `runs(samples, flag)` returns contiguous index ranges.
- **`buildLevelWorld(def)`** builds all meshes from samples. It uses `ribbon(samples, i0, i1, offA, yA, offB, yB, mat)` for water, walls and floors.
  - It also places obstacles, coins, babies and the arrival pond/family. Placement uses `pickSpots` and a `busy` index list so features don't overlap.
  - It returns the `world` object (samples, logs, mills, loops, homeCtx, limit, ...).
  - `loadLevel(i)` swaps worlds. `world.missions` comes from `missionsFor`.
- **Physics:** `physicsStep` / `airStep` move the single player state object `P` (`x`, `y`, `z`, `vx`, `vz`, `idx`, `lat`, `prog`, and special-mode fields such as `air`, `loop`, `diveT`, `cliffAir`).
  - Special modes return early from `physicsStep`.
  - Any new mode needs its fields reset in both `Object.assign(P, …)` lists: `resetDuck` and respawn.
- **Main loop:** `frame()` → `tick(dt)` runs a state machine. States are `title`, `levels`, `countdown`, `playing`, `paused`, `falling`, `respawning`, `win`, `failed`, `wardrobe` and `shop`.
  - `updateCamera` → `cameraGoal`: the camera keeps a fixed world-space offset and never rotates with the track. It dips low when another track segment blocks the view (`segBlocked`) and frames the loop on loop levels.
- **Title screen:** reuses level 1's arrival pond (`showTitleScene`), with wandering ducks, a real-time sky (`titleTimeTheme`) and islands.
- **Persistence:** `save` lives in localStorage under `duckwaterway.v1` and holds unlocked levels, stars/missions, best times per difficulty (`best` = hard, `bestN` = normal), equip, coins, shop and playTime. The title theme override is stored separately under `duckwaterway.titleTheme`.
- **Shop:** the `SHOP` array plus `SHOP_BUILD` builders. Items are placed around the last level's home (`placeShopDecor`, using `world.homeCtx`) and at every family pond.

### Other files

- `js/audio.js`: every sound and the BGM are synthesized with Web Audio (no audio files). `Sfx.*` is the API, and `SONGS` holds the music.
- `js/i18n.js`: `I18N.ko` / `I18N.en` strings plus `t(key, ...args)`. Function values take arguments. Add every new string to both languages.

## Testing in the browser

There are no automated tests. Verify changes in the preview using the debug hook `window.__duck`:
- It exposes `P`, `state`, `startLevel`, `LEVELS`, `tick`, `world`, `camera`, `save`, `iceberg`/`setIceT`.
- A typical check calls `startLevel(i)` and `tick(1/60)` until `state === 'playing'`, teleports `P` near a sample index, then runs `tick` manually and inspects the state.
- If the preview pane is hidden, rAF does not run, so drive `tick` directly.
- Before tests that play levels, back up the save (`localStorage 'duckwaterway.v1'` → `'duckwaterway.bak'`) and restore it afterwards. Win/fail writes stars and best times.
- Never leave intervals running that write to `P`. The game runs in the real loop alongside test code.
- To check all generated levels for overlap warnings without a browser, load `js/levels.js` in a Node `vm` context and access `LEVELS[0..59]`; warnings go to `console.warn`.
