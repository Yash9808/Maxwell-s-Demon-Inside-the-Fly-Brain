#!/usr/bin/env node
"use strict";
/**
 * tools/closed_loop_runner.js — CLI + Node library for the REAL closed loop.
 *
 * The causal chain itself lives in embodiment/closed_loop_core.js (shared
 * verbatim with the browser experiment worker's `run_cl` mode — one loop
 * implementation everywhere). This file adds only Node transport (spawned
 * sidecar over stdio via EmbodimentClient) and the CLI.
 *
 *   node tools/closed_loop_runner.js --steps 120 --seed 11 --out /tmp/cl.jsonl
 *   (PY/E9_CIRCUIT_PATH env override; default python + ./fly_brain_circuit.json)
 * Library: require("./tools/closed_loop_runner").runEpisode({client, ...})
 */
"use strict";

const fs = require("fs");
const path = require("path");

const { EmbodimentClient } = require("../embodiment/embodiment_client");
const contract = require("../embodiment/state_contract");
const core = require("../embodiment/closed_loop_core");
const CORE = require("../experiment_core");
core.init((spec) => spec === "state_contract" ? contract
  : spec === "experiment_core" ? CORE
  : require("../controllers"));   // "controllers"

const CIRCUIT_PATH = process.env.E9_CIRCUIT_PATH ||
  path.join(__dirname, "..", "fly_brain_circuit.json");

// re-export the canonical loop API (tests import from here)
const buildBrain = core.buildBrain;
const driveBrain = core.driveBrain;
const sensoryTransform = core.sensoryTransform;
const blakeObs = core.blakeObs;
async function runEpisode(opts) {
  // adapt the Node-client API ({client}) to the core's transport API ({send})
  if (opts && opts.client && !opts.send) {
    const client = opts.client;
    opts = Object.assign({}, opts, { send: (msg) => client.send(msg) });
  }
  return core.runEpisode(opts);
}

// ------------------------------------------------------------------ CLI ----
function parseArgs(argv) {
  const out = { steps: 120, seed: 11, episode: 0, out: null, learning: true, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--steps") out.steps = parseInt(argv[++i], 10);
    else if (a === "--seed") out.seed = parseInt(argv[++i], 10);
    else if (a === "--episode") out.episode = parseInt(argv[++i], 10);
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--frozen") out.learning = false;
    else if (a === "--quiet") out.quiet = true;
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log("loading canonical circuit:", CIRCUIT_PATH);
  const circuit = JSON.parse(fs.readFileSync(CIRCUIT_PATH, "utf8"));
  const client = new EmbodimentClient().start();
  try {
    const t0 = Date.now();
    const { records, gates, mode } = await core.runEpisode({
      send: (msg) => client.send(msg),
      circuit, seed: opts.seed, steps: opts.steps,
      learning: opts.learning, episode: opts.episode,
      onTick: opts.quiet ? null : (r) => {
        if (r.t % 20 === 0) {
          const aMax = Math.max.apply(null, r.action.map(Math.abs));
          console.log("t=" + String(r.t).padStart(3) +
                      "  motor=" + String(r.motor_rate).padStart(3) +
                      "  da=" + r.da_after.toFixed(4) +
                      "  drift=" + r.weight_drift.toFixed(1) +
                      "  r=" + r.reward.toFixed(4) +
                      "  x=" + r.body_pos[0].toFixed(5) +
                      "  |a59|=" + aMax.toFixed(2));
        }
      },
    });
    if (opts.out) {
      fs.writeFileSync(opts.out, records.map(r => JSON.stringify(r)).join("\n") + "\n");
      console.log("wrote", opts.out, "(" + records.length + " causal records)");
    }
    console.log("mode:", mode, "| elapsed:", ((Date.now() - t0) / 1000).toFixed(1) + "s");
    let all = true;
    for (const [k, v] of Object.entries(gates)) {
      console.log((v ? "PASS " : "FAIL ") + k);
      all = all && v;
    }
    console.log(all ? "CLOSED LOOP OK" : "CLOSED LOOP GATES FAILED");
    process.exitCode = all ? 0 : 1;
  } finally {
    await client.stop();
  }
}

if (require.main === module) {
  main().catch(e => { console.error("closed-loop error:", e.message); process.exit(2); });
}

module.exports = { buildBrain, driveBrain, sensoryTransform, runEpisode, blakeObs, CIRCUIT_PATH };
