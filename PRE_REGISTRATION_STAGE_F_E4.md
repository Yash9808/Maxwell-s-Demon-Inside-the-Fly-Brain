# Preregistration — Stage F E4 Family at the Retinotopic Sparse-Drive Operating Point

**Status: PROSPECTIVE.** This document was written and pinned (SHA256 recorded in
`PRE_REGISTRATION_STAGE_F_E4.json`, `code_frozen_sha256` over inputs) **before
running any arm on any preregistered seed**. It defines the study in
`PRE_REGISTRATION_STAGE_F_E4.json`; the JSON is machine-checkable and the two
must agree. Where the two disagree, the JSON governs.

## 1. Question and motivation

The preregistered original E4 hypothesis — "connectome structure contributes
measurable performance" — was tested at the legacy 8-bin visual operating point
and failed (contrast −0.011, p_bh 0.928, Hedges' g −0.114; verbatim failure
sentence already reported). Stage F (P1_STAGE_F_RETINOTOPY_REPORT.md) replaced
the optic input with the source-derived retinotopic hex-column field and
**measured an operating-point shift**: the legacy optic layer sat at spike
threshold (saturated bins ≈ 1), while the retinotopic field spreads the same
total intensity over ~256 occupied columns at max ≈ 0.06, requiring a declared
relative-contrast coding convention. The Stage F report predicted the sparse-
drive regime is where per-column routing — and hence connectome structure —
can matter. **This study tests that prediction.** No result of any arm in this
study existed when this document was written.

## 2. Design

- **Arms** (identical to original E4; only the optic input mode changes):
  - `connectome_4A` — full connectome, plasticity full, opticDrive 0.25, opticInput retinotopy.
  - `connectome_4B` — restricted plasticity (sensory-pathway edges only), same drive, retinotopy.
  - `connectome_4C` — degree-preserving shuffled connectome (shuffle seed 1000+k·17), plasticity full, same drive, retinotopy.
  - `connectome_frozen` — full connectome, plasticity none, same drive, retinotopy.
- **Seeds** (identical to original E4): 12 seeds k = 1..12, physics seed = 1+(k−1)·101.
  4C: 10 independent shuffle draws (shuffle seeds 1000, 1017, …, 1153) × the same 12 physics
  seeds; 4C condition-level inference uses shuffle-draw means (n = 10).
- **Replicate unit**: seed (4A/4B/frozen); (shuffle-draw, seed) cell for 4C.
- **Windows**: trials [0,120) train; 24 test trials, learning off; 12 s episodes; 320 particles.
- **Environment/config parity**: identical to the original campaign
  (CFG noise 0.12, doorHeight 64; worker trial/episode structure bit-for-bit).
- **Implementation delta** (disclosed, minimal, logged in
  `research_data/validation/STAGE_F_CAMPAIGN_META.json`): `validation_worker.js`
  accepts an optional `opticInput` job field passed through to all E4 arm
  definitions. Physics (`experiment_core.js`), NT semantics, plasticity, reward
  channel, seeds, and trial structure untouched. Controller defaults on this
  branch use `opticInput: "legacy8bin"`; the arms above pass `"retinotopy"`
  explicitly.

## 3. Endpoints and decision rules (fixed before data)

- **Primary**: test-phase `goodBadRatio`, 4A vs shuffle-mean 4C, unpaired
  permutation test (seeded, 10,000 draws, PRNG 20260920), two-sided.
  **Success**: contrast > 0 AND BH-adjusted p < 0.05 AND Hedges' g ≥ 0.5.
  **Failure** (reported verbatim if met): contrast ≤ 0 or adjusted p ≥ 0.05 →
  "connectome structure contributes no measurable performance at the
  retinotopic sparse-drive operating point."
- **Secondaries** (BH within the full primary+secondary family, exactly as the
  original prereg): 4A vs 4B (plasticity scope); 4A vs frozen (learning);
  4A paired learning gain (late − early train, Hedges' g paired);
  test dTfinal and sortEntropy, 4A vs 4C; test miNeural, 4A vs 4C.
- **Statistics**: `stats_utils.js` verbatim (same PERM_SEED, Hedges' g, BH/Holm).
  Holm across the 5 flagship primaries of E3/E4/E9/E10/E11 is NOT recomputed
  here (other experiments are not being re-run); family-internal BH is.

## 4. Integrity rules

- All seeds run; no outcome exclusion; no seed selection; no re-rolls.
- Physics unchanged (physicsUnchanged check re-verified by hash of
  `experiment_core.js` recorded in the JSON).
- All outcome CSVs are written to `research_data/validation/stage_f/`; the
  original campaign outputs are not modified.
- Analysis code records every input hash; any post-freeze code change that
  would affect results voids the run.
- No tuning of any parameter between data collection and analysis.

## 5. Declared prior observations (not outcomes of this study)

- Stage F functional probes: optic-layer rate 2.35 at E4 drive under relative-
  contrast retinotopy (legacy-path probe 0 at threshold); focal 2-column
  stimulus drives only those columns; zero field silent.
- Stage F quick benchmark (1 seed, high-drive demo operating point):
  connectome arms good:bad 0.00 both (was 0.95/0.53), demonAgree 0.536→0.559 /
  0.489→0.558. This is an outcome of the Stage F *wiring check*, not of this
  study's arms/seeds, and sets no expectation threshold here.
- Original-E4 outcome at the legacy operating point: contrast −0.011,
  p_bh 0.928, g −0.114.

## 6. Frozen input hashes (SHA256, first 16 hex)

| File | SHA256 (16) |
|---|---|
| fly_brain_circuit.json | 0eb64ba451356563 |
| controllers.js | 401888258c485118 |
| experiment_core.js | f070e6ab750e2054 |
| p1_retinotopy.js | 31765c5a30bbe9e9 |
| fly_brain_retinotopy.json | 164f7f37460fb526 |
| stats_utils.js | 0526fcd6d2de306d |

Note: `controllers.js` carries uncommitted third-party modifications on this
branch (opt-in `pgKc`/`pgBaseline` policy-gradient features). Those features are
not enabled by any arm in this study; the file hash is recorded as-is so the
exact analyzed code is pinned. If any hash above changes after pinning, the
study must be re-declared.
