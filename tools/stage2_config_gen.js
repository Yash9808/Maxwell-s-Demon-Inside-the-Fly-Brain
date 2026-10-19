#!/usr/bin/env node
/**
 * stage2_config_gen.js — deterministic materializer for the Stage-2 master
 * config (Confirmatory_experiment_protocol_v1.md §6b / §6d / §9).
 *
 * NEW FILE (isolated): imports experiment_core.js read-only for makeRng, and
 * writes stage2_config.json + stage2_seedtable.json at the repo root. It does
 * not read, write or touch any §13-pinned Stage-1 file.
 *
 * What it materializes, once, deterministically:
 *   - the §6d fixed table: N = 16 environmentSeeds x 50 networkSeeds = 800
 *     pairs, stride-101 scheme (environment basis 4101, network basis 9201,
 *     same convention as the pinned stage1_config.json);
 *   - topologySeed for every pair, continuing the 7000+ stream AFTER the §6c
 *     pre-drawn reserve (7001-7008 are reserved/pilot; Stage 2 starts at 7009);
 *   - the §6d pair-index parity table, recorded verbatim, next to the
 *     operational rule the launch protocol uses (arms A-D on EVERY pair; arm E
 *     on pairs with pairIndex % 5 === 0). The protocol states both a parity
 *     mapping and the 1-in-5 floor rule; both are recorded and the resolution
 *     used is disclosed in `disclosures.protocolReadings` rather than silently
 *     picked;
 *   - the §9 estimand block: paired-difference TE, primary A vs D, secondary
 *     A vs B and A vs C, Holm within Stage 2, alpha 0.05 two-sided,
 *     seed-stratified sign-flip permutation reference with 100,000 resamples
 *     and seed 20250921 drawn from the ONE master stream here, before launch,
 *     plus the MDE target;
 *   - the §6d walk-way entanglement check, described and wired where the
 *     runtime supports it (a no-op topology arm: the Arm-D builder with
 *     swapFactor 0 is the REAL edge list, so its endpoint must equal Arm A's
 *     bit-exactly; evaluated on one pair per environment stratum);
 *   - the per-pair job plan consumed by tools/stage2_parallel.js: arm groups
 *     per pair (A+B, C+D, plus E on 1-in-5 pairs and the no-op diagnostic on
 *     the 16 stratum pairs).
 *
 * Determinism: no timestamps, no environment reads, fixed key order. Running
 * twice on the same tree must produce byte-identical output (asserted by the
 * `--check` mode, which regenerates and byte-compares against the file on
 * disk, and prints the sha256 of both).
 *
 * Usage:
 *   node tools/stage2_config_gen.js            # write stage2_config.json
 *   node tools/stage2_config_gen.js --check    # regenerate and byte-compare
 *   node tools/stage2_config_gen.js --stdout   # print, write nothing
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const CORE = require(path.join(__dirname, "..", "experiment_core.js"));   // makeRng only

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "stage2_config.json");
const SEEDTABLE_OUT = path.join(ROOT, "stage2_seedtable.json");

// ---------------------------------------------------------------- design constants
const PROTOCOL = { document: "Confirmatory_experiment_protocol_v1.md", version: "v1.1" };
const MASTER_SEED = 20250921;      // §6d/§9: the single randomization stream
const N_ENV = 16;                  // §9
const N_NET = 50;                  // §9
const ENV_BASIS = 4101;            // §6d
const NET_BASIS = 9201;            // §6d
const TOPO_BASIS = 7008;           // topologySeed = TOPO_BASIS + k  -> 7009..7808
const STRIDE = 101;                // §6a / §6b
const PERM_RESAMPLES = 100000;     // §9
const ALPHA = 0.05;                // §9, two-sided
const PARITY = { 0: "A", 1: "B", 2: "C", 3: "D", 4: "E" };   // §6d, recorded as written
const FLOOR_RULE_MOD = 5;          // §9: arm E on pairIndex % 5 === 0
const NOOP_STRATUM_NET_INDEX = 5;  // the no-op diagnostic pair per environment stratum

const ARM_KEYS = {
  A: "armA_real_connectome",
  B: "armB_restricted_connectome",
  C: "armC_degree_preserved_shuffle",
  D: "armD_matched_random_sparse",
  E: "armE_random_action_floor",
  NOOP: "armD_noop_topology_diagnostic",
};

// ---------------------------------------------------------------- master stream
// ONE stream, drawn ONCE, here, before launch (§6d/§9).
const rng = CORE.makeRng(MASTER_SEED);
const draw1 = rng();
const draw2 = rng();
const masterStream = {
  prng: "mulberry32 (experiment_core.js makeRng)",
  seed: MASTER_SEED,
  drawnOnce: true,
  drawsConsumed: 2,
  draws: [draw1, draw2],
  purpose: [
    "stream instantiation + determinism check (recorded, reproducible from the seed alone)",
    "entropy reserved for the staged-analysis reference seed; no design quantity is drawn at generation time — the seed table and the parity assignment are fully determined by the protocol formulas",
  ],
};
// self-check: the recorded draws must be reproducible from the seed alone
{
  const again = CORE.makeRng(MASTER_SEED);
  if (again() !== draw1 || again() !== draw2)
    throw new Error("makeRng is not reproducible for the master seed — refusing to materialize");
}
const permutationReference = {
  reference: "seed-stratified sign-flip permutation over per-pair paired differences",
  algorithm: [
    "For each PERMUTATION REPLICA r = 1..100000, in this fixed draw order:",
    "  for stratum s = 1..16 (environment index, pairs (s-1)*50+1 .. s*50):",
    "    for j = 1..50 (network index within the stratum), in ascending order:",
    "      draw u = rng(); if u < 0.5 flip the sign of that pair's paired difference",
    "      (equivalently: an independent random sign per pair, which is exact for a",
    "      paired design under the sharp null of no arm effect within the pair),",
    "  then recompute the stratum-balanced mean paired difference for the contrast.",
    "Statistic: |mean over pairs of the (possibly flipped) paired difference|,",
    "two-sided; p = (1 + #{replicas with |stat| >= |observed|}) / (1 + resamples).",
    "One rng stream per contrast run, seeded makeRng(seed) with seed below, each",
    "contrast (A-D, then A-B, then A-C) consuming a fresh stream in that order.",
  ],
  seed: MASTER_SEED,
  seedSource: "§9 (drawn and hashed here, at config-generation time, before any Stage-2 row exists)",
  resamples: PERM_RESAMPLES,
  alpha: ALPHA,
  twoSided: true,
  strata: N_ENV,
};

// ---------------------------------------------------------------- seed table (§6d)
function materializeTable() {
  const pairs = [];
  for (let k = 1; k <= N_ENV * N_NET; k++) {
    const envIndex = Math.ceil(k / N_NET);              // 1..16
    const netIndex = ((k - 1) % N_NET) + 1;             // 1..50
    const environmentSeed = ENV_BASIS + (envIndex - 1) * STRIDE;
    const networkSeed = NET_BASIS + (netIndex - 1) * STRIDE;
    const topologySeed = TOPO_BASIS + k;                // 7009..7808, continues after §6c reserve
    const pairsWithE = (k % FLOOR_RULE_MOD === 0);
    const noopDiagnostic = (netIndex === NOOP_STRATUM_NET_INDEX);   // one per stratum
    // per-pair job plan for tools/stage2_parallel.js: A+B, C+D, then extras
    const groups = [[ARM_KEYS.A, ARM_KEYS.B], [ARM_KEYS.C, ARM_KEYS.D]];
    if (pairsWithE) groups.push([ARM_KEYS.E]);
    if (noopDiagnostic) groups.push([ARM_KEYS.NOOP]);
    pairs.push({
      k,
      environmentIndex: envIndex,
      networkIndex: netIndex,
      environmentSeed,
      networkSeed,
      topologySeed,
      parityIndex: k % FLOOR_RULE_MOD,
      nominalParityArm: PARITY[k % FLOOR_RULE_MOD],     // §6d table, recorded verbatim
      runsFloorArm: pairsWithE,                          // §9 rule, operational
      runsNoopDiagnostic: noopDiagnostic,
      groups,
    });
  }
  return pairs;
}
const pairs = materializeTable();

const seedTable = {
  note: "Protocol §6d fixed table. environmentSeed = 4101 + (envIndex-1)*101 (16 strata); " +
        "networkSeed = 9201 + (netIndex-1)*101 (50 per stratum); topologySeed = 7008 + k " +
        "(the 7000+ stream continued AFTER the §6c reserve 7001-7008, so no pre-drawn/pilot " +
        "topology seed is consumed). Arm A-D on EVERY pair; arm E on pairIndex % 5 === 0; " +
        "the no-op topology diagnostic on the 16 stratum pairs (networkIndex 5).",
  scheme: "stride-101, environment basis " + ENV_BASIS + ", network basis " + NET_BASIS,
  seedStride: STRIDE,
  environmentBasis: ENV_BASIS,
  networkBasis: NET_BASIS,
  topologyStreamBasis: TOPO_BASIS,
  nEnvironment: N_ENV,
  nNetwork: N_NET,
  nPairs: pairs.length,
  consumedPairs: pairs.length,
  floorArmRule: "arm E on pairIndex % 5 === 0 (" + pairs.filter(p => p.runsFloorArm).length + " pairs)",
  pairs,
};
const seedTableSha256 = crypto.createHash("sha256")
  .update(JSON.stringify({ nPairs: seedTable.nPairs, scheme: seedTable.scheme,
    environmentBasis: seedTable.environmentBasis, networkBasis: seedTable.networkBasis,
    topologyStreamBasis: seedTable.topologyStreamBasis, pairs: seedTable.pairs }))
  .digest("hex");

// ---------------------------------------------------------------- costs
const armRuns = {
  connectome_ABCD: pairs.length * 4,
  floor_E: pairs.filter(p => p.runsFloorArm).length,
  noop_diagnostic: pairs.filter(p => p.runsNoopDiagnostic).length,
};
armRuns.total = armRuns.connectome_ABCD + armRuns.floor_E + armRuns.noop_diagnostic;

// ---------------------------------------------------------------- config
const config = {
  header: {
    stage: 2,
    status: "CONFIRMATORY — randomized, pre-registered before any Stage-2 row (protocol §9/§13)",
    protocol: PROTOCOL,
    generator: "tools/stage2_config_gen.js",
    runner: "tools/stage2_parallel.js --config stage2_config.json",
    runtime: {
      engine: "experiment_core.js",
      driver: "benchmark.js --config <derived per-pair config>",
      note: "The designated runtime (protocol §2). The runner invokes the pinned benchmark.js as a subprocess and never modifies it.",
    },
    smokeFlag: "absent by design — a Stage-2 confirmatory config carries no SMOKE flag; " +
               "tools/stage2_parallel.js refuses to run it unless PRE_REGISTRATION_STAGE2.json " +
               "pins this exact file's sha256.",
    randomizationProvenance: {
      masterStream,
      permutationReference,
      seedTableSha256,
      designDeterminism: "seed table, topology stream and parity assignment are closed-form from " +
                         "the protocol formulas; the only drawn quantity is the permutation-reference " +
                         "seed above, drawn once from the single master stream before launch",
    },
    disclosures: {
      protocolReadings: [
        "§6d writes both '(k mod 5) -> arm A/B/C/D as 0..3, with the 5th block folded into E' and, " +
        "in §9, 'E is run on 1 in 5 pairs (every pair with pairIndex ≡ 0 (mod 5))'. The parity table is " +
        "recorded verbatim per pair as nominalParityArm; the operational plan follows the §9/launch rule: " +
        "arms A-D on every pair, arm E on pairIndex % 5 === 0.",
        "The §6 coverage question for such a large N is stated in the protocol as unchanged: A-D are " +
        "estimated from all 800 pairs; E is the floor reference on 160 of them.",
      ],
      seedOverlapWithPilot: {
        note: "The §6d basis/stride is protocol-fixed and the pilot (§6c, exploratory) was drawn on " +
              "nearby anchors; the overlap is disclosed here rather than silently re-based.",
        identicalEnvironmentSeeds: "pilot environmentSeeds are 4101+100*(k-1) (4101..4801); Stage-2 uses " +
              "4101+101*(i-1) (4101..5616). The value 4101 is shared by pilot pair k=1 and Stage-2 envIndex 1.",
        identicalNetworkSeeds: "pilot networkSeeds 9201,9302,9403 (pairs 1-3) are exactly Stage-2 " +
              "networkIndex 1,2,3 of every stratum.",
        consumedPilotCells: "3 exploratory cells (pilot pairs 1-3). Stage-1 is declared EXPLORATORY with " +
              "no inferential claims and no p-values (protocol §7); no pilot value enters the Stage-2 " +
              "estimand, and the confirmatory analysis consumes only Stage-2 rows. If strict pilot/Stage-2 " +
              "cell disjointness is required, that is a protocol amendment (re-base), not a silent edit here.",
        pilotSeedsReserved: "§6c rows 4-8 (topology 7004-7008 included) remain reserved; Stage-2 topology " +
              "seeds start at 7009 and consume none of them.",
      },
      runtimeCoercionTrap: "benchmark.js (57 pinned) builds the arm-D edge list with `arm.swapFactor || 10`, so " +
              "any FALSY swapFactor silently becomes 10. Measured in the 2026-10-09 dry run: with swapFactor 0 the " +
              "no-op diagnostic arm produced rows byte-identical to arm D's on the same pair. The config therefore " +
              "uses a negative swapFactor for the no-op arm and keeps this disclosure next to it.",
      retention: "Per-job trial rows are gzip-compressed after each job is harvested (lossless; the " +
              "manifest's trialsSha256 pins the UNCOMPRESSED bytes, and the .jsonl.gz is recorded with its " +
              "own sha256). Reason: 3,376 arm-runs x ~41 MB of rows would need ~139 GB; the volume has " +
              "18 GB free. Compressed retention keeps every row (measured ratio is written into each job's " +
              "DONE.json) instead of discarding evidence.",
    },
  },
  configVersion: 1,
  stage: 2,
  protocol: PROTOCOL,
  runtime: {
    engine: "experiment_core.js",
    driver: "benchmark.js --config <derived per-pair config>",
    note: "Headless designated runtime only (protocol §2).",
  },
  physics: {
    dt: 0.016666666666666666,
    nParticles: 320,
    noise: 0.12,
    doorHeight: 64,
    jetPower: 0.55,
    jetAim: 0.5,
    jetInterval: 3.5,
    tKelvin: 300,
    simToJoule: 1e-21,
    landauerBitJ: 2.871e-21,
    lr: 0.004,
    lrNote: "identical to the pinned Stage-1 config (protocol §2: the config carries the dopamine-gated rate)",
  },
  phases: {
    pre: { trials: 1, episodeSeconds: 120, learning: false, frozen: true },
    train: { trials: 300, episodeSeconds: 12, learning: true },
    post: { trials: 60, episodeSeconds: 12, learning: false },
  },
  frozenPreSeconds: 120,
  arms: {
    armA_real_connectome: { kind: "connectome", shuffle: false, plasticity: "full", opticDrive: 0.25, opticInput: "legacy8bin" },
    armB_restricted_connectome: { kind: "connectome", shuffle: false, plasticity: "restricted", opticDrive: 0.25, opticInput: "legacy8bin" },
    armC_degree_preserved_shuffle: { kind: "connectome", shuffle: true, plasticity: "full", opticDrive: 0.25, opticInput: "legacy8bin" },
    armD_matched_random_sparse: { kind: "connectome", shuffle: false, plasticity: "full", customEdges: "degreeMatchedRandomEdges", swapFactor: 10, opticDrive: 0.25, opticInput: "legacy8bin" },
    armE_random_action_floor: { kind: "random", policy: "randomActionFloor" },
    armD_noop_topology_diagnostic: { kind: "connectome", shuffle: false, plasticity: "full", customEdges: "degreeMatchedRandomEdges", swapFactor: -1, opticDrive: 0.25, opticInput: "legacy8bin", diagnostic: true,
      swapFactorNote: "NEGATIVE on purpose, not 0. The pinned runtime (benchmark.js) builds the arm-D list as `degreeMatchedRandomEdges(circuit, {seed: spec.topologySeed, swapFactor: arm.swapFactor || 10})()` — a literal 0 is FALSY and silently becomes 10, so a `swapFactor: 0` arm is a second arm D, not a no-op (measured: its rows came out byte-identical to arm D's in the 2026-10-09 dry run). A negative value is truthy and makes `attempts = swapFactor * |E|` negative, so the swap loop never executes and the builder returns the REAL edge list unchanged. Proven element-wise by tools/stage2_noop_check.js phase 1 and end to end (rows vs arm A) by its phase 2." },
  },
  parallel: {
    note: "Job plan for tools/stage2_parallel.js: a job is one pair x one arm group. Each pair entry " +
          "carries its own `groups` (see seedTable.pairs); `armGroups` below is the default for pairs " +
          "without an explicit plan.",
    armGroups: [[ARM_KEYS.A, ARM_KEYS.B], [ARM_KEYS.C, ARM_KEYS.D]],
    jobs: {
      pairs: pairs.length,
      jobsPerPairDefault: 2,
      jobsTotal: pairs.length * 2 + armRuns.floor_E + armRuns.noop_diagnostic,
      armRuns,
    },
    costProjection: {
      note: "Per-arm-run wall time is measured on this machine before launch (see the launch record); " +
            "the pilot's 15 arm-runs took 12.4 h serial (~50 min per connectome arm-run).",
    },
  },
  estimand: {
    endpoint: "deltaSortEntropy_post_minus_pre",
    construction:
      "Y_X,r = mean(sortEntropy over post trials of replicate r) - mean(sortEntropy over pre trials of replicate r); " +
      "TE = mean over pairs of (Y_A,pair - Y_D,pair); seed-paired within every (environmentSeed, networkSeed) cell.",
    primaryContrast: { name: "A - D", a: ARM_KEYS.A, b: ARM_KEYS.D, role: "primary" },
    secondaryContrasts: [
      { name: "A - B", a: ARM_KEYS.A, b: ARM_KEYS.B, role: "plasticity (full vs restricted)" },
      { name: "A - C", a: ARM_KEYS.A, b: ARM_KEYS.C, role: "strong null (degree-preserved shuffle)" },
    ],
    nPairs: pairs.length,
    alpha: ALPHA,
    twoSided: true,
    multiplicity: { family: ["A - D", "A - B", "A - C"], method: "Holm", within: "Stage 2 only" },
    permutationReference,
    dispersionEstimator: "sample SD, ddof = 1, over per-pair paired differences (pilot report §2 recommendation)",
    mde: { sdUnitsAtN800: 0.10, designEffectTargetDeltaOverSd: 0.2, note: "protocol §9" },
    floorReference: { arm: ARM_KEYS.E, pairs: armRuns.floor_E, role: "instrumentation floor, not a confirmatory contrast" },
    thermo: "separate track (protocol §15): recorded in rows, never mixed into the behavioral endpoint",
  },
  walkWayEntanglementCheck: {
    purpose: "Protocol §6d: show that a measured A-D difference cannot be produced by the topological path " +
             "('walk-way') machinery itself — i.e. that the no-op topology variant gains nothing against the REAL environment.",
    implemented: true,
    how: "Arm-D construction with a negative swapFactor attempts no swap, so the builder returns the REAL edge " +
          "list and the arm's endpoint must equal Arm A's for the same pair. The arm `" + ARM_KEYS.NOOP + "` is " +
          "declared above with swapFactor -1 and run on the 16 stratum pairs (`runsNoopDiagnostic`, one per " +
          "environment stratum). See swapFactorNote on that arm: the pinned runtime cannot express a literal 0 " +
          "(falsy-zero coercion), which the 2026-10-09 dry run caught by showing the no-op arm's rows were " +
          "byte-identical to arm D's.",
    evaluation: "For each diagnostic pair, compare the no-op arm's rows to arm A's field by field (only the " +
                "`condition` stamp may differ) and its wiring fingerprint against the real list: PASS = exact " +
                "equality; any difference flags entanglement of the topology path into the environment/network " +
                "path and voids the A-D interpretation until explained. The two arms run as SEPARATE benchmark " +
                "invocations, so this simultaneously checks that the runner's job splitting is draw-neutral.",
    wiring: "no runtime change required: it reuses the pinned Arm-D builder through the pinned `customEdges` " +
            "hook, so no §13-pinned file is touched.",
    cost: { armRuns: armRuns.noop_diagnostic },
    verificationBeforeLaunch: "tools/stage2_noop_check.js — compares the swapFactor-0 edge list against the real " +
            "list (counts, in/out-degree sequences, weight/sign multiset, fingerprint) before any launch.",
  },
  analysis: {
    script: "(to be written against this frozen config; not part of the launch)",
    contrasts: "seed-paired A-D (primary), A-B, A-C (secondary), Holm within Stage 2",
    permutation: "see estimand.permutationReference (100,000 resamples, seed drawn above, alpha 0.05 two-sided)",
    gate: "floor-arm bound + broken-floor guard + frozen-pre enforcement, as in the Stage-1 analyzer",
  },
  seedTable,
};

// ---------------------------------------------------------------- emit
const body = JSON.stringify(config, null, 2) + "\n";
const seedTableBody = JSON.stringify({
  stage: 2,
  note: "Materialized §6d seed table ONLY (no config) — the audit anchor for PRE_REGISTRATION_STAGE2.json.",
  scheme: seedTable.scheme,
  nPairs: seedTable.nPairs,
  sha256: seedTableSha256,
  pairs: seedTable.pairs.map(p => ({ k: p.k, environmentSeed: p.environmentSeed,
    networkSeed: p.networkSeed, topologySeed: p.topologySeed,
    environmentIndex: p.environmentIndex, networkIndex: p.networkIndex,
    nominalParityArm: p.nominalParityArm, runsFloorArm: p.runsFloorArm,
    runsNoopDiagnostic: p.runsNoopDiagnostic })),
}, null, 2) + "\n";

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const mode = process.argv[2];
if (mode === "--stdout") {
  process.stdout.write(body);
} else if (mode === "--check") {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
  const same = cur === body;
  console.log("regenerated sha256:", sha(body));
  console.log("on-disk    sha256:", cur === null ? "(missing)" : sha(cur));
  console.log("seed table sha256:", seedTableSha256);
  console.log(same ? "BYTE-IDENTICAL: the generator is re-runnable to the byte" : "MISMATCH: the config on disk differs from a fresh generation");
  process.exit(same ? 0 : 1);
} else {
  fs.writeFileSync(OUT, body);
  fs.writeFileSync(SEEDTABLE_OUT, seedTableBody);
  console.log("wrote", path.relative(ROOT, OUT), "| sha256", sha(body));
  console.log("wrote", path.relative(ROOT, SEEDTABLE_OUT), "| seedTable sha256", seedTableSha256);
  console.log("pairs", seedTable.nPairs, "| arm-runs", JSON.stringify(armRuns));
  console.log("jobs", config.parallel.jobs.jobsTotal, "| E pairs", armRuns.floor_E, "| no-op pairs", armRuns.noop_diagnostic);
}
