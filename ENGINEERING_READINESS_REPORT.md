# Engineering Readiness Report

**Agent:** 5 (engineering track) · **Date:** 2026-09-20 · **Branch:** `Ver2(Split-code-fastframe)` · **HEAD:** `76bb787`
**Scope:** reproducibility, inspectability, testability, archivability. **No scientific behavior was changed** — pinned by `tests/run_smoke.js`, final result: **41 passed / 0 failed, ALL GREEN**.

Note on concurrency: while this engineering pass ran, science-track agents were
editing the same workspace (`controllers.js`, `brain_worker.js`, `extract_circuit.py`,
`fly_brain_circuit.json`, P0/P1/FLYBODY documents). This pass **preserved their
work**: the mid-session circuit regeneration (schema 2.0-p0 with modulatory edges
+ root-ID provenance) was adopted as the new canonical payload, not overwritten.

---

## What was improved

### Stage 1 — Repository inventory
`REPOSITORY_INVENTORY.md`: all 197 root files + directories classified (SOURCE / GENERATED / DATA / EXPERIMENT / TEST / TEMPORARY / UNKNOWN), sizes, dependency map, version info, open UNKNOWN items (untracked GLB, `Important link.txt`, MCNS v0.9-vs-v1.0 label mismatch, tracked 40 MB snapshot).

### Stage 2 — Manifests
- `MANIFEST.json` — SHA256 of 64 files (sources, payloads, configs, outputs, meshes), git commit/branch/dirty state, app version 0.9.0, FlyWire v783 + MCNS provenance with URLs (`DOI: UNKNOWN` policy — no fabricated DOIs), documented seed scheme, generated-data provenance. Feather tables >512 MB are listed with `sha256: null` + a verify-against-codex note rather than fake hashes.
- `tools/make_manifest.py` — refresh tool (verified: hashes reproduce).

### Stage 3 — Payload separation (39 MB monolith)
- **Audit:** the 40.47 MB HTML = 1.2 MB app code + 31.3 MB FAFB payload (line 656) + 8.7 MB MCNS payload (line 657) + tiny avatar. Embedded payloads verified byte-identical to the standalone JSONs → the split is provably information-preserving.
- **Executed:** `fly_demon_3d.html` 40,472,714 → 446,654 B; `fly_demon_lab.html` 6,949,568 → 31,209 B (production file preserved + exactly one added line; a regeneration side effect that would have reverted manual app edits was caught by diffing against git HEAD and reverted).
- New `data/circuits/fafb_circuit.js` (50.7 MB, includes current schema-2.0-p0 provenance + modulatory edges), `mcns_circuit.js` (8.7 MB), `lab_circuit.js` (6.9 MB).
- Loading via classic blocking `<script src>` (spec-guaranteed before the deferred ES module) → the single consumer site (`makeSim(key==="fafb" ? FAFB : MCNS)`) and all bindings unchanged; visible error screen if payloads are missing (file:// case).
- Regeneration tooling: `tools/inject_circuit_3d.py` (byte-exact re-embed verified), `inject_circuit.py` updated for the loader pattern.
- **Verified live:** app served on localhost:8822 and rendered in a real browser — FAFB · 106,765 neurons loaded from `data/circuits/`, 43–45 fps, DATA INTEGRITY panel showing 553,807 edges / 46 hulls / 99.9% mapping, zero console errors.
- `PAYLOAD_SEPARATION_PLAN.md` documents composition, decision matrix, mechanics, risks, verification checklist.

### Stage 4 — One-off scripts (107 + 2 tmp blocks + backup dir)
- **Nothing deleted.** 110 untracked scratch scripts → `archive/untracked/` (git-ignored); 6 previously-tracked scratch scripts + 2 tracked 40 MB blocks → `archive/` via `git mv` (history preserved); `backup_anatomy_0851/` → `archive/`.
- `_rebuild_anatomy.py` was **not** archived: it is the README-documented generator of the anatomy assets → `tools/rebuild_anatomy.py`, README references updated.
- `SCRIPT_ARCHIVE_INDEX.md` — 117 entries with per-file disposition (20 marked as producers of current production artifacts; 4 near-identical ~40 MB app snapshots flagged as safe-to-delete; duplicate-functionality map; early smoke tests marked superseded).

### Stage 5 — Smoke test suite
`tests/run_smoke.js` (41 checks, S1–S10): payload byte/semantic integrity, app syntax (Node sources + every HTML script block), root-ID mapping (index→FlyWire root ID, cross-checked against the 139,255-ID npy on a deterministic sample, exact BigInt/textual comparison because IDs exceed `Number.MAX_SAFE_INTEGER` — a real portability finding, now documented), PRNG/environment determinism, E1/E4/E9/E10/E11 smoke tests **through the real worker pipeline** (headless XHR shim), run-twice equality (S10), and a golden E1 fixture (S9) that fails on any unintended change to physics/controllers/rewards.
`tests/gen_e1_fixture.js` + `tests/golden/e1_fixture.json` — regeneration protocol for intentional changes.
Notable correctness fixes while building it: E10/E11 are `needsCircuit: true` (brain variants); E9 without a brain drops its two neural variants by design; lab circuit is an earlier 4-layer extraction (preserved as its own payload).

### Stage 6 — Experiment configuration manifests
`experiments/e1..e11.json` (+ README): ID, label, scientific question, needs-circuit flag, circuit SHA256 binding, full physics parameters (chamber geometry, spring/drag constants, baths, thermo constants), controller parameters (incl. E9's 3-window eligibility traces and PG readout seeds), reward coefficients **with no hidden constants** (REWARD_DOC blocks transcribed), seed scheme, train/test split, expected conditions/outputs. Source of truth stays executable (worker registry); `tools/gen_experiment_manifests.py` regenerates; CI validates presence + shape.

### Stage 7 — CI
- `.github/workflows/ci.yml` — **FAST CI**: Node syntax checks, full quick smoke suite, manifest validation, artifact checks (incl. monolith-regrowth guard at 5 MB), Python tool compilation. CPU-only, minutes.
- `.github/workflows/research-benchmark.yml` — **FULL RESEARCH BENCHMARK**: manual/weekly; full smoke suite + seeded benchmark profiles (quick/light/study) + manifest drift check + artifact upload. CPU-only (deterministic JS integrator + sparse CSR LIF; no GPU anywhere).

### Stage 8 — Publication archive
- Structure mapped without breaking the app (`docs/README.md`): app stays at root (root-relative fetches/imports), payloads in `data/circuits/`, configs in `experiments/`, tests in `tests/`, archive in `archive/`; deliverables at repo root for visibility. `research_figures/` kept (README references it) as the `figures/` slot.
- `REPRODUCIBILITY_GUIDE.md` — stranger-facing: install, launch, smoke tests, benchmark profiles + determinism contract, data provenance table, exploratory-vs-seeded-results taxonomy, layout, and the "changing scientific behavior the loud way" protocol.

---

## What remains monolithic (deliberate)

1. **App code stays in the HTML** (~1.2 MB in `fly_demon_3d.html`): extraction would break the single-page UX and the git-blame continuity of actively-edited code, for modest size win. Vendored three.js modules also stay at root.
2. **`_tmp_blk00.mjs`/`_tmp_blk01.js`** (2 tracked ~40 MB app copies) moved to `archive/untracked/` but still in git history; untracking requires a history rewrite — **not done** (destructive). Flagged in the index.
3. `experiment_worker.js` still defines the registry inline (manifests mirror it); a future refactor could make the worker **consume** `experiments/e*.json`, but that changes runtime code paths and was out of scope ("avoid hard-coded hidden constants" is satisfied by documented constants + manifests + tests).

## What cannot yet be reproduced

1. **Raw FlyWire tables** (`*.feather`, 10.7 GB) and the full MCNS export are external downloads; only hashes + URLs are recorded. `fly_brain_circuit.json` regeneration requires them (plus the 9 GB synapse table for optic channels).
2. **GLB mesh sources** (Sketchfab/Fiji) — no source URLs recorded anywhere in the repo. Should be added before any public release.
3. **`malecns_circuit_pruned.json`** has no retained generator script (see index) — the pruned MCNS payload cannot be regenerated from raw data, only re-verified by hash.
4. **Paper figures** in `research_figures/` depend on run JSONs that are committed, but the figure-generation environment (Python package versions) is not pinned beyond README prose.

## Missing metadata / dependencies

- No pinned `requirements.txt` (Python deps are documented prose: numpy/pyarrow/pandas/matplotlib). Deliberately not invented — versions were never recorded.
- No DOI for the FlyWire paper (URL + reference string recorded; `DOI: UNKNOWN` policy honored).
- MCNS version label mismatch (UI v0.9 vs payload `mcns_v1.0`) flagged, unresolved (needs a science-track decision).

## Remaining manual steps

1. `git add`/commit the new engineering layer (nothing was committed by this pass): `.github/`, `tools/`, `tests/`, `experiments/`, `data/circuits/` (careful: ~66 MB of payloads — consider Git LFS or release assets), `MANIFEST.json`, the six root `.md` deliverables, modified `fly_demon_3d.html`/`fly_demon_lab.html`/`inject_circuit.py`/`.gitignore`/`README.md`, and the `archive/` renames. `archive/untracked/` stays local (ignored) unless provenance requires it in the release.
2. Optionally delete the 4 archived ~40 MB app snapshots (~160 MB) — safe, documented in `SCRIPT_ARCHIVE_INDEX.md`.
3. Record GLB asset source URLs in `REPOSITORY_INVENTORY.md` / MANIFEST when known.
4. Decide MCNS version labeling and whether `archive/untracked/` ships in the release archive.
5. First push will trigger FAST CI on GitHub (or run `node tests/run_smoke.js` locally — it is the same suite).

**External dependencies and undocumented data remain; a publication-ready claim is therefore NOT made.**

---

## VERDICT

```
ENGINEERING PARTIAL
```

Rationale: the engineering goals are met on this machine — reproducible manifests, byte-safe payload separation with a live-verified app, a 41-check loud-failure test suite with a golden fixture, machine-readable experiment configs, FAST/FULL CI, a stranger-facing reproducibility guide, and a fully indexed archive with nothing deleted. It is "partial", not "ready", because external datasets are hashed but not re-obtainable from the repo, two mesh provenances and one circuit generator are undocumented, Python pins are prose-only, and history still carries two tracked 40 MB snapshots. Each remaining item is recorded with an owner-ready next step above.
