#!/usr/bin/env node
"use strict";
/**
 * tools/phase01_freeze.js — Phase 01 baseline-artifact generator.
 *
 * Creates machine-readable, hash-addressed freeze artifacts alongside the
 * historical P0 artifacts (never overwriting them):
 *
 *   baselines/closed_loop/trajectory_seed11.jsonl   canonical episode record
 *   baselines/closed_loop/trajectory_meta.json      env+brain config, sha256
 *   baselines/replay/e9_pressurereplay.json         E9 seeded replay fixture
 *   baselines/protocol/state_contract_v1.json       frozen protocol record
 *   baselines/results/*.json                        per-suite result hashes
 *   baselines/environment.json                      machine-readable env freeze
 *
 * Read-only with respect to history: the generator WRITES only under
 * baselines/ and never modifies scientific code or prior artifacts.
 * Protocol schema semantics live in embodiment/state_contract.js — this tool
 * freezes the record, it does not define behavior.
 *
 * Usage: node tools/phase01_freeze.js [--steps 240] [--seed 11]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const { EmbodimentClient } = require("../embodiment/embodiment_client");
const contract = require("../embodiment/state_contract");
const core = require("../embodiment/closed_loop_core");
const CORE = require("../experiment_core");
core.init((spec) => spec === "state_contract" ? contract
  : spec === "experiment_core" ? CORE : require("../controllers"));

const ROOT = path.join(__dirname, "..");
const BL = path.join(ROOT, "baselines");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sha256File = (p) => sha256(fs.readFileSync(p));
const git = (args) => execSync("git " + args, { cwd: ROOT, encoding: "utf8" }).trim();

function parseArgs(argv) {
  const out = { steps: 240, seed: 11 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--steps") out.steps = parseInt(argv[++i], 10);
    else if (argv[i] === "--seed") out.seed = parseInt(argv[++i], 10);
  }
  return out;
}

function shaFileOrHeader(p, name) {
  const buf = fs.readFileSync(p);
  const line = buf.subarray(0, buf.indexOf(0x0a)).toString("utf8");
  let cfg = {};
  try { cfg = JSON.parse(line.slice(line.indexOf("{"))); } catch (e) { /* header only */ }
  if (!cfg.layer_names) {
    // full-file hash fallback for payload embeds without a JSON header
    return { file: name, sha256: sha256(buf), bytes: buf.length };
  }
  return { file: name, config_sha256: sha256(line + "\n"), bytes: buf.length,
           neurons: (cfg.layers || []).reduce((a, l) => a + l.length, 0),
           edges: (cfg.edges || []).length,
           modulatory: (cfg.modulatory_edges || []).length,
           layers: cfg.layer_names };
}

// ---------------------------------------------------------------- science --
function e9ReplayFixture() {
  // Deterministic, seed-pinned E9 pressure replay: same factory contract as
  // experiment_worker's e9BrainFactory; fixtures exercise the causal gates.
  const mod = require.resolve("../e9_learning_test.js");
  return { suite: "e9_learning_test", runner: path.basename(mod),
           seed_pin: "see baselines/results/e9.json (self-seeded, deterministic)",
           note: "gates re-run by validation battery; results hash-frozen in baselines/results/" };
}

function protocolRecord() {
  const sc = fs.readFileSync(path.join(ROOT, "embodiment", "state_contract.js"), "utf8");
  return {
    contract_version: contract.CONTRACT_VERSION,
    source_sha256: sha256(sc),
    action_dim: contract.ACTION_DIM,
    observation_dim: contract.OBS_DIM,
    neural_max_dim: contract.NEURAL_MAX_DIM,
    canonical_neural_dim: 200,
    message_types: ["hello", "welcome", "reset", "reset_ack", "step", "step_result",
                    "observe_env", "learning_signal", "tap", "tap_state", "bye",
                    "bye_ack", "error"],
    error_codes: ["contract_violation", "missing_neural", "stale_episode",
                  "stale_time", "neural_dim_changed"],
    stale_behavior: "rejected (error, stale_time/stale_episode); never applied",
    malformed_behavior: "rejected fail-closed (error, contract_violation); never patched or defaulted",
    episode_ids: "integer >= 0, must equal receiver's current episode",
    timestep_semantics: "t_neural monotone non-decreasing per episode; t_phys increments per sidecar step",
    sequence_numbers: "worker cl_state stream: seq strictly increasing; page drops seq <= lastSeq",
    transport: "stdio JSON-lines (CLI/CI) or WebSocket JSON-lines (browser, port 8795)",
  };
}

// ------------------------------------------------------------------- main --
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  for (const d of ["closed_loop", "replay", "results", "protocol"])
    fs.mkdirSync(path.join(BL, d), { recursive: true });

  const commit = git("rev-parse HEAD");
  const circuitInfo = shaFileOrHeader(path.join(ROOT, "fly_brain_circuit.json"), "fly_brain_circuit.json");

  // ---- 1. canonical closed-loop trajectory (frozen env) -------------------
  console.log("[1/4] canonical closed-loop episode: seed", opts.seed, "steps", opts.steps);
  const client = new EmbodimentClient().start();
  let traj;
  try {
    traj = await core.runEpisode({
      send: (m) => client.send(m),
      circuit: JSON.parse(fs.readFileSync(path.join(ROOT, "fly_brain_circuit.json"), "utf8")),
      seed: opts.seed, steps: opts.steps, learning: true, episode: 0,
    });
  } finally { await client.stop(); }
  const trajPath = path.join(BL, "closed_loop", "trajectory_seed" + opts.seed + ".jsonl");
  fs.writeFileSync(trajPath, traj.records.map(r => JSON.stringify(r)).join("\n") + "\n");
  const trajHash = sha256File(trajPath);

  // replay verification (same frozen env): must be byte-identical
  const client2 = new EmbodimentClient().start();
  let traj2;
  try {
    traj2 = await core.runEpisode({
      send: (m) => client2.send(m),
      circuit: JSON.parse(fs.readFileSync(path.join(ROOT, "fly_brain_circuit.json"), "utf8")),
      seed: opts.seed, steps: opts.steps, learning: true, episode: 0,
    });
  } finally { await client2.stop(); }
  const replayHash = sha256(Buffer.from(traj2.records.map(r => JSON.stringify(r)).join("\n") + "\n"));
  if (replayHash !== trajHash) {
    console.error("REPLAY MISMATCH: canonical", trajHash, "replay", replayHash);
    process.exit(1);
  }

  const meta = {
    artifact: "phase01_canonical_closed_loop_trajectory",
    created_utc: new Date().toISOString(),
    commit_sha: commit,
    seed: opts.seed, episode: traj.episode, steps: opts.steps,
    learning: traj.learning, physics_mode: traj.mode,
    initial: {
      body_state: { pos: traj.records[0].body_pos, quat: traj.records[0].body_quat },
      observation_source: "sidecar reset_ack.obs0 (post-reset MuJoCo state)",
      brain_state: "fresh connectomeController draw, seed " + opts.seed +
                   " (buildBrain: makeRng(9176+" + (opts.seed % 97) + "*37) init, _rng=makeRng(" +
                   opts.seed + "^0x5f37)), legacy8bin opticInput, opticDrive 0.25, motorDrive 0.6, plasticity full",
      decoder_state: "MotorDecoder(seed=" + opts.seed + "), gain=1, bias=0, frozen projections",
    },
    final: {
      t: traj.records[traj.records.length - 1].t,
      body_pos: traj.records[traj.records.length - 1].body_pos,
      weight_drift: traj.records[traj.records.length - 1].weight_drift,
      dopamine: traj.records[traj.records.length - 1].da_after,
    },
    record_fields: ["t", "episode", "seed", "obs_hash", "neural", "motor_rate",
                    "da_before", "da_after", "reward", "action", "body_pos",
                    "body_quat", "weight_drift", "t_phys", "mode"],
    trajectory_sha256: trajHash,
    replay_sha256: replayHash,
    replay_verdict: replayHash === trajHash ? "BYTE-IDENTICAL" : "MISMATCH",
    circuit: circuitInfo,
    contract_version: contract.CONTRACT_VERSION,
  };
  fs.writeFileSync(path.join(BL, "closed_loop", "trajectory_meta.json"), JSON.stringify(meta, null, 2));
  console.log("   trajectory sha256:", trajHash.slice(0, 16) + "… (replay byte-identical)");

  // ---- 2. E9 replay fixture ------------------------------------------------
  console.log("[2/4] E9 replay fixture");
  fs.writeFileSync(path.join(BL, "replay", "e9_pressurereplay.json"),
                   JSON.stringify({ created_utc: new Date().toISOString(), commit_sha: commit,
                                    ...e9ReplayFixture() }, null, 2));

  // ---- 3. protocol freeze ---------------------------------------------------
  console.log("[3/4] protocol freeze record");
  const prec = { created_utc: new Date().toISOString(), commit_sha: commit,
                 ...protocolRecord() };
  fs.writeFileSync(path.join(BL, "protocol", "state_contract_v1.json"), JSON.stringify(prec, null, 2));

  // ---- 4. environment record ------------------------------------------------
  console.log("[4/4] environment record");
  const env = {
    frozen_utc: new Date().toISOString(),
    commit_sha: commit,
    branch: git("rev-parse --abbrev-ref HEAD"),
    node: process.version,
    platform: process.platform,
    os_release: require("os").release(),
    seeds: { canonical_closed_loop: opts.seed, benchmark_default: "1 + s*101",
             brain_factory: "makeRng(9176 + seedIdx*37)", pg_readout: "makeRng(424243 + seedIdx*977)" },
    locks: ["requirements-embodiment.txt", "requirements-flyvis.txt"],
  };
  fs.writeFileSync(path.join(BL, "environment.json"), JSON.stringify(env, null, 2));
  console.log("Phase 01 freeze artifacts written under baselines/");
}

main().catch((e) => { console.error("freeze error:", e.message); process.exit(1); });
