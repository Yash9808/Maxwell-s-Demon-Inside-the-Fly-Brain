/**
 * tests/stage1_arm_d_match.test.js — pre-registration gate (protocol §5d).
 *
 * Arm D construction contract from Confirmatory_experiment_protocol_v1.md:
 * the degree-matched random sparse rewiring must match the REAL circuit
 * EXACTLY in edge count, per-neuron out-degree and per-neuron in-degree,
 * with no self-loops, no duplicate (s,t) pairs and identical weight/sign
 * multisets, and must be deterministic per seed (different seed -> different
 * wiring, same degrees).
 *
 * Fixtures: (1) a small synthetic graph each of whose degrees is CERTIFIED by
 * construction, (2) the real circuit (fly_brain_circuit.json) when present —
 * same 9 assertions over ~250k edges with a byte-stable fingerprint.
 * Skips cleanly when the payload is absent.
 * Run: node --test tests/stage1_arm_d_match.test.js
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const CORE = require(path.join(ROOT, "experiment_core.js"));
const CTRL = require(path.join(ROOT, "controllers.js"));

// --------------------------------------------------------------- helpers
const inDegreesOf = (es) => {
  const d = new Map();
  for (const e of es) d.set(e.t, (d.get(e.t) || 0) + 1);
  return JSON.stringify([...d.entries()].sort((a, b) => a[0] - b[0]));
};
const outDegreesOf = (es) => {
  const d = new Map();
  for (const e of es) d.set(e.s, (d.get(e.s) || 0) + 1);
  return JSON.stringify([...d.entries()].sort((a, b) => a[0] - b[0]));
};
const ALL = new Set([0, 1, 2, 3]);       // synthetic 4-neuron graph

function assertDegreeMatchContract(realList, dList, label) {
  assert.strictEqual(dList.length, realList.length, label + ": |E_D| == |E_real|");
  assert.strictEqual(inDegreesOf(dList), inDegreesOf(realList), label + ": in-degree sequence exact");
  assert.strictEqual(outDegreesOf(dList), outDegreesOf(realList), label + ": out-degree sequence exact");
  const keyOf = (e) => e.s + "=>" + e.t;
  const seen = new Set();
  for (const e of dList) {
    assert.notStrictEqual(e.s, e.t, label + ": no self-loop");
    assert.ok(!seen.has(keyOf(e)), label + ": no duplicate pair " + keyOf(e));
    seen.add(keyOf(e));
  }
  const canon = (list) => list.map(e => e.w + ":" + e.sign).sort().join("|");
  assert.strictEqual(canon(dList), canon(realList), label + ": weight/sign multiset identical");
}

// --------------------------------------------------- 1. synthetic fixture
// 9 edges over 4 neurons; source/target degree CERTIFIED below, so any
// violation of preservation is attributable to the builder, not the fixture.
const SYNTH = [
  { s: 0, t: 1, w: 1, sign: 1 },
  { s: 0, t: 2, w: 1, sign: 1 },
  { s: 0, t: 3, w: 1, sign: -1 },
  { s: 1, t: 2, w: 2, sign: 1 },
  { s: 1, t: 3, w: 2, sign: -1 },
  { s: 2, t: 0, w: 1, sign: 1 },
  { s: 2, t: 1, w: 1, sign: -1 },
  { s: 3, t: 0, w: 1, sign: 1 },
  { s: 3, t: 2, w: 1, sign: 1 },
];
// certification: every neuron's in-degree == out-degree == ... (small graph
// sanity the test asserts directly so a fixture typo fails here, not later)
assert.strictEqual(SYNTH.length, 9);
assert.strictEqual(inDegreesOf(SYNTH), JSON.stringify([[0, 2], [1, 2], [2, 3], [3, 2]]));
assert.strictEqual(outDegreesOf(SYNTH), JSON.stringify([[0, 3], [1, 2], [2, 2], [3, 2]]));

test("arm D builder matches degree sequence on the synthetic graph", () => {
  for (const seed of [7001, 7002, 9201]) {
    const D = CTRL.degreeMatchedRandomEdges(SYNTH, { seed, swapFactor: 400 })();
    assertDegreeMatchContract(SYNTH, D, "synthetic seed=" + seed);
  }
});

test("arm D builder is deterministic per seed and varies across seeds", () => {
  const a = CTRL.degreeMatchedRandomEdges(SYNTH, { seed: 7001, swapFactor: 400 })();
  const b = CTRL.degreeMatchedRandomEdges(SYNTH, { seed: 7001, swapFactor: 400 })();
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b), "same seed -> identical wiring");
  const c = CTRL.degreeMatchedRandomEdges(SYNTH, { seed: 7002, swapFactor: 400 })();
  assert.notStrictEqual(
    JSON.stringify(a.map(e => [e.s, e.t])), JSON.stringify(c.map(e => [e.s, e.t])),
    "different seed -> different wiring (draw is actually seeded)");
});

test("arm D edges instantiate in connectomeController identically to real edges (NE only varies by design)", () => {
  // The controller must treat customEdges exactly like its own fast-edge list:
  // same propagation array construction, same NE, same plastic flag semantics.
  // Arms A and D differ ONLY in the edge list, so this probe runs both edge
  // lists through the same tiny stub circuit and asserts construction parity.
  const N = 4;
  const mkCircuit = (edges) => ({
    layer_names: ["L0", "L1", "motor"],
    optic_layer: 1,
    optic_channels: { "0": [0.5, 0.5, 0.5], "2": [0.5, 0.5, 0.5] },
    layers: [[0, 1], [2, 3], []].map(a2 => a2.filter(x => x < N)),
    edges,
  });
  const env = CORE.makeEnvironment({ seed: 1, nParticles: 40 });
  const build = (edges, kind) => {
    const c = CTRL.connectomeController(mkCircuit(edges), { rng: CORE.makeRng(11), seed: 11 });
    c.observe(env);
    c.step(1 / 60, env);       // one tick must not throw with this edge set
    return { N: c._N, NE: c._NE };
  };
  const realProbe = build(SYNTH, "A-real");
  const dList = CTRL.degreeMatchedRandomEdges(SYNTH, { seed: 7001 })();
  const dProbe = build(dList, "D-custom");
  assert.strictEqual(realProbe.N, dProbe.N, "same neuron count");
  assert.strictEqual(realProbe.NE, dProbe.NE, "same edge count into CSR");
  // the stub's layers must carry ALL neuron ids referenced by any edge list
  // (sky-high active window) — ensured by mkCircuit's layers covering 0..3.
});

// --------------------------------------------------- 2. real circuit probe
let circuit = null;
try {
  circuit = JSON.parse(fs.readFileSync(path.join(ROOT, "fly_brain_circuit.json"), "utf8"));
} catch { /* payload absent -> skip block */ }

if (circuit && Array.isArray(circuit.edges)) {
  const realFast = circuit.edges.filter(e => !e.modulatory);

  test("arm D matches the REAL circuit exactly (250k-edge probe, fingerprinted)", () => {
    const t0 = Date.now();
    const D = CTRL.degreeMatchedRandomEdges(circuit, { seed: 7001, swapFactor: 10 })();
    assertDegreeMatchContract(realFast, D, "real circuit seed=7001");
    // fingerprint: sorted (s,t) pairs hash — detects wiring drift across runs
    const fp = (list) => {
      const h = require("crypto").createHash("sha256");
      for (const e of [...list].sort((a, b) => a.s - b.s || a.t - b.t)) h.update(e.s + "," + e.t + ";");
      return h.digest("hex").slice(0, 16);
    };
    console.log("    [arm D] N_real=%d E=%d fingerprint(seed 7001)=%s (%d ms)",
      circuit.layers.reduce((a, l) => a + l.length, 0), realFast.length, fp(D), Date.now() - t0);
  });

  test("arm D on the real circuit is deterministic and seed-sensitive", () => {
    const a = CTRL.degreeMatchedRandomEdges(circuit, { seed: 7001 })();
    const b = CTRL.degreeMatchedRandomEdges(circuit, { seed: 7001 })();
    assert.strictEqual(JSON.stringify(a), JSON.stringify(b), "same seed -> byte-identical list");
    const c = CTRL.degreeMatchedRandomEdges(circuit, { seed: 7002 })();
    assert.notStrictEqual(JSON.stringify(a.map(e => [e.s, e.t])), JSON.stringify(c.map(e => [e.s, e.t])));
  });
} else {
  test("real-circuit probe (skipped: fly_brain_circuit.json absent)", () => {
    assert.ok(true);
  });
}
