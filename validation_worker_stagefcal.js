"use strict";
/**
 * validation_worker_stagefcal.js — one E4-CAL calibration job.
 *
 * Preregistration: PRE_REGISTRATION_STAGE_F_E4CAL.json (prospective; pinned
 * before any calibration-seed run). Additive companion to validation_worker.js
 * (untouched): runs ONLY the connectome_4A configuration with the two
 * pre-existing connectomeController factory options opticDrive / motorDrive
 * taken from the job. opticInput is hardcoded "retinotopy" (the operating
 * point being calibrated). Trial/episode defaults are identical to the E4
 * worker: 120 train / 24 test, 12 s, 320 particles, noise 0.12, doorHeight 64.
 * The seed rule lives inside experiment_core.runBenchmark and is untouched.
 *
 * --smoke mode (non-registered seed 999, reduced windows, separate output):
 *   node validation_worker_stagefcal.js '<job-json>' --smoke
 *
 * argv[2] = JSON: { opticDrive, motorDrive, seedStart, seedEnd, out }
 */
const fs = require("fs");
const path = require("path");
const job = JSON.parse(process.argv[2]);
const SMOKE = process.argv.includes("--smoke");
const { makeRng, runBenchmark } = require("./experiment_core.js");
const CTRL = require("./controllers.js");
const circuit = JSON.parse(fs.readFileSync(path.join(__dirname, "fly_brain_circuit.json"), "utf8"));

// E4 arm 4A definition, with the two declared knobs threaded. Nothing else
// differs from the E4 connectome_4A arm (rng rule, seed: 1, plasticity).
function armDef(rng, env, c) {
  return CTRL.connectomeController(circuit, {
    shuffle: false, rng, seed: 1,
    opticDrive: job.opticDrive,
    motorDrive: job.motorDrive,
    plasticity: "full",
    opticInput: "retinotopy",
  });
}

function rowFromDoorTrial(tr) {
  return {
    condition: job.cellName || "cal",
    opticDrive: job.opticDrive, motorDrive: job.motorDrive,
    seed: tr.seed, phase: tr.phase, trial: tr.trial,
    goodCrossings: tr.goodCrossings, badCrossings: tr.badCrossings,
    goodBadRatio: tr.goodBadRatio, demonAgree: tr.demonAgree,
    dTfinal: tr.dTfinal, sortEntropy: tr.sortEntropy, spatialH: tr.spatialH,
    openFraction: tr.openFraction, miNeural: tr.miNeural,
    workInJ: tr.workInJ, extractableJ: tr.extractableJ,
    measuredBits: tr.measuredBits, erasureCostJ: tr.erasureCostJ, energyJ: tr.energyJ,
  };
}

const rows = [];
const res = runBenchmark({
  seed: job.seedStart, nSeeds: job.seedEnd - job.seedStart + 1,
  // SMOKE mode is the only place these may differ from the E4 windows
  // (non-registered seed 999, timing calibration; outcomes never inspected).
  trialsTrain: SMOKE ? 4 : 120,
  trialsTest: SMOKE ? 2 : 24,
  episodeSeconds: 12,
  nParticles: 320, noise: 0.12, doorHeight: 64,
  controllers: { cal: armDef },
});
for (const run of res.conditions.cal._raw)
  for (const tr of run.trials) rows.push(rowFromDoorTrial(tr));

// ---- write partial CSV (same escaping as the E4 worker)
function csvEscape(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const cols = Object.keys(rows[0] || { empty: "" });
const lines = [cols.join(",")];
for (const r of rows) lines.push(cols.map(c => csvEscape(r[c])).join(","));
fs.writeFileSync(job.out, lines.join("\n") + "\n");
console.log("done e4cal od" + job.opticDrive, "md" + job.motorDrive,
  "seeds", job.seedStart + "-" + job.seedEnd,
  SMOKE ? "SMOKE" : "", rows.length, "rows");
