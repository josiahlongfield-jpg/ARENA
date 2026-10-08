import json, struct, io, numpy as np
from PIL import Image
def load(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n]); o = 20 + n + 8
    def acc(i):
        a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]; off = o + v.get('byteOffset', 0) + a.get('byteOffset', 0)
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
        c = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        return np.frombuffer(b, dt, a['count'] * c, off).reshape(-1, c).copy()
    def img(k):
        v = j['bufferViews'][j['images'][j['textures'][k]['source']]['bufferView']]; s = o + v.get('byteOffset', 0)
        return Image.open(io.BytesIO(b[s:s + v['byteLength']])).convert('RGB')
    return j, acc, img
def qm(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
def local(nd):
    if 'matrix' in nd: return np.array(nd['matrix']).reshape(4, 4).T
    M = np.eye(4); M[:3, :3] = qm(nd.get('rotation', [0, 0, 0, 1])) * np.array(nd.get('scale', [1, 1, 1])); M[:3, 3] = nd.get('translation', [0, 0, 0]); return M
def world(j):
    WM = {}
    def walk(i, M):
        WM[i] = M @ local(j['nodes'][i])
        for c in j['nodes'][i].get('children', []): walk(c, WM[i])
    for r in j['scenes'][0]['nodes']: walk(r, np.eye(4))
    return WM
def static_mesh(path):
    j, acc, img = load(path); WM = world(j)
    mi = next(i for i, nd in enumerate(j['nodes']) if 'mesh' in nd); pr = j['meshes'][j['nodes'][mi]['mesh']]['primitives'][0]; at = pr['attributes']
    P = acc(at['POSITION']).astype(float); N = acc(at['NORMAL']).astype(float)
    M = WM[mi]; P = P @ M[:3, :3].T + M[:3, 3]; N = N @ M[:3, :3].T
    return dict(j=j, acc=acc, img=img, P=P, N=N, UV=acc(at['TEXCOORD_0']), I=acc(pr['indices']).ravel(), pr=pr)
