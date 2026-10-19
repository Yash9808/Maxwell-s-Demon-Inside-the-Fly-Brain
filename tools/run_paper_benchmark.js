#!/usr/bin/env node
/**
 * run_paper_benchmark.js — per-seed benchmark runner for the Nature-style paper.
 *
 * Purpose: identical scientific configuration to `node benchmark.js --quick`
 * (6 conditions, nParticles 320, noise 0.12, doorHeight 64), but runs ONE seed
 * per invocation so long batches survive shell timeouts, and writes a single
 * self-contained JSON per seed that the paper plotting script merges:
 *   node tools/run_paper_benchmark.js --seed 1
 *   node tools/run_paper_benchmark.js --seed 2 --train 30 --test 10 --episode 8
 *
 * No scientific behavior is changed: same runBenchmark, same controllers,
 * same opticDrive 0.25 for connectome conditions as benchmark.js.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { makeRng, runBenchmark } = require("../experiment_core");
const { classicalDemon, randomController, annController,
        drosophilaController, connectomeController } = require("../controllers");

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };

const SEED   = parseInt(flag("seed", "1"), 10);
const TRAIN  = parseInt(flag("train", "40"), 10);
const TEST   = parseInt(flag("test", "10"), 10);
const EP     = parseFloat(flag("episode", "8"));
const NPART  = parseInt(flag("particles", "320"), 10);
const NOISE  = parseFloat(flag("noise", "0.12"));
const DOOR   = parseFloat(flag("door", "64"));

console.log(`loading circuit for seed ${SEED} ...`);
const circuit = require("../fly_brain_circuit.json");
const OPTIC_DRIVE = 0.25;   // sparsest regime where real vs shuffled wiring diverges (see benchmark.js)

const t0 = Date.now();
const result = runBenchmark({
  seed: SEED, nSeeds: 1,
  trialsTrain: TRAIN, trialsTest: TEST,
  episodeSeconds: EP,
  nParticles: NPART, noise: NOISE, doorHeight: DOOR,
  controllers: {
    classical_demon: (rng, env, cfg) => classicalDemon(rng, env, cfg),
    random:          (rng, env, cfg) => randomController(rng, env, cfg),
    ann:             (rng, env, cfg) => annController(rng, env, cfg),
    drosophila:      (rng, env, cfg) => drosophilaController(rng, env, cfg),
    connectome: (rng, env, cfg) => {
      const c = connectomeController(circuit, { shuffle: false, rng, seed: 1, opticDrive: OPTIC_DRIVE });
      c._rng = rng; return c;
    },
    shuffled_connectome: (rng, env, cfg) => {
      const c = connectomeController(circuit, { shuffle: true, rng, seed: 7, opticDrive: OPTIC_DRIVE });
      c._rng = rng; return c;
    },
  },
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log("finished in", elapsed, "s");

const out = { format: "paper-benchmark-v1", seed: SEED,
              config: { trialsTrain: TRAIN, trialsTest: TEST, episodeSeconds: EP,
                        nParticles: NPART, noise: NOISE, doorHeight: DOOR,
                        opticDrive: OPTIC_DRIVE, engine: "experiment_core.js" },
              elapsedSeconds: parseFloat(elapsed), conditions: {}, thermo: {} };

const LANDAUER_BIT_J = 2.871e-21;
for (const [key, cond] of Object.entries(result.conditions)) {
  const { _raw, ...rest } = cond;
  const blocks = [];
  for (const run of _raw) {
    const n = run.trials.length;
    for (let b = 0; b * 10 < n; b++) {
      const seg = run.trials.slice(b * 10, (b + 1) * 10);
      const m = (f) => seg.reduce((a, t) => a + (t[f] || 0), 0) / seg.length;
      blocks.push({ block: b, phase: seg[0].phase, agree: m("demonAgree"),
                    goodBadRatio: m("goodBadRatio"), sortEntropy: m("sortEntropy"),
                    miNeural: m("miNeural"), energyJ: m("energyJ") });
    }
  }
  out.conditions[key] = Object.assign({}, rest, { blocks });
  // thermodynamic budget from the raw test-phase trials of this seed
  const testRows = _raw[0].trials.filter(t => t.phase === "test");
  const mean = f => testRows.reduce((a, t) => a + (t[f] || 0), 0) / Math.max(1, testRows.length);
  const w = mean("workInJ"), x = mean("extractableJ"), l = mean("erasureCostJ");
  out.thermo[key] = {
    workInJ: w, extractableJ: x, erasureCostJ: l,
    efficiency: w > 0 ? x / w : null,
    landauerRatio: l > 0 ? x / l : null,
    bitsNeeded: Number.isFinite(x) ? x / LANDAUER_BIT_J : null,
    bitsUsed: mean("measuredBits"),
  };
}

const outPath = path.join(__dirname, "..", "research_data", `paper_benchmark_seed${SEED}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log("wrote", outPath);
