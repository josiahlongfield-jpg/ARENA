#!/usr/bin/env python3
"""Build previews/enemies.html: the current enemy bodies (lifted from the game source) beside the proposed detailed ones."""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'src/arena_template.html'), encoding='utf-8').read()
def section(start, end):
    a = src.index(start); b = src.index(end, a); return src[a:b]
prelude = section('  const V3 = THREE.Vector3', '  // ================================================================ renderer')
mats = section('  // ================================================================ painted textures and materials', '  // ================================================================ arenas')
bodies = section("  // ================================================================ enemies' bodies", '  // ================================================================ audio')
hd = open(os.path.join(ROOT, 'previews/enemies_hd_src.js'), encoding='utf-8').read()
page = open(os.path.join(ROOT, 'previews/viewer_shell.html'), encoding='utf-8').read()
js = prelude + mats + bodies + hd
page = page.replace('/*__GAME_CODE__*/', js)
out = os.path.join(ROOT, 'previews/enemies.html')
open(out, 'w', encoding='utf-8').write(page)
print(out, len(page) // 1024, 'KB')
