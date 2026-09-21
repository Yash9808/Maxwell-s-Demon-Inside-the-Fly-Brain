"use strict";
/**
 * validation_worker.js — one campaign job (exp, arms, seed range, shuffle?).
 * Invoked by validation_campaign.js; writes a partial CSV of raw episode rows.
 * Physics and controllers are used bit-for-bit; seed rule matches the cores.
 *
 * argv[2] = JSON: { exp, arms, seedStart, seedEnd, shuffleSeed, out }
 */
"use strict";
const fs = require("fs");
const path = require("path");
const job = JSON.parse(process.argv[2]);
const { makeRng, runBenchmark } = require("./experiment_core.js");
const CTRL = require("./controllers.js");
const circuit = JSON.parse(fs.readFileSync(path.join(__dirname, "fly_brain_circuit.json"), "utf8"));

function e3FrozenWrapper(rng, env, cfg) {
  const c = CTRL.drosophilaController(rng, env, cfg);
  const realSet = c.setLearning ? c.setLearning.bind(c) : null;
  c.setLearning = () => { if (realSet) realSet(false); };
  return c;
}
function brainFactory(sd) {
  return CTRL.connectomeController(circuit, {
    shuffle: false, rng: makeRng(9176 + (sd || 0) * 37), seed: 1,
    opticDrive: 0, motorDrive: 0.6, plasticity: "full",
    eligibility: [{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }],
    policyGradient: true, pgRng: makeRng(424243 + (sd || 0) * 977),
  });
}

const E3_DEFS = {
  drosophila: (rng, env, c) => CTRL.drosophilaController(rng, env, c),
  drosophila_frozen: (rng, env, c) => e3FrozenWrapper(rng, env, c),
  random: (rng, env, c) => CTRL.randomController(rng, env, c),
  classical_demon: (rng, env, c) => CTRL.classicalDemon(rng, env, c),
};
const E4_DEFS = {
  connectome_4A: (rng, env, c) => CTRL.connectomeController(circuit,
    { shuffle: false, rng, seed: 1, opticDrive: 0.25, plasticity: "full" }),
  connectome_4B: (rng, env, c) => CTRL.connectomeController(circuit,
    { shuffle: false, rng, seed: 1, opticDrive: 0.25, plasticity: "restricted" }),
  connectome_frozen: (rng, env, c) => CTRL.connectomeController(circuit,
    { shuffle: false, rng, seed: 1, opticDrive: 0.25, plasticity: "none" }),
};

function rowFromDoorTrial(exp, key, tr, shufSeed) {
  return {
    experiment: exp, condition: key, shuffleSeed: shufSeed === null || shufSeed === undefined ? "" : shufSeed,
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
const CFG = { nParticles: 320, noise: 0.12, doorHeight: 64 };

  if (job.exp === "e4") {
  const defs = {};
  for (const a of job.arms) {
    if (a === "connectome_4C") defs[a] = (rng, env, c) => CTRL.connectomeController(circuit,
      { shuffle: true, rng, seed: job.shuffleSeed, opticDrive: 0.25, plasticity: "full" });
    else defs[a] = E4_DEFS[a];
  }
  const res = runBenchmark({
    seed: job.seedStart, nSeeds: job.seedEnd - job.seedStart + 1,
    trialsTrain: 120, trialsTest: 24, episodeSeconds: 12,
    nParticles: CFG.nParticles, noise: CFG.noise, doorHeight: CFG.doorHeight,
    controllers: defs,
  });
  for (const [key, cond] of Object.entries(res.conditions))
    for (const run of cond._raw)
      for (const tr of run.trials) rows.push(rowFromDoorTrial("E4", key, tr, job.shuffleSeed));
} else if (job.exp === "e3") {
  const defs = {};
  for (const a of job.arms) defs[a] = E3_DEFS[a];
  const res = runBenchmark({
    seed: job.seedStart, nSeeds: job.seedEnd - job.seedStart + 1,
    trialsTrain: 300, trialsTest: 60, episodeSeconds: 12,
    nParticles: CFG.nParticles, noise: CFG.noise, doorHeight: CFG.doorHeight,
    controllers: defs,
  });
  for (const [key, cond] of Object.entries(res.conditions))
    for (const run of cond._raw)
      for (const tr of run.trials) rows.push(rowFromDoorTrial("E3", key, tr, null));
} else {
  // apparatus experiments
  const coreDefs = {
    e9: { core: "pressureDemonCore", cfg: { trials: 24, trainTrials: 12, episodeSeconds: 20, nParticles: 260 } },
    e10: { core: "smoluchowskiCore", cfg: { trials: 20, trainTrials: 10, episodeSeconds: 12, nParticles: 220 } },
    e11: { core: "feynmanRatchetCore", cfg: { trials: 24, trainTrials: 12, episodeSeconds: 24 } },
  };
  const def = coreDefs[job.exp];
  const core = require("./experiment_core.js")[def.core];
  for (let s = job.seedStart; s <= job.seedEnd; s++) {
    const coreRows = [];
    core(Object.assign({}, def.cfg, {
      seed: 1 + (s - 1) * 101, seedTag: s, variants: job.arms,
      brainFactory,
      onTrialData: (cond, phase, r) => coreRows.push(r),
    }));
    rows.push(...coreRows);
  }
}

// ---- write partial CSV
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
console.log("done", job.exp, "seeds", job.seedStart + "-" + job.seedEnd,
  job.shuffleSeed !== undefined ? "shuf" + job.shuffleSeed : "", rows.length, "rows");
