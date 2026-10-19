# FIGURE REGISTRY - E1-E11 paper program (unified)

Every figure is generated from actual experimental outputs; machine-readable provenance in `figures/PROVENANCE*.json`. Generation: `paper_figures.py` (Figs 1-7), `paper_brain_figures.py` (Figs 8-13), `figure14_door_brains.py` (Fig 14), `figure15_entropy_ledger.py` (Fig 15).

## Part 1 - Figure inventory (main figures)

| Figure | File | Content | Generator | Status |
|---|---|---|---|---|
| Fig 1 | `figure1_overview` | System & framework: task, anatomy context, model, E1-E11 map | `paper_figures.py` | DONE |
| Fig 2 | `figure2_learning_behaviour` | Learning & behavior: E3 policy collapse, E2/E5 policies, E5 comparator, E9 decisions | `paper_figures.py` | DONE |
| Fig 3 | `figure3_information_budget` | Information & budget: neural MI by condition; bits used vs needed (ledger) | `paper_figures.py` | DONE |
| Fig 4 | `figure4_connectome_and_secondlaw` | Connectome & 2nd-law: E4 real vs shuffled, E10 trapdoor, E11 ratchet | `paper_figures.py` | DONE |
| Fig 5 | `figure5_mechanism` | Mechanism: E9 valve policy state, decisions vs reference, manipulation checks | `paper_figures.py` | DONE |
| Fig 6 | `figure6_robustness` | Robustness: E7 physics regimes, E8 information-limited demons, learning behaviour | `paper_figures.py` | DONE |
| Fig 7 | `figure7_integrated` | Integrated synthesis: environment -> information -> decision -> behavior -> ledger | `paper_figures.py` | DONE |
| Fig 8 | `figure8_brain_activity` | 3D FAFB brain + per-neuron model activity (trained vs frozen, zoom, regions) | `paper_brain_figures.py` | DONE |
| Fig 9 | `figure9_which_neurons` | Which neurons fired: ranked neurons, cell types, active/inactive split | `paper_brain_figures.py` | DONE |
| Fig 10 | `figure10_learning_delta` | Learning-delta brain map: early vs late vs delta on anatomy + ranked regions | `paper_brain_figures.py` | DONE |
| Fig 11 | `figure11_neural_mi` | Neural MI mapped to brain regions (E9 decisions); MI-vs-behaviour link | `paper_brain_figures.py` | DONE |
| Fig 12 | `figure12_learning_curves` | Learning curves: E9 10-seed replicates + mean, E3 policy trajectory, E10/E11, demonAgree | `paper_brain_figures.py` | DONE |
| Fig 13 | `figure13_predictions_budget_ledger` | Preregistered predictions vs observations; E1 thermodynamic budget; crossing ledger | `paper_brain_figures.py` | DONE |
| Fig 14 | `figure14_door_brains` | Door-task brain outcome at honest scopes: E3 MB mini-circuit maps + delta, E3 layer rates, E5 FAFB regions real vs shuffled, E4 wiring similarity (fig14g) | `figure14_door_brains.py` | DONE |
| Fig 15 | `figure15_entropy_ledger` | Sorting-entropy reduction (Shannon, E1 definition) + crossing ledger (counts-first, g:b annotated) | `figure15_entropy_ledger.py` | DONE |

## Part 2 - Required plots (user program) -> experiment -> figure -> panel -> brain link -> data -> status

| Required analysis/plot | Experiment | Figure | Panel | Brain visualization | Data source | Status |
|---|---|---|---|---|---|---|
| 3D brain + neural activity | E9 (demon_neural/demon_frozen) | Fig 8 | a–c | Required -- provided (3D FAFB anatomy + per-neuron activity) | raw/E9_rows.jsonl fireVec -> ACT bins | DONE |
| Which neurons fired | E9 | Fig 9 | a–d | Required -- provided | ACT bins + celltypes | DONE |
| Learning curve | E9, E3, E10, E11 | Fig 12 | a–c | Optional/linked | raw rows | DONE |
| Good:bad crossing ratio | E1–E8 | Fig 13 | c | Optional/linked (counts shown with ledger) | raw rows | DONE |
| Thermodynamic budget | E1 | Fig 13 | b | Optional -- provided (model quantities only) | raw/E1_rows.jsonl | DONE |
| Neural mutual information | E9 | Fig 11 | a–b | Required where localizable -- provided (region map) | MI_E9.json | DONE |
| Sorting entropy reduction | E1 (sortEntropy/spatialH ledger) | Main Fig 3 (existing) + S tables | -- | Required where localizable -- quantified in Fig 3 & SUPPLEMENTARY S1 | raw/E1_rows.jsonl | DONE (existing Fig 3) |
| Learning delta | E9 | Fig 10 | a–e | Required -- provided | ACT bins early/late | DONE |
| Learning curve (replicates + mean) | E9 (10 seeds), E3, E10, E11 | Fig 12 | a-d | Optional/linked - brain delta in Fig 10 covers the trained brain | raw rows | DONE |
| Predictions vs observations | E3/E4/E9/E10/E11 preregistered endpoints | Fig 13 | a | Optional/linked | PRE_REGISTERED_CRITERIA.json + ANALYSIS_RESULTS.json | DONE |
| Thermodynamic budget (E1 ledger, model quantities) | E1 | Fig 13 | b | Optional | raw/E1_rows.jsonl (workInJ, erasureCostJ, extractableJ, landauerRatio) | DONE |
| Good:bad crossing ratio (counts-first ledger) | E1-E8 door conditions | Fig 15 | b (also Fig 13c) | Optional/linked | raw rows goodCrossings/badCrossings | DONE |
| Sorting-entropy reduction (Shannon, defined) | E1-E8 door conditions (sortEntropy) | Fig 15 | a | Optional/linked - region MI/activity in Figs 8-11, 14 | raw rows sortEntropy | DONE |
| Door-task brain outcome (E3 learning arm) | E3 (248-unit MB mini-circuit) | Fig 14 | a-d | Scope-limited - mini-circuit units, NOT FAFB anatomy (fireVec indexes controller units) | MINI_E3.json, ACT_E3_*.bin, layerRates | DONE (honest scope) |
| Connectome-constraint neural signature | E4/E5 (FAFB real vs shuffled) | Fig 14 | e-g (fig14g) | Required where localizable - full FAFB activity | ACT_E4s?_connectome_4?_test.bin, ACT_E5s0_*.bin | DONE |
| Activity propagation (sensory->motor layers) | E9 5-layer FAFB circuit | Fig 8 | a-c (layered zoom) | Required - provided | ACT_E9_*.bin + circuit layers | DONE |

## Part 3 - Explicit NOT AVAILABLE / scope-limited entries

- **Biological neural recordings / real firing rates:** NOT SUPPORTED BY EXPERIMENTAL DESIGN - this is a computational model; all activity panels are labeled *model neural activity* (decoded fireVec quantization). No biological causality claimed anywhere; E4 4C shuffling is a wiring manipulation, presented as such.
- **Anatomical 3D brain for E3 (learning arm):** NOT AVAILABLE at FAFB scope - the E3 drosophila controller simulates a 248-unit mushroom-body mini-circuit (32 PN + 200 KC + 16 MBON); its fireVec indexes those units. Provided instead at honest mini-circuit scope (Fig 14a-d) with explicit labels.
- **Anatomical 3D brain for E2/E5-ann (ANN controller):** NOT AVAILABLE at FAFB scope - 18-unit (16 hidden + 2 output) ANN. Covered behaviorally (Figs 2, 12); no brain view fabricated.
- **Per-neuron MI with seed-level uncertainty for E3:** NOT AVAILABLE at region level - n=2 seeds < the >=5-seed requirement; only mini-circuit population MI (descriptive, MI_E3.json).
- **Thermodynamic entropy claims:** NOT SUPPORTED - the model's `sortEntropy` is a Shannon entropy of the sorted state; thermodynamic quantities exist only as the E1 ledger's model-priced work/Landauer terms (Fig 13b).
- **E7/E10/E11 brain views:** E7 is a physics-regime experiment (no neural-controller fireVec); E10/E11 rows carry no fireVec. Their analyses are behavioral/energetic (Figs 4, 6, 12, 13).
