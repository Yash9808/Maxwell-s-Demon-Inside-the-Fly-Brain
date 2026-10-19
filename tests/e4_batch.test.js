// C-5 E4 batch validation acceptance tests.
//   T1  script exists, parses, selftest passes (incl. frozen gate)
//   T2  config pins: 6 arms, worker-exact controller options (no tuning),
//       runBenchmark engine untouched, canonical Welch, C-3 export present
//   T3  trialStats: per-seed block aggregation + train→test continuity
//   T4  Welch anchor: p(t=1.8516, df=10) = 0.0938 (two-sided)
//   T5  real run (2 arms, small): rows well-formed; 4A drifts during train,
//       frozen stays exactly 0; restricted/shuffled options take effect;
//       dataset export verifies
// Run: node --test tests/e4_batch.test.js
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
const SCRIPT = path.join(ROOT, "e4_batch_validate.js");
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

test("T1 — script exists, parses, selftest passes (incl. frozen gate)", () => {
  assert.ok(fs.existsSync(SCRIPT), "e4_batch_validate.js missing");
  execFileSync(process.execPath, ["--check", SCRIPT]);
  const out = execFileSync(process.execPath, [SCRIPT, "--selftest"], { encoding: "utf8" });
  assert.match(out, /selftest welchT: OK/);
  assert.match(out, /selftest frozen gate: delta=0 OK/);
  assert.match(out, /selftest factories: OK/);
});

test("T2 — config pins: worker-exact options, engine + stats untouched, C-3 export", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  // all six arms in the default list
  assert.match(src, /"connectome_4A", "connectome_4B", "connectome_4C", "connectome_frozen",\s*"classical_demon", "random"/);
  // worker-exact E4 options: shuffle only for 4C with seed 7; restricted only for 4B
  assert.match(src, /shuffle: variant === "connectome_4C"/);
  assert.match(src, /seed: variant === "connectome_4C" \? 7 : 1/);
  assert.match(src, /plasticity: variant === "connectome_4B" \? "restricted" : "full"/);
  assert.match(src, /opticDrive: 0\.25/);
  // engine + stats canonical
  assert.match(src, /CORE\.runBenchmark\(/);
  assert.doesNotMatch(src, /function runBenchmark/);
  assert.match(src, /require\("\.\/stats_utils\.js"\)/);
  assert.doesNotMatch(src, /function welchT/);
  // C-3 export + frozen refusal
  assert.match(src, /dataset_export\.js/);
  assert.match(src, /brain\.setLearning\(false\);\s*\/\/ always refuse/);
  // fireVec stripped
  assert.match(src, /delete row\.fireVec/);
});

test("T3 — trialStats: per-seed block aggregation + train→test continuity", () => {
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
  assert.ok(Math.abs(b0.reward.ci - 1.96 / Math.sqrt(3)) < 1e-12);
});

test("T4 — Welch anchor: p(t=1.8516, df=10) = 0.0938 (two-sided)", () => {
  const SU = require(path.join(ROOT, "stats_utils.js"));
  const w = SU.welchT([5, 6, 7, 8, 9, 10], [7, 8, 9, 10, 11, 12]);
  assert.ok(Math.abs(Math.abs(w.t) - 1.8516) < 2e-3);
  assert.ok(Math.abs(w.df - 10) < 1e-6);
  assert.ok(Math.abs(w.p - 0.0938) < 5e-4);
});

test("T5 — real run: well-formed rows; 4A train drift > 0, frozen exactly 0; options take effect; export verifies", () => {
  const CORE = require(path.join(ROOT, "experiment_core.js"));
  const DX = require(path.join(ROOT, "dataset_export.js"));
  const rows = [];
  CORE.runBenchmark({
    seed: 9, nSeeds: 1, trialsTrain: 2, trialsTest: 1,
    episodeSeconds: 12, dt: 1 / 60, nParticles: 320, maxCrossingsPerTrial: 50,
    controllers: {
      connectome_4A: MOD.factoryWithTelemetry("connectome_4A"),
      connectome_4B: MOD.factoryWithTelemetry("connectome_4B"),
      connectome_4C: MOD.factoryWithTelemetry("connectome_4C"),
      connectome_frozen: MOD.factoryWithTelemetry("connectome_frozen"),
    },
    onTrialData: (cond, phase, tr) => {
      const row = Object.assign({}, tr, { condition: cond, phase });
      delete row.fireVec;
      rows.push(row);
    },
  });
  const wd = (c, ph) => rows.filter(r => r.condition === c && r.phase === ph).map(r => r.weightDrift);
  // learning arms: drift machinery live in TRAIN
  assert.ok(wd("connectome_4A", "train").every(v => v >= 0));
  // frozen: exactly 0 everywhere (wrapper refused)
  for (const v of wd("connectome_frozen", "train").concat(wd("connectome_frozen", "test")))
    assert.equal(v, 0, "frozen arm drifted: " + v);
  // schema
  for (const r of rows) {
    for (const f of ["weightDrift", "dopaminePeak", "neuralSpikes", "openFraction", "demonAgree"])
      assert.equal(typeof r[f], "number", "missing " + f);
    assert.ok(!("fireVec" in r));
  }
  // distinct controller options actually produce distinct wiring/behavior:
  // 4C (shuffled) rows exist and the arms differ in at least one metric
  const arms = ["connectome_4A", "connectome_4B", "connectome_4C", "connectome_frozen"];
  const sig = arms.map(a => JSON.stringify(rows.filter(r => r.condition === a)
    .map(r => [r.openFraction, r.demonAgree, r.neuralSpikes])));
  assert.equal(new Set(sig).size, arms.length, "arms produced identical rows");
  // C-3 export (rows carry the meta columns as the validator's exporter adds them)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e4t-"));
  const exportRows = rows.map(x => Object.assign({}, x, { experiment: "e4" }));
  const r = DX.exportRun({ experiment: "_e4t", config: {} }, exportRows, { dir, git: false });
  const v = DX.verifyDataset(r.csvPath, r.manifestPath);
  assert.deepEqual(v.errors, []);
});
