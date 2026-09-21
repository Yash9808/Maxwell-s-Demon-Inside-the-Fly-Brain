# -*- coding: utf-8 -*-
"""Patch 2 for fly_demon_3d.html: separate the brain stage from the actors.

The demon hovers at world y~90 (z~40) and the fly's perch/dock sit at
y~20-95 (z~0-100).  The brain (brainGroup base y=60 + lifted holder group)
reached down into that zone in BOTH views (layered discs r~300, anatomical
ball r~470), so the fly/demon avatars were visually lost inside the neuron
cloud.  Raise the lift and re-aim the camera targets so the composition is
brain above, demon/fly/chamber below, with no intersection.
"""
from pathlib import Path

p = Path("fly_demon_3d.html")
data = p.read_bytes()

def rep(old: bytes, new: bytes, label: str):
    global data
    n = data.count(old)
    assert n == 1, f"{label}: expected exactly 1 occurrence, found {n} -- aborting (nothing written)"
    data = data.replace(old, new)
    print(f"patched: {label}")

rep(b"  brainHolder.group.position.y = 340 + daN*8;",
    b"  brainHolder.group.position.y = (anatMode ? 620 : 420) + daN*8;   // keep the brain volume clear of the demon/fly stage below",
    "brain lift: 340 -> 420 layered / 620 anatomical")

rep(b'    cameraTarget.set(0, 60, 0);           // brain group y offset + centroid',
    b'    cameraTarget.set(0, 300, 0);          // frame lifted brain + chamber below',
    "anatomical camera target -> y 300")

rep(b'    cameraTarget.set(0, 40, 0);           // back to chamber framing',
    b'    cameraTarget.set(0, 170, 0);          // chamber + lifted brain above',
    "layered camera target -> y 170")

rep(b"const cameraTarget = new THREE.Vector3(0, 40, 0);",
    b"const cameraTarget = new THREE.Vector3(0, 170, 0);",
    "boot camera target -> y 170")

tmp = p.with_suffix(".html.tmp")
tmp.write_bytes(data)
tmp.replace(p)
print("OK: fly_demon_3d.html patched,", len(data), "bytes")
