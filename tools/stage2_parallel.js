#!/usr/bin/env node
/**
 * stage2_parallel.js — process-level parallel runner for the Stage-2 campaign.
 *
 * Design constraints (pilot report §4 + 2026-10-08 audit remediation #2/#3):
 *  - NEW TOOL ONLY: invokes the PINNED `node benchmark.js --config <cfg>` as a
 *    subprocess. benchmark.js / experiment_core.js / controllers.js are never
 *    modified here, so no §13 amendment discipline is triggered.
 *  - Work queue: the job list is (seed pair x arm-group) pairs derived from a
 *    master Stage-2 config; N worker slots pull from the queue.
 *  - Per-job isolation: each job gets a derived single-pair config; each
 *    WORKER SLOT gets its own sandbox directory (<out>/.sandbox_wN/) holding
 *    hardlinked (or copied) benchmark.js / experiment_core.js / controllers.js
 *    plus their full local require() closure (auto-discovered),
 *    fly_brain_circuit.json and PRE_REGISTRATION_STAGE1.json. The pinned sources
 *    are NEVER modified — but benchmark.js writes its outputs relative to its
 *    own __dirname, so a per-worker sandbox gives every concurrent job an
 *    isolated research_data/ and makes same-second output-stamp collisions
 *    (observed in the first selftest run: two fast jobs overwrote each other's
 *    stage1_trials_<stamp>.jsonl) impossible. Sandboxes live INSIDE the repo
 *    tree so benchmark's git provenance still resolves to this checkout.
 *  - Resumable: a job with a valid DONE.json (matching config sha + trials
 *    sha) is skipped on re-invocation; progress is appended to <out>/progress.jsonl.
 *  - Merged manifest: aggregates per-pair per-arm deltaSortEntropy from every
 *    job manifest (all pairs — fixing the pilot's pair-1-only aggregation),
 *    plus seed-paired A−X contrasts, and writes
 *    <out>/stage2_merged_manifest_<stamp>.json.
 *  - Per-pair arm plan: a seedTable pair entry may carry its own `groups`
 *    (array of arm-key arrays). Stage 2 needs it: arms A-D run on every pair,
 *    arm E on 1-in-5 pairs and the no-op topology diagnostic on 16 stratum
 *    pairs — expressible only per pair. Absent `groups`, the master's
 *    parallel.armGroups applies (byte-identical behaviour to before).
 *  - Lossless row retention: a job's per-trial JSONL is gzip-compressed AFTER
 *    the manifest/trials sha match, the gz is round-trip verified back to the
 *    pinned uncompressed sha256, and only then is the raw JSONL removed. The
 *    full Stage-2 row set would need ~139 GB uncompressed against 18 GB free
 *    on this volume; every row is kept, nothing is discarded or downsampled.
 *
 *  - Attribution robustness (dry-run finding, 2026-10-09 — two independent
 *    causes, both fixed and both reproduced before/after): benchmark.js stamps
 *    its outputs with a SECOND-resolution clock, so two consecutive jobs in the
 *    same sandbox can produce the SAME filename. Attribution is therefore by
 *    content (the manifest's config sha256) plus freshness (mtime >= this job's
 *    start), and the sandbox output dir is cleared of `stage1_*` leftovers
 *    immediately before each job spawns, and nothing keys off filenames.
 *    Without the sweep a same-second collision let a stale file shadow the
 *    new one (reproduced in serial mode); with a name-keyed claim set the
 *    collision failed the job a different way (reproduced in parallel mode).
 *    Both modes now pass. On any job failure the child's stdout/stderr tail
 *    is kept in error.log — a 5-day unattended campaign must not lose the
 *    diagnostic.
 *
 *  - Governance (audit remediation #3): a non-SMOKE master config is REFUSED
 *    (exit 2) unless PRE_REGISTRATION_STAGE2.json exists and pins this exact
 *    master config sha256. Strictly pin BEFORE launching any Stage-2 data.
 *    SMOKE configs are additionally refused if their seed table overlaps the
 *    pre-drawn pilot table (§6c).
 *
 * Usage:
 *   node tools/stage2_parallel.js --config <master.json> [--workers N]
 *        [--out research_data/stage2_runs] [--jobs id1,id2,...] [--finalize]
 *   node tools/stage2_parallel.js --selftest        # serial-vs-parallel byte
 *        determinism check on smoke-sized jobs; cleans up after itself
 *
 * Selftest exit 0 = all jobs byte-identical serial vs parallel + merged
 * manifest valid. NOTHING in this tool writes to any pinned file.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUTDATA = path.join(ROOT, "research_data");
const RUNNER_VERSION = 1;

// ---------------------------------------------------------------- utilities
function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = fs.createReadStream(p);
    s.on("data", d => h.update(d));
    s.on("end", () => resolve(h.digest("hex")));
    s.on("error", reject);
  });
}
function sha256Buf(b) { return crypto.createHash("sha256").update(b).digest("hex"); }
const log = (...a) => console.log("[stage2]", ...a);

// ---------------------------------------------------------------- CLI
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : dflt; };
const has = (name) => args.includes("--" + name);
const SELFTEST = has("selftest");
const FINALIZE = has("finalize");
const CONFIG_PATH = flag("config", null);
const OUT_ROOT = path.isAbsolute(flag("out", "") || "") ? flag("out") : path.join(ROOT, flag("out", "research_data/stage2_runs"));
const SANDBOX_ROOTS = ["benchmark.js", "experiment_core.js", "controllers.js"];

/** Walk the local require("./x") closure of the runtime entry points so the
 *  sandbox is self-contained (e.g. controllers.js -> p1_retinotopy.js). */
function sandboxClosure() {
  const seen = new Set();
  const queue = [...SANDBOX_ROOTS];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f) || !fs.existsSync(path.join(ROOT, f))) continue;
    seen.add(f);
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const m of src.matchAll(/require\("\.\/([^"]+)"\)/g)) {
      let rel = m[1];
      if (!rel.endsWith(".js")) rel += ".js";
      queue.push(rel);
    }
  }
  return [...seen];
}

// ---------------------------------------------------------------- governance
const PILOT_SEEDS = [];
for (let k = 1; k <= 8; k++) PILOT_SEEDS.push({ environmentSeed: 4101 + 101 * (k - 1), networkSeed: 9201 + 101 * (k - 1), topologySeed: 7000 + k });

function governanceGate(master, masterSha) {
  if (master.SMOKE === true) {
    for (const p of master.seedTable.pairs) {
      for (const q of PILOT_SEEDS) {
        if (p.environmentSeed === q.environmentSeed || p.networkSeed === q.networkSeed || p.topologySeed === q.topologySeed) {
          console.error(`REFUSING: SMOKE config reuses a §6c pilot seed (pair k=${p.k}: ${p.environmentSeed}/${p.networkSeed}/${p.topologySeed} overlaps ${q.environmentSeed}/${q.networkSeed}/${q.topologySeed}).`);
          process.exit(2);
        }
      }
    }
    return;
  }
  // real Stage-2 campaign: prereg must exist AND pin this master config
  const regPath = path.join(ROOT, "PRE_REGISTRATION_STAGE2.json");
  if (!fs.existsSync(regPath)) {
    console.error("REFUSING to run: PRE_REGISTRATION_STAGE2.json is missing.\n" +
      "Audit remediation #3: the Stage-2 pre-registration must be pinned STRICTLY BEFORE any Stage-2 data exists.\n" +
      "Pin the master config (sha256 " + masterSha.slice(0, 12) + "…) first; the pin timestamp must precede the first row.");
    process.exit(2);
  }
  const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
  const pinned = reg.config && reg.config.sha256;
  if (pinned !== masterSha) {
    console.error(`REFUSING to run: PRE_REGISTRATION_STAGE2.json pins config sha ${String(pinned).slice(0, 12)}… but master config is ${masterSha.slice(0, 12)}…. Re-register per §13 first.`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------- job model
function buildJobs(master) {
  const armGroups = (master.parallel && Array.isArray(master.parallel.armGroups) && master.parallel.armGroups.length)
    ? master.parallel.armGroups
    : [Object.keys(master.arms)];
  const jobs = [];
  for (const pair of master.seedTable.pairs.slice(0, master.seedTable.consumedPairs)) {
    // per-pair arm plan wins when present (Stage-2 E / no-op diagnostic pairs)
    const pairGroups = (Array.isArray(pair.groups) && pair.groups.length) ? pair.groups : armGroups;
    pairGroups.forEach((group, gi) => {
      const arms = {};
      for (const a of group) {
        if (!master.arms[a]) throw new Error(`armGroups reference unknown arm: ${a}`);
        arms[a] = master.arms[a];
      }
      jobs.push({ id: `pair${pair.k}_g${gi + 1}`, pair, arms });
    });
  }
  return jobs;
}

function deriveJobConfig(master, job) {
  const cfg = JSON.parse(JSON.stringify(master));
  cfg.seedTable = {
    note: `Derived single-pair config for job ${job.id} (tools/stage2_parallel.js); master table row k=${job.pair.k}.`,
    seedStride: master.seedTable.seedStride,
    consumedPairs: 1,
    pairs: [job.pair],
  };
  cfg.arms = job.arms;
  delete cfg.parallel; // per-job configs never re-derive
  return cfg;
}

// ---------------------------------------------------------------- sandbox
/** One sandbox per WORKER SLOT: hardlink (same volume, zero cost) or copy the
 *  pinned runtime files. benchmark.js resolves everything via __dirname, so a
 *  linked sandbox sees identical code AND writes outputs to its own
 *  research_data/. Returns the sandbox dir. */
function ensureSandbox(outDir, workerIndex) {
  const sb = path.join(outDir, `.sandbox_w${workerIndex}`);
  fs.mkdirSync(sb, { recursive: true });
  const files = [...sandboxClosure(), "fly_brain_circuit.json", "PRE_REGISTRATION_STAGE1.json"];
  for (const f of files) {
    const src = path.join(ROOT, f);
    const dst = path.join(sb, f);
    if (!fs.existsSync(src)) throw new Error(`sandbox: missing ${f} (required by the benchmark runtime closure)`);
    if (fs.existsSync(dst)) fs.rmSync(dst, { force: true });
    try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); }
    const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    if (sha(src) !== sha(dst)) throw new Error(`sandbox: ${f} copy verification failed`);
  }
  return sb;
}

// ---------------------------------------------------------------- harvesting
function listStage1Outputs(inDir) {
  const d = inDir || OUTDATA;
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => /^stage1_(trials|manifest)_/.test(f));
}

/** Remove stale `stage1_*` outputs from a sandbox's research_data/ before a job
 *  spawns. Successful jobs rename theirs out; failed or half-finished ones
 *  linger, and because benchmark.js stamps to the SECOND a lingering file can
 *  carry the very name the next job is about to produce. */
function clearSandboxOutputs(sandbox) {
  const outData = path.join(sandbox, "research_data");
  if (!fs.existsSync(outData)) return 0;
  let n = 0;
  for (const f of listStage1Outputs(outData)) { fs.rmSync(path.join(outData, f), { force: true }); n++; }
  return n;
}

/** Claim this job's outputs from the WORKER SANDBOX's research_data/ by
 *  manifest config-sha match (content attribution) plus freshness
 *  (mtime >= this job's spawn time). Deliberately keyed on CONTENT, never on
 *  filename: benchmark.js stamps to the second, so two jobs in one slot can
 *  legitimately produce the same filename, and any name-keyed bookkeeping
 *  turns that into a lost job two runs out of three. Only one job runs per
 *  sandbox at a time, so content match is unambiguous. */
async function harvestJob(sandbox, jobCfgSha, notBeforeMs, tries = 5) {
  const outData = path.join(sandbox, "research_data");
  for (let attempt = 0; attempt < tries; attempt++) {
    const candidates = [];
    for (const f of listStage1Outputs(outData)) {
      if (!f.endsWith(".json")) continue;
      try {
        const full = path.join(outData, f);
        const st = fs.statSync(full);
        if (st.mtimeMs < notBeforeMs) continue;          // stale: from an earlier attempt
        const m = JSON.parse(fs.readFileSync(full, "utf8"));
        if (m && m.config && m.config.sha256 === jobCfgSha) candidates.push({ f, m, mt: st.mtimeMs });
      } catch { /* partial manifest: skip */ }
    }
    if (candidates.length) {
      candidates.sort((a, b) => b.mt - a.mt);
      const pick = candidates[0];
      const trialsName = pick.m.files && pick.m.files.trials;
      if (trialsName && fs.existsSync(path.join(outData, trialsName))) {
        return { manifest: pick.m, manifestName: pick.f, trialsName };
      }
    }
    if (attempt < tries - 1) await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}

// ---------------------------------------------------------------- run one job
async function runJob(job, jobCfg, outDir, sandbox) {
  const jobDir = path.join(outDir, "jobs", job.id);
  fs.mkdirSync(jobDir, { recursive: true });
  const cfgPath = path.join(sandbox, "config.json");
  const cfgBytes = Buffer.from(JSON.stringify(jobCfg, null, 2) + "\n");
  fs.writeFileSync(cfgPath, cfgBytes);
  const cfgSha = sha256Buf(cfgBytes);

  const donePath = path.join(jobDir, "DONE.json");
  if (fs.existsSync(donePath)) {
    const prev = JSON.parse(fs.readFileSync(donePath, "utf8"));
    if (prev.configSha256 === cfgSha && prev.status === "DONE") {
      log(`skip ${job.id} (already DONE, config sha matches)`);
      return prev;
    }
  }

  const swept = clearSandboxOutputs(sandbox);
  const t0 = Date.now();
  log(`start ${job.id} (arms: ${Object.keys(job.arms).join(",")}; pair k=${job.pair.k} seeds ${job.pair.environmentSeed}/${job.pair.networkSeed}/${job.pair.topologySeed})` +
      (swept ? ` [swept ${swept} stale sandbox file(s)]` : ""));
  const r = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(sandbox, "benchmark.js"), "--config", cfgPath],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    const keep = (s, d) => { s += d; return s.length > 64 * 1024 ? s.slice(-32 * 1024) : s; };
    let err = "", out = "";
    p.stderr.on("data", d => { err = keep(err, d); });
    p.stdout.on("data", d => { out = keep(out, d); });
    p.on("close", (code, signal) => resolve({ code, signal, err, out }));
  });
  const elapsedS = ((Date.now() - t0) / 1000).toFixed(1);

  if (r.code !== 0) {
    fs.writeFileSync(path.join(jobDir, "error.log"),
      "benchmark child exited non-zero.\n" +
      "--- child stdout (tail) ---\n" + (r.out || "(empty)") +
      "\n--- child stderr (tail) ---\n" + (r.err || "(empty)") + "\n");
    const rec = { jobId: job.id, status: "FAILED", exitCode: r.code, signal: r.signal, configSha256: cfgSha, elapsedSeconds: +elapsedS, ts: new Date().toISOString() };
    fs.writeFileSync(donePath, JSON.stringify(rec, null, 2) + "\n");
    log(`FAIL ${job.id} (exit ${r.code}${r.signal ? " " + r.signal : ""}) after ${elapsedS}s — see ${path.relative(ROOT, path.join(jobDir, "error.log"))}`);
    return rec;
  }

  const got = await harvestJob(sandbox, cfgSha, t0);
  if (!got) {
    const leftovers = listStage1Outputs(path.join(sandbox, "research_data"));
    fs.writeFileSync(path.join(jobDir, "error.log"),
      "output attribution failed after exit 0.\n" +
      `sandbox: ${path.relative(ROOT, sandbox).replace(/\\/g, "/")}\n` +
      `expected job config sha256: ${cfgSha}\n` +
      `sandbox research_data leftovers at failure: ${leftovers.join(", ") || "(none)"}\n` +
      "--- child stdout (tail) ---\n" + (r.out || "(empty)") +
      "\n--- child stderr (tail) ---\n" + (r.err || "(empty)") + "\n");
    const rec = { jobId: job.id, status: "FAILED", reason: "could not attribute benchmark outputs (no manifest with matching config sha256)", configSha256: cfgSha, elapsedSeconds: +elapsedS, ts: new Date().toISOString() };
    fs.writeFileSync(donePath, JSON.stringify(rec, null, 2) + "\n");
    log(`FAIL ${job.id}: output attribution failed — see ${path.relative(ROOT, path.join(jobDir, "error.log"))}`);
    return rec;
  }

  // move outputs into the job dir; verify trials sha against the manifest
  const sandboxData = path.join(sandbox, "research_data");
  const trialsSha = await sha256File(path.join(sandboxData, got.trialsName));
  if (got.manifest.files.trialsSha256 !== trialsSha) {
    const rec = { jobId: job.id, status: "FAILED", reason: `trials sha mismatch (manifest ${got.manifest.files.trialsSha256.slice(0, 12)}… vs computed ${trialsSha.slice(0, 12)}…)`, configSha256: cfgSha, ts: new Date().toISOString() };
    fs.writeFileSync(donePath, JSON.stringify(rec, null, 2) + "\n");
    log(`FAIL ${job.id}: trials sha mismatch`);
    return rec;
  }
  fs.renameSync(path.join(sandboxData, got.trialsName), path.join(jobDir, got.trialsName));
  fs.renameSync(path.join(sandboxData, got.manifestName), path.join(jobDir, got.manifestName));

  // ---- lossless retention (header): gzip the rows, verify the round trip
  // against the manifest's uncompressed sha256, THEN delete the raw JSONL.
  const rawPath = path.join(jobDir, got.trialsName);
  const gzPath = rawPath + ".gz";
  const rawBytes = fs.statSync(rawPath).size;
  await new Promise((resolve, reject) => {
    const inp = fs.createReadStream(rawPath);
    const gz = zlib.createGzip({ level: 6 });
    const out = fs.createWriteStream(gzPath);
    inp.on("error", reject); gz.on("error", reject); out.on("error", reject);
    out.on("close", resolve);
    inp.pipe(gz).pipe(out);
  });
  const gzBytes = fs.statSync(gzPath).size;
  const backSha = sha256Buf(zlib.gunzipSync(fs.readFileSync(gzPath)));
  if (backSha !== trialsSha) {
    const rec = { jobId: job.id, status: "FAILED",
      reason: `gzip round trip mismatched the pinned trials sha (${backSha.slice(0, 12)}… vs ${trialsSha.slice(0, 12)}…) — raw rows kept`, configSha256: cfgSha, ts: new Date().toISOString() };
    fs.writeFileSync(donePath, JSON.stringify(rec, null, 2) + "\n");
    log(`FAIL ${job.id}: gzip round trip mismatch (raw JSONL kept)`);
    return rec;
  }
  const gzSha = await sha256File(gzPath);
  fs.rmSync(rawPath, { force: true });

  const rec = {
    jobId: job.id, status: "DONE", configSha256: cfgSha,
    sandbox: path.basename(sandbox),
    k: job.pair.k, seeds: job.pair, arms: Object.keys(job.arms),
    manifest: path.relative(outDir, path.join(jobDir, got.manifestName)).replace(/\\/g, "/"),
    trials: path.relative(outDir, path.join(jobDir, got.trialsName)).replace(/\\/g, "/"),
    trialsSha256: trialsSha, manifestSha256: sha256Buf(fs.readFileSync(path.join(jobDir, got.manifestName))),
    retention: { mode: "gzip", gzFile: path.relative(outDir, gzPath).replace(/\\/g, "/"),
                 gzSha256: gzSha, bytesRaw: rawBytes, bytesGz: gzBytes,
                 ratio: +(rawBytes / gzBytes).toFixed(3),
                 roundTripVerified: true, rawRemoved: true },
    n_rows: got.manifest.n_rows, phaseCounts: got.manifest.phaseCounts,
    deltaSelectivity: got.manifest.deltaSelectivity, elapsedSeconds: +elapsedS, ts: new Date().toISOString(),
  };
  fs.writeFileSync(donePath, JSON.stringify(rec, null, 2) + "\n");
  log(`done  ${job.id} in ${elapsedS}s (n_rows ${rec.n_rows})`);
  return rec;
}

// ---------------------------------------------------------------- merged manifest
function aggregate(recs) {
  // per-pair per-arm deltas from job manifests (each job covers exactly 1 pair)
  const byArm = {}; // arm -> [{k, delta}]
  for (const rec of recs) {
    if (rec.status !== "DONE" || !rec.deltaSelectivity) continue;
    for (const [arm, d] of Object.entries(rec.deltaSelectivity)) {
      if (d && Number.isFinite(d.deltaSortEntropy)) (byArm[arm] = byArm[arm] || []).push({ k: rec.k, deltaSortEntropy: d.deltaSortEntropy });
    }
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const stats = a => { const m = mean(a); return { mean: m, sd: Math.sqrt(mean(a.map(x => (x - m) ** 2))), n: a.length, perPair: a }; };
  const perArm = {};
  for (const [arm, arr] of Object.entries(byArm)) perArm[arm] = stats(arr.map(x => x.deltaSortEntropy));
  const contrasts = {};
  const A = byArm["armA_real_connectome"];
  if (A) {
    const pairsOf = arr => new Map(arr.map(x => [x.k, x.deltaSortEntropy]));
    const am = pairsOf(A);
    for (const arm of Object.keys(byArm)) {
      if (arm === "armA_real_connectome") continue;
      const bm = pairsOf(byArm[arm]);
      const diffs = [...am.keys()].filter(k => bm.has(k)).map(k => am.get(k) - bm.get(k));
      if (diffs.length) contrasts["A-" + arm.replace(/^arm/, "").replace(/_.*$/, "")] = stats(diffs);
    }
  }
  return { perArmDeltaSortEntropy: perArm, seedPairedContrasts: contrasts };
}

function writeMergedManifest(master, masterSha, masterPath, outDir, recs, startedTs, workers) {
  const agg = aggregate(recs);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const merged = {
    manifest_version: 1, stage: master.stage || 2, runner: { tool: "tools/stage2_parallel.js", version: RUNNER_VERSION, workers },
    masterConfig: { path: path.relative(ROOT, masterPath).replace(/\\/g, "/"), sha256: masterSha },
    generated: new Date().toISOString(), startedTs,
    git: { commit: (() => { try { return require("child_process").execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(); } catch { return "UNKNOWN"; } })(), branch: (() => { try { return require("child_process").execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT }).toString().trim(); } catch { return "UNKNOWN"; } })() },
    jobsTotal: recs.length,
    jobsDone: recs.filter(r => r.status === "DONE").length,
    jobsFailed: recs.filter(r => r.status === "FAILED").length,
    n_rows_total: recs.reduce((a, r) => a + (r.n_rows || 0), 0),
    aggregation: agg,
    jobs: recs.map(r => ({ jobId: r.jobId, status: r.status, k: r.k, seeds: r.seeds, arms: r.arms, trials: r.trials, trialsSha256: r.trialsSha256, n_rows: r.n_rows, retention: r.retention })),
    governance: "Stage-2 pre-registration (PRE_REGISTRATION_STAGE2.json) must have been pinned BEFORE the earliest job row; see audit remediation #3.",
  };
  const p = path.join(outDir, `stage2_merged_manifest_${stamp}.json`);
  fs.writeFileSync(p, JSON.stringify(merged, null, 2) + "\n");
  return p;
}

// ---------------------------------------------------------------- campaign
async function runCampaign(master, masterSha, masterPath, outDir, filter, workers) {
  workers = Math.max(1, workers || Math.min(4, require("os").cpus().length));
  fs.mkdirSync(outDir, { recursive: true });
  let jobs = buildJobs(master);
  if (filter) jobs = jobs.filter(j => filter.includes(j.id));
  if (!jobs.length) { console.error("no jobs selected"); process.exit(1); }

  // one sandbox per worker slot (isolated benchmark output dirs — see header);
  // each sandbox carries its own claimed-output set (content attribution is
  // per-sandbox, so reruns within one sandbox never double-claim)
  const sandboxes = Array.from({ length: workers }, (_, i) => ensureSandbox(outDir, i));
  const progressPath = path.join(outDir, "progress.jsonl");
  const recs = [];
  const startedTs = new Date().toISOString();
  let idx = 0;
  const worker = async (slot) => {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      const rec = await runJob(job, deriveJobConfig(master, job), outDir, sandboxes[slot]);
      fs.appendFileSync(progressPath, JSON.stringify({ jobId: rec.jobId, status: rec.status, ts: rec.ts }) + "\n");
      recs.push(rec);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, (_, s) => worker(s)));

  const mergedPath = writeMergedManifest(master, masterSha, masterPath, outDir, recs, startedTs, workers);
  const failed = recs.filter(r => r.status === "FAILED");
  log(`campaign finished: ${recs.length - failed.length}/${recs.length} jobs done; merged manifest: ${path.relative(ROOT, mergedPath)}`);
  if (failed.length) { log(`${failed.length} job(s) FAILED: ` + failed.map(f => f.jobId).join(", ")); process.exit(1); }
}

// ---------------------------------------------------------------- finalize
/** Rebuild the merged manifest from the DONE.json receipts already on disk,
 *  WITHOUT running (or re-running) any job. Refuses to finalize unless every
 *  job in the master config has a DONE receipt and none of them FAILED, so a
 *  partial campaign can never be mistaken for a finished one. */
async function finalizeCampaign(master, masterSha, masterPath, outDir, workers) {
  const jobsDir = path.join(outDir, "jobs");
  if (!fs.existsSync(jobsDir)) { console.error(`no jobs directory at ${path.relative(ROOT, jobsDir)} — nothing to finalize`); process.exit(1); }
  const jobs = buildJobs(master);
  const recs = [], missing = [];
  for (const job of jobs) {
    const d = path.join(jobsDir, job.id, "DONE.json");
    if (!fs.existsSync(d)) { missing.push(job.id); continue; }
    recs.push(JSON.parse(fs.readFileSync(d, "utf8")));
  }
  const failed = recs.filter(r => r.status !== "DONE");
  log(`finalize: ${recs.length - failed.length}/${jobs.length} DONE, ${failed.length} FAILED, ${missing.length} never run`);
  if (missing.length) log(`  not run: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ` … (+${missing.length - 8})` : ""}`);
  if (failed.length) log(`  failed: ${failed.slice(0, 8).map(r => r.jobId).join(", ")}`);
  if (missing.length || failed.length) {
    console.error("REFUSING to finalize: the campaign is incomplete. Re-invoke without --finalize to run the remaining/failed jobs (DONE receipts are reused, FAILED ones are retried).");
    process.exit(1);
  }
  const mergedPath = writeMergedManifest(master, masterSha, masterPath, outDir, recs, null, workers);
  log(`finalized: ${path.relative(ROOT, mergedPath)}`);
}

// ---------------------------------------------------------------- selftest
async function selftest() {
  const tinyPath = path.join(__dirname, "..", "tests", "stage1_smoke_tiny_config.json");
  const base = JSON.parse(fs.readFileSync(tinyPath, "utf8"));
  const master = JSON.parse(JSON.stringify(base));
  master.seedTable.pairs.push({ k: 2, environmentSeed: 5201, networkSeed: 7202, topologySeed: 6502 });
  master.seedTable.consumedPairs = 2;
  const allArms = Object.keys(master.arms);
  master.parallel = { armGroups: [allArms.slice(0, 2), allArms.slice(2)] }; // [A,B], [C,D,E] → 4 jobs
  const tmp = path.join(OUTDATA, "stage2_selftest_tmp");
  fs.rmSync(tmp, { recursive: true, force: true });

  const masterPath = path.join(tmp, "master_smoke_2pair.json");
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(masterPath, JSON.stringify(master, null, 2) + "\n");
  const masterSha = sha256Buf(fs.readFileSync(masterPath));

  console.log("== stage2_parallel selftest: 4 smoke-sized jobs (2 pairs x 2 arm groups) ==");
  log("phase 1: SERIAL (workers=1)");
  await runCampaign(master, masterSha, masterPath, path.join(tmp, "serial"), null, 1);
  log("phase 2: PARALLEL (workers=2)");
  await runCampaign(master, masterSha, masterPath, path.join(tmp, "parallel"), null, 2);

  // byte-compare per-job trials between the two modes
  let bad = 0;
  const serialJobs = fs.readdirSync(path.join(tmp, "serial", "jobs"));
  const readTrials = (dir) => {   // retention may already have gzipped the rows
    const files = fs.readdirSync(dir);
    const plain = files.find(f => f.endsWith(".jsonl"));
    if (plain) return fs.readFileSync(path.join(dir, plain));
    const gz = files.find(f => f.endsWith(".jsonl.gz"));
    return gz ? zlib.gunzipSync(fs.readFileSync(path.join(dir, gz))) : null;
  };
  for (const jid of serialJobs) {
    const sb = readTrials(path.join(tmp, "serial", "jobs", jid));
    const pb = readTrials(path.join(tmp, "parallel", "jobs", jid));
    if (!sb || !pb) { console.log(`  FAIL  ${jid}: missing output (serial ${!!sb}, parallel ${!!pb})`); bad++; continue; }
    const eq = sb.equals(pb);
    console.log(`  ${eq ? "PASS" : "FAIL"}  ${jid}: trials byte-identical serial vs parallel (${sb.length} bytes)`);
    if (!eq) bad++;
  }
  // merged manifest sanity
  const mdir = fs.readdirSync(path.join(tmp, "parallel")).filter(f => f.startsWith("stage2_merged_manifest_"));
  const mm = JSON.parse(fs.readFileSync(path.join(tmp, "parallel", mdir[0]), "utf8"));
  const mergeOk = mm.jobsDone === 4 && mm.jobsFailed === 0 && mm.jobs.every(j => j.status === "DONE");
  console.log(`  ${mergeOk ? "PASS" : "FAIL"}  merged manifest: 4/4 jobs DONE, aggregation arms=${Object.keys(mm.aggregation.perArmDeltaSortEntropy).length}`);
  if (!mergeOk) bad++;

  if (process.env.STAGE2_SELFTEST_KEEP !== "1") {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("  (selftest temp dir removed; set STAGE2_SELFTEST_KEEP=1 to keep)");
  }
  console.log(bad === 0 ? "SELFTEST PASS" : `SELFTEST FAIL (${bad} check(s) failed)`);
  process.exit(bad === 0 ? 0 : 1);
}

// ---------------------------------------------------------------- main
(async () => {
  if (SELFTEST) return selftest();
  if (!CONFIG_PATH) {
    console.error("usage: node tools/stage2_parallel.js --config <master.json> [--workers N] [--out dir] [--jobs id,...] [--finalize] | --selftest");
    process.exit(1);
  }
  const masterPath = path.isAbsolute(CONFIG_PATH) ? CONFIG_PATH : path.join(ROOT, CONFIG_PATH);
  const master = JSON.parse(fs.readFileSync(masterPath, "utf8"));
  if (!master.seedTable || !Array.isArray(master.seedTable.pairs)) { console.error("master config missing seedTable.pairs"); process.exit(1); }
  const masterSha = sha256Buf(fs.readFileSync(masterPath));
  governanceGate(master, masterSha);
  const filter = flag("jobs", null) ? flag("jobs").split(",").map(s => s.trim()) : null;
  const workers = Math.max(1, parseInt(flag("workers", String(Math.min(4, require("os").cpus().length))), 10));
  if (FINALIZE) return finalizeCampaign(master, masterSha, masterPath, OUT_ROOT, workers);
  await runCampaign(master, masterSha, masterPath, OUT_ROOT, filter, workers);
})().catch(e => { console.error("[stage2] fatal:", e); process.exit(1); });
