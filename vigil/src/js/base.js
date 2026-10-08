// ==================================================================== base: helpers, decoding the packed assets, sound
const T = THREE, V3 = THREE.Vector3, PI = Math.PI, TAU = PI * 2;
const $ = id => document.getElementById(id);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x, lerp = (a, b, t) => a + (b - a) * t, damp = (k, dt) => 1 - Math.exp(-k * dt);
const rand = (a, b) => a + Math.random() * (b - a), randi = (a, b) => Math.floor(rand(a, b + 1)), pick = a => a[Math.floor(Math.random() * a.length)];
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
const bytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const tmp = new V3(), tmp2 = new V3(), tmp3 = new V3(), UP = new V3(0, 1, 0);
// a seeded random for the zone, so it is laid out the same every time
let SEED = 7; const srand = () => (SEED = (SEED * 16807) % 2147483647) / 2147483647, srange = (a, b) => a + srand() * (b - a);

// ---- packed meshes. Skinned packs (vigil_pack.py, tripo_rig_pack.py, fp_arms.py): positions f32, normals i8, uv u16, skin bytes.
function skinGeo(g) {
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(new Float32Array(bytes(g.pos).buffer), 3));
  geo.setAttribute('normal', new T.BufferAttribute(new Int8Array(bytes(g.nrm).buffer), 3, true));
  geo.setAttribute('uv', new T.BufferAttribute(new Uint16Array(bytes(g.uv).buffer), 2, true));
  geo.setAttribute('skinIndex', new T.BufferAttribute(bytes(g.ji), 4));
  geo.setAttribute('skinWeight', new T.BufferAttribute(bytes(g.jw), 4, true));
  geo.setIndex(new T.BufferAttribute(g.i32 ? new Uint32Array(bytes(g.idx).buffer) : new Uint16Array(bytes(g.idx).buffer), 1));
  return geo;
}
// their material: Tripo's maps (glTF orientation, so no flip), the glow as emission
function packMat(A, o) {
  const tl = new T.TextureLoader(), tex = (k, srgb) => { const t = tl.load(A.tex[k]); t.flipY = false; if (srgb) t.encoding = T.sRGBEncoding; t.anisotropy = 4; return t; };
  const orm = tex('orm');
  return new T.MeshStandardMaterial(Object.assign({ map: tex('color', true), normalMap: tex('normal'), normalScale: new T.Vector2(1, -1), roughnessMap: orm, metalnessMap: orm,
    emissiveMap: A.tex.emis ? tex('emis', true) : null, emissive: A.tex.emis ? 0xffffff : 0x000000, emissiveIntensity: 2.4, skinning: true }, o || {}));
}
// the rifle (rifle_pack.py): 16-bit positions across its box, cut in chunks so each index fits 16 bits
function chunkGroup(q, mat) {
  const g = new T.Group();
  for (const c of q.chunks) {
    const geo = new T.BufferGeometry(), u = new Uint16Array(bytes(c.pos).buffer), p = new Float32Array(u.length);
    for (let i = 0; i < u.length; i++) p[i] = q.lo[i % 3] + u[i] * q.sc[i % 3];
    geo.setAttribute('position', new T.BufferAttribute(p, 3));
    geo.setAttribute('normal', new T.BufferAttribute(new Int8Array(bytes(c.nrm).buffer), 3, true));
    geo.setAttribute('uv', new T.BufferAttribute(new Uint16Array(bytes(c.uv).buffer), 2, true));
    geo.setIndex(new T.BufferAttribute(new Uint16Array(bytes(c.idx).buffer), 1));
    const m = new T.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; g.add(m);
  }
  return g;
}
// a Tripo rig (tripo_rig_pack.py): the joint tree, inverse binds and clips. The holder scales the rig to height H; the mesh is bound
// in the rig's own space (arm.matrix), never the scaled world, or the scale would apply twice.
function rigClips(A, filter) {
  const clips = {};
  for (const [name, c] of Object.entries(A.clips)) {
    const tracks = c.tr.filter(tr => !filter || filter(name, tr)).map(([bone, k, n, b]) => {
      const times = Float32Array.from({ length: n }, (_, i) => i / c.fps), raw = bytes(b).buffer;
      if (k === 't') return new T.VectorKeyframeTrack(bone + '.position', times, new Float32Array(raw));
      const q = new Int16Array(raw), f = new Float32Array(q.length); for (let i = 0; i < q.length; i++) f[i] = q[i] / 32767;
      return new T.QuaternionKeyframeTrack(bone + '.quaternion', times, f);
    });
    clips[name] = new T.AnimationClip(name, c.d, tracks);
  }
  return clips;
}
function rigFactory(A, H, filter, matOpts) {
  const g = A.geo, geo = skinGeo(g), mat = packMat(A, matOpts), clips = rigClips(A, filter), k = H / g.height;
  const ibm = []; for (let i = 0; i < g.joints.length; i++) ibm.push(new T.Matrix4().fromArray(g.ibm, i * 16));
  return function build() {
    const bones = A.tree.map(n => { const b = new T.Bone(); b.name = n.n; b.position.fromArray(n.t); b.quaternion.fromArray(n.r); b.scale.fromArray(n.s); return b; });
    A.tree.forEach((n, i) => { if (n.p >= 0) bones[n.p].add(bones[i]); });
    const arm = bones[0], root = new T.Group(), holder = new T.Group();
    holder.rotation.y = -PI / 2; holder.scale.setScalar(k); holder.add(arm); root.add(holder);
    const m = mat.clone(), mesh = new T.SkinnedMesh(geo, m); mesh.castShadow = true; mesh.frustumCulled = false; arm.add(mesh);
    arm.updateMatrix(); mesh.bind(new T.Skeleton(g.joints.map(i => bones[i]), ibm), arm.matrix.clone());
    const mix = new T.AnimationMixer(arm), act = {};
    for (const n in clips) act[n] = mix.clipAction(clips[n]);
    const bone = {}; for (const b of bones) bone[b.name] = b;
    return { root, holder, mesh, mat: m, mix, act, bone, k, cur: null };
  };
}

// ---- sound: the recordings (MP3 in base64) decoded once; a shot is one buffer source through a panner where it comes from
const AU = (() => {
  let ctx = null, master = null, verb = null; const buf = {}, vol = { v: 0.8 };
  function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    ctx = new C(); master = ctx.createGain(); master.gain.value = vol.v; master.connect(ctx.destination);
    // a short stone-hall reverb from decaying noise, for distance and size
    const n = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
    verb = ctx.createConvolver(); verb.buffer = ir; const vg = ctx.createGain(); vg.gain.value = 0.32; verb.connect(vg); vg.connect(master);
    for (const [k, s] of Object.entries(ASSETS.snd || {})) {
      const b = bytes(s.split(',')[1] || s).buffer;
      ctx.decodeAudioData(b, d => { buf[k] = d; }, () => {});
    }
  }
  function listener(cam) {
    if (!ctx) return; const L = ctx.listener, p = cam.position, f = tmp.set(0, 0, -1).applyQuaternion(cam.quaternion), u = tmp2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z; }
    else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }
  // play(key, {at: Vector3, gain, rate, wet}); key may be an array to pick from
  function play(key, o) {
    if (!ctx) return; o = o || {}; const k = Array.isArray(key) ? pick(key) : key, b = buf[k]; if (!b) return;
    const src = ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = (o.rate || 1) * (o.vary ? rand(1 - o.vary, 1 + o.vary) : 1);
    const g = ctx.createGain(); g.gain.value = o.gain === undefined ? 1 : o.gain; src.connect(g);
    let out = g;
    if (o.at) { const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = o.ref || 3; p.rolloffFactor = o.roll || 1.1;
      if (p.positionX) { p.positionX.value = o.at.x; p.positionY.value = o.at.y; p.positionZ.value = o.at.z; } else p.setPosition(o.at.x, o.at.y, o.at.z);
      g.connect(p); out = p; }
    out.connect(master); if (o.wet !== 0) { const w = ctx.createGain(); w.gain.value = o.wet === undefined ? 0.5 : o.wet; out.connect(w); w.connect(verb); }
    src.start(ctx.currentTime + (o.delay || 0));
    return src;
  }
  // a synthesised layer: filtered noise with an envelope (the grenade's roar, the Feyr's hiss, the rift's hum)
  function noise(o) {
    if (!ctx) return; const d = o.dur || 0.4, n = Math.ceil(ctx.sampleRate * d), b = ctx.createBuffer(1, n, ctx.sampleRate), x = b.getChannelData(0);
    for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, o.decay || 2);
    const src = ctx.createBufferSource(); src.buffer = b; const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass'; f.frequency.value = o.freq || 800; f.Q.value = o.q || 0.7;
    const g = ctx.createGain(); g.gain.value = o.gain || 0.5; src.connect(f); f.connect(g);
    let out = g;
    if (o.at) { const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.refDistance = o.ref || 4; if (p.positionX) { p.positionX.value = o.at.x; p.positionY.value = o.at.y; p.positionZ.value = o.at.z; } else p.setPosition(o.at.x, o.at.y, o.at.z); g.connect(p); out = p; }
    out.connect(master); const w = ctx.createGain(); w.gain.value = o.wet === undefined ? 0.6 : o.wet; out.connect(w); w.connect(verb);
    src.start(); return src;
  }
  return { start, play, noise, listener, setVol(v) { vol.v = v; if (master) master.gain.value = v; }, get ready() { return !!ctx; }, buf };
})();
