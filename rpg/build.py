"""Build the Reach: inline the CC0 textures, the baked Kenney props and the game's sounds.

game_src.html  -> game.html   the RPG (published as the artifact; no doc skeleton)
               -> gallery.html  the wargear gallery alone (published as its own artifact)
world_src.html -> world.html  the walkable preview it grew from
Both scripts are syntax-checked with node.
usage: python3 rpg/build.py   (from the repo root or from rpg/)
"""
import base64, json, os, re, subprocess, tempfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, 'assets', 'tex')

tex, mean = {}, {}
for f in sorted(os.listdir(TEX)):
    m = re.match(r'(.+)_(diff|nor)\.jpg$', f)
    if not m: continue
    name, kind = m.groups()
    data = open(os.path.join(TEX, f), 'rb').read()
    tex[f'{name}|{"d" if kind == "diff" else "n"}'] = 'data:image/jpeg;base64,' + base64.b64encode(data).decode()
    if kind == 'diff':       # the mean colour in linear light, which 'detail' materials divide by
        px = np.asarray(Image.open(os.path.join(TEX, f)).convert('RGB').resize((64, 64)), dtype=np.float64) / 255
        mean[name] = [round(float(v), 4) for v in (px ** 2.2).reshape(-1, 3).mean(0)]

assets = {'tex': tex, 'mean': mean, 'kenney': json.load(open(os.path.join(HERE, 'assets', 'kenney.json')))}
game_assets = dict(assets, snd=json.load(open(os.path.join(HERE, '..', 'data', 'sounds.json'))),
                   feyr=json.load(open(os.path.join(HERE, 'assets', 'feyr_rig.json'))))      # the Tripo-rigged Feyr (tools/tripo_rig_pack.py)

def build(src_name, out_name, data):
    src = open(os.path.join(HERE, src_name)).read()
    assert src.count('/*__ASSETS__*/null') == 1
    out = src.replace('/*__ASSETS__*/null', json.dumps(data, separators=(',', ':')))
    open(os.path.join(HERE, out_name), 'w').write(out)
    # syntax check: the inline game script, without the inlined data
    script = re.search(r'<script>\n(.*?)</script>', src, re.S).group(1)
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as fh: fh.write(script)
    r = subprocess.run(['node', '--check', fh.name], capture_output=True, text=True)
    print(f'{out_name}: {len(out) / 1e6:.1f} MB, syntax:', 'ok' if r.returncode == 0 else r.stderr)

build('game_src.html', 'game.html', game_assets)
# the wargear gallery on its own: the same source with no region, so none of the textures, props or sounds
def build_gallery():
    src = open(os.path.join(HERE, 'game_src.html')).read()
    for a, b_ in [('/*__GALLERY__*/false', 'true'), ('/*__ASSETS__*/null', json.dumps({'tex': {}, 'mean': {}, 'kenney': {}, 'snd': {}})), ('<title>Templar: The Reach</title>', '<title>Templar Wargear Gallery</title>')]:
        assert src.count(a) == 1, a; src = src.replace(a, b_)
    open(os.path.join(HERE, 'gallery.html'), 'w').write(src)
    print(f'gallery.html: {len(src) / 1e6:.1f} MB')
build_gallery()
build('world_src.html', 'world.html', assets)
