# P1 Biological-Fidelity Audit — Maxwell's Demon fly-brain model

Agent 2 · P1 · 2026-09-20
Branch `Ver2(Split-code-fastframe)` @ `76bb787` (clean tree at audit start).

> **Revision note (mid-P1, disclosed).** During P1 execution the parallel agent
> revised `fly_brain_circuit.json` (edge aggregation changed: 563,942 → 553,807
> unique edges; layer membership unchanged, 106,765 neurons). All P1 artifacts
> were rebuilt against the revised circuit AFTER the change (Stage B at 22:25,
> Stage E at 22:26 on 2026-09-20), so every cross-artifact invariant holds for
> the file as it now ships. The counts quoted in the findings below are the
> values as originally audited; the P1 outputs reflect the current file.

## Scope and method

Static audit of the shipping neural model plus a live trace of the full
106,765-neuron circuit (`fly_brain_circuit.json`): 106,765 neurons,
563,942 aggregated edges (≥10 synapse pairs), 81,830 neurons carrying
`optic_channels` position data. Sources inspected: `fly_demon_3d.html`
(`makeSim`/`brainTick`, lines ~1661–1878), `brain_worker.js` (worker tick),
`controllers.js` (`connectomeController`), `extract_circuit.py`,
`_rebuild_anatomy.py`, `fafb783.py`, `fly_brain_meta.json`,
`neuron_nt_classification.csv` (+ report), `fly_brain_positions.bin`,
`fly_brain_hulls.{bin,json}`, `experiment_core.js`.

Classification scale (no blurring):

| Tag | Meaning |
|---|---|
| REAL | Implemented as claimed; mechanism exists and is data-derived |
| PARTIAL | Mechanism exists but covers a subset / one branch only |
| APPROXIMATION | Deliberate simplification, disclosed, parameterized rather than derived |
| MISSING | Not implemented anywhere (no code path) |

Every numeric parameter cited below carries a provenance tag:
`SOURCE-DERIVED` (computed from FAFB v783 data) · `MODEL-ASSUMED` (fixed by the
existing model, not biological) · `EMPIRICAL` (measured in a published
experiment) · `TUNED` (adjusted to make a benchmark behave) · `UNKNOWN`.

## 0. Ledger of findings

| # | Subsystem | Claim / behavior in code | Verdict | Key evidence |
|---|---|---|---|---|
| A1 | Circuit extraction | Real FAFB v783 5-layer subnetwork | REAL | `extract_circuit.py` aggregates v783 edges, ≥10-syn filter |
| A2 | Circuit extraction | Root-ID provenance preserved into runtime | MISSING | circuit JSON stores only local indices; mapping reconstructed out-of-band by `_rebuild_anatomy.py` |
| A3 | Circuit extraction | Per-edge neurotransmitter identity | PARTIAL | `nt_name` emitted, but aggregation is last-write (`a[3] = e["nt"]`), not majority |
| A4 | Cell typing | Neurons typed by dominant output neuropil | PARTIAL | `extract_circuit.py` step 1: real neuropil, but 1 label/neuron of ~70 neuropils |
| A5 | Cell typing | Published FlyWire/flyvis cell types | MISSING | no cell-type table anywhere in repo; only NT class from `classify_neurons.py` |
| A6 | Neurotransmitters | Per-neuron NT class from v783 scores | PARTIAL | `neuron_nt_classification.csv` (139,255 rows) exists but is never joined into the circuit/runtime |
| A7 | Dynamics | One global LIF rule for all neurons | REAL (as implemented) / flaw | decay 0.86, threshold 30, refractory 3, identical for all 106,765 neurons |
| A8 | Dynamics | Conduction/synaptic delays | PARTIAL | uniform 1-tick delay (`_spikePrev`) in 3D + worker paths; controllers path has **zero** delay |
| A9 | Plasticity | Causal dopamine-gated STDP | PARTIAL | pure co-occurrence eligibility trace, no pre/post ordering term |
| A10 | Optic input | Retinotopic mapping to real medulla columns | MISSING | 8 coarse bins exist; columns do not |
| A11 | Optic input | Position-derived visual channels | PARTIAL | `optic_channels` from synapse centroids, but 8×8-bin collapse + y-axis mislabel (E1) |
| A12 | Input mapping | Pixel-to-neuron binning determinism | MISSING | `opticChan[k] = k % 8` fallback assigns silent neurons pseudo-retinotopy |
| A13 | Stimulus semantics | Receptive fields of optic neurons | MISSING | centroid location treated as channel (A11); no RF model |
| A14 | Geometry | Anatomical placement from EM positions | PARTIAL | `fly_brain_positions.bin` real post-synapse centroids; fallback fills exist |
| A15 | Hulls | Neuropil hull surfaces | APPROXIMATION | voxel shells of neuron clouds (`fly_brain_hulls.json` `anchored:true` discloses this) |
| A16 | Provenance | NT scores provenance | PARTIAL | README discloses Buhmann-prediction nature; not carried into runtime metadata |
| A17 | Shuffled control | Degree-preserving rewiring | PARTIAL | rewires *targets* only (Fisher–Yates), breaks degree-pair structure |
| A18 | Parity test | Standardized dynamics-parity stimulus suite | MISSING | nothing in repo runs flash/edge/motion protocols across models |

Detailed evidence per item in §2.

## 1. Executive summary

The model is a **real connectome with a synthetic, uniform dynamic skin**. The
wiring (A1) and the anatomical placements (A14) are genuinely FlyWire-derived,
and the NT-classification pipeline (A6) already exists as data on disk. What is
missing is exactly what the P1 roadmap targets: per-neuron cell-type metadata,
per-type dynamics, a retinotopic interface, a flyvis boundary, and a parity
harness. Two defects found during this audit are not simplifications but
correctness bugs inside existing claims:

* **E1 — visual y-axis mislabel.** The bin formula in all three tick paths is
  `(u*4|0) + ((v*2|0)*4)`, where the first term is the *vertical* axis (u from
  particle x — dorsal/ventral) and the second the *horizontal* (v from particle
  y). Channels 0–3 and 4–7 therefore index elevation rows, not the left–right
  columns the comment, the optic-drive calibration note ("four horizontal bins")
  and the moving-stimulus demos assume. Any left/right motion discrimination in
  the current model is accidental with respect to the visual field layout.
* **A3 — NT aggregation is last-write-wins** per parallel-edge bundle, so an
  edge's sign can be decided by whichever neuropil row happened to be enumerated
  last rather than by synapse-weighted majority.

Both are P0-class dependencies: they change behavior of existing experiments.
Per the phase discipline this report **documents them and leaves the shipped
files untouched**; the P1 code path (Stage C/D/E) implements the corrected
semantics in its own module.

## 2. Findings by subsystem

### 2.1 Circuit extraction — REAL core, PARTIAL edges, MISSING provenance

`extract_circuit.py` builds 5 layers from each neuron's dominant **output**
neuropil (ties → alphabetical min): AL → ME/LO/LOP → LH/MB → SMP/SIP/SLP →
GNG/SAD. Edges are real v783 pairs with `syn_count ≥ 10` (aggregate:
`SOURCE-DERIVED`), parallel edges summed (weight `SOURCE-DERIVED`), sign from
dominant NT score (`SOURCE-DERIVED` per-row, but see A3).

* A1 **REAL**: layer sizes 2,875 / 81,830 / 6,758 / 8,300 / 7,002 = 106,765
  neurons; 563,942 unique edges. Cross-checked against
  `fly_brain_meta.json` (`n: 106765`) and README ("563,942 simulated").
* A2 **MISSING**: the circuit JSON drops root IDs. `_rebuild_anatomy.py` had to
  *reconstruct* the index→root-ID mapping by re-running the same algorithm and
  `assert`-ing equality. Any future cell-type join needs a stable root-ID key —
  this is the first thing Stage B fixes (additively).
* A3 **PARTIAL**: `agg[(s,t)][3] = e["nt"]` inside the aggregation loop — the
  last enumerated row's NT wins for the merged edge. The sign (exc/inh majority
  by synapse count) is computed correctly, but the *name* can disagree with the
  sign. No runtime consumer currently reads `nt_name`, so impact is latent.
* Layer coverage: only neurons whose dominant output neuropil is in the 5 layer
  sets are kept (76.7% of proofread neurons); disclosed in the app's
  data-integrity panel. That is an APPROXIMATION of the brain, correctly
  labeled.

### 2.2 Neuron typing & metadata

* A4 **PARTIAL**: one dominant-neuropil label per neuron → the "layer" is the
  entire neuron's identity. A real lamina monopolar cell outputs in ME but is
  *of* the lamina; a T4 outputs in LO, etc. The label is real but coarse.
* A5 **MISSING**: FlyWire published cell-type annotations (FAFBNv10000000-style
  tables, also mirrored in flyvis's connectivity data) are not present in the
  repo and no schema anticipates them.
* A6 **PARTIAL**: `classify_neurons.py` / `neuron_nt_classification.csv` (all
  139,255 proofread neurons; 56.9% cholinergic, 10.6% GABAergic, 13.1%
  glutamatergic, 0.1% octopaminergic, 0.8% serotonergic, 0.4% dopaminergic,
  17.3% mixed_uncertain, 0.9% no_outgoing — `SOURCE-DERIVED` from v783 NT
  scores) is a complete, existing per-neuron NT classification — but nothing
  loads it into the sim; the 3D app instead re-derives NT by runtime majority
  vote over edge `nt_name` scores (~70% coverage, same scores, different
  method). Stage B should promote the CSV to the primary source.

### 2.3 Neural dynamics

* A7: every neuron integrates `V *= 0.86`, spikes above 30, refractory 3 ticks
  (`MODEL-ASSUMED` throughout). Injection statistics are hard-coded per layer
  (optic gain 14, AL gain 12, motor gain 8, stimulus burst 16 — `TUNED` to make
  motor output measurable; the README's `opticDrive 0.25` calibration). There
  is no per-type variation whatsoever; a 100 ms medulla interneuron and a
  descending motor neuron share parameters.
* A8 **PARTIAL**: the 3D path and `brain_worker.js` propagate via
  `sim._spikePrev` — a uniform 1-tick (~1 frame) delay. `connectomeController`
  (benchmark path) propagates *same-tick* with no delay at all, so the
  benchmarked controller is not even delay-consistent with the visualized one.
  No spatial conduction delays (nanometer coordinates exist but unused for
  latency).
* A9 **PARTIAL**: plasticity is dopamine-gated co-activity: `E[i] += 0.15` iff
  pre and post both spiked this tick, weight moves along `d = lr * DA.v` only
  for excitatory plastic edges. It is reward-modulated and causal in the loose
  sense (traces let past co-activity earn later reward) but has **no timing
  asymmetry** — ΔW does not depend on whether pre preceded post. Claimed as
  "dopamine-gated plasticity" (accurate); not STDP.
* Noise: sensory injection is stochastic per tick (`Math.random` gates);
  `exAmp` "excitability" adds noise-like current to motor neurons
  (`MODEL-ASSUMED`, slider-driven). No independent per-neuron noise process.

### 2.4 Optic input & visual binning

* A10 **MISSING**: `readVisualField()` computes 8 bins (4×2) from particle
  positions; `extract_circuit.py` emits `optic_channels` (normalized
  [u,v,depth] per optic neuron from pre-synapse centroids — `SOURCE-DERIVED`).
  But `fly_brain_circuit.json` carries **no medulla column geometry** (no
  hexgrid, no column IDs, no ommatidia mapping), so true retinotopy cannot be
  expressed. FlyWire FAFB has ~800 medulla columns; 8 bins ≈ 100 columns/bin.
* A11 **PARTIAL + BUG E1**: channel derivation `ch = min(7, (f0*4|0) +
  ((f1*2|0)*4))`. Since `f0` normalizes particle **x** (elevation in the scene)
  and `f1` normalizes **y**, the 8 channels are [2 elevation rows × 4 azimuth
  columns] read in an order that contradicts every comment ("four horizontal
  bins x two vertical bins"). Verified in `fly_demon_3d.html:1810`,
  `brain_worker.js:84`, `controllers.js:526` — three copies of the same bug.
* A12 **MISSING**: `opticChan[k] = k % 8` / `field ? … : k % 8` — optic neurons
  without position data are assigned channels round-robin. 81,830 of 81,830
  optic-layer neurons currently have channels (23,935 sit in the `k%8` fallback
  branch because their `optic_channels` entry is absent... actually the count
  field shows 81,830 entries vs 81,830 layer neurons — the fallback is dead
  *today* but live for MCNS and for any re-extraction without positions).
  Unverifiable mapping = not retinotopy.
* A13 **MISSING**: no receptive-field concept. A neuron's centroid is not its
  RF; the audit mandate explicitly requires separating *anatomical location*
  from *inferred column* from *RF* from *stimulus mapping*. Today all four are
  collapsed into one integer.

### 2.5 Brain geometry & visualization

* A14 **PARTIAL**: per-neuron positions are real mean post-synapse centroids
  (`SOURCE-DERIVED`, canonical v3 frame documented in `fly_brain_meta.json`),
  with pre-synapse fallback for neurons lacking post synapses, and (in the 3D
  app) layered-layout fallback for MCNS. Good, disclosed.
* A15 **APPROXIMATION**: hulls are voxel shells over neuron clouds, not FlyWire
  mesh assets — disclosed in `fly_brain_hulls.json` (`anchored: true` + frame
  string) and in the README ("synapse-density surfaces, not FlyWire mesh
  assets"). Honest, but geometry-driven retinotopy (Stage E) needs *column*
  resolution the hulls don't carry.
* A16 **PARTIAL**: NT-score provenance (Buhmann et al. predictions, v783) is
  documented in README and reports but not attached to the runtime cell-type
  records Stage B will produce. Schema must include provenance fields.

### 2.6 Benchmark / control-loop consistency

* A17 **PARTIAL**: the shuffled-connectome control randomizes *targets* only.
  Out-degree of every source is preserved exactly; in-degree distribution
  follows a multinomial (Poisson-ish) rather than preserved. "Degree-preserving"
  is therefore only half-true — the correct claim is "out-degree-preserving".
  Fine as a null model, but Stage D must label it precisely.
* A18 **MISSING**: no standardized stimulus protocol exists that can be fed
  identically to (a) the browser sim, (b) an improved model, (c) flyvis. All
  existing experiments (E1–E11) are chamber-behavior experiments, not
  neural-response protocols. Stage F defines it.

## 3. Roadmap mapping (Stage → findings)

| P1 stage | Addresses | Output |
|---|---|---|
| B cell-type metadata | A2, A4, A5, A6, A16 | `P1_CELLTYPE_SCHEMA.md`, `fly_brain_celltypes.json`, `p1_celltypes.js` |
| C per-type dynamics | A7, A8, A9 (A3 semantics corrected here) | `p1_dynamics.js`, `p1_sim.js`, `P1_DYNAMICS_REPORT.md` |
| D operating point | A17 (re-labeled), A7 (calibration dependence) | `P1_OPERATING_POINT_PHASE_DIAGRAM.csv` |
| E retinotopy | A10–A13, E1 semantics | `p1_retinotopy.py`, `P1_RETINOTOPY_REPORT.md` |
| F flyvis bridge | A8 (delays), A18 | `flyvis_sidecar.py`, `p1_flyvis_client.js`, `p1_parity_test.js`, `P1_FLYVIS_BRIDGE.md` |

Dependencies on P0-class changes (documented, NOT silently applied to the
shipped model):

1. **E1 (visual y-axis)** — Stage D/E measured grids must use a stated,
   consistent bin convention. P1 code defines its own `binChannels` with the
   corrected convention and documents both; the shipped `fly_demon_3d.html` /
   `brain_worker.js` / `controllers.js` are left untouched this phase.
2. **A2 (root IDs in circuit JSON)** — Stage B needs the index→root mapping.
   Rather than rewriting `fly_brain_circuit.json` (3.1 MB, P0-owned), Stage B
   ships `fly_brain_celltypes.json` keyed by **root ID**, plus the exact
   reconstruction algorithm (already proven by `_rebuild_anatomy.py`) as a
   loader invariant with a checksum. No P0 file is rewritten.
3. **A3 (NT last-write)** — Stage B re-derives edge NT by synapse-weighted
   majority in its own metadata; the shipped edge table is untouched.

## 4. Environment facts constraining the design

* All four large v783 sources are present locally: `proofread_connections_783.feather`
  (852 MB), per-neuropil pre/post counts, `synapses_connections_783.feather`
  (9.5 GB, readable), `proofread_root_ids_783.npy`.
* Python 3.14.6, pyarrow 24, numpy 2.5.1, pandas 3.0.5, scipy present.
* **flyvis absent, torch absent** → Stage F must be an interface + sidecar
  design with an explicit availability probe, not an executed bridge.
* Node v24; the full circuit parses in ~230 ms, so JS-side tooling can run the
  real circuit directly.

## 5. What this audit does NOT claim

* No cell-type annotations were invented; none existed in-repo (verified).
* No flyvis parameter values are cited or assumed anywhere in P1.
* The chamber physics (E1–E11) is out of scope; only the neural model's
  biological parameterization is audited here.
