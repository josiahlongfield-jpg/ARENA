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
- Progress lives in `R` (`freshR()`, save v2: lvl, xp, gold, unguents, equipped `eq`, `bag`, materials `mat` {adam, oil}, subclasses `sub`,
  cosmetics `cos`, weekly `week`, quest, cleared, opened, found, shop stock) and is saved to localStorage (`SAVE_KEY`, autosave every 30 s
  outside a fight). `migrateSave` turns a v1 save (level 1-20, oath points) into v2. `calcStats()` folds level, subclass nodes and gear into `ST`;
  player hits go through `strike()` (Power, crits, perks, `ABIL.dmgMult`) into `damageEnemy()`. Levels run to `MAXLVL` 50 (`xpNext` = 60·L^1.5).
- Power (Destiny-style Light): `charPower()` is the average of the five slots' `pw`. Drops: `dropPw('world'|'powerful'|'pinnacle')` against
  `softCap()` 10L+20, `powCap()` +30, `pinCap()` +50. Enemies have `pw` (`ePow(lvl)` = 10·lvl unless set); the gap d = ST.power - e.pw drives
  `dealtMult(d)` (Immune at -50 or worse) and `takenMult(d)` (up to x3 below, at least x0.8 above; `e.dm = e.dm0 * takenMult`). `pScale` grows
  both sides with Power. The world rises with the player: `riseLvl(base)` keeps foes within four levels, `dunLvl` keeps dungeons within two.
- Enemies carry `lvl`, `pw`, `sc` (scale), `dm` (damage multiplier), `pack` (the encounter that owns them) and `home`. In the world they idle and
  wander, aggro by sight, alert their pack, and leash home (`return` heals them). `buildEncounters()` lists every pack; they spawn within
  130 m (`SPQ`, two per frame) and despawn past 240 m. Cleared camps with a waypoint become fast travel points.
- Loot: `makeItem(slot, pw, rar, name, kind, exo)` in five tiers (`RAR`: Standard, Blessed, Master-crafted, Relic, Artificer; `RHEX` colours).
  Perks from `PERKS` (weapons and armour roll by tier), Artificer exotics in `EXO` (one weapon and one armour piece at a time, `exoClash`).
  `infuse(it, fuel)`, `masterwork(it)`, `dismantle(it)` use gold, adamantium and blessed oil. `lootBurst` drops gems with rarity beams.
  Chests (`addChest`, tiers 1-3 = world, powerful, pinnacle), the Quartermaster's shop (`genStock`), five main quests (`QUESTS`, `checkQuests`).
- Warded foes (`WARDS`, encounter kind 'ward'): the Hollow Saint (pw 250), Warlord Skarr (350), Vorlakh the Daemon Prince (500, sealed until
  the Nave is cleared). Violet shield sphere (`addWard`), respawn after 15 min, exotic drop (`wardSlain`, `newExo`).
  The weekly crusade (`WEEK`, `weekCheck`, `weekStep`) resets Tuesday 17:00 UTC (`weekNo`) and pays pinnacle drops.
- Subclasses (`SUBS`: sword from L1, crusader L5, chaplain L10): Destiny 1 style trees, eight rows, one point per level per subclass
  (`subPts`, `subPick(row)`, `subSwitch`). Energy `AB` {gren, melee, sup} charges over time and on kills; G, V and X fire `useAbility`.
- Abilities (`ABIL`, one module before the main loop): 7 grenades, 9 melee abilities, 3 supers (Wrath of Sigismund, Ansgar's Judgement,
  Litany of Hate) with 3 mods each. `grenade`/`melee`/`super` return false when they refuse; energy is spent only on true. Foe statuses
  (burn, stun, weak, pull, lit) live in `e.ab` and belong to ABIL. Melee abilities run through updateCombo as `C.mode = 'abil'` (bladeHits skips it).
  Hooks: `statusTick`/`speedMult` in updateEnemies, `dmgMult` in strike, `onHit`/`onKill` in damageEnemy, `takenMult` in hurtPlayer,
  `onSwing`, `fireOverride` at the top of fire(), `reset` in clearEnemies and die. Damage-over-time ticks set `ABIL.quiet` (no blood or hit marker).
- Cosmetics (`COS`, just before ABIL): shaders, emblems (`emblemSVG`), servo-skulls, blade ornaments (power field / chain teeth), gunship paints.
  At load the Templar gets private clones of the paints he wears (`COSM[role]`), because `M.*` also dresses the foes and arenas: tint `COSM`,
  never `M`, for him. The trail reads a `tcol` uniform; `COS.update` sets it each frame unless `COS.hold` (an ability's blade look owns it).
  `R.cos` holds the picks and `un` (owned); `applyCos()` wears them. `applyLook` calls `cosCape()`, not `COS`, because it runs before COS exists.
- Screens: the character screen (I, Tab or B; `#build`, `renderCS`: Gear with slot fans, cards with compare and two-step actions, drag to
  equip; Subclass trees; Cosmetics) in `CS` state, Quartermaster shop (`renderSheet`), map with waypoints (M, `drawMap`), talk (`openTalk`).
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
  The jump pack (`JP`, C) is issued once per save (`R.gotJump`). `JP.phase`: 'rise' (about 12 m), 'hover' (3 s real time, world at half speed,
  the aim camera in `updateCamera` follows pitch), 'dive' (straight onto `JP.mark`, re-homing on `JP.lock`), 'fall'. `aimMark` casts from the camera
  through the crosshair (30 m max, snaps to a foe within 2.6 m); `JPM` draws the ring over the ground. Click or F dives, C drops; `landJump` is the AoE.
  The character screen turns the camera onto the player (`armouryCam`).
- No sword hum: it was removed at the user's request (2026-10-08); the swing keeps its whoosh and field crackle.
- The Feyr (`FEYR`, `TYPES.feyr`, `aiFeyr`, `animateFeyr`): the first enemy from the user's own designs, a Tripo sculpt of their sheet,
  rigged by Tripo with idle, walk, slash and hurt clips. `rpg/tools/tripo_rig_pack.py rig.glb rpg/assets/feyr_rig.json idle=… walk=… slash=… hurt=…`
  packs it (joint tree, inverse binds, byte normals and skin, WebP maps with the red glow as emission, 30 fps int16 clips, root motion
  taken out); build.py inlines it as `ASSETS.feyr`. Each Feyr gets its own bones, material and AnimationMixer; bind in the rig's own
  space (`arm.matrix`), never the scaled world, or it renders 2.4x too big. 2.4 m tall. It floats (the user's design: the legs end in one joined point), so every clip
  leaves the legs in their sculpted pose, the hip height barely moves and the holder hovers at `FEYR.HOVER` with a drift; broken, the hips keep
  still too. It glides on the sped-up walk (Tripo's run folds the body), a long overhead slam, kneels (`hurt`) when broken at 40% for an execution. Two 'rift' encounters (by the Breach, lvl 4; and in
  no-man's-land, lvl 9), marked on the map (M) with red diamonds labelled "Feyr rift". Source GLBs: project files `templar-arena/concepts/step3/rig/`. Test hook `hurtE(i, dmg)`.
- The player's body is the Vigil (`VIGIL`, `wearBody`): the user's own design, sculpted by Tripo from their four views and rigged there.
  `rpg/tools/vigil_pack.py rig.glb rpg/assets/vigil_rig.json` folds Tripo's 41 joints into the Templar's 17 (plus a forearm twist joint each side)
  and records her joint positions, hand directions, eye and back. `wearBody('vigil')` moves the Templar's joints to her proportions, hides his
  armour (`J.body`) and skins her mesh to his joints, bound in the root's own space, so everything that poses him poses her. `fitReach` moves
  his third-person poses onto her shoulders and shorter reach; `twistForearms` shares the hand's roll down the forearm; in first person her head
  bone shrinks to nothing. Arm, leg and eye sizes live on T (`armA/armB`, `legA/legB/footH`, `eyeH/eyeF`). Settings > Body switches back to the
  Templar (`SET.body`). His cloaks, gorget and beak stay off her; armour kinds and shaders don't change her look. Source GLBs: project files
  `templar-arena/concepts/step3/vigil_player/`. Test hooks `body(kind)`, `thirdP(on)`.
- Gallery: `openGallery()` from the menu, and `rpg/gallery.html` (build.py, `GALLERY_ONLY`, no textures or sounds) is the same gallery alone,
  published to https://claude.ai/artifact/2dyF1DF8Zz8JJPPMpeA7pJ. Hook `window.__gal` (show, look, hawk, view, step) in that build.
- Character room: `rpg/room_src.html` -> `rpg/room.html` (build.py) is an empty stone hall where the Vigil (twice: at ease, and armed in a combat stance),
  the Skeleton, the Feyr and the Feyr caster stand (x -6, -3, 0, 3, 6) with the game's own meshes, maps and lights, to walk round and inspect. The caster
  (`buildCaster`, `vigil/assets/feyr_caster.json`, copied from the studies viewer's `fc_sculpt_data.js`) stands still, unskinned; its orbiting shards and the
  orb in its raised left hand are made in code as the studies make them, and the orb's light goes in `GLOWS` (turned down in the new pipeline). The Skeleton is the user's skeletal design, Tripo-rigged
  and packed by `vigil_pack.py` (GLOW=red) into `rpg/assets/skeleton_rig.json`, so it could be worn with `wearBody` like the Vigil. Both Vigils use
  `vigil/assets/vigil_body.json` (her rig plus finger joints). The armed one (`AV`, `stanceBody`, `STANCE`) is posed by hand each frame after the user's reference
  (project files `templar-arena/concepts/step3/stance_refs/`): square to the front, feet wide and knees bent (two-bone IK, `legTo`), the rifle
  across her upper chest aimed `aim.yaw` to her left with the butt at `pocket` (tucked into her right shoulder: the user wants the stock always
  in the shoulder pocket, which keeps the rifle back and the left arm natural), the head solved so her right eye lands on the sight line
  (`R.relief`, about 9 cm), then the arms by IK (`armTo`) onto the grips from `vigil/assets/grips_body.json`, fingers included; the at-ease one's fingers fall into a loose curl (`relaxHands`). R (or the panel button) switches between Vigil's renderer (`vigil/src/js/render.js`, injected at
  `/*__RENDER__*/`) and the plain one; B goes back to the door; `?old` starts plain. The hands are the game's own (`vigil/src/js/hands.js`, injected at
  `/*__HANDS__*/`). `armTo` turns each elbow round so the forearm lines up with the hand (`straightPole`, from `J.handU`), so the wrists bend less; with a flare the
  elbow instead hangs from the shoulder-hand line and swings out by it (`STANCE.flare`: left 0.35 rad, just off her chest as the user asked; right 1.0, raised to her side).
  room.html passed 16 MB, so build.py also writes `rpg/room_artifact/` (index.html and an `a_<asset>.js` per asset, filling `window.VGA`), and that is
  what gets published (with `files`) to https://claude.ai/artifact/LWHmSFayM8rJzQn44RZJCZ. Hook `window.__room` (set, light, sim, still, run, mode(on), armed, rifle, caster, stance, pose).
- Test hook `window.__rpg`: begin(fresh), sim(s, fps), set({pos,yaw,pitch,hp,gold,quest}), tp(x,z,yaw), spawn, clear, noEnc, fire, sword,
  execute, dash, key, act, enter(id), exit, wave(n), killAll, xp, give(slot,rar,pw,exo), equip(id), power(), ab(k), fill(), node, subUse,
  cs(o), week(), abil {g, m, s, st, hud}, cos {shader, hawk, orn, skull, emblems, state, vis}, ui(name), talk(id), travel(id), save, quest, norender, render, view(cam, target, fov)/unview, board, land, fly, jump, trial,
  look, cannon, keep(), hawk(), jp(), state(). `noEnc(true)` stops encounters; `noEnc()` turns them back on.
  The page takes about 17 s to load headless (SwiftShader). `window.__world` is the old preview's hook.

## Vigil (vigil/)
The new game: a Destiny-like first-person shooter in the user's own designs, built from scratch (not on The Reach, to keep the art direction its own).
The player is the Vigil with an assault rifle as the primary weapon; enemies will be the Feyr and the Skeleton. Work in progress.
- `src/js/render.js`: `makeRenderer(canvas, opts)`, the frame: HDR target with 4x MSAA, procedural sky captured into PMREM for image-based light,
  a 4096 sun shadow that follows `setFocus` in whole texels, half-res SSAO on the ambient share only (patched materials write it to alpha), bloom,
  height fog patched into every material (use it instead of `scene.fog`), a layer-1 viewmodel pass with its own FOV, ACES and a grade.
  Lights are in physical units (a non-physical scene needs its lights x PI). Quality 'high' | 'medium' | 'low'. Test yard: `test/render_test.html`.
- `test/shot.js <url> <out.png> [steps]`: headless screenshots (steps eval, wait, waitFor, key, click, shot); waits for `window.__ready`.
- Hands: `tools/hands.py` builds the finger rig (15 joints a hand) from landmarks marked by hand in `tools/vigil_hands.json` (per hand: wrist, u along
  the fingers, palm normal, and each finger's joints in mm in the hand's (side, along, palm) frame). Tripo's Mixamo-spec rig has no fingers, so don't use it.
  `tools/body_fingers.py` adds them to her whole body (`rpg/assets/vigil_rig.json` -> `assets/vigil_body.json`); `tools/fp_arms.py` builds the
  150k first-person arms with them. Joint names `thumb1L` ... `little3R` (base to end), after the body's own 17.
- Gauntlets: Tripo fused the sculpt's fingers, so `tools/gauntlet.py pack.json [out.json]` replaces its hands with modelled ones (run it on
  `assets/vigil_body.json` and `assets/fp_arms.json` as body_fingers.py / fp_arms.py made them): a capsule and an armour plate per finger bone, a lofted
  palm, and her armour's plating carried onto them (the user asked that the hands match the gauntlets): two lames on each first finger bone, a plate
  on each other bone, domed caps over the joints, tips and knuckles, two stepped plates with a raised panel over the back of the hand, and lames stepping
  down from the cuff to the hand (`PALM_LAMES`: none under the right wrist, they would meet the pistol grip). Every part is rigid on one joint and each bone
  ends in a ball nested in the next, so bent joints never open. It moves the wrist joint to the band's middle and the finger joints and flex axes onto the
  new hands, and adds `hands` (16-bit positions, one joint per vertex, `wear` a byte for a plate's worn rim, groups 0 glove / 1 plate) beside the sculpt's
  mesh, skinned to the same skeleton. `src/js/hands.js` (shared with the room) draws them: her greys, a grain and bump in rest space, rims worn lighter
  and smoother, no glow (the user's call). Any change to the plating must keep the grips clear: check every part's distance to the rifle (1 mm or more). Reference photos of the grips: project files `templar-arena/concepts/step3/hand_refs/` (grip only, not the look).
- Sculpted hands, set aside: grafting a separately sculpted glove (`tools/hand_sculpt.py`, from the user's glove sheets in project files
  `templar-arena/concepts/step3/wraith_hands/`) onto her arms was rejected: the user wants her hands to come from the same sculpt as her body, so it all
  flows ("you can't add them in after"). The next step is a whole-body re-sculpt from new views with open, spread hands. hand_sculpt.py stays for its digit
  finder (slabs cut from the fingertips down, each piece followed until it joins the palm, finger joints placed on them), which can place the finger joints
  on that sculpt's hands. hands.js can draw textured hands (`tex`, `ji`/`jw` skinning) and grip_solve.py reads either kind.
- Rifle: `tools/rifle_pack.py` packs the user's assault rifle (Tripo bake, project files `templar-arena/concepts/step3/rifle/ar_150k.glb`) into
  `assets/rifle.js` (`window.VG_RIFLE`): body and a removable magazine, quantised to 16 bits in chunks of under 65536 vertices, 2K maps, and the
  points the hands, sights and effects need (`pts`: sight, front, muzzle, gripTop/Bot, trigger, guard, butt, ejector, magTop/magDir, peep).
  Frame: metres, muzzle -Z, top +Y, its right side +X, origin at the rear sight on the sight line. The peep hole is cut by a shader discard.
  `tools/foregrip.py assets/rifle.js` adds the vertical foregrip the user asked for (parts `fore` and `clamp`, untextured, on the rail's rear end;
  `pts.foreTop/foreBot`); rerun it after rifle_pack.py.
- Grips: `tools/grip_solve.py hands.json rifle.js out.json [preview.png]` places each hand on its grip (right: pistol grip, index pad to the trigger;
  left: a fist round the vertical foregrip) and tries every finger pose on a coarse grid and then finer round the best, skinned as the game skins it, keeping the best grasp
  that stays SKIN (0.8 mm) clear of the rifle (voxelised at 1 mm). Out: per hand `T` (her rest space -> rifle frame) and `q` (each finger joint's turn
  in rest space). The hand's target = rifle matrix x T x the hand joint's rest matrix; each finger joint's quaternion = its rest quaternion x q.
