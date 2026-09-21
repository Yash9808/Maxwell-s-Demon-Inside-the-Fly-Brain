# Validation Report — Maxwell-Demon Benchmark Suite

**Agent 3 · statistical validation, controls, reproducibility**
Date: 2026-09-21 (preregistration + audit: 2026-09-20) · Preregistration: `PRE_REGISTERED_CRITERIA.json` (written before campaign outcomes) · Audit: `EXPERIMENTAL_VALIDATION_AUDIT.md`

Every empirical statement below is labeled:

* **FACT** — directly verifiable from the artifacts in `research_data/validation/` (raw CSVs are the ground truth; all seeds run, nothing excluded).
* **INFERENCE** — a statistical conclusion from those artifacts under the preregistered decision rules (seed = independent replicate; t-CIs; seeded permutation tests; BH-FDR q=0.05; Hedges' g ≥ 0.5 required for SUCCESS).
* **EXPLORATORY RESULT** — observed post hoc, not preregistered; hypothesis-generating only.

Physics and neural code were **not modified** (`experiment_core.js`, `controllers.js`, `learning_test.js` untouched). The only production-code change is additive: `stats_utils.js`, campaign/analysis/plots/tests drivers.

---

## 1. Campaign summary

| Experiment | Question | Seeds | Episodes/seed | Primary endpoint | Verdict |
|---|---|---|---|---|---|
| E3 | Can the Drosophila-inspired MB network learn the door task? | 20 | 300 train + 60 test | paired late−early train good:bad | **FAILED — MALADAPTIVE COLLAPSE** |
| E4 | Does the connectome itself contribute performance? | 12 × (4 arms) + 10 shuffle draws | 120 train + 24 test | 4A vs shuffle-mean 4C test good:bad | **NO EVIDENCE** (§3) |
| E9 | Does plasticity help the pressure demon do work? | 20 | 12 train + 12 test | paired neural−frozen test workJEp | **NO EVIDENCE** (loop verified alive) |
| E10 | Does plasticity help the trapdoor transport? | 12 | 10 train + 10 test | paired neural−frozen test netSorted | **NO EVIDENCE** (flap physics verified) |
| E11 | Does plasticity help the ratchet extract work at equilibrium? | 12 | 12 train + 12 test | paired neural−frozen test workJEp | **DIRECTION ONLY** (g≈0.44, p_adj≈0.25) |

## 2. E3 — Drosophila-inspired MB network: maladaptive collapse (headline finding)

**FACT.** Across all 20 seeds × 360 episodes of the learning arm:

* `openFraction` by training quarter: 0.002 (Q1) → **0.000 exactly** (Q2–Q4); crossings/episode 0.04 → 0.00. By trial ~75 the learned policy holds the door permanently shut in every seed (`raw_e3.csv`, `E3_VALIDATION.csv` rows `openFraction_Q*`).
* The frozen twin of the same controller stays engaged (openFraction ≈ 0.249, ≈5.4 crossings/episode), and the environment demonstrably offers crossings (classical arm: 0.2% zero-crossing episodes; random arm: 2.4%).
* 7,194 of 7,200 learning-arm episodes have zero crossings → no feedback → no gradient out of the closed state: an absorbing state created by the reward contract, which scores every non-productive opening as punishment (−1) while holding the door closed is cost-free.

**INFERENCE.** The E3 controller reliably *learns* — it learns disengagement. Under the preregistered success criterion (primary contrast = 0, p_adj = 1.0, exact sign-flip test; only 5/20 seeds produced any finite good:bad block, zero dropped-seed fallback used) E3 **fails**. The failure is worse than "no learning": the reward structure actively teaches door avoidance. The 1.55→4.56 good:bad "learning curve" in `maxwell_demon_experiment.md` (single run, single seed) cannot be generalized: in the multi-seed benchmark the same architecture never reaches a state where that ratio is even defined.

**EXPLORATORY RESULT.** The E3 measurement suite shows dT (p_adj ≈ 1e-4, g ≈ 3.7) and sorting entropy (p_adj ≈ 1e-4, g ≈ 3.3) differences between the drosophila and random arms on the test phase; these are driven by door-usage differences (open fraction 0.0 vs 0.38), not by sorting skill, and should only be interpreted as evidence of *behavioral divergence*, not benefit. A less punitive shaping (e.g., small cost for staying closed while particles wait, or an exploration floor on door openings) is the obvious repair and is deliberately **not** implemented here (out of scope: no redesign).

## 3. E4 — Connectome contribution

**FACT.** The campaign ran 4 arms (4A full, 4B restricted, frozen, 4C shuffled × 10 independent degree-preserving shuffle draws) with 12 seeds each under matched conditions (same opticDrive 0.25, same plasticity rules; `raw_e4.csv`).

**INFERENCE.** On the preregistered primary — 4A vs the mean of 10 independent degree-preserving shuffle draws (4C), test-phase good:bad — **no evidence** of connectome-specific benefit: 4A 0.661 (SD 0.123) vs shuffle-mean 0.672 (SD 0.044), contrast −0.011, Hedges' g = −0.11, BH-adjusted p = 0.93 (raw p = 0.79, label-permutation n = 10,000). Secondaries: 4A vs 4B g = +0.39 (DIRECTION ONLY, p_adj = 0.93); 4A vs frozen g = +0.07 (null); 4A's own late−early train gain g = −0.02 (null — no within-run adaptation either). For completeness: 4A's own late−early train gain is negative but minuscule (contrast −0.006, g = −0.02, p_adj = 0.93, NO_EVIDENCE) — there is no measurable within-run adaptation either. The preregistered answer to E4's question is: **the connectome itself contributes no measurable performance over its degree-preserving shuffle under matched conditions.**

**DISCLOSURE (FACT).** The 4C shuffle draws ran on a different env-seed subset (1,4,7,10,102,105,108,111,203,206,209,212) than 4A/4B/frozen (1–12) — a campaign-chunking artifact, not a matched-pairs design; the primary was declared unpaired accordingly. The shuffle-draw variance (SD 0.044) is 3.6× smaller than 4A's between-seed variance, i.e. shuffle identity matters less than env seed.

**EXPLORATORY RESULT.** 4A's test good:bad (0.661) and frozen's (0.651) are statistically indistinguishable — whatever the connectome computes, plasticity on top of it adds nothing measurable here either.

**EXPLORATORY RESULT.** In pre-campaign 2-seed artifacts, connectome vs shuffled connectome differed by ≈0.03 in demonAgree — within what this audit now identifies as a self-referential metric (F-3); no defensible conclusion was possible from those artifacts.

## 4. E9 — Pressure demon

**FACT.**
* 20 seeds, all 5 variants, 2,400 raw episode rows (`raw_e9.csv`).
* The classical reference (`demon_speed`) produces ≈2× the per-episode spring work of the neural arms and ≈0.95 decision accuracy vs ≈0.45 for the brain arms (matches the Phase-2 artifact).
* `workJEp` is verified to reset per episode (fluctuates independently; cumulative `workJ` is its running sum).
* `netWorkJ = workJ − erasureCostJ` is arithmetically dominated by the Landauer bill: work ~1e-22 J vs erasure ~1.26e-17 J (work/erasure ≈ 7e-6). Any "net work after erasure" claim from this ledger is meaningless at this scale — recorded in `THERMO_CLASSIFICATION.csv`.

**INFERENCE.**
* **Primary (preregistered):** paired neural − frozen test `workJEp`: **no evidence** (p_adj = 0.94, g = −0.01). Plasticity provides no measurable benefit on useful mechanical work.
* **Floor / sanity (preregistered check):** neural vs `never_open` on `workJEp`: p_adj = 3.2e-4, g ≈ 8.7 → the closed loop is **alive**: the brain-driven valve does physical work that the never-open valve cannot. The null is a learning null, not a wiring artifact.
* **Secondary:** dopamine and weightDrift behave as designed (weightDrift SUCCESS p_adj = 6.5e-4, g = 11.3 — plasticity is objectively active in the learning arm and zero in frozen). reward, decisionAccuracy, ΔP, piston, openFraction: all null after FDR.
* **Sagawa–Ueda efficacy** η = ⟨W⟩_feedback / ⟨W⟩_no-feedback = **1.01, CI [0.92, 1.10]** — the feedback (plasticity) extracts no additional work beyond the no-feedback policy. (MODEL-DEPENDENT quantity on simulated units; classified, not claimed as measured thermodynamics.)
* **EXPLORATORY RESULT:** demonAgree ≈ 0.64 for the neural arm confirms the earlier Phase-2 observation that the brain partially *imitates* the reference policy, while its physical performance stays at the frozen level — imitation without benefit; reported only as a metric-behavior observation.

## 5. E10 — Smoluchowski trapdoor

**FACT.**
* 12 seeds, 4 arms, 960 rows (`raw_e10.csv`).
* Flap physics check: light vs heavy flap crossing rate differs strongly (p_adj = 2.2e-2, g = 1.36) — mass-dependent flap dynamics verified.
* The brain's only actuator is `door.hold` (pin-shut); `classicalValveDecision`-style reference is computed for agreement only (source-guard test R3 passes).

**INFERENCE.**
* **Primary:** paired neural − frozen test netSorted (L→R minus R→L): **no evidence** (p_adj = 0.87, g = −0.09). No measurable plasticity benefit on directed transport.
* Secondaries (directionalBias, decisionAccuracy, reward, densityDiff, holdFraction): all null after FDR.
* **Sagawa–Ueda efficacy** on netSorted: η = 2.12, CI [−1.54, 5.79] — consistent with 1; the ratio is unstable because the no-feedback denominator is near zero (documented in the CSV).

## 6. E11 — Feynman ratchet & pawl

**FACT.**
* 12 seeds, 5 arms, 1,440 rows (`raw_e11.csv`).
* Physics checks pass: `ratchet_gradient` (Th>Tc) drives net forward rotation vs `ratchet_equilibrium` (p_adj = 8.0e-4, g = 15.9); at Th=Tc the machine back-drives (negative net per episode) exactly as the detailed-balance construction requires. No work-from-one-bath artifact.
* The pawl is coupled to the controller ONLY through the brain's lift/engage decision (verified by source guard R3 + behavioral test R2-family).

**INFERENCE.**
* **Primary:** paired neural − frozen test `workJEp`: direction consistent (+, g = 0.44, 9/12 seeds positive) but **does not reach significance** after FDR (p_adj = 0.25). Verdict: DIRECTION ONLY — the honest reading of the earlier 10-seed sweep ("the learning gain does NOT hold with proper statistics") is unchanged at 12 seeds.
* **Sagawa–Ueda efficacy** (secondary context): reported in `analysis_meta.json`; CI includes 1.
* `miNeural` for E11 is structurally 0 (no spatial particles; audit F-7) — PLACEHOLDER, excluded from all inference.

**EXPLORATORY RESULT.** The reward secondary shows the same direction (p_adj = 0.065, g = 0.66) — if a future, longer-training or better-credited run is planned, this is the signal worth powering for; as it stands it does not survive multiplicity.

## 7. Thermodynamic accounting (classification)

All quantities classified in `THERMO_CLASSIFICATION.csv` under the five levels. Headlines:

* **No DIRECTLY MEASURED thermodynamic quantity exists in this suite** — every energy/entropy number is simulated (DERIVED from sim state in declared sim units, MODEL-DEPENDENT by construction, or a PROXY).
* `extractableJ` (door task) is a finite-reservoir upper bound; no engine exists; MODEL-DEPENDENT.
* Landauer erasure bills are bookkeeping for metered memory traffic; in E9 they exceed the work signal by ~5 orders of magnitude, which is itself the honest finding: these demons are jet/piston-subsidized, not information-driven.
* The preregistered **feedback/no-feedback comparison** is implemented in every experiment (learning arm vs frozen arm, matched seeds) and consumed by the Sagawa–Ueda-style efficacy η = ⟨W⟩_fb/⟨W⟩_no-fb (MODEL-DEPENDENT; defined only when the denominator is positive; degenerate cases reported as NaN with reason).
* E11 `entropyProduction = Qh/Th − Qc/Tc` is MODEL-DEPENDENT barrier bookkeeping in an event-rate model; it is never reported as measured entropy.

## 8. Regression protection

`validation_tests.js` (15 tests, `node --test validation_tests.js`) now guards, behaviorally and at source level:

* **R1** shuffled control exists, is degree-preserving (in/out degree exact), and is wired into E4 (4C) registries;
* **R2** controllers actually reach their actuators (door target numeric; E9 neural arm moves the valve);
* **R3** the classical/reference policy can never be assigned to an actuator (`valve.target =`, `door.target =`, `pawl.lift =` guards);
* **R4** reward stays coupled to physics (never-open cannot out-work the neural arm; never-open has 0 openings/crossings);
* **R5** train/test separation (phase calls must be `setLearning(true)` then `setLearning(false)`; frozen arm must hold weightDrift at exactly 0);
* **R6** seed-level statistics (analysis must use per-seed aggregation; a block CI must have n = seeds, with an explicit worked example that fails if someone reintroduces trial-level CIs; n=1 must yield zero-width CI);
* **determinism** same-seed reruns are bit-identical.

Status at report time: **15/15 pass**.

## 9. Reproducibility

* Campaign: `node validation_campaign.js --exp e3,e4,e9,e10,e11` (parallel, resumable; seeds fixed; ~5 CPU-hours total for E4 alone, ≈7.5 h wall including an overnight machine suspension — every E4 job resumable and re-verified on merge).
* Analysis: `node validation_analyze.js` (deterministic; fixed permutation seed 20260920).
* Plots: `python validation_plots.py` (seaborn-style PNGs into `research_data/validation/plots/`).
* Tests: `node --test validation_tests.js`.
* Raw per-episode CSVs (`raw_e{3,4,9,10,11}.csv`) are the single source of truth; every number in the report can be recomputed from them.

## 10. Overall status

The statistical layer, controls, preregistration, campaign, and regression suite are complete and the flagship claims are now stated with seed-level uncertainty. The headline scientific results are negative-to-null with two verified-positive sanity anchors (E9 loop-alive; E11/E10 physics checks) and one important maladaptive-learning finding (E3 collapse).

**VALIDATION COMPLETE** — all five flagship campaigns ran to completion (E3: 20 seeds; E4: 12 seeds × 4 arms + 10 shuffle draws; E9: 20 seeds × 5 variants; E10/E11: 12 seeds each), all preregistered tests were computed on the full merged raw data with no exclusions beyond the declared rules, the regression suite passes 15/15, and every deliverable listed in the task is present in `research_data/validation/` (plus `SAGAWA_UEDA_EFFICACY.csv`). The scientific results are negative-to-null across the suite; the two preregistered SUCCESSes that remain (E9 floor check, E10 flap physics, E11 gradient check) are sanity anchors, not demon effects, and E3's dTfinal/sortEntropy "successes" are explicitly flagged degenerate. No wiring defect was found that would block the statistical conclusions.
