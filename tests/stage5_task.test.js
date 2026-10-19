#!/usr/bin/env node
"use strict";
/**
 * tests/stage5_task.test.js — STAGE 5: the first physical closed-loop TASK
 * (AGENT TASK Stage 5). A pushable PILLAR exists in the MuJoCo scene; the
 * canonical FAFB-constrained brain drives the Flybody walker through the
 * unchanged 200→16→59 motor pathway; MuJoCo contact physics lets the fly
 * MOVE the pillar; the task sensor folds the pillar into the unchanged 8-bin
 * visual field; the task reward (physical displacement/contact only) rides
 * the EXISTING reward pathway (receiveFeedback → DA → plasticity).
 *
 * Causality tests (AGENT TASK §13), from telemetry of REAL MuJoCo physics
 * (skipped, loudly, when the flybody stack is absent):
 *   T1  target affects vision      (pillar teleport → 8 bins change)
 *   T2  vision reaches the brain   (controlled visual contrast → different
 *                                   canonical neural output)
 *   T3  brain reaches motor output (sustained perturbation → motor telemetry)
 *   T4  motor output reaches Flybody (calibrated intent contrast through the
 *                                   REAL actuator_map → pillar displacement)
 *   T5  fly affects environment    (walker-pillar contact moves the pillar)
 *   T6  environment change → vision (bins follow the pillar the fly moved)
 *   T7  reward stays causal        (task reward → receiveFeedback → DA)
 *   T8  proprioception no-regress  (7 contact/proprio channels live)
 *   T9  motor contract no-regress  (200 → 59 every step)
 *   T10 protocol unchanged         (OBS_DIM 15, contract v1, task opt-in)
 *   T11 determinism                (identical episodes ⇒ identical telemetry)
 * Guards: R11 unknown task fails closed; R12 proxy-mode provenance (mock CI);
 * R13 python-free wiring pins.
 *
 * Run: node --test tests/stage5_task.test.js
 * Env: CL_MODE=mock (proxy chain only), PYTHON_EMBODIMENT, E9_CIRCUIT_PATH,
 *      S5_STEPS (default 60), S5_T4_STEPS (default 120).
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const { EmbodimentClient } = require("../embodiment/embodiment_client");
const contract = require("../embodiment/state_contract");
const core = require("../embodiment/closed_loop_core");
core.init((spec) => spec === "state_contract" ? contract
  : spec === "experiment_core" ? require("../experiment_core")
  : require("../controllers"));   // "controllers"

const PYTHON = process.env.PYTHON_EMBODIMENT
  || (fs.existsSync(path.join(ROOT, ".venv-embodiment", "Scripts", "python.exe"))
        ? path.join(ROOT, ".venv-embodiment", "Scripts", "python.exe")
        : "python");
const CIRCUIT_PATH = process.env.E9_CIRCUIT_PATH ||
  path.join(ROOT, "fly_brain_circuit.json");
const REAL = process.env.CL_MODE !== "mock";
const STEPS = parseInt(process.env.S5_STEPS || "60", 10);
const T4_STEPS = parseInt(process.env.S5_T4_STEPS || "120", 10);

let CIRCUIT = null;
function circuit() {
  if (!CIRCUIT) CIRCUIT = JSON.parse(fs.readFileSync(CIRCUIT_PATH, "utf8"));
  return CIRCUIT;
}
function startSidecar() {
  const cl = new EmbodimentClient({ body: REAL ? "flybody" : "mock" }).start();
  cl.stop = async () => {
    try { cl.child.kill(); } catch {}
  };
  return cl;
}

// --- python-side probes (deterministic, in-process, no wire) -----------------
function pyProbe(script, timeout = 300000) {
  return execFileSync(PYTHON, ["-c", script], {
    cwd: ROOT, encoding: "utf8", timeout,
    env: Object.assign({}, process.env, { MUJOCO_GL: "disable" }),
  });
}
const PYOK = (() => {
  if (!REAL) return false;
  try { return pyProbe("import mujoco, flybody; print('ok')", 120000).trim().endsWith("ok"); }
  catch { return false; }
})();

// T4 stimulus: u[0:6]=0.9 (stance), u[6:12]=0.1 (swing), trims 0.5 — the
// Stage 5 probe pattern whose actuator_map output holds the walker ~in place,
// against SILENT decoder output (u=0.5) whose output sweeps the walker ~0.13
// m into the pillar. Both go through the REAL MotorDecoder.actuator_map and
// the REAL FlybodyDriver.step — the unchanged u→a59→MuJoCo pipeline stages.
const T4_SCRIPT = `
import os, json
os.environ.setdefault("MUJOCO_GL", "disable")
import sys; sys.path.insert(0, "embodiment")
import numpy as np
from sidecar import Sidecar, FlybodyDriver
from motor_decoder import MotorDecoder
import task_pillar
def u_pattern():
    u = np.full(16, 0.5); u[0:6] = 0.9; u[6:12] = 0.1
    return u
out = {}
for name, uvec in (("silent", np.full(16, 0.5)), ("driven", u_pattern())):
    sc = Sidecar(body="flybody")
    sc.handle({"type": "hello", "client": "t4", "task": "pillar"})
    sc.handle({"type": "reset", "seed": 11, "episode": 1})
    dec = MotorDecoder(seed=0)
    a59 = dec.actuator_map(uvec)          # the REAL fixed map (unchanged)
    disp = 0.0; touch = 0
    for t in range(${T4_STEPS}):
        sc.body.step(a59)                 # the REAL physical pipeline stage
        ph = sc.body.env.physics
        st = task_pillar.pillar_state(ph)
        disp = max(disp, float(np.linalg.norm(np.array(st["pos"][:2]) -
                                              np.array(task_pillar.PILLAR_POS[:2]))))
        touch += int(task_pillar.pillar_contact_steps(ph) > 0)
    out[name] = {"disp": round(disp, 5), "touch_steps": touch}
print(json.dumps(out))
`;

// ------------------------------------------------------------ helpers --------
function burstNeural(t) {
  // deterministic crafted stimulus (same shape as the smoke test's driver)
  const k = 200, out = new Array(k).fill(0.02);
  let s = (11 + t * 7) >>> 0;
  const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const nOn = Math.floor(k * 0.35);
  for (let j = 0; j < nOn; j++) out[Math.floor(rng() * k)] = 0.35 + 0.25 * rng();
  return out;
}
function neuralStep(t, neural) {
  return { type: "step", v: contract.CONTRACT_VERSION, episode: 0,
           t_neural: t, neural, learn: 0.0 };
}
const l1 = (a, b) => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0);

// ---------------------------------------------------------------- session ----
let CL = null, ACK = null, OBS_A = null, OBS_B = null, RUN = null;

// one shared REAL session across the suite (opened in setup); closed once
test.after(async () => {
  if (CL) { await CL.stop(); CL = null; }
});

test("S5 setup: sidecar session with pillar task on REAL flybody", { skip: !PYOK && "flybody stack unavailable" }, async () => {
  CL = startSidecar();
  const welcome = await CL.send({ type: "hello", v: contract.CONTRACT_VERSION, task: "pillar" });
  assert.strictEqual(welcome.mode, "flybody", "task session must run real flybody");
  assert.strictEqual(welcome.task, "pillar", "welcome echoes the task opt-in");
  ACK = await CL.send({ type: "reset", seed: 11, episode: 0 });
  assert.ok(ACK.obs0.length === contract.OBS_DIM);
  OBS_A = ACK.obs0.slice();
});

test("T1 target affects vision: pillar teleport changes the 8-bin visual field", { skip: !PYOK && "flybody stack unavailable" }, async () => {
  assert.ok(ACK, "session missing");
  const pre = ACK.obs0.slice(0, 8);
  const tap = await CL.send({ type: "tap", op: "pillar_set_pose", x: 0.05, y: -0.05 });
  assert.strictEqual(tap.type, "tap_state");
  assert.deepStrictEqual(tap.pillar_pos, [0.05, -0.05, 0.040]);
  // one driven step refreshes the observation from the moved scene
  const step = await CL.send(neuralStep(0, burstNeural(0)));
  const post = step.obs_next.slice(0, 8);
  assert.ok(l1(pre, post) > 0.01,
    `visual bins must track the moved pillar (L1 ${l1(pre, post).toFixed(3)})`);
  // controlled T2/T3 contrast: post-teleport VISUAL with proprio held
  // identical to OBS_A (isolates the visual channel)
  OBS_B = post.concat(OBS_A.slice(8));
  assert.ok(l1(OBS_A.slice(0, 8), OBS_B.slice(0, 8)) > 0.01);
  assert.deepStrictEqual(OBS_B.slice(8), OBS_A.slice(8));
});

// Controlled design for T2/T3: TWO FRESH BRAINS from the same seed (identical
// initial weights, RNG stream, and state) are driven with the two observation
// sequences — the ONLY difference between conditions is the visual input, so
// any output difference is causally attributable to the visual channel (the
// connectome propagates over multiple ticks, so sequences are compared).
function driveSeq(obs, ticks, learning) {
  const brain = core.buildBrain(circuit(), 11);
  brain.setLearning(!!learning);
  const out = [];
  for (let t = 0; t < ticks; t++) out.push(core.driveBrain(brain, obs));
  return out;
}
const SEQ_TICKS = 16;

test("T2 vision reaches the brain: controlled visual contrast changes canonical neural output", { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const va = core.sensoryTransform(OBS_A);
  const vb = core.sensoryTransform(OBS_B);
  assert.ok(va.visual.some((x, i) => x !== vb.visual[i]), "visual split differs");
  assert.deepStrictEqual(va.contact, vb.contact, "proprio held identical");
  const seqA = driveSeq(OBS_A, SEQ_TICKS, true);
  const seqB = driveSeq(OBS_B, SEQ_TICKS, true);
  const diffTicks = seqA.filter((r, i) =>
    r.neural.some((x, j) => x !== seqB[i].neural[j])).length;
  assert.ok(diffTicks > 0,
    `canonical 200-vector must differ under different visual input (${diffTicks}/${SEQ_TICKS} ticks)`);
});

test("T3 brain reaches motor output: sustained perturbation reaches motor telemetry", { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const seqA = driveSeq(OBS_A, SEQ_TICKS, false);
  const seqB = driveSeq(OBS_B, SEQ_TICKS, false);
  assert.ok(seqA.some((r, i) => r.motorRate !== seqB[i].motorRate),
    "sustained visual difference must propagate to motor telemetry within ticks");
});

test("T4 motor output reaches Flybody: calibrated intent contrast moves the pillar via real physics", { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const out = JSON.parse(pyProbe(T4_SCRIPT));
  assert.ok(out.silent.touch_steps > 0, "silent decoder output must contact the pillar");
  assert.ok(out.silent.disp > 0.005,
    `silent-drive sweep must displace the pillar (${out.silent.disp} m)`);
  assert.ok(out.driven.disp < out.silent.disp,
    `driven intents must gate the interaction (${out.driven.disp} < ${out.silent.disp})`);
});

test("T5+T6 fly affects environment; the change reaches vision (closed loop)", { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const { records, taskName } = await core.runEpisode({
    send: (m) => CL.send(m), circuit: circuit(), seed: 11, steps: STEPS,
    learning: true, episode: 0, task: "pillar",
  });
  RUN = records;
  assert.strictEqual(taskName, "pillar");
  const tt = records.filter(r => r.task);
  assert.ok(tt.length === STEPS, "task telemetry on every step");
  assert.ok(tt.some(r => r.task.first_contact_step !== null),
    "walker-pillar contact must occur (MuJoCo contact physics)");
  assert.ok(tt.some(r => r.task.pillar_disp_norm > 0.005),
    `pillar must move under fly interaction (max ${Math.max(...tt.map(r => r.task.pillar_disp_norm)).toFixed(4)} m)`);
  // T6: post-interaction vision differs from initial vision — the changed
  // environment (pillar moved BY THE FLY) is what the brain sees next
  const l = l1(records[0].obs_bins, records[records.length - 1].obs_bins);
  assert.ok(l > 0.01, `closure: post-interaction vision differs (L1 ${l.toFixed(3)})`);
});

test("T7 reward stays causal: task reward → DA via receiveFeedback", { skip: !PYOK && "flybody stack unavailable" }, async () => {
  assert.ok(RUN.some(r => r.reward > 0), "task reward must fire");
  assert.ok(RUN.some(r => Math.abs(r.da_after - r.da_before) > 1e-9),
    "DA must respond to task reward via receiveFeedback");
  const src = fs.readFileSync(path.join(ROOT, "embodiment", "motor_decoder.py"), "utf8");
  assert.ok(!/def (readout|actuator_map)\([^)]*reward/.test(src),
    "decoder API must remain reward-blind");
});

test("T8 proprioception no-regress: 7 contact/proprio channels live", { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const live = RUN.filter(r => r.obs_proprio.some(x => x > 1e-6)).length;
  assert.ok(live > RUN.length * 0.5, `${live}/${RUN.length} steps carry live proprio`);
  assert.ok(RUN.every(r => r.obs_proprio.length === 7));
});

test("T9 motor contract no-regress: 200 spikes → 59 actuators every step", { skip: !PYOK && "flybody stack unavailable" }, async () => {
  assert.ok(RUN.every(r => r.neural.length === 200), "canonical motor pool = 200");
  assert.ok(RUN.every(r => r.action.length === contract.ACTION_DIM), "59-D actions");
});

test("T10 protocol unchanged: OBS_DIM=15, contract v1, task rides hello opt-in", { skip: !PYOK && "flybody stack unavailable" }, async () => {
  assert.strictEqual(contract.OBS_DIM, 15);
  assert.strictEqual(contract.CONTRACT_VERSION, 1);
  assert.ok(RUN.every(r => r.obs_bins.length === 8 && r.obs_proprio.length === 7));
});

test("T11 determinism: two identical task episodes produce identical telemetry", { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const hashes = [];
  for (const ep of [2, 3]) {
    const { records } = await core.runEpisode({
      send: (m) => CL.send(m), circuit: circuit(), seed: 21, steps: 25,
      learning: false, episode: ep, task: "pillar",
    });
    hashes.push(records.map(r => JSON.stringify(
      [r.obs_hash, r.motor_rate, r.reward, r.action, r.task.pillar_disp_norm])).join("|"));
  }
  assert.strictEqual(hashes[0], hashes[1], "episodes must be bit-replayable");
});

// ------------------------------------------------- mock-proxy chain (CI) ----
test("R12 proxy task chain: deterministic telemetry with honest mode stamp", { skip: REAL && "real-mode run covers the chain" }, async () => {
  const cl = startSidecar();
  const { records, gates, mode } = await core.runEpisode({
    send: (m) => cl.send(m), circuit: circuit(), seed: 5, steps: 30,
    learning: true, episode: 1, task: "pillar",
  });
  await cl.stop();
  assert.strictEqual(mode, "mock_body");
  assert.ok(records.every(r => r.task && r.task.mode === "proxy"),
    "proxy provenance stamped on every record");
  assert.ok(gates.g_task_interaction, "proxy interaction gate computed");
  assert.ok(gates.g_task_reward_causal, "proxy reward gate computed");
});

test("R11 unknown task opt-in fails closed", async () => {
  const cl = startSidecar();
  try {
    const w = await cl.send({ type: "hello", v: 1, task: "nonsense" });
    assert.strictEqual(w.type, "error");
    assert.strictEqual(w.code, "contract_violation");
  } finally { await cl.stop(); }
});

test("R13 core wiring (python-free): task opt-in, gates, record fields", () => {
  const src = fs.readFileSync(path.join(ROOT, "embodiment", "closed_loop_core.js"), "utf8");
  assert.match(src, /if \(task\) helloMsg\.task = task;/);
  assert.match(src, /if \(task\) \{[\s\S]{0,400}rec\.obs_bins = obs\.slice\(0, 8\);/);
  assert.match(src, /rec\.obs_proprio = obs\.slice\(8, 15\);/);
  assert.match(src, /g_task_interaction/);
  assert.match(src, /g_task_reward_causal/);
  const tsrc = fs.readFileSync(path.join(ROOT, "embodiment", "task_pillar.py"), "utf8");
  assert.match(tsrc, /SUCCESS_PILLAR_DISP = 0\.005/);
  assert.match(tsrc, /def reward\(/);
  assert.doesNotMatch(tsrc, /default_rng|RandomState|random\.seed/,
    "no RNG in the task module");
});
