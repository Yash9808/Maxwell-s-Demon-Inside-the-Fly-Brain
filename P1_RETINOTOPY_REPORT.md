# P1 Stage E — Retinotopy Report

Status: **implemented** (`p1_retinotopy.py` → `fly_brain_retinotopy.json`;
stimulus mapping shared with the parity suite).

## 1. Audit of the current 8-bin visual interface

The shipped interface (`readVisualField` in `fly_demon_3d.html`, mirrored in
`brain_worker.js` and `controllers.js`):

* The chamber's particles are binned into **8 channels** by the formula
  `ch = min(7, (u*4|0) + ((v*2|0)*4))`, with `u,v` the particle position
  normalized to the chamber box.
* Each optic-layer neuron is assigned one channel from its `optic_channels`
  `[u,v,depth]` (mean PRE-synapse FAFB position, min-max normalized —
  SOURCE-DERIVED), then driven by that channel's intensity.

Findings:

| Issue | Class | Detail |
|---|---|---|
| Resolution: 8 bins vs ~800 real medulla columns | APPROXIMATION | each bin aggregates ~100 columns' worth of neurons |
| **Axis mislabel (E1)** | REAL bug in shipped code | `(u*4|0)` indexes channels 0–3 by the **first** factor — but `u` is built from particle **x** (the elevation axis of the scene) and `v` from particle **y** (azimuth). Channels therefore index elevation rows × azimuth columns in the opposite order from every comment ("four horizontal bins x two vertical bins") and from the moving-stimulus demos. Left/right motion discrimination in the current model is accidental with respect to the visual layout. Documented as a P0 dependency; NOT silently patched in shipped files. |
| Fallback `ch = k % 8` | MISSING mapping | optic neurons without position data get pseudo-retinotopy by enumeration order (dead for FAFB today — all 81,830 have channels — live for MCNS/re-extractions) |
| Centroid ≠ receptive field | MISSING concept | a neuron's synapse centroid is treated as its channel; no RF model exists or is claimed |
| Drift between paths | PARTIAL | three near-copies of the binning code (app, worker, controllers) can drift independently |

## 2. What Stage E built

`fly_brain_retinotopy.json` (14.2 MB), derived **only** from data already in
the workspace:

* **Grid**: hexagonal lattice over the normalized `[0,1)²` (u,v) field —
  40 × 20 = **800 nodes**, the published order of magnitude of the fly
  medulla's column count. The *lattice* is MODEL-ASSUMED (a sampling
  convention; no claim that FAFB columns are perfectly hexagonal); the
  *positions* it samples are SOURCE-DERIVED.
* **Assignment**: each optic-layer neuron's real (u,v) → nearest lattice node
  with a **confidence** value (`d²_best / d²_second`; ≥0.9 flagged
  border-ambiguous). Assignment is brute-force deterministic; 81,830/81,830
  neurons have positions (100%).
* **Axes**: u = normalized particle-x (elevation in the scene), v =
  normalized particle-y (azimuth) — the data's own axes, matching
  `extract_circuit.py`, with the legacy mislabel explicitly NOT reproduced.

Measured structure (from the build):

* 477 / 800 columns occupied (the optic-layer population spans a sub-region
  of the normalized field: expected, since u/v are min-max normalized over
  synapse centroids of all optic neurons).
* median 174 neurons per occupied column.
* 6,642 neurons (8.1%) flagged border-ambiguous — reported, not hidden.

## 3. The mandated distinctions, made explicit

Each neuron record carries these as **separate fields**, and the meta block
declares their provenance:

1. **Anatomical location** — `u, v, depth` per neuron: SOURCE-DERIVED (mean
   PRE-synapse position, normalized). This is where its synapses are, not
   what it sees.
2. **Inferred column** — `column` + `column_confidence`: MODEL-ASSUMED
   lattice over SOURCE-DERIVED positions. An assignment, with an honesty
   score, not an anatomical annotation.
3. **Receptive field** — deliberately **UNKNOWN for every neuron**. No RF
   measurements exist in this workspace; a centroid does not define an RF.
   The schema has the slot; the data does not.
4. **Actual stimulus mapping** — the `stimulus_map` block: the exact declared
   convention (`I(u,v)` evaluated at the nearest column node, no
   interpolation) that the parity suite uses. It is a declared approximation,
   reproducible from the JSON alone.

Additionally, per-neuron **cell type is UNKNOWN** (Stage B reserved field):
so this report does NOT claim any neuron is a T4/T5 or verify column identity
per cell type. Column assignment is a spatial binning of real anatomy — a
better interface than 8 bins, and honestly labeled as such.

## 4. Reproducing

```bash
python p1_retinotopy.py            # rebuild fly_brain_retinotopy.json
python p1_retinotopy.py --verify   # invariant checks
```

Build is ~2 s (pure numpy over the 81,830 × 800 assignment, chunked).

## 5. Stage D result read through retinotopy

The Stage D grid (`P1_OPERATING_POINT_PHASE_DIAGRAM.csv`, 60 cells) ran on the
legacy 8-bin drive interface. Its headline honest result — the motor readout
shows **no robust direction selectivity** (sign-test ≈ chance across the grid)
and real-vs-shuffled motor-rate gaps are large only in *relative* terms at
near-zero firing — is consistent with the Stage E audit: an 8-bin interface
with the E1 axis defect cannot be expected to produce geometry-consistent
direction signals at the readout. The retinotopic column interface built here
is the preconditions for testing that hypothesis properly (per-column edge
stimuli on the typed model), listed as the top follow-up.

## 6. What this enables downstream

* The parity suite and any future stimulus can address **columns** instead of
  8 bins: a stimulus names (u,v) regions; `stimulus_map` names the neurons.
* When published FlyWire/flyvis column or cell-type tables are imported
  (Stage B interface), `cell_type` fills in and the *same* records upgrade
  from "inferred column" to "typed neuron in column C" without any schema
  change.
* The legacy 8-bin path continues to work unchanged (backward compatibility);
  the retinotopic path is additive.
