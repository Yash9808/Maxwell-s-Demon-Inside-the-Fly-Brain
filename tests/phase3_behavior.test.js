#!/usr/bin/env node
"use strict";
/**
 * tests/phase3_behavior.test.js — PHASE 3: closed-loop BEHAVIORAL validation
 * (AGENT TASK Phase 3 §5) on the adopted physical task (the pillar;
 * FLYBODY_ARCHITECTURE.md §9). Complements tests/stage5_task.test.js (the
 * task's own T1–T11 causality suite): this suite adds the behavioral-loop
 * proofs the Phase 3 brief demands BY NAME —
 *
 *   T-B1  target movement → visual change        (controlled teleport)
 *   T-B2  visual change → neural response        (contrasted brains, JS)
 *   T-B3  neural response → decoded action       (decoder-boundary contrast)
 *   T-B4  action → body state                    (u-contrast → MuJoCo states)
 *   T-B5  body state → reward                    (different physics ⇒ different
 *                                               reward; reward NOT a function
 *                                               of the commanded action)
 *   T-B6  complete closed loop                   (brain → pillar → next vision)
 *   T-B7  NO reward leakage                      (reward == pillar-displacement
 *                                               identity from MEASURED state,
 *                                               no neural input in the reward
 *                                               path, no reward without pillar
 *                                               motion while the fly moves)
 *   T-B8  determinism                            (byte-identical episodes AND
 *                                               fresh-process protocol replay)
 *   PERF per-step latency without rendering
 *
 * Run: node --test tests/phase3_behavior.test.js          (real flybody)
 *      CL_MODE=mock node --test tests/phase3_behavior.test.js  (JS-only tests)
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

let CIRCUIT = null;
function circuit() {
  if (!CIRCUIT) CIRCUIT = JSON.parse(fs.readFileSync(CIRCUIT_PATH, "utf8"));
  return CIRCUIT;
}
function startSidecar() {
  const cl = new EmbodimentClient({ body: REAL ? "flybody" : "mock" }).start();
  cl.stop = async () => { try { cl.child.kill(); } catch {} };
  return cl;
}
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

function burstNeural(t) {
  // deterministic crafted stimulus (same shape as the smoke test's driver)
  const k = 200, out = new Array(k).fill(0.02);
  let s = (11 + t * 7) >>> 0;
  const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const nOn = Math.floor(k * 0.35);
  for (let j = 0; j < nOn; j++) out[Math.floor(rng() * k)] = 0.35 + 0.25 * rng();
  return out;
}
const l1 = (a, b) => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0);

// ---------------------------------------------------------------- session ----
let CL = null, FIXTURE = { perf: null, determinism: null, metrics: {} };
test.after(async () => {
  if (CL) { await CL.stop(); CL = null; }
  if (process.env.PHASE3_PRINT_METRICS && FIXTURE.perf) {
    console.log("[phase3 metrics] " + JSON.stringify(FIXTURE));
  }
});

// ------------------------------------------------ T-B1 (target → vision) -----
test("T-B1 target movement → visual change (controlled teleport) + fixture",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  CL = startSidecar();
  const welcome = await CL.send({ type: "hello", v: contract.CONTRACT_VERSION, task: "pillar" });
  assert.strictEqual(welcome.mode, "flybody");
  const ack = await CL.send({ type: "reset", seed: 11, episode: 0 });
  assert.strictEqual(ack.obs0.length, contract.OBS_DIM);
  const pre = ack.obs0.slice(0, 8);
  // experimenter teleport (the sidecar's deterministic tap op; BETWEEN steps,
  // never part of the closed loop) — the ONLY thing that changes is the target
  const tap = await CL.send({ type: "tap", op: "pillar_set_pose", x: 0.05, y: -0.05 });
  assert.strictEqual(tap.type, "tap_state");
  const step = await CL.send({ type: "step", v: 1, episode: 0, t_neural: 0,
                               neural: burstNeural(0), learn: 0 });
  const post = step.obs_next.slice(0, 8);
  assert.ok(l1(pre, post) > 0.01,
    `moving the target must change the 8-bin visual field (L1 ${l1(pre, post).toFixed(3)})`);
  // controlled visual contrast for the JS tests: post-teleport VISUAL with
  // proprio held identical (isolates the visual channel)
  FIXTURE.OBS_B = post.concat(ack.obs0.slice(8));
  FIXTURE.OBS_A = ack.obs0.slice();
  assert.deepStrictEqual(FIXTURE.OBS_B.slice(8), FIXTURE.OBS_A.slice(8));
});

// ------------------- T-B2/T-B3 (vision → neural → decoded action, JS-only) ---
// Two fresh same-seed brains driven with two observations differing ONLY in
// the visual bins; the ONLY free variable is the visual input, so any output
// difference is causally attributable to it. Then the two divergent neural
// vectors go through the REAL frozen MotorDecoder → different 59-D actions.
test("T-B2/T-B3 visual contrast → neural divergence → decoded-action divergence", () => {
  const OBS_A = FIXTURE.OBS_A ||
    new Array(contract.OBS_DIM).fill(0.1);          // mock fallback: synthetic pair
  const OBS_B = FIXTURE.OBS_B ||
    OBS_A.map((v, i) => i === 0 ? v + 0.5 : v);
  assert.ok(l1(OBS_A.slice(0, 8), OBS_B.slice(0, 8)) > 0.01, "visual contrast present");
  assert.deepStrictEqual(OBS_A.slice(8), OBS_B.slice(8), "proprio held identical");

  const driveSeq = (obs, ticks) => {
    const brain = core.buildBrain(circuit(), 11);
    brain.setLearning(false);                    // isolate from plasticity
    const out = [];
    for (let t = 0; t < ticks; t++) out.push(core.driveBrain(brain, obs));
    return out;
  };
  const TICKS = 16;
  const seqA = driveSeq(OBS_A, TICKS);
  const seqB = driveSeq(OBS_B, TICKS);

  // T-B2: canonical 200-vector diverges under visual-only contrast
  const divergent = seqA.map((r, i) => i)
    .filter(i => seqA[i].neural.some((x, j) => x !== seqB[i].neural[j]));
  assert.ok(divergent.length > 0,
    `visual contrast must reach the motor pool (${divergent.length}/${TICKS} ticks)`);

  // T-B3 (decoder boundary): covered by T-B3b below — the decoder lives in
  // python (MotorDecoder, frozen projections), so the neural→action contrast
  // is proven against the REAL decoder in-process.
});

// The decoder is python-side (MotorDecoder, frozen projections), so T-B3's
// decoder-boundary contrast runs through the REAL python decoder in-process:
test("T-B3b divergent neural vectors → different 59-D actuator commands (real decoder)",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const OBS_A = FIXTURE.OBS_A, OBS_B = FIXTURE.OBS_B;
  const driveSeq = (obs, ticks) => {
    const brain = core.buildBrain(circuit(), 11);
    brain.setLearning(false);
    const out = [];
    for (let t = 0; t < ticks; t++) out.push(core.driveBrain(brain, obs));
    return out;
  };
  const seqA = driveSeq(OBS_A, 16), seqB = driveSeq(OBS_B, 16);
  let pickA = null, pickB = null;
  for (let i = 0; i < seqA.length && !pickA; i++) {
    if (seqA[i].neural.some((x, j) => x !== seqB[i].neural[j])) {
      pickA = seqA[i].neural; pickB = seqB[i].neural;
    }
  }
  assert.ok(pickA, "no divergent neural pair found (T-B2 must pass first)");
  const script = `
import json, sys
sys.path.insert(0, "embodiment")
from motor_decoder import MotorDecoder
dec = MotorDecoder(seed=0)
nA = json.loads(${JSON.stringify(JSON.stringify(pickA))})
nB = json.loads(${JSON.stringify(JSON.stringify(pickB))})
aA = dec.actuator_map(dec.readout(nA))
aB = dec.actuator_map(dec.readout(nB))
d = max(abs(x - y) for x, y in zip(aA, aB))
print(json.dumps({"max_action_delta": round(d, 6)}))
`;
  const out = JSON.parse(pyProbe(script, 120000));
  assert.ok(out.max_action_delta > 0.01,
    `divergent neural output must decode to different actions (max Δa59 ${out.max_action_delta})`);
  FIXTURE.metrics.tb3_max_action_delta = out.max_action_delta;
});

// ------------------ T-B4/T-B5 (action → body; body → reward) ----------------
// Real MuJoCo: two FIXED decoder inputs (silent 0.5 vs calibrated hold) drive
// the fly into different physical states with different accumulated rewards.
// The reward difference must be bounded by the PHYSICAL difference (identity),
// not by the action magnitude — the counter-evidence against "reward tracks
// the command".
const TB45_SCRIPT = `
import os, json, math
os.environ.setdefault("MUJOCO_GL", "disable")
import sys; sys.path.insert(0, "embodiment")
import numpy as np
from sidecar import Sidecar
from motor_decoder import MotorDecoder
import task_pillar

STEP = 60
dec = MotorDecoder(seed=0)
def u_driven():
    u = np.full(16, 0.5); u[0:6] = 0.9; u[6:12] = 0.1
    return u
out = {}
for name, uvec in (("silent", np.full(16, 0.5)), ("driven", u_driven())):
    sc = Sidecar(body="flybody")
    sc.handle({"type": "hello", "client": "tb45", "task": "pillar"})
    sc.handle({"type": "reset", "seed": 11, "episode": 1})
    a59 = dec.actuator_map(uvec)
    x0 = sc.body._state()["pos"][0]
    cum = 0.0; pillar_path = 0.0; touch = 0
    prev_post = None
    for i in range(STEP):
        sc.body.step(a59)
        ph = sc.body._physics   # the driver's strong ref — re-read EVERY use
                                # (dm_control wrappers are transient; a cached
                                # env.physics weakref can be reaped mid-loop)
        p = task_pillar.pillar_state(ph)["pos"]
        if prev_post is not None:   # segments AFTER a step: exactly the timing
            pillar_path += math.hypot(p[0] - prev_post[0],  # the dense reward
                                      p[1] - prev_post[1])  # uses (step 0 earns
        prev_post = p                                          # no dense term)
        r, meta = sc.body.task_reward(0.0)
        cum += r
        if meta.get("event", "").startswith("first_contact"):
            touch = 1
    x1 = sc.body._state()["pos"][0]
    out[name] = {"dx": round(x1 - x0, 5), "pillar_path": round(pillar_path, 6),
                 "cum_reward": round(cum, 5), "touch": touch}
print(json.dumps(out))
`;
test("T-B4/T-B5 different neural conditions → different physics → different rewards",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const out = JSON.parse(pyProbe(TB45_SCRIPT));
  const dBody = Math.abs(out.silent.dx - out.driven.dx);
  const dReward = Math.abs(out.silent.cum_reward - out.driven.cum_reward);
  assert.ok(dBody > 1e-4,
    `different decoded actions must reach different body states (|Δdx| ${dBody} m)`);
  assert.ok(dReward > 1e-6,
    `different physical outcomes must earn different rewards (|Δcum| ${dReward})`);
  // counter-evidence: in EACH condition the cumulative reward equals the
  // measured cumulative pillar path / scale (+ the one-time touch bonus) —
  // reward is a function of physical task progress only, never of the
  // commanded action (which differs maximally between the conditions).
  for (const name of ["silent", "driven"]) {
    const c = out[name];
    const expect = c.pillar_path / 0.0005 + 0.25 * c.touch;
    assert.ok(Math.abs(c.cum_reward - expect) < 1e-3,
      `${name}: reward must be the measured pillar-path identity ` +
      `(${c.cum_reward} vs ${expect.toFixed(4)})`);
  }
  FIXTURE.metrics.tb45 = out;
});

// --------------------------- T-B6 (complete closed loop) ---------------------
test("T-B6 complete closed loop: brain → physical pillar change → next-tick vision",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const { records, gates } = await core.runEpisode({
    send: (m) => CL.send(m), circuit: circuit(), seed: 11, steps: 60,
    learning: false, episode: 6, task: "pillar",   // learning OFF: pure causal loop
  });
  assert.ok(records.every(r => r.task), "task telemetry on every step");
  const maxDisp = Math.max(...records.map(r => r.task.pillar_disp_norm));
  assert.ok(maxDisp > 1e-4,
    `the brain-driven fly must physically move the pillar (max ${maxDisp.toFixed(4)} m)`);
  const closure = l1(records[0].obs_bins, records[records.length - 1].obs_bins);
  assert.ok(closure > 0.01,
    `the fly-caused environment change must reach next-tick vision (L1 ${closure.toFixed(3)})`);
  assert.ok(gates.g_action_dim && gates.g_physics_advanced, "loop gates intact");
  FIXTURE.metrics.tb6_max_disp = maxDisp;
  FIXTURE.metrics.tb6_closure_l1 = closure;
  // perf sample: per-step sidecar latency (no rendering anywhere in the loop)
  const lat = records.map(r => r.latency_ms || 0).filter(x => x > 0);
  if (lat.length) {
    lat.sort((a, b) => a - b);
    FIXTURE.perf = {
      n: lat.length,
      mean_ms: +(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(2),
      p50_ms: +lat[Math.floor(lat.length * 0.5)].toFixed(2),
      p95_ms: +lat[Math.floor(lat.length * 0.95)].toFixed(2),
    };
  }
});

// --------------------------- T-B7 (NO reward leakage) ------------------------
// Three independent proofs:
//   (1) IDENTITY from measured state: per-step reward == measured planar
//       pillar displacement / 0.0005 (+ the documented one-time touch bonus),
//       recomputed OUTSIDE the sidecar from post-step MuJoCo geometry.
//   (2) SIGNATURE: task_pillar.reward() does not even accept a neural input
//       (fails closed on any extra argument).
//   (3) NO REWARD FOR FREE: with the pillar teleported out of reach, the fly
//       walks ~25 mm (silent sweep) and earns EXACTLY 0 reward — action is
//       necessary but not sufficient; only physical task progress pays.
const TB7_SCRIPT = `
import os, json, math
os.environ.setdefault("MUJOCO_GL", "disable")
import sys; sys.path.insert(0, "embodiment")
import numpy as np
from sidecar import Sidecar
from motor_decoder import MotorDecoder
import task_pillar

STEP = 45
sc = Sidecar(body="flybody")
sc.handle({"type": "hello", "client": "tb7", "task": "pillar"})
sc.handle({"type": "reset", "seed": 11, "episode": 1})
a59 = MotorDecoder(seed=0).actuator_map(np.full(16, 0.5))
tap = sc.handle({"type": "tap", "op": "pillar_set_pose", "x": 0.17, "y": -0.05})
max_err = 0.0
rows = []
for i in range(STEP):
    ph = sc.body._physics   # driver's strong ref — re-read EVERY use
    prev_p = task_pillar.pillar_state(ph)["pos"]
    prev_x = sc.body._state()["pos"][0]
    sc.body.step(a59)
    st = task_pillar.pillar_state(sc.body._physics)
    r, meta = sc.body.task_reward(0.0)
    x1 = sc.body._state()["pos"][0]
    d_pillar = math.hypot(st["pos"][0] - prev_p[0], st["pos"][1] - prev_p[1])
    expect = d_pillar / task_pillar.REWARD_DISP_SCALE
    if meta.get("event", "").startswith("first_contact"):
        expect += task_pillar.REWARD_TOUCH
    max_err = max(max_err, abs(r - expect))
    if i >= 3:   # post-teleport: pillar out of reach, fly still walks
        rows.append((abs(x1 - prev_x), r))
moved_zero_r = [m for m, r in rows if r == 0.0 and m > 1e-6]
rewarded_post = [r for m, r in rows if abs(r) > 1e-12]
probe = {}
try:
    task_pillar.reward(neural=1, pillar_only=0)
    probe["rejects_neural_kwarg"] = False
except TypeError:
    probe["rejects_neural_kwarg"] = True
out = {"tap_pos": tap.get("pillar_pos"), "max_identity_err": max_err,
       "fly_moved_zero_reward_steps": len(moved_zero_r),
       "post_teleport_rewarded_steps": len(rewarded_post),
       "fly_motion_total_m": round(sum(m for m, _ in rows), 4),
       **probe}
print(json.dumps(out))
`;
test("T-B7 no reward leakage: measured-state identity, blind signature, no free reward",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const out = JSON.parse(pyProbe(TB7_SCRIPT));
  // (1) identity from MEASURED post-step geometry (recomputed externally)
  assert.ok(out.max_identity_err <= 1e-6,
    `reward must equal measured pillar displacement / 0.0005 (max err ${out.max_identity_err})`);
  // (2) the reward path structurally cannot read neural output
  assert.ok(out.rejects_neural_kwarg,
    "task reward must not accept a neural input (signature pin)");
  // (3) walking without task progress pays nothing
  assert.ok(out.fly_motion_total_m > 0.01,
    `fly must be moving in the leakage probe (${out.fly_motion_total_m} m)`);
  assert.strictEqual(out.post_teleport_rewarded_steps, 0,
    "steps with zero pillar motion must earn exactly zero reward");
  assert.ok(out.fly_moved_zero_reward_steps >= 20,
    `many moving steps with zero reward = action is not rewarded (${out.fly_moved_zero_reward_steps})`);
  // source pins: reward signature has no neural param; decoder stays reward-blind
  const tsrc = fs.readFileSync(path.join(ROOT, "embodiment", "task_pillar.py"), "utf8");
  assert.match(tsrc, /def reward\(_prev_x, physics, task\)/,
    "reward(pillar displacement | contact) only — no neural input");
  const dsrc = fs.readFileSync(path.join(ROOT, "embodiment", "motor_decoder.py"), "utf8");
  assert.ok(!/def (readout|actuator_map)\([^)]*reward/.test(dsrc),
    "decoder API must remain reward-blind");
  FIXTURE.metrics.tb7 = out;
});

// --------------------------- T-B8 (determinism) ------------------------------
test("T-B8 determinism: byte-identical task episodes AND fresh-process replay",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  // (a) same session, two episodes, identical command stream
  const hashes = [];
  for (const ep of [7, 8]) {
    const { records } = await core.runEpisode({
      send: (m) => CL.send(m), circuit: circuit(), seed: 21, steps: 25,
      learning: false, episode: ep, task: "pillar",
    });
    hashes.push(records.map(r => JSON.stringify(
      [r.obs_hash, r.motor_rate, r.reward, r.action, r.task.pillar_disp_norm])).join("|"));
  }
  assert.strictEqual(hashes[0], hashes[1], "episodes must be bit-replayable");
  // (b) fresh-process protocol replay: full chain, two independent sidecars
  const traj = async () => {
    const c = new EmbodimentClient({ body: "flybody" }).start();
    await c.send({ type: "hello", v: 1, task: "pillar" });
    await c.send({ type: "reset", seed: 909, episode: 0 });
    const out = [];
    for (let i = 0; i < 30; i++) {
      const r = await c.send({ type: "step", v: 1, episode: 0, t_neural: i,
                               neural: burstNeural(i), learn: 0 });
      out.push(JSON.stringify({ a: r.action, b: r.body, r: r.reward, o: r.obs_next }));
    }
    await c.stop();
    return out.join("\n");
  };
  const [t1, t2] = [await traj(), await traj()];
  assert.strictEqual(t1, t2, "fresh-process task runs must be byte-identical");
  FIXTURE.determinism = { episodes: true, freshProcess: true };
});

// --------------------------- performance --------------------------------------
// Direct measurement: per-step sidecar round-trip on the task scene. The
// loop contains NO rendering (MUJOCO_GL=disable provenance; the geometric
// sensor costs microseconds) — the honest bar is "far below the ~300 ms
// per-frame render cost the design pivot rejected".
test("PERF no per-step rendering: task-loop latency stays in physics range",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  assert.ok(CL, "session missing");
  await CL.send({ type: "reset", seed: 33, episode: 9 });
  const lat = [];
  for (let i = 0; i < 20; i++) {
    const t0 = Date.now();
    const res = await CL.send({ type: "step", v: 1, episode: 9, t_neural: i,
                                neural: burstNeural(i), learn: 0 });
    assert.strictEqual(res.type, "step_result");
    // res.latency_ms = the sidecar's INTERNAL step_ms (physics + sensor +
    // protocol), the honest no-rendering metric; the client round-trip also
    // carries JSON/pipe overhead and is recorded separately.
    assert.ok(res.latency_ms > 0);
    lat.push({ rt: Date.now() - t0, step: res.latency_ms });
  }
  const step = lat.map(x => x.step).sort((a, b) => a - b);
  const rt = lat.map(x => x.rt).sort((a, b) => a - b);
  FIXTURE.perf = {
    n: step.length,
    step_p50_ms: +step[Math.floor(step.length * 0.5)].toFixed(2),
    step_p95_ms: +step[Math.floor(step.length * 0.95)].toFixed(2),
    client_rt_p50_ms: rt[Math.floor(rt.length * 0.5)],
  };
  assert.ok(FIXTURE.perf.step_p50_ms < 75,
    `sidecar step p50 ${FIXTURE.perf.step_p50_ms} ms must stay far below the ` +
    `~300 ms/frame render cost (no per-step rendering allowed)`);
});

// --------------------------- mock CI coverage ---------------------------------
test("R12-mock proxy task chain stays deterministic (mock CI coverage)",
    { skip: REAL && "real-mode run covers the chain" }, async () => {
  const cl = startSidecar();
  const run = async (ep) => {
    const { records } = await core.runEpisode({
      send: (m) => cl.send(m), circuit: circuit(), seed: 5, steps: 30,
      learning: true, episode: ep, task: "pillar",
    });
    return records.map(r => JSON.stringify([r.reward, r.action, r.task.mode])).join("|");
  };
  try {
    const a = await run(1), b = await run(2);
    assert.ok(a.length > 0);
    assert.strictEqual(a, b, "proxy task chain must be deterministic");
  } finally { await cl.stop(); }
});
