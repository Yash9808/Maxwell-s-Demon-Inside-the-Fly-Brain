"use strict";
/*
 * Rebuild research_data/e9_training_sweep.csv from e9_training_sweep_raw.csv
 * using the corrected writer (variant column = config ID, e.g. L96_R2_slow).
 * The sweep process that produced the current file was started before the
 * writer fix, so its in-memory code wrote the condition name into `variant`.
 *
 * Validation: every (config, condition, phase, episode) row present in BOTH
 * files must agree on reward_mean/sd (<=1e-4) and CI bounds (<=1e-3); the
 * rebuild otherwise aborts and leaves the original file untouched.
 *
 * CI method: mean ± t(0.975, df)·sd/√n, df = n_seeds − 1 (same as the sweep;
 * df=19 constant cross-checked against the sweep's verified tcrit 2.0930).
 */
const fs = require("fs");
const path = require("path");
const DIR = path.join(__dirname, "research_data");
const rawPath = path.join(DIR, "e9_training_sweep_raw.csv");
const outPath = path.join(DIR, "e9_training_sweep.csv");
const prevPath = path.join(DIR, "e9_training_sweep_prev_variantcol.csv");

const TCRIT = { 19: 2.093024013 };
const nf = (v, d) => (v === null || !Number.isFinite(v)) ? "" : v.toFixed(d);

// ---- load raw -----------------------------------------------------------------
const rawLines = fs.readFileSync(rawPath, "utf8").split("\n").filter(Boolean);
const rawHead = rawLines[0].split(",");
const raw = rawLines.slice(1).map(l => {
  const cells = l.split(","), r = {};
  rawHead.forEach((h, i) => { r[h] = cells[i]; });
  return r;
});
console.log(`raw rows: ${raw.length}`);

// sanity: every config must have the same seed set
const seedsByCfg = {};
for (const r of raw) (seedsByCfg[r.config] = seedsByCfg[r.config] || new Set()).add(r.seed);
const seedSets = Object.values(seedsByCfg).map(s => [...s].sort((a, b) => a - b).join("|"));
if (new Set(seedSets).size !== 1) throw new Error("seed sets differ across configs: " + JSON.stringify(seedsByCfg));
const N = seedSets[0].split("|").length;
const df = N - 1;
if (!(df in TCRIT)) throw new Error(`no tcrit for df=${df}; extend TCRIT table`);
const T = TCRIT[df];
console.log(`seeds per config: ${N} (df=${df}, tcrit=${T})`);

// ---- aggregate: group by config|condition|phase|trial ---------------------------
const groups = new Map();
for (const r of raw) {
  const key = `${r.config}|${r.condition}|${r.phase}|${r.trial}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
const FIELDS = [
  ["reward", "reward", 4], ["decisionAccuracy", "accuracy", 4], ["workJEp", "work", 15],
  ["demonAgree", "demon_agree", 4], ["dPfinal", "delta_p", 6], ["spikeRate", "spike_rate", 4],
  ["dopamineMean", "dopamine", 4], ["weightDrift", "weight_drift", 8],
  ["sensorDecisionBits", "decision_bits", 2],
];
function stats(vals) {
  const n = vals.length, mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1)) : 0;
  const se = sd / Math.sqrt(n);
  return { n, mean, sd, se, ci95_low: mean - T * se, ci95_high: mean + T * se };
}
const pts = [];
for (const [key, rs] of groups) {
  const [config, condition, phase, trial] = key.split("|");
  // per-seed means, then cross-seed stats (seed = independent replicate)
  const bySeed = new Map();
  for (const r of rs) {
    const s = r.seed;
    if (!bySeed.has(s)) bySeed.set(s, []);
    bySeed.get(s).push(r);
  }
  const statsOut = {};
  for (const [field, name] of FIELDS) {
    const perSeed = [...bySeed.values()].map(rows => {
      const xs = rows.map(r => parseFloat(r[field])).filter(Number.isFinite);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
    }).filter(Number.isFinite);
    statsOut[name] = perSeed.length ? stats(perSeed) : null;
  }
  pts.push({
    config, condition, phase, episode: parseInt(trial, 10),
    rewardRegime: rs[0].rewardRegime, decisionCadence: rs[0].decisionCadence,
    trainingLength: parseInt(rs[0].trainingLength, 10), stats: statsOut,
  });
}
pts.sort((a, b) => a.config.localeCompare(b.config) || a.condition.localeCompare(b.condition) ||
  a.episode - b.episode || a.phase.localeCompare(b.phase));

// ---- emit CSV (corrected schema) ------------------------------------------------
const head = ["experiment", "variant", "condition", "reward_regime", "decision_cadence",
  "training_length", "episode", "phase", "n_seeds"];
const cols = [...head];
for (const [, name] of FIELDS) for (const s of ["mean", "sd", "se", "ci95_low", "ci95_high"])
  cols.push(`${name}_${s}`);
const lines = [cols.join(",")];
for (const p of pts) {
  const dec = Object.fromEntries(FIELDS.map(([, name, d]) => [name, d]));
  const row = ["e9", p.config, p.condition, p.rewardRegime, p.decisionCadence,
    p.trainingLength, p.episode, p.phase, p.stats.reward ? p.stats.reward.n : 0];
  for (const [, name] of FIELDS) {
    const st = p.stats[name];
    row.push(st ? nf(st.mean, dec[name]) : "", st ? nf(st.sd, 6) : "", st ? nf(st.se, 6) : "",
      st ? nf(st.ci95_low, 6) : "", st ? nf(st.ci95_high, 6) : "");
  }
  lines.push(row.join(","));
}
const newCsv = lines.join("\n") + "\n";

// ---- validate against the previous file ----------------------------------------
const prevLines = fs.readFileSync(outPath, "utf8").split("\n").filter(Boolean);
const prevHead = prevLines[0].split(",");
const prev = new Map();
for (const l of prevLines.slice(1)) {
  const c = l.split(","), r = {};
  prevHead.forEach((h, i) => { r[h] = c[i]; });
  prev.set(`${r.reward_regime}|${r.decision_cadence}|${r.training_length}|${r.condition}|${r.phase}|${r.episode}`, r);
}
let checked = 0, bad = 0;
for (const p of pts) {
  const k = `${p.rewardRegime}|${p.decisionCadence}|${p.trainingLength}|${p.condition}|${p.phase}|${p.episode}`;
  const o = prev.get(k);
  if (!o) continue;
  for (const [field, name] of FIELDS) {
    const st = p.stats[name];
    if (!st || o[`${name}_mean`] === "") continue;
    checked++;
    if (Math.abs(st.mean - parseFloat(o[`${name}_mean`])) > 1e-4 ||
        Math.abs(st.sd - parseFloat(o[`${name}_sd`])) > 1e-4 ||
        Math.abs(st.ci95_low - parseFloat(o[`${name}_ci95_low`])) > 1e-3 ||
        Math.abs(st.ci95_high - parseFloat(o[`${name}_ci95_high`])) > 1e-3) {
      bad++;
      if (bad <= 5) console.error(`MISMATCH ${k} ${name}: new mean ${st.mean} vs ${o[`${name}_mean`]}`);
    }
  }
}
console.log(`validation: ${checked} stat groups checked, ${bad} mismatches`);
if (bad > 0) { console.error("ABORT — original file untouched"); process.exit(1); }

fs.copyFileSync(outPath, prevPath);
fs.writeFileSync(outPath, newCsv);
console.log(`wrote ${outPath} (${pts.length} aggregate points); previous file kept as ${path.basename(prevPath)}`);
