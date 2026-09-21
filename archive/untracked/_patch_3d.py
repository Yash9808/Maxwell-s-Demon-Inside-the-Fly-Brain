# -*- coding: utf-8 -*-
"""One-shot patch for fly_demon_3d.html anatomical-view readability.

1. Do NOT triple the sampled edge count in anatomical mode (~18k chords at
   0.5 opacity drowned the real neuron cloud).
2. Dim the edge layer in anatomical mode (0.5 -> 0.24).
3. Slightly larger node instances in anatomical mode (0.9 -> 1.5).
Each target string must occur exactly once; the script aborts otherwise.
"""
from pathlib import Path

p = Path("fly_demon_3d.html")
data = p.read_bytes()

def rep(old: bytes, new: bytes, label: str):
    global data
    n = data.count(old)
    assert n == 1, f"{label}: expected exactly 1 occurrence, found {n} -- aborting"
    data = data.replace(old, new)
    print(f"patched: {label}")

rep(b"  const stride = Math.max(1, Math.floor(NE/6000));\n"
    b"  const segIdx = [];\n"
    b"  const strideEff = anatMode ? Math.max(1, Math.floor(stride/3)) : stride;",
    b"  const stride = Math.max(1, Math.floor(NE/6000));\n"
    b"  const segIdx = [];\n"
    b"  const strideEff = stride;   // same edge budget in every view: tripling in\n"
    b"                              // anatomical mode drowned the real neuron cloud\n"
    b"                              // in chords (the brain became unreadable)",
    "edge sampling: no more tripling in anatomical mode")

rep(b"    new THREE.LineBasicMaterial({ vertexColors:true, transparent:true, opacity: anatMode?0.5:0.85 }));",
    b"    new THREE.LineBasicMaterial({ vertexColors:true, transparent:true, opacity: anatMode?0.24:0.85 }));",
    "edge layer opacity 0.5 -> 0.24 in anatomical mode")

rep(b"    dummy.scale.setScalar(anatMode?0.9:1); dummy.updateMatrix();",
    b"    dummy.scale.setScalar(anatMode?1.5:1); dummy.updateMatrix();",
    "anatomical node scale 0.9 -> 1.5")

tmp = p.with_suffix(".html.tmp")
tmp.write_bytes(data)
tmp.replace(p)
print("OK: fly_demon_3d.html patched,", len(data), "bytes")
