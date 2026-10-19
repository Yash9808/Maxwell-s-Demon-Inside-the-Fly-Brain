# C-6 — E5 Formal Comparator (build-plan row 14)

Recorded: 2026-09-26, branch `deployment/phase-02`, git `6e63e02c` (dirty).
Status: **DONE — all controllers compared on IDENTICAL seeds and gas, with
per-seed paired uncertainty (permutation + Hedges g, Holm-corrected).**

## The E5 design property

One `runBenchmark` call **per seed carries ALL SEVEN controllers**, so every
controller faces the *same* `makeEnvironment` draw — same gas noise stream,
same jet sequence, same door band. Contrasts are therefore **per-seed
paired** (the strongest available design on this engine), not unpaired
across independent runs like the single-experiment validators. Paired
statistics: `stats_utils.permutationTestPaired` (10k, seeded) + paired
Hedges g + Holm correction within each metric family. TRAIN plasticity ON →
FROZEN TEST; 12 seeds × (30+10) trials × 12 s × 320 particles. Determinism
gate: **same-seed rerun IDENTICAL rows — passed.** No tuning, no discarding.

## Ranking (final TEST, mean ± 95% CI, n=12; identical gas per seed)

| Controller | good crossings | good:bad | openFraction |
|---|---|---|---|
| `ann` (E2) | **6.83 ± 2.76** | 0.79 ± 0.22 (n=9) | 0.746 ± 0.254 |
| `classical_demon` | 3.17 ± 0.79 | **1.70 ± 1.04** | 0.515 ± 0.060 |
| `random` | 2.92 ± 0.92 | 0.65 ± 0.27 | 0.406 ± 0.057 |
| `connectome_frozen`-like 4A | 2.58 ± 1.44 | 0.73 ± 0.64 | 0.361 ± 0.110 |
| `connectome_4B` | 2.17 ± 1.62 | 0.41 ± 0.20 (n=11) | 0.377 ± 0.121 |
| `drosophila` (E3) | **0.00 ± 0.00** | — | **0.000 ± 0.000** |
| `never_gate` | 0.00 ± 0.00 | — | 0.000 ± 0.000 |

## Paired contrasts (Holm-corrected within each metric)

Surviving correction (p_holm < 0.05):

| Contrast | Metric | mean diff | Hedges g | p | p_holm |
|---|---|---|---|---|---|
| drosophila − random | goodCrossings | −2.92 | −1.66 | 0.0012 | **0.011** |
| drosophila − classical | goodCrossings | −3.17 | −2.08 | 0.0004 | **0.004** |
| ann − drosophila | goodCrossings | +6.83 | +1.29 | 0.0041 | **0.033** |
| drosophila − random | openFraction | −0.41 | −3.73 | 0.0004 | **0.004** |
| drosophila − classical | openFraction | −0.52 | −4.48 | 0.0004 | **0.004** |
| ann − drosophila | openFraction | +0.75 | +1.53 | 0.0022 | **0.018** |

Nominally significant before correction (not claimed): ann − random
crossings +3.92 (p=0.017, g=0.81), ann − classical +3.67 (p=0.038),
4B − classical good:bad −1.09 (p=0.014).

## Verdicts (honest)

1. **Row-14 DONE**: same environments, same seeds, complete dataset,
   paired uncertainty — the comparator exists as data, not prose.
2. **ANN is the volume leader**: on identical gas it passes the most good
   crossings (6.83 vs classical 3.17) by opening widest — but its
   selectivity (good:bad 0.79) does NOT beat classical (1.70); the
   pre-correction edge is not a selectivity win.
3. **Classical remains the selectivity benchmark**: good:bad 1.70, the
   highest of any controller (consistent with C-4/C-5 unpaired findings,
   now confirmed paired).
4. **E3's collapse is confirmed under pairing**: drosophila sits at the
   never-gate floor and is the ONLY controller significantly *below*
   random after Holm correction — the C-4 finding replicated on identical
   environments with the strongest design.
5. **The connectome arms are statistically indistinguishable from the
   floor and from each other** on volume (4A−random d=−0.33, p=0.71) and
   do not survive any correction — consistent with C-5.

## Artifacts

- `research_data/e5_comparator_2026-09-26T14-06-10.jsonl` (3360 rows) +
  `_summary.json` (paired design provenance, finals, 27 registered
  contrasts with Holm-corrected p)
- `research_data/e5_dataset_2026-09-26T14-25-14.csv` + `.manifest.json`
  (C-3 schema v1, 3360 rows, sha256 `6b6192ba…`, **verify clean**)
- `research_data/e5_comparator_report_2026-09-26T14-25-14.html`

## Tests

`tests/e5_comparator.test.js` **5/5** (selftest incl. canonical sign-flip
convention; pins for the one-env-draw paired design + canonical paired
stats + C-3 export; trialStats hand-check — which caught and fixed a
real offset bug in the first draft; determinism; live pairing property +
export). Combined C-3→C-6 suites: **30/30**.
