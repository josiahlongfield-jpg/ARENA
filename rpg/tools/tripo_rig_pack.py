"""Pack a Tripo-rigged character and its animation GLBs into one JSON the Reach builds a SkinnedMesh from.

usage: python3 rpg/tools/tripo_rig_pack.py rig.glb out.json name=clip.glb [name=clip.glb ...]
env:   TEX colour map size (2048), NTEX normal/ORM/emission size (1024), DARK albedo power, METAL, ROUGH, G0/G1 red glow thresholds, EMIT,
       GLOW_RGB the glow's tint (1.2,0.45,0.4)

The game has no GLTFLoader, so this keeps only what three.js needs: the joint tree (rest TRS), inverse bind matrices,
the mesh (normals and skin as bytes), WebP maps with the red glow pulled out of the colour as emission, and each clip
resampled to 30 fps with quaternions as int16. Walk and run come with root motion; it is taken out so they play in place.
"""
import base64, io, json, os, struct, sys
import numpy as np
from PIL import Image

def load(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n]); o = 20 + n + 8
    def acc(i):
        a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]; off = o + v.get('byteOffset', 0) + a.get('byteOffset', 0)
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
        c = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        return np.frombuffer(b, dt, a['count'] * c, off).reshape(-1, c).copy()
    def img(k):
        v = j['bufferViews'][j['images'][k]['bufferView']]; s = o + v.get('byteOffset', 0)
        return Image.open(io.BytesIO(b[s:s + v['byteLength']]))
    return j, acc, img

b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
j, acc, img = load(sys.argv[1])
nodes = j['nodes']; parent = {c: i for i, nd in enumerate(nodes) for c in nd.get('children', [])}
mesh_node = next(i for i, nd in enumerate(nodes) if 'mesh' in nd)
skin = j['skins'][0]; joints = skin['joints']
# keep the joints and their ancestors (the Armature), leave out the mesh node: the game parents the mesh itself
keep = set(joints)
for i in list(keep):
    while i in parent: i = parent[i]; keep.add(i)
def depth(i): return 0 if i not in parent else 1 + depth(parent[i])
order = sorted(keep, key=depth)      # parents before children
idx = {k: n for n, k in enumerate(order)}
r5 = lambda v: [round(float(x), 5) for x in v]
tree = [dict(n=nodes[i]['name'], p=idx.get(parent.get(i), -1), t=r5(nodes[i].get('translation', [0, 0, 0])),
             r=r5(nodes[i].get('rotation', [0, 0, 0, 1])), s=r5(nodes[i].get('scale', [1, 1, 1]))) for i in order]

pr = j['meshes'][0]['primitives'][0]; at = pr['attributes']
P, N, UV = acc(at['POSITION']), acc(at['NORMAL']), acc(at['TEXCOORD_0'])
J4, W4 = acc(at['JOINTS_0']).astype(np.uint8), acc(at['WEIGHTS_0'])
I = acc(pr['indices']).ravel().astype(np.uint16 if len(P) < 65536 else np.uint32)
N8 = np.round(N / np.linalg.norm(N, axis=1, keepdims=True) * 127).astype(np.int8)
W8 = np.round(W4 / W4.sum(1, keepdims=True) * 255); W8[:, 0] += 255 - W8.sum(1); W8 = W8.astype(np.uint8)
UV16 = np.round(np.clip(UV, 0, 1) * 65535).astype(np.uint16)
geo = dict(n=len(P), pos=b64(P.astype(np.float32)), nrm=b64(N8), uv=b64(UV16), ji=b64(J4), jw=b64(W8), idx=b64(I), i32=I.dtype == np.uint32,
           ibm=r5(acc(skin['inverseBindMatrices']).ravel()), joints=[idx[k] for k in joints], height=round(float(np.ptp(P[:, 1])), 4))

# ---------------------------------------------------------------- maps (same treatment as the studies' tripo_pack.py)
mt = j['materials'][0]; TEX, NT = int(os.environ.get('TEX', 2048)), int(os.environ.get('NTEX', 1024))
C = np.asarray(img(mt['pbrMetallicRoughness']['baseColorTexture']['index']).convert('RGB').resize((TEX, TEX), Image.LANCZOS)).astype(np.float32) / 255
MR = np.asarray(img(mt['pbrMetallicRoughness']['metallicRoughnessTexture']['index']).convert('RGB').resize((TEX, TEX), Image.LANCZOS)).astype(np.float32) / 255
NM = img(mt['normalTexture']['index']).convert('RGB')
ss = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))
r, g, bb = C[..., 0], C[..., 1], C[..., 2]
glow = ss(float(os.environ.get('G0', 0.15)), float(os.environ.get('G1', 0.45)), r - np.maximum(g, bb)) * ss(0.3, 0.7, r)
GRGB = np.array([float(x) for x in os.environ.get('GLOW_RGB', '1.2,0.45,0.4').split(',')])      # the glow's tint (the Feyr's by default)
E = glow[..., None] ** 1.5 * np.clip(C * GRGB, 0, 1) * float(os.environ.get('EMIT', 1.0))
A = np.power(C, float(os.environ.get('DARK', 1.35))) * (1 - glow[..., None] * 0.6) + glow[..., None] * np.array([0.12, 0.015, 0.01]) * 0.6
rough = np.clip(MR[..., 1] + float(os.environ.get('ROUGH', 0)), 0.2, 1); metal = np.clip(MR[..., 2] * float(os.environ.get('METAL', 1)) * (1 - glow), 0, 1)
q = lambda a: Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
def webp(im, qq, size):
    if im.size[0] != size: im = im.resize((size, size), Image.LANCZOS)
    o_ = io.BytesIO(); im.save(o_, 'WEBP', quality=qq, method=6); return 'data:image/webp;base64,' + base64.b64encode(o_.getvalue()).decode()
tex = dict(color=webp(q(A), 88, TEX), normal=webp(NM, 88, NT), orm=webp(q(np.stack([np.ones_like(rough), rough, metal], -1)), 85, NT), emis=webp(q(E), 85, NT))

# ---------------------------------------------------------------- clips: resample to 30 fps; rotations for every joint, translation for the hip
FPS = 30; clips = {}; HIP0 = next(n['t'] for n in tree if n['n'] == 'Hip')      # the hips' place in the rest pose
for arg in sys.argv[3:]:
    name, path = arg.split('='); cj, cacc, _ = load(path); an = cj['animations'][0]
    byname = {}
    for ch in an['channels']:
        s = an['samplers'][ch['sampler']]; nm = cj['nodes'][ch['target']['node']]['name']
        byname[(nm, ch['target']['path'])] = (cacc(s['input']).ravel(), cacc(s['output']), s.get('interpolation', 'LINEAR'))
    T = max(v[0][-1] for v in byname.values()); nf = int(round(T * FPS)) + 1; tt = np.arange(nf) / FPS
    def sample(key, w):
        t, v, ip = byname[key]
        if len(t) == 1 or ip == 'STEP' and len(t) <= 2: return np.repeat(v[:1], nf, 0)
        k = np.clip(np.searchsorted(t, tt) - 1, 0, len(t) - 2); a = np.clip((tt - t[k]) / np.maximum(t[k + 1] - t[k], 1e-6), 0, 1)[:, None]
        v0, v1 = v[k], v[k + 1]
        if w == 4: v1 = np.where(((v0 * v1).sum(1) < 0)[:, None], -v1, v1)
        o = v0 + (v1 - v0) * a
        return o / np.linalg.norm(o, axis=1, keepdims=True) if w == 4 else o
    tracks = []
    for nd in tree:
        nm = nd['n']
        if (nm, 'rotation') in byname:
            qv = sample((nm, 'rotation'), 4)
            if np.ptp(qv, 0).max() < 2e-4: qv = qv[:1]             # a joint that never moves keeps one key
            tracks.append([nm, 'q', len(qv), b64(np.round(qv * 32767).astype(np.int16))])
    tv = sample(('Hip', 'translation'), 3)
    spd = 0
    if name in ('walk', 'run'):          # root motion out: remove the straight-line drift across the clip and centre the hips where they stand
        drift = tv[-1] - tv[0]; spd = float(np.hypot(drift[0], drift[1]) / tt[-1])      # the hip's x, y are the ground plane (z is up under Root)
        tv = tv - (tt / tt[-1])[:, None] * drift
    tv[:, :2] += np.array(HIP0[:2]) - tv[:, :2].mean(0)      # every clip's hips centred over the rest pose's, so the body stands on its collider
    tracks.append(['Hip', 't', len(tv), b64(tv.astype(np.float32))])
    clips[name] = dict(d=round(float(tt[-1]), 4), fps=FPS, v=round(spd, 4), tr=tracks)      # v: the clip's own ground speed, mesh units a second
    print(name, f'{tt[-1]:.2f}s', nf, 'frames', len(tracks), 'tracks')

out = dict(tree=tree, geo=geo, tex=tex, clips=clips)
s = json.dumps(out, separators=(',', ':')); open(sys.argv[2], 'w').write(s)
print(f'{sys.argv[2]}: {len(s) / 1e6:.2f} MB (tex {sum(len(v) for v in tex.values()) / 1e6:.2f} MB), {len(P)} verts, {len(I) // 3} tris, glow {glow.mean():.4f}')
