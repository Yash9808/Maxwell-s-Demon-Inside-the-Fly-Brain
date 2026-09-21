# Reproducibility Guide

**Audience:** a stranger who has never seen this repository and wants to (1) install it, (2) launch it, (3) run a smoke test, (4) reproduce a benchmark, (5) understand where the data came from, and (6) tell exploratory results from seeded multi-run results.

**Status:** engineering pass complete (see `ENGINEERING_READINESS_REPORT.md`). No claim is made that external datasets are reproducible from the repo alone — they are hashed in `MANIFEST.json` and their public sources are listed below.

---

## 1. Install

Requirements (no package manager needed — the JS stack is dependency-free):

- **Node.js ≥ 18** (tested on 24.x) — runs the benchmark, tests, and experiment cores headlessly.
- **Python ≥ 3.10** with `numpy`, `pyarrow`, `pandas`, `matplotlib` — only needed for *re-extracting* the circuit from raw FlyWire tables or regenerating figures. The browser app and the tests need none of it.
- Any static HTTP server for the app (Python's is fine).

```bash
git clone <this repository>
cd Fly
node --version        # >= 18
```

## 2. Launch (browser app)

The 3D app is `fly_demon_3d.html` (~450 KB of code) plus two circuit payloads in
`data/circuits/` (FAFB ≈ 51 MB, MCNS ≈ 9 MB). It must be served over HTTP —
opening via `file://` blocks the payload scripts (the app shows a clear error
screen if that happens):

```bash
python launch_fly_demon_3d.py          # picks a free port, opens the browser
# or:  python -m http.server 8765      # then visit /fly_demon_3d.html
```

The 2D lab (`fly_demon_lab.html`, ~32 KB + `data/circuits/lab_circuit.js`) is
historical but still works the same way.

## 3. Run a smoke test

```bash
node tests/run_smoke.js            # full suite: ~41 checks incl. golden-fixture replay
node tests/run_smoke.js --quick    # skip the golden replay (faster)
```

What it covers (sections S1–S10): payload integrity (the loaded circuits are
byte/semantic-identical to the JSON sources), app script syntax, root-ID mapping
(index → FlyWire root ID, cross-checked against `proofread_root_ids_783.npy`),
PRNG + environment determinism, E1/E4/E9/E10/E11 experiment smoke tests through
the real worker pipeline, run-twice equality, and a golden E1 fixture that fails
on **any** unintended change to physics/controller/reward behavior.

## 4. Reproduce a benchmark

```bash
node benchmark.js --quick    # 2 seeds × 40/10 trials, 8 s episodes   (~minutes)
node benchmark.js --light    # connectome condition on 1 seed only   (perf check)
node benchmark.js            # study default: 5 seeds × 300/60       (~1 h)
node benchmark.js --full     # PDF spec: 10 seeds × 1000/200, 60 s   (~days)
```

Custom profile: `node benchmark.js --seeds 3 --train 100 --test 20 --episode 12`.

Outputs land in `research_data/` as per-trial JSONL + a summary JSON whose
`provenance` block records the full configuration (seeds, trials, physics,
software tag, timestamps). Apparatus experiments (E9–E11) can also be run from
the app's experiment list; per-experiment parameters live in `experiments/e*.json`.

**Determinism:** every stochastic decision draws from a seeded mulberry32 PRNG
(`seed = base + seedIdx*101`; brain draw `9176 + seedIdx*37`; PG readout
`424243 + seedIdx*977`). Same code + same seed ⇒ row-identical output (enforced
by S10 and the S9 golden fixture).

## 5. Where the data came from

| Artifact | Source |
|---|---|
| Connectome tables (`*.feather`, `proofread_root_ids_783.npy`) | FlyWire **FAFB materialization v783** (proofread scope), https://codex.flywire.ai/?dataset=fafb |
| Male CNS circuit | FlyWire **MCNS** (`dataset=mcns`); payload says `mcns_v1.0`, app UI says v0.9 — flagged in MANIFEST.json |
| Neurotransmitter signs | Buhmann et al. synapse-type prediction scores (soft calls, not measurements) |
| `fly_brain_circuit.json` | **Generated** by `extract_circuit.py` from the v783 tables (5-layer visual subnetwork; provenance block inside the file records extraction version, sources, root IDs) |
| `data/circuits/*.js` | **Generated** from the JSONs by `tools/inject_circuit_3d.py` / `tools/split_payloads.py` |
| Anatomy assets (`fly_brain_positions/hulls/meta`) | **Generated** by `tools/rebuild_anatomy.py` (needs the 9 GB synapse table) |
| GLB meshes | External assets (CT-scan fly, larval brain, Fiji sample) — source URLs not recorded in-repo; see MANIFEST gap list |

Full hashes: `MANIFEST.json` (regenerate with `python tools/make_manifest.py`).
Known DOI: none recorded — everything external is cited by URL + reference string
(`DOI: UNKNOWN` policy; no fabricated identifiers).

## 6. Exploratory vs seeded multi-run results

| Class | Where | How to tell |
|---|---|---|
| **Exploratory / single-run** | `research_data/summary_2026-09-16T*.json` (early benchmark probes), `_rebuild_anatomy.log`-era assets, anything in `analysis/` scratch | `provenance.seeds` absent or `n = 1–2`; no CI block; timestamped filenames |
| **Seeded multi-run (CI-bearing)** | `research_data/e9_batch_*.jsonl` + `_summary.json`, `e9_training_sweep*`, `e11_validation_sweep.*`, the six-condition comparator tables | `provenance.seeds ≥ 2` (typically 3–5); summaries carry `mean` ± `ci` per condition; row `seed` column present |
| **Pinned regression** | `tests/golden/e1_fixture.json` | row-for-row equality enforced by `tests/run_smoke.js` S9 |

Rule of thumb: only trust condition comparisons where the summary carries
`mean`/`ci` over ≥ 2 seeds; everything else is a pilot.

## 7. Repository layout (what lives where)

```
fly_demon_3d.html        3D app (code only — circuits load from data/circuits/)
fly_demon_lab.html       2D lab (same pattern)
experiment_core.js       seeded physics + measurement core (CommonJS)
controllers.js           controller classes (classical/ANN/drosophila/connectome)
experiment_worker.js     experiment registry E1–E11 + worker protocol
benchmark.js             CLI benchmark runner
brain_worker.js          3D-app brain worker
fafb783.py, extract_circuit.py, classify_neurons.py, neuropil_matrix.py,
analyze_v783.py          Python data pipeline (needs raw FlyWire tables)
tools/                   manifest/injection/archive/index generators + rebuild_anatomy
experiments/e*.json      machine-readable experiment manifests (Stage 6)
data/circuits/*.js       circuit payloads (FAFB, MCNS, 2D-lab)
tests/run_smoke.js       reproducibility smoke suite (FAST CI)
tests/gen_e1_fixture.js  golden-fixture generator (intended changes only)
tests/golden/            pinned E1 rows
research_data/           experiment outputs (JSONL rows + summaries)
research_figures/        publication figures + results tables
archive/                 audited one-off scripts (SCRIPT_ARCHIVE_INDEX.md)
docs/README.md           layout map — engineering deliverables live at repo root
.github/workflows/       FAST CI + FULL RESEARCH BENCHMARK
REPOSITORY_INVENTORY.md, PAYLOAD_SEPARATION_PLAN.md, SCRIPT_ARCHIVE_INDEX.md,
REPRODUCIBILITY_GUIDE.md, ENGINEERING_READINESS_REPORT.md, MANIFEST.json
```

## 8. Changing scientific behavior (the loud way)

1. Edit `experiment_core.js` / `controllers.js` / `experiment_worker.js`.
2. `python tools/gen_experiment_manifests.py` — refresh `experiments/e*.json`.
3. If the change was **intentional**: `node tests/gen_e1_fixture.js` and commit the
   fixture diff with an explanation. If **unintentional**: the suite will fail —
   go find the bug.
4. `node tests/run_smoke.js` must be ALL GREEN before pushing.
5. `python tools/make_manifest.py` if file hashes changed.
