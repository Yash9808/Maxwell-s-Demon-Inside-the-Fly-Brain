# C-8 — E9/E10/E11 Re-runs onto the Unified Schema (build-plan row 18)

Recorded: 2026-09-26, branch `deployment/phase-02`, git `6e63e02c` (dirty).
Status: **DONE — all three validators on the UNTOUCHED engine now carry the
C-3 standardized dataset export, import-safe mains, determinism gates, and
canonical Welch. Headline: the corrected credit pairing establishes REAL E9
learning (neural vs frozen p=2.5e-7) that the legacy pairing cannot show
(p=0.94); E10 accuracy learning is established (17/20 seeds); E11 stays
second-law safe (negative signed work).**

## What changed (validators only — engine untouched, worker options pinned)

- `e9_batch_validate.js`: private Welch copy (own `betai`/`betacf`/`lgamma`)
  **removed** and delegated to canonical `stats_utils.welchT` (the built-in
  selftest still anchors it against the independent Simpson-integration
  method, p(t=2,df=10)=0.073388 exact); import-safe `main()` guard;
  `delete row.fireVec` hygiene in the JSONL collector (1.58 MB vs 13.8 MB
  historical for the same 1440 rows); C-3 export (already wired by the
  earlier thread) retained. Credit-pairing flag `--pairing legacy|corrected`
  unchanged (`pgBaseline: PAIRING === "corrected"`).
- `e10_e11_batch_validate.js`: import-safe `main()` + `--seeds` CLI;
  **single-pass C-3 export** (analysis loop feeds `dsRows` directly — the
  re-simulation pass is gone); **built-in determinism gate** (same seed →
  identical E10+E11 trajectories, mirroring the production call structure);
  all rows exported (neural + frozen + physics-probe variants at the same
  seeds); frozen-control loops (4x-reduced seeds) remain analysis-only.
- Both files normalized CRLF → LF; suites `tests/e9_batch.test.js` (4) and
  `tests/e10_e11_batch.test.js` (4) pin worker-exact options, constants
  (220p, 24+8 eps, `motorDrive 0.6`, `pgRng 500000+seed`, legacy rng rules),
  gates, exports, hygiene, and import-safety.

## E9 — pressure demon, corrected vs legacy credit pairing

20 seeds × 3 variants (`demon_neural`, `demon_frozen`, `demon_speed`) ×
12+12 trials × 20 s × 260 particles; house September protocol (seed rule
`base + s*101`, brain rng `makeRng(9176 + seed*37)`, PG rng
`makeRng(424243 + seed*977)`); no tuning, no discarding. Gates: **IDENTICAL
trajectory** in both pairings.

Final TEST, mean ± 95% CI (n=20; workJ = cumulative spring work, 1e-22 scale):

| Pairing | Condition | reward | decisionAccuracy | workJ (J) | demonAgree |
|---|---|---|---|---|---|
| legacy | neural | −7.387 ± 0.476 | 0.505 ± 0.032 | 1.75e-22 ± 0.07e-22 | 0.496 ± 0.028 |
| legacy | frozen | −7.362 ± 0.448 | 0.516 ± 0.028 | 1.74e-22 | 0.494 ± 0.030 |
| legacy | classical | **0.000 ± 0.000** | **0.947 ± 0.028** | 1.83e-22 | 1.000 |
| corrected | neural | **−5.391 ± 0.424** | **0.651 ± 0.028** | 1.55e-22 ± 0.06e-22 | 0.653 ± 0.029 |
| corrected | frozen | −7.362 ± 0.448 | 0.516 ± 0.028 | 1.74e-22 | 0.494 ± 0.030 |
| corrected | classical | 0.000 ± 0.000 | 0.947 ± 0.028 | 1.83e-22 | 1.000 |

Welch two-sided t on per-seed final-TEST values:

| Pairing | Contrast | reward | decisionAccuracy | demonAgree |
|---|---|---|---|---|
| legacy | neural vs frozen | t=−0.08, **p=0.94** | t=−0.48, p=0.63 | p=0.92 |
| legacy | neural vs classical | t=−30.4, p=1.4e-17 | t=−20.1, p=1.4e-21 | p=8.6e-19 |
| corrected | neural vs frozen | **t=6.26, p=2.5e-7** | **t=6.60, p=8.6e-8** | **t=7.53, p=4.9e-9** |
| corrected | neural vs classical | t=−24.9, p=5.6e-16 | t=−14.4, p=5.6e-17 | p=1.4e-15 |

**Reading.** The legacy pairing (deferred-tick REINFORCE paired with
decPend) produces **no learning contrast whatsoever** — neural ≡ frozen on
every metric (all p ≥ 0.63) — replicating the known E9 null. The corrected
pairing (credit applied at reward-delivery time, EMA-baselined, zero-reward
windows included) lifts the same brain by ≈ +2.0 reward and +0.135 accuracy
over its frozen twin, with neural TRAIN→TEST improving (−6.82 → −5.39).
Isolation check: the frozen arms are byte-identical across the two pairings
(pgBaseline touches only the neural arm), so the entire legacy-vs-corrected
difference is attributable to credit delivery. The classical reference still
dominates by a wide margin under both pairings — the neural valve closes
part of the gap but does not reach the hand-coded policy (consistent with
C-1's E6 conclusion and the C-6 comparator). dPfinal equilibrates to ≈0.94
in every condition; classical demonAgree is 1.000 by construction
(self-agreement diagnostic — see C-7 honesty note).

## E10 — Smoluchowski trapdoor (PG brain, motorDrive 0.6)

20 seeds × 24+8 episodes × 12 s × 220 particles, TRAIN (plasticity ON) →
TEST (frozen); frozen-control exposure at 4x-reduced seeds (analysis-only).
Gate: **IDENTICAL trajectories**.

Per-seed learning deltas (TEST − TRAIN), mean ± 95% CI:

| Metric | Delta | Improved | Verdict |
|---|---|---|---|
| decisionAccuracy | **+0.0560 ± 0.0187** | **17/20** | established (CI excludes 0) |
| reward | +0.085 ± 0.150 | 11/20 | n.s. |
| netTransport (LR−RL) | −0.01 ± 0.40 | 13/20 | n.s. (honest trapdoor) |

Neural TEST reward −0.98 ± 0.12 (TRAIN −1.06 ± 0.08) vs frozen control
−1.18 ± 0.13 — the trained brain sits ≈0.2 reward above frozen, direction
consistent with the accuracy result.

## E11 — Feynman ratchet (same brains, equilibrium bath)

Gate: **IDENTICAL trajectories**. Learning deltas: reward +0.389 ± 0.522
(12/20, n.s.); accuracy +0.0137 ± 0.0268 (11/20, n.s.); weightDrift at end
of train 89.28 ± 5.40 (machinery live). **Second-law audit: test-phase
signed work −0.098e-21 J ± 0.012e-21 (NEGATIVE — no work extraction,
law-safe), heat +186.8e-21 J/ep, entropy production 2.8698 ≥ 0.** Neural
TEST reward −11.58 ± 0.66 vs frozen control −12.15 ± 0.96.

## Honesty notes

- `workJ` means show as 0.000 at 3-decimal display in logs/HTML (values are
  ~1.5–1.8e-22 J); exponent form is used throughout this record.
- `demonAgree` for the classical arm is definitionally 1.000 (the summary
  re-scores the same rule at the same threshold — same degeneracy documented
  in C-7). It is reported only for the neural/frozen contrast, where it is a
  genuine measurement (0.653 vs 0.494 under the corrected pairing).
- E9's per-seed neural/classical work ratio remains ≈0.85–0.95 in both
  pairings (`ratioStats` in the summaries); the neural valve does less
  piston work than the classical policy at far worse sorting — no
  free-energy claim is made.
- The E10/E11 dataset intentionally includes the probe variants
  (`trapdoor_light/heavy`, `ratchet_gradient/equilibrium/heavy_load`) at the
  same seeds — they are physics probes of the cores, labeled per row.

## Artifacts (research_data/)

- E9 legacy: `e9_batch_2026-09-26T15-56-11.jsonl` (1440 rows) +
  `_summary.json` + `_report.html`; C-3 pair
  `e9_dataset_2026-09-26T16-01-22.csv` + manifest — **verify OK**
  (1440 × 41, sha256 `73f9c6fe639646ba…`, `config.pairing=legacy`)
- E9 corrected: `e9_batch_2026-09-26T16-01-23.jsonl` + summary + report;
  C-3 pair `e9_dataset_2026-09-26T16-06-37.csv` + manifest — **verify OK**
  (1440 × 41, sha256 `5e35b7da2a9b9488…`, `config.pairing=corrected`)
- E10/E11: C-3 pair `e10_e11_dataset_2026-09-26T16-13-36.csv` + manifest —
  **verify OK** (5760 × 56, sha256 `db4febd7e044ed52…`, all 9 core variants)
- Logs `.c8_e9_legacy.log`, `.c8_e9_corrected.log`, `.c8_e10e11.log`

## Conclusion

- **E9:** the September "no learning" verdict was an artifact of legacy
  credit delivery; with corrected pairing the fly-brain valve **learns**
  (reward, accuracy, agreement all p ≤ 1e-7 over frozen) but still loses to
  the classical reference by a wide margin. Schema re-run complete (2 ×
  1440 × 41).
- **E10:** accuracy learning established (+0.056 ± 0.019, 17/20 seeds);
  reward/transport n.s. Schema re-run complete (5760 × 56).
- **E11:** no learning signal; second-law audit clean (negative signed
  work, positive entropy production).
- Unified-schema coverage now spans e6, e2_e3, e4, e5, e7_e8, e9, e10_e11
  — every C-ladder dataset verifies against its sha256-pinned manifest.
