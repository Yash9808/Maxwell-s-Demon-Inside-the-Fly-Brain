// E6 batch validation acceptance tests (Phase C-1; mirrors e9 test discipline).
// Static pins + statistics self-checks + 1-seed determinism smoke.
//   T1  script exists, parses, selftest passes
//   T2  config pins: 4 canonical conditions, runBenchmark engine untouched,
//       stats_utils canonical Welch (no local re-implementation)
//   T3  frozen control cannot learn (wrapper refuses setLearning(true))
//   T4  trialStats: per-seed block aggregation + continuity (hand-checked)
//   T5  Welch anchor: published Student-t value (p(t=1.8516, df=10) = 0.0938)
//   T6  1-seed determinism: same seed -> identical rows (in-process)
//   T7  frozen drift stays exactly 0 through a real run; neural drift > 0
// Run: node --test tests/e6_batch.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "e6_batch_validate.js");

const MOD = (function load() {
  let src = fs.readFileSync(SCRIPT, "utf8");
  if (src.startsWith("#!")) src = src.slice(src.indexOf(String.fromCharCode(10)) + 1);  // new Function rejects shebangs
  const m = { exports: {} };
  const scriptRequire = createRequire(SCRIPT);   // script-relative module resolution
  new Function("module", "exports", "require", "__dirname", "__filename",
    src)(m, m.exports, scriptRequire, ROOT, SCRIPT);
  return m.exports;
})();

test("T1 — script exists, parses, selftest passes", () => {
  assert.ok(fs.existsSync(SCRIPT), "e6_batch_validate.js missing");
  execFileSync(process.execPath, ["--check", SCRIPT]);
  const out = execFileSync(process.execPath, [SCRIPT, "--selftest"], { encoding: "utf8" });
  assert.match(out, /selftest welchT:.*OK/);
  assert.match(out, /selftest frozen gate:.*OK/);
  assert.match(out, /selftest factories: OK/);
});

test("T2 — config pins: canonical conditions, engine + stats untouched", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  // the four row-15 conditions, in the default variant list
  assert.match(src,
    /"demon_neural", "demon_frozen", "never_gate", "classical_demon"/);
  // engine is the shared runBenchmark, never a local copy
  assert.match(src, /CORE\.runBenchmark\(/);
  assert.doesNotMatch(src, /function runBenchmark/);
  // Welch comes from stats_utils (canonical), not a local re-implementation
  assert.match(src, /require\("\.\/stats_utils\.js"\)/);
  assert.doesNotMatch(src, /function welchT/);
  // artifacts land in research_data/ with the e6_batch prefix
  assert.match(src, /"research_data"/);
  assert.match(src, /e6_batch_/);
});

test("T3 — frozen control cannot learn: wrapper refuses setLearning(true)", () => {
  const frozen = MOD.instrumentedBrainFactory(true)();
  const before = frozen.weightDrift();
  frozen.setLearning(true);                       // the engine's train-phase call
  const s = frozen.summary();
  assert.equal(s.weightDriftDelta, 0);            // no drift anchored at trial start
  assert.equal(frozen.weightDrift(), before);     // weights bit-identical
  // and the learning condition still accepts the call
  const neural = MOD.instrumentedBrainFactory(false)();
  neural.setLearning(true);
  assert.equal(typeof neural.weightDrift(), "number");
});

test("T4 — trialStats: per-seed block aggregation + train→test continuity", () => {
  const syn = [];
  for (let sd = 1; sd <= 3; sd++) {
    for (let t = 0; t < 4; t++)
      syn.push({ condition: "c1", phase: "train", seedTag: sd, trial: t, reward: t + sd });
    for (let t = 0; t < 2; t++)
      syn.push({ condition: "c1", phase: "test", seedTag: sd, trial: 4 + t, reward: 100 + t + sd });
  }
  const st = MOD.trialStats(syn, 2);
  const trains = st.filter(p => p.phase === "train");
  const tests = st.filter(p => p.phase === "test");
  // block continuity: first test block starts after the last train block
  assert.equal(Math.min(...tests.map(p => p.block)),
               Math.max(...trains.map(p => p.block)) + 1);
  // seed is the replicate: every point aggregates n=3 seeds
  assert.ok(st.every(p => p.reward.n === 3));
  // hand value: per-seed block-0 means over t=0,1 are 1.5/2.5/3.5 -> mean 2.5,
  // sd 1, CI = 1.96/sqrt(3)
  const b0 = trains.find(p => p.block === 0);
  assert.ok(Math.abs(b0.reward.mean - 2.5) < 1e-12);
  assert.ok(Math.abs(b0.reward.ci - 1.96 / Math.sqrt(3)) < 1e-12);
});

test("T5 — Welch anchor: p(t=1.8516, df=10) = 0.0938 (two-sided)", () => {
  const w = MOD.welchT([5, 6, 7, 8, 9, 10], [7, 8, 9, 10, 11, 12]);
  assert.ok(Math.abs(Math.abs(w.t) - 1.8516) < 2e-3);
  assert.ok(Math.abs(w.df - 10) < 1e-6);
  assert.ok(Math.abs(w.p - 0.0938) < 5e-4);
});

test("T6 — 1-seed determinism: same seed -> identical rows", () => {
  const CORE = require(path.join(ROOT, "experiment_core.js"));
  const run = () => {
    const rows = [];
    CORE.runBenchmark({
      seed: 1, nSeeds: 1, trialsTrain: 1, trialsTest: 1,
      episodeSeconds: 4, dt: 1 / 60, nParticles: 120, maxCrossingsPerTrial: 50,
      controllers: {
        demon_neural: MOD.factoryFor("demon_neural"),
        demon_frozen: MOD.factoryFor("demon_frozen"),
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
  const fields = ["crossings", "goodCrossings", "badCrossings", "openFraction",
                  "demonAgree", "weightDrift", "dopaminePeak", "neuralSpikes",
                  "dTfinal", "energyJ"];
  for (let i = 0; i < a.length; i++)
    for (const f of fields)
      assert.ok(Math.abs((a[i][f] || 0) - (b[i][f] || 0)) < 1e-9,
                "row " + i + " field " + f + " diverged");
});

test("T7 — real run: frozen drift stays exactly 0, neural drift > 0, rows well-formed", () => {
  const CORE = require(path.join(ROOT, "experiment_core.js"));
  const rows = [];
  // manifest-scale operating point (320 particles x 12 s): the smaller smoke
  // scales produce ZERO crossings (under-fed regime, see STAGE_F_E4_RESULTS),
  // which would make the plasticity assertions vacuous.
  CORE.runBenchmark({
    seed: 1, nSeeds: 1, trialsTrain: 2, trialsTest: 1,
    episodeSeconds: 12, dt: 1 / 60, nParticles: 320, maxCrossingsPerTrial: 50,
    controllers: {
      demon_neural: MOD.factoryFor("demon_neural"),
      demon_frozen: MOD.factoryFor("demon_frozen"),
    },
    onTrialData: (cond, phase, tr) => {
      const row = Object.assign({}, tr, { condition: cond, phase });
      delete row.fireVec;
      rows.push(row);
    },
  });
  const wd = (c, ph) => rows.filter(r => r.condition === c && r.phase === ph)
                            .map(r => r.weightDrift);
  // frozen condition: every trial drift exactly 0
  for (const v of wd("demon_frozen", "train").concat(wd("demon_frozen", "test")))
    assert.equal(v, 0, "frozen condition drifted: " + v);
  // neural condition: trained weights carry into the frozen TEST phase
  const tr = wd("demon_neural", "train"), te = wd("demon_neural", "test");
  assert.ok(tr.every(v => v >= 0));
  assert.ok(te.length && te[te.length - 1] >= tr[tr.length - 1] - 1e-9,
            "neural test-phase drift below train-phase drift");
  assert.ok(tr[tr.length - 1] > 0 || te[te.length - 1] > 0,
            "no plasticity anywhere — learning path broken");
  // schema: every row carries the E6 telemetry columns
  for (const r of rows) {
    for (const f of ["weightDrift", "weightDriftDelta", "dopaminePeak",
                     "neuralSpikes", "motorSpikes", "neuralDecisions", "openSteps"])
      assert.equal(typeof r[f], "number", "missing telemetry column " + f);
    assert.ok(!("fireVec" in r), "fireVec display payload must be stripped");
  }
});
