# P1 Stage R — Per-Population Receptor Model (Design)

Status: **DESIGN — not implemented.** No code changed in this document's production.
Companion docs: `P0_IMPLEMENTATION_REPORT.md` (P0 third factor), `P1_CELLTYPE_SCHEMA.md`
(Stage B metadata), `P1_DYNAMICS_REPORT.md` (Stage C typed dynamics), `P1_BIOLOGY_AUDIT.md`
(source of the provenance-tag discipline this design inherits).

## 0. The problem being solved

P0 gave the runtime three modulatory channels (dopamine / serotonin / octopamine),
but they act through **one shared multiplicative gain** on the dopamine-gated
update:

```
G = 1 + γ_da·m_da + γ_ser·m_ser + γ_oct·m_oct      (γ = 0.15, all synapses)
```

Every plastic synapse in the circuit feels the same `G`. That is wrong in three
biological ways, each of which the data in this workspace can already constrain:

1. **Receptors are expressed per postsynaptic cell, not globally.** A
   GABAergic LN in the antennal lobe and a cholinergic MBON do not carry the
   same modulator receptor complement; a shared gain erases that.
2. **Modulators have opposite effects in different targets.** Dopamine is
   excitatory via D1-type receptors (Dop1R1/Dop1R2, Gs-coupled) and inhibitory
   via D2-type (Dop2R, Gi-coupled) in the same animal. Serotonin is
   bidirectional through 5-HT1 (Gi) vs 5-HT2 (Gq) families. Octopamine acts
   through OAMB and the β-adrenergic-like Octβ receptors with distinct coupling.
   A single positive gain cannot represent sign heterogeneity.
3. **Not every synapse is receptor-bearing.** The shared-gain model modulates
   all 553,807 fast edges; a receptor model should modulate only the fraction
   the circuit's anatomy licenses, and say so per edge.

## 1. What the data can and cannot license (provenance discipline)

Inherited rule: every fact is tagged `SOURCE-DERIVED` / `MODEL-ASSUMED` /
`EMPIRICAL` / `UNKNOWN`; nothing is fabricated.

**SOURCE-DERIVED (already on disk):**

| Fact | Source | Use in Stage R |
|---|---|---|
| Postsynaptic neuron's NT class + scores (ach/gaba/glut/oct/ser/da, 0–1) | `neuron_nt_classification.csv` → `fly_brain_celltypes.json` (`nt_class`, `nt_scores`, `nt_margin`) | the *key* of receptor-class assignment |
| Postsynaptic neuron's dominant input/output neuropil, layer | Stage B `post_neuropil`, `pre_neuropil`, `layer` | MB/central-neuropil refinement of the prior |
| Edge's presynaptic modulator identity | `modulatory_edges[].modulatorType` (P0 schema) | which ligand gates the synapse |
| Per-neuron NT confidence (`nt_dominant_score`, `nt_margin`) | Stage B | soft-assign receptor class weights by confidence |
| Modulator neuron counts (2,339 DA / 6,489 SER / 1,395 OCT) | rebuilt circuit | expected receptor-population coverage |

**MODEL-ASSUMED (will be introduced by Stage R, explicitly tagged):**

- The receptor-class **vocabulary** (D1-like, D2-like, 5HT1-like, 5HT2-like,
  OAMB-like, Octβ-like) and each class's effect sign and G-protein family.
- The **assignment prior** from postsynaptic NT class to receptor complement.
- All coupling magnitudes (`gSign`, `gMax`).

**UNKNOWN (never filled by Stage R):**

- Per-cell-type receptor expression — the Stage B `cell_type` field is
  `UNKNOWN` for all 106,765 neurons *by design* (nothing invented). When a
  published table lands, `p1_celltypes.importRows()` + the new
  `importReceptorOverrides()` (below) attach real expression without touching
  the priors' code path.
- Receptor kinetics (association/dissociation rates, desensitization).

The biological anchors (for the record, cited as justification for the
**sign structure** only, not for any parameter value): D1/D2 opposition
(Dop1R1, Dop1R2, Dop2R in FlyBase), 5-HT1/5-HT2 families, OAMB/Octβ1/2 —
all well-established Drosophila pharmacology. Stage R claims **ordering**
(excitatory vs inhibitory coupling), never measured magnitudes.

## 2. Model

### 2.1 Receptor classes and effects (MODEL-ASSUMED vocabulary, real sign structure)

| Receptor class | Ligand | G-protein family | Effect on cAMP/PKC arm | `gSign` (plasticity coupling) |
|---|---|---|---:|---:|
| `D1-like` | dopamine | Gs | ↑ | +1 |
| `D2-like` | dopamine | Gi | ↓ | −1 |
| `5HT1-like` | serotonin | Gi | ↓ | −1 |
| `5HT2-like` | serotonin | Gq | ↑ (PLC arm) | +1 |
| `OAMB-like` | octopamine | Gq | ↑ | +1 |
| `Octβ-like` | octopamine | Gs | ↑ | +1 |

`gSign` is the *direction* of the receptor's effect on the plasticity update
only. D1-like and Octβ-like both being Gs→+1 is the real structure; their
**strengths** differ and are unknown (both `gMax` values MODEL-ASSUMED).

### 2.2 Assignment: synapse → receptor population

The unit of assignment is the **fast edge** (the thing being modulated), keyed
by its **postsynaptic neuron**. For neuron *j* with NT class *C(j)*:

```
R(j) = { (class c, weight w_c) }        // receptor complement of neuron j
w_c = prior(C(j))[c] · conf(j)          // conf = nt_dominant_score
```

Prior table (MODEL-ASSUMED; rows = postsynaptic NT class, values = relative
expression weights summing to 1 across classes of the same ligand):

| Postsynaptic class | DA split | SER split | OCT split |
|---|---|---|---|
| cholinergic | D1 0.7 / D2 0.3 | 5HT1 0.5 / 5HT2 0.5 | OAMB 0.5 / Octβ 0.5 |
| glutamatergic | D1 0.5 / D2 0.5 | 5HT1 0.5 / 5HT2 0.5 | OAMB 0.5 / Octβ 0.5 |
| GABAergic | D1 0.3 / D2 0.7 | 5HT1 0.7 / 5HT2 0.3 | OAMB 0.3 / Octβ 0.7 |
| mixed_uncertain / UNKNOWN | 0.5/0.5 | 0.5/0.5 | 0.5/0.5 |

Rationale (to be written into the code's provenance block): GABAergic
interneurons are biased toward inhibitory modulation in the prior because the
MB conditioning literature finds suppression of inhibitory feedback by DAN
activity; cholinergic output neurons are biased toward D1-like potentiation.
These are **priors over which the ablation protocol (§5) is the test**, not
claims about any named cell.

Neuropil refinement (optional, SOURCE-DERIVED key): neurons whose dominant
input neuropil is MB (CA/ML/VL/PED) get the DA prior sharpened to D1 0.8/D2 0.2
on cholinergic neurons — the canonical KC×DAN→MBON geometry. Every use of the
refinement is tagged and can be disabled by a flag so the coarse prior can be
ablated independently.

### 2.3 Synaptic modulation rule (replaces the P0 scalar)

For fast edge *k* with target *j*, modulated by ligand *L* with activity
`m_L` (the P0 per-modulator EMA, unchanged):

```
G(k) = 1 + Σ_c  gMax_c · gSign_c · w_c(j) · m_L(c)
```

where `m_L(c)` is the EMA of the ligand that receptor class *c* binds. Because
`w_c(j)` sums to 1 per ligand, `G` stays in `1 ± max(gMax)` — the P0 behavior
is the special case `w_c = 1, gSign = +1, gMax = 0.15` for every neuron.

Sign consequence (the point of the whole stage): a DA spike now **potentiates**
D1-dominant cholinergic targets and **depresses** D2-dominant GABAergic
targets within the same tick — the bidirectional teaching geometry the
mushroom body needs, without inventing a new algorithm.

Eligibility gating is unchanged: `plastic[k]` (co-activity), `TRACE_FLOOR`,
clamps, `da.v` teaching signal, frozen-test semantics — all identical to P0.

### 2.4 Coverage (which edges are receptor-bearing)

Default: **all fast edges** (every postsynaptic neuron has a complement).
Optional `receptorCoverage: "nt_margin"` variant zeroes modulation for edges
onto `mixed_uncertain` neurons below a margin threshold — an honest
"unresolved targets get no invented modulation" mode. Default is all-bearing
because zeroing is itself a modeling choice; the variant exists for ablation.

## 3. Data & code surface

### 3.1 New artifact: `fly_brain_receptors.json` (built by `p1_build_receptors.py`)

```json
{
  "meta": {
    "schema_version": 1, "p1_stage": "R",
    "n_neurons": 106765,
    "root_ids_sha256": "<same hash discipline as Stage B>",
    "join": "index i = circuit neuron i (sorted root IDs, verified)",
    "vocabulary": ["D1-like","D2-like","5HT1-like","5HT2-like","OAMB-like","Octβ-like"],
    "provenance": { "assignment_prior": "MODEL-ASSUMED", "sign_structure": "EMPIRICAL-ANCHORED (FlyBase pharmacology; sign only)",
                    "expression_data": "UNKNOWN — no published per-cell-type receptor table in workspace",
                    "nt_source": "Buhmann predictions via classify_neurons.py", "mb_refinement": "on|off" }
  },
  "neurons": [
    { "i": 0, "root_id": "…", "nt_class": "cholinergic",
      "receptors": { "D1-like": 0.7, "D2-like": 0.3,
                     "5HT1-like": 0.5, "5HT2-like": 0.5,
                     "OAMB-like": 0.5, "Octβ-like": 0.5 },
      "prov": { "receptors": "MODEL-ASSUMED", "nt_class": "SOURCE-DERIVED" } }
  ]
}
```

Flat parallel arrays (one f32 per class per neuron, 6 × 106,765 × 4 B ≈ 2.5 MB)
for the runtime; the JSON is the auditable source of truth.

### 3.2 Code changes (surgical, mirrors P0's integration pattern)

| File | Change |
|---|---|
| `p1_build_receptors.py` (new) | builds the JSON from Stage B + circuit modulator types; `--self-test` (prior rows sum to 1 per ligand; assignment deterministic; hash-verified join) |
| `p1_receptors.js` (new) | `loadReceptors()`, `receptorGain(receptors, neuronIdx, modEma)` pure function (unit-testable), `importReceptorOverrides(rows)` extending the Stage B import contract for future published expression tables |
| `controllers.js` | `applyLearning` swap: shared `G` → per-edge `G(k)` via target lookup. Cost control: precompute per-neuron base weights once (`D1j, D2j, …`); inner loop becomes one extra indexed read + FMA per *active* edge (active-list is already bounded at 40,000) |
| `p1_sim.js` | **also fix the P0 gap**: this sim still ships `plastic = sign>0` / `!isExc[i]` gating and ignores `modulatory_edges` (verified today). Stage R gives it the P0-modern path *plus* receptor gains so the parity harness compares like with like |
| `test_p1r.js` (new) | suite in §6 |
| `P1_STAGE_R_REPORT.md` (new) | post-implementation report in the P0 report's format |

`brain_worker.js`/`fly_demon_3d.html` get the same per-edge gain once
`p1_sim.js` validates it — same order as P0 (experiment path first).

### 3.3 Runtime cost

Per **active** (trace-above-floor) edge: one `dst` read that already happens
and one f32 FMA per ligand-class pair — realistically 2–3 FMA after
precompositing `(gMax·gSign·w_c)` per neuron per ligand into two scalars
(net + / net −). No new arrays in the tick loop; no change to the CSR
propagation, eligibility windows, or RNG stream. Expected overhead well under
the existing eligibility-walk cost; measured in the report.

## 4. Determinism & provenance guarantees (hard requirements)

1. Same inputs → byte-identical receptor file (hash-checked like Stage B).
2. `receptorGain` is pure: no RNG, no iteration-order dependence.
3. Every parameter carries a tag at build time; `p1_tests.js` gains a check
   that no `EMPIRICAL`/`SOURCE-DERIVED` tag appears without a `source` string.
4. The legacy P0 path remains reachable: `opts.receptors = null` reproduces
   P0 bit-for-bit (regression-tested both ways).
5. No benchmark or E-family definition changes; no reward coefficients touched.

## 5. Validation & falsification protocol (pre-registered before implementation)

The danger of a receptor model is that it *adds degrees of freedom that only
make the benchmark look better*. Therefore:

- **R1 — Ablation matrix (primary).** Run the E1 quick protocol (2 seeds,
  identical seeds to P0's before/after) under: (a) P0 shared gain, (b) Stage R
  priors, (c) Stage R with D1≡D2 (sign-flattened), (d) Stage R with shuffled
  receptor↔neuron assignment (degree-preserving, seeded — the receptor analog
  of the connectome control), (e) `receptorCoverage:"nt_margin"`.
  Pre-registered prediction: (c) and (d) degrade real-connectome performance
  toward shuffled-connectome levels while (b) ≥ (a). **If (d) ≈ (b), the
  receptor structure is decoration — report that and recommend not shipping it.**
- **R2 — MB refinement on/off.** The §2.2 neuropil sharpening is its own flag;
  its effect is measured separately, never bundled.
- **R3 — Parity.** `p1_parity_test.js` stimulus suite re-run with Stage R
  dynamics: receptor modulation must not shift the flash/edge responses of the
  *unmodulated* baseline (modulation only acts on plasticity, not on the LIF
  tick) — a clean no-op check.
- **R4 — Determinism.** Same-seed drift-trace equality (P0 test 13 pattern)
  under Stage R.
- **R5 — No-tuning invariant.** γ/gMax values fixed at implementation start,
  committed in the provenance block, and never edited afterward; the report
  shows the git history of that block as evidence.

## 6. Test list (test_p1r.js, node:test, zero deps)

1. Prior table rows sum to 1 per ligand; assignment deterministic.
2. Hash-verified join: receptor file neuron i ↔ circuit neuron i ↔ Stage B record i.
3. `receptorGain` sign: D1-dominant target with m_da>0 → G>1; D2-dominant → G<1.
4. Bidirectionality: same m_da, opposite receptor complements → gains mirror.
5. Ligand specificity: m_ser>0, m_da=0 changes only SER-class terms.
6. P0-equivalence: with complements forced to {class:1.0}, gMax=0.15, gSign=+1,
   G(k) ≡ P0's shared gain (bit-equal on a fixture).
7. `opts.receptors=null` path ≡ P0 (existing `test_p0.js` suite passes unchanged).
8. Coverage variant: `nt_margin` mode zeroes modulation for low-margin targets only.
9. MB refinement flag flips only MB-input cholinergic neurons' weights.
10. `p1_sim.js` post-fix: eligibility no longer sign-gated; modulatory edges
    produce third-factor activity; P0 test 6/7 semantics reproduce there.
11. Determinism: same-seed 30-tick drift trace identical across two builds.
12. Smoke: E9 core one trial under Stage R; finite rewards; 34/34 legacy E9
    gates re-pass.

## 7. Out of scope (explicit)

- Receptor kinetics/desensitization (needs data that doesn't exist here).
- Any change to E1–E11 definitions, reward coefficients, or E10/E11 physics.
- flyvis dependency (Stage F boundary respected; the sidecar stays the only
  flyvis surface).
- Claiming measured receptor expression for any named cell type — the
  `cell_type` import path stays the only door for that, and it is currently
  `UNKNOWN` everywhere, honestly.

## 8. Estimated surface

~1 new Python builder (+ self-test), ~120 lines of new JS, a ~15-line
`applyLearning` change in two sims, one new test file (~250 lines), one report.
No experiment cores touched. Risk concentrated in the `applyLearning` hot
loop — mitigated by the precompositing in §3.3 and the bit-equality regression
(test 6).
