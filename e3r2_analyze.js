"use strict";
/**
 * e3r2_analyze.js — preregistered analysis for the E3R2 campaign.
 * Implements exactly the endpoints in PRE_REGISTERED_CRITERIA_E3R2.json:
 *   P1  R2A_cost − R2A_frozen, paired per-seed TEST mean goodMinusBad
 *   G1  engagement gate (R2A TEST openFraction >= 0.10 AND >=50% episodes
 *       with >=1 crossing)
 *   G2  stability guard (SD R2A <= 3x SD R2A_frozen, per-seed TEST means)
 *   S1  R2B_floor − R2B_frozen (paired)          } BH-FDR q=0.05 across
 *   S2  R2A_cost − vanilla_rerun (paired)        } the secondary family
 *   S3  R2A within-arm late−early train quarter  }
 *   S4  R2A TEST g−b > 0 (one-sided)             }
 *   S5  fraction of R2A seeds with TEST openFraction < 0.02 (report, <=10%)
 * Verdicts: SUCCESS / FAILURE / INCONCLUSIVE exactly per preregistration.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const S = require("./stats_utils");

const DIR = path.join("research_data", "validation");
const RAW = path.join(DIR, "E3R2_RAW.csv");
const N_PERM = 10000;
const TRAIN_N = 300, TEST_N = 60;

function readCsv(p) {
  const lines = fs.readFileSync(p, "utf8").trim().split("\n");
  const h = lines[0].split(",");
  return lines.slice(1).map(l => {
    const c = l.split(","), o = {};
    h.forEach((k, i) => { o[k] = c[i]; });
    return o;
  });
}
const gb = (r) => (+r.goodCrossings) - (+r.badCrossings);

/** Per-seed mean of gb over a trial-index window for one arm/phase. */
function perSeed(rows, arm, phase, from, to) {
  const bySeed = new Map();
  for (const r of rows) {
    if (r.condition !== arm || r.phase !== phase) continue;
    const t = +r.trial;
    if (t < from || t >= to) continue;
    if (!bySeed.has(r.seed)) bySeed.set(r.seed, { sum: 0, n: 0, open: 0, cross: 0 });
    const a = bySeed.get(r.seed);
    a.sum += gb(r); a.n++;
    a.open += +r.openFraction;
    a.cross += (+r.goodCrossings) + (+r.badCrossings);
  }
  const out = new Map();
  for (const [seed, a] of bySeed) {
    out.set(seed, { mean: a.sum / a.n, n: a.n, open: a.open / a.n, cross: a.cross / a.n });
  }
  return out;
}

/** One-sided (greater) sign-flip paired permutation p, seeded. */
function oneSidedGreaterPaired(diffs) {
  const obs = S.mean(diffs);
  const rng = S.makeRng(S.PERM_SEED);
  let count = 0;
  for (let i = 0; i < N_PERM; i++) {
    let acc = 0;
    for (let j = 0; j < diffs.length; j++) acc += (rng() < 0.5 ? 1 : -1) * diffs[j];
    if (acc >= obs - 1e-12) count++;
  }
  return count / N_PERM;
}

function pairedTest(a, b) {
  const seeds = [...a.keys()].filter(k => b.has(k)).sort((x, y) => +x - +y);
  const d = seeds.map(k => a.get(k).mean - b.get(k).mean);
  if (d.length < 3) return { n: d.length, notEvaluable: "fewer than 3 matched seed pairs" };
  const ci = S.describe(d);
  const perm = S.permutationTestPaired(d, { nPerm: N_PERM });
  const g = S.hedgesGPaired(d);
  return {
    n: d.length, meanDiff: ci.mean, sdDiff: ci.sd,
    ciLo: ci.ciLo, ciHi: ci.ciHi, p: perm.p, g,
    a: seeds.map(k => a.get(k).mean), b: seeds.map(k => b.get(k).mean), d,
  };
}

function fmt(t) {
  if (!t || t.notEvaluable) return "NOT_EVALUABLE(" + (t && t.notEvaluable) + ")";
  return `d=${t.meanDiff.toFixed(3)} g=${t.g.toFixed(2)} CI=[${t.ciLo.toFixed(3)},${t.ciHi.toFixed(3)}] p=${(+t.p).toExponential(2)} n=${t.n}`;
}

const rows = readCsv(RAW);
const arms = [...new Set(rows.map(r => r.condition))].sort();
console.log("arms:", arms.join(", "), "| rows:", rows.length);

// ---------------- per-arm seed-level TEST summaries ------------------------
const test = {}, trainQ = {};
for (const arm of arms) {
  test[arm] = perSeed(rows, arm, "test", 0, TEST_N);
  trainQ[arm] = {
    early: perSeed(rows, arm, "train", 0, 75),
    late: perSeed(rows, arm, "train", TRAIN_N - 75, TRAIN_N),
  };
}

console.log("\n== Per-arm TEST-phase seed-level summary (goodMinusBad/episode) ==");
const summaryRows = [["arm","metric","n","mean","sd","se","ciLo","ciHi","median"]];
for (const arm of arms) {
  const vals = [...test[arm].values()].map(v => v.mean);
  const ci = S.describe(vals);
  const op = [...test[arm].values()].map(v => v.open);
  const ciOp = S.describe(op);
  console.log(arm.padEnd(14),
    `n=${ci.n}`, `g-b=${ci.mean.toFixed(3)}±${ci.sd.toFixed(3)}`,
    `CI=[${ci.ciLo.toFixed(3)},${ci.ciHi.toFixed(3)}]`,
    `open=${ciOp.mean.toFixed(3)} [${ciOp.ciLo.toFixed(3)},${ciOp.ciHi.toFixed(3)}]`);
  summaryRows.push([arm, "test_goodMinusBad", ci.n, ci.mean.toFixed(4), ci.sd.toFixed(4), ci.se.toFixed(4), ci.ciLo.toFixed(4), ci.ciHi.toFixed(4), ci.median.toFixed(4)]);
  summaryRows.push([arm, "test_openFraction", ciOp.n, ciOp.mean.toFixed(4), ciOp.sd.toFixed(4), ciOp.se.toFixed(4), ciOp.ciLo.toFixed(4), ciOp.ciHi.toFixed(4), ciOp.median.toFixed(4)]);
}

// ---------------- Gates -----------------------------------------------------
const r2aTest = [...test["R2A_cost"].values()];
const G1_open = S.mean(r2aTest.map(v => v.open)) >= 0.10;
const G1_cross = r2aTest.filter(v => v.cross >= 1).length / r2aTest.length >= 0.50;
const G1 = G1_open && G1_cross;
const sdR2A = S.sd(r2aTest.map(v => v.mean));
const sdFrz = S.sd([...test["R2A_frozen"].values()].map(v => v.mean));
const G2 = sdR2A <= 3 * sdFrz;
console.log(`\nG1 engagement: openOK=${G1_open} crossingsOK=${G1_cross} -> ${G1}`);
console.log(`G2 stability:  sdR2A=${sdR2A.toFixed(3)} vs 3x sdFrozen=${(3*sdFrz).toFixed(3)} -> ${G2}`);

// ---------------- Primary P1 ------------------------------------------------
const P1 = pairedTest(test["R2A_cost"], test["R2A_frozen"]);
console.log("\nP1 (R2A_cost - R2A_frozen, paired):", fmt(P1));

let verdict;
if (!P1.notEvaluable && P1.p < 0.05 && P1.g >= 0.5 && G1) verdict = "SUCCESS";
else if (G1 === false) verdict = "FAILURE (G1 engagement gate failed)";
else {
  // Preregistered falsifiability clause: P1 not successful AND G1 holds
  // => FAILURE ('engagement restored but learning does not exceed the
  //    shaping-only control'), NOT a softer verdict.
  verdict = "FAILURE (engagement restored but learning does not exceed shaping-only control; P1 p="
    + (+P1.p).toFixed(3) + ", g=" + (+P1.g).toFixed(2) + ")";
}
if (!G2 && verdict.startsWith("SUCCESS")) verdict = "FAILURE (G2 stability guard violated)";

// ---------------- Secondaries (BH family) -----------------------------------
const S1 = pairedTest(test["R2B_floor"], test["R2B_frozen"]);
const S2 = pairedTest(test["R2A_cost"], test["vanilla_rerun"]);
const s3a = perSeed(rows, "R2A_cost", "train", TRAIN_N - 75, TRAIN_N);
const S3 = pairedTest(s3a, trainQ["R2A_cost"].early);
// S4: one-sided greater on R2A test values
const r2aVals = r2aTest.map(v => v.mean);
const S4 = { obs: S.mean(r2aVals), pOneSided: oneSidedGreaterPaired(r2aVals), n: r2aVals.length };
const ciS4 = S.describe(r2aVals); S4.ciLo = ciS4.ciLo; S4.ciHi = ciS4.ciHi;
// S5: recurrence of collapse
const S5 = { frac: r2aTest.filter(v => v.open < 0.02).length / r2aTest.length,
             n: r2aTest.length };

const fam = [S1, S2, S3].filter(t => !t.notEvaluable);
const ps = fam.map(t => t.p);
const q = S.benjaminiHochberg(ps);
let qi = 0;
for (const t of fam) t.q = q[qi++];

console.log("\n== Secondary family (BH-FDR q=0.05) ==");
console.log("S1 floor ablation (R2B_floor - R2B_frozen):", fmt(S1), S1.q ? `(q=${S1.q.toFixed(3)})` : "");
console.log("S2 package effect (R2A_cost - vanilla_rerun):", fmt(S2), S2.q ? `(q=${S2.q.toFixed(3)})` : "");
console.log("S3 within-arm late-early (R2A_cost):", fmt(S3), S3.q ? `(q=${S3.q.toFixed(3)})` : "");
console.log(`S4 R2A test g-b>0: obs=${S4.obs.toFixed(3)} one-sided p=${S4.pOneSided.toFixed(4)} CI=[${S4.ciLo.toFixed(3)},${S4.ciHi.toFixed(3)}]`);
console.log(`S5 collapse recurrence: ${S5.frac * 100}% of seeds (n=${S5.n}); criterion <=10% -> ${S5.frac <= 0.10 ? "MET" : "FAILED"}`);

console.log("\n==============================================================");
console.log("E3R2 PRIMARY VERDICT:", verdict);
console.log("==============================================================");

// ---------------- CSV outputs ------------------------------------------------
const q5 = (v) => (typeof v === "number" && Number.isFinite(v)) ? (+v.toFixed(5)) : "";
const csvEsc = (v) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function writeCsv(name, header, rowsOut) {
  const p = path.join(DIR, name);
  fs.writeFileSync(p, [header.join(",")].concat(rowsOut.map(r => r.map(csvEsc).join(","))).join("\n") + "\n");
  console.log("wrote", p);
}

writeCsv("E3R2_SUMMARY.csv", summaryRows[0], summaryRows.slice(1));

const testRows = [
  ["P1","primary","R2A_cost","R2A_frozen","test_goodMinusBad_paired", q5(P1.meanDiff), q5(P1.g), q5(P1.ciLo), q5(P1.ciHi), P1.p ? P1.p.toExponential(4) : "", "", P1.n, verdict, G1, G2],
  ["S1","secondary","R2B_floor","R2B_frozen","test_goodMinusBad_paired", q5(S1.meanDiff), q5(S1.g), q5(S1.ciLo), q5(S1.ciHi), S1.p ? S1.p.toExponential(4) : "", S1.q ? q5(S1.q) : "", S1.n, S1.notEvaluable ? "NOT_EVALUABLE" : (S1.q < 0.05 && S1.meanDiff > 0 ? "PASS" : "NO_EVIDENCE"), "", ""],
  ["S2","secondary","R2A_cost","vanilla_rerun","test_goodMinusBad_paired", q5(S2.meanDiff), q5(S2.g), q5(S2.ciLo), q5(S2.ciHi), S2.p ? S2.p.toExponential(4) : "", S2.q ? q5(S2.q) : "", S2.n, S2.notEvaluable ? "NOT_EVALUABLE" : (S2.q < 0.05 && S2.meanDiff > 0 ? "PASS" : "NO_EVIDENCE"), "", ""],
  ["S3","secondary","R2A_cost(late)","R2A_cost(early)","train_goodMinusBad_paired", q5(S3.meanDiff), q5(S3.g), q5(S3.ciLo), q5(S3.ciHi), S3.p ? S3.p.toExponential(4) : "", S3.q ? q5(S3.q) : "", S3.n, S3.notEvaluable ? "NOT_EVALUABLE" : (S3.q < 0.05 && S3.meanDiff > 0 ? "PASS" : "NO_EVIDENCE"), "", ""],
  ["S4","secondary","R2A_cost","(constant 0)","test_goodMinusBad_oneSided", q5(S4.obs), "", q5(S4.ciLo), q5(S4.ciHi), S4.pOneSided.toFixed(4), "", S4.n, S4.ciLo > 0 ? "PASS" : "NO_EVIDENCE", "", ""],
  ["S5","secondary","R2A_cost","(criterion 0.10)","collapse_recurrence_testOpenFrac<0.02", q5(S5.frac), "", "", "", "", "", S5.n, S5.frac <= 0.10 ? "PASS" : "FAILED", "", ""],
];
writeCsv("E3R2_TESTS.csv",
  ["test","family","armA","armB","metric","meanDiff","hedgesG","ciLo","ciHi","p","qBH","n","verdict","G1","G2"],
  testRows);

const effRows = [];
for (const [name, t] of [["P1",P1],["S1",S1],["S2",S2],["S3",S3]]) {
  if (t.notEvaluable) continue;
  for (let i = 0; i < t.d.length; i++)
    effRows.push([name, i, t.a[i].toFixed(4), t.b[i].toFixed(4), t.d[i].toFixed(4)]);
}
writeCsv("E3R2_EFFECTS.csv", ["contrast","seedIdx","armA_val","armB_val","diff"], effRows);

fs.writeFileSync(path.join(DIR, "E3R2_metadata.json"), JSON.stringify({
  generated: new Date().toISOString(),
  preregistration: "PRE_REGISTERED_CRITERIA_E3R2.json",
  raw: "E3R2_RAW.csv",
  arms, rows: rows.length, seedsPerArm: 20,
  env: { nParticles: 320, noise: 0.12, doorHeight: 64, episodeSeconds: 12, dt: 1/60, trialsTrain: 300, trialsTest: 60 },
  seedRule: "env = 1 + s*101, controller rng = envSeed ^ 0x5f5f (runBenchmark rule, identical to R1)",
  kappa: 0.005, floorP: 0.05,
  primary: { P1, G1, G1_open, G1_cross, G2, sdR2A, sdFrz, verdict },
  secondaries: { S1, S2, S3, S4, S5 },
}, null, 2));
console.log("wrote", path.join(DIR, "E3R2_metadata.json"));
