/**
 * benchmark.js — CLI: runs the seeded multi-controller benchmark and writes
 * JSONL (per-trial) + JSON (per-run summaries) into research_data/.
 *
 * Usage:
 *   node benchmark.js --quick          2 seeds x 40/10 trials, 8 s episodes (smoke)
 *   node benchmark.js                  study default: 5 seeds x 300/60, 12 s episodes (~1 h)
 *   node benchmark.js --full           PDF spec: 10 seeds x 1000/200, 60 s episodes (~days)
 *   node benchmark.js --light          connectome only on 1 seed (perf)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { makeRng, runBenchmark, meanCI } = require("./experiment_core");
const { classicalDemon, demonDecisionFor, randomController,
        annController, drosophilaController, connectomeController } = require("./controllers");

// ---- argv
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const has = (name) => args.includes("--" + name);
const QUICK = has("quick");
const FULL = has("full");
const N_SEEDS = parseInt(flag("seeds", QUICK ? "2" : FULL ? "10" : "5"), 10);
const T_TRAIN = parseInt(flag("train", QUICK ? "40" : FULL ? "1000" : "300"), 10);
const T_TEST = parseInt(flag("test", QUICK ? "10" : FULL ? "200" : "60"), 10);
const EPISODE_S = parseFloat(flag("episode", QUICK ? "8" : FULL ? "60" : "12"));
const LIGHT = has("light");
const PROGRESS_EVERY = 25;   // trials between progress lines

// ---- load the connectome circuit (31 MB JSON; parse once, reuse) -------
function loadCircuit() {
  const p = path.join(__dirname, "fly_brain_circuit.json");
  console.log("loading", p, "...");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function buildControllers(circuit) {
  const list = {
    classical_demon: (rng, env, cfg) => classicalDemon(rng, env, cfg),
    random: (rng, env, cfg) => randomController(rng, env, cfg),
    ann: (rng, env, cfg) => annController(rng, env, cfg),
    drosophila: (rng, env, cfg) => drosophilaController(rng, env, cfg),
  };
  if (!LIGHT) {
    // opticDrive 0.25: sparsest sensory regime where real-vs-shuffled wiring
    // diverges behaviorally (verified by sweep) — aggregate drive at 1.0
    // saturates the motor layer and makes topology irrelevant.
    const OPTIC_DRIVE = 0.25;
    list.connectome = (rng, env, cfg) => {
      const c = connectomeController(circuit, { shuffle: false, rng, seed: 1,
                                                opticDrive: OPTIC_DRIVE });
      c._rng = rng; return c;
    };
    list.shuffled_connectome = (rng, env, cfg) => {
      const c = connectomeController(circuit, { shuffle: true, rng, seed: 7,
                                                opticDrive: OPTIC_DRIVE });
      c._rng = rng; return c;
    };
  }
  return list;
}

// ---- run ---------------------------------------------------------------
const circuit = LIGHT ? null : loadCircuit();
console.log(`benchmark: seeds=${N_SEEDS} train=${T_TRAIN} test=${T_TEST} episode=${EPISODE_S}s light=${LIGHT}`);

const t0 = Date.now();
const result = runBenchmark({
  seed: 1, nSeeds: N_SEEDS,
  trialsTrain: T_TRAIN, trialsTest: T_TEST,
  episodeSeconds: EPISODE_S,
  nParticles: 320, noise: 0.12, doorHeight: 64,
  controllers: buildControllers(circuit || {}),
  onTrial: (cond, phase, t, n, si, sn) => {
    if (t % PROGRESS_EVERY === 0)
      console.log(`  [${cond}] seed ${si + 1}/${sn} ${phase} trial ${t + 1}/${n}`);
  },
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log("simulation finished in", elapsed, "s");

// ---- persist ------------------------------------------------------------
const outDir = path.join(__dirname, "research_data");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const jsonlPath = path.join(outDir, `trials_${stamp}.jsonl`);
const lines = [];
for (const [key, cond] of Object.entries(result.conditions)) {
  for (const run of cond._raw) {
    for (const tr of run.trials) {
      lines.push(JSON.stringify(Object.assign({ condition: key }, tr)));
    }
  }
}
fs.writeFileSync(jsonlPath, lines.join("\n") + "\n");

const summary = { generated: stamp, elapsedSeconds: parseFloat(elapsed), conditions: {} };
for (const [key, cond] of Object.entries(result.conditions)) {
  const { _raw, ...rest } = cond;
  // per-trial aggregate for figures: mean demonAgree per 10-trial block
  const blocks = [];
  for (const run of _raw) {
    const n = run.trials.length;
    const bCount = Math.floor(n / 10);
    for (let b = 0; b < bCount; b++) {
      const seg = run.trials.slice(b * 10, (b + 1) * 10);
      const agree = seg.reduce((a, t) => a + (t.demonAgree || 0), 0) / seg.length;
      const gb = seg.reduce((a, t) => a + (t.goodBadRatio || 0), 0) / seg.length;
      const ent = seg.reduce((a, t) => a + (t.sortEntropy || 0), 0) / seg.length;
      const mi = seg.reduce((a, t) => a + (t.miNeural || 0), 0) / seg.length;
      const energy = seg.reduce((a, t) => a + (t.energyJ || 0), 0) / seg.length;
      blocks.push({ block: b, phase: seg[0].phase, agree, goodBadRatio: gb,
                    sortEntropy: ent, miNeural: mi, energyJ: energy });
    }
  }
  summary.conditions[key] = Object.assign({}, rest, { blocks });
}
const summaryPath = path.join(outDir, `summary_${stamp}.json`);
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log("wrote", jsonlPath, `(${lines.length} trials)`);
console.log("wrote", summaryPath);
console.log("\n=== headline results (test phase, mean ± 95% CI) ===");
for (const [key, cond] of Object.entries(summary.conditions)) {
  const a = cond.testAgreement || { mean: 0, ci: 0 };
  const se = cond.testSortEntropy || { mean: 0, ci: 0 };
  console.log(
    key.padEnd(22),
    "demonAgree", a.mean.toFixed(3), "±", a.ci.toFixed(3),
    "| sortEntropy", se.mean.toFixed(4), "±", se.ci.toFixed(4),
    "| good:bad", (cond.testGoodBadRatio || { mean: 0 }).mean.toFixed(2)
  );
}

// ---- thermodynamic budget (test phase, per-trial means) ----------------
const fmtJ = (x) => {
  if (!Number.isFinite(x)) return "n/a";
  if (x === 0) return "0 J";
  return x.toExponential(2) + " J";
};
const LANDAUER_BIT_J = 2.871e-21;   // k_B*300K*ln2, for the needed-bits column
console.log("\n=== thermodynamic budget (test phase, per trial) ===");
console.log(
  "condition".padEnd(22),
  "work_in".padStart(12),
  "extractable".padStart(12),
  "efficiency".padStart(11),
  "landauer_cost".padStart(14),
  "ext/cost".padStart(10),
  "bits_need".padStart(10),
  "bits_used".padStart(10)
);
for (const [key, cond] of Object.entries(summary.conditions)) {
  const w = (cond.testWorkInJ || { mean: NaN }).mean;
  const x = (cond.testExtractableJ || { mean: NaN }).mean;
  const l = (cond.testErasureCostJ || { mean: NaN }).mean;
  const b = (cond.testMeasuredBits || { mean: 0 }).mean;
  const eff = Number.isFinite(w) && w > 0 ? x / w : NaN;
  const bitsNeed = Number.isFinite(x) ? x / LANDAUER_BIT_J : NaN;
  console.log(
    key.padEnd(22),
    fmtJ(w).padStart(12),
    fmtJ(x).padStart(12),
    Number.isFinite(eff) ? eff.toExponential(1).padStart(11) : "n/a".padStart(11),
    fmtJ(l).padStart(14),
    (Number.isFinite(x) && l > 0 ? (x / l).toExponential(1) : "n/a").padStart(10),
    (Number.isFinite(bitsNeed) ? Math.round(bitsNeed).toLocaleString("en-US") : "n/a").padStart(10),
    Math.round(b).toLocaleString("en-US").padStart(10)
  );
}
console.log("\nReading the budget:\n" +
  "  efficiency = extractable / work_in — the sorted state's free energy comes\n" +
  "  from the heat jet's external work, so the second law is bounded by this\n" +
  "  ratio (<< 1 here), not by the Landauer column.\n" +
  "  bits_need = extractable work priced in Landauer bits at 300 K — the memory\n" +
  "  traffic a demon would need to write per trial for its erasure bill to match\n" +
  "  the work it gains. bits_used = decision flips + feedback bits actually\n" +
  "  metered. bits_used << bits_need means this demon barely memorizes: its\n" +
  "  erasure cost is negligible and its sorting is jet-subsidized, not\n" +
  "  information-driven. That is the honest thermodynamic budget, not a\n" +
  "  second-law violation.");
