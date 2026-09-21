# -*- coding: utf-8 -*-
"""
Patch: E3 drosophilaController anatomical upgrade (controllers.js).

1. wPNVis  — dedicated learned visual-bin -> PN weights, replacing the
   `wPN[(i % 7) * NPN + p]` row-sharing hack. Reward-gated conjunctive LTP.
2. MBON pool — 16-neuron mushroom-body output layer with plastic KC->MBON
   synapses (wMB). Winner-take-all race decides the readout; the winner's
   normalized share drives the door (mbOut), and dopamine gates LTP/LTD on
   the winner's KC synapses (contrast LTD on the losers).
3. wKC stays as the fixed KC drive gain (no longer plastic); sensor->PN
   wiring (wPN) stays fixed.
4. fireVec grows NPN+NKC -> NPN+NKC+NMBON (248) with layout.mbon; the PN
   slots now report true PN rates (pnAct) instead of KC-spike leftovers.

Every anchor is asserted to occur exactly once (CRLF file).
"""
import sys

P = "controllers.js"
src = open(P, "r", encoding="utf-8", newline="").read()
CRLF = "\r\n"

def J(*lines):
    return CRLF.join(lines) + CRLF

def rep(old, new, tag):
    global src
    n = src.count(old)
    assert n == 1, "[%s] expected 1 occurrence, found %d" % (tag, n)
    src = src.replace(old, new)
    print("patched:", tag)

# ---------------------------------------------------------------- A0: doc --
rep(J(
"/**",
" * Simplified mushroom-body architecture (PDF Experiment 3):",
" *   sensory (7) -> projection neurons (sparse) -> Kenyon-like population",
" *   -> MB output -> dopamine-gated decision -> motor (door).",
" * Dopamine implements the classic MB valence rule: reward depresses",
" * active KC->output weights (approach), punishment potentiates them.",
" */",
), J(
"/**",
" * Simplified mushroom-body architecture (PDF Experiment 3):",
" *   sensory (7) + visual field (8 bins) -> projection neurons -> Kenyon-like",
" *   population -> MBON output pool (16) -> dopamine-gated decision -> motor",
" *   (door).",
" * Two reward-gated plasticity sites: KC->MBON synapses (wMB; winner-take-all",
" * LTP on the MBON that won the last race, contrast LTD on the losers) and",
" * visual-bin->PN weights (wPNVis; conjunctive LTP). KC drive gains (wKC) and",
" * sensor->PN wiring (wPN) are fixed.",
" */",
), "A0 docstring")

# ------------------------------------------------- A1: constants + weights --
rep(J(
"  const NPN = 32, NKC = 200;",
"  const KC_ACTIVE = 12;                       // sparse winnner-take-all",
"  const wPN = new Float32Array(7 * NPN);",
"  const wKC = new Float32Array(NKC);          // KC -> MB output (single output)",
"  for (let i = 0; i < wPN.length; i++) wPN[i] = rng();",
"  for (let i = 0; i < NKC; i++) wKC[i] = 0.5 + rng() * 0.5;",
"  const kcThr = new Float32Array(NKC);",
"  for (let i = 0; i < NKC; i++) kcThr[i] = 0.3 + rng() * 0.4;",
), J(
"  const NPN = 32, NKC = 200, NMBON = 16;",
"  const KC_ACTIVE = 12;                       // sparse winnner-take-all",
"  const wPN = new Float32Array(7 * NPN);      // sensor -> PN (fixed wiring)",
"  const wPNVis = new Float32Array(8 * NPN);   // visual bin -> PN (LEARNED, reward-gated)",
"  const wKC = new Float32Array(NKC);          // KC drive gain (fixed; not plastic)",
"  const wMB = new Float32Array(NMBON * NKC);  // KC -> MBON synapses (LEARNED, reward-gated)",
"  for (let i = 0; i < wPN.length; i++) wPN[i] = rng();",
"  for (let i = 0; i < wPNVis.length; i++) wPNVis[i] = rng();",
"  for (let i = 0; i < NKC; i++) wKC[i] = 0.5 + rng() * 0.5;",
"  for (let i = 0; i < wMB.length; i++) wMB[i] = 0.05 + rng() * 0.15;",
"  const kcThr = new Float32Array(NKC);",
"  for (let i = 0; i < NKC; i++) kcThr[i] = 0.3 + rng() * 0.4;",
), "A1 weights")

# ------------------------------------------------------------- A2: state --
rep(J(
"  const kcAct = new Float32Array(NKC);",
"  let mbOut = 0, baseline = 0.5, learning = true;",
), J(
"  const pnAct = new Float32Array(NPN);        // PN rates (this step)",
"  const kcAct = new Float32Array(NKC);        // binary KC spikes (this step)",
"  const mb = new Float32Array(NMBON);         // MBON drives (this step)",
"  let mbWinner = 0, lastVis = null;           // last race winner / visual field",
"  let mbOut = 0, baseline = 0.5, learning = true;",
), "A2 state")

# ------------------------------------------------- A3b: keep visual field --
rep(J(
"    const s = env2.readSensors();",
"    const v = env2.readVisualField();",
), J(
"    const s = env2.readSensors();",
"    const v = env2.readVisualField();",
"    lastVis = v;",
), "A3b lastVis")

# --------------------------------------------- A3: PN loop -> wPNVis/pnAct --
rep(J(
"      for (let i = 0; i < 8; i++) a += v[i] * 0.5 * wPN[(i % 7) * NPN + p];",
"      kcAct[p] = a / 7;                       // reuse first NPN slots",
"      if (kcAct[p] > 0.5) layerSums.pn++;     // PN \"spike\" (thresholded rate)",
), J(
"      for (let i = 0; i < 8; i++) a += v[i] * 0.5 * wPNVis[i * NPN + p]; // learned visual-PN weights",
"      pnAct[p] = a / 7;",
"      if (pnAct[p] > 0.5) layerSums.pn++;     // PN \"spike\" (thresholded rate)",
), "A3 PN visual")

# ------------------------------------------------------ A4: KC drive gain --
rep("      const drive = kcAct[p] * wKC[k] + (rng() - 0.5) * 0.05;",
    "      const drive = pnAct[p] * wKC[k] + (rng() - 0.5) * 0.05;",
    "A4 KC drive")

# --------------------------------------------------- A5: MBON forward pass --
rep(J(
"    let active = 0;",
"    for (let k = 0; k < NKC; k++) if (kcAct[k]) active++;",
"    // guarantee sparsity: keep only top-KC_ACTIVE (approximation: threshold)",
"    mbOut = active / NKC;",
"    if (mbOut > 0.06) layerSums.mb++;          // MB output bin fired",
"    layerSteps.mb++;",
"    return mbOut;",
), J(
"    // ---- MBON output layer: sparse KC code drives learned KC->MBON synapses.",
"    // Winner-take-all race decides the readout; the winner's normalized share",
"    // of pool drive (mbOut) is the rate the door comparator tracks. Rest bias",
"    // + noise keep every MBON winnable before learning specializes the pool.",
"    for (let m = 0; m < NMBON; m++) mb[m] = 0.05 + rng() * 0.10;",
"    for (let k = 0; k < NKC; k++) {",
"      if (!kcAct[k]) continue;",
"      const w = wKC[k];",
"      for (let m = 0; m < NMBON; m++) mb[m] += wMB[k * NMBON + m] * w;",
"    }",
"    let mbSum = 0, mbMax = 0, win = 0;",
"    for (let m = 0; m < NMBON; m++) { mbSum += mb[m]; if (mb[m] > mbMax) { mbMax = mb[m]; win = m; } }",
"    mbWinner = win;",
"    mbOut = mbMax / (mbSum + 0.05);             // winner share of pool drive",
"    if (mbMax > 0.25) layerSums.mb++;           // a MBON fired above rest bias",
"    layerSteps.mb++;",
"    return mbOut;",
), "A5 MBON forward")

# --------------------------------------------- A7: dopamine-gated learning --
rep(J(
"      // MB rule: reward -> depress active KC weights; punish -> potentiate",
"      for (let k = 0; k < NKC; k++) {",
"        if (kcAct[k]) {",
"          wKC[k] = clamp(wKC[k] - 0.02 * da.v, 0.05, 2.0);",
"        }",
"      }",
), J(
"      // Dopamine-gated plasticity, two sites:",
"      //  1) KC->MBON (wMB): the MBON that won the last race gets LTP on its",
"      //     active-KC synapses (reward) or LTD (punishment); every loser",
"      //     gets the opposite sign on the same active set (race contrast).",
"      //  2) visual bin -> PN (wPNVis): conjunctive LTP where the last",
"      //     visual field and the spiking PN crowd overlapped.",
"      if (da.v !== 0 && lastVis) {",
"        for (let k = 0; k < NKC; k++) {",
"          if (!kcAct[k]) continue;",
"          const w = wKC[k];",
"          wMB[k * NMBON + mbWinner] = clamp(wMB[k * NMBON + mbWinner] + 0.10 * da.v * w, 0, 0.5);",
"          for (let m = 0; m < NMBON; m++) {",
"            if (m === mbWinner) continue;",
"            wMB[k * NMBON + m] = clamp(wMB[k * NMBON + m] - 0.02 * da.v * wMB[k * NMBON + m], 0, 0.5);",
"          }",
"        }",
"        for (let b = 0; b < 8; b++) {",
"          if (!(lastVis[b] > 0.05)) continue;",
"          for (let p = 0; p < NPN; p++) {",
"            if (pnAct[p] > 0.5) wPNVis[b * NPN + p] = clamp(wPNVis[b * NPN + p] + 0.05 * da.v, 0, 1.5);",
"          }",
"        }",
"      }",
), "A7 plasticity")

# ----------------------------------------------------------- A8: fireVec --
rep(J(
"      // kcAct holds PN rates in its first NPN slots and KC spikes after;",
"      // counts are cumulative for the trial via layerSums-style accumulation,",
"      // so we snapshot current activity quantized like the connectome ctrl.",
"      const q = new Uint8Array(NPN + NKC);",
"      for (let i = 0; i < NPN; i++) {",
"        const v = Math.max(0, kcAct[i]) * 8;    // PN rate proxy",
"        q[i] = Math.min(255, Math.ceil(Math.sqrt(v) * 16));",
"      }",
"      for (let k = 0; k < NKC; k++) {",
"        const c = kcAct[k] > 0.5 ? 4 : 0;       // binary KC spike",
"        q[NPN + k] = c;",
"      }",
), J(
"      // Snapshot of the last step's activity: PN rates, binary KC spikes",
"      // and MBON drives, quantized like the connectome controller.",
"      const q = new Uint8Array(NPN + NKC + NMBON);",
"      for (let i = 0; i < NPN; i++) {",
"        const v = Math.max(0, pnAct[i]) * 8;    // PN rate",
"        q[i] = Math.min(255, Math.ceil(Math.sqrt(v) * 16));",
"      }",
"      for (let k = 0; k < NKC; k++) {",
"        const c = kcAct[k] > 0.5 ? 4 : 0;       // binary KC spike",
"        q[NPN + k] = c;",
"      }",
"      for (let m = 0; m < NMBON; m++) {",
"        const v = Math.max(0, mb[m] - 0.05) * 8; // MBON drive above rest bias",
"        q[NPN + NKC + m] = Math.min(255, Math.ceil(Math.sqrt(v) * 16));",
"      }",
), "A8 fireVec body")

rep("      return { vec: b64, n: q.length, layout: { pn: NPN, kc: NKC } };",
    "      return { vec: b64, n: q.length, layout: { pn: NPN, kc: NKC, mbon: NMBON } };",
    "A8 fireVec layout")

open(P, "w", encoding="utf-8", newline="").write(src)
print("controllers.js patched OK")
