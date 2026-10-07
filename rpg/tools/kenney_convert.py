"""Bake the Kenney GLB props the world uses into one small JSON for inlining.

Each model becomes indexed positions (int16, scaled), per-vertex colours and a surface class.
The colours come from Kenney's colormap (or the material colour for the nature kit) and are
re-coloured into the world's palette: Kenney's lilac stone, orange wood and blue roofs would
look like a toy box next to scanned textures. The class (stone, wood, metal, cloth, plain)
picks which real texture the game lays over that surface.

usage: python3 tools/kenney_convert.py <cc0-world/models dir> assets/kenney.json
"""
import base64, colorsys, json, struct, sys
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]

# surface class -> (palette colour, detail texture index: 0 stone, 1 wood, 2 metal, 3 cloth, 4 none)
PAL = {
    'stone': (0x7e786e, 0), 'sand': (0x8e8676, 0), 'bone': (0xcfc6b2, 0), 'wood': (0x5e4834, 1),
    'iron': (0x34312e, 2), 'roof': (0x2c2a2e, 2), 'gold': (0x8a7440, 2), 'red': (0x5e1a16, 3),
    'canvas': (0x6e6450, 3), 'leaf': (0x34422a, 4), 'fire': (0xd06a20, 4), 'dead': (0x3a2e26, 1),
}

def classify(r, g, b, over):
    h, s, v = colorsys.rgb_to_hsv(r, g, b); h *= 360
    if s < 0.16: c = 'bone' if v > 0.88 else 'stone'
    elif 195 <= h < 300: c = 'stone' if s < 0.42 else 'roof'
    elif 15 <= h < 48: c = 'wood' if s > 0.42 else 'sand'
    elif 48 <= h < 75: c = 'gold'
    elif 75 <= h < 195: c = 'leaf'
    else: c = 'red'
    return over.get(c, c), v

# name: (kit file, recolour overrides). Overrides retarget a class for that model (e.g. green iron fences).
MODELS = {
    # graveyard: the shrine's burial grounds
    'grave_cross': ('graveyard/gravestone-cross', {}), 'grave_round': ('graveyard/gravestone-round', {}),
    'grave_broken': ('graveyard/gravestone-broken', {}), 'grave_deco': ('graveyard/gravestone-decorative', {}),
    'grave_wide': ('graveyard/gravestone-wide', {}), 'grave_bevel': ('graveyard/gravestone-bevel', {}),
    'grave_roof': ('graveyard/gravestone-roof', {}), 'grave_large': ('graveyard/gravestone-cross-large', {}),
    'grave_plot': ('graveyard/grave', {'wood': 'stone'}), 'cross_col': ('graveyard/cross-column', {}),
    'crypt_large': ('graveyard/crypt-large', {'roof': 'stone', 'wood': 'iron'}), 'crypt_small': ('graveyard/crypt-small', {'roof': 'stone', 'wood': 'iron'}),
    'crypt': ('graveyard/crypt', {'roof': 'stone', 'wood': 'iron'}),
    'fence_iron': ('graveyard/iron-fence', {'leaf': 'iron'}), 'fence_iron_dmg': ('graveyard/iron-fence-damaged', {'leaf': 'iron'}),
    'fence_iron_col': ('graveyard/iron-fence-border-column', {'leaf': 'iron'}),
    'gwall': ('graveyard/stone-wall', {'red': 'stone'}), 'gwall_dmg': ('graveyard/stone-wall-damaged', {'red': 'stone'}),
    'altar': ('graveyard/altar-stone', {}), 'candles': ('graveyard/candle-multiple', {'gold': 'fire', 'leaf': 'iron'}),
    'fire_basket': ('graveyard/fire-basket', {'leaf': 'iron', 'gold': 'fire', 'red': 'fire'}),
    'lightpost': ('graveyard/lightpost-single', {'leaf': 'iron', 'gold': 'fire'}),
    'obelisk': ('graveyard/pillar-obelisk', {}), 'coffin': ('graveyard/coffin-old', {}), 'debris_g': ('graveyard/debris', {}),
    'bench_dmg': ('graveyard/bench-damaged', {}), 'urn': ('graveyard/urn-round', {}),
    'pine_crooked': ('graveyard/pine-crooked', {'wood': 'dead', 'sand': 'dead'}), 'pine_fall': ('graveyard/pine-fall', {'wood': 'dead', 'sand': 'dead'}),
    'trunk_long': ('graveyard/trunk-long', {}),
    # castle kit: siege engines, wrecked and whole
    'treb_wreck': ('castle/siege-trebuchet-demolished', {}), 'cata_wreck': ('castle/siege-catapult-demolished', {}),
    'tower_wreck': ('castle/siege-tower-demolished', {}), 'ballista_wreck': ('castle/siege-ballista-demolished', {}),
    'ram_wreck': ('castle/siege-ram-demolished', {}), 'ballista': ('castle/siege-ballista', {}), 'trebuchet': ('castle/siege-trebuchet', {}),
    'banner_long': ('castle/flag-banner-long', {'roof': 'roof', 'bone': 'bone'}),
    # survival kit: camps
    'tent': ('survival/tent-canvas', {'sand': 'canvas', 'wood': 'wood'}), 'tent_half': ('survival/tent-canvas-half', {'sand': 'canvas'}),
    'tent_b': ('survival/tent', {'sand': 'canvas', 'red': 'canvas'}), 'bedroll': ('survival/bedroll', {'red': 'canvas'}),
    'campfire': ('survival/campfire-pit', {'gold': 'fire', 'red': 'fire'}), 'barrel': ('survival/barrel', {'red': 'iron'}),
    'barrel_open': ('survival/barrel-open', {'red': 'iron'}), 'crate_l': ('survival/box-large', {}), 'crate': ('survival/box', {}),
    'chest': ('survival/chest', {}), 'stakes': ('survival/fence-fortified', {}), 'fence_wood': ('survival/fence', {}),
    'shack': ('survival/structure-metal', {'stone': 'iron'}), 'shack_roof': ('survival/structure-metal-roof', {'stone': 'iron'}),
    'canopy': ('survival/structure-canvas', {'sand': 'canvas', 'gold': 'canvas'}), 'panel': ('survival/metal-panel-screws', {'stone': 'iron', 'red': 'iron', 'wood': 'iron'}),
    'workbench': ('survival/workbench', {}), 'signpost': ('survival/signpost', {}), 'planks': ('survival/resource-planks', {}),
    # nature kit: rock outcrops, cliffs, logs
    'rock_tallA': ('nature/rock_tallA', {'red': 'stone', 'sand': 'stone', 'wood': 'stone'}), 'rock_tallB': ('nature/rock_tallB', {'red': 'stone', 'sand': 'stone', 'wood': 'stone'}),
    'rock_tallC': ('nature/rock_tallC', {'red': 'stone', 'sand': 'stone', 'wood': 'stone'}), 'rock_largeA': ('nature/rock_largeA', {'red': 'stone', 'sand': 'stone', 'wood': 'stone'}),
    'rock_largeC': ('nature/rock_largeC', {'red': 'stone', 'sand': 'stone', 'wood': 'stone'}), 'rock_largeE': ('nature/rock_largeE', {'red': 'stone', 'sand': 'stone', 'wood': 'stone'}),
    'cliff': ('nature/cliff_large_rock', {'red': 'stone', 'sand': 'stone', 'wood': 'stone', 'leaf': 'leaf'}),
    'cliff_block': ('nature/cliff_block_rock', {'red': 'stone', 'sand': 'stone', 'wood': 'stone'}),
    'log': ('nature/log_large', {}), 'log_stack': ('nature/log_stackLarge', {}), 'campfire_stones': ('nature/campfire_stones', {'wood': 'wood', 'red': 'fire', 'gold': 'fire'}),
}

def load(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + jl]); off = 20 + jl
    bl = struct.unpack('<I', b[off:off + 4])[0]; binc = b[off + 8: off + 8 + bl]
    return j, binc

CT = {5126: ('<f4', 4), 5123: ('<u2', 2), 5125: ('<u4', 4), 5121: ('<u1', 1)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def acc(j, binc, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; dt, sz = CT[a['componentType']]; n = NC[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', sz * n)
    raw = np.frombuffer(binc, dtype=np.uint8, count=stride * (a['count'] - 1) + sz * n, offset=start)
    out = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], sz * n), strides=(stride, 1)).copy()
    return out.view(dt).reshape(a['count'], n)

def node_mat(nd):
    if 'matrix' in nd: return np.array(nd['matrix'], dtype=np.float64).reshape(4, 4).T
    t = nd.get('translation', [0, 0, 0]); r = nd.get('rotation', [0, 0, 0, 1]); s = nd.get('scale', [1, 1, 1])
    x, y, z, w = r
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4); M[:3, :3] = R * np.array(s); M[:3, 3] = t; return M

out = {}
cmaps = {}
for name, (rel, over) in MODELS.items():
    kit = rel.split('/')[0]
    j, binc = load(f'{SRC}/{rel}.glb')
    if kit not in cmaps and kit != 'nature': cmaps[kit] = np.asarray(Image.open(f'{SRC}/{kit}/Textures/colormap.png').convert('RGB'), dtype=np.float64) / 255
    P, I, Cc, K = [], [], [], []
    def walk(ni, M):
        nd = j['nodes'][ni]; M = M @ node_mat(nd)
        if 'mesh' in nd:
            for pr in j['meshes'][nd['mesh']]['primitives']:
                pos = acc(j, binc, pr['attributes']['POSITION']).astype(np.float64)
                pos = (np.c_[pos, np.ones(len(pos))] @ M.T)[:, :3]
                idx = acc(j, binc, pr['indices']).ravel() if 'indices' in pr else np.arange(len(pos))
                mat = j['materials'][pr['material']] if 'material' in pr else {}
                pbr = mat.get('pbrMetallicRoughness', {})
                if 'baseColorTexture' in pbr:
                    uv = acc(j, binc, pr['attributes']['TEXCOORD_0']); cm = cmaps[kit]; hh, ww = cm.shape[:2]
                    px = np.clip((uv[:, 0] % 1) * ww, 0, ww - 1).astype(int); py = np.clip((uv[:, 1] % 1) * hh, 0, hh - 1).astype(int)
                    col = cm[py, px]
                else:
                    f = pbr.get('baseColorFactor', [1, 1, 1, 1])[:3]; col = np.tile(np.array(f) ** (1 / 2.2), (len(pos), 1))   # factors are linear
                base = sum(len(p) for p in P)
                P.append(pos); I.append(idx.astype(np.int64) + base); Cc.append(col)
        for c in nd.get('children', []): walk(c, M)
    for r in j['scenes'][j.get('scene', 0)]['nodes']: walk(r, np.eye(4))
    pos = np.vstack(P); idx = np.concatenate(I); col = np.vstack(Cc)
    rgb = np.zeros((len(col), 3), np.uint8); cls = np.zeros(len(col), np.uint8)
    for k, (r, g, b) in enumerate(col):
        c, v = classify(r, g, b, over); pc, ci = PAL[c]
        shade = min(1.3, max(0.55, (v / 0.72) ** 0.8)) if c != 'fire' else 1.0
        rgb[k] = [min(255, int(((pc >> s) & 255) * shade)) for s in (16, 8, 0)]; cls[k] = ci
    q = float(np.abs(pos).max()) / 32000 or 1
    out[name] = {
        'q': q, 'p': base64.b64encode(np.round(pos / q).astype('<i2').tobytes()).decode(),
        'i': base64.b64encode(idx.astype('<u2').tobytes()).decode(),
        'c': base64.b64encode(rgb.tobytes()).decode(), 'k': base64.b64encode(cls.tobytes()).decode(),
        'b': [round(float(x), 3) for x in list(pos.min(0)) + list(pos.max(0))],
    }
json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print(len(out), 'models,', sum(len(json.dumps(m)) for m in out.values()) // 1024, 'KB')
for k, m in out.items(): print(k, m['b'], len(base64.b64decode(m['i'])) // 6, 'tris')
