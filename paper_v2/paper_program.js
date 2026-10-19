#!/usr/bin/env node
/**
 * paper_program.js — headless runner for the paper program E1–E11.
 *
 * Executes the manifest-defined experiments (experiments/e*.json) through the
 * SAME engines used by every prior validated campaign:
 *   E1–E8  : experiment_core.runBenchmark (door task)
 *   E9     : experiment_core.pressureDemonCore
 *   E10    : experiment_core.smoluchowskiCore
 *   E11    : experiment_core.feynmanRatchetCore
 *
 * Usage:
 *   node paper_v2/paper_program.js --door                 # E1–E8 (door task)
 *   node paper_v2/paper_program.js --e9                   # E9 (10 seeds)
 *   node paper_v2/paper_program.js --e10 --e11            # E10 + E11 (10 seeds)
 *   node paper_v2/paper_program.js --e9 --seeds 4         # fewer seeds (smoke)
 *
 * Seeds follow the preregistered rule: door seed = base + seedIdx*101 with
 * base 1 (seedIdx = 0..n-1); apparatus seedTag = 1..n with core seed
 * 1 + (s-1)*101 (matching validation_worker.js / e9_batch_validate.js).
 *
 * Raw outputs: paper_v2/raw/E<k>_rows.jsonl (one JSON object per trial) and
 * paper_v2/raw/E<k>_meta.json (provenance + per-condition summary).
 * NOTHING is filtered or discarded: all runs, all seeds.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const { makeRng, runBenchmark, pressureDemonCore, smoluchowskiCore, feynmanRatchetCore } = require(ROOT + "/experiment_core.js");
const CTRL = require(ROOT + "/controllers.js");

const args = process.argv.slice(2);
const has = f => args.includes("--" + f);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const OUT = path.join(__dirname, "raw");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// ---- shared --------------------------------------------------------------
function loadCircuit() {
  const p = path.join(ROOT, "fly_brain_circuit.json");
  console.log("[program] loading circuit", p);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeMeta(id, prov, conditionsSummary) {
  fs.writeFileSync(path.join(OUT, id + "_meta.json"),
    JSON.stringify({ id, provenance: prov, conditions: conditionsSummary }, null, 1));
}

// ---- E1–E8: door task via runBenchmark -------------------------------------
const DOOR_CFG = { nParticles: 320, noise: 0.12, doorHeight: 64, episode: 12 };

// E3 frozen wrapper (same as validation_worker.js): never allow setLearning(true)
function e3FrozenWrapper(rng, env, cfg) {
  const c = CTRL.drosophilaController(rng, env, cfg);
  const realSet = c.setLearning ? c.setLearning.bind(c) : null;
  c.setLearning = () => { if (realSet) realSet(false); };
  return c;
}

const DOOR_EXPS = {
  e1: { train: 60, test: 12, seeds: 2,
        controllers: () => ({ classical_demon: (rng, env, c) => CTRL.classicalDemon(rng, env, c) }) },
  e2: { train: 60, test: 12, seeds: 2,
        controllers: () => ({ ann: (rng, env, c) => CTRL.annController(rng, env, c),
                              random: (rng, env, c) => CTRL.randomController(rng, env, c) }) },
  e3: { train: 60, test: 12, seeds: 2,
        controllers: () => ({ drosophila: (rng, env, c) => CTRL.drosophilaController(rng, env, c),
                              drosophila_frozen: e3FrozenWrapper }) },
  e4: { train: 40, test: 10, seeds: 2, needsCircuit: true,
        controllers: () => ({
          connectome_4A: (rng, env, c) => CTRL.connectomeController(circuit,
            { shuffle: false, rng, seed: 1, opticDrive: 0.25, plasticity: "full" }),
          connectome_4B: (rng, env, c) => CTRL.connectomeController(circuit,
            { shuffle: false, rng, seed: 1, opticDrive: 0.25, plasticity: "restricted" }),
          connectome_4C: (rng, env, c) => CTRL.connectomeController(circuit,
            { shuffle: true, rng, seed: 7, opticDrive: 0.25, plasticity: "full" }),
        }) },
  e5: { train: 40, test: 10, seeds: 2, needsCircuit: true,
        controllers: () => ({
          classical_demon: (rng, env, c) => CTRL.classicalDemon(rng, env, c),
          ann: (rng, env, c) => CTRL.annController(rng, env, c),
          drosophila: (rng, env, c) => CTRL.drosophilaController(rng, env, c),
          connectome: (rng, env, c) => CTRL.connectomeController(circuit,
            { shuffle: false, rng, seed: 1, opticDrive: 0.25, plasticity: "full" }),
          shuffled_connectome: (rng, env, c) => CTRL.connectomeController(circuit,
            { shuffle: true, rng, seed: 7, opticDrive: 0.25, physicsdrive_unused: undefined, plasticity: "full" }),
        }) },
  e6: { train: 60, test: 12, seeds: 2,
        controllers: () => ({ classical_demon: (rng, env, c) => CTRL.classicalDemon(rng, env, c),
                              random: (rng, env, c) => CTRL.randomController(rng, env, c),
                              never_gate: (rng, env, c) => CTRL.neverGateController(rng, env, c) }) },
  e7: { train: 50, test: 10, seeds: 3,
        physics: (seedIdx) => seedIdx === 1 ? { nParticles: 120, noise: 0.0 }
                              : seedIdx === 2 ? { nParticles: 640, noise: 0.30 }
                              : { nParticles: 320, noise: 0.12 },
        controllers: () => ({ classical_demon: (rng, env, c) => CTRL.classicalDemon(rng, env, c) }) },
  e8: { train: 60, test: 12, seeds: 2,
        controllers: () => ({ demon_adaptive: (rng, env, c) => CTRL.classicalDemon(rng, env, c, { adaptive: true }),
                              demon_fixed: (rng, env, c) => CTRL.classicalDemon(rng, env, c, { adaptive: false }),
                              demon_mem4: (rng, env, c) => CTRL.classicalDemon(rng, env, c, { memSize: 4 }) }) },
};

function runDoor(id) {
  const spec = DOOR_EXPS[id];
  const t0 = Date.now();
  // chunking: --seedbase B --seeds N runs seedIdx B..B+N-1 (seed = 1 + idx*101)
  // and appends to E<k>_rows_s<B>.jsonl so long connectome runs are resumable.
  const seedBase = parseInt(flag("seedbase", "0"), 10);
  const nSeedsArg = flag("seeds", null);
  const seeds = nSeedsArg !== null ? parseInt(nSeedsArg, 10) : spec.seeds;
  const rowPath = nSeedsArg !== null
    ? path.join(OUT, id.toUpperCase() + "_rows_s" + seedBase + ".jsonl")
    : path.join(OUT, id.toUpperCase() + "_rows.jsonl");
  const controllers = spec.controllers();
  const res = runBenchmark({
    seed: 1 + seedBase * 101, nSeeds: seeds,
    trialsTrain: spec.train, trialsTest: spec.test,
    episodeSeconds: DOOR_CFG.episode,
    nParticles: DOOR_CFG.nParticles, noise: DOOR_CFG.noise, doorHeight: DOOR_CFG.doorHeight,
    _physics: spec.physics || null,
    circuit,
    controllers,
    onTrial: (cond, phase, t, n, si, sn) => {
      if (t % 25 === 0) console.log(`  [${id}] ${cond} seed ${si + 1}/${sn} ${phase} ${t + 1}/${n}`);
    },
  });
  const elapsed = (Date.now() - t0) / 1000;
  // ---- persist rows (append-safe; stream end then meta per chunk)
  let n = 0;
  const stream = fs.createWriteStream(rowPath, { flags: "a" });
  const conditionsSummary = {};
  for (const [key, cond] of Object.entries(res.conditions)) {
    const { _raw, ...rest } = cond;
    conditionsSummary[key] = rest;
    for (const run of _raw)
      for (const tr of run.trials) { stream.write(JSON.stringify(Object.assign({ condition: key }, tr)) + "\n"); n++; }
  }
  stream.end();
  const prov = {
    experiment: id.toUpperCase(), label: id,
    seeds, seedRule: "seed = 1 + (seedBase + seedIdx)*101", seedBase,
    trainTrials: spec.train, testTrials: spec.test, episodeSeconds: DOOR_CFG.episode,
    nParticles: DOOR_CFG.nParticles, noise: DOOR_CFG.noise, doorHeight: DOOR_CFG.doorHeight,
    dt: 1 / 60, tKelvin: 300, simToJoule: 1e-21,
    engine: "experiment_core.runBenchmark", circuit: spec.needsCircuit ? "fly_brain_circuit.json (FAFB v783, sha256 0eb64ba4...)" : null,
    node: process.version, startedISO: new Date(t0).toISOString(), elapsedSeconds: elapsed,
    rows: n,
  };
  fs.writeFileSync(path.join(OUT, id.toUpperCase() + "_meta_s" + seedBase + ".json"),
    JSON.stringify({ id: id.toUpperCase(), provenance: prov, conditions: conditionsSummary }, null, 1));
  console.log(`[program] ${id.toUpperCase()} chunk done (base ${seedBase}, ${seeds} seeds): ${n} rows in ${elapsed.toFixed(0)}s -> ${rowPath}`);
}

// ---- E9/E10/E11: apparatus cores -------------------------------------------
const APPARATUS = {
  e9: { core: pressureDemonCore, id: "E9",
        cfg: { trials: 24, trainTrials: 12, episodeSeconds: 20, nParticles: 260 } },
  e10: { core: smoluchowskiCore, id: "E10",
         cfg: { trials: 20, trainTrials: 10, episodeSeconds: 16, nParticles: 220 } },
  e11: { core: feynmanRatchetCore, id: "E11",
         cfg: { trials: 20, trainTrials: 10, episodeSeconds: 12 } },
};

function apparatusBrainFactory(sd, variant) {
  // same feature set as e9BrainFactory / apparatusBrainFactory in the worker:
  // E9 uses the E9 feature set; E10/E11 add pgBaseline+pgKc (apparatus-grade).
  return () => CTRL.connectomeController(circuit, {
    shuffle: false, rng: makeRng(9176 + (sd - 1) * 37), seed: 1,
    opticDrive: 0, motorDrive: 0.6, plasticity: "full",
    eligibility: [{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }],
    policyGradient: true, ...(variant === "e9" ? {} : { pgBaseline: true, pgKc: true }),
    pgRng: makeRng(424243 + (sd - 1) * 977),
  });
}

function runApparatus(id) {
  const def = APPARATUS[id];
  const seeds = Number(flag("seeds", "10"));
  const t0 = Date.now();
  const rowPath = path.join(OUT, def.id + "_rows.jsonl");
  const stream = fs.createWriteStream(rowPath);
  const variantRows = {};
  let n = 0;
  for (let s = 1; s <= seeds; s++) {
    const coreRows = [];
    def.core(Object.assign({}, def.cfg, {
      seed: 1 + (s - 1) * 101, seedTag: s,
      variants: null,               // all variants the core defines
      brainFactory: apparatusBrainFactory(s, id),
      onTrialData: (cond, phase, r) => { coreRows.push(r); },
    }));
    for (const r of coreRows) {
      stream.write(JSON.stringify(r) + "\n"); n++;
      (variantRows[r.condition] = variantRows[r.condition] || []).push(r);
    }
    console.log(`  [${def.id}] seed ${s}/${seeds} done (${coreRows.length} rows)`);
  }
  stream.end();
  const perCondition = {};
  for (const [k, rows] of Object.entries(variantRows)) {
    const m = f => { const v = rows.map(r => r[f]).filter(x => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    perCondition[k] = {
      episodes: rows.length,
      testWorkJEp: m("workJEp"), testReward: m("reward"),
      testDecisionAccuracy: m("decisionAccuracy"), testDemonAgree: m("demonAgree"),
      testNetPerEpisode: m("netPerEpisode"), testWeightDrift: m("weightDrift"),
    };
  }
  writeMeta(def.id, {
    experiment: def.id, seeds, seedRule: "core seed = 1 + (seedTag-1)*101",
    trainTrials: def.cfg.trainTrials, testTrials: def.cfg.trials - def.cfg.trainTrials,
    episodeSeconds: def.cfg.episodeSeconds, nParticles: def.cfg.nParticles || 0,
    engine: "experiment_core." + (id === "e9" ? "pressureDemonCore" : id === "e10" ? "smoluchowskiCore" : "feynmanRatchetCore"),
    circuit: "fly_brain_circuit.json (FAFB v783, sha256 0eb64ba4...)",
    node: process.version, startedISO: new Date(t0).toISOString(),
    elapsedSeconds: (Date.now() - t0) / 1000, rows: n,
  }, perCondition);
  console.log(`[program] ${def.id} done: ${n} rows -> ${rowPath}`);
}

// ---- main --------------------------------------------------------------------
const NEEDS_CIRCUIT = has("door") || has("e4") || has("e5") || has("e9") || has("e10") || has("e11");
const circuit = NEEDS_CIRCUIT ? loadCircuit() : null;
for (const id of ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"]) {
  if (has("door") || has(id)) runDoor(id);
}
if (has("e9")) runApparatus("e9");
if (has("e10")) runApparatus("e10");
if (has("e11")) runApparatus("e11");
console.log("[program] all requested experiments complete.");
