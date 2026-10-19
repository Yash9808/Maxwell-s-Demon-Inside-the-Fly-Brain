# C-5 — E4A/B/C Statistical Expansion with Uncertainty (build-plan row 13)

Recorded: 2026-09-26, branch `deployment/phase-02`, git `6e63e02c` (dirty).
Status: **DONE — full/restricted/shuffled/frozen compared across 12 seeds
with CIs, Welch + permutation tests, a frozen exposure control, and a C-3
dataset.**

## Method

`e4_batch_validate.js`: six arms on the UNMODIFIED `runBenchmark` engine —
`connectome_4A` (full plasticity), `connectome_4B` (restricted),
`connectome_4C` (degree-preserving shuffled wiring, seed 7),
`connectome_frozen` (4A brain, `setLearning(true)` REFUSED — the C-1
wrapper pattern, drift pinned at exactly 0), `classical_demon` (reference),
`random` (floor). Controller options are WORKER-EXACT (pinned by test):
`opticDrive 0.25`, legacy8bin, shuffle only for 4C. Operating point is the
original campaign's non-degenerate regime — the Stage F retinotopy point is
documented-degenerate (`STAGE_F_E4_RESULTS.md` §4) and deliberately not
used. 12 seeds × (30 train + 10 frozen test) trials × 12 s × 320 particles.
Seed = independent replicate; no seeds discarded; per-trial telemetry
(weight drift, DA peak, spikes) via the read-only wrapper. Determinism
gate: **same-seed rerun IDENTICAL rows — passed.** 29 tests recorded
(Welch + one 10k permutation on the preregistered-style primary contrast).

## Results (final TEST, mean ± 95% CI over 12 seeds)

| Arm | good crossings | good:bad | openFraction | test weightDrift |
|---|---|---|---|---|
| `connectome_4A` | 2.58 ± 1.44 | 0.73 ± 0.64 | 0.361 ± 0.110 | 2.38e+3 ± 0.09e+3 |
| `connectome_4B` | 2.17 ± 1.62 | 0.41 ± 0.20 | 0.377 ± 0.121 | 1.71e+3 ± 0.09e+3 |
| `connectome_4C` | 2.17 ± 1.05 | 0.52 ± 0.17 | 0.389 ± 0.121 | 5.71e+2 ± 0.48e+2 |
| `connectome_frozen` | 2.83 ± 1.36 | 0.85 ± 0.39 | 0.332 ± 0.106 | **0 (exact)** |
| `classical_demon` | ~3.2 | 1.50 (C-4, n=20) | 0.513 (C-4) | — |
| `random` | 2.75 (C-4, n=20) | 0.72 (C-4) | 0.405 (C-4) | — |

Primary contrasts (Welch, final TEST): **4A vs 4B p=0.71, 4A vs 4C
p=0.65 (crossings) / 0.54 (ratio), 4A vs frozen p=0.81, 4B vs 4C p=1.00;
permutation (4A vs 4C, 10k draws) p=0.71.** No connectome-structure
contrast approaches significance on any behavioral metric.

## Verdict (honest)

1. **Row-13 DONE criterion met**: full/restricted/shuffled compared with
   uncertainty (CIs + tests + frozen control + determinism gate).
2. **The structure contrast is NULL at this operating point**: the shuffled
   arm (4C) is statistically indistinguishable from full (4A) and restricted
   (4B) on every final-TEST metric, and all three sit inside the frozen
   control's band. With n=12 the CIs are wide (±1.0–1.6 crossings), so
   small effects cannot be excluded — but there is no signal that
   connectivity structure, as instantiated by these three arms, changes
   sorting behavior here. This refines the original campaign's
   "arm separation": what separates arms is *exposure regime* (the Stage F
   degeneracy, `STAGE_F_E4_RESULTS.md`), not wiring structure.
3. **Plasticity signatures are arm-distinct even where behavior is not**:
   test-phase weight drift 2.38e+3 (4A) vs 1.71e+3 (4B) vs 5.71e+2 (4C)
   vs exactly 0 (frozen); train→test good-crossing deltas +1.17 (4A),
   −1.75 (4B), +0.17 (4C), +0.83 (frozen). Weight movement does not
   translate into behavioral separation under sparse crossing reward —
   consistent with the C-1/C-2 findings at 12–30 training episodes.
4. The behavioral anchor stands: classical ≈ 1.50 good:bad beats every
   connectome arm; connectome arms ≈ random on volume.

## Artifacts

- `research_data/e4_batch_2026-09-26T13-08-27.jsonl` (2880 rows) +
  `_summary.json` (12 seeds, 29 tests, provenance with operating-point note)
- `research_data/e4_dataset_2026-09-26T13-44-15.csv` + `.manifest.json`
  (C-3 schema v1, 2880 × 35 cols, **verify clean**)
- `research_data/e4_batch_report_2026-09-26T13-44-15.html`

## Tests

`tests/e4_batch.test.js` **5/5** (selftest incl. frozen gate; pins for
worker-exact options + no local stats + C-3 export; trialStats hand-check;
Welch anchor; real-run discipline: 4A drifts, frozen exactly 0, arms
produce distinct rows, export verifies).
