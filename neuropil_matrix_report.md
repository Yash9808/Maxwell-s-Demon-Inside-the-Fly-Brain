# Neuropil x neuropil matrix — findings

Total synapses in matrix: **54,492,922** (of 54,492,922 in the connections table; 0 had unassignable pre-neuropil).

## Method
- rows: presynaptic neuron -> dominant output neuropil (per_neuron_neuropil_count_pre_783, ties alphabetical)
- columns: postsynaptic neuropil (connections `neuropil` column)
- L/R pairs adjacent (L first), major neuropils in FlyViz order; cyan lines mark pair boundaries

## Headline numbers

- within-neuropil (diagonal) synapses: 39,583,678 (72.6% of total)
- ipsilateral (L->L, R->R): 12,794,525 (23.5%)
- contralateral (L->R, R->L): 2,114,719 (3.9%)
- mean mirror asymmetry across 35 paired neuropils: 20.9% (1 - symmetric share, summed over L-column halves)

- `UNASGD` (postsynaptic sites outside named neuropils) column total: 4,185 synapses (0.0%)
- `None` is a literal string label in the pre-counts table (29 output synapses) — data quirk, kept for completeness

## Top 10 inter-neuropil flows (off-diagonal)

| pre -> post | synapses |
|---|---|
| LO_R -> ME_R | 798,149 |
| ME_R -> LO_R | 787,504 |
| LO_L -> ME_L | 766,309 |
| ME_L -> LO_L | 711,321 |
| AVLP_L -> PVLP_L | 214,922 |
| AVLP_R -> PVLP_R | 183,611 |
| LH_L -> MB_CA_L | 167,331 |
| LO_R -> LOP_R | 163,967 |
| LOP_R -> LO_R | 149,287 |
| LOP_L -> LO_L | 143,857 |

## Most mirror-asymmetric pairs (|L - R| / total, row halves)

| pair | asymmetry |
|---|---|
| MB_VL | 81.4% |
| BU | 57.1% |
| CAN | 48.4% |
| GA | 46.7% |
| EPA | 44.6% |
| WED | 37.8% |
| AMMC | 33.5% |
| MB_CA | 29.9% |

Files: `neuropil_matrix.csv`, `neuropil_matrix.png`, `neuropil_matrix_top30.png`.
