# Information-Limited Sorting by a Connectome-Constrained Spiking Controller: An Energy- and Information-Budgeted Test of Demon-Like Behaviour in a Model Drosophila Brain

**Original working title (pre-registration of this manuscript's title analysis):**
*Learning to Act as Maxwell's Demon: A Connectome-Constrained Computational Study of Information-Based Learning in the Drosophila Brain*

**Final title (evidence-selected):** *Information-Limited Sorting by a Connectome-Constrained Spiking Controller: An Energy- and Information-Budgeted Test of Demon-Like Behaviour in a Model Drosophila Brain*

See `paper_v2/TITLE_ANALYSIS_final.md` for the classification decision, the evidence, and alternative titles. The title was changed openly, not silently, per the project's rules.

---

## Abstract

**Problem.** Maxwell's demon thought experiment asks whether an agent that measures molecular states can sort a gas and seemingly reverse entropy; real implementations must pay an information-thermodynamic bill, and it remains an open question what a biologically realistic neural controller *can* actually achieve on a demon-like task. **Approach.** We executed a preregistered-style, seeded experimental program (E1–E11) in which spiking controllers — an engineered speed gate, a small learned ANN, a Drosophila-inspired PN→KC→MB-output network with dopamine-gated plasticity, and a controller built from the FlyWire FAFB v783 connectome (106,765 neurons, 563,942 synapse-weighted edges) — operated a door, a pressure valve, a Smoluchowski trapdoor, and a Feynman ratchet in a simulated ideal-gas chamber. Every trial carried an energy/information ledger (external work in, extractable work out, Landauer erasure cost, metered bits). **Results.** Learning reliably changed policy but not towards demon-like sorting: dopamine-gated plasticity collapsed the Drosophila-inspired network's door policy shut (open fraction 0.497 → 0.000, n = 2 seeds vs frozen controls), the ANN locked the door open (0.994 from the first trial), and the connectome controller's behaviour was indistinguishable from a degree-preserving shuffled-connectome control (ΔT contrast +0.002, p_BH = 1.0). On the pressure apparatus, the neural valve matched its own frozen control (work per episode thermodynamically negligible, < 10⁻³ of one Landauer bit) while the classical speed rule reached 0.91 decision accuracy (neural: 0.52, chance 0.5; p_BH = 6×10⁻⁴). Causal decomposition showed sorting entropy with the jet running equalled or exceeded that of a never-gate control with zero metered information, and bits used per trial (10–120) fell 3–4 orders of magnitude below bits needed for the extractable work (≈4.7×10⁴–7.7×10⁴). The ratchet rectified only under a thermal gradient (7.23 vs −2.01 steps/episode, p_BH = 7×10⁻⁴, g = 11.5), reproducing the second-law boundary. **Significance.** In this implementation, demon-like sorting is jet-subsidized rather than information-driven, and a real connectome constrains dynamics without conferring task competence. The program provides a negative-control baseline and an explicit energy/information accounting standard for connectome-constrained "demon" demonstrations. **Limitations.** All results are computational, at a single sensory-drive operating point, with few seeds on the door task; the connectome is a proofread subset with predicted neurotransmitter signs.

---

## 1. Introduction

### 1.1 Information processing as a physical quantity in biological systems

Nervous systems are often described as information-processing organs, but the information they process is physically instantiated and physically paid for. Landauer's principle bounds the energy cost of erasing a bit; Szilard's engine and Maxwell's demon frame the converse question — how much work can be extracted per bit of measurement. These bounds are computational and thermodynamic statements about *any* implementation, biological or engineered.

### 1.2 Maxwell's demon, carefully stated

Maxwell's demon is a hypothetical agent that measures molecular speeds and opens a gate selectively, sorting fast from slow molecules without doing work. The modern resolution is accounting, not mystery: measurement and memory erasure carry entropy/energy costs, and any real sorting engine must balance its books. In this study, "demon" is used strictly as a **task frame**: a speed-selective gate operating on an idealized gas, with a full energy/information ledger recorded every trial. We do not claim, and our apparatus is not designed to test, any thermodynamic violation; the chamber's free energy comes from an external heat jet whose work is metered.

### 1.3 Learning and decision-making in Drosophila: computational entry points

The adult *Drosophila melanogaster* brain is the largest connectome currently mapped at synapse resolution in a behaving animal. Its mushroom-body circuit (projection neurons → Kenyon cells → output neurons, with dopamine-gated plasticity) is a canonical reinforcement-learning substrate, making it a natural candidate controller for reward-gated tasks.

### 1.4 Connectome-constrained computational neuroscience

Anatomical wiring can constrain neural models: fixed connectivity, realistic sign structure, and measured neuron counts turn a generic network into a specific hypothesis machine. Whether *fixed biological wiring plus simple plasticity* can learn a control task — compared against shuffled-wiring and no-plasticity controls — is an empirical question the present program is built to answer.

### 1.5 The gap addressed

Demon-style demonstrations with neural controllers typically report a learning curve and a sorting metric, but rarely report (i) shuffled-wiring controls, (ii) never-gate/jet-only controls that decompose *where* the sorting came from, or (iii) the Landauer bill of the controller's own memory traffic. Without these, a sorting curve cannot distinguish information-driven control from externally subsidized physics. This study is designed to make that distinction measurable.

### 1.6 Study objective

Execute the predefined experimental program E1–E11 (registry: `paper_v2/configs/experiment_registry.json`): comparator experiments on a demon door task (E1–E5, E6–E8 controls and information budgets), and closed-loop apparatus tests with the connectome brain as actuator controller (E9 pressure valve, E10 Smoluchowski trapdoor, E11 Feynman ratchet). Every experiment is seeded, train→test split, with the seed as the independent replicate.

---

## 2. Results

### 2.1 The experimental system (E1 anchor; Fig 1)

The E1 classical demon establishes the reference: an adaptive-threshold gate produces a good:bad crossing ratio of 1.26 (conditional on crossings) and ΔT ≈ 0.027 sim units, while metering ≈98 bits/trial against ≈6.8×10⁴ bits needed to "pay" for the ≈2×10⁻¹⁶ J of extractable work — the ledger that all subsequent conditions are read against. The program structure is shown in Figure 1 (schematic).

### 2.2 Learning changes policy — but not towards demon-like sorting (E2, E3; Fig 2a,b)

**E2 (ANN).** A small learned ANN held the door open for 99.4% of every episode from the first training trial onwards, with no learning-dependent change (crossings 21.6 → 21.5 per episode across training; Fig 2b). Its selectivity was worse than random (good:bad conditional 0.80 vs random 1.22; test ΔT lower than random, Δ = −0.004).

**E3 (Drosophila-inspired).** Dopamine-gated plasticity produced a clear, reproducible policy change — in the wrong direction for the task. The learning arm's door open fraction collapsed from 0.297 (trial 0) to ≈0 by trial 5 and stayed there for all 60 training trials and all test episodes (test open fraction 0.000 vs frozen control 0.497; Fig 2a). The frozen control (same circuit, learning disabled) maintained ≈10 crossings/episode; the learning arm made zero crossings and therefore zero metered bits. **This is a real learning effect (the policy moved), and it is a task failure: reward-gated plasticity in this circuit configures itself into a no-crossing policy rather than a selective one.** We verified the same collapse in the independent preregistered 20-seed campaign (0 crossings/episode in all 20 seeds and phases; `research_data/validation/raw_e3.csv`).

Because the learning arm never crosses particles, its ΔH (0.036) equals the never-gate subsidy (E6: 0.037) — it inherits the jet's sorting rather than producing its own.

### 2.3 Information processing: measured, but not load-bearing (E5 MI, E8, E6; Fig 3)

**Mutual information (E5).** The ANN condition carried the most neural MI with particle state (0.057 bits, test), consistent with its high-rate activity pattern; connectome conditions carried ≈0.003–0.007 bits; classical and random conditions register zero under the binarization used (no gated variability). MI did not predict sorting quality across conditions (classical demon: 0 bits, best selectivity).

**Information-limited demons (E8).** Reducing the demon's measurement/memory (fixed threshold; 4-decision memory) produced behaviourally identical policies to the adaptive demon (all contrasts exactly 0 in this regime; Fig 6b). The behavioural price of less measurement/memory was zero here — the task's bottleneck is not the demon's information budget.

**Causal decomposition (E6).** With the door welded shut (never-gate), ΔH was *higher* than with the demon gating (0.037 vs 0.027, test) — the jet alone sorts the gas as well as or better than the agents. Random gating (ΔH 0.029) also matched the demon. No agent's gating added measurable sorting over the jet subsidy.

**Thermodynamic ledger (E1–E8).** Bits used per trial (12–120) vs bits needed (4.7×10⁴–7.7×10⁴) across all door conditions (Fig 3b): the demon's memory traffic is negligible precisely because it barely memorizes. Efficiency (extractable/work_in) ≈ 6×10⁻⁶ — no second-law challenge anywhere in the program.

### 2.4 Connectome constraint: dynamics constrained, competence not conferred (E4, E5; Fig 4a)

The real FAFB controller (4A), its sensory-restricted-plasticity variant (4B), and the degree-preserving shuffled connectome (4C) were behaviourally indistinguishable on the door task: test ΔT 0.0265 vs 0.0242 (4A vs 4C, Δ +0.002, p_BH = 1.0, g = 0.40); good:bad conditional 0.44 (4A) vs 0.84 (4C) — numerically *worse* selectivity for real wiring, far from significance with n = 2 seeds (and consistent with the preregistered 12-seed/10-shuffle campaign's NO_EVIDENCE verdict, g = −0.11). In the E5 comparator, the connectome conditions sat between the lock-open ANN (worst ΔT) and the classical demon (best), with no anatomical advantage. **The connectome constrains the dynamics (real vs shuffled produce different spike patterns and different MI: 0.0034 vs 0.0070 bits) but does not produce better task behaviour at this sensory-drive operating point.**

### 2.5 Apparatus tests: the connectome brain as actuator controller (E9–E11; Figs 4b–c, 5, 12, 13)

**E9 (pressure demon).** The FAFB brain-driven valve learned (weight drift 498 vs frozen 0; manipulation check p_BH = 2.3×10⁻³) and its sensory and motor pools were correlated (per-seed r = 0.29 ± 0.11), confirming signal transmission. But its decisions were at chance vs the classical reference rule (accuracy 0.517 vs 0.911; p_BH = 6×10⁻⁴, g = 13.4), and its spring work was thermodynamically negligible in both arms (≈8×10⁻²⁴ J/episode vs one Landauer bit at 2.87×10⁻²¹ J — the valve cannot pay for a single bit of its own memory). The chamber did build pressure (ΔP 0.90 with an open valve vs 0.02 never-open), but pressure is built by *any* open valve, including random (ΔP −0.01 from symmetric openings). No learning advantage over frozen (all work/accuracy contrasts ≤ small effects; work contrasts thermodynamically negligible).

**E10 (Smoluchowski trapdoor).** Passive physics behaved as expected (light flap crossing rate 0.985 vs heavy 0.659; p_BH = 4×10⁻⁴, g = 3.8 — a heavier trapdoor passes fewer molecules, the Smoluchowski pressure effect). The brain-gated flap showed no net-transport advantage over frozen (Δ = −0.03 net crossings, DIRECTION_ONLY), and its higher crossing rate (0.48 vs 0.33) reflects *less* holding, not selective sorting. **The trapdoor cannot sort — as predicted — and the brain does not change that.**

**E11 (Feynman ratchet & pawl).** The ratchet rectified only with a thermal gradient: +7.23 steps/episode (Th > Tc) vs −2.01 at equilibrium (p_BH = 7×10⁻⁴, g = 11.5) — a clean second-law boundary result. The brain-pawl at equilibrium learned (reward −11.81 vs frozen −12.09, p_BH = 2.3×10⁻³; accuracy 0.741 vs 0.690, g = 0.74; weight drift 29 vs 0) but extracted no positive work (net rotation −1.92 vs −1.79). Entropy production was higher in the learning arm (3.25 vs 2.57), consistent with active pawl engagement costing energy rather than harvesting it.

### 2.6 Robustness (E7, E8; Fig 6)

The learning trajectories behind §2.5 are shown as replicate-level curves in Fig 12 (E9: 10 individual seed trajectories plus mean; E3 policy trajectory; E10/E11 training accuracy; and the demon-agreement metric — the fraction of trials on which the agent's gate decision matches the information-ideal demon policy, defined in Methods and the legend). Fig 13a sets the five preregistered primary endpoints against their observed signs from this run; Fig 13b shows the E1 thermodynamic budget as model quantities (work-in, extractable work, Landauer erasure bill, landauerRatio); Fig 13c shows the crossing ledger.

The classical demon's selectivity persisted across physics regimes (good:bad conditional 2.50 sparse/clean, 1.63 dense/noisy, 1.62 default), confirming the apparatus itself is robust; E8 showed the demon's information budget is not the bottleneck; E9/E11 learning effects were consistent across 10 seeds each.

### 2.7 Brain-level outcome: where the model's activity and learning deltas live (Figs 8–11, 14)

Because every connectome-controller trial logs a quantized per-neuron spike-count vector (`fireVec`, all 106,765 FAFB neurons), the model's neural state can be rendered on the real anatomy. **E9 (Fig 8):** test-phase activity concentrates in a sparse population (≈7–8×10³ of 106,765 neurons fire per trial-window), dominated by antennal-lobe, optic-lobe and gnathal-ganglia populations; the trained and frozen brains' most-active neuropil sets overlap but differ in magnitude (Fig 8d). **Which neurons (Fig 9):** the most-active units carry Schlegel-2024 cell-type annotations; activity spans sensory → central → motor classes, consistent with the transmission diagnostic in Fig 2d. **Learning delta (Fig 10):** late-minus-early training activity changes concentrate in central-complex and lateral-horn populations — the anatomical footprint of dopamine-gated weight drift, reported as a model delta. **Neural MI (Fig 11):** region-level MI between binarized activity and above-chance decisions is small (≈0.01–0.08 bits) but reproducible across seeds (n = 10), highest in AL/GNG populations; mapped onto anatomy in Fig 11b. All four figures are labelled *connectome-constrained model neural activity* — not biological recordings.

**Door-task brains at honest scopes (Fig 14).** The E3 learning arm runs a 248-unit mushroom-body mini-circuit (32 PN + 200 KC + 16 MBON), whose activity vectors index those model units — not FAFB space. Fig 14a–d therefore renders E3 at mini-circuit scope: unit-level early/late maps, the learning delta, and the PN/KC/MB-output layer-rate trajectory (learning vs frozen) that shows where the policy collapse is expressed. The full-FAFB renders are reserved for the connectome conditions: Fig 14e–f contrasts real vs shuffled wiring region activity (E5), and Fig 14g quantifies the neural similarity between wiring conditions — per-neuron test-phase activity under real wiring correlates r ≈ 0.981 with shuffled wiring, statistically indistinguishable from real-vs-real (r ≈ 0.985; 2 seeds each): **the neural echo of the behavioural null in §2.4.** The connectome constrains the *neural* dynamics far less than one might expect from the wiring change alone, because the task's sensory drive engages a small, robustly-active subnetwork.

### 2.8 Entropy reduction and the crossing ledger (Fig 15)

Sorting-entropy reduction ΔH (Shannon, E1 definition) by condition and the raw good/bad crossing counts (with conditional ratios annotated only where the denominator is non-zero) are shown together in Fig 15 — the counts-first display that makes the subsidy result visible: conditions that never gate (never-gate) or barely open (the collapsed E3 learning arm) still show ΔH ≈ 0.036–0.037 because the jet, not the agent, sorts the gas.

---

## 3. Discussion

### 3.1 Principal findings

Three negative results, each with a clear mechanism, and one boundary condition, hold the story together:

1. **Demon-like sorting in this implementation is jet-subsidized.** Never-gate and random-gate controls match or exceed the agents' sorting entropy; metered bits fall 3–4 orders below what the extractable work would require. Any claim that these controllers "act as Maxwell's demon" would fail its own ledger (OBSERVED, E6 + ledger).
2. **Dopamine-gated plasticity learns, but learns the wrong policy for sorting.** The Drosophila-inspired circuit collapses to a closed door; the ANN to an open one. Learning moves policy; it does not find selective gating (OBSERVED, E2/E3).
3. **Real connectome wiring constrains dynamics without conferring task competence.** Real vs shuffled wiring differ in spike statistics and MI but not in task behaviour; the brain-valve's decisions sit at chance vs a one-line physical rule (OBSERVED, E4/E5/E9; consistent with the preregistered campaigns).
4. **The second-law boundary holds.** Rectification requires a thermal gradient; neither the physics nor the brain-pawl extracts work at equilibrium (OBSERVED, E11).

### 3.2 The demon reading of the working title is not supported

The working title, "Learning to Act as Maxwell's Demon…", implies successful demon-like performance that the evidence contradicts on three independent grounds (subsidy, ledger, negative controls). We therefore recommend a title centred on what *was* demonstrated: information-limited sorting by a connectome-constrained controller, with the budgets measured. "Information-based learning" would likewise overstate: information was *measured* and *budgeted*, and its behavioural price (E8) was zero; learning was reward-gated, not information-driven.

### 3.3 What would change the verdict (HYPOTHESIS, testable)

The E9 sensory adapter already pairs demon-rate and fly-rate channels; the pairing diagnostic showed sensory→motor transmission. Plausible routes to a positive result: (i) richer credit assignment pairing the demon's rate with the fly's decision window; (ii) sensory interfaces that expose *local* speed structure (the physical observable a demon needs) rather than bulk pressure; (iii) drive regimes where topology matters (the optic-drive sweep found 0.25 is the sparsest regime where real vs shuffled wiring diverges at all). These are predictions of the model, not established mechanisms.

### 3.4 Relation to prior art in this workspace

A single-seed 9,000-frame pilot in this workspace reported a good:bad ratio rising from 1.55 to 4.56 (`learning_curve.json`). Our seeded, controlled program explains why that impression does not survive controls: the random and never-gate conditions match it (E6), and the preregistered multi-seed campaigns found NO_EVIDENCE for the learning claims (E3/E4/E9/E10/E11). This is precisely the gap between an uncontrolled demonstration and a controlled experiment.

### 3.5 Limitations

- **Computational only.** No biological measurement or validation is claimed; "Drosophila" refers to the connectome's source organism.
- **Single operating point.** Door-task results are at opticDrive 0.25 and one chamber configuration; the connectome controller was not tuned per task.
- **Few seeds on door tasks** (n = 2 per condition here; the preregistered campaigns supply n = 12–20 for the headline contrasts and agree with our verdicts).
- **Connectome incompleteness and predicted signs.** Proofread-scope FAFB v783 subset (106,765 of 139,255 neurons; ≥10-synapse aggregate edges; neurotransmitter signs are Buhmann-model predictions, not measurements).
- **Simplified physics.** Idealized 2-D-ish gas, thermal-wall thermostat, no conduction delays in the experiment path.
- **MI instrumentation.** Binarized trial-cumulative spike counts; MI values are lower bounds and instrument-sensitive.

---

## 4. Methods

### 4.1 Connectome and circuit

FlyWire FAFB materialization v783 (proofread scope; Dorkenwald et al. 2024), 139,255 proofread neurons, 16,847,997 aggregated connection rows with per-synapse neurotransmitter prediction scores (Buhmann et al. model). The executable circuit (`fly_brain_circuit.json`, sha256 0eb64ba4…) is a 5-layer visual subnetwork (AL → ME/LO/LOP → LH/MB → SMP/SIP/SLP → GNG/SAD) with 106,765 neurons and 563,942 synapse-weighted edges (≥10-synapse aggregate), signed by dominant predicted transmitter (cholinergic/glutamatergic excitatory, GABAergic inhibitory; DA/5-HT/OA exported as modulatory channels, 10,223 contacts). Optic-lobe neurons carry position-derived visual channels from presynaptic centroids (Stage F: 800-column hexagonal retinotopic field).

### 4.2 Controllers

- **classicalDemon**: adaptive speed-threshold gate (two-direction policy: slow-out-of-hot OR fast-back-into-hot).
- **annController**: small learned MLP on the same observations (E2/E5).
- **drosophilaController**: PN→KC→MB-output LIF network; 12-of-200 sparse KC expansion; dopamine-gated eligibility-trace plasticity (E3).
- **connectomeController**: LIF spiking over the FAFB circuit; CSR spike propagation; dopamine-gated plasticity with fast/mid/slow eligibility traces ({0.90/0.45, 0.985/0.35, 0.9995/0.20}); policy-gradient readout on the motor pool (REINFORCE, γ = 0.99, softmax over pool rates) for E9–E11; E10/E11 add reward-baseline centering and the KC sparse code as readout features. Degree-preserving shuffle for 4C/5-shuffled: out-degree and per-source weight multiset preserved, in-degree preserved, edge sign travels with the edge (sign composition per target not preserved — disclosed).
- **random / neverGate / saboteur**: controls.

### 4.3 Environments and apparatus

**Door task (E1–E8):** 760×380×300 chamber, center wall with a 0.6-gap double-guillotine door (height 64), 320 particles (E7 varies 120/640), noise 0.12 (E7 varies 0/0.30), heat jet (power 0.55, interval 3.5 s), 12 s episodes at dt = 1/60 s, max 50 crossings/trial. Metrics per trial: crossings (good = direction consistent with sorting), ΔT final, sorting entropy ΔH (bits), spatial H, open fraction, MI (binarized trial-cumulative spike counts vs particle-state samples), energy ledger (work_in from jet, extractable work of final state, Landauer erasure cost at 300 K, metered bits = decision flips + crossing evaluations). sim→Joule = 1×10⁻²¹.

**E9 pressure demon:** 900×420×420 chamber, 260 particles, piston+spring (k = 0.002, drag 0.35), 8-channel sensory adapter (local fast/slow/density in the valve approach box; left/right/Δ pressure; aperture; piston velocity), 0.25 s decision interval, reward = 0.5·work-rate + 0.3·selection + 0.2·wrong-action penalty terms (documented coefficients; W_NORM 0.02), 24 episodes (12 train/12 test) × 20 s, 10 seeds.

**E10 Smoluchowski trapdoor:** 760×300×300, 220 particles, spring flap (light 0.02 / heavy 0.12), open threshold 0.22, event-locked decisions (action 1 = release), 20 episodes (10/10) × 16 s, 10 seeds. netSortedProxy = crossLR − crossRL (documented derivation from raw row fields).

**E11 Feynman ratchet:** 24-tooth ratchet + pawl (lift barrier 0.1), load 0.055 (heavy 0.0825), two baths (gradient Th = 2.0/Tc = 1.0; equilibrium 1.0/1.0), 0.25 s decisions (action 1 = drop pawl), 20 episodes (10/10) × 12 s, 10 seeds.

### 4.4 Seeding and statistics

mulberry32 PRNG throughout. Door seeds: 1 + seedIdx·101 (E1–E3/E6/E8: 2 seeds; E4/E5: 2 seeds here; E7: 3 seeds = 1/102/203 with regimes 120/0.0, 640/0.30, 320/0.12 per manifest). Apparatus: core seed 1 + (seedTag−1)·101, brain draw rng 9176 + (seedTag−1)·37, PG readout rng 424243 + (seedTag−1)·977; 10 seeds (E9–E11). **The independent replicate is the seed**; trials/episodes are aggregated to per-seed phase means before any test. 95% CIs: t(0.975, n−1)·sd/√n. Unpaired contrasts: seeded label permutation (10,000 draws, PRNG 20260920); paired: sign-flip on per-seed differences. Effect size: Hedges' g. Multiple comparisons: Benjamini–Hochberg FDR (q = 0.05) within each experiment family. **Verdict gates**: contrasts with < 3 evaluable per-seed differences are reported as DEGENERATE and cannot support positive claims; work/energy contrasts where both arms < 10% of one Landauer bit (2.871×10⁻²¹ J) are THERMODYNAMICALLY NEGLIGIBLE; same-sign contrasts with |Δ| < 1% of the larger mean are NEGLIGIBLE. No runs were excluded; all seeds' data are retained in `paper_v2/raw/`.

### 4.5 Experiment configs

Machine-readable registry: `paper_v2/configs/experiment_registry.json`; manifests `experiments/e1.json`–`e11.json` (generated from the executable registry in `experiment_worker.js`; the code is the source of truth). Runner: `paper_v2/paper_program.js`; analysis: `paper_v2/paper_analysis.js`; figures: `paper_v2/paper_figures.py` (Figs 1–7), `paper_v2/paper_brain_figures.py` (Figs 8–13), `paper_v2/figure14_door_brains.py` (Fig 14), `paper_v2/figure15_entropy_ledger.py` (Fig 15); brain analytics: `paper_v2/brain_export.js` (fireVec decode → activity bins, region MI, mini-circuit bins).

### 4.5b Neural-state recording and brain rendering

Per-trial neural state: each controller exposes `fireVec`, a base64 Uint8 sqrt-quantization of per-unit spike counts (q = ceil(√c·16), c ≈ (q/16)², capped 256). Scope: the connectome controllers (E4/E5 connectome & shuffled; E9–E11 neural arms) record all 106,765 FAFB neurons; the E3 drosophila controller records its 248-unit MB mini-circuit (32 PN + 200 KC + 16 MBON); the E2/E5 ANN records its 18 units (16 hidden + 2 output). **Mini-circuit payloads are never mapped onto FAFB anatomy**; E3 is rendered at mini-circuit scope (Fig 14a–d) and the ANN behaviourally. Anatomy: FAFB v783 soma positions and 46 neuropil hull meshes in the documented canonical scene frame (co-registered; `fly_demon_3d.html` decoder). Region MI: neuropil-binned activity, median-split, vs binarized behaviour; plug-in estimator with Miller–Madow bias correction; per-seed estimates averaged (≥5 seeds required; E3's n = 2 → descriptive only). 3D rendering: fixed orthographic projection with painter's-sorted hull meshes and depth-coded markers — a visualization of real geometry, not a ray-traced renderer.

### 4.6 Data/figure provenance

Every figure panel's source files are recorded in `paper_v2/figures/PROVENANCE.json`; every analysis number in `paper_v2/analysis/ANALYSIS_RESULTS.json`; the full statistics narrative in `paper_v2/analysis/STATISTICS_REPORT.md`. Raw per-trial rows: `paper_v2/raw/E<k>_rows*.jsonl` (5,564 rows total). Processed per-seed data: `paper_v2/processed/`.

---

## 5. Data Availability

All data generated by this study are in the repository: raw per-trial outputs (`paper_v2/raw/`, JSONL, 5,564 rows), processed per-seed summaries (`paper_v2/processed/*.csv`), analysis results (`paper_v2/analysis/ANALYSIS_RESULTS.json`), and figure data (`paper_v2/figure_data/`). Prior campaign data reused for cross-checking: `research_data/validation/*.csv` (preregistered E3/E4/E9/E10/E11 campaigns), `learning_curve.json` (single-seed pilot). Connectome source data (FlyWire FAFB v783) are publicly available via codex.flywire.ai; the derived circuit (`fly_brain_circuit.json`) and its sha256 are in the repository. No external restrictions apply to the simulated data.

## 6. Code Availability

All code is in the repository: experiment engines (`experiment_core.js`, `controllers.js`), headless program runner (`paper_v2/paper_program.js`), statistical analysis (`paper_v2/paper_analysis.js`, `stats_utils.js`), figure generation (`paper_v2/paper_figures.py`), and smoke tests (`tests/run_smoke.js`, including a golden-fixture determinism test). Requirements: Node ≥ 18 (no external JS dependencies), Python ≥ 3.10 with numpy/matplotlib/pandas for figures and connectome analyses. Reproduction: `node paper_v2/paper_program.js --door` (E1–E8), `--e9/--e10/--e11 --seeds 10` (apparatus), then `node paper_v2/paper_analysis.js` and `python paper_v2/paper_figures.py`. Determinism: same code + same seed ⇒ row-identical outputs (enforced by tests).

## 7. References

Established literature (verified in-repo provenance):

1. Dorkenwald, S. et al. Neuronal wiring diagram of an adult brain. *Nature* **644**, 1312–1322 (2024). doi:10.1038/s41586-024-07558-y — FAFB connectome, materialization v783.
2. Schlegel, P. et al. Whole-brain annotation and multi-connectome cell typing of Drosophila. *Nature* **634**, 139–152 (2024). doi:10.1038/s41586-024-07686-5 — cell-type annotations (imported via `tools/import_cell_types.js`).
3. Buhmann, J. et al. Synapse-type predictive two-stage neurotransmitter classification model — source of the NT prediction scores (per `MANIFEST.json` provenance; DOI not recorded in-repo, flagged as unverified).
4. Landauer, R. Irreversibility and heat generation in the computing process. *IBM J. Res. Dev.* **5**, 183–191 (1961) — erasure cost basis (standard reference).
5. Smoluchowski, M. Experimentell nachweisbare, der üblichen Thermodynamik widersprechende Molekularphänomene. *Physik. Z.* **13**, 1069–1080 (1912) — trapdoor principle (standard reference).
6. Feynman, R. P., Leighton, R. B. & Sands, M. *The Feynman Lectures on Physics*, Vol. 1, Ch. 46. Addison–Wesley (1963) — ratchet-and-pawl analysis (standard reference).

Current study results are cited in the text as E1–E11 with traceability to `paper_v2/analysis/ANALYSIS_RESULTS.json`. Interpretations are labeled INFERRED; forward-looking statements are labeled HYPOTHESIS/PREDICTION. Note 3's DOI gap is disclosed rather than silently filled; the remaining references are standard, verifiable citations.

## 8. Supplementary material

See `paper_v2/SUPPLEMENTARY.md`: complete per-condition tables for E1–E8; the full thermodynamic ledger; preregistered campaign cross-check tables (E3/E4/E9/E10/E11 at 12–20 seeds); E9/E11 weight-drift and entropy-production analyses; degeneracy/guard documentation; and the experiment-to-paper matrix.
