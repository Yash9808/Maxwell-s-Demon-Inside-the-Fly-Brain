"use strict";
/**
 * e3r2_campaign.js — E3R2 reward-shaping campaign driver (preregistered).
 *
 * Design (PRE_REGISTERED_CRITERIA_E3R2.json):
 *   20 seeds (s = 0..19), env seed = 1 + s*101, controller rng = envSeed^0x5f5f
 *   (runBenchmark rule — identical to the R1 campaign, so seeds are matched).
 *   TRAIN 300 episodes (plasticity on), TEST 60 episodes (plasticity off),
 *   12 s episodes, dt=1/60, 320 particles, noise 0.12, doorHeight 64,
 *   maxCrossingsPerTrial 50 (all as in R1).
 *
 * Arms:
 *   R2A_cost      drosophila brain + dwell-cost shaping (kappa=0.005/step)
 *   R2B_floor     drosophila brain + exploration floor overlay (p=0.05/step)
 *   R2A_frozen    R2A wrapper around a plasticity-OFF brain (shaping control;
 *                 trajectory-identical to bare frozen brain in R2A mode)
 *   R2B_frozen    R2B wrapper around a plasticity-OFF brain (run for real:
 *                 the floor overlay actuates a frozen brain)
 *   vanilla_rerun unmodified drosophilaController in the CURRENT codebase
 *                 (pre-registered amendment: R1 rows are historical anchors
 *                 because collaborators have edited controllers.js since)
 *   random        randomController (task-difficulty anchor)
 *
 * Usage:
 *   node e3r2_campaign.js --pilot                # 2 seeds, R2A/R2B only
 *   node e3r2_campaign.js                        # full 20-seed campaign
 *   node e3r2_campaign.js --seeds 20 --jobs 14
 *   node e3r2_campaign.js --worker '<json>'      # internal: one job
 *   node e3r2_campaign.js --merge                # merge parts only
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { runBenchmark } = require("./experiment_core");
const CTRL = require("./controllers");
const { e3r2Wrap } = require("./e3r2_wrapper");

const OUT_DIR = path.join("research_data", "validation");
const CFG = {
  trialsTrain: 300, trialsTest: 60, episodeSeconds: 12,
  nParticles: 320, noise: 0.12, doorHeight: 64,
};
const N_SEEDS = 20;
const ARMS_ALL = ["R2A_cost", "R2B_floor", "R2A_frozen", "R2B_frozen",
                  "vanilla_rerun", "random"];

function armFactories(arm) {
  switch (arm) {
    case "R2A_cost":      return { [arm]: e3r2Wrap("R2A_cost", CTRL.drosophilaController) };
    case "R2B_floor":     return { [arm]: e3r2Wrap("R2B_floor", CTRL.drosophilaController) };
    case "R2A_frozen":    return { [arm]: e3r2Wrap("R2A_cost", CTRL.drosophilaController, { forceNoLearn: true }) };
    case "R2B_frozen":    return { [arm]: e3r2Wrap("R2B_floor", CTRL.drosophilaController, { forceNoLearn: true }) };
    case "vanilla_rerun": return { [arm]: CTRL.drosophilaController };
    case "random":        return { [arm]: CTRL.randomController };
    default: throw new Error("unknown arm " + arm);
  }
}

const RAW_HEADER = ["experiment","condition","shuffleSeed","seed","phase","trial",
  "goodCrossings","badCrossings","goodBadRatio","demonAgree","dTfinal",
  "sortEntropy","spatialH","openFraction","miNeural","workInJ","extractableJ",
  "measuredBits","erasureCostJ","energyJ","dwellCostEvents","forcedOpenSteps"]
  .join(",");

function rowFromTrial(arm, tr) {
  const num = (v) => (v === null || v === undefined || !Number.isFinite(v)) ? "" : v;
  return ["E3R2", arm, "", tr.seed, tr.phase, tr.trial,
    num(tr.goodCrossings), num(tr.badCrossings), num(tr.goodBadRatio),
    num(tr.demonAgree), num(tr.dTfinal), num(tr.sortEntropy), num(tr.spatialH),
    num(tr.openFraction), num(tr.miNeural), num(tr.workInJ),
    num(tr.extractableJ), num(tr.measuredBits), num(tr.erasureCostJ),
    num(tr.energyJ), num(tr.dwellCostEvents || 0), num(tr.forcedOpenSteps || 0),
  ].join(",");
}

function runJob(job) {
  const envSeed = 1 + job.s * 101;              // R1 seed rule
  const res = runBenchmark(Object.assign({}, CFG, {
    seed: envSeed, nSeeds: 1,
    controllers: armFactories(job.arm),
  }));
  const cond = res.conditions[job.arm];
  const lines = [RAW_HEADER];
  for (const run of cond._raw) for (const tr of run.trials) lines.push(rowFromTrial(job.arm, tr));
  const partPath = path.join(OUT_DIR, "e3r2_part_" + job.arm + "_s" + job.s + ".csv");
  fs.writeFileSync(partPath, lines.join("\n") + "\n");
  return partPath;
}

function listJobs(pilot) {
  const jobs = [];
  const arms = pilot ? ["R2A_cost", "R2B_floor"] : ARMS_ALL;
  const nSeeds = pilot ? 2 : N_SEEDS;
  for (const arm of arms) for (let s = 0; s < nSeeds; s++) jobs.push({ arm, s });
  return jobs;
}

function merge(outName) {
  const parts = fs.readdirSync(OUT_DIR).filter(f => f.startsWith("e3r2_part_") && f.endsWith(".csv"));
  const rows = {};
  for (const f of parts) {
    const lines = fs.readFileSync(path.join(OUT_DIR, f), "utf8").trim().split("\n");
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(",");
      rows[c[1] + "|" + c[3] + "|" + c[4] + "|" + c[5]] = lines[i]; // arm|seed|phase|trial
    }
  }
  const keys = Object.keys(rows).sort((a, b) => {
    const [a1, a2, a3, a4] = a.split("|"), [b1, b2, b3, b4] = b.split("|");
    return a1.localeCompare(b1) || (+a2 - +b2) || a3.localeCompare(b3) || (+a4 - +b4);
  });
  const out = [RAW_HEADER].concat(keys.map(k => rows[k]));
  const outPath = path.join(OUT_DIR, outName);
  fs.writeFileSync(outPath, out.join("\n") + "\n");
  return { outPath, parts: parts.length, rows: keys.length };
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (flag, dflt) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : dflt;
  };

  if (argv.includes("--worker")) {
    const job = JSON.parse(argv[argv.indexOf("--worker") + 1]);
    console.log(runJob(job));
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (argv.includes("--merge")) {
    console.log(merge(get("--out", "E3R2_RAW.csv")));
    return;
  }

  const pilot = argv.includes("--pilot");
  const jobs = listJobs(pilot);
  const nJobs = parseInt(get("--jobs", "14"), 10);
  const pending = jobs.filter(j =>
    !fs.existsSync(path.join(OUT_DIR, "e3r2_part_" + j.arm + "_s" + j.s + ".csv")));
  console.log(`[e3r2] ${jobs.length - pending.length}/${jobs.length} jobs already done, running ${pending.length} with ${nJobs} workers`);

  let done = 0, failed = 0;
  const t0 = Date.now();
  let next = 0;
  async function workerLoop() {
    for (;;) {
      const i = next++;
      if (i >= pending.length) return;
      const job = pending[i];
      await new Promise((resolve) => {
        const child = spawn(process.execPath, [__filename, "--worker", JSON.stringify(job)],
          { stdio: ["ignore", "pipe", "pipe"] });
        let err = "";
        child.stdout.on("data", () => {});
        child.stderr.on("data", (d) => { err += d; });
        child.on("close", (code) => {
          done++;
          if (code !== 0) { failed++; console.error(`[e3r2] FAIL ${job.arm} s${job.s}: ${err.slice(-400)}`); }
          if (done % 10 === 0 || done === pending.length)
            console.log(`[e3r2] ${done}/${pending.length} jobs done (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
          resolve();
        });
      });
    }
  }
  await Promise.all(Array.from({ length: nJobs }, workerLoop));
  if (failed) { console.error(`[e3r2] ${failed} jobs FAILED; not merging.`); process.exitCode = 1; return; }
  console.log("[e3r2]", merge(pilot ? "E3R2_RAW_PILOT.csv" : "E3R2_RAW.csv"));
}

main().catch((e) => { console.error(e); process.exit(1); });
