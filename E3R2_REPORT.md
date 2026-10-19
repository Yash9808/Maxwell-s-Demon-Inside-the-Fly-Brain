# E3R2 Report — Preregistered Reward-Shaping Study for the Door-Avoidance Collapse

**Date:** 2026-09-21 · **Branch:** `deployment/phase-02` · **Preregistration:** `PRE_REGISTERED_CRITERIA_E3R2.json` (written before any R2 outcome existed; calibration amendments — 720-step episode basis, κ event-rate framing, `vanilla_rerun` amendment — all made and timestamped in-session **before** the first R2 campaign data was generated).

**Scope discipline:** no changes to the neural architecture, the physics (`experiment_core.js`), the trial engine, or `controllers.js`/`experiment_worker.js` (both carry a collaborator's uncommitted edits). The intervention is a purely additive wrapper (`e3r2_wrapper.js`) around the unmodified `drosophilaController`.

---

## 1. FACT — what was measured (raw, seed-level, n=20 seeds/arm)

Environment identical to R1: 320 particles, noise 0.12, doorHeight 64, 12 s episodes, dt=1/60, TRAIN 300 / TEST 60, seed rule `env = 1 + s*101`, controller RNG `envSeed ^ 0x5f5f` (verified identical to R1's rule).

TEST-phase seed-level means (good − bad crossings per episode; 95% t-CI, df=19):

| arm | g−b / episode | openFraction | verdict-relevant note |
|---|---|---|---|
| **R2A_cost** (shaping κ=0.005/step) | −1.682 ± 1.978, CI [−2.607, −0.756] | 0.409 [0.192, 0.626] | engaged again (R1: 0.000) |
| **R2A_frozen** (shaping, plasticity off) | −1.823 ± 2.104, CI [−2.808, −0.839] | 0.448 [0.210, 0.685] | engagement reproduced without plasticity |
| **R2B_floor** (exploration floor p=0.05) | 0.000 ± 0.000 | 0.000 [0, 0] | collapses again at test |
| **R2B_frozen** | −1.762 ± 2.026 | 0.448 | — |
| **random** | −1.894 ± 0.391 | 0.384 | task-difficulty anchor |
| **vanilla_rerun** (unmodified brain, current code) | 0.000 ± 0.000 | 0.000 | collapse persists in current codebase |

R1 anchor drift (disclosed FACT): frozen-arm g−b was −1.04/ep in the R1 campaign, −1.76…−1.82/ep here — the collaborator's `controllers.js` edits since R1 measurably changed frozen-brain behavior. This is why the preregistered amendment reran the vanilla arm in the current codebase instead of reusing archived R1 rows.

## 2. Preregistered endpoints — outcomes

**Gates**
- **G1 engagement:** openOK ✓ (0.409 ≥ 0.10), crossingsOK ✓ → **G1 PASS**. The shaping broke the absorbing state (R1: 100% of seeds collapsed; R2A: mean open 0.409).
- **G2 stability:** SD(R2A)=1.978 ≤ 3×SD(frozen)=6.312 → **PASS**.

**Primary P1** (R2A_cost − R2A_frozen, paired per-seed, TEST g−b):
d = **0.142**, Hedges' g = **0.04**, 95% CI [−1.300, 1.584], sign-flip permutation p = **0.836**, n = 20.
Success required p_adj < 0.05 AND g ≥ 0.5 AND G1 → **not met**.

**Secondaries (BH-FDR q=0.05):**
- **S1** floor ablation (R2B_floor − R2B_frozen): d = 1.762, g = 0.83, q = 0.006 — *significant, but see §3: this is a metric artifact, not demon evidence.*
- **S2** package effect (R2A_cost − vanilla_rerun): d = **−1.682**, q = 0.001 — the shaped arm is *significantly worse than the collapsed arm's 0.00* on g−b, because engagement exposes it to the task's punishment asymmetry.
- **S3** within-arm late−early (R2A): d = −0.041, q = 0.517 — no adaptation trend under shaping.
- **S4** absolute selectivity (R2A g−b > 0): obs −1.682, CI [−2.607, −0.756] → **failed**.
- **S5** collapse recurrence: **45%** of R2A seeds relapse (TEST openFraction < 0.02; criterion ≤10%) → **failed**.

## 3. INFERENCE — what the results mean

1. **The calibrated dwell cost did exactly what it was designed to do mechanically** (INFERENCE from G1 + dwell-event counts 2.8/ep vs predicted 3.6 × closed-fraction): it made silence costly, restored engagement, and raised test-phase crossings from ~0 to ~9/ep. The collapse is therefore *not* an unfixable pathology of the task interface — a one-channel, architecture-untouched signal suffices to re-open the door.
2. **Engagement is not learning.** P1's effect size (g = 0.04) shows the plastic brain extracts *nothing* from restored feedback beyond what a frozen brain does with the same shaping. Combined with S2 (engaged R2A scores worse on g−b than the silent collapsed policy) and S3 (no within-arm trend), the honest conclusion is:
   > **Under its current plasticity rule, the drosophila brain cannot convert calibrated crossing feedback into improved door selectivity on this task, even when feedback is guaranteed to flow.**
3. **The feedback channel is value-broken for learning, not just for engagement** (INFERENCE from R1 anchors + S2): with P(good) ≈ 0.39–0.41 for every unselective policy, net crossing feedback is negative; the dwell cost cannot fix selectivity because the *informative* component of the signal (which crossings are good) has near-zero learnable structure at this brain's timescale. A future attempt (would require new preregistration E3R3) should target the feedback *content* (e.g., advantage/baseline centering or counterfactual-good labeling), not the feedback *rate*.

## 4. EXPLORATORY — non-citable observations

- **S1 is silence-as-ceiling.** R2B_floor "significantly beat" its frozen control only because the collapsed policy produces zero crossings and hence zero punishment — the same hollow victory that made R1's closed door ace dTfinal/sortEntropy. Do not quote S1 as evidence that forced exploration helps. (g−b without an engagement floor rewards not playing.)
- Per-seed scatter (plots/E3R2_P1_paired.png) shows 2–3 R2A seeds at high engagement *and* near-zero g−b — the ceiling any real learning would have to beat — and no seed at positive g−b.
- R2A seeds that stayed open through test (55%) show g−b ≈ −1.9 ± 0.4, statistically indistinguishable from the random policy (−1.894): an open, unselective door *is* the random policy on this metric.

## 5. Disclosures (scope notes, no outcome impact)

- **Frozen-arm identity check:** 1140/1200 TEST rows are byte-identical between R2A_frozen and R2B_frozen; one seed differs because the R2B wrapper's floor-coin consumes controller-RNG draws during TRAIN, shifting the shared stream for that seed's rare RNG branch at test. All preregistered contrasts are *within-mode* (P1 within R2A, S1 within R2B), so both arms of each contrast share any shift; no contrast is affected.
- Shaping was TRAIN-only for both cost and floor; TEST behavior is purely the learned policy (plasticity off, overlays off), per preregistration.

## 6. Verdict

**FAILURE** (preregistered sense of §falsifiability: G1 holds — engagement restored — but P1 does not meet the success criterion, so the fix is *not validated as a learning fix*). Per the preregistration, any parameter retuning or feedback-content redesign requires a new prospective registration (E3R3); none has been performed.

The two robust deliverables of this study: (a) the collapse is fully reversible at the interface level by a calibrated closed-door cost (G1, FACT); (b) the limiting factor is the plasticity rule's inability to exploit restored feedback (P1/S2/S3, FACT-level measurements, INFERENCE-level conclusion).

## 7. Deliverables

- Code: `e3r2_wrapper.js`, `e3r2_campaign.js`, `e3r2_analyze.js`, `e3r2_plots.py`
- Data: `research_data/validation/E3R2_RAW.csv` (43,200 rows), `E3R2_SUMMARY.csv`, `E3R2_TESTS.csv`, `E3R2_EFFECTS.csv`, `E3R2_metadata.json`, `E3R2_RAW_PILOT.csv`
- Plots: `research_data/validation/plots/E3R2_trajectory.png`, `E3R2_P1_paired.png`
- Preregistration: `PRE_REGISTERED_CRITERIA_E3R2.json`

**E3R2 COMPLETE — verdict FAILURE (preregistered criteria), engagement restored, learning absent.**
