"""Pack the Vigil assault rifle (Tripo bake of the user's renders) for the game: the body and the magazine as two meshes, its maps,
and the points the hands, sights and effects need.

usage: python3 vigil/tools/rifle_pack.py ar_150k.glb vigil/assets/rifle.js        env LEN (0.9) TEX (2048) DARK (1.1) METAL (0.6) ROUGH (0.1)

Frame: metres, muzzle toward -Z, top +Y, the rifle's right side +X (the camera's own axes, so the viewmodel needs no turn),
origin on the sight line at the rear sight. Tripo's bake already has the muzzle at -Z and the right side at +X; it is only scaled.
Measured on the bake at LEN 0.9 (mm, h = distance toward the muzzle from the middle, y up): the rear sight plate at h -153.5,
the front sight ring at h 265.5 with its hole centred at y 148.3 (so that is the sight line), the bore at y 57.5, the pistol grip's
axis from (h -156, y -30) to (h -200, y -120), the trigger face at (h -103, y -32), the handguard's underside at y -13.
Tripo left the rear sight solid: the game's rifle material cuts a round peep hole through it on the sight line (pts.peep: radius, half depth). The magazine is cut off below the
magazine well's lip (a plane through (h -41, y -40) and (h 47.5, y -22.5)) and capped, so a reload can take it out.
"""
import base64, io, json, os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbio import static_mesh

GLB, OUT = sys.argv[1:3]
LEN = float(os.environ.get('LEN', 0.9)); TEX = int(os.environ.get('TEX', 2048))
S = static_mesh(GLB); P = S['P'] * (LEN / np.ptp(S['P'][:, 2])); N = S['N'] / np.linalg.norm(S['N'], axis=1, keepdims=True)
UV = S['UV'] * [1, -1] + [0, 1]                                      # three.js flips textures (flipY = true)
I = S['I'].reshape(-1, 3).astype(np.int64)
k = LEN / 0.9                                                        # the measurements below were taken at 0.9 m
SIGHT_Y, REAR_H = 148.3 * k, -153.5 * k
def pt(h, y, x=0.0): return [round(x * k / 1000, 5), round((y * k - SIGHT_Y) / 1000, 5), round((-h * k - (-REAR_H)) / 1000, 5)]
hmm = lambda X: -X[..., 2] * 1000 / k; ymm = lambda X: X[..., 1] * 1000 / k; xmm = lambda X: X[..., 0] * 1000 / k

# ---- magazine: everything below the lip plane inside the magazine's box
a0, a1 = np.array([-41.0, -40.0]), np.array([47.5, -22.5]); dl = (a1 - a0) / np.linalg.norm(a1 - a0); nl = np.array([-dl[1], dl[0]])
def below(X):
    q = np.stack([hmm(X), ymm(X)], -1)
    return ((q - a0) @ nl < -0.6) & (q[..., 0] > -60) & (q[..., 0] < 80) & (q[..., 1] > -175) & (np.abs(xmm(X)) < 30)
mag_t = below(P[I]).all(1)
print('magazine:', int(mag_t.sum()), 'triangles')
def sub(T):
    used = np.unique(T); re = -np.ones(len(P), np.int64); re[used] = np.arange(len(used))
    return dict(P=P[used], N=N[used], UV=UV[used], I=re[T])
body, mag = sub(I[~mag_t]), sub(I[mag_t])
# cap the magazine's open top: a fan over each boundary loop, using the colour of the magazine's own top edge
def cap(m):
    T = m['I']; q = np.round(m['P'] / 2e-5).astype(np.int64); _, wid = np.unique(q, axis=0, return_inverse=True); wid = wid.ravel()
    from collections import Counter
    E = Counter()
    for t in T:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])): E[(wid[a], wid[b])] += 1
    bnd = [(a, b) for (a, b), c in E.items() if (b, a) not in E]
    nxt = {a: b for a, b in bnd}; rep = {}
    for v, w_ in enumerate(wid): rep.setdefault(w_, v)
    loops, seen = [], set()
    for a, _ in bnd:
        if a in seen: continue
        lp = [a]; seen.add(a); c = nxt.get(a)
        while c is not None and c not in seen: lp.append(c); seen.add(c); c = nxt.get(c)
        if len(lp) > 8: loops.append(lp)
    Pn, Nn, Un, In = [m['P']], [m['N']], [m['UV']], [m['I']]; base = len(m['P'])
    for lp in loops:
        V = np.array([rep[w_] for w_ in lp]); ctr = m['P'][V].mean(0)
        nrm = np.cross(m['P'][V[0]] - ctr, m['P'][V[len(V) // 4]] - ctr); nrm /= np.linalg.norm(nrm)
        up = np.array([0, 1.0, 0]); nrm = nrm if nrm @ up > 0 else -nrm
        ring = m['P'][V]; uvc = m['UV'][V].mean(0)
        Pn += [ctr[None], ring]; Nn += [nrm[None], np.repeat(nrm[None], len(V), 0)]; Un += [uvc[None], m['UV'][V]]
        c0 = base; r0 = base + 1; L = len(V)
        tri = np.array([[c0, r0 + i, r0 + (i + 1) % L] for i in range(L)])
        # face the cap upward (out of the magazine)
        e1 = m['P'][V[0]] - ctr; e2 = m['P'][V[1]] - ctr
        if np.cross(e1, e2) @ nrm < 0: tri = tri[:, [0, 2, 1]]
        In.append(tri); base += 1 + L
    print('magazine cap loops:', [len(l) for l in loops])
    return dict(P=np.vstack(Pn), N=np.vstack(Nn), UV=np.vstack(Un), I=np.vstack(In))
mag = cap(mag)
# the magazine pivots out about its top front corner and slides along its own axis
mag_axis = np.array([16.0, -125.0]); mag_axis /= np.linalg.norm(mag_axis)

# ---- the right side of the receiver at the ejection port (for brass)
m = (np.abs(hmm(P) - (-40)) < 6) & (np.abs(ymm(P) - 72) < 6); ej_x = float(xmm(P[m]).max())

pts = dict(sight=pt(-153.5, 148.3), front=pt(265.5, 148.3), muzzle=pt(450, 57.5), bore=pt(-153.5, 57.5),
           gripTop=pt(-156, -30), gripBot=pt(-200, -120), trigger=pt(-103, -32), guard=pt(180, -13), guardFar=pt(260, -13),
           butt=pt(-450, 3), ejector=pt(-40, 72, ej_x), magTop=pt(3, -31), magDir=[0.0, round(float(mag_axis[1]), 4), round(float(-mag_axis[0]), 4)],
           peep=[0.0046 * k, 0.004 * k], gripHalf=[22 * k / 1000, 36 * k / 1000], guardHalf=[39 * k / 1000, 68 * k / 1000])
for part in (body, mag): part['P'] = part['P'] - [0, SIGHT_Y / 1000, -REAR_H / 1000]      # rear sight on the sight line -> origin

# ---- maps: Tripo's colour (4K), metal/roughness (to 2K), normal (1K, as baked)
mt = S['j']['materials'][S['pr']['material']]
Cimg = np.asarray(S['img'](mt['pbrMetallicRoughness']['baseColorTexture']['index']).resize((TEX, TEX), Image.LANCZOS)).astype(np.float32) / 255
MR = np.asarray(S['img'](mt['pbrMetallicRoughness']['metallicRoughnessTexture']['index']).resize((TEX // 2, TEX // 2), Image.LANCZOS)).astype(np.float32) / 255
A = np.power(Cimg, float(os.environ.get('DARK', 1.1)))
rough = np.clip(MR[..., 1] + float(os.environ.get('ROUGH', 0.1)), 0.15, 1); metal = np.clip(MR[..., 2] * float(os.environ.get('METAL', 0.6)), 0, 1)
q = lambda a: Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
def webp(im, qq):
    o_ = io.BytesIO(); im.save(o_, 'WEBP', quality=qq, method=6); return 'data:image/webp;base64,' + base64.b64encode(o_.getvalue()).decode()
tex = dict(color=webp(q(A), 88), normal=webp(S['img'](mt['normalTexture']['index']), 90), orm=webp(q(np.stack([np.ones_like(rough), rough, metal], -1)), 88))
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
def geo(m):
    """quantised to keep the page small: positions as 16-bit steps across the box (lo + q * sc), uv as 16-bit, normals as bytes, and
    the triangles cut into chunks of under 65536 vertices (by distance along the rifle) so every index fits in 16 bits"""
    lo = m['P'].min(0); sc = np.maximum(np.ptp(m['P'], 0), 1e-6) / 65535
    T = m['I']; order = np.argsort(m['P'][T].mean(1)[:, 2]); chunks, a = [], 0
    while a < len(order):
        b = min(len(order), a + 40000)
        while len(np.unique(T[order[a:b]])) > 65535: b = a + (b - a) * 3 // 4
        tt = T[order[a:b]]; used = np.unique(tt); re = -np.ones(len(m['P']), np.int64); re[used] = np.arange(len(used))
        uv = np.clip(np.round(m['UV'][used] * 65535), 0, 65535)
        chunks.append(dict(n=len(used), pos=b64(np.round((m['P'][used] - lo) / sc).astype(np.uint16)),
                           nrm=b64(np.round(m['N'][used] / np.linalg.norm(m['N'][used], axis=1, keepdims=True) * 127).astype(np.int8)),
                           uv=b64(uv.astype(np.uint16)), idx=b64(re[tt].ravel().astype(np.uint16))))
        a = b
    return dict(lo=[float(x) for x in lo], sc=[float(x) for x in sc], chunks=chunks)
data = dict(body=geo(body), mag=geo(mag), tex=tex, pts=pts, len=LEN)
open(OUT, 'w').write('window.VG_RIFLE = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print(OUT, os.path.getsize(OUT) // 1024, 'KB; body', len(body['P']), 'verts', len(body['I']), 'tris in', len(data['body']['chunks']), 'chunks; magazine', len(mag['P']), 'verts')
print('points', json.dumps(pts))
