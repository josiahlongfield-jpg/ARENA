"""Build Vigil: join the game's scripts into the page and inline its assets.

src/vigil.html + src/js/*.js -> dist/vigil.html            one file with everything in it (double-click to play)
                             -> dist/artifact/index.html   the page for the claude.ai artifact, with each asset beside it as its own
                                                           script (a_<name>.js), since one page may not pass 16 MB
                             -> test/game.html             the one-file build, for the headless tests (served from vigil/)
Every script is syntax-checked with node.
usage: python3 vigil/build.py
"""
import json, os, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
JS = ['base', 'render', 'zone', 'rig', 'weapon']           # in load order; each is one section of the game's IIFE
A = lambda *p: os.path.join(HERE, 'assets', *p)

def load_js_obj(path):
    s = open(path).read(); return json.loads(s[s.index('{'):s.rindex('}') + 1])
assets = {
    'arms': json.load(open(A('fp_arms.json'))),            # her first-person arms with the gauntlets (fp_arms.py, gauntlet.py)
    'rifle': load_js_obj(A('rifle.js')),                   # the user's rifle with its foregrip (rifle_pack.py, foregrip.py)
    'grips': json.load(open(A('grips_fp.json'))),          # where the hands hold it (grip_solve.py)
}
tex_dir = os.path.join(ROOT, 'rpg', 'assets', 'tex')       # the CC0 scans the zone lays on (zone.js `scan`)
if os.path.isdir(tex_dir):
    import base64, re
    assets['tex'] = {}
    for f in sorted(os.listdir(tex_dir)):
        m = re.match(r'(.+)_(diff|nor)\.jpg$', f)
        if m: assets['tex'][f'{m.group(1)}|{"d" if m.group(2) == "diff" else "n"}'] = 'data:image/jpeg;base64,' + base64.b64encode(open(os.path.join(tex_dir, f), 'rb').read()).decode()

page = open(os.path.join(HERE, 'src', 'vigil.html')).read()
code = '\n'.join(open(os.path.join(HERE, 'src', 'js', n + '.js')).read() for n in JS)
assert page.count('/*__JS__*/') == 1 and page.count('/*__ASSETS__*/null') == 1
page = page.replace('/*__JS__*/', code.replace('\n', '\n  ').rstrip())

def check(html, name):
    """node --check on every inline script"""
    import re
    bad = 0
    for i, m in enumerate(re.finditer(r'<script>(.*?)</script>', html, re.S)):
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f: f.write(m.group(1)); p = f.name
        r = subprocess.run(['node', '--check', p], capture_output=True, text=True); os.unlink(p)
        if r.returncode: bad += 1; print(name, 'script', i, r.stderr[:2000])
    return 'ok' if not bad else 'FAILED'

os.makedirs(os.path.join(HERE, 'dist', 'artifact'), exist_ok=True); os.makedirs(os.path.join(HERE, 'test'), exist_ok=True)
one = page.replace('/*__ASSETS__*/null', json.dumps(assets, separators=(',', ':')))
for out in (os.path.join(HERE, 'dist', 'vigil.html'), os.path.join(HERE, 'test', 'game.html')): open(out, 'w').write(one)
print(f'vigil.html: {len(one) / 1e6:.1f} MB, syntax: {check(one, "vigil.html")}')
# the artifact: the assets as scripts beside the page, each filling one key of window.VGA before the game's script runs
tags = ''.join(f'<script src="a_{k}.js"></script>\n' for k in assets)
art = page.replace('<script>\nconst ASSETS = /*__ASSETS__*/null;', tags + '<script>\nconst ASSETS = window.VGA;')
assert art != page, 'the asset hook moved'
for k, v in assets.items():
    s = f'(window.VGA = window.VGA || {{}})[{json.dumps(k)}] = ' + json.dumps(v, separators=(',', ':')) + ';\n'
    open(os.path.join(HERE, 'dist', 'artifact', f'a_{k}.js'), 'w').write(s)
    assert len(s) < 16e6, f'a_{k}.js is over 16 MB'
open(os.path.join(HERE, 'dist', 'artifact', 'index.html'), 'w').write(art)
print(f'artifact: page {len(art) / 1e3:.0f} KB + {len(assets)} asset scripts, syntax: {check(art, "artifact")}')
