# -*- coding: utf-8 -*-
"""Patch 10d: expose a __trueflyDebug hook (mirrors the existing __brainDebug
pattern) so the TrueFly-glb placement can be inspected from the console."""
from pathlib import Path
import sys

P = Path("fly_demon_3d.html")
src = P.read_text(encoding="utf-8")

old = 'const TRUEFLY = { on:false, ready:false, loading:false, root:null, wings:[],\n                  hidden:[] };'
new = ('const TRUEFLY = { on:false, ready:false, loading:false, root:null, wings:[],\n'
       '                  hidden:[] };\n'
       'window.__trueflyDebug = { get tf(){ return TRUEFLY; }, get fg(){ return flyGroup; } };')

n = src.count(old)
if n != 1:
    sys.exit(f"expected exactly 1 occurrence, found {n}")
P.write_text(src.replace(old, new), encoding="utf-8")
print("patched OK")
