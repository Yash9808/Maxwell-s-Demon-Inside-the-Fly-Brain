# STATISTICAL ANALYSIS REPORT — E1–E11 paper program

Generated: 2026-09-23T12:29:49.092Z
Replicate unit: **seed** (per-seed phase means first). 95% CI: t-based. Permutation p: 10,000 draws (PRNG 20260920), BH-FDR q=0.05 within family. Effect size: Hedges' g. Verdicts are gated: a contrast computed over fewer than 3 evaluable per-seed differences is reported as DEGENERATE and cannot support a positive claim.

## E1

| condition | n | openFrac train→test | crossings/ep train→test | g:B (cond, test) | dT (test) | ΔH (test) | MI (test) | bits/trial |
|---|---|---|---|---|---|---|---|---|
| classical_demon | 2 | 0.512→0.483 | 7.33→7.75 | 1.26 | 0.0266 | 0.0270 | 0.0000 | 98 |

## E2

| condition | n | openFrac train→test | crossings/ep train→test | g:B (cond, test) | dT (test) | ΔH (test) | MI (test) | bits/trial |
|---|---|---|---|---|---|---|---|---|
| ann | 2 | 0.994→0.994 | 21.25→20.71 | 0.80 | 0.0219 | 0.0189 | 0.0553 | 22 |
| random | 2 | 0.376→0.354 | 7.02→6.00 | 1.22 | 0.0259 | 0.0292 | 0.0000 | 12 |

| comparison | metric | phase | mean A | mean B | Δ | p_raw | p_BH | g | verdict |
|---|---|---|---|---|---|---|---|---|---|
| ann vs random (test openFraction) | openFraction | test | 0.994 | 0.354 | 0.641 | 3.38e-1 | 3.38e-1 | 35.74 | DEGENERATEcontrast: not evaluable as positive evidence |
| ann vs random (test dT) | dTfinal | test | 0.022 | 0.026 | -0.004 | 3.38e-1 | 3.38e-1 | -1.41 | DEGENERATEcontrast: not evaluable as positive evidence |

## E3

| condition | n | openFrac train→test | crossings/ep train→test | g:B (cond, test) | dT (test) | ΔH (test) | MI (test) | bits/trial |
|---|---|---|---|---|---|---|---|---|
| drosophila | 2 | 0.002→0.000 | 0.07→0.00 | n/a | 0.0290 | 0.0363 | 0.0038 | 0 |
| drosophila_frozen | 2 | 0.497→0.497 | 10.55→10.25 | 0.86 | 0.0264 | 0.0299 | 0.0031 | 11 |

| comparison | metric | phase | mean A | mean B | Δ | p_raw | p_BH | g | verdict |
|---|---|---|---|---|---|---|---|---|---|
| drosophila vs frozen (test openFraction; policy collapse) | openFraction | test | 0.000 | 0.497 | -0.497 | 1.00e+0 | 1.00e+0 | -0.57 | DEGENERATEcontrast: not evaluable as positive evidence |
| drosophila vs frozen (train openFraction) | openFraction | train | 0.002 | 0.497 | -0.495 | 1.00e+0 | 1.00e+0 | -0.57 | DEGENERATEcontrast: not evaluable as positive evidence |
| drosophila vs frozen (test dT) | dTfinal | test | 0.029 | 0.026 | 0.003 | 1.00e+0 | 1.00e+0 | 0.48 | DEGENERATEcontrast: not evaluable as positive evidence |

## E4

| condition | n | openFrac train→test | crossings/ep train→test | g:B (cond, test) | dT (test) | ΔH (test) | MI (test) | bits/trial |
|---|---|---|---|---|---|---|---|---|
| connectome_4A | 2 | 0.300→0.322 | 5.80→6.95 | 0.44 | 0.0265 | 0.0257 | 0.0034 | 103 |
| connectome_4B | 2 | 0.355→0.299 | 6.11→6.20 | 0.70 | 0.0246 | 0.0236 | 0.0034 | 106 |
| connectome_4C | 2 | 0.323→0.386 | 5.71→7.65 | 0.84 | 0.0242 | 0.0272 | 0.0056 | 115 |

| comparison | metric | phase | mean A | mean B | Δ | p_raw | p_BH | g | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 4A vs 4C shuffled (test dT) | dTfinal | test | 0.027 | 0.024 | 0.002 | 1.00e+0 | 1.00e+0 | 0.40 | DEGENERATEcontrast: not evaluable as positive evidence |
| 4A vs 4C shuffled (test ΔH) | sortEntropy | test | 0.026 | 0.027 | -0.002 | 1.00e+0 | 1.00e+0 | -0.11 | DEGENERATEcontrast: not evaluable as positive evidence |
| 4A vs 4B restricted (test dT) | dTfinal | test | 0.027 | 0.025 | 0.002 | 3.38e-1 | 1.00e+0 | 1.73 | DEGENERATEcontrast: not evaluable as positive evidence |
| 4A vs 4B (test MI) | miNeural | test | 0.003 | 0.003 | -0.000 | 1.00e+0 | 1.00e+0 | -0.05 | DEGENERATEcontrast: not evaluable as positive evidence |

## E5

| condition | n | openFrac train→test | crossings/ep train→test | g:B (cond, test) | dT (test) | ΔH (test) | MI (test) | bits/trial |
|---|---|---|---|---|---|---|---|---|
| classical_demon | 2 | 0.521→0.498 | 7.40→6.85 | 1.31 | 0.0271 | 0.0291 | 0.0000 | 100 |
| ann | 2 | 0.994→0.994 | 21.52→19.95 | 0.72 | 0.0194 | 0.0164 | 0.0574 | 21 |
| drosophila | 2 | 0.004→0.000 | 0.10→0.00 | n/a | 0.0288 | 0.0317 | 0.0041 | 0 |
| connectome | 2 | 0.300→0.322 | 5.80→6.95 | 0.44 | 0.0265 | 0.0257 | 0.0034 | 103 |
| shuffled_connectome | 2 | 0.323→0.386 | 5.71→7.65 | 0.84 | 0.0242 | 0.0272 | 0.0056 | 115 |

| comparison | metric | phase | mean A | mean B | Δ | p_raw | p_BH | g | verdict |
|---|---|---|---|---|---|---|---|---|---|
| classical vs ann (test dT) | dTfinal | test | 0.027 | 0.019 | 0.008 | 3.38e-1 | 4.51e-1 | 2.06 | DEGENERATEcontrast: not evaluable as positive evidence |
| classical vs ann (test ΔH) | sortEntropy | test | 0.029 | 0.016 | 0.013 | 3.38e-1 | 4.51e-1 | 1.10 | DEGENERATEcontrast: not evaluable as positive evidence |
| connectome vs shuffled (test dT) | dTfinal | test | 0.027 | 0.024 | 0.002 | 1.00e+0 | 1.00e+0 | 0.40 | DEGENERATEcontrast: not evaluable as positive evidence |
| connectome vs classical (test g:B cond.) | goodBadRatio | test | 0.439 | 1.307 | -0.868 | 3.38e-1 | 4.51e-1 | -0.82 | DEGENERATEcontrast: not evaluable as positive evidence |

## E6

| condition | n | openFrac train→test | crossings/ep train→test | g:B (cond, test) | dT (test) | ΔH (test) | MI (test) | bits/trial |
|---|---|---|---|---|---|---|---|---|
| classical_demon | 2 | 0.512→0.483 | 7.33→7.75 | 1.26 | 0.0266 | 0.0270 | 0.0000 | 98 |
| random | 2 | 0.376→0.354 | 7.02→6.00 | 1.22 | 0.0259 | 0.0292 | 0.0000 | 12 |
| never_gate | 2 | 0.000→0.000 | 0.00→0.00 | n/a | 0.0299 | 0.0368 | 0.0000 | 0 |

| comparison | metric | phase | mean A | mean B | Δ | p_raw | p_BH | g | verdict |
|---|---|---|---|---|---|---|---|---|---|
| demon vs never_gate (test ΔH) | sortEntropy | test | 0.027 | 0.037 | -0.010 | 3.38e-1 | 3.38e-1 | -1.00 | DEGENERATEcontrast: not evaluable as positive evidence |
| random vs never_gate (test ΔH) | sortEntropy | test | 0.029 | 0.037 | -0.008 | 3.38e-1 | 3.38e-1 | -1.38 | DEGENERATEcontrast: not evaluable as positive evidence |
| demon vs never_gate (test extractable) | extractableJ | test | 0.000 | 0.000 | -0.000 | 3.38e-1 | 3.38e-1 | -0.98 | DEGENERATEcontrast: not evaluable as positive evidence |

## E7

| condition | n | openFrac train→test | crossings/ep train→test | g:B (cond, test) | dT (test) | ΔH (test) | MI (test) | bits/trial |
|---|---|---|---|---|---|---|---|---|
| classical_demon | 3 | 0.499→0.484 | 12.27→12.27 | 1.93 | 0.0252 | 0.0274 | 0.0000 | 93 |

## E8

| condition | n | openFrac train→test | crossings/ep train→test | g:B (cond, test) | dT (test) | ΔH (test) | MI (test) | bits/trial |
|---|---|---|---|---|---|---|---|---|
| demon_adaptive | 2 | 0.512→0.483 | 7.33→7.75 | 1.26 | 0.0266 | 0.0270 | 0.0000 | 98 |
| demon_fixed | 2 | 0.512→0.483 | 7.33→7.75 | 1.26 | 0.0266 | 0.0270 | 0.0000 | 98 |
| demon_mem4 | 2 | 0.512→0.483 | 7.33→7.75 | 1.26 | 0.0266 | 0.0270 | 0.0000 | 98 |

| comparison | metric | phase | mean A | mean B | Δ | p_raw | p_BH | g | verdict |
|---|---|---|---|---|---|---|---|---|---|
| adaptive vs fixed (test openFraction) | openFraction | test | 0.483 | 0.483 | 0.000 | 1.00e+0 | 1.00e+0 | 0.00 | DEGENERATEcontrast: not evaluable as positive evidence |
| adaptive vs fixed (test dT) | dTfinal | test | 0.027 | 0.027 | 0.000 | 1.00e+0 | 1.00e+0 | 0.00 | DEGENERATEcontrast: not evaluable as positive evidence |
| adaptive vs mem4 (test dT) | dTfinal | test | 0.027 | 0.027 | 0.000 | 1.00e+0 | 1.00e+0 | 0.00 | DEGENERATEcontrast: not evaluable as positive evidence |
| adaptive vs fixed (test bits) | measuredBits | test | 98.292 | 98.292 | 0.000 | 1.00e+0 | 1.00e+0 | 0.00 | DEGENERATEcontrast: not evaluable as positive evidence |

## E7 · physics regimes

| seed | regime | test g:B (cond) | test dT | test ΔH |
|---|---|---|---|---|
| 1 | 120 particles / noise 0.00 (sparse-clean) | 2.50 | 0.0254 | 0.0274 |
| 102 | 640 particles / noise 0.30 (dense-noisy) | 1.63 | 0.0411 | 0.0522 |
| 203 | 320 particles / noise 0.12 (default) | 1.62 | 0.0091 | 0.0028 |

## E9

| condition | n seeds | test-phase metrics: mean ± CI |
|---|---|---|
| demon_neural | 10 | workJEp 0.000 ± 0.000; netWorkJ -0.000 ± 0.000; reward -7.547 ± 0.241; decisionAccuracy 0.517 ± 0.016; demonAgree 0.490 ± 0.013; dPfinal 0.897 ± 0.018; openFraction 0.516 ± 0.017; dopamineMean -1.145 ± 0.018; weightDrift 498.397 ± 23.138; crossings 1.658 ± 0.176; spikeRate 0.059 ± 0.011; valveFlips 695.083 ± 12.803 |
| demon_frozen | 10 | workJEp 0.000 ± 0.000; netWorkJ -0.000 ± 0.000; reward -7.501 ± 0.244; decisionAccuracy 0.520 ± 0.016; demonAgree 0.495 ± 0.012; dPfinal 0.875 ± 0.018; openFraction 0.508 ± 0.015; dopamineMean -1.147 ± 0.016; weightDrift 0.000 ± 0.000; crossings 1.617 ± 0.171; spikeRate 0.044 ± 0.009; valveFlips 696.267 ± 12.179 |
| demon_speed | 10 | workJEp 0.000 ± 0.000; netWorkJ -0.000 ± 0.000; reward 0.000 ± 0.000; decisionAccuracy 0.911 ± 0.019; demonAgree 1.000 ± 0.000; dPfinal 0.880 ± 0.012; openFraction 0.072 ± 0.017; dopamineMean 0.000 ± 0.000; weightDrift 0.000 ± 0.000; crossings 1.292 ± 0.115; spikeRate 0.000 ± 0.000; valveFlips 150.475 ± 9.278 |
| demon_random | 10 | workJEp 0.000 ± 0.000; netWorkJ -0.000 ± 0.000; reward 0.000 ± 0.000; decisionAccuracy 0.363 ± 0.017; demonAgree 0.546 ± 0.011; dPfinal -0.014 ± 0.038; openFraction 0.302 ± 0.010; dopamineMean 0.000 ± 0.000; weightDrift 0.000 ± 0.000; crossings 16.125 ± 0.707; spikeRate 0.000 ± 0.000; valveFlips 575.933 ± 12.709 |
| never_open | 10 | workJEp 0.000 ± 0.000; netWorkJ -0.000 ± 0.000; reward 0.000 ± 0.000; decisionAccuracy 0.187 ± 0.031; demonAgree 0.626 ± 0.013; dPfinal 0.017 ± 0.027; openFraction 0.000 ± 0.000; dopamineMean 0.000 ± 0.000; weightDrift 0.000 ± 0.000; crossings 0.000 ± 0.000; spikeRate 0.000 ± 0.000; valveFlips 0.000 ± 0.000 |

| comparison | metric | mean A | mean B | Δ | p_raw | p_BH | g | verdict |
|---|---|---|---|---|---|---|---|---|
| neural vs frozen (workJEp) | workJEp | 7.96e-24 | 7.43e-24 | 5.32e-25 | 1.95e-3 | 2.34e-3 | 0.53 | THERMODYNAMICALLY NEGLIGIBLE (both arms < 10% of one Landauer bit; no positive evidence) |
| neural vs frozen (netWorkJ) | netWorkJ | -3.98e-18 | -3.98e-18 | 4.71e-24 | 1.95e-3 | 2.34e-3 | 0.47 | NEGLIGIBLE relative to condition means (delta < 1% of |mean|; no positive evidence) |
| neural vs frozen (decisionAccuracy) | decisionAccuracy | 0.5168 | 0.5199 | -0.0031 | 1.95e-3 | 2.34e-3 | -0.11 | SUCCESS_SMALL_EFFECT |
| neural vs frozen (weightDrift; manipulation check) | weightDrift | 498.3973 | 0.0000 | 498.3973 | 1.95e-3 | 2.34e-3 | 18.08 | SUCCESS |
| speed vs frozen (workJEp; reference competence) | workJEp | 7.25e-24 | 7.43e-24 | -1.81e-25 | 7.27e-1 | 7.27e-1 | -0.15 | THERMODYNAMICALLY NEGLIGIBLE (both arms < 10% of one Landauer bit; no positive evidence) |
| speed vs neural (decisionAccuracy) | decisionAccuracy | 0.9109 | 0.5168 | 0.3941 | 1.00e-4 | 6.00e-4 | 13.38 | SUCCESS |

## E10

| condition | n seeds | test-phase metrics: mean ± CI |
|---|---|---|
| trapdoor_light | 10 | netSortedProxy 0.300 ± 0.517; crossingRate 0.985 ± 0.024; holdFraction 0.000 ± 0.000; decisionAccuracy 0.000 ± 0.000; reward 0.000 ± 0.000; weightDrift 0.000 ± 0.000; demonAgree 0.000 ± 0.000; spikeRate 0.000 ± 0.000 |
| trapdoor_heavy | 10 | netSortedProxy 0.370 ± 0.509; crossingRate 0.659 ± 0.067; holdFraction 0.000 ± 0.000; decisionAccuracy 0.000 ± 0.000; reward 0.000 ± 0.000; weightDrift 0.000 ± 0.000; demonAgree 0.000 ± 0.000; spikeRate 0.000 ± 0.000 |
| trapdoor_neural | 10 | netSortedProxy 0.190 ± 0.265; crossingRate 0.481 ± 0.069; holdFraction 0.415 ± 0.027; decisionAccuracy 0.731 ± 0.026; reward -1.522 ± 0.090; weightDrift 2.841 ± 0.462; demonAgree 0.561 ± 0.023; spikeRate 5.871 ± 0.833 |
| trapdoor_frozen | 10 | netSortedProxy 0.220 ± 0.359; crossingRate 0.325 ± 0.066; holdFraction 0.519 ± 0.016; decisionAccuracy 0.711 ± 0.021; reward -1.406 ± 0.167; weightDrift 0.000 ± 0.000; demonAgree 0.501 ± 0.014; spikeRate 5.068 ± 1.668 |

| comparison | metric | mean A | mean B | Δ | p_raw | p_BH | g | verdict |
|---|---|---|---|---|---|---|---|---|
| neural vs frozen (netSortedProxy) | netSortedProxy | 0.1900 | 0.2200 | -0.0300 | 2.27e-1 | 2.27e-1 | -0.06 | DIRECTION_ONLY |
| light vs heavy flap (crossingRate; physics sanity) | crossingRate | 0.9850 | 0.6594 | 0.3256 | 1.00e-4 | 4.00e-4 | 3.81 | SUCCESS |
| neural vs frozen (decisionAccuracy) | decisionAccuracy | 0.7306 | 0.7114 | 0.0192 | 1.95e-3 | 2.60e-3 | 0.48 | SUCCESS_SMALL_EFFECT |
| neural vs frozen (holdFraction) | holdFraction | 0.4147 | 0.5190 | -0.1043 | 1.95e-3 | 2.60e-3 | -2.81 | SUCCESS |

## E11

| condition | n seeds | test-phase metrics: mean ± CI |
|---|---|---|
| ratchet_gradient | 10 | netPerEpisode 7.226 ± 0.540; workJEp 0.000 ± 0.000; netWorkJ 0.000 ± 0.000; liftFraction 0.000 ± 0.000; entropyProduction 6.416 ± 0.211; decisionAccuracy 0.000 ± 0.000; reward 0.000 ± 0.000; demonAgree 0.000 ± 0.000; weightDrift 0.000 ± 0.000; spikeRate 0.000 ± 0.000 |
| ratchet_equilibrium | 10 | netPerEpisode -2.011 ± 0.401; workJEp -0.000 ± 0.000; netWorkJ -0.000 ± 0.000; liftFraction 0.000 ± 0.000; entropyProduction 5.789 ± 0.221; decisionAccuracy 0.000 ± 0.000; reward 0.000 ± 0.000; demonAgree 0.000 ± 0.000; weightDrift 0.000 ± 0.000; spikeRate 0.000 ± 0.000 |
| ratchet_heavy_load | 10 | netPerEpisode 6.993 ± 0.593; workJEp 0.000 ± 0.000; netWorkJ 0.000 ± 0.000; liftFraction 0.000 ± 0.000; entropyProduction 9.949 ± 0.173; decisionAccuracy 0.000 ± 0.000; reward 0.000 ± 0.000; demonAgree 0.000 ± 0.000; weightDrift 0.000 ± 0.000; spikeRate 0.000 ± 0.000 |
| ratchet_neural | 10 | netPerEpisode -1.922 ± 0.446; workJEp -0.000 ± 0.000; netWorkJ -0.000 ± 0.000; liftFraction 0.410 ± 0.101; entropyProduction 3.248 ± 0.619; decisionAccuracy 0.741 ± 0.054; reward -11.811 ± 0.957; demonAgree 0.476 ± 0.034; weightDrift 29.255 ± 3.813; spikeRate 0.611 ± 0.264 |
| ratchet_frozen | 10 | netPerEpisode -1.788 ± 0.378; workJEp -0.000 ± 0.000; netWorkJ -0.000 ± 0.000; liftFraction 0.505 ± 0.018; entropyProduction 2.567 ± 0.169; decisionAccuracy 0.690 ± 0.022; reward -12.087 ± 1.048; demonAgree 0.501 ± 0.019; weightDrift 0.000 ± 0.000; spikeRate 0.749 ± 0.298 |

| comparison | metric | mean A | mean B | Δ | p_raw | p_BH | g | verdict |
|---|---|---|---|---|---|---|---|---|
| gradient vs equilibrium (netPerEpisode; 2nd law boundary) | netPerEpisode | 7.2257 | -2.0106 | 9.2363 | 1.00e-4 | 7.00e-4 | 11.52 | SUCCESS |
| gradient vs heavy load (netPerEpisode; load response) | netPerEpisode | 7.2257 | 6.9927 | 0.2330 | 5.76e-1 | 5.76e-1 | 0.24 | DIRECTION_ONLY |
| neural vs frozen (netPerEpisode) | netPerEpisode | -1.9216 | -1.7881 | -0.1335 | 1.95e-3 | 2.28e-3 | -0.19 | SUCCESS_SMALL_EFFECT |
| neural vs frozen (reward; learning acts) | reward | -11.8110 | -12.0875 | 0.2765 | 1.95e-3 | 2.28e-3 | 0.16 | SUCCESS_SMALL_EFFECT |
| neural vs frozen (decisionAccuracy) | decisionAccuracy | 0.7409 | 0.6896 | 0.0513 | 1.95e-3 | 2.28e-3 | 0.74 | SUCCESS |
| neural vs frozen (weightDrift; manipulation check) | weightDrift | 29.2553 | 0.0000 | 29.2553 | 1.95e-3 | 2.28e-3 | 6.44 | SUCCESS |
| neural vs frozen (entropyProduction) | entropyProduction | 3.25e+0 | 2.57e+0 | 6.81e-1 | 1.95e-3 | 2.28e-3 | 0.89 | SUCCESS |

## E9 · sensory–motor correlation diagnostic (preregistered)

- per-seed Pearson r(sensoryActivity, motorActivity), test+train episodes pooled per seed: mean 0.290 ± 0.114 (n=10 seeds)

## Thermodynamic ledger summary (test phase)

| experiment | condition | workIn J/trial | extractable J/trial | erasureCost J/trial | bits used | bits needed |
|---|---|---|---|---|---|---|
| E1 | classical_demon | 3.30e-11 | 1.96e-16 | 2.82e-19 | 98 | 68,427 |
| E2 | ann | 3.13e-11 | 1.52e-16 | 6.23e-20 | 22 | 53,029 |
| E2 | random | 3.26e-11 | 1.92e-16 | 3.41e-20 | 12 | 66,939 |
| E3 | drosophila | 3.22e-11 | 2.13e-16 | 0.00e+0 | 0 | 74,175 |
| E3 | drosophila_frozen | 3.17e-11 | 1.90e-16 | 3.09e-20 | 11 | 66,060 |
| E4 | connectome_4A | 2.19e-11 | 1.97e-16 | 2.95e-19 | 103 | 68,586 |
| E4 | connectome_4B | 2.21e-11 | 1.79e-16 | 3.06e-19 | 106 | 62,539 |
| E4 | connectome_4C | 2.20e-11 | 1.74e-16 | 3.29e-19 | 115 | 60,733 |
| E5 | classical_demon | 2.27e-11 | 1.97e-16 | 2.87e-19 | 100 | 68,646 |
| E5 | ann | 2.16e-11 | 1.34e-16 | 6.01e-20 | 21 | 46,837 |
| E5 | drosophila | 2.17e-11 | 2.13e-16 | 0.00e+0 | 0 | 74,104 |
| E5 | connectome | 2.19e-11 | 1.97e-16 | 2.95e-19 | 103 | 68,586 |
| E5 | shuffled_connectome | 2.20e-11 | 1.74e-16 | 3.29e-19 | 115 | 60,733 |
| E6 | classical_demon | 3.30e-11 | 1.96e-16 | 2.82e-19 | 98 | 68,427 |
| E6 | random | 3.26e-11 | 1.92e-16 | 3.41e-20 | 12 | 66,939 |
| E6 | never_gate | 3.21e-11 | 2.22e-16 | 0.00e+0 | 0 | 77,256 |
| E8 | demon_adaptive | 3.30e-11 | 1.96e-16 | 2.82e-19 | 98 | 68,427 |
| E8 | demon_fixed | 3.30e-11 | 1.96e-16 | 2.82e-19 | 98 | 68,427 |
| E8 | demon_mem4 | 3.30e-11 | 1.96e-16 | 2.82e-19 | 98 | 68,427 |

**Reading:** bits_needed = extractable work priced in Landauer bits at 300 K. bits_used ≪ bits_needed ⇒ the observed sorting is **jet-subsidized, not information-driven** in this implementation. Efficiency = extractable/work_in ≈ 1e-5 ≪ 1: no second-law challenge. E3-drosophila and E6-never_gate report 0 metered bits because the closed door makes no crossing evaluations (the same closed-door policy); their ΔH under the jet equals the never-gate subsidy.
