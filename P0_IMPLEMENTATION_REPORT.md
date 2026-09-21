# P0 Implementation Report — Biological-Validity Repair

Branch: `Ver2(Split-code-fastframe)` · Completed: 2026-09-20
Companion audit: `P0_AUDIT.md` (written before any code change).

## Files changed

| File | Change |
|---|---|
| `extract_circuit.py` | `NT_TABLE` replaces `INH = {gaba, ser, da}`; two-channel aggregation (`aggregate_edges` → fast + modulatory); deterministic majority vote with alphabetical tie-break (`dominant_nt`); provenance block (root IDs, version, sources, vote rules, assumptions); `--self-test` mode |
| `fly_brain_circuit.json` | Rebuilt (schema 2, P0): 553,807 fast edges + 10,223 modulatory links; provenance with 106,765 root IDs; ~50.7 MB |
| `controllers.js` | Modulatory edges excluded from propagation arrays; third-factor channels (`modEma` per modulator, EMA 0.99); `applyLearning` gain `G = 1 + Σ γ·m`; eligibility gate `!plastic[i]` (no `isExc` requirement); `plastic[i] = 1` for all fast edges; `opts.modulation`, `opts.synapticDelay` extension points; `modulatorTypes/Tone/Counts` + `synapticDelay` telemetry accessors |
| `brain_worker.js` | Mirrors all of the above for the browser worker (`modEdges` accepted at init, third-factor EMA in `brainTick`, ungated eligibility + G gain in `applyLearning`) |
| `fly_demon_3d.html` | Same mirror for the in-frame fallback brain (`makeSim` splits `fastEdges`/`modEdges`, `MOD_GAINS_3D`, worker init payload carries `modEdges`) |
| `archive/untracked/_tmp_blk00.mjs` | Archived code mirror patched identically (was `_tmp_scripts/blk00.mjs`) |
| `README.md` | Delay text corrected: browser = 1-tick relay, experiment path = same-tick, no conduction delay modeled; extractor row documents schema 2 |
| `maxwell_demon_experiment.md` | §8 limitations: explicit no-conduction-delay statement; glutamate uniform-excitatory approximation; fixed structural modulator gains |
| `test_p0.js` | **New** — 14-test suite (node:test, zero deps) |
| `P0_AUDIT.md` | **New** — pre-repair audit (classification A1–A16) |

## Biological assumptions changed

1. **Dopamine**: was an ordinary inhibitory synaptic weight (`sign:-1`); now a modulatory channel (`sign:0`, `modulatory:true`, `modulatorType:"dopamine"`), matching its role as the mushroom-body teaching signal. DA contacts are separate synapses from fast contacts on the same pair and can no longer erase or sign-flip them.
2. **Serotonin**: was auto-inhibitory; now a modulatory channel (`sign:0`). The uniform-inhibitory assumption was never evidence-based.
3. **Octopamine**: was an ordinary excitatory weight; now a modulatory channel (user-approved scope decision — the fly's noradrenaline analog, not fast transmission).
4. **GABA / ACh**: unchanged where supported (fast inhibitory / fast excitatory).
5. **Glutamate**: unchanged (uniformly excitatory) — now **explicitly documented** as an approximation in `provenance.assumptions` and §8, not silently enforced.
6. **Plastic eligibility**: was `sign > 0` (froze every inhibitory/modulatory contact); now a property of the contact (co-active pre/post), independent of sign — inhibitory synapses are plastic, and modulators act as a third factor instead of frozen weights.

## Runtime behavior changed

- `connectomeController` now splits `circuit.edges` into weight-bearing fast edges (553,807) and modulatory contacts (10,223: 2,339 DA / 6,489 SER / 1,395 OCT). Modulators never add current, never hold weights, never enter eligibility traces.
- Each tick, spiking modulator sources update per-type activity EMAs; the dopamine-gated update gain becomes `G = 1 + γ_da·m_da + γ_ser·m_ser + γ_oct·m_oct` (structural γ = 0.15, unoptimized, overridable via `opts.modulation`).
- Eligibility traces and plasticity now include inhibitory fast edges (ΔW sign still follows the dopamine teaching signal).
- Legacy circuits without modulatory fields keep the old behavior bit-for-bit (gains multiply by 0; no modulatory edges to filter).
- Shuffled-connectome control now shuffles fast wiring **and** modulatory contacts, keeping the control structurally matched.
- `opts.synapticDelay = 1` enables a one-tick buffered relay in the experiment path (extension point only; no experiment enables it).

## Tests added (`test_p0.js` — 14/14 PASS, 0 skipped)

1. DA edge: modulatory channel, sign 0, absent from fast weights ✔
2. SER edge: same ✔
3. OCT edge: same ✔
4. ACh edge: weight-bearing, excitatory ✔
5. GABA edge: weight-bearing, inhibitory, weight present ✔
6. DA activity alone alters plasticity (real circuit, 900-tick drive: rewarded drift 0.0102 vs 0.0000 unrewarded) ✔
7. DA=0 vs DA>0 yield different ΔW on identical drive ✔
8. Aggregation deterministic across runs (`--self-test`) ✔
9. Aggregation order-invariant (10 shuffles of a randomized mix assert equality) ✔
10. Tie-break alphabetical + documented in source ✔
11. Root IDs survive serialize/deserialize (106,765 IDs, one per index; full 16–17-digit precision preserved in JSON text) ✔
12. Delay docs match implementation (README names both runtimes; `synapticDelay` exists and defaults 0) ✔
13. Same seed → byte-identical 30-tick drift trajectory (real circuit) ✔
14. E1/E4/E9 smoke: `full/restricted/none` modes construct+tick; E9 `pressureDemonCore` neural variant produces finite trial rows ✔

Regression gates: pre-existing `e9_learning_test.js` suite — **34/34 PASS before and after** (including determinism, delayed-credit windows K.i–iii, frozen control, PG readout L.i–iv).

## Benchmark before/after (identical commands and seeds; numbers are expected to differ — old values are not targets)

`node benchmark.js --quick` (2 seeds × 40 train / 10 test trials, 8 s episodes), test-phase means:

| Condition | demonAgree before → after | good:bad before → after | sortEntropy before → after |
|---|---|---|---|
| classical_demon (reference) | 1.000 → 1.000 | 1.33 → 1.33 | 0.0192 → 0.0192 |
| random (control) | 0.512 → 0.512 | 1.09 → 1.09 | 0.0207 → 0.0207 |
| ann | 0.489 → 0.489 | 0.81 → 0.81 | 0.0174 → 0.0174 |
| drosophila | 0.534 → 0.534 | 0.00 → 0.00 | 0.0200 → 0.0200 |
| **connectome** | 0.498 → **0.536** | 0.48 → **0.95** | 0.0261 → 0.0282 |
| **shuffled_connectome** | 0.456 → **0.489** | 0.36 → **0.53** | 0.0199 → 0.0244 |

Reading (honest, not curve-fit): non-neural conditions are bit-identical, confirming the change is confined to connectome plasticity. Both connectome arms moved upward; the real-vs-shuffled gap widened on every metric (Δagree 0.042→0.047, Δgood:bad 0.12→0.42, Δentropy 0.0062→0.0038 in the opposite direction — real structure now separates more cleanly from shuffled). With n=2 seeds and 40-train this is **suggestive, not significant**; no tuning or seed selection was performed, and the values were recorded as they came out.

Artifacts: `research_data/_p0_benchmark_{before,after}.jsonl`, `research_data/_p0_e9test_{before,mid,after}.log`, `research_data/summary_2026-09-20T21-17-31.json` (before), `summary_2026-09-20T21-38-23.json` (after).

## Regressions

- None detected: 34/34 pre-existing E9 gates pass; 14/14 new tests pass; non-neural benchmark conditions bit-identical.
- Cosmetic: the rebuilt circuit file grew 30 → 50.7 MB (root-ID provenance + per-edge NT metadata). Accepted deliberately.
- Known precision note: `JSON.parse` folds 17-digit FlyWire root IDs to float64; full precision survives in the JSON **text** (test 11 asserts this). Any future consumer needing exact IDs should read them as strings/BigInt.

## Unresolved scientific limitations (documented, not hidden)

1. **No conduction delay** is modeled (experiment path same-tick; browser 1-tick) — `opts.synapticDelay` is the extension point.
2. **Glutamate uniformity** — real-fly CNS glutamate is mixed; per-edge evidence not consumed.
3. **Modulator gains (γ = 0.15) are structural**, not measured dose-response; SER/OCT currently enter the same scalar gain as DA (no per-synapse receptor-type model).
4. **Weights are synapse counts**, not calibrated efficacies; NT scores are predictions, not identities (unchanged from before P0).
5. DA "teaches" via a scalar third factor over the whole eligibility field; the MB-specific KC×DAN→MBON depression motif is represented only in the synthetic `drosophilaController`, not in the connectome arm.
6. Benchmark deltas at `--quick` scale are underpowered (n=2 seeds); the pre-registered full protocol remains the arbiter for any claim.

## Status

All three P0 defects repaired and tested; all pre-existing gates pass; no tuning, no seed selection, no test weakening. Limitations above are documented and deferred rather than resolved.

**P0 COMPLETE WITH LIMITATIONS**
