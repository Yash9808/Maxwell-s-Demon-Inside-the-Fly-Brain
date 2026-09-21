# Directory Layout — publication-archive mapping

The Stage-8 target layout (`src/ data/ experiments/ figures/ tests/ docs/ archive/`)
was mapped onto the existing repository **without breaking the application**: the
3D app, its vendored libraries, and its workers live at the repo root and load
`data/circuits/*.js`, `three.module.js`, `fly_brain_hulls.bin` etc. via
**root-relative paths**. Moving them under `src/` would break every relative
fetch/import for no scientific benefit.

| Target | This repository | Why |
|---|---|---|
| `src/` | repo root (`fly_demon_3d.html`, `experiment_core.js`, `controllers.js`, `experiment_worker.js`, `benchmark.js`, `brain_worker.js`, `*.py`) | app + workers use root-relative URLs; CommonJS files `require()` each other by bare path |
| `data/` | `data/circuits/*.js` (app payloads) + root data files (`fly_brain_circuit.json`, `fly_brain_positions.*`, `fly_brain_hulls.*`, `proofread_root_ids_783.npy`) | payloads load from `data/circuits/`; anatomy files are fetched by the app at root |
| `experiments/` | `experiments/e1..e11.json` + `README.md` | new in this pass |
| `figures/` | `research_figures/` (45 files) + `maxwell_demon_figure.*` | existing name kept; README references it |
| `tests/` | `tests/run_smoke.js`, `tests/gen_e1_fixture.js`, `tests/golden/` | new in this pass |
| `docs/` | this file; main deliverables (`REPRODUCIBILITY_GUIDE.md`, `PAYLOAD_SEPARATION_PLAN.md`, `REPOSITORY_INVENTORY.md`, `SCRIPT_ARCHIVE_INDEX.md`, `ENGINEERING_READINESS_REPORT.md`) live at **repo root** for visibility | deliverables stay top-level; no broken relative links |
| `archive/` | `archive/untracked/`, `archive/_*`, `archive/backup_anatomy_0851/` (see `SCRIPT_ARCHIVE_INDEX.md`) | audited, nothing deleted |

Engineering deliverables (all at repo root): `REPOSITORY_INVENTORY.md`,
`MANIFEST.json`, `PAYLOAD_SEPARATION_PLAN.md`, `SCRIPT_ARCHIVE_INDEX.md`,
`REPRODUCIBILITY_GUIDE.md`, `ENGINEERING_READINESS_REPORT.md`.
