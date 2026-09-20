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
 * Run: node e10_e11_batch_validate.js [seeds=20]
 */
const { smoluchowskiCore, feynmanRatchetCore, makeRng } = require("./experiment_core.js");
const { connectomeController } = require("./controllers.js");
const circuit = require("./fly_brain_circuit.json");

const SEEDS = Number(process.argv[2]) || 20;
const EP = 12;               // episode seconds (matches the causal tests)
const TR = 10, TT = 10;      // 10 train + 10 test episodes per seed

function brainFactoryFor(seed) {
  return () => connectomeController(circuit, {
    shuffle: false, rng: makeRng(1000 + seed), seed: 1, opticDrive: 0,
    motorDrive: 0.6, plasticity: "full",
    eligibility: [{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }],
    policyGradient: true, pgRng: makeRng(500000 + seed),
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

console.log("=== E10 · Smoluchowski trapdoor (n=" + SEEDS + " seeds, " +
            TR + " train + " + TT + " test eps of " + EP + " s) ===");
{
  const seeds = [];
  for (let s = 1; s <= SEEDS; s++) {
    const rows = [];
    smoluchowskiCore({
      seed: s, seedTag: s, trials: TR + TT, trainTrials: TR, episodeSeconds: EP,
      nParticles: 220, brainFactory: brainFactoryFor(s),
      onTrialData: (c, p, r) => { if (c === "trapdoor_neural") rows.push(r); },
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
      onTrialData: (c, p, r) => { if (c === "ratchet_neural") rows.push(r); },
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
console.log("\n(done)");
