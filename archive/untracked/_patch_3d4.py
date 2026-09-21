# -*- coding: utf-8 -*-
"""Patch 4 for fly_demon_3d.html + experiment_plots.html.

Root cause of "neurons and wiring scattered outside the brain": the browser
served a STALE cached fly_brain_positions.bin (old 9-byte format) that got
parsed at the new 7-byte stride -> garbage coordinates everywhere.

1. All anatomy asset fetches revalidate with the server ({cache:"no-cache"}).
2. Loader self-validation: if the buffer size disagrees with meta.n at
   7 bytes/neuron, derive n from the buffer (authoritative) instead of
   silently misparsing.
3. Fog pushed out (900-2600 -> 1800-4600) so the brain stage stays crisp.
"""
from pathlib import Path

def patch(name: str, reps):
    p = Path(name)
    data = p.read_bytes()
    for old, new, label in reps:
        n = data.count(old)
        assert n == 1, f"{name} / {label}: expected 1 occurrence, found {n} -- aborting (nothing written)"
        data = data.replace(old, new)
        print(f"patched [{name}]: {label}")
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(p)
    print(f"OK: {name} written, {len(data)} bytes")

NC = b'{cache:"no-cache"}'

patch("fly_demon_3d.html", [
    (b'fetch("fly_brain_hulls.bin").then(',
     b'fetch("fly_brain_hulls.bin",' + NC + b').then(',
     "hulls.bin fetch: no-cache"),
    (b'fetch("fly_brain_hulls.json").then(',
     b'fetch("fly_brain_hulls.json",' + NC + b').then(',
     "hulls.json fetch: no-cache"),
    (b'fetch("fly_brain_positions.bin").then(',
     b'fetch("fly_brain_positions.bin",' + NC + b').then(',
     "positions.bin fetch: no-cache"),
    (b'fetch("fly_brain_meta.json").then(',
     b'fetch("fly_brain_meta.json",' + NC + b').then(',
     "meta.json fetch: no-cache"),
    (b'if (!meta.n) meta.n = Math.floor(buf.byteLength / 9);   // json lost n on rewrite',
     b'if (!meta.n || buf.byteLength !== meta.n * 7) meta.n = Math.floor(buf.byteLength / 7);   // 7 B/neuron (Int16 x3 + Uint8 prim); stale/mismatched meta must never misparse the buffer',
     "positions loader: self-validating n"),
    (b'scene.fog = new THREE.Fog(0x070b12, 900, 2600);',
     b'scene.fog = new THREE.Fog(0x070b12, 1800, 4600);   // brain stage stays crisp; haze only on the far chamber',
     "fog range pushed out"),
])

patch("experiment_plots.html", [
    (b'fetch("fly_brain_positions.bin").then(',
     b'fetch("fly_brain_positions.bin",' + NC + b').then(',
     "positions.bin fetch: no-cache"),
    (b'fetch("fly_brain_meta.json").then(',
     b'fetch("fly_brain_meta.json",' + NC + b').then(',
     "meta.json fetch: no-cache"),
    (b'if (!meta.n) meta.n = Math.floor(buf.byteLength / 9);   // json lost n on rewrite',
     b'if (!meta.n || buf.byteLength !== meta.n * 7) meta.n = Math.floor(buf.byteLength / 7);   // 7 B/neuron (Int16 x3 + Uint8 prim); stale/mismatched meta must never misparse the buffer',
     "positions loader: self-validating n"),
])
