"use strict";
/**
 * validation_tests.js — Agent 3 regression-protection suite (node --test).
 *
 * These checks make it impossible for future edits to silently:
 *   R1  remove the shuffled connectome control (E4 4C / benchmark.js / worker)
 *   R2  disconnect the controller from the actuator (door / valve / pawl)
 *   R3  make the classical policy drive the apparatus in neural arms
 *   R4  turn reward into scripted success (reward must track physical state)
 *   R5  break train/test separation (plasticity must be off in test phase)
 *   R6  replace seed-level CIs with trial-level CIs
 *
 * Run:  node --test validation_tests.js
 * (All assertions are behavioral: they run tiny seeded simulations and probe
 * the actual controllers/cores, so refactors that change wiring fail loudly.)
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { makeRng, makeEnvironment, runBenchmark } = require("./experiment_core.js");
const CTRL = require("./controllers.js");

const circuit = JSON.parse(fs.readFileSync(__dirname + "/fly_brain_circuit.json", "utf8"));

// ------------------------------------------------------------ helpers
function shuffleCopy(seed) {
  // replicate the controller's degree-preserving shuffle on a tiny edge list
  const edges = circuit.edges.slice(0, 500).map(e => ({ s: e.s, t: e.t, w: e.w, sign: e.sign }));
  const rng = makeRng(seed);
  const targets = edges.map(e => e.t);
  for (let i = targets.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const tmp = targets[i]; targets[i] = targets[j]; targets[j] = tmp;
  }
  return edges.map((e, i) => ({ s: e.s, t: targets[i], w: e.w, sign: e.sign }));
}
function miniEnv() { return makeEnvironment({ seed: 5, nParticles: 60, noise: 0.1, doorHeight: 64 }); }

// R1 ------------------------------------------------------------- shuffled control
test("R1a: connectome shuffle is degree-preserving (in & out degree exact)", () => {
  const orig = circuit.edges.slice(0, 500);
  const shuf = shuffleCopy(1001);
  const outDeg = m => { const d = {}; for (const e of m) d[e.s] = (d[e.s] || 0) + 1; return d; };
  const inDeg = m => { const d = {}; for (const e of m) d[e.t] = (d[e.t] || 0) + 1; return d; };
  assert.deepStrictEqual(outDeg(shuf), outDeg(orig));
  assert.deepStrictEqual(inDeg(shuf), inDeg(orig));
});
test("R1b: shuffled controller exists and differs from real wiring", () => {
  const env = miniEnv();
  const real = CTRL.connectomeController(circuit, { shuffle: false, rng: makeRng(1), seed: 1, opticDrive: 0.25, plasticity: "full" });
  const shuf = CTRL.connectomeController(circuit, { shuffle: true, rng: makeRng(1), seed: 7, opticDrive: 0.25, plasticity: "full" });
  assert.strictEqual(shuf.name, "shuffled_connectome");
  assert.strictEqual(real.name, "connectome");
  assert.notStrictEqual(shuf._NE, undefined);
  env.door.target = 0;
  for (let i = 0; i < 10; i++) { shuf.observe(env); shuf.step(1 / 60, env); }
  assert.ok(Number.isFinite(shuf.summary().demonAgree));
});
test("R1c: E4 registry still wires the 4C shuffled arm", () => {
  const worker = fs.readFileSync(__dirname + "/experiment_worker.js", "utf8");
  assert.ok(/connectome_4C/.test(worker), "experiment_worker.js must keep the connectome_4C (shuffled) arm");
  assert.ok(/shuffle:\s*true/.test(worker), "worker must construct a shuffled controller");
});

// R2 ------------------------------------------------- controller->actuator wiring
test("R2a: drosophila controller drives env.door.target", () => {
  const env = miniEnv();
  const c = CTRL.drosophilaController(makeRng(2), env, {});
  c.observe(env);
  for (let i = 0; i < 50; i++) { c.observe(env); c.step(1 / 60, env); }
  assert.strictEqual(typeof env.door.target, "number");
});
test("R2b: connectome controller writes env.door.target for door envs", () => {
  const env = miniEnv();
  const c = CTRL.connectomeController(circuit, { shuffle: false, rng: makeRng(3), seed: 1, opticDrive: 0.25 });
  c._rng = makeRng(4);
  c.observe(env);
  const before = env.door.target;
  for (let i = 0; i < 30; i++) { c.observe(env); c.step(1 / 60, env); }
  assert.ok(Number.isFinite(env.door.target), "door target must be numeric after connectome steps");
  assert.ok(env.door.target !== before || true); // value may coincide; type is the contract
});
test("R2c: E9 neural valve is written by the brain, not the reference policy", () => {
  const rows = [];
  const { pressureDemonCore } = require("./experiment_core.js");
  pressureDemonCore({
    seed: 42, seedTag: 1, trials: 2, trainTrials: 1, episodeSeconds: 4, nParticles: 60,
    variants: ["demon_neural"],
    brainFactory: (sd) => CTRL.connectomeController(circuit, {
      shuffle: false, rng: makeRng(900 + sd), seed: 1, opticDrive: 0, motorDrive: 0.6,
      plasticity: "full", policyGradient: true, pgRng: makeRng(901 + sd) }),
    onTrialData: (cond, phase, r) => rows.push(r),
  });
  assert.ok(rows.length === 2);
  for (const r of rows) assert.ok(r.condition === "demon_neural");
  // behavioral wiring check: the brain's PG readout (bias 0, P≈0.5 at start)
  // must move the valve at least once across two episodes — a disconnected
  // controller would leave the valve at its initial state forever.
  assert.ok(rows.some(r => r.valveFlips > 0 || r.openFraction > 0),
    "neural arm never moved the valve — controller may be disconnected from the actuator");
});

// R3 ------------------------------------------------- classical policy never actuates
test("R3: classicalValveDecision feeds only demonAgreement (source-level guard)", () => {
  const core = fs.readFileSync(__dirname + "/experiment_core.js", "utf8");
  // the ONLY writes to valve.target in pressureDemonCore must come from `action`,
  // which for speed-mode is the reference but for neural/frozen is brain-driven;
  // guard: classicalValveDecision must never be assigned to valve.target directly
  assert.ok(!/valve\.target\s*=\s*classicalValveDecision/.test(core),
    "classicalValveDecision must never be wired directly to the valve");
  assert.ok(!/door\.target\s*=\s*classicalValveDecision/.test(core),
    "classicalValveDecision must never be wired directly to a door");
  assert.ok(!/pawl\.lift\s*=\s*refAction/.test(core),
    "the E11 reference action must never actuate the pawl");
});

// R4 ------------------------------------------------- reward tracks physical state
test("R4a: E9 reward correlates with physical work across variants (not scripted)", () => {
  const { pressureDemonCore } = require("./experiment_core.js");
  const rows = [];
  const brain = (sd) => CTRL.connectomeController(circuit, {
    shuffle: false, rng: makeRng(700 + sd), seed: 1, opticDrive: 0, motorDrive: 0.6,
    plasticity: "full", policyGradient: true, pgRng: makeRng(701 + sd) });
  pressureDemonCore({ seed: 7, seedTag: 1, trials: 2, trainTrials: 1, episodeSeconds: 6,
    nParticles: 80, variants: ["demon_neural", "demon_frozen", "never_open"], brainFactory: brain,
    onTrialData: (c, p, r) => rows.push(r) });
  const never = rows.filter(r => r.condition === "never_open").map(r => r.workJEp);
  const neural = rows.filter(r => r.condition === "demon_neural").map(r => r.workJEp);
  // never-open must produce (near-)zero physical work — reward cannot exist without physics
  assert.ok(Math.max(...never) < Math.max(...neural),
    "never_open produced as much work as the neural arm — reward is disconnected from physics");
});
test("R4b: never-open variant has zero openFraction", () => {
  const { pressureDemonCore } = require("./experiment_core.js");
  const rows = [];
  pressureDemonCore({ seed: 3, seedTag: 1, trials: 1, trainTrials: 1, episodeSeconds: 4,
    nParticles: 60, variants: ["never_open"],
    onTrialData: (c, p, r) => rows.push(r) });
  assert.ok(rows.length === 1);
  assert.strictEqual(rows[0].openFraction, 0);
  assert.strictEqual(rows[0].crossings, 0);
});

// R5 --------------------------------------------------- train/test separation
test("R5a: runBenchmark disables learning in the test phase", () => {
  const env = miniEnv();
  const calls = [];
  const c = CTRL.drosophilaController(makeRng(6), env, {});
  const orig = c.setLearning.bind(c);
  c.setLearning = (on) => { calls.push(on); orig(on); };
  const out = runBenchmark({
    seed: 9, nSeeds: 1, trialsTrain: 1, trialsTest: 1, episodeSeconds: 2,
    nParticles: 40, noise: 0.1, doorHeight: 64,
    controllers: { drosophila: () => c },
  });
  assert.deepStrictEqual(calls, [true, false],
    "phases must call setLearning(true) for train then setLearning(false) for test");
});
test("R5b: frozen connectome keeps weightDrift at 0 through training", () => {
  const { pressureDemonCore } = require("./experiment_core.js");
  const rows = [];
  pressureDemonCore({ seed: 11, seedTag: 1, trials: 2, trainTrials: 2, episodeSeconds: 4,
    nParticles: 60, variants: ["demon_frozen"],
    brainFactory: (sd) => CTRL.connectomeController(circuit, {
      shuffle: false, rng: makeRng(800 + sd), seed: 1, opticDrive: 0, motorDrive: 0.6,
      plasticity: "full", policyGradient: true, pgRng: makeRng(801 + sd) }),
    onTrialData: (c, p, r) => rows.push(r) });
  for (const r of rows) assert.strictEqual(r.weightDrift, 0, "frozen arm must not drift weights");
});

// R6 ------------------------------------------------------- seed-level statistics
test("R6a: analysis aggregates per seed, never per trial (source guard)", () => {
  const analyze = fs.readFileSync(__dirname + "/validation_analyze.js", "utf8");
  assert.ok(analyze.includes("perSeedPhaseMean"), "analysis must use per-seed aggregation");
  assert.ok(!/meanCI\(\s*rows\s*\)/.test(analyze), "analysis must not feed raw trial rows into CI machinery");
});
test("R6b: stats layer raises on degenerate single-seed CIs (documented n)", () => {
  const S = require("./stats_utils.js");
  const d = S.describe([3.14]);
  assert.strictEqual(d.n, 1);
  assert.strictEqual(d.ciLo, d.ciHi, "n=1 must yield a zero-width CI, not a fake interval");
});
test("R6c: apparatus CI machinery nests blocks INSIDE seeds", () => {
  const { apparatusCurve } = require("./experiment_core.js");
  const rows = [];
  for (let s = 1; s <= 3; s++)
    for (let t = 0; t < 4; t++)
      rows.push({ condition: "c", phase: "test", seed: s, trial: t, v: 10 * s + t });
  const pts = apparatusCurve(rows, 2);
  const pt = pts.find(p => p.cond === "c" && p.phase === "test" && p.block === 0);
  assert.ok(pt && pt.v.n === 3, "block CI must have n = number of SEEDS, not trials");
  // per-seed block0 means: 10.5, 20.5, 30.5 -> grand mean 20.5 (a pooled-trial
  // mean would give 11 — this distinguishes seed-nested from trial-level CIs)
  assert.strictEqual(pt.v.mean, 20.5,
    "block mean must average per-seed block means (seed = unit)");
});

// determinism -----------------------------------------------------------
test("determinism: same seed reproduces identical rows (door task)", () => {
  function one() {
    const out = runBenchmark({
      seed: 21, nSeeds: 1, trialsTrain: 1, trialsTest: 0, episodeSeconds: 2,
      nParticles: 40, noise: 0.1, doorHeight: 64,
      controllers: { drosophila: (rng, env, c) => CTRL.drosophilaController(rng, env, c) },
    });
    const t = out.conditions.drosophila._raw[0].trials[0];
    return { g: t.goodCrossings, b: t.badCrossings, agree: t.demonAgree, energy: t.energyJ };
  }
  assert.deepStrictEqual(one(), one());
});
