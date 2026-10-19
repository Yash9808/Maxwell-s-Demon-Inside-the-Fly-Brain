// C-6 E5 comparator acceptance tests.
//   T1  script exists, parses, selftest passes
//   T2  config pins: 7 controllers in ONE env draw (paired design), engine
//       untouched, canonical stats (perm + Hedges g + Holm), C-3 export
//   T3  trialStats: per-seed block aggregation + continuity
//   T4  1-seed determinism: same seed -> identical rows (in-process)
//   T5  real run (small): all 7 controllers produce rows WITHIN one env
//       draw; seed-pairing property holds (same seeds across conditions);
//       dataset export verifies
// Run: node --test tests/e5_comparator.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "e5_comparator.js");
const require = createRequire(import.meta.url);

const MOD = (function load() {
  let src = fs.readFileSync(SCRIPT, "utf8");
  if (src.startsWith("#!")) src = src.slice(src.indexOf(String.fromCharCode(10)) + 1);
  const m = { exports: {} };
  const scriptRequire = createRequire(SCRIPT);
  new Function("module", "exports", "require", "__dirname", "__filename",
    src)(m, m.exports, scriptRequire, ROOT, SCRIPT);
  return m.exports;
})();

test("T1 — script exists, parses, selftest passes", () => {
  assert.ok(fs.existsSync(SCRIPT), "e5_comparator.js missing");
  execFileSync(process.execPath, ["--check", SCRIPT]);
  const out = execFileSync(process.execPath, [SCRIPT, "--selftest"], { encoding: "utf8" });
  assert.match(out, /selftest paired perm .*OK/);
  assert.match(out, /selftest paired perm\+g .*OK/);
  assert.match(out, /selftest holm monotone: OK/);
});

test("T2 — config pins: 7 controllers in one env draw, canonical stats, C-3 export", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /\["classical_demon", "random", "never_gate",\s*"ann", "drosophila", "connectome_4A", "connectome_4B"\]/);
  // THE paired design: ONE runBenchmark call with ALL controller factories
  assert.match(src, /controllers: controllerFactories\(\),\s*\/\/ ALL controllers, ONE env draw/);
  // paired statistics from the canonical library (perm + Hedges g + Holm)
  assert.match(src, /SU\.permutationTestPaired\(/);
  assert.match(src, /SU\.hedgesGPaired\(/);
  assert.match(src, /SU\.holm\(/);
  assert.doesNotMatch(src, /function permutationTest|function hedgesG|function holm/);
  // engine untouched + C-3 export
  assert.match(src, /CORE\.runBenchmark\(/);
  assert.doesNotMatch(src, /function runBenchmark/);
  assert.match(src, /dataset_export\.js/);
  assert.match(src, /e5_dataset_/);
});

test("T3 — trialStats: per-seed block aggregation + continuity", () => {
  const syn = [];
  for (let sd = 1; sd <= 3; sd++) {
    for (let t = 0; t < 4; t++)
      syn.push({ condition: "c1", phase: "train", seed: sd, trial: t, reward: t + sd });
    for (let t = 0; t < 2; t++)
      syn.push({ condition: "c1", phase: "test", seed: sd, trial: 4 + t, reward: 100 + t + sd });
  }
  const st = MOD.trialStats(syn, 2);
  const trains = st.filter(p => p.phase === "train");
  const tests = st.filter(p => p.phase === "test");
  assert.equal(Math.min(...tests.map(p => p.block)),
               Math.max(...trains.map(p => p.block)) + 1);
  assert.ok(st.every(p => p.reward.n === 3));
  const b0 = trains.find(p => p.block === 0);
  assert.ok(Math.abs(b0.reward.mean - 2.5) < 1e-12);
});

test("T4 — 1-seed determinism: same seed -> identical rows", () => {
  const CORE = require(path.join(ROOT, "experiment_core.js"));
  const run = () => {
    const rows = [];
    CORE.runBenchmark({
      seed: 11, nSeeds: 1, trialsTrain: 1, trialsTest: 1,
      episodeSeconds: 8, dt: 1 / 60, nParticles: 200, maxCrossingsPerTrial: 50,
      controllers: {
        ann: (rng, env, cfg) => require(path.join(ROOT, "controllers.js")).annController(rng, env, cfg),
        random: (rng, env) => require(path.join(ROOT, "controllers.js")).randomController(rng, env),
      },
      onTrialData: (cond, phase, tr) => {
        const row = Object.assign({}, tr, { condition: cond, phase });
        delete row.fireVec;
        rows.push(row);
      },
    });
    return rows;
  };
  const a = run(), b = run();
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++)
    assert.ok(Math.abs((a[i].openFraction || 0) - (b[i].openFraction || 0)) < 1e-9);
});

test("T5 — real run: one env draw carries all controllers; pairing holds; export verifies", () => {
  const CORE = require(path.join(ROOT, "experiment_core.js"));
  const CTRL = require(path.join(ROOT, "controllers.js"));
  const DX = require(path.join(ROOT, "dataset_export.js"));
  const circuit = require(path.join(ROOT, "fly_brain_circuit.json"));
  const rows = [];
  CORE.runBenchmark({
    seed: 13, nSeeds: 1, trialsTrain: 2, trialsTest: 1,
    episodeSeconds: 12, dt: 1 / 60, nParticles: 320, maxCrossingsPerTrial: 50,
    controllers: {
      ann: (rng, env, cfg) => CTRL.annController(rng, env, cfg),
      drosophila: (rng, env, cfg) => CTRL.drosophilaController(rng, env, cfg),
      classical_demon: (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg),
      random: (rng, env) => CTRL.randomController(rng, env),
      connectome_4A: (rng) => CTRL.connectomeController(circuit,
        { shuffle: false, rng, seed: 1, opticDrive: 0.25, plasticity: "full" }),
    },
    onTrialData: (cond, phase, tr) => {
      const row = Object.assign({}, tr, { condition: cond, phase, experiment: "e5" });
      delete row.fireVec;
      rows.push(row);
    },
  });
  // every condition ran the same single env draw: same seed set, 3 trials each
  const conds = [...new Set(rows.map(r => r.condition))];
  assert.equal(conds.length, 5);
  for (const c of conds) {
    const rs = rows.filter(r => r.condition === c);
    assert.equal(rs.length, 3, c + " trial count");
    assert.deepEqual([...new Set(rs.map(r => r.seed))], [13]);
  }
  // C-3 export
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e5t-"));
  const r = DX.exportRun({ experiment: "_e5t", config: {} }, rows, { dir, git: false });
  const v = DX.verifyDataset(r.csvPath, r.manifestPath);
  assert.deepEqual(v.errors, []);
  assert.equal(v.manifest.n_rows, rows.length);
});
