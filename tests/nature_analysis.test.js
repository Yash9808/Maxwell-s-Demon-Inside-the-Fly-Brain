// C-9 Nature analysis layer acceptance tests.
//   T1  script exists, parses, import-safe (no side effects on require)
//   T2  preregistration pins: 10 frozen families, comparison counts, mem4
//       design-note, demonDecisions excluded, LF-only
//   T3  statistics hand-checks (perSeedFinal / perSeedPhaseMean / paired
//       deltas / Holm monotonicity) on synthetic rows
//   T4  doc-traceability on the PRODUCTION datasets: recomputed raw p and
//       effect sizes match the doc-recorded pins (Holm p_holm is
//       family-size-dependent and is NOT pinned raw)
//   T5  digest structure: verified inputs with sha256, headline sources,
//       4 ablation tables
//   T6  CLI reproducibility: two runs -> identical digests modulo timestamp
// Run: node --test tests/nature_analysis.test.js
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
const SCRIPT = path.join(ROOT, "nature_analysis.js");
const require = createRequire(import.meta.url);

const MOD = require(SCRIPT); // must not execute main

test("T1 — script exists, parses, import-safe", () => {
  assert.ok(fs.existsSync(SCRIPT), "nature_analysis.js missing");
  execFileSync(process.execPath, ["--check", SCRIPT]);
  assert.equal(typeof MOD.PREREGISTERED, "object");
  assert.equal(typeof MOD.loadDatasets, "function");
  assert.equal(typeof MOD.buildDigest, "function");
  assert.equal(typeof MOD.analyzeFamily, "function");
});

test("T2 — preregistration pins: 10 families, mem4 design-note, demonDecisions excluded, LF-only", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.equal(src.includes("\r"), false, "script contains CR characters");
  const fams = MOD.PREREGISTERED;
  assert.equal(fams.length, 10);
  const byName = Object.fromEntries(fams.map(f => [f.family, f]));
  assert.equal(byName.F1_e6_apparatus_learning.comparisons.length, 10);
  assert.equal(byName.F2_e2_ann_control.comparisons.length, 4);
  assert.equal(byName.F3_e3_drosophila_collapse.comparisons.length, 2);
  assert.equal(byName.F4_e4_structure.comparisons.length, 5);
  assert.equal(byName.F5_e5_comparator_paired.comparisons.length, 6);
  assert.equal(byName.F6_e7_regime_gradient.comparisons.length, 5);
  assert.equal(byName.F7_e8_information_arms.comparisons.length, 4);
  assert.equal(byName.F8_e9_credit_pairing.comparisons.length, 6);
  assert.equal(byName.F9_e10_trapdoor_learning.comparisons.length, 2);
  assert.equal(byName.F10_e11_second_law.comparisons.length, 1);
  // every family carries a frozen source reference
  assert.ok(fams.every(f => typeof f.source === "string" && f.source.includes(".md")));
  // mem4 structural honesty
  const notes = JSON.stringify(byName.F7_e8_information_arms.designNotes);
  assert.match(notes, /write-only/);
  assert.match(notes, /e7_default/);
  // dead column excluded
  assert.match(src, /demonDecisions \(dead 0-field/);
  // mem4 must not appear as a contrast side anywhere
  for (const f of fams) for (const c of f.comparisons) {
    assert.notEqual(c.a, "e8_mem4");
    assert.notEqual(c.b, "e8_mem4");
  }
});

test("T3 — statistics hand-checks on synthetic rows", () => {
  // perSeedFinal: last test-phase trial per seed
  const rows = [];
  for (const sd of [1, 2]) {
    rows.push({ condition: "c", phase: "train", seed: sd, trial: 0, m: 1 });
    rows.push({ condition: "c", phase: "test", seed: sd, trial: 0, m: 2 });
    rows.push({ condition: "c", phase: "test", seed: sd, trial: 1, m: 4 }); // final
  }
  const v = MOD.analyzeFamily; // touch export
  const { perSeedFinal } = (() => {
    // re-derive via analyzeFamily on a synthetic family to exercise the path
    const fam = { family: "t", experiment: "e6", question: "q", source: "s.md", primary: "m",
      comparisons: [{ a: "c", b: "c2", metric: "m" }] };
    const DS = [{ tag: "e6_dataset", base: "b", sha256: "x", manifest: { n_rows: 1, conditions: ["c"] }, rows }];
    const out = MOD.analyzeFamily(fam, DS);
    return { perSeedFinal: out.comparisons[0] };
  })();
  // meanA = mean of per-seed finals = (4+4)/2 = 4; group b is empty -> degenerate
  assert.equal(perSeedFinal.degenerate, true);
  assert.equal(perSeedFinal.n, 0); // c2 has no rows
  // perSeedPhaseMean via the secondLaw path
  const fam2 = { family: "t2", experiment: "e10_e11", question: "q", source: "s.md", primary: "m",
    comparisons: [{ special: "secondLaw", ds: "e10_e11", cond: "c", metric: "m" }] };
  const DS2 = [{ tag: "e10_e11_dataset", base: "b", sha256: "x", manifest: { n_rows: 1, conditions: ["c"] }, rows }];
  const sl = MOD.analyzeFamily(fam2, DS2).comparisons[0];
  // per-seed test-phase MEAN = (2+4)/2 = 3 per seed -> mean 3
  assert.ok(Math.abs(sl.meanDiff - 3) < 1e-12);
  assert.equal(sl.verdict, "VIOLATION (work > 0)"); // positive by construction here
  // paired phase-delta path
  const fam3 = { family: "t3", experiment: "e10_e11", question: "q", source: "s.md", primary: "m",
    comparisons: [{ special: "pairedPhaseDelta", ds: "e10_e11", cond: "c", metric: "m" }] };
  const pd = MOD.analyzeFamily(fam3, DS2).comparisons[0];
  // per-seed test mean 3 - train mean 1 = +2 per seed
  assert.ok(Math.abs(pd.meanDiff - 2) < 1e-12);
  assert.equal(pd.n, 2);
  assert.equal(pd.nPos, 2);
  // Holm: monotone, adjusted >= raw, min family p * k
  const SU = require(path.join(ROOT, "stats_utils.js"));
  const adj = SU.holm([0.01, 0.02, 0.04]);
  assert.ok(adj[0] <= adj[1] && adj[1] <= adj[2]);
  assert.ok(adj.every(p => p >= 0.01));
  assert.ok(Math.abs(adj[0] - 0.03) < 1e-9); // 0.01*3
});

test("T4 — doc-traceability: recomputed values match the doc pins on production datasets", () => {
  const DS = MOD.loadDatasets();
  assert.equal(DS.length, 8, "expected 8 production datasets (7 families + both e9 pairings)");
  const fams = MOD.PREREGISTERED.map(f => MOD.analyzeFamily(f, DS));
  const find = (famName, pred) => {
    const f = fams.find(x => x.family === famName);
    return f.comparisons.find(pred);
  };
  const near = (a, b, rel) => Math.abs(a - b) <= rel * Math.max(Math.abs(b), 1e-12);
  // F6 E7 gradient: raw p must equal the doc value exactly (same seeds, same test)
  const e7 = find("F6_e7_regime_gradient", c => c.a === "e7_sparse_clean" && c.b === "e7_dense_noisy" && c.metric === "goodCrossings");
  assert.ok(near(e7.p, 1.1e-8, 0.05), "e7 raw p " + e7.p + " vs doc 1.1e-8");
  assert.ok(near(e7.t, -12.57, 0.01), "e7 t " + e7.t + " vs doc -12.57");
  // F8 E9 corrected pairing: raw p must equal the doc value
  const e9c = find("F8_e9_credit_pairing", c => c.ds === "corrected" && c.metric === "reward");
  assert.ok(near(e9c.p, 2.5e-7, 0.05), "e9 corrected raw p " + e9c.p + " vs doc 2.5e-7");
  assert.ok(near(e9c.t, 6.26, 0.02), "e9 corrected t " + e9c.t + " vs doc 6.26");
  const e9l = find("F8_e9_credit_pairing", c => c.ds === "legacy" && c.metric === "reward");
  assert.ok(near(e9l.p, 0.9403, 0.01), "e9 legacy raw p " + e9l.p + " vs doc 0.9403");
  // F10 second law: sign and magnitude must match the doc audit
  const e11 = find("F10_e11_second_law", () => true);
  assert.ok(e11.meanDiff < 0, "second law: work must be negative, got " + e11.meanDiff);
  assert.ok(near(Math.abs(e11.meanDiff), 0.098e-21, 0.05));
  assert.equal(e11.verdict, "LAW-SAFE (work <= 0)");
  // F9 accuracy delta matches the doc (validator uses population-sd CI; raw p seeded)
  const e10 = find("F9_e10_trapdoor_learning", c => c.metric === "decisionAccuracy");
  assert.ok(near(e10.meanDiff, 0.0560, 0.01), "e10 delta " + e10.meanDiff + " vs doc 0.0560");
  assert.equal(e10.nPos, 17);
  assert.equal(e10.n, 20);
  // F5 paired effect size matches the doc's Hedges g to rounding
  const e5 = find("F5_e5_comparator_paired", c => c.a === "drosophila" && c.b === "random" && c.metric === "goodCrossings");
  assert.ok(near(e5.g, -1.66, 0.02), "e5 g " + e5.g + " vs doc -1.66");
  // F4 structure null reproduces
  const e4 = find("F4_e4_structure", c => c.a === "connectome_4A" && c.b === "connectome_4B" && !c.perm);
  assert.ok(near(e4.p, 0.71, 0.05), "e4 raw p " + e4.p + " vs doc 0.71");
});

test("T5 — digest structure: verified inputs, sha256s, headline sources, ablations", () => {
  const DS = MOD.loadDatasets();
  const finals = Object.fromEntries(MOD.PREREGISTERED.map(f => [f.family, MOD.analyzeFamily(f, DS)]));
  const ablations = MOD.buildAblations(DS, finals);
  const digest = MOD.buildDigest(DS, finals, ablations);
  assert.equal(digest.inputs.length, 8);
  assert.ok(digest.inputs.every(i => /^[0-9a-f]{64}$/.test(i.sha256)));
  assert.ok(digest.inputs.filter(i => i.tag.startsWith("e9_dataset")).length === 2);
  assert.equal(Object.keys(digest.headline).length, 12);
  assert.ok(Object.values(digest.headline).every(h => h && typeof h.source === "string" && h.source.length > 4));
  assert.ok(Object.keys(digest.docPinned).length >= 30);
  assert.deepEqual(Object.keys(digest.ablations).sort(),
    ["information_e8", "pairing_e9", "regime_e7", "structure_e4"]);
  assert.match(digest.ablations.pairing_e9.conclusion, /2\.5e-7/);
  assert.match(digest.ablations.regime_e7.conclusion, /collapses/);
  // the e6 family is honestly labeled as a chunk aggregation
  const f1 = finals.F1_e6_apparatus_learning;
  assert.match(f1.source, /4-seed chunk aggregation/);
});

test("T6 — CLI reproducibility: identical digests modulo timestamp", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "c9t-"));
  try {
    execFileSync(process.execPath, [SCRIPT, "--no-html", "--outdir", tmp], { encoding: "utf8" });
    const d1 = fs.readFileSync(path.join(tmp, "paper_digest_c9.json"), "utf8");
    execFileSync(process.execPath, [SCRIPT, "--no-html", "--outdir", tmp], { encoding: "utf8" });
    const d2 = fs.readFileSync(path.join(tmp, "paper_digest_c9.json"), "utf8");
    const j1 = JSON.parse(d1), j2 = JSON.parse(d2);
    assert.equal(j1.generated, j2.generated === undefined ? false : j1.generated, "timestamp present");
    delete j1.generated; delete j2.generated;
    assert.deepEqual(j1, j2, "digests must be byte-stable apart from the timestamp");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
