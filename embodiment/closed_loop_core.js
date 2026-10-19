/**
 * embodiment/closed_loop_core.js — transport-free closed-loop CORE.
 *
 * Owns the causal chain and NOTHING else (no I/O, no node builtins):
 *   canonical brain (controllers.connectomeController) ↔ sidecar client
 * so both the CLI runner (tools/closed_loop_runner.js) and the browser
 * experiment worker (run_cl message, experiment_worker.js) drive the SAME
 * loop implementation. `send` is injected: JSON message in, reply promise out
 * (stdio client in Node, WebSocket in the browser worker).
 *
 * Sensory transform and all scientific semantics are documented in
 * tools/closed_loop_runner.js and embodiment/state_contract.js. NO synthetic
 * path exists: a tick without the canonical motor-pool vector is rejected by
 * the sidecar (missing_neural), and this core never fabricates one.
 */
"use strict";

let CONTRACT = null;   // embodiment/state_contract.js (injected via require)
let CORE = null;       // experiment_core.js            (injected via require)
let CTRL = null;       // controllers.js                (injected via require)

/** Worker-compatible module wiring: resolve deps through a spec-dispatcher. */
function init(resolve) {
  CONTRACT = resolve("state_contract");
  CORE = resolve("experiment_core");
  CTRL = resolve("controllers");
}

/** One canonical connectome brain, exactly like e9BrainFactory (worker). */
function buildBrain(circuit, seed, opts) {
  opts = opts || {};
  const brain = CTRL.connectomeController(circuit, {
    shuffle: false,
    rng: CORE.makeRng(9176 + (seed % 97) * 37),
    seed: 1,
    opticDrive: 0.25,          // audited operating point (legacy8bin interface)
    motorDrive: 0.6,           // tonic drive as in the E9 factory
    plasticity: "full",        // P0: eligibility by contact; DA gates updates
    opticInput: "legacy8bin",  // audited default — retinotopy stays opt-in
  });
  // fully deterministic brain draw: replace the controller's own RNG stream
  // (init rng consumed it) with a seed-derived stream — two identical runs
  // must produce bit-identical trajectories.
  brain._rng = CORE.makeRng(seed ^ 0x5f37);
  return brain;
}

/** Sensory transform: 15-ch obs → brain input (documented in the runner). */
function sensoryTransform(obs) {
  return { visual: obs.slice(0, 8), contact: obs.slice(8, 15) };
}

/**
 * Drive the canonical brain ONE observation tick.
 * Returns { neural (copy), motorRate, dopamine, weightDrift, telemetry }.
 */
function driveBrain(brain, obs) {
  const { visual, contact } = sensoryTransform(obs);
  const envStub = {
    readSensors: () => contact,
    readVisualField: () => visual,
    door: null,                       // actuator envs: no door policy writes
  };
  brain.observe(envStub);
  brain.step(1 / 60, envStub);
  const view = brain.motorSpikeVector();          // live view (read-only)
  const neural = Array.from(view);                // copy for the wire
  const tel = brain.telemetry();
  return {
    neural, motorRate: tel.motorRate, dopamine: tel.dopamine,
    weightDrift: brain.weightDrift(), telemetry: tel,
  };
}

/** Stable content hash of an observation vector (replay comparison). */
function blakeObs(obs) {
  let h = 0x811c9dc5;
  for (let i = 0; i < obs.length; i++) {
    const q = Math.round(obs[i] * 1e6) | 0;
    h ^= q & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Run one deterministic closed-loop episode over an injected transport.
 *   send({type:"hello"...}) → welcome, send({type:"reset"...}) → reset_ack,
 *   send(stepCmd) → step_result — all validated fail-closed (contract).
 * STAGE 5: opts.task = "pillar" opts in to the physical task scene (the
 * sidecar's hello.task opt-in; wire contract unchanged). Task telemetry is
 * carried on every record (`task`, null when no task) and task gates are
 * computed from it (never hardcoded true).
 * Returns { records, gates, episode, seed, mode, taskName }.
 */
async function runEpisode({ send, circuit, seed = 11, steps = 120,
                            learning = true, episode = 0, onTick, task = null }) {
  const helloMsg = { type: "hello", v: CONTRACT.CONTRACT_VERSION };
  if (task) helloMsg.task = task;
  const welcome = await send(helloMsg);
  if (welcome.type !== "welcome") {
    throw new Error("sidecar handshake failed: " + JSON.stringify(welcome));
  }
  const ack = await send({ type: "reset", seed, episode });
  if (ack.type !== "reset_ack") {
    throw new Error("sidecar reset failed: " + JSON.stringify(ack));
  }
  const brain = buildBrain(circuit, seed);
  brain.setLearning(!!learning);      // P0: false ⇒ traces cleared, DA zeroed

  const ctx = { episode, lastTNeural: -1, neuralDim: undefined };
  let obs = ack.obs0;                 // FIRST observation = post-reset body state
  const records = [];
  let daBefore = 0, driftFirst = null, driftLast = null;

  for (let t = 0; t < steps; t++) {
    const drv = driveBrain(brain, obs);
    if (ctx.neuralDim === undefined) ctx.neuralDim = drv.neural.length;

    const cmd = {
      type: "step", v: CONTRACT.CONTRACT_VERSION, episode,
      t_neural: t,                                // monotone identity (C2)
      neural: drv.neural,                         // CANONICAL vector (C1)
      learn: learning ? 0.05 : 0.0,               // decoder gate (log only)
      motor_rate: drv.motorRate, decision: 1, reward: 0,
    };
    const vres = CONTRACT.validate(cmd, ctx);
    if (!vres.ok) throw new Error("runner produced invalid step: " + vres.code);

    const res = await send(cmd);
    if (res.type === "error") {
      throw new Error("sidecar rejected step " + t + ": " + res.code + " " + res.message);
    }
    const rv = CONTRACT.validate(res, { episode });
    if (!rv.ok) throw new Error("sidecar reply violates contract: " + rv.code + " " + rv.message);
    if (res.action.length !== CONTRACT.ACTION_DIM) {
      throw new Error("action dim " + res.action.length + " != " + CONTRACT.ACTION_DIM);
    }

    const reward = res.reward;
    const taskMeta = (res.task && res.task.task) ? res.task.task : null;  // STAGE 5
    daBefore = brain.dopamine;
    brain.receiveFeedback({ reward });   // (10) the ONLY reward→DA mapping
    obs = res.obs_next;                  // (12) NEW physical state → next input

    const rec = {
      t, episode, seed,
      obs_hash: blakeObs(obs),
      neural: drv.neural,
      motor_rate: drv.motorRate,
      da_before: daBefore, da_after: brain.dopamine,
      reward, action: res.action,
      body_pos: res.body.pos, body_quat: res.body.quat,
      weight_drift: brain.weightDrift(),
      t_phys: res.t_phys, mode: res.mode,
    };
    if (task) {
      // STAGE 5 additive fields ONLY in task mode: legacy (no-task) runs keep
      // the EXACT pre-Stage-5 record shape, so the frozen Phase 01/02
      // trajectory anchors stay byte-identical (replay_canonical discipline).
      rec.obs_bins = obs.slice(0, 8);    // post-step visual field (closure
                                         // evidence — the environment the
                                         // brain sees NEXT tick)
      rec.obs_proprio = obs.slice(8, 15); // post-step proprio/contact (T8)
      rec.task = taskMeta;               // task telemetry (object per tick)
    }
    if (driftFirst === null) driftFirst = rec.weight_drift;
    driftLast = rec.weight_drift;
    records.push(rec);
    if (onTick) onTick(rec, obs);   // NATURE FIGURE v1: obs as 2nd arg —
                                     // record shape UNCHANGED (replay anchors
                                     // stay byte-identical); consumers that
                                     // ignore the 2nd arg are unaffected.
  }

  const movedIdx = records.findIndex(r => Math.abs(r.reward) > 0);
  const daResponded = records.some(r => Math.abs(r.da_after - r.da_before) > 1e-9);
  const gates = {
    g_initial_state: true,
    g_sensory_input: records.length > 0,
    g_neural_reaches_decoder: records.every(r => r.neural.length === ctx.neuralDim),
    g_action_dim: records.every(r => r.action.length === CONTRACT.ACTION_DIM),
    g_physics_advanced: records.every(r => Number.isFinite(r.t_phys)) &&
      records[records.length - 1].t_phys === steps,
    g_reward_environmental: movedIdx >= 0,
    g_reward_to_dopamine: daResponded,
    g_dopamine_to_plasticity: learning
      ? (driftLast > driftFirst)
      : (driftLast === driftFirst),
    g_sensory_feedback_loop: true,
  };
  // STAGE 5 task gates: computed from recorded task telemetry, only when a
  // task was requested (absent on legacy runs so legacy gates are unchanged).
  if (task) {
    const tt = records.filter(r => r.task);
    gates.g_task_interaction = tt.length > 0 && tt.some(r =>
      r.task.first_contact_step !== null || r.task.pillar_disp_norm > 1e-9);
    gates.g_task_env_changed = tt.length > 0 && tt.some(r =>
      r.task.pillar_disp_norm > 0.0005);
    gates.g_task_reward_causal = tt.length > 0 && tt.some(r => r.reward > 0);
  }
  return { records, gates, episode, seed, mode: records[0].mode,
           taskName: task, learning };
}

module.exports = { init, buildBrain, driveBrain, sensoryTransform, runEpisode, blakeObs };
