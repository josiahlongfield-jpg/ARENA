// ==================================================================== her arms and her rifle
// The arms are the sculpt's own at full detail (vigil/tools/fp_arms.py), with modelled gauntlet hands (vigil/tools/gauntlet.py), since
// Tripo fused the sculpt's fingers. Tripo's rig gives one bone per hand, so the fingers are joints of our own, three to a finger. Each arm is a two-bone chain: the shoulder and elbow hang along their local -Y and bend about local x,
// so armTo can aim them, and the hand takes whatever turn its grip asks for. The finger joints rest square to her rest space, so each
// one's turn is the one vigil/tools/grip_solve.py found for that grip (GRIP below), and a curl is a turn about the joint's flex axis.
const FING = ['thumb', 'index', 'middle', 'ring', 'little'];
const _qw = new T.Quaternion(), _qp = new T.Quaternion(), _mb = new T.Matrix4(), _ra = new V3(), _rb = new V3(), _rc = new V3(), _rd = new V3();
function setWorldQ(bone, q) { bone.parent.getWorldQuaternion(_qp); bone.quaternion.copy(_qp.invert().multiply(q)); bone.updateMatrixWorld(true); }
const basisQ = (x, y, z) => _qw.setFromRotationMatrix(_mb.makeBasis(x, y, z));
// turn a bone so its -Y runs along dir, with its z as near to hint as that allows
function boneAlong(bone, dir, hint) {
  const y = _ra.copy(dir).normalize().negate(), z = _rb.copy(hint).addScaledVector(y, -hint.dot(y)).normalize();
  setWorldQ(bone, basisQ(_rc.crossVectors(y, z), y, z));
}
// the middle joint of a two-bone chain: lengths a and b from S to W, bent toward the pole
function midJoint(S, W, a, b, pole) {
  const n = _ra.subVectors(W, S), d = clamp(n.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4); n.normalize();
  const ca = (a * a + d * d - b * b) / (2 * a * d), p = _rb.copy(pole).addScaledVector(n, -pole.dot(n)).normalize();
  return new V3().copy(S).addScaledVector(n, a * ca).addScaledVector(p, a * Math.sqrt(Math.max(0, 1 - ca * ca)));
}

// the glove and its plates, matched to her own: the glove to the sculpt's glove, the plates to her forearm plates
// (colour, roughness and metal sampled from her maps; no glow on the hands)
const handMats = () => [
  new T.MeshStandardMaterial({ color: new T.Color(0x0e0e0f).convertSRGBToLinear(), roughness: 0.84, metalness: 0.2, skinning: true }),
  new T.MeshStandardMaterial({ color: new T.Color(0x2d2d2f).convertSRGBToLinear(), roughness: 0.74, metalness: 0.48, skinning: true })];
function buildArms(A) {
  const at = k => new V3(...A.at[k]), root = new T.Group(), J = { root, A };
  const g = (parent, p) => { const o = new T.Group(); o.position.copy(p); parent.add(o); return o; };
  for (const s of 'LR') {
    J['sh' + s] = g(root, at('sh' + s));
    J['el' + s] = g(J['sh' + s], new V3(0, -at('el' + s).distanceTo(at('sh' + s)), 0));
    J['hd' + s] = g(J['el' + s], new V3(0, -at('hd' + s).distanceTo(at('el' + s)), 0));
    J['tw' + s] = g(J['el' + s], new V3(0, -at('tw' + s).distanceTo(at('el' + s)), 0));
  }
  root.updateMatrixWorld(true);
  for (const s of 'LR') {
    boneAlong(J['sh' + s], at('el' + s).sub(at('sh' + s)), new V3(0, 0, -1));
    boneAlong(J['el' + s], at('hd' + s).sub(at('el' + s)), new V3(0, 0, -1));
    boneAlong(J['hd' + s], new V3(...A.hand[s].u), new V3(0, 0, 1));
  }
  const names = A.arm.concat(A.fingers.names);
  A.fingers.names.forEach((k, i) => {
    const par = J[names[A.fingers.parent[i]]], o = new T.Group(); par.add(o);
    o.position.copy(par.worldToLocal(new V3(...A.fingers.pos[i]))); par.getWorldQuaternion(o.quaternion).invert(); J[k] = o; o.updateMatrixWorld(true);
  });
  const bones = names.map(k => J[k]);
  const tl = new T.TextureLoader(), tex = (k, srgb) => { const t = tl.load(A.tex[k]); t.flipY = false; if (srgb) t.encoding = T.sRGBEncoding; t.anisotropy = 8; return t; };
  const orm = tex('orm'), mat = new T.MeshStandardMaterial({ map: tex('color', true), normalMap: tex('normal'), normalScale: new T.Vector2(1, -1), roughnessMap: orm, metalnessMap: orm,
    emissiveMap: tex('emis', true), emissive: 0xffffff, emissiveIntensity: 2.4, skinning: true });
  const mesh = new T.SkinnedMesh(skinGeo(A.geo), mat); mesh.frustumCulled = false; mesh.receiveShadow = true; root.add(mesh);
  mesh.bind(new T.Skeleton(bones, bones.map(b => b.matrixWorld.clone().invert())), new T.Matrix4());
  J.mesh = mesh;
  if (A.hands) {      // the modelled gauntlets (vigil/tools/gauntlet.py) in place of the sculpt's fused hands, on the same skeleton
    const hm = new T.SkinnedMesh(handsGeo(A.hands), handMats()); hm.frustumCulled = false; hm.receiveShadow = true; root.add(hm);
    hm.bind(mesh.skeleton, new T.Matrix4()); J.hands = hm;
  }
  J.rest = {}; J.restW = {};
  for (const k of names) { J.rest[k] = J[k].quaternion.clone(); J.restW[k] = J[k].matrixWorld.clone(); }
  // each finger joint's flex axis (the same in its own frame as in her rest space)
  J.axis = {}; A.fingers.names.forEach((k, i) => { J.axis[k] = new V3(...A.fingers.axis[i]); });
  return J;
}
// reach the hand's joint to Mt (a world matrix), the elbow bending toward the pole; the forearm's twist joint takes half the hand's roll
function armTo(J, s, Mt, pole) {
  const sh = J['sh' + s], el = J['el' + s], hd = J['hd' + s], tw = J['tw' + s];
  const S = sh.getWorldPosition(new V3()), W = new V3().setFromMatrixPosition(Mt), E = midJoint(S, W, el.position.length(), hd.position.length(), pole);
  const x = new V3().crossVectors(_rc.subVectors(E, S), _rd.subVectors(W, E)).normalize(), y = new V3().subVectors(S, E).normalize();
  setWorldQ(sh, basisQ(x, y, new V3().crossVectors(x, y)));
  y.subVectors(E, W).normalize(); setWorldQ(el, basisQ(x, y, new V3().crossVectors(x, y)));
  setWorldQ(hd, _qw.setFromRotationMatrix(_mb.extractRotation(Mt)));
  const d = hd.quaternion.clone().multiply(J.rest['hd' + s].clone().invert()), tq = new T.Quaternion(0, d.y, 0, d.w).normalize();
  tw.quaternion.copy(J.rest['tw' + s]).multiply(new T.Quaternion().slerp(tq, 0.5)); tw.updateMatrixWorld(true);
}
// a grip (grip_solve.py): T takes the hand from her rest space into the rifle's frame; q is each finger joint's turn (thumb..little, 3 each)
function gripOf(g) { return { T: new T.Matrix4().set(...g.T.flat()), q: g.q.map(q => new T.Quaternion(...q)), ang: g.ang }; }
// pose one hand's fingers: the grip's turns, with any finger blended toward open (o[f] 0..1) and curled a little further (c[f], radians)
const _fq = new T.Quaternion(), _fa = new T.Quaternion(), _I = new T.Quaternion();
function fingersTo(J, s, grip, open, curl) {
  FING.forEach((f, fi) => {
    const op = open && open[f] || 0, cu = curl && curl[f] || 0;
    for (let k = 0; k < 3; k++) {
      const n = f + (k + 1) + s; _fq.copy(grip.q[fi * 3 + k]); if (op) _fq.slerp(_I, op);
      if (cu) _fq.premultiply(_fa.setFromAxisAngle(J.axis[n], cu * (k === 0 ? 0.6 : 1)));
      J[n].quaternion.copy(J.rest[n]).multiply(_fq);
    }
  });
}

// ---- the rifle (vigil/tools/rifle_pack.py): metres, muzzle -Z, top +Y, its right side +X, origin at the rear sight on the sight line
function buildRifle(R) {
  const tl = new T.TextureLoader(), tex = (k, srgb) => { const t = tl.load(R.tex[k]); if (srgb) t.encoding = T.sRGBEncoding; t.anisotropy = 8; return t; };
  const orm = tex('orm'), [pr, ph] = R.pts.peep;
  const mat = new T.MeshStandardMaterial({ map: tex('color', true), normalMap: tex('normal'), roughnessMap: orm, metalnessMap: orm });
  // Tripo left the rear sight solid: cut the peep hole through it on the sight line (the rifle's own z axis)
  mat.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vRP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRP = position;');
    sh.fragmentShader = 'varying vec3 vRP;\n' + sh.fragmentShader.replace('void main() {', `void main() {\n  if (dot(vRP.xy, vRP.xy) < ${(pr * pr).toExponential(4)} && abs(vRP.z) < ${ph.toFixed(5)}) discard;`);
  };
  mat.customProgramCacheKey = () => 'vgRifle';
  const group = new T.Group(), body = chunkGroup(R.body, mat), mag = chunkGroup(R.mag, mat);
  group.add(body, mag); group.matrixAutoUpdate = false; mag.matrixAutoUpdate = false;
  // the vertical foregrip (vigil/tools/foregrip.py) is modelled, not baked, so it takes plain materials in the rifle's own greys
  if (R.fore) group.add(chunkGroup(R.fore, new T.MeshStandardMaterial({ color: new T.Color(0x2e2e2d).convertSRGBToLinear(), roughness: 0.78, metalness: 0.3 })),
    chunkGroup(R.clamp, new T.MeshStandardMaterial({ color: new T.Color(0x29292a).convertSRGBToLinear(), roughness: 0.55, metalness: 0.7 })));
  const pts = {}; for (const k in R.pts) if (R.pts[k].length === 3) pts[k] = new V3(...R.pts[k]);
  return { group, body, mag, mat, pts };
}
