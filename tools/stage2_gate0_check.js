#!/usr/bin/env node
/**
 * stage2_gate0_check.js — Gate 0 of the Stage-2 launch protocol (§8 re-verify).
 *
 * Re-derives the Stage-1 gate FROM THE PINNED PILOT ROWS (the manifest's
 * deltaSelectivity block is pair-1-only — pilot report caveat #5 — so it cannot
 * answer §8 clause (ii), which is a PER-REPLICATE statement). Streams the
 * trials JSONL, recomputes:
 *
 *   - row conservation: rows seen vs the manifest n_rows, per (arm, pair, phase)
 *     counts vs the manifest's phaseCounts;
 *   - strict JSON parse of every line + finiteness scan of the endpoint and
 *     budget fields on every row (a bare NaN/Infinity token cannot survive
 *     JSON.parse, so this is the strongest available check);
 *   - frozen-pre enforcement: every pre row carries frozenPre === true and
 *     weightDrift === 0 (protocol §10 stamp);
 *   - ΔY_X per arm per pair = mean(post sortEntropy) − mean(pre sortEntropy),
 *     then the seed-paired contrasts A−D (primary), A−B, A−C (secondary),
 *     A−E with descriptive 95% bands (experiment_core.meanCI — descriptive
 *     only, Stage 1 is exploratory per §7);
 *   - §8 clause (ii): is the A−D point estimate negative BEYOND its descriptive
 *     95% band, i.e. does D systematically beat A?
 *   - §8 clause (iii): does the floor arm E dominate max(A,B,C,D)?
 *
 * Exit 0 = all gate preconditions hold; exit 1 = at least one failure.
 * Usage: node tools/stage2_gate0_check.js <stage1_manifest.json> [trials.jsonl]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const CORE = require(path.join(__dirname, "..", "experiment_core.js"));

const ENDPOINT_FIELDS = ["sortEntropy", "dTfinal", "workInJ", "extractableJ",
                         "erasureCostJ", "goodBadRatio", "demonAgree", "measuredBits"];
const ARMS = ["armA_real_connectome", "armB_restricted_connectome",
              "armC_degree_preserved_shuffle", "armD_matched_random_sparse",
              "armE_random_action_floor"];

const [, , manifestArg, trialsArg] = process.argv;
if (!manifestArg) {
  console.error("usage: node tools/stage2_gate0_check.js <stage1_manifest.json> [trials.jsonl]");
  process.exit(1);
}
const manifestPath = path.resolve(manifestArg);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const trialsPath = path.resolve(trialsArg ||
  path.join(path.dirname(manifestPath), manifest.files.trials));

let fails = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? "  PASS  " : "  FAIL  ") + name + (cond ? "" : "  -> " + (detail || "")));
  if (!cond) fails++;
};
const fmt = (x, d = 4) => (x === undefined || x === null || !Number.isFinite(x)) ? "n/a" : x.toFixed(d);

// accumulate per (arm|pair) per phase: sum + count of sortEntropy
const acc = new Map();          // key -> {pre:[sum,n], post:[sum,n]}
const counts = new Map();       // arm|pair -> {pre,train,post}
const bump = (m, k, d) => { const v = m.get(k) || d; m.set(k, v); return v; };
let nRows = 0, badJson = 0, badNumeric = 0, badFrozen = 0, badDrift = 0;
const badExamples = [];
const phaseSeen = new Map();

function key(arm, pair) { return arm + "|" + pair; }

const rl = readline.createInterface({ input: fs.createReadStream(trialsPath, { encoding: "utf8" }),
                                      crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let r;
  try { r = JSON.parse(line); } catch (e) {
    badJson++;
    if (badExamples.length < 3) badExamples.push("unparseable line " + (nRows + 1));
    return;
  }
  nRows++;
  const pair = r.runId || ("pair_" + r.seed);
  const k = key(r.condition, pair);
  let c = counts.get(k);
  if (!c) { c = { pre: 0, train: 0, post: 0 }; counts.set(k, c); }
  const ph = r.phase === "test" ? "post" : r.phase;
  if (c[ph] !== undefined) c[ph]++;
  for (const f of ENDPOINT_FIELDS) {
    const v = r[f];
    if (v !== null && v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) {
      badNumeric++;
      if (badExamples.length < 6) badExamples.push(`${k} ${ph}#${r.trial}: ${f}=${v}`);
    }
  }
  if (r.phase === "pre") {
    if (r.frozenPre !== true) badFrozen++;
    if (r.weightDrift !== undefined && r.weightDrift !== 0) badDrift++;
  }
  if (Number.isFinite(r.sortEntropy)) {
    const a = acc.get(k) || { pre: [0, 0], post: [0, 0] };
    acc.set(k, a);
    if (ph === "pre") { a.pre[0] += r.sortEntropy; a.pre[1]++; }
    if (ph === "post") { a.post[0] += r.sortEntropy; a.post[1]++; }
    phaseSeen.set(k + "|" + ph, true);
  }
});

rl.on("close", () => {
  console.log("=== Gate 0: Stage-1 re-verify (protocol §8) ===");
  console.log("manifest:", path.basename(manifestPath), "| trials:", path.basename(trialsPath));
  console.log("rows streamed:", nRows, "| manifest n_rows:", manifest.n_rows);

  ok("rows equal the manifest n_rows", nRows === manifest.n_rows, `${nRows} vs ${manifest.n_rows}`);
  ok("every line is strict JSON (no bare NaN/Infinity token)", badJson === 0, `${badJson} bad lines`);
  ok("all endpoint numeric fields finite on all rows", badNumeric === 0,
     `${badNumeric} bad values; e.g. ${badExamples.join("; ")}`);
  ok("frozen-pre stamp on every pre row", badFrozen === 0, `${badFrozen} pre rows unstamped`);
  ok("weightDrift === 0 on every pre row", badDrift === 0, `${badDrift} pre rows moved weights`);

  // phaseCounts agreement (manifest carries them per arm)
  let phaseMismatch = 0;
  for (const arm of ARMS) {
    const want = manifest.phaseCounts && manifest.phaseCounts[arm];
    if (!want) continue;
    for (const pair of ["pair_1", "pair_2", "pair_3"]) {
      const c = counts.get(key(arm, pair));
      if (!c) { phaseMismatch++; continue; }
      for (const p of ["pre", "train", "post"]) if (c[p] !== want[p]) phaseMismatch++;
    }
  }
  ok("per (arm, pair) phase counts match the manifest", phaseMismatch === 0, `${phaseMismatch} mismatches`);

  // per-pair ΔY per arm
  const dY = new Map();     // arm -> Map(pair -> ΔY)
  for (const arm of ARMS) dY.set(arm, new Map());
  for (const [k, a] of acc) {
    const [arm, pair] = k.split("|");
    if (!dY.has(arm)) continue;
    if (!a.pre[1] || !a.post[1]) continue;
    dY.get(arm).set(pair, a.post[0] / a.post[1] - a.pre[0] / a.pre[1]);
  }
  const pairs = [...(dY.get(ARMS[0]).keys())].sort();
  console.log("\nper-pair deltaSortEntropy (post − pre), mean over trials in each phase:");
  console.log("  pair      " + ARMS.map(a => a.replace(/^arm/, "").split("_")[0].padEnd(10)).join(""));
  for (const p of pairs) {
    console.log("  " + p.padEnd(10) + ARMS.map(a => fmt(dY.get(a).get(p)).padEnd(10)).join(""));
  }

  console.log("\nseed-paired contrasts (A − X) with descriptive 95% bands (no p-values, §7):");
  const contrasts = {};
  for (const other of ARMS.slice(1)) {
    const diffs = pairs.map(p => dY.get(ARMS[0]).get(p) - dY.get(other).get(p))
                       .filter(v => Number.isFinite(v));
    if (!diffs.length) continue;
    const ci = CORE.meanCI(diffs);
    contrasts[other] = { n: diffs.length, mean: ci.mean, ci: ci.ci, diffs };
    console.log("  A − " + other.replace(/^arm/, "").padEnd(28) +
      fmt(ci.mean) + " ± " + fmt(ci.ci) + `   (n=${diffs.length}, per-pair: ${diffs.map(v => fmt(v)).join(", ")})`);
  }

  // §8 clause (ii): D must not systematically beat A
  const ad = contrasts[ARMS[3]];
  const ciUpper = ad.mean + ad.ci;
  const clauseII_pass = !(ciUpper < 0);      // D beating A beyond the band => fail
  console.log("");
  ok("§8 clause (ii): D does not systematically beat A beyond its 95% band",
     clauseII_pass, `A−D mean ${fmt(ad.mean)} ± ${fmt(ad.ci)} (band [${fmt(ad.mean - ad.ci)}, ${fmt(ciUpper)}])`);

  // §8 clause (iii): floor does not dominate the graph arms
  const eMean = CORE.meanCI(pairs.map(p => dY.get(ARMS[4]).get(p)).filter(Number.isFinite)).mean;
  const graphMeans = ARMS.slice(0, 4).map(a =>
    CORE.meanCI(pairs.map(p => dY.get(a).get(p)).filter(Number.isFinite)).mean);
  const maxGraph = Math.max(...graphMeans);
  ok("§8 clause (iii): floor arm E does not dominate max(A–D)",
     !(eMean > maxGraph), `E ${fmt(eMean)} vs max(A–D) ${fmt(maxGraph)}`);
  let perPairFloorWins = 0;
  for (const p of pairs)
    if (dY.get(ARMS[4]).get(p) > Math.max(...ARMS.slice(0, 4).map(a => dY.get(a).get(p)))) perPairFloorWins++;
  console.log("  note: per-pair floor dominance (E > all graph arms on that pair): " +
              perPairFloorWins + "/" + pairs.length + " pairs — informational, not a gate (§8 uses the pooled max)");

  console.log("\ngate 0:", fails === 0 ? "ALL PRECONDITIONS HOLD" : `${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
});
