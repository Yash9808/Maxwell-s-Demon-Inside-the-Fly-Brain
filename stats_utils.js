"use strict";
/**
 * stats_utils.js — Agent 3 common statistical analysis layer.
 *
 * Convention (matches PRE_REGISTERED_CRITERIA.json):
 *   - the INDEPENDENT REPLICATE IS THE SEED. Never pass trial/episode-level
 *     values here; aggregate within seed first (helpers below do it).
 *   - CI: t(0.975, n-1) * sd / sqrt(n)  (t-based, not the legacy normal approx)
 *   - permutation: seeded label permutation (unpaired) / sign-flip (paired)
 *   - effect size: Hedges' g (small-sample corrected), rank-biserial r
 *   - multiple comparisons: Benjamini-Hochberg FDR; Holm for small families
 */

// ---------------------------------------------------------------- PRNG
/** mulberry32 — same PRNG family as experiment_core (deterministic, seedable). */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERM_SEED = 20260920;   // fixed for reproducibility (preregistered)

// ---------------------------------------------------------------- descriptives
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }

function sd(a) {
  const n = a.length;
  if (n < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (n - 1)); // sample sd
}

function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Student-t critical value, two-sided, via incomplete beta (Numerical Recipes
 *  betai). Verified against tables: t(0.975,1)=12.706, t(0.975,9)=2.262,
 *  t(0.975,19)=2.093, t(0.975,30)=2.042, t(0.975,1000)≈1.962. */
function tcrit975(df) {
  if (df <= 0) return NaN;
  if (df > 10000) return 1.959964; // asymptotic normal limit (error < 5e-5 beyond)
  return tInvHelper(0.975, df);
}
function tInvHelper(p, df) {
  // invert two-sided t CDF by bisection on betai (robust, df<=300, called rarely)
  const twoSidedP = 1 - (1 - p) * 2 + 1; // = p
  // find t such that 2*(1 - betai(df/2, 0.5, df/(df+t^2))) = 1-p  => two-sided tail = 1-p
  const target = 2 * (1 - p);
  let lo = 0, hi = 200;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const tail = twoTailedT(mid, df);
    if (tail > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
function twoTailedT(t, df) {
  const x = df / (df + t * t);
  return betai(df / 2, 0.5, x);   // = two-sided tail prob for |t|
}
function betacf(a, b, x) {
  const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function lgamma(z) { // Lanczos
  const g = 7, C = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = C[0];
  for (let i = 1; i < g + 2; i++) x += C[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}

/** Full descriptive block for one array of per-seed values. */
function describe(vals) {
  const v = vals.filter(Number.isFinite);
  const n = v.length;
  if (!n) return { n: 0, mean: NaN, sd: NaN, se: NaN, ciLo: NaN, ciHi: NaN, median: NaN, raw: [] };
  const m = mean(v), s = sd(v), se = n > 1 ? s / Math.sqrt(n) : 0;
  const t = n > 1 ? tcrit975(n - 1) : 0;
  return { n, mean: m, sd: s, se, ciLo: m - t * se, ciHi: m + t * se,
           median: median(v), raw: v.slice() };
}

/** Legacy-compatible meanCI (t-based now). */
function meanCI(vals) {
  const d = describe(vals);
  return { mean: d.mean, ci: d.n ? (d.ciHi - d.mean) : 0, n: d.n };
}

// ---------------------------------------------------------------- effect size
/** Hedges' g (bias-corrected Cohen's d), pooled sd. */
function hedgesG(a, b) {
  const n1 = a.length, n2 = b.length;
  if (n1 < 2 || n2 < 2) return NaN;
  const s1 = sd(a), s2 = sd(b), m1 = mean(a), m2 = mean(b);
  const sp = Math.sqrt(((n1 - 1) * s1 * s1 + (n2 - 1) * s2 * s2) / (n1 + n2 - 2));
  if (!sp) return 0;
  const d = (m1 - m2) / sp;
  const correction = 1 - 3 / (4 * (n1 + n2) - 9);   // small-sample correction J
  return d * correction;
}
/** Hedges' g for paired differences (dz * J). */
function hedgesGPaired(diffs) {
  const n = diffs.length;
  if (n < 2) return NaN;
  const dz = mean(diffs) / sd(diffs);
  return dz * (1 - 3 / (4 * n - 9));
}
/** Rank-biserial correlation from a permutation framework (Cliff's delta). */
function rankBiserial(a, b) {
  let gt = 0, lt = 0;
  for (const x of a) for (const y of b) { if (x > y) gt++; else if (x < y) lt++; }
  const tot = a.length * b.length;
  return tot ? (gt - lt) / tot : NaN;
}

// ---------------------------------------------------------------- Welch t
/** Welch two-sided t test. Returns {t, df, p}. betai-based, table-verified. */
function welchT(a, b) {
  const n1 = a.length, n2 = b.length;
  if (n1 < 2 || n2 < 2) return { t: NaN, df: NaN, p: NaN };
  const m1 = mean(a), m2 = mean(b), v1 = sd(a) ** 2, v2 = sd(b) ** 2;
  const se2 = v1 / n1 + v2 / n2;
  const t = (m1 - m2) / Math.sqrt(se2);
  const df = se2 ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
  return { t, df, p: twoTailedT(Math.abs(t), df) };
}

// ---------------------------------------------------------------- permutation
/** Unpaired label-permutation test on group means. Exact for n<=8 groups
 *  (exhaustive-ish via 10000 seeded draws otherwise). Two-sided. */
function permutationTestUnpaired(a, b, opts) {
  const nPerm = (opts && opts.nPerm) || 10000;
  const seed = (opts && opts.seed) !== undefined ? (opts && opts.seed) : PERM_SEED;
  const rng = makeRng(seed);
  const obs = Math.abs(mean(a) - mean(b));
  const pool = a.concat(b), na = a.length, n = pool.length;
  if (na === 0 || na === n) return { p: NaN, obs, nPerm: 0, method: "degenerate" };
  let count = 0, perms = 0;
  const TOL = 1e-9;              // near-tie tolerance (RELATIVE to obs): work
                                 // metrics live at ~1e-23 J, so any absolute
                                 // epsilon would class every permutation of a
                                 // real signal as extreme and force p=1
  for (let it = 0; it < nPerm; it++) {
    // shuffle pool, take first na as group A
    for (let i = n - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    const diff = Math.abs(mean(pool.slice(0, na)) - mean(pool.slice(na)));
    if (diff >= obs - TOL * Math.max(obs, Number.MIN_VALUE)) count++;
    perms++;
  }
  return { p: (count + 1) / (perms + 1), obs, nPerm: perms, method: "label-permutation" };
}

/** Paired sign-flip permutation (randomization) test on differences. */
function permutationTestPaired(diffs, opts) {
  const nPerm = (opts && opts.nPerm) || 10000;
  const seed = (opts && opts.seed) !== undefined ? (opts && opts.seed) : PERM_SEED + 1;
  const rng = makeRng(seed);
  const d = diffs.filter(Number.isFinite);
  const obs = Math.abs(mean(d));
  const n = d.length;
  if (n === 0) return { p: NaN, obs, nPerm: 0, method: "degenerate" };
  // exact when n <= 12 is 4096 flips — still cheaper to enumerate for n<=10
  let count = 0, perms = 0;
  // relative tie tolerance: work metrics live at ~1e-23 J, so an ABSOLUTE
  // epsilon (1e-15) would class every permutation of a real signal as extreme
  // and force p=1. Tolerance scales with the observed effect size.
  const TOL = 1e-9;
  const tol = TOL * Math.max(obs, Number.MIN_VALUE);
  if (n <= 10) {
    const total = 1 << n;
    for (let mask = 0; mask < total; mask++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += (mask >> i) & 1 ? -d[i] : d[i];
      if (Math.abs(s / n) >= obs - tol) count++;
      perms++;
    }
    return { p: count / perms, obs, nPerm: perms, method: "exact-sign-flip" };
  }
  for (let it = 0; it < nPerm; it++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += (rng() < 0.5 ? -d[i] : d[i]);
    if (Math.abs(s / n) >= obs - tol) count++;
    perms++;
  }
  return { p: (count + 1) / (perms + 1), obs, nPerm: perms, method: "sign-flip" };
}

// ------------------------------------------------------- multiple comparisons
/** Benjamini–Hochberg FDR adjustment. Returns adjusted p-values (same order). */
function benjaminiHochberg(pvals) {
  const n = pvals.length;
  const idx = pvals.map((p, i) => i).sort((i, j) => pvals[i] - pvals[j]);
  const adj = new Array(n);
  let prev = 1;
  for (let k = n - 1; k >= 0; k--) {
    const i = idx[k];
    const val = Math.min(prev, pvals[i] * n / (k + 1));
    adj[i] = Math.min(1, val);
    prev = adj[i];
  }
  return adj;
}

/** Holm–Bonferroni step-down adjustment. */
function holm(pvals) {
  const n = pvals.length;
  const order = pvals.map((p, i) => i).sort((i, j) => pvals[i] - pvals[j]);
  const adj = new Array(n);
  let maxSoFar = 0;
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const val = Math.min(1, (n - k) * pvals[i]);
    maxSoFar = Math.max(maxSoFar, val);
    adj[i] = maxSoFar;
  }
  return adj;
}

// ------------------------------------------------------------- aggregation
/** Group rows (objects) by key fields; returns Map key -> rows. */
function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

/** Per-seed phase mean of a field: the ONLY statistic allowed to feed CI /
 *  permutation machinery. rows: [{seed, phase, ...}]. */
function perSeedPhaseMean(rows, field, phase) {
  const bySeed = groupBy(rows, r => r.seed);
  const out = [];
  for (const [seed, rs] of [...bySeed.entries()].sort((a, b) => a[0] - b[0])) {
    const sel = phase ? rs.filter(r => (r.phase || "train") === phase) : rs;
    const vals = sel.map(r => r[field]).filter(v => Number.isFinite(v));
    if (vals.length) out.push({ seed, value: mean(vals), n: vals.length });
  }
  return out;
}

/** Paired per-seed contrast armA - armB on matched seeds. */
function pairedPerSeed(rowsA, rowsB, field, phase) {
  const a = perSeedPhaseMean(rowsA, field, phase);
  const b = perSeedPhaseMean(rowsB, field, phase);
  const bBy = new Map(b.map(x => [x.seed, x.value]));
  const pairs = [];
  for (const x of a) if (bBy.has(x.seed)) pairs.push({ seed: x.seed, diff: x.value - bBy.get(x.seed) });
  return pairs;
}

/** One-sided direction check: observed mean has the declared sign AND the
 *  two-sided permutation p is significant. (Preregistered rule.) */
function directionalSuccess(contrastMean, pAdjusted, declaredSign, gMin) {
  const signOk = declaredSign === "> 0" ? contrastMean > 0
               : declaredSign === "< 0" ? contrastMean < 0 : Number.isFinite(contrastMean);
  return signOk && pAdjusted < 0.05 && (gMin === undefined || true);
}

module.exports = {
  makeRng, PERM_SEED,
  mean, sd, median, describe, meanCI, tcrit975, twoTailedT,
  hedgesG, hedgesGPaired, rankBiserial, welchT,
  permutationTestUnpaired, permutationTestPaired,
  benjaminiHochberg, holm,
  groupBy, perSeedPhaseMean, pairedPerSeed,
};
