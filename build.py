#!/usr/bin/env python3
"""Inline the sounds into the template -> dist/templar-arena.html and test/game.html, then syntax-check the script."""
import json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(ROOT, 'src/arena_template.html'), encoding='utf-8').read()
snd = json.load(open(os.path.join(ROOT, 'data/sounds.json')))
html = tpl.replace('__SOUNDS__', json.dumps(snd, separators=(',', ':')))

os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
for out in ('dist/templar-arena.html', 'test/game.html'):
    p = os.path.join(ROOT, out)
    page = html
    if out.startswith('test/'):     # tests run offline against a local copy of three.js
        page = page.replace('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'three.min.js')
    open(p, 'w', encoding='utf-8').write(page)
    print(out, f'{len(page) // 1024} KB')

# the artifact host wraps the page in its own document skeleton, so publish just the head contents and body
art = re.sub(r'<!doctype html>\s*<html[^>]*>\s*<head>\s*', '', html, flags=re.I)
art = re.sub(r'</head>\s*<body>', '', art, flags=re.I)
art = re.sub(r'</body>\s*</html>\s*$', '', art, flags=re.I)
open(os.path.join(ROOT, 'dist/artifact.html'), 'w', encoding='utf-8').write(art)
print('dist/artifact.html', f'{len(art) // 1024} KB')

script = max(re.findall(r'<script>([\s\S]*?)</script>', html), key=len)
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
    f.write(script)
r = subprocess.run(['node', '--check', f.name], capture_output=True, text=True)
os.unlink(f.name)
print('syntax:', 'ok' if r.returncode == 0 else r.stderr)
sys.exit(r.returncode)
