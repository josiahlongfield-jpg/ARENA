# Templar Arena: first playable plan (agreed 2026-10-07)

A new single-file three.js r128 game, separate from Last Light Avenue. It starts from the Black Templar model in
/mnt/project-files/templar/black-templar.html (also published at https://claude.ai/artifact/QVVj6vq5qyorM8zucroVuq).

First playable scope (the user said "start on that"):
- One circular gothic arena with pillars, braziers and four spawn gates.
- First person: move (WASD, Shift sprint, Space dash), heavy bolt pistol on left click (8-round mag, R reload), pistol viewmodel.
- Right click starts a 3-hit sword combo: horizontal slash, rising backhand, overhead slam. While it runs the camera pulls back
  over the shoulder in about 0.25 s, and it returns to first person when the combo ends or the pistol fires.
  The player soft-locks onto the nearest enemy in front and steps in. Hits use the blade's swept position, with hit-stop and a blade trail.
- Two enemy types: fast melee swarmers and ranged gunners firing dodgeable bolts. Waves come in through the gates.
- Procedural WebAudio sounds, a HUD and a debug hook for headless tests.

Biggest job: re-rigging the marine. It is currently a static statue built in absolute coordinates. It needs pelvis, torso, head,
shoulder, elbow and wrist groups plus hip, knee and ankle groups, so poses can be keyframed.
Planned conventions: shoulders and wrists use Euler order 'YXZ'. Arms hang along local -Y. The sword blade runs along hand +Z.
The model faces +Z, so the player model's rotation.y = yaw + PI.
