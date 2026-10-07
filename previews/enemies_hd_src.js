  // ================================================================ proposed detail pass for the enemies (viewer only, not in the game yet)
  // Each builder keeps the joint names the game animates (hips, hipL/R, kneeL/R, torso, head, jaw, shL/R, elL/R, aim, rifle, muzzle,
  // glow, weapon, shield, cape), so the current animation code can drive them unchanged.
  const HD = {};
  { // painted textures: veined skin, cultist cloth with a sigil, rusted plate, crimson plate with brass edging, a tattered cape, axe runes
    const veins = (base, vein, spot) => canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${rnd() < .5 ? '0,0,0' : '255,240,220'},${rnd() * 0.08})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 2 + rnd() * 10, 0, 7); g.fill(); }
      g.strokeStyle = vein; g.lineWidth = 1.2;
      for (let i = 0; i < 40; i++) { let x = rnd() * w, y = rnd() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (rnd() - .5) * 26; y += (rnd() - .3) * 22; g.lineTo(x, y); } g.globalAlpha = 0.3 + rnd() * 0.4; g.stroke(); }
      g.globalAlpha = 1;
      for (let i = 0; i < 18; i++) { g.fillStyle = spot; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 2 + rnd() * 6, 2 + rnd() * 4, rnd() * 3, 0, 7); g.fill(); }
    }, 1);
    const star = (g, cx, cy, r, col, lw) => {      // the eight-pointed heretic star
      g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round';
      for (let k = 0; k < 8; k++) { const a = k * PI / 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.stroke();
        g.beginPath(); g.moveTo(cx + Math.cos(a - 0.22) * r * 0.78, cy + Math.sin(a - 0.22) * r * 0.78); g.lineTo(cx + Math.cos(a) * r * 1.08, cy + Math.sin(a) * r * 1.08); g.lineTo(cx + Math.cos(a + 0.22) * r * 0.78, cy + Math.sin(a + 0.22) * r * 0.78); g.stroke(); }
      g.beginPath(); g.arc(cx, cy, r * 0.32, 0, 7); g.stroke();
    };
    const robeT = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#6a1d16'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.06})`; g.fillRect(0, y, w, 1); }
      for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(30,10,6,${0.15 + rnd() * 0.25})`; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 4 + rnd() * 18, 3 + rnd() * 10, rnd() * 3, 0, 7); g.fill(); }
      g.fillStyle = '#2c0d0a'; g.fillRect(0, h - 26, w, 26); g.fillStyle = '#b08a3a'; g.fillRect(0, h - 30, w, 3);
      star(g, w / 2, h * 0.42, 34, 'rgba(20,6,4,.85)', 6);
    });
    const hemT = canvasTex(256, 64, (g, w, h) => {      // ragged hem: alpha cut-outs along the bottom edge
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000';
      for (let x = 0; x < w; x += 6 + rnd() * 10) { const d = 8 + rnd() * 40; g.beginPath(); g.moveTo(x, h); g.lineTo(x + 3 + rnd() * 4, h - d); g.lineTo(x + 8 + rnd() * 6, h); g.fill(); }
    });
    const plateT = (base, rust, edge) => canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${rnd() < .6 ? rust : '0,0,0'},${rnd() * 0.12})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 1 + rnd() * 9, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(200,200,210,.25)'; g.lineWidth = 0.8;
      for (let i = 0; i < 50; i++) { const x = rnd() * w, y = rnd() * h, a = rnd() * 6.3, l = 4 + rnd() * 20; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
      if (edge) { g.strokeStyle = edge; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10); g.lineWidth = 2; g.strokeRect(18, 18, w - 36, h - 36);
        g.fillStyle = edge; for (let x = 30; x < w - 20; x += 32) for (const y of [11, h - 11]) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); } }
      else { g.fillStyle = '#1a1816'; for (let x = 14; x < w; x += 28) for (const y of [10, h - 10]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); g.fillStyle = 'rgba(200,190,170,.35)'; g.beginPath(); g.arc(x - 1, y - 1, 1.5, 0, 7); g.fill(); g.fillStyle = '#1a1816'; } }
    }, 1);
    const capeT = canvasTex(256, 512, (g, w, h) => {
      g.fillStyle = '#3a0c0a'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 3) { g.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.12})`; g.fillRect(x, 0, 1, h); }
      g.fillStyle = '#b08a3a'; g.fillRect(0, 0, w, 6);
      star(g, w / 2, 170, 60, 'rgba(176,138,58,.75)', 7);
      g.globalCompositeOperation = 'destination-out';      // torn bottom edge and a few holes
      for (let x = 0; x < w; x += 8 + rnd() * 14) { const d = 20 + rnd() * 110; g.beginPath(); g.moveTo(x, h); g.lineTo(x + 4 + rnd() * 8, h - d); g.lineTo(x + 14 + rnd() * 10, h); g.fill(); }
      for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(rnd() * w, 250 + rnd() * 200, 4 + rnd() * 9, 6 + rnd() * 14, rnd() * 3, 0, 7); g.fill(); }
    });
    const runeT = canvasTex(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.strokeStyle = '#ff5a20'; g.lineWidth = 3; g.lineCap = 'round';
      for (let r = 0; r < 4; r++) { let x = 14 + r * 26, y = 30; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - .5) * 16, y + 10 + rnd() * 10); g.lineTo(x + (rnd() - .5) * 16, y + 22); g.stroke(); y += 26; } }
    });
    const sk = (c) => { const m = mat({ color: 0xffffff, roughness: 0.65, flatShading: false }); m.map = c; return m; };
    HD.M = {
      ghoulSkin: sk(veins('#8b8a78', '#3c2c3a', 'rgba(120,40,40,.6)')), ghoulDark: mat({ color: 0x4d4a40, roughness: 0.8 }),
      leapSkin: sk(veins('#8a4b3a', '#3a1010', 'rgba(255,200,120,.35)')), leapDark: mat({ color: 0x40201a, roughness: 0.75 }),
      gum: mat({ color: 0x5a1a1e, roughness: 0.4 }), tooth: mat({ color: 0xe6dcc0, roughness: 0.35 }), claw: mat({ color: 0xd8ccb0, roughness: 0.35 }),
      membrane: new THREE.MeshStandardMaterial({ color: new THREE.Color(0x8a3020).convertSRGBToLinear(), roughness: 0.5, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
      robe: Object.assign(mat({ color: 0xffffff, roughness: 0.95, flatShading: false, side: THREE.DoubleSide }), { map: robeT, alphaMap: hemT, alphaTest: 0.5 }),
      robePlain: mat({ color: 0x6a1d16, roughness: 0.95 }), leather: mat({ color: 0x3a2a1e, roughness: 0.75 }), brass: mat({ color: 0xb8893a, roughness: 0.3, metalness: 0.9 }),
      lensG: new THREE.MeshStandardMaterial({ color: 0x103a14, emissive: 0x30ff50, emissiveIntensity: 1.4, roughness: 0.1 }),
      rust: Object.assign(mat({ color: 0xffffff, roughness: 0.55, metalness: 0.6 }), { map: plateT('#34302c', '120,60,30') }),
      crimson: Object.assign(mat({ color: 0xffffff, roughness: 0.38, metalness: 0.6 }), { map: plateT('#6a1814', '20,0,0', '#b8893a') }),
      cape: new THREE.MeshStandardMaterial({ map: capeT, roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.5 }),
      runes: new THREE.MeshBasicMaterial({ map: runeT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      fur: mat({ color: 0x2a1c14, roughness: 1 }), stitch: sk(veins('#6e5a4e', '#2a1414', 'rgba(60,10,10,.7)')),
      glowR: new THREE.MeshBasicMaterial({ color: 0xff3a1a }), ember: new THREE.MeshBasicMaterial({ color: 0xff7a2a })
    };
    for (const k of ['ghoulDark', 'leapDark', 'gum', 'tooth', 'claw', 'robePlain', 'leather', 'brass', 'fur']) HD.M[k].color.convertSRGBToLinear();
  }
  const H = HD.M;
  // a curved, tapering horn or hook: cones laid end to end along an arc
  function curve(parent, p0, dir, bend, len, r0, n, m, o = {}) {
    const g = grp(parent); g.position.copy(p0); let p = v(0, 0, 0), d = dir.clone().normalize();
    const axis = o.axis || v(1, 0, 0);
    for (let i = 0; i < n; i++) {
      const L = len / n, r = r0 * (1 - i / n), r2 = r0 * (1 - (i + 1) / n) + 0.002;
      seg(p, p.clone().addScaledVector(d, L * 1.05), r, r2, m, 5, g, { edge: false });
      p.addScaledVector(d, L); d.applyAxisAngle(axis, bend / n);
      if (o.serrate && i > 0) mesh(new THREE.ConeGeometry(r * 0.5, r * 2.4, 3), m, g, { p: p.toArray(), q: qFrom(v(0, 1, 0), d.clone().applyAxisAngle(axis, -PI / 2)), edge: false });
    }
    return g;
  }
  function skull(parent, p, s, m = H.tooth) {
    const g = grp(parent); g.position.copy(p); g.scale.setScalar(s);
    mesh(new THREE.SphereGeometry(0.1, 8, 6), m, g, { s: [1, 0.95, 1.15], edge: false });
    mesh(new THREE.BoxGeometry(0.11, 0.06, 0.08), m, g, { p: [0, -0.08, 0.04], edge: false });
    for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(0.028, 6, 4), H.leather, g, { p: [sx * 0.04, 0.0, 0.1], edge: false, cast: false });
    return g;
  }
  function chain(parent, a, b, links, rr = 0.014) {
    const d = b.clone().sub(a), L = d.length(); d.normalize();
    for (let i = 0; i < links; i++) { const t = (i + 0.5) / links, l = mesh(new THREE.TorusGeometry(rr * 1.7, rr * 0.45, 4, 6), M.steel, parent, { p: a.clone().addScaledVector(d, L * t).add(v(0, -Math.sin(t * PI) * L * 0.12, 0)).toArray(), edge: false, cast: false }); l.quaternion.copy(qFrom(v(0, 1, 0), d)); if (i % 2) l.rotateY(PI / 2); }
  }
  const lathe = (pts, n, m, parent, o) => mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), n || 10), m, parent, Object.assign({ edge: false }, o));

  // ---- Ghoul: ribcage, spine, a long skull with rows of teeth, shackles and serrated bone hooks
  function buildGhoulHD(skin = H.ghoulSkin, dark = H.ghoulDark, eye = M.eyeY, leaper = false) {
    const root = new THREE.Group(), J = { root };
    const hips = grp(root, [0, 0.82, 0]); J.hips = hips;
    lathe([[0, -0.08], [0.16, -0.05], [0.19, 0.04], [0.14, 0.1], [0, 0.11]], 9, skin, hips, { s: [1, 1, 0.8] });
    const cloth = new THREE.PlaneGeometry(0.3, 0.42, 3, 4), cp = cloth.attributes.position;
    for (let k = 0; k < cp.count; k++) cp.setZ(k, Math.sin(cp.getX(k) * 9) * 0.02);
    mesh(cloth, H.robe, hips, { p: [0, -0.2, 0.15], r: [0.2, 0, 0], edge: false });
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const hip = grp(hips, [sx * 0.15, 0, 0]), knee = grp(hip, [0, -0.38, 0.12]);
      seg(v(0, 0, 0), v(0, -0.38, 0.12), 0.095, 0.055, skin, 7, hip, { edge: false });
      mesh(new THREE.SphereGeometry(0.06, 6, 5), skin, knee, { edge: false });
      mesh(new THREE.ConeGeometry(0.025, 0.12, 4), H.claw, knee, { p: [0, 0.02, 0.06], r: [1.1, 0, 0], edge: false });     // knee spur
      if (leaper) {        // digitigrade: a long ankle segment and a high heel
        seg(v(0, 0, 0), v(0, -0.26, -0.16), 0.055, 0.04, skin, 6, knee, { edge: false });
        seg(v(0, -0.26, -0.16), v(0, -0.46, -0.04), 0.04, 0.03, skin, 6, knee, { edge: false });
        for (const tx of [-0.035, 0, 0.035]) mesh(new THREE.ConeGeometry(0.016, 0.13, 4).rotateX(PI / 2), H.claw, knee, { p: [tx, -0.46, 0.03], edge: false });
      } else {
        seg(v(0, 0, 0), v(0, -0.44, -0.14), 0.055, 0.035, skin, 6, knee, { edge: false });
        mesh(new THREE.BoxGeometry(0.1, 0.04, 0.14), skin, knee, { p: [0, -0.45, -0.08], edge: false });
        for (const tx of [-0.035, 0, 0.035]) mesh(new THREE.ConeGeometry(0.014, 0.08, 4).rotateX(PI / 2), H.claw, knee, { p: [tx, -0.46, 0.0], edge: false });
      }
      J['hip' + side] = hip; J['knee' + side] = knee;
    }
    const torso = grp(hips, [0, 0.04, 0]); J.torso = torso;
    // a starved torso: a lathe ribcage over a pinched waist, the ribs standing out, the spine knuckled down the back
    lathe([[0.1, 0], [0.14, 0.12], [0.22, 0.3], [0.25, 0.45], [0.2, 0.58], [0.08, 0.64]], 11, skin, torso, { s: [1.05, 1, 0.85] });
    for (let k = 0; k < 5; k++) for (const sx of [-1, 1]) {
      const y = 0.26 + k * 0.065, r = 0.215 + Math.sin((k + 1) / 6 * PI) * 0.035;
      mesh(new THREE.TorusGeometry(r, 0.011, 3, 10, PI * 0.62), dark, torso, { p: [0, y, 0.0], r: [PI / 2, 0, sx > 0 ? -0.1 : PI + 0.1], s: [1.05, 0.85, 1], edge: false });
    }
    for (let k = 0; k < 9; k++) { const y = 0.05 + k * 0.065; mesh(new THREE.BoxGeometry(0.05, 0.035, 0.05), H.claw, torso, { p: [0, y, -0.19 - Math.sin(k / 8 * PI) * 0.04], edge: false }); }
    for (let k = 0; k < (leaper ? 7 : 4); k++) mesh(new THREE.ConeGeometry(0.03, leaper ? 0.32 : 0.16, 4), H.claw, torso, { p: [0, 0.22 + k * (leaper ? 0.065 : 0.1), -0.24], r: [-0.8, 0, 0], edge: false });
    for (let i = 0; i < 4; i++) mesh(new THREE.SphereGeometry(0.025, 5, 4), H.gum, torso, { p: [rand(-0.15, 0.15), rand(0.15, 0.5), 0.2], s: [1, 1, 0.4], edge: false, cast: false });     // weeping sores
    // the head: a long skull, brow ridge, sunken cheeks, two rows of needle teeth
    const head = grp(torso, [0, 0.68, 0.1]); J.head = head;
    mesh(new THREE.SphereGeometry(0.15, 10, 8), skin, head, { s: [0.85, 0.82, 1.35], edge: false });
    mesh(new THREE.BoxGeometry(0.22, 0.04, 0.08), dark, head, { p: [0, 0.06, 0.13], r: [0.25, 0, 0], edge: false });
    for (const sx of [-1, 1]) {
      mesh(new THREE.SphereGeometry(0.035, 6, 5), eye, head, { p: [sx * 0.058, 0.025, 0.165], edge: false, cast: false });
      if (leaper) mesh(new THREE.SphereGeometry(0.022, 6, 5), eye, head, { p: [sx * 0.08, 0.065, 0.13], edge: false, cast: false });
      mesh(new THREE.ConeGeometry(0.035, leaper ? 0.2 : 0.14, 4), skin, head, { p: [sx * 0.12, 0.06, -0.03], r: [-0.9, 0, -sx * 0.9], edge: false });     // ears
    }
    const lipU = grp(head, [0, -0.04, 0.12]);
    for (let k = 0; k < 9; k++) mesh(new THREE.ConeGeometry(0.008, 0.045, 3), H.tooth, lipU, { p: [-0.064 + k * 0.016, -0.02, 0.04 - Math.abs(k - 4) * 0.01], r: [PI, 0, 0], edge: false, cast: false });
    const jaw = grp(head, [0, -0.07, 0.04]); J.jaw = jaw;
    mesh(new THREE.BoxGeometry(0.15, 0.04, 0.22), dark, jaw, { p: [0, -0.02, 0.09], edge: false });
    mesh(new THREE.BoxGeometry(0.12, 0.012, 0.18), H.gum, jaw, { p: [0, 0.003, 0.09], edge: false, cast: false });
    for (let k = 0; k < 9; k++) mesh(new THREE.ConeGeometry(0.009, 0.055, 3), H.tooth, jaw, { p: [-0.064 + k * 0.016, 0.03, 0.17 - Math.abs(k - 4) * 0.012], edge: false, cast: false });
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const sh = grp(torso, [sx * 0.27, 0.52, 0.02]), el = grp(sh, [0, -0.36, 0]);
      mesh(new THREE.SphereGeometry(0.075, 7, 5), skin, sh, { edge: false });
      seg(v(0, 0, 0), v(0, -0.36, 0), 0.07, 0.045, skin, 7, sh, { edge: false });
      mesh(new THREE.ConeGeometry(0.02, 0.1, 4), H.claw, el, { p: [0, 0.01, -0.05], r: [-1.9, 0, 0], edge: false });      // elbow spike
      seg(v(0, 0, 0), v(0, -0.32, 0), 0.045, 0.04, skin, 6, el, { edge: false });
      mesh(new THREE.TorusGeometry(0.055, 0.016, 4, 8), M.iron, el, { p: [0, -0.24, 0], r: [PI / 2, 0, 0], edge: false });      // a shackle
      chain(el, v(0, -0.25, 0.05), v(sx * 0.05, -0.45, 0.12), 4);
      curve(el, v(0, -0.32, 0), v(0, -1, 0.35), leaper ? 1.1 : 0.9, leaper ? 0.55 : 0.62, 0.04, 6, H.claw, { serrate: !leaper });
      J['sh' + side] = sh; J['el' + side] = el;
    }
    if (leaper) {        // a long whip of a tail and frills of membrane along the spine
      J.tail = grp(hips, [0, 0.02, -0.15]);
      let p = grp(J.tail);
      for (let k = 0; k < 10; k++) { const r = 0.05 * (1 - k / 11); seg(v(0, 0, 0), v(0, 0, -0.11), r, r * 0.85, skin, 5, p, { edge: false }); p = grp(p, [0, 0, -0.11], [0.12, 0, 0]); }
      mesh(new THREE.ConeGeometry(0.03, 0.16, 4).rotateX(-PI / 2), H.claw, p, { p: [0, 0, -0.06], edge: false });
      for (const sx of [-1, 1]) { const f = new THREE.Shape(); f.moveTo(0, 0); f.lineTo(0.02, 0.38); f.lineTo(0.09, 0.3); f.lineTo(0.12, 0.42); f.lineTo(0.16, 0.0); f.closePath();
        mesh(new THREE.ShapeGeometry(f), H.membrane, torso, { p: [sx * 0.03, 0.2, -0.22], r: [-0.7, sx * PI / 2, 0], edge: false, cast: false }); }
      root.scale.setScalar(0.95);
    } else root.scale.setScalar(1.05);
    return J;
  }
  const buildLeaperHD = () => buildGhoulHD(H.leapSkin, H.leapDark, M.eyeR, true);

  // ---- Gunner: hooded cultist robe with the star, twin-filter gas mask and goggles, hose to a tank, bandolier, a scoped long rifle
  function buildGunnerHD() {
    const root = new THREE.Group(), J = { root };
    const hips = grp(root, [0, 0.95, 0]); J.hips = hips;
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const hip = grp(hips, [sx * 0.13, 0, 0]), knee = grp(hip, [0, -0.45, 0]);
      seg(v(0, 0, 0), v(0, -0.45, 0), 0.085, 0.07, M.cloth, 7, hip, { edge: false });
      seg(v(0, 0, 0), v(0, -0.43, 0), 0.07, 0.06, M.cloth, 7, knee, { edge: false });
      for (let k = 0; k < 4; k++) mesh(new THREE.TorusGeometry(0.068, 0.012, 3, 8), H.leather, knee, { p: [0, -0.18 - k * 0.06, 0], r: [PI / 2, 0, 0.2], edge: false, cast: false });   // puttee wraps
      mesh(new THREE.BoxGeometry(0.13, 0.11, 0.26), H.leather, knee, { p: [0, -0.46, 0.04], edge: false });
      J['hip' + side] = hip; J['knee' + side] = knee;
    }
    const skirt = new THREE.CylinderGeometry(0.22, 0.4, 0.78, 14, 3, true); mesh(skirt, H.robe, hips, { p: [0, -0.32, 0], edge: false });
    const torso = grp(hips, [0, 0.02, 0]); J.torso = torso;
    mesh(new THREE.CylinderGeometry(0.24, 0.21, 0.6, 12), H.robePlain, torso, { p: [0, 0.3, 0], s: [1, 1, 0.8], edge: false });
    mesh(new THREE.PlaneGeometry(0.3, 0.45), H.robe, torso, { p: [0, 0.32, 0.17], edge: false });
    mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.07, 12), H.leather, torso, { p: [0, 0.04, 0], s: [1, 1, 0.8], edge: false });
    mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), H.brass, torso, { p: [0, 0.04, 0.18], edge: false });
    for (const [x, z] of [[-0.15, 0.1], [0.15, 0.1], [0.19, -0.04]]) mesh(new THREE.BoxGeometry(0.08, 0.09, 0.05), H.leather, torso, { p: [x, -0.01, z], r: [0, Math.atan2(x, z), 0], edge: false });
    { const b = grp(torso, [0, 0.33, 0], [0, 0, 0.75]);       // bandolier of shells across the chest
      mesh(new THREE.TorusGeometry(0.25, 0.022, 4, 16), H.leather, b, { s: [1, 1, 0.75], r: [PI / 2, 0, 0], edge: false });
      for (let k = 0; k < 7; k++) { const a = -0.9 + k * 0.28; mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.06, 5), H.brass, b, { p: [Math.sin(a) * 0.25, 0, Math.cos(a) * 0.19], r: [0, 0, PI / 2], edge: false, cast: false }); } }
    mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.36, 10), M.gunmetal, torso, { p: [0, 0.36, -0.22], edge: false });     // the air tank
    mesh(new THREE.SphereGeometry(0.09, 10, 6, 0, PI * 2, 0, PI / 2), M.gunmetal, torso, { p: [0, 0.54, -0.22], edge: false });
    for (const sx of [-1, 1]) mesh(new THREE.TorusGeometry(0.2, 0.012, 3, 10, PI * 0.8), H.leather, torso, { p: [sx * 0.12, 0.38, -0.06], r: [0, PI / 2, PI * 0.1], edge: false, cast: false });
    const head = grp(torso, [0, 0.72, 0]); J.head = head;
    // a deep hood with a pointed peak, and the mask inside it
    lathe([[0.0, 0.26], [0.1, 0.24], [0.18, 0.12], [0.2, -0.05], [0.19, -0.14]], 12, H.robePlain, head, { p: [0, 0, -0.03], s: [1, 1, 1.1] });
    mesh(new THREE.ConeGeometry(0.08, 0.24, 6), H.robePlain, head, { p: [0, 0.2, -0.16], r: [-2.1, 0, 0], edge: false });
    mesh(new THREE.SphereGeometry(0.13, 10, 8), M.mask, head, { p: [0, -0.01, 0.07], s: [0.95, 0.95, 0.85], edge: false });
    for (const sx of [-1, 1]) {
      mesh(new THREE.TorusGeometry(0.042, 0.012, 5, 12), H.brass, head, { p: [sx * 0.055, 0.02, 0.165], edge: false });
      mesh(new THREE.CircleGeometry(0.034, 12), H.lensG, head, { p: [sx * 0.055, 0.02, 0.17], edge: false, cast: false });
      mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 10).rotateZ(PI / 2), M.gunmetal, head, { p: [sx * 0.12, -0.07, 0.12], r: [0, -sx * 0.6, 0], edge: false });     // filter cans
      mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.02, 10).rotateZ(PI / 2), H.brass, head, { p: [sx * 0.165, -0.07, 0.15], r: [0, -sx * 0.6, 0], edge: false });
    }
    mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.09, 8).rotateX(PI / 2), M.mask, head, { p: [0, -0.09, 0.17], edge: false });
    { const hose = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([v(0, -0.12, 0.15), v(0.08, -0.24, 0.08), v(0.16, -0.3, -0.12), v(0.08, -0.22, -0.26)]), 12, 0.018, 5);
      mesh(hose, M.joint, head, { edge: false }); for (let k = 0; k < 6; k++) { const p = hose.parameters.path.getPoint(k / 6); mesh(new THREE.TorusGeometry(0.021, 0.006, 3, 6), M.gunmetal, head, { p: p.toArray(), q: qFrom(v(0, 0, 1), hose.parameters.path.getTangent(k / 6)), edge: false, cast: false }); } }
    const aim = grp(torso, [0, 0.48, 0]); J.aim = aim;
    const rifle = grp(aim, [-0.08, -0.04, 0.2]); J.rifle = rifle;
    mesh(new THREE.BoxGeometry(0.075, 0.12, 0.42), M.rifle, rifle, { p: [0, 0, 0.1], edge: false });          // receiver
    mesh(new THREE.BoxGeometry(0.06, 0.13, 0.28), M.rifle, rifle, { p: [0, -0.05, -0.22], r: [-0.12, 0, 0], edge: false });     // stock
    mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 8).rotateX(PI / 2), M.gunmetal, rifle, { p: [0, 0.02, 0.46], edge: false });    // shroud
    for (let k = 0; k < 4; k++) mesh(new THREE.BoxGeometry(0.072, 0.012, 0.04), M.joint, rifle, { p: [0, 0.045, 0.36 + k * 0.07], edge: false, cast: false });
    mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 6).rotateX(PI / 2), M.gunmetal, rifle, { p: [0, 0.02, 0.72], edge: false });
    mesh(new THREE.ConeGeometry(0.014, 0.18, 4).rotateX(PI / 2), M.steel, rifle, { p: [0, -0.03, 0.78], edge: false });     // bayonet
    mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.2, 8).rotateX(PI / 2), M.gunmetal, rifle, { p: [0, 0.11, 0.08], edge: false });    // scope
    for (const z of [-0.02, 0.18]) mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 8).rotateX(PI / 2), H.brass, rifle, { p: [0, 0.11, z], edge: false, cast: false });
    mesh(new THREE.BoxGeometry(0.05, 0.18, 0.07), M.gunmetal, rifle, { p: [0, -0.13, 0.12], r: [0.3, 0, 0], edge: false });        // magazine
    J.muzzle = grp(rifle, [0, 0.02, 0.84]);
    J.glow = mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff5a20, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), J.muzzle, { edge: false, cast: false });
    for (const sx of [-1, 1]) {
      const shp = v(sx * 0.24, 0.06, 0), hand = sx < 0 ? v(-0.08, -0.06, 0.06) : v(-0.08, -0.04, 0.45);
      const elb = shp.clone().lerp(hand, 0.5).add(v(sx * 0.12, -0.12, -0.05));
      mesh(new THREE.SphereGeometry(0.085, 7, 5), H.robePlain, aim, { p: shp.toArray(), edge: false });
      seg(shp, elb, 0.07, 0.06, H.robePlain, 7, aim, { edge: false }); seg(elb, hand, 0.06, 0.05, H.robePlain, 7, aim, { edge: false });
      mesh(new THREE.TorusGeometry(0.052, 0.015, 4, 8), H.leather, aim, { p: elb.clone().lerp(hand, 0.8).toArray(), q: qFrom(v(0, 0, 1), hand.clone().sub(elb)), edge: false, cast: false });
      mesh(new THREE.BoxGeometry(0.07, 0.06, 0.09), H.leather, aim, { p: hand.toArray(), edge: false });
    }
    return J;
  }

  // ---- Heavies: riveted plate, layered pauldrons, a grilled helm with curling horns, trophy skulls and chains
  function buildHeavyHD(o) {
    const root = new THREE.Group(), J = { root }, A = o.armour, F = o.flesh;
    const hips = grp(root, [0, 1.05, 0]); J.hips = hips;
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const hip = grp(hips, [sx * 0.2, 0, 0]), knee = grp(hip, [0, -0.5, 0]);
      seg(v(0, 0, 0), v(0, -0.5, 0), 0.16, 0.12, M.joint, 8, hip, { edge: false });
      mesh(new THREE.BoxGeometry(0.28, 0.38, 0.26), A, hip, { p: [0, -0.22, 0.03], edge: false });             // thigh plate
      mesh(new THREE.SphereGeometry(0.13, 8, 6), A, knee, { p: [0, 0, 0.07], s: [1, 1, 0.8], edge: false });
      mesh(new THREE.ConeGeometry(0.04, 0.16, 4).rotateX(PI / 2), o.trim, knee, { p: [0, 0, 0.2], edge: false });
      seg(v(0, 0, 0), v(0, -0.47, 0), 0.12, 0.1, M.joint, 8, knee, { edge: false });
      mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.36, 8), A, knee, { p: [0, -0.24, 0.01], edge: false });      // greave
      mesh(new THREE.BoxGeometry(0.24, 0.14, 0.4), A, knee, { p: [0, -0.5, 0.06], edge: false });
      mesh(new THREE.BoxGeometry(0.26, 0.04, 0.42), M.joint, knee, { p: [0, -0.56, 0.06], edge: false });
      J['hip' + side] = hip; J['knee' + side] = knee;
    }
    // faulds: overlapping plates hanging from the belt, a chainmail skirt under them, trophy skulls on the belt
    mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.42, 12, 1, true), M.steel, hips, { p: [0, -0.18, 0], s: [1, 1, 0.75], edge: false });
    for (let k = 0; k < 6; k++) { const a = -1.3 + k * 0.52; mesh(new THREE.BoxGeometry(0.2, 0.3, 0.04), A, hips, { p: [Math.sin(a) * 0.36, -0.14, Math.cos(a) * 0.29], r: [0.18, a, 0], edge: false }); }
    mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 12), H.leather, hips, { p: [0, 0.05, 0], s: [1, 1, 0.75], edge: false });
    for (const a of [-0.9, -0.3, 0.35, 0.95]) skull(hips, v(Math.sin(a) * 0.38, -0.02, Math.cos(a) * 0.3), 0.75);
    mesh(new THREE.PlaneGeometry(0.42, 0.7), o.cloth, hips, { p: [0, -0.38, 0.3], r: [0.1, 0, 0], edge: false });
    const torso = grp(hips, [0, 0.1, 0]); J.torso = torso;
    mesh(new THREE.BoxGeometry(0.88, 0.74, 0.58), A, torso, { p: [0, 0.48, 0], edge: false });
    mesh(new THREE.BoxGeometry(0.66, 0.5, 0.1), A, torso, { p: [0, 0.52, 0.3], r: [-0.08, 0, 0], edge: false });     // breastplate
    for (let k = 0; k < 3; k++) mesh(new THREE.BoxGeometry(0.6 - k * 0.05, 0.1, 0.5), A, torso, { p: [0, 0.07 + k * 0.1, 0.02], edge: false });    // abdominal bands
    star3d(torso, v(0, 0.55, 0.36), 0.14, o.trim);
    mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.14, 10), A, torso, { p: [0, 0.9, 0.02], edge: false });    // gorget
    for (const sx of [-1, 1]) {
      const pd = grp(torso, [sx * 0.56, 0.82, 0]);         // three stacked pauldron lames, spikes on top
      for (let k = 0; k < 3; k++) mesh(new THREE.SphereGeometry(0.32 - k * 0.045, 10, 7, 0, PI * 2, 0, PI / 2), A, pd, { p: [sx * 0.03 * k, -k * 0.09, 0], s: [1.05, 0.7, 1], edge: false });
      mesh(new THREE.TorusGeometry(0.3, 0.018, 4, 14), o.trim, pd, { p: [0, 0, 0], r: [PI / 2, 0, 0], s: [1.05, 1, 1], edge: false, cast: false });
      for (let k = 0; k < 3; k++) mesh(new THREE.ConeGeometry(0.045, 0.3, 5), o.trim, pd, { p: [sx * (0.0 + k * 0.1), 0.2, -0.12 + k * 0.12], r: [0, 0, -sx * 0.4], edge: false });
    }
    const head = grp(torso, [0, 0.98, 0.05]); J.head = head;
    mesh(new THREE.BoxGeometry(0.32, 0.36, 0.36), A, head, { p: [0, 0.05, 0], edge: false });
    mesh(new THREE.BoxGeometry(0.34, 0.08, 0.38), A, head, { p: [0, 0.2, 0], edge: false });
    mesh(new THREE.BoxGeometry(0.26, 0.15, 0.02), M.joint, head, { p: [0, -0.02, 0.185], edge: false, cast: false });       // grille
    for (let k = 0; k < 6; k++) mesh(new THREE.BoxGeometry(0.018, 0.15, 0.02), A, head, { p: [-0.1 + k * 0.04, -0.02, 0.19], edge: false, cast: false });
    mesh(new THREE.BoxGeometry(0.22, 0.03, 0.02), M.eyeR, head, { p: [0, 0.085, 0.185], edge: false, cast: false });
    for (const sx of [-1, 1]) curve(head, v(sx * 0.16, 0.15, -0.02), v(sx, 0.6, -0.2), -sx * 1.6 * (o.horn > 0.3 ? 1.3 : 1), o.horn * 1.3, 0.06, 7, M.bone, { axis: v(0, 0, 1) });
    if (o.crown) for (let k = 0; k < 7; k++) { const a = -1.2 + k * 0.4; mesh(new THREE.ConeGeometry(0.025, 0.2, 4), o.trim, head, { p: [Math.sin(a) * 0.16, 0.3, Math.cos(a) * 0.12 - 0.03], r: [Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3], edge: false }); }
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const sh = grp(torso, [sx * 0.58, 0.66, 0]), el = grp(sh, [0, -0.42, 0]);
      seg(v(0, 0, 0), v(0, -0.42, 0), 0.14, 0.12, F, 8, sh, { edge: false });
      for (let k = 0; k < 2; k++) mesh(new THREE.TorusGeometry(0.135, 0.02, 4, 10), H.leather, sh, { p: [0, -0.15 - k * 0.12, 0], r: [PI / 2, 0, 0], edge: false, cast: false });
      mesh(new THREE.SphereGeometry(0.12, 8, 6), A, el, { edge: false });
      mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.36, 8), A, el, { p: [0, -0.2, 0], edge: false });       // vambrace
      for (let k = 0; k < 3; k++) mesh(new THREE.ConeGeometry(0.025, 0.1, 4), o.trim, el, { p: [sx * 0.12, -0.1 - k * 0.1, 0], r: [0, 0, -sx * PI / 2], edge: false });
      mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), M.joint, el, { p: [0, -0.42, 0], edge: false });     // gauntlet
      J['sh' + side] = sh; J['el' + side] = el;
    }
    J.weapon = grp(J.elR, [0, -0.42, 0], [-1.2, 0, 0]);
    o.weapon(J.weapon);
    if (o.shield) {
      const sg = grp(J.elL, [0.02, -0.22, 0.2]); J.shield = sg;
      const sh = new THREE.Shape(); sh.moveTo(-0.5, 0.72); sh.lineTo(0.5, 0.72); sh.lineTo(0.5, -0.4); sh.quadraticCurveTo(0.45, -0.75, 0, -0.95); sh.quadraticCurveTo(-0.45, -0.75, -0.5, -0.4); sh.closePath();
      mesh(ext(sh, 0.08, 0.02), A, sg, { p: [0, 0, 0.05], edge: false });
      const rim = new THREE.Shape(); rim.moveTo(-0.53, 0.75); rim.lineTo(0.53, 0.75); rim.lineTo(0.53, -0.42); rim.quadraticCurveTo(0.48, -0.8, 0, -1.0); rim.quadraticCurveTo(-0.48, -0.8, -0.53, -0.42); rim.closePath();
      rim.holes.push(sh); mesh(ext(rim, 0.11, 0.01), o.trim, sg, { p: [0, 0, 0.04], edge: false });
      star3d(sg, v(0, 0.02, 0.17), 0.3, o.trim);
      skull(sg, v(0, 0.02, 0.2), 1.3);
      for (const [x, y] of [[-0.36, 0.55], [0.36, 0.55], [-0.36, -0.35], [0.36, -0.35], [0, -0.75]]) mesh(new THREE.ConeGeometry(0.045, 0.24, 5).rotateX(PI / 2), M.bone, sg, { p: [x, y, 0.22], edge: false });
      for (let k = 0; k < 8; k++) mesh(new THREE.SphereGeometry(0.022, 5, 4), o.trim, sg, { p: [-0.42 + k * 0.12, 0.66, 0.15], edge: false, cast: false });
    }
    if (o.pack) {        // the champion's backpack: twin exhaust stacks with embers, and a trophy pole of skulls
      mesh(new THREE.BoxGeometry(0.62, 0.6, 0.28), A, torso, { p: [0, 0.6, -0.4], edge: false });
      for (const sx of [-1, 1]) { mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.62, 8), M.gunmetal, torso, { p: [sx * 0.2, 1.02, -0.44], edge: false });
        mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 8), H.ember, torso, { p: [sx * 0.2, 1.34, -0.44], edge: false, cast: false }); }
      seg(v(0, 0.4, -0.55), v(0, 2.0, -0.62), 0.025, 0.02, M.rifle, 6, torso, { edge: false });
      mesh(new THREE.BoxGeometry(0.5, 0.04, 0.04), H.brass, torso, { p: [0, 1.92, -0.62], edge: false });
      const bn = new THREE.PlaneGeometry(0.46, 0.75, 2, 4); bn.translate(0, -0.38, 0); mesh(bn, H.cape, torso, { p: [0, 1.9, -0.63], edge: false });
      for (let k = 0; k < 3; k++) skull(torso, v(0, 1.0 + k * 0.22, -0.66), 0.8);
      mesh(new THREE.ConeGeometry(0.06, 0.24, 6), H.brass, torso, { p: [0, 2.1, -0.62], edge: false });
    }
    if (o.fur) for (let k = 0; k < 26; k++) { const a = k / 26 * PI * 2; mesh(new THREE.ConeGeometry(0.06, 0.22, 4), H.fur, torso, { p: [Math.sin(a) * 0.36, 0.86, Math.cos(a) * 0.3], r: [Math.cos(a) * 1.1 + 0.3, 0, -Math.sin(a) * 1.1], edge: false, cast: false }); }
    if (o.cape) {
      const cp = new THREE.PlaneGeometry(1.0, 1.9, 4, 8), pa = cp.attributes.position;
      for (let k = 0; k < pa.count; k++) { const y = pa.getY(k), x = pa.getX(k); pa.setZ(k, -Math.pow(Math.max(0, 0.95 - y) / 1.9, 1.5) * 0.4 + Math.sin(x * 6 + y * 2) * 0.05); }
      cp.translate(0, -0.95, 0); cp.computeVertexNormals();
      J.cape = mesh(cp, H.cape, torso, { p: [0, 0.86, -0.33], edge: false });
    }
    if (o.chains) { chain(torso, v(-0.4, 0.2, 0.28), v(0.4, 0.8, 0.3), 9, 0.02); chain(hips, v(-0.3, -0.05, 0.3), v(0.25, -0.1, 0.32), 6, 0.018); }
    root.scale.setScalar(o.scale);
    return J;
  }
  function star3d(parent, p, r, m) {        // the eight-pointed star as a raised relief
    const g = grp(parent); g.position.copy(p);
    for (let k = 0; k < 8; k++) { const a = k * PI / 4; mesh(new THREE.BoxGeometry(r, 0.025, 0.02), m, g, { p: [Math.cos(a) * r / 2, Math.sin(a) * r / 2, 0], r: [0, 0, a], edge: false, cast: false });
      mesh(new THREE.ConeGeometry(0.03 * r / 0.14, 0.05 * r / 0.14, 3), m, g, { p: [Math.cos(a) * r, Math.sin(a) * r, 0], r: [0, 0, a - PI / 2], edge: false, cast: false }); }
    mesh(new THREE.TorusGeometry(r * 0.32, 0.012, 4, 14), m, g, { edge: false, cast: false });
  }
  const buildBruteHD = () => buildHeavyHD({ armour: H.rust, flesh: H.stitch, trim: H.brass, cloth: H.robe, horn: 0.24, scale: 1.2, shield: true, chains: true,
    weapon(w) { seg(v(0, -0.15, 0), v(0, 1.1, 0), 0.04, 0.04, H.leather, 6, w, { edge: false });
      for (let k = 0; k < 5; k++) mesh(new THREE.TorusGeometry(0.045, 0.01, 3, 8), M.joint, w, { p: [0, 0.0 + k * 0.06, 0], r: [PI / 2, 0, 0], edge: false, cast: false });
      mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.42, 8), H.rust, w, { p: [0, 1.16, 0], edge: false });
      for (let k = 0; k < 8; k++) { const a = k * PI / 4; mesh(new THREE.BoxGeometry(0.04, 0.38, 0.12), H.rust, w, { p: [Math.cos(a) * 0.22, 1.16, Math.sin(a) * 0.22], r: [0, -a, 0], edge: false }); }
      mesh(new THREE.ConeGeometry(0.08, 0.26, 6), M.bone, w, { p: [0, 1.5, 0], edge: false });
      chain(w, v(0, 0.95, 0.2), v(0.12, 0.6, 0.25), 5, 0.015); } });
  const buildChampionHD = () => {
    const J = buildHeavyHD({ armour: H.crimson, flesh: M.heavy, trim: H.brass, cloth: H.robe, horn: 0.5, scale: 1.5, cape: true, pack: true, fur: true, crown: true,
      weapon(w) { seg(v(0, -0.3, 0), v(0, 1.6, 0), 0.035, 0.035, M.rifle, 6, w, { edge: false });
        for (let k = 0; k < 7; k++) mesh(new THREE.TorusGeometry(0.04, 0.009, 3, 8), H.brass, w, { p: [0, -0.2 + k * 0.05, 0], r: [PI / 2, 0, 0], edge: false, cast: false });
        const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(0.42, -0.05, 0.6, -0.25); sh.quadraticCurveTo(0.72, 0.2, 0.62, 0.62); sh.quadraticCurveTo(0.4, 0.4, 0, 0.52); sh.closePath();
        for (const sx of [-1, 1]) { const g = ext(sh, 0.035, 0.012); g.translate(0, 0, -0.0175);
          mesh(g, M.steel, w, { p: [0, 1.0, 0], s: [sx, 1, 1], edge: false });
          mesh(new THREE.PlaneGeometry(0.4, 0.4), H.runes, w, { p: [sx * 0.34, 1.26, sx * 0.025], r: [0, sx > 0 ? 0 : PI, 0], edge: false, cast: false }); }
        mesh(new THREE.SphereGeometry(0.07, 8, 6), H.brass, w, { p: [0, 1.25, 0], edge: false });
        mesh(new THREE.ConeGeometry(0.05, 0.36, 5), H.brass, w, { p: [0, 1.78, 0], edge: false });
        mesh(new THREE.SphereGeometry(0.05, 6, 5), H.brass, w, { p: [0, -0.32, 0], edge: false }); } });
    for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(0.028, 6, 4), H.glowR, J.head, { p: [sx * 0.06, 0.085, 0.19], edge: false, cast: false });
    return J;
  };
  HD.build = { ghoul: buildGhoulHD, leaper: buildLeaperHD, gunner: buildGunnerHD, brute: buildBruteHD, champion: buildChampionHD };
