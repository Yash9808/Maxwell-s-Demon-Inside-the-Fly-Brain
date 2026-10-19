#!/usr/bin/env node
"use strict";
/**
 * tools/phase3_behavior_experiment.js — PHASE 3 behavioral experiment driver
 * (AGENT TASK Phase 3 §4/§6). Persistent-brain episode loop over the REAL
 * flybody task — the experiment `closed_loop_core.runEpisode` cannot
 * express (it builds a FRESH brain per episode, so training cannot persist
 * across episodes). One sidecar session; the SAME canonical brain (FAFB-
 * constrained connectome, E9 machinery: DA-gated eligibility + REINFORCE
 * readout opt-in) is carried across episodes, so learning can accumulate.
 *
 *   node tools/phase3_behavior_experiment.js            (train 40 episodes)
 *   node tools/phase3_behavior_experiment.js --quick    (smoke-scale numbers)
 *   node tools/phase3_behavior_experiment.js --task pillar_approach
 *                                               --baseline-dir baselines/phase3b_approach
 *
 * PHASE 3B (--task pillar_approach): separated-spawn APPROACH task. The
 * Phase 3 pillar task's CONTACT-SPAWN CEILING (success without approach) is
 * removed by spawning the pillar ~120 mm away, outside the measured
 * leg-sweep envelope (embodiment/task_pillar.py APPROACH_* constants);
 * reward is approach CLOSURE (ratchet). The brain (200→16→59), motor
 * decoder, and reward→DA machinery are UNCHANGED. Baseline-dir default:
 * baselines/phase3_behavior (legacy) / baselines/phase3b_approach (3B).
 * PHASE3_LEARNING=0 runs the untrained-baseline protocol (learning off).
 * Env overrides: PHASE3_TRAIN_EPS, PHASE3_EVAL_STEPS, PHASE3_TRAIN_STEPS,
 * PHASE3_EVAL_SEEDS (csv), PHASE3_TRAIN_BASE (first training env seed;
 * shift training blocks for independent replicates — under PHASE3_RNG_RESET=1
 * the brain seed is behaviorally INERT: initial weights are circuit-
 * deterministic and draws are episode-keyed, so the training-seed block is
 * the honest replicate), PHASE3_BRAIN_SEEDS (csv; one full run per brain
 * seed, artifact suffixed _b<seed>), PHASE3_RNG_RESET=1 (C-2 paired-episode
 * discipline: per-episode brain fast-state reset + episode-keyed draw stream —
 * makes same-seed eval episodes EXACTLY comparable across phases; default off
 * preserves the historical session semantics and byte-valid baselines).
 *
 * Protocol per phase:
 *   EVAL   : learning ON (traces/DA live — the honest loop), k=2 fixed eval
 *            seeds, reward contributions recorded but EXCLUDED from training
 *            (no cross-phase leakage; evals differ only in seed → identical
 *            statistics within a phase, deterministic).
 *   TRAIN  : 16 training seeds; gradients accumulate in the one persistent
 *            brain. Train episodes are 2x eval length (physics ramp: the fly
 *            needs ~35 steps to leave the spawn contact).
 *   FROZEN EVAL (Phase 3B protocol): eval phases run with plasticity
 *            FROZEN — setLearning(false) AND no receiveFeedback — so the
 *            trained policy is measured without any further weight change
 *            (driftDelta === 0 during eval). TRAIN is the only ON phase:
 *            TRAIN (learning) -> FINAL POLICY -> EVAL (frozen).
 *
 * Metrics per episode: initial/final pillar distance (fly→pillar), min
 * distance, displacement, success (>=5 mm), length, cumulative reward,
 * touch bonus steps, mean motor rate, visual-bin L1 range, mean DA,
 * weight-drift delta. Aggregates: mean/std of every metric per phase.
 *
 * All output is deterministic given the CLI args (fixed seeds, no wall-clock
 * input to the loop).
 */
const path = require("path");
const fs = require("fs");
const EXP_CORE = require("../experiment_core");   // makeRng for PHASE3_RNG_RESET
const { EmbodimentClient } = require("../embodiment/embodiment_client");
const contract = require("../embodiment/state_contract");
const core = require("../embodiment/closed_loop_core");
core.init((spec) => spec === "state_contract" ? contract
  : spec === "experiment_core" ? require("../experiment_core")
  : require("../controllers"));

const ROOT = path.join(__dirname, "..");
const CIRCUIT_PATH = process.env.E9_CIRCUIT_PATH ||
  path.join(ROOT, "fly_brain_circuit.json");
const QUICK = process.argv.includes("--quick");
function argVal(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
// PHASE 3B task parameterization: "pillar" = legacy Phase 3 task (untouched
// defaults); "pillar_approach" = separated-spawn approach task — same brain,
// decoder and reward transport; new scene + closure reward.
const TASK = argVal("--task", "pillar");
const APPROACH = TASK === "pillar_approach";
const BASELINE_DIR = argVal("--baseline-dir",
  APPROACH ? "baselines/phase3b_approach" : "baselines/phase3_behavior");
// Approach episodes run at the task's calibrated horizon (700 steps: inside
// the env's own 735-step auto-reset boundary — no mid-episode pose snaps;
// tests/phase3b_approach.test.js T-3B.9). Env overrides for longer runs.
const EVAL_STEPS = +(process.env.PHASE3_EVAL_STEPS ||
  (QUICK ? 30 : APPROACH ? 700 : 150));
const TRAIN_STEPS = +(process.env.PHASE3_TRAIN_STEPS ||
  (QUICK ? 60 : APPROACH ? 700 : 200));
const TRAIN_EPS = +(process.env.PHASE3_TRAIN_EPS || (QUICK ? 4 : 12));
const EVAL_SEEDS = process.env.PHASE3_EVAL_SEEDS
  ? process.env.PHASE3_EVAL_SEEDS.split(",").map(Number).filter(Number.isFinite)
  : (QUICK ? [5, 6] : [5, 6]);
const TRAIN_SEEDS = Array.from({ length: TRAIN_EPS },
  (_, i) => (parseInt(process.env.PHASE3_TRAIN_BASE, 10) || 100) + i);
// C-2 multi-brain-seed support declared with BRAIN_SEED below (TDZ order).

// ---------------------------------------------------------------- helpers ---
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const std = a => a.length > 1
  ? Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1)) : 0;
const r6 = x => Math.round(x * 1e6) / 1e6;

/** Fixed brain seed per phase (so eval-before/eval-after differ ONLY in what
 *  training wrote into the weights — same seed → same draw discipline). */
const BRAIN_SEED = 11;
// C-2 paired-episode discipline (opt-in): per-episode fast-state reset +
// episode-keyed draw stream. Rationale (measured): the session confound band
// (-33.2 cum_reward on a weights-frozen control) was traced to the brain's
// CONTINUOUS neural draw stream + EMA state carrying across episodes — NOT to
// decoder adaptation (the sidecar reconstructs MotorDecoder fresh per reset,
// sidecar.py MotorDecoder(seed=seed)). With RNG_RESET, an eval seed defines
// the episode completely (weights | draws | physics), so eval_after vs
// eval_before differs ONLY in what training wrote into the weights.
const RNG_RESET = process.env.PHASE3_RNG_RESET === "1";
const BRAIN_SEEDS = process.env.PHASE3_BRAIN_SEEDS
  ? process.env.PHASE3_BRAIN_SEEDS.split(",").map(Number).filter(Number.isFinite)
  : [BRAIN_SEED];

function episodeMetrics(records) {
  const t0 = records[0].task, tN = records[records.length - 1].task;
  // Legacy snapshots carry the pillar pose (pillar_pos) — distances are
  // DERIVED from recorded geometry. The approach task snapshot instead
  // carries the task-tracked true gaps (dist/min_dist/spawn_dist) — use
  // them directly; no reconstruction.
  const approach = !!(t0 && t0.name === "pillar_approach");
  const dist = r => Math.hypot(r.body_pos[0] - r.task.pillar_pos[0],
                               r.body_pos[1] - r.task.pillar_pos[1]);
  // dist() reads the legacy pillar pose — legacy episodes only.
  const ds = approach ? [] : records.map(dist);

  const cumR = records.reduce((s, r) => s + r.reward, 0);
  const daMean = mean(records.map(r => r.da_after));
  const motor = mean(records.map(r => r.motor_rate));
  const visL1 = Math.max(...records.map(r =>
    r.obs_bins.reduce((s, x, i) => s + Math.abs(x - records[0].obs_bins[i]), 0)));
  const first = records[0], last = records[records.length - 1];
  const dInit = approach ? t0.dist : dist(first);
  const dFinal = approach ? tN.dist : dist(last);
  const dMin = approach ? tN.min_dist : Math.min(...ds);
  return {
    steps: records.length,
    dist_init: r6(dInit),
    dist_final: r6(dFinal),
    dist_min: r6(dMin),
    drift_delta: r6(records[records.length - 1].weight_drift -
                    records[0].weight_drift),
    ...(approach ? {
      // approach: pillar pose is not in the snapshot; the twitch-immovable
      // landmark is verified at spawn by T-3B.2 (pillar_moved <= 1e-4 m)
      spawn_dist: r6(t0.spawn_dist),
      min_dist: r6(tN.min_dist),
      env_resets: tN.env_reset_seen || 0,
    } : {
      pillar_disp: r6(tN.pillar_disp_norm),
    }),
    success: tN.success ? 1 : 0,
    success_step: tN.success_step,
    cum_reward: r6(cumR),
    ...(approach ? {} : {
      touch_bonus_steps: records.some(r => r.task.first_contact_step !== null) ? 1 : 0,
    }),
    mean_motor_rate: r6(motor),
    vis_bins_l1_range: r6(visL1),
    mean_da: r6(daMean),
    weight_drift_delta: r6(records[records.length - 1].weight_drift -
                           records[0].weight_drift),
  };
}

// ------------------------------------------------------------------ main ----
async function runExperiment(brainSeed) {
  const circuit = JSON.parse(fs.readFileSync(CIRCUIT_PATH, "utf8"));
  const cl = new EmbodimentClient({ body: "flybody" }).start();
  const welcome = await cl.send({ type: "hello", v: contract.CONTRACT_VERSION, task: TASK });
  if (welcome.type !== "welcome" || welcome.mode !== "flybody") {
    throw new Error("task session failed: " + JSON.stringify(welcome));
  }
  const out = { started_utc: new Date().toISOString(), quick: QUICK,
                task: TASK, baseline_dir: BASELINE_DIR,
                eval_steps: EVAL_STEPS, train_steps: TRAIN_STEPS,
                train_episodes: TRAIN_EPS, eval_seeds: EVAL_SEEDS,
                phases: {} };

  // ONE persistent brain for the WHOLE experiment (the training substrate).
  // PHASE3_LEARNING=0 = UNTRAINED-BASELINE protocol (identical loop, learning
  // machinery off) — the honest comparator for the learning run. Default
  // remains learning-ON (Phase 3 semantics).
  const LEARNING = process.env.PHASE3_LEARNING !== "0";
  const brain = core.buildBrain(circuit, brainSeed);
  brain.setLearning(LEARNING);       // traces/DA live; REINFORCE remains opt-in
  const brainInitDrift = brain.weightDrift();
  const TRAJ = {};   // per-step records per phase/episode — persisted to the
                     // *_trajectories.json sibling artifact (Order-6 dataset)

  /** One episode over the shared sidecar session with the shared brain.
   *  NOTE: `hello` is sent ONCE per session (it rebuilds the MuJoCo env);
   *  each episode is a plain `reset` (cheap, deterministic). */
  async function runOne(seed, episode, steps, frozen) {
    // frozen=true: PLASTICITY FROZEN EVAL — no eligibility accumulation, no
    // DA delivery, no weight updates (setLearning(false) also zeroes EW/DA).
    if (frozen) brain.setLearning(false);
    // C-2 paired-episode reset (PHASE3_RNG_RESET=1): resetForTrial zeroes the
    // fast state (V/spikes/refac/EMAs/traces/DA) and the draw stream is
    // re-keyed by THIS episode's seed — the same stream discipline buildBrain
    // uses (seed ^ 0x5f37), fresh per episode. Traces zeroing at episode
    // boundaries is protocol-correct: eligibility e-folds in ~66 ticks, so no
    // credit spans episodes anyway; the persistent substrate is the WEIGHTS.
    if (RNG_RESET) {
      brain.resetForTrial();
      brain._rng = EXP_CORE.makeRng(seed ^ 0x5f37);
    }
    const ack = await cl.send({ type: "reset", seed, episode });
    if (ack.type !== "reset_ack") throw new Error("reset failed: " + JSON.stringify(ack));
    let obs = ack.obs0;
    const records = [];
    for (let t = 0; t < steps; t++) {
      const drv = core.driveBrain(brain, obs);
      const res = await cl.send({ type: "step", v: contract.CONTRACT_VERSION,
                                  episode, t_neural: t,
                                  neural: drv.neural,
                                  learn: frozen ? 0.0 : 0.05 });
      if (res.type === "error") throw new Error("step " + t + ": " + res.code);
      const daBefore = brain.dopamine;
      if (LEARNING && !frozen) brain.receiveFeedback({ reward: res.reward }); // the ONLY reward→DA path
      // (frozen eval => drift MUST stay 0 across the episode; learning off =>
      //  no DA/traces/updates at all: the baseline brain is bit-identical)
      obs = res.obs_next;
      records.push({
        t, reward: res.reward, action: res.action,
        body_pos: res.body.pos, motor_rate: drv.motorRate,
        spike_count: drv.telemetry.spikeCount,          // motor-layer spikes/tick
        da_before: daBefore, da_after: brain.dopamine,
        weight_drift: brain.weightDrift(),
        obs_bins: obs.slice(0, 8),
        task: res.task && res.task.task ? res.task.task : null,
      });
    }
    if (frozen) brain.setLearning(LEARNING);   // restore the run-level gate
    return records;
  }

  async function evalPhase(name, episodeBase) {
    const eps = [];
    for (let i = 0; i < EVAL_SEEDS.length; i++) {
      const recs = await runOne(EVAL_SEEDS[i], episodeBase + i, EVAL_STEPS,
                                /*frozen*/ true);
      TRAJ[name + "_ep" + i] = recs;
      eps.push(episodeMetrics(recs));
    }
    const agg = {};
    for (const k of Object.keys(eps[0])) {
      if (k === "success_step") continue;
      agg[k] = k === "success"
        ? { mean: r6(mean(eps.map(e => e[k]))), rate: eps.filter(e => e[k]).length + "/" + eps.length }
        : { mean: r6(mean(eps.map(e => e[k]))), std: r6(std(eps.map(e => e[k]))) };
    }
    out.phases[name] = { episodes: eps, aggregate: agg };
    console.error(`[${name}] cum_reward ${agg.cum_reward.mean} ± ${agg.cum_reward.std}` +
      ` | final_dist ${agg.dist_final.mean} ± ${agg.dist_final.std}` +
      ` | success ${agg.success.rate} | driftΔ ${agg.weight_drift_delta.mean}`);
    return out.phases[name];
  }

  // ---- phase 1: UNTRAINED EVAL --------------------------------------------
  await evalPhase("eval_before", 0);

  // ---- phase 2: TRAINING ---------------------------------------------------
  const trainSummary = [];
  for (let i = 0; i < TRAIN_SEEDS.length; i++) {
    const recs = await runOne(TRAIN_SEEDS[i], 100 + i, TRAIN_STEPS, false);
    TRAJ["train_ep" + i] = recs;
    trainSummary.push(episodeMetrics(recs));
  }
  out.phases.train = {
    episodes: trainSummary,
    aggregate: Object.fromEntries(Object.keys(trainSummary[0]).filter(k => k !== "success_step")
      .map(k => [k, { mean: r6(mean(trainSummary.map(e => e[k]))),
                      std: r6(std(trainSummary.map(e => e[k]))) }])),
  };
  console.error(`[train] cum_reward ${out.phases.train.aggregate.cum_reward.mean}` +
    ` ± ${out.phases.train.aggregate.cum_reward.std}` +
    ` | success ${trainSummary.filter(e => e.success).length}/${TRAIN_EPS}` +
    ` | total_drift ${r6(brain.weightDrift() - brainInitDrift)}`);

  // ---- phase 3: POST-TRAINING EVAL ----------------------------------------
  await evalPhase("eval_after", 200);

  out.brain = {
    seed: brainSeed,
    weight_drift_total: r6(brain.weightDrift() - brainInitDrift),
    learning: LEARNING,
    rng_reset: RNG_RESET,
    protocol: "persistent brain; TRAIN is the only plasticity-ON phase; " +
          "eval phases run FROZEN (setLearning(false), no receiveFeedback) " +
          "on fixed eval seeds {5,6} - TRAIN (learning) -> FINAL POLICY -> " +
          "EVAL (frozen); eval drift_delta === 0 by construction",
  };

  await cl.stop();

  // --- Run manifest (explicit reproducible metadata; task is DATA, not code state)
  let gitRevision = null, gitDirty = null;
  try {
    const { execSync } = require("child_process");
    gitRevision = execSync("git rev-parse HEAD",
      { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    gitDirty = execSync("git status --porcelain",
      { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0;
  } catch { /* git unavailable: recorded as null, never guessed */ }
  out.manifest = {
    experiment: APPROACH ? "phase_3b" : "phase_3",
    task: TASK,
    seeds: { brain: brainSeed, eval: EVAL_SEEDS, train: TRAIN_SEEDS },
    learning: LEARNING,
    frozen_eval: true,
    rng_reset: RNG_RESET,
    brain: "fafb_v783 (fly_brain_circuit.json, connectomeController)",
    decoder: "MotorDecoder(seed=<episode seed>) - reconstructed fresh per " +
             "episode by the sidecar reset (no cross-episode decoder state)",
    environment: APPROACH
      ? "mujoco flybody + pillar_approach (APPROACH_POS [-0.105,-0.060], arrival 0.050 m, ratchet closure)"
      : "mujoco flybody + pillar (contact spawn)",
    contract: "state_contract v1 (OBS_DIM 15, ACTION_DIM 59)",
    steps: { eval: EVAL_STEPS, train: TRAIN_STEPS },
    quick: QUICK,
    git_revision: gitRevision,
    git_dirty: gitDirty,
  };

  // --- Per-step trajectory persistence (the null/trained behavioral dataset)
  // Main artifact stays aggregate-only; trajectories land in a sibling file
  // so the metrics file remains diff-friendly.
  const cond = LEARNING ? "trained_frozen" : "untrained";
  const writeRun = (file) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(
      Object.assign({}, out, { trajectories: { [cond]: TRAJ } }), null, 2) + "\n");
    console.error("written: " + file);
  };
  const json = JSON.stringify(out, null, 2);
  const seedTag = BRAIN_SEEDS.length > 1 ? "_b" + brainSeed : "";
  const outFile = process.env.PHASE3_OUT
    ? (BRAIN_SEEDS.length > 1
        ? process.env.PHASE3_OUT.replace(/\.json$/, seedTag + ".json")
        : process.env.PHASE3_OUT)
    : path.join(ROOT, BASELINE_DIR,
        `phase3_${TASK}_${QUICK ? "quick" : "full"}${seedTag}.json`);
  writeRun(outFile);
  if (!process.env.PHASE3_OUT) {
    writeRun(path.join(ROOT, BASELINE_DIR,
      `phase3_${TASK}_${QUICK ? "quick" : "full"}${seedTag}_trajectories.json`));
  }
  console.log(json);
  return out;
}

async function main() {
  for (const bs of BRAIN_SEEDS) await runExperiment(bs);   // C-2: one full protocol per brain seed
}

main().catch((e) => { console.error(e); process.exit(1); });
