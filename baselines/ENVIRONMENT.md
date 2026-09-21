# PHASE 01 — FROZEN SOFTWARE ENVIRONMENT
# Recorded 2026-09-21 · branch stabilization/pre-phase01 · parent 771a8cfa (closed loop)
# Rule: versions recorded AS FOUND; nothing upgraded or downgraded for tidiness.

## Toolchain
node                    v24.18.0
python (system)         3.14.6     (manifest/doc tooling only; NOT a runtime for results)
python (embodiment)     3.11.9     (.venv-embodiment — all MuJoCo/FlyBody results)
python (flyvis)         3.11.9     (.venv-flyvis — FlyVis parity sidecar)
os                      Windows 11 Pro x64 (see environment.json platform for exact build)

## Pinned dependency files (committed)
requirements-embodiment.txt   — full embodiment lock; flybody @ d015e9bfe441bd90ae431bac24c55cb74bdbce26
                                (audited commit), mujoco 3.13.0, dm_control 1.0.46,
                                numpy 1.26.4, websockets 17.1 (optional browser transport)
requirements-flyvis.txt       — full flyvis lock; flyvis @ 92b3845c (commit-pinned),
                                torch stack as installed and audited

## Key runtime versions (exact, from the live environments)
mujoco        3.13.0      (.venv-embodiment)
dm_control    1.0.46      (.venv-embodiment)
flybody       0.1.0       (@ d015e9bf…, Vaxenburg et al. Nature 2025 model)
websockets    17.1        (.venv-embodiment, sidecar --ws transport)
numpy         1.26.4      (.venv-embodiment)

## Models / configuration versions
fly_brain_circuit.json     FAFB v783, 106,765 neurons / 553,807 fast edges / 10,223
                           modulatory contacts (sha256 in MANIFEST.json)
malecns_circuit_pruned.json MCNS v1.0 pruned runtime payload, byte-exact browser embed
flyvis checkpoint           flow/0000/000 (65 types), .flyvis_data zips tracked,
                            extraction untracked (gitignored, restorable from zips)

## Random seed scheme (unchanged from audited baseline)
benchmark.js default seeds      1 + s*101 (s = seed index), per-experiment registries
connectome brain draw           makeRng(9176 + seedIdx*37); PG readout makeRng(424243 + seedIdx*977)
closed-loop canonical episode   seed 11, episode 0 (see baselines/closed_loop/)
P0/P1/validation/smoke suites   self-seeded, deterministic (verified bit-exact)

## Working-tree control (Phase 01)
research_paper_structure_maxwell_demon_drosophila.docx carries an UNATTRIBUTED
working-tree modification and is EXCLUDED from the Phase 01 freeze:
  HEAD version : sha256 379fc2c76b6e79a8… (33586 bytes)
  worktree ver : sha256 8bd03b74ec5f086d… (33687 bytes)
Both hashes are preserved here; the file is NOT part of the frozen manifest
scope (documented in tools/make_manifest.py provenance, phase_01.group).
No other uncontrolled files exist at freeze time.
