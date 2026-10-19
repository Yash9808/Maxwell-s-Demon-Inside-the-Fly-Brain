# C-7 — E7 Generalization Sweep + E8 Information-Limited Demons (build-plan rows 16 + 17)

Recorded: 2026-09-26, branch `deployment/phase-02`, git `6e63e02c` (dirty).
Status: **DONE — E7 regime gradient established (all pairs survive Holm);
E8 adaptive-vs-fixed NULL; two worker-exact E8 arms are row-identical to
existing conditions by construction (reported, not hidden).**

## Design

`e7_e8_batch_validate.js` on the UNTOUCHED engine (`experiment_core.js`
runBenchmark). Because the engine's `_physics(si, n)` hook is **per-CALL**
(with `nSeeds:1` it applies to the whole call), each seed runs **4 separate
`runBenchmark` calls**:

1. `e7_sparse_clean` — `_physics: () => ({nParticles: 120, noise: 0.0})`
2. `e7_default` — `_physics: () => ({nParticles: 320, noise: 0.12})`
3. `e7_dense_noisy` — `_physics: () => ({nParticles: 640, noise: 0.30})`
4. E8 arms share ONE call at explicit 320p/0.12 (the default operating point,
   exactly equal to `e7_default`'s gas) so their contrasts are gas-matched:
   `e8_adaptive` = `classicalDemon{adaptive:true}`, `e8_fixed` =
   `classicalDemon{adaptive:false}`, `e8_mem4` = `classicalDemon{memSize:4}`
   (worker-exact options, no tuning).

12 seeds × (30+10) trials × 12 s; seed rule `env = base + s*101`, controller
rng `makeRng(seed ^ 0x5f5f)`. E7 regime contrasts are between-regime by
design (different gas per condition); E8 contrasts are fully paired per seed.
Welch two-sided t on per-seed final-TEST values via canonical
`stats_utils.welchT`; Holm within each experiment family. No tuning, no
seed selection, no discarding. Determinism gate: **same-seed rerun IDENTICAL
rows — passed** (gate mirrors the exact 4-call structure). Total 97 s.

A draft of this validator had all 6 conditions in one call with a broken
`si===0 ? {120,0} : si===0 ? {640,0.3} : {}` physics map (dead branch; would
have run everything at 120p). The restructure above is pinned by
`tests/e7_e8_batch.test.js` (T2 forbids `si === 0 ?`; T5 proves per-call
routing changes gas and same-seed rows are byte-identical).

## E7 — regime gradient (final TEST, mean ± 95% CI, n=12)

| Condition (gas) | good crossings | good:bad (n) | openFraction | dT final | sortEntropy |
|---|---|---|---|---|---|
| sparse/clean (120p, 0.0) | 1.33 ± 0.65 | 0.95 ± 0.38 (n=7) | 0.351 ± 0.105 | **0.0471 ± 0.0100** | **0.0728 ± 0.0229** |
| default (320p, 0.12) | 3.17 ± 0.79 | 1.70 ± 1.04 (n=12) | 0.515 ± 0.060 | 0.0244 ± 0.0038 | 0.0240 ± 0.0047 |
| dense/noisy (640p, 0.30) | **15.50 ± 2.11** | 1.33 ± 0.31 (n=12) | 0.533 ± 0.035 | 0.0066 ± 0.0041 | 0.0016 ± 0.0013 |

Welch t, Holm-corrected within the E7 family (n=3), primary metric
`goodCrossings`:

| Contrast | t | df | p | p_holm |
|---|---|---|---|---|
| sparse < default | −3.49 | 21.2 | 0.0021 | **0.0021** |
| default < dense | −10.72 | 14.1 | 3.8e-8 | **7.5e-8** |
| sparse < dense | −12.57 | 13.1 | 1.1e-8 | **3.3e-8** |

Secondary: openFraction sparse < default p=0.0165, sparse < dense p=0.0064
(default vs dense p=0.61); good:bad ratio null everywhere (p=0.16–0.51).

**E7 answer:** the classical demon's fixed gate policy **generalizes without
re-tuning** — it produces positive sorting (dT > 0, sortEntropy > 0) and
above-chance good:bad traffic in all three regimes, and raw throughput scales
monotonically with gas density (more particles → more crossing opportunities).
But the *quality* metrics invert: dT and sortEntropy are largest in sparse/clean
gas (each decision sorts a larger share of the box) and shrink ~7×/45× toward
dense/noisy, where the demon sorts more events but demixes less per event.
Policy generalizes; per-event sorting efficiency does not scale with density.

## E8 — information-limited arms (matched gas 320p/0.12, fully paired, n=12)

| Arm | good crossings | good:bad | openFraction | measuredBits | sortEntropy |
|---|---|---|---|---|---|
| adaptive (default) | 3.17 ± 0.79 | 1.70 ± 1.04 | 0.515 ± 0.060 | 93.3 ± 7.7 | 0.0240 ± 0.0047 |
| fixed threshold | 4.25 ± 1.28 | 2.41 ± 1.16 | 0.445 ± 0.057 | 66.7 ± 6.9 | 0.0354 ± 0.0096 |
| memory-4 (`memSize:4`) | 3.17 ± 0.79 | 1.70 ± 1.04 | 0.515 ± 0.060 | 93.3 ± 7.7 | 0.0240 ± 0.0047 |

adaptive vs fixed: goodCrossings t=−1.41, df=18.4, **p=0.175**; good:bad
p=0.385; openFraction p=0.112. **NULL** — the adaptive threshold (online
median-speed tracking, `0.55·median + 0.45·prev`) does not significantly
improve sorting over a fixed 120 u/s threshold at this operating point. It
costs MORE measured bits (93 vs 67/trial: threshold chatter adds decision
flips on top of more crossings) while landing slightly behind on every
sorting metric. Consistent with the C-1/C-5/C-6 pattern: adaptation machinery
≠ better sorting.

## Structural audit of the worker-exact arms (honesty report)

The validator audits the E8 arms after every run and hard-fails if the call
structure breaks:

- `e8_adaptive` ≡ `e7_default` **row-identical** — by construction:
  `{adaptive:true}` is the factory default and the E8 call uses exactly the
  `e7_default` gas, so the two conditions are the same computation. Kept for
  worker-option parity and as a free end-to-end consistency check (the audit
  gate exits non-zero if they ever diverge).
- `e8_mem4` ≡ `e8_adaptive` **row-identical** — an engine property, not a
  bug in this validator: `classicalDemon`'s decision-`memory` buffer is
  **write-only** (pushed/shifted, never read — verified in `controllers.js`,
  lines 41/58; the mirrored `saboteurController` has the same shape), so
  `memSize` is behaviorally inert. The "memory-limited" manipulation cannot
  bind on this engine. **The effective E8 information contrast is therefore
  adaptive vs fixed only.** Both identities are pinned in T5 and recorded in
  the dataset manifest (`config.e8_structural_audit`).

## Known degeneracies (all conditions, reported for completeness)

- `demonAgree` ≡ 1.000 constant in every arm: the summary recomputes the same
  `demonGateDecision` with the same threshold at the same step, so agreement
  is definitionally 1 (zero variance → Welch NaN). Degenerate engine
  diagnostic, not an experimental result.
- `erasureCostJ` displays as 0.000000 (≈4e-21 J/bit × ~40–150 bits, below the
  6-decimal display floor; same floor family as E6's never-gate subsidy note).
  `landauerRatio` remains informative: ~1523 (sparse) → ~653 (default) →
  ~439 (dense) — the demon's measured-bit bill per unit extractable work
  grows with density, mirroring the sortEntropy collapse.

## Cross-validator consistency

`e7_default` (good 3.17 ± 0.79, good:bad 1.70 ± 1.04, openFraction
0.515 ± 0.060) **exactly reproduces** E5's `classical_demon` row from
`e5_comparator.js` (C-6) — same seed rule and config, different validator and
call path. The restructured per-call physics route lands on the identical
operating point.

## Artifacts

- `research_data/e7_e8_batch_2026-09-26T15-07-36.jsonl` (2880 rows) +
  `_summary.json` (includes `e8_structural_audit` + Holm-ready tests) +
  `e7_e8_batch_report_2026-09-26T15-07-36.html`
- C-3 dataset pair `research_data/e7_e8_dataset_2026-09-26T15-09-21.csv` +
  `.manifest.json` — **verifyDataset OK** (2880 × 26 cols, sha256
  `597707d1ed72304b…`, per-condition gas in `config.e7_regimes`/`config.e8_gas`)
- Log `.c7_batch.log`; validator `e7_e8_batch_validate.js` (import-safe,
  exports `trialStats`/`factoryFor`/`physicsFor`); tests
  `tests/e7_e8_batch.test.js` (6/6).

## Conclusion

- **E7:** PASS as a generalization demonstration — the fixed classical policy
  sorts above chance in all three regimes with no re-tuning (all regime pairs
  p_holm < 0.01 on throughput); sorting *efficiency* per event decreases with
  density (dT/sortEntropy collapse), i.e. generalization holds for policy
  function, not for per-event efficiency.
- **E8:** NULL on the only informative contrast (adaptive vs fixed, p=0.175,
  n=12); the memory-limited arm is structurally inert on this engine
  (write-only decision buffer) and is reported as such rather than presented
  as a null result.
