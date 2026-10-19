#!/usr/bin/env node
/**
 * stage1_analyze.js — Stage-1 analysis of the run manifest (protocol §14).
 *
 * Consumes research_data/stage1_manifest_<stamp>.json (+ trials JSONL) and
 * produces a DESCRIPTIVE analysis: per-phase counts, Δ(post − pre) endpoint
 * and selectivity deltas per arm/pair, 95% CI bands via experiment_core.meanCI,
 * and the engineering-gate verdict (§8) — row conservation, NaN/Inf scan,
 * frozen-pre enforcement, floor-arm bound.
 *
 * NOTHING here is inferential: Stage 1 is EXPLORATORY (protocol §7). The
 * thermodynamic quantities are reported in a SEPARATE track (§15) — never
 * mixed into the behavioral endpoint.
 *
 * Usage:
 *   node stage1_analyze.js research_data/stage1_manifest_<stamp>.json [--selftest]
 *   node stage1_analyze.js --selftest    (validates the pipeline on hostile
 *                                        synthetic manifests; must exit 0
 *                                        BEFORE Stage-1 pre-registration, §13)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const CORE = require("./experiment_core.js");   // meanCI only; no physics run

// ------------------------------------------------------------ row loading
/** Load per-trial rows: embedded manifest.rows (selftest/synthetic), or the
 *  sibling stage1_trials_*.jsonl (from the manifest's files.trials pointer).
 *  An in-memory note is pushed to opts.failures (if provided) when a
 *  referenced file is MISSING — the caller turns it into a hard gate
 *  failure, because analysis over zero rows must never pass vacuously. */
function loadRows(manifest, manifestPath, opts) {
  const note = (m) => { if (opts && Array.isArray(opts.failures)) opts.failures.push(m); };
  if (Array.isArray(manifest.rows)) return manifest.rows;
  const dir = path.dirname(manifestPath);
  const rel = manifest.files && manifest.files.trials;
  if (rel) {
    const p = path.join(dir, rel);
    if (fs.existsSync(p)) {
      // v1.1c amendment: read the trials file as a Buffer (no V8 max-string
      // limit) and split on newline BYTES, then parse each line separately.
      const buf = fs.readFileSync(p);
      const rows = [];
      let start = 0;
      for (;;) {
        let nl = buf.indexOf(10, start); // 10 = newline byte
        if (nl === -1) nl = buf.length;
        if (nl > start) {
          const line = buf.toString("utf8", start, nl).trim();
          if (line) rows.push(JSON.parse(line));
        }
        if (nl === buf.length) break;
        start = nl + 1;
      }
      return rows;
    }
    note(`trials file "${rel}" referenced by manifest but NOT FOUND in ${dir}`);
    return [];
  }
  note("manifest carries neither embedded rows nor a files.trials pointer");
  return [];
}

// ------------------------------------------------------- analyze helpers
/** Δ(post − pre) per (arm, pair): mean of field over post rows minus mean
 *  over pre rows. Null-safe: undefined when a phase has no rows, and null
 *  values are excluded from means without being coerced to 0. */
function phaseDelta(rows, field) {
  const pre = rows.filter(r => r.phase === "pre").map(r => r[field])
    .filter(v => v !== null && v !== undefined && Number.isFinite(v));
  const post = rows.filter(r => r.phase === "post" || r.phase === "test")
    .map(r => r[field]).filter(v => v !== null && v !== undefined && Number.isFinite(v));
  if (!pre.length || !post.length) return undefined;
  return post.reduce((a, b) => a + b, 0) / post.length
       - pre.reduce((a, b) => a + b, 0) / pre.length;
}

function phaseCountsOf(rows) {
  const c = { pre: 0, train: 0, post: 0 };
  for (const r of rows) {
    const ph = r.phase === "test" ? "post" : r.phase;
    if (c[ph] !== undefined) c[ph]++;
  }
  return c;
}

/** Engineering-gate checks (§8): mechanical soundness, not science. */
function engineeringGate(manifest, rows) {
  const failures = [];
  // 1. per-phase counts present and nonzero per arm × pair
  const byArmPair = {};
  for (const r of rows) {
    const k = r.condition + "|" + (r.runId || r.seed);
    (byArmPair[k] = byArmPair[k] || []).push(r);
  }
  for (const [key, rs] of Object.entries(byArmPair)) {
    const c = phaseCountsOf(rs);
    for (const ph of ["pre", "train", "post"])
      if (c[ph] === 0) failures.push(`${key}: phase ${ph} has 0 trials`);
  }
  // 2. NaN / Infinity scan on the endpoint fields (incl. non-numeric types:
  //    a poisoned "0"/"null" string is malformed data, not a legal value)
  const FIELDS = ["sortEntropy", "dTfinal", "workInJ", "extractableJ", "erasureCostJ"];
  for (const r of rows) for (const f of FIELDS) {
    const v = r[f];
    if (v === null || v === undefined) continue;   // legal nulls stay null
    if (typeof v !== "number" || !Number.isFinite(v))
      failures.push(`${r.condition} ${r.runId || r.seed} ${r.phase}#${r.trial}: ${f} is ${v}`);
  }
  // 3. frozen-pre enforcement: pre rows must carry frozenPre === true
  for (const r of rows) {
    if (r.phase === "pre" && r.frozenPre !== true)
      failures.push(`${r.condition} ${r.runId || r.seed}: pre row missing frozenPre stamp`);
  }
  // 4. floor arm must not dominate: floor ΔsortEntropy should not exceed the
  //    best graph arm's (a floor that "wins" flags a broken floor/sensor)
  const deltas = {};
  for (const [key, rs] of Object.entries(byArmPair))
    deltas[key] = phaseDelta(rs, "sortEntropy");
  const floor = Object.entries(deltas).filter(([k]) => /floor/i.test(k));
  const graph = Object.entries(deltas).filter(([k]) => !/floor/i.test(k));
  for (const [fk, fv] of floor) {
    if (fv === undefined) continue;
    for (const [gk, gv] of graph)
      if (gv !== undefined && fv > gv)
        failures.push(`floor arm ${fk} (Δ=${fv.toFixed(4)}) outperformed graph arm ${gk} (Δ=${gv.toFixed(4)}) — broken-floor guard`);
  }
  const rowGateFailures = manifest.__gateFailures &&
    Array.isArray(manifest.__gateFailures) ? manifest.__gateFailures.slice() : [];

  return { pass: failures.length === 0 && rowGateFailures.length === 0,
           failures: failures.concat(rowGateFailures).slice(0, 40) };
}

/** Full descriptive analysis of one manifest. `injectedRows` (optional)
 *  bypasses file loading — the selftest injects its synthetic rows so the
 *  in-memory fixtures exercise the FULL gate/contrast pipeline. */
function analyze(manifest, manifestPath, injectedRows) {
  const preGate = { pass: false, failures: [] };
  const rows = Array.isArray(injectedRows) ? injectedRows
    : loadRows(manifest, manifestPath, preGate);
  if (!rows.length)
    preGate.failures.push("no per-trial rows found for this manifest — cannot gate (an empty row set must FAIL, never pass vacuously)");
  const byArmPair = {};
  for (const r of rows) {
    const k = r.condition + "|" + (r.runId || r.seed);
    (byArmPair[k] = byArmPair[k] || []).push(r);
  }
  const ENDPOINT = (manifest.analysis && manifest.analysis.endpoint) || "deltaSortEntropy_post_minus_pre";

  const arms = {};
  for (const [key, rs] of Object.entries(byArmPair)) {
    const [condition, runId] = key.split("|");
    arms[condition] = arms[condition] || { pairs: [] };
    const d = {
      runId,
      deltaSortEntropy: phaseDelta(rs, "sortEntropy"),
      deltaGoodBadRatio: phaseDelta(rs, "goodBadRatio"),
      deltaDTfinal: phaseDelta(rs, "dTfinal"),
      deltaDemonAgree: phaseDelta(rs, "demonAgree"),
    };
    arms[condition].pairs.push(d);
  }
  // per-arm cross-pair aggregates (descriptive 95% CI only — §7)
  for (const cond of Object.values(arms)) {
    for (const f of ["deltaSortEntropy", "deltaGoodBadRatio", "deltaDTfinal", "deltaDemonAgree"]) {
      const vals = cond.pairs.map(p => p[f]).filter(v => v !== undefined);
      cond[f] = vals.length ? CORE.meanCI(vals) : null;
    }
  }

  // seed-paired CONTRAST deltas (A−D primary candidate, A−B, A−C secondary)
  const getPairs = (key) => (arms[key] ? arms[key].pairs : []);
  const pairDiff = (aKey, bKey, field) => {
    const A = new Map(getPairs(aKey).map(p => [p.runId, p[field]]));
    const B = getPairs(bKey);
    const diffs = [];
    for (const p of B) {
      const a = A.get(p.runId);
      if (a !== undefined && p[field] !== undefined) diffs.push(a - p[field]);
    }
    return diffs;
  };
  const armKeys = Object.keys(arms).sort();
  const aKey = armKeys.find(k => /armA/.test(k));
  const contrasts = [];
  if (aKey) {
    for (const other of armKeys) {
      if (other === aKey) continue;
      const diffs = pairDiff(aKey, other, "deltaSortEntropy");
      if (diffs.length) contrasts.push({
        contrast: `${aKey} − ${other}`,
        n: diffs.length,
        delta: CORE.meanCI(diffs),
        role: /armD/.test(other) ? "primary candidate" : "secondary",
      });
    }
  }

  const gate = engineeringGate(manifest, rows);
  // merge the load-time pre-gate (empty row set etc.) into the final gate
  gate.failures = preGate.failures.concat(gate.failures);
  gate.pass = gate.failures.length === 0;

  return {
    stage: manifest.stage !== undefined ? manifest.stage : 1,
    declared: "EXPLORATORY (protocol §7): no inferential claims are licensed from these numbers",
    endpoint: ENDPOINT,
    seedPairsUsed: manifest.consumedSeedPairs !== undefined ? manifest.consumedSeedPairs : null,
    arms,
    contrasts,
    phaseCountsByArm: Object.fromEntries(Object.entries(arms).map(([k, v]) =>
      [k, v.pairs.map(p => phaseCountsOf(byArmPair[k + "|" + p.runId]))])),
    engineeringGate: gate,
    thermoTrack: {
      separate: true,
      note: "Protocol §15: thermodynamic quantities are measurement-chain diagnostics, reported separately, never mixed into the behavioral endpoint.",
      perArmPostMeans: thermoSummary(byArmPair),
    },
  };
}

/** Separate-track thermo block: per-arm POST-phase means of the budget fields. */
function thermoSummary(byArmPair) {
  const out = {};
  for (const [key, rs] of Object.entries(byArmPair)) {
    const [cond] = key.split("|");
    const post = rs.filter(r => r.phase === "post" || r.phase === "test");
    if (!post.length) continue;
    const mean = (f) => {
      const vals = post.map(r => r[f]).filter(v => v !== null && v !== undefined && Number.isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    out[cond] = out[cond] || { pairs: [] };
    out[cond].pairs.push({
      runId: key.split("|")[1],
      workInJ: mean("workInJ"),
      extractableJ: mean("extractableJ"),
      erasureCostJ: mean("erasureCostJ"),
      measuredBits: mean("measuredBits"),
    });
  }
  return out;
}

// ---------------------------------------------------- synthetic manifests
/** Hostile synthetic manifest factories for the selftest (§14). Each returns
 *  { realize() -> {manifest, rows, expect: {gatePass}} } — LAZY, so each
 *  fixture builds its own fresh deep copy and mutations poison exactly one
 *  run. Source-controlled validation fixtures; no network, no filesystem. */
function synthGoodBuilder(nPairs) {
  return () => {
    const rows = [];
    const arms = ["armA_real_connectome", "armB_restricted_connectome",
                  "armC_degree_preserved_shuffle", "armD_matched_random_sparse",
                  "armE_random_action_floor"];
    for (let p = 0; p < nPairs; p++) {
      for (const arm of arms) {
        const pre = 0.02 + 0.01 * Math.sin(p);
        const post = pre + (arm === "armE_random_action_floor" ? 0.001
          : 0.05 + 0.03 * (arm === "armA_real_connectome" ? 1 : (0.3 + 0.2 * Math.sin(p))));
        rows.push({ condition: arm, runId: "pair_" + (p + 1), phase: "pre", trial: 0,
          sortEntropy: pre, dTfinal: 0.1, goodBadRatio: 1.2, demonAgree: 0.5,
          workInJ: 1e-15, extractableJ: 1e-17, erasureCostJ: 1e-18, frozenPre: true });
        for (let t = 0; t < 2; t++)
          rows.push({ condition: arm, runId: "pair_" + (p + 1), phase: "post", trial: t,
            sortEntropy: post + 0.001 * t, dTfinal: 0.1, goodBadRatio: 1.3, demonAgree: 0.6,
            workInJ: 1e-15, extractableJ: 1e-17, erasureCostJ: 1e-18 });
        for (let t = 0; t < 2; t++)
          rows.push({ condition: arm, runId: "pair_" + (p + 1), phase: "train", trial: t,
            sortEntropy: pre + 0.02, dTfinal: 0.1, goodBadRatio: 1.2, demonAgree: 0.55,
            workInJ: 1e-15, extractableJ: 1e-17, erasureCostJ: 1e-18 });
      }
    }
    return {
      manifest: { stage: 1, consumedSeedPairs: nPairs, files: {},
        phases: { post: "present" }, analysis: { endpoint: "deltaSortEntropy_post_minus_pre" } },
      rows, expect: { gatePass: true },
    };
  };
}
function synthNaNBuilder() {                    // NaN in endpoint field
  const base = synthGoodBuilder(2);
  return () => {
    const fx = base();
    const i = fx.rows.findIndex(r => r.condition !== "armE_random_action_floor" && r.phase === "post");
    fx.rows[i].sortEntropy = NaN;
    fx.expect.gatePass = false;
    return fx;
  };
}
function synthMissingPhaseBuilder() {           // an arm missing its pre phase
  const base = synthGoodBuilder(2);
  return () => {
    const fx = base();
    const i = fx.rows.findIndex(r => r.condition === "armC_degree_preserved_shuffle" && r.phase === "pre");
    if (i >= 0) fx.rows.splice(i, 1);
    fx.expect.gatePass = false;
    return fx;
  };
}
function synthBrokenFloorBuilder() {            // floor arm outperforms graph arms
  const base = synthGoodBuilder(2);
  return () => {
    const fx = base();
    for (const r of fx.rows)
      if (r.condition === "armE_random_action_floor" && r.phase === "post") r.sortEntropy += 1.0;
    fx.expect.gatePass = false;
    return fx;
  };
}
function synthNoFrozenStampBuilder() {          // pre rows missing the frozen stamp
  const base = synthGoodBuilder(2);
  return () => {
    const fx = base();
    for (const r of fx.rows) if (r.phase === "pre") delete r.frozenPre;
    fx.expect.gatePass = false;
    return fx;
  };
}
const SYNTH_FIXTURES = [
  ["clean synthetic run", synthGoodBuilder(3)],
  ["NaN in endpoint row", synthNaNBuilder()],
  ["missing pre phase", synthMissingPhaseBuilder()],
  ["floor arm outperforms graph arms", synthBrokenFloorBuilder()],
  ["frozen-pre stamp missing", synthNoFrozenStampBuilder()],
];

// --------------------------------------------------------------- selftest
function runSelftest() {
  let passed = 0, failed = 0;
  for (const [name, fx] of SYNTH_FIXTURES) {
    try {
      // fixtures are LAZY (realize()); each selftest gets a fresh copy so
      // one fixture's mutations can never poison the next.
      const src = typeof fx === "function" ? fx() : fx;
      if (!src.rows || !src.rows.length) throw new Error("fixture produced no rows");
      const out = analyze(src.manifest, "synthetic", src.rows);
      const gate = out.engineeringGate.pass;
      if (gate === src.expect.gatePass) {
        console.log("  selftest PASS:", name, `(gate=${gate ? "pass" : "flagged"})`);
        passed++;
      } else {
        console.log("  selftest FAIL:", name, `expected gate=${src.expect.gatePass}, got ${gate}`,
          gate ? "" : JSON.stringify(out.engineeringGate.failures.slice(0, 3)));
        failed++;
      }
    } catch (e) {
      console.log("  selftest FAIL:", name, "threw", e.message);
      failed++;
    }
  }
  console.log(`selftest: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

// ------------------------------------------------------------------- main
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) {
    const ok = runSelftest();
    process.exit(ok ? 0 : 1);
  }
  const manifestArg = argv.find(a => !a.startsWith("--"));
  if (!manifestArg) {
    console.error("usage: node stage1_analyze.js <stage1_manifest.json> | --selftest");
    process.exit(1);
  }
  const p = path.isAbsolute(manifestArg) ? manifestArg : path.join(process.cwd(), manifestArg);
  const manifest = JSON.parse(fs.readFileSync(p, "utf8"));
  const out = analyze(manifest, p);

  console.log("=== Stage-1 descriptive analysis (EXPLORATORY, protocol §7) ===");
  console.log("endpoint:", out.endpoint, "| seed pairs:", out.seedPairsUsed);
  for (const [arm, a] of Object.entries(out.arms)) {
    const d = a.deltaSortEntropy;
    console.log(" ", arm.padEnd(30),
      "ΔsortEntropy", d ? `${d.mean.toFixed(4)} ± ${d.ci.toFixed(4)}` : "n/a",
      `(${a.pairs.length} pairs)`);
  }
  if (out.contrasts.length) {
    console.log("\n  seed-paired contrasts (A−X on ΔsortEntropy):");
    for (const c of out.contrasts)
      console.log("   ", c.contrast.padEnd(44),
        `${c.delta.mean.toFixed(4)} ± ${c.delta.ci.toFixed(4)}`, `(n=${c.n}, ${c.role})`);
  }
  console.log("\nengineering gate:", out.engineeringGate.pass ? "PASS" : "FLAGGED");
  for (const f of out.engineeringGate.failures) console.log("   ⚠", f);
  const t = out.thermoTrack.perArmPostMeans;
  const anyThermo = Object.values(t).some(v => v.pairs.length);
  if (anyThermo) {
    console.log("\n=== thermodynamic track (SEPARATE — protocol §15; diagnostics only) ===");
    for (const [arm, v] of Object.entries(t)) {
      const m = v.pairs[0];
      const fmtJ = (x) => x === null || !Number.isFinite(x) ? "n/a" : x === 0 ? "0 J" : x.toExponential(2) + " J";
      console.log(" ", arm.padEnd(30), "work_in", fmtJ(m.workInJ),
        "extractable", fmtJ(m.extractableJ), "erasure", fmtJ(m.erasureCostJ),
        "bits", m.measuredBits === null ? "n/a" : Math.round(m.measuredBits).toLocaleString("en-US"));
    }
  }
  console.log("\nNo p-values were computed. Stage 1 is exploratory:",
    "these numbers scope Stage-2 sizing, they do not test hypotheses (protocol §7).");
  process.exit(out.engineeringGate.pass ? 0 : 2);
}

if (require.main === module) main();
module.exports = { analyze, engineeringGate, runSelftest, phaseDelta, phaseCountsOf };
