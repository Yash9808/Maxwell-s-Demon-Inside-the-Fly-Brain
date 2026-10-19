#!/usr/bin/env node
"use strict";
/**
 * e7_e8_batch_validate.js — C-7 (build-plan rows 16 + 17):
 *   E7 Generalization Sweep — the classical demon across three physics
 *     regimes (sparse/clean, default, dense/noisy), per-seed paired
 *     regime contrasts;
 *   E8 Information-Limited Demons — adaptive vs fixed-threshold vs
 *     memory-limited (mem 4) classical demon on identical seeds.
 *
 * ENGINE: experiment_core.js runBenchmark, UNTOUCHED. Its `_physics(si, n)`
 * hook is per-CALL (with nSeeds:1 it applies to the whole call), so each E7
 * regime runs as its own runBenchmark call with `_physics: () => regime`,
 * while the three E8 arms share one call at the 320p/0.12 operating point so
 * their dT/sortEntropy contrasts are gas-matched (fully paired per seed).
 * Worker-exact controller options: e8 arms use CTRL.classicalDemon with
 * { adaptive: true|false } and { memSize: 4 }. TRAIN plasticity n/a for
 * classical arms (no plasticity); protocol is the same TRAIN->FROZEN shape
 * for comparability with the other validators (the classical rule's
 * memory adaptation runs in-phase exactly as the worker's E7/E8 runs).
 *
 * METHODOLOGY (identical to e6/e2_e3/e4/e5 validators): SEED = independent
 * replicate (env = base + s*101, controller rng = makeRng(seed ^ 0x5f5f));
 * Welch two-sided t tests on per-seed final-TEST values; no tuning, no
 * seed selection, no discarding. Determinism gate built in.
 *
 * ARTIFACTS: e7_e8_batch_<stamp>.jsonl + _summary.json (+ report) and the
 * C-3 dataset pair e7_e8_dataset_<stamp>.csv + .manifest.json.
 *
 * CLI: node e7_e8_batch_validate.js [--seeds 12] [--base 1] [--b 4]
 *      [--train 30] [--test 10] [--episode 12] [--particles 320]
 *      [--no-html] [--no-determinism] [--selftest]
 *
 * NOTE: --particles is accepted for protocol parity only; effective gas is
 * per-condition (E7 regimes via per-call _physics; E8 arms fixed 320/0.12).
 */

const fs = require("fs");
const path = require("path");
const CORE = require("./experiment_core.js");
const CTRL = require("./controllers.js");
const SU = require("./stats_utils.js");

// ---- CLI -------------------------------------------------------------------
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}
const hasFlag = (name) => args.includes("--" + name);

const SEEDS   = Math.max(1, parseInt(argVal("seeds", "12"), 10) || 12);
const BASE    = parseInt(argVal("base", "1"), 10) || 1;
const TRAIN   = parseInt(argVal("train", "30"), 10) || 30;
const TEST    = parseInt(argVal("test", "10"), 10) || 10;
const EPISODE = parseInt(argVal("episode", "12"), 10) || 12;
const NPART   = parseInt(argVal("particles", "320"), 10) || 320;
const B       = Math.max(1, parseInt(argVal("b", "4"), 10) || 4);
const WANT_HTML = !hasFlag("no-html");
const NO_DETERMINISM = hasFlag("no-determinism");

// E7: the three regimes (worker E7 physics convention; condition names carry
// the regime so both sweeps share the dataset schema)
const E7_REGIMES = [
  { condition: "e7_sparse_clean", nParticles: 120, noise: 0.0 },
  { condition: "e7_default",      nParticles: 320, noise: 0.12 },
  { condition: "e7_dense_noisy",  nParticles: 640, noise: 0.30 },
];
// E8: information-limited arms (worker-exact options)
const E8_ARMS = [
  { condition: "e8_adaptive", opts: { adaptive: true } },
  { condition: "e8_fixed",    opts: { adaptive: false } },
  { condition: "e8_mem4",     opts: { memSize: 4 } },
];
// E8 arms share ONE runBenchmark call at the default operating point so all
// three run on identical gas (dT / entropy contrasts fully paired per seed);
// 320/0.12 equals the e7_default regime, so e8<->e7_default is gas-matched too.
const E8_GAS = { nParticles: 320, noise: 0.12 };

function factoryFor(condition) {
  if (condition.startsWith("e7_")) return (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg);
  const arm = E8_ARMS.find(a => a.condition === condition);
  if (arm) return (rng, env, cfg) => CTRL.classicalDemon(rng, env, arm.opts);
  throw new Error("unknown condition " + condition);
}
function physicsFor(condition, s) {
  const reg = E7_REGIMES.find(r => r.condition === condition);
  return reg ? { nParticles: reg.nParticles, noise: reg.noise } : {};
}

// ---- selftest ----------------------------------------------------------------
if (hasFlag("selftest")) {
  const w = SU.welchT([5, 6, 7, 8, 9, 10], [7, 8, 9, 10, 11, 12]);
  const okT = Math.abs(Math.abs(w.t) - 1.8516) < 2e-2 && Math.abs(w.p - 0.0938) < 5e-4;
  console.log("selftest welchT: " + (okT ? "OK" : "FAIL"));
  let okFact = true;
  for (const c of E7_REGIMES.map(r => r.condition).concat(E8_ARMS.map(a => a.condition))) {
    try { const f = factoryFor(c); if (typeof f !== "function") throw new Error("not fn"); }
    catch (e) { okFact = false; console.log("factory FAIL", c, e.message); }
  }
  console.log("selftest factories: " + (okFact ? "OK" : "FAIL"));
  const okP = physicsFor("e7_sparse_clean", 0).nParticles === 120 &&
              physicsFor("e7_sparse_clean", 0).noise === 0.0 &&
              physicsFor("e7_dense_noisy", 0).nParticles === 640 &&
              physicsFor("e8_adaptive", 0).nParticles === undefined;
  console.log("selftest physics routing: " + (okP ? "OK" : "FAIL"));
  const okGas = E8_GAS.nParticles === 320 && E8_GAS.noise === 0.12 &&
                physicsFor("e7_default", 0).nParticles === E8_GAS.nParticles &&
                physicsFor("e7_default", 0).noise === E8_GAS.noise;
  console.log("selftest e8/default gas parity: " + (okGas ? "OK" : "FAIL"));
  process.exit(okT && okFact && okP && okGas ? 0 : 1);
}

// ---- statistics (top-level: exported) ------------------------------------------
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
      const seeds = [...new Set(list.map(r => r.seed))].sort((a, b) => a - b);
      const seedRows = seeds.map(sd =>
        list.filter(r => r.seed === sd).sort((a, b) => a.trial - b.trial));
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

// ---- main -----------------------------------------------------------------------
function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const CONDITIONS = E7_REGIMES.map(r => r.condition).concat(E8_ARMS.map(a => a.condition));
  const rows = [];
  const perSeed = {};
  for (const v of CONDITIONS) perSeed[v] = [];
  console.log("E7/E8 batch validation: " + SEEDS + " seeds x " + CONDITIONS.length +
              " conditions, " + TRAIN + "+" + TEST + " trials x " + EPISODE +
              "s (E7 regimes: sparse 120/0.0, default 320/0.12, dense 640/0.30)");
  console.log("conditions: " + CONDITIONS.join(", "));
  console.log("call structure: 4 runBenchmark calls per seed (E7 regimes in " +
              "separate per-call _physics runs; E8 arms share one 320p/0.12 call)");
  const t0 = Date.now();
  // Per-seed call structure: each E7 regime is its OWN runBenchmark call
  // because the engine's _physics hook is per-CALL (nSeeds:1 -> whole call);
  // the three E8 arms share ONE call at the 320p/0.12 operating point so
  // their dT/sortEntropy contrasts are gas-matched (fully paired per seed).
  function runSeedCalls(seed, sIdx, sink) {
    for (const reg of E7_REGIMES) {
      CORE.runBenchmark({
        seed, nSeeds: 1,
        trialsTrain: TRAIN, trialsTest: TEST,
        episodeSeconds: EPISODE, dt: 1 / 60,
        nParticles: NPART, maxCrossingsPerTrial: 50,
        _physics: () => ({ nParticles: reg.nParticles, noise: reg.noise }),
        controllers: { [reg.condition]: factoryFor(reg.condition) },
        onTrialData: (cond, phase, tr) => {
          const row = Object.assign({}, tr, { condition: cond, phase, seedTag: sIdx + 1 });
          delete row.fireVec;
          sink.push(row);
        },
      });
    }
    CORE.runBenchmark({
      seed, nSeeds: 1,
      trialsTrain: TRAIN, trialsTest: TEST,
      episodeSeconds: EPISODE, dt: 1 / 60,
      nParticles: NPART, maxCrossingsPerTrial: 50,
      _physics: () => ({ nParticles: E8_GAS.nParticles, noise: E8_GAS.noise }),
      controllers: Object.fromEntries(E8_ARMS.map(a => [a.condition, factoryFor(a.condition)])),
      onTrialData: (cond, phase, tr) => {
        const row = Object.assign({}, tr, { condition: cond, phase, seedTag: sIdx + 1 });
        delete row.fireVec;
        sink.push(row);
      },
    });
  }
  for (let s = 0; s < SEEDS; s++) {
    const seed = BASE + s * 101;
    const tS = Date.now();
    runSeedCalls(seed, s, rows);
    console.log("  seed " + (s + 1) + "/" + SEEDS + " (rng " + seed + ") done in " +
                ((Date.now() - tS) / 1000).toFixed(1) + " s (4 calls: 3 E7 regimes + 1 E8 shared-gas)");
  }
  const elapsed = (Date.now() - t0) / 1000;

  // ---- determinism gate -----------------------------------------------------------
  if (!NO_DETERMINISM) {
    const rerun = [];
    // Gate mirrors the production call structure exactly (same 4 calls/seed).
    runSeedCalls(BASE, 0, rerun);
    const fields = ["crossings", "goodCrossings", "badCrossings", "openFraction",
                    "demonAgree", "dTfinal", "energyJ"];
    let same = true, badAt = null;
    for (const cond of CONDITIONS) {
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

  // ---- per-replicate finals ----------------------------------------------------------
  {
    const tags = [...new Set(rows.map(r => r.seedTag))].sort((a, b) => a - b);
    for (const v of CONDITIONS) {
      for (const tg of tags) {
        const vr = rows.filter(r => r.condition === v && r.seedTag === tg);
        const lastTrain = [...vr].reverse().find(r => r.phase === "train");
        const lastTest  = [...vr].reverse().find(r => r.phase === "test");
        if (lastTrain) perSeed[v].push({ seed: tg, phase: "train", rec: lastTrain });
        if (lastTest)  perSeed[v].push({ seed: tg, phase: "test",  rec: lastTest });
      }
    }
  }

  const stats = trialStats(rows, B);

  const FINAL_FIELDS = ["crossings", "goodCrossings", "badCrossings", "openFraction",
                        "demonAgree", "dTfinal", "sortEntropy", "spatialH", "miNeural",
                        "energyJ", "workInJ", "extractableJ", "erasureCostJ",
                        "landauerRatio", "measuredBits", "goodBadRatio"];
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
  const finals = Object.fromEntries(CONDITIONS.map(v => [v, finalSummary(v)]));

  // ---- structural audit of the worker-exact E8 arms (honesty check) -------------
  // The engine's classicalDemon decision-memory buffer is WRITE-ONLY (pushed
  // and shifted, never read), so memSize is behaviorally inert; and
  // {adaptive:true} is the factory default, so at matched gas (320p/0.12)
  // e8_adaptive replicates e7_default row-for-row. Both identities are pinned
  // by tests/e7_e8_batch.test.js T5 and REPORTED here rather than hidden.
  const AUDIT_FIELDS = ["crossings", "goodCrossings", "badCrossings", "openFraction",
    "demonAgree", "demonDecisions", "dTfinal", "sortEntropy", "spatialH", "miNeural",
    "energyJ", "jetWorkJ", "workInJ", "measuredBits", "erasureCostJ", "extractableJ",
    "landauerRatio", "vThreshold", "steps"];
  function rowsSig(cond) {
    return JSON.stringify(rows.filter(r => r.condition === cond)
      .map(r => AUDIT_FIELDS.map(f => (r[f] === null || r[f] === undefined) ? 0 : r[f])));
  }
  const identDefault = rowsSig("e8_adaptive") === rowsSig("e7_default");
  const identMem4    = rowsSig("e8_mem4") === rowsSig("e8_adaptive");
  console.log("\nE8 structural audit (worker-exact arms):\n" +
    "  e8_adaptive == e7_default (matched gas, default opts): " + (identDefault ? "identical (expected)" : "DIVERGENT (call-structure BUG)") + "\n" +
    "  e8_mem4 == e8_adaptive (memory buffer write-only in engine): " + (identMem4 ? "identical (expected)" : "differs (engine memory path changed?)"));
  if (!identDefault) {
    console.error("STRUCTURAL AUDIT FAILED: e8_adaptive != e7_default at matched gas — runBenchmark call structure is broken");
    process.exit(1);
  }

  // ---- Welch tests: E8 arms + E7 regime pairs (per-seed, final TEST) ------------------
  function lastVals(v, f) {
    return ((perSeed[v] || []).filter(x => x.phase === "test")
            .map(x => x.rec[f])).filter(x => x !== null && x !== undefined && Number.isFinite(x));
  }
  const tests = [];
  {
    // E7 regime gradients (per-seed; NOTE: regimes use DIFFERENT gas per
    // condition by design — these are between-regime contrasts, seed-paired
    // only in the rng-rule sense)
    const e7pairs = [["e7_sparse_clean", "e7_default"], ["e7_default", "e7_dense_noisy"],
                     ["e7_sparse_clean", "e7_dense_noisy"]];
    // E8 information contrasts (identical gas per seed: fully paired).
    // Only adaptive-vs-fixed is retained: the audit above shows e8_mem4 and
    // e7_default are row-identical to e8_adaptive by construction, so those
    // pairs are vacuous (they would report t=0, p=1 by identity).
    const e8pairs = [["e8_adaptive", "e8_fixed"]];
    for (const f of ["goodCrossings", "goodBadRatio", "openFraction", "demonAgree"]) {
      for (const [a, b] of e7pairs.concat(e8pairs)) {
        if (!CONDITIONS.includes(a) || !CONDITIONS.includes(b)) continue;
        const va = lastVals(a, f), vb = lastVals(b, f);
        if (va.length >= 2 && vb.length >= 2)
          tests.push({ metric: f, comparison: a + " vs " + b + " (final TEST)", ...SU.welchT(va, vb) });
      }
    }
  }

  // ---- console report -------------------------------------------------------------------
  const fmt = (st, d) => st ? st.mean.toFixed(d) + " +/- " + st.ci.toFixed(d) + " (n=" + st.n + ")" : "-";
  console.log("\n" + SEEDS + " seeds | " + TRAIN + "+" + TEST + " trials | " + rows.length + " rows | " +
              elapsed.toFixed(0) + " s");
  console.log("\n== FINAL TEST metrics (mean +/- 95% CI over seeds) ==");
  for (const v of CONDITIONS) {
    const F = finals[v];
    console.log("  " + v.padEnd(16) +
      " good " + fmt(F.test && F.test.goodCrossings, 2).padEnd(22) +
      " good:bad " + fmt(F.test && F.test.goodBadRatio, 3).padEnd(20) +
      " openFrac " + fmt(F.test && F.test.openFraction, 3));
  }
  if (tests.length) {
    console.log("\n== Welch t tests on final TEST metrics (two-sided) ==");
    for (const w of tests)
      console.log("  " + w.comparison + " - " + w.metric + ": t=" + w.t.toFixed(2) +
                  ", df=" + w.df.toFixed(1) + ", p=" +
                  (w.p < 1e-4 ? w.p.toExponential(1) : w.p.toFixed(4)));
  }

  // ---- artifacts ----------------------------------------------------------------------------
  fs.mkdirSync(path.join(__dirname, "research_data"), { recursive: true });
  const jsonl = path.join(__dirname, "research_data", "e7_e8_batch_" + stamp + ".jsonl");
  fs.writeFileSync(jsonl, rows.map(r => JSON.stringify(r)).join("\n"));
  const summaryPath = path.join(__dirname, "research_data", "e7_e8_batch_" + stamp + "_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify({
    provenance: {
      experiment: "e7_e8", phase: "C-7", kind: "batch_validation",
      question: "E7: does the demon generalize across physics regimes? E8: what do information constraints (adaptive/fixed/memory-limited) cost?",
      seeds: SEEDS, seedBase: BASE, seedStride: 101,
      trainTrials: TRAIN, testTrials: TEST, episodeSeconds: EPISODE,
      nParticles: NPART, blockB: B,
      callStructure: "per seed: 3 E7 regime calls (per-call _physics) + 1 E8 call at 320p/0.12 shared gas",
      e8_gas: E8_GAS,
      e8_structural_audit: {
        e8_adaptive_equals_e7_default: identDefault,
        e8_mem4_equals_e8_adaptive: identMem4,
        note: "memSize is behaviorally inert in the engine (decision-memory buffer is write-only); " +
              "{adaptive:true} is the factory default, so e8_adaptive replicates e7_default at matched gas. " +
              "The effective E8 information contrast is adaptive vs fixed.",
      },
      e7_regimes: E7_REGIMES, e8_arms: E8_ARMS.map(a => a.condition),
      controllers: { e7: "CTRL.classicalDemon (worker-exact defaults)",
                     e8: "CTRL.classicalDemon {adaptive:true|false}, {memSize:4} (worker-exact)" },
      engine: "experiment_core.js runBenchmark (UNTOUCHED)",
      determinism: NO_DETERMINISM ? "gate skipped" : "same-seed rerun identical (gate passed)",
      startedISO: new Date(Date.now() - elapsed * 1000).toISOString(),
      elapsedSeconds: Math.round(elapsed * 1e6) / 1e6,
    },
    finals, tests,
  }, null, 2));
  console.log("\nwrote " + jsonl + " (" + rows.length + " rows)");
  console.log("wrote " + summaryPath);

  // ---- C-3 standardized dataset export --------------------------------------------------------
  {
    const DX = require("./dataset_export.js");
    const dsRows = rows.map(r => Object.assign({}, r, {
      experiment: r.condition.startsWith("e7") ? "e7" : "e8" }));
    const ds = DX.exportRun({
      experiment: "e7_e8",
      label: "E7 generalization sweep + E8 information-limited demons (C-7)",
      question: "E7: does the demon generalize across physics regimes? E8: what do information constraints cost?",
      protocol: "TRAIN -> FROZEN TEST shape for comparability; seed = independent replicate; no seeds discarded",
      config: { seeds: SEEDS, seedBase: BASE, seedStride: 101, trainTrials: TRAIN,
                testTrials: TEST, episodeSeconds: EPISODE, nParticles: NPART,
                e8_gas: E8_GAS,
                e8_structural_audit: {
                  e8_adaptive_equals_e7_default: identDefault,
                  e8_mem4_equals_e8_adaptive: identMem4,
                  note: "memSize is behaviorally inert in the engine (decision-memory buffer is write-only); " +
                        "{adaptive:true} is the factory default, so e8_adaptive replicates e7_default at matched gas.",
                },
                e7_regimes: E7_REGIMES, e8_arms: E8_ARMS.map(a => a.condition),
                engine: "experiment_core.js runBenchmark (unmodified)" },
      conditions: CONDITIONS,
    }, dsRows);
    console.log("dataset: " + ds.csvPath);
    console.log("dataset manifest: " + ds.manifestPath + " (sha256 " + ds.sha256.slice(0, 16) + "...)");
  }

  // ---- HTML report ------------------------------------------------------------------------------
  if (WANT_HTML) {
    const PANELS = [
      ["goodCrossings", "Good crossings per trial (primary)", v => v.toFixed(1)],
      ["openFraction",  "Door open fraction vs trial",        v => (v * 100).toFixed(0) + "%"],
      ["demonAgree",    "Demon agreement vs trial",           v => (v * 100).toFixed(0) + "%"],
    ];
    const COLORS = { e7_sparse_clean: "#55a868", e7_default: "#4c72b0", e7_dense_noisy: "#c44e52",
                     e8_adaptive: "#dd8452", e8_fixed: "#8c8c8c", e8_mem4: "#b0813a" };
    const series = CONDITIONS.filter(v => COLORS[v]);
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const htmlPanels = PANELS.map(([f, label, fmtV]) => {
      const allPts = stats.filter(s => s.condition === series[0]);
      if (!allPts.length) return "";
      const W = 430, H = 240, padL = 50, padR = 10, padT = 12, padB = 24;
      const xlo = 0, xhi = Math.max(...allPts.map(s => s.trialEnd)) + 1;
      let ylo = Infinity, yhi = -Infinity;
      for (const s of stats) {
        const st = s[f]; if (!st) continue;
        ylo = Math.min(ylo, st.mean - st.ci); yhi = Math.max(yhi, st.mean + st.ci);
      }
      if (!Number.isFinite(ylo)) return "";
      if (yhi === ylo) { yhi = ylo + 1; ylo -= 0.5; }
      const X = x => padL + (x - xlo) / Math.max(1e-9, xhi - xlo) * (W - padL - padR);
      const Y = y => padT + (1 - (y - ylo) / (yhi - ylo)) * (H - padT - padB);
      const testStart = allPts.find(s => s.phase === "test");
      const lines = series.map(v => {
        const pts = stats.filter(s => s.condition === v && s[f]);
        let dd = "", pen = false;
        for (const s of pts) {
          const x = (s.trialStart + s.trialEnd) / 2, y = s[f].mean;
          dd += (pen ? "L" : "M") + X(x).toFixed(1) + "," + Y(y).toFixed(1) + " "; pen = true;
        }
        return dd ? '<path d="' + dd + '" fill="none" stroke="' + COLORS[v] + '" stroke-width="1.6"/>' : "";
      }).join("");
      const ticks = [0, 0.25, 0.5, 0.75, 1].map(fr =>
        '<text x="4" y="' + (padT + (1 - fr) * (H - padT - padB) + 3).toFixed(1) +
        '" font-size="9" fill="#6a737d">' + fmtV(ylo + fr * (yhi - ylo)) + '</text>').join("");
      const xTicks = [0, 0.5, 1].map(fr => {
        const xv = xlo + fr * (xhi - xlo);
        return '<text x="' + X(xv).toFixed(1) + '" y="' + (H - 8) +
               '" font-size="9" fill="#6a737d" text-anchor="middle">' + Math.round(xv) + '</text>';
      }).join("");
      return '<div class="panel"><h3>' + esc(label) +
        ' <span class="tag">all conditions, n=' + SEEDS + ' seeds</span></h3>' +
        '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart">' +
        '<rect x="' + padL + '" y="' + padT + '" width="' + (W - padL - padR) + '" height="' + (H - padT - padB) +
        '" fill="none" stroke="#30363d"/>' +
        (testStart ? '<line x1="' + X(testStart.trialStart).toFixed(1) + '" y1="' + padT +
                     '" x2="' + X(testStart.trialStart).toFixed(1) + '" y2="' + (H - padB) +
                     '" stroke="#8b949e" stroke-dasharray="4 4" opacity=".6"/>' : "") +
        lines + ticks + xTicks + '</svg>' +
        '<div class="legend">' + series.map(v => '<span><i style="background:' + COLORS[v] + '"></i>' + v + '</span>').join("") + '</div></div>';
    }).join("");
    const f2 = (v, f, d) => {
      const st = (finals[v] || {}).test && (finals[v] || {}).test[f];
      return st ? st.mean.toFixed(d) + " +/- " + st.ci.toFixed(d) : "-";
    };
    const tableRows = CONDITIONS.map(v => '<tr><th>' + v + '</th>' +
      '<td>' + f2(v, "goodCrossings", 2) + '</td><td>' + f2(v, "goodBadRatio", 3) + '</td>' +
      '<td>' + f2(v, "openFraction", 3) + '</td><td>' + f2(v, "dTfinal", 3) + '</td></tr>').join("");
    const testsHtml = tests.length
      ? '<table><tr><th>comparison</th><th>metric</th><th>t</th><th>df</th><th>p (two-sided)</th></tr>' +
        tests.map(w => '<tr><td>' + esc(w.comparison) + '</td><td>' + w.metric + '</td><td>' +
                       w.t.toFixed(2) + '</td><td>' + w.df.toFixed(1) + '</td><td>' +
                       (w.p < 1e-4 ? w.p.toExponential(1) : w.p.toFixed(4)) + '</td></tr>').join("") +
        '</table><p class="note">Welch two-sided t tests over per-seed final-TEST values; E8 pairs are fully paired (same gas per seed); E7 pairs are between-regime contrasts.</p>'
      : "";
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>E7/E8 batch report</title><style>' +
      'body{background:#0d1117;color:#e6edf3;font:13px/1.5 system-ui;margin:24px}' +
      'h1{font-size:19px} h2{font-size:15px;margin-top:26px} h3{font-size:13px;margin:8px 0 4px}' +
      '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:14px}' +
      '.panel{background:#10161d;border:1px solid #21262d;border-radius:8px;padding:10px}' +
      '.chart{width:100%;height:auto}.tag{font-weight:400;font-size:11px;color:#8b949e}' +
      '.legend span{margin-right:12px;font-size:11px}.legend i{display:inline-block;width:10px;height:10px;margin-right:4px;border-radius:2px}' +
      'table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #30363d;padding:4px 10px;font-size:12px;text-align:right}th{background:#161b22}' +
      '.note{color:#8b949e;font-size:12px;max-width:900px}' +
      '</style></head><body>' +
      '<h1>E7 Generalization Sweep + E8 Information-Limited Demons</h1>' +
      '<p class="note">' + SEEDS + ' seeds x ' + CONDITIONS.length + ' conditions | ' + TRAIN + '+' + TEST +
      ' trials x ' + EPISODE + 's. E7 regimes: sparse/clean 120p-0.0 noise, default 320p-0.12, dense/noisy 640p-0.30' +
      ' (per-call physics override; one runBenchmark call per regime). E8 arms: adaptive / fixed-threshold / memory-4 (worker-exact options;' +
      ' structural audit: e8_mem4 and e7_default are row-identical to e8_adaptive by construction — the effective information contrast is adaptive vs fixed).' +
      ' Determinism gate: ' + (NO_DETERMINISM ? 'SKIPPED' : 'passed') + '.</p>' +
      '<h2>Final TEST metrics (mean +/- 95% CI)</h2>' +
      '<table><tr><th>condition</th><th>good crossings</th><th>good:bad</th><th>open frac</th><th>dT final</th></tr>' +
      tableRows + '</table>' +
      '<h2>Learning curves</h2><div class="grid">' + htmlPanels + '</div>' +
      '<h2>Welch t tests on final TEST metrics</h2>' + testsHtml +
      '</body></html>';
    const htmlPath = path.join(__dirname, "research_data", "e7_e8_batch_report_" + stamp + ".html");
    fs.writeFileSync(htmlPath, html);
    console.log("wrote " + htmlPath);
  }
}

if (require.main === module) main();

module.exports = { trialStats, factoryFor, physicsFor };
