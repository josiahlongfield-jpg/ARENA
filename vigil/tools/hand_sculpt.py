"""Her hands from a sculpt: Tripo's model of the gloved right hand the user designed (project files
templar-arena/concepts/step3/wraith_hands/: their sheet, the back and palm views cut from it, the model), in place of the hands
gauntlet.py models, so her hands are sculpted and textured the way the rest of her is.

usage: python3 vigil/tools/hand_sculpt.py hand.glb pack.json [out.json]     (a pack gauntlet.py has been run on; in place by default)
env:   BACK  which way the back of the hand faces in the GLB (+x: Tripo turns the front slot's view that way, and the back of the
             hand went in the front slot); LEN  mm from the middle finger's knuckle to its tip (105, the size the grips were fitted to);
       TEX, NTEX  map sizes (2048, 1024); DARK, METAL, ROUGH  as rpg/tools/vigil_pack.py made her body's maps (1.2, 0.5, 0.1)

- the digits: the sculpt is cut into slabs across its length from the fingertips down; each slab's cross-section falls into separate
  pieces, and a piece is followed down slab to slab until it joins another (the webs). The five that start at a tip are the digits:
  the thumb is the outer one that joins lowest, then index to little across the hand. A right hand has its thumb on the side
  u x palm; a left hand is mirrored first.
- the joints: each finger's axis is the line through its pieces' centres; its knuckle sits short of the web by part of the first bone,
  the bones in the proportions of the modelled hand (gauntlet.py's DIG); the thumb likewise, its first joint down at the base of the palm.
- the wrist: the narrowest section between the wrist band and the palm is where the hand bends. It goes at the wrist joint, the
  band above it rides the forearm's twist joint, the glove between blends from one to the other, and the forearm stub above the band
  is cut away (her own forearm carries on under the band). The scale makes the middle finger LEN long.
- the skin: a digit's own pieces go to its three joints by how far along its axis they are, blended a few mm either side of each
  joint; the palm goes to the hand, with the base of each finger and the ball of the thumb blended into them.
Out: `hands` in the pack (positions 16 bits over their box, normals as bytes, UVs, four joints and weights a vertex, one group) with
its maps in `hands.tex`, and the finger joints (pos, axis, tips) moved onto it; the left hand is the right mirrored.
"""
import base64, io, json, os, struct, sys
import numpy as np
from PIL import Image

GLB, SRC = sys.argv[1:3]; OUT = sys.argv[3] if len(sys.argv) > 3 else SRC
FN = ['thumb', 'index', 'middle', 'ring', 'little']
nrm = lambda v: np.asarray(v, float) / np.linalg.norm(v)
# bone proportions (first, second, third) and how far the web sits along the first bone, from gauntlet.py's modelled hand
PROP = {'thumb': (45, 33, 27), 'index': (45, 28, 25), 'middle': (48, 31, 26), 'ring': (45, 29, 25), 'little': (36, 23, 22)}
WEB = 0.45            # a finger's web is this far along its first bone
LEN = float(os.environ.get('LEN', 105)); BLEND = 2.5      # mm either side of a joint where the skin blends

# ---------------------------------------------------------------- the sculpt
b = open(GLB, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n]); o = 20 + n + 8
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
WM = {}
def walk(i, M):
    WM[i] = M @ local(j['nodes'][i])
    for c in j['nodes'][i].get('children', []): walk(c, WM[i])
for r in j['scenes'][j.get('scene', 0)]['nodes']: walk(r, np.eye(4))
Ps, Ns, UVs, Is, mat = [], [], [], [], None
for ni, nd in enumerate(j['nodes']):
    if 'mesh' not in nd: continue
    M = WM[ni]
    for pr in j['meshes'][nd['mesh']]['primitives']:
        at = pr['attributes']; p = acc(at['POSITION']).astype(float); nn = acc(at['NORMAL']).astype(float)
        Is.append(acc(pr['indices']).ravel().astype(np.int64) + sum(len(q) for q in Ps))
        Ps.append(p @ M[:3, :3].T + M[:3, 3]); Ns.append(nn @ np.linalg.inv(M[:3, :3])); UVs.append(acc(at['TEXCOORD_0']).astype(float))
        mat = mat if mat is not None else pr.get('material', 0)
P = np.vstack(Ps); N = np.vstack(Ns); N /= np.linalg.norm(N, axis=1, keepdims=True); UV = np.vstack(UVs); I = np.concatenate(Is).reshape(-1, 3)
print('sculpt', len(P), 'verts', len(I), 'tris')

# ---------------------------------------------------------------- its frame: along the hand (PCA), the palm away from BACK
c0 = P.mean(0); ev, V = np.linalg.eigh(np.cov((P - c0).T)); u = V[:, 2]
BK = os.environ.get('BACK', '+x'); back = np.zeros(3); back['xyz'.index(BK[1])] = 1.0 if BK[0] == '+' else -1.0
pn = nrm(-(back - u * (back @ u))); side = np.cross(u, pn)
S0 = 230 / np.ptp((P - c0) @ u)              # rough mm: the hand and band are about 230 mm long; the true scale comes from LEN later
def frame(X): X = (X - c0) * S0; return np.c_[X @ side, X @ u, X @ pn]
Q = frame(P)

CELL = 0.7
def section(t):
    """the mesh cut by the plane u = t, filled in: a grid over (side, palm) of the pieces it falls into. Returns (origin, labels grid
    (-1 outside), number of pieces); each piece is solid, so its centre is the middle of the digit"""
    du = Q[:, 1] - t; d3 = du[I]; cross = (d3.min(1) < 0) & (d3.max(1) > 0)
    if cross.sum() < 3: return None
    T = I[cross]; D = d3[cross]; E = np.full((len(T), 3, 2), np.nan)
    for e, (i0, i1) in enumerate(((0, 1), (1, 2), (2, 0))):
        m = D[:, i0] * D[:, i1] < 0; f = D[m, i0] / (D[m, i0] - D[m, i1])
        E[m, e] = (Q[T[m, i0]] + (Q[T[m, i1]] - Q[T[m, i0]]) * f[:, None])[:, [0, 2]]
    ok = ~np.isnan(E[..., 0]); E = E[ok.sum(1) == 2]; ok = ok[ok.sum(1) == 2]
    A2 = np.array([e[k][o] for e, k, o in zip(E, ok, ok)]) if False else E[np.repeat(ok[:, :, None], 2, 2)].reshape(-1, 2, 2)
    w = np.linspace(0, 1, 7)[None, :, None]; pts = (A2[:, :1] * (1 - w) + A2[:, 1:] * w).reshape(-1, 2)
    org = pts.min(0) - 3 * CELL; g = np.floor((pts - org) / CELL).astype(int); H, W = g.max(0) + 4
    occ = np.zeros((H, W), bool); occ[g[:, 0], g[:, 1]] = True
    o2 = occ.copy(); o2[1:] |= occ[:-1]; o2[:-1] |= occ[1:]; o2[:, 1:] |= occ[:, :-1]; o2[:, :-1] |= occ[:, 1:]; occ = o2
    out = np.zeros_like(occ); out[0] = out[-1] = True; out[:, 0] = out[:, -1] = True; out &= ~occ
    while True:                       # the outside: what the border reaches; the rest (contours filled in) is the section
        nx = out.copy(); nx[1:] |= out[:-1]; nx[:-1] |= out[1:]; nx[:, 1:] |= out[:, :-1]; nx[:, :-1] |= out[:, 1:]; nx &= ~occ
        if (nx == out).all(): break
        out = nx
    occ = ~out; big = H * W + 1; lab = np.where(occ, np.arange(H * W).reshape(H, W), big)
    while True:                       # each cell takes the smallest label among its neighbours until nothing changes
        L = lab.copy()
        L[1:] = np.minimum(L[1:], lab[:-1]); L[:-1] = np.minimum(L[:-1], lab[1:]); L[:, 1:] = np.minimum(L[:, 1:], lab[:, :-1]); L[:, :-1] = np.minimum(L[:, :-1], lab[:, 1:])
        L = np.where(occ, L, big)
        if (L == lab).all(): break
        lab = L
    ids, inv = np.unique(lab, return_inverse=True); inv = inv.reshape(H, W)
    inv = np.where(lab == big, -1, inv - (1 if (ids == big).any() and ids[-1] == big and False else 0))
    if (ids == big).any(): bi = int(np.nonzero(ids == big)[0][0]); inv = np.where(lab == big, -1, np.where(inv > bi, inv - 1, inv))
    return org, inv, int(inv.max()) + 1
def piece_stats(sec):
    org, G, n = sec; ii, jj = np.nonzero(G >= 0); l = G[ii, jj]; out = []
    for k in range(n):
        m = l == k; X = np.c_[ii[m], jj[m]] * CELL + org + CELL / 2
        out.append(dict(cen=X.mean(0), lo=X.min(0), hi=X.max(0), area=m.sum() * CELL * CELL))
    return out
def lookup(sec, X2, grow=4):
    """the piece each point (side, palm) falls in; points just off a contour take the nearest piece within grow cells"""
    org, G, n = sec; G = G.copy()
    for _ in range(grow):
        e = G < 0; G2 = G.copy()
        for sh in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            r = np.roll(G, sh, (0, 1)); G2 = np.where(e & (G2 < 0) & (r >= 0), r, G2)
        G = G2
    g = np.floor((X2 - org) / CELL).astype(int); ok = (g >= 0).all(1) & (g[:, 0] < G.shape[0]) & (g[:, 1] < G.shape[1])
    out = np.full(len(X2), -1); out[ok] = G[g[ok, 0], g[ok, 1]]; return out

# ---------------------------------------------------------------- which end has the fingers: the end whose section splits most
def count_at(t):
    sec = section(t); return 0 if sec is None else sum(1 for q in piece_stats(sec) if q['area'] > 4)
lo, hi = Q[:, 1].min(), Q[:, 1].max()
if count_at(lo + 0.12 * (hi - lo)) > count_at(hi - 0.12 * (hi - lo)):     # fingers at the low end: turn the frame round
    u = -u; pn = nrm(-(back - u * (back @ u))); side = np.cross(u, pn); Q = frame(P); lo, hi = Q[:, 1].min(), Q[:, 1].max()

# ---------------------------------------------------------------- follow the pieces down from the tips
STEP = 1.5; tracks = []      # each: dict(c=[(u, centre)], merged_at, alive, tip)
label = np.full(len(Q), -1)   # the digit track a vertex belongs to, -1 the palm (pieces that have joined)
groups = []                   # pieces that are joined digits: their last centre
for t in np.arange(hi - STEP / 2, lo, -STEP):
    sec = section(t)
    if sec is None: continue
    st = piece_stats(sec)
    vi = np.nonzero(np.abs(Q[:, 1] - t) <= STEP / 2)[0]; vl_ = lookup(sec, Q[vi][:, [0, 2]])
    live = [k for k, tr in enumerate(tracks) if tr['alive']]
    newgroups = []
    for p_, q in enumerate(st):
        cen, bb0, bb1 = q['cen'], q['lo'] - 1.5, q['hi'] + 1.5; pi = vi[vl_ == p_]
        hit = [k for k in live if (bb0 <= tracks[k]['c'][-1][1]).all() and (tracks[k]['c'][-1][1] <= bb1).all()]
        ghit = [g for g in groups if (bb0 <= g).all() and (g <= bb1).all()]
        if len(hit) == 1 and not ghit:
            tracks[hit[0]]['c'].append((t, cen)); label[pi] = hit[0]; tracks[hit[0]]['seen'] = True
        elif not hit and not ghit:
            if q['area'] < 3: continue                   # a speck
            tracks.append(dict(c=[(t, cen)], merged_at=None, alive=True, seen=True, tip=t + STEP / 2)); label[pi] = len(tracks) - 1
        else:
            est = [k for k in hit if len(tracks[k]['c']) >= 4]
            if len(est) >= 2 or ghit:                    # pieces joining: the digits in it end here
                for k in hit:
                    tracks[k]['alive'] = False; tracks[k]['merged_at'] = t if k in est else None
                newgroups.append(cen)
            else:                                        # a short stray track beside a digit: the digit carries on, the stray goes
                keepk = max(hit, key=lambda k: len(tracks[k]['c']))
                for k in hit:
                    if k != keepk: tracks[k]['alive'] = False; tracks[k]['merged_at'] = None
                tracks[keepk]['c'].append((t, cen)); label[pi] = keepk; tracks[keepk]['seen'] = True
    for k in live:
        if tracks[k]['alive'] and not tracks[k].pop('seen', False): tracks[k]['alive'] = False; tracks[k]['merged_at'] = t if len(tracks[k]['c']) >= 4 else None
    for tr in tracks: tr.pop('seen', None)
    groups = newgroups
cand = [k for k, tr in enumerate(tracks) if tr['merged_at'] is not None and tr['tip'] - tr['merged_at'] > 12]
# the fingers: the four highest tips; the thumb: the longest-reaching other digit whose tip lies out beyond them across the hand
fing = sorted(sorted(cand, key=lambda k: -tracks[k]['tip'])[:4], key=lambda k: tracks[k]['c'][0][1][0])
assert len(fing) == 4, f'expected four fingers, found {len(fing)}'
sx = [tracks[k]['c'][0][1][0] for k in fing]; span = (min(sx), max(sx))
out_by = lambda k: max(span[0] - tracks[k]['c'][0][1][0], tracks[k]['c'][0][1][0] - span[1])
thc = [k for k in cand if k not in fing and tracks[k]['tip'] - tracks[k]['merged_at'] > 20 and out_by(k) > 8]
assert thc, 'no thumb found'
th = max(thc, key=out_by)
print('fingers', [(k, round(tracks[k]['tip'], 1), round(tracks[k]['merged_at'], 1), round(float(tracks[k]['c'][0][1][0]), 1)) for k in fing],
      'thumb', (th, round(tracks[th]['tip'], 1), round(float(tracks[th]['c'][0][1][0]), 1)))
mirror = tracks[th]['c'][0][1][0] < span[0]             # thumb on -side: a left hand; mirror it into a right
order = [th] + (fing[::-1] if not mirror else fing)
print('mirror', mirror, 'order', order)
if mirror:
    Q[:, 0] *= -1; I = I[:, [0, 2, 1]]; side = -side
    for tr in tracks: tr['c'] = [(uu, cc * [-1, 1]) for uu, cc in tr['c']]
digit_of = {k: fi for fi, k in enumerate(order)}
# what the tracking left off a digit (a fingertip too small to start a piece, a stray beside it) joins the digit it touches, if it
# lies beyond the digit's web (the thumb: near its tip); left on the palm it would stay put as the digit curls and pull out a spike
dl = np.array([digit_of.get(t, -1) for t in label]); lim = np.array([tracks[k]['merged_at'] + 1.0 for k in order]); lim[0] = tracks[th]['tip'] - 6
for _ in range(12):
    L3 = dl[I]; tk = L3.max(1); m = (L3 < 0) & (tk >= 0)[:, None]; v = I[m]; f_ = np.repeat(tk, 3).reshape(-1, 3)[m]
    ok = Q[v, 1] > lim[f_]; v, f_ = v[ok], f_[ok]
    if not len(v): break
    dl[v] = f_
fixed = (dl >= 0) & (np.array([digit_of.get(t, -1) for t in label]) < 0)
print('joined to their digits', int(fixed.sum()), 'vertices the tracking left off', [int((fixed & (dl == fi)).sum()) for fi in range(5)])
label = np.where(dl >= 0, np.array(order)[np.maximum(dl, 0)], -1)

# ---------------------------------------------------------------- each digit's axis, tip and web
def axis_of(k):
    C = np.array([[cc[0], uu, cc[1]] for uu, cc in tracks[k]['c']]); m = C.mean(0); _, _, Vt = np.linalg.svd(C - m); d = Vt[0]
    if d @ (C[0] - C[-1]) < 0: d = -d                     # toward the tip (the track starts at the tip)
    pts = Q[label == k]; tip = m + d * ((pts - m) @ d).max(); web = m + d * ((C[-1] - m) @ d)
    return m, d, tip, web
AXS = {FN[digit_of[k]]: axis_of(k) for k in order}
# the wrist: the narrowest section between the band and the thumb's web
def rad(t):
    sec = section(t)
    if sec is None: return 0
    st = max(piece_stats(sec), key=lambda q: q['area']); return np.sqrt(st['area'] / np.pi)      # the main piece's size
web_lo = min(tracks[k]['merged_at'] for k in fing); us = np.arange(lo + 2, web_lo - 0.35 * (web_lo - lo), 1.0); rs = np.array([rad(t) for t in us])
band_i = int(np.argmax(rs[: max(3, len(rs) // 2)])); gap_i = band_i + int(np.argmin(rs[band_i:])) if band_i < len(rs) - 1 else band_i
U_GAP, U_BAND = us[gap_i], us[band_i]
top_i = band_i
while top_i > 0 and rs[top_i - 1] > rs[band_i] * 0.86: top_i -= 1      # the band's upper edge: where the section falls back to the forearm's
U_TOP = us[top_i]
print('band at %.1f (r %.1f), its top %.1f, the wrist gap %.1f (r %.1f) (rough mm)' % (U_BAND, rs[band_i], U_TOP, U_GAP, rs[gap_i]))

# ---------------------------------------------------------------- joints, in rough mm, then everything scaled and moved into her hand frame
def joints_of(f):
    m, d, tip, web = AXS[f]; L = np.array(PROP[f], float)
    if f == 'thumb':        # its bones at the fingers' scale back from its tip; its first joint down at the base of the palm
        kf = np.mean([KF[g] for g in FN[1:]]); ip = tip - d * L[2] * kf; mcp = ip - d * L[1] * kf
        meta = nrm(np.array([22.0, 37.0, 8.0])); return np.array([mcp - meta * L[0] * kf, mcp, ip, tip])
    k1 = ((tip - web) @ d) / (1 - WEB + (L[1] + L[2]) / L[0]); mcp = web - d * WEB * k1; pip = mcp + d * k1; dip = pip + d * k1 * L[1] / L[0]
    KF[f] = k1 / L[0]
    return np.array([mcp, pip, dip, tip])
KF = {}; JR = {f: joints_of(f) for f in FN[1:] + FN[:1]}
k = LEN / np.linalg.norm(JR['middle'][3] - JR['middle'][0])
off = np.array([0, U_GAP, 0.0])
toH = lambda X: (np.asarray(X) - off) * k                  # rough mm -> her hand frame (mm; the wrist joint at u = 0)
JH = {f: toH(v) for f, v in JR.items()}; QH = toH(Q)
# Tripo had only the back and the palm to go on, so it guessed the hand's depth, about twice a gloved hand's in the palm and a third
# over in the fingers. Flatten it toward its mid-plane: not the band (it has to fit her forearm), the palm to FLAT_PALM, the fingers to
# FLAT_FINGER, eased between. The joints go with it; normals are corrected below.
FP_, FF_ = float(os.environ.get('FLAT_PALM', 0.6)), float(os.environ.get('FLAT_FINGER', 0.78))
ssf = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))
flat = lambda uu_: 1 + (FP_ - 1) * ssf(0, 30, uu_) + (FF_ - FP_) * ssf(70, 105, uu_)
ub = np.arange(np.floor(QH[:, 1].min()), QH[:, 1].max() + 2, 2.0); nt = dl != 0; cb = np.full(len(ub), np.nan)
for i_, a_ in enumerate(ub):
    m_ = nt & (np.abs(QH[:, 1] - a_) < 1.5)
    if m_.sum() > 10: cb[i_] = (QH[m_, 2].min() + QH[m_, 2].max()) / 2
ok_ = ~np.isnan(cb); cb = np.interp(ub, ub[ok_], cb[ok_]); cb = np.convolve(np.pad(cb, 3, mode='edge'), np.ones(7) / 7, 'valid')
mid = lambda uu_: np.interp(uu_, ub, cb)
def flatten(X):
    X = np.array(X, float); c_ = mid(X[..., 1]); X[..., 2] = c_ + (X[..., 2] - c_) * flat(X[..., 1]); return X
FV = flat(QH[:, 1]); QH = flatten(QH); JH = {f: flatten(v) for f, v in JH.items()}
print('scale %.3f; knuckles' % k, {f: JH[f][0].round(1).tolist() for f in FN})

# ---------------------------------------------------------------- the skin: columns 0 the hand, 1 the forearm's twist joint, 2 + digit * 3 + bone
W = np.zeros((len(Q), 17)); uH = QH[:, 1]
ss = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))
W[:, 0] = ss(-3, 4, uH); W[:, 1] = 1 - W[:, 0]      # the band rides the forearm; the glove bends between it and the hand
vl = np.full(len(Q), -1); hit = label >= 0; vl[hit] = [digit_of.get(t, -1) for t in label[hit]]
pm = vl < 0
for fi, f in enumerate(FN):
    J4 = JH[f]; cols = 2 + fi * 3; own = vl == fi
    if f == 'thumb':
        # its own pieces: its second and third bones, blended at the middle joint, their bottom still on the first bone;
        # the ball of the thumb (palm round its first bone) rides the first bone
        d = nrm(J4[3] - J4[1]); t = (QH - J4[1]) @ d; L2 = np.linalg.norm(J4[2] - J4[1])
        on = ss(-2 * BLEND, 2 * BLEND, t); b3 = ss(L2 - BLEND, L2 + BLEND, t)
        W[own] = 0; W[own, cols] = (1 - on)[own]; W[own, cols + 1] = (on * (1 - b3))[own]; W[own, cols + 2] = (on * b3)[own]
        dm = nrm(J4[1] - J4[0]); Lm = np.linalg.norm(J4[1] - J4[0]); tm = np.clip((QH - J4[0]) @ dm, 0, Lm)
        rr = np.linalg.norm(QH - J4[0] - tm[:, None] * dm, axis=1); wb = ss(24, 11, rr) * ss(4, 14, uH)
    else:
        d = nrm(J4[3] - J4[0]); t = (QH - J4[0]) @ d; L1, L2 = np.linalg.norm(J4[1] - J4[0]), np.linalg.norm(J4[2] - J4[0])
        b2 = ss(L1 - BLEND, L1 + BLEND, t); b3 = ss(L2 - BLEND, L2 + BLEND, t); on = ss(-6, 4, t)      # on: from the hand onto the first bone
        W[own] = 0; W[own, 0] = (1 - on)[own]; W[own, cols] = (on * (1 - b2))[own]; W[own, cols + 1] = (on * (b2 - b3))[own]; W[own, cols + 2] = (on * b3)[own]
        # the palm round the base of this finger (its lane across the hand) blends onto the first bone too
        others = [JH[g][0][0] for g in FN[1:] if g != f]; sx = J4[0][0]
        lane_lo = max([x for x in others if x < sx], default=-1e9); lane_hi = min([x for x in others if x > sx], default=1e9)
        lane = (QH[:, 0] > (sx + lane_lo) / 2) & (QH[:, 0] <= (sx + lane_hi) / 2); wb = ss(-10, 6, t) * lane
    W[pm, cols] = np.maximum(W[pm, cols], wb[pm]); W[pm, 0] = np.maximum(0, W[pm, 0] - wb[pm])
W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
# the forearm stub above the band goes; triangles across the cut keep their far corners, pressed onto the cut, so the band ends clean
ucut = (U_TOP - U_GAP) * k + 0.5; beyond = uH <= ucut; across = beyond[I].any(1) & ~beyond[I].all(1)
ev = np.unique(I[across][beyond[I[across]]]); QH[ev, 1] = ucut; keep = ~beyond; keep[ev] = True
print('kept', int(keep.sum()), 'of', len(Q), 'vertices; per digit', [int((vl == fi).sum()) for fi in range(5)], 'palm', int(pm.sum()))
keepT = keep[I].all(1); I = I[keepT]; used = np.unique(I); remap = -np.ones(len(Q), np.int64); remap[used] = np.arange(len(used)); I = remap[I]
QH, W, UV, vl = QH[used], W[used], UV[used], vl[used]
NH = np.c_[N[used] @ side, N[used] @ u, N[used] @ pn]          # (side was turned round if the sculpt was mirrored)
NH[:, 2] /= FV[used]; NH /= np.linalg.norm(NH, axis=1, keepdims=True)      # a surface squashed along n tilts its normals toward n

# ---------------------------------------------------------------- the maps, made as her body's were
mt = j['materials'][mat]; pbr = mt['pbrMetallicRoughness']; TEX, NT = int(os.environ.get('TEX', 2048)), int(os.environ.get('NTEX', 1024))
C = np.asarray(img(pbr['baseColorTexture']['index']).resize((TEX, TEX), Image.LANCZOS)).astype(np.float32) / 255
MR = np.asarray(img(pbr['metallicRoughnessTexture']['index']).resize((NT, NT), Image.LANCZOS)).astype(np.float32) / 255
NM = img(mt['normalTexture']['index'])
Al = np.power(C, float(os.environ.get('DARK', 1.2)))
rough = np.clip(MR[..., 1] + float(os.environ.get('ROUGH', 0.1)), 0.2, 1); metal = np.clip(MR[..., 2] * float(os.environ.get('METAL', 0.5)), 0, 1)
q8 = lambda a_: Image.fromarray((np.clip(a_, 0, 1) * 255 + 0.5).astype(np.uint8))
def webp(im, qq, size):
    if im.size[0] != size: im = im.resize((size, size), Image.LANCZOS)
    o_ = io.BytesIO(); im.save(o_, 'WEBP', quality=qq, method=6); return 'data:image/webp;base64,' + base64.b64encode(o_.getvalue()).decode()
tex = dict(color=webp(q8(Al), 88, TEX), normal=webp(NM, 90, NT), orm=webp(q8(np.stack([np.ones_like(rough), rough, metal], -1)), 85, NT))

# ---------------------------------------------------------------- into the pack: the right hand, and the left as its mirror
dec = lambda s_, t_: np.frombuffer(base64.b64decode(s_), t_)
b64 = lambda a_: base64.b64encode(np.ascontiguousarray(a_).tobytes()).decode()
A = json.load(open(SRC)); F = A['fingers']; fp = 'arm' in A
names = (A['arm'] + F['names']) if fp else A['joints']
FR = A['hand'] if fp else F['frames']
assert all('band' in FR[sd] for sd in 'LR'), 'run gauntlet.py on the pack first'
assert 'sculpt' not in A.get('hands', {}).get('mats', []), 'run it on the pack as gauntlet.py left it, not on its own output'
# her own mesh, to fit the band over her forearm
G = A['geo']; PG = dec(G['pos'], np.float32).reshape(-1, 3).astype(float)
IG = dec(G['idx'], np.uint32 if G['i32'] else np.uint16).astype(np.int64).reshape(-1, 3)
JIG = dec(G['ji'], np.uint8).reshape(-1, 4).astype(int); JWG = dec(G['jw'], np.uint8).reshape(-1, 4) / 255.0
CLR = float(os.environ.get('CLR', 1.5)); GROW = float(os.environ.get('GROW', 0.5)); TAPER = 20.0     # mm clear, the band's share, taper length
UT = (U_TOP - U_GAP) * k; UC = float(os.environ.get('UCUT', UT + 16))   # the band's top, and where her forearm is cut off inside it
def her_sec(L, T, t, n=6):
    """points along the section of the triangles T of L (side, along, palm) by the plane u = t, as (side, palm)"""
    d = L[:, 1] - t; D = d[T]; m = (D.min(1) < 0) & (D.max(1) > 0); T, D = T[m], D[m]
    E = np.full((len(T), 3, 2), np.nan)
    for e, (e0, e1) in enumerate(((0, 1), (1, 2), (2, 0))):
        c = D[:, e0] * D[:, e1] < 0; f = D[c, e0] / (D[c, e0] - D[c, e1])
        E[c, e] = (L[T[c, e0]] + (L[T[c, e1]] - L[T[c, e0]]) * f[:, None])[:, [0, 2]]
    ok = ~np.isnan(E[..., 0]); E = E[ok.sum(1) == 2]; ok = ok[ok.sum(1) == 2]
    if not len(E): return np.zeros((0, 2))
    S2 = E[np.repeat(ok[:, :, None], 2, 2)].reshape(-1, 2, 2); w = np.linspace(0, 1, n)[None, :, None]
    return (S2[:, :1] * (1 - w) + S2[:, 1:] * w).reshape(-1, 2)
def sec_centre(pts_at, ts):
    C = [((p.min(0) + p.max(0)) / 2) for p in (pts_at(t) for t in ts) if len(p) > 8]; return np.mean(C, 0)
NB = 36
tbin = lambda X: np.arctan2(X[:, 1], X[:, 0])
dropG = np.zeros(len(PG), bool)
HP, HN, HUV, HJ, HWt, HI = [], [], [], [], [], []; jpos, jax, tips = {}, {}, {}; o_ = 0
# each digit's flex axis (right hand): a positive turn brings the tip toward the palm; the thumb closes toward the middle knuckle
AXH = {}
for f in FN:
    J4 = JH[f]; d = nrm(J4[3] - J4[1])
    if f == 'thumb': ac = JH['middle'][0] - J4[1]; ac -= d * (ac @ d); AXH[f] = nrm(np.cross(d, ac))
    else: AXH[f] = nrm(np.cross(d, [0, 0, 1.0]))
for sd in 'LR':
    W0 = np.array(FR[sd]['band']); uu = np.array(FR[sd]['u']); pp = np.array(FR[sd]['palm']); sdv = np.cross(uu, pp); mir = -1.0 if sd == 'L' else 1.0
    toW = lambda X: W0 + (X[..., :1] * mir * sdv + X[..., 1:2] * uu + X[..., 2:3] * pp) / 1000
    toD = lambda v: nrm(v[0] * mir * sdv + v[1] * uu + v[2] * pp)
    cols = [names.index('hd' + sd), names.index('tw' + sd)] + [names.index(f'{f}{bn}{sd}') for f in FN for bn in (1, 2, 3)]
    top = np.argsort(-W, 1)[:, :4]; tw_ = np.take_along_axis(W, top, 1); tw_ /= tw_.sum(1, keepdims=True)
    # her forearm in this hand's frame (a left one mirrored): its triangles skinned to the forearm and hand near the wrist
    X = PG - W0; LG = np.c_[X @ (mir * sdv), X @ uu, X @ pp] * 1000
    armj = [names.index(x + sd) for x in ('el', 'tw', 'hd')]
    fore = ((JWG * np.isin(JIG, armj)).sum(1) > 0.5) & (np.linalg.norm(X, axis=1) < 0.15); TF = IG[fore[IG].all(1)]
    # the wrist joint goes onto her forearm's axis, and the band is centred on it
    hc = sec_centre(lambda t: her_sec(LG, TF, t), np.arange(UT, UC, 2.0))
    nc = sec_centre(lambda t: her_sec(QH, I, t), np.arange(UT + 1, UC, 2.0))
    W0 = W0 + (hc[0] * mir * sdv + hc[1] * pp) / 1000
    LG -= [hc[0], 0, hc[1]]; Qc = QH - [nc[0], 0, nc[1]]; Jc = {f: JH[f] - [nc[0], 0, nc[1]] for f in FN}
    # where her forearm would still show through the band, the band grows out and her forearm slims in to meet it, half each
    # (by angle round the axis and along the band; her forearm tapers in over TAPER mm above the band's top)
    bins = lambda X2: ((tbin(X2) + np.pi) / (2 * np.pi) * NB).astype(int) % NB
    ts = np.arange(UT + 1, UC + 2, 1.5); D = np.zeros((len(ts), NB))
    for ti, t in enumerate(ts):
        hp = her_sec(LG, TF, t); q = her_sec(Qc, I, t)
        if len(hp) < 8 or len(q) < 30: continue
        rh = np.zeros(NB); rn = np.zeros(NB)
        np.maximum.at(rh, bins(hp), np.hypot(hp[:, 0], hp[:, 1])); np.maximum.at(rn, bins(q), np.hypot(q[:, 0], q[:, 1]))
        ok = (rh > 0) & (rn > 0); D[ti, ok] = np.maximum(0, rh[ok] + CLR - rn[ok])
    # spread then smooth (round the axis by two bins, along it by one slice): never below what a bin needs
    D = np.max([np.roll(D, s_, 1) for s_ in range(-2, 3)], 0); D = sum(np.roll(D, s_, 1) * w_ for s_, w_ in zip(range(-2, 3), (1, 4, 6, 4, 1))) / 16
    Dp = np.pad(D, ((1, 1), (0, 0)), mode='edge'); D = np.maximum(np.maximum(Dp[:-2], Dp[2:]), D)
    Dp = np.pad(D, ((1, 1), (0, 0)), mode='edge'); D = (Dp[:-2] + 2 * D + Dp[2:]) / 4
    def at_(L):
        fb = (tbin(L[:, [0, 2]]) + np.pi) / (2 * np.pi) * NB - 0.5; b0 = np.floor(fb).astype(int); fr = fb - b0
        tf = np.clip((L[:, 1] - ts[0]) / 1.5, 0, len(ts) - 1); t0 = np.minimum(np.floor(tf).astype(int), len(ts) - 2); tr = tf - t0
        row = lambda r_: D[r_, b0 % NB] * (1 - fr) + D[r_, (b0 + 1) % NB] * fr
        return row(t0) * (1 - tr) + row(t0 + 1) * tr
    def push(L, dr):                         # move points of L out (or in) from the axis by dr mm
        r = np.maximum(np.hypot(L[:, 0], L[:, 2]), 1e-6); L[:, 0] *= 1 + dr / r; L[:, 2] *= 1 + dr / r
    push(Qc, GROW * at_(Qc) * (1 - ss(UC + 3, -1, Qc[:, 1])))
    deficit = D.max(0)
    fv = np.nonzero(fore)[0]; Lf = LG[fv]
    push(Lf, -(1 - GROW) * at_(Lf) * ss(UT - TAPER, UT, Lf[:, 1])); LG[fv] = Lf
    PG[fv] = W0 + (Lf[:, :1] * mir * sdv + Lf[:, 1:2] * uu + Lf[:, 2:3] * pp) / 1000
    dropG |= fore & (LG[:, 1] > UC)                                          # her forearm ends inside the band
    print(sd, 'wrist joint moved %.1f mm onto her forearm; band centred by %s; short of her forearm by up to %.1f mm (mean %.1f); her forearm cut at %.0f'
          % (np.hypot(*hc), np.round(nc, 1).tolist(), deficit.max(), deficit.mean(), UC))
    FR[sd]['band'] = [round(float(x), 6) for x in W0]
    if 'hd' + sd in A.get('at', {}): A['at']['hd' + sd] = [round(float(x), 5) for x in W0]
    HP.append(toW(Qc)); HN.append(NH[:, :1] * mir * sdv + NH[:, 1:2] * uu + NH[:, 2:3] * pp); HUV.append(UV)
    HJ.append(np.array(cols)[top]); HWt.append(tw_); HI.append((I[:, [0, 2, 1]] if sd == 'L' else I) + o_); o_ += len(QH)
    for f in FN:
        for bn in range(3): jpos[f'{f}{bn + 1}{sd}'] = toW(Jc[f][bn]); jax[f'{f}{bn + 1}{sd}'] = toD(AXH[f]) * mir    # a mirrored axis is negated
        tips[f + sd] = toW(Jc[f][3])
# her mesh without the forearm ends the bands now cover
keepT = ~dropG[IG].any(1); IG = IG[keepT]; used = np.unique(IG); remap = -np.ones(len(PG), np.int64); remap[used] = np.arange(len(used))
for key_, dt_, w_ in (('pos', np.float32, 3), ('nrm', np.int8, 3), ('uv', np.uint16, 2), ('ji', np.uint8, 4), ('jw', np.uint8, 4)):
    G[key_] = b64((PG.astype(np.float32) if key_ == 'pos' else dec(G[key_], dt_).reshape(-1, w_))[used])
G['n'] = int(len(used)); G['i32'] = bool(len(used) > 65535); G['idx'] = b64(remap[IG].astype(np.uint32 if G['i32'] else np.uint16))
print('her mesh: cut', int(len(PG) - len(used)), 'vertices inside the bands')
HP = np.vstack(HP); HN = np.vstack(HN); HUV = np.vstack(HUV); HJ = np.vstack(HJ); HWt = np.vstack(HWt); HI = np.vstack(HI)
W8 = np.round(HWt * 255); W8[:, 0] += 255 - W8.sum(1)
Hn8 = np.clip(np.round(HN / np.maximum(np.linalg.norm(HN, axis=1, keepdims=True), 1e-9) * 127), -127, 127).astype(np.int8)
lo3 = HP.min(0); sc3 = np.maximum(HP.max(0) - lo3, 1e-6) / 65535; hi32 = len(HP) > 65535
A['hands'] = dict(n=len(HP), lo=lo3.tolist(), sc=sc3.tolist(), pos=b64(np.round((HP - lo3) / sc3).astype(np.uint16)), nrm=b64(Hn8),
                  uv=b64(np.round(np.clip(HUV, 0, 1) * 65535).astype(np.uint16)), ji=b64(HJ.astype(np.uint8)), jw=b64(W8.astype(np.uint8)),
                  idx=b64(HI.astype(np.uint32 if hi32 else np.uint16)), i32=bool(hi32), groups=[[0, int(HI.size), 0]], mats=['sculpt'], tex=tex)
r5 = lambda v: [round(float(x), 5) for x in v]
F['pos'] = [r5(jpos[nm]) for nm in F['names']]; F['axis'] = [r5(jax[nm]) for nm in F['names']]; F['tips'] = {k_: r5(v) for k_, v in tips.items()}
open(OUT, 'w').write(json.dumps(A, separators=(',', ':')))
print(OUT, os.path.getsize(OUT) // 1024, 'KB; hands', len(HP), 'verts', len(HI), 'tris; maps', sum(len(v) for v in tex.values()) // 1024, 'KB')
