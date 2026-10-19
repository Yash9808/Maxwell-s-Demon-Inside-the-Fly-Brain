#!/usr/bin/env node
/**
 * stage2_noop_check.js — the §6d "walk-way entanglement check" verifier.
 *
 * Protocol §6d asks Stage 2 to show that a measured A − D difference cannot be
 * produced by the topological ("walk-way") machinery itself: a topology variant
 * that makes NO topological change must gain nothing against the REAL
 * environment. The config wires that as the arm
 * `armD_noop_topology_diagnostic` — the pinned Arm-D builder (`degreeMatchedRandomEdges`,
 * controllers.js, §13-pinned) with `swapFactor: 0`, i.e. 0 swap attempts, which
 * returns the REAL edge list unchanged.
 *
 * NOTE on the swap factor the runtime can express: benchmark.js (pinned, §13)
 *   builds the arm-D list as `degreeMatchedRandomEdges(circuit, {seed:
 *   spec.topologySeed, swapFactor: arm.swapFactor || 10})()`, so a literal
 *   `swapFactor: 0` is FALSY and silently becomes 10 — a `0` arm is a second
 *   arm D, not a no-op (measured 2026-10-09: its rows were byte-identical to
 *   arm D's). The config therefore declares the no-op arm with a NEGATIVE
 *   swapFactor, which is truthy, so `attempts = swapFactor * |E|` is negative
 *   and the swap loop never runs. Phase 1 checks both values.
 *
 * PHASE 1 (always): prove the no-op edge list is the real one, element-wise —
 *   |E|, ordered (s,t) sequence, per-neuron in/out degree sequences,
 *   weight/sign multiset, and the 16-hex wiring fingerprint — for the negative
 *   swapFactor the pinned runtime actually honours. Nothing is modified: this
 *   tool only READS the pinned circuit and imports the pinned builder.
 *
 * PHASE 2 (with --dryrun <dir>): prove it end to end through the real runtime.
 *   For every seed pair that has both an armA job and a no-op job in the given
 *   dry-run directory, gunzip the retained trial rows and compare them field by
 *   field (the `condition` stamp is the only field allowed to differ). The
 *   arm-A rows and the no-op rows are produced by two SEPARATE benchmark.js
 *   invocations, so this also checks that the runner's job splitting is
 *   draw-neutral (§6b: the per-arm controller rng is makeRng(networkSeed ^
 *   0x5f5f) and the environment is makeEnvironment(environmentSeed), both
 *   independent of arm grouping).
 *
 * Exit 0 = no-op confirmed; exit 1 = entanglement detected (A − D interpretation
 * is void until explained). Reads only; writes nothing.
 *
 * Usage:
 *   node tools/stage2_noop_check.js
 *   node tools/stage2_noop_check.js --dryrun research_data/stage2_dryrun
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const CTRL = require(path.join(ROOT, "controllers.js"));
const CIRCUIT_PATH = path.join(ROOT, "fly_brain_circuit.json");
const NOOP_ARM = "armD_noop_topology_diagnostic";
const ARM_A = "armA_real_connectome";

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const dryrun = flag("dryrun", null);

let failures = 0;
const ok = (c, msg, extra) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${msg}${extra ? "   " + extra : ""}`); if (!c) failures++; };

const fingerprint = (list) => {
  const h = crypto.createHash("sha256");
  for (const e of [...list].sort((a, b) => a.s - b.s || a.t - b.t)) h.update(e.s + "," + e.t + ";");
  return h.digest("hex").slice(0, 16);
};
const degrees = (list, key) => {
  const m = new Map();
  for (const e of list) m.set(e[key], (m.get(e[key]) || 0) + 1);
  return JSON.stringify([...m.entries()].sort((a, b) => a[0] - b[0]));
};
const wsCanon = (list) => list.map(e => `${e.w}:${e.sign}`).sort().join("|");

// ---------------------------------------------------------------- phase 1
const circuit = JSON.parse(fs.readFileSync(CIRCUIT_PATH, "utf8"));
const real = circuit.edges.filter(e => !e.modulatory);
const NOOP_SWAP_FACTOR = -1;   // the value stage2_config.json declares (see header note)
const noop = CTRL.degreeMatchedRandomEdges(circuit, { seed: 7009, swapFactor: NOOP_SWAP_FACTOR })();
const zeroSwaps = CTRL.degreeMatchedRandomEdges(circuit, { seed: 7009, swapFactor: 0 })();

console.log("=== phase 1: no-op topology list vs the REAL edge list (§6d entanglement check) ===");
console.log(`circuit: ${circuit.layers.reduce((a, l) => a + l.length, 0)} neurons, ${circuit.edges.length} edges (${real.length} non-modulatory)`);
ok(noop.length === real.length, "|E_noop| == |E_real|", `${noop.length} vs ${real.length}`);
let orderDiff = 0;
for (let i = 0; i < Math.min(noop.length, real.length); i++)
  if (noop[i].s !== real[i].s || noop[i].t !== real[i].t) orderDiff++;
ok(orderDiff === 0, "ordered (s,t) sequence identical (swapFactor 0 performs no swap)", `${orderDiff} positions differ`);
ok(degrees(noop, "s") === degrees(real, "s"), "out-degree sequence identical");
ok(degrees(noop, "t") === degrees(real, "t"), "in-degree sequence identical");
ok(wsCanon(noop) === wsCanon(real), "weight/sign multiset identical");
const fpReal = fingerprint(real), fpNoop = fingerprint(noop);
ok(fpReal === fpNoop, `wiring fingerprint identical (swapFactor ${NOOP_SWAP_FACTOR})`, `fingerprint ${fpNoop}`);
// the builder itself is value-agnostic for every non-positive swap factor; the
// runtime's `|| 10` coercion is what makes 0 unusable, not the builder.
ok(JSON.stringify(zeroSwaps) === JSON.stringify(noop),
   "builder is a no-op for BOTH 0 and a negative swapFactor (the falsy-zero trap is in the runtime, not the builder)",
   `(0 || 10) === ${0 || 10}`);
// seed sensitivity of the CONSTRUCTION but not the RESULT: swapFactor 0 must be
// topology-invariant across topology seeds (that is what "no-op" means)
const noop2 = CTRL.degreeMatchedRandomEdges(circuit, { seed: 7808, swapFactor: 0 })();
ok(JSON.stringify(noop2) === JSON.stringify(noop), "no-op list is invariant across topology seeds (seed 7009 vs 7808)");

// ---------------------------------------------------------------- phase 2
function rowsOf(jobDir) {
  const files = fs.readdirSync(jobDir);
  const gz = files.find(f => f.endsWith(".jsonl.gz"));
  const plain = files.find(f => f.endsWith(".jsonl"));
  if (gz) return zlib.gunzipSync(fs.readFileSync(path.join(jobDir, gz))).toString("utf8");
  if (plain) return fs.readFileSync(path.join(jobDir, plain), "utf8");
  return null;
}
function parseRows(text) {
  return text.split("\n").filter(Boolean).map(l => JSON.parse(l));
}
function stripCondition(rows) {
  return rows.map(r => { const c = Object.assign({}, r); delete c.condition; return c; });
}

if (dryrun) {
  const jobsDir = path.join(dryrun, "jobs");
  console.log("\n=== phase 2: no-op arm vs arm A through the REAL runtime, end to end ===");
  console.log(`dry-run dir: ${path.relative(ROOT, dryrun).replace(/\\/g, "/")}`);
  const jobs = fs.existsSync(jobsDir) ? fs.readdirSync(jobsDir) : [];
  const withArm = (arm) => jobs.filter(j => JSON.parse(fs.readFileSync(path.join(jobsDir, j, "DONE.json"), "utf8")).arms.includes(arm));
  const aJobs = withArm(ARM_A), nJobs = withArm(NOOP_ARM);
  console.log(`jobs carrying ${ARM_A}: ${aJobs.join(", ") || "(none)"}`);
  console.log(`jobs carrying ${NOOP_ARM}: ${nJobs.join(", ") || "(none)"}`);
  let compared = 0;
  for (const nj of nJobs) {
    const nd = JSON.parse(fs.readFileSync(path.join(jobsDir, nj, "DONE.json"), "utf8"));
    const aj = aJobs.find(j => JSON.parse(fs.readFileSync(path.join(jobsDir, j, "DONE.json"), "utf8")).k === nd.k);
    if (!aj) { console.log(`  note: pair k=${nd.k} has no arm-A job in this dry run (no comparison)`); continue; }
    const aRowsRaw = parseRows(rowsOf(path.join(jobsDir, aj)));
    const nRowsRaw = parseRows(rowsOf(path.join(jobsDir, nj)));
    const aRows = stripCondition(aRowsRaw.filter(r => r.condition === ARM_A));
    const nRows = stripCondition(nRowsRaw.filter(r => r.condition === NOOP_ARM));
    compared++;
    if (aRows.length !== nRows.length) {
      ok(false, `pair k=${nd.k}: row counts differ`, `${aRows.length} vs ${nRows.length}`);
      continue;
    }
    let diff = 0, firstKey = null;
    for (let i = 0; i < aRows.length; i++) {
      const a = aRows[i], b = nRows[i];
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { diff++; if (!firstKey) firstKey = `row ${i} field "${k}": armA=${JSON.stringify(a[k])} noop=${JSON.stringify(b[k])}`; }
      }
    }
    const aD = nd.deltaSelectivity || {};
    ok(diff === 0, `pair k=${nd.k}: ${aRows.length} rows identical field-by-field (arm A vs no-op topology arm)`,
       diff ? `${diff} field differences; first: ${firstKey}` : "");
    const np = (aRowsRaw[0] || {}).phase;
    console.log(`        seeds ${nd.seeds.environmentSeed}/${nd.seeds.networkSeed}/${nd.seeds.topologySeed}, first phase ${np}; ` +
                `no-op deltaSelectivity ${JSON.stringify(nd.deltaSelectivity && nd.deltaSelectivity[NOOP_ARM] && +nd.deltaSelectivity[NOOP_ARM].deltaSortEntropy.toFixed(6))}`);
    void aD;
  }
  if (!compared) console.log("  note: no (pair, armA/no-op) job pair found — phase 2 made no comparison");
  console.log(`pairs compared end to end: ${compared}`);
}

console.log(failures === 0
  ? "\nENTANGLEMENT CHECK PASSED: the no-op topology variant is behaviourally arm A."
  : `\nENTANGLEMENT CHECK FAILED (${failures} check(s)): the A − D interpretation is void until this is explained.`);
process.exit(failures === 0 ? 0 : 1);
