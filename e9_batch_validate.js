#!/usr/bin/env node
"use strict";
/**
 * e9_batch_validate.js — E9 Phase-2 multi-seed batch validation.
 *
 * PURPOSE: measure the EXISTING Phase-1 E9 system across independent random
 * seeds. Nothing about the science is changed here:
 *   - senseE9, neural valve control, classical reference policy, reward
 *     components, dopamine/eligibility plasticity, train/test split, pressure
 *     physics, piston/work — all untouched (see experiment_core.js).
 *   - No tuning, no seed selection, no discarding poor runs. Every seed's
 *     data is retained.
 *
 * STATISTICS: the INDEPENDENT REPLICATE IS THE SEED. For each trial index,
 * per-seed block means are aggregated across seeds into mean / sd / sem and
 * a 95% CI (mean ± 1.96·sem). Trials within one seed are never treated as
 * independent samples. Between-condition claims use Welch's two-sided t test
 * on per-seed final-TEST values (Welch–Satterthwaite df).
 *
 * ARTIFACTS (research_data/):
 *   e9_batch_<stamp>.jsonl          complete per-trial records (all seeds)
 *   e9_batch_<stamp>_summary.json   finals, ratio distribution, Welch tests
 *   e9_batch_report_<stamp>.html    self-contained seaborn-styled report:
 *                                   mean line + 95% CI band per panel,
 *                                   TRAIN | TEST divider on every panel
 *
 * C-8: Welch t tests delegated to the canonical stats_utils.welchT (one
 * implementation project-wide; the selftest still pins it against the
 * independent Simpson-integration anchor), C-3 dataset export, and an
 * import-safe main() guard (require.main === module) so tests can load
 * this script as a module without side effects.
 *
 * CLI:
 *   node e9_batch_validate.js [--seeds 20] [--base 1] [--b 4]
 *        [--train 12] [--test 12] [--episode 20] [--particles 260]
 *        [--variants demon_neural,demon_frozen,demon_speed | all]
 *        [--no-html]
 */

const fs = require("fs");
const path = require("path");
const CORE = require("./experiment_core.js");
const CTRL = require("./controllers.js");
const SU = require("./stats_utils.js");
// C-8: Welch t tests are delegated to the canonical stats_utils.welchT —
// the identical algorithm (Welch-Satterthwaite df + two-sided regularized
// incomplete-beta p) that this file previously carried a private copy of.
// The --selftest block still verifies the implementation against its own
// independent Simpson-integration anchor, so nothing is trusted on faith.
const welchT = SU.welchT;

// ---- CLI -------------------------------------------------------------------
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}
const hasFlag = (name) => args.includes("--" + name);

const SEEDS   = Math.max(2, parseInt(argVal("seeds", "20"), 10) || 20);
const BASE    = parseInt(argVal("base", "1"), 10) || 1;
const TRAIN   = parseInt(argVal("train", "12"), 10) || 12;
const TEST    = parseInt(argVal("test", "12"), 10) || 12;
const EPISODE = parseInt(argVal("episode", "20"), 10) || 20;
const NPART   = parseInt(argVal("particles", "260"), 10) || 260;
const B       = Math.max(1, parseInt(argVal("b", "4"), 10) || 4);
const WANT_HTML = !hasFlag("no-html");
const KNOWN_VARIANTS = ["demon_neural", "demon_frozen", "demon_speed",
                        "demon_random", "never_open"];
const VAR_ARG = hasFlag("variants")
  ? argVal("variants", "").split(",").map(s => s.trim()).filter(Boolean)
  : null;
// default subset: the three scientifically important conditions (same as the
// 3D page). RNG/geometry seeds in the core derive from the FULL variant-list
// index, so subset runs reproduce full-run trajectories exactly.
const VARIANTS = !VAR_ARG ? ["demon_neural", "demon_frozen", "demon_speed"]
  : VAR_ARG.includes("all") ? KNOWN_VARIANTS.slice()
  : VAR_ARG.filter(v => KNOWN_VARIANTS.includes(v));
if (!VARIANTS.length) { console.error("no known variants in --variants list"); process.exit(1); }

// quick self-check of the p-value machinery and the aggregator (--selftest):
// verified against the Student-t table value p(t=2.0, df=10) = 0.0734
// (two-sided), the large-df normal limit via erf, and synthetic-row block
// continuity. Exits before any simulation when run. (Placed before the batch
// loop on purpose; welchT/trialStats are hoisted function declarations.)
if (hasFlag("selftest")) {
  // 1) Welch p-value vs an INDEPENDENT method: numeric integration of the
  //    unnormalized Student-t pdf (no shared code with the incomplete-beta
  //    continued fraction), anchored to the published value
  //    p(t=2, df=10) = 0.073388 (two-sided).
  {
    const a = [5, 6, 7, 8, 9, 10], b = [7, 8, 9, 10, 11, 12];  // |t|=1.8516, df=10
    const w = welchT(a, b);
    const g = (x, nu) => Math.pow(1 + x * x / nu, -(nu + 1) / 2);
    const simp = (f, lo, hi, n) => {           // composite Simpson, even n
      const h = (hi - lo) / n;
      let s = f(lo) + f(hi);
      for (let i = 1; i < n; i++) s += f(lo + i * h) * (i % 2 ? 4 : 2);
      return s * h / 3;
    };
    const pIndep = (t0, nu) => {
      const T = t0 + 300;
      const num = simp(x => g(x, nu), t0, T, 4000);
      const den = 2 * simp(x => g(x, nu), 0, T, 8000);
      return 2 * num / den;
    };
    const pAnchor = pIndep(2, 10);
    const okAnchor = Math.abs(pAnchor - 0.073388) < 5e-4;
    const okMatch = Math.abs(w.p - pIndep(Math.abs(w.t), 10)) < 5e-4;
    const okDf = Math.abs(w.df - 10) < 1e-9;
    console.log(`selftest welchT: anchor p(t=2,df=10)=${pAnchor.toFixed(6)} (want 0.073388) ` +
                `${okAnchor ? "OK" : "FAIL"}; welchT p=${w.p.toFixed(6)} vs integration ${okMatch ? "OK" : "FAIL"}; df=${w.df.toFixed(4)} ${okDf ? "OK" : "FAIL"}`);
    if (!(okAnchor && okMatch && okDf)) process.exit(1);
  }
  // 2) large-df limit must approach the normal approximation 2(1-Phi(|t|))
  {
    const big = Array.from({ length: 400 }, (_, i) => i * 0.01 + 0.5);
    const w = welchT(big.map(x => x + 0.2), big);
    const erfc = (x) => 1 - (function (t) {  // Abramowitz–Stegun 7.1.26 erf
      const s = Math.sign(t), a = Math.abs(t);
      const z = 1 / (1 + 0.3275911 * a);
      const y = 1 - ((((1.061405429 * z - 1.453152027) * z + 1.421413741) * z
                      - 0.284496736) * z + 0.254829592) * z * Math.exp(-a * a);
      return s * y;
    })(x / Math.SQRT2);
    const pNorm = erfc(Math.abs(w.t));            // = 2(1-Phi(|t|))
    const ok = Math.abs(w.p - pNorm) / pNorm < 0.02;
    console.log(`selftest normal limit: p=${w.p.toFixed(5)} vs normal ${pNorm.toFixed(5)} -> ${ok ? "OK" : "FAIL"}`);
    if (!ok) process.exit(1);
  }
  // 3) identical samples -> p = 1; separated samples -> tiny p
  {
    const same = welchT([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    const far = welchT([10, 11, 12, 13, 14], [1, 2, 3, 4, 5]);
    console.log(`selftest edges: identical p=${same.p.toFixed(3)} (want 1), separated p=${far.p.toExponential(2)} (want <1e-3) -> ` +
                (same.p > 0.999 && far.p < 1e-3 ? "OK" : "FAIL"));
    if (!(same.p > 0.999 && far.p < 1e-3)) process.exit(1);
  }
  // 4) trialStats on synthetic rows: block continuity + seed as replicate
  {
    const syn = [];
    for (let sd = 1; sd <= 3; sd++) {
      for (let t = 0; t < 4; t++) syn.push({ condition: "c1", phase: "train", seed: sd, trial: t, reward: t + sd });
      for (let t = 0; t < 2; t++) syn.push({ condition: "c1", phase: "test",  seed: sd, trial: 4 + t, reward: 100 + t + sd });
    }
    const st = trialStats(syn, 2);
    const trains = st.filter(p => p.phase === "train"), tests = st.filter(p => p.phase === "test");
    const cont = Math.min(...tests.map(p => p.block)) === Math.max(...trains.map(p => p.block)) + 1;
    const nOK = st.every(p => p.reward.n === 3);
    // hand value: per-seed block0 means over t=0,1 are 1.5 / 2.5 / 3.5
    // (reward = t + seed); cross-seed mean = 2.5, sd = 1, ci = 1.96/√3
    const b0 = trains.find(p => p.block === 0);
    const handOK = Math.abs(b0.reward.mean - 2.5) < 1e-12 &&
                   Math.abs(b0.reward.ci - 1.96 / Math.sqrt(3)) < 1e-12;
    console.log(`selftest trialStats: continuity=${cont} n=3 everywhere=${nOK} hand mean/CI=${handOK} -> ` +
                (cont && nOK && handOK ? "OK" : "FAIL"));
    if (!(cont && nOK && handOK)) process.exit(1);
  }
  console.log("selftest passed");
  process.exit(0);
}

// ---- brain factory: identical feature set to the worker's e9BrainFactory ---
// (eligibility windows + trained PG readout). --pairing selects the credit
// delivery mode:
//   legacy     - deferred tick update paired with decPend (historical E9
//                behavior; byte-comparable with previous batch runs)
//   corrected  - pgBaseline: REINFORCE applied at reward-DELIVERY time, so
//                window-k credit pairs with decision k (the core writes
//                pgReward BEFORE lastPgAction() re-latches the next sample),
//                reward centered by an EMA baseline, zero-reward windows
//                included as correct rejections. Same fix verified on E10.
const PAIRING = argVal("pairing", "legacy");
if (PAIRING !== "legacy" && PAIRING !== "corrected") {
  console.error("--pairing must be legacy or corrected"); process.exit(1);
}
const CIRCUIT = JSON.parse(fs.readFileSync(path.join(__dirname, "fly_brain_circuit.json"), "utf8"));
function e9BrainFactory(seedIdx) {
  return CTRL.connectomeController(CIRCUIT, {
    shuffle: false, rng: CORE.makeRng(9176 + (seedIdx || 0) * 37), seed: 1,
    opticDrive: 0, motorDrive: 0.6, plasticity: "full",
    eligibility: [{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }],
    policyGradient: true,
    pgBaseline: PAIRING === "corrected",
    pgRng: CORE.makeRng(424243 + (seedIdx || 0) * 977),
  });
}

// ---- statistics: independent replicate = SEED -------------------------------
/**
 * Aggregate per-trial rows into trial-index blocks. Within a condition, TRAIN
 * blocks come first and TEST blocks CONTINUE the global trial/block index
 * (exactly like the live-page curve), so nothing folds back. Every point
 * aggregates per-seed block means; the seed is the replicate.
 */
function trialStats(rowsIn, B) {
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
      const nBlocks = Math.max(1, Math.floor(nTrials / B));
      for (let b = 0; b < nBlocks; b++) {
        const pt = { condition, phase, block: blockOffset + b,
                     trialStart: trialOffset + b * B,
                     trialEnd: trialOffset + Math.min((b + 1) * B, nTrials) - 1 };
        for (const f of fields) {
          const vals = [];
          for (const srows of seedRows) {
            const seg = srows.slice(b * B, (b + 1) * B);
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

// ---- main -------------------------------------------------------------------
function main() {
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const rows = [];
const perSeed = {};                       // variant -> [{seed, phase, rec}]
for (const v of VARIANTS) perSeed[v] = [];
console.log(`E9 Phase-2 batch validation: ${SEEDS} seeds x ${VARIANTS.length} variants, ` +
            `${TRAIN}+${TEST} trials x ${EPISODE}s x ${NPART} particles`);
console.log(`variants: ${VARIANTS.join(", ")} | credit pairing: ${PAIRING}`);
const t0 = Date.now();
for (let s = 0; s < SEEDS; s++) {
  const seed = BASE + s * 101;            // same stride as the worker
  const tS = Date.now();
  CORE.pressureDemonCore({
    seed, seedTag: s + 1,                 // row seed tag = replicate id
    trials: TRAIN + TEST, trainTrials: TRAIN,
    episodeSeconds: EPISODE, nParticles: NPART,
    variants: VARIANTS,
    brainFactory: (tag) => e9BrainFactory(tag),
    onTrialData: (cond, phase, tr) => {
      const row = Object.assign({ condition: cond, phase }, tr);
      delete row.fireVec;   // 139 KB/row display payload — never persist (C-1 hygiene)
      rows.push(row);
    },
  });
  // final-phase record for this seed: last TRAIN and last TEST trial per variant
  for (const v of VARIANTS) {
    const vr = rows.filter(r => r.condition === v && r.seed === s + 1);
    const lastTrain = [...vr].reverse().find(r => r.phase === "train");
    const lastTest  = [...vr].reverse().find(r => r.phase === "test");
    if (lastTrain) perSeed[v].push({ seed: s + 1, phase: "train", rec: lastTrain });
    if (lastTest)  perSeed[v].push({ seed: s + 1, phase: "test",  rec: lastTest });
  }
  console.log(`  seed ${s + 1}/${SEEDS} (rng ${seed}) done in ${((Date.now() - tS) / 1000).toFixed(1)} s`);
}
const elapsed = (Date.now() - t0) / 1000;

// ---- reproducibility gate: same seed -> identical trajectory ----------------
{
  const rerun = [];
  CORE.pressureDemonCore({
    seed: BASE, seedTag: 1, trials: TRAIN + TEST, trainTrials: TRAIN,
    episodeSeconds: EPISODE, nParticles: NPART, variants: VARIANTS,
    brainFactory: (tag) => e9BrainFactory(tag),
    onTrialData: (cond, phase, tr) => rerun.push(Object.assign({ condition: cond, phase }, tr)),
  });
  const first = rows.filter(r => r.seed === 1 && r.condition === "demon_neural");
  const again = rerun.filter(r => r.condition === "demon_neural");
  const fields = ["reward", "decisionAccuracy", "demonAgree", "workJ", "dPfinal",
                  "pistonX", "spikeRate", "dopamine", "weightDrift", "sensorDecisionBits"];
  const same = first.length === again.length && first.length > 0 &&
    first.every((r, i) => fields.every(f =>
      Math.abs((r[f] || 0) - (again[i][f] || 0)) < 1e-12));
  console.log(`\nreproducibility: same seed -> ${same ? "IDENTICAL trajectory" : "DIVERGENT (BUG)"}`);
  if (!same) { console.error("reproducibility gate FAILED"); process.exit(1); }
}
const stats = trialStats(rows, B);

// ---- final-phase cross-seed summaries ---------------------------------------
const FINAL_FIELDS = ["reward", "decisionAccuracy", "demonAgree", "workJ", "netWorkJ",
                      "dPfinal", "pistonX", "openFraction", "goodCrossings", "badCrossings",
                      "spikeRate", "dopamine", "weightDrift", "sensorDecisionBits"];
function finalSummary(v) {
  const out = {};
  for (const phase of ["train", "test"]) {
    const recs = (perSeed[v] || []).filter(x => x.phase === phase).map(x => x.rec);
    if (!recs.length) continue;
    const agg = {};
    for (const f of FINAL_FIELDS) {
      const vals = recs.map(r => r[f]).filter(x => Number.isFinite(x));
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

// per-seed neural/classical test-work ratio — the DISTRIBUTION, not one value.
// workJ is the chamber-cumulative spring work through the end of the TEST
// phase (Phase-1 design: gas + piston persist across episodes within a seed).
let ratioStats = null, ratioPerSeed = [];
if (perSeed.demon_neural && perSeed.demon_speed) {
  ratioPerSeed = perSeed.demon_neural.filter(x => x.phase === "test").map(x => {
    const cls = perSeed.demon_speed.find(c => c.phase === "test" && c.seed === x.seed);
    return cls && cls.rec.workJ > 0 ? x.rec.workJ / cls.rec.workJ : NaN;
  }).filter(Number.isFinite);
  if (ratioPerSeed.length) {
    const m = ratioPerSeed.reduce((a, b) => a + b, 0) / ratioPerSeed.length;
    const sd = ratioPerSeed.length > 1
      ? Math.sqrt(ratioPerSeed.reduce((a, x) => a + (x - m) ** 2, 0) / (ratioPerSeed.length - 1)) : 0;
    const sem = sd / Math.sqrt(ratioPerSeed.length);
    ratioStats = { mean: m, sd, sem, ci: 1.96 * sem, n: ratioPerSeed.length,
                   min: Math.min(...ratioPerSeed), max: Math.max(...ratioPerSeed) };
  }
}

// ---- Welch tests on final TEST metrics --------------------------------------
function lastVals(v, f) {
  return ((perSeed[v] || []).filter(x => x.phase === testPhaseOf(v))
          .map(x => x.rec[f])).filter(Number.isFinite);
}
function testPhaseOf() { return "test"; }   // explicit: finals compare TEST phases
const tests = [];
for (const f of ["reward", "decisionAccuracy", "workJ", "demonAgree"]) {
  const a = lastVals("demon_neural", f), b = lastVals("demon_frozen", f);
  if (a.length && b.length)
    tests.push({ metric: f, comparison: "demon_neural vs demon_frozen (final TEST)", ...welchT(a, b) });
  const c = lastVals("demon_speed", f);
  if (a.length && c.length)
    tests.push({ metric: f, comparison: "demon_neural vs demon_speed (final TEST)", ...welchT(a, c) });
}

// ---- console report ----------------------------------------------------------
const fmt = (st, d) => st ? `${st.mean.toFixed(d)} ± ${st.ci.toFixed(d)} (n=${st.n})` : "—";
const fmtE = (st) => st ? `${st.mean.toExponential(2)} ± ${st.ci.toExponential(2)} (n=${st.n})` : "—";
console.log(`\n${SEEDS} seeds · ${TRAIN}+${TEST} trials · ${EPISODE}s episodes · ${NPART} particles · ` +
            `${rows.length} trial rows · ${elapsed.toFixed(0)} s`);
console.log("\n== FINAL metrics (mean ± 95% CI over seeds; work = cumulative J through phase) ==");
for (const v of VARIANTS) {
  const F = finals[v];
  console.log(`\n${v}:`);
  console.log(`  final train reward    ${fmt(F.train && F.train.reward, 2)}`);
  console.log(`  final test  reward    ${fmt(F.test && F.test.reward, 2)}`);
  console.log(`  final train accuracy  ${fmt(F.train && F.train.decisionAccuracy, 3)}`);
  console.log(`  final test  accuracy  ${fmt(F.test && F.test.decisionAccuracy, 3)}`);
  console.log(`  final train work (J)  ${fmtE(F.train && F.train.workJ)}`);
  console.log(`  final test  work (J)  ${fmtE(F.test && F.test.workJ)}`);
  console.log(`  final demon agreement ${fmt(F.test && F.test.demonAgree, 3)}`);
}
if (ratioStats) {
  console.log(`\nneural/classical test-work ratio (per-seed distribution):`);
  console.log(`  ${ratioStats.mean.toFixed(3)} ± ${ratioStats.ci.toFixed(3)} (n=${ratioStats.n}, ` +
              `range ${ratioStats.min.toFixed(3)}–${ratioStats.max.toFixed(3)})`);
  console.log(`  per-seed: ${ratioPerSeed.map(x => x.toFixed(2)).join(", ")}`);
}
if (tests.length) {
  console.log("\n== Welch t tests on final TEST metrics (two-sided, per-seed values) ==");
  for (const w of tests)
    console.log(`  ${w.comparison} — ${w.metric}: t=${w.t.toFixed(2)}, df=${w.df.toFixed(1)}, ` +
                `p=${w.p < 1e-4 ? w.p.toExponential(1) : w.p.toFixed(4)}`);
}

// ---- artifacts ---------------------------------------------------------------
fs.mkdirSync(path.join(__dirname, "research_data"), { recursive: true });
const jsonl = path.join(__dirname, "research_data", `e9_batch_${stamp}.jsonl`);
fs.writeFileSync(jsonl, rows.map(r => JSON.stringify(r)).join("\n"));
const summaryPath = path.join(__dirname, "research_data", `e9_batch_${stamp}_summary.json`);
fs.writeFileSync(summaryPath, JSON.stringify({
  provenance: {
    experiment: "e9", phase: 2, kind: "batch_validation",
    seeds: SEEDS, seedBase: BASE, seedStride: 101,
    trainTrials: TRAIN, testTrials: TEST, episodeSeconds: EPISODE,
    nParticles: NPART, blockB: B, variants: VARIANTS,
    controllerOptions: { shuffle: false, rng: "makeRng(9176 + seedIdx*37)", seed: 1,
                         opticDrive: 0, motorDrive: 0.6, plasticity: "full" },
    note: "Phase-1 model unchanged; validation only. workJ is cumulative spring work through the end of the phase.",
    reproducibility: "same-seed rerun identical (gate passed)",
    startedISO: new Date(Date.now() - elapsed * 1000).toISOString(),
    elapsedSeconds: elapsed,
  },
  finals, ratioPerSeed, ratioStats, tests,
}, null, 2));
console.log(`\nwrote ${jsonl} (${rows.length} rows)`);
console.log(`wrote ${summaryPath}`);

// ---- self-contained HTML report ---------------------------------------------
if (WANT_HTML) {
  const PANELS = [
    ["reward",           "Reward per trial (primary learning curve)", v => v.toFixed(1), false],
    ["decisionAccuracy", "Decision accuracy vs trial",                v => (v * 100).toFixed(0) + "%", false],
    ["demonAgree",       "Demon agreement vs trial",                  v => (v * 100).toFixed(0) + "%", false],
    ["workJEp",          "Work per episode (J)",                      v => v.toExponential(1), true],
    ["dPfinal",          "Pressure difference ΔP vs trial",           v => v.toFixed(2), false],
    ["pistonX",          "Piston displacement vs trial",              v => v.toFixed(1), false],
    ["spikeRate",        "Motor spike rate vs trial",                 v => v.toFixed(2), false],
    ["dopamineMean",     "Dopamine (mean per trial)",                 v => v.toFixed(2), false],
    ["weightDrift",      "Synaptic weight drift Σ|Δw| vs trial",      v => v.toExponential(1), false],
  ];
  const COLORS = { demon_neural: "#4c72b0", demon_frozen: "#dd8452", demon_speed: "#55a868",
                   demon_random: "#c44e52", never_open: "#8c8c8c" };
  const series = Object.keys(COLORS).filter(v => VARIANTS.includes(v));
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

  const htmlPanels = PANELS.map(([f, label, fmtV, logY]) => {
    // x domain from the neural condition's continuous block index (train→test)
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
    // CI band for the neural condition only (the learning condition)
    const nPts = allPts.filter(s => s[f]);
    let band = "";
    if (nPts.length > 1) {
      const up = nPts.map(s => `${X((s.trialStart + s.trialEnd) / 2).toFixed(1)},${Y(s[f].mean + s[f].ci).toFixed(1)}`);
      const dn = nPts.slice().reverse().map(s => `${X((s.trialStart + s.trialEnd) / 2).toFixed(1)},${Y(s[f].mean - s[f].ci).toFixed(1)}`);
      band = `<path d="M${up.join(" L")} L${dn.join(" L")} Z" fill="${COLORS[series[0]]}22"/>`;
    }
    const lines = series.map(v => {
      const pts = stats.filter(s => s.condition === v && s[f]);
      let dd = "", pen = false;
      for (const s of pts) {
        const x = (s.trialStart + s.trialEnd) / 2, y = s[f].mean;
        dd += `${pen ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)} `; pen = true;
      }
      return dd ? `<path d="${dd}" fill="none" stroke="${COLORS[v]}" stroke-width="1.8"/>` : "";
    }).join("");
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(fr => {
      const yv = logY ? Math.pow(10, Math.log10(ylo) + fr * (Math.log10(yhi) - Math.log10(ylo)))
                      : ylo + fr * (yhi - ylo);
      return `<text x="4" y="${(padT + (1 - fr) * (H - padT - padB) + 3).toFixed(1)}" font-size="9" fill="#6a737d">${fmtV(yv)}</text>`;
    }).join("");
    const xTicks = [0, 0.5, 1].map(fr => {
      const xv = xlo + fr * (xhi - xlo);
      return `<text x="${X(xv).toFixed(1)}" y="${H - 8}" font-size="9" fill="#6a737d" text-anchor="middle">${Math.round(xv)}</text>`;
    }).join("");
    return `<div class="panel"><h3>${esc(label)} <span class="tag">mean line, 95% CI band (neural), n=${SEEDS} seeds</span></h3>` +
      `<svg viewBox="0 0 ${W} ${H}" class="chart">` +
      `<rect x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}" fill="none" stroke="#30363d"/>` +
      (testStart ? `<line x1="${X(testStart.trialStart).toFixed(1)}" y1="${padT}" x2="${X(testStart.trialStart).toFixed(1)}" y2="${H - padB}" stroke="#8b949e" stroke-dasharray="4 4" opacity=".6"/>` +
                   `<text x="${(X(testStart.trialStart) + 4).toFixed(1)}" y="${padT + 10}" font-size="9" fill="#8b949e">TEST (frozen)</text>` +
                   `<text x="${(X(testStart.trialStart) - 4).toFixed(1)}" y="${padT + 10}" font-size="9" fill="#8b949e" text-anchor="end">TRAIN</text>` : "") +
      band + lines + ticks + xTicks + `</svg>` +
      `<div class="legend">${series.map(v => `<span><i style="background:${COLORS[v]}"></i>${v}</span>`).join("")}</div></div>`;
  }).join("");

  const f2 = (v, ph, f, d) => {
    const st = (finals[v] || {})[ph] && (finals[v] || {})[ph][f];
    return st ? st.mean.toFixed(d) + " ± " + st.ci.toFixed(d) + " (n=" + st.n + ")" : "—";
  };
  const fE = (v, ph, f) => {
    const st = (finals[v] || {})[ph] && (finals[v] || {})[ph][f];
    return st ? st.mean.toExponential(2) + " ± " + st.ci.toExponential(2) + " (n=" + st.n + ")" : "—";
  };
  const tableRows = VARIANTS.map(v => `<tr><th>${v}</th>` +
    `<td>${f2(v, "train", "reward", 2)}</td><td>${f2(v, "test", "reward", 2)}</td>` +
    `<td>${f2(v, "train", "decisionAccuracy", 3)}</td><td>${f2(v, "test", "decisionAccuracy", 3)}</td>` +
    `<td>${fE(v, "train", "workJ")}</td><td>${fE(v, "test", "workJ")}</td>` +
    `<td>${f2(v, "test", "demonAgree", 3)}</td></tr>`).join("");
  const ratioHtml = ratioStats
    ? `<table><tr><th>mean</th><th>95% CI</th><th>min</th><th>max</th><th>n</th></tr>` +
      `<tr><td>${ratioStats.mean.toFixed(3)}</td><td>± ${ratioStats.ci.toFixed(3)}</td>` +
      `<td>${ratioStats.min.toFixed(3)}</td><td>${ratioStats.max.toFixed(3)}</td><td>${ratioStats.n}</td></tr></table>` +
      `<p class="note">per-seed ratios: ${ratioPerSeed.map(x => x.toFixed(2)).join(", ")}</p>`
    : `<p class="note">ratio undefined (missing condition or zero classical work).</p>`;
  const testsHtml = tests.length
    ? `<table><tr><th>comparison</th><th>metric</th><th>t</th><th>df</th><th>p (two-sided)</th></tr>` +
      tests.map(w => `<tr><td>${w.comparison}</td><td>${w.metric}</td><td>${w.t.toFixed(2)}</td>` +
                     `<td>${w.df.toFixed(1)}</td><td>${w.p < 1e-4 ? w.p.toExponential(1) : w.p.toFixed(4)}</td></tr>`).join("") +
      `</table><p class="note">Welch's two-sided t test over per-seed final-TEST values; n = ${SEEDS} seeds per condition; df by Welch–Satterthwaite.</p>`
    : `<p class="note">no tests (need demon_neural + a comparison condition).</p>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>E9 Phase-2 batch report</title><style>
    body{background:#0d1117;color:#e6edf3;font:13px/1.5 system-ui;margin:24px}
    h1{font-size:19px} h2{font-size:15px;margin-top:26px} h3{font-size:13px;margin:8px 0 4px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:14px}
    .panel{background:#10161d;border:1px solid #21262d;border-radius:8px;padding:10px}
    .chart{width:100%;height:auto}.tag{font-weight:400;font-size:11px;color:#8b949e}
    .legend span{margin-right:12px;font-size:11px}.legend i{display:inline-block;width:10px;height:10px;margin-right:4px;border-radius:2px}
    table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #30363d;padding:4px 10px;font-size:12px;text-align:right}th{background:#161b22}
    .note{color:#8b949e;font-size:12px;max-width:900px}
  </style></head><body>
  <h1>E9 · Pressure Demon — Phase-2 multi-seed batch report</h1>
  <p class="note">${SEEDS} seeds × ${VARIANTS.length} variants · ${TRAIN}+${TEST} trials × ${EPISODE}s · ${NPART} particles ·
  identical Phase-1 model (no controller changes, no seed selection, no discarded runs).
  The independent replicate for every CI and test is ONE SEED. CI = mean ± 1.96·SEM over seeds.
  Work values are cumulative spring work through the end of the phase. Determinism gate: passed.</p>
  <h2>Final metrics (mean ± 95% CI)</h2>
  <table><tr><th>condition</th><th>final train reward</th><th>final test reward</th>
  <th>final train acc</th><th>final test acc</th><th>final train work (J)</th>
  <th>final test work (J)</th><th>final agreement</th></tr>${tableRows}</table>
  <h2>Learning curves</h2><div class="grid">${htmlPanels}</div>
  <h2>Neural / classical test-work ratio (per-seed distribution)</h2>${ratioHtml}
  <h2>Welch t tests on final TEST metrics</h2>${testsHtml}
  </body></html>`;
  const htmlPath = path.join(__dirname, "research_data", `e9_batch_report_${stamp}.html`);
  fs.writeFileSync(htmlPath, html);
  console.log(`wrote ${htmlPath}`);
}

// ---- C-3 standardized dataset export (CSV + manifest, sha256-pinned) --------
{
  const DX = require("./dataset_export.js");
  const dsRows = rows.map(r => Object.assign({}, r, { experiment: "e9" }));
  const ds = DX.exportRun({
    experiment: "e9",
    label: "E9 Pressure Demon - Phase-2 multi-seed batch validation",
    question: "Does the fly-brain neural valve controller improve over training against the classical reference (pressure-demon apparatus)?",
    protocol: "TRAIN (plasticity ON) -> TEST (frozen); seed = independent replicate; no seeds discarded; credit pairing: " + PAIRING,
    config: { seeds: SEEDS, seedBase: BASE, seedStride: 101, trainTrials: TRAIN,
              testTrials: TEST, episodeSeconds: EPISODE, nParticles: NPART,
              blockB: B, variants: VARIANTS, pairing: PAIRING,
              engine: "experiment_core.js pressureDemonCore (unmodified)" },
    conditions: VARIANTS,
  }, dsRows);
  console.log("dataset: " + ds.csvPath);
  console.log("dataset manifest: " + ds.manifestPath + " (sha256 " + ds.sha256.slice(0, 16) + "...)");
}

}

if (require.main === module) main();

module.exports = { trialStats, welchT, e9BrainFactory, main };
