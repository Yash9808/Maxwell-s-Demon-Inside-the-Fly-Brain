"use strict";
/**
 * validation_campaign_stagef.js — Stage F E4 preregistered campaign driver.
 *
 * Runs the E4 family (4A/4B/4C/frozen) at the retinotopic sparse-drive
 * operating point per PRE_REGISTRATION_STAGE_F_E4.json. Architecture copied
 * from validation_campaign.js; differences:
 *   - opticInput: "retinotopy" threaded to every job (implementation delta
 *     declared in the prereg JSON).
 *   - outputs under research_data/validation/stage_f/ (original artifacts
 *     untouched).
 *   - concurrency 12 (RAM headroom; each worker holds the 553,807-edge
 *     circuit; calibration peak ~1.6 GB/job).
 *
 *   node validation_campaign_stagef.js [--seeds N] [--shuffles K]
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const args = process.argv.slice(2);
function argVal(n, d) { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; }

const SEEDS = parseInt(argVal("seeds", "12"), 10) || 12;
const SHUFFLES = parseInt(argVal("shuffles", "10"), 10) || 10;
const OUT = path.join(__dirname, "research_data", "validation", "stage_f");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function buildJobs() {
  const jobs = [];
  const seedList = Array.from({ length: SEEDS }, (_, k) => k + 1);
  for (const arm of ["connectome_4A", "connectome_4B", "connectome_frozen"])
    for (const sd of seedList)
      jobs.push({ exp: "e4", arms: [arm], seedStart: sd, seedEnd: sd, opticInput: "retinotopy",
                  out: path.join(OUT, `part_${arm}_${sd}.csv`) });
  for (let k = 0; k < SHUFFLES; k++) {
    const seedList2 = Array.from({ length: SEEDS }, (_, i) => i + 1);
    for (const c of chunk(seedList2, 3))
      jobs.push({ exp: "e4", arms: ["connectome_4C"], seedStart: c[0], seedEnd: c[c.length - 1],
                  shuffleSeed: 1000 + k * 17, opticInput: "retinotopy",
                  out: path.join(OUT, `part_4C_s${1000 + k * 17}_${c[0]}.csv`) });
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
        [path.join(__dirname, "validation_worker.js"), JSON.stringify(job)],
        { stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      child.stdout.on("data", d => { out += d; });
      child.stderr.on("data", d => { err += d; });
      child.on("exit", (code) => {
        if (code === 0) {
          done++;
          console.log(`  [stagef] job ${done + failed}/${jobs.length} ok (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
        } else {
          failed++;
          console.error(`  [stagef] job FAILED (code ${code}): ${job.arms.join(",")} seeds ${job.seedStart}-${job.seedEnd} shuf${job.shuffleSeed || ""}\n    ${(err || out).split("\n").slice(-4).join(" ")}`);
        }
        launch();
        if (done + failed === jobs.length) resolve({ done, failed });
      });
    }
    for (let i = 0; i < Math.min(nProc, jobs.length); i++) launch();
  });
}

function mergeCsv() {
  const parts = fs.readdirSync(OUT).filter(f => f.startsWith("part_") && f.endsWith(".csv")).sort();
  const rows = [];
  let cols = null;
  for (const f of parts) {
    const txt = fs.readFileSync(path.join(OUT, f), "utf8").trim();
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
  fs.writeFileSync(path.join(OUT, "raw_e4_stagef.csv"),
    [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n") + "\n");
  return rows.length;
}

(async () => {
  const t0 = Date.now();
  const meta = {
    schema: "stage-f-campaign-meta/1.0",
    preregistration: "PRE_REGISTRATION_STAGE_F_E4.json",
    generated: new Date().toISOString(), stamp: STAMP,
    seeds: SEEDS, shuffles: SHUFFLES, opticInput: "retinotopy",
    implementation_delta: "validation_worker.js opticInput passthrough (prereg-declared)",
    codeVersion: "deployment/phase-02 @ f1d8c7d2 + declared worker delta",
    physicsUnchanged: true, no_seed_selection: true, no_outcome_exclusion: true,
    rowCounts: {}, runtimeS: {}, jobCounts: {},
  };
  console.log(`=== STAGE F E4 campaign · ${SEEDS} seeds · ${SHUFFLES} shuffle draws · opticInput=retinotopy ===`);
  const jobs = buildJobs();
  const te = Date.now();
  const res = await runPool(jobs);
  const n = mergeCsv();
  meta.jobCounts = res; meta.rowCounts.e4 = n;
  meta.runtimeS = Math.round((Date.now() - te) / 1000);
  console.log(`  merged ${n} rows -> research_data/validation/stage_f/raw_e4_stagef.csv`);
  fs.writeFileSync(path.join(OUT, "STAGE_F_CAMPAIGN_META.json"), JSON.stringify(meta, null, 2));
  console.log(`\nstage F campaign done in ${((Date.now() - t0) / 60000).toFixed(1)} min (ok=${res.done} failed=${res.failed})`);
})();
