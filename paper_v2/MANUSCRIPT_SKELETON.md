# MANUSCRIPT SKELETON — Nature Portfolio Article format

Working title (**per `paper_v2/TITLE_DECISION_MEMO.md`**):

> **Information-limited sorting by a connectome-constrained spiking controller: an energy- and information-budgeted test of demon-like behaviour in a model Drosophila brain**

Skeleton built on the `build_nature_paper_docx.py` Article map (Summary /
untitled Introduction / Results R1–R5 / Discussion / References / Methods M1–M8
/ legends / data-code availability). Every content bullet is keyed to the
evidence trail: `paper_v2/MANUSCRIPT.md` (authoritative numbers),
`paper_evidence/evidence_log.md` (fresh 2026-09-28 session),
`paper_evidence/figures/combined_*.png` (panels), `paper_v2/analysis/ANALYSIS_RESULTS.json`.

Format constraints honored: no "Introduction" heading in print; Results before
Discussion; Methods after References; figure legends collected after Methods;
fully-referenced ~200-word summary.

---

## Summary paragraph (~200 words, fully referenced)

1. **Problem.** Maxwell's demon asks whether measurement can power sorting;
   what a biologically measured wiring diagram can actually achieve on such a
   task is untested. *(key: MANUSCRIPT.md §1 Problem)*
2. **Approach.** Seeded program E1–E11 in a simulated ideal-gas chamber:
   FlyWire FAFB v783 connectome (106,765 neurons, ~5.6×10⁵ signed edges) as a
   spiking controller on a door, valve, trapdoor and ratchet; dopamine-gated
   plasticity; every trial carries the energy/information ledger; a live
   closed-loop embodiment couples the same brain to a MuJoCo flybody.
   *(keys: MANUSCRIPT.md §2; evidence_log CL section)*
3. **Key numbers.** Comparator: classical demon 1.00 ±0.00 vs drosophila
   0.50 ±0.05 ≈ shuffled connectome 0.48 ±0.05 (fresh E5); learning changes
   policy, not sorting (E3 open 0.497→0.000); jet-subsidy ≥ never-gate (E6);
   bits used 10–120 ≪ bits needed ≈4.7–7.7×10⁴ (ledger); valve accuracy 0.517
   vs 0.911 (E9); rectification only under a gradient, +7.23 vs −2.01 (E11).
4. **Significance.** In this implementation sorting is jet-subsidized, not
   information-driven; real wiring constrains dynamics without conferring
   task competence; the program delivers a negative-control standard and an
   explicit budget for connectome-constrained "demon" demonstrations.

## Introduction (no heading in print; ~700 words, 5 paragraphs)

1. ¶1 Maxwell's demon → information thermodynamics (Szilard, Landauer,
   Bennett; experimental demons). *(manuscript refs Block A/B)*
2. ¶2 Brains as physical information processors; reinforcement as the
   measure→act bridge.
3. ¶3 Why *Drosophila*: FAFB connectome, mushroom-body circuitry, dopaminergic
   reinforcement — the parts list for measure→represent→decide→act.
4. ¶4 The gap: structure from connectomics, policy from learning — does a
   measured connectome suffice for a closed-loop information task? State the
   demo-vs-controlled-experiment trap (uncontrolled pilot 1.55→4.56 did not
   survive controls; MANUSCRIPT.md "single-seed pilot" paragraph).
5. ¶5 Contribution: six controller classes under identical physics, full
   thermodynamic audit, live MuJoCo embodiment, seeded protocol E1–E11.

## Results (~1,200 words, 5 subsections)

- **R1 — Sorting under identical physics is comparator-dominated.** Fresh E5
  comparator ordering (classical 1.00 > drosophila 0.50 ≈ shuffled 0.48);
  browser cards + CI reruns agree; "compare rows, not trials".
  *(Fig: combined_e5.png; Fig. 3 lineage)*
- **R2 — Dopamine-gated learning changes policy, not sorting.** E3 policy
  collapse (0.497→0.000, fresh rerun); E2 ANN lock-open; E9/E11 learning
  machinery verified (weight drift 498 vs 0; reward −11.81 vs −12.09) while
  work stays negligible. *(Fig: combined_e3.png, combined_e9/11.png; Fig. 12)*
- **R3 — Real wiring constrains dynamics without conferring competence.**
  E4 real vs restricted vs shuffled (test ΔT Δ +0.002, p_BH = 1.0); MI differs
  (0.0034 vs 0.0070 bits) while behaviour does not; E5 shuffled parity.
  *(Figs: combined_e4.png, combined_brain_outcome.png; Figs 8–11)*
- **R4 — The thermodynamic audit: sorting is jet-subsidized.** E6 causal
  decomposition; ledger bits-used ≪ bits-needed; E9 valve cannot pay one
  Landauer bit (≈8×10⁻²⁴ J). *(Figs: combined_e6.png, combined_e1.png; Fig. 13b, Fig. 15)*
- **R5 — Boundaries, robustness and the live closed loop.** E7 regime sweep
  (classical selectivity persists: 2.50/1.63/1.62); E8 information budgets;
  E10 Smoluchowski flap (heavier door passes fewer: 0.985 vs 0.659, no net
  sorting); E11 second-law boundary; **closed-loop FlyBody/MuJoCo: 9/9 causal
  gates PASS at 240 steps, two independent entry points (browser one-click,
  deterministic CLI)**. *(Figs: combined_e7/e8/e10/e11.png, combined_CL_locomotion.png; Fig. 13a)*

## Discussion (~800 words)

1. Behavioural convergence without mechanistic convergence — what agreement
   with the classical rule does and does not imply.
2. Why the subsidy dominates: decomposition (E6) and the ledger; "demon" as
   task frame, not performance claim (decision-memo §4 lens note).
3. Honest scope: computational model, single sensory-drive operating point,
   proofread-subset connectome with predicted transmitter signs.
4. Second law: no violation; rectification requires the gradient (E11).
5. Outlook: routes to a possible positive result (credit assignment pairing,
   local-speed sensory interfaces, sparse topology-sensitive regimes — labeled
   PREDICTION, MANUSCRIPT.md §6); the negative-control standard for future
   demonstrations.

## References (~30, Nature numbered superscript style)

- Block A: Maxwell's demon & information thermodynamics.
- Block B: Landauer principle & experimental demons.
- Block C: *Drosophila* mushroom body, dopamine, learning (incl. Schlegel 2024 cell types).
- Block D: FlyWire/FAFB v783 connectomics.
- Block E: LIF dynamics, three-factor rules, RL.
- Block F: Information measures & statistics.
- Note: per-trial results cited as E1–E11 with traceability to
  `paper_v2/analysis/ANALYSIS_RESULTS.json`; the known DOI gap is disclosed,
  not silently filled.

## Methods (after References; unlimited)

- **M1 — Connectome data & circuit construction.** FAFB v783 materialization,
  NT classification, edge signing, layer assignment; fireVec quantization.
- **M2 — Gas-chamber physics.** Door/valve/trapdoor/ratchet parameters
  (chamber sizes, particle counts, springs, baths) — MANUSCRIPT.md M-tables.
- **M3 — Sensory interface.** 8-channel valve adapter; fairness contract.
- **M4 — Controllers.** D1–D7 (classical rule, ANN, drosophila mini-circuit,
  connectome, restricted-plasticity, degree-preserving shuffle, random/never).
- **M5 — Neural dynamics & learning rule.** LIF + CSR; DA-gated eligibility
  {0.90/0.45, 0.985/0.35, 0.9995/0.20}; REINFORCE readout (γ=0.99) for E9–E11.
- **M6 — Experimental protocol E1–E11.** Nature-Protocols-style step-by-step
  Procedure + Timing; seeds `1 + (base+idx)·101`; 10 apparatus seeds.
- **M7 — Metrics.** Selectivity, ΔT, good:bad conditionals, sort entropy, MI
  (Miller–Madow), Landauer bill (2.871×10⁻²¹ J), extractable work.
- **M8 — Statistics & reproducibility.** Seed = independent replicate; 10,000-
  draw permutation; Hedges' g; BH-FDR q=0.05; DEGENERATE /
  THERMODYNAMICALLY NEGLIGIBLE / NEGLIGIBLE verdict gates; determinism tests.
- **M9 (this session) — Evidence capture & live closed loop.** Headless
  browser harness (CDP) for cards/figures; `paper_program.js` CI reruns;
  closed-loop routes (worker `run_cl` → sidecar ws → FlyBody/MuJoCo; sidecar
  episode logs `embodiment/logs/`); harness-disclosure note for the
  `/api/sidecar` launcher shim (loop untouched; `paper_evidence/evidence_log.md`).

## Figure legends (after Methods; one bold title line + description each)

- **Fig. 1** Pipeline schematic (Stages A–G) — `combined_brain_outcome.png` pairs
  the connectome render (n=106,765; 564,030 mapped edges; app Save-PNG
  provenance) with the behavioural outcome.
- **Fig. 2** Door-task learning curves (E3 policy collapse; E2 lock-open).
- **Fig. 3** Comparator bars, fresh E5 ordering (1.00 / 0.50 / 0.48 ± CI).
- **Fig. 4** Neural information (MI by region; real vs shuffled).
- **Fig. 5** Thermodynamic budget (work-in / extractable / Landauer / bits).
- **Fig. 6** Decision-loop flow-chart; visual abstract = the six-lab session
  figure; live-capture panels from `paper_evidence/raw/stage_*.png` as
  Extended Data; CL locomotion panel (`combined_CL_locomotion.png`) as the
  embodiment figure.

## Data & code availability (after Methods)

- Data: `paper_v2/raw/` (per-trial JSONL, incl. fresh E3/E5 reruns),
  `paper_v2/processed/`, `paper_v2/analysis/ANALYSIS_RESULTS.json`,
  `paper_evidence/` (captures + evidence log), sidecar episode logs.
- Code: experiment engines, `paper_v2/paper_program.js`, analysis + figure
  scripts, `tools/closed_loop_runner.js`; connectome extract sha256 recorded.
- Reproduction: `node paper_v2/paper_program.js --door | --e3 | --e5 |
  --e9 | --e10 | --e11`, then analysis + figure scripts; browser evidence
  reproducible via the logged harness commands; CL:
  `PYTHON_EMBODIMENT=.venv-embodiment/Scripts/python.exe node
  tools/closed_loop_runner.js --steps 240 --seed 11`.

---

*Traceability:* title decision `paper_v2/TITLE_DECISION_MEMO.md`; evidence
`paper_evidence/evidence_log.md`; numbers `paper_v2/MANUSCRIPT.md` (fresh-session
additions marked). No app code was changed for any figure or number.
