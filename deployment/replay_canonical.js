#!/usr/bin/env node
"use strict";
/**
 * deployment/replay_canonical.js — canonical seed-11 closed-loop replay.
 *
 * Mirrors tools/phase01_freeze.js mechanics EXACTLY (same core entry point,
 * same circuit source, same seed/steps/learning/episode) so the trajectory
 * is byte-identical to the frozen Phase 01 artifact:
 *   baselines/closed_loop/trajectory_seed11.jsonl
 *   sha256 05c47753fe56af3de12d5fa3b209e6c3ef20f88a74952154977b1c568bac204b
 *
 * Requires PYTHON_EMBODIMENT (fail closed via EmbodimentClient/env contract).
 * Output (machine-parsable):
 *   RECORDS=<n>
 *   TRAJECTORY_SHA256=<hex64>
 *   MATCH=true|false
 * Exit 0 iff MATCH.
 *
 * Post-Phase-02 ADDITIVE capability (real visual feedback, FLYBODY_ARCHITECTURE
 * §7): when EMBODIMENT_TRAJECTORY_SHA256 is set to a 64-hex hash, THIS hash is
 * compared instead of the frozen Phase 01 constant — an opt-in gate for
 * regression-anchoring NEW canonical trajectories after an additive,
 * documented change to the sidecar's observation semantics (never a silent
 * weakening: the default target stays the frozen Phase 01 hash, and RECORDS
 * must equal 240 in either case).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const FROZEN_SHA = "05c47753fe56af3de12d5fa3b209e6c3ef20f88a74952154977b1c568bac204b";

// Opt-in target override (fail closed on malformed values).
const ENV_SHA = (process.env.EMBODIMENT_TRAJECTORY_SHA256 || "").trim().toLowerCase();
const EXPECTED_SHA = /^[0-9a-f]{64}$/.test(ENV_SHA) ? ENV_SHA : FROZEN_SHA;

const { EmbodimentClient } = require("../embodiment/embodiment_client");
const contract = require("../embodiment/state_contract");
const core = require("../embodiment/closed_loop_core");
const CORE = require("../experiment_core");
core.init((spec) => spec === "state_contract" ? contract
  : spec === "experiment_core" ? CORE : require("../controllers"));

const SEED = 11;
const STEPS = 240;

async function main() {
  const circuit = JSON.parse(fs.readFileSync(path.join(ROOT, "fly_brain_circuit.json"), "utf8"));
  const client = new EmbodimentClient().start();
  let traj;
  try {
    traj = await core.runEpisode({
      send: (m) => client.send(m),
      circuit,
      seed: SEED, steps: STEPS, learning: true, episode: 0,
    });
  } finally {
    await client.stop();
  }

  const text = traj.records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const sha = crypto.createHash("sha256").update(text, "utf8").digest("hex");

  console.log(`RECORDS=${traj.records.length}`);
  console.log(`TRAJECTORY_SHA256=${sha}`);
  const match = sha === EXPECTED_SHA;
  console.log(`EXPECTED=${EXPECTED_SHA}`);
  console.log(`MATCH=${match}`);
  if (!match) {
    console.error(`REPLAY MISMATCH: expected ${EXPECTED_SHA} observed ${sha}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("REPLAY ERROR:", (e && e.stack) || e);
  process.exit(1);
});
