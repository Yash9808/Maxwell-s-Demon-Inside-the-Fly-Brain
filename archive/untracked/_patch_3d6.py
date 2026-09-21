# -*- coding: utf-8 -*-
"""Patch 6: MCNS switch UX + representation, dataset-aware integrity, blue quiet.

1. switchDataset: paint a "rebuilding brain" card BEFORE the synchronous
   makeSim+buildBrain block (UI never looks frozen; the rebuild itself stays
   synchronous but now announces itself).
2. anatFillPositions: datasets whose neuron count != FAFB (e.g. MCNS) get a
   layer-role placement in the SAME canonical fly-brain frame (optic lobes,
   central mass, VNC, motor) instead of borrowing FAFB's per-neuron file.
3. Integrity panel: mapping %/unmapped only when the FAFB anatomy actually
   matches the loaded circuit (meta.n === N); no more fake 99.9% for MCNS.
4. LIVE CONNECTOME idle cloud: grey -> deep blue (jet "quiet" end).
5. 3D anatomy idle neurons: NT-tinted grey -> uniform deep blue (jet quiet).
"""
import re, sys

P = "fly_demon_3d.html"
data = open(P, "rb").read()

def rep(old, new, tag):
    global data
    nb = data.count(old)
    assert nb == 1, f"[{tag}] expected 1 occurrence, found {nb}"
    data = data.replace(old, new)
    print("patched:", tag)

# ---------------------------------------------------------------- 1) switchDataset deferral
start = data.find(b"function switchDataset(key){")
assert start != -1
tail_anchor = b'real synapses");\n}'
end = data.find(tail_anchor, start)
assert end != -1, "switchDataset tail not found"
end += len(tail_anchor)
new_fn = (
b'function switchDataset(key){\n'
b'  const meta = DS_META[key];\n'
b'  const old = $("loadOverlay"); if (old) old.remove();\n'
b'  const busy = document.createElement("div");\n'
b'  busy.id = "loadOverlay";\n'
b'  busy.textContent = "rebuilding brain \\u2014 " + meta.name + " \\u2026";\n'
b'  document.body.appendChild(busy);\n'
b'  // paint the busy card first, THEN run the synchronous rebuild, so the\n'
b'  // switch never reads as a freeze (makeSim+buildBrain block one frame).\n'
b'  requestAnimationFrame(()=>requestAnimationFrame(()=>{\n'
b'    if (!meta.sim) meta.sim = makeSim(key==="fafb" ? FAFB : MCNS);\n'
b'    sim = meta.sim;\n'
b'    window.__expCircuit = sim.circuit;   // experiment list data handle (additive)\n'
b'    buildBrain(sim.circuit);\n'
b'    crossGood=0; crossBad=0; bestDT=0;\n'
b'    $("dsBadge").textContent = meta.badge + " \\u00b7 " + sim.N.toLocaleString() + " neurons";\n'
b'    $("dsInfo").textContent = meta.info;\n'
b'    $("dsFafb").classList.toggle("active", key==="fafb");\n'
b'    $("dsMcns").classList.toggle("active", key==="mcns");\n'
b'    busy.remove();\n'
b'    msg("switched to "+meta.name+" \\u2014 "+sim.N.toLocaleString()+" real neurons, "\n'
b'        +sim.NE.toLocaleString()+" real synapses");\n'
b'  }));\n'
b'}'
)
data = data[:start] + new_fn + data[end:]

# ---------------------------------------------------------------- 2) MCNS anatomy fallback
rep(
    b'      if (bin && matches){\n',
    b'      const layerNames = circuit.layer_names || [];\n'
    b'      const roleOf = (li) => /optic|antennal|sensory/i.test(layerNames[li]||"") ? 0\n'
    b'                          : /vnc|descend|abdominal/i.test(layerNames[li]||"") ? 2\n'
    b'                          : /motor/i.test(layerNames[li]||"") ? 3 : 1;\n'
    b'      // dataset-shaped fallback volumes in the SAME canonical frame as\n'
    b'      // FAFB (matches=false => e.g. MCNS): sensory -> optic lobes, central\n'
    b'      // -> brain mass, VNC -> nerve-cord volume, motor -> output.\n'
    b'      const VOL = [\n'
    b'        [[-298, 6, 0, 150, 112, 122], [298, 6, 0, 150, 112, 122]],\n'
    b'        [[0, 58, 0, 190, 142, 150]],\n'
    b'        [[0, -205, 0, 72, 120, 62]],\n'
    b'        [[0, -245, 0, 55, 78, 46]],\n'
    b'      ];\n'
    b'      if (bin && matches){\n',
    "mcns-role-map")

rep(
    b'      if (prim){\n',
    b'      if (prim && matches){\n',
    "prim-guard")

rep(
    b'      if (!done) anatScatter(pos,i,i*2+li,0,10,0,150,80,80,0.3,0.9,0);\n',
    b'      if (!done){\n'
    b'        const vol = VOL[roleOf(li)];\n'
    b'        const vv = vol[h32(i*5+li) % vol.length];\n'
    b'        const aA = h32(i*7+1)/4294967296*6.2832, bB = Math.acos(2*h32(i*7+2)/4294967296-1);\n'
    b'        const fF = 0.25 + 0.75*Math.cbrt(h32(i*7+3)/4294967296);\n'
    b'        pos[i*3]   = vv[0] + Math.sin(bB)*Math.cos(aA)*vv[3]*fF;\n'
    b'        pos[i*3+1] = vv[1] + Math.cos(bB)*vv[4]*fF;\n'
    b'        pos[i*3+2] = vv[2] + Math.sin(bB)*Math.sin(aA)*vv[5]*fF;\n'
    b'      }\n',
    "fallback-fill")

# ---------------------------------------------------------------- 3) dataset-aware integrity
rep(
    b'  const unmapped = (typeof REAL_ANAT !== "undefined" && REAL_ANAT.ready && REAL_ANAT.prim)\n'
    b'    ? Array.from(REAL_ANAT.prim).filter(v => v === 255).length : null;\n',
    b'  const anatMatches = (typeof REAL_ANAT !== "undefined" && REAL_ANAT.ready\n'
    b'                       && REAL_ANAT.prim && REAL_ANAT.meta\n'
    b'                       && REAL_ANAT.meta.n === N);\n'
    b'  const unmapped = anatMatches\n'
    b'    ? Array.from(REAL_ANAT.prim).filter(v => v === 255).length : null;\n',
    "integrity-match")

# ---------------------------------------------------------------- 4) LC idle cloud: blue
rep(
    b'  og.fillStyle="#6f7a88";\n',
    b'  og.fillStyle="#1d3f8f";   // jet "quiet" end: idle neurons read as blue\n',
    "lc-quiet-blue")

# ---------------------------------------------------------------- 5) 3D anatomy idle: uniform blue
rep(
    b'          } else {\n'
    b'            // quiet: faint blue-grey so idle structure stays readable\n'
    b'            const cls = ntOf[i];\n'
    b'            if (cls >= 0){\n'
    b'              const b0 = NT_COLORS[["ach","gaba","glut","da","ser","oct"][cls]];\n'
    b'              col[i*3]   = (((b0>>16)&255)/255)*0.30;\n'
    b'              col[i*3+1] = (((b0>>8)&255)/255)*0.30;\n'
    b'              col[i*3+2] = ((b0&255)/255)*0.38;\n'
    b'            } else { col[i*3]=0.16; col[i*3+1]=0.20; col[i*3+2]=0.27; }\n'
    b'          }\n',
    b'          } else {\n'
    b'            // quiet: deep blue (jet ramp 0) \u2014 same language as the panel\n'
    b'            col[i*3]   = 0.10;\n'
    b'            col[i*3+1] = 0.22;\n'
    b'            col[i*3+2] = 0.52;\n'
    b'          }\n',
    "anat-quiet-blue")

open(P, "wb").write(data)

# ---- verify the script block still parses -------------------------------
m = re.search(rb"<script>\r?\n(.*?)</script>", data, re.S)
assert m, "main script block not found"
open("_check_3d6.js", "wb").write(m.group(1))
print("OK: all patches applied, JS extracted")
