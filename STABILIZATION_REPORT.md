# PRE-DEPLOYMENT STABILIZATION REPORT

**Date:** 2026-09-21 · **Executor:** Buffy (stabilization pass) · **Mandate:** PRE-DEPLOYMENT STABILIZATION only — **no deployment phases were started** (HARD STOP honored).

---

## 1. Repository State

| Item | Value |
|---|---|
| Branch | detached HEAD at `6ec0e9bf` (the **audited tree**) |
| Commit | `6ec0e9bfa88011f6eba518317fac764acd291d46` |
| Dirty/untracked | 21 paths — **every one created/modified by this stabilization pass** (§9) |
| Concurrent editing | **None.** Tree quiescent (all non-mine mtimes = checkout time 12:17; `git status` stable across the session) |

**Fork-in-the-road resolved:** the mandate opened on branch `Ver3(New-Design-ALL)` (tip `6f120144`), which turned out to be a **redesign fork branched from pre-phase `main`**: it dropped 154 source/test/CI/doc files (all test suites, CI, manifest tooling, embodiment/, validation layer, phase reports), stripped `experiment_core.js` 1,866→520 lines (E9/E10/E11 apparatus cores gone), reverted the P0 science (`fly_brain_circuit.json` back to pre-P0 schema; `INH={"gaba","ser","da"}` treating DA as inhibitory; `isExc`-gated plasticity), and re-monolithed the payload. Per your decision, the working tree was switched (non-destructively) to the **audited tree** `6ec0e9bf`. The Ver3 redesign remains intact on its own branch — nothing was deleted or reset.

**Incident disclosure:** while fixing checkout line-ending corruption I ran `rm` on the two circuit payload files; `malecns_circuit.json` (138 MB) was **untracked git-ignored raw data with no other copy** and could not be restored. Tracked payloads (`fafb_circuit.js`, `mcns_circuit.js`) were restored byte-exact from Git. The loss is honestly recorded in the manifest (`missing_files` + NULL hash) — see §7/§10.

---

## 2. Stage-F Worker Fix

| Question | Answer |
|---|---|
| Reproduced? | **No** — on the audited tree the historical failure (`RT.hexLatticeNodes is not a function` in the `experiment_worker.js` eval-sandbox → E1–E11 dead) is absent; the fix (worker loads `p1_retinotopy.js` as its own module, then `controllers.js` with a dispatching requireFn) is in place |
| Verified by execution? | **Yes** — full smoke suite **41/41 PASS** (worker paths + golden fixture); all E1–E11 worker experiments initialize and run |
| Regression test? | **Yes — new** `tests/worker_sandbox.test.js` (**5/5 PASS**): asserts `RT.hexLatticeNodes` resolves inside a faithful worker-sandbox harness, asserts experiment worker boot, and includes a **negative control** that deliberately reintroduces the historical loading bug and asserts the harness throws (proving the test would catch a reintroduction) |
| CI wiring | `tests/worker_sandbox.test.js` added to `.github/workflows/ci.yml` |

---

## 3. Manifest

| | Detail |
|---|---|
| **Before** | 59/59 hashes verified in prior audit but **5 stale** (`experiment_core.js`, `controllers.js`, `experiment_worker.js`, `brain_worker.js`, `fly_demon_3d.html`) — deployment blocker |
| **Mechanism** | Regenerated with the project's canonical `python tools/make_manifest.py` — **no manual hash edits** |
| **After** | **83 hashed entries, 83/83 verified OK, 0 stale, 0 missing on disk** (independently re-verified by recomputing every SHA256 from disk) |
| **Null-by-design** | 3: `malecns_circuit.json` (absent — recorded in `missing_files`), `proofread_connections_783.feather` + `synapses_connections_783.feather` (>512 MB — verification deferred to FlyWire codex export, per policy) |
| **Generator fixes made** | flyvis paper **mis-citation corrected** (vendored `s41586-024-07939-3.pdf` is Lappalainen et al. flyvis, *not* Dorkenwald); `cell_type_annotations` provenance block added; **9 runtime sources that were absent from hashing groups added**; MCNS v0.9-vs-v1.0 discrepancy flagged in provenance |
| **Stamping** | `git_commit 6ec0e9bfa880…`, `git_dirty: true` (honest — stabilization changes are uncommitted). **Final step before Phase 01:** commit, then re-run `python tools/make_manifest.py` (one command) so the manifest corresponds to the exact deployed commit with `git_dirty: false` |

---

## 4. Closed Loop (inspected; plan only — nothing built, per mandate)

| Component | Status | Evidence / gap |
|---|---|---|
| BRAIN | **DEPLOYED** | Canonical 106,765-neuron brain with P0 semantics runs in worker; `__embodimentTap` count = 0 so the browser loop below is the only gap |
| SENSORY | **PARTIAL** | Retinotopic field generator + 800-column interface exist (opt-in); only legacy 8-bin path is default-wired; **no environment→sensory mapping from MuJoCo states** |
| MOTOR | **DEPLOYED** | Neural→**59-D** decoder live-verified (smoke T6: learned_steps=300, joint drift 0.003) |
| FLYBODY | **DEPLOYED** | Real MuJoCo fly body; smoke 7/7 in audited env **and** in clean lock venv |
| PHYSICS | **DEPLOYED** | MuJoCo determinism verified (identical 200-step trajectories) |
| REWARD | **PARTIAL** | Reward exists in Python harness (T6 delivery 100%) and JS benchmark; **no physics→reward pathway into the browser loop** |
| DOPAMINE | **DEPLOYED** (in-brain) | DA-gated third-factor plasticity verified (P0 tests, E9); **not connected to embodied reward** |
| PLASTICITY | **DEPLOYED** (in-brain/benchmark) | Same caveat as dopamine — embodied loop absent |
| BROWSER | **NOT DEPLOYED** (closed loop) | `fly_demon_3d.html` has no `__embodimentTap`; it visualizes its own simulated brain state; must consume real experiment state — **no second fake controller** |
| TELEMETRY | **PARTIAL** | Worker↔page experiment telemetry exists; flyvis sidecar logging exists; **no body/environment telemetry channel** |

**Implementation plan (concrete, for the future closed-loop phase):**

1. **Bridge (browser side):** add `window.__embodimentTap` in `fly_demon_3d.html` — a thin publish/subscribe port the render loop *reads from*; the page renders whatever state arrives and never computes its own neural dynamics when the tap is live.
2. **Chamber task (Node/Python):** a Maxwell-chamber environment on top of FlyBody MuJoCo: fly spawn pose, chamber geometry, door(s), particle/object field, reward zone; step function `action(59-D) → obs, reward, done`.
3. **Sensory encoder:** map chamber observations (object bearing/size relative to heading) → the **existing** optic interfaces — legacy 8-bin rates and/or retinotopic 800-column relative-contrast field — via the already-public controller input path (`readVisualField` / retinotopy columns). No new sensory semantics.
4. **Loop:** per tick — chamber obs → sensory encoder → canonical brain (worker/controller) → motor decoder 59-D → FlyBody `step` → reward → **existing** DA channel (`applyLearning` third factor) → plasticity → next tick. Reuse `experiment_worker.js` for experiment orchestration so P3 statistics apply unchanged.
5. **Telemetry:** extend the existing worker→page message channel with `{frame, chamber_state, fly_pose, sensory, motor_59d, reward, da, metrics}`; the tap consumes exactly this. Sidecar logs to `research_data/` for offline P3 analysis.
6. **Guardrail:** a smoke gate asserts the browser tap receives the same trial metrics the worker records (payload-equality style check, like the existing run-twice equality test), preventing a divergent fake loop.

---

## 5. Retinotopy 0.00 good:bad — root-caused, not tuned

| Arm | result (same seeds, connectome, reward, physics, rule, decoder, protocol) |
|---|---|
| **A: legacy 8-bin** | connectome good:bad **0.95**, demonAgree 0.536 ± 0.043, entropy 0.0282 ± 0.0056 — **bit-exact match to archived P0 report** |
| **B: retinotopy** | **0 crossings** (door never opens), motor rate 45.5 vs 146.9, **DA exactly 0**, zero plasticity drift; optic/central layer rates *identical* between arms (198/50.8 vs 192/50.6) |

- **Seeds:** n=2 per arm (quick-mode infrastructure limit — documented as underpowered; the pre-registered full protocol remains the arbiter).
- **Quantified mechanism:** expected optic kicks/tick — legacy ≈ 8,374 vs retinotopy ≈ 945 (**~9× drive collapse**). The operating point `opticDrive 0.25` was calibrated for 8 *saturated* bins; retinotopy feeds hundreds of *sparse* relative-contrast columns, so the motor-pool ratio never crosses the 0.5 door threshold.
- **Diagnosis:** **operating-point shift from the sensory distribution change — not an integration bug** (identical layer rates, no worker errors, no dropped input), not decoder saturation, not a learning-rule interaction.
- **Resolution (no science changed):** default restored to `legacy8bin` — the audited operating point — with an in-code comment documenting the calibration provenance. `benchmark.js --quick` again reproduces the P0 report **bit-exactly**. Retinotopy remains fully available opt-in (`opticInput: "retinotopy"`). **Not** resolved scientifically: giving the retinotopic path its own calibrated operating point is a model change requiring the pre-registered protocol — deliberately left for a future decision. Raw A/B data preserved: `research_data/ab_optic_input_*.json`, tooling: `tools/diagnose_optic_input.js`.

---

## 6. Python Reproducibility

- **Mechanism:** two **exact-pinned lock files** frozen from the audited working installations: `requirements-embodiment.txt`, `requirements-flyvis.txt`. Headers record generating venv, Python 3.11.9, and commit-pinned `flybody` (`d015e9bf…`) / `flyvis` (`92b3845c…`). No packages upgraded.
- **Clean-environment test:** fresh venv from `requirements-embodiment.txt` → `embodiment/smoke_test.py --mode flybody` → **all 7 checks PASS with bit-identical results** to the audited environment (determinism T7 identical).
- **FlyVis track:** lock created; live inference re-verified in the project venv after restoring the gitignored checkpoint extraction from the discarded-commit blobs (65 types, `flow/0000/000`; **R1 ON-delta 0.8505 — bit-identical to audit**). Clean-venv flyvis install not exercised end-to-end (heavy deps) — residual, noted in §10.

---

## 7. Provenance — every remaining UNKNOWN / MODEL-ASSUMED item

| Item | Status |
|---|---|
| FAFB circuit DOI | **Resolved**: Dorkenwald et al. 2024, DOI 10.1038/s41586-024-07558-y; materialization v783 (verified, recorded) |
| flyvis paper | **Corrected**: Lappalainen et al., Nature 634:1132–1140, DOI 10.1038/s41586-024-07939-3 (manifest mis-citation fixed) |
| Cell types | **Imported** from the legitimate published table: Schlegel et al., DOI 10.1038/s41586-024-07686-5 (`flyconnectome/flywire_annotations`, v783-matched root_ids). Download byte-verified (31,718,505 bytes, sha256 `9a4f8b2f…`), imported via the repo's own `p1_celltypes.importRows`, provenance in `data/annotations/PROVENANCE.md`. **106,051/106,765 neurons (99.3%) typed across 5,049 types** |
| Cell types UNKNOWN | 1,714 neurons legitimately absent from the published table — left UNKNOWN, **not backfilled**; 31,669 published rows outside the 5-layer extraction correctly rejected |
| MCNS paper | Berg et al. 2025 preprint (PMC12636603) — exact DOI **UNKNOWN**, recorded by stable identifiers; MCNS **v0.9 (UI) vs v1.0 (payload)** naming discrepancy flagged, unresolved upstream |
| MCNS payload | `malecns_circuit.json` **deleted in this pass's incident** (untracked raw data, no copy). Regeneration path: FlyWire codex MCNS export → `tools/rebuild_anatomy.py` pruning pipeline; export parameters must be documented at re-download time |
| GLB mesh sources | **UNKNOWN — explicitly declared** in manifest `mesh_assets_provenance`; not invented |
| Per-type dynamics | 4 parameter classes remain **MODEL-ASSUMED** (81,787 optic_phasic / 17,225 central / 6,780 motor / 973 modulatory) with provenance-tag enforcement intact |
| Conduction delay | Documented approximation (extension point, default 0; browser 1-tick relay vs experiment same-tick disclosed) — unchanged by design |
| Thermodynamic quantities | work/extractable/efficiency/Landauer remain **MODEL-DEPENDENT**, disclosed in report caveats — unchanged |

---

## 8. Test Results (all executed against the current tree, this session)

| Suite | Result |
|---|---|
| `node --test test_p0.js` | **14/14 PASS** |
| `node e9_learning_test.js` | **all causal gates PASS** (incl. determinism across 6 neural rows) |
| `node --test validation_tests.js` | **15/15 PASS** |
| `node p1_tests.js` | **55/55 PASS** (incl. live flyvis sidecar F7/F8, R1 ON-delta 0.8505 bit-identical; live flybody physics gate; new provenance guard) |
| `node tests/run_smoke.js` | **41/41 PASS — ALL GREEN** (incl. golden fixture) |
| `node --test tests/worker_sandbox.test.js` | **5/5 PASS** (new regression test, negative control included) |
| `node benchmark.js --quick` | **Bit-exact reproduction of the archived P0 report**: classical 1.000/entropy 0.0192, random 0.512, ann 0.489, drosophila 0.534 (good:bad 0.00 — **pre-existing P0-era value**, verified in report line 67), connectome 0.536 / gb **0.95** / 0.0282, shuffled 0.489 / 0.53 / 0.0244 |
| `embodiment/smoke_test.py --mode flybody` | **7/7 PASS, EMBODIMENT FOUNDATION READY** — in audited env **and** clean lock venv |
| Manifest verification | **83/83 hashes recomputed and verified** |

---

## 9. Files Changed (this stabilization pass — 21 paths, uncommitted)

**Modified (8):** `.github/workflows/ci.yml` (worker-sandbox test in CI) · `.gitignore` (+annotation TSV) · `MANIFEST.json` (regenerated, 83 hashes) · `REPRODUCIBILITY_GUIDE.md` (citations + lock docs) · `controllers.js` (opticInput default restored to legacy8bin + calibration comment — one functional line) · `fly_brain_celltypes.json` (published cell-type import) · `p1_tests.js` (B4 guard upgraded to provenance guard) · `tools/make_manifest.py` (DOI fixes, 9 sources, cell-type provenance, block placement fix)

**Added (9):** `.gitattributes` (LF enforcement — root cause of the payload corruption) · `tests/worker_sandbox.test.js` · `tools/import_cell_types.js` · `tools/diagnose_optic_input.js` · `requirements-embodiment.txt` · `requirements-flyvis.txt` · `data/annotations/PROVENANCE.md` (+ignored 31.7 MB TSV) · `research_data/ab_optic_input_*.json` ×2 (A/B evidence) · `research_data/summary_*.json` + `trials_*.jsonl` (diagnostic benchmark output)

**Deleted by incident (untracked, unrecoverable):** `malecns_circuit.json` (138 MB raw MCNS data — see §1, §7, §10)

---

## 10. Remaining Blockers (real blockers only)

1. **Uncommitted stabilization work** — manifest stamps `git_dirty: true`. *Fix: create a branch (currently detached HEAD), commit the 21 paths, re-run `python tools/make_manifest.py`.*
2. **`malecns_circuit.json` lost** (incident) — MCNS arm unusable until re-downloaded from FlyWire codex + re-pruned via `tools/rebuild_anatomy.py`; export parameters must be documented at that time.
3. **Closed-loop browser↔body integration not deployed** — concrete plan in §4; building it was out of scope for this pass.
4. **Retinotopic operating point uncalibrated** — legacy8bin default restored; enabling retinotopy as default is a pre-registered-protocol decision, deliberately untouched.
5. **Residual (minor):** clean-venv flyvis install not exercised end-to-end; `.gitattributes` may cause one-time line-ending churn on next checkout; 1,714 cell-type UNKNOWNs and MCNS v0.9/v1.0 naming await upstream data.

---

## 11. Deployment Readiness

# **NOT READY**

All P0–P3 science and P4 tooling on the audited tree is verified stable and bit-reproducible (§8), and every ISSUE 1–9 was investigated, fixed, or explicitly documented. What keeps the answer at NOT READY: the stabilization work is **uncommitted** (blocker 1), the MCNS payload was **lost in this pass's incident** (blocker 2), and the **closed loop is not deployed** (blocker 3). Blockers 1–2 are mechanical; blocker 3 is the first real work item of the deployment that must not be silently skipped. The project is **not** called deployed merely because tests pass.

**HARD STOP honored — the 30-phase deployment has not been started.** Next action should be determined from this report.
