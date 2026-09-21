"use strict";
/**
 * validation_analyze.js — Agent 3 preregistered analysis driver.
 *
 * Consumes research_data/validation/raw_{exp}.csv (from validation_campaign.js)
 * and executes PRE_REGISTERED_CRITERIA.json: per-seed aggregation (seed = the
 * only independent replicate), t-CIs, permutation tests, Hedges' g,
 * Benjamini–Hochberg FDR, Sagawa–Ueda efficacy, and verdicts.
 *
 * Outputs (research_data/validation/):
 *   E3_VALIDATION.csv E4_VALIDATION.csv E9_VALIDATION.csv
 *   E10_VALIDATION.csv E11_VALIDATION.csv STATISTICAL_SUMMARY.csv
 *   PERMUTATION_TESTS.csv EFFECT_SIZES.csv THERMO_CLASSIFICATION.csv
 *   analysis_meta.json
 *
 * Usage: node validation_analyze.js [--exp e3,e4,e9,e10,e11]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const S = require("./stats_utils.js");

const args = process.argv.slice(2);
function argVal(n, d) { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; }
const WANT = (argVal("exp", "e3,e4,e9,e10,e11")).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const DIR = path.join(__dirname, "research_data", "validation");
const OUT = DIR;

// -------------------------------------------------------------- csv helpers
function readCsv(file) {
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  if (lines.length < 2) return null;
  const cols = lines[0].split(",");
  return lines.slice(1).map(l => {
    const v = l.split(","), r = {};
    cols.forEach((c, i) => { r[c] = v[i]; });
    return r;
  });
}
function csvEscape(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(name, rows) {
  if (!rows.length) { fs.writeFileSync(path.join(OUT, name), ""); return; }
  const cols = Object.keys(rows[0]);
  fs.writeFileSync(path.join(OUT, name),
    [cols.join(","), ...rows.map(r => cols.map(c => csvEscape(r[c])).join(","))].join("\n") + "\n");
}
const num = (x) => { const v = parseFloat(x); return Number.isFinite(v) ? v : NaN; };

// global result collectors
const statSummary = [];   // STATISTICAL_SUMMARY.csv
const permTests = [];     // PERMUTATION_TESTS.csv
const effectSizes = [];   // EFFECT_SIZES.csv
const validationRows = {}; // exp -> [E{x}_VALIDATION.csv rows]
const meta = { generated: new Date().toISOString(), preregistration: "PRE_REGISTERED_CRITERIA.json",
  seedRule: "door tasks seed=1+k*101; apparatus seed=1+(s-1)*101; replicate unit = SEED",
  ciMethod: "mean ± t(0.975, n-1)·sd/√n over per-seed values",
  permutationMethod: "unpaired: seeded label permutation (10000 draws, seed 20260920); paired: exact/sign-flip on per-seed differences",
  correction: "Benjamini–Hochberg FDR (q=0.05) within each experiment family; Holm reported for primary tests",
  experiments: {} };

// --------------------------------------------------- generic stat machinery
let familyIndex = {};   // exp -> [p-values] for BH
function pushStat(exp, comparison, condition, metric, phase, dA, dB, pRaw, pAdj, g, rb, test, verdict, primary) {
  statSummary.push({
    experiment: exp, comparison, primary: primary ? "yes" : "no",
    condition_A: condition, condition_B: dB ? dB.cond : "", metric, phase,
    n_A: dA ? dA.n : "", mean_A: dA ? dA.mean : "", sd_A: dA ? dA.sd : "",
    se_A: dA ? dA.se : "", ciLo_A: dA ? dA.ciLo : "", ciHi_A: dA ? dA.ciHi : "",
    median_A: dA ? dA.median : "",
    n_B: dB && dB.d ? dB.d.n : "", mean_B: dB && dB.d ? dB.d.mean : "",
    sd_B: dB && dB.d ? dB.d.sd : "", se_B: dB && dB.d ? dB.d.se : "",
    ciLo_B: dB && dB.d ? dB.d.ciLo : "", ciHi_B: dB && dB.d ? dB.d.ciHi : "",
    median_B: dB && dB.d ? dB.d.median : "",
    p_raw: Number.isFinite(pRaw) ? pRaw.toExponential(4) : "",
    p_bh: Number.isFinite(pAdj) ? pAdj.toExponential(4) : "",
    hedges_g: Number.isFinite(g) ? g.toFixed(4) : "",
    rank_biserial: Number.isFinite(rb) ? rb.toFixed(4) : "",
    test, verdict,
  });
}
const effs = [];   // Sagawa-Ueda efficacy rows (experiments, not per-contrast)
function pushEffect(exp, comparison, metric, g, rb, dA, dB, interpret) {
  effectSizes.push({ experiment: exp, comparison, metric,
    hedges_g: Number.isFinite(g) ? g.toFixed(4) : "", rank_biserial: Number.isFinite(rb) ? rb.toFixed(4) : "",
    n_A: dA ? dA.n : "", n_B: dB ? dB.n : "",
    interpretation: interpret || (Math.abs(g) < 0.2 ? "negligible" : Math.abs(g) < 0.5 ? "small"
      : Math.abs(g) < 0.8 ? "medium" : "large") });
}
function pushPerm(exp, comparison, metric, test, pRaw, pAdj, obs, nPerm, verdict) {
  const row = { experiment: exp, comparison, metric, test,
    observed_stat: Number.isFinite(obs) ? obs : "",
    n_permutations: nPerm || "", p_raw: Number.isFinite(pRaw) ? pRaw.toExponential(4) : "",
    p_bh: Number.isFinite(pAdj) ? pAdj.toExponential(4) : "", verdict };
  permTests.push(row);
  return row;   // reference so the verdict loop can patch p_bh/verdict in place
}

/** Full preregistered test on a per-seed contrast. */
function runContrast(exp, comparison, metric, valsA, valsB, declaredSign, primary) {
  // NOT_EVALUABLE guard (declared before unblinding): a contrast with fewer than
  // minN finite per-seed values per arm cannot support a test. It is reported as
  // NOT_EVALUABLE and contributes NO p-value to the BH family (alignment kept).
  const fA = (valsA || []).filter(Number.isFinite), fB = (valsB || []).filter(Number.isFinite);
  const paired = valsA.length === valsB.length && comparison.startsWith("paired");
  const minN = paired ? 3 : 2;
  if (fA.length < minN || fB.length < minN) {
    return { notEvaluable: true,
      reason: `insufficient evaluable seeds: nA=${fA.length}, nB=${fB.length} (min ${minN})`,
      dA: S.describe(fA), dB: S.describe(fB), g: NaN, rb: NaN, pRaw: NaN, nPerm: "",
      test: "none", wt: null, primary };
  }
  const dA = S.describe(valsA), dB = S.describe(valsB);
  const g = paired ? S.hedgesGPaired(valsA.map((v, i) => v - valsB[i]))
                   : S.hedgesG(valsA, valsB);
  const rb = paired ? NaN : S.rankBiserial(valsA, valsB);
  let pRaw = NaN, nPerm = "", test;
  if (paired) {
    const diffs = valsA.map((v, i) => v - valsB[i]);
    const pr = S.permutationTestPaired(diffs);
    pRaw = pr.p; nPerm = pr.nPerm; test = pr.method;
  } else {
    const pr = S.permutationTestUnpaired(valsA, valsB);
    pRaw = pr.p; nPerm = pr.nPerm; test = pr.method;
  }
  const wt = S.welchT(valsA, valsB);   // cross-check only
  familyIndex[exp] = familyIndex[exp] || [];
  familyIndex[exp].push(pRaw);
  // Register the PERMUTATION_TESTS row exactly once, at contrast creation.
  // The verdict loop patches p_bh/verdict on this row (no duplicate rows).
  const permRow = pushPerm(exp, comparison, metric, test, pRaw, NaN,
    paired ? Math.abs(S.mean(valsA.map((v, i) => v - valsB[i])))
           : Math.abs(S.mean(fA) - S.mean(fB)),
    nPerm, "pending BH");
  return { dA, dB, g, rb, pRaw, nPerm, test, wt, primary, permRow };
}

// =========================================================== door-task exps
function loadDoor(exp) {
  const rows = readCsv(path.join(DIR, `raw_${exp}.csv`));
  if (!rows) return null;
  for (const r of rows) {
    r.seed = +r.seed; r.trial = +r.trial;
    for (const f of ["goodCrossings", "badCrossings", "goodBadRatio", "demonAgree",
      "dTfinal", "sortEntropy", "spatialH", "openFraction", "miNeural", "workInJ",
      "extractableJ", "measuredBits", "erasureCostJ", "energyJ"]) r[f] = num(r[f]);
    r.shuffleSeed = r.shuffleSeed === "" ? null : +r.shuffleSeed;
  }
  return rows;
}
function gbPerSeed(rows, cond, phase) {
  // good:bad per seed, trials with 0 bad crossings EXCLUDED (count reported)
  const bySeed = S.groupBy(rows.filter(r => r.condition === cond && r.phase === phase), r => r.seed);
  const out = [], excluded = [];
  for (const [sd, rs] of [...bySeed.entries()].sort((a, b) => a[0] - b[0])) {
    const vals = rs.map(r => r.goodBadRatio).filter(v => Number.isFinite(v));
    excluded.push(rs.length - vals.length);
    if (vals.length) out.push({ seed: +sd, value: S.mean(vals), n: vals.length, excluded: rs.length - vals.length });
  }
  return { values: out.map(x => x.value), detail: out, excluded };
}
function fieldPerSeed(rows, cond, phase, field) {
  const bySeed = S.groupBy(rows.filter(r => r.condition === cond && (r.phase || "train") === phase), r => r.seed);
  return [...bySeed.entries()].sort((a, b) => a[0] - b[0]).map(([sd, rs]) =>
    ({ seed: +sd, value: S.mean(rs.map(r => r[field]).filter(Number.isFinite)) }));
}
function doorEarlyLate(rows, cond, phase, field) {
  // preregistered windows: early = first 20% of phase trials, late = last 20%
  // Fallback rule (declared before unblinding, mechanical): if a seed has no finite
  // values inside its block, use its finite values from the whole phase; a seed with
  // no finite values in the entire phase is DROPPED from the paired set (n reported).
  const rs = rows.filter(r => r.condition === cond && r.phase === phase);
  const bySeed = S.groupBy(rs, r => +r.seed);
  const tMax = Math.max(...rs.map(r => r.trial));
  const earlyCut = Math.floor((tMax + 1) * 0.2), lateCut = Math.ceil((tMax + 1) * 0.8);
  const early = [], late = [], droppedSeeds = [];
  for (const [sd, trs] of [...bySeed.entries()].sort((a, b) => a[0] - b[0])) {
    const e = trs.filter(t => t.trial < earlyCut).map(t => t[field]).filter(Number.isFinite);
    const l = trs.filter(t => t.trial >= lateCut).map(t => t[field]).filter(Number.isFinite);
    const all = trs.map(t => t[field]).filter(Number.isFinite);
    const eV = e.length ? S.mean(e) : (all.length ? S.mean(all) : NaN);
    const lV = l.length ? S.mean(l) : (all.length ? S.mean(all) : NaN);
    if (!Number.isFinite(eV) || !Number.isFinite(lV)) { droppedSeeds.push(+sd); continue; }
    early.push({ seed: sd, value: eV, blockUsed: e.length ? "block" : "phase-fallback" });
    late.push({ seed: sd, value: lV, blockUsed: l.length ? "block" : "phase-fallback" });
  }
  return { early, late, earlyCut, lateCut, droppedSeeds };
}

function analyzeDoor(exp, cfg) {
  const rows = loadDoor(exp);
  if (!rows) { console.log(`  (no raw_${exp}.csv — skipped)`); return; }
  const V = validationRows[exp] = [];
  console.log(`\n=== ${exp.toUpperCase()} · ${cfg.title} ===`);
  const conds = [...new Set(rows.map(r => r.condition))];

  // ---- descriptive table: every condition x phase, primary + secondary metrics
  for (const cond of conds) {
    for (const phase of ["train", "test"]) {
      for (const metric of ["goodBadRatio", "dTfinal", "sortEntropy", "openFraction", "demonAgree", "miNeural"]) {
        const ps = fieldPerSeed(rows, cond, phase, metric);
        if (!ps.length) continue;
        const d = S.describe(ps.map(x => x.value));
        if (metric === "goodBadRatio") {
          const gb = gbPerSeed(rows, cond, phase);
          V.push({ exp, metric, condition: cond, phase, unit: "seed",
            n: d.n, mean: d.mean, sd: d.sd, se: d.se, ciLo: d.ciLo, ciHi: d.ciHi,
            median: d.median, raw: ps.map(x => x.value.toFixed(4)).join(" "),
            excludedTrials_noBadCrossings: gb.excluded.join(" ") });
        } else {
          V.push({ exp, metric, condition: cond, phase, unit: "seed",
            n: d.n, mean: d.mean, sd: d.sd, se: d.se, ciLo: d.ciLo, ciHi: d.ciHi,
            median: d.median, raw: ps.map(x => x.value.toFixed(4)).join(" "), excludedTrials_noBadCrossings: "" });
        }
      }
    }
  }

  // ---- adaptation trajectory (per-quarter train windows) — machine-readable
  // collapse detection: a plastic arm whose openFraction -> 0 is MALADAPTATION
  // under the reward contract, not "no learning". Record it per quarter.
  for (const cond of conds) {
    for (const [q, [lo, hi]] of [["Q1", [0, 75]], ["Q2", [75, 150]], ["Q3", [150, 225]], ["Q4", [225, 300]]]) {
      const ps = fieldPerSeed(rows.filter(r => r.phase === "train" && r.trial >= lo && r.trial < hi),
                              cond, "train", "openFraction");
      if (!ps.length) continue;
      const d = S.describe(ps.map(x => x.value));
      const xs = fieldPerSeed(rows.filter(r => r.phase === "train" && r.trial >= lo && r.trial < hi),
                              cond, "train", "goodCrossings").map(x => x.value);
      const xb = fieldPerSeed(rows.filter(r => r.phase === "train" && r.trial >= lo && r.trial < hi),
                              cond, "train", "badCrossings").map(x => x.value);
      V.push({ exp, metric: `openFraction_${q}_trials${lo}-${hi}`, condition: cond, phase: "train", unit: "seed",
        n: d.n, mean: d.mean, sd: d.sd, se: d.se, ciLo: d.ciLo, ciHi: d.ciHi,
        median: d.median, raw: ps.map(x => x.value.toFixed(4)).join(" "),
        excludedTrials_noBadCrossings: "mean crossings/ep: " +
          (S.mean(xs) + S.mean(xb)).toFixed(3) });
    }
  }

  // ---- preregistered tests
  const tests = [];
  if (exp === "E3") {
    const gb_d = doorEarlyLate(rows, "drosophila", "train", "goodBadRatio");
    const pairs = [];
    const lateBy = new Map(gb_d.late.map(x => [x.seed, x.value]));
    for (const e of gb_d.early) if (lateBy.has(e.seed)) pairs.push({ seed: e.seed, a: lateBy.get(e.seed), b: e.value });
    const nDropped = gb_d.droppedSeeds.length;
    const eV = S.describe(pairs.map(p => p.a)), bV = S.describe(pairs.map(p => p.b));
    V.push({ exp, metric: "goodBadRatio (late block)", condition: "drosophila", phase: "train", unit: "seed",
      n: eV.n, mean: eV.mean, sd: eV.sd, se: eV.se, ciLo: eV.ciLo, ciHi: eV.ciHi, median: eV.median,
      raw: pairs.map(p => p.a.toFixed(4)).join(" "),
      excludedTrials_noBadCrossings: `seeds dropped (no finite goodBadRatio in train): ${nDropped}${nDropped ? " [" + gb_d.droppedSeeds.join(",") + "]" : ""}` });
    V.push({ exp, metric: "goodBadRatio (early block)", condition: "drosophila", phase: "train", unit: "seed",
      n: bV.n, mean: bV.mean, sd: bV.sd, se: bV.se, ciLo: bV.ciLo, ciHi: bV.ciHi, median: bV.median,
      raw: pairs.map(p => p.b.toFixed(4)).join(" "), excludedTrials_noBadCrossings: "" });
    const rPrim = runContrast(exp, "paired learning gain (late-early train)", "goodBadRatio",
      pairs.map(p => p.a), pairs.map(p => p.b), "> 0", true);
    tests.push({ name: "primary: paired late-early goodBadRatio (drosophila)", r: rPrim, primary: true, condA: "drosophila", condB: "drosophila",
      declaredSign: "> 0", contrast: S.mean(pairs.map(p => p.a - p.b)),
      note: `n=${pairs.length}/20 seeds evaluable (no finite goodBadRatio for ${nDropped}); engagement collapse: openFraction -> 0 by train Q2, no crossings => no feedback => metric undefined` });
    const dTest = gbPerSeed(rows, "drosophila", "test"), rTest = gbPerSeed(rows, "random", "test");
    let r = runContrast(exp, "drosophila vs random (test)", "goodBadRatio", dTest.values, rTest.values, "> 0", false);
    tests.push({ name: "secondary: drosophila vs random test goodBadRatio", r, declaredSign: "> 0", condA: "drosophila", condB: "random", contrast: S.mean(dTest.values) - S.mean(rTest.values) });
    r = runContrast(exp, "drosophila vs drosophila_frozen (test)", "goodBadRatio",
      gbPerSeed(rows, "drosophila", "test").values, gbPerSeed(rows, "drosophila_frozen", "test").values, "> 0", false);
    tests.push({ name: "secondary: drosophila vs frozen test goodBadRatio", r, declaredSign: "> 0", condA: "drosophila", condB: "drosophila_frozen", contrast: S.mean(gbPerSeed(rows, "drosophila", "test").values) - S.mean(gbPerSeed(rows, "drosophila_frozen", "test").values) });
    for (const [m, c] of [["dTfinal", "drosophila vs random (test)"], ["sortEntropy", "drosophila vs random (test)"]]) {
      const a = fieldPerSeed(rows, "drosophila", "test", m), b = fieldPerSeed(rows, "random", "test", m);
      r = runContrast(exp, c, m, a.map(x => x.value), b.map(x => x.value), "> 0", false);
      tests.push({ name: `secondary: ${m} ${c} [DEGENERATE-PRONE: see note]`, r, declaredSign: "> 0", condA: "drosophila", condB: "random",
        contrast: S.mean(a.map(x => x.value)) - S.mean(b.map(x => x.value)),
        note: `${m}: closed-door policy scores as "perfect" (${m === "dTfinal" ? "hot side never mixed" : "no sorting occurred to un-sort"}); sign consistent but hollow — do NOT count as demon evidence without engagement` });
    }
    // Sagawa-Ueda efficacy for the door task: signed jet work (reward is negative in
    // this task, making reward-based eta undefined; workInJ is positive for all seeds).
    // EXPLORATORY: proxy work, not an independent-work extraction metric.
    const suDoor = sagawaUeda(rows, "drosophila", "drosophila_frozen", "workInJ");
    if (suDoor) effs.push({ experiment: exp, comparison: "drosophila (feedback) vs drosophila_frozen (no-plasticity), seed-matched",
      metric: "workInJ (signed jet work)", eta: suDoor.eta, se: suDoor.se, ciLo: suDoor.ciLo, ciHi: suDoor.ciHi,
      n: suDoor.pairs.length, nDegenerate: suDoor.nDegenerate,
      note: "EXPLORATORY: eta<1 means the plastic arm extracts less jet work than its frozen twin under identical physics; door task is sorting-, not work-extraction-oriented, so interpret with caution" });
  }
  if (exp === "E4") {
    // 4C values: aggregate per (shuffleSeed, seed) -> shuffle-draw means for the contrast
    const rows4C = rows.filter(r => r.condition === "connectome_4C" && r.phase === "test");
    const byShuf = S.groupBy(rows4C, r => +r.shuffleSeed);
    const shufMeans = [], shufDetail = [];
    for (const [shuf, rs] of [...byShuf.entries()].sort((a, b) => a[0] - b[0])) {
      const gb = gbPerSeed(rows4C.filter(r => +r.shuffleSeed === shuf), "connectome_4C", "test");
      if (gb.values.length) {
        shufMeans.push(S.mean(gb.values));
        shufDetail.push({ shuffleSeed: shuf, perSeed: gb.values, mean: S.mean(gb.values) });
      }
    }
    const a4 = gbPerSeed(rows, "connectome_4A", "test");
    if (shufMeans.length) {
      const r = runContrast(exp, "connectome_4A vs shuffle-mean 4C (test)", "goodBadRatio",
        a4.values, shufMeans, "> 0", true);
      tests.push({ name: "primary: 4A vs 4C(shuffle-draw means) test goodBadRatio", r, primary: true, condA: "connectome_4A", condB: "connectome_4C", declaredSign: "> 0", contrast: S.mean(a4.values) - S.mean(shufMeans) });
      // shuffle-draw variance disclosure
      const dShuf = S.describe(shufMeans);
      V.push({ exp, metric: "goodBadRatio", condition: "connectome_4C (shuffle-draw means)", phase: "test", unit: "shuffle draw",
        n: dShuf.n, mean: dShuf.mean, sd: dShuf.sd, se: dShuf.se, ciLo: dShuf.ciLo, ciHi: dShuf.ciHi,
        median: dShuf.median, raw: shufMeans.map(x => x.toFixed(4)).join(" "), excludedTrials_noBadCrossings: "" });
    }
    const b4 = gbPerSeed(rows, "connectome_4B", "test");
    const f4 = gbPerSeed(rows, "connectome_frozen", "test");
    let r = runContrast(exp, "connectome_4A vs 4B (test)", "goodBadRatio", a4.values, b4.values, "> 0", false);
    tests.push({ name: "secondary: 4A vs 4B test goodBadRatio", r, declaredSign: "> 0", condA: "connectome_4A", condB: "connectome_4B", contrast: S.mean(a4.values) - S.mean(b4.values) });
    r = runContrast(exp, "connectome_4A vs frozen (test)", "goodBadRatio", a4.values, f4.values, "> 0", false);
    tests.push({ name: "secondary: 4A vs frozen test goodBadRatio", r, declaredSign: "> 0", condA: "connectome_4A", condB: "connectome_frozen", contrast: S.mean(a4.values) - S.mean(f4.values) });
    // 4A learning gain
    const gl = doorEarlyLate(rows, "connectome_4A", "train", "goodBadRatio");
    const pairs = [];
    const lateBy = new Map(gl.late.map(x => [x.seed, x.value]));
    for (const e of gl.early) if (lateBy.has(e.seed)) pairs.push({ seed: e.seed, a: lateBy.get(e.seed), b: e.value });
    if (pairs.length) {
      r = runContrast(exp, "paired learning gain (late-early train)", "goodBadRatio", pairs.map(p => p.a), pairs.map(p => p.b), "> 0", false);
      tests.push({ name: "secondary: 4A paired late-early goodBadRatio", r, declaredSign: "> 0", condA: "connectome_4A", condB: "connectome_4A", contrast: S.mean(pairs.map(p => p.a - p.b)) });
    }
  }

  // ---- BH within experiment family + verdicts
  const fam = familyIndex[exp] || [];
  const bh = S.benjaminiHochberg(fam);
  const holm = S.holm(fam);
  let k = 0;
  const primaryVerdicts = [];
  for (const t of tests) {
    const { r, declaredSign, name, contrast } = t;
    if (r.notEvaluable) {
      t.verdict = "NOT_EVALUABLE";
      pushStat(exp, name, r.dA ? cfg.arms[t.condA] || "" : "", cfg.metricOf ? cfg.metricOf(t) : "", "test",
        r.dA, r.dB ? { d: r.dB } : null, NaN, NaN, NaN, r.rb, `NOT_EVALUABLE: ${r.reason}`, "NOT_EVALUABLE", t.r && t.primary);
      pushPerm(exp, name, "", "none", NaN, NaN, NaN, "", "NOT_EVALUABLE");
      pushEffect(exp, name, "", NaN, r.rb, r.dA, r.dB);
      if (t.r && t.primary) primaryVerdicts.push("NOT_EVALUABLE");
      continue;   // consumes no BH index
    }
    const pAdj = bh[k], pHolm = holm[k];
    const signOk = declaredSign === "> 0" ? contrast > 0 : contrast < 0;
    const g = r.g;
    const bigEnough = Math.abs(g) >= 0.5;
    let verdict;
    if (signOk && pAdj < 0.05 && bigEnough) verdict = "SUCCESS";
    else if (signOk && pAdj < 0.05 && !bigEnough) verdict = "SUCCESS_SMALL_EFFECT";
    else if (pAdj < 0.05 && !signOk) verdict = "REVERSED";
    else verdict = signOk ? "DIRECTION_ONLY" : "NO_EVIDENCE";
    t.verdict = verdict; t.pAdj = pAdj; t.pHolm = pHolm;
    pushStat(exp, name, r.dA ? cfg.arms[t.condA] || "" : "", cfg.metricOf ? cfg.metricOf(t) : "", "test",
      r.dA, r.dB ? { d: r.dB } : null, r.pRaw, pAdj, g, r.rb, r.test + (r.nPerm ? ` n=${r.nPerm}` : ""), verdict, t.r && t.primary);
    if (r.permRow) {   // patch the registration-time row in place (no duplicate)
      r.permRow.p_bh = Number.isFinite(pAdj) ? pAdj.toExponential(4) : "";
      r.permRow.verdict = verdict;
    } else pushPerm(exp, name, "", r.test, r.pRaw, pAdj, "", r.nPerm, verdict);
    pushEffect(exp, name, "", g, r.rb, r.dA, r.dB);
    if (t.r && t.primary) primaryVerdicts.push(verdict);
    k++;
  }
  // patch: record primary verdict separately
  meta.experiments[exp] = {
    title: cfg.title,
    primaryEndpoint: cfg.primaryLabel,
    seeds: [...new Set(rows.map(r => r.seed))].length,
    conditions: conds,
    primaryVerdicts: primaryVerdicts,
    familyBH: fam.map((p, i) => ({ p_raw: p, p_bh: bh[i], p_holm: holm[i] })),
  };
  return { rows, tests };
}

// ======================================================= apparatus analysis
function loadApparatus(exp) {
  const rows = readCsv(path.join(DIR, `raw_${exp}.csv`));
  if (!rows) return null;
  for (const r of rows) {
    r.seed = +r.seed; r.trial = +r.trial;
    for (const f of Object.keys(r)) if (!["condition", "phase", "layerRates", "fireVec"].includes(f)) r[f] = num(r[f]);
  }
  // E10 has no netSorted column: derive the preregistered transport proxy
  // HERE (post-load, in the same array analyzeApparatus consumes)
  if (/^e10$/i.test(exp)) for (const r of rows) r.netSortedProxy = r.crossLR - r.crossRL;
  return rows;
}

function analyzeApparatus(exp, cfg) {
  const rows = loadApparatus(exp);
  if (!rows) { console.log(`  (no raw_${exp}.csv — skipped)`); return; }
  const V = validationRows[exp] = [];
  console.log(`\n=== ${exp.toUpperCase()} · ${cfg.title} ===`);
  const conds = [...new Set(rows.map(r => r.condition))];

  // ---- descriptive table
  const fields = cfg.descFields;
  for (const cond of conds) {
    for (const phase of ["train", "test"]) {
      for (const metric of fields) {
        const ps = S.perSeedPhaseMean(rows.filter(r => r.condition === cond), metric, phase);
        if (!ps.length) continue;
        const d = S.describe(ps.map(x => x.value));
        V.push({ exp, metric, condition: cond, phase, unit: "seed",
          n: d.n, mean: d.mean, sd: d.sd, se: d.se, ciLo: d.ciLo, ciHi: d.ciHi,
          median: d.median, raw: ps.map(x => x.value.toFixed(6)).join(" "), excludedTrials_noBadCrossings: "" });
      }
    }
  }

  // ---- paired primary + secondaries (neural - frozen, matched seeds)
  const tests = [];
  const neural = cfg.neural, frozen = cfg.frozen;
  const testRows = rows.filter(r => r.phase === "test");
  const pairs = S.pairedPerSeed(testRows.filter(r => r.condition === neural),
                                 testRows.filter(r => r.condition === frozen), cfg.primary, "test");
  if (pairs.length) {
    // reconstruct paired per-seed values (arm A and arm B on matched seeds)
    const a = S.perSeedPhaseMean(testRows.filter(r => r.condition === neural), cfg.primary, "test");
    const b = S.perSeedPhaseMean(testRows.filter(r => r.condition === frozen), cfg.primary, "test");
    const bBy = new Map(b.map(x => [x.seed, x.value]));
    const av = [], bv = [];
    for (const x of a) if (bBy.has(x.seed)) { av.push(x.value); bv.push(bBy.get(x.seed)); }
    const r2 = runContrast(exp, `paired ${neural} - ${frozen} (test)`, cfg.primary, av, bv, "> 0", true);
    r2.primary = true;
    tests.push({ name: `primary: paired ${neural} - ${frozen} test ${cfg.primary}`, r: r2, declaredSign: "> 0",
      contrast: S.mean(av) - S.mean(bv), condA: neural, condB: frozen, primary: true });

    // secondaries
    for (const sec of cfg.secondaries) {
      const a2 = S.perSeedPhaseMean(testRows.filter(r => r.condition === neural), sec, "test");
      const b2 = S.perSeedPhaseMean(testRows.filter(r => r.condition === frozen), sec, "test");
      const b2By = new Map(b2.map(x => [x.seed, x.value]));
      const a2v = [], b2v = [];
      for (const x of a2) if (b2By.has(x.seed)) { a2v.push(x.value); b2v.push(b2By.get(x.seed)); }
      if (a2v.length < 3) continue;
      const rr = runContrast(exp, `paired ${neural} - ${frozen} (test)`, sec, a2v, b2v, "> 0", false);
      rr.primary = false;
      tests.push({ name: `secondary: paired ${sec} (${neural} - ${frozen})`, r: rr, declaredSign: "> 0",
        contrast: S.mean(a2v) - S.mean(b2v), primary: false });
    }
  }
  // floors / physics checks (unpaired)
  for (const chk of cfg.checks) {
    const a = S.perSeedPhaseMean(testRows.filter(r => r.condition === chk.a), chk.metric, "test");
    const b = S.perSeedPhaseMean(testRows.filter(r => r.condition === chk.b), chk.metric, "test");
    if (a.length < 3 || b.length < 3) continue;
    const rr = runContrast(exp, chk.label, chk.metric, a.map(x => x.value), b.map(x => x.value), chk.sign || "> 0", false);
    tests.push({ name: chk.label, r: rr, declaredSign: chk.sign || "> 0", contrast: S.mean(a.map(x => x.value)) - S.mean(b.map(x => x.value)), primary: false });
  }

  // ---- Sagawa–Ueda efficacy on the primary metric
  const eff = sagawaUeda(testRows, neural, frozen, cfg.primary);
  if (eff) {
    V.push({ exp, metric: "sagawaueda_eff", condition: `${neural}/${frozen}`, phase: "test", unit: "seed-pair",
      n: eff.n, mean: eff.eta, sd: NaN, se: eff.se, ciLo: eff.ciLo, ciHi: eff.ciHi,
      median: eff.median, raw: eff.pairs.map(x => x.eta.toFixed(4)).join(" "),
      excludedTrials_noBadCrossings: `noFeedbackDenominator<=0 in ${eff.nDegenerate} pairs (eta undefined)` });
  }

  // ---- BH + verdicts
  const fam = familyIndex[exp] || [];
  const bh = S.benjaminiHochberg(fam);
  const holmP = S.holm(fam);
  let k = 0;
  const primaryVerdicts = [];
  for (const t of tests) {
    if (t.r && t.r.notEvaluable) {
      t.verdict = "NOT_EVALUABLE";
      pushStat(exp, t.name, t.r.dA ? t.condA || "" : "", "", "test", t.r.dA, t.r.dB ? { d: t.r.dB } : null,
        NaN, NaN, NaN, t.r.rb, `NOT_EVALUABLE: ${t.r.reason}`, "NOT_EVALUABLE", t.r && t.primary);
      pushPerm(exp, t.name, "", "none", NaN, NaN, NaN, "", "NOT_EVALUABLE");
      if (t.r && t.primary) primaryVerdicts.push("NOT_EVALUABLE");
      continue;   // consumes no BH index
    }
    const pAdj = bh[k], pHolm = holmP[k];
    const signOk = t.declaredSign === "> 0" ? t.contrast > 0 : t.contrast < 0;
    const g = t.r.g;
    let verdict;
    if (signOk && pAdj < 0.05 && Math.abs(g) >= 0.5) verdict = "SUCCESS";
    else if (signOk && pAdj < 0.05) verdict = "SUCCESS_SMALL_EFFECT";
    else if (pAdj < 0.05 && !signOk) verdict = "REVERSED";
    else verdict = signOk ? "DIRECTION_ONLY" : "NO_EVIDENCE";
    t.verdict = verdict;
    pushStat(exp, t.name, t.condA || "", "", "test", t.r.dA, t.r.dB ? { d: t.r.dB } : null,
      t.r.pRaw, pAdj, g, t.r.rb, t.r.test + (t.r.nPerm ? ` n=${t.r.nPerm}` : ""), verdict, t.primary);
    if (t.r.permRow) {   // patch the registration-time row (apparatus rows were never patched before)
      t.r.permRow.p_bh = Number.isFinite(pAdj) ? pAdj.toExponential(4) : "";
      t.r.permRow.verdict = verdict;
    } else pushPerm(exp, t.name, "", t.r.test, t.r.pRaw, pAdj, "", t.r.nPerm, verdict);
    if (t.primary) primaryVerdicts.push(verdict);
    k++;
  }
  meta.experiments[exp] = {
    title: cfg.title,
    primaryEndpoint: `paired ${neural} - ${frozen} test ${cfg.primary}`,
    seeds: [...new Set(rows.map(r => r.seed))].length,
    conditions: conds,
    primaryVerdicts,
    sagawaUedaEta: eff ? { eta: eff.eta, ciLo: eff.ciLo, ciHi: eff.ciHi, n: eff.n } : null,
    familyBH: fam.map((p, i) => ({ p_raw: p, p_bh: bh[i], p_holm: holmP[i] })),
  };
}

/** Sagawa–Ueda efficacy: eta = <W>_feedback / <W>_no-feedback per matched seed. */
function sagawaUeda(testRows, neural, frozen, metric) {
  const a = S.perSeedPhaseMean(testRows.filter(r => r.condition === neural), metric, "test");
  const b = S.perSeedPhaseMean(testRows.filter(r => r.condition === frozen), metric, "test");
  const bBy = new Map(b.map(x => [x.seed, x.value]));
  const pairs = [];
  let nDegenerate = 0;
  for (const x of a) {
    const w0 = bBy.get(x.seed);
    if (w0 === undefined) continue;
    if (!(w0 > 1e-300)) { nDegenerate++; continue; }   // denominator not positive -> undefined
    pairs.push({ seed: x.seed, eta: x.value / w0 });
  }
  if (pairs.length < 3) return pairs.length ? { eta: NaN, se: NaN, ciLo: NaN, ciHi: NaN, median: NaN, pairs, nDegenerate: nDegenerate + (b.length - pairs.length - nDegenerate) } : null;
  const etas = pairs.map(p => p.eta);
  const d = S.describe(etas);
  return { eta: d.mean, se: d.se, ciLo: d.ciLo, ciHi: d.ciHi, median: d.median, pairs, nDegenerate };
}

// ================================================================== main
const DOOR_CFG = {
  e3: { title: "Drosophila-inspired MB network on the door task",
        primaryLabel: "paired late-early train goodBadRatio (drosophila)",
        arms: {}, metricOf: () => "goodBadRatio" },
  e4: { title: "Connectome-constrained demon 4A/4B/4C(+frozen)",
        primaryLabel: "connectome_4A vs shuffle-mean 4C test goodBadRatio",
        arms: {}, metricOf: () => "goodBadRatio" },
};
const APP_CFG = {
  e9: { title: "Pressure demon", neural: "demon_neural", frozen: "demon_frozen", primary: "workJEp",
    descFields: ["workJEp", "netWorkJ", "workJ", "reward", "decisionAccuracy", "dPfinal", "pistonX", "openFraction",
                 "demonAgree", "goodCrossings", "badCrossings", "dopamine", "weightDrift", "spikeRate", "miNeural"],
    secondaries: ["reward", "decisionAccuracy", "dPfinal", "pistonX", "openFraction", "demonAgree", "dopamine", "weightDrift", "workJEp"],
    checks: [
      { a: "demon_neural", b: "never_open", metric: "workJEp", label: "floor: neural vs never_open (loop alive)", tol: 1e-12 },
      { a: "demon_speed", b: "never_open", metric: "workJEp", label: "reference: demon_speed vs never_open (workJEp)" },
      { a: "demon_speed", b: "demon_neural", metric: "decisionAccuracy", label: "reference context: speed vs neural accuracy" },
    ] },
  e10: { title: "Smoluchowski trapdoor", neural: "trapdoor_neural", frozen: "trapdoor_frozen", primary: "netSortedProxy",
    descFields: ["netSortedProxy", "crossLR", "crossRL", "directionalBias", "decisionAccuracy", "reward", "densityDiff", "holdFraction", "pgReleaseP", "demonAgree", "dopamine", "weightDrift"],
    secondaries: ["directionalBias", "decisionAccuracy", "reward", "densityDiff", "holdFraction"],
    checks: [
      { a: "trapdoor_light", b: "trapdoor_heavy", metric: "crossingRate", label: "physics: light vs heavy flap crossingRate" },
    ] },
  e11: { title: "Feynman ratchet & pawl", neural: "ratchet_neural", frozen: "ratchet_frozen", primary: "workJEp",
    descFields: ["workJEp", "netPerEpisode", "reward", "forwardSteps", "reverseSteps", "liftFraction", "entropyProduction", "decisionAccuracy", "demonAgree", "dopamine", "weightDrift"],
    secondaries: ["reward", "netPerEpisode", "liftFraction", "entropyProduction", "decisionAccuracy"],
    checks: [
      { a: "ratchet_gradient", b: "ratchet_equilibrium", metric: "netPerEpisode", label: "PHYSICS: gradient vs equilibrium netPerEpisode" },
      { a: "ratchet_gradient", b: "ratchet_heavy_load", metric: "workJEp", label: "PHYSICS: gradient vs heavy load workJEp" },
    ] },
};
// E10 netSortedProxy is now added inside loadApparatus (post-load)

// E9: workJ/workJEp are cumulative spring work (monotone within a variant);
// the isolated per-episode contribution is the between-episode DELTA. Compute
// workJEpDelta per episode; NaN (dropped) for the first episode of each seed.
function e9AddDelta(rows) {
  for (const r of rows) r.workJEpDelta = NaN;
  const byKey = new Map();
  for (const r of rows) {
    const k = r.condition + "|" + r.seed;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  for (const rs of byKey.values()) {
    rs.sort((a, b) => a.trial - b.trial);
    for (let i = 1; i < rs.length; i++)
      rs[i].workJEpDelta = rs[i].workJEp - rs[i - 1].workJEp;
  }
  return rows;
}

for (const exp of WANT) {
  familyIndex[exp] = [];
  if (exp === "e9") {
    const rows = readCsv(path.join(DIR, "raw_e9.csv"));
    if (rows) { analyzeApparatus("E9", APP_CFG.e9); }
    else console.log("  (no raw_e9.csv — skipped)");
  } else  if (exp === "e10") {
    analyzeApparatus("E10", APP_CFG.e10);
    if (!fs.existsSync(path.join(DIR, "raw_e10.csv"))) console.log("  (no raw_e10.csv — skipped)");
  } else if (DOOR_CFG[exp]) {
    analyzeDoor(exp.toUpperCase(), DOOR_CFG[exp]);
  } else if (APP_CFG[exp]) {
    analyzeApparatus(exp.toUpperCase(), APP_CFG[exp]);
  }
}

writeCsv("STATISTICAL_SUMMARY.csv", statSummary);
writeCsv("PERMUTATION_TESTS.csv", permTests);
writeCsv("EFFECT_SIZES.csv", effectSizes);
if (effs.length) writeCsv("SAGAWA_UEDA_EFFICACY.csv", effs);
for (const [exp, rows] of Object.entries(validationRows)) writeCsv(`${exp}_VALIDATION.csv`, rows);

// ---- thermodynamic classification table
const THERMO = [
  { experiment: "E3/E4 (door task)", metric: "workInJ (signed jet work)", classification: "DERIVED",
    basis: "Σ step jetWorkNet × SIM_J (1e-21 J/sim-unit; scale is a convention)", reported_as_thermo: "no — input energy bookkeeping only" },
  { experiment: "E3/E4 (door task)", metric: "extractableJ = U_hot(1-Tc/Th)", classification: "MODEL_DEPENDENT",
    basis: "finite-reservoir Carnot bound on the final state; no engine implemented", reported_as_thermo: "no — upper bound, never a measured output" },
  { experiment: "E3/E4 (door task)", metric: "erasureCostJ (Landauer)", classification: "MODEL_DEPENDENT",
    basis: "kB·300K·ln2 × meteredBits (decision flips + crossing evaluations)", reported_as_thermo: "no — memory-traffic meter, not a measured heat" },
  { experiment: "E3/E4 (door task)", metric: "measuredBits", classification: "DERIVED", basis: "counted decision-state flips + 1 bit per crossing evaluation", reported_as_thermo: "no" },
  { experiment: "E3/E4 (door task)", metric: "sortEntropy delta (bits)", classification: "PROXY",
    basis: "occupancy-histogram entropy of speed classes; not Gibbs entropy of the gas", reported_as_thermo: "no — sorting proxy" },
  { experiment: "E3/E4 (door task)", metric: "miNeural", classification: "PROXY",
    basis: "binarized trial-cumulative spike counts × speed class, 256 sampled neurons; not information flow", reported_as_thermo: "no" },
  { experiment: "E9", metric: "workJEp (spring work)", classification: "DERIVED",
    basis: "∫ SPRING·x·ẋ dt on the piston ODE; sim-unit Joules", reported_as_thermo: "primary work metric (declared sim units)" },
  { experiment: "E9", metric: "dPfinal, dTfinal", classification: "PROXY", basis: "kinetic ideal-gas pressure/temperature from mean v² per side", reported_as_thermo: "no — state descriptors" },
  { experiment: "E9", metric: "erasureCostJ", classification: "MODEL_DEPENDENT", basis: "kB·T·ln2 × decision bits", reported_as_thermo: "no" },
  { experiment: "E10", metric: "crossLR/crossRL, netSortedProxy, directionalBias", classification: "PROXY",
    basis: "crossing counts as transport-directionality stand-in; no per-molecule entropy ledger exists", reported_as_thermo: "no — transport proxy" },
  { experiment: "E10", metric: "netWorkJ/workJ fields", classification: "PLACEHOLDER",
    basis: "E10 rows carry constant zeros (no work integrator in the trapdoor core)", reported_as_thermo: "no — excluded from all inference" },
  { experiment: "E11", metric: "workJEp = net·load (SIGNED)", classification: "DERIVED",
    basis: "net tooth hops × load energy bias per hop; backward hops pay work back", reported_as_thermo: "primary work metric (declared sim units)" },
  { experiment: "E11", metric: "entropyProduction = Qh/Th - Qc/Tc", classification: "MODEL_DEPENDENT",
    basis: "barrier-energy bookkeeping in an event-rate model; not measured heat", reported_as_thermo: "no — classified, not interpreted" },
  { experiment: "E11", metric: "heatJ (qh+qc)", classification: "MODEL_DEPENDENT", basis: "cumulated barrier energies paid to baths", reported_as_thermo: "no" },
  { experiment: "E11", metric: "miNeural", classification: "PLACEHOLDER",
    basis: "structurally 0: particleSample is empty in the ratchet core (audit F-7)", reported_as_thermo: "no — excluded from all inference" },
  { experiment: "E9/E10/E11", metric: "Sagawa-Ueda efficacy eta = <W>_fb / <W>_no-fb", classification: "MODEL_DEPENDENT",
    basis: "ratio of expectations on simulated work metrics; formally defined feedback efficacy (Sagawa-Ueda 2010 analogue)", reported_as_thermo: "yes — as MODEL-DEPENDENT feedback efficacy, never as measured thermodynamics" },
];
writeCsv("THERMO_CLASSIFICATION.csv", THERMO);

fs.writeFileSync(path.join(OUT, "analysis_meta.json"), JSON.stringify(meta, null, 2));
console.log("\nwrote STATISTICAL_SUMMARY / PERMUTATION_TESTS / EFFECT_SIZES / THERMO_CLASSIFICATION / *_VALIDATION CSVs + analysis_meta.json");
