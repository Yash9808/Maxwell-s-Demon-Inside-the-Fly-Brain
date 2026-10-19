# Stage F E4-CAL Results — Preregistered Retinotopy Input-Calibration Sweep

**Status: EXECUTED — DECISION: CALIBRATED.** No data exclusion, no seed selection
beyond the preregistered rule, no post-hoc criterion change.
Preregistration: `PRE_REGISTRATION_STAGE_F_E4CAL.json` (pinned before any
calibration-seed run; the only pre-launch execution was the declared smoke check
on non-registered seed 999 with reduced windows, whose outcome values were never
inspected). Campaign: `research_data/validation/stage_f_cal/`.

## 1. Execution summary

| Item | Value |
|---|---|
| Jobs | **28/28 OK, 0 failures** (7 cells × 4 calibration seeds 13–16), 12-way parallel |
| Wall time | 3 × 10-min execution windows (8 → 20 → 28 jobs; resumable driver) — 498 s of active runtime, per `STAGE_F_E4CAL_CAMPAIGN_META.json` |
| Raw rows | **4,032 — exactly the preregistered design** (7 × 4 × 144); coverage check found zero incomplete cells |
| Arm | connectome_4A configuration only (plasticity full, opticInput retinotopy); no structure comparison run here |
| Integrity | Hash gate verified all 5 pinned inputs before every launch window; analysis ran twice from re-parsed data — **deterministic_rerun = true**; driver+worker SHA256 recorded in meta and result JSON |
| Pre-launch validation | `--smoke` mode (seed 999, non-registered): 7/7 jobs OK, 42 rows, outcome values not inspected |

## 2. Preregistered results (test phase, per-cell score = mean openFraction over seeds 13–16)

| Cell (od / md) | Score | Crossing gate | Viable |
|---|---|---|---|
| od 0.5, md 0.35 | 0.006 | 0.031 | no |
| od 1.0, md 0.35 | 0.177 | 0.802 | no (below band) |
| **od 2.0, md 0.35** | **0.380** | 0.979 | **yes** |
| od 4.0, md 0.35 | 0.420 | 0.979 | no (above band) |
| od 2.0, md 0.10 | 0.189 | 0.792 | no (below band) |
| **od 2.0, md 0.20** | **0.289** | 0.958 | **yes** |
| od 0.25, md 0.35 (anchor) | 0.0007 | 0.000 | no |

**Preregistered selection rule, applied verbatim:** viable = score ∈ [0.20, 0.40]
AND crossing gate ≥ 0.50; selected = viable cell closest to legacy 0.334.
**Selected: `cal_od2p0_md0p20` — opticDrive 2.0, motorDrive 0.20, score 0.289.**

## 3. The three preregistered readings

1. **The degenerate operating point is restored to function with two pre-existing
   factory options and zero code change.** The transition is sharp on the optic
   axis: 0.006 → 0.177 → 0.380 → 0.420 as opticDrive goes 0.5 → 1 → 2 → 4. The
   retinotopic operating-point shift is a **drive offset, not a dead interface**:
   opticDrive ≈ 2.0 restores the legacy-matched total-kick regime (~8,400
   kicks/tick) exactly as the preregistration's bracket predicted, and the
   anchor cell reproduces the E4 degeneracy on held-out seeds (0.0007 vs the
   E4 campaign's 0.0006) — the sanity control held.
2. **The preregistered motor-axis mechanism (tone dilution) was wrong in sign.**
   The prereg (§2) predicted lower uniform motor tone would *raise* the pool-vs-
   layer ratio; the data show the opposite monotone direction — at od 2.0,
   score fell 0.380 → 0.289 → 0.189 as motorDrive fell 0.35 → 0.20 → 0.10.
   Under retinotopy, the motor pool needs *more* baseline tone, not less, to
   open the door at a matched optic drive. This is a **measurement-level FACT
   with an INFERENCE-level interpretation**, and it is honest to say the
   mechanism remains unexplained: the uniform tone may add to routed optic
   drive non-linearly (supra-linear recruitment of the ratio readout), but no
   ablation here isolates the pathway. No post-hoc mechanism claim is made.
3. **The optic axis dominates; the motor axis tunes within a working regime.**
   od 1.0 → 2.0 moved the score ~2.2× at fixed md 0.35; md 0.20 → 0.35 at od 2.0
   moved it 1.3×. The two knobs are not symmetric levers.

## 4. Selection margin (honest disclosure)

The rule's tie-break was **not** needed, but the margin between the two viable
cells was **0.001** in distance-to-legacy (|0.289−0.334| = 0.045 vs
|0.380−0.334| = 0.046). Had the seed sample shifted one cell's score by ~0.001,
the other cell (od 2.0, md 0.35) would have been selected instead. Both are
inside the band and both pass the crossing gate, so either satisfies the
preregistered viability definition; but the report must say plainly: **the
selected point is one hair's breadth from the runner-up, and the confirmatory
E4R2 inherits that knife-edge.** Any robustness check on this choice (e.g. a
two-cell head-to-head at the confirmatory seeds) belongs in the E4R2
preregistration, written before its data — not here.

## 5. What IS and IS NOT concluded

- **Concluded (preregistered):** the grid contains viable cells; the rule
  selected (opticDrive 2.0, motorDrive 0.20) as the calibration point; the door
  task is functional again under retinotopy at that point.
- **Concluded (measured):** optic axis transition is sharp and bracketing as
  predicted; motor-axis direction contradicts the preregistered mechanism
  sketch; anchor reproduced the degeneracy.
- **NOT concluded:** anything about connectome structure (no shuffled/frozen arm
  was run — that is E4R2's question at this operating point); any mechanism for
  the motor-tone direction; whether the selected point generalizes to seeds
  1–12 (the confirmatory seeds are different seeds — that is the point).

## 6. Honest caveats

1. **Re-pinned inputs.** `controllers.js` (72ef49138c5a7b10) and
   `experiment_core.js` (7fb11e3155214d50) are pinned to the live worktree
   bytes, which differ from the Stage F E4 pins (401888258c485118 /
   f070e6ab750e2054): the shared worktree carries an uncommitted collaborator
   workstream that kept evolving these files after the E4 campaign froze its
   hashes (the E4 campaign itself ran on this same evolving worktree). The
   used surface (opticDrive/motorDrive options, ratio > 0.0125 door rule,
   seed rule, row schema) was verified unchanged before pinning; the hash gate
   was fail-closed at every window.
2. **The motor-axis prediction failed in sign** (see §3.2). The prereg's
   mechanism paragraph is now a documented miss; the selection rule never
   depended on it, so the verdict is unaffected — but it is recorded here as a
   preregistered prediction that did not survive contact with the data.
3. **The 0.001 selection margin** (§4) makes the selected point fragile to seed
   noise; disclosed rather than hidden.
4. `stats_utils.js` was deliberately not pinned and no inferential test was
   computed — this study is measurement + selection only. All p-value-free.
5. The smoke mode validated the pipeline on seed 999 before launch; its outcome
   values were never inspected, preserving prospectivity of seeds 13–16.

## 7. Consequence — the pinned confirmatory operating point

The confirmatory 4-arm comparison (E4R2) is now calibrated and may be
preregistered at **opticDrive 2.0, motorDrive 0.20, opticInput retinotopy** —
original arms (4A/4B/4C/frozen), original seeds k = 1..12, original endpoint
family and decision rules, with only the two drive values substituted. Per the
E4-CAL prereg §10: if E4R2 succeeds, connectome structure contributes
measurable performance at a *viable* retinotopic operating point; if it fails,
the failure sentence is earned rather than degenerate. E4R2 has **not** been
preregistered or run here.

## 8. Artifact list

- `PRE_REGISTRATION_STAGE_F_E4CAL.md` / `.json` — preregistration (pinned pre-data)
- `validation_worker_stagefcal.js`, `calibration_campaign_stagef.js` — additive driver + worker (SHA256 in meta/result)
- `research_data/validation/stage_f_cal/raw_e4cal.csv` (4,032 rows, frozen)
- `research_data/validation/stage_f_cal/STAGE_F_E4CAL_CAMPAIGN_META.json`, `STAGE_F_E4CAL_RESULT.json`
- Smoke artifacts: `research_data/validation/stage_f_cal/_smoke/` (never merged)

**STAGE F E4-CAL COMPLETE — DECISION: CALIBRATED at opticDrive 2.0, motorDrive 0.20; door task functional under retinotopy; confirmatory E4R2 may now be preregistered at this point.**
