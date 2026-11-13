# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Duckling's Journey (귀여운 오리 가족 찾기): a portrait mobile 3D game written in plain browser JavaScript on Three.js r128 (vendored at `js/vendor/three.min.js`, so it runs offline). There is no bundler, no npm package, no linter and no test suite. The game ships as an Android APK by wrapping the web files with Capacitor. UI text and code comments are in Korean. README.md lists every gameplay feature and its rules.

## Commands

- Run locally (no-cache server): `python serve.py`, then open http://localhost:8123. `.claude/launch.json` has a `ducksway` preview config for the same server. Always check the game in the portrait phone view.
- Build the APK (Git Bash): `bash build-apk.sh` → `dist/DucklingsJourney.apk` (debug, for testing only).
- Build the Play Store bundle: `VERSION_CODE=<n> VERSION_NAME=<x.y> bash build-apk.sh release` → `dist/DucklingsJourney.aab`. Signing reads `C:\Users\leejj\android-build\keystore.properties` (outside the repo; never commit the keystore). The script also removes the INTERNET permission, writes the Korean app name (`values-ko`, '오리의모험'), the adaptive icon XML, and a tiny native `KeepAwake` plugin (`MainActivity.java` + `KeepAwakePlugin.java`) that game.js calls to keep the screen on during play (web Wake Lock is the browser fallback). The android/ project is generated, so native changes belong in build-apk.sh.
  - It copies `index.html`, `css/`, `js/` and `fonts/` into `C:\Users\leejj\android-build\ducksway-app`. That English-only path avoids problems with the Korean OneDrive path.
  - It then runs `npx cap sync`, regenerates icons with `tools/make-icons.js`, and builds a debug APK with Gradle.
  - Icons are drawn procedurally by `tools/make-icons.js`, which writes PNGs directly with no image library. Preview one with `node tools/make-icons.js <out-res-dir> <preview.png>`.
- Dev-only hooks (`window.__duck`, `?unlock=1`) exist only when the page is served over `http://` with a port (`DEV_BUILD` in game.js). The Android app (https://localhost) has them off.

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
- Race stages live at `LEVELS[100..105]` (`RACE_BASE = 100`), built in `genRace(k)`:
  - Races 1, 3, 5: normal races from `buildRace` (finish order decides the winner).
  - Races 2, 4 (`SLIDE_RACES`): long steep coin water-slide races from `buildSlideRace`, flagged `coinRace`. Coins collected decide the winner (`world.myCoins`, rivals also eat coins).
  - Race 6 (`WAVE_RACES`): wave-surfing + eagle-chase finale from `buildWaveRace`, flagged `waveRace`.
  - Each race kind uses its own seed formula, so changing one kind doesn't reshape the others.
- Changing generation logic or `frng` call order changes the shape of later levels, and players' saved best times then refer to the old course. Changing seeds or feature order does the same.

### `js/game.js`: everything else, about 7k lines in one file

Top-of-file constants hold the tuning values: `WATER_DRAG`, `INPUT_ACC`, `CAM_UP/BACK`, `LIMIT_1_5`, `lakeYFor`, and so on.

- **`sampleTrack(def)`** turns pieces into `samples` spaced 0.25 apart. Each sample has position, tangent `t`, left normal `n`, half-width `w` and flags: `fall`, `gap`, `ramp`, `jet`, `lift`, `slide`, `fork`/`ic`/`ih`/`fast`, `cliff`/`pool`, `loopIn`/`loopZone`, `wl`/`wr`, and more.
  - Gameplay works in sample space: index `idx`, distance `d`, lateral offset `lat`.
  - The helper `runs(samples, flag)` returns contiguous index ranges.
  - The `push()` helper inside `sampleTrack` copies flags into each sample by an explicit field list. A new flag passed to `push(p, slope, { myFlag: true })` is silently dropped unless you also add it to that list.
- **`buildLevelWorld(def)`** builds all meshes from samples. It uses `ribbon(samples, i0, i1, offA, yA, offB, yB, mat)` for water, walls and floors.
  - It also places obstacles, coins, babies and the arrival pond/family. Placement uses `pickSpots` and a `busy` index list so features don't overlap.
  - Most placement draws from the level's seeded `rng`. Newer features use their own `mulberry(levelNo * k + c)` stream (gravel `grng`, low bump logs `brng`, ...) and are placed after the older ones, so adding a feature doesn't move existing obstacles or coins. Follow that pattern for new placements.
  - Each obstacle that slows the duck adds seconds to `limit` (the time limit) in one summed line near the end.
  - It returns the `world` object (samples, logs, bumpLogs, mills, loops, homeCtx, limit, ...).
  - `loadLevel(i)` swaps worlds. `world.missions` comes from `missionsFor`.
- **Physics:** `physicsStep` / `airStep` move the single player state object `P` (`x`, `y`, `z`, `vx`, `vz`, `idx`, `lat`, `prog`, and special-mode fields such as `air`, `loop`, `diveT`, `cliffAir`).
  - Special modes return early from `physicsStep`.
  - Any new mode needs its fields reset in both `Object.assign(P, …)` lists: `resetDuck` and respawn.
- **Main loop:** `frame()` → `tick(dt)` runs a state machine. States are `title`, `levels`, `intro`, `countdown`, `playing`, `paused`, `falling`, `respawning`, `outro`, `win`, `failed`, `wardrobe` and `shop`.
  - `intro` (`playTitleIntro`/`updateIntro`): when level 1 is started from the title or level screen, the family on the title-screen pond swims off to screen right, the hero follows, then the screen fades and `startLevel(0, { skipIntro: true })` runs. Tapping skips it.
  - `outro` (level 60 only, `startOutro`/`updateOutro`): after the finish arch (`world.epiD`, samples flagged `epi`), the duck auto-swims the wide channel, then `startWin`. The time limit and placements exclude the `epi` stretch.
  - `updateCamera` → `cameraGoal`: the camera keeps a fixed world-space offset and never rotates with the track. It dips low when another track segment blocks the view (`segBlocked`) and frames the loop on loop levels.
  - Exception: in coin and wave races (`chaseOn()`), `chaseGoal` puts the camera behind the duck looking down the slide.
  - Player input is camera-relative (`camF` in `physicsStep`), so steering follows whichever camera is active.
- **Runtime hazards** (spawned during play, reset per level in the level-start block that calls `resetEagle()`):
  - `updateIcebergs`: one object drifts down from behind at a time. Levels 4–50 get a floating log or rock, snow levels 51+ get an iceberg. A hit shoves the duck forward and costs no heart.
  - `updateEagle`: a crow (20+) or eagle (30+) on a perch chases the duck. If caught, the eagle takes ½ heart and the crow steals coins.
  - `updateLurker`: underwater predators (catfish 12+, crocodile 38+). A shaped shadow swims up the channel from behind. If the duck is slow, it leaps out (−½ heart) and dives away.
  - Chases check `chaseOk()` / `lurkOk()` so they never start near jumps, falls, loops, rails or forks.
- **Title screen:** reuses level 1's arrival pond (`showTitleScene`), with wandering ducks, a real-time sky (`titleTimeTheme`) and islands.
- **Persistence:** `save` lives in localStorage under `duckwaterway.v1` and holds unlocked levels, stars/missions, best times per difficulty (`best` = hard, `bestN` = normal), equip, coins, shop and playTime. The title theme override is stored separately under `duckwaterway.titleTheme`.
- **Shop:** the `SHOP` array plus `SHOP_BUILD` builders. Items are placed around the last level's home (`placeShopDecor`, using `world.homeCtx`) and at every family pond.

### Other files

- `js/audio.js`: every sound and the BGM are synthesized with Web Audio (no audio files). `Sfx.*` is the API, and `SONGS` holds the music.
- `js/i18n.js`: `I18N.ko` / `I18N.en` strings plus `t(key, ...args)`. Function values take arguments. Add every new string to both languages.

## Testing in the browser

There are no automated tests. Verify changes in the preview using the debug hook `window.__duck`:
- It exposes `P`, `state`, `startLevel`, `LEVELS`, `tick`, `world`, `camera`, `renderer`, `scene`, `save`, `keys`, `noSave`, `iceberg`/`setIceT`, `eagle`, `lurker`/`resetLurker`.
- A typical check calls `startLevel(i)` and `tick(1/60)` until `state === 'playing'`, teleports `P` near a sample index, then runs `tick` manually and inspects the state.
- `readInput()` overwrites `input` every tick from the joystick and keys, so to steer in a test set `__duck.keys.ArrowLeft`/`ArrowUp`/... rather than `input`. Clear them afterwards.
- If the preview pane is hidden, rAF does not run, so drive `tick` directly. A hidden page also fires the pause menu. Click its resume button (text `계속`) before ticking.
- To look at a frame while the pane is hidden, call `renderer.render(scene, camera)`, put `renderer.domElement.toDataURL()` into a full-screen `<img>` overlay, take a screenshot, then remove the overlay.
- The preview pane's localStorage can come back empty when the pane is reopened. Don't treat it as durable storage for the user's progress.
- Before tests that play levels, set `__duck.noSave = true` so nothing is written to the save (win/fail would write stars and best times), and reload the page when done. Don't back up and restore `duckwaterway.v1` instead: restoring an old copy erases any progress the user made in the meantime, and several sessions share the same `localhost:8123` storage.
- Never leave intervals running that write to `P`. The game runs in the real loop alongside test code.
- To check all generated levels for overlap warnings without a browser, load `js/levels.js` in a Node `vm` context and access `LEVELS[0..59]`; warnings go to `console.warn`.
