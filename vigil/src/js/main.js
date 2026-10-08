// ==================================================================== main: the frame, the player, the rifle, the HUD and the menu
// One loop: step (input, the player, the rifle, the enemies, effects), then draw. The player is a capsule on the zone's colliders
// (collide, groundAt); the camera is her right eye, and the viewmodel (VM) hangs from it, drawn in the renderer's own pass.
// Shots are hitscan from the eye: rayWorld for the zone and FOES.ray for the enemies, with spread that blooms while firing and
// recoil that climbs, then settles back once the trigger is released.
const SET = (() => {
  const d = { sens: 1, fov: 78, vol: 0.8, qual: 'high' };
  try { return Object.assign(d, JSON.parse(localStorage.getItem('vigil.settings') || '{}')); } catch (e) { return d; }
})();
const saveSet = () => { try { localStorage.setItem('vigil.settings', JSON.stringify(SET)); } catch (e) {} };

const rnd = makeRenderer($('c'), { quality: SET.qual });
const scene = new T.Scene(), cam = new T.PerspectiveCamera(SET.fov, 1, 0.05, 700);
cam.rotation.order = 'YXZ'; scene.add(cam, ZONE.group); cam.add(VM.group); rnd.viewmodel(VM.group);
// dusk over the ridge: a low sun behind the nave's left shoulder, a violet sky going to ember at the horizon, mist in the hollows
const LOOK = {
  sky: { top: 0x15121f, horizon: 0xb0522f, ground: 0x1d1714, sunDir: [-0.6, 0.11, -0.79], sunColor: 0xffa468, glowColor: 0xff7438, glow: 1.15,
    sunDisc: 45, spread: 0.85, curve: 0.7 },
  sun: [0xffad74, 3.6], hemi: [0x6b6684, 0x1f1712, 1.25],
  set: { exposure: 1.1, fogDensity: 0.02, fogFalloff: 0.2, fogStart: 2, bloomStrength: 0.55, envIntensity: 1.15, shadowRange: 34 },
};
const hemi = new T.HemisphereLight(0xffffff, 0x000000, 1); scene.add(hemi);
function applyLook() {
  rnd.updateSky(LOOK.sky); Object.assign(rnd.settings, LOOK.set);
  rnd.sun.color.set(LOOK.sun[0]).convertSRGBToLinear(); rnd.sun.intensity = LOOK.sun[1];
  hemi.color.set(LOOK.hemi[0]).convertSRGBToLinear(); hemi.groundColor.set(LOOK.hemi[1]).convertSRGBToLinear(); hemi.intensity = LOOK.hemi[2];
}
applyLook();

const G = { state: 'menu', paused: false, t: 0, god: false, noFoes: false, norender: false, frames: 0 };
const FOE = typeof FOES === 'undefined' ? null : FOES;      // the enemies' module, when the build has it
const ABIL = typeof ABILS === 'undefined' ? null : ABILS;   // the grenade and the melee, likewise

// ---------------------------------------------------------------- the player
const MV = { walk: 4.6, sprint: 7.2, ads: 2.9, accel: 46, air: 8, grav: 21, jump: 6.5, step: 0.45, r: 0.38, h: 1.86, eye: 1.72 };
const P = { pos: new V3(), vel: new V3(), yaw: 0, pitch: 0, ground: true, hp: 100, sh: 100, alive: true, hurtT: 9, deadT: 0, stride: 0, airT: 0, dmg: 0 };
function spawnPlayer() {
  P.pos.copy(SPAWNS.player.pos); P.pos.y = groundAt(P.pos.x, P.pos.z, 50, MV.r, 0); P.vel.set(0, 0, 0);
  P.yaw = SPAWNS.player.yaw; P.pitch = 0; P.hp = P.sh = 100; P.alive = true; P.hurtT = 9; P.ground = true;
  GS.mag = GUN.cap; GS.res = GUN.reserve; GS.rl = -1; GS.climb = 0; GS.bloom = 0;
}
function hurtPlayer(dmg, from) {
  if (!P.alive || G.god || G.state !== 'play') return;
  P.hurtT = 0; const s = Math.min(P.sh, dmg); P.sh -= s; P.hp -= dmg - s; P.dmg = Math.min(1, P.dmg + 0.3 + dmg / 50);
  AU.play(['hurt0', 'hurt1', 'hurt2', 'hurt3'], { gain: 0.5, rate: 1.25, vary: 0.05, wet: 0.1 });
  if (P.hp <= 0) { P.hp = 0; P.alive = false; P.deadT = 0; toast('You fell'); }
}

// ---------------------------------------------------------------- the rifle
const GUN = { rpm: 600, cap: 36, reserve: 288, dmg: 17, crit: 1.6, range: 160, fall: [26, 50], reload: 2.3, adsIn: 0.17, adsOut: 0.13,
  spread: { hip: 0.017, ads: 0.0032, move: 0.014, air: 0.032, bloom: 0.0026, max: 0.015 }, kick: { p: 0.0058, y: 0.0022 } };
const GS = { mag: GUN.cap, res: GUN.reserve, cd: 0, rl: -1, rlEmpty: false, ads: 0, bloom: 0, climb: 0, since: 9, sprint: 0, dry: false, shots: 0, hits: 0 };
function startReload() {
  if (GS.rl >= 0 || GS.mag >= GUN.cap || GS.res <= 0 || !P.alive) return;
  GS.rl = 0; GS.rlEmpty = GS.mag === 0; GS.rlStage = 0;
}
function stepReload(dt) {
  if (GS.rl < 0) return;
  const u0 = GS.rl; GS.rl += dt / GUN.reload; const at = u => u0 < u && GS.rl >= u;
  if (at(0.12)) AU.play('p_magout', { gain: 0.7, vary: 0.04, wet: 0.15 });
  if (at(0.58)) { AU.play('p_magin', { gain: 0.8, vary: 0.04, wet: 0.15 }); const n = Math.min(GUN.cap - GS.mag, GS.res); GS.mag += n; GS.res -= n; }
  if (GS.rlEmpty && at(0.8)) AU.play('p_slide', { gain: 0.7, vary: 0.04, wet: 0.15 });
  if (GS.rl >= 1) GS.rl = -1;
}
const _o = new V3(), _d = new V3(), _f = new V3(), _u = new V3(), _rt = new V3(), _n = new V3(), _hp = new V3(), _mz = new V3();
// spread in radians for this moment: hip or sights, moving, in the air, and the bloom from firing
function spreadNow() {
  const s = GUN.spread, sp = Math.hypot(P.vel.x, P.vel.z);
  return lerp(s.hip, s.ads, GS.ads) + s.move * clamp(sp / MV.walk, 0, 1.4) * (1 - 0.7 * GS.ads) + (P.ground ? 0 : s.air) + GS.bloom;
}
function shoot() {
  GS.mag--; GS.shots++; GS.since = 0; VM.fire({ ads: GS.ads });
  cam.getWorldPosition(_o); _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
  _u.set(0, 1, 0).applyQuaternion(cam.quaternion); _rt.set(1, 0, 0).applyQuaternion(cam.quaternion);
  const a = spreadNow() * Math.sqrt(Math.random()), ph = Math.random() * TAU;
  _d.copy(_f).addScaledVector(_rt, Math.tan(a) * Math.cos(ph)).addScaledVector(_u, Math.tan(a) * Math.sin(ph)).normalize();
  const tw = rayWorld(_o, _d, GUN.range), hit = FOE && !G.noFoes ? FOE.ray(_o, _d, tw) : null, t = hit ? hit.t : tw;
  _hp.copy(_o).addScaledVector(_d, t);
  // the tracer leaves from where the muzzle shows on screen (the viewmodel has its own FOV), not from where it is in the world
  FX.tracer(muzzleOnScreen(_mz), _hp, t < GUN.range);
  FX.flash();
  if (hit) {
    const fall = 1 - 0.35 * smooth(GUN.fall[0], GUN.fall[1], t), dmg = GUN.dmg * fall * (hit.crit ? GUN.crit : 1);
    const r = FOE.damage(hit.foe, dmg, { crit: hit.crit, point: _hp, dir: _d, part: hit.part });
    GS.hits++; hitMarker(r && r.killed ? 'kill' : hit.crit ? 'crit' : ''); damageNumber(_hp, dmg, hit.crit);
    FX.impact(hit.kind || 'flesh', _hp, _n.copy(_d).negate());
  } else if (t < GUN.range) {
    hitNormal(_hp, _d, _n); FX.impact('stone', _hp, _n); FX.decal(_hp, _n);
  }
  // recoil: the aim climbs and wanders a little (less down the sights), and the spread blooms
  const k = 1 - 0.35 * GS.ads, kp = GUN.kick.p * k * rand(0.85, 1.15);
  P.pitch = clamp(P.pitch + kp, -1.45, 1.45); GS.climb += kp; P.yaw += rand(-0.6, 1) * GUN.kick.y * k;
  GS.bloom = Math.min(GUN.spread.max, GS.bloom + GUN.spread.bloom);
  // sound: the report, a crack, and now and then the echo coming back off the cliffs
  AU.play('shot_g', { gain: 0.75, rate: 1.12, vary: 0.04, wet: 0.35 });
  AU.play(['crack0', 'crack1', 'crack2'], { gain: 0.35, rate: 1.3, vary: 0.06, wet: 0.2 });
  if (GS.shots % 4 === 1) AU.play('far_g', { gain: 0.22, rate: 1.05, delay: 0.09, wet: 0.8 });
  if (FOE && FOE.heard) FOE.heard(P.pos, 45);
}
function stepGun(dt) {
  const fireReady = P.alive && GS.rl < 0 && GS.sprint < 0.35;
  GS.since += dt;
  if (IN.fire && fireReady) {
    if (GS.mag <= 0) { if (!GS.dry) { AU.play('dry_p', { gain: 0.7 }); GS.dry = true; startReload(); } GS.cd = 0; }
    else { GS.cd -= dt; while (GS.cd <= 0 && GS.mag > 0) { shoot(); GS.cd += 60 / GUN.rpm; } }
  } else { GS.cd = Math.max(0, GS.cd - dt); if (!IN.fire) GS.dry = false; }
  if (GS.mag === 0 && GS.rl < 0 && GS.res > 0 && GS.since > 0.25 && !IN.fire) startReload();
  stepReload(dt);
  // the climb settles back once the trigger is off; the bloom shrinks
  if (GS.since > 0.11 && GS.climb > 0) { const d = Math.min(GS.climb, GS.climb * damp(9, dt) + 0.01 * dt); P.pitch -= d; GS.climb -= d; }
  GS.bloom = Math.max(0, GS.bloom - dt * (GS.since > 0.12 ? 0.08 : 0.01));
  const ads = IN.ads && GS.rl < 0 && P.alive && GS.sprint < 0.5;
  GS.ads = clamp(GS.ads + (ads ? dt / GUN.adsIn : -dt / GUN.adsOut), 0, 1);
}

// ---------------------------------------------------------------- input
const KEY = new Set(), IN = { fire: false, ads: false };
let locked = false, everLocked = false, lockFailed = false, lookX = 0, lookY = 0;
const canvas = rnd.renderer.domElement;
// pointer lock can be refused (some app views): then the game runs unlocked and reads raw mouse movement. A refusal after it has
// worked once is the browser's cool-down after Esc, so the game stays paused instead.
const lockRefused = () => { if (!everLocked) { lockFailed = true; if (G.paused) setPaused(false); } };
function lockMouse() { try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); if (r && r.catch) r.catch(lockRefused); } catch (e) { lockRefused(); } }
document.addEventListener('pointerlockerror', lockRefused);
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas; if (locked) everLocked = true;
  if (G.state === 'play') setPaused(!locked);
});
addEventListener('keydown', e => {
  if (G.state !== 'play') return;
  if (e.code === 'Escape' && !locked) { if (lockFailed || window.__vgNoLock) setPaused(!G.paused); return; }
  if (G.paused) return;
  KEY.add(e.code);
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'Tab') e.preventDefault();
  if (ABIL && !e.repeat) { if (e.code === 'KeyQ') ABIL.grenade(); if (e.code === 'KeyF') ABIL.melee(); }
});
addEventListener('keyup', e => KEY.delete(e.code));
addEventListener('blur', () => { KEY.clear(); IN.fire = IN.ads = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (G.state !== 'play' || G.paused) return;
  if (!locked && !lockFailed && !window.__vgNoLock) { lockMouse(); AU.start(); return; }
  if (e.button === 0) IN.fire = true; if (e.button === 2) IN.ads = true;
});
addEventListener('mouseup', e => { if (e.button === 0) IN.fire = false; if (e.button === 2) IN.ads = false; });
addEventListener('mousemove', e => {
  if ((!locked && !lockFailed) || G.state !== 'play' || G.paused) return;
  const k = 0.0021 * SET.sens / (1 + 0.32 * GS.ads);      // a little slower down the sights, with the zoom
  lookX -= e.movementX * k; lookY -= e.movementY * k;
});

// ---------------------------------------------------------------- moving
function stepPlayer(dt) {
  // the look: this frame's turn goes to the aim and to the viewmodel's sway; pulling down against the climb uses it up
  const dy = lookX, dp = lookY; lookX = lookY = 0;
  P.yaw += dy; const p0 = P.pitch; P.pitch = clamp(P.pitch + dp, -1.45, 1.45);
  if (dp < 0) GS.climb = Math.max(0, GS.climb + dp);
  P.look = { x: dy, y: P.pitch - p0 };
  if (!P.alive) { P.deadT += dt; P.vel.set(0, P.vel.y, 0); if (P.deadT > 3.5) spawnPlayer(); }
  const f = (KEY.has('KeyW') ? 1 : 0) - (KEY.has('KeyS') ? 1 : 0), s = (KEY.has('KeyD') ? 1 : 0) - (KEY.has('KeyA') ? 1 : 0);
  const want = KEY.has('ShiftLeft') || KEY.has('ShiftRight');
  const sprint = P.alive && want && f > 0 && P.ground && GS.rl < 0 && !IN.ads && !IN.fire;
  GS.sprint = clamp(GS.sprint + (sprint ? dt / 0.22 : -dt / 0.16), 0, 1);
  const speed = !P.alive ? 0 : lerp(lerp(MV.walk, MV.ads, GS.ads), MV.sprint, GS.sprint) * (f < 0 ? 0.85 : 1);
  const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw), n = Math.hypot(f, s) || 1;
  const wx = (-sy * f + cy * s) / n * speed, wz = (-cy * f - sy * s) / n * speed;
  const acc = P.ground ? MV.accel : MV.air, k = damp(acc / Math.max(speed, 1), dt);
  P.vel.x += (wx - P.vel.x) * k; P.vel.z += (wz - P.vel.z) * k;
  if (P.ground && KEY.has('Space') && P.alive && !P.jumpHeld) { P.vel.y = MV.jump; P.ground = false; P.jumpHeld = true; }
  if (!KEY.has('Space')) P.jumpHeld = false;
  // move across, push out of walls, then settle onto (or fall to) the ground beneath
  P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt; collide(P.pos, MV.r, MV.h, MV.step);
  const g = groundAt(P.pos.x, P.pos.z, P.pos.y, MV.r, MV.step);
  if (P.ground && P.pos.y - g < MV.step && P.vel.y <= 0) { P.pos.y = g; P.vel.y = 0; }
  else {
    P.ground = false; P.vel.y -= MV.grav * dt; P.pos.y += P.vel.y * dt; P.airT += dt;
    if (P.pos.y <= g) {
      if (P.airT > 0.25) { VM.land(-P.vel.y); AU.play('land_con', { gain: clamp(-P.vel.y / 10, 0.2, 0.8), vary: 0.05, wet: 0.2 }); }
      P.pos.y = g; P.vel.y = 0; P.ground = true; P.airT = 0;
    }
  }
  // footsteps every stride
  const hs = Math.hypot(P.vel.x, P.vel.z);
  if (P.ground && hs > 0.8) { P.stride += hs * dt; if (P.stride > (GS.sprint > 0.5 ? 2.3 : 1.85)) { P.stride = 0; AU.play(['st_con0', 'st_con1', 'st_con2', 'st_con3', 'st_con4', 'st_con5'], { gain: 0.16 + 0.1 * GS.sprint, vary: 0.06, wet: 0.15 }); } }
  // shield comes back after 3.5 s out of harm, then health
  P.hurtT += dt;
  if (P.alive && P.hurtT > 3.5) { if (P.sh < 100) P.sh = Math.min(100, P.sh + 45 * dt); else P.hp = Math.min(100, P.hp + 30 * dt); }
  P.dmg = Math.max(0, P.dmg - dt * 0.9);
}
function placeCamera(dt) {
  const down = P.alive ? 0 : smooth(0, 1.2, P.deadT) * 1.25;      // fallen: the view sinks to the ash
  cam.position.set(P.pos.x, P.pos.y + MV.eye - down, P.pos.z);
  cam.rotation.set(P.pitch, P.yaw, P.alive ? 0 : -0.5 * smooth(0, 1.2, P.deadT));
  cam.fov = SET.fov / (1 + 0.32 * smooth(0, 1, GS.ads)) + 5 * GS.sprint;
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
}

// ---------------------------------------------------------------- where a shot struck: the face of a block, a post's side, or the ground
function hitNormal(p, d, out) {
  const e = 0.03;
  for (const b of BOXES) {
    if (p.x < b.x0 - e || p.x > b.x1 + e || p.y < b.y0 - e || p.y > b.y1 + e || p.z < b.z0 - e || p.z > b.z1 + e) continue;
    const f = [[p.x - b.x0, -1, 0, 0], [b.x1 - p.x, 1, 0, 0], [p.y - b.y0, 0, -1, 0], [b.y1 - p.y, 0, 1, 0], [p.z - b.z0, 0, 0, -1], [b.z1 - p.z, 0, 0, 1]];
    let m = f[0]; for (const q of f) if (Math.abs(q[0]) < Math.abs(m[0])) m = q;
    return out.set(m[1], m[2], m[3]);
  }
  for (const q of POSTS) {
    const dx = p.x - q.x, dz = p.z - q.z;
    if (dx * dx + dz * dz < (q.r + 0.05) ** 2 && p.y < q.y1 + e) return p.y > q.y1 - e ? out.set(0, 1, 0) : out.set(dx, 0, dz).normalize();
  }
  const h = 0.06; return out.set(GH(p.x - h, p.z) - GH(p.x + h, p.z), 2 * h, GH(p.x, p.z - h) - GH(p.x, p.z + h)).normalize();
}
// the muzzle as the eye sees it: the viewmodel's muzzle projected with its own FOV, then put back into the world 1 m from the eye
const vmProj = new T.PerspectiveCamera();
function muzzleOnScreen(out) {
  VM.muzzle(out);
  vmProj.fov = rnd.settings.vmFov; vmProj.aspect = cam.aspect; vmProj.near = rnd.settings.vmNear; vmProj.far = 50; vmProj.updateProjectionMatrix();
  cam.matrixWorld.decompose(vmProj.position, vmProj.quaternion, vmProj.scale); vmProj.updateMatrixWorld(true);
  out.project(vmProj); out.z = 0.5; out.unproject(cam);
  return out.sub(cam.position).normalize().multiplyScalar(1.0).add(cam.position);
}

// ---------------------------------------------------------------- effects: the muzzle flash, tracers, sparks and dust, bullet marks
const FX = (() => {
  const glow = (() => {      // a soft round sprite, drawn once
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  })();
  // the flash: a star of three crossed quads and a round core at the muzzle, shown for a frame or two; a light at the muzzle with it
  const flashMat = new T.MeshBasicMaterial({ map: glow, color: new T.Color(4.5, 2.4, 1.0), transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
  flashMat.userData.vgSkip = true;
  const flash = new T.Group(), core = new T.Mesh(new T.PlaneGeometry(0.09, 0.09), flashMat); flash.add(core);
  for (let i = 0; i < 3; i++) { const q = new T.Mesh(new T.PlaneGeometry(0.035, 0.16), flashMat); q.rotation.set(PI / 2, 0, i * PI / 3); q.position.z = -0.06; flash.add(q); }
  flash.position.copy(VM.RF.pts.muzzle); flash.visible = false; VM.RF.group.add(flash); rnd.viewmodel(flash);
  const light = new T.PointLight(0xffa860, 0, 9, 2); scene.add(light);
  let flashT = 0;
  // tracers: a streak billboarded about its own line in the vertex shader, its head running out at 420 m/s
  const TR = [], trGeo = new T.BufferGeometry();
  trGeo.setAttribute('position', new T.BufferAttribute(new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]), 3)); trGeo.setIndex([0, 2, 1, 1, 2, 3]);
  for (let i = 0; i < 10; i++) {
    const m = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { a: { value: new V3() }, b: { value: new V3() }, w: { value: 0.012 }, c: { value: new V3(3, 1.5, 0.6) } },
      vertexShader: `uniform vec3 a, b; uniform float w; varying float vT, vS;
        void main(){ vec3 p = mix(a, b, position.x), d = normalize(b - a), s = normalize(cross(d, cameraPosition - p));
          vT = position.x; vS = position.y; gl_Position = projectionMatrix * viewMatrix * vec4(p + s * w * position.y, 1.0); }`,
      fragmentShader: 'uniform vec3 c; varying float vT, vS; void main(){ float k = vT * (1.0 - vS * vS); gl_FragColor = vec4(c * k, 1.0); }' });
    m.userData.vgSkip = true;
    const o = new T.Mesh(trGeo, m); o.frustumCulled = false; o.visible = false; scene.add(o); TR.push({ o, a: new V3(), b: new V3(), d: 0, L: 0, s: 0 });
  }
  let trI = 0;
  function tracer(a, b, struck) {
    const t = TR[trI++ % TR.length]; t.a.copy(a); t.b.copy(b); t.L = a.distanceTo(b); t.s = 0; t.o.visible = true; t.struck = struck;
  }
  // particles: one pool for sparks (added light) and one for dust (blended), each point with its own colour, alpha and size
  function pool(n, additive) {
    const g = new T.BufferGeometry(), pos = new Float32Array(n * 3), col = new Float32Array(n * 4), size = new Float32Array(n);
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aCol', new T.BufferAttribute(col, 4)); g.setAttribute('aSize', new T.BufferAttribute(size, 1));
    const m = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending, uniforms: { uScale: { value: 400 } },
      vertexShader: `attribute vec4 aCol; attribute float aSize; uniform float uScale; varying vec4 vC;
        void main(){ vC = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / max(-mv.z, 0.05); }`,
      fragmentShader: 'varying vec4 vC; void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c) * 4.0; if (r > 1.0) discard; gl_FragColor = vec4(vC.rgb, vC.a * (1.0 - r) * (1.0 - r)); }' });
    m.userData.vgSkip = true;
    const o = new T.Points(g, m); o.frustumCulled = false; scene.add(o);
    const P_ = []; for (let i = 0; i < n; i++) P_.push({ p: new V3(), v: new V3(), life: 0, max: 1, s0: 0.02, s1: 0.02, c: [1, 1, 1], a: 1, drag: 0, grav: 0 });
    let next = 0;
    return { o, m, P: P_, add(o2) { const q = P_[next++ % n]; Object.assign(q, o2); q.p.copy(o2.p); q.v.copy(o2.v); q.life = 0; return q; },
      update(dt) {
        for (let i = 0; i < n; i++) {
          const q = P_[i]; if (q.life >= q.max) { col[i * 4 + 3] = 0; size[i] = 0; continue; }
          q.life += dt; q.v.y -= q.grav * dt; q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt)); q.p.addScaledVector(q.v, dt);
          const u = Math.min(1, q.life / q.max); pos[i * 3] = q.p.x; pos[i * 3 + 1] = q.p.y; pos[i * 3 + 2] = q.p.z;
          col[i * 4] = q.c[0]; col[i * 4 + 1] = q.c[1]; col[i * 4 + 2] = q.c[2]; col[i * 4 + 3] = q.a * (1 - u) * (additive ? 1 : Math.min(1, u * 8));
          size[i] = lerp(q.s0, q.s1, u);
        }
        g.attributes.position.needsUpdate = g.attributes.aCol.needsUpdate = g.attributes.aSize.needsUpdate = true;
      } };
  }
  const sparks = pool(240, true), dust = pool(160, false);
  // bullet marks: small dark scorches laid on the surface, the oldest reused
  const markTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.35, 'rgba(10,8,7,0.85)'); g.addColorStop(1, 'rgba(20,16,14,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  })();
  const markMat = new T.MeshStandardMaterial({ map: markTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 1 });
  const MARKS = [], markGeo = new T.PlaneGeometry(0.11, 0.11); let markI = 0;
  for (let i = 0; i < 90; i++) { const m = new T.Mesh(markGeo, markMat); m.visible = false; m.receiveShadow = true; scene.add(m); MARKS.push(m); }
  function decal(p, n) {
    const m = MARKS[markI++ % MARKS.length]; m.visible = true; m.position.copy(p).addScaledVector(n, 0.004);
    m.lookAt(tmp.copy(m.position).add(n)); m.rotateZ(Math.random() * TAU); m.scale.setScalar(rand(0.7, 1.2));
  }
  const _v = new V3();
  function impact(kind, p, n) {
    if (kind === 'stone') {
      for (let i = 0; i < 7; i++) sparks.add({ p, v: _v.copy(n).multiplyScalar(rand(2, 6)).add(tmp.set(rand(-2.5, 2.5), rand(-1, 3), rand(-2.5, 2.5))), max: rand(0.12, 0.35), s0: 0.025, s1: 0.008, c: [5, 2.2, 0.8], a: 1, drag: 2, grav: 9 });
      for (let i = 0; i < 4; i++) dust.add({ p, v: _v.copy(n).multiplyScalar(rand(0.4, 1.4)).add(tmp.set(rand(-0.4, 0.4), rand(0, 0.6), rand(-0.4, 0.4))), max: rand(0.6, 1.2), s0: 0.08, s1: 0.4, c: [0.2, 0.18, 0.16], a: 0.7, drag: 3, grav: -0.3 });
    } else if (kind === 'feyr') {      // their blood is the rift's light: red sparks and a red haze
      for (let i = 0; i < 9; i++) sparks.add({ p, v: _v.copy(n).multiplyScalar(rand(1, 4)).add(tmp.set(rand(-2, 2), rand(-1, 2.5), rand(-2, 2))), max: rand(0.2, 0.5), s0: 0.03, s1: 0.01, c: [6, 0.7, 0.25], a: 1, drag: 3, grav: 4 });
      for (let i = 0; i < 3; i++) dust.add({ p, v: _v.copy(n).multiplyScalar(rand(0.3, 1)), max: rand(0.4, 0.8), s0: 0.06, s1: 0.3, c: [0.35, 0.03, 0.02], a: 0.6, drag: 3, grav: 0 });
    } else if (kind === 'bone') {      // the Skeleton: chips of bone and grey dust
      for (let i = 0; i < 6; i++) sparks.add({ p, v: _v.copy(n).multiplyScalar(rand(1.5, 4)).add(tmp.set(rand(-2, 2), rand(0, 3), rand(-2, 2))), max: rand(0.25, 0.5), s0: 0.02, s1: 0.012, c: [0.9, 0.85, 0.75], a: 1, drag: 1, grav: 10 });
      for (let i = 0; i < 4; i++) dust.add({ p, v: _v.copy(n).multiplyScalar(rand(0.3, 1.2)), max: rand(0.5, 1), s0: 0.06, s1: 0.32, c: [0.45, 0.42, 0.38], a: 0.55, drag: 3, grav: -0.2 });
    } else {
      for (let i = 0; i < 5; i++) dust.add({ p, v: _v.copy(n).multiplyScalar(rand(0.5, 2)).add(tmp.set(rand(-1, 1), rand(0, 1.5), rand(-1, 1))), max: rand(0.3, 0.6), s0: 0.04, s1: 0.2, c: [0.25, 0.02, 0.02], a: 0.8, drag: 2, grav: 3 });
    }
  }
  function burst(p, o) {      // a grenade or a death: a ball of sparks and smoke
    o = o || {}; const n = o.n || 40, c = o.c || [6, 1.6, 0.4];
    for (let i = 0; i < n; i++) sparks.add({ p, v: _v.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, o.speed || 9)), max: rand(0.3, 0.9), s0: 0.06, s1: 0.015, c, a: 1, drag: 2, grav: 5 });
    for (let i = 0; i < n / 3; i++) dust.add({ p, v: _v.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).multiplyScalar(rand(0.5, 2.5)), max: rand(1, 2.2), s0: 0.3, s1: 1.4, c: o.smoke || [0.12, 0.1, 0.09], a: 0.55, drag: 1.5, grav: -0.4 });
  }
  function update(dt) {
    flashT -= dt; flash.visible = flashT > 0; light.intensity = flashT > 0 ? 70 * (flashT / 0.05) : 0;
    for (const t of TR) {
      if (!t.o.visible) continue;
      t.s += dt * 420; const head = Math.min(t.s, t.L), tail = Math.max(0, t.s - 7);
      if (tail >= t.L) { t.o.visible = false; continue; }
      t.o.material.uniforms.a.value.copy(t.a).lerp(t.b, tail / t.L); t.o.material.uniforms.b.value.copy(t.a).lerp(t.b, head / t.L);
    }
    const H = rnd.stats().size[1], sc = H / (2 * Math.tan(cam.fov * PI / 360));
    sparks.m.uniforms.uScale.value = dust.m.uniforms.uScale.value = sc;
    sparks.update(dt); dust.update(dt);
  }
  return {
    flash() { flashT = 0.05; flash.rotation.z = Math.random() * TAU; flash.scale.setScalar(rand(0.8, 1.25)); VM.muzzle(light.position); },
    tracer, impact, decal, burst, update, sparks, dust,
  };
})();

// ---------------------------------------------------------------- HUD
const HUD = { mag: -1, res: -1, sh: -1, hp: -1, hit: 0, hitEl: $('hit'), ret: [...$('ret').children], toastT: 0, nums: [] };
function hitMarker(kind) {
  HUD.hit = 1; HUD.hitEl.className = 'hud' + (kind ? ' ' + kind : '');
  if (kind === 'kill') AU.noise({ dur: 0.12, freq: 2400, type: 'bandpass', q: 3, gain: 0.25, wet: 0.1 });
  else AU.noise({ dur: 0.04, freq: kind === 'crit' ? 5200 : 3600, type: 'bandpass', q: 5, gain: kind === 'crit' ? 0.22 : 0.14, wet: 0 });
}
function damageNumber(p, dmg, crit) {
  const el = document.createElement('span'); el.textContent = Math.round(dmg); if (crit) el.className = 'c'; $('nums').appendChild(el);
  HUD.nums.push({ el, p: p.clone(), t: 0, dx: rand(-14, 14) });
  if (HUD.nums.length > 24) HUD.nums.shift().el.remove();
}
function toast(s, t) { const el = $('toast'); el.textContent = s; el.style.opacity = 1; HUD.toastT = t || 2.2; }
function updateHUD(dt) {
  if (GS.mag !== HUD.mag || GS.res !== HUD.res) {
    HUD.mag = GS.mag; HUD.res = GS.res; $('ammo').querySelector('.n').textContent = GS.mag; $('ammo').querySelector('.r').textContent = '/ ' + GS.res;
    $('ammo').classList.toggle('empty', GS.mag === 0);
  }
  const bar = (sel, v, last) => { if (Math.abs(v - last) < 0.2) return last; const b = $('vit').querySelector(sel); b.querySelector('b').style.transform = `scaleX(${v / 100})`; return v; };
  HUD.sh = bar('.sh', P.sh, HUD.sh); HUD.hp = bar('.hp', P.hp, HUD.hp); $('vit').querySelector('.hp').classList.toggle('low', P.hp < 35);
  // the reticle: the ticks stand off by the spread (as it shows on screen); down the sights her rifle's own sights take over
  const px = Math.tan(spreadNow()) / Math.tan(cam.fov * PI / 360) * innerHeight / 2 + 4, ra = 1 - smooth(0.3, 0.7, GS.ads) - GS.sprint;
  const [t, b, l, r, d] = HUD.ret;
  t.style.transform = `translateY(${-px - 9}px)`; b.style.transform = `translateY(${px}px)`; l.style.transform = `translateX(${-px - 9}px)`; r.style.transform = `translateX(${px}px)`;
  $('ret').style.opacity = clamp(ra, 0, 1);
  HUD.hit = Math.max(0, HUD.hit - dt * 5); HUD.hitEl.style.opacity = HUD.hit;
  $('dmg').style.opacity = P.dmg;
  if (HUD.toastT > 0) { HUD.toastT -= dt; if (HUD.toastT <= 0) $('toast').style.opacity = 0; }
  // damage numbers rise and fade where they struck
  for (let i = HUD.nums.length - 1; i >= 0; i--) {
    const n = HUD.nums[i]; n.t += dt; if (n.t > 0.9) { n.el.remove(); HUD.nums.splice(i, 1); continue; }
    tmp.copy(n.p).project(cam); if (tmp.z > 1) { n.el.style.opacity = 0; continue; }
    n.el.style.left = ((tmp.x + 1) / 2 * innerWidth + n.dx) + 'px'; n.el.style.top = ((1 - tmp.y) / 2 * innerHeight - n.t * 46) + 'px'; n.el.style.opacity = 1 - smooth(0.5, 0.9, n.t);
  }
  if (ABIL) ABIL.hud();
}

// ---------------------------------------------------------------- the menu, pause and settings
function setPaused(on) {
  if (G.state !== 'play') return;
  G.paused = on; $('menu').classList.toggle('off', !on); $('hud').classList.toggle('off', on);
  $('play').textContent = 'Resume'; $('sub').textContent = 'Paused';
  if (on) { KEY.clear(); IN.fire = IN.ads = false; }
}
function begin(noLock) {
  AU.start(); AU.setVol(SET.vol);
  if (G.state !== 'play') { G.state = 'play'; spawnPlayer(); if (FOE) FOE.begin(); if (ABIL) ABIL.reset(); toast('Close the rift', 3); }
  G.paused = false; $('menu').classList.add('off'); $('hud').classList.remove('off');
  if (!noLock && !lockFailed && !window.__vgNoLock) lockMouse();
}
$('play').addEventListener('click', () => begin());
const bindSet = (id, key, fmt, apply) => {
  const el = $(id), out = $(id + 'V'); el.value = SET[key];
  const show = () => { if (out) out.textContent = fmt(SET[key]); };
  el.addEventListener('input', () => { SET[key] = el.type === 'range' ? +el.value : el.value; show(); apply && apply(); saveSet(); }); show();
};
bindSet('sens', 'sens', v => v.toFixed(2));
bindSet('fov', 'fov', v => String(v));
bindSet('vol', 'vol', v => String(Math.round(v * 100)), () => AU.setVol(SET.vol));
bindSet('qual', 'qual', v => v, () => rnd.setQuality(SET.qual));

// ---------------------------------------------------------------- the loop
function resize() { cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); rnd.setSize(innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 1.5)); }
addEventListener('resize', resize); resize();
spawnPlayer();
function step(dt) {
  G.t += dt;
  const play = G.state === 'play' && !G.paused;
  if (play) { stepPlayer(dt); stepGun(dt); }
  else {      // the menu: the view drifts slowly round the courtyard
    lookX = lookY = 0; P.look = { x: 0, y: 0 };
    if (G.state === 'menu') { P.yaw = 0.35 * Math.sin(G.t * 0.05); P.pitch = 0.04 + 0.03 * Math.sin(G.t * 0.07); }
  }
  placeCamera(dt);
  if (FOE && !G.noFoes) FOE.update(play ? dt : 0, G.t);
  if (ABIL && play) ABIL.update(dt);
  VM.group.visible = G.state === 'play' && P.alive;
  VM.update(dt, { ads: GS.ads, sprint: GS.sprint, speed: Math.hypot(P.vel.x, P.vel.z), air: !P.ground, look: P.look, reload: GS.rl,
    trigger: GS.since < 1.2 || IN.fire || GS.ads > 0.5, t: G.t });
  ZONE.update(dt, G.t, cam.position);
  FX.update(dt);
  rnd.setFocus(P.pos);
  AU.listener(cam);
  if (G.state === 'play') updateHUD(dt);
}
function draw(dt) { rnd.render(scene, cam, dt); G.frames++; }
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  if (G.norender) return;
  step(dt); draw(dt);
}
requestAnimationFrame(frame);
// ready once the zone's scans and her maps have loaded and a frame has been drawn
T.DefaultLoadingManager.onLoad = () => { G.loaded = true; };
setTimeout(() => { G.loaded = true; }, 8000);
(function ready() { if (G.loaded && G.frames > 1) window.__ready = true; else setTimeout(ready, 100); })();

// ---------------------------------------------------------------- test hook
window.__vg = {
  G, P, GS, GUN, VM, LOOK, rnd, cam, scene, SET, FX,
  begin() { window.__vgNoLock = true; begin(true); return 'ok'; },
  sim(s, fps) { const n = Math.round(s * (fps || 60)); for (let i = 0; i < n; i++) step(1 / (fps || 60)); draw(1 / 60); return this.state(); },
  set(o) {
    if (o.pos) { P.pos.set(...o.pos); if (o.pos.length < 3 || o.ground) P.pos.y = groundAt(P.pos.x, P.pos.z, 50, MV.r, 0); }
    if (o.yaw !== undefined) P.yaw = o.yaw; if (o.pitch !== undefined) P.pitch = o.pitch;
    if (o.hp !== undefined) P.hp = o.hp; if (o.sh !== undefined) P.sh = o.sh; if (o.god !== undefined) G.god = o.god;
    if (o.mag !== undefined) GS.mag = o.mag; if (o.ads !== undefined) GS.ads = o.ads; if (o.sprint !== undefined) GS.sprint = o.sprint;
    if (o.reload !== undefined) GS.rl = o.reload; return this.state();
  },
  input(o) { Object.assign(IN, o); return { ...IN }; },
  key(code, on) { if (on) KEY.add(code); else KEY.delete(code); },
  fire(n) { let k = 0; while (k < (n || 1) && GS.mag > 0) { shoot(); k++; } return GS.mag; },
  reload: startReload,
  look(dx, dy) { lookX += dx || 0; lookY += dy || 0; },
  look_: applyLook,
  hurt: hurtPlayer,
  hide(on) { $('menu').style.display = on ? 'none' : ''; $('hud').style.display = on === 'hud' ? 'none' : ''; },
  norender(on) { G.norender = !!on; },
  state() {
    return { state: G.state, paused: G.paused, t: +G.t.toFixed(2), pos: P.pos.toArray().map(v => +v.toFixed(2)), yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(3),
      ground: P.ground, hp: Math.round(P.hp), sh: Math.round(P.sh), alive: P.alive, mag: GS.mag, res: GS.res, reload: +GS.rl.toFixed(2), ads: +GS.ads.toFixed(2),
      sprint: +GS.sprint.toFixed(2), shots: GS.shots, hits: GS.hits, foes: FOE ? FOE.state() : null, abil: ABIL ? ABIL.state() : null, render: rnd.stats().msAvg | 0 };
  },
};
