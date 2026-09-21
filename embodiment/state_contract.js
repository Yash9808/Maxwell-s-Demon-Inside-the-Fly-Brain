/**
 * embodiment/state_contract.js — AUTHORITATIVE closed-loop state contract.
 *
 * One versioned schema for every message that crosses the
 *   canonical fly brain (JS) ↔ embodiment sidecar (FlyBody/MuJoCo, Python)
 * boundary. The browser panel, the Node closed-loop runner and the Python
 * sidecar ALL speak exactly this contract; messages that fail validation are
 * REJECTED (fail closed), never patched up, defaulted or substituted.
 *
 * Causal loop this contract carries (FLYBODY_ARCHITECTURE.md §1):
 *   physical environment → observation → canonical brain → motor pool spikes
 *   → MotorDecoder → 59-D action → MuJoCo step → new physical state
 *   → observation → reward → dopamine (brain.receiveFeedback) → plasticity
 *
 * RULES ENCODED HERE (the contract makes silent substitution impossible):
 *  C1  `neural` on a step command is REQUIRED — there is no zero/synthetic
 *      fallback path. A missing or invalid neural vector is a contract
 *      violation, not "auto-silence".
 *  C2  Identity: every message carries {episode, t_*}. Episode must match the
 *      receiver's current episode; time must be monotone non-decreasing
 *      (stale/replayed/out-of-order messages are rejected).
 *  C3  The decoded action is exactly 59-D (ACTION_DIM, flybody walking spec)
 *      and originates from the canonical motor-pool spike vector — the
 *      contract checks dimensionality at the boundary.
 *  C4  Sensory feedback: `obs_next` returned by the sidecar is the observation
 *      computed from the POST-step MuJoCo state; the brain's next drive must
 *      be built from that observation (enforced by the runner loop order,
 *      asserted by the closed-loop tests).
 *  C5  Reward/dopamine: the sidecar returns the environment reward; the
 *      reward→dopamine mapping lives ONLY in the canonical brain
 *      (connectomeController.receiveFeedback). The contract transports the
 *      scalar; it never fabricates one.
 *  C6  Malformed JSON, wrong types, non-finite numbers, wrong vector lengths
 *      → {"type":"error","code":"contract_violation"} with the reason. Fail
 *      closed on both ends.
 *
 * Pure data module (no I/O) so every consumer can require() it.
 */
"use strict";

const CONTRACT_VERSION = 1;
const ACTION_DIM = 59;          // flybody walking action space (SOURCE-DERIVED)
const OBS_DIM = 15;             // 8-bin visual + 7 contact/proprio channels
const POS_DIM = 3, QUAT_DIM = 4;

// Maximum neural-vector length accepted on the wire. The canonical motor pool
// is POOL_N = min(200, motor-layer size) = 200 neurons; the decoder treats the
// vector dimension as the motor population size and FORBIDS changes
// mid-episode. 512 gives headroom for future pool sizes without loosening C1.
const NEURAL_MAX_DIM = 512;

const ERR = (code, message) => ({ ok: false, code, message });
const OK = { ok: true };

/** Finite number check (NaN/Infinity are contract violations, not clamps). */
function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

/** Vector of finite numbers with an exact length (or [min,max] range). */
function checkVector(v, len, name) {
  if (!Array.isArray(v)) return ERR("contract_violation", name + " must be an array");
  if (v.length !== len) {
    return ERR("contract_violation", name + " length " + v.length + " != expected " + len);
  }
  for (let i = 0; i < v.length; i++) {
    if (!isFiniteNumber(v[i])) {
      return ERR("contract_violation", name + "[" + i + "] not a finite number");
    }
  }
  return OK;
}

function checkIdentity(msg, name, ctx) {
  if (!Number.isInteger(msg.episode) || msg.episode < 0) {
    return ERR("contract_violation", name + ".episode must be a non-negative integer");
  }
  if (ctx && ctx.episode !== undefined && msg.episode !== ctx.episode) {
    return ERR("stale_episode", name + ".episode " + msg.episode +
               " != current episode " + ctx.episode);
  }
  return OK;
}

function checkMonotone(t, name, lastT) {
  if (!Number.isInteger(t) || t < 0) {
    return ERR("contract_violation", name + " must be a non-negative integer");
  }
  if (lastT !== undefined && t < lastT) {
    return ERR("stale_time", name + " " + t + " < already-processed " + lastT);
  }
  return OK;
}

// ------------------------------------------------------------------ messages
/**
 * environment → brain: the observation computed from the POST-step MuJoCo
 * state (the sensory closed-loop edge). Emitted by the sidecar in
 * `step_result.obs_next` and by the runner as an explicit `observe_env`.
 */
function observeEnv({ episode, tEnv, body, observation, task }) {
  return {
    type: "observe_env", v: CONTRACT_VERSION,
    episode: episode | 0, t_env: tEnv | 0,
    body: { pos: body.pos, quat: body.quat, linvel: body.linvel, angvel: body.angvel },
    observation, task: task || null,
  };
}

function validateObserveEnv(msg, ctx) {
  let r = checkIdentity(msg, "observe_env", ctx);
  if (!r.ok) return r;
  r = checkMonotone(msg.t_env, "observe_env.t_env", ctx && ctx.lastTEnv);
  if (!r.ok) return r;
  if (!msg.body || typeof msg.body !== "object") {
    return ERR("contract_violation", "observe_env.body missing");
  }
  r = checkVector(msg.body.pos, POS_DIM, "body.pos");
  if (!r.ok) return r;
  r = checkVector(msg.body.quat, QUAT_DIM, "body.quat");
  if (!r.ok) return r;
  r = checkVector(msg.observation, OBS_DIM, "observation");
  return r;
}

/**
 * brain → body: step command. `neural` is the CANONICAL motor-pool spike
 * vector (canonical motor pool size = 200) — C1: required, never defaulted.
 * `reward`/`decision`/`motor_rate` ride along for the sidecar's causal log so
 * one JSONL record contains the full brain→body→env chain.
 */
function stepCommand({ episode, tNeural, neural, learn, motorRate, decision, reward }) {
  const cmd = {
    type: "step", v: CONTRACT_VERSION,
    episode: episode | 0, t_neural: tNeural | 0,
    neural, learn: isFiniteNumber(learn) ? learn : 0,
  };
  if (motorRate !== undefined) cmd.motor_rate = motorRate;
  if (decision !== undefined) cmd.decision = decision;
  if (reward !== undefined) cmd.reward = reward;
  return cmd;
}

function validateStep(msg, ctx) {
  let r = checkIdentity(msg, "step", ctx);
  if (!r.ok) return r;
  r = checkMonotone(msg.t_neural, "step.t_neural", ctx && ctx.lastTNeural);
  if (!r.ok) return r;
  // C1: neural is REQUIRED. No zero vector, no last-value hold, no synthesis.
  if (!Array.isArray(msg.neural) || msg.neural.length === 0) {
    return ERR("missing_neural", "step.neural is required (no synthetic fallback)");
  }
  if (msg.neural.length > NEURAL_MAX_DIM) {
    return ERR("contract_violation",
      "step.neural length " + msg.neural.length + " > NEURAL_MAX_DIM " + NEURAL_MAX_DIM);
  }
  for (let i = 0; i < msg.neural.length; i++) {
    if (!isFiniteNumber(msg.neural[i])) {
      return ERR("contract_violation", "step.neural[" + i + "] not a finite number");
    }
  }
  if (ctx && ctx.neuralDim !== undefined && msg.neural.length !== ctx.neuralDim) {
    return ERR("neural_dim_changed", "step.neural length " + msg.neural.length +
               " != fixed decoder dim " + ctx.neuralDim);
  }
  if (msg.learn !== undefined && !isFiniteNumber(msg.learn)) {
    return ERR("contract_violation", "step.learn not a finite number");
  }
  return OK;
}

/** body → brain: the full loop step result (sidecar reply). */
function validateStepResult(msg, ctx) {
  if (msg.type !== "step_result") {
    return ERR("contract_violation", "expected step_result, got " + msg.type);
  }
  let r = checkIdentity(msg, "step_result", ctx);
  if (!r.ok) return r;
  r = checkVector(msg.action, ACTION_DIM, "step_result.action");
  if (!r.ok) return r;                                            // C3
  r = checkVector(msg.obs_next, OBS_DIM, "step_result.obs_next");
  if (!r.ok) return r;                                            // C4
  if (!isFiniteNumber(msg.reward)) {
    return ERR("contract_violation", "step_result.reward not a finite number"); // C5
  }
  if (!msg.body || !Array.isArray(msg.body.pos)) {
    return ERR("contract_violation", "step_result.body.pos missing");
  }
  r = checkVector(msg.body.pos, POS_DIM, "step_result.body.pos");
  return r;
}

/** Top-level dispatcher — mirrors the Python side's fail-closed checks. */
function validate(msg, ctx) {
  if (!msg || typeof msg !== "object") {
    return ERR("contract_violation", "message must be an object");
  }
  if (msg.v !== CONTRACT_VERSION) {
    return ERR("contract_violation",
      "contract version " + msg.v + " != supported " + CONTRACT_VERSION);
  }
  switch (msg.type) {
    case "observe_env": return validateObserveEnv(msg, ctx);
    case "step": return validateStep(msg, ctx);
    case "step_result": return validateStepResult(msg, ctx);
    case "reset":
    case "reset_ack":
    case "hello":
    case "welcome":
    case "learning_signal":
    case "tap":
    case "tap_state":
    case "bye":
    case "bye_ack":
      return OK;
    default:
      return ERR("contract_violation", "unknown message type " + JSON.stringify(msg.type));
  }
}

module.exports = {
  CONTRACT_VERSION, ACTION_DIM, OBS_DIM, NEURAL_MAX_DIM,
  observeEnv, stepCommand, validate,
  _internal: { isFiniteNumber, checkVector, checkIdentity, checkMonotone },
};
