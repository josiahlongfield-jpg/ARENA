"""A vertical foregrip under the rifle's handguard, for her left hand (the user asked for one): a rounded grip, a little raked
forward, with three shallow rings and a flared foot, on a clamp with two cross bolts. Added to the packed rifle as two more parts,
'fore' (polymer) and 'clamp' (metal), in rifle_pack.py's chunk format, plus the points the grip solver and the game use.

usage: python3 vigil/tools/foregrip.py vigil/assets/rifle.js      (in place; running it again replaces the grip)
Rifle frame (rifle_pack.py): metres, muzzle -Z, top +Y, right side +X, origin at the rear sight. The handguard's underside is at
y -0.1687 from z -0.32 to -0.22, and a rail runs under it from z -0.31 to -0.45 (bottom y -0.161): the clamp sits on
the rail's rear end.
"""
import base64, json, sys
import numpy as np

PATH = sys.argv[1]
src = open(PATH).read(); head, tail = src[:src.index('{')], src[src.rindex('}') + 1:]
R = json.loads(src[src.index('{'):src.rindex('}') + 1])
TOP = np.array([0, -0.166, -0.333]); BOT = np.array([0, -0.277, -0.343])       # the grip's axis: 11 cm, raked 5 degrees forward
RX, RZ, E = 0.0158, 0.0176, 2.4                                                  # half width, half depth, squareness of its section
nrm = lambda v: v / np.linalg.norm(v)

def grid_tris(nu, nv):
    T = []
    for i in range(nu - 1):
        for j in range(nv):
            a, b, c, d = i * nv + j, i * nv + (j + 1) % nv, (i + 1) * nv + j, (i + 1) * nv + (j + 1) % nv
            T += [(a, b, c), (b, d, c)]
    return np.array(T)
def orient(P, T, out):
    fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]]); f = (fn * out).sum(1) < 0; T = T.copy(); T[f] = T[f][:, [0, 2, 1]]; return T
def normals(P, T):
    n = np.zeros_like(P); fn = np.cross(P[T[:, 1]] - P[T[:, 0]], P[T[:, 2]] - P[T[:, 0]])
    for k in range(3): np.add.at(n, T[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)

def grip():
    ax = nrm(BOT - TOP); L = np.linalg.norm(BOT - TOP); ex = np.array([1.0, 0, 0]); ez = nrm(np.cross(ex, ax))     # ez: toward the muzzle side
    M = 40; th = np.linspace(0, 2 * np.pi, M, endpoint=False); c, s = np.cos(th), np.sin(th)
    cs, ss = np.sign(c) * np.abs(c) ** (2 / E), np.sign(s) * np.abs(s) ** (2 / E)
    def k(t):      # the section's size down the grip: slim under the clamp, full in the hand, three shallow rings, a flared foot
        base = np.interp(t, [0, 0.12, 0.45, 0.8, 0.9, 0.95, 1.0], [0.9, 0.97, 1.02, 1.0, 1.02, 1.16, 1.16])
        ring = sum(0.035 * np.exp(-((t - r) / 0.012) ** 2) for r in (0.3, 0.5, 0.7))
        return base - ring
    ts = np.concatenate([np.linspace(0, 0.9, 46), np.linspace(0.905, 1.0, 10)])
    rings = [TOP + ax * (t * L) + (np.outer(cs, ex) * RX + np.outer(ss, ez) * RZ) * k(t) for t in ts]
    # the foot: a rounded underside closing the bottom
    for f in np.linspace(0.15, 1, 6): rings.append(BOT + ax * 0.004 * np.sin(f * np.pi / 2) + (np.outer(cs, ex) * RX + np.outer(ss, ez) * RZ) * 1.16 * np.cos(f * np.pi / 2) ** 0.6)
    P = np.vstack(rings); T = grid_tris(len(rings), M)
    ci = len(P); P = np.vstack([P, BOT + ax * 0.004]); last = (len(rings) - 1) * M; T = np.vstack([T, [(last + j, last + (j + 1) % M, ci) for j in range(M)]])
    ci2 = len(P); P = np.vstack([P, TOP]); T = np.vstack([T, [(j, (j + 1) % M, ci2) for j in range(M)]])
    c_ = P[T].mean(1); x = (c_ - TOP) @ ax; out = c_ - (TOP + np.outer(np.clip(x, 0, L), ax))
    out[len(T) - M:] = -ax; out[len(T) - 2 * M:len(T) - M] = ax
    return P, orient(P, T, out)

def rbox(c, half, r, M=6):
    half = np.asarray(half, float); g = np.linspace(-1, 1, M); P, T = [], []
    for a in range(3):
        for sg in (-1, 1):
            o = len(P)
            for i in g:
                for j in g:
                    v = np.zeros(3); v[a] = sg; v[(a + 1) % 3] = i; v[(a + 2) % 3] = j
                    q = v * half; cl = np.clip(q, -(half - r), half - r); dl = q - cl; P.append(c + cl + r * dl / np.linalg.norm(dl))
            for i in range(M - 1):
                for j in range(M - 1):
                    p0, p1, p2, p3 = o + i * M + j, o + i * M + j + 1, o + (i + 1) * M + j, o + (i + 1) * M + j + 1; T += [(p0, p2, p1), (p1, p2, p3)]
    P = np.array(P); T = np.array(T); return P, orient(P, T, P[T].mean(1) - c)

def cyl(c, ax, r, h, M=14):
    ax = nrm(np.asarray(ax, float)); e1 = nrm(np.cross(ax, [0, 1, 0] if abs(ax[1]) < 0.9 else [1, 0, 0])); e2 = np.cross(ax, e1)
    th = np.linspace(0, 2 * np.pi, M, endpoint=False); ring = np.outer(np.cos(th), e1) * r + np.outer(np.sin(th), e2) * r
    P = np.vstack([c - ax * h / 2 + ring, c + ax * h / 2 + ring, [c - ax * h / 2, c + ax * h / 2]]); T = grid_tris(2, M)
    T = np.vstack([T, [(j, (j + 1) % M, 2 * M) for j in range(M)], [(M + j, M + (j + 1) % M, 2 * M + 1) for j in range(M)]])
    cc = P[T].mean(1); out = cc - c; return P, orient(P, T, out)

def merge(parts):
    P, T, o = [], [], 0
    for p, t in parts: P.append(p); T.append(t + o); o += len(p)
    return np.vstack(P), np.vstack(T)

def pack(P, T):
    """rifle_pack.py's format: 16-bit positions over the part's box, normals as bytes, no UVs (these parts are untextured)"""
    N = normals(P, T); lo = P.min(0); sc = np.maximum(P.max(0) - lo, 1e-6) / 65535
    q = np.round((P - lo) / sc).astype(np.uint16); b = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
    return dict(lo=lo.tolist(), sc=sc.tolist(), chunks=[dict(n=len(P), pos=b(q), nrm=b(np.clip(np.round(N * 127), -127, 127).astype(np.int8)),
                uv=b(np.zeros((len(P), 2), np.uint16)), idx=b(T.astype(np.uint16)))])

zc = TOP[2]
fore = grip()
clamp = merge([rbox(np.array([0, -0.1660, zc]), (0.0172, 0.0052, 0.026), 0.002)] +
              [cyl(np.array([0, -0.1664, zc + dz]), (1, 0, 0), 0.0032, 0.0405) for dz in (-0.015, 0.015)] +
              [cyl(np.array([sx * 0.0207, -0.1664, zc + dz]), (1, 0, 0), 0.0046, 0.0022, 6) for dz in (-0.015, 0.015) for sx in (-1, 1)])
R['fore'] = pack(*fore); R['clamp'] = pack(*clamp)
R['pts'].update(foreTop=[round(float(x), 5) for x in TOP], foreBot=[round(float(x), 5) for x in BOT], foreHalf=[RX, RZ])
open(PATH, 'w').write(head + json.dumps(R, separators=(',', ':')) + tail)
print('foregrip', len(fore[0]), 'verts; clamp', len(clamp[0]), 'verts ->', PATH)
