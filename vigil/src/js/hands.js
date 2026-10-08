// ==================================================================== her hands
// Shared by the game and the character room (rpg/build.py splices this file into the room), so both draw the same hands.
// Two kinds, by what the pack holds:
// - sculpted (vigil/tools/hand_sculpt.py): Tripo's model of the user's glove design, skinned to the hand, the forearm's twist joint and
//   the finger joints (four joints a vertex), with its own maps, drawn as her body is drawn;
// - modelled (vigil/tools/gauntlet.py): every vertex rigid on one joint (j), a byte saying how far onto a plate's worn rim it is (wear),
//   triangles grouped by material, drawn by handMat below. No glow on the hands either way.
function handsGeo(h) {
  const geo = new THREE.BufferGeometry(), u = new Uint16Array(bytes(h.pos).buffer), p = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) p[i] = h.lo[i % 3] + u[i] * h.sc[i % 3];
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bytes(h.nrm).buffer), 3, true));
  if (h.ji) { geo.setAttribute('skinIndex', new THREE.BufferAttribute(bytes(h.ji), 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(bytes(h.jw), 4, true)); }
  else {
    const j = bytes(h.j), ji = new Uint8Array(h.n * 4), jw = new Uint8Array(h.n * 4);
    for (let i = 0; i < h.n; i++) { ji[i * 4] = j[i]; jw[i * 4] = 255; }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(ji, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(jw, 4, true));
  }
  if (h.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(bytes(h.uv).buffer), 2, true));
  geo.setAttribute('wear', new THREE.BufferAttribute(h.wear ? bytes(h.wear) : new Uint8Array(h.n), 1, true));
  geo.setIndex(new THREE.BufferAttribute(h.i32 ? new Uint32Array(bytes(h.idx).buffer) : new Uint16Array(bytes(h.idx).buffer), 1));
  for (const [start, count, m] of h.groups) geo.addGroup(start, count, m);
  return geo;
}
// o: { grain (albedo mottling), bump (grain height, metres), scale (grain per mm), wear (rim colour, sRGB), key }
function handMat(color, roughness, metalness, o) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).convertSRGBToLinear(), roughness, metalness, skinning: true });
  const wearCol = new THREE.Color(o.wear || 0x000000).convertSRGBToLinear();
  m.onBeforeCompile = sh => {
    sh.uniforms.uWearCol = { value: wearCol };
    sh.vertexShader = 'attribute float wear;\nvarying float vWear;\nvarying vec3 vRest;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n\tvWear = wear; vRest = position * 1000.0;');      // rest space in mm: every part is rigid, so the grain stays on it
    sh.fragmentShader = `varying float vWear;
varying vec3 vRest;
uniform vec3 uWearCol;
float vgH( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
float vgN( vec3 p ) {
	vec3 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( vgH( i ), vgH( i + vec3( 1, 0, 0 ) ), f.x ), mix( vgH( i + vec3( 0, 1, 0 ) ), vgH( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( vgH( i + vec3( 0, 0, 1 ) ), vgH( i + vec3( 1, 0, 1 ) ), f.x ), mix( vgH( i + vec3( 0, 1, 1 ) ), vgH( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
` + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
	float vgG = vgN( vRest * ${(0.35 * (o.scale || 1)).toFixed(3)} ) * 0.55 + vgN( vRest * ${(1.6 * (o.scale || 1)).toFixed(3)} ) * 0.45;
	float vgW = clamp( smoothstep( 0.12, 0.85, vWear ) * ( 0.55 + 0.9 * vgN( vRest * 0.9 + 17.0 ) ), 0.0, 1.0 );
	diffuseColor.rgb *= 1.0 + ${(o.grain || 0).toFixed(3)} * ( vgG - 0.5 );
	diffuseColor.rgb = mix( diffuseColor.rgb, uWearCol, vgW );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
	roughnessFactor = clamp( roughnessFactor + ( vgG - 0.5 ) * 0.12 - vgW * 0.28, 0.05, 1.0 );`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
	metalnessFactor = clamp( metalnessFactor + vgW * 0.3, 0.0, 1.0 );`)
      // the grain as a bump: three's perturbNormalArb, with the noise for the height
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	{ float vgB = vgN( vRest * ${(2.2 * (o.scale || 1)).toFixed(3)} ) * 0.6 + vgN( vRest * ${(5.5 * (o.scale || 1)).toFixed(3)} ) * 0.4;
	  vec3 vgX = dFdx( -vViewPosition ), vgY = dFdy( -vViewPosition ), vgR1 = cross( vgY, normal ), vgR2 = cross( normal, vgX );
	  float vgD = dot( vgX, vgR1 ); vec2 vgDH = ${(o.bump || 0).toExponential(3)} * vec2( dFdx( vgB ), dFdy( vgB ) );
	  normal = normalize( abs( vgD ) * normal - sign( vgD ) * ( vgDH.x * vgR1 + vgDH.y * vgR2 ) ); }`);
  };
  m.customProgramCacheKey = () => 'vgHand' + (o.key || '');
  return m;
}
// the materials for a pack's hands: the sculpt's own maps (as her body's: Tripo's normal map with green flipped, roughness and metal from
// one map), or for modelled hands, the glove like the sculpt's glove (matte black, a pebbled leather grain) and the plates like her
// forearm plates (satin grey, worn light at the rims)
function handMats(h, anis) {
  if (h && h.tex) {
    const tl = new THREE.TextureLoader(), tex = (k, srgb) => { const t = tl.load(h.tex[k]); t.flipY = false; if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = anis || 8; return t; };
    const orm = tex('orm');
    return [new THREE.MeshStandardMaterial({ map: tex('color', true), normalMap: tex('normal'), normalScale: new THREE.Vector2(1, -1), roughnessMap: orm, metalnessMap: orm, skinning: true })];
  }
  return [
    handMat(0x0e0e0f, 0.84, 0.2, { grain: 0.5, bump: 0.00022, scale: 1.0, key: 'g' }),
    handMat(0x2d2d2f, 0.74, 0.48, { grain: 0.35, bump: 0.00004, scale: 0.6, wear: 0x5f5f63, key: 'p' })];
}
