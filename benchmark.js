/**
 * benchmark.js — CLI: runs the seeded multi-controller benchmark and writes
 * JSONL (per-trial) + JSON (per-run summaries) into research_data/.
 *
 * Usage:
 *   node benchmark.js --quick          2 seeds x 40/10 trials, 8 s episodes (smoke)
 *   node benchmark.js                  study default: 5 seeds x 300/60, 12 s episodes (~1 h)
 *   node benchmark.js --full           PDF spec: 10 seeds x 1000/200, 60 s episodes (~days)
 *   node benchmark.js --light          connectome only on 1 seed (perf)
 *   node benchmark.js --config stage1_config.json
 *                                 Stage-1 protocol run: five arms (A–E) over
 *                                 the pinned seed-pair table, with the frozen
 *                                 pre-baseline and a run manifest carrying
 *                                 per-phase counts + selectivity. Does NOT run
 *                                 the pre-registration gate itself (protocol
 *                                 §13: PRE_REGISTRATION_STAGE1.json must exist
 *                                 and verify BEFORE any pilot/simulation).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { makeRng, runBenchmark, meanCI, demonObsBand } = require("./experiment_core");
const { classicalDemon, demonDecisionFor, randomController,
        annController, drosophilaController, connectomeController,
        degreeMatchedRandomEdges } = require("./controllers");

// ---- argv
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const has = (name) => args.includes("--" + name);
const CONFIG_PATH = flag("config", null);       // Stage-1 protocol mode
const QUICK = has("quick");
const FULL = has("full");
const N_SEEDS = parseInt(flag("seeds", QUICK ? "2" : FULL ? "10" : "5"), 10);
const T_TRAIN = parseInt(flag("train", QUICK ? "40" : FULL ? "1000" : "300"), 10);
const T_TEST = parseInt(flag("test", QUICK ? "10" : FULL ? "200" : "60"), 10);
const EPISODE_S = parseFloat(flag("episode", QUICK ? "8" : FULL ? "60" : "12"));
const LIGHT = has("light");
const PROGRESS_EVERY = 25;   // trials between progress lines

// ---- runtime identity for provenance (tools/make_manifest.py convention)
function sha256File(p) {
  const h = require("crypto").createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}
function gitRev() {
  try { return require("child_process").execSync("git rev-parse HEAD", { cwd: __dirname }).toString().trim(); }
  catch { return "UNKNOWN"; }
}
function gitDirty() {
  try { return require("child_process").execSync("git status --porcelain", { cwd: __dirname }).toString().length > 0; }
  catch { return true; }
}

// ============================================================ Stage-1 mode ==
if (CONFIG_PATH) {
  const cfgPath = path.isAbsolute(CONFIG_PATH) ? CONFIG_PATH : path.join(__dirname, CONFIG_PATH);
  const config = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  if (!config.seedTable || !Array.isArray(config.seedTable.pairs))
    throw new Error("Stage-1 config missing seedTable.pairs");

  const consumed = config.seedTable.consumedPairs !== undefined
    ? config.seedTable.consumedPairs : 3;
  // §6c: rows beyond consumedPairs are pre-drawn reserve and MUST NOT run.
  const seedSpecs = config.seedTable.pairs.slice(0, consumed).map(p => ({
    runId: "pair_" + p.k,
    environmentSeed: p.environmentSeed,
    networkSeed: p.networkSeed,
    topologySeed: p.topologySeed,
  }));

  // pilot-prohibition mechanical assist (protocol §13): refuse to run if a
  // registration file is absent; presence of the file is verified at hash
  // level by stage1_analyze.js (the CLI only checks existence here).
  const regPath = path.join(__dirname, "PRE_REGISTRATION_STAGE1.json");
  if (!fs.existsSync(regPath)) {
    console.error("REFUSING to run: PRE_REGISTRATION_STAGE1.json is missing.\n" +
      "Protocol §13: generate the registration record (pin hashes) BEFORE any Stage-1 simulation.");
    process.exit(2);
  }

  console.log(`[stage1] arms=${Object.keys(config.arms).length} pairs=${consumed} ` +
    `pre=${config.phases.pre.trials}x${config.phases.pre.episodeSeconds}s(frozen) ` +
    `train=${config.phases.train.trials}x${config.phases.train.episodeSeconds}s ` +
    `post=${config.phases.post.trials}x${config.phases.post.episodeSeconds}s`);

  // cache the circuit ONCE (arms A–D read it; ~250k edges)
  const circuitPath = path.join(__dirname, "fly_brain_circuit.json");
  const hasCircuit = fs.existsSync(circuitPath);
  const circuit = hasCircuit ? JSON.parse(fs.readFileSync(circuitPath, "utf8")) : null;
  if (!hasCircuit) {
    console.error("REFUSING to run: fly_brain_circuit.json missing (arms A–D require the connectome).");
    process.exit(2);
  }

  const OPTIC_DRIVE = 0.25;   // sparsest divergent regime (pre-registered operating point)
  const OPTIC_INPUT = "legacy8bin";   // stabilization-pass default (documented)
  // (Stage-3 demon observation arm) config plumbing. Contract: top-level
  // `demonObs` (DEFAULT FALSE, browser parity) is the run default for the
  // arm-level registered flag, `demonObsGain` (DEFAULT 12) the obs-tail
  // injection gain into the reserved input-layer sub-band; each arm may
  // override both. When NO flag appears anywhere, `demonObsArms` stays empty
  // and runBenchmark is called EXACTLY as before — byte-identical OFF path.
  const demonObsArms = {};
  for (const [armKey, arm] of Object.entries(config.arms))
    if (arm.demonObs !== undefined || config.demonObs !== undefined)
      demonObsArms[armKey] = arm.demonObs !== undefined ? !!arm.demonObs
                              : !!config.demonObs;
  const obsGainOf = (arm) => arm.demonObsGain !== undefined ? arm.demonObsGain
    : config.demonObsGain !== undefined ? config.demonObsGain : 12;
  const obsArmKeys = Object.keys(demonObsArms).filter(k => demonObsArms[k]);
  const anyObsOn = obsArmKeys.length > 0;
  const runGain = config.demonObsGain !== undefined ? config.demonObsGain : 12;
  // the reserved input-layer sub-band, computed ONCE from the real circuit
  // with the SAME slice math the injector and browser application use
  // (FAFB input layer L = 2875 → [2472, 2875), 403 reserved neurons).
  const OBS_BAND = anyObsOn ? demonObsBand(circuit) : null;
  if (anyObsOn && !OBS_BAND)
    throw new Error("demonObs on but the input-layer band could not be derived from the circuit");
  if (config.physics.lr === undefined)
    throw new Error("Stage-1 config missing physics.lr (the dopamine-gated plasticity rate) — add it explicitly, never inherit it silently");

  const controllers = {};
  for (const [armKey, arm] of Object.entries(config.arms)) {
    if (arm.kind === "connectome") {
      controllers[armKey] = (rng, env, cfg, spec) => {
        const opts = {
          shuffle: !!arm.shuffle,
          plasticity: arm.plasticity || "full",
          rng, seed: spec.networkSeed,
          // lr (dopamine-gated plasticity rate) comes from the config's
          // physics.lr unless an arm overrides it (protocol §2 deliverable:
          // --config carries env/network/topology seeds AND lr).
          lr: arm.lr !== undefined ? arm.lr : config.physics.lr,
          opticDrive: arm.opticDrive !== undefined ? arm.opticDrive : OPTIC_DRIVE,
          opticInput: arm.opticInput || OPTIC_INPUT,
          // (Stage-3 demon observation) registered arm flags; undefined keys
          // mean "no flag declared" and the controller stays byte-identical.
          demonObs: demonObsArms[armKey],
          demonObsGain: obsGainOf(arm),
        };
        if (arm.customEdges === "degreeMatchedRandomEdges") {
          // arm D: the drawn edge list rides on THIS seed's topology stream
          const list = degreeMatchedRandomEdges(circuit, { seed: spec.topologySeed, swapFactor: arm.swapFactor || 10 })();
          opts.customEdges = list;
        }
        return connectomeController(circuit, opts);
      };
    } else if (arm.kind === "random") {
      controllers[armKey] = (rng, env, cfg) => {
        if (arm.policy === "randomActionFloor") {
          // arm E: floor of ≥2 random open/close decisions per 10 s (protocol §3)
          return randomController(rng, env, cfg, { minDecisionsPer10s: 2 });
        }
        return randomController(rng, env, cfg);
      };
    } else throw new Error("Unknown arm kind: " + arm.kind);
  }

  const t0 = Date.now();
  const result = runBenchmark({
    nSeeds: seedSpecs.length,
    seedSpecs,
    trialsPre: config.phases.pre.trials,
    preEpisodeSeconds: config.phases.pre.episodeSeconds,
    frozenPreSeconds: config.frozenPreSeconds,
    trialsTrain: config.phases.train.trials,
    trialsTest: config.phases.post.trials,   // legacy column carries the post count
    trialsPost: 0,                            // post == test here (§11 table)
    episodeSeconds: config.phases.train.episodeSeconds,
    nParticles: config.physics.nParticles,
    noise: config.physics.noise,
    doorHeight: config.physics.doorHeight,
    controllers,
    // (Stage-3 demon observation) registered-arm plumbing — ONLY the fields
    // below; the DA rule (q·0.6·rewScale), actuate() and the door reflex are
    // untouched: the obs arm changes the SENSORY INPUT and nothing else.
    demonObs: anyObsOn,          // run has ≥1 obs arm (env/window gating)
    demonObsArms,                // per-arm flag map — row stamping follows the arm
    demonObsGain: runGain,       // run-level default gain
    demonObsBand: OBS_BAND,      // reserved sub-band from the real circuit
    onTrial: (cond, phase, t, n, si, sn) => {
      if (t % PROGRESS_EVERY === 0)
        console.log(`  [${cond}] pair ${si + 1}/${sn} ${phase} trial ${t + 1}/${n}`);
    },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("simulation finished in", elapsed, "s");

  // ---- run manifest (the §12 contract: per-phase counts + selectivity) ----
  const outDir = path.join(__dirname, "research_data");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const jsonlPath = path.join(outDir, `stage1_trials_${stamp}.jsonl`);
  // Stream rows to disk instead of accumulating one giant string: the full
  // pilot set (5,415 rows, ~115 KB/row with fireVec/layerRates) exceeds V8's
  // max string length and crashed the 2026-10-07 pilot AFTER the entire
  // simulation had finished (RangeError: Invalid string length at join).
  // Output bytes are IDENTICAL to the old join-based write (same row order,
  // same trailing newline).
  let n_rows = 0;
  {
    const fd = fs.openSync(jsonlPath, "w");
    try {
      for (const [key, cond] of Object.entries(result.conditions)) {
        for (const run of cond._raw)
          for (const tr of run.trials) {
            fs.writeSync(fd, JSON.stringify(Object.assign({ condition: key }, tr)) + "\n");
            n_rows++;
          }
      }
    } finally { fs.closeSync(fd); }
  }

  // per-phase trial counts per arm (protocol §12: malformed if absent)
  const phaseCounts = {};
  // per-arm, per-pair pre/post sorting performance + selectivity deltas
  const deltaSelectivity = {};
  for (const key of Object.keys(result.conditions)) {
    const run = result.conditions[key]._raw[0];
    const byPhase = { pre: 0, train: 0, post: 0 };
    for (const tr of run.trials) {
      const ph = tr.phase === "test" ? "post" : tr.phase;
      if (byPhase[ph] !== undefined) byPhase[ph]++;
    }
    phaseCounts[key] = byPhase;
    const preRows = run.trials.filter(t => t.phase === "pre");
    const postRows = run.trials.filter(t => (t.phase === "post" || t.phase === "test"));
    const mean = (arr, f) => arr.length ? arr.reduce((a, r) => a + (Number.isFinite(r[f]) ? r[f] : 0), 0) / arr.length : null;
    deltaSelectivity[key] = {
      deltaSortEntropy: mean(postRows, "sortEntropy") - mean(preRows, "sortEntropy"),
      deltaGoodBadRatio: mean(postRows, "goodBadRatio")
        && mean(preRows, "goodBadRatio")
        ? mean(postRows, "goodBadRatio") - mean(preRows, "goodBadRatio") : null,
      deltaDTfinal: mean(postRows, "dTfinal") - mean(preRows, "dTfinal"),
      deltaDemonAgree: mean(postRows, "demonAgree") - mean(preRows, "demonAgree"),
    };
  }

  const manifest = {
    manifest_version: 1,
    stage: 1,
    status: "EXPLORATORY — no inferential claims (protocol §7)",
    generated: stamp,
    protocol: { document: "Confirmatory_experiment_protocol_v1.md", version: "v1.1" },
    config: { path: path.relative(__dirname, cfgPath), sha256: sha256File(cfgPath) },
    runtimeFiles: {
      experiment_core: sha256File(path.join(__dirname, "experiment_core.js")),
      controllers: sha256File(path.join(__dirname, "controllers.js")),
      benchmark: sha256File(__filename),
    },
    git: { commit: gitRev(), dirty: gitDirty(), branch: "deployment/phase-02" },
    consumedSeedPairs: consumed,
    seedSpecs,
    // (Stage-3 demon observation) manifest block — present ONLY when at least
    // one arm carries the registered flag; OFF manifests gain NO keys.
    ...(anyObsOn ? {
      demonObs: {
        on: true,
        gain: runGain,
        armGains: Object.fromEntries(obsArmKeys.map(k => [k, obsGainOf(config.arms[k])])),
        arms: obsArmKeys,
        band: OBS_BAND ? { lo: OBS_BAND.lo, hi: OBS_BAND.hi, neurons: OBS_BAND.neurons,
                           inputLayer: OBS_BAND.inputLayer } : null,
        sensorVector: "base 7 then obs_8 (one-hot FSM state WATCH/ATTEND/HOLD/STRIKE/RECOIL, " +
          "timeSinceAction 2s clamp, goodRate rolling-20 with 0.5 prior, gateCmd = door.target) — " +
          "exact fly_demon_3d.html demonObsVector() ordering",
        inputBand: "reserved sub-band [floor(0.86·L), L) of input layer 0; obs-tail injection gain " +
          "per demonObsGain (browser constants: OBS_INPUT_BAND [0.86, 1.0], DEMON_OBS_INPUT_GAIN 12)",
        scope: "sensory input ONLY — the DA rule (q·0.6·rewScale), actuate() and the door reflex are untouched",
      },
    } : {}),
    physics: {
      nParticles: config.physics.nParticles, noise: config.physics.noise,
      doorHeight: config.physics.doorHeight, dt: 1 / 60,
      episodeSeconds: config.phases.train.episodeSeconds,
      frozenPreSeconds: config.frozenPreSeconds,
    },
    phases: { pre: "1x120s frozen", train: `${config.phases.train.trials}x${config.phases.train.episodeSeconds}s`, post: `${config.phases.post.trials}x${config.phases.post.episodeSeconds}s` },
    phaseCounts,
    deltaSelectivity,
    thermoTrack: "separate (protocol §15); budget table printed, never mixed into the behavioral endpoint",
    files: { trials: path.basename(jsonlPath), trialsSha256: sha256File(jsonlPath) },
    n_rows,
    elapsedSeconds: parseFloat(elapsed),
  };
  const manifestPath = path.join(outDir, `stage1_manifest_${stamp}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log("wrote", jsonlPath, `(${n_rows} trials)`);
  console.log("wrote", manifestPath);

  // ---- descriptive readout (NO p-values — Stage 1 is exploratory) --------
  console.log("\n=== Stage-1 descriptive deltas (post − pre, mean over pairs) ===");
  for (const [key, d] of Object.entries(deltaSelectivity)) {
    const fmt = (x) => x === null || !Number.isFinite(x) ? "n/a" : x.toFixed(4);
    console.log(key.padEnd(30),
      "ΔsortEntropy", fmt(d.deltaSortEntropy),
      "| ΔdT", fmt(d.deltaDTfinal),
      "| Δgood:bad", d.deltaGoodBadRatio === null ? "n/a" : d.deltaGoodBadRatio.toFixed(3),
      "| Δagree", fmt(d.deltaDemonAgree));
  }
  console.log("\nStage 1 is EXPLORATORY (protocol §7): these deltas are scoping",
    "measurements for Stage-2 sizing, not evidence of any arm's superiority.");

  // ---- thermodynamic budget: SEPARATE track (protocol §15) ---------------
  const fmtJ = (x) => !Number.isFinite(x) ? "n/a" : x === 0 ? "0 J" : x.toExponential(2) + " J";
  console.log("\n=== thermodynamic budget (post phase, per trial) — separate track ===");
  console.log("condition".padEnd(30), "work_in".padStart(12), "extractable".padStart(12),
    "ext/cost".padStart(10), "bits_used".padStart(10));
  for (const [key, cond] of Object.entries(result.conditions)) {
    const posts = cond._raw[0].trials.filter(t => t.phase === "post" || t.phase === "test");
    const avg = (f) => posts.reduce((a, r) => a + (Number.isFinite(r[f]) ? r[f] : 0), 0) / Math.max(1, posts.length);
    const w = avg("workInJ"), x = avg("extractableJ"), l = avg("erasureCostJ");
    console.log(key.padEnd(30), fmtJ(w).padStart(12), fmtJ(x).padStart(12),
      (l > 0 ? (x / l).toExponential(1) : "n/a").padStart(10),
      Math.round(avg("measuredBits")).toLocaleString("en-US").padStart(10));
  }
  console.log("\nThermo metrics are measurement-chain diagnostics (protocol §15):",
    "no Stage-1 or Stage-2 claim may mix them with the behavioral endpoint.");
  process.exit(0);
}

// ================================================= standard benchmark mode ==
// ---- load the connectome circuit (31 MB JSON; parse once, reuse) -------
function loadCircuit() {
  const p = path.join(__dirname, "fly_brain_circuit.json");
  console.log("loading", p, "...");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function buildControllers(circuit) {
  const list = {
    classical_demon: (rng, env, cfg) => classicalDemon(rng, env, cfg),
    random: (rng, env, cfg) => randomController(rng, env, cfg),
    ann: (rng, env, cfg) => annController(rng, env, cfg),
    drosophila: (rng, env, cfg) => drosophilaController(rng, env, cfg),
  };
  if (!LIGHT) {
    // opticDrive 0.25: sparsest sensory regime where real-vs-shuffled wiring
    // diverges behaviorally (verified by sweep) — aggregate drive at 1.0
    // saturates the motor layer and makes topology irrelevant.
    const OPTIC_DRIVE = 0.25;
    list.connectome = (rng, env, cfg) => {
      const c = connectomeController(circuit, { shuffle: false, rng, seed: 1,
                                                opticDrive: OPTIC_DRIVE });
      c._rng = rng; return c;
    };
    list.shuffled_connectome = (rng, env, cfg) => {
      const c = connectomeController(circuit, { shuffle: true, rng, seed: 7,
                                                opticDrive: OPTIC_DRIVE });
      c._rng = rng; return c;
    };
  }
  return list;
}

// ---- run ---------------------------------------------------------------
const circuit = LIGHT ? null : loadCircuit();
console.log(`benchmark: seeds=${N_SEEDS} train=${T_TRAIN} test=${T_TEST} episode=${EPISODE_S}s light=${LIGHT}`);

const t0 = Date.now();
const result = runBenchmark({
  seed: 1, nSeeds: N_SEEDS,
  trialsTrain: T_TRAIN, trialsTest: T_TEST,
  episodeSeconds: EPISODE_S,
  nParticles: 320, noise: 0.12, doorHeight: 64,
  controllers: buildControllers(circuit || {}),
  onTrial: (cond, phase, t, n, si, sn) => {
    if (t % PROGRESS_EVERY === 0)
      console.log(`  [${cond}] seed ${si + 1}/${sn} ${phase} trial ${t + 1}/${n}`);
  },
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log("simulation finished in", elapsed, "s");

// ---- persist ------------------------------------------------------------
const outDir = path.join(__dirname, "research_data");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const jsonlPath = path.join(outDir, `trials_${stamp}.jsonl`);
const lines = [];
for (const [key, cond] of Object.entries(result.conditions)) {
  for (const run of cond._raw) {
    for (const tr of run.trials) {
      lines.push(JSON.stringify(Object.assign({ condition: key }, tr)));
    }
  }
}
fs.writeFileSync(jsonlPath, lines.join("\n") + "\n");

const summary = { generated: stamp, elapsedSeconds: parseFloat(elapsed), conditions: {} };
for (const [key, cond] of Object.entries(result.conditions)) {
  const { _raw, ...rest } = cond;
  // per-trial aggregate for figures: mean demonAgree per 10-trial block
  const blocks = [];
  for (const run of _raw) {
    const n = run.trials.length;
    const bCount = Math.floor(n / 10);
    for (let b = 0; b < bCount; b++) {
      const seg = run.trials.slice(b * 10, (b + 1) * 10);
      const agree = seg.reduce((a, t) => a + (t.demonAgree || 0), 0) / seg.length;
      const gb = seg.reduce((a, t) => a + (t.goodBadRatio || 0), 0) / seg.length;
      const ent = seg.reduce((a, t) => a + (t.sortEntropy || 0), 0) / seg.length;
      const mi = seg.reduce((a, t) => a + (t.miNeural || 0), 0) / seg.length;
      const energy = seg.reduce((a, t) => a + (t.energyJ || 0), 0) / seg.length;
      blocks.push({ block: b, phase: seg[0].phase, agree, goodBadRatio: gb,
                    sortEntropy: ent, miNeural: mi, energyJ: energy });
    }
  }
  summary.conditions[key] = Object.assign({}, rest, { blocks });
}
const summaryPath = path.join(outDir, `summary_${stamp}.json`);
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

console.log("wrote", jsonlPath, `(${lines.length} trials)`);
console.log("wrote", summaryPath);
console.log("\n=== headline results (test phase, mean ± 95% CI) ===");
for (const [key, cond] of Object.entries(summary.conditions)) {
  const a = cond.testAgreement || { mean: 0, ci: 0 };
  const se = cond.testSortEntropy || { mean: 0, ci: 0 };
  console.log(
    key.padEnd(22),
    "demonAgree", a.mean.toFixed(3), "±", a.ci.toFixed(3),
    "| sortEntropy", se.mean.toFixed(4), "±", se.ci.toFixed(4),
    "| good:bad", (cond.testGoodBadRatio || { mean: 0 }).mean.toFixed(2)
  );
}

// ---- thermodynamic budget (test phase, per-trial means) ----------------
const fmtJ = (x) => {
  if (!Number.isFinite(x)) return "n/a";
  if (x === 0) return "0 J";
  return x.toExponential(2) + " J";
};
const LANDAUER_BIT_J = 2.871e-21;   // k_B*300K*ln2, for the needed-bits column
console.log("\n=== thermodynamic budget (test phase, per trial) ===");
console.log(
  "condition".padEnd(22),
  "work_in".padStart(12),
  "extractable".padStart(12),
  "efficiency".padStart(11),
  "landauer_cost".padStart(14),
  "ext/cost".padStart(10),
  "bits_need".padStart(10),
  "bits_used".padStart(10)
);
for (const [key, cond] of Object.entries(summary.conditions)) {
  const w = (cond.testWorkInJ || { mean: NaN }).mean;
  const x = (cond.testExtractableJ || { mean: NaN }).mean;
  const l = (cond.testErasureCostJ || { mean: NaN }).mean;
  const b = (cond.testMeasuredBits || { mean: 0 }).mean;
  const eff = Number.isFinite(w) && w > 0 ? x / w : NaN;
  const bitsNeed = Number.isFinite(x) ? x / LANDAUER_BIT_J : NaN;
  console.log(
    key.padEnd(22),
    fmtJ(w).padStart(12),
    fmtJ(x).padStart(12),
    Number.isFinite(eff) ? eff.toExponential(1).padStart(11) : "n/a".padStart(11),
    fmtJ(l).padStart(14),
    (Number.isFinite(x) && l > 0 ? (x / l).toExponential(1) : "n/a").padStart(10),
    (Number.isFinite(bitsNeed) ? Math.round(bitsNeed).toLocaleString("en-US") : "n/a").padStart(10),
    Math.round(b).toLocaleString("en-US").padStart(10)
  );
}
console.log("\nReading the budget:\n" +
  "  efficiency = extractable / work_in — the sorted state's free energy comes\n" +
  "  from the heat jet's external work, so the second law is bounded by this\n" +
  "  ratio (<< 1 here), not by the Landauer column.\n" +
  "  bits_need = extractable work priced in Landauer bits at 300 K — the memory\n" +
  "  traffic a demon would need to write per trial for its erasure bill to match\n" +
  "  the work it gains. bits_used = decision flips + feedback bits actually\n" +
  "  metered. bits_used << bits_need means this demon barely memorizes: its\n" +
  "  erasure cost is negligible and its sorting is jet-subsidized, not\n" +
  "  information-driven. That is the honest thermodynamic budget, not a\n" +
  "  second-law violation.");
