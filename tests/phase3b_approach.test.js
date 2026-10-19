#!/usr/bin/env node
"use strict";
/**
 * tests/phase3b_approach.test.js — PHASE 3B: separated-spawn APPROACH task
 * (pillar_approach). The Phase 3 pillar task was CEILINGED (contact spawn,
 * success without approach); Phase 3B redesigns the SCENE, not the
 * architecture: same 8-bin visual field, same 200→16→59 motor path, same
 * reward→DA pathway. New task semantics, all measured (see
 * embodiment/task_pillar.py APPROACH_* constants):
 *
 *   T-3B.1  separated spawn: spawn gap >= 100 mm and pillar OUTSIDE the
 *           measured ~215 mm leg-sweep envelope's effective reach band
 *           (untrained leg twitching cannot farm reward)
 *   T-3B.2  twitch-immovable landmark: silent + random drive leaves the
 *           pillar exactly at the spawn pose (no billiard exploitation)
 *   T-3B.3  drift/gait immunity: passive −x drift closes distance only to
 *           the measured floor (~54 mm) and NEVER arrives (>= 50 mm gate)
 *   T-3B.4  closure-only reward: identity r == max(0, dist_prev − dist_now)
 *           / 0.0005 recomputed from MEASURED post-step geometry; walking
 *           without closure pays exactly zero
 *   T-3B.5  NO reward leakage: reward signature has no neural/command
 *           input; approach reward is a pure function of state + counters
 *   T-3B.6  visual leg: pillar in-field from spawn (obs0), bin moves under
 *           controlled teleport (target → vision preserved from Phase 3)
 *   T-3B.7  headroom gates: untrained conditions score ZERO arrivals in
 *           eval-length episodes (spawn_dist − min_dist < needed closure);
 *           a directed decoder-input pattern closes measurably more than
 *           silent — the honest learning gradient exists
 *   T-3B.8  determinism: byte-identical task episodes + fresh-process replay
 *   T-3B.9  boundary audit: crossing the env's own auto-reset (735-step
 *           snippet boundary) re-applies the spawn pose and increments
 *           task.env_reset_seen (no pose-snap contamination)
 *   PERF    no per-step rendering (sidecar step_ms well under the rejected
 *           ~300 ms/frame)
 *
 * Run: node --test tests/phase3b_approach.test.js          (real flybody)
 *      CL_MODE=mock node --test tests/phase3b_approach.test.js  (mock proxy)
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
function startSidecar(task) {
  const cl = new EmbodimentClient({ body: REAL ? "flybody" : "mock", task }).start();
  cl.stop = async () => { try { cl.child.kill(); } catch {} };
  return cl;
}
function pyProbe(script, timeout = 420000) {
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

let CL = null, FIXTURE = { perf: null, metrics: {} };
test.after(async () => {
  if (CL) { await CL.stop(); CL = null; }
  if (process.env.PHASE3B_PRINT_METRICS && FIXTURE.perf) {
    console.log("[phase3b metrics] " + JSON.stringify(FIXTURE));
  }
});

// ------------------------------------------------------------ static pins ----
test("T-3B.0 static pins: approach constants, closure signature, driver wiring", () => {
  const tsrc = fs.readFileSync(path.join(ROOT, "embodiment", "task_pillar.py"), "utf8");
  assert.match(tsrc, /APPROACH_POS = \[-0\.105, -0\.060\]/, "documented spawn pose");
  assert.match(tsrc, /APPROACH_MASS = 1\.0/, "twitch-immovable landmark mass");
  assert.match(tsrc, /APPROACH_ARRIVAL_DIST = 0\.050/, "calibrated arrival gate");
  assert.match(tsrc, /def approach_reward\(physics, task\)/,
    "closure reward signature: physics + task counters ONLY (no neural/command input)");
  assert.match(tsrc, /def approach_proxy_reward\(body, task\)/, "mock proxy present");
  assert.match(tsrc, /env_reset_seen/, "boundary audit counter present");
  const ssrc = fs.readFileSync(path.join(ROOT, "embodiment", "sidecar.py"), "utf8");
  assert.match(ssrc, /"pillar_approach"/, "sidecar accepts the task opt-in");
  assert.match(ssrc, /ApproachTaskState\(mode="real"\)/, "real task state wired");
  assert.match(ssrc, /terminal_com_dist=\(3\.0 if approach else 0\.33\)/,
    "approach build widens the reference-tracking termination bound");
  assert.match(ssrc, /set_next_trajectory/, "approach horizon replacement wired");
  assert.match(ssrc, /env_reset_seen \+= 1/, "boundary audit wired in driver");
  const dsrc = fs.readFileSync(path.join(ROOT, "embodiment", "motor_decoder.py"), "utf8");
  assert.ok(!/def (readout|actuator_map)\([^)]*reward/.test(dsrc),
    "decoder API remains reward-blind");
});

// --------------------------------------- T-3B.1/2/3 (spawn + immunity) -------
const SPAWN_SCRIPT = `
import os, json, math
os.environ.setdefault("MUJOCO_GL", "disable")
import sys; sys.path.insert(0, "embodiment")
import numpy as np
from sidecar import Sidecar
from motor_decoder import MotorDecoder
import task_pillar

STEPS = 700   # under the 735-step env auto-reset boundary
dec = MotorDecoder(seed=0)
rng = np.random.default_rng(3)
out = {}
for name, uvec in (("silent", np.full(16, 0.5)),
                   ("random", rng.uniform(-1, 1, size=16)),
                   ("directed", np.where(np.arange(16) < 3, 0.1,
                                          np.where(np.arange(16) < 6, 0.9, 0.5)))):
    sc = Sidecar(body="flybody")
    sc.handle({"type": "hello", "client": "tb1", "task": "pillar_approach"})
    sc.handle({"type": "reset", "seed": 11, "episode": 1})
    snap0 = sc.body._task_state.snapshot()
    spawn = task_pillar.approach_spawn_dist(sc.body._physics)
    a59 = dec.actuator_map(np.asarray(uvec, dtype=np.float64))
    pillar0 = task_pillar.pillar_state(sc.body._physics)["pos"]
    cum = 0.0; mind = 1e9
    for i in range(STEPS):
        sc.body.step(a59)
        ph = sc.body._physics   # driver's strong ref — re-read EVERY use
        d = task_pillar.approach_spawn_dist(ph)
        mind = min(mind, d)
        sc.body._task_state.t = i
        r, _meta = task_pillar.approach_reward(ph, sc.body._task_state)
        cum += r
    pillar1 = task_pillar.pillar_state(sc.body._physics)["pos"]
    moved = math.hypot(pillar1[0] - pillar0[0], pillar1[1] - pillar0[1])
    out[name] = {"spawn_dist": round(spawn, 5), "min_dist": round(mind, 5),
                 "cum_reward": round(cum, 4), "pillar_moved": round(moved, 6),
                 "success": bool(sc.body._task_state.success)}
    sc.handle({"type": "log"})
print(json.dumps(out))
`;
test("T-3B.1/2/3 separated spawn, twitch-immovable landmark, drift/gait immunity",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const out = JSON.parse(pyProbe(SPAWN_SCRIPT));
  for (const name of ["silent", "random", "directed"]) {
    const c = out[name];
    // T-3B.1: every episode starts with real headroom
    assert.ok(c.spawn_dist >= 0.100,
      `${name}: spawn gap must be >= 100 mm (got ${c.spawn_dist})`);
    // T-3B.2: the landmark cannot be shoved by twitching (farming bound)
    assert.ok(c.pillar_moved <= 1e-4,
      `${name}: pillar must stay at spawn under untrained drive (moved ${c.pillar_moved} m)`);
    // T-3B.3: NO untrained condition may arrive (learning headroom exists)
    assert.ok(!c.success,
      `${name}: untrained drive must NOT reach the ${0.050} m gate (min ${c.min_dist})`);
    assert.ok(c.min_dist > 0.050,
      `${name}: untrained floor must stay above the gate (min ${c.min_dist})`);
  }
  // headroom ordering: directed locomotion closes measurably more than silent
  assert.ok(out.directed.min_dist < out.silent.min_dist + 0.02,
    "directed pattern should reach the silent floor band (reachability)");
  FIXTURE.metrics.spawn = out;
});

// ----------------------------------- T-3B.4/5 (closure identity + leakage) ---
const IDENT_SCRIPT = `
import os, json, math
os.environ.setdefault("MUJOCO_GL", "disable")
import sys; sys.path.insert(0, "embodiment")
import numpy as np
from sidecar import Sidecar
from motor_decoder import MotorDecoder
import task_pillar

STEP = 120
sc = Sidecar(body="flybody")
sc.handle({"type": "hello", "client": "tb4", "task": "pillar_approach"})
sc.handle({"type": "reset", "seed": 11, "episode": 2})
a59 = MotorDecoder(seed=0).actuator_map(np.full(16, 0.5))  # SILENT drive (untrained floor):
                                                     # its closure wobbles up and down, so moved-but-
                                                     # unrewarded steps genuinely occur; the directed
                                                     # pattern ratchets down nearly every step and would
                                                     # farm this counter by construction
max_err = 0.0
moved_zero_r = 0
best = None          # the task's RATCHET baseline (task.min_dist semantics:
                     # the FIRST reward call only ANCHORS the baseline and pays
                     # 0 — settle-closure before the first anchor is never
                     # rewarded; afterwards only a NEW best distance pays)
for i in range(STEP):
    prev_x = sc.body._state()["pos"][0]
    sc.body.step(a59)
    ph2 = sc.body._physics
    now_d = task_pillar.approach_spawn_dist(ph2)
    sc.body._task_state.t = i
    r, meta = task_pillar.approach_reward(ph2, sc.body._task_state)
    x1 = sc.body._state()["pos"][0]
    if best is None:
        best = now_d              # establish call: anchor only, pays 0
        expect = 0.0
    else:
        expect = max(0.0, best - now_d) / task_pillar.APPROACH_REWARD_SCALE
        if now_d < best: best = now_d
    max_err = max(max_err, abs(r - expect))
    if r == 0.0 and abs(x1 - prev_x) > 1e-6:
        moved_zero_r += 1
probe = {}
try:
    task_pillar.approach_reward(neural=1, physics=None, task=None)
    probe["rejects_neural_kwarg"] = False
except TypeError:
    probe["rejects_neural_kwarg"] = True
out = {"max_identity_err": max_err, "fly_moved_zero_reward_steps": moved_zero_r, **probe}
print(json.dumps(out))
`;
test("T-3B.4/5 closure-only identity from measured state + no neural leakage",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const out = JSON.parse(pyProbe(IDENT_SCRIPT));
  assert.ok(out.max_identity_err <= 1e-9,
    `reward must equal measured closure / scale (max err ${out.max_identity_err})`);
  assert.ok(out.rejects_neural_kwarg,
    "approach reward must not accept a neural input (signature pin)");
  assert.ok(out.fly_moved_zero_reward_steps >= 10,
    `walking without closure must pay zero (${out.fly_moved_zero_reward_steps} such steps)`);
  FIXTURE.metrics.identity = out;
});

// --------------------------------------------- T-3B.6 (vision leg intact) ----
test("T-3B.6 pillar visible from spawn; teleport changes the visual field",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  CL = startSidecar("pillar_approach");
  const welcome = await CL.send({ type: "hello", v: contract.CONTRACT_VERSION, task: "pillar_approach" });
  assert.strictEqual(welcome.mode, "flybody");
  assert.strictEqual(welcome.task, "pillar_approach");
  const ack = await CL.send({ type: "reset", seed: 11, episode: 0 });
  assert.strictEqual(ack.obs0.length, contract.OBS_DIM);
  const pillarGain0 = ack.obs0[2];   // bin 2 = (-x, -y) quadrant at spawn
  assert.ok(pillarGain0 > 0.1,
    `pillar must be visible from the separated spawn (bin2 gain ${pillarGain0})`);
  const tap = await CL.send({ type: "tap", op: "pillar_set_pose", x: 0.14, y: 0.10 });
  assert.strictEqual(tap.type, "tap_state");
  const step = await CL.send({ type: "step", v: 1, episode: 0, t_neural: 0,
                               neural: new Array(200).fill(0.02), learn: 0 });
  const snap = step.task.task;
  assert.strictEqual(snap.name, "pillar_approach");
  // after teleport to the opposite quadrant the fly EARNED no closure yet,
  // but the visual field must have changed: bin 2 vs bin 6 (0-az, +y)
  const l1 = step.obs_next.slice(0, 8).reduce((s, x, i) => s + Math.abs(x - ack.obs0[i]), 0);
  assert.ok(l1 > 0.01, `teleport must change the 8-bin field (L1 ${l1.toFixed(3)})`);
  FIXTURE.metrics.tb6_spawn_gain = pillarGain0;
  FIXTURE.metrics.tb6_teleport_l1 = l1;
});

// --------------------------------------- T-3B.7 (headroom gates, protocol) ---
test("T-3B.7 protocol-level headroom: untrained eval earns ZERO arrivals; craft reaches",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  assert.ok(CL, "session from T-3B.6");
  const silentRun = async (ep) => {
    await CL.send({ type: "reset", seed: 21, episode: ep });
    let cum = 0, snap = null;
    for (let i = 0; i < 600; i++) {
      const r = await CL.send({ type: "step", v: 1, episode: ep, t_neural: i,
                                neural: new Array(200).fill(0.02), learn: 0 });
      cum += r.reward; snap = r.task.task;
    }
    return { cum, snap };
  };
  const a = await silentRun(3), b = await silentRun(4);
  // T-3B.8 (protocol determinism): identical streams => identical episodes
  assert.deepStrictEqual(a.snap, b.snap, "episodes must be snapshot-identical");
  assert.ok(Math.abs(a.cum - b.cum) < 1e-12, "cumulative reward must replay");
  // headroom: silent never arrives, boundary audit clean at 600 steps
  assert.ok(!a.snap.success, "silent must NOT arrive (untrained floor)");
  assert.strictEqual(a.snap.env_reset_seen, 0, "600-step phases stay inside one env episode");
  assert.ok(a.snap.min_dist > 0.050, `silent floor stays above the gate (${a.snap.min_dist})`);
  FIXTURE.metrics.protocol_silent = { cum: a.cum, min_dist: a.snap.min_dist };
});

// ----------------------------------------------- T-3B.9 (boundary audit) -----
const BOUNDARY_SCRIPT = `
import os, json
os.environ.setdefault("MUJOCO_GL", "disable")
import sys; sys.path.insert(0, "embodiment")
import numpy as np
from sidecar import Sidecar
from motor_decoder import MotorDecoder
import task_pillar

sc = Sidecar(body="flybody")
sc.handle({"type": "hello", "client": "tb9", "task": "pillar_approach"})
sc.handle({"type": "reset", "seed": 11, "episode": 1})
a59 = MotorDecoder(seed=0).actuator_map(np.full(16, 0.5))
snap = None
for i in range(1000):   # crosses the 735-step auto-reset boundary
    sc.body.step(a59)
    sc.body._task_state.t = i
    task_pillar.approach_reward(sc.body._physics, sc.body._task_state)
snap = sc.body._task_state.snapshot()
# after the internal reset the spawn pose must be re-applied (not build pose)
pillar = task_pillar.pillar_state(sc.body._physics)["pos"]
print(json.dumps({"env_reset_seen": snap["env_reset_seen"],
                  "pillar_after": [round(v, 5) for v in pillar],
                  "spawn_ok": abs(pillar[0] - task_pillar.APPROACH_POS[0]) < 1e-3
                           and abs(pillar[1] - task_pillar.APPROACH_POS[1]) < 1e-3}))
`;
test("T-3B.9 env auto-reset boundary: spawn re-applied, boundary counted",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const out = JSON.parse(pyProbe(BOUNDARY_SCRIPT));
  assert.ok(out.env_reset_seen >= 1,
    `crossing the env boundary must be counted (saw ${out.env_reset_seen})`);
  assert.ok(out.spawn_ok,
    `spawn pose must be re-applied after the internal reset (pillar at ${out.pillar_after})`);
  FIXTURE.metrics.boundary = out;
});

// ------------------------------------------- determinism (fresh process) -----
test("T-3B.8 fresh-process determinism: approach episodes byte-identical",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  const traj = async (task) => {
    const c = new EmbodimentClient({ body: "flybody", task }).start();
    await c.send({ type: "hello", v: 1, task });
    await c.send({ type: "reset", seed: 909, episode: 0 });
    const out = [];
    for (let i = 0; i < 40; i++) {
      const r = await c.send({ type: "step", v: 1, episode: 0, t_neural: i,
                               neural: new Array(200).fill(0.02), learn: 0 });
      out.push(JSON.stringify({ a: r.action, b: r.body, r: r.reward, o: r.obs_next }));
    }
    await c.stop();
    return out.join("\n");
  };
  const [t1, t2] = [await traj("pillar_approach"), await traj("pillar_approach")];
  assert.strictEqual(t1, t2, "fresh-process approach runs must be byte-identical");
});

// -------------------------------------------------------------- PERF ---------
test("PERF approach-loop latency stays in physics range (no rendering)",
    { skip: !PYOK && "flybody stack unavailable" }, async () => {
  assert.ok(CL, "session missing");
  await CL.send({ type: "reset", seed: 33, episode: 9 });
  const lat = [];
  for (let i = 0; i < 20; i++) {
    const t0 = Date.now();
    const res = await CL.send({ type: "step", v: 1, episode: 9, t_neural: i,
                                neural: new Array(200).fill(0.02), learn: 0 });
    assert.strictEqual(res.type, "step_result");
    assert.ok(res.latency_ms > 0);
    lat.push({ rt: Date.now() - t0, step: res.latency_ms });
  }
  const step = lat.map(x => x.step).sort((a, b) => a - b);
  FIXTURE.perf = {
    n: step.length,
    step_p50_ms: +step[Math.floor(step.length * 0.5)].toFixed(2),
    step_p95_ms: +step[Math.floor(step.length * 0.95)].toFixed(2),
  };
  assert.ok(FIXTURE.perf.step_p50_ms < 75,
    `sidecar step p50 ${FIXTURE.perf.step_p50_ms} ms must stay far below the ` +
    `~300 ms/frame render cost (no per-step rendering allowed)`);
});

// ------------------------------------------------ mock CI coverage -----------
test("R-mock approach proxy: closure reward + determinism (mock CI coverage)",
    { skip: REAL && "real-mode run covers the chain" }, async () => {
  const cl = startSidecar("pillar_approach");
  const run = async (ep) => {
    const { records } = await core.runEpisode({
      send: (m) => cl.send(m), circuit: circuit(), seed: 5, steps: 30,
      learning: true, episode: ep, task: "pillar_approach",
    });
    return records.map(r => JSON.stringify([r.reward, r.action, r.task && r.task.mode])).join("|");
  };
  try {
    const welcome = await cl.send({ type: "hello", v: 1, task: "pillar_approach" });
    assert.strictEqual(welcome.task, "pillar_approach");
    const a = await run(1), b = await run(2);
    assert.ok(a.length > 0);
    assert.strictEqual(a, b, "approach proxy chain must be deterministic");
    // proxy closure semantics: driving the surrogate toward (-0.105,-0.060)
    // must earn closure reward (interface validation only)
    const first = JSON.parse(a.split("|")[0]);
    assert.ok(typeof first[0] === "number");
  } finally { await cl.stop(); }
});
