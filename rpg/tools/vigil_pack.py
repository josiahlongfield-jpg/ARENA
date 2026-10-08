"""Pack the Vigil, the player's body, from a Tripo-rigged GLB into the JSON The Reach skins onto the Templar's own joints.

usage: python3 rpg/tools/vigil_pack.py rig.glb out.json
env:   H height in metres (1.95), TEX colour map size (4096), NTEX normal map size (2048), DARK albedo power, METAL, ROUGH,
       W0/W1 white glow thresholds, EMIT; GLOW=red finds red light instead (G0/G1 thresholds, GLOW_RGB its tint)

The game keeps the Templar's rig (IK arms, procedural legs, every pose) and only moves its joints to her proportions, so this
keeps no clips and no Tripo skeleton: it turns the mesh to face +Z (right side -X, feet at y = 0), folds Tripo's 41 joints
into the game's 17 (twist and spine bones into the limb or torso they belong to; a forearm twist joint stays, so a turned
wrist is shared along the forearm), and records where each game joint sits in her rest pose, her hand directions, eye and back.
"""
import base64, io, json, os, struct, sys
import numpy as np
from PIL import Image

b = open(sys.argv[1], 'rb').read()
n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n]); o = 20 + n + 8
def acc(i):
    a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]; off = o + v.get('byteOffset', 0) + a.get('byteOffset', 0)
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
    c = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    return np.frombuffer(b, dt, a['count'] * c, off).reshape(-1, c).copy()
def img(k):
    v = j['bufferViews'][j['images'][j['textures'][k]['source']]['bufferView']]; s = o + v.get('byteOffset', 0)
    return Image.open(io.BytesIO(b[s:s + v['byteLength']])).convert('RGB')
def qm(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
def local(nd):
    if 'matrix' in nd: return np.array(nd['matrix']).reshape(4, 4).T
    M = np.eye(4); M[:3, :3] = qm(nd.get('rotation', [0, 0, 0, 1])) * np.array(nd.get('scale', [1, 1, 1])); M[:3, 3] = nd.get('translation', [0, 0, 0]); return M
nodes = j['nodes']; WM = {}
def walk(i, M):
    WM[i] = M @ local(nodes[i])
    for c in nodes[i].get('children', []): walk(c, WM[i])
for r in j['scenes'][0]['nodes']: walk(r, np.eye(4))

skin = j['skins'][0]; tj = skin['joints']; IBM = acc(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
pr = j['meshes'][0]['primitives'][0]; at = pr['attributes']
P0, N0, UV = acc(at['POSITION']).astype(np.float64), acc(at['NORMAL']).astype(np.float64), acc(at['TEXCOORD_0'])
J4, W4 = acc(at['JOINTS_0']).astype(int), acc(at['WEIGHTS_0']).astype(np.float64)
I = acc(pr['indices']).ravel()
# the rest pose is the bind pose here (Tripo's joints times their inverse binds are the identity), so the rest mesh is skin-weighted
# through the joints, which also takes in any transform on the mesh's own node
SKM = np.stack([WM[jj] @ IBM[k] for k, jj in enumerate(tj)])
M4 = np.einsum('vk,vkij->vij', W4, SKM[J4])
P = np.einsum('vij,vj->vi', M4[:, :3, :3], P0) + M4[:, :3, 3]; N = np.einsum('vij,vj->vi', M4[:, :3, :3], N0)

# ---------------------------------------------------------------- Tripo's figure faces +X with her left at -Z: turn her to face +Z (left at +X)
turn = lambda p: np.c_[-p[..., 2], p[..., 1], p[..., 0]]
P, N = turn(P), turn(N)
names = [nodes[jj]['name'] for jj in tj]
JP = {nm: turn(WM[jj][:3, 3][None])[0] for nm, jj in zip(names, tj)}
H = float(os.environ.get('H', 1.95)); s = H / np.ptp(P[:, 1]); y0 = P[:, 1].min(); c = JP['Hip'].copy()
fit = lambda p: (p - [c[0], y0, c[2]]) * s
P = fit(P); JP = {k: fit(v) for k, v in JP.items()}
assert JP['L_Upperarm'][0] > 0 > JP['R_Upperarm'][0], 'her left arm should be at +X'
print('height', round(float(np.ptp(P[:, 1])), 3), 'bounds', P.min(0).round(3), P.max(0).round(3))

# ---------------------------------------------------------------- Tripo's joints folded into the game's
GAME = ['pelvis', 'waist', 'head', 'shL', 'elL', 'twL', 'hdL', 'shR', 'elR', 'twR', 'hdR', 'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR']
def game_of(nm):
    if nm in ('Root', 'Hip', 'Pelvis'): return 'pelvis'
    if nm in ('Waist', 'Spine01', 'Spine02', 'NeckTwist01', 'NeckTwist02') or nm.endswith('Clavicle'): return 'waist'
    if nm == 'Head': return 'head'
    sd = nm[0]; part = nm[2:]
    return {'Upperarm': 'sh', 'UpperarmTwist01': 'sh', 'UpperarmTwist02': 'sh', 'Forearm': 'el', 'ForearmTwist01': 'el', 'ForearmTwist02': 'tw', 'Hand': 'hd',
            'Thigh': 'hip', 'ThighTwist01': 'hip', 'ThighTwist02': 'hip', 'Calf': 'knee', 'CalfTwist01': 'knee', 'CalfTwist02': 'knee',
            'Foot': 'ankle', 'ToeBase': 'ankle'}[part] + sd
gi = np.array([GAME.index(game_of(nm)) for nm in names])
WG = np.zeros((len(P), len(GAME)))
np.add.at(WG, (np.repeat(np.arange(len(P)), 4), gi[J4].ravel()), W4.ravel())
top = np.argsort(-WG, 1)[:, :4]; tw = np.take_along_axis(WG, top, 1); tw /= tw.sum(1, keepdims=True)
W8 = np.round(tw * 255); W8[:, 0] += 255 - W8.sum(1)
print('main joint shares', {g: round(float((top[:, 0] == k).mean()), 3) for k, g in enumerate(GAME)})

# where each game joint sits in her rest pose
src = dict(pelvis='Hip', waist='Spine01', head='Head', shL='L_Upperarm', elL='L_Forearm', twL='L_ForearmTwist02', hdL='L_Hand', shR='R_Upperarm', elR='R_Forearm',
           twR='R_ForearmTwist02', hdR='R_Hand', hipL='L_Thigh', kneeL='L_Calf', ankleL='L_Foot', hipR='R_Thigh', kneeR='R_Calf', ankleR='R_Foot')
AT = {g: JP[t].round(5).tolist() for g, t in src.items()}
# each hand points from the wrist to the middle of the hand's own vertices
hand = {}
for sd in 'LR':
    k = GAME.index('hd' + sd); m = WG[:, k] > 0.6; d = P[m].mean(0) - JP[sd + '_Hand']; hand[sd] = (d / np.linalg.norm(d)).round(4).tolist()

# ---------------------------------------------------------------- maps: Tripo's colour and metal/roughness, the white lights pulled out as emission
mt = j['materials'][pr['material']]; TEX, NT = int(os.environ.get('TEX', 4096)), int(os.environ.get('NTEX', 2048))
C = np.asarray(img(mt['pbrMetallicRoughness']['baseColorTexture']['index']).resize((TEX, TEX), Image.LANCZOS)).astype(np.float32) / 255
MR = np.asarray(img(mt['pbrMetallicRoughness']['metallicRoughnessTexture']['index']).resize((TEX, TEX), Image.LANCZOS)).astype(np.float32) / 255
NM = img(mt['normalTexture']['index'])
ss = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))
mx_, mn_ = C.max(-1), C.min(-1)
if os.environ.get('GLOW') == 'red':      # red lights (veins, ribs, eyes): red that outshines the rest, found as step3/tripo_pack.py finds it
    glow = ss(float(os.environ.get('G0', 0.15)), float(os.environ.get('G1', 0.45)), C[..., 0] - np.maximum(C[..., 1], C[..., 2])) * ss(0.3, 0.7, C[..., 0])
    tint, under = np.array([float(x) for x in os.environ.get('GLOW_RGB', '1.25,0.22,0.16').split(',')]), np.array([0.12, 0.015, 0.01])
else:                                    # white lights (the Vigil's visor, ear discs and lamps)
    glow = ss(float(os.environ.get('W0', 0.62)), float(os.environ.get('W1', 0.85)), mx_) * (1 - ss(0.12, 0.3, (mx_ - mn_) / (mx_ + 1e-4)))
    tint, under = np.array([0.9, 0.95, 1.05]), np.array([0.5, 0.52, 0.55])
E = glow[..., None] ** 1.5 * np.clip(C * tint, 0, 1) * float(os.environ.get('EMIT', 1.6))
A = np.power(C, float(os.environ.get('DARK', 1.2))) * (1 - glow[..., None] * 0.6) + glow[..., None] * under * 0.6
rough = np.clip(MR[..., 1] + float(os.environ.get('ROUGH', 0.1)), 0.2, 1); metal = np.clip(MR[..., 2] * float(os.environ.get('METAL', 0.5)) * (1 - glow), 0, 1)
q = lambda a: Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
def webp(im, qq, size):
    if im.size[0] != size: im = im.resize((size, size), Image.LANCZOS)
    o_ = io.BytesIO(); im.save(o_, 'WEBP', quality=qq, method=6); return 'data:image/webp;base64,' + base64.b64encode(o_.getvalue()).decode()
tex = dict(color=webp(q(A), 88, TEX), normal=webp(NM, 88, NT), orm=webp(q(np.stack([np.ones_like(rough), rough, metal], -1)), 85, NT // 2), emis=webp(q(E), 85, NT // 2))

# the visor: lit vertices above the neck give the eye height; the back plate's surface at chest height places the jump pack
vg = glow[np.clip((UV[:, 1] * TEX).astype(int), 0, TEX - 1), np.clip((UV[:, 0] * TEX).astype(int), 0, TEX - 1)]
vis = (vg > 0.5) & (P[:, 1] > AT['head'][1]) & (P[:, 2] > AT['head'][2])
eye = [round(float(P[vis, 1].mean()), 4), round(float(P[vis, 2].max()), 4)] if vis.sum() > 20 else [round(AT['head'][1] + 0.1, 4), 0.1]
band = (np.abs(P[:, 0]) < 0.08) & (np.abs(P[:, 1] - (AT['shL'][1] - 0.18)) < 0.05)
back = [round(AT['shL'][1] - 0.18, 4), round(float(P[band, 2].min()), 4)]
print('eye (visor height, front)', eye, 'back plate', back, 'hands', hand)

b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
N8 = np.round(N / np.linalg.norm(N, axis=1, keepdims=True) * 127).astype(np.int8)
UV16 = np.round(np.clip(UV, 0, 1) * 65535).astype(np.uint16)
Iq = I.astype(np.uint16 if len(P) < 65536 else np.uint32)
geo = dict(n=len(P), pos=b64(P.astype(np.float32)), nrm=b64(N8), uv=b64(UV16), ji=b64(top.astype(np.uint8)), jw=b64(W8.astype(np.uint8)), idx=b64(Iq), i32=Iq.dtype == np.uint32)
out = dict(geo=geo, joints=GAME, at=AT, hand=hand, eye=eye, back=back, height=round(float(np.ptp(P[:, 1])), 4), tex=tex)
st = json.dumps(out, separators=(',', ':')); open(sys.argv[2], 'w').write(st)
print(f'{sys.argv[2]}: {len(st) / 1e6:.2f} MB (tex {sum(len(v) for v in tex.values()) / 1e6:.2f} MB), {len(P)} verts, {len(I) // 3} tris, glow {glow.mean():.4f}')
