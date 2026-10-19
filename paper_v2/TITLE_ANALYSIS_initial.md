# INITIAL TITLE VALIDATION (pre-execution)

**Date:** 2026-09-23 (before the E1–E11 paper run; after manifest + code inspection)

**Original working title:**
> Learning to Act as Maxwell's Demon: A Connectome-Constrained Computational Study of Information-Based Learning in the Drosophila Brain

## Component-by-component assessment (based on specifications only)

| Title component | Evidence status from E1–E11 specs | Assessment |
|---|---|---|
| **"Learning to Act"** | E2 (ANN), E3 (PN→KC→MBON DA-gated plasticity), E4 (connectome plasticity variants), E9 (policy-gradient readout on the motor pool) all contain train→test structure with dopamine-gated learning. E3/E4/E9 preregistered verdicts are largely NO_EVIDENCE for the *learning* claims at multi-seed scale. | Supported as an *investigated property*, but the title asserts it as accomplished. Must be re-judged after analysis. |
| **"as Maxwell's Demon"** | E1 is a classical demon; E2–E5 couple agents to a demon *task*; E6 decomposes ΔH causally (jet-subsidy); E8 prices measurement/memory; E9–E11 are explicit second-law apparatus (pressure demon, Smoluchowski trapdoor, Feynman ratchet). The thermo-ledger (work_in, extractable, Landauer bits_used vs bits_needed) is built into every row. | The demon *frame* is genuinely central — but the honest finding is that the agents act as *gate/valve controllers* and the sorting they produce is largely jet-subsidized, NOT thermodynamically demon-like. "As Maxwell's Demon" risks asserting the thing the apparatus is designed to test and (per existing evidence) refutes. |
| **"Connectome-Constrained"** | E4 (4A real vs 4B restricted vs 4C shuffled), E5, E9–E11 inject the real FAFB v783 circuit (106,765 neurons, 563,942 edges) as the controller. | Accurately describes the methodology. |
| **"Computational Study"** | All E1–E11 are simulations; no biological measurement. | Accurate. |
| **"Information-Based Learning"** | miNeural (mutual information between neural activity and particle state) is measured in E1–E8 rows; E8 manipulates measurement/memory; E6 quantifies bits_used vs bits_needed. | Information is *measured*, but "information-based learning" implies the learning is driven by information gain; the evidence (so far) shows learning is reward-gated and information-limited. Needs re-judgment post-run. |
| **"Drosophila Brain"** | The connectome is the full adult fly brain (FAFB v783); E1/E2/E6/E7/E8 use toy or compact networks instead. | Scope is defensible for the connectome experiments (E4, E5, E9–E11) but overstates E1/E2/E6/E7/E8, which are abstract agents. |

## Maxwell's demon terminology disposition (per prompt §9)

The program treats "Maxwell's demon" as a **task frame and thermodynamic accounting scheme** (speed-selective gate + Landauer ledger), not as a physical Maxwell demon. The apparatus explicitly measures *whether* the sorting is information-driven; the preregistered E6-style decomposition and the bits_used ≪ bits_needed ledger are designed to detect the opposite (jet-subsidized sorting). Any final title implying the model *is* a working Maxwell demon would overclaim.

## Preliminary classification (provisional, pre-execution)

**VALID WITH MODIFICATION** (provisional). Concerns:

1. "Learning to Act as Maxwell's Demon" implies successful demon-like thermodynamic performance; the thermo-ledger is designed to quantify exactly why that is not the finding.
2. "Information-Based Learning" should become e.g. "information-limited" or "information-budgeted" if the E8/E6 pattern holds.
3. "Drosophila Brain" is precise only for the connectome-constrained subset; consider "connectome-constrained" retaining the brain scope via "Drosophila connectome".

## Preliminary alternative framings (to be re-scored after E1–E11)

- Mechanism-focused: "…information-limited sorting by a connectome-constrained spiking controller…"
- Thermodynamics-focused: "…an information and energy budget for demon-like sorting in a simulated fly brain…"
- Connectome-focused: "…real connectome wiring versus shuffled controls on a demon task…"

None adopted at this stage. Final classification deferred until E1–E11 complete (§25–§31 of the program).
