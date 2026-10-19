#!/usr/bin/env node
/**
 * stage2_dryrun_verify.js — checks the Stage-2 pre-flight dry run (protocol §6d/§9,
 * launch step 2). Reads only; writes nothing; exit 0 = every check passed.
 *
 *   node tools/stage2_dryrun_verify.js <serialDir> <parallelDir> <smokeConfig> <realConfig>
 *
 * Checks, in order:
 *   1. every job in the parallel run produced a DONE receipt with gzip retention
 *      whose round trip the runner already verified;
 *   2. the retained rows are BYTE-IDENTICAL between the serial and parallel runs
 *      (after gunzip) for every job;
 *   3. the merged manifest covers ALL seed pairs of the smoke config (not
 *      pair-1-only), with jobsFailed 0 and rows equal to the per-job sum;
 *   4. sandbox isolation: every job was attributed from a fresh output set, i.e.
 *      no two jobs share an output stamp inside one sandbox (the collision the
 *      runner now handles by content, asserted here so it is visible);
 *   5. seed disjointness: no SMOKE seed equals a §6c pilot seed or a
 *      pre-registered Stage-2 seed (so the dry run consumed no real seed).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const [serialDir, parallelDir, smokeCfg, realCfg] = process.argv.slice(2);
if (!serialDir || !parallelDir || !smokeCfg || !realCfg) {
  console.error("usage: node tools/stage2_dryrun_verify.js <serialDir> <parallelDir> <smokeConfig> <realConfig>");
  process.exit(1);
}
let bad = 0;
const ok = (c, msg, extra) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${msg}${extra ? "   " + extra : ""}`); if (!c) bad++; };
const jobsOf = (dir) => fs.readdirSync(path.join(dir, "jobs")).sort();
const rowsOf = (dir, jobId) => {
  const d = path.join(dir, "jobs", jobId);
  const gz = fs.readdirSync(d).find(f => f.endsWith(".jsonl.gz"));
  const raw = fs.readdirSync(d).find(f => f.endsWith(".jsonl"));
  if (gz) return zlib.gunzipSync(fs.readFileSync(path.join(d, gz)));
  return raw ? fs.readFileSync(path.join(d, raw)) : null;
};

console.log("=== 1. DONE receipts + retention ===");
const sj = jobsOf(serialDir), pj = jobsOf(parallelDir);
console.log(`serial jobs ${sj.length}: ${sj.join(", ")}`);
console.log(`parallel jobs ${pj.length}: ${pj.join(", ")}`);
ok(JSON.stringify(sj) === JSON.stringify(pj), "both runs ran the same job set");
let done = 0, gz = 0;
for (const j of pj) {
  const rec = JSON.parse(fs.readFileSync(path.join(parallelDir, "jobs", j, "DONE.json"), "utf8"));
  if (rec.status === "DONE") done++;
  if (rec.retention && rec.retention.roundTripVerified && rec.retention.gzSha256) gz++;
}
ok(done === pj.length, "every job DONE", `${done}/${pj.length}`);
ok(gz === pj.length, "every job kept its rows gzip-compressed with a verified round trip and a pinned gz sha");

console.log("=== 2. serial vs parallel byte identity ===");
let same = 0;
for (const j of pj) {    const a = rowsOf(serialDir, j), b = rowsOf(parallelDir, j);
  if (a && b && a.equals(b)) same++;
  else console.log(`     mismatch in ${j} (serial ${a ? a.length : "none"}B vs parallel ${b ? b.length : "none"}B)`);
}
ok(same === pj.length, "rows byte-identical serial vs parallel for every job", `${same}/${pj.length}`);

console.log("=== 3. merged manifest coverage ===");
const merged = fs.readdirSync(parallelDir).filter(f => f.startsWith("stage2_merged_manifest_")).sort().pop();
const mm = JSON.parse(fs.readFileSync(path.join(parallelDir, merged), "utf8"));
const cfg = JSON.parse(fs.readFileSync(smokeCfg, "utf8"));
const pairKs = new Set(cfg.seedTable.pairs.slice(0, cfg.seedTable.consumedPairs).map(p => p.k));
const covered = new Set(mm.jobs.map(j => j.k));
console.log(`merged manifest ${merged}: jobsTotal ${mm.jobsTotal}, jobsDone ${mm.jobsDone}, jobsFailed ${mm.jobsFailed}, n_rows_total ${mm.n_rows_total}`);
ok(mm.jobsTotal === pj.length && mm.jobsDone === pj.length && mm.jobsFailed === 0, "merged manifest: all jobs DONE");
ok(covered.size === pairKs.size && [...pairKs].every(k => covered.has(k)),
   `all ${pairKs.size} seed pairs covered (not pair-1-only)`, `covered k = ${[...covered].sort((a, b) => a - b).join(",")}`);
const rowSum = mm.jobs.reduce((a, j) => a + (j.n_rows || 0), 0);
ok(rowSum === mm.n_rows_total, "n_rows_total equals the per-job sum", `${rowSum} rows`);
ok(Object.keys(mm.aggregation.perArmDeltaSortEntropy).length >= 5, "aggregation carries the per-arm deltas",
   `arms=${Object.keys(mm.aggregation.perArmDeltaSortEntropy).join(",")}`);
ok(Object.keys(mm.aggregation.seedPairedContrasts).length >= 3, "aggregation carries the seed-paired A−X contrasts",
   `contrasts=${Object.keys(mm.aggregation.seedPairedContrasts).join(",")}`);

console.log("=== 4. attribution under same-second stamp reuse ===");
// benchmark.js stamps to the SECOND, so a stamp legitimately recurs (measured in
// this very run). Stamp uniqueness is therefore NOT the property to test: the
// property is that every job's retained rows are the rows ITS OWN derived config
// produced, which is checked here directly from the row contents (seeds +
// conditions + row count) against the job plan in the smoke config.
const stampOf = (j) => (j.trials || "").match(/stage1_trials_(.+)\.jsonl/).pop();
const plan = new Map();
for (const p of cfg.seedTable.pairs.slice(0, cfg.seedTable.consumedPairs)) plan.set(p.k, p);
let attributionBad = 0, checked = 0;
for (const j of mm.jobs) {
  const rec = JSON.parse(fs.readFileSync(path.join(parallelDir, "jobs", j.jobId, "DONE.json"), "utf8"));
  const pair = plan.get(rec.k);
  const rows = zlib.gunzipSync(fs.readFileSync(path.join(parallelDir, rec.retention.gzFile))).toString("utf8").trim().split("\n").map(JSON.parse);
  const conds = [...new Set(rows.map(r => r.condition))].sort().join("|");
  const arms = rec.arms.slice().sort().join("|");
  const seedsOk = rows.every(r => r.seed === pair.environmentSeed && r.networkSeed === pair.networkSeed && r.topologySeed === pair.topologySeed);
  const rowsOk = rows.length === rec.n_rows && rows.length === Object.values(rec.phaseCounts[rec.arms[0]] || {}).reduce((a, b) => a + b, 0) * rec.arms.length;
  checked++;
  if (!seedsOk || conds !== arms || !rowsOk) {
    attributionBad++;
    console.log(`     ${j.jobId}: seedsOk=${seedsOk} conditions=${conds} arms=${arms} rows=${rows.length}/${rec.n_rows}`);
  }
}
ok(checked === mm.jobs.length && attributionBad === 0,
   "every job's retained rows carry its own pair's seeds and its own arm set",
   `${checked} jobs, sandbox field present: ${mm.jobs.every(j => JSON.parse(fs.readFileSync(path.join(parallelDir, "jobs", j.jobId, "DONE.json"), "utf8")).sandbox)}`);
const stamps = mm.jobs.map(stampOf);
const repeats = [...new Set(stamps.filter((s, i) => stamps.indexOf(s) !== i))];
console.log(`     (informational) output stamps reused in this run: ${repeats.length} (${repeats.join(", ") || "none"}) — ` +
            "these are the same-second cases that used to lose jobs; each was attributed from row content, not from its filename");

console.log("=== 5. seed disjointness (SMOKE seeds consumed: none) ===");
const real = JSON.parse(fs.readFileSync(realCfg, "utf8"));
const pilot = [];
for (let k = 1; k <= 8; k++) pilot.push({ environmentSeed: 4101 + 101 * (k - 1), networkSeed: 9201 + 101 * (k - 1), topologySeed: 7000 + k });
const realSeeds = new Set();
for (const p of real.seedTable.pairs.slice(0, real.seedTable.consumedPairs))
  for (const key of ["environmentSeed", "networkSeed", "topologySeed"]) realSeeds.add(p[key]);
let hits = 0;
for (const p of cfg.seedTable.pairs.slice(0, cfg.seedTable.consumedPairs))
  for (const key of ["environmentSeed", "networkSeed", "topologySeed"]) {
    if (realSeeds.has(p[key])) { hits++; console.log(`     collision: pair k=${p.k} ${key}=${p[key]} is a pre-registered Stage-2 seed`); }
    if (pilot.some(q => q[key] === p[key])) { hits++; console.log(`     collision: pair k=${p.k} ${key}=${p[key]} is a §6c pilot seed`); }
  }
ok(hits === 0, "no SMOKE seed touches the §6c pilot table or the pre-registered Stage-2 table");
ok(cfg.SMOKE === true && real.SMOKE === undefined, "the dry run config is SMOKE-flagged and the real config carries no SMOKE flag");

console.log(bad === 0 ? "\nDRY RUN VERIFIED" : `\nDRY RUN VERIFICATION FAILED (${bad} check(s))`);
process.exit(bad === 0 ? 0 : 1);
