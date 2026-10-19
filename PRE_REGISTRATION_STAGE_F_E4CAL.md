# Preregistration — Stage F E4-CAL: Retinotopic Input-Calibration Sweep

**Status: PROSPECTIVE.** This document was written and pinned **before running any
arm on any preregistered calibration seed** (the only pre-launch execution is the
declared smoke check on non-registered seed 999, whose outcome values are never
inspected — same convention as the Stage F E4 timing calibration). It defines the
study in `PRE_REGISTRATION_STAGE_F_E4CAL.json`; the JSON is machine-checkable and
the two must agree. Where the two disagree, the JSON governs.

## 1. Question and motivation

The preregistered Stage F E4 study (STAGE F E4, `STAGE_F_E4_RESULTS.md`) failed
its primary criterion and documented **endpoint degeneracy** as the primary
empirical finding: at opticDrive 0.25 with motorDrive 0.35, the retinotopic
relative-contrast field leaves the connectome motor readout opening the door at
~0.06% of steps (test openFraction 0.0006 vs 0.3342 in the legacy-input original
campaign at identical drive; test crossings/trial 0.000 vs 5.941; trials with ≥1
crossing 0.0% vs 93.4% — `STAGE_F_E4_DEGENERACY_SUPPLEMENT.json`). The E4 report
(§7) prescribed, as the recommended next step, *a small preregistered sweep of the
optic→motor drive mapping that restores the door to an open fraction in the
legacy ballpark (0.2–0.4) without touching physics, seeds, or reward
coefficients*. **This study performs exactly that sweep.** No result of any grid
cell on any calibration seed existed when this document was written.

## 2. Mechanistic basis (FACT, from code and prior measurements)

- The door policy is `ratio = motorRateSmooth / max(layerRateSmooth, 1e-6) − 1`,
  `door.target = clamp(ratio·40, 0, 1)`, open iff target > 0.5, i.e.
  **ratio > 0.0125** (pool rate must exceed whole-layer rate by ≥1.25%).
- Uniform motor-pool tone is injected per tick with probability
  `motorDrive·0.10` (`motorDrive` factory option, default 0.35 — the baseline
  that was never re-tuned for the new input regime). Uniform tone raises pool and
  layer rates equally and therefore **dilutes** any routed pool-vs-layer
  asymmetry; a lower tone makes routed signal stand out in the ratio.
- Retinotopic optic injection probability per neuron is
  `min(1, drive·2·opticScale)` per tick (4× rotating decimation, kick 14 —
  identical semantics to legacy; only the grouping changed). Measured kick
  collapse at identical opticDrive 0.25: **~945 vs ~8374 kicks/tick** (~9×;
  `tools/diagnose_optic_input.js` A/B, recorded in the controllers.js Stage F
  comment). Busiest legacy bin sat at drive ≈1 → p ≈ 0.5; busiest retinotopy
  column has relative contrast ≈ 0.06 → p = 0.12·opticDrive
  (0.03 at the current drive).
- The two normalizations bracket the legacy-matched optic drive:
  **total-kick-matched ≈ 0.25 × 8374/945 ≈ 2.2**; **peak-matched
  ≈ 0.5/(2·0.06) ≈ 4.2**. The grid spans both plus two below points.

## 3. Design

- **One arm only**: the connectome_4A configuration (shuffle false, plasticity
  full, `opticInput: "retinotopy"`). Calibration concerns the input interface,
  not connectome structure; no shuffled or frozen arm is run here and no
  structure comparison is made in this study.
- **Sweep knobs** — both are pre-existing `connectomeController` factory options;
  **no code semantics change, no physics change, no seed-rule change, no reward
  or plasticity change, no trial-structure change**:
  - **optic axis** at motorDrive 0.35 (the untouched baseline):
    opticDrive ∈ {0.5, 1.0, 2.0, 4.0}
  - **motor axis** at opticDrive 2.0 (total-kick-matched point):
    motorDrive ∈ {0.10, 0.20} (tone-dilution probe)
  - **anchor cell**: (opticDrive 0.25, motorDrive 0.35) — the degenerate E4
    operating point, reproduced on held-out seeds as a sanity control.
  Grid: **7 cells**, named `cal_od<X>_md<Y>` (dot → `p`).
- **Seeds**: calibration seeds **k = 13..16** (4 seeds), env seed rule untouched
  (physics seed = 1+(k−1)·101 inside `runBenchmark`). These are **held out from
  the confirmatory re-registration**: the E4R2 4-arm comparison, if this sweep
  selects a viable point, will reuse the original preregistered k = 1..12
  exactly, so operating-point selection cannot contaminate the confirmatory
  seeds.
- **Windows**: trials [0,120) train; 24 test trials, learning off; 12 s episodes;
  320 particles, noise 0.12, doorHeight 64 — identical to the E4 campaign CFG.
- **Row budget**: 7 cells × 4 seeds × 144 trials = **4,032 rows** (coverage check
  enforced; any missing cell voids the run).
- **Estimated cost**: ~28 jobs at the E4 campaign's measured rate ≈ 25 min at
  12-way parallelism.

## 4. Endpoints and decision rules (fixed before data)

Per cell, per seed: test-phase `openFraction` mean, test-phase
crossings/trial, test-phase % of trials with ≥1 crossing. Cell score =
mean over the 4 seeds of test-phase openFraction. **No inferential test is run
in this study** (measurement and selection only; no p-values are reported
anywhere in the analysis). The confirmatory hypothesis test about connectome
structure belongs to a separately preregistered E4R2 at the selected point —
not part of this document.

**Primary selection rule, applied verbatim:**

1. **Viable cells**: cell score ∈ [0.20, 0.40] AND mean test-phase
   trials-with-≥1-crossing ≥ 50%.
2. If ≥ 1 viable cell: **CALIBRATED**; selected cell = viable cell with score
   closest to the legacy 0.334; ties broken by smaller opticDrive, then smaller
   motorDrive.
3. If no viable cell but some cell has score ≥ 0.10 with the crossing-viability
   gate met: **BELOW_BAND**; no confirmatory re-registration launches from this
   sweep; a new sweep may be preregistered with an updated grid (disclosed as an
   amendment, written before that new grid's data).
4. If every cell has score < 0.10: **NO_CANDIDATE — calibration FAILED** for the
   (motorDrive, opticDrive) knob pair; the fallback path per STAGE F E4 §7 is
   endpoint replacement (optic-layer spatial encoding studies at the current
   operating point), which is **not executed here** and must be separately
   declared.

The anchor cell is expected (declared prior, §5) to reproduce the degenerate
openFraction ~6e-4. If it does not, that is reported as a seed-sensitivity
observation and changes nothing in the rule.

## 5. Declared prior observations (not outcomes of this study)

- STAGE F E4 degeneracy supplement: test openFraction 0.0006 (retinotopy) vs
  0.3342 (legacy), crossings/trial 0.000 vs 5.941, trials-with-crossing 0.0% vs
  93.4%, at identical opticDrive 0.25 / motorDrive 0.35.
- Stage F wiring report: optic-layer rate 2.35 Hz at the E4 drive under
  relative-contrast retinotopy; ~9× optic kick collapse at identical drive
  (tools/diagnose_optic_input.js A/B).
- Legacy busiest-bin injection probability ≈ 0.5 (drive ≈ 1, saturated).

## 6. Integrity rules

- All 7 cells × 4 seeds run; no outcome exclusion; no cell or seed selection
  beyond the preregistered rule; no re-rolls.
- Physics (`experiment_core.js`) unchanged; controller options used are exactly
  the two declared factory knobs. The exact analyzed code is pinned by hash
  (§7); **any hash mismatch at launch fails the driver closed (exit 1) before
  any job runs**.
- Driver and worker SHA256 (full hex) are recorded in
  `STAGE_F_E4CAL_CAMPAIGN_META.json` at launch, before the first calibration
  job; the sources are the copies in this repository as pinned by this
  preregistration. Any code change between launch and analysis voids the run.
- The analysis (aggregation + selection rule) runs **twice from independently
  re-parsed data** inside the driver; any difference sets
  `deterministic_rerun: false` and is reported, never hidden.
- All outputs go to `research_data/validation/stage_f_cal/`; the Stage F E4 and
  original-campaign artifacts are not modified.
- No tuning of any parameter between data collection and analysis.

## 7. Frozen input hashes (SHA256, first 16 hex — verified at launch, fail-closed)

| File | SHA256 (16) | vs Stage F E4 pin |
|---|---|---|
| fly_brain_circuit.json | 0eb64ba451356563 | unchanged |
| controllers.js | 72ef49138c5a7b10 | **re-pinned** (E4 pin 401888258c485118) |
| experiment_core.js | 7fb11e3155214d50 | **re-pinned** (E4 pin f070e6ab750e2054) |
| p1_retinotopy.js | 31765c5a30bbe9e9 | unchanged |
| fly_brain_retinotopy.json | 164f7f37460fb526 | unchanged |

**Provenance (disclosed):** `controllers.js` and `experiment_core.js` are
re-pinned to the live worktree bytes at preregistration time (2026-09-22).
The E4-era pins match neither the current worktree nor the branch HEAD blobs:
the shared worktree carries a real, uncommitted collaborator workstream that
continued evolving these files after the E4 campaign froze its hashes (the E4
campaign itself ran on this same evolving worktree and pinned worktree bytes).
Before pinning, the live files were verified to still contain, unchanged: the
two factory options this study uses (`opticDrive`, `motorDrive`), the
door-policy threshold (`ratio > 0.0125`), the `runBenchmark` seed rule, and the
door-trial row schema. Any further change to a pinned file before launch voids
the study (hash gate, fail-closed).

Note: `controllers.js` continues to carry the uncommitted third-party opt-in
features (`pgKc`, `pgBaseline`) disclosed by the E4 prereg; they are not
enabled here (`policyGradient` is not passed). `stats_utils.js` is deliberately
NOT pinned here: this study defines no inferential test.

## 8. Implementation delta (disclosed, additive)

Two NEW files, used by no other experiment:

- `validation_worker_stagefcal.js` — calibration worker: E4 arm definition
  (4A config) with `opticDrive`/`motorDrive` taken from the job; `opticInput`
  hardcoded `"retinotopy"`; trial/episode defaults identical to the E4 worker
  (overridable only by the declared smoke mode).
- `calibration_campaign_stagef.js` — driver: hash gate, job builder, 12-way
  pool, merge, preregistered selection rule, meta + result JSON. `--smoke` mode
  (seed 999, non-registered, reduced windows, separate `_smoke/` output, never
  merged) and `--analyze-only` mode.

`validation_worker.js`, `controllers.js`, `experiment_core.js` untouched.

## 9. Outputs

- `research_data/validation/stage_f_cal/raw_e4cal.csv` (frozen after merge)
- `research_data/validation/stage_f_cal/STAGE_F_E4CAL_CAMPAIGN_META.json`
- `research_data/validation/stage_f_cal/STAGE_F_E4CAL_RESULT.json`
- Report: `STAGE_F_E4CAL_RESULTS.md` (written after execution)

## 10. Consequences

If CALIBRATED: the selected (opticDrive, motorDrive) pair becomes the pinned
operating point for a separately preregistered E4R2 4-arm comparison (original
seeds 1–12, original arms/endpoints family, only the two drive values
substituted). If BELOW_BAND or NO_CANDIDATE: the door-task endpoint remains
unavailable under retinotopy and endpoint-replacement studies must be separately
preregistered before any structure claim is made.
