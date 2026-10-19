// C-8 E10/E11 batch validation acceptance tests (unified-schema re-run).
//   T1  script exists, parses, import-safe (no side effects on require)
//   T2  config pins: worker-exact brain options, core constants (220p, 24+8
//       eps, 12 s), single-pass export (no re-simulation), determinism gate,
//       main guard, LF-only
//   T3  hand-check of the phases() aggregator + ci95()
//   T4  real mini-run via CLI: gate passes, dataset carries both experiments
//       (e10/e11), meta columns + variants provenance, verifies clean
// Run: node --test tests/e10_e11_batch.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "e10_e11_batch_validate.js");
const require = createRequire(import.meta.url);

test("T1 — script exists, parses, import-safe (no side effects on require)", () => {
  assert.ok(fs.existsSync(SCRIPT), "e10_e11_batch_validate.js missing");
  execFileSync(process.execPath, ["--check", SCRIPT]);
  const M = require(SCRIPT);
  assert.equal(typeof M.main, "function");
  assert.equal(typeof M.brainFactoryFor, "function");
  assert.equal(typeof M.phases, "function");
  assert.equal(typeof M.ci95, "function");
});

test("T2 — config pins: worker-exact brains, core constants, single-pass export, gate, main guard, LF-only", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  // worker-exact brain factory (no tuning)
  assert.match(src, /connectomeController\(circuit, \{/);
  assert.match(src, /motorDrive: 0\.6/);
  assert.match(src, /pgRng: makeRng\(500000 \+ seed\)/);
  // core constants pinned
  assert.match(src, /const TR = 24, TT = 8;/);
  assert.match(src, /nParticles: 220/);
  // eligibility + PG options (worker E10/E11 setup)
  assert.match(src, /tau: 0\.90, w: 0\.45/);
  assert.match(src, /policyGradient: true, pgBaseline: true, pgKc: true/);
  // single-pass export: analysis callback feeds dsRows; the re-simulation
  // loop from the earlier draft must stay gone
  assert.match(src, /dsRows\.push\(Object\.assign\(\{\}, r, \{ experiment: "e10" \}\)\)/);
  assert.match(src, /dsRows\.push\(Object\.assign\(\{\}, r, \{ experiment: "e11" \}\)\)/);
  assert.doesNotMatch(src, /for \(let s = 1; s <= SEEDS; s\+\+\) \{\s*\n\s*smoluchowskiCore\(\{[^}]*dsRows/);
  // determinism gate + import-safe main guard
  assert.match(src, /reproducibility: same seed -> " \+/);
  assert.match(src, /reproducibility gate FAILED/);
  assert.match(src, /if \(require\.main === module\) main\(\)/);
  assert.match(src, /dataset_export\.js/);
  // LF-only
  assert.equal(src.includes("\r"), false, "script contains CR characters");
});

test("T3 — phases() hand-check + ci95()", () => {
  const M = require(SCRIPT);
  const rows = [];
  for (let t = 0; t < 3; t++) rows.push({ phase: "train", reward: 1 + t, weightDrift: 0.5 });
  for (let t = 0; t < 2; t++) rows.push({ phase: "test", reward: 4 + t, weightDrift: 0 });
  const ph = M.phases(rows, ["reward", "weightDrift"]);
  assert.ok(Math.abs(ph.reward.train - 2) < 1e-12);
  assert.ok(Math.abs(ph.reward.test - 4.5) < 1e-12);
  assert.ok(Math.abs(ph.weightDrift.test - 0) < 1e-12);
  // ci95 uses the POPULATION sd (divide by n) — the validator's established
  // convention since the September E10/E11 runs; pin it, don't change it
  const ci = M.ci95([1, 2, 3]);
  assert.ok(Math.abs(ci - 1.96 * Math.sqrt(2 / 3) / Math.sqrt(3)) < 1e-12);
  assert.ok(M.ci95([5]) === 0, "ci95 of a single value must be 0");
});

test("T4 — real mini-run via CLI: gate passes, dual-experiment dataset verifies", () => {
  const DX = require(path.join(ROOT, "dataset_export.js"));
  const RD = path.join(ROOT, "research_data");
  fs.mkdirSync(RD, { recursive: true });
  const before = new Set(fs.readdirSync(RD).filter(f => f.startsWith("e10_e11_dataset")));
  const out = execFileSync(process.execPath, [SCRIPT, "--seeds", "1"], { encoding: "utf8" });
  assert.match(out, /reproducibility: same seed -> IDENTICAL trajectories \(E10\+E11\)/);
  assert.match(out, /dataset: .*e10_e11_dataset_.*\.csv/);
  const after = fs.readdirSync(RD).filter(f => f.startsWith("e10_e11_dataset") && !before.has(f));
  const csv = after.find(f => f.endsWith(".csv"));
  const man = after.find(f => f.endsWith(".manifest.json"));
  assert.ok(csv && man, "dataset pair not written: " + after.join(", "));
  try {
    const v = DX.verifyDataset(path.join(RD, csv), path.join(RD, man));
    assert.deepEqual(v.errors, []);
    assert.equal(v.manifest.experiment, "e10_e11");
    // per seed: (24+8) train+test eps x ALL core variants (neural + frozen
    // + physics probes light/heavy/gradient/equilibrium/heavy_load), 288 rows
    const conds = new Set(v.manifest.conditions);
    for (const c of ["trapdoor_neural", "trapdoor_frozen", "trapdoor_light",
                     "trapdoor_heavy", "ratchet_neural", "ratchet_frozen",
                     "ratchet_gradient", "ratchet_equilibrium", "ratchet_heavy_load"])
      assert.ok(conds.has(c), "missing condition " + c);
    assert.equal(v.manifest.n_rows, 288, "1 seed x 32 eps x 9 variants");
    for (const m of ["experiment", "condition", "phase", "seed", "trial"])
      assert.ok(v.manifest.meta_columns.includes(m), "missing meta column " + m);
    // rows carry per-row experiment tags e10 / e11
    const lines = fs.readFileSync(path.join(RD, csv), "utf8").trim().split(/\r?\n/);
    const head = lines[0].split(",");
    const ei = head.indexOf("experiment"), ci = head.indexOf("condition");
    const exps = new Set(lines.slice(1).map(l => l.split(",")[ei]));
    assert.deepEqual([...exps].sort(), ["e10", "e11"]);
    const condsInCsv = new Set(lines.slice(1).map(l => l.split(",")[ci]));
    assert.ok(condsInCsv.has("trapdoor_neural") && condsInCsv.has("ratchet_neural"));
  } finally {
    for (const f of after) fs.rmSync(path.join(RD, f), { force: true });
  }
});
