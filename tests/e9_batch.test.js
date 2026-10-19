// C-8 E9 batch validation acceptance tests (unified-schema re-run).
//   T1  script exists, parses, selftest passes (canonical-Welch anchor)
//   T2  config pins: canonical stats_utils.welchT (no local copy), pairing
//       flag wiring, worker-exact brain factory, C-3 export, fireVec stripped,
//       import-safe main guard, LF-only
//   T3  import-safety + delegated Welch anchor (t=-1.8516, df=10, p=0.0938)
//   T4  real mini-run via CLI: determinism gate passes, JSONL rows carry no
//       fireVec, C-3 dataset verifies with meta columns + pairing provenance
// Run: node --test tests/e9_batch.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "e9_batch_validate.js");
const require = createRequire(import.meta.url);

test("T1 — script exists, parses, selftest passes (canonical-Welch anchor)", () => {
  assert.ok(fs.existsSync(SCRIPT), "e9_batch_validate.js missing");
  execFileSync(process.execPath, ["--check", SCRIPT]);
  const out = execFileSync(process.execPath, [SCRIPT, "--selftest"], { encoding: "utf8" });
  assert.match(out, /selftest welchT: anchor p\(t=2,df=10\)=0\.073388 .*OK/);
  assert.match(out, /selftest normal limit: .*OK/);
  assert.match(out, /selftest edges: .*OK/);
  assert.match(out, /selftest trialStats: .*OK/);
  assert.match(out, /selftest passed/);
});

test("T2 — config pins: canonical Welch, pairing wiring, C-3 export, fireVec hygiene, import-safe, LF-only", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  // canonical stats only — the private Welch copy must stay gone
  assert.match(src, /require\("\.\/stats_utils\.js"\)/);
  assert.match(src, /const welchT = SU\.welchT/);
  assert.doesNotMatch(src, /function welchT/);
  assert.doesNotMatch(src, /function betacf/);
  // credit-pairing flag wired to the brain factory (legacy vs corrected)
  assert.match(src, /const PAIRING = argVal\("pairing", "legacy"\)/);
  assert.match(src, /pgBaseline: PAIRING === "corrected"/);
  // worker-exact brain factory options (no tuning)
  assert.match(src, /makeRng\(9176 \+ \(seedIdx \|\| 0\) \* 37\)/);
  assert.match(src, /motorDrive: 0\.6/);
  // import-safe main guard + export block
  assert.match(src, /if \(require\.main === module\) main\(\)/);
  assert.match(src, /module\.exports = \{ trialStats, welchT, e9BrainFactory, main \}/);
  assert.match(src, /dataset_export\.js/);
  // display payload never persisted
  assert.match(src, /delete row\.fireVec/);
  // determinism gate present
  assert.match(src, /reproducibility gate FAILED/);
  // LF-only
  assert.equal(src.includes("\r"), false, "script contains CR characters");
});

test("T3 — import-safety + delegated Welch anchor (t=-1.8516, df=10, p=0.0938)", () => {
  const M = require(SCRIPT);   // requiring must NOT run the batch
  assert.equal(typeof M.trialStats, "function");
  assert.equal(typeof M.welchT, "function");
  assert.equal(typeof M.e9BrainFactory, "function");
  assert.equal(typeof M.main, "function");
  const SU = require(path.join(ROOT, "stats_utils.js"));
  assert.equal(M.welchT, SU.welchT, "e9 welchT must BE the canonical implementation");
  const w = M.welchT([5, 6, 7, 8, 9, 10], [7, 8, 9, 10, 11, 12]);
  assert.ok(Math.abs(Math.abs(w.t) - 1.8516) < 2e-3);
  assert.ok(Math.abs(w.df - 10) < 1e-6);
  assert.ok(Math.abs(w.p - 0.0938) < 5e-4);
});

test("T4 — real mini-run via CLI: gate passes, JSONL free of fireVec, C-3 export verifies", () => {
  const DX = require(path.join(ROOT, "dataset_export.js"));
  const RD = path.join(ROOT, "research_data");
  fs.mkdirSync(RD, { recursive: true });
  const before = new Set(fs.readdirSync(RD).filter(f => f.startsWith("e9_")));
  const out = execFileSync(process.execPath, [SCRIPT,
    "--seeds", "2", "--train", "2", "--test", "2", "--episode", "8",
    "--particles", "160", "--base", "1", "--no-html"], { encoding: "utf8" });
  assert.match(out, /reproducibility: same seed -> IDENTICAL trajectory/);
  assert.match(out, /credit pairing: legacy/);
  assert.match(out, /dataset: .*e9_dataset_.*\.csv/);
  const after = fs.readdirSync(RD).filter(f => f.startsWith("e9_") && !before.has(f));
  const jsonl = after.find(f => /^e9_batch_.*\.jsonl$/.test(f));
  const csv = after.find(f => f.endsWith(".csv"));
  const man = after.find(f => f.endsWith(".manifest.json"));
  assert.ok(jsonl && csv && man, "artifacts not written: " + after.join(", "));
  try {
    // JSONL rows must not carry the display payload
    for (const line of fs.readFileSync(path.join(RD, jsonl), "utf8").split("\n")) {
      if (!line.trim()) continue;
      assert.ok(!("fireVec" in JSON.parse(line)), "fireVec persisted in JSONL");
    }
    // C-3 dataset verifies with schema + provenance
    const v = DX.verifyDataset(path.join(RD, csv), path.join(RD, man));
    assert.deepEqual(v.errors, []);
    assert.equal(v.manifest.experiment, "e9");
    assert.equal(v.manifest.n_rows, 2 * 3 * 4, "2 seeds x 3 variants x 4 trials");
    for (const m of ["experiment", "condition", "phase", "seed", "trial"])
      assert.ok(v.manifest.meta_columns.includes(m), "missing meta column " + m);
    assert.equal(v.manifest.config.pairing, "legacy");
    assert.equal(v.manifest.config.engine.includes("pressureDemonCore"), true);
  } finally {
    for (const f of after) fs.rmSync(path.join(RD, f), { force: true });
  }
});
