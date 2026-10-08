"""Finger joints and weights for the sculpt's hands, from the knuckles marked in vigil_hands.json.

Tripo fuses the fingers along their sides, so nothing in the mesh's topology tells them apart. Instead:
- each finger's joints come from the marks: the side and along positions as marked, the depth half way through the finger
  (a ray along the palm normal, first surface to second);
- the thumb is whatever lies nearest a thumb bone in 3D; the other four are told apart in the back view (nearest marked line),
  shared half and half across a few mm where two fingers are fused, so a bent finger stretches the seam rather than tearing it;
- along a finger, a vertex belongs to a segment by which side of each joint's bisecting plane it lies (blended over a few mm).
"""
import json
import numpy as np

FN = ['thumb', 'index', 'middle', 'ring', 'little']
BLEND = dict(thumb=[12, 5, 4], finger=[6, 4, 3.5])          # mm either side of each joint plane: base, middle, end
FEATHER = 3.0                                              # mm either side of the seam between two fused fingers


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def frame(h):
    w, u, pn = (np.array(h[k], float) for k in ('wrist', 'u', 'palm'))
    pn = pn - u * (pn @ u); pn /= np.linalg.norm(pn)
    return w, u, pn, np.cross(u, pn)


def ray_depths(L3, ss, aa):
    """Depths (palm axis, mm) where a ray along the palm normal through (side, along) crosses these triangles, back of the hand first."""
    x0, y0 = L3[:, 0, 0], L3[:, 0, 1]; x1, y1 = L3[:, 1, 0], L3[:, 1, 1]; x2, y2 = L3[:, 2, 0], L3[:, 2, 1]
    d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    with np.errstate(divide='ignore', invalid='ignore'):
        a = ((y1 - y2) * (ss - x2) + (x2 - x1) * (aa - y2)) / d
        b = ((y2 - y0) * (ss - x2) + (x0 - x2) * (aa - y2)) / d
    c = 1 - a - b; m = (a >= 0) & (b >= 0) & (c >= 0) & np.isfinite(a)
    n = np.sort(a[m] * L3[m, 0, 2] + b[m] * L3[m, 1, 2] + c[m] * L3[m, 2, 2])
    keep = n[:1].tolist()
    for v in n[1:]:
        if v - keep[-1] > 0.8: keep.append(v)            # the bake splits vertices at UV seams: one crossing can hit twice
    return keep


def seg_dist(X, a, b):
    d = b - a; t = np.clip(((X - a) @ d) / (d @ d), 0, 1)
    return np.linalg.norm(X - (a + t[:, None] * d), axis=1)


def poly_dist(Q, pts):
    return np.min([seg_dist(Q, a, b) for a, b in zip(pts[:-1], pts[1:])], axis=0)


def build_hand(P, I, hand, h):
    """P: vertices (game space), I: triangles (n, 3), hand: mask of vertices that follow the hand joint, h: this hand's entry in
    vigil_hands.json. Returns joints {finger: 4 x 3 world points}, flex axes, and per-hand-vertex weights."""
    w, u, pn, side = frame(h)
    toL = lambda X: np.c_[(X - w) @ side, (X - w) @ u, (X - w) @ pn] * 1000
    toW = lambda q: w + (q[..., :1] * side + q[..., 1:2] * u + q[..., 2:3] * pn) / 1000
    hv = np.where(hand)[0]; loc = toL(P[hv])
    L3 = toL(P[I[hand[I].all(1)]].reshape(-1, 3)).reshape(-1, 3, 3)
    J = {}
    for f in FN[1:]:
        pts = []
        for k, (ss, aa) in enumerate(h['marks'][f]):
            if k == 3:          # the tip: the vertex furthest along the finger near the mark
                near = np.hypot(loc[:, 0] - ss, loc[:, 1] - aa) < 9
                pts.append(loc[near][np.argmax(loc[near, 1])]); continue
            hits = ray_depths(L3, ss, aa)
            pts.append([ss, aa, (hits[0] + hits[1]) / 2 if len(hits) > 1 else hits[0]])
        J[f] = np.array(pts, float)
    J['thumb'] = np.array(h['marks']['thumb'], float)
    JW = {f: toW(J[f]) for f in FN}
    # a palm bone for each digit (part of the hand) so the palm isn't claimed by the nearest finger
    base = {f: w + (JW[f][0] - w) * (0.4 if f == 'thumb' else 0.25) for f in FN}
    X = P[hv]
    bones = [(f, 0, base[f], JW[f][0]) for f in FN] + [(f, k + 1, JW[f][k], JW[f][k + 1]) for f in FN for k in range(3)]
    near = np.argmin(np.stack([seg_dist(X, a, b) for _, _, a, b in bones], 1), 1)
    thumbv = np.array([bones[i][0] == 'thumb' and bones[i][1] > 0 for i in near])
    # the four fingers by the back view, feathered across fused sides
    D2 = np.stack([poly_dist(loc[:, :2], np.vstack([J[f][:1, :2] - [0, 60], J[f][:, :2]])) for f in FN[1:]], 1)
    o = np.argsort(D2, 1); d1 = np.take_along_axis(D2, o[:, :1], 1)[:, 0]; d2 = np.take_along_axis(D2, o[:, 1:2], 1)[:, 0]
    g = sstep(-FEATHER, FEATHER, d2 - d1) * 0.5 + 0.5
    share = np.zeros((len(hv), 5)); r = np.arange(len(hv))
    share[r, 1 + o[:, 0]] = g; share[r, 1 + o[:, 1]] = 1 - g
    share[thumbv] = 0; share[thumbv, 0] = 1
    Wf = np.zeros((len(hv), 5, 3)); axes = {}
    for fi, f in enumerate(FN):
        ch = JW[f]
        dirs = [ch[0] - base[f]] + [ch[k + 1] - ch[k] for k in range(3)]; dirs = [d / np.linalg.norm(d) for d in dirs]
        sk = [sstep(-bw / 1000, bw / 1000, (X - ch[k]) @ ((dirs[k] + dirs[k + 1]) / np.linalg.norm(dirs[k] + dirs[k + 1])))
              for k, bw in enumerate(BLEND['thumb' if f == 'thumb' else 'finger'])]
        Wf[:, fi] = np.stack([sk[0] * (1 - sk[1]), sk[1] * (1 - sk[2]), sk[2]], 1) * share[:, fi:fi + 1]
        # flex axis, signed so a positive turn brings the tip toward the palm; the finger's own curl plane where it is curled
        flat = np.cross(dirs[1], pn); ax = np.cross(dirs[1], dirs[3])
        ax = ax if np.linalg.norm(ax) > 0.3 else flat
        if f == 'thumb':        # the thumb closes across the palm, toward the middle finger's knuckle
            ac = JW['middle'][0] - ch[1]; ac -= dirs[2] * (ac @ dirs[2]); ax = np.cross(dirs[2], ac); flat = ax
        ax = ax / np.linalg.norm(ax)
        axes[f] = ax if ax @ flat >= 0 else -ax
    return dict(hv=hv, joints=JW, axes=axes, Wf=Wf, frame=dict(u=u, palm=pn, side=side))
