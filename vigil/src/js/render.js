// ==================================================================== render: Vigil's frame (three.js r128, no other libraries)
// makeRenderer(canvas, opts) -> rnd. One HDR target with 4x MSAA and a depth texture; a procedural sky drawn as the background and
// captured into a PMREM for image-based light; a sun whose 4096 shadow map follows the player in whole texels; half-res SSAO that
// darkens only the ambient share of each pixel; a 13-tap down / tent up bloom chain; height fog patched into every material;
// the first-person viewmodel (layer 1) drawn after the world with its own FOV; ACES, grade, vignette and grain out to sRGB.
// Colours given as numbers or strings are sRGB and get linearised; THREE.Color, Vector3 and [r, g, b] are taken as linear.
//
// opts: { renderer (wrap an existing WebGLRenderer), quality: 'high'|'medium'|'low', settings: {...S}, sky: {...SKY}, addSun (default true), target }
// rnd.render(scene, camera, dt)   one frame; leaves the renderer's own settings as it found them (so a plain render path still works)
// rnd.setSize(w, h, pixelRatio)   rnd.setQuality(q)   rnd.setFocus(vec3) (the shadow follows it)   rnd.updateSky(params)   rnd.stats()
// rnd.settings (S below, live)    rnd.sun (DirectionalLight: set colour and intensity in physical units)   rnd.vmCamera
// rnd.viewmodel(obj)  puts obj and its children on layer 1 (drawn last, own FOV, no world AO, no shadow cast into the world)
// rnd.patch(material) adds fog etc. now (done automatically to Mesh/Points materials on first render; a ShaderMaterial opts in with
//                     userData.vgFog = true and must contain #include <fog_vertex> / <fog_fragment>); userData.vgSkip opts out.
// rnd.uniforms, rnd.fogGLSL  the shared fog uniforms and GLSL (vgFog(worldPos, eye) -> rgb in-scatter, a transmittance) for custom shaders.
// Use this fog instead of scene.fog. Lights are in physically correct units (a non-physical scene needs its lights x PI).
function makeRenderer(canvas, opts) {
  opts = opts || {};
  const T = THREE;
  const renderer = opts.renderer || new T.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
  const GL2 = renderer.capabilities.isWebGL2;
  const HALF = GL2 || renderer.extensions.has('EXT_color_buffer_half_float') ? T.HalfFloatType : T.UnsignedByteType;

  const S = Object.assign({
    exposure: 1.0,
    bloom: true, bloomStrength: 0.6, bloomThreshold: 1.0, bloomKnee: 0.6, bloomRadius: 0.8,
    ssao: true, ssaoStrength: 0.9, ssaoRadius: 0.5, ssaoBias: 0.02, ssaoPower: 1.5, ssaoDirect: 0.1, ssaoMaxDist: 90,
    fog: true, fogDensity: 0.01, fogFalloff: 0.12, fogBase: 0, fogStart: 1.5, fogMax: 0.97, fogColor: null, fogSun: null, fogSunPow: 6, fogSky: 1,
    sky: true, ibl: true, envIntensity: 1.0,
    shadowRange: 30, shadowDepth: 160, shadowBias: -0.0003, shadowNormalBias: 0.02, shadowSoft: 1.5,
    vmFov: 54, vmNear: 0.01,
    vignette: 0.28, grain: 0.03,
    saturation: 1.04, contrast: 1.04, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
    split: 0.5, splitShadow: [0.93, 0.98, 1.1], splitHighlight: [1.06, 1.0, 0.93],
    debug: '',      // 'ao' | 'ambient' | 'bloom' shows one buffer
  }, opts.settings);
  const SKY = Object.assign({ top: 0x2b4775, horizon: 0xe3a676, ground: 0x2b2420, sunDir: [-0.45, 0.2, -0.87], sunColor: 0xfff1de,
    sunSize: 1.1, sunDisc: 60, halo: 1, glow: 1, glowColor: 0xff9a55, intensity: 1, iblHalo: 0.6, spread: 0.6, curve: 1 }, opts.sky);      // spread: how high the gradient reaches the top colour
  const QUAL = {
    high: { msaa: 4, ssao: true, ssaoN: 16, bloomN: 6, shadow: 4096, pcf: 3 },
    medium: { msaa: 4, ssao: true, ssaoN: 10, bloomN: 6, shadow: 4096, pcf: 2 },
    low: { msaa: 2, ssao: false, ssaoN: 8, bloomN: 3, shadow: 2048, pcf: 0 } };
  let Q = QUAL[opts.quality] || QUAL.high, quality = QUAL[opts.quality] ? opts.quality : 'high';

  const lin = (v, out) => {
    if (v == null) return out;
    if (typeof v === 'number' || typeof v === 'string') { const c = new T.Color(v).convertSRGBToLinear(); return out.set(c.r, c.g, c.b); }
    if (v.isColor) return out.set(v.r, v.g, v.b);
    if (v.isVector3) return out.copy(v);
    return out.set(v[0], v[1], v[2]);
  };
  const v3 = () => new T.Vector3();

  // ---------------------------------------------------------------- shared uniforms: every patched material holds these same objects
  const U = {
    vgFogCol: { value: v3() }, vgFogSunCol: { value: v3() }, vgSunDir: { value: new T.Vector3(0, 1, 0) },
    vgFogP: { value: new T.Vector4() }, vgFogQ: { value: new T.Vector2(0.97, 6) },
    vgEnvI: { value: 1 }, vgNoAO: { value: 0 }, vgSoft: { value: 0 },
  };
  // the fog: density a·exp(-b(h - h0)) integrated along the eye ray, with a sun lobe so it glows toward the light
  const FOG_GLSL = `
uniform vec3 vgFogCol;
uniform vec3 vgFogSunCol;
uniform vec3 vgSunDir;
uniform vec4 vgFogP;
uniform vec2 vgFogQ;
vec4 vgFog( vec3 wp, vec3 eye ) {
	vec3 rd = wp - eye; float d = length( rd ); rd /= max( d, 1e-4 );
	float s = min( d, vgFogP.w ), L = d - s;
	if ( L <= 0.0 || vgFogP.x <= 0.0 ) return vec4( vgFogCol, 1.0 );
	float b = max( vgFogP.y, 1e-4 ), h = eye.y + rd.y * s - vgFogP.z, k = max( b * rd.y * L, -40.0 );
	float od = vgFogP.x * exp( clamp( -b * h, -40.0, 40.0 ) ) * L * ( abs( k ) > 1e-3 ? ( 1.0 - exp( -k ) ) / k : 1.0 - 0.5 * k );
	float mu = max( dot( rd, vgSunDir ), 0.0 );
	return vec4( vgFogCol + vgFogSunCol * pow( mu, vgFogQ.y ), max( exp( -od ), 1.0 - vgFogQ.x ) );
}
`;
  // soft PCF: a grid of bilinear compares spread over shadow.radius texels (r128's own 3x3 runs when vgSoft is 0)
  const PCF_GLSL = `
	float vgBil( sampler2D sm, vec2 uv, float z, vec2 ts, vec2 size ) {
		vec2 f = fract( uv * size + 0.5 ), b = uv - f * ts;
		return mix( mix( texture2DCompare( sm, b, z ), texture2DCompare( sm, b + vec2( ts.x, 0.0 ), z ), f.x ),
			mix( texture2DCompare( sm, b + vec2( 0.0, ts.y ), z ), texture2DCompare( sm, b + ts, z ), f.x ), f.y );
	}
	float vgPCF( sampler2D sm, vec2 size, float radius, vec3 c ) {
		vec2 ts = 1.0 / size; float r = max( radius, 1.0 ), s = 0.0;
		if ( vgSoft > 2.5 ) {
			for ( int i = -1; i <= 1; i ++ ) for ( int j = -1; j <= 1; j ++ ) s += vgBil( sm, c.xy + vec2( float( i ), float( j ) ) * ts * r * 0.75, c.z, ts, size );
			return s * ( 1.0 / 9.0 );
		}
		for ( int i = 0; i < 2; i ++ ) for ( int j = 0; j < 2; j ++ ) s += vgBil( sm, c.xy + ( vec2( float( i ), float( j ) ) - 0.5 ) * ts * r, c.z, ts, size );
		return s * 0.25;
	}
`;
  const SOFT_CHUNK = (() => {
    const c = T.ShaderChunk.shadowmap_pars_fragment, m1 = '#elif defined( SHADOWMAP_TYPE_PCF_SOFT )', m2 = '#elif defined( SHADOWMAP_TYPE_VSM )';
    const i0 = c.indexOf('float getShadow('), i1 = c.indexOf(m1, i0), i2 = c.indexOf(m2, i1);
    if (i0 < 0 || i1 < 0 || i2 < 0) return null;
    return c.slice(0, i0) + PCF_GLSL + c.slice(i0, i1 + m1.length) +
      '\n\t\t\tif ( vgSoft > 0.5 ) { shadow = vgPCF( shadowMap, shadowMapSize, shadowRadius, shadowCoord.xyz ); } else {' + c.slice(i1 + m1.length, i2) + '}\n' + c.slice(i2);
  })();

  // ---------------------------------------------------------------- material patch: height fog, IBL scale, soft shadows, ambient share in alpha
  // The alpha of each opaque pixel carries how much of its light is ambient (hemisphere + IBL); the final pass darkens only that share
  // with the AO, so sunlit faces and glows keep their strength. Additive and transparent materials keep their own alpha.
  const PATCH_V = 'vg1', patched = new WeakSet();
  const VS_WPOS = `
	{ vec4 vgW = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		vgW = instanceMatrix * vgW;
	#endif
	vgWPos = ( modelMatrix * vgW ).xyz; }`;
  function inject(sh, m, kind) {
    for (const k in U) sh.uniforms[k] = U[k];
    let vs = sh.vertexShader, fs = sh.fragmentShader;
    const fogOn = m.fog !== false, opaque = !m.transparent, additive = m.blending === T.AdditiveBlending;
    if (vs.includes('#include <project_vertex>') && vs.includes('#include <begin_vertex>')) vs = vs.replace('#include <project_vertex>', '#include <project_vertex>' + VS_WPOS);
    else if (vs.includes('#include <fog_vertex>')) vs = vs.replace('#include <fog_vertex>', '#include <fog_vertex>\n\tvgWPos = ( modelMatrix * vec4( ' + (vs.includes('#include <begin_vertex>') ? 'transformed' : 'position') + ', 1.0 ) ).xyz;');
    else return;     // nowhere to put the world position: leave it as it was
    sh.vertexShader = 'varying vec3 vgWPos;\n' + vs;
    fs = 'varying vec3 vgWPos;\nuniform float vgEnvI, vgNoAO, vgSoft;\nfloat vgLum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }\n' + FOG_GLSL + fs;
    if (SOFT_CHUNK) fs = fs.replace('#include <shadowmap_pars_fragment>', SOFT_CHUNK);
    fs = fs.replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
	#if defined( RE_IndirectDiffuse ) && defined( USE_ENVMAP )
		iblIrradiance *= vgEnvI;
	#endif
	#if defined( RE_IndirectSpecular ) && defined( USE_ENVMAP )
		radiance *= vgEnvI;
	#endif`);
    const OUT = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';
    let amb = '1.0';
    if (fs.includes(OUT)) {
      amb = 'vgAmb';
      fs = fs.replace(OUT, (kind === 'basic' ? 'float vgAmb = 0.0;' : 'float vgAmb = vgLum( reflectedLight.indirectDiffuse + reflectedLight.indirectSpecular ) / max( vgLum( outgoingLight ), 1e-5 );') + '\n\t' + OUT);
    }
    let tail = '\n\tfloat vgT = 1.0;';
    if (fogOn) tail += '\n\t{ vec4 vgF = vgFog( vgWPos, cameraPosition ); vgT = vgF.a; gl_FragColor.rgb = ' +
      (additive ? 'gl_FragColor.rgb * vgT; }' : 'gl_FragColor.rgb * vgT + vgF.rgb * ( 1.0 - vgT ); }');
    const alpha = opaque ? `\n\tgl_FragColor.a = clamp( ${amb}, 0.0, 1.0 ) * vgT * ( 1.0 - vgNoAO );` : '';
    if (!fs.includes('#include <fog_fragment>')) { sh.fragmentShader = fs; return; }
    if (fs.includes('#include <premultiplied_alpha_fragment>')) {
      fs = fs.replace('#include <fog_fragment>', '#include <fog_fragment>' + tail).replace('#include <premultiplied_alpha_fragment>', '#include <premultiplied_alpha_fragment>' + alpha);
    } else fs = fs.replace('#include <fog_fragment>', '#include <fog_fragment>' + tail + alpha);
    sh.fragmentShader = fs;
  }
  function patch(m) {
    if (!m || patched.has(m) || (m.userData && m.userData.vgSkip)) return;
    const kind = m.isMeshStandardMaterial ? 'pbr' : (m.isMeshPhongMaterial || m.isMeshLambertMaterial || m.isMeshToonMaterial) ? 'lit'
      : (m.isMeshBasicMaterial || m.isPointsMaterial) ? 'basic' : (m.isShaderMaterial && !m.isRawShaderMaterial && m.userData && m.userData.vgFog) ? 'shader' : null;
    if (!kind) return;
    patched.add(m);
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey !== T.Material.prototype.customProgramCacheKey
      ? m.customProgramCacheKey.bind(m) : (s => () => s)(prev.toString());     // the default key is onBeforeCompile's text, which we replace
    m.onBeforeCompile = function (sh, r) { prev.call(this, sh, r); inject(sh, this, kind); };
    m.customProgramCacheKey = function () { return prevKey() + '|' + PATCH_V + (this.transparent ? 't' : 'o') + (this.fog === false ? 'n' : 'f') + (this.blending === T.AdditiveBlending ? 'a' : ''); };
    m.needsUpdate = true;
  }

  // ---------------------------------------------------------------- full-screen passes
  const triGeo = new T.BufferGeometry();
  triGeo.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  triGeo.setAttribute('uv', new T.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const QUAD_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';
  const passMat = (fs, uniforms, defines) => new T.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: fs, uniforms, defines: defines || {}, depthTest: false, depthWrite: false, toneMapped: false });
  const quadScene = new T.Scene(), quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new T.Mesh(triGeo, passMat('void main(){ gl_FragColor = vec4( 0.0 ); }', {}));
  quad.frustumCulled = false; quadScene.add(quad);
  function run(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); }

  // ---------------------------------------------------------------- sky: the background and the source of the image-based light
  const SKY_FS = FOG_GLSL + `
uniform vec3 uTop, uHor, uGround, uSunCol, uGlowCol, uEye;
uniform vec4 uSkyP;
uniform vec2 uShape;
uniform float uSkyI, uFogSky, uDisc;
varying vec3 vDir;
void main() {
	vec3 d = normalize( vDir ); float y = d.y;
	// the gradient runs in a gamma-2 space: a linear mix of a bright horizon and a dark zenith stays horizon-coloured almost to the top
	vec3 c = y >= 0.0 ? mix( sqrt( uHor ), sqrt( uTop ), pow( smoothstep( 0.0, uShape.x, y ), uShape.y ) ) : mix( sqrt( uHor ), sqrt( uGround ), smoothstep( 0.0, 0.2, -y ) );
	c *= c;
	float mu = dot( d, vgSunDir ), m = max( mu, 0.0 );
	c += uGlowCol * exp( -abs( y ) * 7.0 ) * ( 0.2 + 0.8 * m * m * m ) * uSkyP.w;
	c += uSunCol * ( pow( m, 500.0 ) * 0.5 + pow( m, 30.0 ) * 0.1 + pow( m, 5.0 ) * 0.04 ) * uSkyP.z;
	c += uSunCol * smoothstep( uSkyP.x - 2e-5, uSkyP.x + 2e-5, mu ) * uDisc;
	c *= uSkyI;
	if ( uFogSky > 0.0 ) { vec4 f = vgFog( uEye + d * 3000.0, uEye ); c = mix( c, c * f.a + f.rgb * ( 1.0 - f.a ), uFogSky ); }
	gl_FragColor = vec4( c, 0.0 );
	#include <encodings_fragment>
}`;
  const skyU = { uTop: { value: v3() }, uHor: { value: v3() }, uGround: { value: v3() }, uSunCol: { value: v3() }, uGlowCol: { value: v3() },
    uEye: { value: v3() }, uSkyP: { value: new T.Vector4() }, uShape: { value: new T.Vector2(0.6, 1) }, uSkyI: { value: 1 }, uFogSky: { value: 1 }, uDisc: { value: 1 },
    uInvProj: { value: new T.Matrix4() }, uCamWorld: { value: new T.Matrix4() } };
  for (const k of ['vgFogCol', 'vgFogSunCol', 'vgSunDir', 'vgFogP', 'vgFogQ']) skyU[k] = U[k];
  const skyMat = new T.ShaderMaterial({ uniforms: skyU, fragmentShader: SKY_FS, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: 'uniform mat4 uInvProj, uCamWorld; varying vec3 vDir; void main() { vec4 v = uInvProj * vec4( position.xy, 1.0, 1.0 ); vDir = mat3( uCamWorld ) * ( v.xyz / v.w ); gl_Position = vec4( position.xy, 0.9999, 1.0 ); }' });
  const skyQuad = new T.Mesh(triGeo, skyMat); skyQuad.frustumCulled = false; skyQuad.renderOrder = -1e9; skyQuad.name = 'vg-sky';
  // the capture sees the same sky without the disc (the sun light already gives its highlight) and with a softer halo
  // sky.env can give the capture its own colours/intensity (an interior lit by a different sky than the one it shows)
  const capU = Object.assign({}, skyU, { uDisc: { value: 0 }, uSkyP: { value: new T.Vector4() }, uEye: { value: v3() },
    uTop: { value: v3() }, uHor: { value: v3() }, uGround: { value: v3() }, uGlowCol: { value: v3() }, uSkyI: { value: 1 } });
  const capMat = new T.ShaderMaterial({ uniforms: capU, fragmentShader: SKY_FS, side: T.BackSide, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }' });
  const capScene = new T.Scene(); capScene.add(new T.Mesh(new T.SphereGeometry(50, 48, 24), capMat));
  const pmrem = new T.PMREMGenerator(renderer);
  let envRT = null, envSig = '';
  const sunDir = new T.Vector3();
  function applySky() {
    lin(SKY.top, skyU.uTop.value); lin(SKY.horizon, skyU.uHor.value); lin(SKY.ground, skyU.uGround.value);
    lin(SKY.sunColor, skyU.uSunCol.value); lin(SKY.glowColor, skyU.uGlowCol.value);
    sunDir.set(SKY.sunDir[0], SKY.sunDir[1], SKY.sunDir[2]); if (SKY.sunDir.isVector3) sunDir.copy(SKY.sunDir); sunDir.normalize();
    U.vgSunDir.value.copy(sunDir);
    skyU.uSkyP.value.set(Math.cos(SKY.sunSize * Math.PI / 180), 0, SKY.halo, SKY.glow); skyU.uSkyI.value = SKY.intensity; skyU.uDisc.value = SKY.sunDisc; skyU.uShape.value.set(SKY.spread, SKY.curve);
    capU.uSkyP.value.set(skyU.uSkyP.value.x, 0, SKY.halo * SKY.iblHalo, SKY.glow);
    const E = Object.assign({}, SKY, SKY.env);
    lin(E.top, capU.uTop.value); lin(E.horizon, capU.uHor.value); lin(E.ground, capU.uGround.value); lin(E.glowColor, capU.uGlowCol.value); capU.uSkyI.value = E.intensity;
  }
  function regenEnv(eyeY) {
    capU.uEye.value.set(0, eyeY, 0);
    const old = envRT; envRT = pmrem.fromScene(capScene, 0, 0.1, 100); if (old) old.dispose();
  }

  // ---------------------------------------------------------------- the sun, its shadow kept on the focus point in whole texels
  const sun = new T.DirectionalLight(0xffffff, 3); sun.name = 'vg-sun'; sun.castShadow = true;
  const focus = new T.Vector3(), _snap = new T.Vector3(), _m = new T.Matrix4(), _ax = new T.Vector3(), _ay = new T.Vector3(), _up = new T.Vector3(0, 1, 0), _zero = new T.Vector3();
  function updateSun() {
    const sh = sun.shadow, size = Q.shadow;
    if (sh.mapSize.x !== size) { sh.mapSize.set(size, size); if (sh.map) { sh.map.dispose(); sh.map = null; } }
    sh.bias = S.shadowBias; sh.normalBias = S.shadowNormalBias; sh.radius = S.shadowSoft;
    const R = S.shadowRange, texel = 2 * R / size, c = sh.camera;
    _m.lookAt(sunDir, _zero, _up); _ax.setFromMatrixColumn(_m, 0); _ay.setFromMatrixColumn(_m, 1);     // the shadow camera's own right and up
    const px = focus.dot(_ax), py = focus.dot(_ay);
    _snap.copy(focus).addScaledVector(_ax, Math.round(px / texel) * texel - px).addScaledVector(_ay, Math.round(py / texel) * texel - py);
    sun.target.position.copy(_snap); sun.position.copy(_snap).addScaledVector(sunDir, S.shadowDepth * 0.5);
    if (c.right !== R || c.far !== S.shadowDepth) { c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = 0.5; c.far = S.shadowDepth; c.updateProjectionMatrix(); }
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
  }

  // ---------------------------------------------------------------- targets
  let W = 1, H = 1, PR = 1, hdr = null, aoA = null, aoB = null, aoFull = null, B = [], UP = [];
  const rtOpts = (type, filter) => ({ type, format: T.RGBAFormat, minFilter: filter, magFilter: filter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
  function makeHDR() {
    const o = rtOpts(HALF, T.LinearFilter); o.depthBuffer = true;
    const rt = GL2 && Q.msaa > 1 ? new T.WebGLMultisampleRenderTarget(W, H, o) : new T.WebGLRenderTarget(W, H, o);
    if (rt.isWebGLMultisampleRenderTarget) rt.samples = Q.msaa;
    rt.depthTexture = new T.DepthTexture(W, H, GL2 ? T.FloatType : T.UnsignedIntType);      // float depth: the MSAA resolve blits into it
    return rt;
  }
  function buildTargets() {
    for (const t of [hdr, aoA, aoB, aoFull, ...B, ...UP]) if (t) { if (t.depthTexture) t.depthTexture.dispose(); t.dispose(); }
    hdr = makeHDR();
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    aoA = new T.WebGLRenderTarget(hw, hh, rtOpts(HALF, T.NearestFilter)); aoB = new T.WebGLRenderTarget(hw, hh, rtOpts(HALF, T.NearestFilter));
    aoFull = new T.WebGLRenderTarget(W, H, rtOpts(T.UnsignedByteType, T.LinearFilter));
    B = []; UP = [];
    for (let i = 0; i < Q.bloomN; i++) {
      const w = Math.max(1, W >> (i + 1)), h = Math.max(1, H >> (i + 1));
      B.push(new T.WebGLRenderTarget(w, h, rtOpts(HALF, T.LinearFilter)));
      if (i < Q.bloomN - 1) UP.push(new T.WebGLRenderTarget(w, h, rtOpts(HALF, T.LinearFilter)));
    }
  }

  // ---------------------------------------------------------------- SSAO: hemisphere kernel, normals from depth, depth-aware blur and upsample
  const VZ = 'uniform float uNear, uFar; float vz( float d ) { return ( uNear * uFar ) / ( ( uFar - uNear ) * d - uFar ); }\n';
  const kernel = []; { let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 32; i++) { const v = new T.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, 0.15 + rnd() * 0.85).normalize(), t = i / 32; kernel.push(v.multiplyScalar(0.12 + 0.88 * t * t)); } }
  const ssaoMat = passMat(VZ + `
uniform sampler2D tDepth; uniform vec2 uFull; uniform mat4 uProj, uInvProj; uniform float uRadius, uBias, uPower, uMaxD;
uniform vec3 uKernel[ 32 ];
varying vec2 vUv;
vec3 vpos( vec2 uv ) { float d = texture2D( tDepth, uv ).x; vec4 p = uInvProj * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 ); return p.xyz / p.w; }
void main() {
	// work at full-res texel centres: a half-res pixel centre sits on a texel corner, and the mismatch bands flat floors
	vec2 tx = 1.0 / uFull, uv = ( floor( vUv * uFull ) + 0.5 ) * tx;
	float d = texture2D( tDepth, uv ).x;
	if ( d >= 0.99999 ) { gl_FragColor = vec4( 1.0, 1e4, 0.0, 1.0 ); return; }
	vec3 p = vpos( uv );
	vec3 l = vpos( uv - vec2( tx.x, 0.0 ) ), r = vpos( uv + vec2( tx.x, 0.0 ) ), b = vpos( uv - vec2( 0.0, tx.y ) ), t = vpos( uv + vec2( 0.0, tx.y ) );
	vec3 dx = abs( r.z - p.z ) < abs( p.z - l.z ) ? r - p : p - l, dy = abs( t.z - p.z ) < abs( p.z - b.z ) ? t - p : p - b;
	vec3 n = normalize( cross( dx, dy ) );
	float a = 6.2831853 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
	vec3 rv = vec3( cos( a ), sin( a ), 0.0 ), tg = normalize( rv - n * dot( rv, n ) );
	mat3 tbn = mat3( tg, cross( n, tg ), n );
	// the bias grows with distance and with how steeply the surface runs away from the eye (a texel's depth step)
	float slope = max( abs( dx.z ), abs( dy.z ) ), bias = uBias * ( 1.0 - p.z * 0.02 ) + slope * 0.75;
	float occ = 0.0;
	for ( int i = 0; i < N; i ++ ) {
		vec3 s = p + tbn * uKernel[ i ] * uRadius;
		vec4 o = uProj * vec4( s, 1.0 ); vec2 su = o.xy / o.w * 0.5 + 0.5;
		if ( su.x < 0.0 || su.y < 0.0 || su.x > 1.0 || su.y > 1.0 ) continue;
		float sz = vz( texture2D( tDepth, su ).x );
		occ += step( s.z + bias, sz ) * smoothstep( 0.0, 1.0, uRadius / abs( p.z - sz ) );
	}
	float ao = pow( clamp( 1.0 - occ / float( N ), 0.0, 1.0 ), uPower );
	gl_FragColor = vec4( mix( ao, 1.0, smoothstep( uMaxD * 0.7, uMaxD, -p.z ) ), -p.z, 0.0, 1.0 );
}`, { tDepth: { value: null }, uFull: { value: new T.Vector2() }, uProj: { value: new T.Matrix4() }, uInvProj: { value: new T.Matrix4() },
    uNear: { value: 0.1 }, uFar: { value: 100 }, uRadius: { value: 0.5 }, uBias: { value: 0.02 }, uPower: { value: 1.5 }, uMaxD: { value: 90 }, uKernel: { value: kernel } }, { N: Q.ssaoN });
  const blurMat = passMat(`
uniform sampler2D tAO; uniform vec2 uDir; varying vec2 vUv;
void main() {
	vec4 c = texture2D( tAO, vUv ); float z = c.g, sg = 0.04 * z + 0.03, s = c.r * 0.2270, w = 0.2270;
	for ( int i = 1; i <= 3; i ++ ) {
		float g = i == 1 ? 0.1945 : i == 2 ? 0.1216 : 0.0540;
		vec4 a = texture2D( tAO, vUv + uDir * float( i ) ), b = texture2D( tAO, vUv - uDir * float( i ) );
		float wa = g * exp( -abs( a.g - z ) / sg ), wb = g * exp( -abs( b.g - z ) / sg );
		s += a.r * wa + b.r * wb; w += wa + wb;
	}
	gl_FragColor = vec4( s / w, z, 0.0, 1.0 );
}`, { tAO: { value: null }, uDir: { value: new T.Vector2() } });
  const upAOMat = passMat(VZ + `
uniform sampler2D tAO, tDepth; uniform vec2 uHalf; varying vec2 vUv;
void main() {
	float d = texture2D( tDepth, vUv ).x;
	if ( d >= 0.99999 ) { gl_FragColor = vec4( 1.0 ); return; }
	float z = -vz( d ), sg = 0.03 * z + 0.02;
	vec2 p = vUv * uHalf - 0.5, f = fract( p ), t = 1.0 / uHalf, b = ( floor( p ) + 0.5 ) * t;
	vec4 a0 = texture2D( tAO, b ), a1 = texture2D( tAO, b + vec2( t.x, 0.0 ) ), a2 = texture2D( tAO, b + vec2( 0.0, t.y ) ), a3 = texture2D( tAO, b + t );
	vec4 w = vec4( ( 1.0 - f.x ) * ( 1.0 - f.y ), f.x * ( 1.0 - f.y ), ( 1.0 - f.x ) * f.y, f.x * f.y );
	w *= exp( -abs( vec4( a0.g, a1.g, a2.g, a3.g ) - z ) / sg ) + 1e-4;
	gl_FragColor = vec4( vec3( dot( w, vec4( a0.r, a1.r, a2.r, a3.r ) ) / dot( w, vec4( 1.0 ) ) ), 1.0 );
}`, { tAO: { value: null }, tDepth: { value: null }, uHalf: { value: new T.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 100 } });

  // ---------------------------------------------------------------- bloom: exposure + soft threshold with a Karis average, 13-tap down, tent up
  const DOWN_FS = `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uExp; uniform vec2 uTh; varying vec2 vUv;
vec3 S( float x, float y ) { return texture2D( tSrc, vUv + vec2( x, y ) * uTexel ).rgb; }
float kw( vec3 c ) { return 1.0 / ( 1.0 + 0.25 * max( c.r, max( c.g, c.b ) ) ); }      // a gentle Karis weight: tames sparkles, keeps thin glows
void main() {
	vec3 a = S( -2.0, 2.0 ), b = S( 0.0, 2.0 ), c = S( 2.0, 2.0 ), d = S( -2.0, 0.0 ), e = S( 0.0, 0.0 ), f = S( 2.0, 0.0 ), g = S( -2.0, -2.0 ), h = S( 0.0, -2.0 ), i = S( 2.0, -2.0 );
	vec3 j = S( -1.0, 1.0 ), k = S( 1.0, 1.0 ), l = S( -1.0, -1.0 ), m = S( 1.0, -1.0 );
	#ifdef PREFILTER
	vec3 b0 = ( j + k + l + m ) * 0.25 * uExp, b1 = ( a + b + d + e ) * 0.25 * uExp, b2 = ( b + c + e + f ) * 0.25 * uExp, b3 = ( d + e + g + h ) * 0.25 * uExp, b4 = ( e + f + h + i ) * 0.25 * uExp;
	float w0 = kw( b0 ) * 0.5, w1 = kw( b1 ) * 0.125, w2 = kw( b2 ) * 0.125, w3 = kw( b3 ) * 0.125, w4 = kw( b4 ) * 0.125;
	vec3 col = ( b0 * w0 + b1 * w1 + b2 * w2 + b3 * w3 + b4 * w4 ) / ( w0 + w1 + w2 + w3 + w4 );
	float br = max( col.r, max( col.g, col.b ) ), rq = clamp( br - uTh.x + uTh.y, 0.0, 2.0 * uTh.y );
	rq = rq * rq / ( 4.0 * uTh.y + 1e-5 );
	col *= max( rq, br - uTh.x ) / max( br, 1e-5 );
	#else
	vec3 col = e * 0.125 + ( a + c + g + i ) * 0.03125 + ( b + d + f + h ) * 0.0625 + ( j + k + l + m ) * 0.125;
	#endif
	gl_FragColor = vec4( min( col, vec3( 6e4 ) ), 1.0 );
}`;
  const bloomU = () => ({ tSrc: { value: null }, uTexel: { value: new T.Vector2() }, uExp: { value: 1 }, uTh: { value: new T.Vector2() } });
  const preMat = passMat(DOWN_FS, bloomU(), { PREFILTER: 1 }), downMat = passMat(DOWN_FS, bloomU());
  const upMat = passMat(`
uniform sampler2D tLow, tHigh; uniform vec2 uTexel; uniform float uR; varying vec2 vUv;
vec3 L( float x, float y ) { return texture2D( tLow, vUv + vec2( x, y ) * uTexel ).rgb; }
void main() {
	vec3 t = ( L( -1.0, -1.0 ) + L( 1.0, -1.0 ) + L( -1.0, 1.0 ) + L( 1.0, 1.0 ) + 2.0 * ( L( 0.0, -1.0 ) + L( 0.0, 1.0 ) + L( -1.0, 0.0 ) + L( 1.0, 0.0 ) ) + 4.0 * L( 0.0, 0.0 ) ) / 16.0;
	gl_FragColor = vec4( texture2D( tHigh, vUv ).rgb + t * uR, 1.0 );
}`, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new T.Vector2() }, uR: { value: 0.8 } });

  // ---------------------------------------------------------------- final: AO on the ambient share, bloom, ACES (as three's), grade, vignette, grain, sRGB
  const finalMat = passMat(`
uniform sampler2D tHDR, tAO, tBloom; uniform vec2 uRes; uniform float uExp, uBloom, uAOK, uAOD, uAOOn, uVig, uGrain, uTime, uSat, uCon, uSplit, uDebug;
uniform vec3 uLift, uGamma, uGain, uSplitS, uSplitH;
varying vec2 vUv;
vec3 RRTAndODTFit( vec3 v ) { vec3 a = v * ( v + 0.0245786 ) - 0.000090537; vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081; return a / b; }
vec3 aces( vec3 c ) {
	const mat3 I = mat3( vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 ) );
	const mat3 O = mat3( vec3( 1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 ) );
	return clamp( O * RRTAndODTFit( I * ( c / 0.6 ) ), 0.0, 1.0 );
}
vec3 srgb( vec3 c ) { return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( vec3( 0.0031308 ), c ) ); }
float hash( vec2 p ) { vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
void main() {
	vec4 h = texture2D( tHDR, vUv ); vec3 c = h.rgb;
	float ao = uAOOn > 0.5 ? mix( 1.0, texture2D( tAO, vUv ).r, uAOK ) : 1.0;
	float share = mix( clamp( h.a, 0.0, 1.0 ), 1.0, uAOD );
	c *= 1.0 - share * ( 1.0 - ao );
	vec3 bl = texture2D( tBloom, vUv ).rgb * uBloom;
	if ( uDebug > 0.5 ) { gl_FragColor = vec4( uDebug < 1.5 ? vec3( ao ) : uDebug < 2.5 ? vec3( h.a ) : srgb( aces( bl ) ), 1.0 ); return; }
	c = aces( c * uExp + bl );
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	c = max( mix( vec3( l ), c, uSat ), 0.0 );
	c = 0.18 * pow( c / 0.18, vec3( uCon ) );
	c *= mix( vec3( 1.0 ), mix( uSplitS, uSplitH, smoothstep( 0.02, 0.5, l ) ), uSplit );
	c = uGain * ( c + uLift * ( 1.0 - c ) );
	c = pow( clamp( c, 0.0, 1.0 ), 1.0 / uGamma );
	vec2 q = ( vUv - 0.5 ) * vec2( uRes.x / uRes.y, 1.0 ); float r = dot( q, q ) / ( 0.25 * ( uRes.x * uRes.x / ( uRes.y * uRes.y ) ) + 0.25 );
	c *= 1.0 - uVig * r * r * ( 3.0 - 2.0 * r );
	c = srgb( c );
	float n = hash( vUv * uRes + fract( uTime * 7.31 ) * 917.0 ) + hash( vUv * uRes * 1.37 + fract( uTime * 3.17 ) * 491.0 ) - 1.0;
	c += n * ( uGrain * ( 0.35 + 0.65 * ( 1.0 - abs( dot( c, vec3( 0.333 ) ) * 2.0 - 1.0 ) ) ) + 1.0 / 255.0 );
	gl_FragColor = vec4( c, 1.0 );
}`, { tHDR: { value: null }, tAO: { value: null }, tBloom: { value: null }, uRes: { value: new T.Vector2() }, uExp: { value: 1 }, uBloom: { value: 0 },
    uAOK: { value: 1 }, uAOD: { value: 0 }, uAOOn: { value: 0 }, uVig: { value: 0 }, uGrain: { value: 0 }, uTime: { value: 0 }, uSat: { value: 1 }, uCon: { value: 1 },
    uSplit: { value: 0 }, uDebug: { value: 0 }, uLift: { value: v3() }, uGamma: { value: v3() }, uGain: { value: v3() }, uSplitS: { value: v3() }, uSplitH: { value: v3() } });
  const blackTex = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blackTex.needsUpdate = true;

  // ---------------------------------------------------------------- the frame
  const vmCam = new T.PerspectiveCamera(S.vmFov, 1, S.vmNear, 50); vmCam.layers.set(1);
  const _cc = new T.Color(), ST = { calls: 0, triangles: 0, worldCalls: 0, vmCalls: 0, postCalls: 0, ms: 0, msAvg: 0, envMs: 0, envFrames: 0 };
  let time = 0, hasVM = false;
  function prepare(scene) {
    hasVM = false;
    scene.traverse(o => {
      if (o === skyQuad) return;
      if (o.isLight) { o.layers.enable(1); return; }       // the viewmodel pass only sees lights on its layer
      if (!(o.isMesh || o.isPoints)) return;
      if (o.layers.mask & 2 && o.visible) hasVM = true;
      if (Array.isArray(o.material)) o.material.forEach(patch); else patch(o.material);
    });
  }
  function applyUniforms(camera) {
    const f = U.vgFogP.value;
    f.set(S.fog ? S.fogDensity : 0, S.fogFalloff, S.fogBase, S.fogStart); U.vgFogQ.value.set(S.fogMax, S.fogSunPow);
    if (S.fogColor != null) lin(S.fogColor, U.vgFogCol.value); else U.vgFogCol.value.copy(skyU.uHor.value).multiplyScalar(SKY.intensity * 0.85);
    if (S.fogSun != null) lin(S.fogSun, U.vgFogSunCol.value); else U.vgFogSunCol.value.copy(skyU.uGlowCol.value).multiplyScalar(0.6 * SKY.glow * SKY.intensity);
    U.vgEnvI.value = S.envIntensity; U.vgSoft.value = Q.pcf; U.vgNoAO.value = 0;
    skyU.uFogSky.value = S.fog ? S.fogSky : 0;
    skyU.uEye.value.setFromMatrixPosition(camera.matrixWorld);
    skyU.uInvProj.value.copy(camera.projectionMatrixInverse); skyU.uCamWorld.value.copy(camera.matrixWorld);
  }
  function render(scene, camera, dt) {
    const t0 = performance.now(); dt = dt || 0; time += dt;
    if (!hdr) buildTargets();
    const st = { enc: renderer.outputEncoding, tm: renderer.toneMapping, pcl: renderer.physicallyCorrectLights, ac: renderer.autoClear, smt: renderer.shadowMap.type,
      sme: renderer.shadowMap.enabled, sma: renderer.shadowMap.autoUpdate, iar: renderer.info.autoReset, bg: scene.background, env: scene.environment,
      layers: camera.layers.mask, ca: renderer.getClearAlpha() };
    renderer.getClearColor(_cc);
    renderer.outputEncoding = T.LinearEncoding; renderer.toneMapping = T.NoToneMapping; renderer.physicallyCorrectLights = true;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.info.autoReset = false; renderer.info.reset();
    if (opts.addSun !== false && !sun.parent) scene.add(sun, sun.target);
    camera.updateMatrixWorld();
    prepare(scene); applySky(); updateSun(); applyUniforms(camera);
    if (S.ibl) {
      const eyeY = Math.round(skyU.uEye.value.y), sig = JSON.stringify([SKY, S.fog && [S.fogDensity, S.fogFalloff, S.fogBase, S.fogColor, S.fogSun, S.fogSky], eyeY]);
      if (sig !== envSig || !envRT) { envSig = sig; const e0 = performance.now(); regenEnv(eyeY); ST.envMs = performance.now() - e0; ST.envFrames++; renderer.info.reset(); }
      scene.environment = envRT.texture;
    }
    // 1. the world, with the sky behind it
    renderer.setRenderTarget(hdr); renderer.setClearColor(0x000000, 0); renderer.clear(true, true, false); renderer.autoClear = false;
    if (S.sky) { scene.background = null; scene.add(skyQuad); }
    camera.layers.disable(1); renderer.shadowMap.autoUpdate = true;
    renderer.render(scene, camera);
    camera.layers.mask = st.layers; if (S.sky) scene.remove(skyQuad);
    ST.worldCalls = renderer.info.render.calls;
    // 2. AO from the world's depth (before the viewmodel overwrites it)
    const aoOn = Q.ssao && S.ssao && S.ssaoStrength > 0;
    if (aoOn) {
      const u = ssaoMat.uniforms;
      if (ssaoMat.defines.N !== Q.ssaoN) { ssaoMat.defines.N = Q.ssaoN; ssaoMat.needsUpdate = true; }
      u.tDepth.value = hdr.depthTexture; u.uFull.value.set(W, H); u.uProj.value.copy(camera.projectionMatrix); u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uNear.value = upAOMat.uniforms.uNear.value = camera.near; u.uFar.value = upAOMat.uniforms.uFar.value = camera.far;
      u.uRadius.value = S.ssaoRadius; u.uBias.value = S.ssaoBias; u.uPower.value = S.ssaoPower; u.uMaxD.value = S.ssaoMaxDist;
      run(ssaoMat, aoA);
      blurMat.uniforms.tAO.value = aoA.texture; blurMat.uniforms.uDir.value.set(1 / aoA.width, 0); run(blurMat, aoB);
      blurMat.uniforms.tAO.value = aoB.texture; blurMat.uniforms.uDir.value.set(0, 1 / aoA.height); run(blurMat, aoA);
      upAOMat.uniforms.tAO.value = aoA.texture; upAOMat.uniforms.tDepth.value = hdr.depthTexture; upAOMat.uniforms.uHalf.value.set(aoA.width, aoA.height);
      run(upAOMat, aoFull);
    }
    // 3. the viewmodel: depth cleared, its own FOV, the same lights and the shadow map already drawn
    const c0 = renderer.info.render.calls;
    if (hasVM) {
      camera.matrixWorld.decompose(vmCam.position, vmCam.quaternion, vmCam.scale);
      if (vmCam.fov !== S.vmFov || vmCam.aspect !== camera.aspect || vmCam.near !== S.vmNear) { vmCam.fov = S.vmFov; vmCam.aspect = camera.aspect; vmCam.near = S.vmNear; vmCam.updateProjectionMatrix(); }
      renderer.setRenderTarget(hdr); renderer.clearDepth();
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; U.vgNoAO.value = 1;
      const bg = scene.background; scene.background = null;
      renderer.render(scene, vmCam);
      scene.background = bg; U.vgNoAO.value = 0;
    }
    ST.vmCalls = renderer.info.render.calls - c0;
    // 4. bloom
    const bloomOn = S.bloom && S.bloomStrength > 0;
    let bloomTex = blackTex, norm = 1;
    if (bloomOn) {
      const n = B.length, pu = preMat.uniforms;
      pu.tSrc.value = hdr.texture; pu.uTexel.value.set(1 / W, 1 / H); pu.uExp.value = S.exposure; pu.uTh.value.set(S.bloomThreshold, Math.max(1e-3, S.bloomKnee * S.bloomThreshold));
      run(preMat, B[0]);
      for (let i = 1; i < n; i++) { downMat.uniforms.tSrc.value = B[i - 1].texture; downMat.uniforms.uTexel.value.set(1 / B[i - 1].width, 1 / B[i - 1].height); run(downMat, B[i]); }
      let low = B[n - 1]; norm = 1;
      for (let i = n - 2; i >= 0; i--) {
        const u = upMat.uniforms; u.tLow.value = low.texture; u.tHigh.value = B[i].texture; u.uTexel.value.set(1 / low.width, 1 / low.height); u.uR.value = S.bloomRadius;
        run(upMat, UP[i]); low = UP[i]; norm = 1 + S.bloomRadius * norm;
      }
      bloomTex = low.texture;
    }
    // 5. to the screen
    const f = finalMat.uniforms;
    f.tHDR.value = hdr.texture; f.tAO.value = aoOn ? aoFull.texture : blackTex; f.tBloom.value = bloomTex; f.uRes.value.set(W, H);
    f.uExp.value = S.exposure; f.uBloom.value = bloomOn ? S.bloomStrength / norm : 0; f.uAOK.value = S.ssaoStrength; f.uAOD.value = S.ssaoDirect; f.uAOOn.value = aoOn ? 1 : 0;
    f.uVig.value = S.vignette; f.uGrain.value = S.grain; f.uTime.value = time; f.uSat.value = S.saturation; f.uCon.value = S.contrast; f.uSplit.value = S.split;
    f.uDebug.value = { ao: 1, ambient: 2, bloom: 3 }[S.debug] || 0;
    lin(S.lift, f.uLift.value); lin(S.gamma, f.uGamma.value); lin(S.gain, f.uGain.value); lin(S.splitShadow, f.uSplitS.value); lin(S.splitHighlight, f.uSplitH.value);
    run(finalMat, opts.target || null);
    // restore what we changed, so other code (or the old renderer path) sees the renderer as it left it
    U.vgFogP.value.x = 0; U.vgSoft.value = 0; U.vgEnvI.value = 1;
    ST.calls = renderer.info.render.calls; ST.triangles = renderer.info.render.triangles; ST.postCalls = ST.calls - ST.worldCalls - ST.vmCalls;
    renderer.outputEncoding = st.enc; renderer.toneMapping = st.tm; renderer.physicallyCorrectLights = st.pcl; renderer.autoClear = st.ac;
    renderer.shadowMap.type = st.smt; renderer.shadowMap.enabled = st.sme; renderer.shadowMap.autoUpdate = st.sma; renderer.info.autoReset = st.iar;
    renderer.setClearColor(_cc, st.ca); scene.background = st.bg; scene.environment = st.env;
    ST.ms = performance.now() - t0; ST.msAvg = ST.msAvg ? ST.msAvg * 0.9 + ST.ms * 0.1 : ST.ms;
  }

  function setSize(w, h, pixelRatio) {
    PR = pixelRatio || PR; renderer.setPixelRatio(PR); renderer.setSize(w, h, false);
    W = Math.max(1, Math.floor(w * PR)); H = Math.max(1, Math.floor(h * PR));
    buildTargets();
  }
  function setQuality(q) {
    if (!QUAL[q]) return quality;
    const old = Q; Q = QUAL[q]; quality = q;
    if (old.msaa !== Q.msaa || old.bloomN !== Q.bloomN) buildTargets();
    return quality;
  }
  applySky();

  const rnd = {
    renderer, settings: S, sky: SKY, sun, vmCamera: vmCam, uniforms: U, fogGLSL: FOG_GLSL,
    render, setSize, setQuality, patch,
    get quality() { return quality; },
    get environment() { return envRT && envRT.texture; },
    setFocus(v) { focus.copy(v); },
    updateSky(p) { Object.assign(SKY, p || {}); applySky(); },     // the capture is redone on the next frame if anything changed
    viewmodel(obj) { obj.traverse(o => o.layers.set(1)); return obj; },
    stats() { return Object.assign({ programs: renderer.info.programs.length, size: [W, H], msaa: hdr && hdr.samples || 0, quality,
      textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries }, ST); },
    dispose() { for (const t of [hdr, aoA, aoB, aoFull, ...B, ...UP]) if (t) t.dispose(); if (envRT) envRT.dispose(); pmrem.dispose(); },
  };
  return rnd;
}
