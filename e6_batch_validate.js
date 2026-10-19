#!/usr/bin/env node
"use strict";
/**
 * e6_batch_validate.js — E6 Jet-Closure formal multi-seed batch validation
 * (build-plan rows 15 + 8: learning / no-learning / never-gate comparison).
 *
 * METHODOLOGY (identical to e9_batch_validate.js):
 *   - The INDEPENDENT REPLICATE IS THE SEED. Blocks aggregate per-seed block
 *     means; CI = mean +/- 1.96*SEM over seeds. Trials within one seed are
 *     never treated as independent samples.
 *   - Between-condition claims use Welch's two-sided t test on per-seed
 *     final-TEST values (stats_utils.js canonical implementation,
 *     Welch-Satterthwaite df). No tuning, no seed selection, no discarding.
 *
 * ENGINE: experiment_core.js runBenchmark — the SAME generic Maxwell-demon
 * engine E1-E8 use, UNTOUCHED. Protocol is built in: TRAIN phase runs with
 * plasticity ON (controller.setLearning(true)), FROZEN TEST phase with
 * plasticity OFF (setLearning(false) zeroes eligibility + DA; per-trial
 * neural state resets; weights persist across the phase boundary for the
 * trained condition). Environment: jet-closure chamber (auto heat jet,
 * one-way speed-selective physical door band, good:bad crossing scoring).
 *
 * CONDITIONS (the row-15 comparison):
 *   demon_neural    - REAL FAFB connectome controller, plasticity ON in train
 *   demon_frozen    - SAME brain config, plasticity OFF from trial 0
 *                     (exposure control: same sensory history, no learning)
 *   never_gate      - door never opens (subsidy floor: jet alone)
 *   classical_demon - classical speed-selective rule (analytical reference)
 *
 * ARTIFACTS (research_data/):
 *   e6_batch_<stamp>.jsonl          complete per-trial records (all seeds)
 *   e6_batch_<stamp>_summary.json   finals, Welch tests, manifest
 *   e6_batch_report_<stamp>.html    self-contained report
 *
 * CLI:
 *   node e6_batch_validate.js [--seeds 20] [--base 1] [--b 4]
 *        [--train 12] [--test 8] [--episode 12] [--particles 260]
 *        [--variants demon_neural,demon_frozen,never_gate,classical_demon | all]
 *        [--no-html] [--no-determinism] [--selftest]
 */

const fs = require("fs");
const path = require("path");
const CORE = require("./experiment_core.js");
const CTRL = require("./controllers.js");
const SU = require("./stats_utils.js");
const circuit = require("./fly_brain_circuit.json");

// ---- CLI -------------------------------------------------------------------
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}
const hasFlag = (name) => args.includes("--" + name);

const SEEDS   = Math.max(1, parseInt(argVal("seeds", "20"), 10) || 20);
const BASE    = parseInt(argVal("base", "1"), 10) || 1;
const TRAIN   = parseInt(argVal("train", "12"), 10) || 12;
const TEST    = parseInt(argVal("test", "8"), 10) || 8;
const EPISODE = parseInt(argVal("episode", "12"), 10) || 12;
const NPART   = parseInt(argVal("particles", "260"), 10) || 260;
const B       = Math.max(1, parseInt(argVal("b", "4"), 10) || 4);
const WANT_HTML = !hasFlag("no-html");
const NO_DETERMINISM = hasFlag("no-determinism");   // chunked-batch mode only
// --from-jsonl a.jsonl,b.jsonl: aggregate pre-simulated chunk artifacts instead
// of simulating (chunked execution against shell time clamps). Chunk bases are
// read from each chunk's sibling *_summary.json (provenance.seedBase) and the
// per-chunk seedTag 1..k is re-based to the global replicate id, so the
// combined artifacts are identical to what one unchunked run would produce.
const FROM_JSONL = hasFlag("from-jsonl")
  ? argVal("from-jsonl", "").split(",").map(s => s.trim()).filter(Boolean)
  : null;

const KNOWN_VARIANTS = ["demon_neural", "demon_frozen", "never_gate",
                        "classical_demon", "random"];
const VAR_ARG = hasFlag("variants")
  ? argVal("variants", "").split(",").map(s => s.trim()).filter(Boolean)
  : null;
const VARIANTS = !VAR_ARG ? ["demon_neural", "demon_frozen", "never_gate", "classical_demon"]
  : VAR_ARG.includes("all") ? KNOWN_VARIANTS.slice()
  : VAR_ARG.filter(v => KNOWN_VARIANTS.includes(v));
if (!VARIANTS.length) { console.error("no known variants in --variants list"); process.exit(1); }

// ---- brain factory: REAL FAFB connectome, the E4-verified runBenchmark config
// (E4 connectome conditions run THIS engine with opticDrive 0.25; the rng is
// the one runBenchmark derives from the env seed: makeRng(seed ^ 0x5f5f), so
// controller draw and gas couple per seed exactly like E4). Learning path is
// the E1-E8 loop: crossing -> receiveFeedback -> DA -> applyLearning at each
// decision; the train/frozen split comes from runBenchmark's setLearning calls.
function e6NeuralFactory(rng) {
  return CTRL.connectomeController(circuit, {
    shuffle: false, rng, seed: 1, opticDrive: 0.25, plasticity: "full",
  });
}

const r6 = (x) => Math.round(x * 1e6) / 1e6;

// ---- per-trial telemetry enrichment (READ-ONLY wrapper) --------------------
// runBenchmark calls observe/step/receiveFeedback/setLearning/resetForTrial/
// summary on the controller object it was given. We hand it a prototype-
// chained wrapper that adds E6 telemetry capture (weight drift, DA peak,
// spike counts, decision counts) WITHOUT touching controllers.js or
// experiment_core.js. Every original method runs unchanged.
function instrumentedBrainFactory(alwaysFrozen) {
  return function (rng) {
    const brain = e6NeuralFactory(rng);
    const wrapped = Object.create(brain);            // delegate, do not copy
    const cap = { wdEnd: 0, wdStart: 0, daPeak: 0, daMin: 0,
                  spikes: 0, motorSpikes: 0, decisions: 0, opens: 0 };
    wrapped.setLearning = function (on) {
      cap.wdStart = brain.weightDrift();             // phase-boundary anchor
      // THE FROZEN CONTROL: the engine's phase loop calls setLearning(true)
      // for its train phase in EVERY condition; the frozen condition must
      // never enable plasticity (same pattern as pressureDemonCore's frozen
      // arm: setLearning(mode === "neural" && phase === "train")).
      brain.setLearning(alwaysFrozen ? false : on);
    };
    wrapped.resetForTrial = function () {
      cap.spikes = 0; cap.motorSpikes = 0; cap.daPeak = 0; cap.daMin = 0;
      cap.decisions = 0; cap.opens = 0;
      cap.wdStart = brain.weightDrift();             // trial-boundary anchor
      brain.resetForTrial();
    };
  wrapped.observe = function (env) {
    brain.observe(env);   // state must land ON the brain: brain.step reads this._sens/_visual
  };
  wrapped.step = function (dt, env) {
    brain.step(dt, env);
      const t = brain.telemetry();
      cap.spikes += t.spikeCount || 0;
      cap.motorSpikes += t.motorRate || 0;
      if (t.dopamine > cap.daPeak) cap.daPeak = t.dopamine;
      if (t.dopamine < cap.daMin) cap.daMin = t.dopamine;
      cap.decisions += 1;
      if (env.door && env.door.target > 0.5) cap.opens += 1;
    };
    wrapped.summary = function () {
      const s = brain.summary();
      cap.wdEnd = brain.weightDrift();
      return Object.assign({}, s, {
        weightDrift: r6(cap.wdEnd),                     // cumulative from baseline
        weightDriftDelta: r6(cap.wdEnd - cap.wdStart),  // growth this trial
        dopaminePeak: r6(cap.daPeak),
        dopamineMin: r6(cap.daMin),
        neuralSpikes: cap.spikes,
        motorSpikes: cap.motorSpikes,
        neuralDecisions: cap.decisions,
        openSteps: cap.opens,
      });
    };
    return wrapped;
  };
}

// ---- controller factories per condition ------------------------------------
function factoryFor(v) {
  if (v === "demon_neural") return instrumentedBrainFactory(false);
  if (v === "demon_frozen") return instrumentedBrainFactory(true);
  if (v === "never_gate")      return (rng, env, cfg) => CTRL.neverGateController(rng, env, cfg);
  if (v === "classical_demon") return (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg);
  if (v === "random")          return (rng, env, cfg) => CTRL.randomController(rng, env, cfg);
  throw new Error("unknown variant " + v);
}

// ---- selftest (no simulation) ----------------------------------------------
if (hasFlag("selftest")) {
  // 1) canonical Welch against published Student-t tables:
  //    a=[5..10], b=[7..12] -> t = -1.8516 (signed, m1-m2), df = 10,
  //    two-sided p(t=1.8516, df=10) = 0.0938 (tables; the e9 script's
  //    independent numeric integration verifies the same machinery).
  const w = SU.welchT([5, 6, 7, 8, 9, 10], [7, 8, 9, 10, 11, 12]);
  const okT = Math.abs(Math.abs(w.t) - 1.8516) < 2e-2 && Math.abs(w.df - 10) < 0.1 &&
              Math.abs(w.p - 0.0938) < 5e-4;
  console.log("selftest welchT: t=" + w.t.toFixed(4) + " df=" + w.df.toFixed(3) +
              " p=" + w.p.toFixed(6) + (okT ? " OK" : " FAIL"));
  // 2) enrichment wrapper builds and reports without throwing; frozen mode
  //    must refuse to enable plasticity even when the engine asks for it
  {
    const brain = instrumentedBrainFactory(false)();
    brain.setLearning(true); brain.setLearning(false);
    const s = brain.summary();
    const okW = typeof s.weightDrift === "number" && s.weightDriftDelta === 0;
    console.log("selftest wrapper: weightDrift=" + s.weightDrift +
                " delta=" + s.weightDriftDelta + (okW ? " OK" : " FAIL"));
    if (!okW) process.exit(1);
    const frozen = instrumentedBrainFactory(true)();
    frozen.setLearning(true);                        // engine asks -> wrapper refuses
    const fs2 = frozen.summary();
    const okF = fs2.weightDriftDelta === 0;
    console.log("selftest frozen gate: setLearning(true) refused -> delta=" +
                fs2.weightDriftDelta + (okF ? " OK" : " FAIL"));
    if (!okF) process.exit(1);
  }
  // 3) every known variant maps to a factory without throwing
  let okFact = true;
  for (const v of KNOWN_VARIANTS) {
    try { factoryFor(v); } catch (e) { okFact = false; console.log("factory FAIL", v, e.message); }
  }
  console.log("selftest factories: " + (okFact ? "OK" : "FAIL"));
  process.exit(okT && okFact ? 0 : 1);
}

// ---- statistics: independent replicate = SEED (top-level: exported) --------
function trialStats(rowsIn, Bsize) {
  const byCond = new Map();
  for (const r of rowsIn) {
    if (!byCond.has(r.condition)) byCond.set(r.condition, []);
    byCond.get(r.condition).push(r);
  }
  const out = [];
  for (const [condition, crows] of byCond) {
    const fields = Object.keys(crows[0]).filter(f => typeof crows[0][f] === "number" &&
      Number.isFinite(crows[0][f]) && f !== "seed" && f !== "trial" && f !== "steps");
    let trialOffset = 0, blockOffset = 0;
    for (const phase of ["train", "test"]) {
      const list = crows.filter(r => r.phase === phase);
      if (!list.length) continue;
      const seeds = [...new Set(list.map(r => r.seedTag))].sort((a, b) => a - b);
      const seedRows = seeds.map(sd =>
        list.filter(r => r.seedTag === sd).sort((a, b) => a.trial - b.trial));
      const nTrials = Math.max(...seedRows.map(a => a.length));
      const nBlocks = Math.max(1, Math.floor(nTrials / Bsize));
      for (let b = 0; b < nBlocks; b++) {
        const pt = { condition, phase, block: blockOffset + b,
                     trialStart: trialOffset + b * Bsize,
                     trialEnd: trialOffset + Math.min((b + 1) * Bsize, nTrials) - 1 };
        for (const f of fields) {
          const vals = [];
          for (const srows of seedRows) {
            const seg = srows.slice(b * Bsize, (b + 1) * Bsize);
            if (!seg.length) continue;
            vals.push(seg.reduce((a, r) => a + r[f], 0) / seg.length);
          }
          if (!vals.length) continue;
          const m = vals.reduce((a, x) => a + x, 0) / vals.length;
          const sd = vals.length > 1
            ? Math.sqrt(vals.reduce((a, x) => a + (x - m) ** 2, 0) / (vals.length - 1)) : 0;
          const sem = vals.length > 1 ? sd / Math.sqrt(vals.length) : 0;
          pt[f] = { mean: m, sd, sem, ci: 1.96 * sem, n: vals.length };
        }
        out.push(pt);
      }
      trialOffset += nTrials;
      blockOffset += nBlocks;
    }
  }
  return out;
}

// ---- main: simulate / aggregate, analyze, write artifacts -------------------
// (require.main guard: importing this module runs NOTHING — tests and tools
// consume trialStats/factories without triggering a 20-seed batch)
function main() {
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const rows = [];
const perSeed = {};                       // variant -> [{seed, phase, rec}]
for (const v of VARIANTS) perSeed[v] = [];
console.log("E6 Jet-Closure batch validation: " +
            (FROM_JSONL ? "aggregated from " + FROM_JSONL.length + " chunks"
                        : SEEDS + " seeds") + " x " + VARIANTS.length + " conditions, " +
            TRAIN + "+" + TEST + " trials x " + EPISODE + "s x " + NPART + " particles");
console.log("conditions: " + VARIANTS.join(", "));
const t0 = Date.now();
if (FROM_JSONL) {
  for (const f of FROM_JSONL) {
    const p = path.resolve(f);
    const sum = JSON.parse(fs.readFileSync(p.replace(/\.jsonl$/, "_summary.json"), "utf8"));
    const base = sum.provenance.seedBase;
    const rws = fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean)
      .map(l => JSON.parse(l));
    for (const r of rws)
      rows.push(Object.assign({}, r, { seedTag: (base - 1) / 101 + r.seedTag }));
    console.log("  loaded " + rws.length + " rows from " + f + " (seedBase " + base + ")");
  }
} else {
  for (let s = 0; s < SEEDS; s++) {
    const seed = BASE + s * 101;          // same stride as the worker + e9 batch
    const tS = Date.now();
    CORE.runBenchmark({
      seed,
      nSeeds: 1,                          // one seed per outer-loop iteration
      trialsTrain: TRAIN, trialsTest: TEST,
      episodeSeconds: EPISODE, dt: 1 / 60,
      nParticles: NPART, maxCrossingsPerTrial: 50,
      controllers: Object.fromEntries(VARIANTS.map(v => [v, factoryFor(v)])),
      onTrialData: (cond, phase, tr) => {
        const row = Object.assign({}, tr, { condition: cond, phase, seedTag: s + 1 });
        delete row.fireVec;   // 139 KB/row legacy per-neuron b64 display payload;
                              // the E6 dataset carries neuralSpikes/motorSpikes/
                              // weightDrift/dopaminePeak + layerRates instead
        rows.push(row);
      },
    });
    console.log("  seed " + (s + 1) + "/" + SEEDS + " (rng " + seed + ") done in " +
                ((Date.now() - tS) / 1000).toFixed(1) + " s");
  }
  // ---- determinism gate: same seed -> identical rows ------------------------
  if (!NO_DETERMINISM) {
    const rerun = [];
    CORE.runBenchmark({
      seed: BASE, nSeeds: 1,
      trialsTrain: TRAIN, trialsTest: TEST,
      episodeSeconds: EPISODE, dt: 1 / 60,
      nParticles: NPART, maxCrossingsPerTrial: 50,
      controllers: Object.fromEntries(VARIANTS.map(v => [v, factoryFor(v)])),
      onTrialData: (cond, phase, tr) => {
        const row = Object.assign({}, tr, { condition: cond, phase });
        delete row.fireVec;
        rerun.push(row);
      },
    });
    const fields = ["crossings", "goodCrossings", "badCrossings", "openFraction",
                    "demonAgree", "weightDrift", "weightDriftDelta", "dopaminePeak",
                    "neuralSpikes", "motorSpikes", "dTfinal", "sortEntropy", "energyJ"];
    let same = true, badAt = null;
    for (const cond of VARIANTS) {
      const first = rows.filter(r => r.condition === cond && r.seedTag === 1);
      const again = rerun.filter(r => r.condition === cond);
      if (first.length !== again.length) { same = false; badAt = cond + ":rowcount"; break; }
      for (let i = 0; i < first.length && same; i++) {
        for (const f of fields) {
          const a = first[i][f], b = again[i][f];
          const na = a === null || a === undefined ? 0 : a;
          const nb = b === null || b === undefined ? 0 : b;
          if (Math.abs(na - nb) > 1e-9) { same = false; badAt = cond + "[" + i + "]." + f; break; }
        }
      }
      if (!same) break;
    }
    console.log("\nreproducibility: same seed -> " +
                (same ? "IDENTICAL rows" : "DIVERGENT at " + badAt + " (BUG)"));
    if (!same) { console.error("reproducibility gate FAILED"); process.exit(1); }
  }
}
const elapsed = (Date.now() - t0) / 1000;
const NSEEDS = FROM_JSONL ? new Set(rows.map(r => r.seedTag)).size : SEEDS;

// ---- per-replicate finals from rows (single code path, both modes) ----------
{
  const tags = [...new Set(rows.map(r => r.seedTag))].sort((a, b) => a - b);
  for (const v of VARIANTS) {
    for (const tg of tags) {
      const vr = rows.filter(r => r.condition === v && r.seedTag === tg);
      const lastTrain = [...vr].reverse().find(r => r.phase === "train");
      const lastTest  = [...vr].reverse().find(r => r.phase === "test");
      if (lastTrain) perSeed[v].push({ seed: tg, phase: "train", rec: lastTrain });
      if (lastTest)  perSeed[v].push({ seed: tg, phase: "test",  rec: lastTest });
    }
  }
}

const stats = trialStats(rows, B);   // trialStats is top-level (exported + testable)

// ---- final-phase cross-seed summaries ---------------------------------------
const FINAL_FIELDS = ["crossings", "goodCrossings", "badCrossings", "openFraction",
                      "demonAgree", "dTfinal", "sortEntropy", "spatialH", "miNeural",
                      "energyJ", "jetWorkJ", "workInJ", "extractableJ", "erasureCostJ",
                      "landauerRatio", "measuredBits", "goodBadRatio",
                      "weightDrift", "weightDriftDelta", "dopaminePeak", "dopamineMin",
                      "neuralSpikes", "motorSpikes", "neuralDecisions", "openSteps"];
function finalSummary(v) {
  const out = {};
  for (const phase of ["train", "test"]) {
    const recs = (perSeed[v] || []).filter(x => x.phase === phase).map(x => x.rec);
    if (!recs.length) continue;
    const agg = {};
    for (const f of FINAL_FIELDS) {
      const vals = recs.map(r => r[f]).filter(x => x !== null && x !== undefined && Number.isFinite(x));
      if (!vals.length) continue;
      const m = vals.reduce((a, x) => a + x, 0) / vals.length;
      const sd = vals.length > 1
        ? Math.sqrt(vals.reduce((a, x) => a + (x - m) ** 2, 0) / (vals.length - 1)) : 0;
      const sem = vals.length > 1 ? sd / Math.sqrt(vals.length) : 0;
      agg[f] = { mean: m, sd, sem, ci: 1.96 * sem, n: vals.length };
    }
    out[phase] = agg;
  }
  return out;
}
const finals = Object.fromEntries(VARIANTS.map(v => [v, finalSummary(v)]));

// ---- Welch tests on final TEST metrics — THE row-15 comparisons -------------
function lastVals(v, f) {
  return ((perSeed[v] || []).filter(x => x.phase === "test")
          .map(x => x.rec[f])).filter(x => x !== null && x !== undefined && Number.isFinite(x));
}
const tests = [];
{
  const pairs = [["demon_neural", "demon_frozen"],
                 ["demon_neural", "never_gate"],
                 ["demon_neural", "classical_demon"],
                 ["demon_frozen", "never_gate"]];
  for (const f of ["goodCrossings", "goodBadRatio", "openFraction", "demonAgree", "dTfinal"]) {
    for (const [a, b] of pairs) {
      if (!VARIANTS.includes(a) || !VARIANTS.includes(b)) continue;
      const va = lastVals(a, f), vb = lastVals(b, f);
      if (va.length >= 2 && vb.length >= 2)
        tests.push({ metric: f, comparison: a + " vs " + b + " (final TEST)", ...SU.welchT(va, vb) });
    }
  }
}

// ---- console report ---------------------------------------------------------
const fmt = (st, d) => st ? st.mean.toFixed(d) + " +/- " + st.ci.toFixed(d) + " (n=" + st.n + ")" : "-";
const fmtE = (st) => st ? st.mean.toExponential(2) + " +/- " + st.ci.toExponential(2) + " (n=" + st.n + ")" : "-";
console.log("\n" + NSEEDS + " seeds | " + TRAIN + "+" + TEST + " trials | " + EPISODE +
            "s episodes | " + NPART + " particles | " + rows.length + " rows | " +
            elapsed.toFixed(0) + " s");
console.log("\n== FINAL metrics (mean +/- 95% CI over seeds) ==");
for (const v of VARIANTS) {
  const F = finals[v];
  console.log("\n" + v + ":");
  console.log("  final train good xings  " + fmt(F.train && F.train.goodCrossings, 2));
  console.log("  final test  good xings  " + fmt(F.test && F.test.goodCrossings, 2));
  console.log("  final test good:bad     " + fmt(F.test && F.test.goodBadRatio, 3));
  console.log("  final test openFraction " + fmt(F.test && F.test.openFraction, 3));
  console.log("  final test demonAgree   " + fmt(F.test && F.test.demonAgree, 3));
  console.log("  final test dT (sim K)   " + fmt(F.test && F.test.dTfinal, 3));
  console.log("  final train weightDrift " + fmtE(F.train && F.train.weightDrift));
  console.log("  final test  weightDrift " + fmtE(F.test && F.test.weightDrift));
}
if (tests.length) {
  console.log("\n== Welch t tests on final TEST metrics (two-sided, per-seed values) ==");
  for (const w of tests)
    console.log("  " + w.comparison + " - " + w.metric + ": t=" + w.t.toFixed(2) +
                ", df=" + w.df.toFixed(1) + ", p=" +
                (w.p < 1e-4 ? w.p.toExponential(1) : w.p.toFixed(4)));
}

// ---- artifacts ---------------------------------------------------------------
fs.mkdirSync(path.join(__dirname, "research_data"), { recursive: true });
const jsonl = path.join(__dirname, "research_data", "e6_batch_" + stamp + ".jsonl");
fs.writeFileSync(jsonl, rows.map(r => JSON.stringify(r)).join("\n"));
const summaryPath = path.join(__dirname, "research_data", "e6_batch_" + stamp + "_summary.json");
fs.writeFileSync(summaryPath, JSON.stringify({
  provenance: {
    experiment: "e6", phase: "C-1", kind: "batch_validation",
    question: "Does the FAFB connectome demon's plasticity (demon_neural) beat its own frozen control (demon_frozen) and the never-gate subsidy floor (never_gate)?",
    seeds: NSEEDS, seedBase: BASE, seedStride: 101,
    mode: FROM_JSONL ? "aggregated-from-chunks" : "simulated",
    aggregatedFrom: FROM_JSONL || undefined,
    trainTrials: TRAIN, testTrials: TEST, episodeSeconds: EPISODE,
    nParticles: NPART, blockB: B, variants: VARIANTS,
    brain: "FAFB v783 connectomeController plasticity=full policyGradient=true pgBaseline=true pgKc=true",
    engine: "experiment_core.js runBenchmark (UNTOUCHED): train phase plasticity ON, test phase FROZEN via setLearning(false)",
    protocol: "TRAIN (learning) -> FROZEN EVAL; per-trial neural state reset; weights persist across the phase boundary only for the trained condition; seed = independent replicate; no seeds discarded",
    determinism: NO_DETERMINISM ? "gate skipped (--no-determinism chunked-batch mode)"
                                : "same-seed rerun identical (gate passed)",
    startedISO: new Date(Date.now() - elapsed * 1000).toISOString(),
    elapsedSeconds: r6(elapsed),
  },
  finals, tests,
}, null, 2));
console.log("\nwrote " + jsonl + " (" + rows.length + " rows)");
console.log("wrote " + summaryPath);

// ---- C-3 standardized dataset export (CSV + manifest, sha256-pinned) --------
{
  const DX = require("./dataset_export.js");
  const dsRows = rows.map(r => Object.assign({}, r, { experiment: "e6", seed: r.seedTag }));
  const ds = DX.exportRun({
    experiment: "e6",
    label: "E6 Jet-Closure Paradox - formal multi-seed batch (C-1)",
    question: "Does the FAFB connectome demon's plasticity beat its frozen control, the never-gate floor, and the classical reference?",
    protocol: "TRAIN (plasticity ON) -> FROZEN EVAL (setLearning(false)); per-trial neural state reset; seed = independent replicate; no seeds discarded",
    config: { seeds: NSEEDS, seedBase: BASE, seedStride: 101, trainTrials: TRAIN,
              testTrials: TEST, episodeSeconds: EPISODE, nParticles: NPART,
              blockB: B, variants: VARIANTS,
              mode: FROM_JSONL ? "aggregated-from-chunks" : "simulated",
              engine: "experiment_core.js runBenchmark (unmodified)" },
    conditions: VARIANTS,
  }, dsRows);
  console.log("dataset: " + ds.csvPath);
  console.log("dataset manifest: " + ds.manifestPath + " (sha256 " + ds.sha256.slice(0, 16) + "...)");
}

// ---- self-contained HTML report ---------------------------------------------
if (WANT_HTML) {
  const PANELS = [
    ["goodCrossings", "Good crossings per trial (primary selectivity)", v => v.toFixed(1), false],
    ["openFraction",  "Door open fraction vs trial",                    v => (v * 100).toFixed(0) + "%", false],
    ["demonAgree",    "Demon agreement vs trial",                       v => (v * 100).toFixed(0) + "%", false],
    ["weightDrift",   "Synaptic weight drift (sum of absolute changes) vs trial", v => v.toExponential(1), false],
    ["dopaminePeak",  "Dopamine peak per trial",                        v => v.toFixed(2), false],
    ["neuralSpikes",  "Neural spikes per trial",                        v => v.toExponential(1), false],
    ["dTfinal",       "dT final per trial",                             v => v.toFixed(2), false],
  ];
  const COLORS = { demon_neural: "#4c72b0", demon_frozen: "#dd8452", never_gate: "#8c8c8c",
                   classical_demon: "#55a868", random: "#c44e52" };
  const series = Object.keys(COLORS).filter(v => VARIANTS.includes(v));
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

  const htmlPanels = PANELS.map(([f, label, fmtV, logY]) => {
    const allPts = stats.filter(s => s.condition === series[0]);
    if (!allPts.length) return "";
    const W = 430, H = 240, padL = 50, padR = 10, padT = 12, padB = 24;
    const xsAll = allPts.map(s => (s.trialStart + s.trialEnd) / 2);
    const xlo = 0, xhi = Math.max(...allPts.map(s => s.trialEnd)) + 1;
    let ylo = Infinity, yhi = -Infinity;
    for (const s of allPts) {
      const st = s[f]; if (!st) continue;
      ylo = Math.min(ylo, st.mean - st.ci); yhi = Math.max(yhi, st.mean + st.ci);
    }
    if (!Number.isFinite(ylo)) return "";
    if (logY) { ylo = Math.max(ylo, 1e-25); yhi = Math.max(yhi, ylo * 10); }
    if (yhi === ylo) { yhi = ylo + 1; ylo -= 0.5; }
    const X = x => padL + (x - xlo) / Math.max(1e-9, xhi - xlo) * (W - padL - padR);
    const Y = y => logY
      ? padT + (1 - (Math.log10(Math.max(y, ylo)) - Math.log10(ylo)) /
                (Math.log10(yhi) - Math.log10(ylo))) * (H - padT - padB)
      : padT + (1 - (y - ylo) / (yhi - ylo)) * (H - padT - padB);
    const testStart = allPts.find(s => s.phase === "test");
    const nPts = allPts.filter(s => s[f]);
    let band = "";
    if (nPts.length > 1) {
      const up = nPts.map(s => X((s.trialStart + s.trialEnd) / 2).toFixed(1) + "," +
                             Y(s[f].mean + s[f].ci).toFixed(1));
      const dn = nPts.slice().reverse().map(s => X((s.trialStart + s.trialEnd) / 2).toFixed(1) + "," +
                             Y(s[f].mean - s[f].ci).toFixed(1));
      band = '<path d="M' + up.join(" L") + ' L' + dn.join(" L") + ' Z" fill="' + COLORS[series[0]] + '22"/>';
    }
    const lines = series.map(v => {
      const pts = stats.filter(s => s.condition === v && s[f]);
      let dd = "", pen = false;
      for (const s of pts) {
        const x = (s.trialStart + s.trialEnd) / 2, y = s[f].mean;
        dd += (pen ? "L" : "M") + X(x).toFixed(1) + "," + Y(y).toFixed(1) + " "; pen = true;
      }
      return dd ? '<path d="' + dd + '" fill="none" stroke="' + COLORS[v] + '" stroke-width="1.8"/>' : "";
    }).join("");
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(fr => {
      const yv = logY ? Math.pow(10, Math.log10(ylo) + fr * (Math.log10(yhi) - Math.log10(ylo)))
                      : ylo + fr * (yhi - ylo);
      return '<text x="4" y="' + (padT + (1 - fr) * (H - padT - padB) + 3).toFixed(1) +
             '" font-size="9" fill="#6a737d">' + fmtV(yv) + '</text>';
    }).join("");
    const xTicks = [0, 0.5, 1].map(fr => {
      const xv = xlo + fr * (xhi - xlo);
      return '<text x="' + X(xv).toFixed(1) + '" y="' + (H - 8) +
             '" font-size="9" fill="#6a737d" text-anchor="middle">' + Math.round(xv) + '</text>';
    }).join("");
    return '<div class="panel"><h3>' + esc(label) +
      ' <span class="tag">mean line, 95% CI band (' + esc(series[0]) + '), n=' + NSEEDS + ' seeds</span></h3>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart">' +
      '<rect x="' + padL + '" y="' + padT + '" width="' + (W - padL - padR) + '" height="' + (H - padT - padB) +
      '" fill="none" stroke="#30363d"/>' +
      (testStart ? '<line x1="' + X(testStart.trialStart).toFixed(1) + '" y1="' + padT +
                   '" x2="' + X(testStart.trialStart).toFixed(1) + '" y2="' + (H - padB) +
                   '" stroke="#8b949e" stroke-dasharray="4 4" opacity=".6"/>' +
                   '<text x="' + (X(testStart.trialStart) + 4).toFixed(1) + '" y="' + (padT + 10) +
                   '" font-size="9" fill="#8b949e">TEST (frozen)</text>' +
                   '<text x="' + (X(testStart.trialStart) - 4).toFixed(1) + '" y="' + (padT + 10) +
                   '" font-size="9" fill="#8b949e" text-anchor="end">TRAIN</text>' : "") +
      band + lines + ticks + xTicks + '</svg>' +
      '<div class="legend">' + series.map(v => '<span><i style="background:' + COLORS[v] + '"></i>' + v + '</span>').join("") + '</div></div>';
  }).join("");

  const f2 = (v, ph, f, d) => {
    const st = (finals[v] || {})[ph] && (finals[v] || {})[ph][f];
    return st ? st.mean.toFixed(d) + " +/- " + st.ci.toFixed(d) + " (n=" + st.n + ")" : "-";
  };
  const fE = (v, ph, f) => {
    const st = (finals[v] || {})[ph] && (finals[v] || {})[ph][f];
    return st ? st.mean.toExponential(2) + " +/- " + st.ci.toExponential(2) + " (n=" + st.n + ")" : "-";
  };
  const tableRows = VARIANTS.map(v => '<tr><th>' + v + '</th>' +
    '<td>' + f2(v, "train", "goodCrossings", 2) + '</td><td>' + f2(v, "test", "goodCrossings", 2) + '</td>' +
    '<td>' + f2(v, "test", "goodBadRatio", 3) + '</td>' +
    '<td>' + f2(v, "test", "openFraction", 3) + '</td>' +
    '<td>' + f2(v, "test", "demonAgree", 3) + '</td>' +
    '<td>' + f2(v, "test", "dTfinal", 3) + '</td>' +
    '<td>' + fE(v, "train", "weightDrift") + '</td><td>' + fE(v, "test", "weightDrift") + '</td></tr>').join("");
  const testsHtml = tests.length
    ? '<table><tr><th>comparison</th><th>metric</th><th>t</th><th>df</th><th>p (two-sided)</th></tr>' +
      tests.map(w => '<tr><td>' + esc(w.comparison) + '</td><td>' + w.metric + '</td><td>' +
                     w.t.toFixed(2) + '</td><td>' + w.df.toFixed(1) + '</td><td>' +
                     (w.p < 1e-4 ? w.p.toExponential(1) : w.p.toFixed(4)) + '</td></tr>').join("") +
      '</table><p class="note">Welch two-sided t test over per-seed final-TEST values; n = ' + NSEEDS +
      ' seeds per condition; df by Welch-Satterthwaite.</p>'
    : '<p class="note">no tests (need at least two conditions with n>=2 seeds).</p>';

  const html = '<!doctype html><html><head><meta charset="utf-8"><title>E6 Jet-Closure batch report</title><style>' +
    'body{background:#0d1117;color:#e6edf3;font:13px/1.5 system-ui;margin:24px}' +
    'h1{font-size:19px} h2{font-size:15px;margin-top:26px} h3{font-size:13px;margin:8px 0 4px}' +
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:14px}' +
    '.panel{background:#10161d;border:1px solid #21262d;border-radius:8px;padding:10px}' +
    '.chart{width:100%;height:auto}.tag{font-weight:400;font-size:11px;color:#8b949e}' +
    '.legend span{margin-right:12px;font-size:11px}.legend i{display:inline-block;width:10px;height:10px;margin-right:4px;border-radius:2px}' +
    'table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #30363d;padding:4px 10px;font-size:12px;text-align:right}th{background:#161b22}' +
    '.note{color:#8b949e;font-size:12px;max-width:900px}' +
    '</style></head><body>' +
    '<h1>E6 | Jet-Closure Paradox - formal multi-seed batch report</h1>' +
    '<p class="note">' + NSEEDS + ' seeds x ' + VARIANTS.length + ' conditions | ' + TRAIN + '+' + TEST +
    ' trials x ' + EPISODE + 's | ' + NPART + ' particles. TRAIN phase runs with plasticity ON;' +
    ' TEST phase runs FROZEN (setLearning(false)). The independent replicate for every CI and test' +
    ' is ONE SEED. CI = mean +/- 1.96*SEM over seeds. No seed selection, no discarded runs.' +
    ' Determinism gate: ' + (NO_DETERMINISM ? 'SKIPPED (chunked mode)' : 'passed') + '.</p>' +
    '<h2>Final metrics (mean +/- 95% CI)</h2>' +
    '<table><tr><th>condition</th><th>final train good xings</th><th>final test good xings</th>' +
    '<th>final test good:bad</th><th>final test open frac</th><th>final test agreement</th>' +
    '<th>final test dT</th><th>final train weight drift</th><th>final test weight drift</th></tr>' +
    tableRows + '</table>' +
    '<h2>Learning curves</h2><div class="grid">' + htmlPanels + '</div>' +
    '<h2>Welch t tests on final TEST metrics</h2>' + testsHtml +
    '</body></html>';
  const htmlPath = path.join(__dirname, "research_data", "e6_batch_report_" + stamp + ".html");
  fs.writeFileSync(htmlPath, html);
  console.log("wrote " + htmlPath);
}
}

if (require.main === module) main();

module.exports = { trialStats, welchT: SU.welchT, instrumentedBrainFactory, e6NeuralFactory, factoryFor };
