# Experimental Validation Audit — Maxwell-Demon Benchmark Suite

**Agent 3 · statistical validation, controls, reproducibility**
Date: 2026-09-20 · Branch: `Ver2(Split-code-fastframe)` · Code version: `8c5793d` (as stamped in research_data provenance)

Scope: **E3, E4, E9, E10, E11** (flagship). E1/E2/E5/E6/E7/E8 are treated as regression controls only — their existing artifacts are cited as evidence about the framework, not re-audited for science.

This audit was written **before** running any new campaign and **before** `PRE_REGISTERED_CRITERIA.json` was evaluated against any new outcome. Files inspected: `experiment_core.js` (1866 lines), `controllers.js` (939 lines), `benchmark.js`, `experiment_worker.js`, `e9_batch_validate.js`, `e10_e11_batch_validate.js`, `e11_validation_sweep.js`, `learning_test.js`, and the result artifacts under `research_data/`.

---

## 1. Architecture of the benchmark (what actually runs)

| Layer | File | Contents |
|---|---|---|
| Physics + trial engine (E1–E8 door task) | `experiment_core.js` `makeEnvironment`, `runBenchmark` | 320-particle 3D chamber, seeded PRNG (`makeRng`, mulberry32), per-trial thermodynamic ledger |
| Apparatus cores (E9/E10/E11) | `experiment_core.js` `pressureDemonCore`, `smoluchowskiCore`, `feynmanRatchetCore` | Self-contained seeded sims; one row per episode via `onTrialData` |
| Controllers | `controllers.js` | classical demon, random, ANN, drosophila (E3), connectome + shuffled control (E4), saboteur, never-gate |
| CLI batch | `benchmark.js`, `e9_batch_validate.js`, `e10_e11_batch_validate.js`, `e11_validation_sweep.js` | Multi-seed orchestration, JSONL/CSV/JSON output |
| Browser worker | `experiment_worker.js` | Same cores in a Web Worker; per-experiment seed/episode defaults |

## 2. Unit definitions (the single most important statistical fact)

**One independent replicate = one SEED.** Concretely:

* **E1–E8 door task (`runBenchmark`):** seed k uses environment PRNG `seed + k*101` and controller PRNG `makeRng(seed ^ 0x5f5f)`. `conditions[key]._raw` is an array of per-seed records — this is the correct replicate level, and `meanCI()` in `summarizeCondition` averages **one value per seed** (e.g. `blockAvg` collects one per-seed mean of the test block, not per-trial values). ✅ **Trial-level CIs are NOT used in the core.**
* **E9/E10/E11 apparatus cores:** `cfg.seed` drives the gas/variant PRNG; `brainFactory(seedTag)` builds **one brain draw per seed** (`makeRng(9176 + seedIdx*37)`, `pgRng = makeRng(424243 + seedIdx*977)`). Episodes within a seed share the gas, the piston state (E9 persists physical state across episodes *within a variant*), and the brain weights — they are repeated measures, **not** independent replicates. `e9_batch_validate.js` and `e11_validation_sweep.js` both aggregate per-seed TEST-phase means before CI. ✅

**One trial:**
* Door task: one `train`/`test` episode of `episodeSeconds` (default 12 s), 320 particles, ~50 crossing cap.
* E9: 20 s valve episode (260 molecules, 10 s burn-in excluded from pressure averages; piston state *persists* across episodes within a variant).
* E10: 16 s trapdoor episode (220 molecules, 6 s equilibration before crossing counting).
* E11: 12–30 s ratchet episode (event-rate model, no spatial particles).

**Which seeds are independent:** all seeds within one campaign (`seed + k*101`). **Caveat F-1:** E9's variant PRNG is `makeRng(seed*31 + vi*7919)`; E10/E11 use the same formula. Different variants within one seed therefore draw *different* (not shared) gas realizations — real-vs-control comparisons are **unpaired at the gas level**. The brain draw IS matched between `demon_neural` and `demon_frozen` (same factory + same seed), so neural-vs-frozen is paired at the brain level but not the gas level. This weakens variance reduction but does not bias estimates.

**Seeds actually used in existing artifacts (pre-campaign):**
* `benchmark.js` default: 5 seeds (quick: 2). `research_data/trials_*.jsonl` confirm 2 seeds (1, 102) in the Sept-16 runs.
* `e9_batch_validate`: 20 seeds (seed list 1..1920 step 101), 12 train + 12 test × 20 s — runtime ~192 s.
* `e11_validation_sweep`: 10 seeds, 24+12 × 30 s.
* `e9_training_sweep`: 20 seeds × 4 training lengths × 3 reward regimes × 3 cadences (~8.8 h run).

## 3. Train/test leakage audit

| Pathway | Verdict | Evidence |
|---|---|---|
| Door task test phase | **No weight leakage** (learning flag off) — but see F-3 | `runBenchmark` sets `setLearning(ph.learning)`; connectome/drosophila implement it; classical/ANN/random have no plasticity |
| E9/E10/E11 test phase | **No weight leakage** | `brain.setLearning(mode==='neural' && phase==='train')`; frozen control runs plasticity off from trial 0 |
| Gas/piston state | **PHYSICAL CARRY-OVER** (F-2) | E9 comment: "physical state persists ACROSS episodes within a variant (one gas, one piston)"; E10/E11 counters (`crossLR`, `ang`, `qh/qc`) also persist — per-episode fields isolate deltas, but phase means ride on a shared trajectory |
| Metric leakage | **`demonAgree` is self-referential** (F-3, critical) | Door task: the controller scores itself against `demonDecisionFor(env)` — the classical demon agrees with itself 100% by construction (seen: `classical_demon agree=1.0` in every summary). E9/E10/E11: "classical reference computed every decision for demonAgreement ONLY and never actuates" — the score is reference-vs-action, computed for all variants, so it is a *similarity* metric, never a performance proof |
| Threshold adaptation across phases | Minor | classicalDemon adapts `vThreshold` continuously (train and test alike); it is a non-learning policy so this is not leakage of learned weights, but test-phase behavior is not fully exogenous |

**F-3 detail (why this matters):** `demonAgree` for the connectome is the fraction of ticks where its door target matches the *hard-coded classical rule*. A controller can raise demonAgree by imitating the reference without improving the physical outcome (good:bad crossings, ΔT). E4's headline in the older summaries (`connectome agree 0.53 vs shuffled 0.50`) is a 0.03 self-similarity gap, not evidence of sorting skill. Existing E9 Phase-2 data: `demon_speed` (the reference policy itself) has accuracy 0.947 while `demon_neural` ≈ 0.45 ≈ `demon_frozen` ≈ 0.47 — i.e. the fly brain is ~chance on the reference-scored axis. Any report that uses demonAgree as a *learning* metric is invalid. → Confirmed in §8 criteria: demonAgree is a **secondary/reference** metric only.

## 4. Curve aggregation audit

* `benchmark.js` builds 10-trial blocks **per seed** and the summary `blocks[]` pools all seeds' block means — plots drawn from `blocks` therefore mix seed-level and block-level variance. **Blocks are for display; CIs must come from per-seed values.** (The `meanCI` in `summarizeCondition` does this correctly; the `blocks` array does not carry CIs.)
* `apparatusCurve(rows, B)` (E9/E10/E11): block-averages per seed **first**, then `meanCI` across seeds per block. ✅ Correct nesting (seed = unit).
* `experiment_worker.js` live sparklines: block curves across seeds, CI band from `apparatusCurve`. ✅
* `learning_test.js` (`learning_curve.json`, the 1.55→4.56 headline in `maxwell_demon_experiment.md`): **a single 9,000-frame run, one seed, no controls.** FACT: those numbers exist in the artifact. INFERENCE: none about learning in general. This headline is explicitly downgraded in `VALIDATION_REPORT.md`.

## 5. CI methodology audit

* Core `meanCI()`: **normal approximation** `1.96·sd/√n` over seed values. For n = 5–20 seeds this is anti-conservative; a Student-t critical value (e.g. 2.093 at df 19) should be used. `e9_training_sweep_analysis.json` already uses `t(0.975, N−1)` and verified tcrit against tables. → The new analysis layer (`stats_utils.js`) uses **t-based CIs** and, for small n, also reports bootstrap CIs where noted.
* Welch t-tests (`e9_batch_validate.js`): Welch–Satterthwaite df, two-sided, verified against an independent numeric-integration p-value method (`--selftest`). ✅ Reused.
* Paired claims (E11 sweep): paired neural−frozen per matched seed. ✅ Correct pairing direction (brain-matched).
* **No multiple-comparison handling exists anywhere.** The Phase-2 E9 file runs 8 Welch tests at α=0.05 uncorrected. → New layer: Benjamini–Hochberg FDR across each experiment's primary family + Holm for the small preregistered families.
* **No permutation/randomization tests exist.** → New layer implements seeded, degree-preserving-label permutation (see `stats_utils.js`), which is the correct tool given non-normal seed-level distributions and n≈20.
* **No effect sizes are reported anywhere** (no Cohen's d, no Hedges' g, no rank-biserial). → New layer: Hedges' g (small-sample corrected) + rank-biserial r from the permutation framework.
* `goodBadRatio` handling: `null` when 0 bad crossings avoids ∞; `blockAvg` filters non-finite. ✅ but means of ratios are dominated by the small-denominator tail — medians reported alongside.

## 6. Controls audit

### 6.1 Shuffled connectome (E4 4C / E5 / benchmark.js)
* **Degree-preserving?** `connectomeController` shuffle: `targets = edges.map(e => e.t)` then Fisher–Yates on **targets only**, keeping sources and weights fixed. This is **in-degree-exact, out-degree-exact, weight-exact** rewiring (a configuration-model style permutation). Sign is kept on the edge (moves with the edge, not the target) — so excitatory/inhibitory counts per *source* are preserved; per-*target* sign composition is NOT preserved (a shuffle can hand an inhibitory input to a neuron that had none). Documented as a known property of the control, matching the PDF's 4C definition. Verdict: **degree-preserving (yes), sign-location-preserving (no)**.
* **Matched conditions?** Same circuit JSON, same `opticDrive: 0.25`, same `plasticity: "full"`, same LIF parameters; only `shuffle: true` and `rng: makeRng(7)` differ. One shuffle draw (seed 7) per run — the new campaign uses **10 independent shuffle seeds** (the randomization-test unit), each contributing its own seed-level replicates.
* **Saturation regime:** README notes aggregate drive 1.0 saturates the motor layer making topology irrelevant; benchmark pins 0.25. Campaign keeps 0.25 and records it.

### 6.2 Frozen / random / never-open / saboteur
* **Frozen connectome (E9 `demon_frozen`, E10 `trapdoor_frozen`, E11 `ratchet_frozen`):** identical brain factory and seed, `setLearning(false)` from trial 0 → isolates *plasticity*, holding the connectome draw fixed. **Causal as a learning control** (exposure-matched). Note E9's frozen variant *does* write the valve (rate-code readout) — it is a "frozen-weights, same-actuator" control, correct for the learning claim.
* **E4 has no frozen-weights arm** in the worker registry (4A full / 4B restricted / 4C shuffled). The campaign adds `connectome_frozen` (plasticity "none") as a new control arm so E4 can separate *structure* from *plasticity*.
* **Random valve (E9 `demon_random`):** opens with p=0.3, **two-way passable** (the only two-way variant — deliberate: "no information, no rectification"). It therefore differs from neural variants in *two* respects (policy AND rectification direction); it is a no-information control, not a matched-rectification control. Documented.
* **Never-open (E9):** valve never opens; isolates background drift of pressure/piston metrics. ✅ proper zero-policy control.
* **Saboteur (`saboteurController`, door task):** inverted rule under identical physics — causal counterpart of the classical demon. Only used by E6 (regression control here).
* **Classical controller:** reference policy in E9 (computed each decision, never actuates neural variants). **Verified: the classical rule is NOT the actuator of any neural condition** (`pressureDemonCore` decision block writes `valve.target = action` where `action` comes from the brain/PG readout for neural/frozen; `classicalValveDecision` feeds only `epAgree`). E10/E11 identical pattern. ✅
* **E3 random control:** E3's registry entry runs drosophila alone; but E2/E5 pair drosophila-class comparisons with `random`. Campaign runs drosophila + random + classical in one seeded block.

## 7. Physics/causality audit for E10/E11 (chain classification)

Full chain-by-chain classification (REAL / PARTIAL / SCRIPTED / DECORATIVE / MISSING) lives in `VALIDATION_REPORT.md` §E10/§E11. Summary of code-level findings:

* **E9 chain:** sensors `senseE9` (8ch, local box + bulk pressures) → REAL but includes **bulk pressure channels (ch3–ch5) that a molecule-scale demon could not measure locally** (disclosed in the sensor doc as "cuticle sensing" — PARTIAL). Neural controller (FAFB LIF + PG readout) → REAL. Motor → valve.target → valve.pos (eased `dt*10`) → one-way L→R passable rule → crossings → `_apparatusSideStats` pressures → piston integrator `F=(P_R−P_L)−SPRING·x` → spring work `dW` → reward `wWork·dW + wSelect·(helps) − wWrong` → `receiveFeedback` → dopamine `da.v` → `applyLearning` via eligibility windows → weights persist → future valve decisions. Every link present and driven by state. **No scripted success found.** The `success` field (`epGood > epBad && epWorkU > 0`) is a derived flag, not an input to anything.
* **E10 chain:** flap physics is real (impulse-driven spring-hinge, mass-dependent, both directions passable while open — the Smoluchowski `kBT ln2` trap holds by construction); brain's ONLY actuator is `door.hold` (pin shut); release while a fast molecule waits (`wrong = action===1 && fastWaiting`) is scored, not scripted. ✅ no shortcut. Known limit: sensors include the brain's own `hold` state (ch6) and global side-density contrast (ch3) — PARTIAL observability, disclosed.
* **E11 chain:** event-rate model (not molecular dynamics) — hop probabilities with explicit barriers `exp(−(EPS+Lb)/Th)` forward, `exp(−(EPS−Lb)/Tc)` backward; at Th=Tc, pFwd/pBack = exp(−2Lb/T) < 1 ⇒ **net back-driving at equilibrium is guaranteed by construction**; the brain's only actuator is `pawl.lift` (lift ⇒ both directions see the load alone). Work is signed (`workEp = net·load`, backward pays work back — the old `max(0,·)` clamp was removed). Heat/entropy bookkeeping is a per-episode sum of barrier energies: **MODEL-DEPENDENT**, not a measured Q. **DECORATIVE only:** `wobAng` thermal wobble is visual. The `miNeural` field for E11 divides spike counts against an **empty particle list** → structurally 0 (MISSING metric, reported as such).
* **Ratchet–controller coupling:** verified `pawl.lift` is written ONLY in the brain decision block; physics variants never write it. The demon effect cannot be scripted because the only pathway from brain to wheel is the pawl timing.
* **Thermodynamic ledger (door task):** `workInJ` (signed jet work), `extractableJ` (`U_hot(1−Tc/Th)` upper bound), Landauer erasure bill for metered decision/feedback bits. All **DERIVED** from simulated state; the SIM_J = 1e-21 J scale factor is an arbitrary unit convention. Honest headline (README): bits_used ≪ bits_needed ⇒ jet-subsidized sorting. Preserved as MODEL-DEPENDENT/PROXY in the classification table.

## 8. Findings register (F-1 … F-9)

| # | Severity | Finding |
|---|---|---|
| F-1 | Low | Variant gas draws are unpaired across conditions (per-variant PRNG). Fixed by recording pairing structure; neural-vs-frozen remains brain-paired. |
| F-2 | Medium | E9 physical state (piston, gas) persists across episodes within a variant — per-episode rows are repeated measures on one physical trajectory; only seeds are replicates. Never treat episodes as n. |
| F-3 | **Critical** | `demonAgree` is self-referential for the classical demon (≈1.0 trivially) and reference-relative for all controllers; it must never be the sole/primary learning metric. Confirmed numerically in existing artifacts. |
| F-4 | Medium | `meanCI` uses normal-approx 95% CI with n as small as 2 (`benchmark.js --quick`, E4/E10 worker defaults: seeds=1!). Single-seed configs (E4: seeds 1; E10: seeds 1; E11: seeds 1 in worker defaults) produce **CI = 0** — meaningless precision. Campaign fixes seeds ≥ 10 (E4/E10/E11) and 20 (E3/E9). |
| F-5 | Medium | No multiple-comparison correction, no permutation tests, no effect sizes anywhere in the codebase. |
| F-6 | Low | E4 4C uses a single shuffle seed (7) per run — shuffle-draw variance never quantified. Campaign: 10 shuffle seeds. |
| F-7 | Low | E11 `miNeural` structurally 0 (no particles); do not interpret. |
| F-8 | Low | `benchmark.js` summary `blocks[]` mixes seed and block variance for display curves; CI extraction must go through per-seed values only. |
| F-9 | Info | Pre-campaign criteria that exist (`e9_training_sweep_analysis.json` successCriterion; `e11_validation_sweep` gainTest) were defined **before** their sweeps ran but **after** Phase-1/2 exploratory results were seen. They are labeled *exploratory-confirmed* in `PRE_REGISTERED_CRITERIA.json`; all headline criteria in that file are the new prospective ones, written before the Agent-3 campaign. |

## 9. Verdict of the audit

The framework's **replicate unit (seed) is consistently correct** in the batch validators and the core CI path; the **critical flaw is metric choice** (demonAgree self-reference, F-3) and **underpowered single-seed defaults** (F-4), with a complete absence of formal statistics beyond Welch t (F-5). No train/test weight leakage, no scripted reward, no scripted actuation was found. The E10/E11 physics loops are causally closed and were **not modified**.

**Audit status: VALIDATION PARTIAL** — the statistical layer, campaigns, and reports (see `VALIDATION_REPORT.md`) complete the program this audit prescribes.
