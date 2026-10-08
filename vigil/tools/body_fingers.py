"""Give the packed Vigil body (vigil_pack.py's vigil_rig.json, 60k) the same finger joints as the first-person arms (hands.py),
so a whole-body Vigil can close her hands round the rifle too.

usage: python3 vigil/tools/body_fingers.py rpg/assets/vigil_rig.json vigil/assets/vigil_body.json
The 30 finger joints go after the body's 17 (thumb, index, middle, ring, little; three each; left hand first), and each takes its
share out of its hand's weight. The rest of the file is copied as it is.
"""
import base64, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hands import build_hand, FN

SRC, OUT = sys.argv[1:3]
A = json.load(open(SRC)); g = A['geo']
dec = lambda s, t: np.frombuffer(base64.b64decode(s), t)
P = dec(g['pos'], np.float32).reshape(-1, 3).astype(float); NV = len(P)
I = dec(g['idx'], np.uint32 if g['i32'] else np.uint16).astype(np.int64).reshape(-1, 3)
JI = dec(g['ji'], np.uint8).reshape(-1, 4).astype(int); JW = dec(g['jw'], np.uint8).reshape(-1, 4) / 255
NB = len(A['joints']); W = np.zeros((NV, NB + 30)); np.add.at(W, (np.repeat(np.arange(NV), 4), JI.ravel()), JW.ravel())
HJ = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vigil_hands.json')))
names, pos, parent, axis, tips = [], [], [], [], {}
HW = W.copy()
for sd in 'LR':
    k = A['joints'].index('hd' + sd); H = build_hand(P, I, W[:, k] > 0.5, HJ[sd])
    for fi, f in enumerate(FN):
        j0 = NB + len(names)
        for kj in range(3):
            names.append(f'{f}{kj + 1}{sd}'); pos.append(H['joints'][f][kj]); parent.append(k if kj == 0 else j0 + kj - 1); axis.append(H['axes'][f])
        tips[f + sd] = H['joints'][f][3]
        ws = H['Wf'][:, fi]; hv = H['hv']
        W[hv, k] -= HW[hv, k] * ws.sum(1); W[hv, j0:j0 + 3] += HW[hv, k][:, None] * ws
    print(sd, 'hand vertices', len(H['hv']))
top = np.argsort(-W, 1)[:, :4]; tw = np.take_along_axis(W, top, 1); tw /= tw.sum(1, keepdims=True)
W8 = np.round(tw * 255); W8[:, 0] += 255 - W8.sum(1)
b64 = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
g['ji'] = b64(top.astype(np.uint8)); g['jw'] = b64(W8.astype(np.uint8))
r5 = lambda v: [round(float(x), 5) for x in v]
A['joints'] = A['joints'] + names
A['fingers'] = dict(names=names, pos=[r5(p) for p in pos], parent=parent, axis=[r5(a) for a in axis], tips={k_: r5(v) for k_, v in tips.items()},
                    frames={sd: dict(u=HJ[sd]['u'], palm=HJ[sd]['palm']) for sd in 'LR'})
open(OUT, 'w').write(json.dumps(A, separators=(',', ':')))
print(OUT, os.path.getsize(OUT) // 1024, 'KB,', len(A['joints']), 'joints')
