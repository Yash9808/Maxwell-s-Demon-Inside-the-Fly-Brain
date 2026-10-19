# Supplementary Material — E1–E11 paper program

All numbers trace to `paper_v2/analysis/ANALYSIS_RESULTS.json` and `paper_v2/analysis/STATISTICS_REPORT.md`. Raw: `paper_v2/raw/`. Processed: `paper_v2/processed/`.

---

## S1. Complete per-condition tables, E1–E8 (test phase)

Values: mean ± t-based 95% CI over per-seed means (n = 2 seeds for E1–E6, E8; n = 3 for E7).

| Exp | Condition | openFrac | crossings/ep | g:B (cond) | ΔT (×10⁻³) | ΔH (bits, ×10⁻²) | MI (×10⁻³) | bits/trial |
|---|---|---|---|---|---|---|---|---|
| E1 | classical_demon | 0.483 | 7.75 | 1.26 | 26.6 | 2.70 | 0 | 98 |
| E2 | ann | 0.994 | 20.71 | 0.80 | 21.9 | 1.89 | 55.3 | 22 |
| E2 | random | 0.354 | 6.00 | 1.22 | 25.9 | 2.92 | 0 | 12 |
| E3 | drosophila | 0.000 | 0.00 | n/a (no crossings) | 29.0 | 3.63 | 3.8 | 0 |
| E3 | drosophila_frozen | 0.497 (bimodal: 0.994 / 0.000 by seed) | 10.25 | 0.86 | 26.4 | 2.99 | 3.1 | 11 |
| E4 | connectome_4A | 0.322 | 6.95 | 0.44 | 26.5 | 2.57 | 3.4 | 103 |
| E4 | connectome_4B | 0.299 | 6.20 | 0.70 | 24.6 | 2.36 | 3.4 | 106 |
| E4 | connectome_4C | 0.386 | 7.65 | 0.84 | 24.2 | 2.72 | 7.0 | 115 |
| E5 | classical_demon | 0.498 | 6.85 | 1.31 | 27.1 | 2.91 | 0 | 100 |
| E5 | ann | 0.994 | 19.95 | 0.72 | 19.4 | 1.64 | 57.4 | 21 |
| E5 | drosophila | 0.000 | 0.00 | n/a | 28.8 | 3.17 | 4.1 | 0 |
| E5 | connectome (=4A) | 0.322 | 6.95 | 0.44 | 26.5 | 2.57 | 3.4 | 103 |
| E5 | shuffled_connectome (=4C) | 0.386 | 7.65 | 0.84 | 24.2 | 2.72 | 7.0 | 115 |
| E6 | classical_demon | 0.483 | 7.75 | 1.26 | 26.6 | 2.70 | 0 | 98 |
| E6 | random | 0.354 | 6.00 | 1.22 | 25.9 | 2.92 | 0 | 12 |
| E6 | never_gate | 0.000 | 0.00 | n/a | 29.9 | 3.68 | 0 | 0 |
| E8 | demon_adaptive | 0.483 | 7.75 | 1.26 | 26.6 | 2.70 | 0 | 98 |
| E8 | demon_fixed | 0.483 | 7.75 | 1.26 | 26.6 | 2.70 | 0 | 98 |
| E8 | demon_mem4 | 0.483 | 7.75 | 1.26 | 26.6 | 2.70 | 0 | 98 |

Note: E1/E6-classical/E8-adaptive are the same configuration run in three experiments (identical numbers verify seed-rule determinism). E8 fixed/mem4 are exactly identical to adaptive in this regime — the adaptive mechanism never engages (see S5).

## S2. Complete thermodynamic ledger (test phase)

| Experiment | Condition | workIn J/trial | extractable J/trial | erasureCost J/trial | bits used | bits needed |
|---|---|---|---|---|---|---|
| E1 | classical_demon | 3.30e-11 | 1.96e-16 | 2.82e-19 | 98 | 68,427 |
| E2 | ann | 3.13e-11 | 1.52e-16 | 6.23e-20 | 22 | 53,029 |
| E2 | random | 3.26e-11 | 1.92e-16 | 3.41e-20 | 12 | 66,939 |
| E3 | drosophila | 3.22e-11 | 2.13e-16 | 0 | 0 | 74,175 |
| E3 | drosophila_frozen | 3.17e-11 | 1.90e-16 | 3.09e-20 | 11 | 66,060 |
| E4 | connectome_4A | 2.19e-11 | 1.97e-16 | 2.95e-19 | 103 | 68,586 |
| E4 | connectome_4B | 2.21e-11 | 1.79e-16 | 3.06e-19 | 106 | 62,539 |
| E4 | connectome_4C | 2.20e-11 | 1.74e-16 | 3.29e-19 | 115 | 60,733 |
| E5 | (five conditions) | ≈2.2e-11 | 1.34e-16 … 2.13e-16 | 0 … 2.9e-19 | 0 … 115 | 46,837 … 74,104 |
| E6 | classical_demon / random / never_gate | 3.2–3.3e-11 | 1.92–2.22e-16 | 0 … 2.8e-19 | 0 / 12 / 98 | 66,939 … 77,256 |
| E8 | adaptive / fixed / mem4 | 3.30e-11 | 1.96e-16 | 2.82e-19 | 98 | 68,427 |

Reading: bits_needed = extractable work priced in Landauer bits (k_B·300 K·ln2 = 2.871×10⁻²¹ J). bits_used ≪ bits_needed everywhere: the metered memory traffic is 3–4 orders too small to pay for the observed extractable work; the sorted state's free energy comes from the jet. Efficiency = extractable/work_in ≈ 6×10⁻⁶.

## S3. Apparatus results, full condition tables (E9–E11, test phase, n = 10 seeds)

**E9 · Pressure demon**

| Condition | workJEp (J) | ΔP final | openFrac | decisionAccuracy | reward | weightDrift | valveFlips |
|---|---|---|---|---|---|---|---|
| demon_neural | ≈8×10⁻²⁴ | 0.897 ± 0.018 | 0.516 ± 0.017 | 0.517 ± 0.016 | −7.55 ± 0.24 | 498 ± 23 | 695 ± 13 |
| demon_frozen | ≈7×10⁻²⁴ | 0.875 ± 0.018 | 0.508 ± 0.015 | 0.520 ± 0.016 | −7.50 ± 0.24 | 0 | 696 ± 12 |
| demon_speed | ≈7×10⁻²⁴ | 0.880 ± 0.012 | 0.072 ± 0.017 | 0.911 ± 0.019 | 0 | 0 | 150 ± 9 |
| demon_random | ≈0 | −0.014 ± 0.038 | 0.302 ± 0.010 | 0.363 ± 0.017 | 0 | 0 | 576 ± 13 |
| never_open | 0 | 0.017 ± 0.027 | 0.000 | 0.187 ± 0.031 | 0 | 0 | 0 |

**E10 · Smoluchowski trapdoor**

| Condition | crossingRate | crossLR | crossRL | netSortedProxy | holdFrac | decisionAccuracy | weightDrift |
|---|---|---|---|---|---|---|---|
| trapdoor_light | 0.985 ± 0.024 | 8.03 ± 0.36 | 7.73 ± 0.29 | 0.30 ± 0.52 | 0 | 0 | 0 |
| trapdoor_heavy | 0.659 ± 0.067 | 5.46 ± 0.61 | 5.09 ± 0.59 | 0.37 ± 0.51 | 0 | 0 | 0 |
| trapdoor_neural | 0.481 ± 0.069 | 3.94 ± 0.53 | 3.75 ± 0.61 | 0.19 ± 0.27 | 0.415 ± 0.027 | 0.731 ± 0.026 | 2.8 ± 0.5 |
| trapdoor_frozen | 0.325 ± 0.066 | 2.71 ± 0.63 | 2.49 ± 0.49 | 0.22 ± 0.36 | 0.519 ± 0.016 | 0.711 ± 0.021 | 0 |

**E11 · Feynman ratchet & pawl**

| Condition | netPerEpisode | liftFrac | entropyProduction | decisionAccuracy | reward | weightDrift |
|---|---|---|---|---|---|---|
| ratchet_gradient (Th>Tc) | +7.23 ± 0.54 | 0 | 6.42 ± 0.21 | 0 | 0 | 0 |
| ratchet_equilibrium | −2.01 ± 0.40 | 0 | 5.79 ± 0.22 | 0 | 0 | 0 |
| ratchet_heavy_load | +6.99 ± 0.59 | 0 | 9.95 ± 0.17 | 0 | 0 | 0 |
| ratchet_neural (equilibrium) | −1.92 ± 0.45 | 0.410 ± 0.101 | 3.25 ± 0.62 | 0.741 ± 0.054 | −11.81 ± 0.96 | 29.3 ± 3.8 |
| ratchet_frozen (equilibrium) | −1.79 ± 0.38 | 0.505 ± 0.018 | 2.57 ± 0.17 | 0.690 ± 0.022 | −12.09 ± 1.05 | 0 |

## S4. Preregistered campaign cross-check (independent, prior multi-seed runs)

The repository contains a preregistered validation campaign (`PRE_REGISTERED_CRITERIA.json`; data `research_data/validation/`, 12–20 seeds) run independently of this paper program. Verdicts agree with ours everywhere they overlap:

| Campaign | Primary endpoint | Verdict | Our program |
|---|---|---|---|
| E3 (20 seeds) | paired late-early goodBadRatio (drosophila) | NO_EVIDENCE (p = 1.0) | policy collapse to closed door (Fig 2a) |
| E4 (12 seeds + 10 shuffle draws) | 4A vs 4C test goodBadRatio | NO_EVIDENCE (p_BH = 0.93, g = −0.11) | ΔT contrast p_BH = 1.0 (n = 2) |
| E9 (20 seeds) | paired neural−frozen test workJEp | NO_EVIDENCE (p = 0.94) | THERMODYNAMICALLY NEGLIGIBLE |
| E9 floor | neural vs never_open workJEp | SUCCESS (loop alive) | reproduced (ΔP 0.90 vs 0.02) |
| E10 (12 seeds) | neural−frozen netSortedProxy | NO_EVIDENCE (p = 0.77) | DIRECTION_ONLY (Δ = −0.03) |
| E10 physics | light vs heavy crossingRate | SUCCESS (p = 3.2×10⁻³) | SUCCESS (p_BH = 4×10⁻⁴, g = 3.8) |
| E11 (12 seeds) | gradient vs equilibrium netPerEpisode | SUCCESS (p < 1×10⁻⁴) | SUCCESS (p_BH = 7×10⁻⁴, g = 11.5) |
| E11 | neural−frozen reward | SUCCESS (learning acts) | SUCCESS_SMALL_EFFECT (+0.28) |
| E11 | neural−frozen workJEp | DIRECTION_ONLY | NEGLIGIBLE (no positive work at equilibrium) |

The single-seed 9,000-frame pilot (`learning_curve.json`, ratio 1.55→4.56) predates the campaigns; the never-gate/random controls (E6) and the campaigns explain it as an uncontrolled demonstration.

## S5. Statistical guards and degeneracy documentation

1. **Degeneracy guard**: door-task conditions have n = 2 seeds; paired/unpaired permutation p-values on 2-point samples cannot support positive claims (any p is achievable under degeneracy). All E1–E8 verdicts therefore read DEGENERATE or NO_EVIDENCE regardless of p. Where n = 2 contrasts are reported, they are descriptive.
2. **Thermodynamic-negligibility guard**: work/energy contrasts where both arms are below 10% of one Landauer bit (2.871×10⁻²¹ J) are reported as THERMODYNAMICALLY NEGLIGIBLE even if permutation p < 0.05 (applies to E9 workJEp contrasts; ≈8×10⁻²⁴ J is 0.3% of one bit).
3. **Relative-negligibility guard**: same-sign contrasts with |Δ| < 1% of the larger mean are NEGLIGIBLE (applies to E9 netWorkJ: both arms ≈ −4×10⁻¹⁸ J, Δ ≈ 5×10⁻²⁴ J).
4. **Identical-condition artifacts**: E1 = E6-classical = E8-adaptive (same seed rule, same config) — used as a determinism check. E8 fixed/mem4 are bit-identical to adaptive because the adaptive mechanism never engages in this regime (threshold never adapts away from default), so the E8 manipulation is inert here; the honest verdict is "no observable price of reduced measurement/memory in this regime".
5. **E3 zero-crossing convention**: the learning arm's 0 metered bits and 0 crossings are a *policy outcome* (door closed), not missing data; ΔH for that condition equals the never-gate jet subsidy and must not be read as sorting.

## S6. Additional analyses

- **E9 sensory–motor correlation (preregistered)**: per-seed Pearson r(sensoryActivity, motorActivity) = 0.29 ± 0.11 (n = 10 seeds) — signal transmission through the connectome is present and variable across brain draws.
- **E11 entropy production**: learning arm 3.25 ± 0.62 vs frozen 2.57 ± 0.17 (p_BH = 2.3×10⁻³, g = 0.89) — active pawl engagement *increases* entropy production while extracting no net work, consistent with the second-law accounting.
- **E7 regime detail**: selectivity (good:bad conditional) 2.50 (sparse/clean), 1.63 (dense/noisy), 1.62 (default); ΔT higher in the dense/noisy regime (0.041 vs 0.025) because more particles + more jet noise broaden the speed distribution the gate exploits.
- **E10 crossingRate asymmetry**: neural flap opens more often than frozen (crossingRate 0.48 vs 0.33, holdFrac 0.42 vs 0.52, p_BH = 2.6×10⁻³) — learning moved the flap towards *less* holding, i.e. more permissive, not selective.

## S6b. Brain-level neural analytics (Figs 8–11, 14)

**Scope discipline (critical).** `fireVec` payloads are scope-limited per controller: connectome controllers (E4 connectome/shuffled, E5 connectome/shuffled, E9–E11 neural arms) log all **106,765 FAFB neurons**; the E3 drosophila controller logs its **248-unit MB mini-circuit** (32 PN + 200 KC + 16 MBON model units, `controllers.js:246`); the E2/E5-ann controller logs **18 units** (16 hidden + 2 output). Mini-circuit payloads are never mapped onto FAFB anatomy. All activity shown is decoded MODEL activity (c ≈ (q/16)², capped 256) — not biological recordings.

- **E9 per-neuron activity** (Fig 8): test-phase, 10 seeds/condition. ≈7–8×10³ neurons fire per trial-window. Top regions (mean decoded counts/trial, trained): antennal lobe (L) dominant, then optic lobe (ME), lateral horn, gnathal ganglia; trained-vs-frozen top-10 sets overlap with magnitude differences (Fig 8d).
- **E9 learning delta** (Fig 10): late − early training activity; largest |delta| populations in central-complex (SMP/SIP/SLP) and lateral-horn bins; per-neuron delta distribution heavy-tailed (few units change strongly).
- **E9 neural MI** (Fig 11): neuropil-binned, median-split activity vs decision accuracy above chance; Miller–Madow corrected; per-seed then mean ± SD (n = 10 seeds). Top: AL_L 0.079 ± 0.106, AL_R 0.048 ± 0.074, GNG 0.044 ± 0.050 bits; optic lobe near zero. Values are small; seed-level dispersion overlaps zero for most regions — reported as OBSERVED descriptors, not strong claims.
- **E3 mini-circuit analytics** (Fig 14a–d): 248-unit maps for early/late training and test; learning delta per unit; `layerRates` trajectory (PN/KC/MBON model rates) for both conditions — the PN rate stays input-driven while MB-output rates differentiate learning from frozen. Mini-circuit population MI vs crossing (descriptive, n = 1 usable seed per condition: PN 0.004, KC 0.006 bits; MBON undefined — no usable variance) in `MI_E3.json`.
- **E4/E5 wiring-similarity** (Fig 14e–g): real vs shuffled FAFB region activity at test; per-neuron Pearson r(4A,4C) = 0.981/0.982 (s0/s1) vs r(4A,4B) = 0.985/0.987 — real–shuffled neural similarity ≈ real–real. The shuffled circuit's firing map is nearly indistinguishable from the real one at this sensory drive, mechanistically consistent with the behavioural null (§2.4).
- **E9/E10/E11 note**: E10/E11 rows carry no fireVec (their controllers do not log one); their analyses are behavioural/energetic. E9 neural data are covered in Figs 8–11.

Files: `processed/brain/ACT_*.bin` (Float32 activity vectors), `MINI_E3.json`, `MI_E9.json`, `MI_E3.json`, `TOPCELLS.json` (cell-type annotations of the 400 most-active neurons), `NEUROPIL_SIZES.json`, `*_neuropil_activity.json` (per-condition × seed × window region tables). Exporter: `brain_export.js`; figures: `paper_brain_figures.py`, `figure14_door_brains.py`.

## S7. Experiment-to-paper matrix

| Experiment | Question | Dataset | Main metric | Figure/Table | Results § | Supplement |
|---|---|---|---|---|---|---|
| E1 | Adaptive demon sorts at what cost? | door, 2 seeds | ledger bits used vs needed | Fig 3b; Table S2 | 2.1 | S1, S2 |
| E2 | Can a small ANN match the engineered gate? | door, 2 seeds | openFrac, selectivity | Fig 2b | 2.2 | S1 |
| E3 | Does DA-gated MB network learn the task? | door, 2 seeds (+20-seed campaign) | openFrac (policy collapse) | Fig 2a | 2.2 | S1, S4, S5 |
| E4 | Real vs restricted vs shuffled wiring | FAFB circuit, 2 seeds (+12-seed campaign) | ΔT, MI | Fig 4a | 2.4 | S1, S4 |
| E5 | Head-to-head comparator | FAFB circuit, 2 seeds | ΔT, MI, g:B | Figs 2c, 3a | 2.3, 2.4 | S1 |
| E6 | Is ΔH jet-subsidized? | door, 2 seeds | ΔH vs never-gate | Fig 3b (context) | 2.3 | S2 |
| E7 | Robustness across physics | door, 3 regimes × 1 seed | g:B conditional | Fig 6a | 2.6 | S6 |
| E8 | Price of less measurement/memory | door, 2 seeds | all (no effect) | Fig 6b | 2.3, 2.6 | S1, S5 |
| E9 | Brain valve: ΔP and net work? | FAFB circuit, 10 seeds | decisionAccuracy, workJEp, weightDrift | Figs 2d, 5a–c, 8–11, 12a, 13 | 2.5, 2.7 | S3, S4, S6, S6b |
| E10 | Trapdoor sorts? (expected: no) | FAFB circuit, 10 seeds | crossingRate, netSortedProxy | Fig 4b; Fig 5c | 2.5 | S3, S4 |
| E11 | Ratchet: gradient boundary? | FAFB circuit, 10 seeds | netPerEpisode, entropyProduction | Fig 4c; Fig 6c | 2.5, 2.6 | S3, S4, S6 |
| E1–E8 (entropy/ledger) | Entropy reduction + crossing counts by condition | door rows | sortEntropy, good/bad crossings | Fig 15 (a,b); Fig 13b–c | 2.8 | S2 |

## S8. Reproducibility manifest

```
MANUSCRIPT              paper_v2/MANUSCRIPT.md
FIGURES                 paper_v2/figures/figure1..15 (.png + .pdf)
FIGURE_PROVENANCE       paper_v2/figures/PROVENANCE.json (+ PROVENANCE_fig14.json, PROVENANCE_fig15.json)
FIGURE_LEGENDS          paper_v2/legends/FIGURE_LEGENDS.md
FIGURE_REGISTRY         paper_v2/FIGURE_REGISTRY.md (+ FIGURE_REGISTRY_BRAIN.json)
FIGURE_DATA             paper_v2/figure_data/  (see PROVENANCE.json data_files)
RAW_EXPERIMENT_DATA     paper_v2/raw/E1..E11_rows*.jsonl (5,564 rows) + *_meta.json
PROCESSED_DATA          paper_v2/processed/*_per_seed.csv + curves_*.csv; brain analytics in processed/brain/
BRAIN_ANALYTICS         paper_v2/brain_export.js -> processed/brain/ (ACT bins, MI_E9/MI_E3, MINI_E3, TOPCELLS)
ANALYSIS                paper_v2/analysis/ANALYSIS_RESULTS.json
STATISTICS              paper_v2/analysis/STATISTICS_REPORT.md
EXPERIMENT_CONFIGS      paper_v2/configs/experiment_registry.json + experiments/e*.json
MODEL_CONFIGS           experiment_core.js / controllers.js (code = source of truth)
TITLE_ANALYSIS          paper_v2/TITLE_ANALYSIS_initial.md + TITLE_ANALYSIS_final.md
RUNNER                  paper_v2/paper_program.js  (node, headless, seeded)
ANALYSIS_SCRIPT         paper_v2/paper_analysis.js
FIGURE_SCRIPT           paper_v2/paper_figures.py
PRIOR_CAMPAIGNS         research_data/validation/ (preregistered, 12-20 seeds)
SEED_RULES              door: 1+seedIdx*101; apparatus: 1+(seedTag-1)*101; brain 9176+..*37; PG 424243+..*977
ENVIRONMENT             Node 26.8.2; Python 3.14.6 (numpy 2.5.1, matplotlib 3.11.1)
```

Traceability: every manuscript claim → Results § → figure/table → `ANALYSIS_RESULTS.json` key → processed CSV → raw JSONL rows → seeded engine (`paper_program.js` → `experiment_core.js`/`controllers.js`).
