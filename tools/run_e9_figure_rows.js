#!/usr/bin/env node
"use strict";
/**
 * tools/run_e9_figure_rows.js — Figure-B activity data for the publication
 * figures, from REAL experiment rows only.
 *
 * Two modes:
 *   --rows <file.jsonl>  aggregate an existing frozen E9 batch JSONL
 *                        (default: newest research_data/e9_batch_*.jsonl that
 *                        carries fireVec). Read-only; Phase-03 results are not
 *                        touched. This is the default and preferred mode.
 *   --live [--seeds N]   run the real E9 machinery now (experiment_core.js +
 *                        controllers.js, unmodified) and aggregate those rows.
 *
 * Output: research_data/figure_rows.json with, per condition:
 *   fireVecMean/Early/Late : mean quantized firing vector (b64 uint8)
 *   layerRatesEarly/Late   : per-region mean firing rate (5 coarse regions)
 *   bundleDelta            : per real pathway bundle, mean quantized firing of
 *                            its PRE neurons (early, late) and the late-early
 *                            delta, plus synapse-weighted member means
 *   regionDelta            : same per anatomical target region (post_neuropil)
 * Early/late windows are consecutive B-trial TRAIN blocks (B = the run's own
 * block size from its summary provenance). Delta = late - early is computed
 * downstream in the figure renderer on identical coordinates.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}
const hasFlag = (n) => args.includes("--" + n);

function b64ToBytes(b64) { return Buffer.from(b64, "base64"); }
function bytesToB64(buf) { return Buffer.from(buf).toString("base64"); }

/** mean of quantized uint8 vectors (rounded to nearest int, byte-clamped) */
function meanVectors(vecs) {
  if (!vecs.length) return null;
  const n = vecs[0].length;
  const acc = new Float64Array(n);
  for (const v of vecs) {
    if (v.length !== n) throw new Error("fireVec length mismatch across rows");
    for (let i = 0; i < n; i++) acc[i] += v[i];
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, Math.round(acc[i] / vecs.length)));
  return out;
}

/**
 * Aggregate rows -> per-condition activity, including REAL pathway bundles.
 * Bundle membership comes from fly_brain_pathway_bundles.json
 * (memberEdges -> fly_brain_circuit.json rows; pre/post roots ->
 * provenance.root_ids). Every quantity below is derived from the same
 * per-neuron quantized firing vector the figure plots, on the same rows.
 */
function aggregate(rows, B, ctx) {
  const conds = [...new Set(rows.map(r => r.condition))];
  const out = {};
  for (const cond of conds) {
    const crows = rows.filter(r => r.condition === cond);
    const train = crows.filter(r => r.phase === "train").sort((a, b) => a.trial - b.trial);
    const trials = [...new Set(train.map(r => r.trial))];
    if (!trials.length) continue;
    const earlyT = new Set(trials.slice(0, B));
    const lateT = new Set(trials.slice(-B));
    const pick = (pred) => train.filter(pred).map(r => r.fireVec).filter(Boolean).map(fv => b64ToBytes(fv.vec));
    const early = pick(r => earlyT.has(r.trial));
    const late = pick(r => lateT.has(r.trial));
    const all = crows.filter(r => r.fireVec).map(r => b64ToBytes(r.fireVec.vec));
    // conditions without a fireVec emitter (e.g. demon_speed/classical) are
    // kept with null vectors so the figure can still use their layerRates
    const nz = (v) => (v && v.length ? bytesToB64(v) : null);
    const layerField = (pred) => {
      const rs = train.filter(pred).map(r => r.layerRates).filter(Boolean);
      if (!rs.length) return null;
      const keys = Object.keys(rs[0]);
      const m = {};
      for (const k of keys) m[k] = rs.reduce((a, r) => a + (r[k] || 0), 0) / rs.length;
      return m;
    };
    const rec = {
      fireVecMean: nz(meanVectors(all)),
      fireVecEarly: nz(meanVectors(early)),
      fireVecLate: nz(meanVectors(late)),
      layerRatesEarly: layerField(r => earlyT.has(r.trial)),
      layerRatesLate: layerField(r => lateT.has(r.trial)),
      rowsEarly: early.length,
      rowsLate: late.length,
      rowsTotal: all.length,
    };

    // ---- per-bundle + per-region aggregates (needs real mapping) --------
    if (ctx) {
      const vecOfSeedTrial = train.filter(r => r.fireVec)
        .map(r => ({ seed: r.seed, trial: r.trial, v: b64ToBytes(r.fireVec.vec) }));
      const inWin = (s, t) => (earlyT.has(t) ? "e" : lateT.has(t) ? "l" : null);
      const sumType = { e: new Float64Array(ctx.N), l: new Float64Array(ctx.N) };
      const cnt = { e: 0, l: 0 };
      for (const { seed, trial, v } of vecOfSeedTrial) {
        const w = inWin(seed, trial);
        if (!w) continue;
        for (let i = 0; i < ctx.N; i++) sumType[w][i] += v[i];
        cnt[w]++;
      }
      if (cnt.e && cnt.l) {
        const mEarly = sumType.e.map((x, i) => x / cnt.e);
        const mLate = sumType.l.map((x, i) => x / cnt.l);
        // region delta by TARGET neuropil (post_neuropil of the neuron row)
        const regions = {};
        for (let i = 0; i < ctx.N; i++) {
          const rg = ctx.postNp[i];
          if (!rg) continue;
          const r = regions[rg] || (regions[rg] = { e: 0, l: 0 });
          r.e += mEarly[i]; r.l += mLate[i];
        }
        rec.regionDelta = Object.fromEntries(Object.entries(regions).map(([k, v]) =>
          [k, { early: v.e / ctx.regionCount[k], late: v.l / ctx.regionCount[k],
                delta: (v.l - v.e) / ctx.regionCount[k] }]));
        // bundle aggregates: PRE-side per-neuron means, synapse-weighted
        rec.bundleDelta = ctx.bundles.map(b => {
          let se = 0, sl = 0, cntE = 0, cntL = 0;
          for (const i of b.preRows) { se += mEarly[i]; sl += mLate[i]; cntE++; cntL++; }
          const earlyN = cntE ? se / cntE : null, lateN = cntL ? sl / cntL : null;
          // synapse-weighted member means (over preRows with multiplicity = w)
          let wse = 0, wsl = 0, wsum = 0;
          for (const [i, w] of b.preWeighted) { wse += w * mEarly[i]; wsl += w * mLate[i]; wsum += w; }
          return {
            src: b.src, tgt: b.tgt, mod: b.mod, nEdges: b.nEdges, synTotal: b.synTotal,
            early: earlyN, late: lateN,
            delta: earlyN != null ? lateN - earlyN : null,
            earlyW: wsum ? wse / wsum : null, lateW: wsum ? wsl / wsum : null,
            deltaW: wsum ? (wsl - wse) / wsum : null,
          };
        });
      }
    }
    out[cond] = rec;
  }
  return out;
}

/** load the real edge -> neuron -> neuropil mapping for bundle aggregation */
function loadBundleCtx() {
  const circuit = JSON.parse(fs.readFileSync(path.join(ROOT, "fly_brain_circuit.json"), "utf8"));
  const bundlesDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "fly_brain_pathway_bundles.json"), "utf8"));
  const ctDoc = JSON.parse(fs.readFileSync(path.join(ROOT, "fly_brain_celltypes.json"), "utf8"));
  const rootIds = circuit.provenance.root_ids;
  const N = rootIds.length;
  const postNp = new Array(N).fill(null);
  const preNp = new Array(N).fill(null);
  const byRoot = new Map(ctDoc.neurons.map(n => [String(n.root_id), n]));
  rootIds.forEach((r, i) => {
    const e = byRoot.get(String(r));
    if (e) { preNp[i] = e.pre_neuropil || null; postNp[i] = e.post_neuropil || null; }
  });
  // circuit rows in W1 order: fast edges then modulatory (verified 1:1 with W1)
  const fast = circuit.edges, mod = circuit.modulatory_edges;
  const preRows = new Int32Array(fast.length + mod.length);
  const wts = new Float64Array(fast.length + mod.length);
  fast.forEach((e, i) => { preRows[i] = +e.s; wts[i] = +e.w; });
  mod.forEach((e, i) => { preRows[fast.length + i] = +e.s; wts[fast.length + i] = +e.w; });
  const regionCount = {};
  for (let i = 0; i < N; i++) if (postNp[i]) regionCount[postNp[i]] = (regionCount[postNp[i]] || 0) + 1;
  const bundles = bundlesDoc.bundles.map(b => {
    const preRowsSet = new Set();
    const preWeighted = [];
    for (const k of b.memberEdgeSamples) {
      const row = preRows[k];
      if (row == null || row < 0 || row >= N) continue;
      preWeighted.push([row, wts[k]]);
      preRowsSet.add(row);
    }
    return { src: b.src, tgt: b.tgt, mod: b.mod, nEdges: b.nEdges, synTotal: b.synTotal,
             preRows: [...preRowsSet], preWeighted };
  });
  return { N, postNp, preNp, regionCount, bundles };
}

function main() {
  let rows, B, provenance, ctx = null;
  if (hasFlag("live")) {
    const CORE = require(path.join(ROOT, "experiment_core.js"));
    const CTRL = require(path.join(ROOT, "controllers.js"));
    const SEEDS = parseInt(argVal("seeds", "3"), 10) || 3;
    const TRAIN = parseInt(argVal("train", "12"), 10) || 12;
    const TEST = parseInt(argVal("test", "12"), 10) || 12;
    const EPISODE = parseInt(argVal("episode", "20"), 10) || 20;
    const NPART = parseInt(argVal("particles", "260"), 10) || 260;
    B = Math.max(1, parseInt(argVal("b", "4"), 10) || 4);
    const VARIANTS = ["demon_neural", "demon_frozen", "demon_speed"];
    const CIRCUIT = JSON.parse(fs.readFileSync(path.join(ROOT, "fly_brain_circuit.json"), "utf8"));
    rows = [];
    const t0 = Date.now();
    for (let s = 0; s < SEEDS; s++) {
      const seed = 1 + s * 101;
      CORE.pressureDemonCore({
        seed, seedTag: s + 1, trials: TRAIN + TEST, trainTrials: TRAIN,
        episodeSeconds: EPISODE, nParticles: NPART, variants: VARIANTS,
        brainFactory: () => CTRL.connectomeController(CIRCUIT, {
          shuffle: false, rng: CORE.makeRng(9176 + s * 37), seed: 1,
          opticDrive: 0, motorDrive: 0.6, plasticity: "full",
          eligibility: [{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }],
          policyGradient: true, pgRng: CORE.makeRng(424243 + s * 977),
        }),
        onTrialData: (cond, phase, tr) => rows.push(Object.assign({ condition: cond, phase }, tr)),
      });
      console.error(`  seed ${s + 1}/${SEEDS} done (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    provenance = { mode: "live", seeds: SEEDS, trainTrials: TRAIN, testTrials: TEST, episodeSeconds: EPISODE, nParticles: NPART, B };
  } else {
    let file = argVal("rows", null);
    if (!file) {
      const dir = path.join(ROOT, "research_data");
      const cands = fs.readdirSync(dir)
        .filter(f => f.startsWith("e9_batch_") && f.endsWith(".jsonl") && !f.startsWith("_"))
        .sort().reverse();
      for (const f of cands) {
        const line = fs.readFileSync(path.join(dir, f), "utf8").split("\n")[0];
        if (line.includes("fireVec")) { file = path.join(dir, f); break; }
      }
      if (!file) throw new Error("no frozen e9_batch jsonl with fireVec; use --live");
    }
    rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    if (!rows.some(r => r.fireVec)) throw new Error("rows carry no fireVec: " + file);
    let sumFile = file.replace(/\.jsonl$/, "_summary.json");
    try { provenance = JSON.parse(fs.readFileSync(sumFile, "utf8")).provenance; } catch (e) { /* none */ }
    B = (provenance && provenance.blockB) || parseInt(argVal("b", "4"), 10) || 4;
    provenance = Object.assign({ mode: "frozen-rows", source: path.relative(ROOT, file) }, provenance || {}, { B });
  }
  try { ctx = loadBundleCtx(); } catch (e) {
    console.error("bundle context unavailable (" + e.message + "); vectors only");
  }
  const agg = aggregate(rows, B, ctx);
  const out = {
    format: "figure-rows-v1",
    B,
    provenance,
    bundleProvenance: ctx ? {
      circuit: "fly_brain_circuit.json (edges: s,t,w; modulatory_edges)",
      bundles: "fly_brain_pathway_bundles.json (memberEdgeSamples -> circuit rows)",
      neuropil: "fly_brain_celltypes.json (pre_neuropil/post_neuropil, Schlegel et al. 2024)",
      nBundles: ctx.bundles.length,
    } : null,
    conditions: agg,
  };
  const dest = path.join(ROOT, "research_data", "figure_rows.json");
  fs.writeFileSync(dest, JSON.stringify(out));
  for (const [c, a] of Object.entries(agg)) {
    const bd = (a.bundleDelta || []).filter(b => b.delta != null);
    console.log(`${c}: rows=${a.rowsTotal} early=${a.rowsEarly} late=${a.rowsLate} ` +
      `bundles=${bd.length} regions=${a.regionDelta ? Object.keys(a.regionDelta).length : 0}`);
  }
  console.log("wrote " + dest);
}

// --selftest: aggregation math on synthetic rows + a synthetic ctx (no sim)
if (args.includes("--selftest")) {
  const b64 = (u8) => Buffer.from(u8).toString("base64");
  const rows = [];
  for (let seed = 1; seed <= 3; seed++) {
    for (let t = 0; t < 6; t++) {
      const v = new Uint8Array(4).fill(t < 3 ? 10 : 50); // early=10, late=50
      rows.push({ condition: "c", phase: "train", seed, trial: t, fireVec: { vec: b64(v) }, layerRates: { R: t < 3 ? 1 : 5 } });
    }
  }
  // synthetic bundle ctx: N=4 neurons, one bundle {0,1}, region A={0,2}, B={1,3}
  const ctx = {
    N: 4,
    postNp: ["A", "B", "A", "B"],
    preNp: ["B", "A", null, null],
    regionCount: { A: 2, B: 2 },
    bundles: [{ src: "B", tgt: "A", mod: false, nEdges: 2, synTotal: 30,
                preRows: [0, 1], preWeighted: [[0, 10], [1, 20]] }],
  };
  const agg = aggregate(rows, 3, ctx);
  const dec = [...b64ToBytes(agg.c.fireVecEarly)];
  const del = [...b64ToBytes(agg.c.fireVecLate)];
  const all = [...b64ToBytes(agg.c.fireVecMean)];
  const bd = agg.c.bundleDelta[0];
  const ok = dec.every(x => x === 10) && del.every(x => x === 50) &&
    all.every(x => x === 30) && agg.c.rowsEarly === 9 && agg.c.rowsLate === 9 &&
    Math.abs(agg.c.layerRatesEarly.R - 1) < 1e-12 && Math.abs(agg.c.layerRatesLate.R - 5) < 1e-12 &&
    bd.early === 10 && bd.late === 50 && bd.delta === 40 && bd.deltaW === 40 &&
    agg.c.regionDelta.A.delta === 40 && agg.c.regionDelta.B.delta === 40;
  console.log("selftest aggregate: early=10 late=50 mean=30 bundle delta=40 regions +40 -> " + (ok ? "OK" : "FAIL"));
  if (!ok) process.exit(1);
} else {
  main();
}
