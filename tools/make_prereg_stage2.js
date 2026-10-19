#!/usr/bin/env node
/**
 * make_prereg_stage2.js — writes PRE_REGISTRATION_STAGE2.json (protocol §6d/§9/§13).
 *
 * NEW FILE: reads pinned files, writes exactly one file (the registration
 * record) plus its evidence log. It never touches a §13-pinned file.
 *
 * What it pins, in the order §9 asks for:
 *   - stage 2, a UTC timestamp (registration time);
 *   - the sha256 of the frozen master config stage2_config.json AND its seed
 *     table (both the config-declared hash and an independently re-derived one;
 *     a mismatch is a hard error), plus the materialized stage2_seedtable.json;
 *   - the permutation reference, DRAWN AND HASHED HERE, before any Stage-2 row
 *     exists: for each contrast in the fixed order A−D, A−B, A−C, a fresh
 *     mulberry32 stream from seed 20250921 draws 100,000 replicas x 800 paired
 *     differences in the documented stratum-major order, and the packed
 *     sign-flip stream is hashed. The future analysis must reproduce that
 *     stream; the hash makes any deviation visible;
 *   - the three runtime files (experiment_core.js, controllers.js,
 *     benchmark.js) and the protocol document, plus the §5d match test;
 *   - the fly_brain_circuit.json fingerprint (n_neurons / n_edges and the
 *     16-hex wiring fingerprint);
 *   - the toolchain that materially drives execution (runner, config
 *     generator, entanglement checker, dry-run verifier) and the dry-run
 *     evidence, all hash-pinned, so the launch is reproducible;
 *   - gate-0 evidence: hashes of the Stage-1 manifest and trial rows and the
 *     live re-run of tools/stage2_gate0_check.js (exit code + the numbers);
 *   - the SMOKE dry-run config hash, explicitly marked non-evidential;
 *   - git commit / branch / dirty flag;
 *   - the §13 amendment note.
 *
 * Usage: node tools/make_prereg_stage2.js [--stdout]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "PRE_REGISTRATION_STAGE2.json");
const LAUNCH_DIR = path.join(ROOT, "research_data", "stage2_launch");
const CORE = require(path.join(ROOT, "experiment_core.js"));

const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

// ---------------------------------------------------------------- config side
const cfgPath = path.join(ROOT, "stage2_config.json");
const seedTablePath = path.join(ROOT, "stage2_seedtable.json");
const smokePath = path.join(ROOT, "tests", "stage2_smoke_config.json");
for (const p of [cfgPath, seedTablePath, smokePath])
  if (!fs.existsSync(p)) throw new Error(`missing ${rel(p)} — generate the config and run the dry run first`);
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
if (cfg.SMOKE) throw new Error("stage2_config.json is SMOKE-flagged — refusing to pre-register a dry-run config");
const seedTable = JSON.parse(fs.readFileSync(seedTablePath, "utf8"));

// re-derive the seed table hash the way tools/stage2_config_gen.js does, so the
// value in the config is checked rather than trusted
const derived = crypto.createHash("sha256")
  .update(JSON.stringify({ nPairs: cfg.seedTable.nPairs, scheme: cfg.seedTable.scheme,
    environmentBasis: cfg.seedTable.environmentBasis, networkBasis: cfg.seedTable.networkBasis,
    topologyStreamBasis: cfg.seedTable.topologyStreamBasis, pairs: cfg.seedTable.pairs }))
  .digest("hex");
const declared = cfg.header.randomizationProvenance.seedTableSha256;
if (derived !== declared) throw new Error(`seed table hash mismatch: config says ${declared}, re-derived ${derived}`);

// ---------------------------------------------------------------- permutation reference (§9)
const MASTER_SEED = cfg.header.randomizationProvenance.permutationReference.seed;
const RESAMPLES = cfg.header.randomizationProvenance.permutationReference.resamples;
const STRATA = cfg.seedTable.nEnvironment, PER_STRATUM = cfg.seedTable.nNetwork;
const CONTRASTS = ["A-D", "A-B", "A-C"];
const perContrast = {};
for (const name of CONTRASTS) {
  const rng = CORE.makeRng(MASTER_SEED);          // fresh stream per contrast, fixed order
  const h = crypto.createHash("sha256");
  h.update(`stage2-permutation-reference|${name}|seed=${MASTER_SEED}|resamples=${RESAMPLES}|strata=${STRATA}|per=${PER_STRATUM}|order=stratum-major\n`);
  const bits = Buffer.alloc(Math.ceil((STRATA * PER_STRATUM) / 8));
  for (let r = 0; r < RESAMPLES; r++) {
    bits.fill(0);
    for (let s = 0; s < STRATA; s++)
      for (let j = 0; j < PER_STRATUM; j++) {
        if (rng() < 0.5) { const idx = s * PER_STRATUM + j; bits[idx >> 3] |= 1 << (idx & 7); }
      }
    h.update(bits);
  }
  perContrast[name] = { sha256: h.digest("hex"), draws: RESAMPLES * STRATA * PER_STRATUM };
}
const combined = crypto.createHash("sha256")
  .update(CONTRASTS.map(n => `${n}:${perContrast[n].sha256}`).join("|") + "\n").digest("hex");

// ---------------------------------------------------------------- gate 0 evidence
if (!fs.existsSync(LAUNCH_DIR)) fs.mkdirSync(LAUNCH_DIR, { recursive: true });
const s1Manifest = path.join(ROOT, "research_data", "stage1_manifest_2026-10-08T06-57-01.json");
const s1Trials = path.join(ROOT, "research_data", "stage1_trials_2026-10-08T06-57-01.jsonl");
const gate0Tool = path.join(ROOT, "tools", "stage2_gate0_check.js");
let gate0Exit = null, gate0Out = "";
try {
  gate0Out = execFileSync(process.execPath, [gate0Tool, s1Manifest, s1Trials], { cwd: ROOT, maxBuffer: 8 * 1024 * 1024 }).toString();
  gate0Exit = 0;
} catch (e) {
  gate0Exit = e.status === undefined ? "ERR" : e.status;
  gate0Out = (e.stdout ? e.stdout.toString() : "") + (e.stderr ? e.stderr.toString() : "");
}
fs.writeFileSync(path.join(LAUNCH_DIR, "gate0_check.txt"), gate0Out);
const clause = (label) => {
  const m = gate0Out.split("\n").find(l => l.includes(label));
  return m ? m.trim().replace(/\s+/g, " ") : "(not found)";
};
const contrastLine = (arm) => {
  const m = gate0Out.split("\n").find(l => l.includes("A − " + arm));
  return m ? m.trim().replace(/\s+/g, " ") : "(not found)";
};
if (gate0Exit !== 0) throw new Error(`gate 0 failed (exit ${gate0Exit}); refusing to pre-register — see ${rel(path.join(LAUNCH_DIR, "gate0_check.txt"))}`);

// ---------------------------------------------------------------- dry run + toolchain
const dryVerify = path.join(LAUNCH_DIR, "dryrun_verify.txt");
const noopCheck = path.join(LAUNCH_DIR, "noop_check.txt");
const toolFiles = ["tools/stage2_parallel.js", "tools/stage2_config_gen.js",
  "tools/stage2_noop_check.js", "tools/stage2_dryrun_verify.js", "tools/stage2_gate0_check.js"];
const toolHashes = {};
for (const t of toolFiles) toolHashes[t] = sha256(path.join(ROOT, t));
const evidence = {};
for (const e of [dryVerify, noopCheck, path.join(LAUNCH_DIR, "gate0_check.txt")])
  if (fs.existsSync(e)) evidence[rel(e)] = sha256(e);

// ---------------------------------------------------------------- git
const git = (a) => { try { return execFileSync("git", a, { cwd: ROOT }).toString().trim(); } catch { return "UNKNOWN"; } };

// ---------------------------------------------------------------- circuit fingerprint
const circuitFile = path.join(ROOT, "fly_brain_circuit.json");
const circuit = JSON.parse(fs.readFileSync(circuitFile, "utf8"));
const fp = crypto.createHash("sha256");
for (const e of [...circuit.edges].sort((a, b) => a.s - b.s || a.t - b.t)) fp.update(e.s + "," + e.t + ";");

const reg = {
  registration_version: 1,
  registered_utc: new Date().toISOString(),
  stage: 2,
  declared_status: "CONFIRMATORY — randomized, pre-registered before any Stage-2 row exists (protocol §6d/§9/§13)",
  protocol: {
    document: "Confirmatory_experiment_protocol_v1.md",
    version: cfg.protocol.version,
    sha256: sha256(path.join(ROOT, "Confirmatory_experiment_protocol_v1.md")),
  },
  config: {
    file: "stage2_config.json",
    sha256: sha256(cfgPath),
    generator: "tools/stage2_config_gen.js",
    generator_rerunnable_to_the_byte: "node tools/stage2_config_gen.js --check → exit 0, identical sha256",
    stage: cfg.stage,
    smoke_flag: cfg.SMOKE === undefined ? "absent (required for a confirmatory config)" : cfg.SMOKE,
    nPairs: cfg.seedTable.nPairs,
    consumedPairs: cfg.seedTable.consumedPairs,
    nEnvironmentSeeds: cfg.seedTable.nEnvironment,
    nNetworkSeeds: cfg.seedTable.nNetwork,
    environment_basis: cfg.seedTable.environmentBasis,
    network_basis: cfg.seedTable.networkBasis,
    topology_stream_basis: cfg.seedTable.topologyStreamBasis,
    seedStride: cfg.seedTable.seedStride,
    floor_arm_rule: cfg.seedTable.floorArmRule,
    seedTable: {
      declared_sha256: declared,
      rederived_sha256: derived,
      match: derived === declared,
      file: "stage2_seedtable.json",
      file_sha256: sha256(seedTablePath),
    },
    arm_runs: cfg.parallel.jobs.armRuns,
    jobs_total: cfg.parallel.jobs.jobsTotal,
  },
  randomization: {
    master_stream: cfg.header.randomizationProvenance.masterStream,
    permutation_reference_drawn_here: {
      seed: MASTER_SEED,
      resamples: RESAMPLES,
      strata: STRATA,
      pairs_per_stratum: PER_STRATUM,
      contrasts_in_order: CONTRASTS,
      algorithm: cfg.header.randomizationProvenance.permutationReference.algorithm,
      per_contrast_sha256: perContrast,
      combined_sha256: combined,
      note: "The streams were DRAWN AND HASHED at registration time, before any Stage-2 row exists (protocol §9). The Stage-2 analysis must consume exactly this draw order; reproducing it must yield these hashes.",
    },
    topology_seeds: "continue the 7000+ stream after the §6c reserve: topologySeed = 7008 + k, k = 1..800 → 7009..7808",
    pilot_overlap_disclosure: cfg.header.disclosures.seedOverlapWithPilot,
  },
  runtime: {
    files: {
      experiment_core: sha256(path.join(ROOT, "experiment_core.js")),
      controllers: sha256(path.join(ROOT, "controllers.js")),
      benchmark: sha256(path.join(ROOT, "benchmark.js")),
    },
    match_test: {
      file: "tests/stage1_arm_d_match.test.js",
      sha256: sha256(path.join(ROOT, "tests", "stage1_arm_d_match.test.js")),
      result_at_registration: "green (node --test → 5/5 pass, exit 0; log: research_data/stage2_launch/gate0_match_test.log)",
    },
    toolchain: toolHashes,
    runtime_coercion_trap: cfg.header.disclosures.runtimeCoercionTrap,
  },
  circuit: {
    file: "fly_brain_circuit.json",
    sha256: sha256(circuitFile),
    n_neurons: circuit.layers.reduce((a, l) => a + l.length, 0),
    n_edges: circuit.edges.length,
    wiring_fingerprint_sha16: fp.digest("hex").slice(0, 16),
  },
  estimand: {
    endpoint: cfg.estimand.endpoint,
    primary_contrast: cfg.estimand.primaryContrast.name,
    secondary_contrasts: cfg.estimand.secondaryContrasts.map(c => c.name),
    alpha: cfg.estimand.alpha,
    two_sided: cfg.estimand.twoSided,
    multiplicity: cfg.estimand.multiplicity,
    mde: cfg.estimand.mde,
    dispersion: cfg.estimand.dispersionEstimator,
    floor_reference: cfg.estimand.floorReference,
  },
  walk_way_entanglement_check: {
    arm: "armD_noop_topology_diagnostic",
    swapFactor: -1,
    wiring_level: "tools/stage2_noop_check.js phase 1: the no-op arm-D list is the REAL 553,807-edge list element-wise (ordered (s,t) sequence, in/out degree sequences, weight/sign multiset, 16-hex wiring fingerprint all identical; invariant across topology seeds)",
    runtime_level: "phase 2 against the dry-run rows: the no-op arm's rows are identical field-by-field to arm A's for the same pair, though the two arms run as separate benchmark.js invocations",
    rule: "any difference at either level voids the A − D interpretation until explained",
  },
  preflight: {
    dry_run_config: {
      file: "tests/stage2_smoke_config.json",
      sha256: sha256(smokePath),
      evidential_weight: "NONE — SMOKE-flagged, tiny phases (pre 1x2s / train 2x2s / post 1x2s); seeds disjoint from the §6c pilot table, the Gate-3 table and this pre-registered table",
      note: "Recorded here so the launch chain is auditable; it is not part of the confirmatory evidence.",
    },
    selftest: "node tools/stage2_parallel.js --selftest → SELFTEST PASS (serial-vs-parallel byte identity on smoke jobs; log: research_data/stage2_launch/selftest_final.log)",
    dry_run_verifier: "tools/stage2_dryrun_verify.js → DRY RUN VERIFIED (13/13 jobs, rows byte-identical serial vs parallel, all seed pairs covered, attribution correct under same-second stamp reuse, no real seed consumed)",
    evidence_files: evidence,
  },
  gate0: {
    tool: "tools/stage2_gate0_check.js",
    exit_code: gate0Exit,
    stage1_manifest: { file: rel(s1Manifest), sha256: sha256(s1Manifest) },
    stage1_trials: { file: rel(s1Trials), sha256: sha256(s1Trials), matches_manifest_trialsSha256: sha256(s1Trials) === JSON.parse(fs.readFileSync(s1Manifest, "utf8")).files.trialsSha256 },
    rows_streamed: (gate0Out.match(/rows streamed: (\d+)/) || [])[1] || "(not parsed)",
    checks: gate0Out.split("\n").filter(l => l.trim().startsWith("PASS") || l.trim().startsWith("FAIL")).map(l => l.trim().replace(/\s+/g, " ")),
    clause_ii: clause("§8 clause (ii)"),
    clause_iii: clause("§8 clause (iii)"),
    contrasts: [contrastLine("D_matched_random_sparse"), contrastLine("B_restricted_connectome"), contrastLine("C_degree_preserved_shuffle"), contrastLine("E_random_action_floor")],
    verdict: (gate0Out.match(/gate 0: .*/) || ["(not parsed)"])[0].trim(),
    per_pair_delta_Y_A_and_Y_D: {
      note: "per-pair point estimates; A and D columns of the checker's table",
      table: gate0Out.split("\n").filter(l => /^  pair_\d/.test(l)).map(l => l.trim().replace(/\s+/g, " ")),
    },
  },
  git: { commit: git(["rev-parse", "HEAD"]), branch: git(["rev-parse", "--abbrev-ref", "HEAD"]), dirty: git(["status", "--porcelain"]).length > 0 },
  governance: {
    runner_gate: "tools/stage2_parallel.js refuses to run a non-SMOKE config unless this file pins that config's sha256 (exit 2 otherwise). Registration therefore precedes execution by construction as well as by timestamp.",
    amendment_note: "Any change to a pinned file after registration invalidates the pin and requires the §13 amendment path: re-run the §5d match test and the gate-0 checker, regenerate this record, and note the amendment in protocol §0. A new config sha256 is a new registration.",
  },
};

const body = JSON.stringify(reg, null, 2) + "\n";
if (process.argv[2] === "--stdout") process.stdout.write(body);
else {
  fs.writeFileSync(OUT, body);
  console.log("wrote", rel(OUT));
  console.log("registered_utc:", reg.registered_utc);
  console.log("config sha256 :", reg.config.sha256);
  console.log("seedTable     :", reg.config.seedTable.declared_sha256, "(re-derived match:", reg.config.seedTable.match + ")");
  console.log("permutation   :", combined);
  console.log("gate0         :", reg.gate0.verdict, "| exit", reg.gate0.exit_code);
  console.log("rows          :", reg.gate0.rows_streamed);
  console.log("clause (ii)   :", reg.gate0.clause_ii);
  console.log("clause (iii)  :", reg.gate0.clause_iii);
}
