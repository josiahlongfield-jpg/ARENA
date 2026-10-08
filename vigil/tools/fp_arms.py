"""First-person arms for Vigil: the four-view Vigil's arms at the sculpt's full 150k detail, skinned to the game's arm joints, with
finger joints of our own so her hands can close round the rifle. (Tripo's rig stops at the wrist: one bone per hand.)

usage: python3 vigil/tools/fp_arms.py rig.glb hi.glb out.json
  rig.glb  Tripo's rig of the 60k bake (her joints and skin weights; vp_rig.glb)
  hi.glb   Tripo's 150k bake of the same model (vn4_150k.glb), in the same frame but centred on y = 0
env: H height (1.95, as vigil_pack.py), TEX (4096), NTEX (2048)

Both meshes get vigil_pack.py's turn and fit (face +Z, left at +X, feet at y = 0, H tall, centred on the hips), so the joint
positions it records (vigil_rig.json `at`) hold here too. Each high-res vertex takes its weights from the nearest rig vertices.
Fingers: hands.py places three joints per finger from the knuckles marked in vigil_hands.json and splits the hand's weight
among them; each joint has a flex axis (a positive turn curls the finger toward the palm; the thumb closes across it).
"""
import base64, io, json, os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbio import load, world, static_mesh
from hands import build_hand

RIG, HI, OUT = sys.argv[1:4]
H = float(os.environ.get('H', 1.95))

# ---------------------------------------------------------------- the rig's rest mesh and joints, turned and fitted as vigil_pack.py does
j, acc, img = load(RIG); WM = world(j); nodes = j['nodes']
skin = j['skins'][0]; tj = skin['joints']; IBM = acc(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
pr = j['meshes'][0]['primitives'][0]; at = pr['attributes']
P0 = acc(at['POSITION']).astype(float); J4 = acc(at['JOINTS_0']).astype(int); W4 = acc(at['WEIGHTS_0']).astype(float)
SKM = np.stack([WM[jj] @ IBM[k] for k, jj in enumerate(tj)]); M4 = np.einsum('vk,vkij->vij', W4, SKM[J4])
PR = np.einsum('vij,vj->vi', M4[:, :3, :3], P0) + M4[:, :3, 3]
turn = lambda p: np.c_[-p[..., 2], p[..., 1], p[..., 0]]
names = [nodes[jj]['name'] for jj in tj]
JP = {nm: turn(WM[jj][:3, 3][None])[0] for nm, jj in zip(names, tj)}
PRt = turn(PR); s = H / np.ptp(PRt[:, 1]); y0 = PRt[:, 1].min(); c = JP['Hip'].copy()
fit = lambda p: (p - [c[0], y0, c[2]]) * s
PRt = fit(PRt); JP = {k: fit(v) for k, v in JP.items()}
ARM = ['shL', 'elL', 'twL', 'hdL', 'shR', 'elR', 'twR', 'hdR']
def game_of(nm):
    sd = nm[0]; part = nm[2:]
    m = {'Upperarm': 'sh', 'UpperarmTwist01': 'sh', 'UpperarmTwist02': 'sh', 'Forearm': 'el', 'ForearmTwist01': 'el', 'ForearmTwist02': 'tw', 'Hand': 'hd'}
    return m[part] + sd if nm[1] == '_' and part in m else None
gi = np.array([ARM.index(game_of(nm)) if game_of(nm) else -1 for nm in names])
WR = np.zeros((len(PRt), len(ARM) + 1))           # last column: everything that isn't an arm
np.add.at(WR, (np.repeat(np.arange(len(PRt)), 4), np.where(gi[J4] >= 0, gi[J4], len(ARM)).ravel()), W4.ravel())
src = dict(shL='L_Upperarm', elL='L_Forearm', twL='L_ForearmTwist02', hdL='L_Hand', shR='R_Upperarm', elR='R_Forearm', twR='R_ForearmTwist02', hdR='R_Hand')
AT = {g: JP[t] for g, t in src.items()}

# ---------------------------------------------------------------- the 150k mesh in the same frame, weights from its nearest rig vertices
S = static_mesh(HI); PH = S['P'] + [0, 0.5, 0]; NH = S['N']
PH = fit(turn(PH)); NH = turn(NH); NH /= np.linalg.norm(NH, axis=1, keepdims=True)
armR = WR[:, :len(ARM)].sum(1) > 0.02            # rig vertices with any arm weight, and the hi vertices near them
lo, hi_ = PRt[armR].min(0) - 0.03, PRt[armR].max(0) + 0.03
cand = np.where(((PH > lo) & (PH < hi_)).all(1))[0]
RP = PRt; WH = np.zeros((len(PH), len(ARM) + 1)); WH[:, -1] = 1
for a in range(0, len(cand), 2000):
    ids = cand[a:a + 2000]; d2 = ((PH[ids, None, :] - RP[None, :, :]) ** 2).sum(-1)
    nn = np.argpartition(d2, 4, 1)[:, :4]; dd = np.sqrt(np.take_along_axis(d2, nn, 1)) + 1e-4; w = 1 / dd; w /= w.sum(1, keepdims=True)
    WH[ids] = np.einsum('vk,vkj->vj', w, WR[nn])
    if a == 0: print('nearest rig vertex distance (median mm):', round(float(np.median(dd[:, 0])) * 1000, 2))
dom = WH.argmax(1); keepV = dom < len(ARM)
I = S['I'].reshape(-1, 3); keepT = keepV[I].all(1); I = I[keepT]
used = np.unique(I); remap = -np.ones(len(PH), int); remap[used] = np.arange(len(used))
P, N, UV, W = PH[used], NH[used], S['UV'][used], WH[used, :len(ARM)]; I = remap[I]
W /= np.maximum(W.sum(1, keepdims=True), 1e-6)
print('arm mesh', len(P), 'verts', len(I), 'tris')

# ---------------------------------------------------------------- fingers (see hands.py): three joints each, from the marked knuckles
FN = ['thumb', 'index', 'middle', 'ring', 'little']
HJ = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vigil_hands.json')))
joints, parents, axes, names_out, tips = [], [], [], [], {}
WF = []                                                 # (vertex, hand joint, first finger joint, weights for its 3 joints)
info = {}
for sd in 'LR':
    k = ARM.index('hd' + sd); H_ = build_hand(P, I, W[:, k] > 0.5, HJ[sd])
    fr = H_['frame']; info[sd] = dict(u=fr['u'].tolist(), palm=fr['palm'].tolist())
    for fi, f in enumerate(FN):
        base_j = len(ARM) + len(joints)
        for kj in range(3):
            joints.append(H_['joints'][f][kj]); parents.append(k if kj == 0 else base_j + kj - 1)
            axes.append(H_['axes'][f]); names_out.append(f'{f}{kj + 1}{sd}')
        tips[f + sd] = H_['joints'][f][3]
        for v, ws in zip(H_['hv'], H_['Wf'][:, fi]):
            if ws.sum() > 1e-4: WF.append((v, k, base_j, ws))
    print(sd, 'finger joints placed; hand vertices', len(H_['hv']))

# ---------------------------------------------------------------- final skin: 8 arm joints + 30 finger joints, top 4 per vertex
NJ = len(ARM) + len(joints); WA = np.zeros((len(P), NJ)); WA[:, :len(ARM)] = W
HW = WA[:, :len(ARM)].copy()                           # each finger's share comes out of the vertex's hand weight
for v, k, base_j, ws in WF:
    WA[v, k] -= HW[v, k] * ws.sum(); WA[v, base_j:base_j + 3] += HW[v, k] * ws
top = np.argsort(-WA, 1)[:, :4]; tw = np.take_along_axis(WA, top, 1); tw /= tw.sum(1, keepdims=True)
W8 = np.round(tw * 255); W8[:, 0] += 255 - W8.sum(1)

# ---------------------------------------------------------------- maps: the 150k bake's own (vigil_pack.py's tone, white glow)
mt = S['j']['materials'][S['pr']['material']]; TEX, NT = int(os.environ.get('TEX', 4096)), int(os.environ.get('NTEX', 2048))
C = np.asarray(S['img'](mt['pbrMetallicRoughness']['baseColorTexture']['index']).resize((TEX, TEX), Image.LANCZOS)).astype(np.float32) / 255
MR = np.asarray(S['img'](mt['pbrMetallicRoughness']['metallicRoughnessTexture']['index']).resize((TEX, TEX), Image.LANCZOS)).astype(np.float32) / 255
NM = S['img'](mt['normalTexture']['index'])
ss = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))
mx_, mn_ = C.max(-1), C.min(-1)
glow = ss(0.62, 0.85, mx_) * (1 - ss(0.12, 0.3, (mx_ - mn_) / (mx_ + 1e-4)))
E = glow[..., None] ** 1.5 * np.clip(C * np.array([0.9, 0.95, 1.05]), 0, 1) * 1.6
A = np.power(C, 1.2) * (1 - glow[..., None] * 0.6) + glow[..., None] * np.array([0.5, 0.52, 0.55]) * 0.6
rough = np.clip(MR[..., 1] + 0.1, 0.2, 1); metal = np.clip(MR[..., 2] * 0.5 * (1 - glow), 0, 1)
q = lambda a: Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
def webp(im, qq, size):
    if im.size[0] != size: im = im.resize((size, size), Image.LANCZOS)
    o_ = io.BytesIO(); im.save(o_, 'WEBP', quality=qq, method=6); return 'data:image/webp;base64,' + base64.b64encode(o_.getvalue()).decode()
tex = dict(color=webp(q(A), 88, TEX), normal=webp(NM, 90, NT), orm=webp(q(np.stack([np.ones_like(rough), rough, metal], -1)), 85, NT // 2), emis=webp(q(E), 80, NT // 4))

b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
N8 = np.round(N * 127).astype(np.int8); UV16 = np.round(np.clip(UV, 0, 1) * 65535).astype(np.uint16)
Iq = I.ravel().astype(np.uint16 if len(P) < 65536 else np.uint32)
geo = dict(n=len(P), pos=b64(P.astype(np.float32)), nrm=b64(N8), uv=b64(UV16), ji=b64(top.astype(np.uint8)), jw=b64(W8.astype(np.uint8)), idx=b64(Iq), i32=Iq.dtype == np.uint32)
r4 = lambda v: [round(float(x), 5) for x in v]
out = dict(geo=geo, arm=ARM, at={k: r4(v) for k, v in AT.items()}, fingers=dict(names=names_out, pos=[r4(p) for p in joints], parent=parents, axis=[r4(a) for a in axes], tips={k_: r4(v) for k_, v in tips.items()}),
           hand=info, tex=tex)
st = json.dumps(out, separators=(',', ':')); open(OUT, 'w').write(st)
print(f'{OUT}: {len(st) / 1e6:.2f} MB, {len(P)} verts, {len(I)} tris, {NJ} joints')
