"use strict";
/**
 * calibration_campaign_stagef.js — Stage F E4-CAL input-calibration sweep.
 *
 * Preregistration: PRE_REGISTRATION_STAGE_F_E4CAL.json (prospective; pinned
 * before any calibration-seed run; smoke mode on non-registered seed 999 is
 * the only pre-launch execution and its outcomes are never inspected).
 *
 * Modes:
 *   node calibration_campaign_stagef.js --smoke         # seed 999, tiny windows, _smoke/ output
 *   node calibration_campaign_stagef.js                 # the preregistered sweep
 *   node calibration_campaign_stagef.js --analyze-only  # re-run analysis + selection on existing CSV
 *
 * Fail-closed hash gate: the driver verifies the pinned preregistration input
 * hashes (sha256, first 16 hex) BEFORE any job runs; mismatch exits 1.
 * Analysis runs twice from independently re-parsed data; any difference is
 * reported (deterministic_rerun=false), never hidden. Outputs live only in
 * research_data/validation/stage_f_cal/; no other campaign's artifacts are
 * touched. No inferential statistics are computed (measurement + selection).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const args = process.argv.slice(2);
const SMOKE = args.includes("--smoke");
const ANALYZE_ONLY = args.includes("--analyze-only");
const OUT = path.join(__dirname, "research_data", "validation", "stage_f_cal");
const OUT_SMOKE = path.join(__dirname, "research_data", "validation", "stage_f_cal", "_smoke");
const RAW = path.join(OUT, "raw_e4cal.csv");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// ---- preregistered design (must equal PRE_REGISTRATION_STAGE_F_E4CAL.json)
const PINNED_HASHES = {
  "fly_brain_circuit.json": "0eb64ba451356563",
  "controllers.js": "72ef49138c5a7b10",
  "experiment_core.js": "7fb11e3155214d50",
  "p1_retinotopy.js": "31765c5a30bbe9e9",
  "fly_brain_retinotopy.json": "164f7f37460fb526",
};
const CELLS = [
  { name: "cal_od0p5_md0p35", opticDrive: 0.5, motorDrive: 0.35 },
  { name: "cal_od1p0_md0p35", opticDrive: 1.0, motorDrive: 0.35 },
  { name: "cal_od2p0_md0p35", opticDrive: 2.0, motorDrive: 0.35 },
  { name: "cal_od4p0_md0p35", opticDrive: 4.0, motorDrive: 0.35 },
  { name: "cal_od2p0_md0p10", opticDrive: 2.0, motorDrive: 0.10 },
  { name: "cal_od2p0_md0p20", opticDrive: 2.0, motorDrive: 0.20 },
  { name: "cal_od0p25_md0p35_anchor", opticDrive: 0.25, motorDrive: 0.35 },
];
const CAL_SEEDS = [13, 14, 15, 16];
const LEGACY_SCORE = 0.334;
// selection rule (verbatim from the prereg JSON)
const BAND_LO = 0.20, BAND_HI = 0.40, CROSS_GATE = 0.50, BELOW_BAND_MIN = 0.10;

function sha16(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, file))).digest("hex").slice(0, 16);
}
function hashGate() {
  const bad = [];
  for (const [f, h] of Object.entries(PINNED_HASHES)) {
    const got = sha16(f);
    if (got !== h) bad.push(`${f}: pinned ${h} vs live ${got}`);
  }
  if (bad.length) {
    console.error("HASH GATE FAILED — code differs from the preregistered pin; refusing to run:");
    for (const b of bad) console.error("  " + b);
    process.exit(1);
  }
  console.log("hash gate: all " + Object.keys(PINNED_HASHES).length + " pinned inputs match the preregistration");
}
function selfHash() {
  const h = f => crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, f))).digest("hex");
  return { "calibration_campaign_stagef.js": h("calibration_campaign_stagef.js"),
           "validation_worker_stagefcal.js": h("validation_worker_stagefcal.js") };
}

// ---- job builder
function buildJobs() {
  const jobs = [];
  const dir = SMOKE ? OUT_SMOKE : OUT;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const seedList = SMOKE ? [999] : CAL_SEEDS;
  for (const cell of CELLS) {
    for (const sd of seedList) {
      jobs.push({ exp: "e4cal", cellName: cell.name,
                  opticDrive: cell.opticDrive, motorDrive: cell.motorDrive,
                  seedStart: sd, seedEnd: sd,
                  out: path.join(dir, `part_${cell.name}_${sd}.csv`) });
    }
  }
  const pending = jobs.filter(j => !fs.existsSync(j.out));
  const skipped = jobs.length - pending.length;
  if (skipped) console.log(`  (${skipped} jobs already done, resuming)`);
  return pending;
}

function runPool(jobs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let next = 0, done = 0, failed = 0;
    const nProc = 12;
    function launch() {
      if (next >= jobs.length) return;
      const job = jobs[next++];
      const child = spawn(process.execPath,
        [path.join(__dirname, "validation_worker_stagefcal.js"), JSON.stringify(job), ...(SMOKE ? ["--smoke"] : [])],
        { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", d => { out += d; });
      child.stderr.on("data", d => { err += d; });
      child.on("exit", (code) => {
        if (code === 0) {
          done++;
          console.log(`  [e4cal] job ${done + failed}/${jobs.length} ok (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
        } else {
          failed++;
          console.error(`  [e4cal] job FAILED (code ${code}): ${job.cellName} seed ${job.seedStart}\n    ${(err || out).split("\n").slice(-4).join(" ")}`);
        }
        launch();
        if (done + failed === jobs.length) resolve({ done, failed });
      });
    }
    for (let i = 0; i < Math.min(nProc, jobs.length); i++) launch();
  });
}

function mergeCsv(dir, outFile) {
  const parts = fs.readdirSync(dir).filter(f => f.startsWith("part_") && f.endsWith(".csv")).sort();
  const rows = [];
  let cols = null;
  for (const f of parts) {
    const txt = fs.readFileSync(path.join(dir, f), "utf8").trim();
    if (!txt) continue;
    const ls = txt.split("\n");
    cols = ls[0].split(",");
    for (let i = 1; i < ls.length; i++) {
      const vals = ls[i].split(",");
      const r = {};
      cols.forEach((c, j) => { r[c] = vals[j]; });
      rows.push(r);
    }
  }
  if (!rows.length) return 0;
  const esc = v => (v === undefined || v === null) ? "" :
    /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
  fs.writeFileSync(outFile, [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n") + "\n");
  return rows.length;
}

// ---- preregistered analysis + selection (pure; run twice for determinism)
function parseCsvFile(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  const cols = lines[0].split(",");
  return lines.slice(1).map(l => {
    const vals = l.split(","), r = {};
    cols.forEach((c, i) => { r[c] = vals[i]; });
    return r;
  });
}
function analyze() {
  const data = parseCsvFile(RAW).map(r => ({
    condition: r.condition, seed: Number(r.seed), phase: r.phase,
    openFraction: Number(r.openFraction),
    goodCrossings: Number(r.goodCrossings), badCrossings: Number(r.badCrossings),
  }));
  // coverage check: every cell x seed must have exactly 144 rows
  const cov = {};
  for (const r of data) {
    const key = `${r.condition}|${r.seed}`;
    cov[key] = (cov[key] || 0) + 1;
  }
  const expectedCells = SMOKE ? 0 : CELLS.length, expectedSeeds = SMOKE ? 0 : CAL_SEEDS.length;
  const bad = Object.entries(cov).filter(([k, n]) => n < 144);
  const nCells = new Set(data.map(r => r.condition)).size;
  const cells = {};
  for (const cell of CELLS) {
    const rows = data.filter(r => r.condition === cell.name);
    if (!rows.length) { cells[cell.name] = { present: false }; continue; }
    const testRows = rows.filter(r => r.phase === "test");
    const perSeed = [...new Set(testRows.map(r => r.seed))].sort((a, b) => a - b).map(sd => {
      const rs = testRows.filter(r => r.seed === sd);
      const open = rs.map(r => r.openFraction).filter(Number.isFinite);
      const withCross = rs.filter(r => (r.goodCrossings + r.badCrossings) > 0).length;
      return { seed: sd, openFraction: open.reduce((a, v) => a + v, 0) / open.length,
               trialsWithCrossing: withCross / rs.length,
               crossingsPerTrial: rs.reduce((a, r) => a + r.goodCrossings + r.badCrossings, 0) / rs.length };
    });
    const score = perSeed.reduce((a, x) => a + x.openFraction, 0) / perSeed.length;
    const crossGate = perSeed.reduce((a, x) => a + x.trialsWithCrossing, 0) / perSeed.length;
    cells[cell.name] = { present: true, opticDrive: cell.opticDrive, motorDrive: cell.motorDrive,
      score, crossingGate: crossGate, viable: score >= BAND_LO && score <= BAND_HI && crossGate >= CROSS_GATE,
      perSeed };
  }
  // selection rule — applied verbatim
  let decision, selected = null;
  const viable = CELLS.map(c => cells[c.name]).filter(c => c.present && c.viable);
  if (viable.length) {
    decision = "CALIBRATED";
    viable.sort((a, b) => Math.abs(a.score - LEGACY_SCORE) - Math.abs(b.score - LEGACY_SCORE) ||
      a.opticDrive - b.opticDrive || a.motorDrive - b.motorDrive);
    const best = viable[0];
    selected = { name: CELLS.find(c => c.opticDrive === best.opticDrive && c.motorDrive === best.motorDrive).name,
      opticDrive: best.opticDrive, motorDrive: best.motorDrive, score: best.score };
  } else {
    const some = CELLS.map(c => cells[c.name]).filter(c => c.present && c.score >= BELOW_BAND_MIN && c.crossingGate >= CROSS_GATE);
    decision = some.length ? "BELOW_BAND" : "NO_CANDIDATE";
  }
  return {
    preregistration: "PRE_REGISTRATION_STAGE_F_E4CAL.json",
    coverage: { rows: data.length, cells: nCells, expectedRows: expectedCells * expectedSeeds * 144,
      cellsBelow144: bad.length ? bad : "none" },
    cells, decision, selected,
    selection_rule: { band: [BAND_LO, BAND_HI], crossingGate: CROSS_GATE, legacyScore: LEGACY_SCORE,
      belowBandMin: BELOW_BAND_MIN },
    smokeMode: SMOKE,
  };
}

(async () => {
  const t0 = Date.now();
  if (!ANALYZE_ONLY) {
    hashGate();
    console.log(`=== STAGE F E4-CAL calibration sweep${SMOKE ? " · SMOKE (seed 999, non-registered)" : " · preregistered grid"} ===`);
    const meta = {
      schema: "stage-f-e4cal-campaign-meta/1.0",
      preregistration: "PRE_REGISTRATION_STAGE_F_E4CAL.json",
      generated: new Date().toISOString(), stamp: STAMP,
      mode: SMOKE ? "smoke (seed 999, non-registered, reduced windows; outcomes never inspected)" : "preregistered sweep",
      seeds: SMOKE ? [999] : CAL_SEEDS, cells: CELLS.length,
      codeVersion: "deployment/phase-02 + additive calibration driver (prereg-declared)",
      driver_worker_sha256: selfHash(),
      pinned_inputs_verified: true, physicsUnchanged: true,
      no_seed_selection: true, no_outcome_exclusion: true,
      jobCounts: {}, rowCounts: {}, runtimeS: 0,
    };
    const jobs = buildJobs();
    const te = Date.now();
    const res = await runPool(jobs);
    const n = SMOKE ? mergeCsv(OUT_SMOKE, path.join(OUT_SMOKE, "raw_e4cal_smoke.csv")) : mergeCsv(OUT, RAW);
    meta.jobCounts = res; meta.rowCounts.e4cal = n;
    meta.runtimeS = Math.round((Date.now() - te) / 1000);
    console.log(`  merged ${n} rows -> ${SMOKE ? "_smoke/raw_e4cal_smoke.csv" : "raw_e4cal.csv"}`);
    fs.writeFileSync(path.join(OUT, "STAGE_F_E4CAL_CAMPAIGN_META.json"), JSON.stringify(meta, null, 2));
  }
  if (SMOKE) {
    console.log("smoke done — outcome values not inspected, as declared");
    return;
  }
  // analysis (twice, deterministic-rerun gate)
  const r1 = analyze(), r2 = analyze();
  const deterministic = JSON.stringify(r1) === JSON.stringify(r2);
  const result = Object.assign({}, r1, { deterministic_rerun: deterministic,
    generated: new Date().toISOString(), stamp: STAMP,
    driver_worker_sha256: selfHash() });
  fs.writeFileSync(path.join(OUT, "STAGE_F_E4CAL_RESULT.json"), JSON.stringify(result, null, 2));
  console.log("=== STAGE F E4-CAL — preregistered analysis ===");
  console.log(`coverage: ${JSON.stringify(result.coverage)}`);
  for (const [k, c] of Object.entries(result.cells)) {
    if (!c.present) { console.log(`${k.padEnd(26)} MISSING`); continue; }
    console.log(`${k.padEnd(26)} score ${c.score.toFixed(4)}  crossGate ${c.crossingGate.toFixed(3)}  viable ${c.viable}`);
  }
  console.log(`DECISION: ${result.decision}${result.selected ? ` — selected ${result.selected.name} (od ${result.selected.opticDrive}, md ${result.selected.motorDrive}, score ${result.selected.score.toFixed(4)})` : ""}`);
  console.log(`deterministic_rerun: ${deterministic}`);
})();
