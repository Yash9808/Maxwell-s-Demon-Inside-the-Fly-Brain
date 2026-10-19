/**
 * stage1_five_arm_smoke.test.js — fast five-arm Stage-1 smoke (audit item 3).
 *
 * Runs the FULL Stage-1 driver (node benchmark.js --config <tiny config>) twice
 * with identical seeds and verifies, end to end:
 *   V1  process exits 0; both the trials JSONL and manifest are produced
 *   V2  row counts: 5 arms x 1 pair x (1 pre + 2 train + 1 post) = 20 rows,
 *       manifest phaseCounts match the config
 *   V3  every pre row: frozenPre === true, frozenPreSeconds === config value,
 *       weightDrift === 0 EXACTLY; weightDrift present (finite number) on all rows
 *   V4  every row parses as strict JSON; numeric fields finite
 *   V5  determinism: the two runs' trials JSONL are BYTE-IDENTICAL
 *
 * Run:  node --test tests/stage1_five_arm_smoke.test.js
 * (also invoked as S16 by tests/run_smoke.js)
 *
 * Runtime budget: < 90 s on the dev machine (two tiny benchmark subprocesses;
 * circuit parse dominates). No output files survive a passing run: the test
 * deletes exactly the stage1_* artifacts it caused benchmark.js to create.
 *
 * This file is NOT pinned by PRE_REGISTRATION_STAGE1.json (engineering smoke,
 * zero evidential weight — like stage1_smoke_config.json).
 */
"use strict";
const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CFG = path.join(__dirname, "stage1_smoke_tiny_config.json");
const OUTDIR = path.join(ROOT, "research_data");
const TRIALS_RE = /^stage1_trials_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.jsonl$/;
const MANIFEST_RE = /^stage1_manifest_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/;

const NUMERIC = ["crossings", "goodCrossings", "badCrossings", "energyJ", "jetWorkJ",
  "openFraction", "dTfinal", "sortEntropy", "steps", "miNeural", "measuredBits", "weightDrift"];

function listStage1Outputs() {
  return new Set(fs.readdirSync(OUTDIR).filter(f => TRIALS_RE.test(f) || MANIFEST_RE.test(f)));
}
function newestFile(re) {
  const files = fs.readdirSync(OUTDIR).filter(f => re.test(f))
    .map(f => ({ f, m: fs.statSync(path.join(OUTDIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files.length ? files[0].f : null;
}

test("five-arm Stage-1 smoke (all arms, all phases, run-twice byte determinism)", (t) => {
  const config = JSON.parse(fs.readFileSync(CFG, "utf8"));
  const circuitOk = fs.existsSync(path.join(ROOT, "fly_brain_circuit.json"));
  const preregOk = fs.existsSync(path.join(ROOT, "PRE_REGISTRATION_STAGE1.json"));
  if (!circuitOk || !preregOk) {
    t.skip("fly_brain_circuit.json or PRE_REGISTRATION_STAGE1.json absent");
    return;
  }

  const before = listStage1Outputs();
  const created = new Set();
  const t0 = Date.now();
  let jsonl1 = null, jsonl2 = null, manifest1 = null;

  try {
    // ---- two identical runs (run 1 bytes are captured BEFORE run 2 so a
    // ---- same-second output-stamp collision cannot fake determinism)
    for (let run = 1; run <= 2; run++) {
      const r = spawnSync(process.execPath,
        [path.join(ROOT, "benchmark.js"), "--config", CFG],
        { cwd: ROOT, timeout: 300000, encoding: "buffer" });
      assert.strictEqual(r.status, 0,
        `run ${run}: benchmark.js exited ${r.status}: ${Buffer.concat([r.stdout || Buffer.alloc(0), r.stderr || Buffer.alloc(0)]).toString("utf8").slice(-1500)}`);

      // V1 both artifacts produced
      const jl = newestFile(TRIALS_RE);
      const mf = newestFile(MANIFEST_RE);
      assert.ok(jl, `run ${run}: no stage1_trials_*.jsonl produced`);
      assert.ok(mf, `run ${run}: no stage1_manifest_*.json produced`);
      for (const f of listStage1Outputs()) if (!before.has(f)) created.add(f);
      for (const f of created) if (!before.has(f)) { /* union tracked */ }
      if (run === 1) { jsonl1 = fs.readFileSync(path.join(OUTDIR, jl)); manifest1 = JSON.parse(fs.readFileSync(path.join(OUTDIR, mf), "utf8")); }
      else { jsonl2 = fs.readFileSync(path.join(OUTDIR, jl)); }
    }
    const elapsedS = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`    [five-arm smoke] two runs in ${elapsedS} s (budget 90 s)`);

    // ---- V2 row counts + phaseCounts
    const rows = jsonl1.toString("utf8").split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
    assert.strictEqual(rows.length, 20, `expected 20 rows (5 arms x 4 trials), got ${rows.length}`);
    const arms = Object.keys(config.arms);
    for (const arm of arms) {
      const rs = rows.filter(r => r.condition === arm);
      assert.strictEqual(rs.length, 4, `${arm}: expected 4 rows, got ${rs.length}`);
      assert.strictEqual(rs.filter(r => r.phase === "pre").length, 1, `${arm}: pre rows`);
      assert.strictEqual(rs.filter(r => r.phase === "train").length, 2, `${arm}: train rows`);
      assert.strictEqual(rs.filter(r => r.phase === "test" || r.phase === "post").length, 1, `${arm}: post rows`);
      assert.strictEqual(rs[0].seed, config.seedTable.pairs[0].environmentSeed, `${arm}: env seed`);
      assert.strictEqual(rs[0].networkSeed, config.seedTable.pairs[0].networkSeed, `${arm}: net seed`);
    }
    for (const arm of arms) {
      const pc = manifest1.phaseCounts[arm];
      assert.deepStrictEqual(pc, { pre: 1, train: 2, post: 1 }, `${arm}: manifest phaseCounts`);
    }
    assert.strictEqual(manifest1.n_rows, 20, "manifest n_rows");
    assert.strictEqual(manifest1.stage, 1, "manifest stage");
    assert.ok(manifest1.files && manifest1.files.trialsSha256, "manifest records trials sha256");

    // ---- V3 frozen-pre contract
    for (const r of rows.filter(r => r.phase === "pre")) {
      assert.strictEqual(r.frozenPre, true, `pre row frozenPre (arm ${r.condition})`);
      assert.strictEqual(r.frozenPreSeconds, config.frozenPreSeconds, `pre row frozenPreSeconds (arm ${r.condition})`);
      assert.strictEqual(r.weightDrift, 0, `pre row weightDrift === 0 EXACT (arm ${r.condition})`);
    }
    for (const r of rows) {
      assert.ok(typeof r.weightDrift === "number" && Number.isFinite(r.weightDrift),
        `weightDrift present + finite on ${r.condition}/${r.phase}`);
    }

    // ---- V4 strict JSON + finite numerics (every row already parsed above)
    for (const r of rows) {
      for (const f of NUMERIC) {
        const v = r[f];
        assert.ok(v === undefined || (typeof v === "number" && Number.isFinite(v)),
          `${r.condition}/${r.phase}: field ${f} not finite: ${v}`);
      }
    }

    // ---- V5 determinism: byte-identical trials JSONL
    assert.ok(jsonl1.equals(jsonl2), "run-twice trials JSONL BYTE-IDENTICAL");
  } finally {
    // delete ONLY files this test caused to appear (never pre-existing ones);
    // on failure, keep them and name them for debugging instead.
    if (process.env.STAGE1_SMOKE_KEEP === "1") {
      console.log("    [five-arm smoke] STAGE1_SMOKE_KEEP=1 — kept:", [...created].join(", ") || "(none)");
    } else {
      let cleaned = true;
      for (const f of created) {
        try { fs.unlinkSync(path.join(OUTDIR, f)); }
        catch (e) { cleaned = false; console.error(`    [five-arm smoke] cleanup failed for ${f}: ${e.message}`); }
      }
      if (cleaned) console.log("    [five-arm smoke] cleaned up", created.size, "generated artifact(s)");
    }
  }
});
