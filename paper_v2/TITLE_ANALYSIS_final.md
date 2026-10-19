# FINAL TITLE ASSESSMENT (post E1–E11)

## Original working title

> **Learning to Act as Maxwell's Demon: A Connectome-Constrained Computational Study of Information-Based Learning in the Drosophila Brain**

## Validity classification

# VALID WITH MODIFICATION

## Evidence supporting the assessment

**What holds (and is kept):**
- *"Connectome-Constrained Computational Study"* — accurate and demonstrated (E4/E5/E9–E11 use the FlyWire FAFB v783 circuit as a fixed controller; E4 quantifies real-vs-shuffled wiring; the connectome demonstrably constrains spike dynamics and MI, Fig 3a/4a).
- *"Drosophila Brain"* scope — accurate for the connectome experiments (the circuit is the adult fly brain at proofread v783 scope).
- *"Learning"* — the program does contain genuine, measured learning: DA-gated plasticity changes policy (E3 door closes; E9 weight drift 498 vs 0, p_BH = 2.3e-3; E11 reward/accuracy improve vs frozen). Learning is real.

**What fails (and must be modified):**
1. *"as Maxwell's Demon"* — the title asserts successful demon-like performance. The evidence contradicts this on three independent grounds:
   - **Subsidy**: ΔH with the jet running equals/exceeds agent conditions for a never-gate control with zero information (E6: 0.037 vs 0.027 bits).
   - **Ledger**: bits_used (10–120) is 3–4 orders below bits_needed (≈4.7–7.7 ×10⁴) for the extractable work in every condition (Fig 3b).
   - **Competence**: the neural valve is at chance vs the one-line physical rule (0.517 vs 0.911, E9); real wiring ≈ shuffled wiring on task behaviour (E4/E5); no condition sorts selectively better than random gating (E1's 1.26 vs random's 1.22 conditional ratio).
   The demon frame is a *task and accounting scheme* in this study — the honest finding is the negative verdict, not the performance.
2. *"Information-Based Learning"* — information was measured and budgeted, but learning is reward-gated, not information-driven; the measured behavioural price of reduced information (E8) was zero. "Information-based" would misdescribe the mechanism. The accurate phrase is **information-limited** / **information-budgeted**.

## Per-term consistency check (title ↔ abstract ↔ intro ↔ results ↔ figures ↔ discussion)

- "Maxwell's Demon" → explained in Intro §1.2 as a task frame; §30 checklist answered in MANUSCRIPT §2.3/§3.1 (what is modeled: speed-selective gating + Landauer accounting; what is demonstrated: the subsidy and the ledger; what is NOT demonstrated: information-driven sorting, thermodynamic violation). PASSES only after rewording to a test/budget framing.
- "Learning" → E3/E9/E11 evidence exists. PASSES.
- "Connectome-Constrained" → E4/E5/E9–E11 + control comparison. PASSES.
- "Information-Based" → measured MI/bits, but no evidence the learning is based on information. FAILS → replaced by "Information-Limited"/"budgeted".
- "Drosophila Brain" → PASSES with the computational-scope caveat carried in the text (abstract: "model Drosophila brain").

## Alternative titles (5–10, scientifically distinct framings)

**A1. Mechanism-focused**
- Title: *Dopamine-Gated Plasticity Learns Door Policies, Not Selective Sorting: A Connectome-Constrained Spiking Study*
- Supported by: E3 (policy collapse), E9/E11 (learning acts, work negligible), E2 (ANN lock-open).
- Potential issue: foregrounds the failure; less discoverable for demon-literature searches. Confidence: High.

**A2. Thermodynamics/information-budget focused**
- Title: *An Energy- and Information-Budgeted Maxwell-Demon Task for Neural Controllers: Sorting Is Jet-Subsidized in a Simulated Drosophila Brain*
- Supported by: E6 (subsidy), ledger (E1–E8), E9 (negligible work), E11 (gradient boundary).
- Potential issue: longer; "jet-subsidized" is jargon until defined. Confidence: High.

**B1. Connectome-focused**
- Title: *What a Real Fly Connectome Can and Cannot Learn: Shuffled-Wiring Controls on a Maxwell-Demon Task*
- Supported by: E4 (real vs shuffled), E5, E9–E11 (brain as valve/flap/pawl).
- Potential issue: "can and cannot" phrasing is broad; content supports it but reviewers may want narrower scope. Confidence: Medium-High.

**C1. Information-processing focused (RECOMMENDED — used as final title)**
- Title: *Information-Limited Sorting by a Connectome-Constrained Spiking Controller: An Energy- and Information-Budgeted Test of Demon-Like Behaviour in a Model Drosophila Brain*
- Supported by: all of E1–E11 (MI in E5; budgets in E1–E8/E9; limits in E8; constraint in E4).
- Potential issue: long; two-clause structure. Confidence: High.

**D1. Computational-neuroscience focused**
- Title: *Connectome-Constrained Reinforcement Learning Under a Thermodynamic Audit: Negative Results from a Demon Task*
- Supported by: E3/E9/E11 learning machinery + ledger.
- Potential issue: "negative results" framing may undersell the boundary result (E11 gradient). Confidence: Medium.

**E1. Biological-insight-focused**
- Title: *A Simulation Study of Whether Fly-Brain Wiring Supports Demon-Like Gating: Dynamics Yes, Task Competence No*
- Supported by: E4/E5 (constraint without competence), E9 (chance-level decisions).
- Potential issue: colloquial "Yes/No" style. Confidence: Medium.

**F1. General-principle focused**
- Title: *Sorting Is Not Demonstrating: External Work Subsidy and Landauer Accounting Separate Demon Performance from Demon Claim*
- Supported by: E6 + ledger (the principle is general).
- Potential issue: the program supports the principle as applied here, but only within this apparatus; a general-principle claim would need broader evidence. Confidence: Low-Medium (not used).

## Final scientific framing

A seeded, controlled, connectome-constrained computational study that (i) implements a demon task with full energy/information accounting, (ii) demonstrates that dopamine-gated learning changes policy without producing selective sorting, (iii) shows real connectome wiring constrains dynamics without conferring task competence against shuffled controls, and (iv) reproduces the second-law boundary on the apparatus. Its contribution is a **negative-control standard and an explicit budget** for future demon-style demonstrations with neural controllers.

## Final title (used consistently across manuscript, figures, legends, supplementary, metadata)

> **Information-Limited Sorting by a Connectome-Constrained Spiking Controller: An Energy- and Information-Budgeted Test of Demon-Like Behaviour in a Model Drosophila Brain**

Recorded: original working title preserved above; change is explicit, not silent.
