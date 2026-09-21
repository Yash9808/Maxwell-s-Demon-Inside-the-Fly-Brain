# -*- coding: utf-8 -*-
"""Patch 5: activity-jet neuron colors + glow-path edges in the anatomy view.

- Nodes: live activity coloring on the shared jet ramp (blue=quiet .. red=peak),
  same jetRGB + relative normalization as the LIVE CONNECTOME mini-panel.
- Edges: additive blending; inactive edges invisible in anatomy view so the
  wiring reads as transient activity glow-paths only (no static web).
- NT pulse overlay: layered view only (cannot fight the jet recolor).
Every replacement is asserted to occur exactly once; JS re-extracted after.
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

# ---------------------------------------------------------------- 1) jet ramp helper
# Insert jetRGB helper right after the node-mesh construction block, inside
# the brain builder (buildBrain). We anchor on the NT-pulse bookkeeping start.
rep(
    b"  // NT-pulse bookkeeping (both views): base instance colors + the\n",
    b"  // ---- live activity jet coloring (anatomy view) ----------------\n"
    b"  // Anatomy-mode nodes ride the shared jet ramp (jetRGB: 0=deep blue\n"
    b"  // quiet -> 1=red peak), same ramp + relative auto-gain as the LIVE\n"
    b"  // CONNECTOME mini-panel. brainHolder.jet assigns activity colors;\n"
    b"  // null in layered view (NT colors stay there).\n"
    b"  brainHolder.jet = anatMode ? (()=>{\n"
    b"    const heat = new Float32Array(N);\n"
    b"    const col = nMesh.instanceColor.array;\n"
    b"    let frame = 0;\n"
    b"    const J = [[0,0.36,1],[0,0.83,1],[0.2,1,0.45],[0.98,1,0.1],[1,0.55,0],[1,0.12,0.05]];\n"
    b"    const jramp = (t)=>{ t=Math.min(1,Math.max(0,t)); const f=t*(J.length-1), k=Math.min(J.length-2,f|0), u=f-k;\n"
    b"      return [J[k][0]+(J[k+1][0]-J[k][0])*u, J[k][1]+(J[k+1][1]-J[k][1])*u, J[k][2]+(J[k+1][2]-J[k][2])*u]; };\n"
    b"    return {\n"
    b"      step(spk){\n"
    b"        // decay (panel-matched) + attack\n"
    b"        for (let i=0;i<N;i++){ heat[i] = spk[i] ? 1 : heat[i]*0.94; }\n"
    b"        if ((frame++ % 4) !== 0) return;   // recolor ~15x/s\n"
    b"        // relative normalization: 95th percentile of active heat\n"
    b"        let p95 = 0; const arr = [];\n"
    b"        const stepS = Math.max(1, (N/6000)|0);\n"
    b"        for (let i=0;i<N;i+=stepS) if (heat[i] > 0.07) arr.push(heat[i]);\n"
    b"        if (arr.length){ arr.sort((a,b)=>a-b); p95 = arr[(arr.length*0.95)|0]; }\n"
    b"        const hScale = Math.max(0.22, p95);\n"
    b"        const ntOf = ntClassify(circuit);\n"
    b"        for (let i=0;i<N;i++){\n"
    b"          const h = heat[i];\n"
    b"          if (h > 0.07){\n"
    b"            const c = jramp(h / hScale);\n"
    b"            const boost = 0.35 + 0.65*Math.min(1, h/hScale);\n"
    b"            col[i*3]   = c[0]*boost;\n"
    b"            col[i*3+1] = c[1]*boost;\n"
    b"            col[i*3+2] = c[2]*boost;\n"
    b"          } else {\n"
    b"            // quiet: faint blue-grey so idle structure stays readable\n"
    b"            const cls = ntOf[i];\n"
    b"            if (cls >= 0){\n"
    b"              const b0 = NT_COLORS[[\"ach\",\"gaba\",\"glut\",\"da\",\"ser\",\"oct\"][cls]];\n"
    b"              col[i*3]   = (((b0>>16)&255)/255)*0.30;\n"
    b"              col[i*3+1] = (((b0>>8)&255)/255)*0.30;\n"
    b"              col[i*3+2] = ((b0&255)/255)*0.38;\n"
    b"            } else { col[i*3]=0.16; col[i*3+1]=0.20; col[i*3+2]=0.27; }\n"
    b"          }\n"
    b"        }\n"
    b"        nMesh.instanceColor.needsUpdate = true;\n"
    b"      },\n"
    b"      restore(){ col.set(brainHolder.pulseBase); nMesh.instanceColor.needsUpdate = true; }\n"
    b"    };\n"
    b"  })() : null;\n"
    b"  // NT-pulse bookkeeping (both views): base instance colors + the\n",
    "jet-helper")

# ---------------------------------------------------------------- 2) gate NT pulse to layered view
rep(
    b"  const daSig = clamp(sim.DA.v, 0, 3);\n"
    b"  if (brainHolder.pulseBase && brainHolder.pulseDA){\n",
    b"  const daSig = clamp(sim.DA.v, 0, 3);\n"
    b"  if (brainHolder.pulseBase && brainHolder.pulseDA && !anatMode){\n",
    "nt-pulse-gate")

# ---------------------------------------------------------------- 3) edges: additive glow-paths
rep(
    b"  const lines = new THREE.LineSegments(segGeo,\n"
    b"    new THREE.LineBasicMaterial({ vertexColors:true, transparent:true, opacity: anatMode?0.24:0.85 }));\n",
    b"  const lines = new THREE.LineSegments(segGeo,\n"
    b"    new THREE.LineBasicMaterial({ vertexColors:true, transparent:true,\n"
    b"      opacity: anatMode?0.85:0.85, blending: anatMode?THREE.AdditiveBlending:THREE.NormalBlending,\n"
    b"      depthWrite: !anatMode }));\n",
    "edge-material")

# ---------------------------------------------------------------- 4) edge colors: activity glow only (anat)
rep(
    b"    } else {\n"
    b"      c = spikes[src[ei]] ? (isExc[ei]? gCol : rCol) : dCol;\n"
    b"    }\n",
    b"    } else if (anatMode){\n"
    b"      // glow-path wiring: edges carry only live activity; the idle brain\n"
    b"      // is clean (no static web). Excitatory = warm ember, inhibitory =\n"
    b"      // cool azure; brightness follows the pre-neuron's decaying heat.\n"
    b"      const hS = brainHolder._eHeat ? brainHolder._eHeat[src[ei]] : (spikes[src[ei]]?1:0);\n"
    b"      if (hS > 0.05){\n"
    b"        const b = Math.min(1, hS) * 0.75;\n"
    b"        c = isExc[ei] ? [0.55*b, 0.30*b, 0.10*b] : [0.12*b, 0.34*b, 0.55*b];\n"
    b"      } else c = [0,0,0];\n"
    b"    } else {\n"
    b"      c = spikes[src[ei]] ? (isExc[ei]? gCol : rCol) : dCol;\n"
    b"    }\n",
    "edge-colors")

# ---------------------------------------------------------------- 5) per-neuron heat store for edges
rep(
    b"  const { spikes, src, dst, isExc, N, layers, layerStart, E } = sim;\n",
    b"  const { spikes, src, dst, isExc, N, layers, layerStart, E } = sim;\n"
    b"  // decaying per-neuron heat shared by edge glow + node jet recolor\n"
    b"  if (!brainHolder._eHeat){ brainHolder._eHeat = new Float32Array(sim.N); }\n"
    b"  { const HN = brainHolder._eHeat;\n"
    b"    for (let i=0;i<sim.N;i++) HN[i] = spikes[i] ? 1 : HN[i]*0.90; }\n"
    b"  if (anatMode && brainHolder.jet) brainHolder.jet.step(spikes);\n",
    "heat-store")

# ---------------------------------------------------------------- 6) restore static colors when leaving anat mode
# Locate the anat-mode toggle handler: btnAnat click sets anatMode and rebuilds
# the brain; layered view rebuilds too, so pulseBase refresh is automatic.
# The restore path is only needed if anatMode can flip without a rebuild;
# buildBrain() runs on every toggle, so nothing further is required here.

open(P, "wb").write(data)

# ---- verify the script block still parses -------------------------------
m = re.search(rb"<script>\r?\n(.*?)</script>", data, re.S)
assert m, "main script block not found"
open("_check_3d5.js", "wb").write(m.group(1))
print("OK: all patches applied, JS extracted for node --check")
