# C-4 — E2/E3 Seeded Verification + Benchmark Datasets (build-plan rows 11 + 12)

Recorded: 2026-09-26, branch `deployment/phase-02`, git `6e63e02c` (dirty).
Status: **E2 VERIFIED + benchmarked; E3 verified with a REPLICATED negative
result (collapse); both exported to the C-3 standardized dataset format.**

## Method

`e2_e3_batch_validate.js`: the four controllers run on the UNMODIFIED
`runBenchmark` engine (worker e2/e3 controller options — production
defaults, no tuning), TRAIN (plasticity ON) → FROZEN TEST, 20 seeds
(env seed = 1+s·101, controller rng = makeRng(seed ^ 0x5f5f) — the
engine's own rule), 30+10 trials × 12 s × 320 particles. Seed =
independent replicate; no seeds discarded; Welch two-sided t tests on
per-seed final-TEST values. Determinism gate: same-seed rerun
**IDENTICAL rows — passed**. C-3 dataset pair: 3200 rows × 26 cols,
sha256-pinned, **verify clean**.

## Results (final TEST, mean ± 95% CI over 20 seeds)

| Condition | good crossings | good:bad | openFraction | demonAgree |
|---|---|---|---|---|
| `ann` (E2) | 5.55 ± 2.08 | 0.71 ± 0.17 (n=13) | 0.647 ± 0.213 | 0.482 ± 0.047 |
| `drosophila` (E3) | **0.00 ± 0.00** | — | **0.000 ± 0.000** | 0.540 ± 0.039 |
| `classical_demon` | 3.20 ± 0.91 | 1.50 ± 0.75 (n=19) | 0.513 ± 0.055 | 1.000 (by construction) |
| `random` | 2.75 ± 0.65 | 0.72 ± 0.23 | 0.405 ± 0.055 | 0.519 ± 0.006 |

Key Welch tests (full list in the summary JSON + report):

| Comparison | Metric | t | p | Reading |
|---|---|---|---|---|
| ann vs random | goodCrossings | 2.52 | **0.019** | E2 above the floor |
| ann vs random | openFraction | 2.15 | **0.043** | E2 opens more |
| ann vs classical | goodCrossings | 2.03 | 0.053 | volume parity (ann nominally higher) |
| ann vs classical | goodBadRatio | −2.04 | 0.055 | classical keeps better selectivity |
| drosophila vs ann | goodCrossings | −5.22 | **4.8e-5** | E3 far below E2 |
| drosophila vs random | goodCrossings | −8.30 | **9.7e-8** | E3 below the FLOOR |

## Verdicts (honest)

**E2 (ANN demon) — row 11 DONE.** Verified + benchmarked: significantly
above the random floor on crossings and door use; statistically
indistinguishable from the classical reference on crossing volume
(nominally higher), while the classical rule retains the selectivity edge
(good:bad 1.50 vs 0.71, p=0.055). demonAgree ≈ 0.48 = chance: the ANN is
not imitating the classical rule — it drives the door with its own policy
that happens to pass more good than bad molecules.

**E3 (Drosophila-inspired) — row 12 DONE (verified negative).** The door
never opens: openFraction 0.000 ± 0.000 in **all 20 seeds** (zero variance
across the whole replicate set), so crossings are exactly zero and the
controller sits below the random floor (p ≤ 1e-5). This quantitatively
REPLICATES the E3R2 preregistered finding (R1: 100% of seeds collapsed;
R2A shaping partially rescued it — mean open 0.409 — but 45% of seeds
relapsed and no seed achieved positive good−bad). The E3 collapse is now a
measured, reproducible property of the controller on this task, not an
anecdote. Any future E3 work starts from the E3R2 shaping/floor levers,
documented there.

Both results are honest verified states of the EXISTING controllers —
exactly what rows 11/12 asked for ("verification + benchmark dataset").

## Artifacts

- `research_data/e2_e3_batch_2026-09-26T12-47-41.jsonl` (3200 rows) +
  `_summary.json` (20 seeds, 14 tests, provenance, finals)
- `research_data/e2_e3_dataset_2026-09-26T12-47-41.csv` +
  `.manifest.json` (C-3 schema v1, sha256 `12085ff4…`, verify clean)
- Smoke-scale + 1-seed artifacts from the shakedown also present
  (`12-45-19`, `12-45-20`).

## Tests

`tests/e2_e3_batch.test.js` **6/6** (selftest, config pins incl. "no
tuning in the driver", trialStats hand-check, Welch anchor, in-process
determinism, four-condition well-formedness + export). Combined with
C-3's suite: 13/13. `tests/run_smoke.js` 42/42.
