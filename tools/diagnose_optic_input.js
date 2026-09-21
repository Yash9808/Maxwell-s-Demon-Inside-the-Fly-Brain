#!/usr/bin/env node
"use strict";
/**
 * tools/diagnose_optic_input.js — ISSUE 5 controlled A/B (stabilization pass).
 *
 * Question: why did connectome good:bad drop from ~0.95 (P0-era, 8-bin optic
 * input) to 0.00 after Stage F made the 800-column retinotopic interface the
 * benchmark default?
 *
 * Method: run the EXACT benchmark connectome arm under two conditions that
 * differ ONLY in `opticInput` ("legacy8bin" vs "retinotopy"). Circuit, seed
 * rule, physics, episode length, reward, learning rule and evaluation
 * protocol are identical. Neural/behavioral diagnostics are read from the
 * controller's own public accessors (weightDrift / dopamine /
 * layerSpikeRates) at trial end. NO parameter is tuned — causal diagnosis.
 *
 * Usage: node tools/diagnose_optic_input.js [--seeds N] [--train N] [--test N] [--episode S]
 */
const fs = require("fs");
const path = require("path");
const { runBenchmark } = require(path.join(__dirname, "..", "experiment_core"));
const { classicalDemon, connectomeController } =
  require(path.join(__dirname, "..", "controllers"));

const flag = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const N_SEEDS = parseInt(flag("seeds", "3"), 10);
const T_TRAIN = parseInt(flag("train", "40"), 10);
const T_TEST = parseInt(flag("test", "10"), 10);
const EPISODE_S = parseFloat(flag("episode", "8"));
const OPTIC_DRIVE = 0.25;   // unchanged benchmark operating point

const circuit = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "fly_brain_circuit.json"), "utf8"));

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

function runArm(opticInput) {
  const testRows = [];
  const probes = [];
  for (let s = 0; s < N_SEEDS; s++) {
    const seed = 1 + s * 101;                 // benchmark.js seed rule
    let ctrl = null;
    const rows = [];
    runBenchmark({
      seed, nSeeds: 1,
      trialsTrain: T_TRAIN, trialsTest: T_TEST,
      episodeSeconds: EPISODE_S,
      nParticles: 320, noise: 0.12, doorHeight: 64,
      controllers: {
        connectome: (rng, env, cfg) => {
          ctrl = connectomeController(circuit, {
            shuffle: false, rng, seed: 1,
            opticDrive: OPTIC_DRIVE, opticInput,
          });
          ctrl._rng = rng;
          return ctrl;
        },
        classical_demon: (rng, env, cfg) => classicalDemon(rng, env, cfg),
      },
      onTrialData: (key, phase, tr) => {
        if (key !== "connectome") return;
        rows.push(tr);
        if (ctrl) {
          const rates = ctrl.layerSpikeRates();
          probes.push({
            seed, phase,
            opticRate: rates[circuit.layer_names[1]],
            centralRate: rates[circuit.layer_names[3]],
            motorRate: rates[circuit.layer_names[4]],
            da: ctrl.dopamine,
            weightDrift: ctrl.weightDrift(),
            doorTarget: ctrl.lastDoorTargetAvg !== undefined
              ? ctrl.lastDoorTargetAvg : undefined,
          });
        }
      },
    });
    testRows.push(...rows.filter(r => r.phase === "test"));
    console.log(`  [${opticInput}] seed ${s + 1}/${N_SEEDS} done`);
  }

  const gbDefined = testRows.filter(r => r.goodBadRatio !== null && r.goodBadRatio !== undefined);
  const maxDrift = Math.max(...probes.map(p => p.weightDrift), 0);
  return {
    opticInput,
    nSeeds: N_SEEDS, nTestTrials: testRows.length,
    goodBad_defined: gbDefined.length,
    goodBad_mean: mean(gbDefined.map(r => r.goodBadRatio)),
    crossingsPerTrial: mean(testRows.map(r => r.crossings)),
    goodCrossingsPerTrial: mean(testRows.map(r => r.goodCrossings)),
    badCrossingsPerTrial: mean(testRows.map(r => r.badCrossings)),
    openFraction: mean(testRows.map(r => r.openFraction)),
    dTfinal: mean(testRows.map(r => r.dTfinal)),
    demonAgree: mean(testRows.map(r => r.demonAgree)),
    neural: {
      opticRate: mean(probes.filter(p => p.phase === "test").map(p => p.opticRate)),
      centralRate: mean(probes.filter(p => p.phase === "test").map(p => p.centralRate)),
      motorRate: mean(probes.filter(p => p.phase === "test").map(p => p.motorRate)),
      da_post_trial: mean(probes.filter(p => p.phase === "test").map(p => p.da)),
      weightDrift_max: maxDrift,
    },
  };
}

console.log(`A/B: seeds=${N_SEEDS} train=${T_TRAIN} test=${T_TEST} episode=${EPISODE_S}s ` +
  `opticDrive=${OPTIC_DRIVE} — arms differ ONLY in opticInput`);
const legacy = runArm("legacy8bin");
const retino = runArm("retinotopy");

console.log("\n=== A/B summary (test phase) ===");
for (const v of [legacy, retino]) {
  console.log(`\n[${v.opticInput}]`);
  console.log(`  good:bad  mean      : ${v.goodBad_mean?.toFixed(4) ?? "n/a"} (defined in ${v.goodBad_defined}/${v.nTestTrials} test trials)`);
  console.log(`  crossings/trial      : ${v.crossingsPerTrial?.toFixed(3)} (good ${v.goodCrossingsPerTrial?.toFixed(3)} / bad ${v.badCrossingsPerTrial?.toFixed(3)})`);
  console.log(`  openFraction         : ${v.openFraction?.toFixed(4)}`);
  console.log(`  dTfinal              : ${v.dTfinal?.toFixed(4)}`);
  console.log(`  demonAgree (ref)     : ${v.demonAgree?.toFixed(4)}`);
  console.log(`  optic layer rate     : ${v.neural.opticRate?.toFixed(4)}`);
  console.log(`  central layer rate   : ${v.neural.centralRate?.toFixed(4)}`);
  console.log(`  motor layer rate     : ${v.neural.motorRate?.toFixed(4)}`);
  console.log(`  DA.v (post-trial)    : ${v.neural.da_post_trial?.toFixed(4)}`);
  console.log(`  weightDrift (max)    : ${v.neural.weightDrift_max?.toFixed(4)}`);
}

const out = {
  generated_utc: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  purpose: "ISSUE 5 stabilization A/B: retinotopy vs legacy8bin optic input, causal diagnosis",
  config: { N_SEEDS, T_TRAIN, T_TEST, EPISODE_S, OPTIC_DRIVE,
            seed_rule: "seed = 1 + s*101 (benchmark.js rule)",
            optics_differ_only: true },
  arms: { legacy8bin: legacy, retinotopy: retino },
};
const stamp = out.generated_utc.replace(/[:.]/g, "-").slice(0, 19);
const outPath = path.join(__dirname, "..", "research_data", `ab_optic_input_${stamp}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log("\nwrote", path.basename(outPath));
