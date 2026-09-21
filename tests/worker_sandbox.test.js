"use strict";
/**
 * Regression test — worker-sandbox module loading (Stage F, 2026-09-21).
 *
 * Historical failure (P4 smoke suite S5–S10, 7 failures): controllers.js
 * gained `require("./p1_retinotopy.js")`, but experiment_worker.js's eval
 * sandbox mapped require -> experiment_core exports, so inside the worker
 * `RT.hexLatticeNodes` was not a function and worker init died, killing all
 * E1–E11 worker experiments (browser app + smoke suite).
 *
 * The fix: experiment_worker.js loads p1_retinotopy.js as its own module and
 * hands controllers.js a DISPATCHING requireFn (p1_retinotopy -> RT, else CORE).
 *
 * This test must FAIL if that loading problem returns. It replicates the
 * worker's importAs pattern verbatim (keep in sync with experiment_worker.js!)
 * and asserts the full chain resolves in the sandbox exactly as in plain Node.
 *
 * Run: node --test tests/worker_sandbox.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Mirrors experiment_worker.js::importAs (synchronous fetch + scoped eval).
function importAs(file, requireFn) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const mod = { exports: {} };
  const fn = new Function("module", "exports", "require", src);
  fn(mod, mod.exports, requireFn);
  return mod.exports;
}

test("plain Node: p1_retinotopy exposes hexLatticeNodes", () => {
  const RT = require(path.join(ROOT, "p1_retinotopy.js"));
  assert.strictEqual(typeof RT.hexLatticeNodes, "function");
  const nodes = RT.hexLatticeNodes();
  assert.ok(Array.isArray(nodes) && nodes.length === 800,
    `expected 800 lattice nodes, got ${nodes.length}`);
});

test("plain Node: controllers.js loads (retinotopy require satisfied)", () => {
  const CTRL = require(path.join(ROOT, "controllers.js"));
  assert.strictEqual(typeof CTRL.classicalDemon, "function");
  assert.strictEqual(typeof CTRL.connectomeController, "function");
});

test("worker sandbox: full importAs chain resolves like experiment_worker.js", () => {
  // Exactly the try-block of experiment_worker.js — the dispatching requireFn
  // is the load-bearing fix. If controllers.js ever gains a require the
  // dispatch cannot satisfy, importAs throws here and this test fails loudly.
  const CORE = importAs("experiment_core.js",
    () => { throw new Error("experiment_core.js must not require()"); });
  const RT = importAs("p1_retinotopy.js",
    () => { throw new Error("p1_retinotopy.js must not require()"); });
  const CTRL = importAs("controllers.js",
    (spec) => String(spec).includes("p1_retinotopy") ? RT : CORE);

  assert.strictEqual(typeof RT.hexLatticeNodes, "function",
    "sandbox-loaded p1_retinotopy.js must export hexLatticeNodes");
  const nodes = RT.hexLatticeNodes();
  assert.ok(Array.isArray(nodes) && nodes.length === 800,
    "sandbox lattice must have 800 nodes");

  assert.strictEqual(typeof CTRL.classicalDemon, "function",
    "sandbox-loaded controllers.js must expose classicalDemon");
  assert.strictEqual(typeof CTRL.connectomeController, "function",
    "sandbox-loaded controllers.js must expose connectomeController");
});

test("worker sandbox: the historical bug would be caught (dispatch is real)", () => {
  // Sanity that the dispatch is not a silent pass-through: a require spec NOT
  // containing "p1_retinotopy" must yield CORE, and the retinotopy spec must
  // yield the RT module (not CORE). If someone reverts to require -> CORE,
  // RT would equal CORE and hexLatticeNodes would be undefined.
  const RT = importAs("p1_retinotopy.js", () => { throw new Error("no require"); });
  const CORE = importAs("experiment_core.js", () => { throw new Error("no require"); });
  const dispatch = (spec) => String(spec).includes("p1_retinotopy") ? RT : CORE;
  assert.strictEqual(dispatch("./p1_retinotopy.js"), RT);
  assert.strictEqual(dispatch("./experiment_core"), CORE);
  assert.notStrictEqual(RT, CORE);
});

test("worker sandbox: the historical bug reproduces when the fix is absent (negative)", () => {
  // Reproduce the 2026-09-21 failure: controllers.js evaluated with the OLD
  // require mapping (always CORE). controllers.js must THROW
  // "hexLatticeNodes is not a function" — i.e. this harness genuinely fails
  // if the dispatch fix is ever removed.
  const CORE = importAs("experiment_core.js", () => { throw new Error("no require"); });
  assert.throws(
    () => importAs("controllers.js", () => CORE),
    /hexLatticeNodes/,
    "controllers.js under the old broken require mapping should throw on " +
    "RT.hexLatticeNodes — if this stops throwing, the loading guard has changed"
  );
});
