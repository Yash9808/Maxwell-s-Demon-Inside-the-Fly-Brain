# -*- coding: utf-8 -*-
"""Follow-up: rAF fallback for the deferred switchDataset (hidden tabs)."""
import re

P = "fly_demon_3d.html"
data = open(P, "rb").read()

old = (b'  requestAnimationFrame(()=>requestAnimationFrame(()=>{\n'
       b'    if (!meta.sim) meta.sim = makeSim(key==="fafb" ? FAFB : MCNS);\n')
assert data.count(old) == 1, "rAF anchor not found"

new = (b'  let ran = false;\n'
       b'  const run = () => { if (ran) return; ran = true;\n'
       b'    if (!meta.sim) meta.sim = makeSim(key==="fafb" ? FAFB : MCNS);\n')
data = data.replace(old, new)

old2 = (b'    msg("switched to "+meta.name+" \\u2014 "+sim.N.toLocaleString()+" real neurons, "\n'
        b'        +sim.NE.toLocaleString()+" real synapses");\n'
        b'  }));\n'
        b'}')
assert data.count(old2) == 1, "tail anchor not found"
new2 = (b'    msg("switched to "+meta.name+" \\u2014 "+sim.N.toLocaleString()+" real neurons, "\n'
        b'        +sim.NE.toLocaleString()+" real synapses");\n'
        b'  };\n'
        b'  // rAF paints the busy card first when visible; setTimeout guarantees\n'
        b'  // the rebuild still runs when the page is hidden (rAF is paused there).\n'
        b'  requestAnimationFrame(()=>requestAnimationFrame(run));\n'
        b'  setTimeout(run, 120);\n'
        b'}')
data = data.replace(old2, new2)

open(P, "wb").write(data)
m = re.search(rb"<script>\r?\n(.*?)</script>", data, re.S)
assert m
open("_check_3d6b.js", "wb").write(m.group(1))
print("patched: rAF fallback")
