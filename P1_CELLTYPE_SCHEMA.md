# P1 Stage B — Cell-Type Metadata Schema

Status: **implemented** (`p1_build_celltypes.py`, `p1_celltypes.js`,
`fly_brain_celltypes.json`, tests in `p1_tests.js` / `--verify` mode).

## Design constraints honored

1. **No invented biology.** Every populated field is computed from data that
   already existed in this workspace (v783 connectome exports + the existing
   `classify_neurons.py` output). Where the field would need a source that is
   absent, the value is the literal `UNKNOWN` — never a guess.
2. **No P0 rewrite.** `fly_brain_circuit.json` (legacy circuit), `brain_worker.js`
   and `fly_demon_3d.html` are untouched. Metadata live in a **separate file
   keyed by v783 root ID** and join to circuit indices through the
   reconstruction invariant (see "Identity & join" below).
3. **Backward compatibility.** All legacy consumers keep working; the metadata
   are parallel data. The dominant-neuropil representation is *augmented*, not
   replaced: `pre_neuropil`/`post_neuropil` are real FlyWire neuropil
   annotations, and the legacy "layer" survives as the coarse `layer` field.

## File: `fly_brain_celltypes.json`

```
{
  "meta": {
    "schema_version": 1,
    "p1_stage": "B",
    "n_neurons": 106765,
    "root_ids_sha256": "<sha256 of the uint64 root-ID sequence, little-endian bytes>",
    "index_mapping": "<how record order relates to circuit indices>",
    "provenance": { dataset, materialization, scope, nt_source, neuropil_source,
                    cell_type_source, note },
    "n_nt_classified": 106765,
    "n_post_mapped": 106676
  },
  "layer_names": [ [per-layer neuropil name lists] ],
  "neurons": [ record, ... ]   // one per circuit neuron, in circuit index order
}
```

### Record fields (51.3 MB total file)

| Field | Type | Provenance | Meaning |
|---|---|---|---|
| `root_id` | uint64 | SOURCE-DERIVED | FlyWire v783 root ID (stable within materialization 783) |
| `layer` | uint8 0–4 | SOURCE-DERIVED | coarse legacy layer from dominant pre neuropil (backward-compat) |
| `pre_neuropil` | string \| null | SOURCE-DERIVED | dominant **output** neuropil (FlyWire pre-count table) |
| `pre_syn_total` | int | SOURCE-DERIVED | total output synapses across named neuropils |
| `pre_neuropils_top` | [[neuropil,count]×≤4] | SOURCE-DERIVED | top output neuropils (descending, alphabetical tie-break) |
| `post_neuropil` | string \| null | SOURCE-DERIVED | dominant **input** neuropil |
| `post_syn_total` | int | SOURCE-DERIVED | total input synapses across named neuropils |
| `post_neuropils_top` | [[neuropil,count]×≤4] | SOURCE-DERIVED | top input neuropils |
| `nt_class` | string | SOURCE-DERIVED | v783 NT-score class: cholinergic / GABAergic / glutamatergic / octopaminergic / serotonergic / dopaminergic / mixed_uncertain / no_outgoing (Buhmann-model predictions — soft calls, not experimental confirmations) |
| `nt_scores` | {ach,gaba,glut,oct,ser,da} 0–1 | SOURCE-DERIVED | mean per-synapse NT scores aggregated to the neuron |
| `nt_dominant_score` | float 0–1 | SOURCE-DERIVED | confidence of the dominant class |
| `nt_margin` | float | SOURCE-DERIVED | dominant − runner-up score |
| `cell_type` | string | **UNKNOWN (all 106,765)** | reserved for published FlyWire/flyvis cell-type names (e.g. T4c, KCab-p) |
| `cell_type_source` | string | **UNKNOWN** | provenance string required when `cell_type` is imported |
| `synapse_class_sign` | −1/0/+1 | MODEL-ASSUMED | polarity prior: −1 gaba/ser/da-dominant, +1 ach/glut-dominant, 0 unknown/mixed. Convention inherited from `extract_circuit.py`'s `INH` set; it is a modeling prior, **not** a measured synapse sign |

Observed distributions (this build): cholinergic 62,926 · GABAergic 11,868 ·
glutamatergic 14,842 · mixed_uncertain 15,998 · dopaminergic 347 ·
serotonergic 626 · octopaminergic 46 · no_outgoing 112.
(`n_nt_classified` counts records with a non-UNKNOWN class; the distribution
differs from the 139,255-neuron report because only the 106,765 circuit
neurons are included.)

## Identity & join (why root IDs + reconstruction, not a circuit rewrite)

`extract_circuit.py` persists only *local indices*; the mapping is
`sorted(root_ids of neurons whose dominant pre neuropil is in a layer set)`,
grouped by layer. `p1_build_celltypes.py` recomputes exactly that mapping and
**fails hard** unless the recomputed layers equal `fly_brain_circuit.json`'s
`layers` (the same invariant `_rebuild_anatomy.py` asserts). The record list is
emitted in that order, so record *i* = circuit neuron *i* positionally; the
loader (`p1_celltypes.js`) additionally checks:

- record count == circuit neuron count,
- per-layer blocks are strictly ascending in `root_id` (reconstruction order),
- full root-ID sequence hash equality is verified by
  `p1_build_celltypes.py --verify` (invoked by the test harness) and by the
  loader's structural checks.

If FlyWire IDs are ever rematerialized (v784+), the hash check fails loudly
instead of silently mis-joining. That is the intended failure mode.

## Runtime API (`p1_celltypes.js`)

```js
const ct = require("./p1_celltypes");
const table = ct.buildNeuronTable(circuit);
// table.N, table.records[i]           — metadata records in circuit index order
// table.ntSign[i] ∈ {-1,0,+1}         — MODEL-ASSUMED polarity prior (ntSignOf)
// table.ntConf[i] ∈ [0,1]             — SOURCE-DERIVED dominant NT score
// table.layer[i], table.rootOf[i]     — coarse layer, root ID
// table.stats = { n, nt_classified, post_mapped, cell_type_known }
```

Import interface for published tables (validates, never invents):

```js
const report = ct.import(rows, { jsonPath });
// rows: { root_id, cell_type, source, ... } — source REQUIRED
// report: { matched, unknown_root, patched, rejected }
```

## Reserved import formats

Two anticipated sources, both accepted by `import()` after trivial mapping:

1. **FlyWire cell-type table** (`cell_type` + `root_id` (+ `hemisphere`)):
   from the published FlyWire annotations (codex / FAFB cell-type spreadsheets)
   or neuprint-style exports. `source` should carry the file/materialization.
2. **flyvis connectome CSV** (`flyvis.connectome.ConnectomeFromCodecs` table
   columns `root_id`/`cell_type`): same shape; `source: "flyvis-<version>"`.

Types beyond the NT class (e.g. "T4c", "Mi1", "KCab") must come from one of
these tables — the builder cannot synthesize them, and per the audit (A5) none
exists in this workspace, so `cell_type` ships `UNKNOWN` everywhere.

## What Stage B deliberately does NOT claim

- `nt_class` is a **computational prediction**, not an experimentally confirmed
  transmitter identity (README disclosure carried forward).
- `synapse_class_sign` is a **polarity prior for modeling**, not biology.
- Dominant-neuropil labels remain coarse (audit A4): a neuron "of" ME is not
  necessarily a medulla intrinsic neuron. True cell types can only arrive
  through the reserved import path.
