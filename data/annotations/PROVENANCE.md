# Provenance: FlyWire cell-type annotations (Schlegel et al., Nature 2024)

- **Source**: `flyconnectome/flywire_annotations` repository, branch `main`,
  `supplemental_files/Supplemental_file1_neuron_annotations.tsv`
  (raw download URL:
  `https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv`).
- **Paper**: Schlegel, P., et al. "Whole-brain annotation and multi-connectome
  cell typing of Drosophila." *Nature* 630:199–209 (2024).
  DOI: 10.1038/s41586-024-07686-5.
- **Materialization**: root_ids in this table are FlyWire release **v783** —
  the same materialization as this repository's circuit
  (`data/circuits/fafb_circuit.js`, see MANIFEST `provenance.circuit`).
- **Download verification**:
  - bytes on disk: `31718505`
  - sha256: `9a4f8b2f843196074431ebd7cd883536afa1be86c8a4ce90970441e8be81d1be`
  - upstream size at download time matched exactly (byte-for-byte).
- **Import path**: `node tools/import_cell_types.js` (wraps the repo's own
  `p1_celltypes.importRows` — join validated on `root_id`, rows outside the
  5-layer circuit rejected, no labels invented).
- **Import result** (recorded 2026-09-21):
  - 106,051 / 106,765 circuit neurons matched a published `cell_type`
    (99.3%); 5,049 distinct cell types represented.
  - 1,714 neurons remain `UNKNOWN` — legitimately absent from the published
    table (do NOT backfill).
  - 31,669 published rows correspond to neurons outside this repo's
    extracted 5-layer circuit and are correctly not imported.
- **Policy**: any record whose provenance is not `PUBLISHED` must carry
  `cell_type: "UNKNOWN"`; the "nothing invented" guard in `p1_tests.js`
  (test B4b) enforces that every typed record carries a `PUBLISHED`
  provenance tag.
