#!/usr/bin/env node
"use strict";
/**
 * nature_analysis.js — C-9 (build-plan row 24): Nature analysis layer.
 *
 * Reads the SEVEN production C-3 dataset families (csv + sha256-pinned
 * manifest; every input verified with dataset_export.verifyDataset before
 * use) and produces:
 *   1. PREREGISTERED comparison families — the list below is frozen from the
 *      C-1..C-8 results docs (written BEFORE this analysis; no re-picking).
 *      Each comparison: per-seed extraction, Welch t + Hedges g + 95% CI of
 *      the difference, Holm correction WITHIN its family.
 *   2. ABLATION tables — structure (E4), information (E8), credit-pairing
 *      (E9), gas regime (E7): what each manipulated factor contributes.
 *   3. paper_digest.json — machine-readable, every entry traceable to a
 *      dataset sha256 and/or the doc-recorded value (mode: "pinned").
 *   4. An HTML report (reproducible-analysis style, dark theme).
 *
 * Traceability contract:
 *   - mode "dataset"  -> recomputed here from <base>.csv/.manifest.json
 *   - mode "pinned"   -> doc-recorded value quoted verbatim with its source
 *                        (the full-seed run behind it is chunked; see
 *                        DATASET_SCHEMA.md); the recomputed n=4 e6 family is
 *                        reported alongside for consistency checking.
 *   - mode "design-note" -> structural fact from the audit (PRE_C9_AUDIT.md)
 *
 * Usage: node nature_analysis.js [--no-html] [--outdir DIR]
 * Import-safe (require.main guard). Exports { PREREGISTERED, loadDatasets,
 * buildDigest } for tests.
 */

const fs = require("fs");
const path = require("path");
const SU = require("./stats_utils.js");
const DX = require("./dataset_export.js");

// ---------------------------------------------------------------- CLI
const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
const WANT_HTML = !args.includes("--no-html");
const OUTDIR = argVal("outdir", path.join(__dirname, "research_data"));

// ---------------------------------------------------------------- preregistration
// Frozen 2026-09-26 from the C-1..C-8 results docs BEFORE any recomputation.
// Families isolate the Holm correction; primary metric per family listed.
const PREREGISTERED = [
  {
    family: "F1_e6_apparatus_learning",
    experiment: "e6",
    question: "Does the fly brain's plasticity change behavior at the jet-gate apparatus vs its own frozen control? (E6)",
    primary: "goodCrossings",
    source: "PHASE_C_E6.md (20-seed chunked run; dataset artifact is a 4-seed chunk aggregation — recomputed values are labeled n=4 and the doc values are pinned)",
    comparisons: [
      { a: "demon_neural", b: "demon_frozen", metric: "goodCrossings", pinned: { t: 0.54, p: 0.592, ref: "PHASE_C_E6.md L69" } },
      { a: "demon_neural", b: "demon_frozen", metric: "goodBadRatio", pinned: { t: -1.23, p: 0.231, ref: "PHASE_C_E6.md L70" } },
      { a: "demon_neural", b: "demon_frozen", metric: "openFraction", pinned: { t: 0.51, p: 0.616, ref: "PHASE_C_E6.md L71" } },
      { a: "demon_neural", b: "demon_frozen", metric: "demonAgree", pinned: { t: 0.22, p: 0.826, ref: "PHASE_C_E6.md L72" } },
      { a: "demon_neural", b: "demon_frozen", metric: "dTfinal", pinned: { t: -0.52, p: 0.608, ref: "PHASE_C_E6.md L73" } },
      { a: "demon_neural", b: "classical_demon", metric: "goodCrossings", pinned: { t: -1.93, p: 0.062, ref: "PHASE_C_E6.md L77" } },
      { a: "demon_neural", b: "classical_demon", metric: "goodBadRatio", pinned: { t: -2.26, p: 0.030, ref: "PHASE_C_E6.md L78 (classical better)" } },
      { a: "demon_neural", b: "never_gate", metric: "goodCrossings", pinned: { t: 4.64, p: 0.0002, ref: "PHASE_C_E6.md L74" } },
      { a: "demon_frozen", b: "never_gate", metric: "goodCrossings", pinned: { t: 5.60, p: 2.1e-5, ref: "PHASE_C_E6.md L75" } },
      { a: "demon_neural", b: "never_gate", metric: "openFraction", pinned: { t: 6.29, p: 4.9e-6, ref: "PHASE_C_E6.md L76" } },
    ],
  },
  {
    family: "F2_e2_ann_control",
    experiment: "e2_e3",
    question: "Does the E2 ANN controller beat the random gate and match the classical reference? (E2)",
    primary: "goodCrossings",
    source: "E2_E3_C4_RESULTS.md L32-L34",
    comparisons: [
      { a: "ann", b: "random", metric: "goodCrossings", pinned: { p: 0.019, t: 2.52, ref: "E2_E3_C4_RESULTS.md L32" } },
      { a: "ann", b: "classical_demon", metric: "goodCrossings", pinned: { p: 0.053, t: 2.03, ref: "E2_E3_C4_RESULTS.md L34 (volume parity, ann nominally higher)" } },
      { a: "ann", b: "random", metric: "openFraction", pinned: null },
      { a: "ann", b: "random", metric: "goodBadRatio", pinned: null },
    ],
  },
  {
    family: "F3_e3_drosophila_collapse",
    experiment: "e2_e3",
    question: "Does the drosophila-morphology controller gate at all? (E3; preregistered direction: openFraction 0 vs random > 0)",
    primary: "openFraction",
    source: "E2_E3_C4_RESULTS.md (collapse table; random openFraction ~0.42)",
    comparisons: [
      { a: "drosophila", b: "random", metric: "openFraction", pinned: { p: "<=1e-5", ref: "E2_E3_C4_RESULTS.md collapse table (below random, p<=1e-5)" } },
      { a: "drosophila", b: "random", metric: "goodCrossings", pinned: null },
    ],
  },
  {
    family: "F4_e4_structure",
    experiment: "e4",
    question: "Do the connectome wiring variants (full/restricted/shuffled) differ behaviorally? (E4 structure null)",
    primary: "goodCrossings",
    source: "E4_C5_RESULTS.md L36-L38",
    comparisons: [
      { a: "connectome_4A", b: "connectome_4B", metric: "goodCrossings", pinned: { p: 0.71, ref: "E4_C5_RESULTS.md L36" } },
      { a: "connectome_4A", b: "connectome_4C", metric: "goodCrossings", pinned: { p: 0.65, ref: "E4_C5_RESULTS.md L36-37" } },
      { a: "connectome_4A", b: "connectome_frozen", metric: "goodCrossings", pinned: { p: 0.81, ref: "E4_C5_RESULTS.md L37" } },
      { a: "connectome_4B", b: "connectome_4C", metric: "goodCrossings", pinned: { p: 1.00, ref: "E4_C5_RESULTS.md L37" } },
      { a: "connectome_4A", b: "connectome_4C", metric: "goodCrossings", perm: true, pinned: { p: 0.71, ref: "E4_C5_RESULTS.md L38 (10k permutation)" } },
    ],
  },
  {
    family: "F5_e5_comparator_paired",
    experiment: "e5",
    question: "All-controller ranking on identical gas per seed (paired design; Holm within each metric)",
    primary: "goodCrossings",
    source: "E5_C6_RESULTS.md L35-L42",
    comparisons: [
      { a: "drosophila", b: "random", metric: "goodCrossings", paired: true, pinned: { diff: -2.92, g: -1.66, p: 0.0012, p_holm: 0.011, ref: "E5_C6_RESULTS.md L37" } },
      { a: "drosophila", b: "classical_demon", metric: "goodCrossings", paired: true, pinned: { diff: -3.17, g: -2.08, p: 0.0004, p_holm: 0.004, ref: "E5_C6_RESULTS.md L38" } },
      { a: "ann", b: "drosophila", metric: "goodCrossings", paired: true, pinned: { diff: 6.83, g: 1.29, p: 0.0041, p_holm: 0.033, ref: "E5_C6_RESULTS.md L39" } },
      { a: "ann", b: "drosophila", metric: "openFraction", paired: true, pinned: { diff: 0.75, g: 1.53, p: 0.0022, p_holm: 0.018, ref: "E5_C6_RESULTS.md L41" } },
      { a: "ann", b: "random", metric: "goodCrossings", paired: true, pinned: { p: 0.017, g: 0.81, note: "n.s. after correction — not claimed", ref: "E5_C6_RESULTS.md L43" } },
      { a: "connectome_4A", b: "random", metric: "goodCrossings", paired: true, pinned: { d: -0.33, p: 0.71, ref: "E5_C6_RESULTS.md ranking table (4A vs random)" } },
    ],
  },
  {
    family: "F6_e7_regime_gradient",
    experiment: "e7_e8",
    question: "Does the classical demon's fixed policy generalize across gas regimes, and does per-event sorting efficiency scale? (E7)",
    primary: "goodCrossings",
    source: "E7_E8_C7_RESULTS.md (gradient table; Holm within E7 family)",
    comparisons: [
      { a: "e7_sparse_clean", b: "e7_default", metric: "goodCrossings", pinned: { p: 0.0021, t: -3.49, p_holm: 0.0021, ref: "E7_E8_C7_RESULTS.md Welch table" } },
      { a: "e7_default", b: "e7_dense_noisy", metric: "goodCrossings", pinned: { p: 3.8e-8, t: -10.72, p_holm: 7.5e-8, ref: "E7_E8_C7_RESULTS.md" } },
      { a: "e7_sparse_clean", b: "e7_dense_noisy", metric: "goodCrossings", pinned: { p: 1.1e-8, t: -12.57, p_holm: 3.3e-8, ref: "E7_E8_C7_RESULTS.md" } },
      { a: "e7_sparse_clean", b: "e7_dense_noisy", metric: "dTfinal", pinned: null },
      { a: "e7_sparse_clean", b: "e7_dense_noisy", metric: "sortEntropy", pinned: null },
    ],
  },
  {
    family: "F7_e8_information_arms",
    experiment: "e7_e8",
    question: "Does the adaptive threshold beat the fixed threshold at matched gas? (E8; mem4 arm is structurally inert — design-note)",
    primary: "goodCrossings",
    source: "E7_E8_C7_RESULTS.md E8 section + structural audit",
    comparisons: [
      { a: "e8_adaptive", b: "e8_fixed", metric: "goodCrossings", pinned: { p: 0.175, t: -1.41, ref: "E7_E8_C7_RESULTS.md E8" } },
      { a: "e8_adaptive", b: "e8_fixed", metric: "goodBadRatio", pinned: { p: 0.385, ref: "E7_E8_C7_RESULTS.md E8" } },
      { a: "e8_adaptive", b: "e8_fixed", metric: "openFraction", pinned: { p: 0.112, ref: "E7_E8_C7_RESULTS.md E8" } },
      { a: "e8_adaptive", b: "e8_fixed", metric: "measuredBits", pinned: null },
    ],
    designNotes: [
      "e8_mem4 is row-identical to e8_adaptive (decision-memory buffer is write-only in the engine); excluded from contrasts (C-7 audit, PRE_C9_AUDIT.md)",
      "e8_adaptive is row-identical to e7_default by construction (matched gas + default opts) — used as the end-to-end consistency check",
    ],
  },
  {
    family: "F8_e9_credit_pairing",
    experiment: "e9",
    question: "Does corrected credit pairing (reward-time REINFORCE with EMA baseline) reveal learning that the legacy pairing hides? (E9, C-8)",
    primary: "reward",
    source: "E9_E10_E11_C8_RESULTS.md (both pairings, 20 seeds each)",
    datasets: { legacy: "e9 legacy", corrected: "e9 corrected" },
    comparisons: [
      { ds: "corrected", a: "demon_neural", b: "demon_frozen", metric: "reward", pinned: { t: 6.26, p: 2.5e-7, ref: "E9_E10_E11_C8_RESULTS.md corrected Welch table" } },
      { ds: "corrected", a: "demon_neural", b: "demon_frozen", metric: "decisionAccuracy", pinned: { t: 6.60, p: 8.6e-8, ref: "E9_E10_E11_C8_RESULTS.md" } },
      { ds: "corrected", a: "demon_neural", b: "demon_frozen", metric: "demonAgree", pinned: { t: 7.53, p: 4.9e-9, ref: "E9_E10_E11_C8_RESULTS.md" } },
      { ds: "corrected", a: "demon_neural", b: "demon_speed", metric: "reward", pinned: { t: -24.92, p: 5.6e-16, ref: "E9_E10_E11_C8_RESULTS.md" } },
      { ds: "legacy", a: "demon_neural", b: "demon_frozen", metric: "reward", pinned: { t: -0.08, p: 0.9403, ref: "E9_E10_E11_C8_RESULTS.md legacy Welch table" } },
      { ds: "legacy", a: "demon_neural", b: "demon_frozen", metric: "decisionAccuracy", pinned: { t: -0.48, p: 0.6305, ref: "E9_E10_E11_C8_RESULTS.md" } },
    ],
  },
  {
    family: "F9_e10_trapdoor_learning",
    experiment: "e10_e11",
    question: "Does the trapdoor pawl improve decision accuracy from TRAIN to TEST? (E10; per-seed paired delta)",
    primary: "decisionAccuracy",
    source: "E9_E10_E11_C8_RESULTS.md E10 (deltas: acc +0.0560±0.0187, 17/20)",
    comparisons: [
      { special: "pairedPhaseDelta", ds: "e10_e11", cond: "trapdoor_neural", metric: "decisionAccuracy", pinned: { mean: 0.0560, ci: 0.0187, nPos: "17/20", ref: "E9_E10_E11_C8_RESULTS.md E10 delta table" } },
      { special: "pairedPhaseDelta", ds: "e10_e11", cond: "trapdoor_neural", metric: "reward", pinned: { mean: 0.085, ci: 0.150, nPos: "11/20", ref: "E9_E10_E11_C8_RESULTS.md E10 delta table" } },
    ],
  },
  {
    family: "F10_e11_second_law",
    experiment: "e10_e11",
    question: "Second-law audit: does the ratchet pawl extract positive work at equilibrium? (E11; preregistered: signed work must NOT be > 0)",
    primary: "workJEp",
    source: "E9_E10_E11_C8_RESULTS.md E11 (signed work -0.098e-21 J ± 0.012; entropy 2.8698)",
    comparisons: [
      { special: "secondLaw", ds: "e10_e11", cond: "ratchet_neural", metric: "workJEp", pinned: { mean: -0.098e-21, ci: 0.012e-21, entropy: 2.8698, ref: "E9_E10_E11_C8_RESULTS.md E11" } },
    ],
  },
];

// ---------------------------------------------------------------- dataset loading
const MEANINGFUL = (rows) => {
  // production = the largest-rows manifest per experiment family tag;
  // "_"-prefixed tags are test fixtures (e.g. _unittest) and never inputs
  const byTag = new Map();
  for (const d of rows) {
    if (d.tag.startsWith("_")) continue;
    const k = d.tag;
    if (!byTag.has(k) || d.manifest.n_rows > byTag.get(k).manifest.n_rows) byTag.set(k, d);
  }
  return [...byTag.values()];
};

function loadDatasets(rootDir) {
  const dir = rootDir || path.join(__dirname, "research_data");
  const found = [];
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^(.+)\.manifest\.json$/);
    if (!m) continue;
    const base = m[1];
    let tag = base.replace(/_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/, "");
    const csvPath = path.join(dir, base + ".csv");
    const manPath = path.join(dir, f);
    const v = DX.verifyDataset(csvPath, manPath);
    if (!v.ok) throw new Error("dataset failed verification: " + base + " -> " + JSON.stringify(v.errors));
    const manifest = v.manifest;
    // the two production e9 runs differ ONLY by credit pairing — split the tag
    if (manifest.config && manifest.config.pairing) tag += " " + manifest.config.pairing;
    // parse the csv (simple split — the exporter quotes nothing numeric)
    const lines = fs.readFileSync(csvPath, "utf8").trim().split(/\r?\n/);
    const head = lines[0].split(",");
    const rows = lines.slice(1).map(l => {
      const cells = l.split(",");
      const o = {};
      head.forEach((h, i) => {
        const s = cells[i];
        o[h] = s === "" || s === "null" || s === "undefined" ? null
          : (s !== undefined && s !== "" && !isNaN(Number(s)) ? Number(s) : s);
      });
      return o;
    });
    found.push({ tag, base, csvPath, manPath, manifest, rows, sha256: manifest.csv_sha256 });
  }
  // keep the production dataset per family tag (largest n_rows; verified above)
  return MEANINGFUL(found);
}

// per-seed final-phase values of one condition/metric from a dataset
function perSeedFinal(rows, cond, metric, phase) {
  const ph = phase || "test";
  const out = new Map(); // seed -> last trial value in the phase
  for (const r of rows) {
    if (r.condition !== cond || r.phase !== ph) continue;
    const v = r[metric];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const prev = out.get(r.seed);
    if (!prev || r.trial > prev.trial) out.set(r.seed, r);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1][metric]);
}
// per-seed PHASE-MEAN values (all rows of the phase, not just the last trial)
function perSeedPhaseMean(rows, cond, metric, phase) {
  const acc = new Map();
  for (const r of rows) {
    if (r.condition !== cond || r.phase !== (phase || "test")) continue;
    const v = r[metric];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (!acc.has(r.seed)) acc.set(r.seed, []);
    acc.get(r.seed).push(v);
  }
  return [...acc.entries()].sort((a, b) => a[0] - b[0])
    .map(e => e[1].reduce((x, y) => x + y, 0) / e[1].length);
}
function perSeedAllPhases(rows, cond, metric) {
  const acc = new Map(); // seed -> {train: mean, test: mean}
  const sums = new Map();
  for (const r of rows) {
    if (r.condition !== cond) continue;
    const v = r[metric];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (!sums.has(r.seed)) sums.set(r.seed, { train: [], test: [] });
    sums.get(r.seed)[r.phase === "train" ? "train" : "test"].push(v);
  }
  for (const [sd, s] of sums) {
    if (s.train.length && s.test.length)
      acc.set(sd, { train: s.train.reduce((a, b) => a + b, 0) / s.train.length,
                    test: s.test.reduce((a, b) => a + b, 0) / s.test.length });
  }
  return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1].test - e[1].train);
}

// ---------------------------------------------------------------- statistics
function ci95OfMean(a) {
  const n = a.length;
  if (n < 2) return 0;
  const m = a.reduce((x, y) => x + y, 0) / n;
  const sd = Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
  return 1.96 * sd / Math.sqrt(n);
}
function ci95OfMeanDiff(a, b) {
  // unpaired Welch-style CI of (meanA - meanB)
  const n1 = a.length, n2 = b.length;
  const m1 = a.reduce((x, y) => x + y, 0) / n1, m2 = b.reduce((x, y) => x + y, 0) / n2;
  const v1 = a.reduce((s, v) => s + (v - m1) ** 2, 0) / (n1 - 1);
  const v2 = b.reduce((s, v) => s + (v - m2) ** 2, 0) / (n2 - 1);
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  return 1.96 * se;
}
function analyzeFamily(fam, DS) {
  const out = { family: fam.family, question: fam.question, source: fam.source,
                primary: fam.primary, comparisons: [], designNotes: fam.designNotes || [] };
  // resolve datasets for this family (tags: "e6_dataset", ..., "e9_dataset legacy|corrected")
  const dsFor = (name) => {
    if (fam.experiment === "e9")
      return DS.find(d => d.tag === "e9_dataset " + (name === "legacy" ? "legacy" : "corrected"));
    const d = DS.find(x => x.tag === fam.experiment + "_dataset");
    if (!d) throw new Error("family " + fam.family + ": dataset tag not found: " + fam.experiment + "_dataset");
    return d;
  };
  // Holm families: group the Welch-testable comparisons per family
  const welchComps = [];
  for (const c of fam.comparisons) {
    if (c.special === "pairedPhaseDelta") {
      const d = dsFor(c.ds);
      const diffs = perSeedAllPhases(d.rows, c.cond, c.metric);
      const m = diffs.reduce((x, y) => x + y, 0) / diffs.length;
      const t = SU.permutationTestPaired(diffs, { nPerm: 10000, seed: 20260926 });
      out.comparisons.push({
        ...c, mode: "dataset", n: diffs.length,
        meanDiff: m, ci: ci95OfMean(diffs),
        gPaired: SU.hedgesGPaired(diffs),
        p: t.p, method: t.method + " (paired phase delta, TEST - TRAIN per seed)",
        nPos: diffs.filter(v => v > 0).length,
      });
      continue;
    }
    if (c.special === "secondLaw") {
      const d = dsFor(c.ds);
      // per-episode signed work: per-seed MEAN over ALL test episodes (the
      // validator's "test-phase signed work/ep" convention), not last-trial
      const vals = perSeedPhaseMean(d.rows, c.cond, c.metric, "test");
      const m = vals.reduce((x, y) => x + y, 0) / vals.length;
      out.comparisons.push({
        ...c, mode: "dataset", n: vals.length,
        meanDiff: m, ci: ci95OfMean(vals),
        verdict: m > 0 ? "VIOLATION (work > 0)" : "LAW-SAFE (work <= 0)",
        entropyProduction: (() => {
          const e = perSeedPhaseMean(d.rows, c.cond, "entropyProduction", "test");
          return e.reduce((x, y) => x + y, 0) / e.length;
        })(),
      });
      continue;
    }
    welchComps.push(c);
  }
  // unpaired (or paired-diff) Welch contrasts, Holm within family
  const computed = welchComps.map(c => {
    const dsName = c.ds || fam.experiment;
    const d = dsFor(dsName);
    const a = perSeedFinal(d.rows, c.a, c.metric);
    const b = perSeedFinal(d.rows, c.b, c.metric);
    if (a.length < 2 || b.length < 2) return { ...c, mode: "dataset", n: Math.min(a.length, b.length), degenerate: true };
    const diffs = c.paired ? a.map((v, i) => v - b[i]) : null;
    const w = diffs ? SU.welchT(diffs, diffs.map(() => 0)) : SU.welchT(a, b);
    const res = {
      ...c, mode: "dataset", n: Math.min(a.length, b.length),
      meanA: a.reduce((x, y) => x + y, 0) / a.length,
      meanB: b.reduce((x, y) => x + y, 0) / b.length,
      t: w.t, df: w.df, p: w.p,
    };
    res.ci = diffs ? ci95OfMean(diffs) : ci95OfMeanDiff(a, b);
    res.meanDiff = res.meanA - res.meanB;
    res.g = diffs ? SU.hedgesGPaired(diffs) : SU.hedgesG(a, b);
    if (c.perm) res.perm = SU.permutationTestUnpaired(a, b, { nPerm: 10000, seed: 20260926 });
    return res;
  });
  // Holm within family over the non-degenerate p-values
  const idx = computed.map((r, i) => [r, i]).filter(([r]) => r.mode === "dataset" && !r.degenerate && Number.isFinite(r.p));
  const adj = SU.holm(idx.map(([r]) => r.p));
  idx.forEach(([r, i], k) => { computed[i].p_holm = adj[k]; });
  out.comparisons.push(...computed);
  return out;
}

// ---------------------------------------------------------------- ablation tables
function buildAblations(DS, finals) {
  const e4 = finals.F4_e4_structure, e7 = finals.F6_e7_regime_gradient,
        e8 = finals.F7_e8_information_arms, e9 = finals.F8_e9_credit_pairing;
  const d4 = DS.find(d => d.tag === "e4_dataset"), d7 = DS.find(d => d.tag === "e7_e8_dataset");
  const d9c = DS.find(d => d.tag === "e9_dataset corrected");
  const condMean = (d, cond, metric) => {
    const v = perSeedFinal(d.rows, cond, metric);
    return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN;
  };
  return {
    structure_e4: {
      factor: "connectome wiring (full 4A / restricted 4B / shuffled 4C / frozen)",
      metric: "goodCrossings (final TEST)",
      levels: ["connectome_4A", "connectome_4B", "connectome_4C", "connectome_frozen"]
        .map(c => ({ level: c, mean: condMean(d4, c, "goodCrossings") })),
      conclusion: "no structure effect (all family p > 0.6); drift signatures distinct (2.38e3 / 1.71e3 / 5.71e2 / 0) — machinery without behavioral leverage",
    },
    information_e8: {
      factor: "information constraints (adaptive / fixed / memory-4) at matched gas",
      metric: "goodCrossings + measuredBits (final TEST)",
      levels: ["e8_adaptive", "e8_fixed", "e8_mem4"].map(c => ({
        level: c, mean: condMean(d7, c, "goodCrossings"), bits: condMean(d7, c, "measuredBits") })),
      conclusion: "adaptive does not beat fixed (family p=0.18) and costs more measured bits (93 vs 67/trial); mem4 structurally inert (design-note)",
    },
    pairing_e9: {
      factor: "credit-pairing delivery (legacy vs corrected), neural arm only",
      metric: "reward / decisionAccuracy (final TEST, n=20 each)",
      levels: [
        { level: "legacy neural", reward: condMean(DS.find(d => d.tag === "e9_dataset legacy"), "demon_neural", "reward"),
          acc: condMean(DS.find(d => d.tag === "e9_dataset legacy"), "demon_neural", "decisionAccuracy") },
        { level: "corrected neural", reward: condMean(d9c, "demon_neural", "reward"),
          acc: condMean(d9c, "demon_neural", "decisionAccuracy") },
        { level: "frozen (identical both)", reward: condMean(d9c, "demon_frozen", "reward"),
          acc: condMean(d9c, "demon_frozen", "decisionAccuracy") },
      ],
      conclusion: "pairing is the ablation that unlocks learning: corrected moves the neural arm from p=0.94 (indistinguishable from frozen) to p=2.5e-7 while frozen arms are byte-identical",
    },
    regime_e7: {
      factor: "gas regime (120p/0.0 vs 320p/0.12 vs 640p/0.30)",
      metric: "goodCrossings (throughput) vs dTfinal + sortEntropy (per-event quality)",
      levels: ["e7_sparse_clean", "e7_default", "e7_dense_noisy"].map(c => ({
        level: c, good: condMean(d7, c, "goodCrossings"),
        dT: condMean(d7, c, "dTfinal"), sortEntropy: condMean(d7, c, "sortEntropy") })),
      conclusion: "throughput rises monotonically with density; per-event quality (dT, entropy) collapses ~7x / ~45x — policy generalizes, efficiency does not scale",
    },
  };
}

// ---------------------------------------------------------------- digest + report
function buildDigest(DS, finals, ablations) {
  const digest = {
    generated: new Date().toISOString(),
    layer: "C-9 nature analysis (row 24)",
    engine: "experiment_core.js (UNTOUCHED throughout phases A-C)",
    inputs: DS.map(d => ({ tag: d.tag, base: d.base, sha256: d.sha256, rows: d.manifest.n_rows,
                           conditions: d.manifest.conditions, git_revision: d.manifest.git_revision })),
    preregistration: "frozen from C-1..C-8 results docs before recomputation (see PREREGISTERED in nature_analysis.js)",
    excludedColumns: ["demonDecisions (dead 0-field in runBenchmark — PRE_C9_AUDIT.md)", "fireVec/layerRates (excluded by the C-3 exporter)"],
    headline: {
      e2_ann_beats_random: finalize(finals.F2_e2_ann_control, "ann vs random", "goodCrossings"),
      e2_ann_vs_classical: finalize(finals.F2_e2_ann_control, "ann vs classical_demon", "goodCrossings"),
      e3_drosophila_collapsed: finalize(finals.F3_e3_drosophila_collapse, "drosophila vs random", "openFraction"),
      e4_structure_null: finalize(finals.F4_e4_structure, "connectome_4A vs connectome_4B", "goodCrossings"),
      e5_paired_drosophila_below_random: finalize(finals.F5_e5_comparator_paired, "drosophila vs random", "goodCrossings"),
      e7_gradient_sparse_vs_dense: finalize(finals.F6_e7_regime_gradient, "e7_sparse_clean vs e7_dense_noisy", "goodCrossings"),
      e8_adaptive_vs_fixed: finalize(finals.F7_e8_information_arms, "e8_adaptive vs e8_fixed", "goodCrossings"),
      e9_corrected_learning: finalize(finals.F8_e9_credit_pairing, "demon_neural vs demon_frozen", "reward", "corrected"),
      e9_legacy_null: finalize(finals.F8_e9_credit_pairing, "demon_neural vs demon_frozen", "reward", "legacy"),
      e10_accuracy_delta: finalize(finals.F9_e10_trapdoor_learning, "trapdoor_neural decisionAccuracy", null),
      e11_second_law: finalize(finals.F10_e11_second_law, "ratchet_neural workJEp", null),
      e6_apparatus_null: finalize(finals.F1_e6_apparatus_learning, "demon_neural vs demon_frozen", "goodCrossings"),
    },
    docPinned: {},
    ablations,
  };
  function finalize(fam, compLabel, metric, dsName) {
    const c = fam.comparisons.find(x =>
      (dsName ? x.ds === dsName : true) &&
      (compLabel.includes(" ")
        ? (x.a + " vs " + x.b === compLabel || (x.cond || "") + " " + (x.special || "") === compLabel || (x.cond || "") + " " + x.metric === compLabel)
        : true) &&
      (!metric || x.metric === metric));
    if (!c) return null;
    const picked = {};
    for (const k of ["t", "df", "p", "p_holm", "g", "gPaired", "meanDiff", "ci", "n", "nPos", "method", "verdict", "entropyProduction"])
      if (c[k] !== undefined) picked[k] = c[k];
    picked.source = c.pinned ? c.pinned.ref : fam.source;
    return picked;
  }
  for (const fam of PREREGISTERED)
    for (const c of fam.comparisons)
      if (c.pinned) digest.docPinned[fam.family + " | " + (c.ds ? c.ds + " " : "") + c.a + (c.b ? " vs " + c.b : "") + " | " + c.metric] = c.pinned;
  return digest;
}

const f3 = (v) => Number.isFinite(v) ? v.toFixed(3) : "—";
const pfmt = (p) => !Number.isFinite(p) ? "—" : (p < 1e-4 ? p.toExponential(1) : p.toFixed(4));

function renderHTML(DS, finals, ablations, digest) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const famHtml = Object.values(finals).map(f => {
    const rows = f.comparisons.map(c => {
      if (c.mode === "missing-dataset") return "";
      if (c.special === "pairedPhaseDelta")
        return `<tr><td>${esc(c.cond)} (TEST − TRAIN per seed)</td><td>${esc(c.metric)}</td><td>${f3(c.meanDiff)} ± ${f3(c.ci)}</td><td>g=${f3(c.gPaired)}</td><td>${pfmt(c.p)} (${esc(c.method || "")})</td><td>${c.nPos}/${c.n} improved</td><td class="pin">${c.pinned ? esc(c.pinned.ref) : ""}</td></tr>`;
      if (c.special === "secondLaw")
        return `<tr><td>${esc(c.cond)} (equilibrium bath)</td><td>workJEp</td><td>${c.meanDiff.toExponential(2)} ± ${c.ci.toExponential(2)} J</td><td>—</td><td><b>${esc(c.verdict)}</b></td><td>entropy/ep ${c.entropyProduction.toFixed(3)}</td><td class="pin">${c.pinned ? esc(c.pinned.ref) : ""}</td></tr>`;
      if (c.degenerate) return `<tr><td>${esc(c.a)} vs ${esc(c.b)}</td><td>${esc(c.metric)}</td><td colspan="3">degenerate (constant metric)</td><td>n=${c.n}</td><td class="pin">${c.pinned ? esc(c.pinned.ref) : ""}</td></tr>`;
      const pin = c.pinned ? `doc: t=${c.pinned.t !== undefined ? c.pinned.t : "—"}, p=${c.pinned.p}` : "";
      const agree = c.pinned && c.pinned.p !== undefined && Number.isFinite(c.p)
        ? (Math.abs(c.p - c.pinned.p) < Math.max(0.02, 0.05 * (c.pinned.p || 1)) ? " ✓" : " (differs — see note)")
        : "";
      return `<tr><td>${esc(c.a)} vs ${esc(c.b)}${c.ds ? " [" + esc(c.ds) + "]" : ""}</td><td>${esc(c.metric)}</td>` +
        `<td>${f3(c.meanDiff)} ± ${f3(c.ci)}</td><td>g=${f3(c.g)}${c.perm ? ", perm p=" + pfmt(c.perm.p) : ""}</td>` +
        `<td>t=${f3(c.t)}, p=${pfmt(c.p)}, p_holm=${pfmt(c.p_holm)}${esc(agree)} <span class="pin">${esc(pin)}</span></td>` +
        `<td>n=${c.n}</td><td class="pin">${esc(c.pinned ? c.pinned.ref : "")}</td></tr>`;
    }).join("");
    return `<h2>${esc(f.family)}</h2><p class="q">${esc(f.question)}</p><p class="src">${esc(f.source)}</p>` +
      (f.designNotes || []).map(n => `<p class="note">design-note: ${esc(n)}</p>`).join("") +
      `<table><tr><th>comparison</th><th>metric</th><th>effect (diff ± 95% CI)</th><th>effect size</th><th>test</th><th>n</th><th>source</th></tr>${rows}</table>`;
  }).join("");

  const abl = Object.entries(ablations).map(([k, a]) =>
    `<h3>${esc(a.factor)}</h3><p class="src">${esc(a.metric)}</p><table><tr><th>level</th><th>values</th></tr>` +
    a.levels.map(l => `<tr><td>${esc(l.level)}</td><td>${esc(Object.entries(l).filter(([k2]) => k2 !== "level")
      .map(([k2, v]) => k2 + "=" + (typeof v === "number" ? (Math.abs(v) < 1e-3 && v !== 0 ? v.toExponential(2) : v.toFixed(3)) : v)).join(", "))}</td></tr>`).join("") +
    `</table><p class="note">${esc(a.conclusion)}</p>`).join("");

  const inputs = DS.map(d => `<tr><td>${esc(d.tag)}</td><td>${esc(d.base)}</td><td>${d.manifest.n_rows}</td><td><code>${d.sha256.slice(0, 16)}…</code></td><td>${esc((d.manifest.conditions || []).join(", "))}</td></tr>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>C-9 Nature analysis layer</title><style>
  body{background:#0d1117;color:#e6edf3;font:13px/1.5 system-ui;margin:24px;max-width:1200px}
  h1{font-size:19px}h2{font-size:15px;margin-top:26px}h3{font-size:13px;margin:10px 0 4px}
  table{border-collapse:collapse;margin:8px 0;width:100%}td,th{border:1px solid #30363d;padding:4px 8px;font-size:12px;text-align:left}th{background:#161b22}
  .pin{color:#8b949e;font-size:11px}.q{color:#c9d1d9;margin:2px 0}.src{color:#8b949e;font-size:12px;margin:2px 0 8px}
  .note{color:#d29922;font-size:12px;margin:2px 0}
  code{color:#79c0ff}</style></head><body>
  <h1>C-9 — Nature analysis layer (build-plan row 24)</h1>
  <p class="src">Preregistered comparison families (frozen from the C-1..C-8 results docs BEFORE recomputation) · every input a verified, sha256-pinned C-3 dataset · Holm correction within each family · "doc:" spans quote the doc-recorded value for traceability (✓ = recomputed value agrees within rounding; the e6 family recomputes a 4-seed chunk aggregation, so its doc pins come from the full 20-seed run — both shown).</p>
  <h2>Inputs (all verifyDataset OK)</h2><table><tr><th>family tag</th><th>artifact base</th><th>rows</th><th>sha256</th><th>conditions</th></tr>${inputs}</table>
  <p class="note">Excluded by preregistration: smoke-scale artifacts (same tags, smaller n); the demonDecisions column (dead 0-field, PRE_C9_AUDIT.md); fireVec/layerRates (C-3 exporter exclusions).</p>
  ${famHtml}
  <h2>Ablation tables</h2>${abl}
  <h2>Traceability</h2>
  <p class="src">digest JSON: <code>research_data/paper_digest_c9.json</code> — headline entries carry mode "dataset" (recomputed here) plus the doc-recorded reference; docPinned holds every preregistered doc value verbatim with its source line.</p>
  </body></html>`;
}

// ---------------------------------------------------------------- main
function main() {
  const t0 = Date.now();
  console.log("C-9 nature analysis layer: loading + verifying datasets...");
  const DS = loadDatasets();
  for (const d of DS) console.log("  " + d.tag.padEnd(12) + " rows=" + String(d.manifest.n_rows).padEnd(5) + " sha=" + d.sha256.slice(0, 12) + "…  [" + d.manifest.conditions.join(", ") + "]");
  const finals = {};
  for (const fam of PREREGISTERED) {
    finals[fam.family] = analyzeFamily(fam, DS);
    console.log("  family " + fam.family + ": " + finals[fam.family].comparisons.length + " comparisons");
  }
  const ablations = buildAblations(DS, finals);
  const digest = buildDigest(DS, finals, ablations);
  fs.mkdirSync(OUTDIR, { recursive: true });
  const digestPath = path.join(OUTDIR, "paper_digest_c9.json");
  fs.writeFileSync(digestPath, JSON.stringify(digest, null, 2));
  console.log("\nwrote " + digestPath);
  // console summary of the preregistered headlines
  console.log("\n== Preregistered headlines (recomputed | doc-pinned) ==");
  for (const [k, v] of Object.entries(digest.headline)) {
    if (!v) continue;
    console.log("  " + k.padEnd(34) +
      (v.p !== undefined ? "p=" + pfmt(v.p) : "diff=" + f3(v.meanDiff)) +
      (v.p_holm !== undefined ? " p_holm=" + pfmt(v.p_holm) : "") +
      (v.g !== undefined && Number.isFinite(v.g) ? " g=" + f3(v.g) : "") +
      (v.verdict ? " " + v.verdict : "") +
      "   [" + (v.source || "") + "]");
  }
  if (WANT_HTML) {
    const htmlPath = path.join(OUTDIR, "nature_analysis_report.html");
    fs.writeFileSync(htmlPath, renderHTML(DS, finals, ablations, digest));
    console.log("wrote " + htmlPath);
  }
  console.log("done in " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
}

if (require.main === module) main();
module.exports = { PREREGISTERED, loadDatasets, buildDigest, analyzeFamily, buildAblations };
