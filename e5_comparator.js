#!/usr/bin/env node
"use strict";
/**
 * e5_comparator.js — C-6 (build-plan row 14): E5 formal multi-controller
 * comparator on IDENTICAL seeds.
 *
 * THE E5 DESIGN PROPERTY (what makes this the comparator): one
 * runBenchmark call PER SEED carrying ALL SEVEN controllers. Inside
 * runBenchmark, every controller of a seed gets the SAME makeEnvironment
 * draw (same gas noise stream, same jet sequence, same door band), so any
 * two controllers' per-seed outcomes are PAIRED by construction. The
 * environment IS the controlled variable; contrasts below are per-seed
 * paired tests (permutation + Hedges g), not unpaired across different
 * runs like the single-experiment validators.
 *
 * CONTROLLERS (production defaults, worker-config style; no tuning):
 *   classical_demon  — classical speed-selective rule (analytical reference)
 *   random           — random controller (floor)
 *   never_gate       — door never opens (subsidy floor)
 *   ann              — E2 ANN demon
 *   drosophila       — E3 Drosophila-inspired network
 *   connectome_4A    — REAL FAFB connectome, full plasticity
 *   connectome_4B    — REAL FAFB connectome, restricted plasticity
 *
 * PROTOCOL: TRAIN (plasticity ON) -> FROZEN TEST (runBenchmark phase loop).
 * STATISTICS: per-seed paired contrasts on final-TEST metrics — exact-ish
 * permutation (stats_utils.permutationTestPaired, seeded) + Hedges g
 * (paired) + Holm correction across the registered family; block curves
 * per condition for the report; determinism gate (same seed -> identical
 * rows). No tuning, no seed selection, no discarding.
 *
 * ARTIFACTS: e5_comparator_<stamp>.jsonl + _summary.json (+ report) and
 * the C-3 dataset pair e5_dataset_<stamp>.csv + .manifest.json.
 *
 * CLI: node e5_comparator.js [--seeds 12] [--base 1] [--b 4]
 *      [--train 30] [--test 10] [--episode 12] [--particles 320]
 *      [--no-html] [--no-determinism] [--selftest]
 */

const fs = require("fs");
const path = require("path");
const CORE = require("./experiment_core.js");
const CTRL = require("./controllers.js");
const SU = require("./stats_utils.js");
const circuit = require("./fly_brain_circuit.json");

// ---- CLI -------------------------------------------------------------------
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}
const hasFlag = (name) => args.includes("--" + name);

const SEEDS   = Math.max(1, parseInt(argVal("seeds", "12"), 10) || 12);
const BASE    = parseInt(argVal("base", "1"), 10) || 1;
const TRAIN   = parseInt(argVal("train", "30"), 10) || 30;
const TEST    = parseInt(argVal("test", "10"), 10) || 10;
const EPISODE = parseInt(argVal("episode", "12"), 10) || 12;
const NPART   = parseInt(argVal("particles", "320"), 10) || 320;
const B       = Math.max(1, parseInt(argVal("b", "4"), 10) || 4);
const WANT_HTML = !hasFlag("no-html");
const NO_DETERMINISM = hasFlag("no-determinism");

const CONTROLLERS = ["classical_demon", "random", "never_gate",
                     "ann", "drosophila", "connectome_4A", "connectome_4B"];

const r6 = (x) => Math.round(x * 1e6) / 1e6;

function controllerFactories() {
  return {
    classical_demon: (rng, env, cfg) => CTRL.classicalDemon(rng, env, cfg),
    random:          (rng, env) => CTRL.randomController(rng, env),
    never_gate:      (rng, env, cfg) => CTRL.neverGateController(rng, env, cfg),
    ann:             (rng, env, cfg) => CTRL.annController(rng, env, cfg),
    drosophila:      (rng, env, cfg) => CTRL.drosophilaController(rng, env, cfg),
    connectome_4A:   (rng) => CTRL.connectomeController(circuit,
      { shuffle: false, rng, seed: 1, opticDrive: 0.25, plasticity: "full" }),
    connectome_4B:   (rng) => CTRL.connectomeController(circuit,
      { shuffle: false, rng, seed: 1, opticDrive: 0.25, plasticity: "restricted" }),
  };
}

// ---- selftest ----------------------------------------------------------------
if (hasFlag("selftest")) {
  // paired machinery against hand-computed cases (canonical stats_utils
  // conventions: constant diffs -> exact sign-flip p = 2/2^n family;
  // consistent signal diffs -> small p, large |g|)
  const diffs = [-2, -2, -2, -2, -2, -2];
  const perm = SU.permutationTestPaired(diffs, { nPerm: 5000, seed: 7 });
  const okP = perm.method === "exact-sign-flip" && Math.abs(perm.p - 0.03125) < 1e-9;
  const diffs2 = [-2, -1, -2, -3, -2, -2];
  const perm2 = SU.permutationTestPaired(diffs2, { nPerm: 5000, seed: 7 });
  const g2 = SU.hedgesGPaired(diffs2);
  const ok2 = perm2.p < 0.05 && g2 < -1;
  const holm = SU.holm([0.01, 0.04, 0.03]);
  const okH = holm[0] <= holm[1] && holm[1] <= holm[2];
  console.log("selftest paired perm (constant diffs -> exact sign-flip p=0.03125): " + (okP ? "OK" : "FAIL"));
  console.log("selftest paired perm+g (signal diffs -> p<0.05, g<-1): " + (ok2 ? "OK" : "FAIL"));
  console.log("selftest holm monotone: " + (okH ? "OK" : "FAIL"));
  process.exit(okP && ok2 && okH ? 0 : 1);
}

// ---- statistics helpers (top-level: exported) ---------------------------------
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

// ---- main -----------------------------------------------------------------------
function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rows = [];
  const perSeed = {};
  for (const v of CONTROLLERS) perSeed[v] = [];
  console.log("E5 comparator: " + SEEDS + " seeds x " + CONTROLLERS.length +
              " controllers ON IDENTICAL gas per seed, " + TRAIN + "+" + TEST +
              " trials x " + EPISODE + "s x " + NPART + " particles");
  console.log("controllers: " + CONTROLLERS.join(", "));
  const t0 = Date.now();
  for (let s = 0; s < SEEDS; s++) {
    const seed = BASE + s * 101;
    const tS = Date.now();
    CORE.runBenchmark({
      seed, nSeeds: 1,
      trialsTrain: TRAIN, trialsTest: TEST,
      episodeSeconds: EPISODE, dt: 1 / 60,
      nParticles: NPART, maxCrossingsPerTrial: 50,
      controllers: controllerFactories(),        // ALL controllers, ONE env draw
      onTrialData: (cond, phase, tr) => {
        const row = Object.assign({}, tr, { condition: cond, phase, seedTag: s + 1 });
        delete row.fireVec;
        rows.push(row);
      },
    });
    console.log("  seed " + (s + 1) + "/" + SEEDS + " (rng " + seed + ") done in " +
                ((Date.now() - tS) / 1000).toFixed(1) + " s");
  }
  const elapsed = (Date.now() - t0) / 1000;

  // ---- determinism gate --------------------------------------------------------
  if (!NO_DETERMINISM) {
    const rerun = [];
    CORE.runBenchmark({
      seed: BASE, nSeeds: 1,
      trialsTrain: TRAIN, trialsTest: TEST,
      episodeSeconds: EPISODE, dt: 1 / 60,
      nParticles: NPART, maxCrossingsPerTrial: 50,
      controllers: controllerFactories(),
      onTrialData: (cond, phase, tr) => {
        const row = Object.assign({}, tr, { condition: cond, phase });
        delete row.fireVec;
        rerun.push(row);
      },
    });
    const fields = ["crossings", "goodCrossings", "badCrossings", "openFraction",
                    "demonAgree", "dTfinal", "energyJ"];
    let same = true, badAt = null;
    for (const cond of CONTROLLERS) {
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

  // ---- per-replicate finals ------------------------------------------------------
  {
    const tags = [...new Set(rows.map(r => r.seedTag))].sort((a, b) => a - b);
    for (const v of CONTROLLERS) {
      for (const tg of tags) {
        const vr = rows.filter(r => r.condition === v && r.seedTag === tg);
        const lastTrain = [...vr].reverse().find(r => r.phase === "train");
        const lastTest  = [...vr].reverse().find(r => r.phase === "test");
        if (lastTrain) perSeed[v].push({ seed: tg, phase: "train", rec: lastTrain });
        if (lastTest)  perSeed[v].push({ seed: tg, phase: "test",  rec: lastTest });
      }
    }
  }

  const stats = trialStats(rows, B);

  const FINAL_FIELDS = ["crossings", "goodCrossings", "badCrossings", "openFraction",
                        "demonAgree", "dTfinal", "sortEntropy", "spatialH", "miNeural",
                        "energyJ", "workInJ", "extractableJ", "erasureCostJ",
                        "landauerRatio", "measuredBits", "goodBadRatio"];
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
  const finals = Object.fromEntries(CONTROLLERS.map(v => [v, finalSummary(v)]));

  // ---- PAIRED contrasts (the E5 point): same seed, same gas -----------------------
  const registered = [];
  {
    const PAIRS = [
      ["ann", "random"], ["drosophila", "random"],
      ["connectome_4A", "random"], ["connectome_4B", "random"],
      ["ann", "classical_demon"], ["drosophila", "classical_demon"],
      ["connectome_4A", "classical_demon"], ["connectome_4B", "classical_demon"],
      ["connectome_4A", "connectome_4B"], ["ann", "drosophila"],
    ];
    for (const metric of ["goodCrossings", "goodBadRatio", "openFraction"]) {
      for (const [a, b] of PAIRS) {
        const recsA = (perSeed[a] || []).filter(x => x.phase === "test");
        const recsB = (perSeed[b] || []).filter(x => x.phase === "test");
        const bBy = new Map(recsB.map(x => [x.seed, x.rec[metric]]));
        const diffs = [];
        for (const x of recsA) {
          const bv = bBy.get(x.seed);
          if (bv === null || bv === undefined || !Number.isFinite(bv)) continue;
          const av = x.rec[metric];
          if (!Number.isFinite(av)) continue;
          diffs.push(av - bv);
        }
        if (diffs.length < 2) continue;
        const perm = SU.permutationTestPaired(diffs, { nPerm: 10000, seed: 20260926 });
        const g = SU.hedgesGPaired(diffs);
        const md = diffs.reduce((x, y) => x + y, 0) / diffs.length;
        registered.push({ metric, comparison: a + " - " + b + " (paired, final TEST)",
                          n: diffs.length, meanDiff: r6(md),
                          hedgesG: Number.isFinite(g) ? r6(g) : null,
                          p: perm.p, method: perm.method });
      }
    }
    // Holm correction across the registered family (per metric)
    for (const metric of ["goodCrossings", "goodBadRatio", "openFraction"]) {
      const fam = registered.filter(t => t.metric === metric);
      const adj = SU.holm(fam.map(t => t.p));
      fam.forEach((t, i) => { t.p_holm = r6(adj[i]); });
    }
  }

  // ---- console report ---------------------------------------------------------------
  const fmt = (st, d) => st ? st.mean.toFixed(d) + " +/- " + st.ci.toFixed(d) + " (n=" + st.n + ")" : "-";
  console.log("\n" + SEEDS + " seeds | " + TRAIN + "+" + TEST + " trials | " + EPISODE +
              "s episodes | " + NPART + " particles | " + rows.length + " rows | " +
              elapsed.toFixed(0) + " s");
  console.log("\n== FINAL TEST metrics (mean +/- 95% CI over seeds; IDENTICAL gas per seed) ==");
  for (const v of CONTROLLERS) {
    const F = finals[v];
    console.log("  " + v.padEnd(16) +
      " good " + fmt(F.test && F.test.goodCrossings, 2).padEnd(24) +
      " good:bad " + fmt(F.test && F.test.goodBadRatio, 3).padEnd(22) +
      " openFrac " + fmt(F.test && F.test.openFraction, 3));
  }
  console.log("\n== PAIRED contrasts (same seed, same gas; permutation + Hedges g; Holm-corrected per metric) ==");
  for (const t of registered)
    console.log("  " + t.comparison + " - " + t.metric + ": d=" + t.meanDiff.toFixed(3) +
                ", g=" + (t.hedgesG === null ? "-" : t.hedgesG.toFixed(2)) +
                ", p=" + (t.p < 1e-4 ? t.p.toExponential(1) : t.p.toFixed(4)) +
                ", p_holm=" + (t.p_holm < 1e-4 ? t.p_holm.toExponential(1) : t.p_holm.toFixed(4)));

  // ---- artifacts -----------------------------------------------------------------------
  fs.mkdirSync(path.join(__dirname, "research_data"), { recursive: true });
  const jsonl = path.join(__dirname, "research_data", "e5_comparator_" + stamp + ".jsonl");
  fs.writeFileSync(jsonl, rows.map(r => JSON.stringify(r)).join("\n"));
  const summaryPath = path.join(__dirname, "research_data", "e5_comparator_" + stamp + "_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify({
    provenance: {
      experiment: "e5", phase: "C-6", kind: "comparator",
      question: "How do all demon controllers compare on IDENTICAL environments and seeds, with paired uncertainty?",
      seeds: SEEDS, seedBase: BASE, seedStride: 101,
      trainTrials: TRAIN, testTrials: TEST, episodeSeconds: EPISODE,
      nParticles: NPART, blockB: B, controllers: CONTROLLERS,
      paired_design: "one runBenchmark call per seed carries ALL controllers -> identical makeEnvironment draw (gas noise stream, jet sequence, door band) per seed; contrasts are per-seed paired",
      engine: "experiment_core.js runBenchmark (UNTOUCHED): train plasticity ON, test FROZEN",
      determinism: NO_DETERMINISM ? "gate skipped" : "same-seed rerun identical (gate passed)",
      startedISO: new Date(Date.now() - elapsed * 1000).toISOString(),
      elapsedSeconds: Math.round(elapsed * 1e6) / 1e6,
    },
    finals, pairedContrasts: registered,
  }, null, 2));
  console.log("\nwrote " + jsonl + " (" + rows.length + " rows)");
  console.log("wrote " + summaryPath);

  // ---- C-3 standardized dataset export ---------------------------------------------------
  {
    const DX = require("./dataset_export.js");
    const dsRows = rows.map(r => Object.assign({}, r, { experiment: "e5" }));
    const ds = DX.exportRun({
      experiment: "e5",
      label: "E5 formal comparator - all controllers on identical seeds/gas (C-6)",
      question: "How do all demon controllers compare on identical environments, with paired per-seed uncertainty?",
      protocol: "TRAIN (plasticity ON) -> FROZEN EVAL; PAIRED by construction (one env draw per seed, all controllers); no seeds discarded",
      config: { seeds: SEEDS, seedBase: BASE, seedStride: 101, trainTrials: TRAIN,
                testTrials: TEST, episodeSeconds: EPISODE, nParticles: NPART,
                controllers: CONTROLLERS,
                engine: "experiment_core.js runBenchmark (unmodified)" },
      conditions: CONTROLLERS,
    }, dsRows);
    console.log("dataset: " + ds.csvPath);
    console.log("dataset manifest: " + ds.manifestPath + " (sha256 " + ds.sha256.slice(0, 16) + "...)");
  }

  // ---- HTML report -------------------------------------------------------------------
  if (WANT_HTML) {
    const PANELS = [
      ["goodCrossings", "Good crossings per trial (primary)", v => v.toFixed(1)],
      ["openFraction",  "Door open fraction vs trial",        v => (v * 100).toFixed(0) + "%"],
      ["demonAgree",    "Demon agreement vs trial",           v => (v * 100).toFixed(0) + "%"],
    ];
    const COLORS = { classical_demon: "#55a868", random: "#8c8c8c", never_gate: "#3d3d3d",
                     ann: "#4c72b0", drosophila: "#dd8452",
                     connectome_4A: "#c44e52", connectome_4B: "#b0813a" };
    const series = CONTROLLERS.filter(v => COLORS[v]);
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const htmlPanels = PANELS.map(([f, label, fmtV]) => {
      const allPts = stats.filter(s => s.condition === series[0]);
      if (!allPts.length) return "";
      const W = 430, H = 240, padL = 50, padR = 10, padT = 12, padB = 24;
      const xlo = 0, xhi = Math.max(...allPts.map(s => s.trialEnd)) + 1;
      let ylo = Infinity, yhi = -Infinity;
      for (const s of stats) {
        const st = s[f]; if (!st) continue;
        ylo = Math.min(ylo, st.mean - st.ci); yhi = Math.max(yhi, st.mean + st.ci);
      }
      if (!Number.isFinite(ylo)) return "";
      if (yhi === ylo) { yhi = ylo + 1; ylo -= 0.5; }
      const X = x => padL + (x - xlo) / Math.max(1e-9, xhi - xlo) * (W - padL - padR);
      const Y = y => padT + (1 - (y - ylo) / (yhi - ylo)) * (H - padT - padB);
      const testStart = allPts.find(s => s.phase === "test");
      const lines = series.map(v => {
        const pts = stats.filter(s => s.condition === v && s[f]);
        let dd = "", pen = false;
        for (const s of pts) {
          const x = (s.trialStart + s.trialEnd) / 2, y = s[f].mean;
          dd += (pen ? "L" : "M") + X(x).toFixed(1) + "," + Y(y).toFixed(1) + " "; pen = true;
        }
        return dd ? '<path d="' + dd + '" fill="none" stroke="' + COLORS[v] + '" stroke-width="1.6"/>' : "";
      }).join("");
      const ticks = [0, 0.25, 0.5, 0.75, 1].map(fr =>
        '<text x="4" y="' + (padT + (1 - fr) * (H - padT - padB) + 3).toFixed(1) +
        '" font-size="9" fill="#6a737d">' + fmtV(ylo + fr * (yhi - ylo)) + '</text>').join("");
      const xTicks = [0, 0.5, 1].map(fr => {
        const xv = xlo + fr * (xhi - xlo);
        return '<text x="' + X(xv).toFixed(1) + '" y="' + (H - 8) +
               '" font-size="9" fill="#6a737d" text-anchor="middle">' + Math.round(xv) + '</text>';
      }).join("");
      return '<div class="panel"><h3>' + esc(label) +
        ' <span class="tag">all controllers, n=' + SEEDS + ' seeds, paired gas</span></h3>' +
        '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart">' +
        '<rect x="' + padL + '" y="' + padT + '" width="' + (W - padL - padR) + '" height="' + (H - padT - padB) +
        '" fill="none" stroke="#30363d"/>' +
        (testStart ? '<line x1="' + X(testStart.trialStart).toFixed(1) + '" y1="' + padT +
                     '" x2="' + X(testStart.trialStart).toFixed(1) + '" y2="' + (H - padB) +
                     '" stroke="#8b949e" stroke-dasharray="4 4" opacity=".6"/>' : "") +
        lines + ticks + xTicks + '</svg>' +
        '<div class="legend">' + series.map(v => '<span><i style="background:' + COLORS[v] + '"></i>' + v + '</span>').join("") + '</div></div>';
    }).join("");
    const f2 = (v, f, d) => {
      const st = (finals[v] || {}).test && (finals[v] || {}).test[f];
      return st ? st.mean.toFixed(d) + " +/- " + st.ci.toFixed(d) : "-";
    };
    const tableRows = CONTROLLERS.map(v => '<tr><th>' + v + '</th>' +
      '<td>' + f2(v, "goodCrossings", 2) + '</td><td>' + f2(v, "goodBadRatio", 3) + '</td>' +
      '<td>' + f2(v, "openFraction", 3) + '</td><td>' + f2(v, "dTfinal", 3) + '</td></tr>').join("");
    const testsHtml = '<table><tr><th>contrast (paired)</th><th>metric</th><th>mean diff</th><th>Hedges g</th><th>p</th><th>p_holm</th></tr>' +
      registered.map(t => '<tr><td>' + esc(t.comparison) + '</td><td>' + t.metric + '</td><td>' +
        t.meanDiff.toFixed(3) + '</td><td>' + (t.hedgesG === null ? "-" : t.hedgesG.toFixed(2)) + '</td><td>' +
        (t.p < 1e-4 ? t.p.toExponential(1) : t.p.toFixed(4)) + '</td><td>' +
        (t.p_holm < 1e-4 ? t.p_holm.toExponential(1) : t.p_holm.toFixed(4)) + '</td></tr>').join("") +
      '</table><p class="note">Per-seed paired permutation tests (10k, seeded) + Hedges g (paired); Holm-corrected within each metric family. n = ' + SEEDS + ' seeds.</p>';
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>E5 comparator report</title><style>' +
      'body{background:#0d1117;color:#e6edf3;font:13px/1.5 system-ui;margin:24px}' +
      'h1{font-size:19px} h2{font-size:15px;margin-top:26px} h3{font-size:13px;margin:8px 0 4px}' +
      '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:14px}' +
      '.panel{background:#10161d;border:1px solid #21262d;border-radius:8px;padding:10px}' +
      '.chart{width:100%;height:auto}.tag{font-weight:400;font-size:11px;color:#8b949e}' +
      '.legend span{margin-right:12px;font-size:11px}.legend i{display:inline-block;width:10px;height:10px;margin-right:4px;border-radius:2px}' +
      'table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #30363d;padding:4px 10px;font-size:12px;text-align:right}th{background:#161b22}' +
      '.note{color:#8b949e;font-size:12px;max-width:900px}' +
      '</style></head><body>' +
      '<h1>E5 - formal comparator: all controllers on IDENTICAL seeds and gas</h1>' +
      '<p class="note">' + SEEDS + ' seeds x ' + CONTROLLERS.length + ' controllers | ' + TRAIN + '+' + TEST +
      ' trials x ' + EPISODE + 's. One runBenchmark call per seed carries ALL controllers: every controller' +
      ' faces the SAME gas draw, jet sequence and door band - contrasts are per-seed PAIRED. TRAIN plasticity ON,' +
      ' TEST FROZEN. Determinism gate: ' + (NO_DETERMINISM ? 'SKIPPED' : 'passed') + '.</p>' +
      '<h2>Final TEST metrics (mean +/- 95% CI)</h2>' +
      '<table><tr><th>controller</th><th>good crossings</th><th>good:bad</th><th>open frac</th><th>dT final</th></tr>' +
      tableRows + '</table>' +
      '<h2>Learning curves</h2><div class="grid">' + htmlPanels + '</div>' +
      '<h2>Paired contrasts</h2>' + testsHtml +
      '</body></html>';
    const htmlPath = path.join(__dirname, "research_data", "e5_comparator_report_" + stamp + ".html");
    fs.writeFileSync(htmlPath, html);
    console.log("wrote " + htmlPath);
  }
}

if (require.main === module) main();

module.exports = { trialStats };
