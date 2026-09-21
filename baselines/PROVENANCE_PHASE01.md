# PHASE 01 — FROZEN PROVENANCE RECORD
Recorded 2026-09-21 · commit at freeze: see baselines/results/results_index.json
Principle: transparent provenance, NOT artificially complete — every remaining
UNKNOWN/MODEL-ASSUMED item is listed, nothing fabricated.

## Connectome sources
| Item | Status | Record |
|---|---|---|
| FAFB v783 (female adult fly brain) | DEPLOYED | Dorkenwald et al. 2024, "Neuronal wiring diagram of an adult fly brain", Nature — DOI 10.1038/s41586-024-07558-y; 106,765 simulated neurons, 553,807 fast edges, 10,223 modulatory contacts; sha256 in MANIFEST.json |
| MCNS v1.0 (male CNS) | RUNTIME DEPLOYED (pruned) | Berg et al. 2025 preprint (PMC12636603; Cell 2026) — exact DOI **UNKNOWN**, recorded by stable identifiers. Official upstream version: **MaleCNS v1.0** (Janelia/FlyWire codex, June 2026); stale "v0.9" UI labels were aligned to v1.0 in commit fc7272c. Payload `malecns_circuit_pruned.json` self-declares `mcns_v1.0` |
| Missing raw MCNS payload | DOCUMENTED ABSENCE | `malecns_circuit.json` (138,507,515 bytes; sha256 72d96c29…72482 recorded while present, pre-stabilization) was lost in a disclosed stabilization incident; never entered git history; **not consumed by any code or test** (doc/manifest references only). Hard re-download acceptance target pinned in MANIFEST provenance (`mcns.raw_payload_integrity_target`). Runtime unaffected: pruned payload is byte-exact-verified (see below) |
| Pruned MCNS runtime payload | VERIFIED | sha256 140cb881af1d23d13947125adeae208085aecb42ecb7b1d1f603336c7b5d28c5, 8,715,602 bytes, byte-exact with `data/circuits/mcns_circuit.js` browser embed; enforced by smoke S3 |
| MCNS pruning generator | DOCUMENTED ABSENCE | Generator script not retained (manifest note); the pruned derivative's own metadata + the byte-exact embed chain are the authoritative record |

## Cell types
| Item | Status | Record |
|---|---|---|
| Published table | DEPLOYED | Schlegel et al. 2024, "Whole-brain annotation and multi-connectome cell typing of Drosophila", Nature — DOI 10.1038/s41586-024-07686-5; flyconnectome/flywire_annotations `Supplemental_file1_neuron_annotations.tsv` (root_id = FlyWire **v783**, same materialization as this repo's circuit); byte-verified download, sha256 + re-download instructions in `data/annotations/PROVENANCE.md` |
| Coverage | 99.3% | 106,051 / 106,765 circuit neurons carry published types (5,049 distinct); imported via the repo's own `p1_celltypes.importRows` interface |
| UNKNOWN cells | 1,714 (1.7%) | Legitimately absent from the published table — left UNKNOWN, **not backfilled**; 31,669 published rows outside the 5-layer circuit correctly rejected |

## Model assumptions (all tagged MODEL-ASSUMED in code/params)
| Item | Status | Record |
|---|---|---|
| Per-type neural dynamics | MODEL-ASSUMED | 4 parameter classes (81,787 optic_phasic / 17,225 central / 6,780 motor / 973 modulatory); provenance-tag enforcement intact (P1) |
| Conduction delays | MODEL-ASSUMED | Same-tick propagation (documented synapticDelay=0 default; =1 buffered knob exists, not enabled) |
| Modulator gains (DA/SER/OCT) | MODEL-ASSUMED | γ = 0.15 third-factor gains, structural/unoptimized (P0) |
| Thermodynamic quantities | MODEL-DEPENDENT | Landauer bill, extractable work, efficiency depend on the sim→Joule constant (simToJoule 1e-21) and T=300K environment assumptions; documented in the benchmark output, not claimed as physical measurements |
| Retinotopy operating point | DOCUMENTED | `legacy8bin` is the audited default (opticDrive 0.25); retinotopy is opt-in — its ~9× optic-drive collapse at that point is causally diagnosed (tools/diagnose_optic_input.js), NOT calibrated |

## Mesh / visual assets
| Item | Status | Record |
|---|---|---|
| GLB mesh sources | **UNKNOWN — explicitly declared** | Manifest `mesh_assets_provenance`; upstream origins not established, not invented |
| FlyVis checkpoints | SOURCE-DERIVED | flow/0000/000 (65 types); zips tracked, extraction gitignored/restorable |

## Datasets (large, git-ignored)
FlyWire v783 feather tables: hashed only below 512 MB (2 of 4; larger two carry
sha256 null **by design**, verified against the codex export instead — policy in
tools/make_manifest.py). Vendored paper PDF `s41586-024-07939-3.pdf` is the
flyvis paper (Lappalainen et al., Nature 634:1132–1140) — earlier manifest
mis-citation fixed during stabilization.
