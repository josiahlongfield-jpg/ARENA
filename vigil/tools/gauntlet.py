"""Gauntlet hands for the Vigil, modelled in place of the sculpt's. Tripo fused her fingers, so however the joints turned, a bent
hand only ever made a mitten. These are built from parts instead: a tapered capsule per finger bone with an armour plate over its
back (as the sculpt has), the palm lofted from rounded sections under a plate over the back of the hand and a ridge of studs across
the knuckles, and a collar closing the sculpt's wrist band. Every part is rigid on one joint, so a bent finger keeps its shape, and
each bone ends in a ball that sits inside the next bone's, so a joint never opens as it bends.

usage: python3 vigil/tools/gauntlet.py pack.json [out.json]      (vigil/assets/vigil_body.json or fp_arms.json; in place by default)
- the hand's frame: the wrist joint moves to the middle of the sculpt's wrist band (Tripo put the left one 35 mm off it), the
  fingers point straight down the forearm, and the palm faces the way the sculpt's did;
- the sculpt's hand goes, from just past the band; any finger weight left near the wrist goes back to the hand joint;
- the 30 finger joints move onto these hands, each with its flex axis (a positive turn curls it toward the palm), and the tips;
- `hands` holds the new geometry in rest space, triangles grouped by material (0 glove, 1 plate): positions as 16 bits over the box lo..lo+sc*65535,
  normals as bytes, and `j`, the one joint each vertex is rigid on.
Run it on the packs as body_fingers.py / fp_arms.py made them. Run again on its own output, it gives the same frames and joints, and
the same hands but for the collar, which follows the band's edge as last cut (a few mm).
"""
import base64, json, os, sys
import numpy as np

SRC = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else SRC
FN = ['thumb', 'index', 'middle', 'ring', 'little']
U_CUT = 9.0                     # mm past the band's middle where the sculpt's hand is cut away

# ---------------------------------------------------------------- the right hand's design, mm in the hand's frame:
# s across the hand (thumb side +), u along the fingers from the wrist, n through the palm (palm side +). The left is its mirror.
DIG = {   # base joint, direction, bone lengths (the last runs to the fingertip), radii at each joint and at the tip
    'thumb':  dict(j=(29, 14, 9), j2=(51, 51, 17), d=None, L=(45, 33, 27), r=(12.6, 11.2, 10.2, 9.0)),
    'index':  dict(j=(36, 79, -4), d=(0.05, 1, 0), L=(45, 28, 25), r=(10.8, 9.9, 9.0, 8.0)),
    'middle': dict(j=(13, 81, -5), d=(0.0, 1, 0), L=(48, 31, 26), r=(11.1, 10.2, 9.2, 8.2)),
    'ring':   dict(j=(-10, 78, -5), d=(-0.05, 1, 0), L=(45, 29, 25), r=(10.6, 9.7, 8.8, 7.9)),
    'little': dict(j=(-31, 71, -3), d=(-0.12, 1, 0), L=(36, 23, 22), r=(9.4, 8.6, 7.8, 7.1)),
}
nrm = lambda v: np.asarray(v, float) / np.linalg.norm(v)

def chains():
    """each digit's four points (three joints and the tip) and radii, right hand"""
    out = {}
    for f, d in DIG.items():
        p = [np.array(d['j'], float)]
        if f == 'thumb':        # the thumb bends at its base toward the index: its bones turn a little in the palm's plane as they go
            p.append(np.array(d['j2'], float)); a = nrm(p[1] - p[0])
            for k, L in enumerate(d['L'][1:]): a = nrm(a + np.array([0.04, 0.06, 0.03])); p.append(p[-1] + a * L)
        else:
            a = nrm(d['d'])
            for L in d['L']: p.append(p[-1] + a * L)
        out[f] = (np.array(p), np.array(d['r'], float))
    return out
CH = chains()
S_, U_, N_ = np.eye(3)

# ---------------------------------------------------------------- mesh building: parts in the right hand's mm frame
class Mesh:
    """parts, each rigid on one joint: -1 the hand, else finger index * 3 + bone; group 0 glove, 1 plate"""
    def __init__(s): s.parts = []
    def add(s, P, T, joint, group):
        P = np.asarray(P, float); T = np.asarray(T, int)
        n = np.zeros_like(P); fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
        for k in range(3): np.add.at(n, T[:, k], fn)
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        s.parts.append((P, n, T, joint, group))

def grid_tris(nu, nv, wrap_v=True):
    """triangles over a (nu, nv) grid of points, rows along u; v wraps round if wrap_v"""
    T = []
    for i in range(nu - 1):
        for j in range(nv if wrap_v else nv - 1):
            a, b, c, d = i * nv + j, i * nv + (j + 1) % nv, (i + 1) * nv + j, (i + 1) * nv + (j + 1) % nv
            T += [(a, c, b), (b, c, d)]
    return np.array(T)

def orient(P, T, out):
    """wind each face so its normal agrees with out (one direction per face)"""
    fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]]); flip = (fn * out).sum(1) < 0
    T = T.copy(); T[flip] = T[flip][:, [0, 2, 1]]; return T

def seg_frame(a, b, dorsal):
    d = nrm(b - a); e2 = nrm(dorsal - d * (dorsal @ d)); e1 = np.cross(e2, d); return d, e1, e2

def axis_out(P, T, a, d):
    """per face: outward from the line through a along d"""
    c = P[T].mean(1); x = (c - a) @ d; return c - (a + np.outer(x, d))

def capsule(a, b, ra, rb, dorsal, M=20, ex=1.0, ey=0.95, k0=1.0):
    """a tapered capsule from a (its ball shrunk by k0 so it nests inside the bone before) to b"""
    d, e1, e2 = seg_frame(a, b, dorsal); L = np.linalg.norm(b - a)
    prof = [(-ra * k0 * np.cos(ph), ra * k0 * np.sin(ph) + 1e-3) for ph in np.linspace(0, np.pi / 2, 7)[:-1]]
    prof += [(t * L, ra * (k0 + (1 - k0) * min(1, t * 4)) * (1 - t) + rb * t) for t in np.linspace(0, 1, 7)]
    prof += [(L + rb * np.sin(ph), rb * np.cos(ph) + 1e-3) for ph in np.linspace(0, np.pi / 2, 7)[1:]]
    th = np.linspace(0, 2 * np.pi, M, endpoint=False)
    P = np.array([a + d * x + (e1[None] * np.cos(th)[:, None] * ex + e2[None] * np.sin(th)[:, None] * ey) * r for x, r in prof]).reshape(-1, 3)
    T = grid_tris(len(prof), M)
    c = P[T].mean(1); return P, orient(P, T, c - (a + b) / 2)

def plate(outer, inner, mid, nx, nv, out_at):
    """a closed plate from three (nx * nv) sheets: its outer face, its inner face and the line where the chamfer meets the rim
    (all on the same grid); out_at(points) gives the outward direction of the sheet at each point"""
    To = grid_tris(nx, nv, False)
    ring = [(i, 0) for i in range(nx)] + [(nx - 1, j) for j in range(1, nv)] + [(i, nv - 1) for i in range(nx - 2, -1, -1)] + [(0, j) for j in range(nv - 2, 0, -1)]
    idx = [i * nv + j for i, j in ring]; R = len(idx); no = len(outer)
    P = np.vstack([outer, inner, inner[idx], mid[idx], mid[idx], outer[idx]]); b0 = 2 * no
    walls = []
    for k in range(R):
        k1 = (k + 1) % R
        for lo, hi in ((b0, b0 + R), (b0 + 2 * R, b0 + 3 * R)): walls += [(lo + k, lo + k1, hi + k), (lo + k1, hi + k1, hi + k)]
    walls = np.array(walls)
    To = orient(P, To, out_at(P[To].mean(1))); Ti = orient(P, To + no, -out_at(P[To + no].mean(1)))
    c = P[walls].mean(1); n = out_at(c); n = n / np.linalg.norm(n, axis=1, keepdims=True); wo = c - inner.mean(0); wo -= n * (wo * n).sum(1, keepdims=True)
    return P, np.vstack([To, Ti, orient(P, walls, wo)])

def bone_plate(a, b, r_of, dorsal, x0, x1, ang, thick=1.7, gap=0.3, nx=10, nv=9, ridge=0.5, bevel=0.7, p=4):
    """an armour plate over the back of a bone: a curved shell from x0 to x1 (mm along it), ang (radians) either side of its back,
    outlined as a rounded rectangle, with a low ridge down its middle and a chamfered rim"""
    d, e1, e2 = seg_frame(a, b, dorsal); xm, hx = (x0 + x1) / 2, (x1 - x0) / 2
    def sheet(add, inset, xin, rdg):
        out = []
        for x in np.linspace(x0 + xin, x1 - xin, nx):
            w = max(0.18, max(0.0, 1 - abs((x - xm) / hx) ** p) ** (1 / p))
            for v in np.linspace(-1, 1, nv):
                t = v * max(0.05, ang * w - inset / max(r_of(x), 1)); rr = r_of(x) + gap + add + rdg * np.cos(v * np.pi / 2) ** 6
                out.append(a + d * x + (e1 * np.sin(t) + e2 * np.cos(t) * 0.95) * rr)
        return np.array(out)
    out_at = lambda X: X - (a + np.outer((X - a) @ d, d))
    return plate(sheet(thick, bevel, bevel * 0.6, ridge), sheet(-0.6, 0, 0, 0), sheet(thick - bevel, 0, 0, 0), nx, nv, out_at)

def superellipse(M, E):
    th = np.linspace(0, 2 * np.pi, M, endpoint=False); c, sn = np.cos(th), np.sin(th)
    return np.sign(c) * np.abs(c) ** (2 / E), np.sign(sn) * np.abs(sn) ** (2 / E)

def loft(sections, M=32, E=2.6, cap0=True, cap1=True):
    """rings of superellipse sections (u, a, s0, n0, b_dorsal, b_palm, bump(s, u) -> extra palm depth), along u"""
    cs, ss = superellipse(M, E); rings = []
    for u, a, s0, n0, bd, bp, bump in sections:
        s = s0 + a * cs; b = np.where(ss > 0, bp + (bump(s, u) if bump else 0), bd); rings.append(np.c_[s, np.full(M, u), n0 + b * ss])
    P = np.vstack(rings); T = grid_tris(len(rings), M); ctr = np.array([r.mean(0) for r in rings])
    c = P[T].mean(1); axp = np.c_[np.interp(c[:, 1], ctr[:, 1], ctr[:, 0]), c[:, 1], np.interp(c[:, 1], ctr[:, 1], ctr[:, 2])]
    out = [c - axp]; Ts = [T]
    for on, ri, sg in ((cap0, 0, -1), (cap1, len(rings) - 1, 1)):
        if not on: continue
        ci = len(P); P = np.vstack([P, rings[ri].mean(0)]); base = ri * M
        Tc = np.array([(base + j, base + (j + 1) % M, ci) for j in range(M)]); Ts.append(Tc); out.append(np.tile([0, sg, 0], (len(Tc), 1)))
    T = np.vstack(Ts); return P, orient(P, T, np.vstack(out))

def rbox(c, half, r, M=5):
    """a rounded box: centre c, half sizes (s, u, n), edge radius r"""
    half = np.asarray(half, float); g = np.linspace(-1, 1, M); P, T = [], []
    for ax in range(3):
        for sg in (-1, 1):
            o = len(P)
            for i in g:
                for j in g:
                    v = np.zeros(3); v[ax] = sg; v[(ax + 1) % 3] = i; v[(ax + 2) % 3] = j
                    q = v * half; cl = np.clip(q, -(half - r), half - r); dl = q - cl; P.append(c + cl + r * dl / np.linalg.norm(dl))
            for i in range(M - 1):
                for j in range(M - 1):
                    a_, b_, c_, d_ = o + i * M + j, o + i * M + j + 1, o + (i + 1) * M + j, o + (i + 1) * M + j + 1; T += [(a_, c_, b_), (b_, c_, d_)]
    P = np.array(P); T = np.array(T); return P, orient(P, T, P[T].mean(1) - c)

def flex_axes():
    """each digit's flex axis (right hand): a positive turn about it brings the tip toward the palm"""
    ax = {}
    for f in FN:
        p, _ = CH[f]; d = nrm(p[2] - p[1])
        if f == 'thumb':      # the thumb closes across the palm toward the middle finger's knuckle
            ac = CH['middle'][0][0] - p[1]; ac -= d * (ac @ d); ax[f] = nrm(np.cross(d, ac))
        else: ax[f] = nrm(np.cross(d, N_))
    return ax
AXES = flex_axes()

PALM = [   # u, half width, centre s, centre n, dorsal half depth, palm half depth
    (2, 28, 2, 0, 14, 14), (12, 31, 3, 0, 14.5, 15), (26, 36, 4, -0.5, 14, 16), (42, 40, 3.5, -1, 13.5, 15.5),
    (56, 42, 3, -1.5, 13, 14.5), (66, 43, 3, -2, 12.5, 13.5), (73, 42, 3, -2.5, 11.5, 11.5), (78, 37, 3, -3, 8.5, 8), (81, 28, 3, -3, 4, 4)]
PE = 2.6
def palm_back(s, u):
    """the palm's dorsal surface (n) at (s, u)"""
    us = [p[0] for p in PALM]; a, s0, n0, bd = (np.interp(u, us, [p[i] for p in PALM]) for i in (1, 2, 3, 4))
    f = np.clip(np.abs((s - s0) / a), 0, 1); return n0 - bd * (1 - f ** PE) ** (1 / PE)

def build_right(collar):
    """the right gauntlet in its mm frame"""
    m = Mesh()
    for fi, f in enumerate(FN):
        p, r = CH[f]; dors = nrm(-np.cross(AXES[f], nrm(p[2] - p[1])))           # the back of the digit: away from where it curls
        for k in range(3):
            a, b = p[k], p[k + 1]; L = np.linalg.norm(b - a); ra, rb = r[k], r[k + 1]
            m.add(*capsule(a, b, ra, rb, dors, k0=0.95 if k else 1.0), fi * 3 + k, 0)
            # a plate per bone, as the sculpt has; the end bone's runs out toward the tip like a nail guard
            rof = lambda x, ra=ra, rb=rb, L=L: ra + (rb - ra) * np.clip(x / L, 0, 1)
            x0, x1, ang = (0.30 * L, 0.88 * L, 1.0) if f == 'thumb' and k == 0 else (0.16 * L, 0.82 * L, 1.05) if k == 2 else (0.17 * L, 0.84 * L, 1.1)
            m.add(*bone_plate(a, b, rof, dors, x0, x1, ang), fi * 3 + k, 1)
    # the palm: rounded sections from the wrist to the knuckles; the thenar and hypothenar pads swell the palm side
    bump = lambda s, u: 6 * np.exp(-((s - 24) / 14) ** 2 - ((u - 27) / 16) ** 2) + 3.5 * np.exp(-((s + 25) / 11) ** 2 - ((u - 22) / 18) ** 2)
    P, T = loft([sec + ((bump if sec[0] < 70 else None),) for sec in PALM], E=PE)
    # the knuckle line is lower on the little finger's side: pull the palm's end back to follow it
    ks = np.array([CH[f][0][0][0] for f in FN[1:]])[::-1]; ku = np.array([CH[f][0][0][1] for f in FN[1:]])[::-1]
    k = P[:, 1] > 62; line = np.interp(P[k, 0], ks, ku) + 2
    P[k, 1] = 62 + (P[k, 1] - 62) * (line - 62) / (81 - 62)
    m.add(P, T, -1, 0)
    # the plate over the back of the hand: follows the palm's back, a little domed, the rim chamfered
    nx, nv = 12, 15; us = np.linspace(10, 63, nx); um, hu = 36.5, 26.5
    def sheet(add, inset):
        out = []
        for u in us:
            w = max(0.3, (1 - abs((u - um) / hu) ** 4) ** 0.25); a, s0 = np.interp(u, [q[0] for q in PALM], [q[1] for q in PALM]), np.interp(u, [q[0] for q in PALM], [q[2] for q in PALM])
            for v in np.linspace(-1, 1, nv):
                s = s0 + v * (0.86 * a * w - inset); dome = 1.2 * (1 - ((u - um) / hu) ** 2)
                out.append((s, u + np.sign(u - um) * -inset * 0.5, palm_back(s, u) - 0.3 - add - dome * (add > 0)))
        return np.array(out)
    m.add(*plate(sheet(2.0, 0.9), sheet(-0.6, 0), sheet(1.3, 0), nx, nv, lambda X: np.c_[np.zeros(len(X)), np.zeros(len(X)), -np.ones(len(X))] + 0.02 * np.c_[X[:, 0], 0 * X[:, 0], 0 * X[:, 0]]), -1, 1)
    # the knuckle ridge: a stud over each knuckle, as the sculpt has
    for f in FN[1:]:
        j = CH[f][0][0]; r0 = CH[f][1][0]
        m.add(*rbox(j + np.array([0, -1.0, -(r0 + 3.9)]), (r0 * 0.62, 5.5, 2.4), 1.4), -1, 1)
    # the collar: from the sculpt's wrist band in to the glove's wrist
    cs_, ca, cb, cn = collar
    m.add(*loft([(U_CUT - 0.6, ca * 1.01, cs_, cn, cb * 1.01, cb * 1.01, None), (U_CUT + 1.2, ca * 0.97, cs_ * 0.95, cn * 0.95, cb * 0.96, cb * 0.96, None),
                 (9, 30, 2.5, -0.5, 15.5, 15.5, None), (14, 28.8, 2.8, 0, 13.6, 14, None)], E=2.0, cap0=False, cap1=False), -1, 0)
    return m

# ---------------------------------------------------------------- the pack
dec = lambda s, t: np.frombuffer(base64.b64decode(s), t)
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
A = json.load(open(SRC)); g = A['geo']; F = A['fingers']
fp = 'arm' in A
names = (A['arm'] + F['names']) if fp else A['joints']
P = dec(g['pos'], np.float32).reshape(-1, 3).astype(float); NV = len(P)
Nn = dec(g['nrm'], np.int8).reshape(-1, 3); UV = dec(g['uv'], np.uint16).reshape(-1, 2)
JI = dec(g['ji'], np.uint8).reshape(-1, 4).astype(int); JWt = dec(g['jw'], np.uint8).reshape(-1, 4).astype(float)
I = dec(g['idx'], np.uint32 if g['i32'] else np.uint16).astype(np.int64).reshape(-1, 3)
W = np.zeros((NV, len(names))); np.add.at(W, (np.repeat(np.arange(NV), 4), JI.ravel()), JWt.ravel() / 255)
FR = A['hand'] if fp else F['frames']
keepV = np.ones(NV, bool); frames = {}; collars = {}
for sd in 'LR':
    k = names.index('hd' + sd); fj = [names.index(f'{f}{b}{sd}') for f in FN for b in (1, 2, 3)]
    el = np.array(A['at']['el' + sd]); w0 = np.array(A['at']['hd' + sd])
    u0 = nrm(FR[sd]['u']); pn0 = nrm(FR[sd]['palm']); pn0 = nrm(pn0 - u0 * (pn0 @ u0))
    if 'band' not in FR[sd]:
        # the band's middle, from the sculpt (first run): the centre of the forearm's surface 2-6 mm short of the old wrist joint
        near = np.linalg.norm(P - w0, axis=1) < 0.075; uu = (P - w0) @ u0
        m = near & (uu > -0.006) & (uu < -0.002) & (W[:, k] + W[:, fj].sum(1) < 0.6)
        Q = P[m]; side0 = np.cross(u0, pn0)
        cen = w0 + u0 * -0.004 + side0 * ((Q - w0) @ side0).mean() + pn0 * 0.5 * (((Q - w0) @ pn0).min() + ((Q - w0) @ pn0).max())
        c2 = w0 + side0 * 0.5 * (((Q - w0) @ side0).min() + ((Q - w0) @ side0).max()) + pn0 * 0.5 * (((Q - w0) @ pn0).min() + ((Q - w0) @ pn0).max()) + u0 * -0.004
        FR[sd]['band'] = c2.tolist()
    W0 = np.array(FR[sd]['band']); u = nrm(W0 - el); pn = nrm(pn0 - u * (pn0 @ u)); side = np.cross(u, pn)
    frames[sd] = (W0, u, pn, side)
    X = P - W0; L = np.c_[X @ side, X @ u, X @ pn] * 1000
    if sd == 'L': L[:, 0] *= -1
    handw = W[:, k] + W[:, fj].sum(1)
    near = np.linalg.norm(X, axis=1) < 0.26
    beyond = near & (handw > 0.25) & (L[:, 1] > U_CUT)
    # triangles across the cut keep their far corners, pressed back onto the cut's plane, so the band ends in a clean edge
    across = beyond[I].any(1) & ~beyond[I].all(1); edge = np.zeros(NV, bool); edge[I[across].ravel()] = True; edge &= beyond
    # each goes onto the plane straight over the kept corner nearest it (so the band's wall runs on up to the cut, no flange)
    for t in I[across]:
        kept = [v for v in t if not beyond[v]]; far = [v for v in t if edge[v]]
        for v in far:
            k_ = min(kept, key=lambda q: np.linalg.norm(P[q] - P[v])); tgt = P[k_] + u * (U_CUT / 1000 - (P[k_] - W0) @ u)
            if not hasattr(P, '_done'): pass
            if (P[v] - W0) @ u > U_CUT / 1000 + 1e-7 or np.linalg.norm(P[v] - tgt) < 1e-9: P[v] = tgt
    keepV &= ~(beyond & ~edge)
    X = P - W0; L = np.c_[X @ side, X @ u, X @ pn] * 1000
    if sd == 'L': L[:, 0] *= -1
    # finger weight left near the wrist goes back to the hand
    W[:, k] += W[:, fj].sum(1); W[:, fj] = 0
    # the collar's base: the band's clean edge
    Q = L[edge] if edge.sum() > 8 else L[near & (L[:, 1] > U_CUT - 5) & (L[:, 1] <= U_CUT + 0.1)]
    collars[sd] = (0.5 * (Q[:, 0].min() + Q[:, 0].max()), 0.5 * (Q[:, 0].max() - Q[:, 0].min()), 0.5 * (Q[:, 2].max() - Q[:, 2].min()), 0.5 * (Q[:, 2].min() + Q[:, 2].max()))
    A['at']['hd' + sd] = [round(float(x), 5) for x in W0]
    FR[sd]['u'] = [round(float(x), 6) for x in u]; FR[sd]['palm'] = [round(float(x), 6) for x in pn]
    print(sd, 'wrist moved', round(float(np.linalg.norm(W0 - w0)) * 1000, 1), 'mm; cut', int((beyond & ~edge).sum()), 'sculpt vertices, edge', int(edge.sum()), '; collar s0 %.0f a %.0f b %.0f n0 %.0f' % collars[sd])
# drop the cut triangles and the vertices nothing uses
keepT = keepV[I].all(1); I = I[keepT]; used = np.unique(I); remap = -np.ones(NV, np.int64); remap[used] = np.arange(len(used))
P, Nn, UV, W = P[used], Nn[used], UV[used], W[used]; I = remap[I]
top = np.argsort(-W, 1)[:, :4]; tw = np.take_along_axis(W, top, 1); tw /= tw.sum(1, keepdims=True)
W8 = np.round(tw * 255); W8[:, 0] += 255 - W8.sum(1)
i32 = len(P) > 65535
g.update(n=len(P), pos=b64(P.astype(np.float32)), nrm=b64(Nn.astype(np.int8)), uv=b64(UV.astype(np.uint16)), ji=b64(top.astype(np.uint8)), jw=b64(W8.astype(np.uint8)),
         idx=b64(I.astype(np.uint32 if i32 else np.uint16)), i32=bool(i32))

# ---------------------------------------------------------------- the new hands, into her rest space
HP, HN, HJ, HI, HG = [], [], [], [], []; jpos, jax, tips = {}, {}, {}; o = 0
for sd in 'LR':
    W0, u, pn, side = frames[sd]; mir = -1.0 if sd == 'L' else 1.0
    toW = lambda X: W0 + (X[..., :1] * mir * side + X[..., 1:2] * u + X[..., 2:3] * pn) / 1000
    toD = lambda v: nrm(v[0] * mir * side + v[1] * u + v[2] * pn)
    k = names.index('hd' + sd)
    for Pp, Np, T, code, G in build_right(collars[sd]).parts:
        HP.append(toW(Pp)); HN.append(Np[:, :1] * mir * side + Np[:, 1:2] * u + Np[:, 2:3] * pn)
        HI.append((T[:, [0, 2, 1]] if sd == 'L' else T) + o); HG.append(np.full(len(T), G)); o += len(Pp)
        HJ.append(np.full(len(Pp), k if code < 0 else names.index(f'{FN[code // 3]}{code % 3 + 1}{sd}')))
    for f in FN:
        p, _ = CH[f]
        # a mirrored hand turns about the mirrored axis, negated (an axis is a pseudovector)
        for bn in range(3): jpos[f'{f}{bn + 1}{sd}'] = toW(p[bn]); jax[f'{f}{bn + 1}{sd}'] = toD(AXES[f]) * mir
        tips[f + sd] = toW(p[3])
HP = np.vstack(HP); HN = np.vstack(HN); HG = np.concatenate(HG); HI = np.vstack(HI); HJ = np.concatenate(HJ)
# triangles sorted by material so each is one draw range
order = np.argsort(HG, kind='stable'); HI = HI[order]; HG = HG[order]
groups = [[int(np.searchsorted(HG, gi)) * 3, int((HG == gi).sum()) * 3, int(gi)] for gi in (0, 1) if (HG == gi).any()]
Hn8 = np.clip(np.round(HN / np.maximum(np.linalg.norm(HN, axis=1, keepdims=True), 1e-9) * 127), -127, 127).astype(np.int8)
hi32 = len(HP) > 65535
# packed small (the room page is near its 16 MB limit): positions as 16 bits over their box, and one joint per vertex, since every part is rigid
lo = HP.min(0); sc = np.maximum(HP.max(0) - lo, 1e-6) / 65535
A['hands'] = dict(n=len(HP), lo=lo.tolist(), sc=sc.tolist(), pos=b64(np.round((HP - lo) / sc).astype(np.uint16)), nrm=b64(Hn8), j=b64(HJ.astype(np.uint8)),
                  idx=b64(HI.astype(np.uint32 if hi32 else np.uint16)), i32=bool(hi32), groups=groups, mats=['glove', 'plate'])
r5 = lambda v: [round(float(x), 5) for x in v]
F['pos'] = [r5(jpos[n]) for n in F['names']]; F['axis'] = [r5(jax[n]) for n in F['names']]; F['tips'] = {k_: r5(v) for k_, v in tips.items()}
open(OUT, 'w').write(json.dumps(A, separators=(',', ':')))
print(OUT, os.path.getsize(OUT) // 1024, 'KB; sculpt', len(P), 'verts; hands', len(HP), 'verts', len(HI), 'tris', groups)
