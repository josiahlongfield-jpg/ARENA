# Templar Arena

A browser arena fighter built with three.js r128, separate from Last Light Avenue. You play a Black Templar:
the heavy bolt pistol is first person, and the power sword combo pulls the camera back over the shoulder.
The whole game ships as one self-contained HTML file.

- **Live version:** https://claude.ai/artifact/Ts9qsGkAJTVt87YpK7d4Df (private to the owner). Publish `dist/artifact.html` there.
- **Standalone copy:** `dist/templar-arena.html` (double-click to play; needs the internet for three.js and fonts).
- **Repo:** github.com/josiahlongfield-jpg/arena. The source also lives in the project files under `templar-arena/`.

## Layout
```
src/arena_template.html  THE source: HTML, CSS and all game JS in one IIFE. Sounds are injected at build time.
data/sounds.json         MP3s (base64): some borrowed from Last Light Avenue's city_sounds_mp3.json, plus the CC0 set. Credits are in the menu.
assets/cc0/              CC0 sword, slice and bolt recordings (Kenney, Freesound via CDDA) with CREDITS.md. Keys in sounds.json: swing0-4, slice0-3, bdraw, bring, bscrape, bolt_k, bolt_t, bimp0-1
build.py                 Inlines sounds -> dist/templar-arena.html, dist/artifact.html (no doc skeleton), test/game.html; syntax-checks with node
test/run.js              Headless Playwright driver (node). Steps: begin, sim, eval, log, shot
test/three.min.js        three.js r128 for offline tests
```

## Build and test
```
python3 build.py                                   # must print "syntax: ok"
cd test && python3 -m http.server 8766 --bind 127.0.0.1 &
NODE_PATH=/opt/node22/lib/node_modules node test/run.js steps.json outdir
```
`window.__ta` is the test hook: begin, sim(s), set({pos,yaw,pitch,hp}), spawn(type,x,z,state), clear, fire, sword, dash, key,
execute, breakE(i), wave(n), setArena(id), setPaused(on), los(i), en(i), posePreview(strike, u, camPos, lookAt) to freeze the loop and render a strike pose,
unfreeze, state(). Set `__ta.G.noWaves = true` to stop the wave director during a test.
Note: the page's own animation frames keep running between test steps, so screenshots advance the game a little.

## How it works
- Rig: `buildTemplar()` is the study model re-rigged. It faces +Z, right side is -X, limbs hang along local -Y, the sword blade runs
  along the right hand's +Z and the pistol barrel along the left hand's -Y. The player model's rotation.y = yaw + PI.
- Arms are driven by two-bone IK (`solveArm`) every frame: first-person targets come from camera space (`camToBody`),
  combo poses from `STRIKES` keyframes in the body's own space (h = wrist position, b = blade direction, tw = twist, lean, py).
- Combo: three strikes (horizontal slash, rising backhand, overhead slam with a shockwave). Each has wind-up, cut, recovery.
  Pressing during a strike queues the next. Soft lock picks the best enemy within 8.5 m in front (`pickTarget`) and lunges in.
  Hits test the blade's swept position each frame (`bladeHits`), with hit-stop. Firing the pistol cancels the combo.
- Camera (`updateCamera`): first person at the eye; during the combo it blends over 0.25 s to an over-the-shoulder view,
  arcing up and right so it doesn't pass through the pack.
- Moves (`C.mode`): 'combo' (STRIKES), 'thrust' (sword within 0.22 s of a dash: `THRUST` drives forward and pierces, then can
  chain into strike 2 via `next`), 'finisher' (fire during strike 2 or 3: the left arm aims the pistol at the target, `finisherShot`),
  'exec' (executions). Each strike def has w/s/r timings, dmg, knock, src and three pose keys.
- Executions: enemies get `broken` (gunner below 45% hp once, brute guard break or charge into a wall, champion below 12%).
  E, or the sword right next to one, runs `EXEC_LIGHT` or `EXEC_HEAVY`: a timed pose track with events (chop, impale, rip),
  the victim pinned in front (`execd`), a side camera (`execCam` picks the clearer side), slow-mo (`G.slowT`), heal +25/35/50.
- Enemies (`TYPES`, mass scales knockback and whether hits interrupt): ghouls (fast melee, at most two attack at once), gunners
  (hold 9-17 m, aim 0.7 s, slow bolts the sword can knock away), leapers (crouch tell, ballistic leap, landing AoE; can be shot
  out of the air), brutes (the shield is solid: `shieldRay` stops any bolt that meets `J.shieldBody`, no damage or splash gets through it, and
  blades from the front only wear down `guard` until it breaks; `holdHeavy` keeps the shield facing forward and the weapon head-up; maul smash; charge that
  stuns them if they hit a pillar or wall), the Champion every fifth wave (cleave x3, leap slam, summons ghouls at 66%/33%, poise
  staggers, armour 0.75, boss bar). Bodies: `buildGhoulHD`, `buildLeaperHD`, `buildGunnerHD`, `buildHeavyHD(o)` for brute/champion,
  with painted materials in `HD.M`. `mergeParts(J)` runs on each spawn and merges every joint's parts per material (about 200 parts
  down to 30-60 meshes) while leaving anything named in J alone. `previews/` is the enemy studies viewer that came before them (frozen).
- Arenas (`ARENAS`, `buildArena(id)`): the Pit (circle), the Nave, the Hive and the Void Ship (rects). Each sets the sky shader
  uniforms, fog and lights and fills PILLARS (round colliders), BOXES (axis-aligned), FIRES, SPAWNS and ALARMS. `clampBounds`,
  `insideBy`, `collide` and `rayWorld` all read these. The menu picker saves the choice in localStorage.
- Pause (`setPaused`): Esc leaves pointer lock, which opens the pause screen; it doubles as Settings from the main menu (`SET`:
  sensitivity, invert Y, FOV, volume, sword sound, screen shake; saved in localStorage).
- Audio: recordings for the pistol, footsteps, grunts and hits; the CC0 sword recordings layer under the synthesis (`swordAudio`:
  'mix' | 'rec' | 'synth', a menu toggle so they can be compared); everything else is synthesised (`SYN`, `humSet`).
  No openly licensed 40k bolter/bolt pistol recording exists (see assets/cc0/CREDITS.md); the bolt is generic CC0 material.

## Templar: The Reach (rpg/)
An open world RPG vertical slice: one 1.6 km region (shrine highlands, siege front, dead hive) with the arena's combat, roaming camps,
the arenas as dungeons, levels, loot, quests and saving. Published to https://claude.ai/artifact/HfAK8LV57xTesDm78gw3C8 (no doc skeleton).
- `rpg/game_src.html` is THE source; `python3 rpg/build.py` inlines the CC0 textures (`rpg/assets/tex`), the baked Kenney props
  (`rpg/assets/kenney.json`) and the arena's sounds (`data/sounds.json`) into `rpg/game.html`. It also still builds the old
  walk-only preview `rpg/world_src.html` -> `rpg/world.html`. Both must print "syntax: ok".
- `buildRegion()` builds the world once into `W` (terrain `W.gH`, `W.collide`, `W.ray`, `W.clampB`, CAMPS, GATES, CHESTS, places).
  `ZONE` is 'world' or 'dungeon'; `GY(x, z)` is the ground under any point (0 in a dungeon), and `collide`/`rayWorld`/`clampBounds`
  hand off to `W` in the world. Dungeons rebuild an arena (`buildArena`) into `DG` and run `DUNS[id].waves`, with a named boss on the last.
- Progress lives in `R` (`freshR()`: lvl, xp, oath points, gold, unguents, equipped `eq`, `bag`, quest, cleared, opened, found, shop stock)
  and is saved to localStorage (`SAVE_KEY`, autosave every 30 s outside a fight). `calcStats()` folds level, oaths and gear into `ST`;
  player hits go through `strike()` (crits, multipliers) into `damageEnemy()`.
- Enemies carry `lvl`, `sc` (scale), `dm` (damage multiplier), `pack` (the encounter that owns them) and `home`. In the world they idle and
  wander, aggro by sight, alert their pack, and leash home (`return` heals them). `buildEncounters()` lists every pack; they spawn within
  130 m (`SPQ`, two per frame) and despawn past 240 m. Cleared camps with a waypoint become fast travel points.
- Loot: `makeItem(slot, lvl, rarity)` with affixes from `AFX`, uniques in `UNIQ`; `drop()` puts gems with rarity beams on the ground.
  Chests (`addChest`, tiers 1-3), the Quartermaster's shop (`genStock`), five main quests (`QUESTS`, `checkQuests`).
- Screens: character/inventory (I or Tab, `renderSheet`, clicks via data-act), map with waypoints (M, `drawMap`), talk (`openTalk`).
- `rpg/tools/kenney_convert.py <cc0-world/models> rpg/assets/kenney.json` bakes the Kenney GLBs to vertex colours with a per-surface class
  (stone, wood, metal, cloth) that picks the scanned texture. The full download is in the project files under `templar-arena/assets/cc0-world/`.
- `triMat()` lays scanned textures on by world position (triplanar). Give each new variant a distinct key: r128 caches programs
  by `customProgramCacheKey`. Grass cards zero their specular, or they glow white toward the low sun.
- The keep (`W.KEEP` from the region builder): north gate and a west postern (`WALL_GAPS`), forge, apothecarion, chaplain's dais, training
  yard with pells, firing range, refectory fire, well, lectern, and the landing field outside the postern (`PAD` flattens the terrain).
- Brothers: `buildBrother(kind, o)` builds every rank from shared pieces (serf, servitor, neophyte, initiate, sword, castellan, chaplain, tech,
  apoth), vertex-coloured and merged per joint (`npcBake`, about a dozen draw calls each). `raiseKeep()` places about 38 `KEEPERS` with jobs
  (`animKeeper`: smith, preach, kneel, spar, drill, shoot, walk routes, eat...); named ones are in `NPCS` and talk through `STATION_TALK`
  (reforge at the forge, healing, the Litany buff `G.buffT`, the Trial of the Bolt on the range, the pilot). Pells and boards are `TARGETS`.
- Thunderhawk: `buildThunderhawk()` (faces +Z, about 23 m), flown via `FLY` (`updateFly`, `hawkCam`, bolters, cannon, `hawkLand`, `parkHawk`).
  While flying P.pos follows the ship, damage and sight aggro are off.
- Wargear kinds: each item has `kind` (`KINDS`: blade power/chain/hammer, pistol bolt/plasma, armour mk7/mk6/crusader/mk10, pack jump/power);
  `kindOf` infers it for old saves. `buildGear(T)` adds the models, `applyLook(over)` shows them, `BK()` is the blade's speed/damage/knock.
  The jump pack (`JP`, C; sword in the air = ground pound) is issued once per save (`R.gotJump`). B opens the armoury (`renderArmoury`, `armouryCam`).
- No sword hum: it was removed at the user's request (2026-10-08); the swing keeps its whoosh and field crackle.
- Gallery: `openGallery()` from the menu, and `rpg/gallery.html` (build.py, `GALLERY_ONLY`, no textures or sounds) is the same gallery alone,
  published to https://claude.ai/artifact/2dyF1DF8Zz8JJPPMpeA7pJ. Hook `window.__gal` (show, look, hawk, view, step) in that build.
- Test hook `window.__rpg`: begin(fresh), sim(s, fps), set({pos,yaw,pitch,hp,gold,quest}), tp(x,z,yaw), spawn, clear, noEnc, fire, sword,
  execute, dash, key, act, enter(id), exit, wave(n), killAll, xp, give(slot,rar,lvl), ui(name), talk(id), travel(id), save, quest,
  norender, render, view(cam, target, fov)/unview, board, land, fly, jump, trial, look, cannon, keep(), hawk(), jp(), state().
  The page takes about 17 s to load headless (SwiftShader). `window.__world` is the old preview's hook.
