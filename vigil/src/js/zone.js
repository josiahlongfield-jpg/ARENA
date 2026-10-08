// ==================================================================== the zone: the Cinder Cloister
// A ruined cloister on a ridge at dusk: ash underfoot, dark stone, mist lying in the low ground, and a Feyr rift torn open over the
// altar in the middle. The courtyard (44 m square, broken walls, a colonnade) opens north into a roofless nave; outside it the ash
// runs out to a ring of cliffs. Everything static is batched into one draw call per material.
// Colliders: BOXES (axis-aligned, {x0, x1, z0, z1, y0, y1}) and POSTS (upright circles {x, z, r, y1}); a box or post whose top is
// within a step of your feet is ground you can stand on.
const BOXES = [], POSTS = [], SPAWNS = {}, RIFT = { pos: new V3(0, 2.4, 0), t: 0 };
const ZR = 64;      // you can walk out to here; the cliffs stand beyond it
// the ground's height: low swells of ash, flattened where the cloister stands, rising into the cliffs
function GH(x, z) {
  const r = Math.hypot(x, z), flat = smooth(30, 46, Math.max(Math.abs(x), Math.abs(z) + (z < -20 ? -40 : 0)));
  const swell = 0.55 * Math.sin(x * 0.075 + 1.3) * Math.cos(z * 0.06 - 0.4) + 0.3 * Math.sin(x * 0.19 + z * 0.13) + 0.18 * Math.cos(z * 0.23 - x * 0.07);
  return swell * (0.15 + 0.85 * flat) + smooth(ZR - 4, ZR + 18, r) * 14;
}
const ZONE = (() => {
  const tl = new T.TextureLoader();
  const scan = (name, srgb) => { const t = tl.load(ASSETS.tex[name]); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 8; if (srgb) t.encoding = T.sRGBEncoding; return t; };
  // dark materials: the scans darkened toward soot and ash (colour multiplies the map)
  const M = {
    wall: new T.MeshStandardMaterial({ map: scan('old_stone_wall|d', true), normalMap: scan('old_stone_wall|n'), color: 0x6b6460, roughness: 0.95 }),
    floor: new T.MeshStandardMaterial({ map: scan('monastery_stone_floor|d', true), normalMap: scan('monastery_stone_floor|n'), color: 0x5e5853, roughness: 0.92 }),
    rock: new T.MeshStandardMaterial({ map: scan('cliff_side|d', true), normalMap: scan('cliff_side|n'), color: 0x55504c, roughness: 0.97 }),
    ash: new T.MeshStandardMaterial({ map: scan('concrete_debris|d', true), normalMap: scan('concrete_debris|n'), color: 0x55514e, roughness: 1 }),
    char: new T.MeshStandardMaterial({ color: 0x141110, roughness: 0.9 }),
    ember: new T.MeshStandardMaterial({ color: 0x120403, emissive: 0xff3a1c, emissiveIntensity: 3.2, roughness: 0.6 }),
  };
  // ---- batching: geometry is baked into world space per material; uv is world-scaled so the stone keeps one size everywhere
  const batch = new Map();
  function put(geo, mat, m, tile) {
    geo = geo.index ? geo.toNonIndexed() : geo.clone(); geo.applyMatrix4(m);
    if (tile) {      // planar uv from the world position, picked per face by its normal (a cheap triplanar)
      const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
        uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
      }
      geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    }
    if (!batch.has(mat)) batch.set(mat, []); batch.get(mat).push(geo);
  }
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _s = new V3(), _e = new T.Euler();
  const mat4 = (x, y, z, rx, ry, rz, sx, sy, sz) => _m.compose(new V3(x, y, z), _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0)), _s.set(sx || 1, sy || 1, sz || 1));
  const BOX = new T.BoxGeometry(1, 1, 1), CYL = new T.CylinderGeometry(1, 1, 1, 18, 1), CYL8 = new T.CylinderGeometry(1, 1, 1, 8, 1);
  // a block of stone (and its collider): centre x, z, size w (x) by d (z), from y0 up h
  function block(x, z, w, d, y0, h, mat, ry) {
    put(BOX, mat || M.wall, mat4(x, y0 + h / 2, z, 0, ry || 0, 0, w, h, d), 2.2);
    if (!ry) BOXES.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0, y1: y0 + h });
  }
  function column(x, z, r, h, broken) {
    const y0 = GH(x, z) - 0.2;
    put(BOX, M.wall, mat4(x, y0 + 0.3, z, 0, 0, 0, r * 2.9, 0.6, r * 2.9), 2);
    put(CYL, M.wall, mat4(x, y0 + 0.6 + h / 2, z, 0, srand() * 3, 0, r, h, r), 2);
    if (!broken) put(BOX, M.wall, mat4(x, y0 + 0.6 + h + 0.2, z, 0, 0, 0, r * 2.7, 0.4, r * 2.7), 2);
    else put(CYL8, M.wall, mat4(x, y0 + 0.6 + h + 0.05, z, srange(-0.3, 0.3), 0, srange(-0.3, 0.3), r * 0.92, 0.25, r * 0.92), 2);      // a sheared top
    POSTS.push({ x, z, r: r * 1.45, y1: y0 + 0.6 + h + (broken ? 0 : 0.4) });
  }
  // a boulder: a squashed, jittered icosahedron
  function boulder(x, z, s) {
    const g = new T.IcosahedronGeometry(1, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 0.78 + 0.4 * Math.abs(Math.sin(p.getX(i) * 3.1 + p.getY(i) * 5.3 + p.getZ(i) * 2.2 + x)); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k); }
    g.computeVertexNormals();
    put(g, M.rock, mat4(x, GH(x, z) + s * 0.25, z, 0, srand() * 6, 0, s, s, s), 3);
    POSTS.push({ x, z, r: s * 0.95, y1: GH(x, z) + s * 0.8 });
  }

  // ---- ground: one heightfield of ash
  const N = 140, S = 2 * (ZR + 26), ground = new T.PlaneGeometry(S, S, N, N); ground.rotateX(-PI / 2);
  { const p = ground.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, GH(p.getX(i), p.getZ(i))); ground.computeVertexNormals(); }
  put(ground, M.ash, new T.Matrix4(), 3.5);

  // ---- the courtyard: a paved square, the broken outer wall, a colonnade
  const H = 22;
  put(BOX, M.floor, mat4(0, -0.05, 0, 0, 0, 0, 2 * H - 1, 0.2, 2 * H - 1), 3);
  const wallRun = (x0, z0, x1, z1, gaps) => {      // a wall from (x0, z0) to (x1, z1) in 2 m blocks, some broken low, leaving gaps
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.round(L / 2), alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, x = lerp(x0, x1, t), z = lerp(z0, z1, t);
      if (gaps.some(([a, b]) => (alongX ? x : z) > a && (alongX ? x : z) < b)) continue;
      const r = srand(), h = r < 0.12 ? srange(0.5, 1.4) : r < 0.3 ? srange(2.2, 3.4) : srange(3.9, 4.6);
      block(x, z, alongX ? L / n + 0.02 : 1.0, alongX ? 1.0 : L / n + 0.02, GH(x, z) - 0.3, h + 0.3);
      if (r > 0.3 && srand() < 0.35) block(x, z, alongX ? L / n * 0.6 : 0.6, alongX ? 0.6 : L / n * 0.6, GH(x, z) + h, srange(0.3, 0.8));      // a merlon left standing
    }
  };
  wallRun(-H, H, H, H, [[-3.5, 3.5]]); wallRun(-H, -H, H, -H, [[-6, 6]]); wallRun(-H, -H, -H, H, [[-3, 3]]); wallRun(H, -H, H, H, [[2, 8]]);
  // the south gate: two towers
  for (const sx of [-1, 1]) block(sx * 5, H, 3, 3, -0.3, 6.5);
  // colonnade inside the wall
  for (let i = -3; i <= 3; i++) {
    const a = i * 5.6;
    for (const [x, z] of [[a, H - 4.2], [a, -H + 4.2], [-H + 4.2, a], [H - 4.2, a]]) {
      if (Math.abs(x) < 3 && z > 0 || Math.abs(z) < 2 && x < 0 && Math.abs(x) > 10) continue;
      const r = srand(); if (r < 0.12) continue;
      column(x, z, 0.42, r < 0.4 ? srange(1.0, 2.6) : 4.2, r < 0.4);
    }
  }
  // a fallen column across the east walk
  put(CYL, M.wall, mat4(13, 0.42, -6, PI / 2, 0, 0.35, 0.42, 6.5, 0.42), 2); BOXES.push({ x0: 11.5, x1: 14.5, z0: -9, z1: -3, y0: 0, y1: 0.84 });
  // the altar: two steps up to a slab, the rift standing over it
  block(0, 0, 9, 9, -0.2, 0.5, M.floor); block(0, 0, 6.5, 6.5, 0.3, 0.35, M.floor); block(0, 0, 2.6, 1.4, 0.65, 0.9, M.wall);
  // cracks glowing in the paving, out from the altar
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * TAU + srand() * 0.4, r0 = 5, L = srange(3, 9);
    for (let s = 0; s < 4; s++) { const r = r0 + s * L / 4, w = 0.09 * (1 - s / 5); put(BOX, M.ember, mat4(Math.sin(a + s * 0.12) * r, 0.03, Math.cos(a + s * 0.12) * r, 0, a + s * 0.12, 0, w, 0.06, L / 4 + 0.1)); }
  }

  // ---- the nave, north: two long walls with buttresses, two rows of pillars, an apse of pillars at the far end
  const NZ0 = -H, NZ1 = -64;
  put(BOX, M.floor, mat4(0, -0.06, (NZ0 + NZ1) / 2, 0, 0, 0, 17, 0.2, NZ0 - NZ1), 3);
  for (const sx of [-1, 1]) {
    for (let z = NZ0 - 1; z > NZ1 + 4; z -= 3) {
      const gap = Math.abs(z + 38) < 2.5 && sx > 0;      // a breach in the east wall
      if (gap) continue;
      const h = Math.abs(z + 52) < 5 && sx < 0 ? srange(2, 3.5) : srange(6.5, 8.5);
      block(sx * 9, z, 1.2, 3.02, -0.3, h + 0.3);
      if ((Math.round(z) % 6 === 0)) block(sx * 10, z, 1.2, 1.4, -0.3, h * 0.75);      // buttress
    }
    for (let z = NZ0 - 5; z > NZ1 + 8; z -= 6) column(sx * 4.6, z, 0.55, srand() < 0.25 ? srange(1.5, 3) : 7.5, false);
  }
  for (let i = 0; i <= 6; i++) { const a = PI + (i / 6 - 0.5) * PI * 0.95; column(Math.sin(a) * 7, NZ1 + 6 + Math.cos(a) * -4.5, 0.5, srand() < 0.3 ? 2.2 : 6.5, false); }
  put(CYL, M.wall, mat4(-2, 0.55, -40, PI / 2, 0, -0.5, 0.55, 8, 0.55), 2); BOXES.push({ x0: -4.5, x1: 0.6, z0: -42.5, z1: -37.5, y0: 0, y1: 1.1 });

  // ---- outside: boulders, charred trees, a few standing stones
  for (let i = 0; i < 46; i++) {
    const a = srand() * TAU, r = srange(30, ZR + 2), x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (Math.abs(x) < 12 && z < -18 && z > -70) continue;      // keep the nave's doors clear
    boulder(x, z, srange(0.8, 2.6));
  }
  for (let i = 0; i < 18; i++) {
    const a = srand() * TAU, r = srange(32, ZR - 4), x = Math.sin(a) * r, z = Math.cos(a) * r; if (Math.abs(x) < 12 && z < -18) continue;
    const y0 = GH(x, z), h = srange(4, 8), lean = srange(-0.15, 0.15);
    put(CYL8, M.char, mat4(x, y0 + h / 2, z, lean, 0, lean, 0.16, h, 0.16));
    for (let b = 0; b < 4; b++) { const by = y0 + h * srange(0.45, 0.9), ba = srand() * TAU, L = srange(1, 2.4);
      put(CYL8, M.char, mat4(x + Math.sin(ba) * L * 0.4, by + L * 0.3, z + Math.cos(ba) * L * 0.4, Math.cos(ba) * 0.9, 0, -Math.sin(ba) * 0.9, 0.06, L, 0.06)); }
    POSTS.push({ x, z, r: 0.3, y1: y0 + h });
  }
  for (let i = 0; i < 7; i++) { const a = -1.9 + i * 0.22, x = Math.sin(a) * 40, z = Math.cos(a) * 40; block(x, z, 1.1, 0.5, GH(x, z) - 0.3, srange(1.6, 3.2), M.wall, a); POSTS.push({ x, z, r: 0.7, y1: GH(x, z) + 2.5 }); }
  // the cliffs: a ring of great rocks past the edge
  for (let i = 0; i < 40; i++) { const a = i / 40 * TAU + srand() * 0.1, r = ZR + srange(9, 18); boulder(Math.sin(a) * r, Math.cos(a) * r, srange(7, 13)); }

  const group = new T.Group();
  for (const [mat, list] of batch) {
    let n = 0; for (const g of list) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2); let o = 0;
    for (const g of list) {
      pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count;
    }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nrm, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    const mesh = new T.Mesh(geo, mat); mesh.castShadow = mat !== M.ember; mesh.receiveShadow = true; group.add(mesh);
  }

  // ---- the rift: a torn seam of light over the altar, flickering; a red light under it; embers rising off it
  const riftMat = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, uniforms: { t: { value: 0 } },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vU; uniform float t;
      float h(float x){ return fract(sin(x * 127.1) * 43758.5); }
      float n(float x){ float i = floor(x), f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
      void main(){
        float y = vU.y, x = vU.x - 0.5;
        float edge = 0.07 * (sin(y * 3.14159) + 0.15) * (0.75 + 0.5 * n(y * 9.0 + t * 1.7));
        float off = 0.08 * (n(y * 5.0 + t * 0.4) - 0.5) + 0.04 * (n(y * 17.0 - t) - 0.5);
        float d = abs(x - off) / max(edge, 1e-3);
        float core = exp(-d * d * 3.0), halo = exp(-d * 0.9) * 0.35;
        float fl = 0.85 + 0.15 * n(t * 6.0);
        vec3 c = vec3(1.0, 0.16, 0.06) * (halo + core * 2.2) + vec3(1.0, 0.8, 0.6) * pow(core, 4.0) * 3.0;
        float fade = smoothstep(0.0, 0.12, y) * smoothstep(1.0, 0.82, y);
        gl_FragColor = vec4(c * fl * fade * 2.4, 1.0);
      }` });
  const rift = new T.Mesh(new T.PlaneGeometry(3.2, 4.6), riftMat); rift.position.set(0, 3.6, 0); rift.userData.vgSkip = true; group.add(rift);
  const rift2 = rift.clone(); rift2.rotation.y = PI / 2; rift2.scale.set(0.55, 0.92, 1); group.add(rift2);
  const riftLight = new T.PointLight(0xff3a1e, 60, 30, 2); riftLight.position.set(0, 3, 0); group.add(riftLight);
  // ash: grey flakes drifting through the whole zone; embers: sparks rising from the rift and the cracks
  function points(n, size, color, blend) {
    const g = new T.BufferGeometry(), p = new Float32Array(n * 3), s = new Float32Array(n); g.setAttribute('position', new T.BufferAttribute(p, 3)); g.setAttribute('seed', new T.BufferAttribute(s, 1));
    for (let i = 0; i < n; i++) s[i] = Math.random();
    const m = new T.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: blend ? 1 : 0.55, depthWrite: false, blending: blend ? T.AdditiveBlending : T.NormalBlending });
    const o = new T.Points(g, m); o.frustumCulled = false; group.add(o); return o;
  }
  const ash = points(2400, 0.05, 0x8a837c), embers = points(260, 0.06, 0xff6a30, true);
  embers.userData.vgSkip = true;
  { const p = ash.geometry.attributes.position.array; for (let i = 0; i < p.length; i += 3) { p[i] = rand(-50, 50); p[i + 1] = rand(0, 14); p[i + 2] = rand(-60, 40); } }
  function update(dt, t, eye) {
    riftMat.uniforms.t.value = t; riftLight.intensity = 55 + 12 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
    // ash drifts with the wind and wraps round the eye, so there's always some near you
    const p = ash.geometry.attributes.position.array, s = ash.geometry.attributes.seed.array;
    for (let i = 0, j = 0; i < p.length; i += 3, j++) {
      p[i] += (0.7 + s[j] * 0.6) * dt + Math.sin(t * 0.7 + s[j] * 40) * 0.2 * dt; p[i + 1] -= (0.15 + s[j] * 0.25) * dt; p[i + 2] += 0.25 * dt;
      if (p[i] - eye.x > 30) p[i] -= 60; if (p[i] - eye.x < -30) p[i] += 60; if (p[i + 2] - eye.z > 30) p[i + 2] -= 60; if (p[i + 2] - eye.z < -30) p[i + 2] += 60;
      if (p[i + 1] < GH(p[i], p[i + 2])) p[i + 1] += 14;
    }
    ash.geometry.attributes.position.needsUpdate = true;
    const e = embers.geometry.attributes.position.array, es = embers.geometry.attributes.seed.array;
    for (let i = 0, j = 0; i < e.length; i += 3, j++) {
      const life = (t * (0.18 + es[j] * 0.2) + es[j] * 7) % 1, a = es[j] * 97, r = es[j] < 0.4 ? 0.6 + es[j] * 2 : 4 + es[j] * 8;
      e[i] = Math.sin(a) * r + Math.sin(t + a) * 0.3 * life; e[i + 1] = 0.4 + life * (es[j] < 0.4 ? 7 : 3); e[i + 2] = Math.cos(a) * r + Math.cos(t * 0.8 + a) * 0.3 * life;
    }
    embers.geometry.attributes.position.needsUpdate = true;
  }
  SPAWNS.nave = [new V3(-3, 0, -56), new V3(3, 0, -56), new V3(0, 0, -50), new V3(-5, 0, -46), new V3(5, 0, -46)];
  SPAWNS.breach = [new V3(13, 0, -38), new V3(16, 0, -34)];
  SPAWNS.west = [new V3(-30, 0, 0), new V3(-30, 0, 4), new V3(-34, 0, -3)];
  SPAWNS.east = [new V3(30, 0, 5), new V3(32, 0, 0)];
  SPAWNS.rift = [new V3(0, 0, -1.5), new V3(1.5, 0, 1), new V3(-1.5, 0, 1)];
  SPAWNS.player = { pos: new V3(0, 0, 40), yaw: 0 };
  return { group, update, M, rift, riftLight };
})();

// ---- collision. Where can a body of radius r stand at (x, z), coming from height y? The highest ground, block or post top
// that is no more than 'step' above y.
function groundAt(x, z, y, r, step) {
  let g = GH(x, z);
  for (const b of BOXES) if (x > b.x0 - r * 0.3 && x < b.x1 + r * 0.3 && z > b.z0 - r * 0.3 && z < b.z1 + r * 0.3 && b.y1 <= y + step && b.y1 > g) g = b.y1;
  for (const p of POSTS) if ((x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r && p.y1 <= y + step && p.y1 > g) g = p.y1;
  return g;
}
// push a body of radius r at pos (feet at pos.y, height h) out of every wall and post it overlaps that stands above its step
function collide(pos, r, h, step) {
  for (const b of BOXES) {
    if (b.y1 <= pos.y + step || b.y0 >= pos.y + h) continue;
    const cx = clamp(pos.x, b.x0, b.x1), cz = clamp(pos.z, b.z0, b.z1), dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; pos.x += dx * k; pos.z += dz * k; }
    else {      // inside the box: out by the nearest side
      const o = [pos.x - b.x0 + r, b.x1 - pos.x + r, pos.z - b.z0 + r, b.z1 - pos.z + r], m = Math.min(...o);
      if (m === o[0]) pos.x = b.x0 - r; else if (m === o[1]) pos.x = b.x1 + r; else if (m === o[2]) pos.z = b.z0 - r; else pos.z = b.z1 + r;
    }
  }
  for (const p of POSTS) {
    if (p.y1 <= pos.y + step) continue;
    const dx = pos.x - p.x, dz = pos.z - p.z, d2 = dx * dx + dz * dz, R = r + p.r;
    if (d2 < R * R && d2 > 1e-8) { const d = Math.sqrt(d2), k = (R - d) / d; pos.x += dx * k; pos.z += dz * k; }
  }
  const rr = Math.hypot(pos.x, pos.z); if (rr > ZR) { pos.x *= ZR / rr; pos.z *= ZR / rr; }
}
// the first thing a ray hits: ground, a block or a post (for shots, sight lines and grenades). Returns distance or Infinity.
function rayWorld(o, d, far) {
  let best = far;
  for (const b of BOXES) {      // slab test
    let t0 = 0, t1 = best;
    for (const [oa, da, a0, a1] of [[o.x, d.x, b.x0, b.x1], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z0, b.z1]]) {
      if (Math.abs(da) < 1e-9) { if (oa < a0 || oa > a1) { t0 = Infinity; break; } continue; }
      let ta = (a0 - oa) / da, tb = (a1 - oa) / da; if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) break;
    }
    if (t0 <= t1 && t0 < best) best = t0;
  }
  for (const p of POSTS) {
    const ox = o.x - p.x, oz = o.z - p.z, a = d.x * d.x + d.z * d.z; if (a < 1e-9) continue;
    const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - p.r * p.r * 0.5, disc = b * b - a * c; if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / a; if (t > 0 && t < best && o.y + d.y * t < p.y1) best = t;
  }
  // ground: march, then refine
  let prev = 0;
  for (let t = 0.5; t < best; t += 0.5) {
    const y = o.y + d.y * t; if (y < GH(o.x + d.x * t, o.z + d.z * t)) { let a = prev, b = t; for (let i = 0; i < 8; i++) { const m = (a + b) / 2; if (o.y + d.y * m < GH(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; } best = b; break; }
    prev = t;
  }
  return best;
}
