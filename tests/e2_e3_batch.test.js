// C-4 E2/E3 batch validation acceptance tests.
//   T1  script exists, parses, selftest passes
//   T2  config pins: 4 canonical conditions, runBenchmark engine untouched,
//       stats_utils canonical Welch, C-3 dataset export present
//   T3  trialStats: per-seed block aggregation + train→test continuity
//   T4  Welch anchor: p(t=1.8516, df=10) = 0.0938 (two-sided)
//   T5  1-seed determinism: same seed -> identical rows (in-process)
//   T6  real run: rows well-formed, engine metrics present, all four
//       conditions produce trials, dataset export succeeds
// Run: node --test tests/e2_e3_batch.test.js
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
const SCRIPT = path.join(ROOT, "e2_e3_batch_validate.js");
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
  assert.ok(fs.existsSync(SCRIPT), "e2_e3_batch_validate.js missing");
  execFileSync(process.execPath, ["--check", SCRIPT]);
  const out = execFileSync(process.execPath, [SCRIPT, "--selftest"], { encoding: "utf8" });
  assert.match(out, /selftest welchT: OK/);
  assert.match(out, /selftest factories: OK/);
});

test("T2 — config pins: canonical conditions, engine + stats untouched, C-3 export", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /\["ann", "drosophila", "classical_demon", "random"\]/);
  assert.match(src, /CORE\.runBenchmark\(/);
  assert.doesNotMatch(src, /function runBenchmark/);
  assert.match(src, /require\("\.\/stats_utils\.js"\)/);
  assert.doesNotMatch(src, /function welchT/);
  assert.match(src, /dataset_export\.js/);
  assert.match(src, /e2_e3_dataset_/);
  // controller options are the production defaults (no tuning in the driver)
  assert.match(src, /CTRL\.annController\(rng, env, cfg\)/);
  assert.match(src, /CTRL\.drosophilaController\(rng, env, cfg\)/);
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

test("T5 — 1-seed determinism: same seed -> identical rows", () => {
  const CORE = require(path.join(ROOT, "experiment_core.js"));
  const run = () => {
    const rows = [];
    CORE.runBenchmark({
      seed: 3, nSeeds: 1, trialsTrain: 1, trialsTest: 1,
      episodeSeconds: 8, dt: 1 / 60, nParticles: 200, maxCrossingsPerTrial: 50,
      controllers: { ann: MOD.factoryFor("ann"), drosophila: MOD.factoryFor("drosophila") },
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
  const fields = ["crossings", "goodCrossings", "badCrossings", "openFraction",
                  "demonAgree", "dTfinal", "energyJ"];
  for (let i = 0; i < a.length; i++)
    for (const f of fields)
      assert.ok(Math.abs((a[i][f] || 0) - (b[i][f] || 0)) < 1e-9,
                "row " + i + " field " + f + " diverged");
});

test("T6 — real run: four conditions produce well-formed rows; export succeeds", () => {
  const CORE = require(path.join(ROOT, "experiment_core.js"));
  const DX = require(path.join(ROOT, "dataset_export.js"));
  const rows = [];
  CORE.runBenchmark({
    seed: 5, nSeeds: 1, trialsTrain: 2, trialsTest: 1,
    episodeSeconds: 12, dt: 1 / 60, nParticles: 320, maxCrossingsPerTrial: 50,
    controllers: {
      ann: MOD.factoryFor("ann"),
      drosophila: MOD.factoryFor("drosophila"),
      classical_demon: MOD.factoryFor("classical_demon"),
      random: MOD.factoryFor("random"),
    },
    onTrialData: (cond, phase, tr) => {
      const row = Object.assign({}, tr, { condition: cond, phase, experiment: cond === "ann" ? "e2" : "e3" });
      delete row.fireVec;
      rows.push(row);
    },
  });
  for (const cond of ["ann", "drosophila", "classical_demon", "random"]) {
    const rs = rows.filter(r => r.condition === cond);
    assert.equal(rs.length, 3, cond + " trial count");
    for (const r of rs) {
      assert.equal(typeof r.openFraction, "number");
      assert.equal(typeof r.demonAgree, "number");
      assert.equal(typeof r.dTfinal, "number");
      assert.ok(!("fireVec" in r), "fireVec must be stripped");
    }
  }
  // C-3 export works on these rows
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e3-"));
  const r = DX.exportRun({ experiment: "_e2e3t", config: {} }, rows, { dir, git: false });
  const v = DX.verifyDataset(r.csvPath, r.manifestPath);
  assert.deepEqual(v.errors, []);
  assert.equal(v.manifest.n_rows, rows.length);
});
