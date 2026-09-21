# Repository Inventory — Maxwell's Demon: Inside the Fly Brain

**Generated:** 2026-09-20 · **Branch:** `Ver2(Split-code-fastframe)` · **HEAD:** `76bb787`
**Scope:** top-level workspace + all subdirectories. **No file was deleted, moved, or modified** while producing this inventory.

Counts and sizes were measured on disk (root: **197 files, ≈11.05 GB**, dominated by
untracked FlyWire feather exports; git tracks 196 files, ≈295 MB).

---

## 1. Classification scheme

| Tag | Meaning |
|---|---|
| `SOURCE` | Hand-written code that defines scientific behavior (app, cores, controllers, loaders) |
| `GENERATED` | Output of a script in this repo; regenerable from `SOURCE` + `DATA` |
| `DATA` | External dataset or immutable input (connectome materializations, mesh assets) |
| `EXPERIMENT` | Logged experiment runs / result tables (provenance-tracked outputs) |
| `TEST` | Tests, validation sweeps, benchmarks used as tests |
| `TEMPORARY` | Scratch: patch/probe/check scripts, backup dirs, logs, caches |
| `UNKNOWN` | Purpose not yet determined — needs owner decision before archival |

---

## 2. Source code — the scientific core (all tracked)

| File | Size | Class | Role |
|---|---:|---|---|
| `experiment_core.js` | 97,861 B | SOURCE | Seeded headless physics + measurement core: PRNG, `makeEnvironment`, `runBenchmark`, `METRICS`, apparatus cores `pressureDemonCore` (E9), `smoluchowskiCore` (E10), `feynmanRatchetCore` (E11), `apparatusCurve`. CommonJS. |
| `controllers.js` | 45,608 B | SOURCE | Controller classes: `classicalDemon`, `annController`, `drosophilaController`, `connectomeController` (LIF over FAFB circuit, dopamine-gated plasticity), `randomController`, `neverGateController`. CommonJS. |
| `experiment_worker.js` | 29,322 B | SOURCE | Web-Worker experiment registry E1–E11 + chat-designed experiments; message protocol; seeded train/test loops; provenance. Loads the two CommonJS files via `importAs` shim. |
| `benchmark.js` | ~30 KB | SOURCE | CLI runner: writes per-trial JSONL + summary JSON into `research_data/`. Flags `--quick / --full / --light`, `--seeds/--train/--test/--episode`. |
| `learning_test.js` | ~20 KB | SOURCE | Stochastic standalone benchmark for the 2D lab (`fly_demon_lab.html`), 9k-frame good:bad crossings. |
| `brain_worker.js` | ~15 KB | SOURCE | 3D-app worker: LIF simulation of the live brain panel. |
| `fafb783.py` | ~8 KB | SOURCE | Python loader for all FlyWire v783 feather/npy tables (memory-mapped). |
| `extract_circuit.py` | ~15 KB | SOURCE | Builds `fly_brain_circuit.json` from v783 tables (5-layer visual subnetwork, NT signs, optic position channels). |
| `inject_circuit.py` | small | SOURCE | Embeds circuit JSON into `fly_demon_lab.html` (2D app). |
| `inject_3d_circuit.py` | ~1 KB | SOURCE | Embeds `fly_brain_circuit.json` into the `const FAFB = ` slot of `fly_demon_3d.html` (marker splice `const FAFB = ` → `\nconst MCNS = `). |
| `neuropil_matrix.py` | ~25 KB | SOURCE | 79×79 neuropil×neuropil synapse matrix + heatmaps + report. |
| `classify_neurons.py` | ~10 KB | SOURCE | NT classification of all 139,255 proofread neurons → CSVs + report. |
| `analyze_v783.py` | ~10 KB | SOURCE | Dataset summary → `report_v783.md`. |
| `neuron_nt_*.py` / misc analysis | small | SOURCE | Supporting analyses (see per-file listing). |
| `plot_experiment_figures.py` | ~15 KB | SOURCE | Publication 3-panel figure (`maxwell_demon_figure.pdf/png`). |
| `analysis/plot_research_figures.py` | 36 KB | SOURCE | Generates `results_table.txt` + `thermo_budget.txt` + research figures from any `research_data/` run. |
| `launch_fly_demon_3d.py` | ~3 KB | SOURCE | Local HTTP launcher for the 3D app. |
| `build_nature_paper_docx.py` | 41 KB | SOURCE | Regenerates the Nature-Portfolio manuscript docx (Agent-4 deliverable). |

### Browser application (HTML)
| File | Size | Class | Role |
|---|---:|---|---|
| `fly_demon_3d.html` | **40,472,714 B** | SOURCE + GENERATED (hybrid) | **Primary 3D app.** Hand-written app code (≈1.5 MB) + two embedded circuit payloads (`const FAFB = …` 31,311,473 B on line 656; `const MCNS = …` 8,715,602 B on line 657; `const DEVIL_B64 = …` data-URI avatar). The payloads are **byte-identical** to `fly_brain_circuit.json` and `malecns_circuit_pruned.json` (verified by SHA256) — this is the file `inject_3d_circuit.py` regenerates. See `PAYLOAD_SEPARATION_PLAN.md`. |
| `fly_demon_lab.html` | 6,949,568 B | SOURCE + GENERATED (hybrid) | 2D lab; embedded circuit at line 174 (≈6.9 MB, from `inject_circuit.py`). |
| `fly_demon_lab_template.html` | 30,876 B | SOURCE | Payload-free template the 2D app is generated from. |
| `experiment_plots.html` | 153,512 B | SOURCE | Plot window for live experiments. |
| `preview_matrix.html`, `glb_test.html` | small | SOURCE/TEMPORARY | Dev viewers (preview_matrix regenerates from neuropil CSV). |
| `three.module.js`, `GLTFLoader.module.js`, `BufferGeometryUtils.module.js` | 1.27 MB / 108 KB / 31 KB | DATA (vendored libs, three.js r1xx) | Vendored browser deps so the app runs fully offline. |

## 3. Circuit datasets (connectome payloads)

| File | Size | Class | Provenance |
|---|---:|---|---|
| `fly_brain_circuit.json` | 31,311,473 B | GENERATED (from v783 tables) / DATA-equivalent | Extracted 5-layer FAFB v783 circuit used by app + E4–E11. SHA256 in `MANIFEST.json`. |
| `malecns_circuit_pruned.json` | 8,715,602 B | GENERATED | Pruned ♂ MCNS circuit (same schema). Embedded as `MCNS` in the 3D app. |
| `malecns_circuit.json` | 138,507,515 B | DATA | Full MCNS export (git-ignored; superset of pruned). `dataset: "mcns_v1.0"`. |
| `fly_brain_positions.json` / `.bin` | 4.7 MB / 747 KB | GENERATED | Per-neuron anatomical positions for the 3D anatomical view. |
| `fly_brain_hulls.json` / `.bin`, `fly_brain_hulls_raw_frame.bin` | 849 KB / 375 KB | GENERATED | Neuropil hull meshes (fetched at runtime by `loadHulls()`). |
| `fly_brain_meta.json` | small | GENERATED | Hull metadata. |
| `proofread_root_ids_783.npy` | 1,114,168 B | DATA | 139,255 uint64 root IDs, FAFB v783 (FlyWire codex download). |
| `*.feather` (4 files) | **10.7 GB** | DATA | FlyWire v783 materialization tables (edges, synapses, per-neuropil counts). Untracked (`.gitignore`) — see §9 "not reproducible from the repo alone". |
| `neuron_nt_classification.csv` | 17,122,421 B | GENERATED | One row per proofread neuron with NT call. |
| `neuron_nt_summary_by_neuropil.csv`, `neuropil_matrix.csv` | small–MB | GENERATED | Aggregate tables. |
| `neuron_nt_*.feather` (2) | 250 MB | DATA | v783 per-neuropil pre/post counts (untracked). |

## 4. Mesh / media assets

| File | Size | Class | Note |
|---|---:|---|---|
| `drosophila_-_adult_fruit_fly_-_ct_scan.glb` | 40,171,084 B | DATA | Demon-scale avatar source (Sketchfab CT scan). |
| `drosophila_larve_brain__axotactin_enhancer_axog.glb` | 19,847,452 B | DATA | Larval brain mesh. |
| `fiji_sample_-_fly_brain_stl-binary_-_tarea_9.glb` | 2,556,964 B | DATA | Fiji sample brain mesh. |
| `fly.glb` | 729,336 B | DATA | Small fly avatar. |
| `b7c7e51c-…glb` | 164,176 B | UNKNOWN | UUID-named GLB; referenced only by `glb_test.html` (dev viewer). Needs owner decision. |
| `devil_b64.txt` | 4,204 B | SOURCE-asset | Raw base64 of the demon avatar; `fly_demon_3d.html` embeds it as `const DEVIL_B64` (same bytes, wrapped in a data URI). |
| `brand_animation/` (9 files) | 20.6 MB | DATA/GENERATED | Brand animation assets (`_brand_animation_webp.b64` embedded by the app). |
| `research_figures/` (45 files) | 17.9 MB | GENERATED | Publication figures (PNG/PDF) + `results_table.txt`, `thermo_budget.txt`, `icon_image_project.png` (used by README). |

## 5. Research data & experiment outputs

| Path | Size | Class | Contents |
|---|---:|---|---|
| `research_data/` (58 files) | 34.6 MB | EXPERIMENT | Seeded runs: `summary_*.json` (benchmark summaries), `rows_*.jsonl`, `e9_training_sweep*` (CSV + raw 14.3 MB + analysis JSON), `e9_batch_*` (JSONL + summaries + HTML report), `e11_validation_sweep.*`, `_payload_e*.json` (per-experiment payload fixtures used by plots/tests), `_e9/_e10_payload_test.json`. |
| `learning_curve.json` | 76,790 B | EXPERIMENT | 2D-lab learning-curve series feeding `maxwell_demon_figure.*`. |
| `report_v783.md`, `neuron_nt_report.md`, `neuropil_matrix_report.md` | small | GENERATED | Written analyses. |
| `maxwell_demon_experiment.md` | ~30 KB | SOURCE (doc) | Method/results description (canonical science doc). |
| `maxwell_demon_figure.pdf/png` | 66 KB | GENERATED | Publication figure. |
| `*.docx` (2) | 80 KB | GENERATED | Manuscript structure documents (v1 + v2 Nature Portfolio). |
| `s41586-024-07939-3.pdf` | 10 MB | DATA (literature) | Reference paper PDF (untracked). `DOI: UNKNOWN` recorded in MANIFEST with source URL. |
| `Create Research Abstract.pdf` | 1.5 MB | DATA (admin) | Abstract PDF. |
| `Important link.txt` | tiny | UNKNOWN | Needs owner decision. |

## 6. One-off scripts (patch / probe / check / smoke) — see `SCRIPT_ARCHIVE_INDEX.md`

The root contains **≈110** `_patch_*` / `_check_*` / `_probe_*` / `_smoke_*` / `_extract_*` / `_fix_*` / `_inspect_*` / `_time_*` / `_audit_*` scripts (plus their `.log` outputs). Class: **TEMPORARY** by construction, with three notable exceptions:

- **`_patch_exp14_core*.py` (10 files, core2…core9)** — the *lineage that produced the current `experiment_core.js`* (apparatus cores, reward docs, streaming). These generated current production artifacts → **archive, do not delete**.
- **`_patch_3d*.py` (20 files)** — lineage of the current 3D app layout/perf/worker behavior.
- **`_check_3d10*` family** — each contains a full 40 MB copy of the app for module testing (**≈160 MB of duplicated HTML**; `_check_3d10.tmp.mjs` 40,163,405 B, `_check_3d10_module.mjs` 40,160,382 B, `_check_3d8.js` 40,158,180 B). Git-ignored, safe to delete after archive-index records their purpose.
- `_tmp_scripts/blk00.mjs` (40,172,457 B, **tracked**) — another full app copy in module form. Tracked 40 MB in git; candidate for removal from the index at next history-rewriting opportunity (recorded, not done — no destructive history ops).
- `_probe_integrity.py`, `_smoke_chat12.js`, `_smoke_exp14*.js` — early smoke harnesses; functionality superseded by `tests/`.

## 7. Runtime / local artifacts (untracked, disposable)

| Path | Class |
|---|---|
| `server.log`, `.exp-server.log`, `.fly-preview*.log`, `.patch10_server.log`, `.truefly-preview.log`, `learning_test.log`, `isolate-*.log` | TEMPORARY (logs) |
| `__pycache__/`, `analysis/__pycache__/` | TEMPORARY (caches) |
| `_rebuild_anatomy.log` | TEMPORARY |
| `.freebuff/`, `.vscode/` | tooling state |

## 8. Backup directories

| Path | Size | Class |
|---|---|---|
| `backup_anatomy_0851/` (5 files) | 1.7 MB | TEMPORARY (snapshot of `fly_brain_*` anatomy files at an earlier state; superseded — archive) |

## 9. External dependencies

**Runtime (browser, vendored, offline-capable):** `three.module.js`, `GLTFLoader.module.js`, `BufferGeometryUtils.module.js` (three.js), plus browser-native `Worker`, `BroadcastChannel`, `XMLHttpRequest`.

**Python (documented in README; not pinned in any manifest before now):** Python ≥ 3.10, pandas 3, pyarrow 24 (feather loading), numpy, matplotlib (figures), Pillow (ad-hoc), python-docx (manuscript build). **No `requirements.txt` existed before this audit.**

**Node:** Node ≥ 18 recommended (tested on v24.18.0); **zero npm dependencies** — the entire JS stack is dependency-free CommonJS + browser modules. **No `package.json` existed before this audit.**

**External data dependencies (cannot be recreated from the repo):**
1. FlyWire FAFB materialization **v783** (codex.flywire.ai) — the four feather tables + root-id npy.
2. MCNS v0.9/v1.0 male CNS export (codex.flywire.ai, `dataset=mcns`).
3. Sketchfab/Fiji GLB mesh assets (source URLs unrecorded in repo).

## 10. Version information

| Item | Value | Where recorded |
|---|---|---|
| App version | **0.9.0** (first release; pre-1.0 research code) | `MANIFEST.json` |
| Connectome | FlyWire FAFB **v783** (proofread scope), root IDs stable only within v783 | README, MANIFEST |
| MCNS | v0.9 in app UI / `mcns_v1.0` in payload `dataset` field | MANIFEST flags discrepancy |
| Git | branch `Ver2(Split-code-fastframe)`, HEAD `76bb787`, 5 commits, 2 contributors, history begins 2026-09-18 | MANIFEST |
| Experiment registry | E1–E11 (+ dynamic `chat`), defined in `experiment_worker.js` | `experiments/` manifests (Stage 6) |
| Seeding scheme | seed = `base + seedIdx*101` (benchmark/worker), brain draw `9176 + seedIdx*37`, PG readout `424243 + seedIdx*977`, E4 shuffle seed 7 | MANIFEST + experiment manifests |

## 11. UNKNOWN / decisions needed

1. `b7c7e51c-2912-…glb` — purpose unclear (only referenced by dev viewer).
2. `Important link.txt` — content not reviewed here; likely a bookmark.
3. `_tmp_scripts/blk00.mjs` — 40 MB tracked duplicate of the app (module-wrapped). Should be untracked at the next history rewrite; not done in this pass.
4. `_probe_it.py`, `_probe_debug.py` — trivial smoke scripts; archived with "superseded" status.
5. MCNS version label mismatch (v0.9 UI vs `mcns_v1.0` payload) — flagged, not changed (no scientific-behavior edits).
