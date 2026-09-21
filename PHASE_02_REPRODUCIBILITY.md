# PHASE 02 — DEPLOYMENT RUNNER & CROSS-MACHINE REPRODUCIBILITY

**Status: implementation complete; acceptance battery green at the frozen reference (tag `phase-02-candidate`).**
**Date: 2026-09-21 · Branch: `deployment/phase-02` (from tag `phase-01-baseline`)**

Labels used throughout: **FACT** (recorded, reproducible), **MEASURED** (observed value this phase),
**MODEL-ASSUMED**, **UNKNOWN**, **LIMITATION**.

---

## 1. Objective

Build and freeze a reproducible deployment runner around the already-frozen
Phase 01 scientific system: one canonical command that verifies environment,
dependencies, manifest, provenance and every scientific suite; executes the
real closed loop; verifies deterministic replay against the Phase 01 hash;
and fails closed on any substitution. No scientific semantics changed.

## 2. Starting reference (FACT)

* Tag `phase-01-baseline` → `f1d8c7d2397961d420edb26d4bf5c6222485b802` (verified with `git describe --exact-match`).
* Phase 01 canonical trajectory `05c47753fe56af3de12d5fa3b209e6c3ef20f88a74952154977b1c568bac204b` (FACT, frozen).

## 3. Implementation commits (FACT, in order on `deployment/phase-02`)

| Commit | Purpose |
|---|---|
| `59e2d360` | Deployment runner (14 modes), environment contract generator, manifest verifier, bootstrap, replay executor, failure injection, protocol freeze check, Phase 01 offline archive record, foreign-edit disposition |
| `60f70456` | Bootstrap: resolve Python 3.11 via `py` launcher fallback |
| `6b9a9694` | Bootstrap: fix pip invocation (`-m pip`) |
| `28a5afb3` | Cross-machine manifest integrity: byte-faithful checkout (`* -text`), local-provisioned data classification |
| `f80d2359` | Manifest regenerated (zero stale, local provisions classified) |
| `e2db9be2` | Bootstrap self-heal for smudged checkouts; foreign v2 disposition |
| `87fb4696` | Phase 01 evidence logs archived in git (were ignored, manifest-referenced) |
| `92f68891` | FlyVis provisioning: record the PyTorch CPU index required by the pinned `+cpu` wheel |
| `19a05bb8` | Pinned `requirements-flybody.txt` for the dedicated P1 venv (F2d gap) |
| `c7e330f5` | Verify mode: `DEPLOY_EXPECTED_COMMIT` gate + manifest-stamp-vs-HEAD (content-tree) check |
| `0aa20332` | Final manifest regeneration at the reference tree (zero stale) |
| `4c9767ac` | `PHASE_02_REPRODUCIBILITY.md` (this document) |
| *(tagged)* | Final manifest regeneration at the tag (pristine worktree, zero stale) — tag target below |

## 4. Deployment runner (FACT)

* Entry point: `deployment/deploy_runner.js`
* Modes: `verify p0 e9 validation p1 sandbox smoke benchmark flybody flyvis closedloop replay protocol failures acceptance`
* Canonical acceptance command (documented env gates, no hidden state):

```bash
export PYTHON_EMBODIMENT="$PWD/.venv-embodiment/Scripts/python.exe"   # REQUIRED for physics suites
export FLYVIS_PYTHON="$PWD/.venv-flyvis/Scripts/python.exe"           # REQUIRED for flyvis
node deployment/deploy_runner.js verify
node deployment/deploy_runner.js acceptance      # full Phase 02 acceptance
node deployment/deploy_runner.js failures        # 12 failure-injection cases
```

* Fail-closed guarantees (MEASURED): missing env vars produce deterministic
  validation errors (no system-python fallback); every check emits
  machine-readable JSON at `deployment/runs/<utc>_<mode>/mode.json`; any
  failure ⇒ exit 1.

## 5. Environment (MEASURED; frozen in `baselines/environment_contract.json`)

* OS: Windows 11 x64 (git-bash) · Node v24.18.0 · Python 3.11.9 (all three venvs)
* flybody `d015e9bf…` · mujoco 3.13.0 · dm_control 1.0.46 · websockets 17.1 · numpy 1.26.4
* flyvis `92b3845c…` · torch 2.14.0+cpu (PyTorch CPU index — now documented in `requirements-flyvis.txt`)
* Three locked tracks: `requirements-embodiment.txt`, `requirements-flyvis.txt`, `requirements-flybody.txt`

## 6. Fresh-machine bootstrap (FACT, exercised end-to-end)

`bash deployment/bootstrap.sh [--embodiment|--flyvis]`:
prerequisite gates (git, node ≥ 18, python 3.11 via PATH or `py`) → pinned
venv creation → manifest verification (with smudge self-heal) → minimal
smoke test → prints the exact runner exports. MEASURED: built
`.venv-embodiment`, `.venv-flyvis`, `.venv-flybody` from scratch in clean
clones; all pins resolved exactly.

## 7. Clean-room / cross-machine verification (MEASURED)

Environment: independent clone from the git bundle, fresh venvs, no reliance
on the dev shell (E1–E6):

* **E1 source identity**: clone HEAD == `deployment/phase-02` tip; lineage intact. PASS
* **E2 dependency identity**: all pins install exactly (incl. `+cpu` torch via documented index). PASS
* **E3 payload identity**: `fafb_circuit.js 42f5a80f…`, `mcns_circuit.js 3d3e8fa0…` byte-match. PASS
* **E4 canonical replay (seed 11, 240 ticks)**: observed
  `05c47753fe56af3de12d5fa3b209e6c3ef20f88a74952154977b1c568bac204b` ==
  expected. **EXACT MATCH** (240/240 records).
* **E5 benchmark identity**: `connectome 0.536 / 0.0282 / 0.95`;
  `shuffled_connectome 0.489 / 0.0244 / 0.53` — bit-exact vs Phase 01. PASS
* **E6 causal identity**: closed-loop suite 11/11 (all twelve causal links
  and all negative guards) on real FlyBody/MuJoCo. PASS

Clean-room findings fixed this phase (each a real deployment defect):
CRLF smudge vs manifest hashing; never-committed evidence logs; unrecorded
torch index; unprovisioned `.venv-flybody`; hidden `python` dependency in
P1's B10 (resolved via documented machine-local provisions).

## 8. Protocol freeze (FACT)

`deployment/lib/mode_protocol.js` verifies the live
`embodiment/state_contract.js` **byte-identical** to the Phase 01 frozen
record (`baselines/protocol/state_contract_v1.json`), version/dims intact,
all error codes and message types present, all negative R-guards still
active. MEASURED: PASS at the reference tree.

## 9. Failure injection (MEASURED — all 12 DETECTED, fail-closed)

| # | Case | Detection |
|---|---|---|
| 01 | wrong git commit | `DEPLOY_EXPECTED_COMMIT` gate ⇒ verify exits 1 |
| 02 | stale manifest | verifier exit 1 (tampered hash) |
| 03 | missing runtime payload | runner verify fails (record absent) |
| 04 | wrong dependency version | measured-vs-pin comparison flags |
| 05 | missing python environment | deterministic `PYTHON_EMBODIMENT not set` gate |
| 06 | missing neural vector | `missing_neural` (no synthetic fallback) |
| 07 | wrong neural dimension | `neural_dim_changed` (200 fixed) |
| 08 | wrong action dimension | 58 ≠ 59 rejected (`contract_violation`) |
| 09 | stale timestep | `stale_time` (t < lastT; monotone semantics preserved) |
| 10 | wrong episode id | `stale_episode` |
| 11 | NaN neural | `contract_violation` (non-finite) |
| 12 | protocol version mismatch | `contract version 2 != supported 1` |

## 10. Full regression at the reference tree (MEASURED — acceptance exit 0)

`verify` PASS · P0 **14/14** · E9 all causal gates · validation **15/15** ·
P1 **55/55** · sandbox **5/5** · smoke **41/41** · benchmark **bit-exact** ·
FlyBody **7/7 READY** · FlyVis probes ALL PASS · closed-loop **11/11** ·
canonical replay **byte-identical** · protocol PASS · failures **12/12**.

## 11. Manifest (FACT)

Final manifest regenerated **inside the pristine freeze worktree** (the main
worktree is contended by an external, actively-evolving E10/edge-waypoint
workstream — see `deployment/foreign/DISPOSITION.json`): zero stale hashes,
local provisions classified, exclusions explicit. The runner's stamp check
(additional hardening) allows exactly `MANIFEST.json` to differ from the
stamped content tree.

## 12. Artifacts (hash-addressed)

* `deployment/runs/<utc>_<mode>/mode.json` — machine-readable result per run (log sha256 recorded inside).
* `deployment/archive_record.json` — Phase 01 offline archive (bundle `8ae7ee74…`, tree `db62dc83…`, bundle-clone-verified).
* `deployment/foreign/DISPOSITION.json` — foreign-edit timeline + round-trip-proven patches (`c0caec8b…`, `b7d94716…`).
* `baselines/environment_contract.json` — MEASURED environment contract (classified vocabulary).
* Final battery logs: `final_acceptance_wt.log`, `ref_*.log` (see §10).

## 13. Deviations from Phase 01

None scientific. All changes are deployment infrastructure (runner,
bootstrap, attributes policy, requirements headers, manifest tooling) plus
one additive verify-gate. P0/P1 semantics, benchmark values, trajectory hash,
protocol bytes: unchanged (MEASURED bit-exact).

## 14. Known limitations (honest)

* **LIMITATION**: no second physical machine was available; the clean room is
  a fresh-clone + fresh-venv simulation on the same host (strongest available).
* **LIMITATION**: raw `malecns_circuit.json` remains absent (documented,
  non-runtime; integrity target pinned).
* **LIMITATION**: three upstream FlyWire feathers (~10.7 GB) remain
  machine-local provisions (documented classification; hash-verified when present).
* **LIMITATION**: the main worktree carries an external, uncommitted E10/edge
  workstream (not part of this phase; preserved as patches; manifests are
  generated in a pristine worktree to stay immune).
* **UNKNOWN**: MCNS exact DOI (unchanged, honest).

## 15. Final reference

* Tag: **`phase-02-candidate`** (annotated) on branch `deployment/phase-02` —
  the authoritative Phase 02 reference. Resolve its exact target with
  `git rev-parse phase-02-candidate^{commit}`; the tag annotation records the
  lineage and the frozen results. (This document intentionally names the tag,
  not a hardcoded SHA, so the reference stays valid at the fixed point.)
* Final measured state at the tag: manifest 105 entries, **0 stale**, 4
  documented-missing (raw MCNS + 3 machine-local provisions), 0
  null-by-design at generation, docx excluded; acceptance **12/12 PASS**,
  protocol PASS, failure injection **12/12 DETECTED** (exit 0 = all
  detected).

## 16. Verdict

# `PHASE 02 COMPLETE — READY FOR PHASE 03`
