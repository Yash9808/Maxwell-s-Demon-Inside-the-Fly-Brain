// C-7 E7/E8 batch validation acceptance tests.
//   T1  script exists, parses, selftest passes (physics routing + gas parity)
//   T2  config pins: 3 E7 regimes + 3 worker-exact E8 arms, per-CALL physics
//       structure (E7 regimes separate; E8 arms one shared 320p/0.12 call),
//       engine untouched, canonical Welch, C-3 export present, LF-only
//   T3  trialStats: per-seed block aggregation + train→test continuity
//   T4  Welch anchor: p(t=1.8516, df=10) = 0.0938 (two-sided)
//   T5  in-process determinism of the exported call structure: same seed →
//       byte-identical rows; per-call _physics routing actually changes gas
//       (6 distinct condition signatures); E8 options take effect
//   T6  real small run via CLI: gate passes, rows well-formed, dataset
//       export verifies (artifacts cleaned up after)
// Run: node --test tests/e7_e8_batch.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "e7_e8_batch_validate.js");
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

const E7_CONDS = ["e7_sparse_clean", "e7_default", "e7_dense_noisy"];
const E8_CONDS = ["e8_adaptive", "e8_fixed", "e8_mem4"];

test("T1 — script exists, parses, selftest passes (physics routing + gas parity)", () => {
  assert.ok(fs.existsSync(SCRIPT), "e7_e8_batch_validate.js missing");
  execFileSync(process.execPath, ["--check", SCRIPT]);
  const out = execFileSync(process.execPath, [SCRIPT, "--selftest"], { encoding: "utf8" });
  assert.match(out, /selftest welchT: OK/);
  assert.match(out, /selftest factories: OK/);
  assert.match(out, /selftest physics routing: OK/);
  assert.match(out, /selftest e8\/default gas parity: OK/);
});

test("T2 — config pins: worker-exact E8 options, per-CALL physics structure, engine + stats untouched, C-3 export", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  // all six conditions in the default lists
  assert.match(src, /e7_sparse_clean/);
  assert.match(src, /e7_dense_noisy/);
  assert.match(src, /condition: "e8_adaptive"/);
  assert.match(src, /condition: "e8_fixed"/);
  assert.match(src, /condition: "e8_mem4"/);
  // worker-exact E8 options (no tuning)
  assert.match(src, /\{ condition: "e8_adaptive", opts: \{ adaptive: true \} \}/);
  assert.match(src, /\{ condition: "e8_fixed",\s*opts: \{ adaptive: false \} \}/);
  assert.match(src, /\{ condition: "e8_mem4",\s*opts: \{ memSize: 4 \} \}/);
  // E7 regime constants (worker physics convention)
  assert.match(src, /nParticles: 120, noise: 0\.0/);
  assert.match(src, /nParticles: 320, noise: 0\.12/);
  assert.match(src, /nParticles: 640, noise: 0\.30/);
  // per-CALL physics: each E7 regime is its own runBenchmark with a fixed
  // _physics closure (NOT an si-conditional map — the engine hook is per-call)
  assert.match(src, /_physics: \(\) => \(\{ nParticles: reg\.nParticles, noise: reg\.noise \}\)/);
  assert.match(src, /_physics: \(\) => \(\{ nParticles: E8_GAS\.nParticles, noise: E8_GAS\.noise \}\)/);
  assert.doesNotMatch(src, /si === 0 \?/); // the old per-seed-index flaw must stay out
  // determinism gate reuses the same call structure
  assert.match(src, /runSeedCalls\(BASE, 0, rerun\)/);
  // honesty: the worker-exact mem4 arm is behaviorally inert (engine memory
  // buffer write-only) — validator must report the structural audit, not hide it
  assert.match(src, /e8_structural_audit/);
  assert.match(src, /write-only/);
  assert.match(src, /STRUCTURAL AUDIT FAILED/);
  assert.doesNotMatch(src, /\["e8_adaptive", "e8_mem4"\]/); // vacuous pairs removed
  // engine + stats canonical
  assert.match(src, /CORE\.runBenchmark\(/);
  assert.doesNotMatch(src, /function runBenchmark/);
  assert.match(src, /require\("\.\/stats_utils\.js"\)/);
  assert.doesNotMatch(src, /function welchT/);
  // C-3 export + display-payload hygiene
  assert.match(src, /dataset_export\.js/);
  assert.match(src, /delete row\.fireVec/);
  // LF-only
  assert.equal(src.includes("\r"), false, "script contains CR characters");
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

test("T5 — in-process: per-call physics routing changes gas; E8 options take effect; same seed → identical rows", () => {
  const CORE = require(path.join(ROOT, "experiment_core.js"));
  // replicate the validator's call structure using its own exported routing
  function runSeedCalls(seed) {
    const rows = [];
    const push = (cond, phase, tr) => {
      const row = Object.assign({}, tr, { condition: cond, phase });
      delete row.fireVec;
      rows.push(row);
    };
    for (const cond of E7_CONDS) {
      const reg = MOD.physicsFor(cond);
      CORE.runBenchmark({
        seed, nSeeds: 1, trialsTrain: 1, trialsTest: 1,
        episodeSeconds: 12, dt: 1 / 60, nParticles: 320, maxCrossingsPerTrial: 50,
        _physics: () => ({ nParticles: reg.nParticles, noise: reg.noise }),
        controllers: { [cond]: MOD.factoryFor(cond) },
        onTrialData: push,
      });
    }
    CORE.runBenchmark({
      seed, nSeeds: 1, trialsTrain: 1, trialsTest: 1,
      episodeSeconds: 12, dt: 1 / 60, nParticles: 320, maxCrossingsPerTrial: 50,
      _physics: () => ({ nParticles: 320, noise: 0.12 }),
      controllers: Object.fromEntries(E8_CONDS.map(c => [c, MOD.factoryFor(c)])),
      onTrialData: push,
    });
    return rows;
  }
  const a = runSeedCalls(7);
  const b = runSeedCalls(7);
  assert.equal(a.length, 6 * 2, "expected 6 conditions x 2 trials rows");
  // determinism: identical rows, in order
  const FIELDS = ["crossings", "goodCrossings", "badCrossings", "openFraction",
                  "demonAgree", "dTfinal", "sortEntropy", "measuredBits", "steps"];
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].condition, b[i].condition, "row order diverged at " + i);
    for (const f of FIELDS) {
      const na = a[i][f] === null || a[i][f] === undefined ? 0 : a[i][f];
      const nb = b[i][f] === null || b[i][f] === undefined ? 0 : b[i][f];
      assert.ok(Math.abs(na - nb) < 1e-9, "row " + i + " field " + f + " diverged");
    }
  }
  // physics routing + E8 options: all six conditions produce distinct behavior,
  // EXCEPT the two pinned identities (worker-exact arms are row-identical to
  // e8_adaptive at matched gas; the validator's audit asserts these too)
  const conds = [...new Set(a.map(r => r.condition))];
  assert.deepEqual(conds.sort(), [...E7_CONDS, ...E8_CONDS].sort());
  const sig = cond => JSON.stringify(a.filter(r => r.condition === cond)
    .map(r => FIELDS.map(f => r[f])));
  const groups = new Map(); // signature -> conditions sharing it
  for (const c of E7_CONDS.concat(E8_CONDS)) {
    const k = sig(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  assert.equal(groups.size, 4, "expected 4 distinct row signatures, got " + groups.size);
  const triplet = groups.get(sig("e8_adaptive"));
  assert.deepEqual([...triplet].sort(), ["e7_default", "e8_adaptive", "e8_mem4"],
    "e7_default / e8_adaptive / e8_mem4 should be row-identical " +
    "(matched gas, default opts, memory buffer write-only): got " + triplet.join(","));
  // ...and the effective information contrast is real: adaptive != fixed
  assert.notEqual(sig("e8_fixed"), sig("e8_adaptive"), "adaptive and fixed collapsed");
});

test("T6 — real small run via CLI: gate passes, rows well-formed, C-3 export verifies", () => {
  const DX = require(path.join(ROOT, "dataset_export.js"));
  const RD = path.join(ROOT, "research_data");
  fs.mkdirSync(RD, { recursive: true });
  const before = new Set(fs.readdirSync(RD).filter(f => f.startsWith("e7_e8_")));
  const out = execFileSync(process.execPath, [SCRIPT,
    "--seeds", "1", "--train", "1", "--test", "1", "--episode", "12",
    "--particles", "320", "--base", "7", "--no-html"], { encoding: "utf8" });
  assert.match(out, /reproducibility: same seed -> IDENTICAL rows/);
  assert.match(out, /4 calls: 3 E7 regimes \+ 1 E8 shared-gas/);
  const after = fs.readdirSync(RD).filter(f => f.startsWith("e7_e8_") && !before.has(f));
  const csv = after.find(f => f.endsWith(".csv"));
  const man = after.find(f => f.endsWith(".manifest.json"));
  assert.ok(csv && man, "dataset pair not written: " + after.join(", "));
  try {
    const v = DX.verifyDataset(path.join(RD, csv), path.join(RD, man));
    assert.deepEqual(v.errors, []);
    assert.equal(v.manifest.n_rows, 6 * 2, "expected 12 data rows");
    const lines = fs.readFileSync(path.join(RD, csv), "utf8").trim().split(/\r?\n/);
    const head = lines[0].split(",");
    for (const m of ["experiment", "condition", "phase", "seed", "trial"])
      assert.ok(head.includes(m), "missing meta column " + m);
    const conds = new Set(lines.slice(1).map(l => l.split(",")[head.indexOf("condition")]));
    assert.equal(conds.size, 6);
  // manifest carries the per-condition gas provenance + structural audit
  assert.equal(v.manifest.config.e8_gas.nParticles, 320);
  assert.equal(v.manifest.config.e8_gas.noise, 0.12);
  assert.equal(v.manifest.config.e7_regimes.length, 3);
  assert.equal(v.manifest.config.e8_structural_audit.e8_adaptive_equals_e7_default, true);
  assert.equal(v.manifest.config.e8_structural_audit.e8_mem4_equals_e8_adaptive, true);
  } finally {
    for (const f of after) fs.rmSync(path.join(RD, f), { force: true });
  }
});
