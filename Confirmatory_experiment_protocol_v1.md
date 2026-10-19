# Confirmatory experiment protocol — v1.1
## Stage-1 exploratory gate → Stage-2 confirmatory randomized connectome trial

**Document:** Confirmatory_experiment_protocol_v1.md
**Version:** v1.1 (2026-10-07)
**Status:** PRE-REGISTRATION DRAFT — the pilot-prohibition lock in §13 must be
satisfied (PRE_REGISTRATION_STAGE1.json pinned) before Stage 1 simulates a
single trial.
**Designated runtime:** headless `experiment_core.js` driven by
`benchmark.js --config stage1_config.json` (§2). All Stage 1 / Stage 2
simulation and measurement occurs in that runtime and in no other.

---

## 0. Version history

| Ver | Date | Change |
|-----|------|--------|
| v1.0 | 2026-09-21 | Drafted around the benchmark/optimality sweep. Never ran as written: no `--config`, no Stage-1 seed assignment, no Arm D construction. Superseded. |
| v1.1 | 2026-10-07 | (a) exact five-arm definition incl. Arm D construction and match criteria; (b) explicit estimand and sample-size logic; (c) Stage 1 seed-pair table pinned (E×N pairs around 4101/9201) plus a separate topology-shuffle draw seed; (d) Stage 1 declared EXPLORATORY; (e) runtime designated narrowly as headless `experiment_core.js`; (f) thermodynamics split out as a separate track. |
| v1.1a | 2026-10-07 | §10 enforcement amendment (caught at Gate 3, before any pilot run): `runBenchmark` now stamps `weightDrift` (Σ\|Δw\| vs the bit-exact init snapshot) on every trial row; pre rows must read EXACTLY 0.0. Golden E1 fixture regenerated — schema-only diff, physics bit-identical — and `PRE_REGISTRATION_STAGE1.json` re-pinned per §13. No design change: arms, seeds, estimand, phases, and analysis are untouched. |
| v1.1b | 2026-10-07 | Runtime I/O fix (pilot-attempt #1 completed its full simulation but crashed at the write step: `RangeError: Invalid string length` — 5,415 trial rows exceed V8's max string length when joined). `benchmark.js` Stage-1 path now streams rows to the trials JSONL; output verified BYTE-IDENTICAL to the join-based write on a full smoke rerun, and the smoke determinism pair remains byte-identical. No design change; prereg re-pinned per §13. |
| v1.1c | 2026-10-08 | Analysis I/O fix (found when analyzing the completed pilot: `stage1_analyze.js` `loadRows` hit the same V8 max-string limit that v1.1b fixed on the write side — the 622 MB trials JSONL exceeds it on read). `loadRows` now reads the file as a Buffer and splits on newline BYTES, parsing each line separately; `--selftest` 5/5 and the full smoke suite 79/0/0 are green on the patched analyzer, and pilot manifest validation (29/29 mechanical checks, `research_data/validate_pilot.js`) passes. No design change: arms, seeds, estimand, phases, gate logic, and reported statistics are untouched. Prereg re-pinned per §13. |

v1.1 is the operative text. Sections §4–§13 below are canonical.

---

## 1. The research question

Prior staged work (E1–E11, P0–P1 reports, and the C9 audit) delivered two
sub-results: (i) real-vs-shuffled connectome wiring diverges behaviorally in a
sparse sensory operating regime (opticDrive 0.25, legacy 8-bin interface); and
(ii) degree-preserving edge shuffling is the canonical strong null. What is
still missing is a **transparent, pre-registered interventional decision**:
does the *real* wiring improve sorting *because* it is more consistently
topologically organized (degree-structure) than a matched random sparse
wiring — or is the earlier behavioral gap an idiosyncrasy of the specific
real layout (idiosyncratic-identity residual)?

Stage 1 answers this descriptively at restricted sample size. Stage 2 then
runs a fully powered randomized confirmatory RCT **only if Stage 1 does not
show a clear negative** (§11 Stage-2 gating).

---

## 2. Designated runtime

**Only** this runtime executes Stage 1 / Stage 2 trials; the browser 3D app
(`fly_demon_3d.html` / its worker chain) and every interactive harness are
explicitly out of scope for evidence generation (they remain for
visualization only).

- Physics + environment + trial engine + measurement chain:
  `experiment_core.js` — `makeEnvironment` (seed/makeRng-driven particles),
  `runBenchmark(cfg)` (which drives controllers through
  observe/step/receiveFeedback/resetForTrial and records the per-trial row),
  `summarizeCondition`, and `meanCI`.
- Controllers: `controllers.js` — `connectomeController(circuit, opts)`
  provides arms A–C/D via the `shuffle`, `customEdges` (Arm D extension),
  `plasticity`, and `opticDrive` knobs, and `randomController` (extended to
  `randomActionFloor`) provides arm E.
- Headless driver: `benchmark.js --config <json>` reads
  `stage1_config.json` (pinned below), instantiates arms, drives
  `runBenchmark` with the seed-spec table, validated the frozen pre-baseline
  (§10), and writes `stage1_manifest_<stamp>.json` + row JSONL into
  `research_data/`. The config carries the environment / network /
  topology seeds (§6) **and the learning rate** (`physics.lr`, the
  dopamine-gated plasticity rate in `connectomeController.applyLearning`;
  per-arm override via `arms.*.lr`; the default 0.004 preserves every
  legacy caller byte-for-byte).

The physics contract is strictLock to the repo baseline: deterministic
mulberry32 PRNG, dt = 1/60, chamber 760×380×300, WALL_T = 8, DOOR_GAP = 0.6,
elastic pair collisions on a uniform grid, drag 0.999, `SIM_TO_J = 1e-21`
(sim-unit → Joules), Landauer T = 300 K. Any change to `experiment_core.js`
dynamics after PRE_REGISTRATION_STAGE1.json is pinned invalidates the
pin and requires an explicit protocol amendment (§13).

---

## 3. Arms — exact construction definitions

All arms share the **same environment draw** and physics (760×380×300 chamber,
walls, elastic collisions, drag). Only the controller/edge-graph differs. Each
arm is a controller factory compatible with
`runBenchmark(controllers: {armKey: factory(rng, env, cfg, seedSpec)})`.

| Arm | Key | Brain construction | Plasticity | Acts on |
|-----|-----|--------------------|------------|---------|
| **A** | `armA_real_connectome` | `connectomeController(circuit, {shuffle:false, customEdges:null, plasticity:"full", opticDrive:0.25, rng, seed:pairs[i].networkSeed, modulation by P0 defaults})` | full | door |
| **B** | `armB_restricted_connectome` | same as A but `plasticity:"restricted"` (only sensory-pathway edges plastic) | restricted | door |
| **C** | `armC_degree_preserved_shuffle` | same as A but `shuffle:true` with `seed: pairs[i].topologySeed` (degree-preserving edge rewiring) | full | door |
| **D** | `armD_matched_random_sparse` | same controller as A but `customEdges: degreeMatchedSparseEdges(circuit, {seed:pairs[i].topologySeed})` (§5) | full | door |
| **E** | `armE_random_action_floor` | `randomActionFloor` (open ligand-gated floor: every trial performs ≥ 2 random open/close policy decisions purely as a random floor) | n/a | door |

Arms A–D share an **explicit graph** (per-edge `[s, t, w, sign, nt]`),
instantiated by `connectomeController`’s CSR propagation, eligibility-trace
machinery, dopamine teaching signal, and the pool-ratio door policy
(`motorRateSmooth / layerRateSmooth` vs 1). This guarantees that any A-vs-D
difference traces to the *edge list*, not to the runtime. Arm E sits outside
the graph and forms the random-action reference floor.

**Frozen arm** (`armB_restricted_connectome` in Stage 1 also serves as the
engagement/frozen reference on its non-plastic edges; it is the SAME brain as
arm A with restricted plasticity, so A-vs-B isolates the plasticity factor
while B-vs-A cross-checks weight-drift semantics identical to prior
audits).

No other comparator (classical demon policy, never-gate, saboteur) is
simulated in Stage 1; they were characterized in prior tracked E1–E11
campaigns and are not interventional subjects of this RCT.

---

## 4. Primary estimand

**Interventions:** real circuit wiring (A) vs degree-matched random sparse
wiring (D), both fully plastic; (secondary) restricted vs full plasticity
(A vs B); and strong-null shuffled wiring (C) as the third structural arm.

**Population:** one simulated gas-handling apparatus (this repo’s chamber),
with duplicate `env` seeds under the environmentSeed assignment of §6.

**Primary endpoint (confirmatory candidate, Stage 2):**
Δ(post − pre) sorting performance, measured as
`summarizeCondition.testSortEntropy.mean` (post phase) minus
`summarizeCondition.testSortEntropy.mean` of the pre phase (§10) — i.e. the
within-arm improvement in the sorting-entropy `METRICS.sortingEntropy.delta`
achieved by the trained controller at the frozen post-test, relative to the
frozen pre baseline.

Formally, for arm X with replicate index r over the seed-pair table:

    Y_X,r = mean( sortEntropy.delta over post trials of replicate r )
          − mean( sortEntropy.delta over pre trials of replicate r )

    TE = E[ Y_A − Y_D ]     (primary)
    TB = E[ Y_A − Y_B ]     (plasticity secondary)
    TC = E[ Y_A − Y_C ]     (strong-null secondary)

All non-fluent II.2.2 issues (weight leakage, feedback timing, weight-drift
attribution) are handled inside `connectomeController`’s existing
eligibility/DA machinery; no Stage-specific weight-matching is applied after
the fact.

**Estimand population:** the seed-pair table of §6c, each cell computed
from `runBenchmark` on the designated runtime with the rendered Stage-1
seedSpec list it emits; missing cells (crash / timeout) are recorded as
failures and reduce N, never silently imputed (§13).

---

## 5. Arm D: degree-matched random sparse construction + match criteria

### 5a. Construction (deterministic)
`degreeMatchedRandomEdges(circuit, {seed, swapFactor = 10})` in
`controllers.js` — **Maslov–Sneppen double-edge randomization** of the real
fast-synapse edge list:

1. Build the real propagation edge list exactly as
   `connectomeController` does (all edges; modulatory contacts filtered
   per the P0 filter). Record the edge count |E| and, from the SAME list,
   per-neuron out-degree d_out(v) and in-degree d_in(v). Weights `w`,
   signs `sign` and neurotransmitter tags `nt` stay bound to their
   original edges.
2. Draw S = swapFactor·|E| swap attempts from `makeRng(seed)`
   (deterministic mulberry32). Each attempt picks two distinct edges
   (u₁→v₁), (u₂→v₂) and rewires them to (u₁→v₂), (u₂→v₁) — a double-edge
   swap that moves ENDPOINTS BETWEEN EXISTING EDGES and therefore
   preserves |E|, every d_out(v) and every d_in(v) **by construction**.
3. Accept the swap iff it introduces no self-loop (v₂≠u₁ and v₁≠u₂),
   no parallel duplicate pair, and neither target change collides with
   an existing pair; otherwise reject and continue (rejections cost one
   attempt, never alter the list).
4. Return the rewiring sequence of `{s, t, w, sign, nt}` edges. The
   accepted-attempt count and the seed bound to it are logged in the arm
   row (`topologyFingerprint`, §12) so the draw is auditable.

Degrees are matched **exactly** (not distributionally) because each swap
is degree-invariant; no stuck-state exists (any two-edge sample yields a
valid or rejected attempt). The result is a degree-matched random sparse
graph over the REAL circuit’s connectivity — the random baseline that
removes the "A wins because some neurons are extremely connected"confound, while keeping the real weight/sign distribution.

Hierarchy vs arm C: arm C (`shuffle:true`, one-pass target bijection)
also preserves both degree sequences as a multiset but may introduce
self-loops/parallel pairs and performs only one mixing pass; arm D adds
the no-self-loop/no-dupe constraints and swapFactor·|E| mixing passes.
Arm D holds the REAL modulatory-contact layout (the controller derives
modulatory edges from the circuit, and Stage 1 does not synthesize
modulators); arm C is the arm that randomizes both fast wiring and
modulatory contacts. This asymmetry is disclosed, not hidden.

### 5b. Why not a configured `annController`?
Considered and rejected: `annController` is a fully dense 15-16-2 MLP with no
edge list, no degree information, and a flat 15-channel input mapping that
bears no relation to the connectome’s layer/pool structure. Making it
"degree-matched" would require a different I/O mapping than arms A–C, which
would confound topology with representational surface. Arm D therefore uses
the SAME controller/kernel as A–C and differs only in the supplied edge
list (§3).

### 5c. runtime passthrough
`connectomeController(circuit, opts)` gains an additive `opts.customEdges`:
when present (a plain array of `{s, t, w, sign, nt}`), it replaces the
propagation edge list (real or shuffled) BEFORE CSR construction —
bit-identical to A/B/C in every other respect (modulatory handling, weights
scaling by the same `WS`, plasticity flags, eligibility windows).

### 5d. Automated match-check test (must pass before any Stage 1 launch)
`tests/stage1_arm_d_match.test.js` asserts, per edge list (and re-checked
after `--config` re-instantiation):

1. **Degree sequence equality:** the multiset of per-neuron in-degrees of
   arm-D edges sorted equals the real circuit’s; likewise for out-degrees
   (exact per-neuron equality, not just matching distribution shape).
2. **No self-loops, no duplicate (s,t) pairs within arm D.**
3. **Density guard:** |E_D| = |E_real| exactly (no edges added or lost),
   and the weight/sign multiset of D equals that of the real list.
4. **Reproducibility:** rebuilding with the same `seed` reproduces the
   same edge list (parse-equality); rebuilding with a different seed (e.g.
   seed+1) does NOT survive the degree-equality test unchanged (sanity
   that the draw is actually seeded).
5. **Instantiation parity:** `connectomeController` with `customEdges`
   versus the raw real edge list runs one tick of identical CSR
   construction (same `NE`, same layer bookkeeping) so the runtime does not
   silently re-inject real edges.

The test runs at `n -- -no-warnings node --test tests/stage1_arm_d_match.test.js`
and is part of the pre-registration gate (§13): if it fails, no Stage 1
simulations may be performed until the builder is fixed.

---

## 6. Randomization & seeds

### 6a. Seed rule (repo convention, kept)
`seeds[s] = base + s * 101` derived from
`EXPERIMENTAL_VALIDATION_AUDIT.md` and prior campaigns; every run uses
**mulberry32** via `experiment_core.makeRng`.

Stage 1 uses paired seeds (see 6c). Stage 2 will be RANDOMIZED per §6d.

### 6b. Seed streams, split (already in the runtime)
- `environmentSeed` — chamber gas/particle draw only (makeEnvironment).
- `networkSeed` — controller/eligibility/PG-readout draw (A/B/C/D arms;
  selects the FLAVOR of each arm’s behavior; feeds P0’s `connectome`
  brain node).
- `topologySeed` — the degree-shuffle draw seed (arm C) AND the random
  graph draw seed (arm D) OUTSIDE of the network seed stream — independent
  by design, see §6c.

The runtime core additionally derives a separate `pgRng` stream
(`makeRng(seed ^ 0x5f5f)`, see P0 §E9) — Stage 1 does not use E9-style PG
readouts and leaves it inert (nulls in rows), byte-locked as in the audit.

### 6c. Stage-1 seed-pair table (exploratory, restricted N=8 pairs)

Stage 1 uses a **small pre-declared table**, drawn deterministically; the
pairing is (environmentSeed, networkSeed) with an independent
topology/shuffle draw seed, both explicitly identical across arms A/B/C/D
per replicate so A/B/C/D differences within a replicate are
topology-only.

| pair k | environmentSeed | networkSeed | top/shuffleSeed (shared C+D) |
|--------|-----------------|-------------|------------------------------|
| 1 | 4101 | 9201 | 7001 |
| 2 | 4201 | 9302 | 7002 |
| 3 | 4301 | 9403 | 7003 |
| 4 | 4401 | 9504 | 7004 |
| 5 | 4501 | 9605 | 7005 |
| 6 | 4601 | 9706 | 7006 |
| 7 | 4701 | 9807 | 7007 |
| 8 | 4801 | 9907 | 7008 |

- Base/stride: E_k = 4101 + (k−1)·101; N_k = 9201 + (k−1)·101
  (k = 1..8), matching the seedStride=101 convention.
- `topologySeed` = **7000 + k** (k = 1..8) — a stream **independent** of
  environmentSeed/networkSeed, so the shuffle (C) and random (D) draws
  shift while E/N streams stay put (bakes in the deterministic
  rep-level pairing bookkeeping).
- **Consumption:** Stage 1 consumes the FIRST THREE pairs (k = 1, 2, 3).
  The remaining five rows stay pre-drawn and reserved; consuming any of
  them requires an explicit protocol amendment recorded in §0.
- The environmentSeed/networkSeed/topologySeed columns above are the
  authoritative numbers from which the `seedSpecs` entries are derived;
  the rendered spec in the manifest restates them per replicate (§12),
  so the table is the audit anchor, not a re-derivation rule.
- Within one replicate k, all arms A/B/C/D run in the SAME (E_k, N_k)
  environment/network draw; the `topologySeed` differs only between C and
  D topologies — one single draw pair per replicate, never re-drawn
  across arms. (Drawing per-arm would silently introduce extra
  environmental draws into some arms and not others.)

Rationale for the 8-row table: Stage 1 is a **descriptive pilot gate**
(§8), not a powered RCT — it exists to size Stage 2 and to catch
instrumentation bugs. Consuming only 3 pairs keeps the pilot duration
bounded while leaving pre-drawn reserve; no inferential decision may be
drawn from Stage 1 alone (§7/§8).

### 6d. Stage-2 randomization (confirmatory plan; NOT yet licensed)
After Stage 1, assuming the Stage-1 gate (§11) passes, Stage 2 draws a
FIXED table of 16 environmentSeeds × 50 networkSeeds with the same
stride-101 scheme (4101-basis environment, 9201-basis network),
assigning arms within each (E, N) pair by the pair-index parity table
((k mod 5) → arm A/B/C/D as 0..3, with the 5th block folded into E) —
this is a block-randomized assignment generated ON THE SAME
deterministic stream (single `makeRng(20250921)` master stream, drawn
once, hashed into Stage-2 config at pre-registration time). Topology
seeds for Stage 2 (arms C/D) continue on the 7000+ stream; and one
**separate walk-way entanglement check** (no-op topological gains against
the REAL environment) is described in Stage-2 config when written. That
randomization will be recorded, hashed, and locked into
`PRE_REGISTRATION_STAGE2.json` BEFORE Stage 2 runs. Stage 1 cannot
"preview" these assignments (the table is not materialized yet).

---

## 7. Stage 1 is EXPLORATORY — declaration

**The Stage-1 run is exploratory.** It is pre-specified (arm set, seeds,
metrics, and stopping rule below are fixed before any simulation) but its
purpose is calibration, guard verification, and Stage-2 sizing. WHAT IS
DEFINITELY NOT LICENSED from Stage 1 data:

- No claim that arm A beats arm D (or fails to) — 8 replicates cannot
  support an interventional decision at this noise level.
- No threshold-crossing "significance" language (no p-values from Stage-1
  data; CIs shown only as descriptive uncertainty bands).
- No "only Stage 1 was pre-registered" argument — Stage 2 will carry its
  own, fuller pre-registration (§6d) before any Stage-2 simulation.

What Stage 1 data MAY legitimately support: engineering sanity checks
(match-check passes, no-inf/NaN row conservation, frozen-pre-correctness,
verifying the floor arm performs as floor), Stage-2 effect-size scoping
(descriptive effect magnitudes + spread used purely to size Stage 2’s
sample), and verifying the R2-style runtime guards.

---

## 8. Stage 1 gate → proceed/stop rule

Stage 1 is complete when `benchmark.js --config stage1_config.json` has
run **all 4 graph arms (A, B, C, D) × 3 replicates = 12 simulated
replicates** using the FIRST THREE pairs of the §6c table, plus arm E on
the same 3 pairs as an instrumentation floor, **with zero crash /
zero NaN/Infinity in any per-trial row**, and the §5d match test is green.

Standard stop: Stage 1 runs the 12 replicates (4 arms × 3 pairs; pair 1–3 of
§6c) **plus arm E on the same 3 pairs**, one pass, no repeated restarts, and
automatically writes `research_data/stage1_manifest_<stamp>.json` +
per-trial rows. On completion Stage 1 STOPS and does not trickle into
more replicates. If a replicate fails mechanically (crash/NaN), Stage 1
reports the failure and stops — the fail-fast rule is skipped only by an
explicit protocol amendment (never silently).

Stage 2 is authorized iff ALL of: (i) Stage 1 gate green; (ii) the
measured, per-replicate |ΔY_D − ΔY_A| point estimate is **not** negative
beyond its descriptive 95% band in a way that suggests D systematically
beats A (a strong Stage-1 negative → protocol amendment, not a silent
greenlight); (iii) floor arm E performs as a floor: its pre→post change
must not dominate the max of arms A–D (guards against a broken floor).

---

## 9. Stage 2 preview (confirmatory; requires its own pre-registration)

- Sample size: N = 16 (environmentSeed) × 50 (networkSeed) = 800 pairs;
  each pair runs ALL of arms A, B, C, D; E is run on 1 in 5 pairs
  (every pair with pairIndex ≡ 0 (mod 5)) as the floor reference.
- Estimand: TE as defined in §4 with paired-difference construction and
  a seed-stratified permutation reference (100k resamples, seed
  `20250921`, drawn and hashed BEFORE Stage 2 runs).
- α = 0.05 two-sided, one primary contrast (A vs D); A vs B (plasticity)
  and A vs C (strong null) are secondary, Holm-corrected within Stage 2.
- Power: Stage 1’s descriptive |Δ| magnitude gates Stage 2 sizing via a
  documentable minimum standardized effect (ΔY/SD) target of ≥ 0.2
  (medium-small); with N = 800, the paired design’s MDE is ~0.10 SD,
  comfortably below target.
- Runtime + row + manifest contract identical to Stage 1 (§12/§15);
  new prereg file `PRE_REGISTRATION_STAGE2.json` (hash-pinned like §13).

---

## 10. Frozen 120-second pre-baseline

Before training, EVERY trial in every arm runs a **120 s frozen
pre-baseline episode** through the same controller pipeline:

- `connectomeController`: `brainTick`-driven, `setLearning(false)` during
  the pre phase; the real/shuffled/arm-D edge weights stay bit-identical
  to their pre-trial initialized state (the run’s `weightDrift` metric
  must return EXACTLY 0.0 at the end of every pre trial in Stage 1 —
  the runtime stamps `frozenPre: true` on pre rows as evidence);
- `randomController`/floor arm `armE_random_action_floor`: sampled from
  its PRNG only, `setLearning(false)` — but arm E is by construction
  non-plastic and the flag is a no-op for it (the controller reports
  `learningIrrelevant: true` in its summary).

The pre phase is declared in config as
`"prePhaseFrozen": true, "frozenPreSeconds": 120`; the runtime asserts
enforcement and stamps `frozenPre: true` + `frozenPreSeconds: 120` on
every pre-phase row.

Purpose: every arm A–D measures a **no-learning, no-skill baseline** in
the SAME environment+network draw before any plastic change, so the
primary Δ(post − pre) is a within-arm improvement, not an across-arm
idiosyncrasy. The frozen-arm logic matches the audited Phase-2 baseline
(`setLearning(false)` from trial 0) extended to a full 120 s frozen
single-agent episode.

---

## 11. Phases and trial counts (both stages)

Every arm runs a single-phase-sequence of 4 stages of trials:

| phase | trials | learning | duration | purpose |
|-------|--------|----------|----------|---------|
| pre | 1 trial × 120 s | frozen | 120 s | frozen pre-baseline (§10) |
| train | 300 trials × 12 s | plasticity on | 3600 s | shaping; no Stage-1 inference on this phase |
| test | 60 trials × 12 s | frozen | 720 s | post-test scoring at frozen weights |

(The runtime’s legacy `trialsTrain`/`trialsTest` columns persist for
backwards compatibility with Phase-2 tooling; Stage 1 config sets
them to 300/60 to match this table; the pre phase is added on top
via `trialsPre`.)

---

## 12. Measurements

Per trial, the runtime already records: crossings, goodCrossings,
badCrossings, `goodBadRatio`, dTfinal, sortEntropy (METRICS.sortingEntropy
delta), spatialH, miNeural, workInJ, measuredBits, erasureCostJ, extractableJ,
landauerRatio, energyJ, jetWorkJ, openFraction, steps, plus
controller.summary fields (demonAgree 0..1 for the classical reference,
motorHz for arms A–D, P(open) telemetry for the PG path — inert in Stage 1).

Stage-1-specific additions:
- `frozenPre` / `frozenPreSeconds` stamps on pre-phase rows (§10).
- Arms A–D rows carry `topologyFingerprint` (16-hex sha16 of the edge
  list, see MANIFEST.json schema convention) so an edge-list swap or a
  mis-assigned seed is detectable from data alone.
- Selectivity (secondary diagnostics, not confirmatory claims in
  Stage 1): `sortEntropy·post − sortEntropy·pre` per arm (the §4 endpoint),
  plus `goodBadRatio (post) − goodBadRatio (pre)`, `dTfinal (post) −
  dTfinal (pre)`, and `demonAgree (post) − demonAgree (pre)`.
- Per-phase trial counts (pre / train / test) are written by
  `stage1_analyze.js` into the manifest summary for every arm (a
  manifest without per-phase counts is malformed and §13-invalidates).

Cross-arm comparisons use seed-PAIRED differences (A−D, A−B, A−C within
the same (E_k, N_k) pair), never unpaired arm-vs-arm t-tests.

---

## 13. Pre-registration, pilot prohibition, and hash pinning

Before the FIRST trial of Stage 1 (or any partial "pilot" run):

1. `stage1_config.json` is finalized (arm table, seed-pair table, trial
   counts, runtime paths, metric weights).
2. `tests/stage1_arm_d_match.test.js` is green (§5d).
3. `stage1_analyze.js --selftest` runs its synthetic-data validation
   (§14) and exits 0.
4. `PRE_REGISTRATION_STAGE1.json` is (re)generated fresh (it is
   forbidden to edit by hand), pinning sha256 of: this protocol file,
   `stage1_config.json`, `stage1_analyze.js`, the runtime files it
   depends on (`experiment_core.js`, `controllers.js`, `benchmark.js`),
   the match test, and itself.
5. Only then may `benchmark.js --config stage1_config.json` run. Any
   code change after step 4 invalidates the pin (visibility: any of the
   pinned hashes will no longer verify) and requires a scripted
   amendment: re-run the selftest + match test, regenerate
   `PRE_REGISTRATION_STAGE1.json`, and note the amendment in §0.

No exploratory/pilot simulation of ANY size (including single-trial
smoke probes of the exact Stage-1 arm configuration) may occur between
step 1 and step 4: the pilot-prohibition lock is hash-enforced, not
honor-system.

---

## 14. Analysis pipeline

`stage1_analyze.js` consumes `research_data/stage1_manifest_<stamp>.json`
(+ row JSONL) and produces, without any inferential machinery:

- per-arm, per-phase trial counts (pre/train/test) — the "PhaseCounts"
  block (malformed if absent);
- per-arm, per-replicate Δ(post − pre) for the §4 endpoint and §12
  selectivity diagnostics (seed-paired across arms);
- mean ± 95% CI (via `experiment_core.meanCI`) as the only uncertainty
  presentation — no p-values, no significance language;
- the Stage-1 gate verdict per §8 (engineering gate only, not a
  scientific decision): row conservation (counts match the seedSpec
  plan), no NaN/Inf, frozen-pre enforcement (weights unmoved in pre),
  floor-arm performance bounded, match-test-not-required-here note.

`node stage1_analyze.js --selftest` validates the pipeline end-to-end on
a SYNTHETIC manifest generated from a documented hostile-test matrix
(deliberately broken rows: NaN, missing phases, floor arm that
outperformed arm A, seed-spec mismatch, weight-drift-nonzero pre rows).
The synthetic selftest is SOURCE-CONTROLLED (no network, no file system
artists) and must pass before Stage 1 can be gated green.

Thermodynamics stays a separate track — see §15 (Stage 1 analysis does
not carry any thermodynamics-derived claim into the primary endpoint).

---

## 15. Thermodynamics: separate track

Thermodynamic quantities (workInJ, extractableJ, erasureCostJ,
landauerRatio, measuredBits and their per-block budgets in
`benchmark.js`’s header) are recorded in rows and reported in the
manifest, but:

1. The confirmatory RCT’s PRIMARY endpoint (§4) is the sorting-behavior
   endpoint (Δpost−pre sortEntropy), NOT a thermodynamic quantity.
2. Thermo metrics are analyzed in a SEPARATE stage-1-analysis block with
   SEPARATE uncertainty reporting, and are treated as measurement-chain
   diagnostics (the audit already showed erasure-cost / measured-bits
   are sensitive to `door.target` flip bookkeeping, not just to
   information flow).
3. No claim in any Stage-1 or Stage-2 report may mix thermo quantities
   with the interventional behavior endpoint (i.e. no "A sorts more
   per Joule than D" as a confirmatory claim — that would be a
   different estimand and would need its own pre-registered
   contrast + multiplicity control in a future amendment).

---

## 16. Provenance & disclosures carried into Stage 1

Inherited from the repo’s own audits (EXPERIMENTAL_VALIDATION_AUDIT.md,
E3R2_REPORT.md §3, P1_BIOLOGY_AUDIT.md) and re-affirmed here:

- `demonAgree` measures agreement with the classical reference policy,
  NOT sorting competence (F-3); it is a secondary diagnostic only.
- Sampling floor: the good:bad metric requires bad crossings > 0 to be
  defined; rows with `goodBadRatio: null` are handled explicitly in
  analysis (not silently dropped or coerced to 0).
- Prior frozen-arm episodes (E4/C5, E9–E11, E3R2); RNG-stream discipline (the
  `makeRng(networkSeed ^ 0x5f5f)` derivation for network seeds, the
  101-stride scheme); the benchmark’s `seedSpecs` table is authoritative,
  never re-derived.
- Stage 1 is exploratory; no claim may cite Stage-1 data as
  confirmation of structural scaling, and all analysis and reporting of
  Stage 1 must repeat the §7 declaration verbatim.

---

## 17. Files that constitute this pre-registration bundle

| Artifact | Role |
|----------|------|
| `Confirmatory_experiment_protocol_v1.md` | this document (v1.1) |
| `stage1_config.json` | frozen Stage-1 config the runtime ingests |
| `stage1_analyze.js` | manifest analysis script (+ `--selftest`) |
| `tests/stage1_arm_d_match.test.js` | Arm D degree-sequence match check (§5d) |
| `PRE_REGISTRATION_STAGE1.json` | hash-pinned registration record |
| `experiment_core.js`, `controllers.js`, `benchmark.js` | designated runtime |

The registration record pins the sha256 of all of the above (both this
bundle and the runtime) at freeze time; the lock semantics of §13 apply.

— END OF PROTOCOL v1.1 —
