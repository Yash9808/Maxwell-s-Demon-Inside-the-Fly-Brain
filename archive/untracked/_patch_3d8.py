# -*- coding: utf-8 -*-
"""Patch 8: TrueFly-glb mode — real CT-scan fly surface + live activity wiring.

- Button "TrueFly-glb" under the dataset row / anatomical button.
- Loads drosophila_-_adult_fruit_fly_-_ct_scan.glb (40 MB, 15 meshes), centers
  + scales it onto the neuron-cloud volume, poses it in the brain group.
- In TrueFly mode: neuron points + hull shells + static edges hidden; the CT
  surface renders as a translucent ghost; a dedicated glow-line layer redraws
  the sampled connectome each frame, colored by the decaying pre-neuron heat
  on the shared jet ramp (blue = quiet/starting, red = peak).
- Works in both datasets; rebuild-safe (re-applies after every buildBrain).
"""
import re

P = "fly_demon_3d.html"
src = open(P, "r", encoding="utf-8", newline="").read().replace("\r\n", "\n")

def rep(old, new, tag):
    global src
    nb = src.count(old)
    assert nb == 1, f"[{tag}] expected 1 occurrence, found {nb}"
    src = src.replace(old, new)
    print("patched:", tag)

# ---------------------------------------------------------------- 1) import GLTFLoader
rep(
    'import * as THREE from "./three.module.js";',
    'import * as THREE from "./three.module.js";\n'
    'import { GLTFLoader } from "./GLTFLoader.module.js";',
    "gltf-import")

# ---------------------------------------------------------------- 2) button
rep(
    '<button id="btnAnat" style="flex:1">\U0001f9e0 Anatomical 3D brain</button>\n    </div>',
    '<button id="btnAnat" style="flex:1">\U0001f9e0 Anatomical 3D brain</button>\n    </div>\n'
    '    <div class="row" style="margin-top:6px">\n'
    '      <button id="btnGlb" style="flex:1">\U0001f9ec TrueFly-glb</button>\n'
    '    </div>',
    "button")

# ---------------------------------------------------------------- 3) TrueFly module + handler
rep(
    '// ---- dataset switch\n',
    '// ---- TrueFly-glb: real CT-scan fruit fly surface + live activity wiring ---\n'
    '// The CT model REPLACES the point-cloud brain in this mode; active pathways\n'
    '// are drawn as additive jet-colored lines through the brain volume (blue\n'
    '// quiet/starting -> red peak), at the measured neuron positions.\n'
    'const TRUEFLY = { on:false, ready:false, loading:false, root:null, lines:null,\n'
    '                  geo:null };\n'
    'function trueflyLoad(){\n'
    '  if (TRUEFLY.ready || TRUEFLY.loading) return;\n'
    '  TRUEFLY.loading = true;\n'
    '  new GLTFLoader().load("drosophila_-_adult_fruit_fly_-_ct_scan.glb", (gltf) => {\n'
    '    TRUEFLY.root = gltf.scene;\n'
    '    // center + scale the CT scan onto the neuron-cloud volume (~760 units)\n'
    '    const box = new THREE.Box3().setFromObject(TRUEFLY.root);\n'
    '    const c = box.getCenter(new THREE.Vector3());\n'
    '    const size = box.getSize(new THREE.Vector3());\n'
    '    const s = 760 / Math.max(size.x, size.y, size.z, 1e-6);\n'
    '    TRUEFLY.root.position.sub(c).multiplyScalar(s);\n'
    '    TRUEFLY.root.scale.setScalar(s);\n'
    '    // ghost the surface so the glow wiring inside stays readable\n'
    '    TRUEFLY.root.traverse(o => { if (o.isMesh)\n'
    '      o.material = new THREE.MeshPhongMaterial({ color:0x9fb4cc, shininess:30,\n'
    '        transparent:true, opacity:0.14, depthWrite:false }); });\n'
    '    TRUEFLY.ready = true; TRUEFLY.loading = false;\n'
    '    if (TRUEFLY.on) trueflyApply();\n'
    '    msg("TrueFly CT model loaded \\u2014 activity wiring live", 3000);\n'
    '  }, undefined, () => { TRUEFLY.loading = false;\n'
    '    msg("TrueFly-glb: model failed to load", 4000); });\n'
    '}\n'
    'function trueflyBuildLines(){\n'
    '  const pos = brainHolder.pos;\n'
    '  const base = brainHolder.segIdx || [];\n'
    '  const segPos = new Float32Array(base.length * 6);\n'
    '  base.forEach((ei, k) => {\n'
    '    const e = sim.circuit.edges[ei];\n'
    '    segPos[k*6]   = pos[e.s*3];   segPos[k*6+1] = pos[e.s*3+1]; segPos[k*6+2] = pos[e.s*3+2];\n'
    '    segPos[k*6+3] = pos[e.t*3];   segPos[k*6+4] = pos[e.t*3+1]; segPos[k*6+5] = pos[e.t*3+2];\n'
    '  });\n'
    '  const geo = new THREE.BufferGeometry();\n'
    '  geo.setAttribute("position", new THREE.BufferAttribute(segPos, 3));\n'
    '  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(base.length*6), 3));\n'
    '  TRUEFLY.geo = geo;\n'
    '  TRUEFLY.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({\n'
    '    vertexColors:true, transparent:true, opacity:0.95,\n'
    '    blending:THREE.AdditiveBlending, depthWrite:false }));\n'
    '}\n'
    'function trueflyApply(){\n'
    '  const g = brainHolder.group;\n'
    '  if (!g) return;\n'
    '  if (TRUEFLY.on){\n'
    '    if (TRUEFLY.root && !TRUEFLY.root.parent) g.add(TRUEFLY.root);\n'
    '    if (!TRUEFLY.lines) trueflyBuildLines();\n'
    '    if (TRUEFLY.lines && !TRUEFLY.lines.parent) g.add(TRUEFLY.lines);\n'
    '    if (brainHolder.nodes) brainHolder.nodes.visible = false;\n'
    '    if (brainHolder.edgeLines) brainHolder.edgeLines.visible = false;\n'
    '    (brainHolder.shells || []).forEach(sh => { sh.grp.visible = false; });\n'
    '  } else {\n'
    '    if (TRUEFLY.root) g.remove(TRUEFLY.root);\n'
    '    if (TRUEFLY.lines) g.remove(TRUEFLY.lines);\n'
    '    if (brainHolder.nodes) brainHolder.nodes.visible = true;\n'
    '    if (brainHolder.edgeLines) brainHolder.edgeLines.visible = true;\n'
    '    (brainHolder.shells || []).forEach(sh => { sh.grp.visible = true; });\n'
    '  }\n'
    '}\n'
    '$("btnGlb").addEventListener("click", () => {\n'
    '  TRUEFLY.on = !TRUEFLY.on;\n'
    '  $("btnGlb").classList.toggle("active", TRUEFLY.on);\n'
    '  if (!anatMode){                    // TrueFly lives in the anatomical frame\n'
    '    anatMode = true;\n'
    '    $("btnAnat").classList.add("active");\n'
    '    $("jetLegend").style.display = "";\n'
    '    buildBrain(sim.circuit);\n'
    '    cameraTarget.set(0, 520, 0); orbit.dist = 2000; orbit.pitch = 0.22;\n'
    '  }\n'
    '  trueflyLoad();                     // no-op once loaded / while loading\n'
    '  if (TRUEFLY.ready) trueflyApply(); // otherwise applied by the loader\n'
    '  msg(TRUEFLY.on\n'
    '    ? "\\U0001f9ec TrueFly CT model \\u2014 glowing lines show live pathways through the real fly surface (blue quiet \\u2192 red peak)"\n'
    '    : "TrueFly off \\u2014 back to the neuron cloud", 5200);\n'
    '});\n'
    '// ---- dataset switch\n',
    "truefly-module")

# ---------------------------------------------------------------- 4) rebuild-safe apply
rep(
    '  return brainHolder;\n}',
    '  if (TRUEFLY.on && TRUEFLY.ready) trueflyApply();   // keep TrueFly mode across rebuilds\n'
    '  return brainHolder;\n}',
    "rebuild-safe")

# ---------------------------------------------------------------- 5) per-frame wiring colors
rep(
    '  if (anatMode && brainHolder.jet) brainHolder.jet.step(spikes);\n',
    '  if (anatMode && brainHolder.jet) brainHolder.jet.step(spikes);\n'
    '  // TrueFly wiring: the same decaying heat drives jet colors on the\n'
    '  // CT-mode glow lines (invisible when idle, blue -> red with activity).\n'
    '  if (TRUEFLY.on && TRUEFLY.lines && brainHolder._eHeat){\n'
    '    const HN = brainHolder._eHeat;\n'
    '    const srcA = sim.src, base = brainHolder.segIdx;\n'
    '    const colA = TRUEFLY.geo.getAttribute("color");\n'
    '    let p95 = 0;\n'
    '    for (let i = 0; i < HN.length; i += 11) if (HN[i] > p95) p95 = HN[i];\n'
    '    const scale = Math.max(0.25, p95);\n'
    '    for (let k = 0; k < base.length; k++){\n'
    '      const ei = base[k];\n'
    '      const h = Math.min(1, Math.pow(HN[srcA[ei]] / scale, 0.75));\n'
    '      if (h < 0.07){ colA.setXYZ(k, 0, 0, 0); colA.setXYZ(k + base.length, 0, 0, 0); continue; }\n'
    '      const rC = Math.min(1, Math.max(0, 1.5 - Math.abs(4*h - 3)));\n'
    '      const gC = Math.min(1, Math.max(0, 1.5 - Math.abs(4*h - 2)));\n'
    '      const bC = Math.min(1, Math.max(0, 1.5 - Math.abs(4*h - 1)));\n'
    '      colA.setXYZ(k, rC, gC, bC); colA.setXYZ(k + base.length, rC, gC, bC);\n'
    '    }\n'
    '    colA.needsUpdate = true;\n'
    '  }\n',
    "wiring-colors")

open(P, "w", encoding="utf-8", newline="").write(src)

m = re.search(r"<script type=\"module\">\r?\n(.*?)</script>", src, re.S)
assert m, "script block not found"
open("_check_3d8.js", "w", encoding="utf-8", newline="").write(m.group(1))
print("OK: all patches applied, JS extracted")
