# PHASE 01 — BASELINE FREEZE (ACCEPTANCE DOCUMENT)

**Status: FROZEN · 2026-09-21 · branch `stabilization/pre-phase01`**

This document identifies the **immutable deployment baseline** accepted after
Phase 0 (closed-loop integration). Phase 01 introduced **no new scientific
behavior** — it converts the validated Phase 0 state into the reference.

## 1. The immutable baseline

| Item | Value |
|---|---|
| Branch | `stabilization/pre-phase01` |
| Phase 01 freeze commit | see §9 (final commit of this phase; contains baseline + manifest) |
| Parent (closed loop) | `771a8cfa` (`771a8cfae1760a2fd2aed2158b64c859a3b18cd0`) |
| Stabilization commits | `c3e2bfc3` (stabilization) → `8b8be3a6` → `fc7272c0` (MCNS disposition) → `d0a9e86f` |
| Scientific baseline (audited) | `6ec0e9bf` (untouched; all results remain bit-exact against it) |
| Parked Ver3 redesign | separate branch `Ver3(New-Design-ALL)` — NOT merged, NOT part of this baseline |
| Tag | `phase-01-baseline` → the freeze commit |

## 2. Frozen environment
Full record: `baselines/ENVIRONMENT.md` + machine-readable `baselines/environment.json`.
Node v24.18.0 · Python 3.11.9 (embodiment + flyvis venvs) · Windows 11 x64 ·
locks `requirements-embodiment.txt` (flybody @ `d015e9bf`, mujoco 3.13.0,
dm_control 1.0.46, websockets 17.1) and `requirements-flyvis.txt`
(flyvis @ `92b3845c`). Versions recorded AS FOUND; nothing upgraded.

## 3. Working-tree state at freeze (explicit)
Exactly one uncontrolled file, by decision:
`research_paper_structure_maxwell_demon_drosophila.docx` — manuscript-planning
document with an **unattributed working-tree modification**. It is excluded
from the freeze (manifest `repository.phase_01_excluded`); both versions are
hash-recorded in `baselines/ENVIRONMENT.md` (HEAD `379fc2c7…` 33,586 B;
worktree `8bd03b74…` 33,687 B). The baseline commit carries the HEAD version;
the modification remains uncommitted and cannot contaminate the freeze.

## 4. Frozen scientific baseline artifacts
All under `baselines/` (manifest group `phase_01`, sha256-tracked):
- `baselines/results/results_index.json` — per-suite result + evidence hashes
- `baselines/evidence/*.log` — complete raw test/benchmark outputs (P0, E9,
  validation, P1, smoke, worker-sandbox, benchmark --quick, embodiment
  flybody+mock, closed-loop, flyvis probe)
- Historical P0 artifacts (`P0_IMPLEMENTATION_REPORT.md`, `P1_*`, etc.) are
  UNTOUCHED — Phase 01 artifacts live alongside, never overwriting.

## 5. Canonical closed-loop trajectory (frozen)
- Record: `baselines/closed_loop/trajectory_seed11.jsonl` (240 ticks, seed 11,
  episode 0, learning on, real FlyBody/MuJoCo)
- Meta: `baselines/closed_loop/trajectory_meta.json` — commit, seeds, initial
  physical/brain/decoder state, per-tick fields, final state
- **trajectory sha256: `05c47753fe56af3de12d5fa3b209e6c3ef20f88a74952154977b1c568bac204b`**
- Replay in the frozen environment: **BYTE-IDENTICAL** (same hash); the same
  trajectory was previously reproduced through the browser entry point
  (0/240 mismatches vs the sidecar ground-truth log).

## 6. Frozen protocol
`baselines/protocol/state_contract_v1.json` — contract **v1**, message schemas,
episode/timestep semantics, sequence numbers, stale/malformed behavior
(fail-closed), action dim 59, canonical neural dim 200, error codes. Source of
truth `embodiment/state_contract.js` (sha256 recorded). **No protocol changes
in Phase 01.**

## 7. Frozen provenance
`baselines/PROVENANCE_PHASE01.md` — FAFB v783 + DOI, MCNS v1.0 + missing raw
payload + integrity target + byte-verified pruned runtime payload, cell-type
table (99.3% coverage, 1,714 honest UNKNOWNs), MODEL-ASSUMED dynamics/delays/
gains/thermodynamics, GLB UNKNOWN-by-declaration, pruning-generator absence,
delay approximation. Nothing fabricated.

## 8. Manifest
Regenerated AFTER the final Phase 01 state was established, via the canonical
`tools/make_manifest.py` (group `phase_01` added; docx exclusion recorded in
`repository.phase_01_excluded`). Result: **zero stale hashes**, only the
documented null-by-design entries (2 × >512 MB feathers) and the documented
missing raw MCNS payload. No hashes edited by hand.

## 9. Freeze commits and tag
Two-commit convention (same as stabilization, keeps the manifest commit-stamped
and clean):
1. **Freeze-content commit** — adds `PHASE_01_BASELINE.md`, `baselines/**`,
   freeze tooling (`tools/phase01_freeze.js`), the manifest `phase_01` group,
   and the harness venv-resolution fix. Parent:
   `efb56903749de238d7956a821493f019137c7843` (closed-loop manifest commit).
2. **Manifest commit** — regenerates `MANIFEST.json` against commit 1; this
   final commit carries the tag `phase-01-baseline`.
Baseline artifacts record `commit_sha = efb56903…` as the **capture state**:
all evidence and the canonical trajectory were measured at that tree, whose
scientific content is identical to the freeze commit (the freeze adds only
documentation, baselines, and test-infrastructure files — no runtime code).

## 10. Final validation battery (all PASS at freeze)
P0 14/14 · E9 all causal gates · validation 15/15 · P1 55/55 (flyvis R1
ON-delta 0.8505, bit-identical) · worker-sandbox 5/5 · smoke 41/41 ·
benchmark --quick bit-exact (connectome 0.536/0.0282/gb 0.95) · FlyBody 7/7
FOUNDATION READY · closed-loop 11/11 · deterministic replay byte-identical ·
manifest verification zero-stale. Raw outputs: `baselines/evidence/`.

## 11. Deviations from Phase 0
None in scientific behavior. Test-infrastructure-only change: the closed-loop
harness now auto-resolves the project's pinned venv python when
`PYTHON_EMBODIMENT` is unset (fixes an environment-resolution gap; assertions
unchanged). Additions are Phase 01 artifacts themselves (baselines/, freeze
tooling, manifest group).

## 12. Acceptance
Phase 01 acceptance criteria are met (§§1–10). Phase 02 must start from the
tagged freeze commit; any deviation from this baseline requires a new,
explicitly documented phase.
