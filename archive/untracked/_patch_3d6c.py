# -*- coding: utf-8 -*-
"""Patch 6c: refresh integrity after dataset switch + NaN-proof LC tint alpha."""
import re

P = "fly_demon_3d.html"
data = open(P, "rb").read()

def rep(old, new, tag):
    global data
    nb = data.count(old)
    assert nb == 1, f"[{tag}] expected 1 occurrence, found {nb}"
    data = data.replace(old, new)
    print("patched:", tag)

rep(
    b'    buildBrain(sim.circuit);\n'
    b'    crossGood=0; crossBad=0; bestDT=0;\n',
    b'    buildBrain(sim.circuit);\n'
    b'    if (typeof refreshIntegrity === "function") refreshIntegrity();\n'
    b'    crossGood=0; crossBad=0; bestDT=0;\n',
    "integrity-refresh")

rep(
    b'      const a = Math.min(0.42, (t.r + t.g + t.b) / 3 * 0.62);\n'
    b'      if (a < 0.015) continue;\n',
    b'      let a = Math.min(0.42, (t.r + t.g + t.b) / 3 * 0.62);\n'
    b'      if (!isFinite(a)) a = 0;              // NaN must not reach addColorStop\n'
    b'      if (a < 0.015) continue;\n',
    "tint-nan-guard")

open(P, "wb").write(data)
m = re.search(rb"<script>\r?\n(.*?)</script>", data, re.S)
assert m
open("_check_3d6c.js", "wb").write(m.group(1))
print("OK")
