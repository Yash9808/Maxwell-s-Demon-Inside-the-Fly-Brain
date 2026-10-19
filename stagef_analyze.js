"use strict";
/**
 * stagef_analyze.js — preregistered analysis for PRE_REGISTRATION_STAGE_F_E4.json.
 *
 * Statistics come ONLY from stats_utils.js (same PERM_SEED 20260920, Hedges g,
 * BH) — no locally defined test. Inputs: research_data/validation/stage_f/
 * raw_e4_stagef.csv. Outputs: STAGE_F_E4_ANALYSIS.json (same dir) + console
 * summary. The whole analysis runs twice from independently re-parsed data;
 * any difference voids determinism (reported, never hidden).
 *
 * Analysis-time convention (disclosed): the prereg inherited the original E4
 * secondary "4A learning gain (late - early train, paired)" without pinning
 * the split. The convention applied here — fixed before running this script:
 * early = train trials [0,60), late = train trials [60,120) (midpoint split).
 */
const fs = require("fs");
const path = require("path");
const SU = require("./stats_utils.js");

const DIR = path.join(__dirname, "research_data", "validation", "stage_f");
const RAW = path.join(DIR, "raw_e4_stagef.csv");

function parseCsv(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  const cols = lines[0].split(",");
  return lines.slice(1).map(l => {
    const vals = l.split(","), r = {};
    cols.forEach((c, i) => { r[c] = vals[i]; });
    return r;
  });
}

function analyze() {
  const data = parseCsv(RAW).map(r => ({
    condition: r.condition,
    shuffleSeed: r.shuffleSeed === "" ? null : Number(r.shuffleSeed),
    seed: Number(r.seed),
    phase: r.phase,
    trial: Number(r.trial),
    goodBadRatio: Number(r.goodBadRatio),
    dTfinal: Number(r.dTfinal),
    sortEntropy: Number(r.sortEntropy),
    miNeural: Number(r.miNeural),
  }));

  // ---- coverage check (no missing cells, no silently dropped seeds)
  const cov = {};
  for (const r of data) {
    const key = `${r.condition}|${r.shuffleSeed === null ? "-" : r.shuffleSeed}|${r.seed}`;
    cov[key] = (cov[key] || 0) + 1;
  }
  const bad = Object.entries(cov).filter(([k, n]) => n < 144);
  const nSeedsA = new Set(data.filter(r => r.condition === "connectome_4A").map(r => r.seed)).size;
  const nDrawsC = new Set(data.filter(r => r.condition === "connectome_4C").map(r => r.shuffleSeed)).size;

  const test = cond => data.filter(r => r.condition === cond && r.phase === "test");
  const train = cond => data.filter(r => r.condition === cond && r.phase === "train");

  // ---- 4C: per-field shuffle-draw means (the preregistered 4C unit)
  const cRows = test("connectome_4C");
  const drawOrder = [...SU.groupBy(cRows, r => r.shuffleSeed).entries()]
    .sort((a, b) => a[0] - b[0]);
  const cDrawField = field => drawOrder.map(([ss, rs]) => {
    const perSeed = SU.perSeedPhaseMean(rs, field, null);
    return SU.mean(perSeed.map(x => x.value));
  });
  const drawGroups = drawOrder.map(([ss, rs]) => ({
    shuffleSeed: ss,
    perSeed: SU.perSeedPhaseMean(rs, "goodBadRatio", null),
  }));
  const C = drawGroups.map(g => SU.mean(g.perSeed.map(x => x.value)));

  const A = SU.perSeedPhaseMean(test("connectome_4A"), "goodBadRatio", null).map(x => x.value);
  const B = SU.perSeedPhaseMean(test("connectome_4B"), "goodBadRatio", null).map(x => x.value);
  const F = SU.perSeedPhaseMean(test("connectome_frozen"), "goodBadRatio", null).map(x => x.value);

  // ---- contrasts (every test computed on its own correct field arrays)
  const tests = {};
  const unpaired = (name, a, b) => {
    const perm = SU.permutationTestUnpaired(a, b);
    tests[name] = { meanA: SU.mean(a), meanB: SU.mean(b), nA: a.length, nB: b.length,
      contrast: SU.mean(a) - SU.mean(b), p_raw: perm.p, method: perm.method,
      hedgesG: SU.hedgesG(a, b), ciA: SU.meanCI(a), ciB: SU.meanCI(b) };
  };
  unpaired("primary_4A_vs_4C_shuffleMean", A, C);
  unpaired("secondary_4A_vs_4B", A, B);
  unpaired("secondary_4A_vs_frozen", A, F);
  unpaired("secondary_4A_vs_4C_dTfinal",
    SU.perSeedPhaseMean(test("connectome_4A"), "dTfinal", null).map(x => x.value),
    cDrawField("dTfinal"));
  unpaired("secondary_4A_vs_4C_sortEntropy",
    SU.perSeedPhaseMean(test("connectome_4A"), "sortEntropy", null).map(x => x.value),
    cDrawField("sortEntropy"));
  unpaired("secondary_4A_vs_4C_miNeural",
    SU.perSeedPhaseMean(test("connectome_4A"), "miNeural", null).map(x => x.value),
    cDrawField("miNeural"));

  // paired learning gain (midpoint split, disclosed above)
  const early = [], late = [];
  for (const [seed, rs] of SU.groupBy(train("connectome_4A"), r => r.seed)) {
    const e = rs.filter(r => r.trial < 60).map(r => r.goodBadRatio).filter(Number.isFinite);
    const l = rs.filter(r => r.trial >= 60).map(r => r.goodBadRatio).filter(Number.isFinite);
    if (e.length && l.length) { early.push(SU.mean(e)); late.push(SU.mean(l)); }
  }
  const diffs = late.map((v, i) => v - early[i]);
  const gainPerm = SU.permutationTestPaired(diffs);
  tests.secondary_4A_learning_gain_paired = {
    meanEarly: SU.mean(early), meanLate: SU.mean(late), n: diffs.length,
    contrast: SU.mean(diffs), p_raw: gainPerm.p, method: gainPerm.method,
    hedgesG: SU.hedgesGPaired(diffs),
  };

  // ---- BH family (primary + all secondaries, per prereg)
  const names = Object.keys(tests);
  const pvals = names.map(n => tests[n].p_raw);
  const adj = SU.benjaminiHochberg(pvals);
  names.forEach((n, i) => { tests[n].p_bh = adj[i]; });

  // ---- preregistered decision (primary only)
  const P = tests.primary_4A_vs_4C_shuffleMean;
  const success = P.contrast > 0 && P.p_bh < 0.05 && P.hedgesG >= 0.5;
  const failure = P.contrast <= 0 || P.p_bh >= 0.05;
  const decision = success ? "SUCCESS"
    : failure ? "FAILURE — verbatim: connectome structure contributes no measurable performance at the retinotopic sparse-drive operating point."
    : "INDETERMINATE";

  return {
    preregistration: "PRE_REGISTRATION_STAGE_F_E4.json",
    coverage: { rows: data.length, seeds4A: nSeedsA, shuffleDraws4C: nDrawsC,
      cellsBelow144: bad.length ? bad : "none", expectedRows: 12 * 144 * 3 + 120 * 144 },
    perSeedValues: { "4A": A, "4B": B, "frozen": F,
      "4C_drawMeans": drawGroups.map(g => ({ shuffleSeed: g.shuffleSeed, drawMean: SU.mean(g.perSeed.map(x => x.value)) })) },
    tests, decision,
    primary: { contrast: P.contrast, p_raw: P.p_raw, p_bh: P.p_bh, hedgesG: P.hedgesG,
      successCriterion: "contrast > 0 AND p_bh < 0.05 AND g >= 0.5",
      contrastPos: P.contrast > 0, sigAt05: P.p_bh < 0.05, gAtLeastHalf: P.hedgesG >= 0.5 },
  };
}

const r1 = analyze(), r2 = analyze();
const deterministic = JSON.stringify(r1) === JSON.stringify(r2);
const out = Object.assign({}, r1, { deterministic_rerun: deterministic,
  stats_utils_version_sha16: require("crypto").createHash("sha256").update(fs.readFileSync(path.join(__dirname, "stats_utils.js"))).digest("hex").slice(0, 16) });
fs.writeFileSync(path.join(DIR, "STAGE_F_E4_ANALYSIS.json"), JSON.stringify(out, null, 2));

const P = out.primary;
console.log("=== STAGE F E4 — preregistered analysis ===");
console.log(`coverage: ${JSON.stringify(out.coverage)}`);
for (const [k, t] of Object.entries(out.tests))
  console.log(`${k.padEnd(36)} contrast ${t.contrast.toFixed(4).padStart(8)}  p_raw ${t.p_raw.toFixed(4)}  p_bh ${t.p_bh.toFixed(4)}  g ${t.hedgesG.toFixed(3)}`);
console.log(`primary: contrast>0 ${P.contrastPos} | p_bh<0.05 ${P.sigAt05} | g>=0.5 ${P.gAtLeastHalf}`);
console.log(`DECISION: ${out.decision}`);
console.log(`deterministic_rerun: ${deterministic}`);
