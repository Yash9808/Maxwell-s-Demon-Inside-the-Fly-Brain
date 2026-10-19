#!/usr/bin/env node
/**
 * audit_skeletons.js — anatomical validation gate for fly_skeletons/.
 *
 * A registered skeleton is SCIENTIFIC only if (a) it stays inside the head
 * capsule, and (b) each anatomical class sits with its population CENTER at
 * the measured FAFB location of the same anatomy, with a realistic fraction of
 * its neurons near that location.
 *
 * Ground truth per class+side: the measured FAFB population
 * (fly_brain_positions.bin prim-indexed neurons; the page itself places those
 * neurons inside their neuropil geometry), summarized by per-axis median M,
 * median absolute deviation MAD, and atlas scale S (rms of the class neuropil
 * boxes' half-extents).
 *
 * Gates (G4 PER NEURON — robust to arbors crossing the midline):
 *   G1 head containment — >=85% of points inside fly_head_shell.json bbox
 *   G2 axis overshoot   — no axis extends >1.5x beyond the head bbox
 *   G3 class center     — the batch's per-side CENTER (median over neurons of
 *                         each neuron's point-median) sits within 3 MAD of the
 *                         measured M. This is the quantity the fetcher anchors
 *                         (verified exact for MB/LO/ME/CX); individual whole-
 *                         neuron medians legitimately spread 1-3 neuropil scales
 *                         for multi-compartment classes (MB calyx<->lobes), so
 *                         centering — not per-neuron collapse — is the contract.
 *   G4 placement        — >=50% of neurons within 3x S of M. Whole-neuron
 *                         medians legitimately spread 1-3 neuropil scales for
 *                         multi-compartment classes (MB calyx<->lobes, CX
 *                         FB<->EB<->PB), and the schematic atlas compresses
 *                         those spans; 3xS + 50% tolerates real anatomy while
 *                         still failing gross sprawl (the v1 bug: whole
 *                         regions displaced by a wrong bbox fit).
 * Bilateral neurons are assigned to a side by their OWN median x sign
 * (scene midline ~= 0: measured AL -27/+41, LO -244/+242, ME -316/+316).
 *
 * RUN:  node tools/audit_skeletons.js     → exit 1 on any FAIL
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

const meta = JSON.parse(fs.readFileSync(path.join(ROOT, "fly_brain_meta.json"), "utf8"));
const shell = JSON.parse(fs.readFileSync(path.join(ROOT, "fly_head_shell.json"), "utf8"));
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "fly_skeletons", "index.json"), "utf8"));

// class -> { neuropils per side, bilateral }  (mirrors fetcher v8 anchors)
const CLASSES = {
  anten:   { L: ["AL_L"], R: ["AL_R"], bilat: true },
  mb:      { L: ["MB_CA_L", "MB_ML_L", "MB_VL_L", "MB_PED_L"],
             R: ["MB_CA_R", "MB_ML_R", "MB_VL_R", "MB_PED_R"], bilat: true },
  lobula:  { L: ["LO_L"], R: ["LO_R"], bilat: true },
  medulla: { L: ["ME_L"], R: ["ME_R"], bilat: true },
  cx:      { L: ["FB"], R: ["FB"], bilat: false },
};
// color region -> ordered class batches (shared outKey numbering, in fetch order)
const REGION_BATCHES = {
  anten:   ["anten"],
  mb:      ["mb"],
  optic:   ["lobula", "medulla"],
  central: ["cx", "cx", "cx"],           // FB / EB / PB download batches, one anchor
};
const REGION_FBBT = {
  anten: ["FBbt_00003924"], mb: ["FBbt_00003685"],
  optic: ["FBbt_00003852", "FBbt_00003748"],
  central: ["FBbt_00003679", "FBbt_00003678", "FBbt_00003668"],
};

// ---------- measured populations ------------------------------------------
const pbuf = fs.readFileSync(path.join(ROOT, "fly_brain_positions.bin"));
let nNeurons = meta.n || Math.floor(pbuf.byteLength / 7);
if (pbuf.byteLength !== nNeurons * 7) nNeurons = Math.floor(pbuf.byteLength / 7);
const P16 = new Int16Array(pbuf.buffer, pbuf.byteOffset, nNeurons * 3);
const PRIM = new Uint8Array(pbuf.buffer, pbuf.byteOffset + nNeurons * 6, nNeurons);
const npIdx = new Map(meta.np_names.map((nm, i) => [nm, i]));
function medianOf(col){
  col.sort((a, b) => a - b);
  const m = col.length >> 1;
  return col.length % 2 ? col[m] : (col[m - 1] + col[m]) / 2;
}
function popStats(names){
  const want = new Set(names.map(nm => npIdx.get(nm)).filter(v => v !== undefined));
  const pts = [];
  for (let i = 0; i < nNeurons; i++)
    if (want.has(PRIM[i])) pts.push(P16[i * 3] * 0.1, P16[i * 3 + 1] * 0.1, P16[i * 3 + 2] * 0.1);
  if (pts.length < 30) return null;
  const M = [0, 1, 2].map(k => medianOf(pts.filter((_, j) => j % 3 === k)));
  const MAD = [0, 1, 2].map(k => {
    const col = [];
    for (let i = k; i < pts.length; i += 3) col.push(Math.abs(pts[i] - M[k]));
    return Math.max(4, medianOf(col));   // floor: quantization noise
  });
  // atlas scale: rms half-extent of the class's neuropil boxes
  const gs = names.map(nm => meta.neuropils[nm]).filter(Boolean);
  const S = gs.length ? Math.sqrt(gs.reduce((a, g) => a + (g.s[0] ** 2 + g.s[1] ** 2 + g.s[2] ** 2) / 3, 0) / gs.length) : 20;
  return { M, MAD, S, n: pts.length / 3 };
}
const STATS = {};
for (const [nm, c] of Object.entries(CLASSES))
  STATS[nm] = { L: popStats(c.L), R: popStats(c.R) };

let fails = 0;
const report = [];
console.log("skeleton audit — registrationVersion", idx.registrationVersion || 1,
            "| global scale", idx.globalFit ? idx.globalFit.scale : "n/a",
            "| measured populations: FAFB", nNeurons, "neurons");
for (const [reg, batches] of Object.entries(REGION_BATCHES)){
  const fbbts = REGION_FBBT[reg];
  const files = idx.files.filter(f => f.startsWith("skel_" + reg + "_")).sort();
  const perBatch = files.length / batches.length;
  for (let b = 0; b < batches.length; b++){
    const cls = batches[b], fbbt = fbbts[b];
    const batchFiles = files.slice(Math.round(b * perBatch), Math.round((b + 1) * perBatch));
    // pass 1: per-neuron point medians + head containment
    const neurons = [];                     // { med:[x,y,z], n, head }
    let nPts = 0, nHead = 0;
    const mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
    for (const f of batchFiles){
      const txt = fs.readFileSync(path.join(ROOT, "fly_skeletons", f), "utf8");
      const sx = [], sy = [], sz = [];
      let head = 0, cnt = 0;
      for (const ln of txt.split(/\r?\n/)){
        if (!ln || ln[0] === "#") continue;
        const c = ln.split(/\s+/);
        if (c.length < 7) continue;
        const x = +c[2], y = +c[3], z = +c[4];
        sx.push(x); sy.push(y); sz.push(z);
        cnt++;
        for (let k = 0, p = [x, y, z]; k < 3; k++){
          if (p[k] < mn[k]) mn[k] = p[k];
          if (p[k] > mx[k]) mx[k] = p[k];
        }
        let h = true;
        for (let k = 0, p = [x, y, z]; k < 3; k++)
          if (p[k] < shell.bbox_min[k] || p[k] > shell.bbox_max[k]) h = false;
        if (h) head++;
      }
      if (!cnt) continue;
      neurons.push({ med: [medianOf(sx), medianOf(sy), medianOf(sz)], n: cnt, head });
      nPts += cnt; nHead += head;
    }
    if (!neurons.length){ report.push([reg, fbbt, cls, "-", "SKIP", "no neurons"]); continue; }
    // pass 2: per-neuron side assignment + population gates
    const sides = CLASSES[cls].bilat ? ["L", "R"] : ["L"];
    for (const side of sides){
      const st = STATS[cls][side];
      if (!st){ report.push([reg, fbbt, cls, side, "SKIP", "no measured population"]); continue; }
      const mine = neurons.filter(nr => CLASSES[cls].bilat
        ? (side === "L" ? nr.med[0] < 0 : nr.med[0] >= 0) : true);
      if (!mine.length){ report.push([reg, fbbt, cls, side, "SKIP", "no neurons on this side"]); continue; }
      const dAbs = mine.map(nr => Math.hypot(nr.med[0] - st.M[0], nr.med[1] - st.M[1], nr.med[2] - st.M[2]));
      // class center = median over neuron medians, per axis (the anchored quantity)
      const C = [medianOf(mine.map(nr => nr.med[0])),
                 medianOf(mine.map(nr => nr.med[1])),
                 medianOf(mine.map(nr => nr.med[2]))];
      const cDist = Math.hypot((C[0] - st.M[0]) / st.MAD[0],
                               (C[1] - st.M[1]) / st.MAD[1],
                               (C[2] - st.M[2]) / st.MAD[2]);
      const placed = dAbs.filter(v => v <= 3 * st.S).length / mine.length * 100;
      const headPct = 100 * nHead / nPts;
      let over = 0;
      for (let k = 0; k < 3; k++){
        if (mn[k] < shell.bbox_min[k]) over = Math.max(over, (shell.bbox_min[k] - mn[k]) / (shell.bbox_max[k] - shell.bbox_min[k]) * 2);
        if (mx[k] > shell.bbox_max[k]) over = Math.max(over, (mx[k] - shell.bbox_max[k]) / (shell.bbox_max[k] - shell.bbox_min[k]) * 2);
      }
      const g1 = headPct >= 85, g2 = over <= 1.5, g3 = cDist <= 3, g4 = placed >= 50;
      const bad = !(g1 && g2 && g3 && g4);
      if (bad) fails++;
      report.push([reg, fbbt, cls, side,
        `${g1 ? "PASS" : "FAIL"} G1 head ${headPct.toFixed(1)}%`,
        `${g2 ? "PASS" : "FAIL"} G2 over ${over.toFixed(2)}x`,
        `${g3 ? "PASS" : "FAIL"} G3 center ${cDist.toFixed(2)} MAD (n=${mine.length})`,
        `${g4 ? "PASS" : "FAIL"} G4 placed ${placed.toFixed(0)}%(>=50 @3xS=${(3 * st.S).toFixed(0)}u)`,
        bad ? `M=[${st.M.map(v=>v.toFixed(0))}] S=${st.S.toFixed(0)}` : ""]);
    }
  }
}
for (const r of report) console.log("  " + r.join("  "));
console.log("\n" + (fails ? `AUDIT FAILED: ${fails} class-side(s) out of gates` : "AUDIT PASSED: all class-sides within anatomical gates"));
process.exit(fails ? 1 : 0);
