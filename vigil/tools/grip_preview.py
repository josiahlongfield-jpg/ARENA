"""Quick look at grip_solve.py's result without a browser: the rifle and both posed hands, from four sides, by a tiny z-buffer."""
import numpy as np
from PIL import Image

def rast(P, I, col, right, up, W, H, scale, centre):
    right = right / np.linalg.norm(right); up = up - right * (up @ right); up /= np.linalg.norm(up); fwd = np.cross(right, up)
    X = (P - centre) @ right * scale + W / 2; Y = H / 2 - (P - centre) @ up * scale; Z = (P - centre) @ fwd
    img = np.full((H, W, 3), 245.0); zb = np.full((H, W), -1e9)
    n = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    sh = 0.35 + 0.65 * np.abs(n @ fwd)
    for t, s_ in zip(I, sh):
        xs, ys, zs = X[t], Y[t], Z[t]
        x0, x1 = int(max(0, np.floor(xs.min()))), int(min(W - 1, np.ceil(xs.max()))); y0, y1 = int(max(0, np.floor(ys.min()))), int(min(H - 1, np.ceil(ys.max())))
        if x0 > x1 or y0 > y1: continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(d) < 1e-9: continue
        a = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / d; b = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / d
        c = 1 - a - b; m = (a >= 0) & (b >= 0) & (c >= 0)
        if not m.any(): continue
        z = a * zs[0] + b * zs[1] + c * zs[2]; sub = zb[y0:y1 + 1, x0:x1 + 1]; upd = m & (z > sub); sub[upd] = z[upd]
        img[y0:y1 + 1, x0:x1 + 1][upd] = (col[t[0]] + col[t[1]] + col[t[2]]) / 3 * s_
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))

PAL = np.array([[150, 150, 150], [230, 70, 70], [70, 200, 70], [70, 110, 235], [235, 200, 50], [200, 70, 220]], float)
def sheet(path, RP, RI, hands, IDX, pts, size=420, marks=(), scale=1500):
    """hands: [(Hand, T, posed rest-space points of H.hv)]; one row per hand, four views round its grip"""
    rows = []
    for H, T, Xp in hands:
        Xs = Xp @ T[:3, :3].T + T[:3, 3]
        hm = np.zeros(IDX.max() + 1, bool); hm[H.hv] = True; tri = IDX[hm[IDX].all(1)]
        re = -np.ones(len(hm), int); re[H.hv] = np.arange(len(H.hv))
        Pa = np.vstack([RP, Xs])
        fid = np.zeros(len(H.hv), int)
        for fi in range(5): fid[H.fm[fi]] = fi + 1
        col = np.vstack([np.full((len(RP), 3), 185.0), PAL[fid]])
        c = Xs.mean(0)
        near = (np.linalg.norm(RP[RI].mean(1) - c, axis=1) < 0.16); Ia = np.vstack([RI[near], re[tri] + len(RP)])
        for m in marks:      # a small red block at each mark (the trigger target)
            o = len(Pa); q = 0.003; Pa = np.vstack([Pa, m + np.array([[-q, -q, -q], [q, -q, -q], [-q, q, -q], [-q, -q, q]])])
            Ia = np.vstack([Ia, [[o, o + 1, o + 2], [o, o + 1, o + 3], [o, o + 2, o + 3], [o + 1, o + 2, o + 3]]]); col = np.vstack([col, np.full((4, 3), [255.0, 0, 0])])
        views = [((0, 0, -1), (0, 1, 0)), ((0, 0, 1), (0, 1, 0)), ((1, 0, 0), (0, 1, 0)), ((0, 0, -1), (1, 0, 0))]
        ims = [rast(Pa, Ia, col, np.array(r, float), np.array(u, float), size, size, scale, c) for r, u in views]
        row = Image.new('RGB', (size * 4, size), 'white')
        for i, im in enumerate(ims): row.paste(im, (i * size, 0))
        rows.append(row)
    out = Image.new('RGB', (size * 4, size * len(rows)), 'white')
    for i, r in enumerate(rows): out.paste(r, (0, i * size))
    out.save(path)
