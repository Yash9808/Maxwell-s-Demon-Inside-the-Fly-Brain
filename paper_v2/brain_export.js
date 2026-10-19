#!/usr/bin/env node
/**
 * brain_export.js — decode fireVec payloads (quantized per-neuron spike counts
 * for all 106,765 FAFB v783 neurons) from the paper-program raw rows and export
 * the neural analytics needed for the brain-level figures:
 *
 *   1. ACT_<exp>_<cond>_<win>.bin  : Float32 per-neuron mean model spike count
 *                                    per trial, averaged over seeds.
 *   2. MI_<exp>.json               : per-neuropil MI(model state -> behavior)
 *                                    with Miller-Madow bias correction and
 *                                    per-seed estimates (seed = replicate).
 *   3. TOPCELLS_<exp>.json         : cell-type annotations for the most active
 *                                    neurons (Schlegel-2024 annotations shipped
 *                                    with this repository).
 *
 * Windows: early = first 5 train trials (E9) / first 10 (E4/E5);
 *          late  = remaining train trials; test = test phase.
 * All outputs are derived from raw rows; nothing here fabricates data.
 */
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "processed", "brain");
fs.mkdirSync(OUT, { recursive: true });

const POS = require(path.join("..", "fly_brain_positions.json"));
const CT = require(path.join("..", "fly_brain_celltypes.json"));
const N = POS.x.length;                       // 106,765
const NP_NAMES = POS.np_names;
const PRIM = POS.primary;                     // primary-neuropil index per neuron

// fireVec is base64 of Uint8 quantization q of spike count c:
//   c == 0            -> q = 0
//   1 <= c < 256      -> q = ceil(sqrt(c) * 16)
//   c >= 256          -> q = 255
// Inverse (documented approximation used for figures): c ~= (q/16)^2, capped 256.
function decodeFireVec(b64) {
  const buf = Buffer.from(b64, "base64");
  const out = new Float32Array(N);
  if (buf.length === N) {
    for (let i = 0; i < N; i++) {
      const q = buf[i];
      if (q === 0) continue;
      out[i] = q >= 255 ? 256 : Math.max(1, (q / 16) * (q / 16));
    }
    return out;
  }
  // Mini-circuit payloads (E3 drosophila controller: 248 = 32 PN + 200 KC + 16 MBON;
  // E2/E5 ann controller: 18 = 16 hidden + 2 output). These index their own model
  // units, NOT the FAFB 106,765 space -> returned WITHOUT anatomical mapping.
  const mini = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const q = buf[i];
    if (q === 0) continue;
    mini[i] = q >= 255 ? 256 : Math.max(1, (q / 16) * (q / 16));
  }
  return mini;   // length !== N signals mini-circuit scope
}

function windowOf(r, earlyTrain) {
  if (r.phase === "train") return r.trial < earlyTrain ? "early" : "late";
  return "test";
}

/** Aggregate rows -> per (cond|win) seed-averaged per-neuron activity.
 *  Only FULL-FAFB payloads (length N) produce anatomical bins; mini-circuit
 *  payloads are aggregated separately by unit index (no anatomy). */
function activityBins(rowsFile, earlyTrain, condFilter) {
  const lines = fs.readFileSync(rowsFile, "utf8").trim().split("\n");
  const sums = new Map();    // cond|win -> Float64Array
  const counts = new Map();  // cond|win -> n seeds contributing
  const scope = new Set();   // 'fafb' | 'mini248' | 'mini18'
  for (const l of lines) {
    const r = JSON.parse(l);
    if (!r.fireVec) continue;
    if (condFilter && !condFilter(r.condition)) continue;
    const k = r.condition + "|" + windowOf(r, earlyTrain);
    if (!sums.has(k)) { sums.set(k, new Float64Array(N)); counts.set(k, new Map()); }
    const v = decodeFireVec(r.fireVec.vec);
    if (v.length !== N) {
      scope.add("mini" + v.length);
      continue;                // do not mix mini-circuit units into FAFB space
    }
    scope.add("fafb");
    const acc = sums.get(k);
    for (let i = 0; i < N; i++) acc[i] += v[i];
    const seedCounts = counts.get(k);
    seedCounts.set(r.seed, (seedCounts.get(r.seed) || 0) + 1);
  }
  const out = new Map();
  for (const [k, acc] of sums) {
    if (!scope.has("fafb")) continue;      // whole key was mini-circuit only
    const nTrials = [...counts.get(k).values()].reduce((a, b) => a + b, 0);
    const mean = new Float32Array(N);
    for (let i = 0; i < N; i++) mean[i] = acc[i] / nTrials;
    out.set(k, mean);
  }
  return { bins: out, counts, scope: [...scope] };
}

function saveBin(name, f32) {
  fs.writeFileSync(path.join(OUT, name), Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength));
}

// ---------------------------------------------------------------- MI machinery
// Discrete MI between binarized neuropil activity and binarized behavior,
// plug-in estimator with Miller-Madow bias correction:
//   MI_hat - (R-1)(S-1)/(2 n ln2),  R,S = bin counts.
function miBinned(xs, ys) {
  const n = xs.length;
  if (n < 16) return null;
  const joint = [0, 0, 0, 0]; // [x0y0, x0y1, x1y0, x1y1]
  for (let i = 0; i < n; i++) joint[(xs[i] ? 2 : 0) | (ys[i] ? 1 : 0)]++;
  const px1 = (joint[2] + joint[3]) / n, py1 = (joint[1] + joint[3]) / n;
  let mi = 0;
  for (let x = 0; x <= 1; x++) for (let y = 0; y <= 1; y++) {
    const pxy = joint[x * 2 + y] / n;
    if (pxy > 0) {
      const p = (x ? px1 : 1 - px1) * (y ? py1 : 1 - py1);
      if (p > 0) mi += pxy * Math.log2(pxy / p);
    }
  }
  const bias = 1 / (2 * n * Math.LN2);   // (2-1)(2-1)/(2n ln2)
  return Math.max(0, mi - bias);
}

/** Per-neuropil MI(activity -> behavior) per seed, then mean +- t-CI over seeds. */
function neuropilMI(rowsFile, earlyTrain, conds, behavior) {
  const lines = fs.readFileSync(rowsFile, "utf8").trim().split("\n");
  const rowsByCell = new Map(); // cond -> seed -> [{npAct: Map np->sum, beh}]
  for (const l of lines) {
    const r = JSON.parse(l);
    if (!r.fireVec || !conds.includes(r.condition)) continue;
    const beh = behavior(r);
    if (beh === null || beh === undefined || !isFinite(beh)) continue;
    if (!rowsByCell.has(r.condition)) rowsByCell.set(r.condition, new Map());
    const bySeed = rowsByCell.get(r.condition);
    if (!bySeed.has(r.seed)) bySeed.set(r.seed, []);
    const fv = decodeFireVec(r.fireVec.vec);
    const npAct = {};
    for (let i = 0; i < N; i++) {
      if (fv[i] === 0) continue;
      const nm = NP_NAMES[PRIM[i]];
      if (!nm) continue;
      npAct[nm] = (npAct[nm] || 0) + fv[i];
    }
    bySeed.get(r.seed).push({ npAct, beh });
  }
  const result = {};
  for (const [cond, bySeed] of rowsByCell) {
    // collect per-seed MI per neuropil
    const perSeed = new Map(); // np -> [mi per seed]
    for (const [seed, rows] of bySeed) {
      if (rows.length < 16) continue;
      // per-neuropil activity values for thresholding (median split)
      const totals = new Map();
      for (const row of rows) for (const [np, v] of Object.entries(row.npAct))
        totals.set(np, (totals.get(np) || 0) + v);
      for (const [np, tot] of totals) {
        const vals = rows.map(r => r.npAct[np] || 0);
        const sorted = [...vals].sort((a, b) => a - b);
        const med = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
        const xs = vals.map(v => v > med ? 1 : 0);
        const ys = rows.map(r => r.beh ? 1 : 0);
        const m = miBinned(xs, ys);
        if (m === null) continue;
        if (!perSeed.has(np)) perSeed.set(np, []);
        perSeed.get(np).push(m);
      }
    }
    // summarize
    const summary = {};
    for (const [np, arr] of perSeed) {
      if (arr.length < 5) continue;              // require >= 5 seeds
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (arr.length - 1));
      summary[np] = { mean, sd, nSeeds: arr.length };
    }
    result[cond] = { nTrialsPerSeed: [...bySeed.values()][0].length, neuropils: summary };
  }
  return result;
}

/** Mini-circuit MI: per-neuron unit activity (length !== N) -> behavior, per
 *  seed, for each controller population block (E3: PN/KC/MBON). Descriptive only
 *  when nSeeds < 5. */
function miniMI(rowsFile, earlyTrain, conds, behavior) {
  const lines = fs.readFileSync(rowsFile, "utf8").trim().split("\n");
  const byCell = new Map();  // cond -> seed -> [{blocks:{pn:[],kc:[],mb:[]}, beh}]
  for (const l of lines) {
    const r = JSON.parse(l);
    if (!r.fireVec || !r.fireVec.vec || !conds.includes(r.condition)) continue;
    const v = decodeFireVec(r.fireVec.vec);
    if (v.length === N) continue;
    const beh = behavior(r);
    if (beh === null || beh === undefined || !isFinite(beh)) continue;
    if (!byCell.has(r.condition)) byCell.set(r.condition, new Map());
    const bySeed = byCell.get(r.condition);
    if (!bySeed.has(r.seed)) bySeed.set(r.seed, []);
    const blocks = { pn: v.slice(0, 32), kc: v.slice(32, 232), mb: v.slice(232, 248) };
    bySeed.get(r.seed).push({ blocks, beh });
  }
  const result = {};
  for (const [cond, bySeed] of byCell) {
    const perSeed = new Map(); // block -> [mi per seed]
    for (const [seed, rows] of bySeed) {
      if (rows.length < 16) continue;
      for (const block of ["pn", "kc", "mb"]) {
        const vals = rows.map(r => r.blocks[block].reduce((a, b) => a + b, 0));
        const pos = vals.some(x => x > 0);
        if (!pos) continue;
        const sorted = [...vals].sort((a, b) => a - b);
        const med = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2;
        const xs = vals.map(v2 => v2 > med ? 1 : 0);
        if (new Set(xs).size < 2) continue;
        const ys = rows.map(r => r.beh);
        if (new Set(ys).size < 2) continue;
        const m = miBinned(xs, ys);
        if (m === null) continue;
        if (!perSeed.has(block)) perSeed.set(block, []);
        perSeed.get(block).push(m);
      }
    }
    result[cond] = { nTrialsPerSeed: [...bySeed.values()][0].length,
      blocks: Object.fromEntries([...perSeed.entries()].map(([b, arr]) => [b, {
        mean: arr.reduce((a, c) => a + c, 0) / arr.length,
        nSeeds: arr.length,
        perSeed: arr,
      }])) };
  }
  return result;
}

// ------------------------------------------------------------------- E9 export
const E9_CONDS = ["demon_neural", "demon_frozen"];
{
  const { bins } = activityBins(path.join(__dirname, "raw", "E9_rows.jsonl"), 5,
    c => E9_CONDS.includes(c));
  for (const [k, mean] of bins) {
    const [cond, win] = k.split("|");
    saveBin(`ACT_E9_${cond}_${win}.bin`, mean);
  }
  console.log("E9 activity bins:", [...bins.keys()].join(", "));

  // MI vs behavioral variables (per seed -> mean +- sd over seeds)
  const miSuccess = neuropilMI(path.join(__dirname, "raw", "E9_rows.jsonl"), 5, E9_CONDS,
    r => (r.success === true ? 1 : r.success === false ? 0 : null));
  const miAcc = neuropilMI(path.join(__dirname, "raw", "E9_rows.jsonl"), 5, E9_CONDS,
    r => (typeof r.decisionAccuracy === "number" ? (r.decisionAccuracy > 0.5 ? 1 : 0) : null));
  fs.writeFileSync(path.join(OUT, "MI_E9.json"), JSON.stringify({
    behavior: {
      success: miSuccess,
      decisionAboveChance: miAcc,
    },
    note: "MI(model neuropil state -> behavior), binarized (median-split activity, binary behavior), Miller-Madow corrected; per-seed estimates averaged; seed = replicate.",
  }, null, 2));
  console.log("E9 MI saved");
}

// ------------------------------------------------------------------ E4 export
{
  const { bins } = activityBins(path.join(__dirname, "raw", "E4_rows_s0.jsonl"), 10);
  for (const [k, mean] of bins) {
    const [cond, win] = k.split("|");
    saveBin(`ACT_E4s0_${cond}_${win}.bin`, mean);
  }
  const { bins: bins1 } = activityBins(path.join(__dirname, "raw", "E4_rows_s1.jsonl"), 10);
  for (const [k, mean] of bins1) {
    const [cond, win] = k.split("|");
    saveBin(`ACT_E4s1_${cond}_${win}.bin`, mean);
  }
  console.log("E4 activity bins:", [...bins.keys()].map(k => k + " (s0)").join(", "),
    "|", [...bins1.keys()].map(k => k + " (s1)").join(", "));
}

// -------------------------------------------------- E3 export (door task)
// The E3 drosophila controller runs a 248-unit MB mini-circuit (32 PN + 200 KC
// + 16 MBON; controllers.js). Its fireVec indexes THOSE units, not FAFB space,
// so E3 yields MINI-CIRCUIT activity + layerRates (PN/KC/MBON), not anatomy.
{
  const lines = fs.readFileSync(path.join(__dirname, "raw", "E3_rows.jsonl"), "utf8").trim().split("\n");
  // per (cond|win) mean over rows of the 248-unit vector + layerRates
  const sums = new Map(), counts = new Map(), lays = new Map();
  for (const l of lines) {
    const r = JSON.parse(l);
    if (!r.fireVec || !r.fireVec.vec) continue;
    const v = decodeFireVec(r.fireVec.vec);
    if (v.length === N) continue;                 // safety: skip FAFB payloads
    const k = r.condition + "|" + windowOf(r, 5);
    if (!sums.has(k)) { sums.set(k, new Float64Array(v.length)); counts.set(k, new Map()); lays.set(k, { pn: [], kc: [], mb: [] }); }
    const acc = sums.get(k);
    for (let i = 0; i < v.length; i++) acc[i] += v[i];
    const sc = counts.get(k); sc.set(r.seed, (sc.get(r.seed) || 0) + 1);
    const L = lays.get(k);
    if (r.layerRates) {
      L.pn.push(r.layerRates["PN (antennal lobe)"] || 0);
      L.kc.push(r.layerRates["Kenyon cells"] || 0);
      L.mb.push(r.layerRates["MB output"] || 0);
    }
  }
  const miniOut = {};
  for (const [k, acc] of sums) {
    const n = [...counts.get(k).values()].reduce((a, b) => a + b, 0);
    const mean = new Float32Array(acc.length);
    for (let i = 0; i < acc.length; i++) mean[i] = acc[i] / n;
    const fn = `ACT_E3_${k.replace("|", "_")}.bin`;
    saveBin(fn, mean);
    const L = lays.get(k);
    miniOut[k] = { file: fn, layout: { pn: 32, kc: 200, mbon: 16 }, nTrials: n,
      layerRates: { pn: L.pn.reduce((a, b) => a + b, 0) / L.pn.length,
                    kc: L.kc.reduce((a, b) => a + b, 0) / L.kc.length,
                    mbon: L.mb.reduce((a, b) => a + b, 0) / L.mb.length } };
  }
  fs.writeFileSync(path.join(OUT, "MINI_E3.json"), JSON.stringify({
    scope: "248-unit mushroom-body mini-circuit (32 PN + 200 KC + 16 MBON) — NOT mapped to FAFB anatomy",
    decode: "fireVec sqrt-quantization inverse c=(q/16)^2; PN/KC/MBON are controller units, not biological neurons",
    bins: miniOut,
  }, null, 2));
  console.log("E3 mini-circuit bins:", Object.keys(miniOut).join(", "));
  // MI at mini-circuit level: PN/KC/MBON population activity -> crossed
  const miCross = miniMI(path.join(__dirname, "raw", "E3_rows.jsonl"), 5,
    ["drosophila", "drosophila_frozen"], r => (r.crossings > 0 ? 1 : 0));
  fs.writeFileSync(path.join(OUT, "MI_E3.json"), JSON.stringify({
    scope: "mini-circuit populations (PN/KC/MBON) -> behavior; NOT anatomical MI",
    behavior: { crossed: miCross },
    note: "MI(population rate state -> trial had >=1 crossing), binarized (median-split), Miller-Madow; per-seed then mean. nSeeds=2 -> descriptive only.",
  }, null, 2));
  console.log("E3 mini MI saved");
}

// ------------------------------------------------------------------ E5 export
// Only the connectome/shuffled_connectome conditions carry full FAFB payloads.
// ann (18-unit) and drosophila (248-unit) fireVecs are mini-circuit scope and
// are reported as such, not mapped to anatomy.
{
  const { bins } = activityBins(path.join(__dirname, "raw", "E5_rows_s0.jsonl"), 10,
    c => ["connectome", "shuffled_connectome"].includes(c));
  for (const [k, mean] of bins) {
    const [cond, win] = k.split("|");
    saveBin(`ACT_E5s0_${cond}_${win}.bin`, mean);
  }
  console.log("E5 FAFB activity bins:", [...bins.keys()].join(", "));
}

// --------------------------------------------------- cell-type labels for tops
{
  // annotate the union of the most active neurons in each exported bin
  const files = fs.readdirSync(OUT).filter(f => f.startsWith("ACT_") && f.endsWith(".bin"));
  const topGlobal = new Map(); // idx -> max activity across bins
  for (const f of files) {
    const b = fs.readFileSync(path.join(OUT, f));
    const arr = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > (topGlobal.get(i) || 0)) topGlobal.set(i, arr[i]);
    }
  }
  const entries = [...topGlobal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400);
  const ann = CT.neurons;
  const topCells = entries.map(([idx, act]) => ({
    idx,
    root_id: ann[idx] ? ann[idx].root_id : null,
    cell_type: ann[idx] ? ann[idx].cell_type : null,
    nt_class: ann[idx] ? ann[idx].nt_class : null,
    neuropil: NP_NAMES[PRIM[idx]],
    act: act,
  }));
  fs.writeFileSync(path.join(OUT, "TOPCELLS.json"), JSON.stringify(topCells, null, 1));
  console.log("TOPCELLS saved:", topCells.length);
}

// ------------------------------------------------------ neuropil-level summary
{
  // per-neuron primary-neuropil membership sizes (for normalizing "fraction active")
  const counts = {};
  for (let i = 0; i < N; i++) {
    const nm = NP_NAMES[PRIM[i]];
    if (!nm) continue;
    counts[nm] = (counts[nm] || 0) + 1;
  }
  fs.writeFileSync(path.join(OUT, "NEUROPIL_SIZES.json"), JSON.stringify(counts));
  console.log("neuropil sizes saved:", Object.keys(counts).length);
}
console.log("brain_export done");
