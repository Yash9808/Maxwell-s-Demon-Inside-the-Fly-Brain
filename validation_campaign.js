"use strict";
/**
 * validation_campaign.js — Agent 3 multi-seed validation campaign driver.
 *
 * Parallelizes (arm x seed-chunk) jobs across validation_worker.js children.
 * Determinism is unaffected: each job re-creates its controllers from the
 * same seed rule the cores use (seed = seedStart + k*101 for door tasks,
 * seed = 1 + (s-1)*101 for apparatus).
 *
 *   node validation_campaign.js --exp e3,e4,e9,e10,e11 [--seeds N] [--shuffles K]
 *
 * Outputs (research_data/validation/):
 *   raw_{exp}.csv   one row per episode (raw replicate data, all seeds)
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const args = process.argv.slice(2);
function argVal(n, d) { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; }
const WANT = (argVal("exp", "e3,e4,e9,e10,e11")).split(",").map(s => s.trim()).filter(Boolean);
const OUT = path.join(__dirname, "research_data", "validation");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const SEEDS = { e3: 20, e4: 12, e9: 20, e10: 12, e11: 12 };

function chunk5(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
function buildJobs(exp, seeds, shuffles) {
  const nProc = Math.max(2, Math.min(16, require("os").cpus().length - 2));
  const jobs = [];
  const chunk = (list) => {
    const per = Math.ceil(list.length / Math.min(nProc, list.length));
    const out = [];
    for (let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per));
    return out;
  };
  if (exp === "e3") {
    const seedList = Array.from({ length: seeds }, (_, k) => k + 1);
    const arms3 = ["drosophila", "drosophila_frozen", "random", "classical_demon"];
    // one job per (arm, 5-seed chunk): ~52 s/seed/arm keeps jobs < 300 s
    for (const arm of arms3)
      for (const c of chunk5(seedList, 5))
        jobs.push({ exp, arms: [arm], seedStart: c[0], seedEnd: c[c.length - 1],
                    out: path.join(OUT, `part_${exp}_${arm}_${c[0]}.csv`) });
  } else if (exp === "e4") {
    const seedList = Array.from({ length: seeds }, (_, k) => k + 1);
    // one job per (arm, seed): ~115 s each
    for (const arm of ["connectome_4A", "connectome_4B", "connectome_frozen"])
      for (const sd of seedList)
        jobs.push({ exp, arms: [arm], seedStart: sd, seedEnd: sd,
                    out: path.join(OUT, `part_${exp}_${arm}_${sd}.csv`) });
    // shuffled arm: one job per (shuffle draw, 3-seed chunk)
    for (let k = 0; k < shuffles; k++) {
      const seedList2 = Array.from({ length: seeds }, (_, i) => i + 1);
      for (const c of chunk5(seedList2, 3))
        jobs.push({ exp, arms: ["connectome_4C"], seedStart: c[0], seedEnd: c[c.length - 1],
                    shuffleSeed: 1000 + k * 17,
                    out: path.join(OUT, `part_${exp}_4C_s${1000 + k * 17}_${c[0]}.csv`) });
    }
  } else {
    const armDefs = {
      e9: ["demon_neural", "demon_frozen", "demon_speed", "demon_random", "never_open"],
      e10: ["trapdoor_light", "trapdoor_heavy", "trapdoor_neural", "trapdoor_frozen"],
      e11: ["ratchet_gradient", "ratchet_equilibrium", "ratchet_heavy_load", "ratchet_neural", "ratchet_frozen"],
    };
    const seedList = Array.from({ length: seeds }, (_, k) => k + 1);
    for (const c of chunk5(seedList, 5))
      jobs.push({ exp, arms: armDefs[exp], seedStart: c[0], seedEnd: c[c.length - 1],
                  out: path.join(OUT, `part_${exp}_${c[0]}.csv`) });
  }
  // resumability: skip jobs whose output already exists
  const pending = jobs.filter(j => !fs.existsSync(j.out));
  const skipped = jobs.length - pending.length;
  if (skipped) console.log(`  (${skipped} jobs already done, resuming)`);
  return pending;
}

function runPool(jobs, label) {
  // TRUE parallelism: async spawn (execFileSync blocked the event loop and
  // silently serialized the whole pool).
  return new Promise((resolve) => {
    const t0 = Date.now();
    let next = 0, done = 0, failed = 0;
    const nProc = Math.max(2, Math.min(14, require("os").cpus().length - 2));
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
          console.log(`  [${label}] job ${done + failed}/${jobs.length} ok (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
        } else {
          failed++;
          console.error(`  [${label}] job FAILED (code ${code}): ${job.exp} ${job.arms.join(",")} seeds ${job.seedStart}-${job.seedEnd}\n    ${(err || out).split("\n").slice(-4).join(" ")}`);
        }
        launch();
        if (done + failed === jobs.length) resolve({ done, failed });
      });
    }
    for (let i = 0; i < Math.min(nProc, jobs.length); i++) launch();
  });
}

const meta = { generated: new Date().toISOString(), stamp: STAMP, codeVersion: "8c5793d",
  seeds: {}, shuffles: {}, rowCounts: {}, runtimeS: {}, physicsUnchanged: true,
  note: "Preregistered campaign (PRE_REGISTERED_CRITERIA.json). All seeds run; no outcome exclusion. Parallel driver; per-job outputs merged into raw_{exp}.csv." };

function mergeCsv(exp, partPrefix) {
  const parts = fs.readdirSync(OUT).filter(f => f.startsWith(partPrefix) && f.endsWith(".csv")).sort();
  const rows = [];
  for (const f of parts) {
    const txt = fs.readFileSync(path.join(OUT, f), "utf8").trim();
    if (!txt) continue;
    const ls = txt.split("\n");
    const cols = ls[0].split(",");
    for (let i = 1; i < ls.length; i++) {
      const vals = ls[i].split(",");
      const r = {};
      cols.forEach((c, j) => { r[c] = vals[j]; });
      rows.push(r);
    }
  }
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const esc = v => (v === undefined || v === null) ? "" :
    /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
  fs.writeFileSync(path.join(OUT, `raw_${exp}.csv`),
    [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n") + "\n");
  for (const f of parts) fs.unlinkSync(path.join(OUT, f));
  return rows.length;
}

(async () => {
  const t0 = Date.now();
  for (const exp of WANT) {
    const seeds = parseInt(argVal("seeds", String(SEEDS[exp])), 10) || SEEDS[exp];
    const shuffles = exp === "e4" ? (parseInt(argVal("shuffles", "10"), 10) || 10) : 0;
    console.log(`\n=== campaign ${exp.toUpperCase()} · ${seeds} seeds${exp === "e4" ? ` · ${shuffles} shuffle draws` : ""} ===`);
    const jobs = buildJobs(exp, seeds, shuffles);
    const te = Date.now();
    await runPool(jobs, exp);
    const n = mergeCsv(exp, `part_${exp}_`);
    meta.seeds[exp] = seeds; meta.shuffles[exp] = shuffles;
    meta.rowCounts[exp] = n; meta.runtimeS[exp] = Math.round((Date.now() - te) / 1000);
    console.log(`  merged ${n} rows -> research_data/validation/raw_${exp}.csv`);
  }
  fs.writeFileSync(path.join(OUT, "campaign_meta.json"), JSON.stringify(meta, null, 2));
  console.log(`\nall campaigns done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
})();
