# Stage F E4 Results — Preregistered Retinotopy Operating-Point Study

**Status: EXECUTED AND REPORTED — no data exclusion, no post-hoc criterion change.**
Preregistration: `PRE_REGISTRATION_STAGE_F_E4.json` (pinned before any registered-seed run;
machine-checkable copy of the design). Campaign: `research_data/validation/stage_f/`.

## 1. Execution summary

| Item | Value |
|---|---|
| Jobs | **76/76 OK, 0 failures** (36 single-seed + 40 shuffle-chunk), 12-way parallel |
| Wall time | 61.0 min (`campaign_log.txt`, `STAGE_F_CAMPAIGN_META.json`) |
| Raw rows | **22,464 — exactly the preregistered design** (3 arms × 12 seeds × 144 + 10 draws × 12 seeds × 144); coverage check found zero incomplete cells |
| Optic input | `opticInput: "retinotopy"` on every arm (declared implementation delta; default behavior verified bit-identical by SHA256 gate before launch) |
| Analysis | `stagef_analyze.js`, statistics exclusively from `stats_utils.js` (PERM_SEED 20260920, Hedges g, BH); whole analysis executed twice from re-parsed data: **deterministic_rerun = true** |
| Timing | Prereg MD+JSON written and hashed before the first registered-seed run; only non-registered seed 999 was touched pre-prereg (timing calibration, outcome values never inspected) |

## 2. Preregistered results (test-phase endpoints, per-seed / per-draw aggregation)

| Test | Contrast | p_raw | p_bh | Hedges g |
|---|---|---|---|---|
| **primary: 4A vs 4C shuffle-mean (goodBadRatio)** | **0.0000** | 1.0000 | 1.0000 | 0.000 |
| 4A vs 4B (plasticity scope) | 0.0000 | 1.0000 | 1.0000 | 0.000 |
| 4A vs frozen (learning) | 0.0000 | 1.0000 | 1.0000 | 0.000 |
| 4A vs 4C dTfinal | −0.0005 | 0.2121 | 1.0000 | −0.550 |
| 4A vs 4C sortEntropy | −0.0005 | 0.6762 | 1.0000 | −0.180 |
| 4A vs 4C miNeural | 0.0000 | 0.8981 | 1.0000 | 0.060 |
| 4A learning gain (paired, midpoint split) | 0.0000 | 1.0000 | 1.0000 | NaN |

## 3. Preregistered decision — applied exactly as written

Primary criterion: contrast > 0 AND p_bh < 0.05 AND g ≥ 0.5 → not met (contrast = 0 ≤ 0).

> **FAILURE — verbatim: "connectome structure contributes no measurable performance at the retinotopic sparse-drive operating point."**

This sentence is reported verbatim as required. **However, the raw data show the
comparison is worse than null — it is degenerate.** Reporting that without
overriding the preregistered verdict is the honest position; §4 is the real
scientific finding of this study.

## 4. Primary finding: the preregistered endpoint is DEGENERATE at this operating point

Descriptive characterization (no inferential statistic; written to
`STAGE_F_E4_DEGENERACY_SUPPLEMENT.json`, full per-arm numbers):

| Metric (test phase) | Stage F (retinotopy) | Original campaign (legacy 8-bin), identical opticDrive 0.25 |
|---|---|---|
| Door-open fraction of steps | **0.0006** | 0.334 |
| Trials with door ever open | 10.4% | 98.6% |
| Crossings per trial | **0.000** | 5.94 |
| Trials with ≥1 crossing | **0.0%** | 93.4% |

Mechanism chain, each step measured: (1) at opticDrive 0.25 the retinotopic
relative-contrast field leaves the optic layer firing at ~2.35 Hz, but the
connectome motor readout converts this into door-open decisions at ~0.06% of
steps (motorDrive baseline 0.35 was never re-tuned for the new input regime);
(2) a door open 0.06% of the time lets essentially no particles cross;
(3) goodBadRatio is therefore identically 0 in every arm — **zero variance** —
so the permutation test is trivially p = 1 and Hedges g undefined/0; the
endpoint cannot distinguish *any* pair of arms regardless of connectome
structure. The statistic is uninformative about the hypothesis, not evidence
for or against it.

Two corroborating mechanistic observations:

- **4A ≡ 4B ≡ frozen, trajectory-identical** (identical demonAgree 0.5369,
  train dTfinal +0.0289, all-zero crossings). With no sorting and no reward
  events, P0's reward-gated plasticity produces zero weight change — exactly
  the designed behavior: no teaching signal, no ΔW. The arm collapse is
  therefore *consistent with* the P0 plasticity repair working correctly; the
  legacy campaign showed arm separation only when reward events existed.
- **4C differs faintly** (openFraction 0.0004–0.0007, 3 crossing events in
  22,464 rows' worth of trials): the degree-preserving shuffle changes
  spontaneous dynamics slightly, but with the endpoint saturated at zero this
  cannot be interpreted.

## 5. What IS and IS NOT concluded

- **Concluded (preregistered):** the primary criterion was not met; the verbatim
  failure sentence above stands.
- **Concluded (measured):** at opticDrive 0.25 with motorDrive 0.35, the
  retinotopic input regime does not drive enough door-opening for the door-task
  endpoint to function. The Stage F quick-benchmark outcome (good:bad 0.00 both
  connectome arms) is now explained: it was not a learning failure, it was the
  same openFraction collapse at a different operating point.
- **NOT concluded:** anything about whether connectome structure helps or hurts
  under retinotopic input — the study was blinded to that question by the
  degenerate endpoint.

## 6. Honest caveats

1. The prereg fixed arms/seeds/endpoints but inherited the original opticDrive
   0.25 operating point without checking task viability under the new input
   mode. The Stage F report had declared the operating-point shift but this
   study did not preregister an input-calibration stage. That is a design
   limitation of the prereg, disclosed here rather than papered over.
2. The midpoint learning-gain split was unpinned in the prereg; the convention
   (early [0,60) vs late [60,120)) was fixed at analysis-script writing time,
   before execution. It is moot — the gain is identically 0.
3. The relative-contrast transduction convention (Stage F, MODEL-ASSUMED)
   shapes the input magnitude; a differently normalized convention would land
   elsewhere on the drive axis. No convention change was made post hoc.
4. `controllers.js` carries uncommitted third-party opt-in features (`pgKc`,
   `pgBaseline`); they are not enabled by any arm, and the exact file is
   SHA-pinned in the prereg JSON.
5. No exploratory p-values are reported beyond the preregistered family;
   the supplementary descriptives use no inferential tests.

## 7. Consequences and recommended next step (not executed here)

The empirical implication is narrow and concrete: retinotopy needs an
**input-calibration stage before it can host E4-family comparisons** — e.g. a
small preregistered sweep of the optic→motor drive mapping that restores the
door to an open fraction in the legacy ballpark (0.2–0.4) *without* touching
physics, seeds, or reward coefficients, followed by re-registration of the
4-arm comparison at the calibrated point. Alternatively, endpoints that do not
require door-open behavior (e.g. optic-layer spatial encoding) can be studied
at the current operating point. This study itself performs no calibration and
makes no recommendation about which choice is scientifically preferable.

## 8. Artifact list

- `PRE_REGISTRATION_STAGE_F_E4.md` / `.json` — preregistration (pinned pre-data)
- `validation_campaign_stagef.js` — driver; `validation_worker.js` — declared opticInput passthrough
- `research_data/validation/stage_f/campaign_log.txt`, `STAGE_F_CAMPAIGN_META.json`
- `research_data/validation/stage_f/raw_e4_stagef.csv` (22,464 rows, frozen)
- `stagef_analyze.js` → `research_data/validation/stage_f/STAGE_F_E4_ANALYSIS.json`
- `research_data/validation/stage_f/STAGE_F_E4_DEGENERACY_SUPPLEMENT.json`
- Original-campaign artifacts untouched (`research_data/validation/raw_e4.csv` et al.)

**STAGE F E4 STUDY COMPLETE — DECISION: FAILURE (preregistered verbatim), with endpoint degeneracy documented as the primary empirical finding (§4).**
