# Paper skeleton — Erdman-style (arXiv:2408.15328 / QST 10, 025047 (2025)) applied to this project

Model paper: *Artificially intelligent Maxwell's demon for optimal control of open quantum systems*
(Erdman, Czupryniak, Bhandari, Jordan, Noé, Eisert, Guarnieri, 2024/2025).
Its key structural moves, and how each maps onto our FAFB-connectome demon work.

## 0. What the model paper does (so the mapping is deliberate)

1. **Not IMRAD.** Methods are folded into early sections; results are organized **by physical regime**
   (thermalization-dominated / measurement-dominated / all timescales comparable), not by a generic "Results".
2. **The agent literally takes the demon role**: at each step it chooses actions (Unitary / Thermalize / Measure +
   a continuous control), observes a state that encodes acquired information, and conditions later actions on that history.
3. **Explicit thermodynamic budget as equations**: cooling power `P(t)` (time- and trajectory-averaged),
   Landauer erasure cost `W = β⁻¹ S({p_k})` for measurement outcomes, second-law averaging gives the
   efficiency bound `η = ⟨P⟩/⟨D⟩ ≤ 1`; the objective is a trade-off
   `F_c = c⟨P⟩ − (1−c)⟨D⟩`, visualized as a **Pareto front** with RL optima marked on it.
4. **Learned vs interpretable comparison**: every RL-discovered policy is paired with a simpler
   "interpretable policy" the authors construct from what the agent learned; the learned one wins modestly.
5. **Abstract arc**: motivate the domain → state the difficulty → introduce the method ("the agent takes
   the literal role of … demon") → regimes/discovered strategies (non-intuitive but interpretable) →
   significance and scaling.
6. **Rigor**: method detail moved to appendices (Appendix F = RL implementation); parameters stated inline;
   no preregistration found — ours is *stronger* on that axis and should show it.

## 1. Proposed section outline for our paper (title stays the pinned, outcome-neutral one)

Pinned title (unchanged until Stage-2 clears): *Information-Limited Sorting by a Connectome-Constrained
Spiking Controller: An Energy- and Information-Budgeted Test of Demon-Like Behaviour in a Model Drosophila Brain*.

1. **Introduction** — particle-sorting as a Maxwell-demon task; why a biological connectome is an interesting
   demon substrate; roadmap paragraph previewing each "regime" (our analog below) exactly as their intro does.
2. **The demon task chamber** (their "Quantum Maxwell's demon")
   - 2.1 Demon's optimization goals (their "Demon's optimization goals"): one gate `{target, pos}`, heat-jet
     pulsing, good/bad crossings, valence `q`, dopamine-gated plasticity; the budgets
     (energy injected by the jet, information available to the sensors).
3. **Connectorme-controller formulation** (their "RL formulation") — the role of their SAC agent is played by
   the FAFB v783 spiking brain (106,765 neurons / 553,807 edges); sensory injection channels ×7 (+8 obs in
   OFF-by-default tail), the gatekeeper FSM WATCH→ATTEND→HOLD→STRIKE→RECOIL, the door reflex; state what the
   controller observes, what it controls, and that its "policy" is fixed wiring + plasticity, not gradient training.
4. **Regime 1: jet-dominated** ↔ their thermalization-dominated. Behavior when the heat-jet timescale is fast
   relative to gate actuation: what strategy the FSM/brain settles into.
5. **Regime 2: gate/decision-dominated** ↔ their measurement-dominated. Behavior when gate actuation is fast:
   crossings-limited operation, sampling strategy.
6. **Regime 3: all timescales comparable** ↔ their two-qubit/entanglement section. Where the interesting
   strategies live; where we compare arms.
7. **Test of demon-likeness** (parallel to their learned-vs-interpretable + Pareto-front role):
   the preregistered confirmatory result — per-pair Δsort entropy, contrasts A−D (primary), A−B, A−C (Holm,
   permutation p-values from the pinned reference), with arm E as the floor check and the
   apparatus-coupling control (p = 2.0e-4 in both arms ⇒ covariance is apparatus-coupled, not obs-carried)
   as our honest null disclosure.
8. **Conclusion / outlook** — information limits of fixed wiring; scaling to larger connectomes.
   Appendices (their Appendix F pattern): RL/engine equivalent = experiment engine parameter tables,
   FSM transition table, plasticity rule, retention/gzip pipeline, prereg hashes.

## 2. The thermodynamic budget section (our analog of their P/D/η accounting)

State as equations, not prose:
- `J(t) ≈ (1/t)∫₀ᵗ |T_L − T_R| dt′` (already computed and plotted in Fig6/Fig9 of the exploratory set)
- Landauer erasure cost of the demon's memory per decision; jet energy injected per pulse;
  the sorting-entropy ledger already in `paper_v2/SUPPLEMENTARY.md` ("full thermodynamic ledger").
- Efficiency figure of merit: sorting gained per unit information available to the sensors — this is the
  quantity that makes "information-limited" in the title earn its place.
- **Pareto-front analog**: plot sorting performance against information use (or energy spent on learning)
  across arms A–D; the real-connectome point sits on this front or it does not — that picture, positive or
  null, is the paper's central figure (their Fig3 analog).

## 3. Figure mapping (their figure → ours)

| Erdman et al. | Ours | Status |
|---|---|---|
| Fig3: Pareto fronts + RL optima + interpretable-policy comparison | sorting performance vs information/energy budget across arms A–E | blocked on Stage-2 finalize |
| Figs4–6: Bloch-sphere action/state plots making the policy taxonomy visible | gate-state-resolved activity maps (Fig14 style: 10 time-matched cases), FSM-state ⟂ mean |T_L−T_R| distributions | exploratory versions exist (claude_anlsyse set) |
| adaptive-vs-fixed measurement comparison | obs_8 tail ON vs OFF (DEFAULT OFF; byte-identical when OFF) | exists; present as apparatus-coupling disclosure, not a performance claim |
| long-trajectory strategy examples (10,000 steps) | 400-s episode trajectories (crossing timelines, good/bad markers) | exist |

## 4. Abstract skeleton (their arc, our content, outcome-neutral)

1. Domain: molecular/thermal sorting via feedback control exposes the information–energy interplay.
2. Difficulty: a fixed biological wiring diagram cannot be trained end-to-end; its computed dynamics and
   plasticity must be shown either to use or to fail to use available information above an energy/information budget.
3. Method: we embed the FAFB v783 connectome as the controller of a Smoluchowski trapdoor gate and
   preregister a confirmatory multi-arm test against degree-preserved and parameter-matched controls.
4. Findings: (Stage-2 dependent) either the learned/plastic wiring sorts above the control arms by the
   preregistered margin, or sorting is information-limited — both phrasable without knowing the outcome.
5. Significance: what this says about information processing in real connectome-constrained controllers.

## 5. Sequencing (what has to happen before section 7/f Fig3 can be written)

1. Stage-2 campaign finalize (≈1,240/1,776 jobs done; keep the runner untouched).
2. Write + self-test + hash-pin `tools/stage2_analyze.js` BEFORE it reads Stage-2 rows (prereg §7 rule).
3. Run the preregistered analysis; then this skeleton's regime and budget sections get real numbers.
4. The exploratory claude_anlsyse figures may be reused only where relabeled exploratory / single-seed,
   per the §7 no-p-values-from-Stage-1 rule.
