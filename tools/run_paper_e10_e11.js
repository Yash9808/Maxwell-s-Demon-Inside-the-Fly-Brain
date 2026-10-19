#!/usr/bin/env node
/**
 * run_paper_e10_e11.js — E10/E11 per-episode row dump for the Nature paper.
 * Configuration is IDENTICAL to e10_e11_batch_validate.js (same cores, same
 * seeds 1..10, 24 train + 8 test episodes of 12 s, same brain factory); the
 * only difference is that complete per-episode rows are persisted so the
 * paper's Figure panels can be plotted from raw data.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { smoluchowskiCore, feynmanRatchetCore, makeRng } = require("../experiment_core.js");
const { connectomeController } = require("../controllers.js");
const circuit = require("../fly_brain_circuit.json");

const SEEDS = Number(process.argv[2]) || 10;
const EP = 12, TR = 24, TT = 8;
const fromArg = process.argv.indexOf("--from");
const toArg = process.argv.indexOf("--to");
const FROM = fromArg >= 0 ? Number(process.argv[fromArg + 1]) : 1;
const TO = toArg >= 0 ? Number(process.argv[toArg + 1]) : SEEDS;

function brainFactoryFor(seed) {
  return () => connectomeController(circuit, {
    shuffle: false, rng: makeRng(1000 + seed), seed: 1, opticDrive: 0,
    motorDrive: 0.6, plasticity: "full",
    eligibility: [{ tau: 0.90, w: 0.45 }, { tau: 0.985, w: 0.35 }, { tau: 0.9995, w: 0.20 }],
    policyGradient: true, pgBaseline: true, pgKc: true,
    pgRng: makeRng(500000 + seed),
  });
}

const outPath = path.join(__dirname, "..", "research_data", "paper_e10_e11_rows.json");
// merge into an existing chunked output so ranges can be run in separate calls
let prior = {};
try { prior = JSON.parse(fs.readFileSync(outPath, "utf8")); } catch (e) {}
const e10Rows = (prior.e10_neural || []).filter(r => r.seed < FROM || r.seed > TO);
const e11Rows = (prior.e11_neural || []).filter(r => r.seed < FROM || r.seed > TO);
const frozenRows = (prior.e10_frozen || []).filter(r => r.seed < FROM || r.seed > TO);
for (let s = FROM; s <= TO; s++) {
  smoluchowskiCore({
    seed: s, seedTag: s, trials: TR + TT, trainTrials: TR, episodeSeconds: EP,
    nParticles: 220, brainFactory: brainFactoryFor(s),
    onTrialData: (c, p, r) => { if (c === "trapdoor_neural") e10Rows.push(r); },
  });
  feynmanRatchetCore({
    seed: s, seedTag: s, trials: TR + TT, trainTrials: TR, episodeSeconds: EP,
    brainFactory: brainFactoryFor(s),
    onTrialData: (c, p, r) => { if (c === "ratchet_neural") e11Rows.push(r); },
  });
  process.stdout.write(`seed ${s} done\n`);
}
for (let s = FROM; s <= TO; s += 4) {
  smoluchowskiCore({
    seed: s, seedTag: s, trials: TR + TT, trainTrials: 0, episodeSeconds: EP,
    nParticles: 220, variants: ["trapdoor_frozen"], brainFactory: brainFactoryFor(s),
    onTrialData: (c, p, r) => frozenRows.push(r),
  });
}

const out = { format: "paper-e10-e11-v1", config: { seeds: SEEDS, trainTrials: TR, testTrials: TT, episodeSeconds: EP },
              e10_neural: e10Rows, e11_neural: e11Rows, e10_frozen: frozenRows };
fs.writeFileSync(outPath, JSON.stringify(out));
console.log("wrote", outPath, `(${e10Rows.length} E10 rows, ${e11Rows.length} E11 rows, ${frozenRows.length} frozen rows)`);
