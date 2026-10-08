"""Close the Vigil's hands round the rifle: place each hand on its grip, then curl every finger joint (base first) until it
touches the rifle, so the fingers wrap the grip and handguard without passing through them; the right index finger is posed
so its pad rests on the trigger.

usage: python3 vigil/tools/grip_solve.py hands.json rifle.js out.json [preview.png]
  hands.json  vigil/assets/vigil_body.json (whole body) or the first-person arms: anything with finger joints from hands.py
Writes, per hand: T, the rigid transform taking the hand (and everything it carries) from her rest pose into the rifle's frame;
the finger angles: [base, middle, end] radians about each joint's flex axis, plus a spread at the base (toward the thumb);
and q, the same turns as quaternions in her rest space, thumb to little finger, base to end.
The rifle is voxelised at 1 mm round each grip. Each finger tries every pose on a grid, skinned as the game skins it, and keeps
the best grasp that comes no nearer the rifle than SKIN.

Where the hands go (rifle frame, see rifle_pack.py):
- right: knuckle line along the pistol grip's axis, palm on its right side; the middle finger wraps just under the trigger
  guard (26 mm down the axis from the grip's top) with its knuckle off the front right corner; the index reaches up to the trigger.
- left: under the handguard, palm up with the knuckle line along the barrel and the thumb forward; the knuckles at the
  handguard's lower right corner, so the fingers curl up its right side.
"""
import base64, json, os, sys
import numpy as np
SRC, RIFLE, OUT = sys.argv[1:4]; DBG = sys.argv[4] if len(sys.argv) > 4 else None
SKIN = float(os.environ.get('SKIN', 0.8))           # mm kept between a finger and the rifle
A = json.load(open(SRC)); F = A['fingers']
src = open(RIFLE).read(); RF = json.loads(src[src.index('{'):src.rindex('}') + 1])
dec = lambda s, t: np.frombuffer(base64.b64decode(s), t)
g = A['geo']; P = dec(g['pos'], np.float32).reshape(-1, 3).astype(float); NV = len(P)
JI = dec(g['ji'], np.uint8).reshape(-1, 4).astype(int); JW = dec(g['jw'], np.uint8).reshape(-1, 4) / 255
IDX = dec(g['idx'], np.uint32 if g['i32'] else np.uint16).astype(int).reshape(-1, 3)
BASE = A['arm'] if 'arm' in A else [n for n in A['joints'] if n not in F['names']]
NB = len(BASE); NJ = NB + len(F['names'])
JP = np.array([A['at'][k] for k in BASE] + F['pos']); AX = np.array([[0, 0, 1.0]] * NB + F['axis'])
FR = F.get('frames') or A['hand']
Wfull = np.zeros((NV, NJ)); np.add.at(Wfull, (np.repeat(np.arange(NV), 4), JI.ravel()), JW.ravel())
FN = ['thumb', 'index', 'middle', 'ring', 'little']
def rifle_geo(part):
    q = RF[part]; Ps, Is, n = [], [], 0
    for c in q['chunks']:
        Ps.append(dec(c['pos'], np.uint16).reshape(-1, 3) * np.array(q['sc']) + q['lo']); Is.append(dec(c['idx'], np.uint16).astype(int).reshape(-1, 3) + n); n += c['n']
    return np.vstack(Ps), np.vstack(Is)
RP, RI = rifle_geo('body'); MP, MI = rifle_geo('mag'); RI = np.vstack([RI, MI + len(RP)]); RP = np.vstack([RP, MP])
pts = {k: np.array(v, float) for k, v in RF['pts'].items()}
deg = np.radians

# ---------------------------------------------------------------- voxels: the rifle's surface and inside, in a box round a grip
class Vox:
    def __init__(s, lo, hi, h=0.001):
        s.lo, s.h = np.array(lo, float), h; s.n = np.ceil((np.array(hi) - s.lo) / h).astype(int) + 1
        occ = np.zeros(s.n, bool)
        T = RP[RI]; T = T[((T.max(1) > s.lo - 0.005) & (T.min(1) < np.array(hi) + 0.005)).all(1)]
        e = np.max(np.linalg.norm(T - np.roll(T, 1, 1), axis=2), 1); ns = np.clip(np.ceil(e / (h * 0.5)), 1, 60).astype(int)
        for k in np.unique(ns):
            Tk = T[ns == k]; a, b = np.meshgrid(np.arange(k + 1), np.arange(k + 1)); m = a + b <= k; a, b = a[m] / k, b[m] / k
            X = Tk[:, None, 0] * (1 - a - b)[None, :, None] + Tk[:, None, 1] * a[None, :, None] + Tk[:, None, 2] * b[None, :, None]
            ijk = np.floor((X.reshape(-1, 3) - s.lo) / h).astype(int); ijk = ijk[((ijk >= 0) & (ijk < s.n)).all(1)]
            occ[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
        def grow(c):
            p = np.pad(c, 1)
            return c | p[2:, 1:-1, 1:-1] | p[:-2, 1:-1, 1:-1] | p[1:-1, 2:, 1:-1] | p[1:-1, :-2, 1:-1] | p[1:-1, 1:-1, 2:] | p[1:-1, 1:-1, :-2]
        ext = np.zeros_like(occ); ext[[0, -1]] = True; ext[:, [0, -1]] = True; ext[:, :, [0, -1]] = True; ext &= ~occ
        while True:                    # outside = empty voxels reachable from the box's faces; the rest is rifle
            nxt = grow(ext) & ~occ
            if nxt.sum() == ext.sum(): break
            ext = nxt
        s.dist = np.full(s.n, 99, np.int16); cur = ~ext; s.dist[cur] = 0
        for d in range(1, 7): nxt = grow(cur); s.dist[nxt & ~cur] = d; cur = nxt
    def d(s, X):
        """mm from each point to the rifle (0 inside; 99 when far or outside the box)"""
        ijk = np.floor((X - s.lo) / s.h).astype(int); ok = ((ijk >= 0) & (ijk < s.n)).all(1); out = np.full(len(X), 99.0)
        out[ok] = s.dist[ijk[ok, 0], ijk[ok, 1], ijk[ok, 2]] * s.h * 1000
        return out

# ---------------------------------------------------------------- the hand and its fingers, rigid per joint (the dominant weight)
def rod(ax, th):
    """rotation matrices about unit axis ax for an array of angles th: (..., 3, 3)"""
    ax = np.asarray(ax, float) / np.linalg.norm(ax); th = np.asarray(th, float)
    K = np.array([[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]])
    s, c = np.sin(th)[..., None, None], np.cos(th)[..., None, None]
    return np.eye(3) + s * K + (1 - c) * (K @ K)
class Hand:
    """the hand's vertices, skinned as the game skins them (linear blend over the hand and its 15 finger joints)"""
    def __init__(s, sd):
        s.sd = sd; s.k = BASE.index('hd' + sd); s.j0 = NB + 'LR'.index(sd) * 15
        cols = [s.k] + list(range(s.j0, s.j0 + 15)); own = Wfull[:, cols].sum(1); s.hv = np.where(own > 0.5)[0]
        Wf = Wfull[s.hv][:, s.j0:s.j0 + 15]; Wf = Wf / np.maximum(1, Wf.sum(1, keepdims=True))   # the rest (hand, wrist) moves with the hand
        s.dom = np.where(Wf.max(1) > 0.3, np.argmax(Wf, 1), -1)                                  # -1: palm
        s.w = JP[s.k]; s.u = np.array(FR[sd]['u'], float); s.pn = np.array(FR[sd]['palm'], float)
        s.pn -= s.u * (s.pn @ s.u); s.pn /= np.linalg.norm(s.pn); s.side = np.cross(s.u, s.pn)
        s.palm = s.hv[s.dom < 0]; s.Wf = Wf
        s.fm = [(s.dom >= f * 3) & (s.dom < f * 3 + 3) for f in range(5)]          # mask over hv: the finger's own vertices
        s.fi_v = [np.where(Wf[:, f * 3:f * 3 + 3].sum(1) > 0.005)[0] for f in range(5)]   # every vertex the finger moves at all
    def spread_axis(s, fi):
        b = JP[s.j0 + fi * 3]; d = JP[s.j0 + fi * 3 + 1] - b
        if fi == 0: ax = np.cross(AX[s.j0], d)          # the thumb swings out of the palm's plane instead
        else: th = JP[s.j0 + 1] - b; ax = np.cross(d, th - d * (th @ d) / (d @ d))
        return ax / np.linalg.norm(ax)
    def chain(s, fi, a):
        """a: (N, 4) angles -> for each of the finger's 3 joints, (R (N,3,3), t (N,3)) taking rest space to posed"""
        out, R0, t0 = [], np.broadcast_to(np.eye(3), (len(a), 3, 3)), np.zeros((len(a), 3))
        for k in range(3):
            J = JP[s.j0 + fi * 3 + k]; R = rod(AX[s.j0 + fi * 3 + k], a[:, k])
            if k == 0: R = R @ rod(s.spread_axis(fi), a[:, 3])
            Rn = R0 @ R; tn = (R0 @ (J - R @ J)[..., None])[..., 0] + t0      # x -> R0 (R (x - J) + J) + t0
            out.append((Rn, tn)); R0, t0 = Rn, tn
        return out
    def pose_finger(s, fi, a):
        """(N, 4) angles -> (N, n, 3): the finger's vertices (fi_v) blended as the game blends them"""
        a = np.atleast_2d(np.asarray(a, float)); ch = s.chain(fi, a); iv = s.fi_v[fi]; X = P[s.hv[iv]]; w = s.Wf[iv, fi * 3:fi * 3 + 3]
        out = (1 - w.sum(1))[None, :, None] * X[None]
        for k in range(3): out = out + w[None, :, k, None] * (np.einsum('nij,mj->nmi', ch[k][0], X) + ch[k][1][:, None, :])
        return out
    def all_pts(s, ang):
        X = P[s.hv].copy(); D = np.zeros_like(X)
        for fi, f in enumerate(FN): D[s.fi_v[fi]] += s.pose_finger(fi, ang[f])[0] - X[s.fi_v[fi]]
        return X + D
    def frame_T(s, side_t, pn_t, at_world, at_rest):
        side_t = side_t / np.linalg.norm(side_t); pn_t = pn_t - side_t * (pn_t @ side_t); pn_t = pn_t / np.linalg.norm(pn_t)
        Rr = np.stack([s.side, s.pn, np.cross(s.side, s.pn)], 1); Rt = np.stack([side_t, pn_t, np.cross(side_t, pn_t)], 1)
        T = np.eye(4); T[:3, :3] = Rt @ Rr.T; T[:3, 3] = at_world - T[:3, :3] @ at_rest; return T
place = lambda T, X: X @ T[:3, :3].T + T[:3, 3]

TOUCH = 3.0                                          # mm: a vertex this close to the rifle is in contact
def settle(H, T, V):
    """slide the hand straight off the grip (against its palm) until the palm is clear"""
    X = place(T, P[H.palm]); step = -T[:3, :3] @ H.pn * 0.0005; n = 0
    while (V.d(X + step * n) < SKIN).any() and n < 160: n += 1
    T = T.copy(); T[:3, 3] += step * n; return T, n * 0.5
def grid(r1, r2, r3, rs=(0, 1, 1)):
    g = np.meshgrid(*[deg(np.arange(*r)) for r in (r1, r2, r3, rs)], indexing='ij'); return np.stack([x.ravel() for x in g], 1)
def wrap(H, T, V, fi, A):
    """every pose in A for finger fi, scored as a grasp: each of its three segments touching the rifle, as many vertices in contact
    as can be, curled rather than straight, the end joint following the middle one as a real finger's does; never into the rifle"""
    best = None
    for c in range(0, len(A), 1500):
        a = A[c:c + 1500]; X = H.pose_finger(fi, a); n = X.shape[1]
        d = V.d(place(T, X.reshape(-1, 3))).reshape(len(a), n)
        own = H.dom[H.fi_v[fi]]; ok = d.min(1) >= SKIN
        seg = sum(((d < TOUCH) & (own == fi * 3 + k)[None]).any(1) for k in range(3))
        sc = 12 * seg + 0.25 * (d < TOUCH).sum(1) + 0.04 * np.degrees(a[:, :3].sum(1)) - 0.08 * np.abs(np.degrees(a[:, 2] - 0.67 * a[:, 1]))
        sc = np.where(ok, sc, -1e9); i = int(np.argmax(sc))
        if best is None or sc[i] > best[0]: best = (float(sc[i]), a[i].tolist(), int(seg[i]))
    return best
def reach(H, T, V, target):
    """the index finger's pad onto target: every pose on a grid, nearest first, the first one clear of the rifle"""
    fi = 1; j = H.j0 + 3; tip = np.array(F['tips']['index' + H.sd]); dj = JP[j + 2]
    pad = dj + (tip - dj) * 0.62 + H.pn * 0.007
    A = grid((-20, 71, 4), (-10, 91, 4), (-10, 71, 5), (-6, 34, 3))
    R, t = H.chain(fi, A)[2]; pp = place(T, (R @ pad) + t); dist = np.linalg.norm(pp - target, axis=1)
    order = np.argsort(dist)[:3000]
    for c in range(0, len(order), 500):
        ii = order[c:c + 500]; X = H.pose_finger(fi, A[ii]); d = V.d(place(T, X.reshape(-1, 3))).reshape(len(ii), -1)
        ok = np.where(d.min(1) >= SKIN)[0]
        if len(ok): return A[ii[ok[0]]].tolist(), float(dist[ii[ok[0]]])
    return [0.0, 0.0, 0.0, 0.0], 1.0
FINGER_GRID = grid((-10, 91, 5), (0, 101, 5), (0, 81, 5))
THUMB_GRID = grid((-10, 51, 6), (-20, 71, 6), (-20, 71, 6), (-20, 41, 8))
show = lambda ang: {f: [round(float(np.degrees(x))) for x in ang[f]] for f in FN}

def one(c):
    """one placement: settle the hand, then fit every finger; returns (score, T, angles, tag)"""
    H, V, wraps, trigger = CTX
    T = H.frame_T(c['side'], c['pn'], c['at'], JP[H.j0 + 6])           # the middle finger's knuckle onto c['at']
    T, pushed = settle(H, T, V)
    palm = int((V.d(place(T, P[H.palm])) < TOUCH).sum())
    ang, sc, segs, miss = {}, 0.3 * palm, {}, 0.0
    for f in FN:
        if f == 'index' and trigger is not None: continue
        r = wrap(H, T, V, FN.index(f), THUMB_GRID if f == 'thumb' else FINGER_GRID)
        if r[0] < -1e8: r = (-500.0, [0.0, 0.0, 0.0, 0.0], 0)
        ang[f] = r[1]; segs[f] = r[2]; sc += r[0] if f in wraps else 0
    if trigger is not None: ang['index'], miss = reach(H, T, V, trigger); sc -= 15000 * miss
    print(H.sd, c['tag'], 'pushed', pushed, 'palm', palm, 'segments', segs, 'miss mm', round(miss * 1000, 1), 'score', round(sc), show(ang), flush=True)
    return sc, T, ang, c['tag']
CTX = None
def solve(H, V, cands, wraps, trigger=None):
    """wraps: the fingers that close round the rifle (the rest of the hand curls in clear of it). Placements run on every core
    (forked, so each worker shares the hand and the voxels). TAGS (comma-separated) keeps only the placements with those tags."""
    global CTX
    keep = [t for t in os.environ.get('TAGS', '').split(',') if t]
    if keep: cands = [c for c in cands if c['tag'] in keep] or cands
    CTX = (H, V, wraps, trigger)
    import multiprocessing as mp
    with mp.get_context('fork').Pool(min(len(cands), os.cpu_count() or 1)) as pool: res = pool.map(one, cands, chunksize=1)
    sc, T, ang, tag = max(res, key=lambda r: r[0])
    print('best', H.sd, tag, round(sc), show(ang), flush=True)
    return dict(score=sc, T=T, ang=ang, tag=tag)
def quats(H, ang):
    """each finger joint's turn in her rest space, as a quaternion (x, y, z, w): what the game sets on the joint (after its rest turn)"""
    out = []
    for fi, f in enumerate(FN):
        for k in range(3):
            R = rod(AX[H.j0 + fi * 3 + k], ang[f][k])
            if k == 0: R = R @ rod(H.spread_axis(fi), ang[f][3])
            w = np.sqrt(max(0.0, 1 + R[0, 0] + R[1, 1] + R[2, 2])) / 2
            q = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]]) / (4 * w)
            out.append([round(float(x), 5) for x in (*q, w)])
    return out

if __name__ == '__main__':
    out = {}
    X = np.array([1.0, 0, 0]); Y = np.array([0, 1.0, 0]); Z = np.array([0, 0, 1.0])
    # ---- right hand on the pistol grip
    HR = Hand('R'); ga = pts['gripTop'] - pts['gripBot']; ga /= np.linalg.norm(ga); ut = np.cross(-X, ga)
    VR = Vox(pts['gripTop'] + [-0.05, -0.14, -0.13], pts['gripTop'] + [0.07, 0.03, 0.09])
    # her gauntlet is about 50 mm thick, so the knuckle joints sit about 30 mm off the palm's skin: the middle knuckle goes that far
    # out from the grip's right side (22 mm), just in front of its front face (31 mm), so the finger bones can fold across the front
    # gamma tips the knuckle line off the grip's axis (negative lifts the fingers), so the index can reach level into the guard
    cands = [dict(tag=f'beta {b} gamma {gm} dx {dx} du {du} dv {dv}', side=rod(rod(ga, deg(b)) @ -X, deg(gm)) @ ga, pn=rod(ga, deg(b)) @ -X,
                  at=pts['gripTop'] - ga * dv + X * dx + ut * du)
             for b in (-20, -10, 0) for gm in (8, 0, -8, -16) for dx in (0.046, 0.054) for du in (0.028, 0.038, 0.048) for dv in (0.020, 0.026)]
    bR = solve(HR, VR, cands, ['middle', 'ring', 'little', 'thumb'], trigger=pts['trigger'] + [0, -0.002, -0.009])
    out['R'] = dict(T=bR['T'].round(6).tolist(), ang={f: [round(float(x), 4) for x in bR['ang'][f]] for f in FN}, q=quats(HR, bR['ang']), tag=bR['tag'])
    # ---- left hand under the handguard
    HL = Hand('L'); zc = pts['guard'][2]; bot = pts['guard'][1]
    VL = Vox([-0.09, bot - 0.09, zc - 0.13], [0.09, bot + 0.12, zc + 0.13])
    cands = [dict(tag=f'beta {b} dx {dx} dy {dy} dz {dz}', side=Z, pn=rod(Z, deg(b)) @ Y, at=np.array([dx, bot - dy, zc + dz]))
             for b in (-30, -15, 0) for dx in (0.044, 0.050, 0.056) for dy in (0.030, 0.036) for dz in (0.03, 0.0)]
    bL = solve(HL, VL, cands, ['middle', 'ring', 'little', 'index', 'thumb'])
    out['L'] = dict(T=bL['T'].round(6).tolist(), ang={f: [round(float(x), 4) for x in bL['ang'][f]] for f in FN}, q=quats(HL, bL['ang']), tag=bL['tag'])
    json.dump(out, open(OUT, 'w'), indent=1)
    print('wrote', OUT)
    if DBG:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from grip_preview import sheet
        sheet(DBG, RP, RI, [(H, b['T'], H.all_pts(b['ang'])) for H, b in ((HR, bR), (HL, bL))], IDX, pts, marks=[pts['trigger'] + [0, -0.002, -0.009]])
