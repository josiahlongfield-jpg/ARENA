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
data/sounds.json         MP3s (base64) borrowed from Last Light Avenue's city_sounds_mp3.json. Credits are in the menu.
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
posePreview(strike, u, camPos, lookAt) to freeze the loop and render a strike pose, unfreeze, state().

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
- Enemies: ghouls (fast melee, at most two attack at once) and gunners (hold 9-17 m, strafe, aim 0.7 s, fire slow bolts the
  sword can knock away). Waves come through four gates.
- Audio: borrowed recordings for the pistol, footsteps, grunts and hits; everything else is synthesised (`SYN`, `humSet`).
