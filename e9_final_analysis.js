"use strict";
/*
 * E9 Phase 3 — final analysis (Q1–Q6) from sweep artifacts.
 * Reads:  research_data/e9_training_sweep.csv        (aggregate: seed-based mean/sd/se/CI95 per episode)
 *         research_data/e9_training_sweep_summary.json
 * Writes: research_data/e9_training_sweep_analysis.json
 * Prints: human-readable answers to Questions 1–6.
 * Read-only over the sweep outputs; no simulation, no tuning.
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "research_data");
const csvPath = path.join(DIR, "e9_training_sweep.csv");
const sumPath = path.join(DIR, "e9_training_sweep_summary.json");
const outPath = path.join(DIR, "e9_training_sweep_analysis.json");

if (!fs.existsSync(csvPath)) { console.error("missing " + csvPath); process.exit(1); }

// ---- load aggregate CSV -------------------------------------------------------
const lines = fs.readFileSync(csvPath, "utf8").split("\n").filter(Boolean);
const header = lines[0].split(",");
const rows = lines.slice(1).map(l => {
  const cells = l.split(",");
  const r = {};
  header.forEach((h, i) => { r[h] = cells[i]; });
  const num = (k) => { const v = parseFloat(r[k]); return Number.isFinite(v) ? v : null; };
  return {
    config: r.variant, condition: r.condition, regime: r.reward_regime,
    cadence: r.decision_cadence, length: parseInt(r.training_length, 10),
    episode: parseInt(r.episode, 10), phase: r.phase, n: parseInt(r.n_seeds, 10),
    reward: { mean: num("reward_mean"), low: num("reward_ci95_low"), high: num("reward_ci95_high") },
    accuracy: { mean: num("accuracy_mean"), low: num("accuracy_ci95_low"), high: num("accuracy_ci95_high") },
    work: { mean: num("work_mean"), low: num("work_ci95_low"), high: num("work_ci95_high") },
    demonAgree: { mean: num("demon_agree_mean"), low: num("demon_agree_ci95_low"), high: num("demon_agree_ci95_high") },
    dP: { mean: num("delta_p_mean"), low: num("delta_p_ci95_low"), high: num("delta_p_ci95_high") },
    spikeRate: { mean: num("spike_rate_mean"), low: num("spike_rate_ci95_low"), high: num("spike_rate_ci95_high") },
    dopamine: { mean: num("dopamine_mean"), low: num("dopamine_ci95_low"), high: num("dopamine_ci95_high") },
    weightDrift: { mean: num("weight_drift_mean"), low: num("weight_drift_ci95_low"), high: num("weight_drift_ci95_high") },
    decisionBits: { mean: num("decision_bits_mean") },
  };
});

const summary = fs.existsSync(sumPath) ? JSON.parse(fs.readFileSync(sumPath, "utf8")) : null;

// ---- helpers ------------------------------------------------------------------
const keyOf = (r) => `${r.length}|${r.regime}|${r.cadence}`;
const configs = [...new Set(rows.map(keyOf))];

// final TRAIN episode row for a config+condition
function finalRow(cfgKey, cond, phase) {
  const [length, regime, cadence] = cfgKey.split("|").map((v, i) => i === 0 ? parseInt(v, 10) : v);
  const cand = rows.filter(r => r.length === length && r.regime === regime && r.cadence === cadence &&
    r.condition === cond && r.phase === phase);
  if (!cand.length) return null;
  return cand.reduce((a, b) => (b.episode > a.episode ? b : a));
}

// Pearson correlation across configs between two final-train metrics (neural condition)
function corr(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : null;
}

// ---- per-config finals ----------------------------------------------------------
const finals = configs.map(cfgKey => {
  const [length, regime, cadence] = cfgKey.split("|");
  const g = (cond, phase) => finalRow(cfgKey, cond, phase);
  return {
    config: `L${length}_${regime}_${cadence}`, trainingLength: length, rewardRegime: regime, decisionCadence: cadence,
    neuralTrainFinal: g("demon_neural", "train"),
    neuralTestFinal: g("demon_neural", "test"),
    frozenTrainFinal: g("demon_frozen", "train"),
    frozenTestFinal: g("demon_frozen", "test"),
    classicalTrainFinal: g("demon_speed", "train"),
    classicalTestFinal: g("demon_speed", "test"),
  };
});

// criterion check per config (on the TRAIN final of the neural condition)
for (const f of finals) {
  const r = f.neuralTrainFinal && f.neuralTrainFinal.reward;
  f.criterion = !r ? "no_data" : (r.low > 0 ? "criterion_met" : "criterion_not_met");
  f.rewardPositive = !!(r && r.mean > 0);
}

// ---- Q4: reward ↔ physical performance coherence --------------------------------
const nn = finals.filter(f => f.neuralTrainFinal && f.neuralTrainFinal.reward.mean !== null);
const q4 = {
  note: "across configurations, final TRAIN reward vs physical metrics (demon_neural)",
  n: nn.length,
  corr_reward_vs_work: corr(nn.map(f => f.neuralTrainFinal.reward.mean), nn.map(f => f.neuralTrainFinal.work.mean)),
  corr_reward_vs_accuracy: corr(nn.map(f => f.neuralTrainFinal.reward.mean), nn.map(f => f.neuralTrainFinal.accuracy.mean)),
  corr_reward_vs_demonAgree: corr(nn.map(f => f.neuralTrainFinal.reward.mean), nn.map(f => f.neuralTrainFinal.demonAgree.mean)),
  corr_reward_vs_dP: corr(nn.map(f => f.neuralTrainFinal.reward.mean), nn.map(f => f.neuralTrainFinal.dP.mean)),
};

// ---- Q5: neural changes ----------------------------------------------------------
const q5 = {
  note: "final TRAIN episode, demon_neural: is reward-related learning accompanied by neural change?",
  perConfig: nn.map(f => ({
    config: f.config,
    dopamine_mean: f.neuralTrainFinal.dopamine.mean,
    weightDrift_mean: f.neuralTrainFinal.weightDrift.mean,
    spikeRate_mean: f.neuralTrainFinal.spikeRate.mean,
    decisionBits_mean: f.neuralTrainFinal.decisionBits.mean,
  })),
};

// ---- Q6: frozen preservation (train-final vs test-final work, frozen condition) --
const q6 = {
  note: "demon_frozen: test-final work vs train-final work (policy preservation after weight freeze)",
  perConfig: finals.filter(f => f.frozenTrainFinal && f.frozenTestFinal).map(f => ({
    config: f.config,
    trainFinalWork: f.frozenTrainFinal.work.mean,
    testFinalWork: f.frozenTestFinal.work.mean,
    ratio_test_over_train: f.frozenTrainFinal.work.mean > 0 ? f.frozenTestFinal.work.mean / f.frozenTrainFinal.work.mean : null,
    trainFinalAgree: f.frozenTrainFinal.demonAgree.mean,
    testFinalAgree: f.frozenTestFinal.demonAgree.mean,
  })),
};

// ---- assemble report -------------------------------------------------------------
const best = finals.filter(f => f.criterion !== "no_data")
  .sort((a, b) => (b.neuralTrainFinal.reward.low || -1e9) - (a.neuralTrainFinal.reward.low || -1e9))[0] || null;

const anyMet = finals.some(f => f.criterion === "criterion_met");
const verdict = anyMet ? "criterion_met" : "criterion_not_met";

const analysis = {
  experiment: "e9", phase: 3, kind: "training_sweep_final_analysis",
  dateISO: new Date().toISOString(),
  sourceAggregate: path.basename(csvPath),
  summaryProvenance: summary ? summary.provenance : null,
  successCriterion: "final TRAIN episode mean reward CI95_low > 0 for demon_neural",
  verdict,
  anyRewardMeanPositive: finals.some(f => f.rewardPositive),
  configs: finals,
  bestByCILow: best ? { config: best.config, reward: best.neuralTrainFinal.reward, criterion: best.criterion } : null,
  Q1_longerTraining: finals.filter(f => f.rewardRegime === "R0" && f.decisionCadence === "base").map(f => ({
    config: f.config, finalTrainReward: f.neuralTrainFinal && f.neuralTrainFinal.reward, criterion: f.criterion,
  })),
  Q2_rewardRegimes: finals.filter(f => f.rewardRegime !== "R0" && f.decisionCadence === "base").map(f => ({
    config: f.config, finalTrainReward: f.neuralTrainFinal && f.neuralTrainFinal.reward, criterion: f.criterion,
  })),
  Q3_cadences: finals.filter(f => f.decisionCadence !== "base").map(f => ({
    config: f.config, finalTrainReward: f.neuralTrainFinal && f.neuralTrainFinal.reward, criterion: f.criterion,
  })),
  Q4_physicalCoherence: q4,
  Q5_neuralChange: q5,
  Q6_frozenPreservation: q6,
};

fs.writeFileSync(outPath, JSON.stringify(analysis, null, 2));

// ---- human-readable --------------------------------------------------------------
const fmt = (m) => m ? `${m.mean.toFixed(3)} [CI95 ${m.low !== null ? m.low.toFixed(3) : "?"}, ${m.high !== null ? m.high.toFixed(3) : "?"}]` : "n/a";
console.log("=".repeat(72));
console.log("E9 PHASE 3 — FINAL ANALYSIS  (verdict: " + verdict + ")");
console.log("=".repeat(72));
for (const f of finals) {
  console.log(`\n[${f.config}]  criterion: ${f.criterion}${f.rewardPositive ? "  (reward mean > 0)" : ""}`);
  console.log(`  neural train-final reward : ${fmt(f.neuralTrainFinal && f.neuralTrainFinal.reward)}`);
  console.log(`  neural train-final acc    : ${f.neuralTrainFinal ? (f.neuralTrainFinal.accuracy.mean * 100).toFixed(0) + "%" : "n/a"}` +
    `   work: ${f.neuralTrainFinal ? f.neuralTrainFinal.work.mean.toExponential(2) : "n/a"} J` +
    `   agree: ${f.neuralTrainFinal ? (f.neuralTrainFinal.demonAgree.mean * 100).toFixed(0) + "%" : "n/a"}`);
  console.log(`  neural test-final  reward : ${fmt(f.neuralTestFinal && f.neuralTestFinal.reward)}`);
  if (f.classicalTestFinal) {
    const ratio = f.neuralTestFinal && f.classicalTestFinal.work.mean > 0
      ? (f.neuralTestFinal.work.mean / f.classicalTestFinal.work.mean) : null;
    console.log(`  classical test-final work : ${f.classicalTestFinal.work.mean.toExponential(2)} J` +
      `   neural/classical: ${ratio !== null ? (ratio * 100).toFixed(0) + "%" : "n/a"}`);
  }
}
console.log("\nQ4 reward<->physics correlations (across configs, neural train-final):");
console.log(`  work: ${q4.corr_reward_vs_work === null ? "n/a" : q4.corr_reward_vs_work.toFixed(2)}` +
  `  accuracy: ${q4.corr_reward_vs_accuracy === null ? "n/a" : q4.corr_reward_vs_accuracy.toFixed(2)}` +
  `  demonAgree: ${q4.corr_reward_vs_demonAgree === null ? "n/a" : q4.corr_reward_vs_demonAgree.toFixed(2)}` +
  `  dP: ${q4.corr_reward_vs_dP === null ? "n/a" : q4.corr_reward_vs_dP.toFixed(2)}`);
console.log(`\nwrote ${outPath}`);
console.log(anyMet
  ? "\nOVERALL: criterion_met — CI95_low > 0 achieved by " + (best && best.config)
  : "\nOVERALL: criterion_not_met — no tested configuration's final-train reward CI excludes zero.");
