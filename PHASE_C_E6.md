# Phase C-1 — E6 Jet-Closure Formal Experiment (build-plan rows 15 + 8)

Recorded: 2026-09-26, branch `deployment/phase-02`, git `6e63e02c` (dirty).
Status: **experiment complete — honest NULL on the learning claim; controls
healthy, endpoint non-degenerate, machinery verified live.**

## Scientific question

Does the FAFB connectome demon's dopamine-gated plasticity (`demon_neural`)
beat (a) its own frozen control (`demon_frozen`, same brain, plasticity
refused from trial 0), (b) the never-gate subsidy floor (`never_gate`), and
(c) the hand-coded classical reference (`classical_demon`) — on the jet-
closure chamber with a TRAIN → FROZEN-EVAL protocol?

## Hypothesis

- **H1:** 12 training episodes of crossing-driven DA (legacy q → DA →
  eligibility → applyLearning) produce a final-TEST behavioral improvement
  over the frozen control on the same seeds.
- **H0:** neural ≈ frozen within seed noise (the Phase 3B precedent).

## Engine and protocol (nothing touched)

`experiment_core.js runBenchmark` — the SAME generic Maxwell-demon engine
E1–E8 use, unmodified: TRAIN phase plasticity ON, FROZEN TEST phase
(`setLearning(false)` zeroes eligibility + DA), per-trial neural state
reset, weights persist across the phase boundary for the trained condition.
Chamber: auto heat jet (0.55, 3.5 s), one-way speed-selective door band,
`good = dir·(T2−v2)/max(T2,1) > 0` scoring. No tuning, no seed selection,
no discarded runs; the seed is the independent replicate.

## Conditions

| Condition | Controller | Plasticity |
|---|---|---|
| `demon_neural` | REAL FAFB v783 `connectomeController` (E4-verified options: `opticDrive 0.25`, plasticity full; E1–E8 crossing-feedback learning path) | ON in train, frozen in test |
| `demon_frozen` | SAME brain; wrapper **refuses** `setLearning(true)` (the engine's phase loop asks; the control declines — same pattern as pressureDemonCore's frozen arm) | OFF always |
| `never_gate` | `CTRL.neverGateController` | n/a |
| `classical_demon` | `CTRL.classicalDemon` | n/a (reference) |

Per-trial telemetry (read-only prototype-chained wrapper — core and
controllers untouched): `weightDrift` (cumulative Σ|Δw| from connectome
baseline), `weightDriftDelta`, `dopaminePeak/Min`, `neuralSpikes`,
`motorSpikes`, `neuralDecisions`, `openSteps`, plus the engine's full row
(crossings, good/bad, openFraction, demonAgree, dTfinal, entropies, MI,
thermo budget). The 139 KB/row legacy `fireVec` display payload is stripped
from persisted rows.

## Seeds and determinism

20 seeds (base 1, stride 101: rng seeds 1..1919), 12 train + 8 test trials,
12 s episodes, 320 particles (the calibrated operating point — the smaller
smoke scales produce zero crossings and a degenerate endpoint, see
STAGE_F_E4_RESULTS). Chunked execution against the shell time clamp:
10 x 2-seed chunks (`--no-determinism`), combined via `--from-jsonl`
(replicate ids re-based from chunk provenance). Determinism gate
(same-seed full-protocol rerun): **IDENTICAL rows — passed.**

## Results (final TEST phase, mean ± 95% CI over 20 seeds)

| Condition | good crossings | good:bad | openFraction | demonAgree | weightDrift |
|---|---|---|---|---|---|
| `demon_neural` | 2.10 ± 0.89 | 0.51 ± 0.24 | 0.330 ± 0.103 | 0.500 ± 0.030 | 1.43e+3 |
| `demon_frozen` | 1.80 ± 0.63 | 0.86 ± 0.50 | 0.297 ± 0.072 | 0.494 ± 0.049 | **0 (exact)** |
| `never_gate` | 0.00 ± 0.00 | — | 0.000 ± 0.000 | 0.000 ± 0.000 | — |
| `classical_demon` | 3.45 ± 1.05 | 0.92 ± 0.25 | 0.496 ± 0.060 | 1.000 (by construction) | — |

Welch two-sided t tests on per-seed final-TEST values (18 recorded):

| Comparison | Metric | t | p |
|---|---|---|---|
| neural vs frozen | goodCrossings | 0.54 | **0.592** |
| neural vs frozen | goodBadRatio | −1.23 | **0.231** |
| neural vs frozen | openFraction | 0.51 | 0.616 |
| neural vs frozen | demonAgree | 0.22 | 0.826 |
| neural vs frozen | dTfinal | −0.52 | 0.608 |
| neural vs never_gate | goodCrossings | 4.64 | **0.0002** |
| frozen vs never_gate | goodCrossings | 5.60 | **2.1e-5** |
| neural vs never_gate | openFraction | 6.29 | 4.9e-6 |
| neural vs classical | goodCrossings | −1.93 | 0.062 |
| neural vs classical | goodBadRatio | −2.26 | **0.030** (classical better) |

## Verdict (honest)

**Learning NOT DEMONSTRATED.** `demon_neural` does not separate from
`demon_frozen` on any behavioral metric (p = 0.23–0.83; the selectivity
point estimate is WORSE for the trained arm). This is not a power failure:
the endpoint is non-degenerate (openFraction 0.30–0.33, hundreds of
crossings, the neural arms beat the never-gate floor at p ≤ 2e-4), so the
comparison had the sensitivity to detect a real effect and found none.
What IS demonstrated:

1. **Machinery live:** trained-arm weight drift 1.43e+3 through train,
   exactly 0 in the frozen control (gate verified in selftest, tests, and
   the data); DA peaks 0.35–0.43; ~1.3e5 spikes/trial.
2. **Frozen-control discipline works:** engine asked to enable plasticity
   in every train phase; the wrapper refused; frozen drift stayed 0 to the
   last digit across 20 seeds x 20 trials.
3. **Subsidy floor quantified:** with the jet running and the door never
   open, dT still reads 0.024 ± 0.003 (jet-subsidized, no sorting, zero
   crossings) — any dT claim must beat this band.
4. **Classical reference dominates:** the hand-coded rule beats both neural
   arms on selectivity (p = 0.030) — the bar a learning claim must clear.

Consistent with the Phase 3B precedent: 12 episodes of sparse,
crossing-locked DA is far too little training for a 106k-neuron controller;
the experiment validates the PROTOCOL, not H1.

## Regression battery (post-implementation)

| Suite | Result |
|---|---|
| `tests/e6_batch.test.js` (new) | **7/7** (pins, frozen gate, trialStats hand-check, Welch anchor, in-process determinism, real-run drift discipline) |
| `tests/run_smoke.js` | 42/42 ALL GREEN |
| Parity suites (p2/p3/p4/no-autorotate/glsl/gatekeeper) | 43/43 |
| `tests/phase3_behavior.test.js` + `tests/phase3b_approach.test.js` (real) | 16 pass / 0 fail / 2 by-design skip |
| `e6_batch_validate.js --selftest` | PASS (Welch anchor p(t=1.8516, df=10)=0.0938; frozen gate; factories) |

## Reproducibility

```
# single chunk (2 seeds)
node e6_batch_validate.js --seeds 2 --base <B> --train 12 --test 8 \
     --episode 12 --particles 320 --no-html --no-determinism
# determinism gate (1 seed, rerun built in)
node e6_batch_validate.js --seeds 1 --base 1 --train 12 --test 8 \
     --episode 12 --particles 320 --no-html
# aggregate chunks -> summary + Welch + HTML
node e6_batch_validate.js --from-jsonl <chunk1.jsonl>,...,<chunk10.jsonl> \
     --train 12 --test 8 --episode 12 --particles 320
```

Artifacts in `research_data/`: 10 chunk `e6_batch_<stamp>.jsonl` +
`_summary.json` pairs, the gate-run pair (`T10-07-00`), and the combined
`e6_batch_2026-09-26T10-08-46.jsonl` (1600 rows) + `_summary.json`
(20 seeds, 18 tests, full provenance incl. protocol + mode) +
`e6_batch_report_2026-09-26T10-08-46.html`. All LF-clean.

## Known limitations

- Training length (12 episodes) and single brain-seed-per-replicate; a
  positive claim needs longer training batches and multiple brain draws.
- The learning path exercised is the E1–E8 crossing-feedback loop (legacy
  q → DA), not the opt-in PG readout (the e9 pairing machinery is inert
  under runBenchmark); switching readouts is a separate preregistered study.
- `demonAgree` for both neural arms sits at 0.50 (chance agreement with the
  classical rule) — the pool-ratio policy is not yet sorted-gate-like.
- Chunked aggregation re-bases seedTags from chunk provenance; a chunk run
  with a non-standard `--base` breaks the re-basing (documented in-code).

## Next (per the approved ladder — NOT started)

C-2 Phase 3B close-out (rows 3) → C-3 unified export schema (row 9) →
C-4 E2/E3 verification → C-5 E4A/B/C stats → C-6 E5 comparator →
C-7 E7/E8 → C-8 E9/E10/E11 re-runs → C-9 Nature analysis layer.
