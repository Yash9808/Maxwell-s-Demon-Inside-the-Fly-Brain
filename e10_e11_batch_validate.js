"use strict";
/**
 * e10_e11_batch_validate.js — multi-seed validation for the repaired E10
 * (Smoluchowski trapdoor) and E11 (Feynman ratchet) closed loops, following
 * the e9_batch_validate methodology: SEEDS independent brains (independent
 * connectome draw + gas), per-seed TRAIN vs TEST phase aggregation (episodes
 * are NOT treated as replicates), cross-seed mean + 95% CI.
 *
 * Primary question: does the fly-brain controller improve across training?
 *   E10: test-phase transport (sorted crossings) & reward vs train-phase.
 *   E11: test-phase signed work vs train-phase (equilibrium bath: the honest
 *        learning target is the reward itself, not work extraction — see the
 *        second-law audit in e10_e11_learning_test.js E11-Q).
 *
 * Run: node e10_e11_batch_validate.js [--seeds 20] [--no-determinism]
 *
 * C-8: import-safe main() guard, --seeds CLI, built-in determinism gate
 * (same seed -> identical E10+E11 trajectories), and a single-pass C-3
 * dataset export (the analysis pass IS the export pass — no re-simulation;
 * the 4x-reduced frozen-control rows stay analysis-only).
 */
const { smoluchowskiCore, feynmanRatchetCore, makeRng } = require("./experiment_core.js");
const { connectomeController } = require("./controllers.js");
const circuit = require("./fly_brain_circuit.json");

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const hasFlag = (name) => args.includes("--" + name);
const SEEDS = parseInt(argVal("seeds", String(process.argv[2] || 20)), 10) || 20;
const NO_DETERMINISM = hasFlag("no-determinism");
const EP = 12;               // episode seconds (matches the causal tests)
const TR = 24, TT = 8;      // 24 train + 8 test episodes per seed — event-
                            // locked decisions are ~3x sparser than the old
                            // blind-clock regime, so 24 train episodes give
                            // the policy a comparable graded-decision count
                            // per training run (measured: 10-episode training
                            // produced a consistently positive but CI-wide
                            // delta, +0.056 ± 0.142)

function brainFactoryFor(seed) {
  return () => connectomeController(circuit, {
    shuffle: false, rng: makeRng(1000 + seed), seed: 1, opticDrive: 0,
    motorDrive: 0.6, plasticity: "full",
    eligibility: [{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }],
    policyGradient: true, pgBaseline: true, pgKc: true,
    pgRng: makeRng(500000 + seed),
  });
}
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
function ci95(a) {
  if (a.length < 2) return 0;
  const m = mean(a), sd = Math.sqrt(mean(a.map(v => (v - m) * (v - m))));
  return 1.96 * sd / Math.sqrt(a.length);
}
// per-seed TRAIN vs TEST aggregation of one core run
function phases(rows, fields) {
  const out = {};
  for (const f of fields) {
    const tr = rows.filter(r => r.phase === "train").map(r => r[f]);
    const te = rows.filter(r => r.phase === "test").map(r => r[f]);
    out[f] = { train: mean(tr), test: mean(te) };
  }
  return out;
}

// ---- main -------------------------------------------------------------------
function main() {
const dsRows = [];   // C-3 dataset rows, single-pass: the analysis pass IS the export pass

console.log("=== E10 · Smoluchowski trapdoor (n=" + SEEDS + " seeds, " +
            TR + " train + " + TT + " test eps of " + EP + " s) ===");
{
  const seeds = [];
  for (let s = 1; s <= SEEDS; s++) {
    const rows = [];
    smoluchowskiCore({
      seed: s, seedTag: s, trials: TR + TT, trainTrials: TR, episodeSeconds: EP,
      nParticles: 220, brainFactory: brainFactoryFor(s),
      onTrialData: (c, p, r) => {
        if (c === "trapdoor_neural") rows.push(r);
        dsRows.push(Object.assign({}, r, { experiment: "e10" }));
      },
    });
    // per-seed learning delta: test minus train on each metric
    const ph = phases(rows, ["reward", "rewardWork", "rewardSelection",
                             "crossLR", "crossRL", "decisionAccuracy",
                             "demonAgree", "weightDrift", "pgReleaseP"]);
    ph.deltaReward = ph.reward.test - ph.reward.train;
    ph.deltaAcc = ph.decisionAccuracy.test - ph.decisionAccuracy.train;
    ph.deltaTransport = (ph.crossLR.test - ph.crossRL.test) -
                        (ph.crossLR.train - ph.crossRL.train);
    ph.drift = Math.max(...rows.map(r => r.weightDrift));
    seeds.push(ph);
    process.stdout.write("  seed " + s + ": dReward " + ph.deltaReward.toFixed(2) +
      "  dAcc " + ph.deltaAcc.toFixed(3) + "  dTransport " + ph.deltaTransport.toFixed(2) + "\n");
  }
  const d = {};
  for (const k of ["deltaReward", "deltaAcc", "deltaTransport"]) d[k] = seeds.map(x => x[k]);
  const nPos = seeds.filter(x => x.deltaReward > 0).length;
  console.log("-- per-seed learning deltas (TEST - TRAIN), mean + 95% CI --");
  console.log("  reward      : " + mean(d.deltaReward).toFixed(3) + " ± " + ci95(d.deltaReward).toFixed(3) +
              "   improved " + nPos + "/" + SEEDS + " seeds");
  console.log("  accuracy    : " + mean(d.deltaAcc).toFixed(4) + " ± " + ci95(d.deltaAcc).toFixed(4) +
              "   improved " + seeds.filter(x => x.deltaAcc > 0).length + "/" + SEEDS);
  console.log("  netTransport: " + mean(d.deltaTransport).toFixed(2) + " ± " + ci95(d.deltaTransport).toFixed(2) +
              "   improved " + seeds.filter(x => x.deltaTransport > 0).length + "/" + SEEDS);
  const frozen = [];
  for (let s = 1; s <= SEEDS; s += 4) {   // 5-seed exposure control
    const rows = [];
    smoluchowskiCore({
      seed: s, seedTag: s, trials: TR + TT, trainTrials: 0, episodeSeconds: EP,
      nParticles: 220, variants: ["trapdoor_frozen"], brainFactory: brainFactoryFor(s),
      onTrialData: (c, p, r) => frozen.push(r),
    });
  }
  const fr = mean(frozen.map(r => r.reward)), frAcc = mean(frozen.map(r => r.reward > 0 ? 1 : 0));
  const trAll = seeds.map(x => x.reward.train), teAll = seeds.map(x => x.reward.test);
  console.log("  frozen control reward : " + fr.toFixed(2) + " ± " + ci95(frozen.map(r => r.reward)).toFixed(2) +
              "  (frozen TEST mean acc-proxy " + frAcc.toFixed(2) + ")");
  console.log("  neural TRAIN reward   : " + mean(trAll).toFixed(2) + " ± " + ci95(trAll).toFixed(2));
  console.log("  neural TEST  reward   : " + mean(teAll).toFixed(2) + " ± " + ci95(teAll).toFixed(2));
}

console.log("\n=== E11 · Feynman ratchet (n=" + SEEDS + " seeds, " +
            TR + " train + " + TT + " test eps of " + EP + " s) ===");
{
  const seeds = [];
  for (let s = 1; s <= SEEDS; s++) {
    const rows = [];
    feynmanRatchetCore({
      seed: s, seedTag: s, trials: TR + TT, trainTrials: TR, episodeSeconds: EP,
      brainFactory: brainFactoryFor(s),
      onTrialData: (c, p, r) => {
        if (c === "ratchet_neural") rows.push(r);
        dsRows.push(Object.assign({}, r, { experiment: "e11" }));
      },
    });
    const ph = phases(rows, ["reward", "rewardWork", "rewardSelection",
                             "netPerEpisode", "workJEp", "heatJ",
                             "entropyProduction", "decisionAccuracy",
                             "demonAgree", "weightDrift", "pgReleaseP", "liftFraction"]);
    ph.deltaReward = ph.reward.test - ph.reward.train;
    ph.deltaAcc = ph.decisionAccuracy.test - ph.decisionAccuracy.train;
    ph.drift = Math.max(...rows.map(r => r.weightDrift));
    ph.workTest = mean(rows.filter(r => r.phase === "test").map(r => r.workJEp));
    ph.heatTest = mean(rows.filter(r => r.phase === "test").map(r => r.heatJ));
    ph.entTest = mean(rows.filter(r => r.phase === "test").map(r => r.entropyProduction));
    seeds.push(ph);
    process.stdout.write("  seed " + s + ": dReward " + ph.deltaReward.toFixed(2) +
      "  dAcc " + ph.deltaAcc.toFixed(3) + "  workTest " + ph.workTest.toExponential(1) + " J\n");
  }
  const d = {};
  for (const k of ["deltaReward", "deltaAcc"]) d[k] = seeds.map(x => x[k]);
  console.log("-- per-seed learning deltas (TEST - TRAIN), mean + 95% CI --");
  console.log("  reward  : " + mean(d.deltaReward).toFixed(3) + " ± " + ci95(d.deltaReward).toFixed(3) +
              "   improved " + seeds.filter(x => x.deltaReward > 0).length + "/" + SEEDS + " seeds");
  console.log("  accuracy: " + mean(d.deltaAcc).toFixed(4) + " ± " + ci95(d.deltaAcc).toFixed(4) +
              "   improved " + seeds.filter(x => x.deltaAcc > 0).length + "/" + SEEDS);
  console.log("  weightDrift (end of train): " + mean(seeds.map(x => x.drift)).toFixed(2) +
              " ± " + ci95(seeds.map(x => x.drift)).toFixed(2));
  const trR = seeds.map(x => x.reward.train), teR = seeds.map(x => x.reward.test);
  console.log("  neural TRAIN reward   : " + mean(trR).toFixed(2) + " ± " + ci95(trR).toFixed(2));
  console.log("  neural TEST  reward   : " + mean(teR).toFixed(2) + " ± " + ci95(teR).toFixed(2) +
              "   (learning contrast vs frozen below)");
  console.log("  test-phase signed work/ep : " +
              (mean(seeds.map(x => x.workTest)) * 1e21).toFixed(3) + "e-21 J ± " +
              (ci95(seeds.map(x => x.workTest)) * 1e21).toFixed(3) + "e-21 J  " +
              "(>0 would violate the second law)");
  console.log("  test-phase heat/ep        : " +
              (mean(seeds.map(x => x.heatTest)) * 1e21).toFixed(1) + "e-21 J");
  console.log("  test-phase entropy prod/ep: " + mean(seeds.map(x => x.entTest)).toFixed(4) +
              "  (>= 0 at equilibrium)");
  const frozen = [];
  for (let s = 1; s <= SEEDS; s += 4) {
    const rows = [];
    feynmanRatchetCore({
      seed: s, seedTag: s, trials: TR + TT, trainTrials: 0, episodeSeconds: EP,
      variants: ["ratchet_frozen"], brainFactory: brainFactoryFor(s),
      onTrialData: (c, p, r) => frozen.push(r),
    });
  }
  console.log("  frozen control reward : " + mean(frozen.map(r => r.reward)).toFixed(2) +
              " ± " + ci95(frozen.map(r => r.reward)).toFixed(2));
}
// ---- determinism gate: same seed -> identical E10+E11 trajectories ----------
// Mirrors the production call structure for seed 1 (default-variant E10 +
// E11 cores; the 4x-reduced frozen-control loops are analysis-only and are
// not part of the exported rows).
if (!NO_DETERMINISM) {
  const flat = [];
  const snap = (c, p, r) => flat.push(Object.assign({}, r, { condition: c, phase: p }));
  smoluchowskiCore({
    seed: 1, seedTag: 1, trials: TR + TT, trainTrials: TR, episodeSeconds: EP,
    nParticles: 220, brainFactory: brainFactoryFor(1), onTrialData: snap,
  });
  feynmanRatchetCore({
    seed: 1, seedTag: 1, trials: TR + TT, trainTrials: TR, episodeSeconds: EP,
    brainFactory: brainFactoryFor(1), onTrialData: snap,
  });
  const FIELDS = ["reward", "decisionAccuracy", "demonAgree", "weightDrift",
                  "pgReleaseP", "workJEp", "heatJ", "crossLR", "crossRL",
                  "entropyProduction"];
  const key = (r) => r.condition + "|" + r.phase + "|" + r.trial;
  const A = new Map(dsRows.filter(r => r.seed === 1).map(r => [key(r), r]));
  const Bm = new Map(flat.map(r => [key(r), r]));
  let same = A.size > 0 && A.size === Bm.size;
  for (const [k, ra] of A) {
    if (!same) break;
    const rb = Bm.get(k);
    if (!rb) { same = false; break; }
    for (const f of FIELDS)
      if (Math.abs((ra[f] || 0) - (rb[f] || 0)) > 1e-12) { same = false; break; }
  }
  console.log("\nreproducibility: same seed -> " +
              (same ? "IDENTICAL trajectories (E10+E11)" : "DIVERGENT (BUG)"));
  if (!same) { console.error("reproducibility gate FAILED"); process.exit(1); }
}

// ---- C-3 standardized dataset export (CSV + manifest, sha256-pinned) --------
// Single-pass: dsRows were collected during the analysis loops above (every
// variant row of both cores, tagged e10/e11); no re-simulation is performed.
{
  const DX = require("./dataset_export.js");
  const ds = DX.exportRun({
    experiment: "e10_e11",
    label: "E10 Smoluchowski trapdoor + E11 Feynman ratchet - multi-seed batch",
    question: "Does the fly-brain controller improve across training on the trapdoor/ratchet apparatus loops (with second-law audit)?",
    protocol: "TRAIN (plasticity ON) -> TEST (frozen); 4x-reduced frozen control seeds (analysis-only, not exported); seed = independent replicate",
    config: { seeds: SEEDS, trainTrials: TR, testTrials: TT, episodeSeconds: EP,
              nParticles: 220, e10_variants: ["trapdoor_neural", "trapdoor_frozen"],
              e11_variants: ["ratchet_neural", "ratchet_frozen"],
              engine: "experiment_core.js smoluchowskiCore/feynmanRatchetCore (unmodified)" },
    conditions: [...new Set(dsRows.map(r => r.condition))],
  }, dsRows);
  console.log("dataset: " + ds.csvPath);
  console.log("dataset manifest: " + ds.manifestPath + " (sha256 " + ds.sha256.slice(0, 16) + "...)");
}
console.log("\n(done)");
}

if (require.main === module) main();

module.exports = { main, brainFactoryFor, phases, ci95, mean };
