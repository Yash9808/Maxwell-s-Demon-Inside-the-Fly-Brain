# -*- coding: utf-8 -*-
"""Patch 10c-revert: drop the __brainDebug extension (the object is re-assigned
by buildBrain at runtime, so the extra getters never survive anyway)."""
from pathlib import Path
import sys

P = Path("fly_demon_3d.html")
src = P.read_text(encoding="utf-8")

old = ("window.__brainDebug = { get bh(){ return brainHolder; }, get anat(){ return anatMode; },\n"
       "                          get truefly(){ return TRUEFLY; }, get flyGroup(){ return flyGroup; } };")
new = "window.__brainDebug = { get bh(){ return brainHolder; }, get anat(){ return anatMode; } };"

n = src.count(old)
if n != 1:
    sys.exit(f"expected exactly 1 occurrence, found {n}")
P.write_text(src.replace(old, new), encoding="utf-8")
print("reverted OK")
