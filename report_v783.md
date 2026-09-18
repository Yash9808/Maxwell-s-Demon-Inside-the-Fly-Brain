# FAFB v783 — Dataset Summary

- **Proofread neurons:** 139,255
- **Edges (pair × neuropil rows):** 16,847,997
- **Unique neuron pairs:** 15,091,983
- **Synapses in proofread edges:** 54,492,922

## Neurotransmitter composition (score mass over all edges)

| NT | Σ score | share |
|---|---|---|
| gaba | 3,602,740 | 21.4% |
| ach | 8,072,577 | 47.9% |
| glut | 3,383,656 | 20.1% |
| oct | 504,245 | 3.0% |
| ser | 394,538 | 2.3% |
| da | 888,510 | 5.3% |

## Top 15 neuropils by synapse count

| neuropil | synapses | % of total | dominant NT | GABA share |
|---|---|---|---|---|
| ME_R | 8,821,540 | 16.2% | ach | 30% |
| ME_L | 7,712,403 | 14.2% | ach | 30% |
| LO_R | 3,877,311 | 7.1% | ach | 19% |
| LO_L | 3,792,886 | 7.0% | ach | 19% |
| GNG | 2,713,213 | 5.0% | ach | 18% |
| AVLP_R | 2,000,857 | 3.7% | ach | 20% |
| LOP_R | 1,901,109 | 3.5% | ach | 21% |
| AVLP_L | 1,510,021 | 2.8% | ach | 19% |
| LOP_L | 1,189,689 | 2.2% | ach | 25% |
| SMP_R | 898,333 | 1.6% | ach | 11% |
| FB | 897,766 | 1.6% | ach | 8% |
| PVLP_L | 895,615 | 1.6% | ach | 19% |
| SMP_L | 816,580 | 1.5% | ach | 10% |
| AL_L | 760,542 | 1.4% | ach | 18% |
| PLP_L | 746,323 | 1.4% | ach | 18% |

## Degree distributions (synapse-weighted, proofread partners only)

- Output: 138,005 neurons, median 229, p95 1,206, max 99,871
- Input:  137,090 neurons, median 200, p95 1,390, max 69,948

## Cross-checks

- pre counts Σ = post counts Σ = 130,054,535 (= synapse-level rows) ✔
- All 138,639 neurons appearing in edges are in proofread_root_ids ✔
- Most-output neuron: 720575940628908548 with 99,871 output synapses
