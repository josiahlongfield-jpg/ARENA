// ==================================================================== the viewmodel: her arms and the rifle in front of the camera
// Everything here lives in the camera's space (x right, y up, -z ahead) and is drawn in the renderer's viewmodel pass (layer 1, with
// its own FOV). Each frame the rifle is placed from a blend of poses (hip, down the sights, sprinting, reloading) plus sway, bob and
// recoil; then each arm reaches for its grip (grip_solve.py's T), the shoulder giving a little when the grip is out of reach, and the
// fingers take the grip's turns: the trigger finger lies along the receiver whenever she isn't ready to fire.
const VM = (() => {
  const A = ASSETS.arms, J = buildArms(A), RF = buildRifle(ASSETS.rifle), GR = { L: gripOf(ASSETS.grips.L), R: gripOf(ASSETS.grips.R) };
  const group = new T.Group(); group.add(J.root, RF.group);
  // her rest space faces +Z with her right eye at EYE; turned to face -Z with that eye at the camera
  const EYE = new V3(-0.032, 1.80, 0.055);
  J.root.rotation.y = PI; J.root.position.set(EYE.x, -EYE.y, EYE.z);
  // where her shoulders sit in camera space, from the character room's stance (vigil/tools: st_eval): down the sights her cheek is on the
  // stock, so the right shoulder is under the eye and behind it; at the hip her head lifts a few centimetres off the stock
  const SH = { ads: { L: new V3(-0.265, -0.119, 0.008), R: new V3(0.013, -0.137, 0.248) } };
  SH.hip = { L: SH.ads.L.clone().add(new V3(0, -0.03, 0.02)), R: SH.ads.R.clone().add(new V3(0, -0.03, 0.02)) };
  const POLE = { L: new V3(-0.6, -1, 0.1), R: new V3(1, -0.7, 0.2) };                      // which way each elbow goes (camera space)
  // poses: the rifle frame's origin (the rear sight) in camera space and its turn (pitch, yaw, roll); RELIEF puts the eye behind the sight
  const RELIEF = 0.145;
  const POSE = {
    hip:    { p: new V3(0.115, -0.135, -0.19), r: new V3(0.02, 0.055, -0.06) },
    ads:    { p: new V3(0, 0, -RELIEF), r: new V3(0, 0, 0) },
    sprint: { p: new V3(0.06, -0.20, -0.16), r: new V3(-0.32, 0.62, 0.42) },
    reload: { p: new V3(0.07, -0.16, -0.24), r: new V3(0.22, 0.18, -0.52) },
  };
  const S = { sway: new V3(), swayV: new V3(), bob: 0, kick: new V3(), kickV: new V3(), rot: new V3(), rotV: new V3(), trig: 0, pull: 0, land: 0, landV: 0 };
  const _p = new V3(), _r = new V3(), _q = new T.Quaternion(), _e = new T.Euler(), _m = new T.Matrix4(), _m2 = new T.Matrix4(), _s = new V3(), _w = new V3();
  const HT = { L: new T.Matrix4(), R: new T.Matrix4() };      // this frame's hand targets (world)
  // a damped spring, for sway and recoil: x pulled back to rest, v its velocity
  const spring = (x, v, k, c, dt) => { v.addScaledVector(x, -k * dt).multiplyScalar(Math.max(0, 1 - c * dt)); x.addScaledVector(v, dt); };
  function blendPose(st) {
    // the hip pose, eased toward the sights by ads, toward the sprint pose, and toward the reload pose through the reload's middle
    _p.copy(POSE.hip.p).lerp(POSE.ads.p, st.ads); _r.copy(POSE.hip.r).lerp(POSE.ads.r, st.ads);
    if (st.sprint > 0) { _p.lerp(POSE.sprint.p, st.sprint); _r.lerp(POSE.sprint.r, st.sprint); }
    if (st.reload > 0) { const k = smooth(0, 0.18, st.reload) * (1 - smooth(0.82, 1, st.reload)); _p.lerp(POSE.reload.p, k); _r.lerp(POSE.reload.r, k); }
  }
  // st: { ads 0..1, sprint 0..1, speed (m/s on the ground), air, look {x, y} (this frame's turn, radians), reload (-1 or 0..1),
  //       trigger (ready to fire), t (time) }; look.x is the turn left, look.y the turn up
  function update(dt, st) {
    blendPose(st);
    // sway: the rifle lags the look a little, less down the sights
    const sw = 1 - 0.75 * st.ads; S.swayV.x -= st.look.x * 1.6 * sw; S.swayV.y -= st.look.y * 1.6 * sw;
    spring(S.sway, S.swayV, 90, 12, dt);
    // bob: a figure of eight with the stride, smaller down the sights
    const sp = st.air ? 0 : clamp(st.speed / 4.5, 0, 1.6); S.bob += dt * (6 + 3 * st.sprint) * (sp > 0.05 ? 1 : 0);
    const bo = sp * (1 - 0.8 * st.ads) * 0.009;
    // recoil springs: position kicks back and up, the turn climbs; landing dips the rifle
    spring(S.kick, S.kickV, 260, 22, dt); spring(S.rot, S.rotV, 220, 20, dt);
    S.landV += (-S.land * 140 - S.landV * 14) * dt; S.land += S.landV * dt;
    _p.x += S.sway.x * 0.02 + Math.sin(S.bob) * bo; _p.y += S.sway.y * 0.02 - Math.abs(Math.cos(S.bob)) * bo * 0.8 + S.land;
    _p.add(S.kick); _r.x += S.rot.x + S.sway.y * 0.12; _r.y += S.rot.y + S.sway.x * 0.16; _r.z += S.rot.z + S.sway.x * 0.2;
    // breathing, when still
    _p.y += Math.sin(st.t * 1.6) * 0.0012 * (1 - sp); _r.x += Math.sin(st.t * 1.6 + 0.7) * 0.002 * (1 - 0.6 * st.ads);
    // the rifle turns about its grip (where the recoil and the wrist turn it), not about the rear sight
    const pivot = RF.pts.gripTop;
    _q.setFromEuler(_e.set(_r.x, _r.y, _r.z, 'YXZ'));
    _m.makeRotationFromQuaternion(_q); _s.copy(pivot).applyMatrix4(_m).negate().add(pivot).add(_p);
    _m.setPosition(_s); RF.group.matrix.copy(_m); RF.group.matrixWorldNeedsUpdate = true;
    // the magazine: out and back during a reload (in its own frame, along magDir)
    reloadMag(st.reload);
    group.updateMatrixWorld(true);
    // where each hand goes: onto its grip (the rifle's matrix x the grip's T x the hand's rest matrix); the left hand leaves the
    // foregrip for the magazine during a reload
    const rw = _m2.multiplyMatrices(group.matrixWorld, RF.group.matrix);
    HT.R.copy(rw).multiply(GR.R.T).multiply(J.restW.hdR);
    if (st.reload > 0) reloadTarget(st.reload, rw, HT.L); else HT.L.copy(rw).multiply(GR.L.T).multiply(J.restW.hdL);
    // the shoulders: where the stance puts them; a grip out of reach brings the shoulder forward to it, as a real one would, up to 7 cm
    for (const s of 'LR') {
      _s.copy(SH.hip[s]).lerp(SH.ads[s], st.ads); group.localToWorld(_s);
      const w = _w.setFromMatrixPosition(HT[s]), reach = (J['el' + s].position.length() + J['hd' + s].position.length()) * 0.97, d = _s.distanceTo(w);
      if (d > reach) _s.lerp(w, Math.min(d - reach, 0.07) / d);
      J['sh' + s].position.copy(J.root.worldToLocal(_s));
    }
    J.root.updateMatrixWorld(true);
    for (const s of 'LR') armTo(J, s, HT[s], _w.copy(POLE[s]).transformDirection(group.matrixWorld));
    // fingers: the trigger finger lies straight along the receiver unless she's ready to fire, and curls a little more on a shot
    S.trig += ((st.trigger ? 1 : 0) - S.trig) * damp(14, dt);
    fingersTo(J, 'R', GR.R, { index: 1 - S.trig }, { index: S.trig * S.pull * 0.12 });
    S.pull = Math.max(0, S.pull - dt * 12);
    if (st.reload > 0) reloadFingers(st.reload); else fingersTo(J, 'L', GR.L);
  }
  // one shot: the kick (more from the hip), a random sideways twitch, and the trigger finger's pull
  function fire(o) {
    const k = 1 - 0.55 * (o.ads || 0);
    S.kickV.z += 0.9 * k; S.kickV.y += 0.25 * k; S.rotV.x += 1.5 * k; S.rotV.y += rand(-0.5, 0.5) * k; S.rotV.z += rand(-0.6, 0.6) * k; S.pull = 1;
  }
  function land(v) { S.landV -= clamp(v, 0, 12) * 0.012; }
  // ---- reload: the magazine drops out along its own axis, the left hand fetches a new one from her belt and seats it
  const magDir = new V3(...ASSETS.rifle.pts.magDir);
  function magOffset(u) {     // how far the magazine is out (metres along magDir) through the reload
    if (u < 0.12) return 0; if (u < 0.3) return smooth(0.12, 0.3, u) * 0.35;      // out and falling
    if (u < 0.55) return 0.35 - smooth(0.3, 0.55, u) * 0.30;                    // the new one comes up in her hand
    if (u < 0.72) return 0.05 * (1 - smooth(0.55, 0.72, u));                     // seated with a push
    return 0;
  }
  function reloadMag(u) {
    if (!(u > 0)) { RF.mag.matrix.identity(); RF.mag.visible = true; return; }
    const d = magOffset(u); RF.mag.matrix.makeTranslation(magDir.x * d, magDir.y * d, magDir.z * d); RF.mag.matrixWorldNeedsUpdate = true;
    RF.mag.visible = !(u > 0.27 && u < 0.33);      // the old one is gone before the new one comes up
  }
  // the left hand on the magazine: the foregrip grip, carried down the magazine's axis with it, and back to the foregrip at the end
  const reloadK = u => smooth(0.08, 0.2, u) * (1 - smooth(0.72, 0.88, u));
  function reloadTarget(u, rw, out) {
    const k = reloadK(u), d = magOffset(u);
    return out.copy(rw).multiply(_m.makeTranslation(magDir.x * d, magDir.y * d - 0.06 * k, magDir.z * d + 0.17 * k)).multiply(GR.L.T).multiply(J.restW.hdL);
  }
  function reloadFingers(u) { const k = reloadK(u); fingersTo(J, 'L', GR.L, null, { thumb: -0.2 * k, index: -0.3 * k, middle: -0.3 * k, ring: -0.25 * k, little: -0.2 * k }); }
  // where the muzzle is and which way it points, in world space (for the flash and the tracer)
  function muzzle(out, dir) {
    out.copy(RF.pts.muzzle).applyMatrix4(RF.group.matrixWorld);
    if (dir) dir.set(0, 0, -1).transformDirection(RF.group.matrixWorld);
    return out;
  }
  return { group, J, RF, GR, update, fire, land, muzzle, POSE, SH, POLE };
})();
