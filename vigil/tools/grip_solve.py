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
- left: on the vertical foregrip (foregrip.py), palm on its left side and thumb up, the fingers round its front to the right.
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
if 'hands' in A:      # gauntlet.py's modelled hands: their own geometry, skinned to the same joints
    h = A['hands']; IDX = np.vstack([IDX, dec(h['idx'], np.uint32 if h['i32'] else np.uint16).astype(int).reshape(-1, 3) + NV])
    hj = dec(h['j'], np.uint8).astype(int); P = np.vstack([P, np.array(h['lo']) + dec(h['pos'], np.uint16).reshape(-1, 3) * np.array(h['sc'])])
    JI = np.vstack([JI, np.stack([hj] + [np.zeros_like(hj)] * 3, 1)]); JW = np.vstack([JW, np.repeat([[1.0, 0, 0, 0]], len(hj), 0)]); NV = len(P)
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
RP, RI = rifle_geo('body')
for part in ('mag', 'fore', 'clamp'):
    if part in RF: MP, MI = rifle_geo(part); RI = np.vstack([RI, MI + len(RP)]); RP = np.vstack([RP, MP])
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
def wrap(H, T, V, fi, thumb, far=None):
    """the best grasp for finger fi: a coarse grid, then twice finer round five of its best that differ (a good grasp can sit in a
    pocket the coarse grid only grazes, so the seeds come from different poses, not five neighbours; see best_pose)"""
    G = THUMB_GRID if thumb else FINGER_GRID; top = best_pose(H, T, V, fi, G[0], 80, far)
    if top[0][0] < -1e8: return best_pose(H, T, V, fi, G[1], 3, far)[0]   # nothing clear on the coarse grid: the whole fine one
    seeds = []
    for r in top:
        if r[0] > -1e8 and all(np.abs(np.degrees(r[1] - q[1])).max() > 1.5 * G[2] for q in seeds): seeds.append(r)
        if len(seeds) == 5: break
    best = seeds
    for step in (G[2], G[2] / 2):
        A = np.vstack([around(a, step, thumb) for _, a, _ in best]); best = sorted(best + best_pose(H, T, V, fi, A, 5, far), key=lambda r: -r[0])[:5]
    return best[0]
def around(a, step, thumb):
    """poses within a step of a (the spread too, for the thumb), every half step, inside the grid's bounds"""
    o = np.radians(np.arange(-1, 1.01, 0.5) * step); lo, hi = THUMB_BOUNDS if thumb else FINGER_BOUNDS
    g = np.meshgrid(*[a[k] + (o if k < 3 or thumb else np.zeros(1)) for k in range(4)], indexing='ij')
    return np.clip(np.unique(np.stack([x.ravel() for x in g], 1).round(6), axis=0), lo, hi)
def best_pose(H, T, V, fi, A, k=3, far=None):
    """the k best poses in A for finger fi, scored as a grasp: each of its three segments touching the rifle, as many vertices in
    contact as can be, curled rather than straight, the end joint following the middle one as a real finger's does; never into the rifle.
    far (a point and a direction): the end segment is wanted across that plane and touching, as a thumb that wraps round to the grip's far side"""
    out = []
    for c in range(0, len(A), 1500):
        a = A[c:c + 1500]; X = H.pose_finger(fi, a); n = X.shape[1]
        d = V.d(place(T, X.reshape(-1, 3))).reshape(len(a), n)
        own = H.dom[H.fi_v[fi]]; ok = d.min(1) >= SKIN
        seg = sum(((d < TOUCH) & (own == fi * 3 + k)[None]).any(1) for k in range(3))
        sc = 12 * seg + 0.25 * (d < TOUCH).sum(1) + 0.04 * np.degrees(a[:, :3].sum(1)) - 0.08 * np.abs(np.degrees(a[:, 2] - 0.67 * a[:, 1]))
        if far is not None:
            end = own == fi * 3 + 2; Xw = place(T, X[:, end].reshape(-1, 3)).reshape(len(a), -1, 3).mean(1)
            hold = ((d < TOUCH) & end[None]).any(1)      # only a thumb that lies on the far side counts, not one held out into the air
            sc = sc + 30 * np.clip(((Xw - far[0]) @ far[1]) / 0.012, 0, 1) * hold
        sc = np.where(ok, sc, -1e9)
        for i in np.argsort(-sc)[:k]: out.append((float(sc[i]), np.asarray(a[i], float), int(seg[i])))
    return sorted(out, key=lambda r: -r[0])[:k]
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
# each: the coarse grid, the whole fine one (if nothing on the coarse one is clear) and the coarse step in degrees; and the bounds
FINGER_GRID = (grid((-10, 91, 10), (0, 101, 10), (0, 81, 10)), grid((-10, 91, 5), (0, 101, 5), (0, 81, 5)), 10)
THUMB_GRID = (grid((-30, 61, 12), (-20, 71, 12), (-20, 71, 12), (-60, 41, 10)), grid((-30, 61, 6), (-20, 71, 6), (-20, 71, 6), (-60, 41, 8)), 12)
FINGER_BOUNDS = (np.radians([-10, 0, 0, 0]), np.radians([90, 100, 80, 0]))
THUMB_BOUNDS = (np.radians([-30, -20, -20, -60]), np.radians([60, 70, 70, 40]))      # wide enough for the thumb to wrap behind a grip
show = lambda ang: {f: [round(float(np.degrees(x))) for x in ang[f]] for f in FN}

def one(c):
    """one placement: settle the hand, then fit every finger; returns (score, T, angles, tag)"""
    H, V, wraps, trigger, far = CTX
    T = H.frame_T(c['side'], c['pn'], c['at'], JP[H.j0 + 6])           # the middle finger's knuckle onto c['at']
    T, pushed = settle(H, T, V)
    palm = int((V.d(place(T, P[H.palm])) < TOUCH).sum())
    ang, sc, segs, miss = {}, 0.3 * palm, {}, 0.0
    for f in FN:
        if f == 'index' and trigger is not None: continue
        r = wrap(H, T, V, FN.index(f), f == 'thumb', far if f == 'thumb' else None)
        if r[0] < -1e8: r = (-500.0, np.zeros(4), 0)
        ang[f] = np.asarray(r[1], float).tolist(); segs[f] = r[2]; sc += r[0] if f in wraps else 0
    if trigger is not None: ang['index'], miss = reach(H, T, V, trigger); sc -= 15000 * miss
    print(H.sd, c['tag'], 'pushed', pushed, 'palm', palm, 'segments', segs, 'miss mm', round(miss * 1000, 1), 'score', round(sc), show(ang), flush=True)
    return sc, T, ang, c['tag']
CTX = None
def solve(H, V, cands, wraps, trigger=None, far=None):
    """wraps: the fingers that close round the rifle (the rest of the hand curls in clear of it). Placements run on every core
    (forked, so each worker shares the hand and the voxels). TAGS (comma-separated) keeps only the placements with those tags."""
    global CTX
    keep = [t for t in os.environ.get('TAGS', '').split(',') if t]
    if keep: cands = [c for c in cands if c['tag'] in keep] or cands
    CTX = (H, V, wraps, trigger, far)
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
    # ONLY=R or ONLY=L refits one hand and keeps the other from out.json as it is
    ONLY = os.environ.get('ONLY'); out = json.load(open(OUT)) if ONLY and os.path.exists(OUT) else {}
    kept = lambda s: dict(T=np.array(out[s]['T']), ang={f: np.array(out[s]['ang'][f]) for f in FN}, tag=out[s]['tag'])
    X = np.array([1.0, 0, 0]); Y = np.array([0, 1.0, 0]); Z = np.array([0, 0, 1.0])
    # ---- right hand on the pistol grip
    HR = Hand('R'); ga = pts['gripTop'] - pts['gripBot']; ga /= np.linalg.norm(ga); ut = np.cross(-X, ga)
    VR = Vox(pts['gripTop'] + [-0.05, -0.14, -0.13], pts['gripTop'] + [0.07, 0.03, 0.09])
    # the gauntlet's knuckle joints sit about 17 mm off the palm's skin (gauntlet.py): the middle knuckle goes that far out from the
    # grip's right side (22 mm), about level with its front face, so the finger bones can fold across the front
    # gamma tips the knuckle line off the grip's axis (negative lifts the fingers), so the index can reach level into the guard
    # RGRID / LGRID (env, 'a,b/c,d/...' in the order of the loops below) search a finer grid round a fit already found
    gr = lambda k, d: [[float(x) for x in a.split(',')] for a in os.environ[k].split('/')] if os.environ.get(k) else d
    Bs, GMs, DXs, DUs, DVs = gr('RGRID', [(-15, -5), (-8, -16), (0.036, 0.040, 0.044), (0.020, 0.028, 0.036), (0.020, 0.028)])
    cands = [dict(tag=f'beta {b:g} gamma {gm:g} dx {dx:g} du {du:g} dv {dv:g}', side=rod(rod(ga, deg(b)) @ -X, deg(gm)) @ ga, pn=rod(ga, deg(b)) @ -X,
                  at=pts['gripTop'] - ga * dv + X * dx + ut * du)
             for b in Bs for gm in GMs for dx in DXs for du in DUs for dv in DVs]
    # the thumb wraps round behind the grip to its left side, as in the user's reference (hand_refs/), not forward along its right
    bR = kept('R') if ONLY == 'L' else solve(HR, VR, cands, ['middle', 'ring', 'little', 'thumb'], trigger=pts['trigger'] + [0, -0.002, -0.009], far=(np.zeros(3), -X))
    if ONLY != 'L': out['R'] = dict(T=bR['T'].round(6).tolist(), ang={f: [round(float(x), 4) for x in bR['ang'][f]] for f in FN}, q=quats(HR, bR['ang']), tag=bR['tag'])
    # ---- left hand on the vertical foregrip (foregrip.py): palm on its left side, thumb up toward the handguard, the fingers round
    # its front to the right side; the left hand's thumb is on the -side of its frame, so side points down the grip
    HL = Hand('L'); fa = pts['foreTop'] - pts['foreBot']; fa /= np.linalg.norm(fa); fw = np.cross(X, -fa); fw /= np.linalg.norm(fw)
    zc = pts['foreTop'][2]
    VL = Vox([-0.075, pts['foreBot'][1] - 0.04, zc - 0.10], [0.075, pts['foreTop'][1] + 0.05, zc + 0.10])
    Bs, GMs, DXs, DUs, DVs = gr('LGRID', [(-10, 10), (0, 10), (0.030, 0.034, 0.038), (0.010, 0.018), (0.032, 0.040)])
    cands = [dict(tag=f'beta {b:g} gamma {gm:g} dx {dx:g} du {du:g} dv {dv:g}', side=rod(rod(fa, deg(b)) @ X, deg(gm)) @ -fa, pn=rod(fa, deg(b)) @ X,
                  at=pts['foreTop'] - fa * dv - X * dx + fw * du)
             for b in Bs for gm in GMs for dx in DXs for du in DUs for dv in DVs]
    # a fist: the thumb wraps round behind the grip toward its right side, over the fingers' ends
    bL = kept('L') if ONLY == 'R' else solve(HL, VL, cands, ['index', 'middle', 'ring', 'little', 'thumb'], far=(pts['foreTop'], X) if os.environ.get('LFAR', '1') == '1' else None)
    if ONLY != 'R': out['L'] = dict(T=bL['T'].round(6).tolist(), ang={f: [round(float(x), 4) for x in bL['ang'][f]] for f in FN}, q=quats(HL, bL['ang']), tag=bL['tag'], on='fore')
    json.dump(out, open(OUT, 'w'), indent=1)
    print('wrote', OUT)
    if DBG:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from grip_preview import sheet
        sheet(DBG, RP, RI, [(H, b['T'], H.all_pts(b['ang'])) for H, b in ((HR, bR), (HL, bL))], IDX, pts, marks=[pts['trigger'] + [0, -0.002, -0.009]])
