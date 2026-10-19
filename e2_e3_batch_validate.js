#!/usr/bin/env node
"use strict";
/**
 * e2_e3_batch_validate.js — C-4 (build-plan rows 11 + 12): E2 ANN demon and
 * E3 Drosophila-inspired network, seeded verification + benchmark datasets.
 *
 * PURPOSE: measure the EXISTING controllers across independent seeds on the
 * UNMODIFIED shared engine (experiment_core.js runBenchmark — the same
 * Maxwell-demon engine E1/E2/E3/E6/E8 run on). Nothing about the science is
 * changed here: controller math, reward semantics, physics, train/frozen
 * split are all the production code paths (worker e2/e3 configs verified:
 * ann, drosophila with default options; classical_demon reference; random
 * floor).
 *
 * METHODOLOGY (identical to e6/e9 batch validators):
 *   - The INDEPENDENT REPLICATE IS THE SEED (env seed = base + s*101,
 *     controller rng = makeRng(seed ^ 0x5f5f) — the engine's own rule).
 *   - TRAIN phase plasticity ON, TEST phase FROZEN (runBenchmark phase loop).
 *   - Welch two-sided t tests on per-seed final-TEST values (stats_utils.js).
 *   - No tuning, no seed selection, no discarding.
 *
 * CONDITIONS:
 *   ann            — E2 ANN demon (15-16-2, reward-modulated Hebbian, lr 0.02)
 *   drosophila     — E3 Drosophila-inspired (PN 32 / KC 200 sparse-12 / MBON 16)
 *   classical_demon— classical speed-selective rule (analytical reference)
 *   random         — random controller (floor)
 *
 * ARTIFACTS: e2_e3_batch_<stamp>.jsonl + _summary.json (+ report) and the
 * C-3 standardized dataset pair e2_e3_dataset_<stamp>.csv + .manifest.json.
 *
 * CLI: node e2_e3_batch_validate.js [--seeds 20] [--base 1] [--b 4]
 *      [--train 30] [--test 10] [--episode 12] [--particles 320]
 *      [--variants ann,drosophila,classical_demon,random | all]
 *      [--no-html] [--no-determinism] [--selftest]
 */

const fs = require("fs");
const path = require("path");
const CORE = require("./experiment_core.js");
const CTRL = require("./controllers.js");
const SU = require("./stats_utils.js");

// ---- CLI -------------------------------------------------------------------
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}
const hasFlag = (name) => args.includes("--" + name);

const SEEDS   = Math.max(1, parseInt(argVal("seeds", "20"), 10) || 20);
const BASE    = parseInt(argVal("base", "1"), 10) || 1;
const TRAIN   = parseInt(argVal("train", "30"), 10) || 30;
const TEST    = parseInt(argVal("test", "10"), 10) || 10;
const EPISODE = parseInt(argVal("episode", "12"), 10) || 12;
const NPART   = parseInt(argVal("particles", "320"), 10) || 320;
const B       = Math.max(1, parseInt(argVal("b", "4"), 10) || 4);
const WANT_HTML = !hasFlag("no-html");
const NO_DETERMINISM = hasFlag("no-determinism");
const FROM_JSONL = hasFlag("from-jsonl")
  ? argVal("from-jsonl", "").split(",").map(s => s.trim()).filter(Boolean)
  : null;

const KNOWN_VARIANTS = ["ann", "drosophila", "classical_demon", "random"];
const VAR_ARG = hasFlag("variants")
  ? argVal("variants", "").split(",").map(s => s.trim()).filter(Boolean)
  : null;
const VARIANTS = !VAR_ARG
  ? ["ann", "drosophila", "classical_demon", "random"]
  : VAR_ARG.includes("all") ? KNOWN_VARIANTS.slice()
  : VAR_ARG.filter(v => KNOWN_VARIANTS.includes(v));
if (!VARIANTS.length) { console.error("no known variants in --variants list"); process.exit(1); }

function factoryFor(v) {
  if (v === "ann")            return (rng, env, cfg) => CTRL.annController(rng, env, cfg);
  if (v === "drosophila")     return (rng, env, cfg) => CTRL.drosophilaController(rng, env, cfg);
  if (v === "classical_demon") return (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg);
  if (v === "random")         return (rng, env) => CTRL.randomController(rng, env);
  throw new Error("unknown variant " + v);
}

// ---- statistics: independent replicate = SEED (top-level: exported) --------
function trialStats(rowsIn, Bsize) {
  const byCond = new Map();
  for (const r of rowsIn) {
    if (!byCond.has(r.condition)) byCond.set(r.condition, []);
    byCond.get(r.condition).push(r);
  }
  const out = [];
  for (const [condition, crows] of byCond) {
    const fields = Object.keys(crows[0]).filter(f => typeof crows[0][f] === "number" &&
      Number.isFinite(crows[0][f]) && f !== "seed" && f !== "trial" && f !== "steps");
    let trialOffset = 0, blockOffset = 0;
    for (const phase of ["train", "test"]) {
      const list = crows.filter(r => r.phase === phase);
      if (!list.length) continue;
      const seeds = [...new Set(list.map(r => r.seed))].sort((a, b) => a - b);
      const seedRows = seeds.map(sd =>
        list.filter(r => r.seed === sd).sort((a, b) => a.trial - b.trial));
      const nTrials = Math.max(...seedRows.map(a => a.length));
      const nBlocks = Math.max(1, Math.floor(nTrials / Bsize));
      for (let b = 0; b < nBlocks; b++) {
        const pt = { condition, phase, block: blockOffset + b,
                     trialStart: trialOffset + b * Bsize,
                     trialEnd: trialOffset + Math.min((b + 1) * Bsize, nTrials) - 1 };
        for (const f of fields) {
          const vals = [];
          for (const srows of seedRows) {
            const seg = srows.slice(b * Bsize, (b + 1) * Bsize);
            if (!seg.length) continue;
            vals.push(seg.reduce((a, r) => a + r[f], 0) / seg.length);
          }
          if (!vals.length) continue;
          const m = vals.reduce((a, x) => a + x, 0) / vals.length;
          const sd = vals.length > 1
            ? Math.sqrt(vals.reduce((a, x) => a + (x - m) ** 2, 0) / (vals.length - 1)) : 0;
          const sem = vals.length > 1 ? sd / Math.sqrt(vals.length) : 0;
          pt[f] = { mean: m, sd, sem, ci: 1.96 * sem, n: vals.length };
        }
        out.push(pt);
      }
      trialOffset += nTrials;
      blockOffset += nBlocks;
    }
  }
  return out;
}

// ---- selftest (no simulation) ----------------------------------------------
if (hasFlag("selftest")) {
  const w = SU.welchT([5, 6, 7, 8, 9, 10], [7, 8, 9, 10, 11, 12]);
  const okT = Math.abs(Math.abs(w.t) - 1.8516) < 2e-2 && Math.abs(w.p - 0.0938) < 5e-4;
  console.log("selftest welchT: " + (okT ? "OK" : "FAIL"));
  let okFact = true;
  for (const v of KNOWN_VARIANTS) {
    try { const f = factoryFor(v); if (typeof f !== "function") throw new Error("not fn"); }
    catch (e) { okFact = false; console.log("factory FAIL", v, e.message); }
  }
  console.log("selftest factories: " + (okFact ? "OK" : "FAIL"));
  process.exit(okT && okFact ? 0 : 1);
}

// ---- main: simulate / aggregate, analyze, write artifacts -------------------
function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rows = [];
  const perSeed = {};
  for (const v of VARIANTS) perSeed[v] = [];
  console.log("E2/E3 batch validation: " +
              (FROM_JSONL ? "aggregated from " + FROM_JSONL.length + " chunks"
                          : SEEDS + " seeds") + " x " + VARIANTS.length +
              " conditions, " + TRAIN + "+" + TEST + " trials x " + EPISODE +
              "s x " + NPART + " particles");
  console.log("conditions: " + VARIANTS.join(", "));
  const t0 = Date.now();
  if (FROM_JSONL) {
    for (const f of FROM_JSONL) {
      const p = path.resolve(f);
      const sum = JSON.parse(fs.readFileSync(p.replace(/\.jsonl$/, "_summary.json"), "utf8"));
      const base = sum.provenance.seedBase;
      const rws = fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean)
        .map(l => JSON.parse(l));
      for (const r of rws)
        rows.push(Object.assign({}, r, { seed: (base - 1) / 101 + r.seed }));
      console.log("  loaded " + rws.length + " rows from " + f + " (seedBase " + base + ")");
    }
  } else {
    for (let s = 0; s < SEEDS; s++) {
      const seed = BASE + s * 101;          // the engine's own seed rule
      const tS = Date.now();
      CORE.runBenchmark({
        seed, nSeeds: 1,
        trialsTrain: TRAIN, trialsTest: TEST,
        episodeSeconds: EPISODE, dt: 1 / 60,
        nParticles: NPART, maxCrossingsPerTrial: 50,
        controllers: Object.fromEntries(VARIANTS.map(v => [v, factoryFor(v)])),
        onTrialData: (cond, phase, tr) => {
          const row = Object.assign({}, tr, { condition: cond, phase, seedTag: s + 1 });
          delete row.fireVec;               // 16-neuron b64 display payload
          rows.push(row);
        },
      });
      console.log("  seed " + (s + 1) + "/" + SEEDS + " (rng " + seed + ") done in " +
                  ((Date.now() - tS) / 1000).toFixed(1) + " s");
    }
    // ---- determinism gate: same seed -> identical rows ----------------------
    if (!NO_DETERMINISM) {
      const rerun = [];
      CORE.runBenchmark({
        seed: BASE, nSeeds: 1,
        trialsTrain: TRAIN, trialsTest: TEST,
        episodeSeconds: EPISODE, dt: 1 / 60,
        nParticles: NPART, maxCrossingsPerTrial: 50,
        controllers: Object.fromEntries(VARIANTS.map(v => [v, factoryFor(v)])),
        onTrialData: (cond, phase, tr) => {
          const row = Object.assign({}, tr, { condition: cond, phase });
          delete row.fireVec;
          rerun.push(row);
        },
      });
      const fields = ["crossings", "goodCrossings", "badCrossings", "openFraction",
                      "demonAgree", "dTfinal", "sortEntropy", "energyJ", "miNeural"];
      let same = true, badAt = null;
      for (const cond of VARIANTS) {
        const first = rows.filter(r => r.condition === cond && r.seedTag === 1);
        const again = rerun.filter(r => r.condition === cond);
        if (first.length !== again.length) { same = false; badAt = cond + ":rowcount"; break; }
        for (let i = 0; i < first.length && same; i++) {
          for (const f of fields) {
            const a = first[i][f], b = again[i][f];
            const na = a === null || a === undefined ? 0 : a;
            const nb = b === null || b === undefined ? 0 : b;
            if (Math.abs(na - nb) > 1e-9) { same = false; badAt = cond + "[" + i + "]." + f; break; }
          }
        }
        if (!same) break;
      }
      console.log("\nreproducibility: same seed -> " +
                  (same ? "IDENTICAL rows" : "DIVERGENT at " + badAt + " (BUG)"));
      if (!same) { console.error("reproducibility gate FAILED"); process.exit(1); }
    }
  }
  const elapsed = (Date.now() - t0) / 1000;
  const NSEEDS = FROM_JSONL ? new Set(rows.map(r => r.seed)).size : SEEDS;

  // ---- per-replicate finals -------------------------------------------------
  {
    const tags = [...new Set(rows.map(r => r.seedTag !== undefined ? r.seedTag : r.seed))].sort((a, b) => a - b);
    for (const v of VARIANTS) {
      for (const tg of tags) {
        const vr = rows.filter(r => r.condition === v &&
          (r.seedTag !== undefined ? r.seedTag : r.seed) === tg);
        const lastTrain = [...vr].reverse().find(r => r.phase === "train");
        const lastTest  = [...vr].reverse().find(r => r.phase === "test");
        if (lastTrain) perSeed[v].push({ seed: tg, phase: "train", rec: lastTrain });
        if (lastTest)  perSeed[v].push({ seed: tg, phase: "test",  rec: lastTest });
      }
    }
  }

  const stats = trialStats(rows, B);

  // ---- final-phase cross-seed summaries -------------------------------------
  const FINAL_FIELDS = ["crossings", "goodCrossings", "badCrossings", "openFraction",
                        "demonAgree", "dTfinal", "sortEntropy", "spatialH", "miNeural",
                        "energyJ", "jetWorkJ", "workInJ", "extractableJ", "erasureCostJ",
                        "landauerRatio", "measuredBits", "goodBadRatio", "motorHz"];
  function finalSummary(v) {
    const out = {};
    for (const phase of ["train", "test"]) {
      const recs = (perSeed[v] || []).filter(x => x.phase === phase).map(x => x.rec);
      if (!recs.length) continue;
      const agg = {};
      for (const f of FINAL_FIELDS) {
        const vals = recs.map(r => r[f]).filter(x => x !== null && x !== undefined && Number.isFinite(x));
        if (!vals.length) continue;
        const m = vals.reduce((a, x) => a + x, 0) / vals.length;
        const sd = vals.length > 1
          ? Math.sqrt(vals.reduce((a, x) => a + (x - m) ** 2, 0) / (vals.length - 1)) : 0;
        const sem = vals.length > 1 ? sd / Math.sqrt(vals.length) : 0;
        agg[f] = { mean: m, sd, sem, ci: 1.96 * sem, n: vals.length };
      }
      out[phase] = agg;
    }
    return out;
  }
  const finals = Object.fromEntries(VARIANTS.map(v => [v, finalSummary(v)]));

  // ---- Welch tests on final TEST metrics ------------------------------------
  function lastVals(v, f) {
    return ((perSeed[v] || []).filter(x => x.phase === "test")
            .map(x => x.rec[f])).filter(x => x !== null && x !== undefined && Number.isFinite(x));
  }
  const tests = [];
  {
    const pairs = [["ann", "classical_demon"], ["ann", "random"],
                   ["drosophila", "classical_demon"], ["drosophila", "random"],
                   ["drosophila", "ann"]];
    for (const f of ["goodCrossings", "goodBadRatio", "openFraction", "demonAgree"]) {
      for (const [a, b] of pairs) {
        if (!VARIANTS.includes(a) || !VARIANTS.includes(b)) continue;
        const va = lastVals(a, f), vb = lastVals(b, f);
        if (va.length >= 2 && vb.length >= 2)
          tests.push({ metric: f, comparison: a + " vs " + b + " (final TEST)", ...SU.welchT(va, vb) });
      }
    }
  }

  // ---- console report ---------------------------------------------------------
  const fmt = (st, d) => st ? st.mean.toFixed(d) + " +/- " + st.ci.toFixed(d) + " (n=" + st.n + ")" : "-";
  console.log("\n" + NSEEDS + " seeds | " + TRAIN + "+" + TEST + " trials | " + EPISODE +
              "s episodes | " + NPART + " particles | " + rows.length + " rows | " +
              elapsed.toFixed(0) + " s");
  console.log("\n== FINAL metrics (mean +/- 95% CI over seeds) ==");
  for (const v of VARIANTS) {
    const F = finals[v];
    console.log("\n" + v + ":");
    console.log("  final train good xings  " + fmt(F.train && F.train.goodCrossings, 2));
    console.log("  final test  good xings  " + fmt(F.test && F.test.goodCrossings, 2));
    console.log("  final test good:bad     " + fmt(F.test && F.test.goodBadRatio, 3));
    console.log("  final test openFraction " + fmt(F.test && F.test.openFraction, 3));
    console.log("  final test demonAgree   " + fmt(F.test && F.test.demonAgree, 3));
  }
  if (tests.length) {
    console.log("\n== Welch t tests on final TEST metrics (two-sided, per-seed values) ==");
    for (const w of tests)
      console.log("  " + w.comparison + " - " + w.metric + ": t=" + w.t.toFixed(2) +
                  ", df=" + w.df.toFixed(1) + ", p=" +
                  (w.p < 1e-4 ? w.p.toExponential(1) : w.p.toFixed(4)));
  }

  // ---- artifacts ---------------------------------------------------------------
  fs.mkdirSync(path.join(__dirname, "research_data"), { recursive: true });
  const jsonl = path.join(__dirname, "research_data", "e2_e3_batch_" + stamp + ".jsonl");
  fs.writeFileSync(jsonl, rows.map(r => JSON.stringify(r)).join("\n"));
  const summaryPath = path.join(__dirname, "research_data", "e2_e3_batch_" + stamp + "_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify({
    provenance: {
      experiment: "e2_e3", phase: "C-4", kind: "batch_validation",
      question: "Do the E2 ANN and E3 Drosophila-inspired demons learn the jet-closure sorting task better than the classical reference and the random floor?",
      seeds: NSEEDS, seedBase: BASE, seedStride: 101,
      trainTrials: TRAIN, testTrials: TEST, episodeSeconds: EPISODE,
      nParticles: NPART, blockB: B, variants: VARIANTS,
      controllers: { ann: "annController defaults (lr 0.02)",
                     drosophila: "drosophilaController defaults (PN32/KC200/MBON16)",
                     classical_demon: "classicalDemon", random: "randomController" },
      engine: "experiment_core.js runBenchmark (UNTOUCHED): train plasticity ON, test FROZEN",
      determinism: NO_DETERMINISM ? "gate skipped (--no-determinism chunked-batch mode)"
                                  : "same-seed rerun identical (gate passed)",
      startedISO: new Date(Date.now() - elapsed * 1000).toISOString(),
      elapsedSeconds: Math.round(elapsed * 1e6) / 1e6,
    },
    finals, tests,
  }, null, 2));
  console.log("\nwrote " + jsonl + " (" + rows.length + " rows)");
  console.log("wrote " + summaryPath);

  // ---- C-3 standardized dataset export (CSV + manifest, sha256-pinned) --------
  {
    const DX = require("./dataset_export.js");
    const dsRows = rows.map(r => Object.assign({}, r, { experiment: r.condition === "ann" ? "e2" : "e3" }));
    const ds = DX.exportRun({
      experiment: "e2_e3",
      label: "E2 ANN demon + E3 Drosophila-inspired network - seeded verification batch (C-4)",
      question: "Do the E2/E3 demons learn the sorting task better than the classical reference and the random floor?",
      protocol: "TRAIN (plasticity ON) -> FROZEN EVAL (setLearning(false)); seed = independent replicate; no seeds discarded",
      config: { seeds: NSEEDS, seedBase: BASE, seedStride: 101, trainTrials: TRAIN,
                testTrials: TEST, episodeSeconds: EPISODE, nParticles: NPART,
                variants: VARIANTS,
                engine: "experiment_core.js runBenchmark (unmodified)" },
      conditions: VARIANTS,
    }, dsRows);
    console.log("dataset: " + ds.csvPath);
    console.log("dataset manifest: " + ds.manifestPath + " (sha256 " + ds.sha256.slice(0, 16) + "...)");
  }

  // ---- HTML report -------------------------------------------------------------
  if (WANT_HTML) {
    const PANELS = [
      ["goodCrossings", "Good crossings per trial (primary selectivity)", v => v.toFixed(1), false],
      ["openFraction",  "Door open fraction vs trial",                    v => (v * 100).toFixed(0) + "%", false],
      ["demonAgree",    "Demon agreement vs trial",                       v => (v * 100).toFixed(0) + "%", false],
      ["miNeural",      "Neural-particle mutual information vs trial",    v => v.toFixed(3), false],
    ];
    const COLORS = { ann: "#4c72b0", drosophila: "#dd8452",
                     classical_demon: "#55a868", random: "#8c8c8c" };
    const series = Object.keys(COLORS).filter(v => VARIANTS.includes(v));
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const htmlPanels = PANELS.map(([f, label, fmtV]) => {
      const allPts = stats.filter(s => s.condition === series[0]);
      if (!allPts.length) return "";
      const W = 430, H = 240, padL = 50, padR = 10, padT = 12, padB = 24;
      const xlo = 0, xhi = Math.max(...allPts.map(s => s.trialEnd)) + 1;
      let ylo = Infinity, yhi = -Infinity;
      for (const s of allPts) {
        const st = s[f]; if (!st) continue;
        ylo = Math.min(ylo, st.mean - st.ci); yhi = Math.max(yhi, st.mean + st.ci);
      }
      if (!Number.isFinite(ylo)) return "";
      if (yhi === ylo) { yhi = ylo + 1; ylo -= 0.5; }
      const X = x => padL + (x - xlo) / Math.max(1e-9, xhi - xlo) * (W - padL - padR);
      const Y = y => padT + (1 - (y - ylo) / (yhi - ylo)) * (H - padT - padB);
      const testStart = allPts.find(s => s.phase === "test");
      const nPts = allPts.filter(s => s[f]);
      let band = "";
      if (nPts.length > 1) {
        const up = nPts.map(s => X((s.trialStart + s.trialEnd) / 2).toFixed(1) + "," + Y(s[f].mean + s[f].ci).toFixed(1));
        const dn = nPts.slice().reverse().map(s => X((s.trialStart + s.trialEnd) / 2).toFixed(1) + "," + Y(s[f].mean - s[f].ci).toFixed(1));
        band = '<path d="M' + up.join(" L") + ' L' + dn.join(" L") + ' Z" fill="' + COLORS[series[0]] + '22"/>';
      }
      const lines = series.map(v => {
        const pts = stats.filter(s => s.condition === v && s[f]);
        let dd = "", pen = false;
        for (const s of pts) {
          const x = (s.trialStart + s.trialEnd) / 2, y = s[f].mean;
          dd += (pen ? "L" : "M") + X(x).toFixed(1) + "," + Y(y).toFixed(1) + " "; pen = true;
        }
        return dd ? '<path d="' + dd + '" fill="none" stroke="' + COLORS[v] + '" stroke-width="1.8"/>' : "";
      }).join("");
      const ticks = [0, 0.25, 0.5, 0.75, 1].map(fr => {
        const yv = ylo + fr * (yhi - ylo);
        return '<text x="4" y="' + (padT + (1 - fr) * (H - padT - padB) + 3).toFixed(1) +
               '" font-size="9" fill="#6a737d">' + fmtV(yv) + '</text>';
      }).join("");
      const xTicks = [0, 0.5, 1].map(fr => {
        const xv = xlo + fr * (xhi - xlo);
        return '<text x="' + X(xv).toFixed(1) + '" y="' + (H - 8) +
               '" font-size="9" fill="#6a737d" text-anchor="middle">' + Math.round(xv) + '</text>';
      }).join("");
      return '<div class="panel"><h3>' + esc(label) +
        ' <span class="tag">mean line, 95% CI band (' + esc(series[0]) + '), n=' + NSEEDS + ' seeds</span></h3>' +
        '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart">' +
        '<rect x="' + padL + '" y="' + padT + '" width="' + (W - padL - padR) + '" height="' + (H - padT - padB) +
        '" fill="none" stroke="#30363d"/>' +
        (testStart ? '<line x1="' + X(testStart.trialStart).toFixed(1) + '" y1="' + padT +
                     '" x2="' + X(testStart.trialStart).toFixed(1) + '" y2="' + (H - padB) +
                     '" stroke="#8b949e" stroke-dasharray="4 4" opacity=".6"/>' +
                     '<text x="' + (X(testStart.trialStart) + 4).toFixed(1) + '" y="' + (padT + 10) +
                     '" font-size="9" fill="#8b949e">TEST (frozen)</text>' +
                     '<text x="' + (X(testStart.trialStart) - 4).toFixed(1) + '" y="' + (padT + 10) +
                     '" font-size="9" fill="#8b949e" text-anchor="end">TRAIN</text>' : "") +
        band + lines + ticks + xTicks + '</svg>' +
        '<div class="legend">' + series.map(v => '<span><i style="background:' + COLORS[v] + '"></i>' + v + '</span>').join("") + '</div></div>';
    }).join("");
    const f2 = (v, ph, f, d) => {
      const st = (finals[v] || {})[ph] && (finals[v] || {})[ph][f];
      return st ? st.mean.toFixed(d) + " +/- " + st.ci.toFixed(d) + " (n=" + st.n + ")" : "-";
    };
    const tableRows = VARIANTS.map(v => '<tr><th>' + v + '</th>' +
      '<td>' + f2(v, "train", "goodCrossings", 2) + '</td><td>' + f2(v, "test", "goodCrossings", 2) + '</td>' +
      '<td>' + f2(v, "test", "goodBadRatio", 3) + '</td>' +
      '<td>' + f2(v, "test", "openFraction", 3) + '</td>' +
      '<td>' + f2(v, "test", "demonAgree", 3) + '</td></tr>').join("");
    const testsHtml = tests.length
      ? '<table><tr><th>comparison</th><th>metric</th><th>t</th><th>df</th><th>p (two-sided)</th></tr>' +
        tests.map(w => '<tr><td>' + esc(w.comparison) + '</td><td>' + w.metric + '</td><td>' +
                       w.t.toFixed(2) + '</td><td>' + w.df.toFixed(1) + '</td><td>' +
                       (w.p < 1e-4 ? w.p.toExponential(1) : w.p.toFixed(4)) + '</td></tr>').join("") +
        '</table><p class="note">Welch two-sided t test over per-seed final-TEST values; n = ' + NSEEDS +
        ' seeds per condition; df by Welch-Satterthwaite.</p>'
      : '<p class="note">no tests (need at least two conditions with n>=2 seeds).</p>';
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>E2/E3 batch report</title><style>' +
      'body{background:#0d1117;color:#e6edf3;font:13px/1.5 system-ui;margin:24px}' +
      'h1{font-size:19px} h2{font-size:15px;margin-top:26px} h3{font-size:13px;margin:8px 0 4px}' +
      '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:14px}' +
      '.panel{background:#10161d;border:1px solid #21262d;border-radius:8px;padding:10px}' +
      '.chart{width:100%;height:auto}.tag{font-weight:400;font-size:11px;color:#8b949e}' +
      '.legend span{margin-right:12px;font-size:11px}.legend i{display:inline-block;width:10px;height:10px;margin-right:4px;border-radius:2px}' +
      'table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #30363d;padding:4px 10px;font-size:12px;text-align:right}th{background:#161b22}' +
      '.note{color:#8b949e;font-size:12px;max-width:900px}' +
      '</style></head><body>' +
      '<h1>E2/E3 - ANN + Drosophila demons, seeded verification batch</h1>' +
      '<p class="note">' + NSEEDS + ' seeds x ' + VARIANTS.length + ' conditions | ' + TRAIN + '+' + TEST +
      ' trials x ' + EPISODE + 's | ' + NPART + ' particles. TRAIN plasticity ON, TEST FROZEN.' +
      ' The independent replicate is ONE SEED. CI = mean +/- 1.96*SEM. Determinism gate: ' +
      (NO_DETERMINISM ? 'SKIPPED (chunked mode)' : 'passed') + '.</p>' +
      '<h2>Final metrics (mean +/- 95% CI)</h2>' +
      '<table><tr><th>condition</th><th>final train good xings</th><th>final test good xings</th>' +
      '<th>final test good:bad</th><th>final test open frac</th><th>final test agreement</th></tr>' +
      tableRows + '</table>' +
      '<h2>Learning curves</h2><div class="grid">' + htmlPanels + '</div>' +
      '<h2>Welch t tests on final TEST metrics</h2>' + testsHtml +
      '</body></html>';
    const htmlPath = path.join(__dirname, "research_data", "e2_e3_batch_report_" + stamp + ".html");
    fs.writeFileSync(htmlPath, html);
    console.log("wrote " + htmlPath);
  }
}

if (require.main === module) main();

module.exports = { trialStats, factoryFor };
