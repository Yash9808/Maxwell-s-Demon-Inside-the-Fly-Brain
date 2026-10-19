# FIGURE LEGENDS — E1–E11 paper program

All panels are generated from the experimental outputs of this study (`paper_v2/raw/`, processed in `paper_v2/processed/`, statistics in `paper_v2/analysis/STATISTICS_REPORT.md`). Machine-readable provenance for every panel: `paper_v2/figures/PROVENANCE.json`. The independent replicate is the **seed** (door experiments: seed = 1 + seedIdx·101; apparatus experiments: seed = 1 + (seedTag−1)·101). Error bars/CI are t-based 95% confidence intervals over per-seed values. All quantities are measures of the simulated apparatus, not biological measurements.

---

## Figure 1 — Experimental program overview (conceptual schematic)

**Panel a** — Conceptual schematic of the E1–E11 program: chamber/apparatus layer (E1–E8 door task; E9–E11 pressure, trapdoor, and ratchet engines), agent classes (engineered gate, ANN, PN→KC→MBON network, FAFB connectome controller), dopamine-gated plasticity, the trial-level thermodynamic ledger (work_in, extractable work, Landauer erasure bill, bits_used vs bits_needed), information measures (MI between neural activity and particle state; measurement/memory budgets in E8; causal ΔH decomposition in E6), and the central question of whether demon-like sorting is information-driven or jet-subsidized.

*Note: this figure contains no experimental data; it is a schematic of the program structure drawn from `experiments/e1.json`–`e11.json` and is explicitly labeled as such on the figure.*

---

## Figure 2 — Learning and behavioral performance

**(a)** E3 (Drosophila-inspired network): door open fraction per 12-trial block, learning arm vs frozen control. Thin lines: per-seed trajectories (2 seeds); thick lines with markers: cross-seed means. The learning arm collapses to a closed-door policy (open fraction ≈ 0 by the second block); the frozen control is bimodal across seeds (one brain draw parks the door open at ≈0.99, the other closed at ≈0.00). Dashed line at trial 60 marks the train→test boundary. Source: `E3_rows.jsonl`; related statistic: drosophila vs frozen test openFraction, Δ = −0.497 (STATISTICS_REPORT §E3).

**(b)** E2/E5: test-phase door open fraction for the engineered classical demon, the learned ANN, and the random controller (bars = cross-seed means; black dots = per-seed means, n = 2 seeds each). The ANN locks the door open (≈0.994), the random policy sits at ≈0.35, the classical demon at ≈0.48. Source: `E2_rows.jsonl`, `E5_rows_s*.jsonl`.

**(c)** E5 comparator study: test-phase ΔT (final left-minus-right temperature difference, sim units) per seed for all five agent classes (box = interquartile structure of per-seed means with n = 2 seeds; overlay points = individual seeds). Classical demon and Drosophila-inspired (closed-door) conditions show the largest ΔT; the ANN lock-open policy the smallest. Source: `E5_rows_s*.jsonl`; statistics in STATISTICS_REPORT §E5.

**(d)** E9 (pressure demon): motor-pool activity vs sensory-pool activity for the FAFB brain-driven valve (each point = one episode; n = 10 seeds pooled). Pooled Pearson r = 0.27; per-seed mean r = 0.29 ± 0.11 (t-based 95% CI over 10 seeds) — evidence of sensory-to-motor transmission through the connectome, with large seed-to-seed variability. Source: `E9_rows.jsonl`; STATISTICS_REPORT §E9 diagnostic.

---

## Figure 3 — Information and thermodynamic budget

**(a)** E5: test-phase mutual information (bits) between binarized neural population activity and particle-state samples, per condition (n = 2 seeds per condition). The ANN (door locked open) carries the most MI; classical-demon and random conditions register zero by design of the binarization (no gated variability). Source: `E5_rows_s*.jsonl`.

**(b)** Thermodynamic ledger for E1–E8 (test phase): metered bits used per trial (decision flips + crossing evaluations) versus bits needed = extractable work of the final sorted state priced in Landauer bits (k_B·300 K·ln2 per bit). Both axes logarithmic. Bits used (10–120) are 3–4 orders of magnitude below bits needed (≈4.7×10⁴–7.7×10⁴) in every condition — the observed sorting is jet-subsidized, not information-driven. Source: `ANALYSIS_RESULTS.json` (thermoLedger), computed from `E1–E8_rows.jsonl`.

---

## Figure 4 — Connectome constraint and second-law boundary

**(a)** E4: test-phase ΔT per seed for the real FAFB connectome (full plasticity), the sensory-restricted-plasticity variant, and the degree-preserving shuffled connectome (n = 2 seeds per condition; heavy line = mean ± 95% CI). Real and shuffled wiring are behaviourally indistinguishable at this sensory-drive level (ΔT contrast 4A vs 4C: +0.002, p_BH = 1.0). Source: `E4_rows_s*.jsonl`; STATISTICS_REPORT §E4.

**(b)** E10 (Smoluchowski trapdoor): test-phase crossing rate per seed for the passive light flap, passive heavy flap, brain-gated flap, and frozen-brain flap (n = 10 seeds per condition). The light-vs-heavy contrast is the physics sanity check (0.985 vs 0.659, p_BH = 4×10⁻⁴, g = 3.8); no active-sorting advantage appears (neural vs frozen net transport: Δ = −0.03, DIRECTION_ONLY). Source: `E10_rows.jsonl`; STATISTICS_REPORT §E10.

**(c)** E11 (Feynman ratchet & pawl): test-phase net rotation per episode for the thermal-gradient bath (T_h > T_c), the equilibrium bath (T_h = T_c), and the gradient with a heavier load (n = 10 seeds per condition). Rectification appears only with a temperature gradient (7.23 vs −2.01 steps/episode, p_BH = 7×10⁻⁴, g = 11.5) — the second-law boundary; the brain-pawl at equilibrium extracts no work. Source: `E11_rows.jsonl`; STATISTICS_REPORT §E11.

---

## Figure 5 — Circuit mechanism (behavioural and manipulation evidence)

**(a)** E9: test-phase valve open fraction per seed for the five valve controllers (n = 10 seeds each; heavy line = mean ± 95% CI). The neural valve spends ≈0.52 of each episode open, indistinguishable from frozen; the classical speed rule ≈0.07; random ≈0.30; never-open = 0. Source: `E9_rows.jsonl`.

**(b)** E9: test-phase decision accuracy (agreement with the classical speed-reference rule) per seed. The speed rule agrees with itself by construction (1.0); the neural (0.52) and frozen (0.52) valves are at chance, random at 0.36, never-open at 0.19. Chance = 0.5 (dotted). Source: `E9_rows.jsonl`; STATISTICS_REPORT §E9.

**(c)** Manipulation checks that learning machinery was active: E9 cumulative weight drift (learning arm ≈ 498, frozen = 0 by construction) and E10 hold fraction (learning 0.415 vs frozen 0.519, p_BH = 2.6×10⁻³, g = −2.8). Points = per-seed test-phase means. Source: `E9_rows.jsonl`, `E10_rows.jsonl`.

*Interpretation (belongs to Results, repeated here only as scope): these panels establish that the connectome machinery runs and learns, not that it outperforms controls.*

---

## Figure 6 — Robustness

**(a)** E7 generalization sweep: test-phase good:bad crossing ratio (conditional on crossings > 0) for the classical demon in three physics regimes, one regime per seed (sparse/clean 120 particles & noise 0; dense/noisy 640 particles & noise 0.30; default 320/0.12). Selectivity persists in all regimes (2.50, 1.63, 1.62). Source: `E7_rows.jsonl`.

**(b)** E8 information-limited demons: test-phase door open fraction for adaptive, fixed-threshold, and 4-decision-memory demons (n = 2 seeds each). The three variants are behaviourally identical in this regime — reduced explicit memory does not change the door policy. Source: `E8_rows.jsonl`; STATISTICS_REPORT §E8 (all contrasts degenerate/zero).

**(c)** Learning arms on the apparatus: per-seed reward change from train to test (E9 neural valve; E11 neural pawl; n = 10 seeds each). E9: Δ = −0.05 (no evidence of improvement); E11: Δ = +0.28 (small but significant reward increase vs frozen; p_BH = 2.3×10⁻³). Source: `E9_rows.jsonl`, `E11_rows.jsonl`; STATISTICS_REPORT §E9/§E11.

---

## Figure 7 — Integrated summary

**Panel a** — Top: schematic of the modeled information→action chain (environment → 8-channel sensing → FAFB connectome processing → decision → gate/valve/flap/pawl action → behavioural consequence). Bottom: measured results classified by evidence class — OBSERVED (dopamine-gated learning changes policy in E3/E9/E11; ΔH under the jet matches the never-gate subsidy in E6; bits_used ≪ bits_needed in E1–E8; real ≈ shuffled wiring behaviourally in E4/E5), INFERRED (demon-like sorting in this implementation is jet-subsidized, not information-driven; the connectome constrains dynamics but not task competence at this sensory drive), and HYPOTHESIS (richer sensory pairing or credit assignment could change the E9 work outcome — testable, not established).

*Note: the chain is a schematic; only the bottom boxes report measured results, each traceable to the statistics report.*

---

# FIGURE LEGENDS — Brain-level and synthesis figures (Figs 8–15)

Rendering basis for all brain panels: real FAFB v783 anatomy — 106,765 neuron positions (`fly_brain_positions.json`), 46 neuropil hull meshes (`fly_brain_hulls`), published cell-type annotations (Schlegel et al. 2024; `fly_brain_celltypes.json`). Activity shown is **connectome-constrained MODEL neural activity**: per-neuron spike counts decoded from the simulation's quantized `fireVec` payloads (inverse sqrt quantization, c ≈ (q/16)², capped at 256). **These are not biological recordings.** Provenance: `figures/PROVENANCE.json`, `figures/PROVENANCE_fig14.json`, `figures/PROVENANCE_fig15.json`.

---

## Figure 8 — Brain outcome: 3D anatomy with simulated neural activity (E9)

**(a)** Whole-brain view (frontal orthographic projection of the FlyWire canonical frame): every neuron that fired at least once in the test phase, position = real FAFB soma coordinate, size/colour = decoded model spike counts per trial (trained E9 demon, n = 10 seeds, test phase; PowerNorm γ=0.35 spreads the heavy-tailed count distribution). Hull meshes of the 46 segmented neuropils provide anatomical context.

**(b)** Trained brain, zoomed to the 12 most-active neuropils. **(c)** Frozen-control brain (learning disabled), zoomed to its own 12 most-active neuropils. **(d)** Region-level quantification: total decoded activity in the top-10 neuropils, trained vs frozen (bars; n = 10 seeds/condition). Source: `E9_rows.jsonl` fireVec payloads → `processed/brain/ACT_E9_*.bin`.

---

## Figure 9 — Which neurons fired (E9)

**(a)** Ranked per-neuron activity (top 60 neurons, test phase, averaged over 10 seeds), coloured by primary neuropil. **(b)** Cell-type composition of the most-active neurons (Schlegel-2024 annotations; classes with ≥3 representatives). **(c)** Activity by broad neuropil class — sensory (optic/antennal), central, motor — demonstrating transmission through the connectome stack. **(d)** Distribution over all neurons: the large inactive fraction vs the sparse active population. *Interpretation scope:* OBSERVED — these neurons were active and differ between conditions; INFERRED — they may contribute to the computational distinction; no causal claim is made (no ablation was performed).

---

## Figure 10 — Learning-delta brain map (E9)

Learning delta = late-training minus early-training decoded per-neuron activity (early = first 5 training trials, late = remaining training trials, seeds 1–10).

**(a)** Early-training brain state. **(b)** Late-training brain state (same view/scale). **(c)** Delta mapped onto anatomy — blue = decrease, red = increase. **(d)** Distribution of per-neuron deltas. **(e)** Neuropils ranked by |total delta|. The delta concentrates in central-complex and lateral-horn populations, consistent with weight drift during training; it is a *model* delta (dopamine-gated plasticity), not a biological measurement. Source: `ACT_E9_*_early/late.bin`.

---

## Figure 11 — Neural mutual information mapped to brain regions (E9)

**(a)** MI (bits) between binarized per-neuropil model activity and binarized decision accuracy (above/below chance), per condition (n = 10 seeds; Miller–Madow corrected; mean ± SD across per-seed estimates) — only neuropils meeting the ≥5-seed requirement. Antennal-lobe and gnathal-ganglia populations carry the most task-relevant information in the trained brain. **(b)** The same MI values mapped onto the 3D brain (region colour = MI). **(c)** MI vs behaviour link: per-seed MI against per-seed decision accuracy (pooled Pearson r annotated). Source: `processed/brain/MI_E9.json`. Scope: discrete estimator on binarized variables; values are small (≈0.01–0.08 bits) and reported with seed-level dispersion.

---

## Figure 12 — Learning curves and demon-agreement across the program

**(a)** E9 pressure demon: decision accuracy per training episode — thin lines: 10 individual seeds; heavy line: cross-seed mean; dotted: chance (0.5). **(b)** E3 door task: door-open fraction per trial, learning arm vs frozen control (cross-seed means; the frozen control is bimodal across its 2 seeds). **(c)** E10/E11 apparatus: decision accuracy over training episodes (cross-seed means). **(d)** Demon-agreement metric (E1): fraction of trials where the agent's gate decision matches the information-ideal demon policy (exact definition in Methods §Demon-agreement metric). All replicates are seeds. Source: raw rows.

---

## Figure 13 — Preregistered predictions, thermodynamic budget, crossing ledger

**(a)** Preregistered predictions vs observed signs of the primary contrasts (from `PRE_REGISTERED_CRITERIA.json`, committed before the validation campaigns; verdicts from this run's analysis: as-predicted / direction-only / opposite). **(b)** E1 thermodynamic budget as MODEL quantities: work_in (jet/pump), extractable work of the sorted state, Landauer-bounded erasure accounting, and the landauerRatio — explicitly labeled model prices; no thermodynamic claim about biological tissue. **(c)** Crossing ledger: good (hot→cold) vs bad (cold→hot) counts per episode with conditional ratios. Source: `ANALYSIS_RESULTS.json`, `E1_rows.jsonl`.

---

## Figure 14 — Door-task brain outcome at honest scopes (E3/E4/E5)

The E3 drosophila controller simulates a 248-unit mushroom-body mini-circuit (32 PN + 200 KC + 16 MBON model units, `controllers.js`); its `fireVec` indexes **those units, not FAFB anatomy**. Figure 14 therefore renders E3 at mini-circuit scope and keeps the full-FAFB views for the connectome conditions.

**(a)** E3 MB mini-circuit unit-activity map, early training (248 units; PN/KC/MBON blocks shaded). **(b)** Late training. **(c)** Learning delta (late − early) per unit (diverging colour). **(d)** E3 `layerRates` trajectory across trials — PN, Kenyon-cell and MB-output model rates, learning arm (solid) vs frozen control (dashed); recorded on every row, independent of fireVec. **(e)** E5 connectome controller: full-FAFB region activity (test phase, top-12 neuropils; points = individual neurons, jittered; size/opacity = decoded counts). **(f)** E5 shuffled-wiring control, same rendering. **(g — inset file `figure14g_wiring_similarity`)** E4 neural similarity: Pearson correlation of per-neuron test-phase activity between wiring conditions (4A vs 4B real-real; 4A/4B vs 4C real-shuffled; dots = 2 seeds). Real–shuffled similarity (r ≈ 0.981) ≈ real–real (r ≈ 0.985): the neural echo of the behavioural null. Source: `MINI_E3.json`, `ACT_E3_*.bin`, `ACT_E5s0_*.bin`, `ACT_E4s?_connectome_4?_test.bin`.

---

## Figure 15 — Sorting-entropy reduction and the crossing ledger (E1–E6, E8)

**(a)** Sorting-entropy reduction ΔH = H_mixed − H_sorted (bits; E1 definition — Shannon entropy over fast/slow speed classes × chamber sides, `experiment_core.METRICS.sortingEntropy`) at end of trial, test phase, per condition; bars = cross-seed means, dots = per-seed means (n = 2 seeds; descriptive). This is a **Shannon** entropy of the sorted state — not a thermodynamic entropy. **(b)** Crossing ledger: good (hot→cold) and bad (cold→hot) crossing **counts** per episode (primary display), with the conditional good:bad ratio annotated only where the denominator is non-zero (the ratio is unstable as bad-crossings → 0). Source: `E1–E8_rows*.jsonl`.
