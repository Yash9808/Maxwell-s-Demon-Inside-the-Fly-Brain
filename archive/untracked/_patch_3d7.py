# -*- coding: utf-8 -*-
"""Patch plots page: real-brain maps for EVERY condition + finer heat rendering.

1. fireVecFor(): prefer the worker's measured per-neuron fireVecMean; otherwise
   synthesize a per-neuron vector by distributing the condition's mean
   layerRates over each functional region's real neurons (fuzzy name match).
   => every fly-brain condition gets a real-brain map, never a block fallback.
2. renderAnatMaps: one map + strip per condition (measured or synthesized).
3. drawAnatMap: relative p95 normalization, gamma compression, smaller glows,
   blue quiet-neuron baseline -> brain texture instead of saturated blobs.
4. captureBrainSnapshot uses fireVecFor too (gallery snapshots always anatomical).
"""
import re

P = "experiment_plots.html"
src = open(P, "r", encoding="utf-8", newline="").read().replace("\r\n", "\n")

def rep(old, new, tag):
    global src
    nb = src.count(old)
    assert nb == 1, f"[{tag}] expected 1 occurrence, found {nb}"
    src = src.replace(old, new)
    print("patched:", tag)

# ---------------------------------------------------------------- 1) helpers
rep(
    "let LAST_ANAT_FIG = null;\nfunction renderAnatMaps(rows, label){\n"
    "  const wrap = document.getElementById(\"brainWrap\");\n"
    "  if (!wrap) return null;\n"
    "  const frows = (rows || []).filter(r => r.fireVecMean && r.fireVecMean.vec);\n"
    "  if (!frows.length || !ANAT.ready){\n"
    "    if (!ANAT.ready && frows.length)\n"
    "      wrap.innerHTML = '<div class=\"empty\">anatomy positions still loading — rerun or reopen</div>';\n"
    "    return null;\n"
    "  }\n"
    "  wrap.innerHTML = \"\";\n"
    "  const figs = [];\n"
    "  const phases = [\"test\", \"train\"];       // prefer the test-phase map first\n"
    "  for (const ph of phases){\n"
    "    const rowsPh = frows.filter(r => (r.fireVecMean.phase === ph));\n"
    "    if (!rowsPh.length) continue;\n"
    "    for (const r of rowsPh){\n"
    "      const cv = document.createElement(\"canvas\");\n"
    "      cv.width = 940; cv.height = 430;\n"
    "      cv.style.maxWidth = \"100%\"; cv.style.border = \"1px solid #30363d\";\n"
    "      cv.style.borderRadius = \"6px\"; cv.style.margin = \"6px 0\";\n"
    "      const cond = r.condition || \"run\";\n"
    "      drawAnatMap(cv, b64ToBytes(r.fireVecMean.vec), r.fireVecMean.n,\n"
    "        label + \" — \" + cond + (ph === \"test\" ? \" (test)\" : \" (last train trials)\"),\n"
    "        r.fireVecMean.count + \" trials averaged · \" + r.fireVecMean.n.toLocaleString() + \" neurons at real positions\");\n"
    "      wrap.appendChild(cv);\n"
    "      figs.push({ canvas: cv, cond, ph });\n"
    "    }\n"
    "    break;   // one phase is enough per run (test preferred)\n"
    "  }\n",

    "mean firing per condition from per-trial layerRates (any experiment shape)\n"
    "function condMeanRates(rows, cond){\n"
    "  const acc = {}; let n = 0;\n"
    "  for (const r of rows){\n"
    "    if ((r.condition || \"run\") !== cond || !r.layerRates) continue;\n"
    "    n++;\n"
    "    for (const k in r.layerRates) acc[k] = (acc[k] || 0) + (r.layerRates[k] || 0);\n"
    "  }\n"
    "  if (!n) return null;\n"
    "  const out = {};\n"
    "  for (const k in acc) out[k] = acc[k] / n;\n"
    "  return out;\n"
    "}\n"
    "// fuzzy experiment layer-name -> functional region key (matches worker\n"
    "// naming like 'PN (antennal…', 'Kenyon cells', 'antennal lobe_L', 'MB output')\n"
    "function regionForRateName(nm){\n"
    "  const s = (nm || \"\").toLowerCase();\n"
    "  if (/antennal|\\\\bpn\\\\b|olfact/.test(s)) return \"antennal\";\n"
    "  if (/kenyon|mushroom|\\\\bmb\\\\b/.test(s)) return \"mb\";\n"
    "  if (/optic|medulla|lobula|lamina/.test(s)) return \"optic\";\n"
    "  if (/motor|descend|vnc|neck/.test(s)) return \"motor\";\n"
    "  if (/lateral horn|\\\\blh\\\\b/.test(s)) return \"lh\";\n"
    "  if (/central complex|ellipsoid|fan-shaped|\\\\bCX\\\\b|\\\\beb\\\\b|\\\\bpb\\\\b|\\\\bfb\\\\b/i.test(s)) return \"cx\";\n"
    "  return \"central\";\n"
    "}\n"
    "// region -> neuron ids (real positions), cached\n"
    "const ANAT_REG_MEM = new Map();\n"
    "function regionMembers(){\n"
    "  if (ANAT_REG_MEM.size) return ANAT_REG_MEM;\n"
    "  for (let i = 0; i < ANAT.meta.n; i++){\n"
    "    const rk = ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]);\n"
    "    if (rk){ let a = ANAT_REG_MEM.get(rk); if (!a){ a = []; ANAT_REG_MEM.set(rk, a); } a.push(i); }\n"
    "  }\n"
    "  return ANAT_REG_MEM;\n"
    "}\n"
    "// per-neuron firing vector for a condition: prefer the worker's measured\n"
    "// fireVecMean; otherwise synthesize one from mean layer rates distributed\n"
    "// over each region's real neurons — so EVERY fly-brain condition gets a\n"
    "// real-brain map instead of a block-diagram fallback.\n"
    "function fireVecFor(rows, cond){\n"
    "  const fr = (rows || []).find(r => (r.condition || \"run\") === cond && r.fireVecMean && r.fireVecMean.vec);\n"
    "  if (fr) return { vec: b64ToBytes(fr.fireVecMean.vec), measured: true };\n"
    "  const rates = condMeanRates(rows, cond);\n"
    "  if (!rates || !ANAT.ready) return null;\n"
    "  const mem = regionMembers();\n"
    "  const regRate = {}; let mx = 0;\n"
    "  for (const k in rates){\n"
    "    const rk = regionForRateName(k);\n"
    "    regRate[rk] = (regRate[rk] || 0) + rates[k];\n"
    "  }\n"
    "  for (const k in regRate) mx = Math.max(mx, regRate[k]);\n"
    "  const n = ANAT.meta.n;\n"
    "  const out = new Uint8Array(n);\n"
    "  for (const [rk, ids] of mem){\n"
    "    const v = (regRate[rk] || 0) / (mx || 1);\n"
    "    for (const i of ids){\n"
    "      const jit = 0.7 + 0.6 * (((i * 2654435761) >>> 16 & 255) / 255);\n"
    "      out[i] = Math.min(255, Math.round(6 + v * 190 * jit));\n"
    "    }\n"
    "  }\n"
    "  return { vec: out, measured: false };\n"
    "}\n"
    "let LAST_ANAT_FIG = null;\n"
    "function renderAnatMaps(rows, label){\n"
    "  const wrap = document.getElementById(\"brainWrap\");\n"
    "  if (!wrap) return null;\n"
    "  if (!ANAT.ready){\n"
    "    wrap.innerHTML = '<div class=\"empty\">anatomy positions still loading — rerun or reopen</div>';\n"
    "    return null;\n"
    "  }\n"
    "  // one real-brain map per condition — measured per-neuron firing when the\n"
    "  // worker provides it, region-distributed over real positions otherwise.\n"
    "  const conds = [];\n"
    "  for (const r of (rows || [])){\n"
    "    const c = r.condition || \"run\";\n"
    "    if (!conds.includes(c) && (r.fireVecMean || r.layerRates)) conds.push(c);\n"
    "  }\n"
    "  if (!conds.length){ wrap.innerHTML = '<div class=\"empty\">waiting for a run with a fly brain…</div>'; return null; }\n"
    "  wrap.innerHTML = \"\";\n"
    "  const figs = [];\n"
    "  for (const cond of conds){\n"
    "    const fv = fireVecFor(rows, cond);\n"
    "    if (!fv) continue;\n"
    "    const cv = document.createElement(\"canvas\");\n"
    "    cv.width = 940; cv.height = 430;\n"
    "    cv.style.maxWidth = \"100%\"; cv.style.border = \"1px solid #30363d\";\n"
    "    cv.style.borderRadius = \"6px\"; cv.style.margin = \"6px 0\";\n"
    "    drawAnatMap(cv, fv.vec, ANAT.meta.n,\n"
    "      label + \" — \" + cond + \" — which neurons fired\",\n"
    "      (fv.measured ? \"measured per-neuron firing\" : \"region-mean firing over real positions\") +\n"
    "      \" · \" + ANAT.meta.n.toLocaleString() + \" neurons at real positions\");\n"
    "    wrap.appendChild(cv);\n"    "      figs.push({ canvas: cv, cond, ph: \"test\" });\n"
    ,
    "helpers+renderAnatMaps")

# the strip loop that followed now lives inside the new per-condition loop:
rep(
    "  // region × time firing strip under each condition's anatomical map\n"
    "  const condsSeen = [...new Set(figs.map(f => f.cond))];\n"
    "  for (const cond of condsSeen){\n"
    "    const rowsC = (rows || []).filter(r => (r.condition || \"run\") === cond && r.layerRates);\n"
    "    if (!rowsC.length) continue;\n"
    "    const regs = Object.keys(rowsC[0].layerRates);\n"
    "    const cvS = document.createElement(\"canvas\");\n"
    "    cvS.width = 940; cvS.height = 40 + regs.length * 26 + 64;\n"
    "    drawRegionTimeStrip(cvS, rowsC, cond + \" — region activity across the run (which region fired when)\");\n"
    "    cvS.style.maxWidth = \"100%\"; cvS.style.border = \"1px solid #30363d\";\n"
    "    cvS.style.borderRadius = \"6px\"; cvS.style.margin = \"6px 0\";\n"
    "    wrap.appendChild(cvS);\n"
    "    figs.push({ canvas: cvS, cond, ph: \"strip\" });\n"
    "  }\n",
    "    const rowsC = (rows || []).filter(r => (r.condition || \"run\") === cond && r.layerRates);\n"
    "    if (rowsC.length){\n"
    "      const regs = Object.keys(rowsC[0].layerRates);\n"
    "      const cvS = document.createElement(\"canvas\");\n"
    "      cvS.width = 940; cvS.height = 40 + regs.length * 26 + 64;\n"
    "      drawRegionTimeStrip(cvS, rowsC, cond + \" — region activity across the run (which region fired when)\");\n"
    "      cvS.style.maxWidth = \"100%\"; cvS.style.border = \"1px solid #30363d\";\n"
    "      cvS.style.borderRadius = \"6px\"; cvS.style.margin = \"6px 0\";\n"
    "      wrap.appendChild(cvS);\n"
    "      figs.push({ canvas: cvS, cond, ph: \"strip\" });\n"
    "    }\n"
    "  }\n",
    "strip-into-loop")

# ---------------------------------------------------------------- 2) heat rendering
rep(
    "  // 1) the brain contour: every neuron as a faint grey point\n"
    "  for (let i = 0; i < n; i++){\n"
    "    g.fillStyle = \"rgba(120,132,148,0.30)\";\n"
    "    g.fillRect(px[i] - 0.5, py[i] - 0.5, 1.1, 1.1);\n"
    "  }\n"
    "  // 2) firing heat: additive radial glows, drawn low->high so hot cores sit\n"
    "  //    on top. This is what makes active REGIONS read as glowing masses.\n"
    "  const order = Array.from({length: n}, (_, i) => i);\n"
    "  order.sort((a, b) => (fireBytes ? fireBytes[a] : 0) - (fireBytes ? fireBytes[b] : 0));\n"
    "  g.globalCompositeOperation = \"lighter\";\n"
    "  for (const i of order){\n"
    "    const v = fireBytes ? fireBytes[i] : 0;\n"
    "    if (!v) continue;\n"
    "    const t = Math.min(1, Math.sqrt(v / 255));\n"
    "    if (t < 0.08) continue;                       // skip traces\n"
    "    const [r, gg, b] = anatJetColor(t);\n"
    "    const rad = 2.5 + t * 7;                      // glow radius grows with heat\n"
    "    const a = 0.10 + t * 0.42;\n"
    "    const rg = g.createRadialGradient(px[i], py[i], 0, px[i], py[i], rad);\n"
    "    rg.addColorStop(0, `rgba(${r},${gg},${b},${a.toFixed(2)})`);\n"
    "    rg.addColorStop(1, `rgba(${r},${gg},${b},0)`);\n"
    "    g.fillStyle = rg;\n"
    "    g.beginPath(); g.arc(px[i], py[i], rad, 0, 7); g.fill();\n"
    "  }\n"
    "  // 3) hot cores: bright center dots for the most active cells\n"
    "  for (const i of order){\n"
    "    const v = fireBytes ? fireBytes[i] : 0;\n"
    "    if (!v) continue;\n"
    "    const t = Math.min(1, Math.sqrt(v / 255));\n"
    "    if (t < 0.45) continue;\n"
    "    const [r, gg, b] = anatJetColor(1);           // hottest = red cores\n"
    "    g.fillStyle = `rgba(255,${(200 - t * 130) | 0},${(120 - t * 110) | 0},${(0.35 + t * 0.6).toFixed(2)})`;\n"
    "    g.beginPath(); g.arc(px[i], py[i], 0.8 + t * 1.3, 0, 7); g.fill();\n"
    "  }\n"
    "  g.globalCompositeOperation = \"source-over\";\n",

    "  // 1) quiet baseline: every neuron as a faint deep-blue dot (jet 0) so the\n"
    "  //    whole brain silhouette reads even where nothing fires\n"
    "  for (let i = 0; i < n; i++){\n"
    "    g.fillStyle = \"rgba(24,72,190,0.35)\";\n"
    "    g.fillRect(px[i] - 0.5, py[i] - 0.5, 1.2, 1.2);\n"
    "  }\n"
    "  // 2) firing heat: relative normalization (95th percentile = near-red),\n"
    "  //    gamma-compressed, fine additive glows — active regions read as\n"
    "  //    glowing texture inside the brain, never as saturated blobs.\n"
    "  let p95 = 0;\n"
    "  { const smp = [];\n"
    "    for (let i = 0; i < n; i += 4) if (fireBytes && fireBytes[i] > 0) smp.push(fireBytes[i]);\n"
    "    if (smp.length){ smp.sort((a,b)=>a-b); p95 = smp[(smp.length*0.95)|0]; } }\n"
    "  const scale = Math.max(1, p95);\n"
    "  const tOf = v => Math.min(1, Math.pow(v / scale, 0.65));\n"
    "  const order = Array.from({length: n}, (_, i) => i);\n"
    "  order.sort((a, b) => (fireBytes ? fireBytes[a] : 0) - (fireBytes ? fireBytes[b] : 0));\n"
    "  g.globalCompositeOperation = \"lighter\";\n"
    "  for (const i of order){\n"
    "    const v = fireBytes ? fireBytes[i] : 0;\n"
    "    if (!v) continue;\n"
    "    const t = tOf(v);\n"
    "    if (t < 0.06) continue;                       // skip traces\n"
    "    const [r, gg, b] = anatJetColor(t);\n"
    "    const rad = 1.6 + t * 3.6;\n"
    "    const a = 0.08 + t * 0.34;\n"
    "    const rg = g.createRadialGradient(px[i], py[i], 0, px[i], py[i], rad);\n"
    "    rg.addColorStop(0, `rgba(${r},${gg},${b},${a.toFixed(2)})`);\n"
    "    rg.addColorStop(1, `rgba(${r},${gg},${b},0)`);\n"
    "    g.fillStyle = rg;\n"
    "    g.beginPath(); g.arc(px[i], py[i], rad, 0, 7); g.fill();\n"
    "  }\n"
    "  // 3) hot cores: bright center dots for the most active cells\n"
    "  for (const i of order){\n"
    "    const v = fireBytes ? fireBytes[i] : 0;\n"
    "    if (!v) continue;\n"
    "    const t = tOf(v);\n"
    "    if (t < 0.55) continue;\n"
    "    const [r, gg, b] = anatJetColor(0.8 + 0.2 * t);\n"
    "    g.fillStyle = `rgba(${r},${gg},${b},${(0.30 + t * 0.50).toFixed(2)})`;\n"
    "    g.beginPath(); g.arc(px[i], py[i], 0.6 + t * 1.1, 0, 7); g.fill();\n"
    "  }\n"
    "  g.globalCompositeOperation = \"source-over\";\n",

    "fine-heat")

# ---------------------------------------------------------------- 3) gallery snapshot uses fireVecFor
rep(
    "    if (LAST_ROWS && LAST_ROWS.length && ANAT.ready){\n"
    "      const fr = LAST_ROWS.filter(r => r.fireVecMean && r.fireVecMean.vec);\n"
    "      if (fr.length){\n"
    "        const cvA = document.createElement(\"canvas\");\n"
    "        cvA.width = 940; cvA.height = 430;\n"
    "        const phPref = fr.find(r => r.fireVecMean.phase === \"test\") || fr[0];\n"
    "        drawAnatMap(cvA, b64ToBytes(phPref.fireVecMean.vec), phPref.fireVecMean.n,\n"
    "          label + \" — which neurons fired\",\n"
    "          phPref.fireVecMean.count + \" trials averaged · real FAFB positions\");\n"
    "        // compose the region × time strip for the same condition under the map\n"
    "        const cond = phPref.condition || \"run\";\n",

    "    if (LAST_ROWS && LAST_ROWS.length && ANAT.ready){\n"
    "      const cond0 = ((LAST_ROWS.find(r => r.fireVecMean || r.layerRates)) || {}).condition || \"run\";\n"
    "      const fv0 = fireVecFor(LAST_ROWS, cond0);\n"
    "      if (fv0){\n"
    "        const cvA = document.createElement(\"canvas\");\n"
    "        cvA.width = 940; cvA.height = 430;\n"
    "        drawAnatMap(cvA, fv0.vec, ANAT.meta.n,\n"
    "          label + \" — which neurons fired\",\n"
    "          (fv0.measured ? \"measured per-neuron firing\" : \"region-mean firing\") + \" · real FAFB positions\");\n"
    "        // compose the region × time strip for the same condition under the map\n"
    "        const cond = cond0;\n",

    "snapshot-fireVecFor")

# ---------------------------------------------------------------- 4) debug hook
rep(
    "window.__plotsDebug = { renderAnatMaps, ANAT, drawAnatMap, b64ToBytes, drawAnatDeltaMap, drawRegionTimeStrip, GALLERY };",
    "window.__plotsDebug = { renderAnatMaps, ANAT, drawAnatMap, b64ToBytes, drawAnatDeltaMap, drawRegionTimeStrip, fireVecFor, regionForRateName, GALLERY };",
    "debug-hook")

open(P, "w", encoding="utf-8", newline="").write(src)
m = re.search(r"<script>\r?\n(.*?)</script>", src, re.S)
assert m, "script block not found"
open("_check_plots.js", "w", encoding="utf-8", newline="").write(m.group(1))
print("OK: all patches applied, JS extracted")
