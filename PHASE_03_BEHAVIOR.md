# PHASE 3 — Closed-Loop Behavioral Task Validation

Recorded: 2026-09-25 · branch `deployment/phase-02` · companion to
`FLYBODY_ARCHITECTURE.md §9` (the physical task) and
`PHASE_02_REPRODUCIBILITY.md` (visual baseline). Status: **implemented,
all batteries green, honest null learning result.**

## 0. Provenance note (audit of pre-existing work)

The physical task object (the **pillar**, `embodiment/task_pillar.py` +
`tests/stage5_task.test.js` + `closed_loop_core.js` task plumbing) was found
**already present and uncommitted** in the worktree at Phase 3 start,
referencing an "AGENT TASK Stage 5" document that does not exist in the
repository. The work is additive and contract-clean, and per the user's
decision it was **adopted as the Phase 3 task** rather than rebuilt. Two
latent bugs were found in it by this phase's tests and fixed (§3). No
"AGENT TASK" document was created; this report is the authoritative record.

## 1. Exact task definition

**Visual target approach/orientation on the pillar** (flybody walk scene):
a light free (6-DoF) box pillar (fixed build pose (−0.030, −0.005, 0.040) m,
mass 1e-4 kg, `contype=1`) stands on the inference-mode drift path; the
ghost (`contype=0`) cannot collide — **only the fly can move the pillar**.
The task opt-in is `hello.task = "pillar"` (unknown names fail closed);
the wire contract is unchanged (`OBS_DIM = 15`, protocol v1, 200-spike
motor path, frozen decoder/actuator map, frozen connectome).

Measured task state (all from post-step MuJoCo geometry, never from
commands): fly→pillar planar distance, pillar displacement from build pose
(`pillar_disp_norm`), first-contact step, contact-step count. Success
**policy**: |planar pillar displacement| ≥ 5 mm (`SUCCESS_PILLAR_DISP`),
latched per episode; the raw displacement is always carried in telemetry,
never gated by the threshold.

## 2. Reward definition

Pure function of post-step MuJoCo state + episode counters; no RNG:

    r_t = |Δ pillar_xy| / 0.0005        (dense; 0.5 mm per unit reward)
        + 0.25                          (one-time first-contact bonus,
                                         latched structurally via
                                         touch_bonus_given)
    success: pillar_disp_norm ≥ 0.005 m (telemetry latch only)

`receiveFeedback({reward})` → `da.v += r * 0.6` remains the **only**
reward→learning path. The MotorDecoder is reward-blind (structural
`_guardrails`; signature-pinned by T-B7).

## 3. Causal chain + proofs (T-B1..T-B8)

Chain proven: **target → 8-bin vision (T-B1) → canonical neural output
(T-B2) → decoded 59-D action (T-B3/T-B3b) → MuJoCo body state (T-B4) →
measured task state → reward (T-B5) → next-tick vision (T-B6) → reward →
DA → eligibility-gated plasticity (T-B7/T-B8, R10)**.

- **T-B1** teleport (`tap pillar_set_pose`, experimenter-only op) → 8-bin
  visual field changes (L1 ≈ 1.75 vs reset field: the pillar's bin migrates
  forward-quadrant → left-quadrant at full gain).
- **T-B2/T-B3** visual-only contrast (proprio held identical) between two
  fresh same-seed brains → 200-vector divergence → real-decoder action
  divergence (max Δa59 0.0435).
- **T-B4/T-B5** silent vs calibrated decoder input → different physics
  (|Δdx| 0.0168 m) → different rewards (Δcum 326.2); per-condition
  cumulative-reward == measured cumulative pillar-path identity.
- **T-B6** brain-driven episode moves the pillar (max 0.0892 m) and the
  fly-caused change reaches next-tick vision (closure L1 0.0541).
- **T-B7 no leakage** — three proofs: (1) per-step reward recomputed
  EXTERNALLY from measured post-step geometry matches exactly
  (max err 0.0); (2) `task_pillar.reward(_prev_x, physics, task)` cannot
  accept a neural input; (3) pillar moved out of reach → fly walks
  0.1261 m across 42 moving steps earning **exactly zero** reward.
  Source pins: reward signature, decoder reward-blindness.
- **T-B8** byte-identical episodes (same session), byte-identical
  fresh-process task runs, and byte-identical experiment payloads across
  independent processes.

## 4. Baseline + learning experiment (untrained → trained)

Fixed seeds: eval `{5,6}` × 150 steps; train seeds 100..111 × 200 steps;
persistent brain (seed 11) across all phases; learning ON in evals (the
honest loop). Artifact `baselines/phase3_behavior/behavior_experiment.json`
(sha256 `7baedbbba262ed679a1c8be07867e7171de6c1f9455fefe8262a96aa6732d004`)
with `behavior_meta.json` (params, aggregates, verdict, artifact hashes).

| phase | cum reward | final dist (m) | success | drift Δ |
|---|---|---|---|---|
| eval_before | 912.440 ± 7.875 | 0.02217 ± 0.00024 | 2/2 | 1749.80 |
| train (12 eps) | 1344.828 ± 61.398 | — | 12/12 | total 4255.16 |
| eval_after | 891.556 ± 39.063 | 0.02009 ± 0.00144 | 2/2 | 45.59 |

**Honest verdict: NO behavioral learning demonstrated.** Plasticity
mechanically ran (total weight drift 4255.16 from eligibility-gated
REINFORCE/DA updates), but task metrics did not improve: the brain spawns
**already in contact** with the pillar (build pose on the drift path), the
5 mm displacement threshold is crossed within the physics settling ramp,
and the dense reward is then dominated by contact sliding — the task is at
ceiling for the untrained drive, leaving no gradient for improvement to
express. Per the Phase 3 brief: reported honestly, **no tuning performed**
to make learning "appear".

Neural/plasticity evidence: DA responded to every nonzero reward
(receiveFeedback path), eligibility traces accumulated, weights moved
(drift 0 → 4255.16 during training), R10 frozen control still proves
learning=false ⇒ zero plasticity.

## 5. Determinism

Episode-level (T-B8: hashes over obs/motor/reward/action/task per tick),
protocol-level (fresh-process byte identity), and experiment-level (full
JSON payload byte-identity across independent runs) all hold. Phase 01/02
anchors untouched: visual baseline replay **MATCH=true** (anchor
`477eb89d…`) after all changes; frozen Phase 01 hash unchanged.

## 6. Performance (no per-step rendering)

Full behavioral-loop step (physics + geometric sensor + decoder +
protocol), measured two ways: sidecar-internal step p50 **9.03 ms** /
p95 **10.91 ms** (warm suite fixture), cold-run p50 ≈ 42 ms — either way
**>3.5× below the ~0.3 s/frame eye-camera render rejected in Phase 2**,
with MUJOCO_GL=disable provenance and zero rendering in the loop. The
PERF regression bar (< 75 ms p50) catches any reintroduction of per-step
rendering (which would jump ~100×).

## 7. Known limitations (separation of causal vs biological claims)

1. **What is proven**: a closed causal loop — visual scene → canonical
   FAFB-constrained brain → 200→16→59 motor path → real MuJoCo body
   dynamics → measured task state → reward → DA → eligibility-gated
   plasticity — with leakage-free reward and byte determinism.
2. **What is NOT proven**: any biological realism beyond the connectome's
   wiring itself; that the fly "sees" in any retinotopic sense (8-bin
   egocentric geometric occupancy, no occlusion, no retina model); that
   the fly *learned* anything (null result above).
3. Task simplifications: single pushable object; no orientation criterion
   implemented (approach/displacement only); success threshold is policy;
   fly spawns in contact (ceiling effect — see §4); ghost visual target
   max-pooled into the same bins; mock "proxy" task mode is interface
   validation only, never embodiment evidence.
4. The pillar task was adopted from unreviewed in-tree work (missing
   "AGENT TASK Stage 5" provenance); two latent reward bugs were found
   and fixed by this phase's tests (§3, §8).
5. Learning-experiment scale is small (12 train episodes, k=2 eval seeds)
   by design; reward delivery in evals is not gradient-excluded (fixed
   identical eval seeds keep phases comparable; noted in the artifact).

## 8. Files changed (Phase 3, by this agent)

- `embodiment/task_pillar.py` — adopted; **two fixes**: `TaskState.reset()`
  now clears `_prev_pos` (stale cross-episode dense reward earned a
  phantom 12.56-reward first step in episode ≥ 2); touch bonus latched via
  `touch_bonus_given` instead of `task.t` equality (re-fired per contact
  step for any caller not stamping `task.t` — 14.75 = 59 × 0.25 residual
  caught by the T-B4/T-B5 identity). Both fixes are behavior-identical in
  the sidecar flow.
- `tests/phase3_behavior.test.js` — NEW: T-B1..T-B8 + PERF + mock CI
  coverage (8 pass / 1 by-design skip on real flybody; 2 pass / 7 skipped
  under mock).
- `tests/closed_loop.test.js` — additive skip guards on the two
  real-physics tests (mock CI gate now 12 pass / 0 fail / 2 skipped;
  real mode 14/14 unchanged).
- `tools/phase3_behavior_experiment.js` — NEW: persistent-brain eval /
  train / eval experiment driver (deterministic, fixed seeds).
- `baselines/phase3_behavior/behavior_experiment.json` +
  `behavior_meta.json` — NEW baseline artifact (params, aggregates,
  learning verdict, artifact hashes).
- `PHASE_03_BEHAVIOR.md` — this report.
- Docs referencing the pillar task ("Stage 5") — unchanged from their
  authors; this report supersedes them as the validation record.

## 9. Regression battery (final, all green)

- `tests/closed_loop.test.js` real: **14/14** · mock: 12 pass / 0 fail / 2 skipped
- `tests/stage5_task.test.js`: **13 pass / 0 fail / 1 skip** (post-fix re-run)
- `tests/phase3_behavior.test.js`: **8 pass / 0 fail / 1 skip** (real) · 2 pass / 7 skipped (mock)
- `embodiment/smoke_test.py --mode flybody`: **8/8 FOUNDATION READY** · `--mode mock`: PARTIAL (as designed)
- `tests/run_smoke.js`: **41/41 ALL GREEN** · `deploy_runner protocol`: **PASS**
- Replay anchors: Phase 02 visual **MATCH=true** (`477eb89d…`); frozen Phase 01 untouched.

**Acceptance criterion met**: the simulated fly receives visual
information, its existing brain/motor pathway responds, the resulting
physical action changes its task state (pillar displacement measured from
MuJoCo geometry), and that measured task state drives the existing
reward/learning pathway — with success, reward, and telemetry all derived
from measured physics, never from commanded or expected outcomes.
