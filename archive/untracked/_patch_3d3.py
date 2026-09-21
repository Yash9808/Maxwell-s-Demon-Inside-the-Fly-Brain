# -*- coding: utf-8 -*-
"""Patch 3 for fly_demon_3d.html: finish the stage separation + framing.

Geometry (world y): demon body tops out ~y190 (hover 90 + body + trident).
- Layered discs: brainGroup base 60 + lift, radius 300 -> lift 460 puts the
  disc undersides at y 220, clear of the actors.
- Anatomical ball: radius ~470 -> lift 700 puts the underside at y 290.
Camera: fov 50 -> half-height = dist*tan25 (653 @1400, 933 @2000); targets
re-centered so the chamber AND the whole brain fit in frame in both views.
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

rep(b"  brainHolder.group.position.y = (anatMode ? 620 : 420) + daN*8;   // keep the brain volume clear of the demon/fly stage below",
    b"  brainHolder.group.position.y = (anatMode ? 700 : 460) + daN*8;   // keep the brain volume clear of the demon/fly stage below",
    "lift: 620/420 -> 700/460")

rep(b'    cameraTarget.set(0, 300, 0);          // frame lifted brain + chamber below\n    orbit.dist = 1750; orbit.pitch = 0.22;',
    b'    cameraTarget.set(0, 520, 0);          // frame lifted brain + chamber below\n    orbit.dist = 2000; orbit.pitch = 0.22;',
    "anatomical camera: target 520, dist 2000")

rep(b'    cameraTarget.set(0, 170, 0);          // chamber + lifted brain above\n    msg(',
    b'    cameraTarget.set(0, 405, 0);          // chamber + lifted brain above\n    orbit.dist = 1400;                    // reframe: brain above, chamber below\n    msg(',
    "layered camera: target 405, dist 1400")

rep(b"const cameraTarget = new THREE.Vector3(0, 170, 0);",
    b"const cameraTarget = new THREE.Vector3(0, 405, 0);",
    "boot camera target -> 405")

rep(b"const orbit = { yaw:0, pitch:0.42, dist:1050, auto:0.04 };",
    b"const orbit = { yaw:0, pitch:0.42, dist:1400, auto:0.04 };",
    "boot orbit dist -> 1400")

tmp = p.with_suffix(".html.tmp")
tmp.write_bytes(data)
tmp.replace(p)
print("OK: fly_demon_3d.html patched,", len(data), "bytes")
