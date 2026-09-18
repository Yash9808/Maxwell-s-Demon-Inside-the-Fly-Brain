# FAFB v783 proofread-neuron neurotransmitter classification

- Proofread neurons classified: **139,255**
- Confidence threshold: **0.50**
- Minimum dominant-vs-second margin: **0.05**

## Overall cell-type counts

| cell type | neurons | share |
|---|---:|---:|
| cholinergic | 79,260 | 56.9% |
| GABAergic | 14,782 | 10.6% |
| glutamatergic | 18,271 | 13.1% |
| octopaminergic | 83 | 0.1% |
| serotonergic | 1,054 | 0.8% |
| dopaminergic | 501 | 0.4% |
| mixed_uncertain | 24,054 | 17.3% |
| no_outgoing | 1,250 | 0.9% |

## Per-neuropil summary

The complete wide table is in `neuron_nt_summary_by_neuropil.csv`; each row uses the neuron's dominant output neuropil from the pre-count table.

| output neuropil | total | dominant class | count |
|---|---:|---|---:|
| AL_L | 1,609 | cholinergic | 747 |
| AL_R | 1,266 | cholinergic | 625 |
| AME_L | 12 | mixed_uncertain | 6 |
| AME_R | 6 | cholinergic | 2 |
| AMMC_L | 237 | cholinergic | 81 |
| AMMC_R | 346 | cholinergic | 142 |
| AOTU_L | 490 | cholinergic | 399 |
| AOTU_R | 519 | cholinergic | 430 |
| ATL_L | 54 | cholinergic | 39 |
| ATL_R | 32 | cholinergic | 21 |
| AVLP_L | 1,709 | cholinergic | 1,194 |
| AVLP_R | 2,026 | cholinergic | 1,379 |
| BU_L | 26 | cholinergic | 23 |
| BU_R | 36 | cholinergic | 35 |
| CAN_L | 3 | cholinergic | 3 |
| CAN_R | 1 | cholinergic | 1 |
| CRE_L | 520 | cholinergic | 300 |
| CRE_R | 689 | cholinergic | 439 |
| EB | 392 | GABAergic | 286 |
| EPA_L | 9 | GABAergic | 5 |
| EPA_R | 8 | cholinergic | 3 |
| FB | 1,978 | cholinergic | 933 |
| FLA_L | 132 | cholinergic | 69 |
| FLA_R | 152 | cholinergic | 72 |
| GA_L | 14 | cholinergic | 11 |
| GA_R | 5 | cholinergic | 5 |
| GNG | 6,060 | cholinergic | 2,820 |
| GOR_L | 70 | cholinergic | 42 |
| GOR_R | 49 | cholinergic | 21 |
| IB_L | 197 | cholinergic | 109 |
| IB_R | 217 | cholinergic | 112 |
| ICL_L | 551 | cholinergic | 332 |
| ICL_R | 577 | cholinergic | 350 |
| IPS_L | 819 | cholinergic | 442 |
| IPS_R | 725 | cholinergic | 395 |
| LAL_L | 507 | cholinergic | 283 |
| LAL_R | 497 | cholinergic | 265 |
| LA_L | 5,081 | cholinergic | 2,317 |
| LA_R | 4,440 | mixed_uncertain | 3,254 |
| LH_L | 814 | cholinergic | 283 |
| LH_R | 744 | cholinergic | 245 |
| LOP_L | 7,068 | cholinergic | 4,962 |
| LOP_R | 7,150 | cholinergic | 5,246 |
| LO_L | 10,601 | cholinergic | 8,523 |
| LO_R | 9,864 | cholinergic | 7,919 |
| MB_CA_L | 38 | cholinergic | 29 |
| MB_CA_R | 37 | cholinergic | 26 |
| MB_ML_L | 2,544 | cholinergic | 2,392 |
| MB_ML_R | 2,100 | cholinergic | 1,993 |
| MB_PED_L | 36 | cholinergic | 33 |
| MB_PED_R | 67 | cholinergic | 65 |
| MB_VL_L | 38 | cholinergic | 35 |
| MB_VL_R | 340 | cholinergic | 334 |
| ME_L | 23,371 | cholinergic | 10,293 |
| ME_R | 23,776 | cholinergic | 11,178 |
| NO | 32 | mixed_uncertain | 16 |
| None | 9 | mixed_uncertain | 4 |
| OCG | 313 | serotonergic | 143 |
| PB | 101 | cholinergic | 46 |
| PLP_L | 1,375 | cholinergic | 1,092 |
| PLP_R | 1,207 | cholinergic | 948 |
| PRW | 542 | cholinergic | 240 |
| PVLP_L | 1,247 | cholinergic | 659 |
| PVLP_R | 1,050 | cholinergic | 600 |
| SAD | 942 | cholinergic | 440 |
| SCL_L | 186 | cholinergic | 108 |
| SCL_R | 184 | cholinergic | 94 |
| SIP_L | 173 | cholinergic | 106 |
| SIP_R | 276 | cholinergic | 151 |
| SLP_L | 1,933 | cholinergic | 1,072 |
| SLP_R | 2,002 | cholinergic | 1,111 |
| SMP_L | 1,924 | cholinergic | 1,127 |
| SMP_R | 1,992 | cholinergic | 1,171 |
| SPS_L | 738 | cholinergic | 421 |
| SPS_R | 965 | cholinergic | 582 |
| UNASSIGNED | 604 | no_outgoing | 604 |
| VES_L | 244 | cholinergic | 146 |
| VES_R | 222 | cholinergic | 134 |
| WED_L | 105 | cholinergic | 64 |
| WED_R | 240 | cholinergic | 122 |

## Method and caveats

- Each neuron's outgoing NT score is `Σ(syn_count × edge_mean_score) / Σ(syn_count)` over proofread connection rows.
- The output neuropil is the dominant presynaptic neuropil in `per_neuron_neuropil_count_pre_783.feather`; ties are resolved alphabetically.
- `mixed_uncertain` means the top score is below the threshold or too close to the runner-up; `no_outgoing` means no proofread outgoing edge was present.
- NT scores are model predictions, not direct experimental transmitter measurements, so these are transmitter-like computational classes rather than definitive biological labels.
