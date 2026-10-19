#!/usr/bin/env node
/**
 * paper_analysis.js — statistical analysis of the paper program (E1–E11).
 *
 * Conventions (PRE_REGISTERED_CRITERIA.json, stats_utils.js):
 *   - the INDEPENDENT REPLICATE IS THE SEED. Trials/episodes within a seed are
 *     aggregated first (per-seed phase means); the seed is the n.
 *   - CI: t(0.975, n-1)·sd/√n over per-seed values.
 *   - unpaired comparisons: seeded label permutation (10000 draws, seed 20260920)
 *   - paired comparisons: seeded sign-flip permutation on per-seed differences
 *   - effect size: Hedges' g; multiple comparisons: Benjamini–Hochberg FDR
 *   - verdicts are GATED: permutation p cannot declare SUCCESS from
 *     degenerate zero-variance contrasts (n_evaluable seeds < 3 => NO_EVIDENCE)
 *
 * Outputs:
 *   paper_v2/analysis/ANALYSIS_RESULTS.json   machine-readable full results
 *   paper_v2/analysis/STATISTICS_REPORT.md    human-readable statistics report
 *   paper_v2/processed/E<k>_per_seed.csv      per-seed phase means
 *   paper_v2/processed/curves_E<k>.csv        10-trial/4-ep block curves (figures)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const { meanCI } = require(ROOT + "/experiment_core.js");
const stats = require(ROOT + "/stats_utils.js");

const RAW = path.join(__dirname, "raw");
const ANA = path.join(__dirname, "analysis");
const PRO = path.join(__dirname, "processed");
for (const d of [ANA, PRO]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

// ------------------------------------------------------------- helpers
function readRows(patterns) {
  const files = fs.readdirSync(RAW).filter(f => patterns.some(p => f.startsWith(p) && f.endsWith(".jsonl"))).sort();
  const rows = [];
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(RAW, f), "utf8").split("\n")) {
      const s = line.trim();
      if (s) { try { rows.push(JSON.parse(s)); } catch (e) { /* skip malformed */ } }
    }
  }
  return rows;
}
function perSeedPhaseMeans(rows, fields) {
  const by = {};
  for (const r of rows) {
    const c = (by[r.condition] = by[r.condition] || {});
    for (const f of fields) {
      const v = r[f];
      if (typeof v === "number" && Number.isFinite(v)) {
        const slot = (c[f] = c[f] || { train: {}, test: {} });
        const ph = r.phase === "test" ? "test" : "train";
        (slot[ph][r.seed] = slot[ph][r.seed] || []).push(v);
      }
    }
  }
  const out = {};
  for (const [c, fieldsMap] of Object.entries(by)) {
    out[c] = {};
    for (const [f, slot] of Object.entries(fieldsMap)) {
      out[c][f] = {};
      for (const ph of ["train", "test"]) {
        const perSeed = Object.entries(slot[ph]).map(([seed, vals]) => ({ seed: +seed, mean: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length }));
        perSeed.sort((a, b) => a.seed - b.seed);
        out[c][f][ph] = perSeed;
      }
    }
  }
  return out;
}
function earlyLateTrialMeans(rows, field, frac = 0.2) {
  const by = {};
  for (const r of rows) {
    if (r.phase !== "train") continue;
    const v = r[field];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    (by[r.condition] = by[r.condition] || {});
    (by[r.condition][r.seed] = by[r.condition][r.seed] || []).push({ trial: r.trial, v });
  }
  const out = {};
  for (const [c, seedMap] of Object.entries(by)) {
    out[c] = { early: [], late: [] };
    for (const [seed, list] of Object.entries(seedMap)) {
      list.sort((a, b) => a.trial - b.trial);
      const k = Math.max(1, Math.floor(list.length * frac));
      const avg = arr => arr.length ? arr.reduce((a, b) => a + b.v, 0) / arr.length : NaN;
      out[c].early.push({ seed: +seed, mean: avg(list.slice(0, k)) });
      out[c].late.push({ seed: +seed, mean: avg(list.slice(-k)) });
    }
  }
  return out;
}
function csvEscape(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(name, rows) {
  if (!rows.length) { console.log("  (skip empty " + name + ")"); return; }
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map(c => csvEscape(r[c])).join(","));
  fs.writeFileSync(path.join(PRO, name), lines.join("\n") + "\n");
  console.log("  wrote processed/" + name + " (" + rows.length + " rows)");
}
const fmt = (x, d = 4) => Number.isFinite(x) ? x.toFixed(d) : "n/a";
const sci = (x) => Number.isFinite(x) ? x.toExponential(2) : "n/a";
// Thermodynamic-negligibility guard: a work/energy contrast is scientifically
// meaningless when BOTH condition means sit far below the energy of ONE
// Landauer bit at 300 K (k_B*T*ln2 = 2.871e-21 J) — the apparatus then
// cannot pay for a single bit of the demon's memory, so any permutation
// significance on the contrast is an artifact of sim-unit bookkeeping, not
// evidence of demon-like performance. 10% of one bit is the eligibility bar.
const LANDAUER_BIT_J = 2.871e-21;
const JOULE_METRICS = new Set(["workJEp", "netWorkJ", "workInJ", "extractableJ",
                               "erasureCostJ", "heatJ", "energyJ", "workJ"]);
// verdicts with degeneracy + magnitude guards
function verdictOf(pRaw, pBh, g, delta, nEvaluable, scaleA, scaleB, metric) {
  if (!Number.isFinite(pBh)) return "NOT_EVALUABLE";
  if (nEvaluable < 3) return "DEGENERATEcontrast: not evaluable as positive evidence";
  if (metric && JOULE_METRICS.has(metric) && scaleA !== undefined && scaleB !== undefined) {
    if (Math.abs(scaleA) < 0.1 * LANDAUER_BIT_J && Math.abs(scaleB) < 0.1 * LANDAUER_BIT_J) {
      return "THERMODYNAMICALLY NEGLIGIBLE (both arms < 10% of one Landauer bit; no positive evidence)";
    }
    // same-sign arms with a contrast smaller than 1% of the larger mean:
    // the comparison does not change the qualitative state (e.g. both arms
    // net-negative work) and the delta is bookkeeping noise relative to it
    const big = Math.max(Math.abs(scaleA), Math.abs(scaleB));
    if (Math.sign(scaleA) === Math.sign(scaleB) && big > 0 &&
        Math.abs(delta) < 0.01 * big) {
      return "NEGLIGIBLE relative to condition means (delta < 1% of |mean|; no positive evidence)";
    }
  }
  const sig = pBh < 0.05;
  const sameSign = Math.sign(delta) === Math.sign(g || delta || 0);
  if (sig && Number.isFinite(g) && Math.abs(g) >= 0.5 && sameSign) return "SUCCESS";
  if (sig && sameSign) return "SUCCESS_SMALL_EFFECT";
  if (Math.sign(delta) === Math.sign(g || delta || 0)) return "DIRECTION_ONLY";
  return "NO_EVIDENCE";
}
function bh(ps) {
  const n = ps.length;
  if (!n) return [];
  const idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(n);
  let prev = 1;
  for (let i = n - 1; i >= 0; i--) {
    const rank = i + 1;
    const adj = Math.min(prev, idx[i][0] * n / rank);
    prev = adj; out[idx[i][1]] = adj;
  }
  return out;
}
function pairedDiff(a, b) {
  const n = Math.min(a.length, b.length); const d = [];
  for (let i = 0; i < n; i++) d.push(a[i] - b[i]);
  return d;
}

// =====================================================================
// LOAD
// =====================================================================
const doorFields = ["goodBadRatio", "demonAgree", "dTfinal", "sortEntropy", "spatialH",
                    "openFraction", "miNeural", "workInJ", "extractableJ", "erasureCostJ",
                    "landauerRatio", "measuredBits", "energyJ", "crossings", "goodCrossings", "badCrossings", "demonDecisions"];
const E = {
  E1: readRows(["E1_rows"]), E2: readRows(["E2_rows"]), E3: readRows(["E3_rows"]),
  E4: readRows(["E4_rows_s"]), E5: readRows(["E5_rows_s"]), E6: readRows(["E6_rows"]),
  E7: readRows(["E7_rows"]), E8: readRows(["E8_rows"]),
  E9: readRows(["E9_rows"]), E10: readRows(["E10_rows"]), E11: readRows(["E11_rows"]),
};
// E10: derive netSortedProxy = crossLR - crossRL per row (documented derivation)
for (const r of E.E10) r.netSortedProxy = (r.crossLR || 0) - (r.crossRL || 0);

const apparatusFields = {
  E9: ["workJEp", "netWorkJ", "reward", "decisionAccuracy", "demonAgree", "dPfinal", "dTfinal",
       "pistonX", "openFraction", "dopamine", "dopamineMean", "weightDrift", "erasureCostJ",
       "crossings", "spikeRate", "sensoryActivity", "motorActivity", "motorRateMean", "valveFlips"],
  E10: ["netSortedProxy", "crossLR", "crossRL", "directionalBias", "crossingRate",
        "densityDiff", "holdFraction", "decisionAccuracy", "reward", "weightDrift", "demonAgree",
        "spikeRate", "sensoryActivity", "motorActivity", "pgReleaseP"],
  E11: ["netPerEpisode", "workJEp", "netWorkJ", "heatJ", "liftFraction", "entropyProduction",
        "efficiency", "decisionAccuracy", "reward", "demonAgree", "weightDrift", "spikeRate",
        "sensoryActivity", "motorActivity", "forwardSteps", "reverseSteps"],
};

const RESULTS = { schema: "paper-analysis/2.0", generated: new Date().toISOString(),
  conventions: { replicate_unit: "seed", ci: "t(0.975,n-1)*sd/sqrt(n)",
    permutation: "10000 draws, PRNG seed 20260920",
    correction: "Benjamini-Hochberg FDR q=0.05 within experiment family",
    effect_size: "Hedges g",
    degeneracy_guard: "contrasts with fewer than 3 evaluable per-seed differences cannot yield SUCCESS regardless of permutation p (zero-variance artifacts)" },
  experiments: {} };
const report = [];
const push = s => { report.push(s); console.log(s.replace(/<[^>]*>/g, "")); };

push("# STATISTICAL ANALYSIS REPORT — E1–E11 paper program");
push("");
push("Generated: " + RESULTS.generated);
push("Replicate unit: **seed** (per-seed phase means first). 95% CI: t-based. Permutation p: 10,000 draws (PRNG 20260920), BH-FDR q=0.05 within family. Effect size: Hedges' g. Verdicts are gated: a contrast computed over fewer than 3 evaluable per-seed differences is reported as DEGENERATE and cannot support a positive claim.");
push("");

// =====================================================================
// E1–E8 door experiments
// =====================================================================
const doorExp = { E1: ["classical_demon"], E2: ["ann", "random"], E3: ["drosophila", "drosophila_frozen"],
  E4: ["connectome_4A", "connectome_4B", "connectome_4C"],
  E5: ["classical_demon", "ann", "drosophila", "connectome", "shuffled_connectome"],
  E6: ["classical_demon", "random", "never_gate"], E7: ["classical_demon"],
  E8: ["demon_adaptive", "demon_fixed", "demon_mem4"] };

const gBcond = rows => { // good:bad ratio conditional on crossings>0 (documented: Infinity-safe)
  const t = rows.filter(r => (r.goodCrossings || 0) + (r.badCrossings || 0) > 0 && Number.isFinite(r.goodBadRatio));
  return t.length ? t.reduce((a, r) => a + r.goodBadRatio, 0) / t.length : NaN;
};

for (const [id, conds] of Object.entries(doorExp)) {
  push("## " + id);
  const rows = E[id];
  const psp = perSeedPhaseMeans(rows, doorFields);
  const el = earlyLateTrialMeans(rows, "goodBadRatio");
  const elAgree = earlyLateTrialMeans(rows, "demonAgree");
  const elCross = earlyLateTrialMeans(rows, "crossings");
  const expRes = { conditions: {}, learning: {}, comparisons: {}, crossingActivity: {} };
  const csvRows = [];
  for (const c of conds) {
    for (const f of doorFields) {
      if (!psp[c] || !psp[c][f]) continue;
      for (const ph of ["train", "test"])
        for (const ps of psp[c][f][ph])
          csvRows.push({ experiment: id, condition: c, seed: ps.seed, phase: ph, metric: f, per_seed_mean: ps.mean, n_trials: ps.n });
    }
    for (const [ph, arr] of [["early", el[c] && el[c].early], ["late", el[c] && el[c].late]])
      for (const ps of arr || [])
        csvRows.push({ experiment: id, condition: c, seed: ps.seed, phase: "train_" + ph, metric: "goodBadRatio", per_seed_mean: ps.mean, n_trials: null });
    // crossing activity (openFrac + crossings per episode)
    for (const ph of ["train", "test"]) {
      const rr = rows.filter(r => r.condition === c && r.phase === ph);
      for (const seed of [...new Set(rr.map(r => r.seed))]) {
        const sr = rr.filter(r => r.seed === seed);
        csvRows.push({ experiment: id, condition: c, seed, phase: ph + "_activity", metric: "openFraction",
          per_seed_mean: sr.reduce((a, r) => a + (r.openFraction || 0), 0) / sr.length, n_trials: sr.length });
        csvRows.push({ experiment: id, condition: c, seed, phase: ph + "_activity", metric: "crossings",
          per_seed_mean: sr.reduce((a, r) => a + (r.crossings || 0), 0) / sr.length, n_trials: sr.length });
      }
    }
  }
  writeCsv(id + "_per_seed.csv", csvRows);

  for (const c of conds) {
    const condRes = {};
    for (const f of ["goodBadRatio", "demonAgree", "dTfinal", "sortEntropy", "miNeural", "extractableJ", "erasureCostJ", "measuredBits", "landauerRatio", "workInJ", "openFraction", "crossings"]) {
      if (!psp[c] || !psp[c][f]) continue;
      condRes[f] = {};
      for (const ph of ["train", "test"]) {
        const vals = psp[c][f][ph].map(x => x.mean);
        if (!vals.length) continue;
        const ci = meanCI(vals);
        condRes[f][ph] = { n: vals.length, mean: ci.mean, ci: ci.ci, sd: stats.sd(vals) };
      }
    }
    expRes.conditions[c] = condRes;
    const earlyVals = (el[c] && el[c].early || []).map(x => x.mean);
    const lateVals = (el[c] && el[c].late || []).map(x => x.mean);
    expRes.learning[c] = {
      goodBadRatio_early: meanCI(earlyVals), goodBadRatio_late: meanCI(lateVals),
      demonAgree_early: meanCI((elAgree[c] && elAgree[c].early || []).map(x => x.mean)),
      demonAgree_late: meanCI((elAgree[c] && elAgree[c].late || []).map(x => x.mean)),
      crossings_early: meanCI((elCross[c] && elCross[c].early || []).map(x => x.mean)),
      crossings_late: meanCI((elCross[c] && elCross[c].late || []).map(x => x.mean)),
    };
    // crossing activity per phase
    expRes.crossingActivity[c] = {};
    for (const ph of ["train", "test"]) {
      const rr = rows.filter(r => r.condition === c && r.phase === ph);
      const perSeed = {};
      for (const r of rr) (perSeed[r.seed] = perSeed[r.seed] || []).push(r);
      expRes.crossingActivity[c][ph] = {
        openFraction: meanCI(Object.values(perSeed).map(sr => sr.reduce((a, r) => a + (r.openFraction || 0), 0) / sr.length)),
        crossings: meanCI(Object.values(perSeed).map(sr => sr.reduce((a, r) => a + (r.crossings || 0), 0) / sr.length)),
        goodBadConditional: gBcond(rr),
      };
    }
  }
  push("");
  push("| condition | n | openFrac train→test | crossings/ep train→test | g:B (cond, test) | dT (test) | ΔH (test) | MI (test) | bits/trial |");
  push("|---|---|---|---|---|---|---|---|---|");
  for (const c of conds) {
    const T = expRes.conditions[c], A = expRes.crossingActivity[c];
    const ofT = A.train && A.test ? A.train.openFraction.mean.toFixed(3) + "→" + A.test.openFraction.mean.toFixed(3) : "n/a";
    const crT = A.train && A.test ? A.train.crossings.mean.toFixed(2) + "→" + A.test.crossings.mean.toFixed(2) : "n/a";
    push("| " + c + " | " + (T.openFraction ? T.openFraction.train.n : "?") +
      " | " + ofT + " | " + crT +
      " | " + fmt(A.test && A.test.goodBadConditional, 2) +
      " | " + fmt(T.dTfinal.test.mean, 4) + " | " + fmt(T.sortEntropy.test.mean, 4) +
      " | " + fmt(T.miNeural && T.miNeural.test.mean, 4) +
      " | " + fmt(T.measuredBits.test.mean, 0) + " |");
  }
  // planned comparisons
  const comparisons = [];
  function addComp(name, a, b, metric, phase, paired, declaredSign) {
    const A = psp[a] && psp[a][metric] && psp[a][metric][phase].map(x => x.mean) || [];
    const B = psp[b] && psp[b][metric] && psp[b][metric][phase].map(x => x.mean) || [];
    if (A.length < 2 || B.length < 2) {
      comparisons.push({ name, metric, phase, a, b, nA: A.length, nB: B.length, verdict: "NOT_EVALUABLE (n<2)" });
      return;
    }
    let p, delta, nEval;
    if (paired) {
      const d = pairedDiff(A, B); delta = stats.mean(d); nEval = d.length;
      p = stats.permutationTestPaired ? stats.permutationTestPaired(A, B).p : NaN;
    } else {
      const r = stats.permutationTestUnpaired(A, B);
      p = r.p; delta = stats.mean(A) - stats.mean(B); nEval = Math.min(A.length, B.length);
    }
    const g = stats.hedgesG ? stats.hedgesG(A, B) : NaN;
    comparisons.push({ name, metric, phase, a, b, paired, nA: A.length, nB: B.length,
      meanA: stats.mean(A), meanB: stats.mean(B), delta, p_raw: p, hedges_g: g,
      n_evaluable: nEval, declared_sign: declaredSign === undefined ? null : declaredSign });
  }
  if (id === "E2") {
    addComp("ann vs random (test openFraction)", "ann", "random", "openFraction", "test", false, +1);
    addComp("ann vs random (test dT)", "ann", "random", "dTfinal", "test", false, -1);
  }
  if (id === "E3") {
    addComp("drosophila vs frozen (test openFraction; policy collapse)", "drosophila", "drosophila_frozen", "openFraction", "test", false, -1);
    addComp("drosophila vs frozen (train openFraction)", "drosophila", "drosophila_frozen", "openFraction", "train", false, -1);
    addComp("drosophila vs frozen (test dT)", "drosophila", "drosophila_frozen", "dTfinal", "test", false, +1);
  }
  if (id === "E4") {
    addComp("4A vs 4C shuffled (test dT)", "connectome_4A", "connectome_4C", "dTfinal", "test", false, +1);
    addComp("4A vs 4C shuffled (test ΔH)", "connectome_4A", "connectome_4C", "sortEntropy", "test", false, +1);
    addComp("4A vs 4B restricted (test dT)", "connectome_4A", "connectome_4B", "dTfinal", "test", false, +1);
    addComp("4A vs 4B (test MI)", "connectome_4A", "connectome_4B", "miNeural", "test", false, +1);
  }
  if (id === "E5") {
    addComp("classical vs ann (test dT)", "classical_demon", "ann", "dTfinal", "test", false, +1);
    addComp("classical vs ann (test ΔH)", "classical_demon", "ann", "sortEntropy", "test", false, +1);
    addComp("connectome vs shuffled (test dT)", "connectome", "shuffled_connectome", "dTfinal", "test", false, +1);
    addComp("connectome vs classical (test g:B cond.)", "connectome", "classical_demon", "goodBadRatio", "test", false, -1);
  }
  if (id === "E6") {
    addComp("demon vs never_gate (test ΔH)", "classical_demon", "never_gate", "sortEntropy", "test", false, +1);
    addComp("random vs never_gate (test ΔH)", "random", "never_gate", "sortEntropy", "test", false, +1);
    addComp("demon vs never_gate (test extractable)", "classical_demon", "never_gate", "extractableJ", "test", false, +1);
  }
  if (id === "E8") {
    addComp("adaptive vs fixed (test openFraction)", "demon_adaptive", "demon_fixed", "openFraction", "test", false, +1);
    addComp("adaptive vs fixed (test dT)", "demon_adaptive", "demon_fixed", "dTfinal", "test", false, +1);
    addComp("adaptive vs mem4 (test dT)", "demon_adaptive", "demon_mem4", "dTfinal", "test", false, +1);
    addComp("adaptive vs fixed (test bits)", "demon_adaptive", "demon_fixed", "measuredBits", "test", false, +1);
  }
  const evaluable = comparisons.filter(c => Number.isFinite(c.p_raw));
  const adj = bh(evaluable.map(c => c.p_raw));
  evaluable.forEach((c, i) => { c.p_bh = adj[i];
    c.verdict = verdictOf(c.p_raw, c.p_bh, c.hedges_g, c.delta, c.n_evaluable, c.meanA, c.meanB, c.metric); });
  expRes.comparisons = comparisons;
  if (comparisons.length) {
    push("");
    push("| comparison | metric | phase | mean A | mean B | Δ | p_raw | p_BH | g | verdict |");
    push("|---|---|---|---|---|---|---|---|---|---|");
    for (const c of comparisons)
      push("| " + c.name + " | " + c.metric + " | " + c.phase + " | " + fmt(c.meanA, 3) + " | " + fmt(c.meanB, 3) + " | " +
        fmt(c.delta, 3) + " | " + (Number.isFinite(c.p_raw) ? c.p_raw.toExponential(2) : "n/a") + " | " +
        (Number.isFinite(c.p_bh) ? c.p_bh.toExponential(2) : "n/a") + " | " + fmt(c.hedges_g, 2) + " | " + (c.verdict || "n/a") + " |");
  }
  RESULTS.experiments[id] = expRes;
  push("");
  // block curve for figures
  const curveCsv = [];
  for (const c of conds) {
    const rr = rows.filter(r => r.condition === c);
    const perSeed = {};
    for (const r of rr) (perSeed[r.seed] = perSeed[r.seed] || []).push(r);
    const seeds = Object.keys(perSeed).map(Number).sort((a, b) => a - b);
    const nTrials = Math.max(...rr.map(r => r.trial)) + 1;
    for (let b = 0; b * 10 < nTrials; b++) {
      for (const seed of seeds) {
        const seg = perSeed[seed].filter(r => r.trial >= b * 10 && r.trial < b * 10 + 10);
        if (!seg.length) continue;
        const avg = f => { const v = seg.map(r => r[f]).filter(Number.isFinite); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : NaN; };
        curveCsv.push({ experiment: id, condition: c, seed, block: b, phase: seg[0].phase,
          openFraction: avg("openFraction"), crossings: avg("crossings"), demonAgree: avg("demonAgree"),
          goodBadRatio: avg("goodBadRatio"), sortEntropy: avg("sortEntropy"), dTfinal: avg("dTfinal"),
          miNeural: avg("miNeural"), measuredBits: avg("measuredBits") });
      }
    }
  }
  writeCsv("curves_" + id + ".csv", curveCsv);
}

// E7 physics regimes — rows do NOT carry nParticles; the manifest maps each
// seed to its regime (seedIdx 1: 120/0.0, 2: 640/0.30, 3: 320/0.12) and the
// core implements it via _physics(seedIdx): seed 1 -> idx0 (120), seed 102 ->
// idx1 (640), seed 203 -> idx2 (320). Derive regime from seed, document it.
{
  push("## E7 · physics regimes");
  const rows = E.E7.filter(r => r.phase === "test");
  const REGIME = { 1: "120 particles / noise 0.00 (sparse-clean)",
                   102: "640 particles / noise 0.30 (dense-noisy)",
                   203: "320 particles / noise 0.12 (default)" };
  const byRegime = {};
  for (const r of rows) (byRegime[r.seed] = byRegime[r.seed] || []).push(r);
  const regimeRes = {};
  push("");
  push("| seed | regime | test g:B (cond) | test dT | test ΔH |");
  push("|---|---|---|---|---|");
  for (const [seed, list] of Object.entries(byRegime)) {
    regimeRes[seed] = { regime: REGIME[seed], goodBadConditional: gBcond(list),
                        dT: meanCI(list.map(r => r.dTfinal || 0)), sortH: meanCI(list.map(r => r.sortEntropy || 0)) };
    push("| " + seed + " | " + REGIME[seed] + " | " + fmt(gBcond(list), 2) + " | " + fmt(regimeRes[seed].dT.mean, 4) + " | " + fmt(regimeRes[seed].sortH.mean, 4) + " |");
  }
  RESULTS.experiments.E7 = { regimes: regimeRes, regimeMapSource: "experiments/e7.json physics.per_seed_regimes (seed 1/102/203 = seedIdx 1/2/3)" };
  const csv = [];
  for (const r of E.E7) csv.push({ experiment: "E7", condition: r.condition, seed: r.seed, phase: r.phase, trial: r.trial,
                                   nParticles: r.nParticles, openFraction: r.openFraction, crossings: r.crossings,
                                   goodBadRatio: r.goodBadRatio, dTfinal: r.dTfinal, sortEntropy: r.sortEntropy });
  writeCsv("E7_per_seed.csv", csv);
  push("");
}

// =====================================================================
// E9–E11 apparatus
// =====================================================================
for (const [id, fields] of Object.entries(apparatusFields)) {
  push("## " + id);
  const rows = E[id];
  const psp = perSeedPhaseMeans(rows, fields);
  const expRes = { conditions: {}, comparisons: {} };
  const csvRows = [];
  for (const c of Object.keys(psp)) {
    for (const f of fields) {
      if (!psp[c][f]) continue;
      for (const ph of ["train", "test"])
        for (const ps of psp[c][f][ph])
          csvRows.push({ experiment: id, condition: c, seed: ps.seed, phase: ph, metric: f, per_seed_mean: ps.mean, n_episodes: ps.n });
    }
  }
  writeCsv(id + "_per_seed.csv", csvRows);
  push("");
  push("| condition | n seeds | test-phase metrics: mean ± CI |");
  push("|---|---|---|");
  for (const c of Object.keys(psp)) {
    expRes.conditions[c] = {};
    const parts = [];
    for (const f of fields) {
      if (!psp[c][f] || !psp[c][f].test || !psp[c][f].test.length) continue;
      const vals = psp[c][f].test.map(x => x.mean);
      const ci = meanCI(vals);
      expRes.conditions[c][f] = { test: ci, train: meanCI(psp[c][f].train.map(x => x.mean)) };
      if (["workJEp", "netWorkJ", "reward", "decisionAccuracy", "dPfinal", "netPerEpisode", "netSortedProxy",
           "liftFraction", "entropyProduction", "openFraction", "holdFraction", "dopamineMean", "weightDrift",
           "crossingRate", "demonAgree", "valveFlips", "crossings", "spikeRate"].includes(f))
        parts.push(f + " " + fmt(ci.mean, 3) + " ± " + fmt(ci.ci, 3));
    }
    const n0 = psp[c][fields[0]] ? psp[c][fields[0]].test.length : "?";
    push("| " + c + " | " + n0 + " | " + parts.join("; ") + " |");
  }
  const comparisons = [];
  function addA(name, a, b, metric, paired, declaredSign) {
    const A = psp[a] && psp[a][metric] && psp[a][metric].test.map(x => x.mean) || [];
    const B = psp[b] && psp[b][metric] && psp[b][metric].test.map(x => x.mean) || [];
    if (A.length < 2 || B.length < 2) { comparisons.push({ name, metric, a, b, nA: A.length, nB: B.length, verdict: "NOT_EVALUABLE (n<2)" }); return; }
    let p, delta, nEval;
    if (paired) {
      const d = pairedDiff(A, B); delta = stats.mean(d); nEval = d.length;
      p = stats.permutationTestPaired ? stats.permutationTestPaired(A, B).p : NaN;
    } else {
      const r = stats.permutationTestUnpaired(A, B); p = r.p;
      delta = stats.mean(A) - stats.mean(B); nEval = Math.min(A.length, B.length);
    }
    comparisons.push({ name, metric, a, b, paired, nA: A.length, nB: B.length,
      meanA: stats.mean(A), meanB: stats.mean(B), delta, p_raw: p,
      hedges_g: stats.hedgesG ? stats.hedgesG(A, B) : NaN, n_evaluable: nEval,
      declared_sign: declaredSign === undefined ? null : declaredSign });
  }
  if (id === "E9") {
    addA("neural vs frozen (workJEp)", "demon_neural", "demon_frozen", "workJEp", true, +1);
    addA("neural vs frozen (netWorkJ)", "demon_neural", "demon_frozen", "netWorkJ", true, +1);
    addA("neural vs frozen (decisionAccuracy)", "demon_neural", "demon_frozen", "decisionAccuracy", true, +1);
    addA("neural vs frozen (weightDrift; manipulation check)", "demon_neural", "demon_frozen", "weightDrift", true, +1);
    addA("speed vs frozen (workJEp; reference competence)", "demon_speed", "demon_frozen", "workJEp", false, +1);
    addA("speed vs neural (decisionAccuracy)", "demon_speed", "demon_neural", "decisionAccuracy", false, +1);
  }
  if (id === "E10") {
    addA("neural vs frozen (netSortedProxy)", "trapdoor_neural", "trapdoor_frozen", "netSortedProxy", true, +1);
    addA("light vs heavy flap (crossingRate; physics sanity)", "trapdoor_light", "trapdoor_heavy", "crossingRate", false, +1);
    addA("neural vs frozen (decisionAccuracy)", "trapdoor_neural", "trapdoor_frozen", "decisionAccuracy", true, +1);
    addA("neural vs frozen (holdFraction)", "trapdoor_neural", "trapdoor_frozen", "holdFraction", true, -1);
  }
  if (id === "E11") {
    addA("gradient vs equilibrium (netPerEpisode; 2nd law boundary)", "ratchet_gradient", "ratchet_equilibrium", "netPerEpisode", false, +1);
    addA("gradient vs heavy load (netPerEpisode; load response)", "ratchet_gradient", "ratchet_heavy_load", "netPerEpisode", false, -1);
    addA("neural vs frozen (netPerEpisode)", "ratchet_neural", "ratchet_frozen", "netPerEpisode", true, +1);
    addA("neural vs frozen (reward; learning acts)", "ratchet_neural", "ratchet_frozen", "reward", true, +1);
    addA("neural vs frozen (decisionAccuracy)", "ratchet_neural", "ratchet_frozen", "decisionAccuracy", true, +1);
    addA("neural vs frozen (weightDrift; manipulation check)", "ratchet_neural", "ratchet_frozen", "weightDrift", true, +1);
    addA("neural vs frozen (entropyProduction)", "ratchet_neural", "ratchet_frozen", "entropyProduction", true, +1);
  }
  const evaluable = comparisons.filter(c => Number.isFinite(c.p_raw));
  const adj = bh(evaluable.map(c => c.p_raw));
  evaluable.forEach((c, i) => { c.p_bh = adj[i];
    c.verdict = verdictOf(c.p_raw, c.p_bh, c.hedges_g, c.delta, c.n_evaluable, c.meanA, c.meanB, c.metric); });
  expRes.comparisons = comparisons;
  push("");
  push("| comparison | metric | mean A | mean B | Δ | p_raw | p_BH | g | verdict |");
  push("|---|---|---|---|---|---|---|---|---|");
  for (const c of comparisons) {
    const tiny = /J|entropy|Energy|work/i.test(c.metric);
    const fA = tiny ? sci(c.meanA) : fmt(c.meanA, 4);
    const fB = tiny ? sci(c.meanB) : fmt(c.meanB, 4);
    const fD = tiny ? sci(c.delta) : fmt(c.delta, 4);
    push("| " + c.name + " | " + c.metric + " | " + fA + " | " + fB + " | " + fD + " | " +
      (Number.isFinite(c.p_raw) ? c.p_raw.toExponential(2) : "n/a") + " | " +
      (Number.isFinite(c.p_bh) ? c.p_bh.toExponential(2) : "n/a") + " | " + fmt(c.hedges_g, 2) + " | " + (c.verdict || "n/a") + " |");
  }
  RESULTS.experiments[id] = expRes;
  push("");
  // block curve (4-episode blocks)
  const curveCsv = [];
  for (const c of Object.keys(psp)) {
    const rr = rows.filter(r => r.condition === c);
    const perSeed = {};
    for (const r of rr) (perSeed[r.seed] = perSeed[r.seed] || []).push(r);
    for (const [seed, list] of Object.entries(perSeed)) {
      list.sort((a, b) => (a.trial || 0) - (b.trial || 0));
      for (let b = 0; b * 4 < list.length; b++) {
        const seg = list.slice(b * 4, b * 4 + 4);
        if (!seg.length) continue;
        const avg = f => { const v = seg.map(r => r[f]).filter(Number.isFinite); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : NaN; };
        const row = { experiment: id, condition: c, seed: +seed, block: b, phase: seg[0].phase };
        for (const f of fields) row[f] = avg(f);
        curveCsv.push(row);
      }
    }
  }
  writeCsv("curves_" + id + ".csv", curveCsv);
}

// E9 sensory×motor correlation diagnostic (preregistered, per-seed Pearson r)
{
  push("## E9 · sensory–motor correlation diagnostic (preregistered)");
  const rows = E.E9.filter(r => r.condition === "demon_neural" &&
    Number.isFinite(r.sensoryActivity) && Number.isFinite(r.motorActivity));
  const bySeed = {};
  for (const r of rows) (bySeed[r.seed] = bySeed[r.seed] || []).push(r);
  const pearson = (x, y) => {
    const mx = stats.mean(x), my = stats.mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
  };
  const perSeed = Object.entries(bySeed).map(([seed, list]) => ({ seed: +seed,
    r: pearson(list.map(r => r.sensoryActivity), list.map(r => r.motorActivity)) })).filter(x => Number.isFinite(x.r));
  const ci = meanCI(perSeed.map(x => x.r));
  push("");
  push("- per-seed Pearson r(sensoryActivity, motorActivity), test+train episodes pooled per seed: mean " + fmt(ci.mean, 3) + " ± " + fmt(ci.ci, 3) + " (n=" + perSeed.length + " seeds)");
  RESULTS.experiments.E9 = RESULTS.experiments.E9 || {};
  RESULTS.experiments.E9.sensoryMotorCorrelation = { per_seed: perSeed, mean: ci.mean, ci: ci.ci };
  push("");
}

// =====================================================================
// Thermodynamic ledger (test phase, pooled)
// =====================================================================
push("## Thermodynamic ledger summary (test phase)");
push("");
push("| experiment | condition | workIn J/trial | extractable J/trial | erasureCost J/trial | bits used | bits needed |");
push("|---|---|---|---|---|---|---|");
const LEDGER = [];
const kBLn2 = 1.38e-23 * 300 * Math.LN2;
for (const [id, conds] of Object.entries(doorExp)) {
  for (const c of conds) {
    const t = RESULTS.experiments[id] && RESULTS.experiments[id].conditions && RESULTS.experiments[id].conditions[c];
    if (!t || !t.extractableJ || !t.extractableJ.test) continue;
    const win = t.workInJ ? t.workInJ.test.mean : NaN;
    const ext = t.extractableJ.test.mean || 0, lnd = t.erasureCostJ.test.mean || 0, bits = t.measuredBits.test.mean || 0;
    LEDGER.push({ experiment: id, condition: c, workInJ: win, extractableJ: ext, erasureCostJ: lnd, bitsUsed: bits,
                  bitsNeeded: ext / kBLn2, landauerRatio: t.landauerRatio && t.landauerRatio.test ? t.landauerRatio.test.mean : null });
    push("| " + id + " | " + c + " | " + sci(win) + " | " + sci(ext) + " | " + sci(lnd) + " | " + fmt(bits, 0) + " | " + Math.round(ext / kBLn2).toLocaleString("en-US") + " |");
  }
}
RESULTS.thermoLedger = LEDGER;
push("");
push("**Reading:** bits_needed = extractable work priced in Landauer bits at 300 K. bits_used ≪ bits_needed ⇒ the observed sorting is **jet-subsidized, not information-driven** in this implementation. Efficiency = extractable/work_in ≈ 1e-5 ≪ 1: no second-law challenge. E3-drosophila and E6-never_gate report 0 metered bits because the closed door makes no crossing evaluations (the same closed-door policy); their ΔH under the jet equals the never-gate subsidy.");
push("");

fs.writeFileSync(path.join(ANA, "ANALYSIS_RESULTS.json"), JSON.stringify(RESULTS, null, 1));
fs.writeFileSync(path.join(ANA, "STATISTICS_REPORT.md"), report.join("\n") + "\n");
console.log("\nwrote analysis/ANALYSIS_RESULTS.json and analysis/STATISTICS_REPORT.md");
