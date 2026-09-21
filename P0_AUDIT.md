# P0 Audit — Biological Validity of the Connectome Pipeline

Branch: `Ver2(Split-code-fastframe)` · Date: 2026-09-20 · Scope: audit only, no code modified in this document's production.

Runtime path audited end-to-end: `fafb783.py` (loaders) → `extract_circuit.py` (circuit build) → `fly_brain_circuit.json` (30 MB) → `controllers.js` (`connectomeController`) → `experiment_core.js` (E1–E11 cores) → `benchmark.js` / `e9_learning_test.js` / `experiment_worker.js`. Browser mirror path: `brain_worker.js` + `fly_demon_3d.html`.

## Classification legend

**REAL** — implemented as described and scientifically defensible as-is.
**PARTIAL** — implemented but with a defect that limits validity.
**INCORRECT** — implemented in a way that is biologically wrong.
**DECORATIVE** — present in the data but never used by the runtime.
**SCRIPTED** — hard-coded behavior wearing the label of biology.
**MISSING** — required by the scientific claim, absent.

## Findings

| # | Component | Where | Classification | Evidence / notes |
|---|-----------|-------|----------------|------------------|
| A1 | LIF neuron model (decay 0.86/tick, threshold 30, refractory 3) | `controllers.js` `brainTick` | REAL | Deterministic, seeded, used by every experiment. |
| A2 | Spike propagation, experiment path | `controllers.js` L605–617 | PARTIAL | Currents are injected **same-tick** (source spike → target `V` in the same `brainTick`). The README claims "a 1-tick synaptic delay"; that is true only of the browser mirror (`brain_worker.js` `_spikePrev` buffer, `fly_demon_3d.html` L1828). Two runtimes, two delays, docs describe one. |
| A3 | Neurotransmitter sign assignment | `extract_circuit.py` (`INH = {"gaba","ser","da"}`) | **INCORRECT** | DA and SER edges become ordinary `sign:-1` weights; octopamine becomes an ordinary `sign:+1` weight. In the fly, DA is the mushroom-body **teaching signal** (KC(ACh)×DAN→MBON depression), SER is predominantly modulatory, and octopamine is the neuromodulatory analog of noradrenaline (arousal/state), not fast excitatory transmission. Sign must be separated from identity and from modulatory role. |
| A4 | NT aggregation across parallel (s,t) rows | `extract_circuit.py` step 4 | PARTIAL | Per-pair aggregation keeps **whichever NT label was seen last** (`a[3] = e["nt"]`) — order-dependent in principle; the sign vote (`exc_w vs inh_w`) ignores NT identity entirely; no tie-break rule; no contributor provenance. Raw FlyWire rows arrive sorted, so behavior is deterministic today, but nothing enforces it. |
| A5 | Plasticity eligibility | `controllers.js` L459 `plastic[i] = e.sign > 0` + L718 `if (!plastic[i] \|\| !isExc[i]) continue` | **INCORRECT** | Only edges labeled `sign:+1` are both plastic and updated. Two consequences: (a) any DA/SER edge is a frozen negative weight — a teaching pathway that cannot teach; (b) even under correct semantics, the rule conflates *transmission sign* with *plastic eligibility* — inhibitory synapses are plastic in real circuits. Mirrored at `brain_worker.js` L41/L116 and `fly_demon_3d.html` L1845. |
| A6 | NT identity in the experiment runtime | controllers / core / worker | **DECORATIVE** | `nt_name` is carried in the circuit JSON and colored in the 3D view (`fly_demon_3d.html` L1047), but no experiment reads it. The learning machinery is NT-blind. |
| A7 | Reward → dopamine → plasticity (E9 pathway) | `controllers.js` `receiveFeedback` L760–776 → `da.v` → `applyLearning` L713 | REAL | Explicit scalar reward enters an additive dopamine state that gates a multi-window eligibility-trace update. Correct hook for third-factor modulation; no new algorithm needed. Verified by `e9_learning_test.js` gates F/K/L (all PASS pre-repair). |
| A8 | Per-crossing eligibility windows | `controllers.js` `updateTraces` | REAL | Fast/mid/slow traces with lazy decay; frozen-test control verified (K.iii). |
| A9 | Shuffled-connectome control | `controllers.js` (degree-preserving target shuffle, seeded) | REAL | The key connectome-science control; present and correct. |
| A10 | Toy mushroom-body controller | `controllers.js` `drosophilaController` | PARTIAL (by design) | DA-gated wMB/wPNVis plasticity is mechanistically sensible, but it is a synthetic 32/200/16 network — it does not read the connectome and carries no NT data. Keep as the "theory benchmark" arm; do not confuse with the connectome arm. |
| A11 | Circuit JSON provenance | `fly_brain_circuit.json` | **MISSING** | Keys are exactly `layer_names, optic_layer, optic_channels, nt_name, layers, edges`. No FlyWire root IDs, no extraction version, no source list, no index→root mapping. Index→root is only recoverable by re-running extraction against the .feather inputs. |
| A12 | Root-ID mapping determinism | `extract_circuit.py` (`all_ids = sorted(layer_of)`) | REAL | Index = position in sorted root-ID list; deterministic given the same inputs. (Provenance *storage* is still A11.) |
| A13 | Glutamate sign | `extract_circuit.py` | PARTIAL | Uniformly excitatory. Real-fly CNS glutamate is mixed. The assumption is inherited, undocumented in the runtime path, and must be stated explicitly rather than silently enforced. |
| A14 | Synaptic delay | controllers vs brain_worker | PARTIAL | See A2. Experiment path: same-tick. Browser path: 1-tick via `_spikePrev`. `maxwell_demon_experiment.md` §8 honestly lists "synaptic delays" as not provided; `README.md` L382 contradicts it for the browser path only. |
| A15 | Reward coefficients / benchmark tuning | `controllers.js` L761–776, cores | REAL (untouched) | Confirmed no audit-time tuning; out of P0 scope. |
| A16 | E-family identity | `experiment_core.js`, `experiment_worker.js` | REAL | E1–E11 definitions intact; P0 must not redesign them. |

## The three P0 defects in one line each

1. **DA/SER (and OCT) are mis-modeled as signed fast synapses** (A3) — the mushroom-body teaching motif is unrepresentable.
2. **`plastic = sign > 0` freezes every modulatory / inhibitory edge** (A5) — plasticity is structurally blind to NT.
3. **Aggregation has no deterministic, biologically meaningful rule** (A4) and the circuit file carries no provenance (A11).

## Constraints honored going into repair

- No flyvis / flybody / E12+ / UI redesign / E10–E11 physics change / reward or physics tuning / seed selection / test weakening.
- Existing evidence is preserved (NT prediction scores stay the aggregation input); no invented biology.
- Downstream numbers are expected to change and will be reported, not matched.
