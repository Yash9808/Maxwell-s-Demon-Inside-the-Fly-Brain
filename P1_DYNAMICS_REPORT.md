# P1 Stage C — Per-Type Dynamics Report

Status: **implemented** (`p1_dynamics.js`, `p1_sim.js`; validated by `p1_smoke.js` and the regression suite).

## What changed vs the shipped model

The shipped model (`fly_demon_3d.html` makeSim/brainTick, `brain_worker.js`) has
exactly one dynamics rule for all 106,765 neurons:

| Parameter | Value | Provenance tag |
|---|---|---|
| leak factor (per tick) | 0.86 | TUNED (README optic-drive calibration) |
| spike threshold | 30 | TUNED |
| refractory | 3 ticks | TUNED |
| resting potential | 0 (implicit) | MODEL-ASSUMED |
| weight scale | 0.02 | MODEL-ASSUMED |
| reset | hard `V=0` on spike | MODEL-ASSUMED |
| delays | 1 tick, uniform (3D/worker path); 0 ticks (benchmark path) | MODEL-ASSUMED |
| plasticity | dopamine-gated co-activity (no pre/post ordering) | MODEL-ASSUMED |

Stage C keeps that rule reachable (`profile: "legacy"`, used as the audit
baseline in the parity test) and adds the **typed profile** in which every
parameter resolves from the neuron's type (Stage B metadata), never randomly:

## Parameter classes (typed profile)

Classes are selected by coarse type: optic-layer membership, motor-layer
membership, and neurotransmitter class for modulatory neurons. Selection facts
are SOURCE-DERIVED (real layer membership and NT class); the *values* are
documented parameter classes — biologically **ordered**, not measured.

| Class | Neurons | tauMem | theta | tRef | noiseRate | Rationale (MODEL-ASSUMED) |
|---|---:|---:|---:|---:|---:|---|
| `optic_phasic` | 81,787 | 0.80 | 24 | 2 | 0.010 | visual pathway: fast, phasic, low threshold |
| `central_standard` | 17,225 | 0.86 | 30 | 3 | 0.006 | central integration (legacy-adjacent anchor) |
| `motor_integrating` | 6,780 | 0.90 | 34 | 4 | 0.004 | motor output: longer integration, stability |
| `modulatory_slow` | 973 | 0.92 | 40 | 8 | 0.002 | da/ser/oct: sparse, long refractory |
| `legacy_global` | (baseline) | 0.86 | 30 | 3 | 0 | the shipped rule, preserved verbatim |

Class distribution on the real circuit (computed, not assumed):
`optic_phasic 81,787 · central_standard 17,225 · motor_integrating 6,780 ·
modulatory_slow 973`. Inhibitory-polarity neurons (GABAergic) keep their
neuropil class parameters; polarity lives on **edges** (sign), not on the
membrane rule — matching how the connectome encodes it.

Additional per-neuron mechanics introduced in `p1_sim.js`:

* **Resting potential** `Vrest` with leak toward it (`V = Vrest + (V−Vrest)·tauMem`) —
  the legacy rule is the `Vrest = 0` special case.
* **Soft reset** (`V -= theta`) instead of hard zero — residual memory of
  sub-threshold input, standard LIF practice. MODEL-ASSUMED.
* **Per-class intrinsic noise** (rate + amplitude), replacing part of the
  legacy's injection-side randomness. MODEL-ASSUMED.
* **Structured conduction delays**: per-edge delay buckets with ring-buffered
  spike history. Default rule: `1 + depth·2` ticks where `depth` is the optic
  source neuron's SOURCE-DERIVED radial synapse-position axis (`optic_channels[2]`,
  normalized 0–1 across optic neurons); the 1+2·depth mapping is MODEL-ASSUMED.
  Result: delays span **1–3 ticks** (16.7–50 ms at frame semantics) with real
  anatomical ordering, vs the legacy uniform 1 tick (and 0 ticks in the
  benchmark path — see audit A8).
* **Causal, dopamine-gated STDP** (optional, `stdp` option): pairwise-approx
  with pre/post *ordering*: pre-before-post → LTP (`Aplus = 0.10`),
  post-before-pre within `tauPost = 20` ticks → LTD (`Aminus = 0.12`, slight
  stability bias), all gated by the dopamine signal `lr·DA.v` exactly like the
  legacy gate. All four STDP parameters: MODEL-ASSUMED (documented; no
  measured LTP/LTD magnitudes are claimed anywhere in this workspace).

## Provenance discipline

* Every class parameter carries an explicit tag in `PARAM_CLASSES[key].prov`
  and per-neuron in `provPerNeuron[i]` (worst-case tag of the resolved class).
* Tags used in this stage: `MODEL-ASSUMED` (all typed values), `TUNED` (the
  preserved legacy profile only), `SOURCE-DERIVED` (the *membership facts* that
  select classes and the delay axis), `UNKNOWN` (refinements that would need
  published per-cell-type tables — see below).
* No parameter in this stage is tagged EMPIRICAL, and nothing is silently
  TUNED: `resolveDynamics` cannot receive tuned values, and
  `setClassOverride` **throws** unless the caller passes an explicit
  provenance ≠ MODEL-ASSUMED (regression-tested).

## Where exact parameters would attach (UNKNOWN, not fabricated)

The audit (A5) verified that no flyvis parameter tables exist in this
workspace; per the mandate nothing is invented. The mechanism is ready:

```js
const { setClassOverride, PROV } = require("./p1_dynamics");
// e.g. after importing a published per-cell-type table:
setClassOverride("T4c", { tauMem: <value>, theta: <value>, tRef: <value> },
                 PROV.SOURCE_DERIVED);   // or EMPIRICAL, with the citation in `source`
```

Imported overrides are applied per-neuron when the Stage B `cell_type` matches
(they are `UNKNOWN` for all neurons today, so zero overrides apply — verified
by test). This makes the "global decay/threshold/refractory/weight" permanently
non-unique: any neuron can carry its own parameters from data, and the legacy
model remains available as one profile among others.

## Validation summary (details in p1_tests.js)

* legacy profile reproduces the shipped rule (class counts: 106,765 × legacy_global).
* typed profile resolves all 106,765 neurons to exactly the four classes above.
* STDP produces ordering-dependent events (LTP ≠ LTD counts; LTD requires
  post-before-pre within tauPost).
* shuffle control is deterministic and preserves BOTH degree sequences
  (1,090,132 double-edge swaps at seed 7).
* response traces record per-tick population rates for the parity harness.
