#!/usr/bin/env node
/*
 * Stage-2 confirmatory analysis (protocol §9, PRE_REGISTRATION_STAGE2.json estimand).
 *
 * - Endpoint: per (arm, pair) deltaSortEntropy_post_minus_pre, taken from the
 *   FINALIZED merged manifest's aggregation.perArmDeltaSortEntropy.perPair arrays
 *   (order = seed-table pair order, pairs 1..800; verified below).
 * - Contrasts: A−D (primary), A−B, A−C (secondary), two-sided α = 0.05,
 *   Holm-corrected within Stage 2 (family size 3).
 * - Permutation reference: the 100,000-resample sign-flip reference DRAWN AT
 *   PREREGISTRATION is re-derived here byte-for-byte (same stream, same order,
 *   same stratum-major bit layout) and its sha256 checked against the prereg —
 *   if any byte diverges the analysis prints an error and refuses.
 * - p-values: two-sided sign-flip permutation of the per-pair paired differences,
 *   added-in (≥) rule including the observed mean.
 * - Dispersion: sample SD, ddof = 1, over per-pair paired differences (pilot §2).
 *
 * Usage: node tools/stage2_analyze.js [--manifest <merged_manifest.json>]
 * Writes: research_data/stage2_analysis/stage2_analysis.json + .txt and prints a table.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

process.chdir(path.join(__dirname, ".."));
const ROOT = process.cwd();

const CORE = require(path.join(ROOT, "experiment_core.js"));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "stage2_config.json"), "utf8"));
const prereg = JSON.parse(fs.readFileSync(path.join(ROOT, "PRE_REGISTRATION_STAGE2.json"), "utf8"));

// ------------------------------------------------------------- pin checks
const CONTRASTS = ["A-D", "A-B", "A-C"];
if (!prereg.estimand || prereg.estimand.primary_contrast !== "A - D") throw new Error("prereg estimand mismatch");
// manifest: default = newest finalized merged manifest
let manifestPath = null;
const argIdx = process.argv.indexOf("--manifest");
if (argIdx > 0) manifestPath = path.resolve(process.argv[argIdx + 1]);
else {
  const dir = path.join(ROOT, "research_data", "stage2_runs");
  const cands = fs.readdirSync(dir).filter(f => f.startsWith("stage2_merged_manifest_") && f.endsWith(".json"));
  manifestPath = path.join(dir, cands.sort().pop());
}
const merged = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (merged.jobsTotal !== 1776 || merged.jobsDone !== 1776 || merged.jobsFailed !== 0)
  throw new Error(`refusing to analyze: manifest says ${merged.jobsDone}/${merged.jobsTotal} jobs, ${merged.jobsFailed} failed`);

// ------------------------------------------------------------- re-derive the permutation reference (byte-exact)
const PREFER = prereg.randomization.permutation_reference_drawn_here;
const MASTER_SEED = PREFER.seed;
const RESAMPLES = PREFER.resamples;
const STRATA = PREFER.strata;
const PER_STRATUM = PREFER.pairs_per_stratum;
if (JSON.stringify(PREFER.contrasts_in_order) !== JSON.stringify(CONTRASTS)) throw new Error("prereg contrast order mismatch");
const perContrast = {};
for (const name of CONTRASTS) {
  const rng = CORE.makeRng(MASTER_SEED);           // fresh stream per contrast, fixed order — as registered
  const h = crypto.createHash("sha256");
  h.update(`stage2-permutation-reference|${name}|seed=${MASTER_SEED}|resamples=${RESAMPLES}|strata=${STRATA}|per=${PER_STRATUM}|order=stratum-major\n`);
  const bits = Buffer.alloc(Math.ceil((STRATA * PER_STRATUM) / 8));
  const refs = [];                                  // store sign masks to reuse for p-values
  for (let r = 0; r < RESAMPLES; r++) {
    const sign = new Int8Array(STRATA * PER_STRATUM);
    bits.fill(0);
    for (let s = 0; s < STRATA; s++)
      for (let j = 0; j < PER_STRATUM; j++) {
        const idx = s * PER_STRATUM + j;
        const bit = rng() < 0.5;
        if (bit) bits[idx >> 3] |= 1 << (idx & 7);
        sign[idx] = bit ? 1 : -1;
      }
    h.update(bits);
    refs.push(sign);
  }
  perContrast[name] = { sha256: h.digest("hex"), refs };
}
for (const name of CONTRASTS) {
  const got = perContrast[name].sha256, want = PREFER.per_contrast_sha256[name].sha256;
  if (got !== want) throw new Error(`permutation reference hash mismatch for ${name}: re-derived ${got}, prereg says ${want}`);
}
console.log(`permutation reference re-derived and matched for all 3 contrasts (${RESAMPLES} sign masks each)`);

// ------------------------------------------------------------- per-pair deltas from the finalized manifest
const agg = merged.aggregation.perArmDeltaSortEntropy;
const armOf = (suffix) => Object.keys(agg).find(k => suffix === "A" ? k.startsWith("armA_")
  : suffix === "B" ? k.startsWith("armB_") : suffix === "C" ? k.startsWith("armC_") : k.startsWith("armD_") && !k.includes("noop"));
const N = cfg.seedTable.pairs.length;
const delta = {};
for (const a of ["A", "B", "C", "D"]) {
  const k = armOf(a);
  if (!k) throw new Error(`arm ${a} missing from aggregated manifest`);
  const arr = agg[k].perPair;
  if (!Array.isArray(arr) || arr.length !== N) throw new Error(`arm ${a} perPair length ${arr ? arr.length : "none"} != ${N}`);
  if (arr.some(v => !isFinite(v))) throw new Error(`arm ${a} has a non-finite per-pair delta`);
  delta[a] = arr;
}

// ------------------------------------------------------------- contrasts, stats, p-values, Holm
const results = {};
for (const name of CONTRASTS) {
  const [a1, a2] = name.split("-");
  const d = new Float64Array(N);                    // paired differences per pair
  for (let i = 0; i < N; i++) d[i] = delta[a1][i] - delta[a2][i];
  let mean = 0; for (let i = 0; i < N; i++) mean += d[i]; mean /= N;
  let ss = 0; for (let i = 0; i < N; i++) { const e = d[i] - mean; ss += e * e; }
  const sd = Math.sqrt(ss / (N - 1));               // ddof = 1, prereg dispersion rule
  // observed statistic mapped into the reference's sign space: mean of ±d[k]
  const obs = mean;
  // permutation p: |mean(sign∘d)| >= |obs|, added-in rule (count ≥ includes exact equality)
  let ge = 0;
  for (let r = 0; r < RESAMPLES; r++) {
    const sign = perContrast[name].refs[r];
    let m = 0; for (let i = 0; i < N; i++) m += sign[i] * d[i];
    if (Math.abs(m / N) >= Math.abs(obs) - 1e-15) ge++;
  }
  // prereg formula: p = (1 + #{replicas with |stat| >= |obs|}) / (1 + resamples)
  results[name] = {
    a1, a2, n_pairs: N,
    pairedDiff: { mean, sd, se: sd / Math.sqrt(N) },
    stdEffect: sd ? mean / sd : NaN,
    observed_mean: mean,
    perm_p_twoSided: (ge + 1) / (RESAMPLES + 1),
    perm_ge: ge,
    perm_resamples: RESAMPLES
  };
}
// Holm (family of 3, two-sided)
const order = CONTRASTS.slice().sort((x, y) => results[x].perm_p_twoSided - results[y].perm_p_twoSided);
let cum = 0;
const holm = {};
order.forEach((nm, i) => {
  const adj = Math.min(1, Math.max(cum, (results[nm].perm_p_twoSided) * (CONTRASTS.length - i)));
  cum = Math.max(cum, adj);
  holm[nm] = adj;
  results[nm].holm_p = adj;
  results[nm].holm_reject = adj < 0.05;
});

// floor arm E (reference only, not a confirmatory contrast)
const eKey = Object.keys(agg).find(k => k.startsWith("armE_"));
const floorDesc = eKey ? { arm: eKey, n: agg[eKey].n, mean: agg[eKey].mean, sd: agg[eKey].sd }
  : { note: "no floor arm in aggregated manifest" };

// ------------------------------------------------------------- report
const txt = [];
txt.push(`Stage-2 confirmatory analysis — ${new Date().toISOString()}`);
txt.push(`manifest: ${path.relative(ROOT, manifestPath)} (jobs ${merged.jobsDone}/${merged.jobsTotal}, failed ${merged.jobsFailed})`);
txt.push(`permutation reference: re-derived and MATCHED against the prereg (seed ${MASTER_SEED}, ${RESAMPLES} resamples, ${STRATA}x${PER_STRATUM} stratum-major sign masks)`);
txt.push(`endpoint: deltaSortEntropy_post_minus_pre; N = ${N} pairs; dispersion = sample SD ddof 1`);
txt.push("");
txt.push("contrast | paired mean ± SD | std effect | two-sided perm p | Holm p | reject @0.05");
for (const nm of CONTRASTS) {
  const r = results[nm];
  txt.push(`${(r.a1 + " − " + r.a2).padEnd(9)} | ${r.observed_mean >= 0 ? "+" : ""}${r.observed_mean.toFixed(6)} ± ${r.pairedDiff.sd.toFixed(6)} | ${r.stdEffect.toFixed(4)} | ${r.perm_p_twoSided.toFixed(6)} | ${r.holm_p.toFixed(6)} | ${r.holm_reject ? "YES" : "no"}`);
}
txt.push("");
txt.push(`floor reference (not a contrast): ${JSON.stringify(floorDesc)}`);
txt.push("A−D is the primary; A−B, A−C secondary; Holm within Stage 2 (§9). Standardized effect = mean paired diff / SD (ddof 1).");

const report = {
  analyzed_utc: new Date().toISOString(),
  manifest: path.relative(ROOT, manifestPath),
  permutation_reference: { seed: MASTER_SEED, resamples: RESAMPLES, strata: STRATA, pairs_per_stratum: PER_STRATUM,
    re_derived_sha256: { A_minus_D: perContrast["A-D"].sha256, A_minus_B: perContrast["A-B"].sha256, A_minus_C: perContrast["A-C"].sha256 },
    matched_prereg: true },
  masterSeed: MASTER_SEED,
  resamples: RESAMPLES,
  strata: { nEnvironment: STRATA, nNetwork: PER_STRATUM },
  n_pairs: N,
  contrasts: results,
  holm_family: CONTRASTS,
  floor_reference: floorDesc
};
const outDir = path.join(ROOT, "research_data", "stage2_analysis");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "stage2_analysis.json"), JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(path.join(outDir, "stage2_analysis.txt"), txt.join("\n") + "\n");
console.log(txt.join("\n"));
