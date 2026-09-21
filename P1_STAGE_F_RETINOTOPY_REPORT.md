# Stage F — Retinotopic Optic Input Wired into the Runtime

Status: **IMPLEMENTED AND VERIFIED.** Companion docs: `P1_STAGE_R_RECEPTOR_DESIGN.md`
(Stage R), `maxwell_demon_experiment.md` §2 (updated optic-input description),
`P1_BIOLOGY_AUDIT.md` E1 (the legacy 8-bin axis mislabel this stage retires).

## What changed (one sentence)

The verified Stage E retinotopy data (`fly_brain_retinotopy.json`: 81,830 optic
neurons with SOURCE-DERIVED (u,v,depth), hex-column assignment, confidence) is
now the default optic input of every runtime — experiment controllers, the
typed P1 sim, the 3D app's worker and in-frame fallback brains — while the
legacy 8-bin path remains reproducible bit-for-bit behind an explicit option.

## Files changed

| File | Change |
|---|---|
| `p1_retinotopy.js` | NEW. Shared Stage F module: exact JS mirror of the Stage E hex lattice (N_U=40 × N_V=20, rows offset by half a step), `nearestColumn`, `buildOpticColumns` (neuron→column Int32Array + per-column lists), `readVisualFieldRetinotopy` (stimulus field from particles), `liftLegacyField` (8-bin→column fallback layout). Dual-environment: `module.exports` under CommonJS (Node + worker/smoke sandboxes), `Retinotopy` global under browser `<script>`. Node detection is by capability (require must actually work) — sandbox `require` stubs throw by design. CLI self-test: lattice geometry equals the Python-emitted JSON textually (800/800 nodes) and 2,000 neuron round-trips reproduce the stored columns with 0 mismatches. |
| `controllers.js` | `connectomeController` gains `opticInput: "retinotopy" | "legacy8bin"` (default retinotopy). Retinotopy mode builds per-column neuron lists at factory time; `brainTick` injects per column with the SAME decimation semantics as legacy (p = drive·2·opticScale, 4× rotating subset, kick 14); `observe()` computes the 800-bin field from `env.particles` + shared `CH` constants (chosen over an env method to keep `experiment_core.js` require()-free — see constraint below). Legacy mode is the untouched 8-bin path. |
| `p1_sim.js` | Opt-in `opticInput` option; **default stays `legacy8bin`** so `P1_PARITY_RESULTS.json` remains a valid regression instrument (parity suite runs without learning; recorded correlations unchanged: 0.9214–0.9911). Retinotopy mode consumes `inp.retinotopicField` (native 800-bin) or lifts an 8-bin `inp.visual` through the declared layout, with the same p = drive·0.5 injection semantics. |
| `brain_worker.js` | Accepts a length>8 `visual` packet: each optic neuron reads its precomputed hex column (`sim.opticCol`). Length-8 packets use the legacy `opticChan` map unchanged. ALSO FIXED a discovered P0-parity violation: `plastic: sign` aliased plasticity to the excitatory-sign array, silently freezing every inhibitory synapse in the browser path; now `plastic` is all-ones over fast edges, mirroring `controllers.js`. |
| `fly_demon_3d.html` | `p1_retinotopy.js` script tag; shared `RT_NODES`; `readVisualField()` returns the 800-bin field by default (`window.USE_LEGACY_8BIN = true` restores the pre-F app behavior); worker tick packets are length-adaptive; in-frame fallback brain gets the per-column branch; init message carries `opticCol` (Uint16Array, per-neuron column, 0xFFFF = unassigned). |
| `experiment_worker.js` | Import chain extended: `p1_retinotopy.js` loaded hermetically (no-require stub), `controllers.js` require stub now dispatches on the requested module id. |
| `experiment_core.js` | COMMENT ONLY, after two revert cycles (below): documents the require()-free constraint. Its 8-bin `readVisualField` and the `spatialEntropy` metric are untouched — E1–E11 metric definitions unchanged. |
| `maxwell_demon_experiment.md` | §2 updated: NT-sign paragraph brought to P0 semantics (it still said "octopaminergic excitatory, dopaminergic inhibitory"); optic-input paragraph now describes the 800-column field and the legacy escape hatch. |

## Two declared conventions (MODEL-ASSUMED, documented in code)

1. **Relative-contrast coding.** The 800-bin field divides each column by the
   max column intensity of the same snapshot. Without it, raw per-column
   intensities peak at ~0.06 (320 particles over ~256 columns) and the optic
   layer sits below spike threshold at the experimental opticScale (0.25) —
   measured before this fix: optic layer rate 0.0, a decorative wiring.
   Legacy 8-bin fields saturate near 1.0 for any busy scene, which is what
   had kept the optic layer at threshold. Normalizing by snapshot max
   preserves all spatial structure (which columns are occupied and their
   ratios are pure data) and gives the busiest column the drive a saturated
   legacy bin carried. Consistent with contrast normalization in the early
   fly visual system; not a measured biological parameter.
2. **Legacy-bin lift.** Envs that only provide an 8-bin field (zero-field
   stubs) get each legacy bin's intensity filled into the hex columns inside
   its rectangle, then the same contrast normalization. Prevents silent zeros
   in retinotopy mode.

## Constraint discovered and honored

`tests/run_smoke.js` (S7–S10) executes `experiment_core.js` inside a hermetic
determinism sandbox where `require()` throws, and `experiment_worker.js`
evaluates sources with require stubs. Two wiring attempts (field builder in
`experiment_core.js`; plain `require` in sandboxed `controllers.js`) broke
S5–S10 and were **reverted**; the final design computes the field in
`controllers.js` from `env.particles` and keeps the require edge to
`p1_retinotopy.js` only where real CommonJS exists.

## Verification (all run live, this session)

| Check | Result |
|---|---|
| `p1_retinotopy.js` self-test | geometry 800/800 exact vs Python JSON; 2,000 round-trips, **0 mismatches** |
| `node --test test_p0.js` | **14/14** |
| `tests/run_smoke.js` | **41/41, zero FAIL** (includes S2 page module syntax, S6 E4, S9 golden E1 replay, S10 benchmark determinism) |
| `e9_learning_test.js` | **34/34 PASS, 0 FAIL** (E9 uses opticDrive 0 — bit-preserved) |
| `p1_tests.js` | **54 PASS** |
| `p1_smoke.js` | weight drift **2710.9 — bit-identical** (p1_sim default path untouched) |
| `p1_parity_test.js` | correlations unchanged (legacy↔typed 0.92–0.99); flyvis leg **RAN** this session (deps newly installed in env) — parity file regenerated by the suite itself |
| Trajectory invariance probe (opticDrive=0, real circuit, 600 ticks) | hash **cf1e1659 before == after** — E9/E10/E11 runs (opticDrive 0) are trajectory-identical |
| Functional probes (real circuit) | retinotopy at E4 drive: optic layer rate **2.35** (legacy same-drive probe: 0 — its saturated bins sat at threshold in the legacy path; the legacy experiment path injected through its own saturated-bin branch); p1_sim: busy-field lift ≈ legacy (0.1015 vs 0.1035), focal 2-column stimulus drives only those columns (0.0008 vs 0 background), zero field silent |
| Syntax | `node --check` on all 5 JS files + extracted page module block |

## Benchmarks (quick, same seeds, no tuning)

Non-connectome arms are **bit-identical** before/after (classical_demon,
random, ann, drosophila — no connectome brain, optic path irrelevant).

Connectome arms (2 seeds, opticDrive 0.25) — honestly reported:

| arm | before | after |
|---|---|---|
| connectome | good:bad 0.95 | good:bad 0.00, demonAgree 0.536→0.559 |
| shuffled_connectome | good:bad 0.53 | good:bad 0.00, demonAgree 0.489→0.558 |

This is an **operating-point shift, not a regression fix**: the optic layer
went from threshold-saturated (driven by 8 saturated bins) to contrast-coded
sparse drive over ~256 columns. At n=2 this outcome (both arms collapse to
no good crossings at this drive) is consistent with the preregistered E4
null at the old operating point — the regime where connectome structure was
predicted to matter (sparse drive) is exactly the new default. Nothing was
tuned to recover the old numbers, per the no-tuning constraint.

## Known limitations

1. `fly_brain_retinotopy.json`'s static neuron records are not read at
   runtime; the JS re-derives columns from `optic_channels` via the shared
   lattice (validated equal by self-test). The JSON remains the provenance
   record and the source for future RF work.
2. Receptive fields remain UNKNOWN — a synapse centroid is not an RF; the
   field is a declared sampling convention over source-derived positions.
3. The contrast-coding convention is global (one max per snapshot); per-side
   or per-region normalization would need a declared rationale first.
4. The 3D app's `window.USE_LEGACY_8BIN` flag is evaluated per frame; the
   worker packet length switches automatically, so the toggle is hot-swappable.

STAGE F COMPLETE
