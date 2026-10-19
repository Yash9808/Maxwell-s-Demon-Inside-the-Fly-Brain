# Phase 3B — Separated-Spawn Approach Task (`pillar_approach`)

Experimental protocol + record. Recorded: 2026-09-26, branch
`deployment/phase-02`, git `6e63e02c` (dirty worktree). Companion to
`PHASE_03_BEHAVIOR.md` (legacy pillar task, paused) and
`PHASE_3A_BRIN_REGRESSION.md`. Status: task redesigned additively, tests
green, baseline + determinism rerun + learning experiment run under the
FROZEN-EVAL protocol, regression battery re-verified after the protocol
upgrade — with an honest NULL result on the learning claim at this scale
(machinery verified live; improvement not demonstrated; confound band
quantified).

## Scientific question

Can the FAFB-constrained connectome controller, driving the real flybody
through the fixed motor decoder, improve its approach policy through its
own dopamine-gated synaptic plasticity — on a task redesigned so that
untrained behavior cannot succeed?

## Hypothesis

- **H1:** reward -> DA -> eligibility -> weight updates produce a
  measurable policy improvement on held-out FROZEN evaluation (same
  eval seeds, same initial conditions, only training history differs).
- **H0 (control):** any before/after change stays within the
  session-confound band of the frozen-brain control run (sidecar decoder
  gain/bias adaptation carryover + spawn lottery).

## Environment

MuJoCo flybody scene via dm_control, task `pillar_approach`
(`embodiment/task_pillar.py`):

| Constant | Value | Why |
|---|---|---|
| `APPROACH_POS` | `[-0.105, -0.060]` | 121 mm spawn gap, outside the measured 215 mm leg-sweep twitch envelope; pillar in obs bin 2 from step 0 |
| `APPROACH_MASS` | `1.0 kg` | twitch-immovable landmark (10 g pillar shoved 117 mm under twitching) — approach is a landmark task, not a push task |
| `APPROACH_ARRIVAL_DIST` | `0.050 m` | just below the untrained 54-81 mm floor; face-contact floor is 30.4 mm, so the gate is reachable |
| Episode horizon | 700 steps | inside dm_control's 735-step auto-reset boundary (boundary crossing re-applies the spawn and counts `env_reset_seen`) |
| Reward scale | `0.0005 m/unit` | ratchet closure normalization |

## Fly embodiment

Real flybody MJCF (59-D body actuators), stepped by the Python sidecar
(`.venv-embodiment/Scripts/python.exe`, `MUJOCO_GL=disable` — no
rendering in the loop; PERF tests pin step latency in physics range).
Spawn teleport per reset uses the same mechanics as the debug
`pillar_set_pose` tap; boundary audit counts every silent auto-reset.

## Connectome

FAFB-constrained connectome (`fly_brain_circuit.json`,
`connectomeController`): 106,765 neurons, ~563k edges. Learning
machinery: DA-gated eligibility traces (`EW`) + REINFORCE readout
(opt-in). `setLearning(false)` zeroes `EW` and `da.v` — this IS the
freeze primitive the evaluation protocol relies on.

## Observation space

`state_contract` v1: `OBS_DIM 15` = 8-bin visual field (pillar visible
from spawn: bin-2 gain > 0.1, T-3B.6) + 7 proprioceptive channels.
Observations are deterministic per (seed, episode).

## Neural model

200 -> 16 -> 59 motor path over the connectome; per-step drive via
`closed_loop_core.driveBrain` (sensoryTransform -> neuron state ->
motor spike vector). Controller telemetry exposes motorRate, spikeCount,
dopamine, sensoryActivity per step.

## Motor decoder

`MotorDecoder(seed=0)` in the sidecar: neural spike vector -> 59-D
torque action. Fixed seed. Reward-blind (T-3B.0 pin: decoder never sees
reward). Its gain/bias adaptation runs LIVE across the whole session —
the documented source of the frozen-brain behavioral confound below.

## Task definition

Separated-spawn approach: fly spawns ~121 mm from the pillar; success =
first arrival inside the 50 mm gate (latched; `success_step` recorded;
one-time `APPROACH_ARRIVAL_BONUS`). The legacy pillar task's
contact-spawn ceiling (success without approach; twitch-farmable
reward) is removed. Legacy `pillar` remains byte-identical and
selectable (`--task pillar`).

## Reward definition

Ratchet closure, anti-farmable:

```
r = max(0, min_dist - dist) / APPROACH_REWARD_SCALE   (only on a NEW best distance)
```

First call anchors (`min_dist = dist`) and pays 0. Oscillation around a
distance double-pays nothing; walking without closing pays 0 (T-3B.4/5:
zero-reward counter verified under the SILENT drive pattern). Arrival
bonus paid once at first arrival.

## Dopamine signal

`brain.receiveFeedback({ reward })` is the ONLY reward -> DA path,
called ONLY in TRAIN phases (learning ON, `frozen=false`). Frozen eval
episodes deliver no DA: freezing zeroes DA (`da_before = da_after = 0`
throughout — measured: eval mean_da = 0 in both runs).

## Plasticity rule

Three-factor: eligibility traces (`EW`) accumulate under drive while
learning is ON; `receiveFeedback(reward)` delivers DA-gated updates.
Frozen evals accumulate nothing and update nothing — verified
`drift_delta === 0` in every eval episode of every run.

## Training protocol

ONE persistent brain for the whole experiment (fresh-brain-per-episode
cannot learn). Phases: `eval_before` (frozen) -> `train` (learning ON)
-> `eval_after` (frozen). TRAIN = 5 episodes x 700 steps, seeds
100..104, `receiveFeedback` live. `TRAIN (learning) -> FINAL POLICY ->
EVAL (frozen)` — the trained policy is measured with plasticity off.
`PHASE3_LEARNING=0` runs the untrained-baseline protocol: the identical
loop with the learning machinery entirely off (bit-identical frozen
brain across all episodes; train drift 0 measured).

## Evaluation protocol

FROZEN eval: `brain.setLearning(false)` before the episode (zeroes
EW + DA), no `receiveFeedback` during, restore run-level gate after.
Fixed eval seeds {5, 6}, 700 steps, episode bases 0 (before) / 200
(after). Eval `drift_delta === 0` by construction and by measurement.
Rationale: evaluating while traces/DA are live measures the learner
mid-update, not the learned policy.

## Seeds

- Brain: 11 (`buildBrain(circuit, 11)`)
- Eval: {5, 6} (both phases)
- Train: 100..104 (5 episodes)
- Decoder: 0 (fixed in sidecar)

All recorded in the run manifest; CLI overrides documented below.

## Metrics

Per episode: `steps, dist_init, dist_final, dist_min, drift_delta,
weight_drift_delta, spawn_dist, min_dist, env_resets, success,
success_step, cum_reward, mean_motor_rate, mean_spike_rate,
vis_bins_l1_range, mean_da`.

Per step (trajectories artifact): `t, reward, action (59-D),
body_pos (3), motor_rate, spike_count (motor-layer spikes/tick),
da_before, da_after, weight_drift, obs_bins (8), task snapshot
(name, mode, spawn_dist, dist, min_dist, cum_closure,
first_arrival_step, arrival_steps, success, success_step,
env_reset_seen)`.

## Baseline

Untrained protocol (`PHASE3_LEARNING=0`, TRAIN_EPS=5, brain seed 11):

| Phase | cum_reward | dist_min (mm) | dist_final (mm) | arrivals | mean DA | driftDelta |
|---|---|---|---|---|---|---|
| eval_before (frozen) | 133.10 +- 1.57 | 54.2 +- 0.8 | 54.7 +- 1.1 | 0/2 | 0 | 0 |
| train-lottery (5 ep) | 128.33 +- 25.97 | 56.8 +- 12.8 | 59.3 +- 11.5 | 2/5 | 0 | 0 |
| eval_after (frozen) | 99.87 +- 14.86 | 70.8 +- 7.4 | 71.4 +- 7.8 | 0/2 | 0 | 0 |

- Determinism: fresh-process rerun reproduces
  `phases + trajectories + manifest` BYTE-identically (only
  `started_utc` differs); files 12.94 MB each.
- **Session confound band: -33.2 cum_reward (133.1 -> 99.9) for a
  brain whose weights never change** (decoder adaptation carryover +
  spawn lottery). Any learning claim must beat this band.
- Train-lottery arrivals (2/5) occur WITHOUT learning — spawn/gait
  lottery, not policy.

## Learning experiment

Same protocol with learning ON:

| Phase | cum_reward | dist_min (mm) | dist_final (mm) | arrivals | mean DA | driftDelta |
|---|---|---|---|---|---|---|
| eval_before (frozen) | 133.10 +- 1.57 | 54.2 +- 0.8 | 54.7 +- 1.1 | 0/2 | 0 | 0 |
| train (5 ep) | 131.48 +- 7.35 | 55.1 +- 3.7 | 57.3 +- 4.0 | 0/5 | 0.689 +- 0.189 | 1069.5 (total 5347.9) |
| eval_after (frozen) | 113.56 +- 11.20 | 64.0 +- 5.6 | 65.3 +- 7.1 | 0/2 | 0 | 0 |

**Learning verdict (honest): NOT DEMONSTRATED at this scale.** The
machinery demonstrably ran (persistent-brain weight drift 5347.9, mean
DA 0.689 during train, exactly 0 in eval), but eval_after (113.6) is
WORSE than eval_before (133.1) and sits inside the frozen-brain
confound band (-33.2). With 5 training episodes and sparse ratchet
reward, no visible policy shift is expected in a 106,765-neuron
controller; the experiment validates the PROTOCOL, not H1.

## Controls

1. **Untrained baseline** — identical loop, machinery off (above).
2. **Frozen-eval integrity** — eval `drift_delta === 0` in all runs.
3. **Cross-condition eval_before equality** — 133.095527 identical in
   baseline, rerun, and learning runs: freezing is behaviorally
   transparent and eval seeds are the ONLY eval variable.
4. **Legacy byte-stability** — `--task pillar --quick` aggregates
   bit-identical to the stored baseline (164.895031 / 413.254478 /
   158.544736); freeze-eval changed eval-phase drift 314.6 -> 0 with
   zero behavioral change; manifest/trajectories purely additive.
5. **Determinism** — byte-identical fresh-process rerun (above).
6. **Spawn-lottery control** — train-lottery arrivals occur with drift
   0 (baseline), so arrivals alone are never evidence of learning.

## Regression tests

Re-run after the frozen-eval/manifest/trajectory upgrade (this session):

| Suite | Result |
|---|---|
| `deploy_runner.js protocol` | PASS |
| Replay anchor (`EMBODIMENT_TRAJECTORY_SHA256=477eb89d...`) | MATCH=true (default Phase-01 target `05c47753...` mismatches by design on this tree; see `baselines/closed_loop_visual/trajectory_meta.json`) |
| Legacy `--task pillar --quick` | aggregates bit-identical to stored baseline |
| `tests/run_smoke.js` S1-S11 | 42/42 |
| `closed_loop.test.js` (real) | 14/14 |
| `stage5_task.test.js` (real) | 13 pass / 0 fail / 1 skip |
| `tests/phase3_behavior.test.js` (real) | 8 pass / 0 fail / 1 by-design skip |
| `tests/phase3b_approach.test.js` (real) | 8 pass / 0 fail / 1 by-design skip |

Phase 3B test map: T-3B.0 static pins (constants, closure-only reward
signature, decoder reward-blind) - T-3B.1/2/3 spawn geometry +
landmark immovability + untrained floor - T-3B.4/5 ratchet identity +
silent-drive zero-reward counter - T-3B.6 pillar visibility - T-3B.7
protocol replay + zero arrivals + boundary - T-3B.8 fresh-process
byte-identical determinism - T-3B.9 auto-reset boundary audit - PERF
latency - R-mock CI chain. Contract invariants untouched: OBS_DIM 15,
protocol v1, 8+7 channels, 200->16->59 motor path, reward transport.

## Reproducibility

All runs from the repo root; deterministic given env + args:

```
# untrained baseline (+ determinism rerun: repeat the same command)
PHASE3_LEARNING=0 PHASE3_TRAIN_EPS=5 \
  PHASE3_OUT=baselines/phase3b_approach/phase3_pillar_approach_baseline.json \
  node tools/phase3_behavior_experiment.js --task pillar_approach

# learning experiment
PHASE3_TRAIN_EPS=5 \
  PHASE3_OUT=baselines/phase3b_approach/phase3_pillar_approach_learning.json \
  node tools/phase3_behavior_experiment.js --task pillar_approach
```

Every artifact embeds a run manifest: `{experiment: phase_3b, task,
seeds: {brain, eval, train}, learning, frozen_eval: true, brain,
decoder, environment, contract, steps, quick, git_revision,
git_dirty}` plus the full per-step `trajectories` (condition key
`untrained` / `trained_frozen`). With `PHASE3_OUT` unset the tool also
writes the sibling `..._trajectories.json` (identical content). Env
overrides: `PHASE3_TRAIN_EPS, PHASE3_EVAL_STEPS, PHASE3_TRAIN_STEPS,
PHASE3_LEARNING, PHASE3_OUT`. Artifacts in
`baselines/phase3b_approach/`: baseline, baseline_rerun, learning
(12.94 MB each).

## Known limitations

- **TRAIN_EPS=5** (protocol-documented override; 10-min shell clamp
  truncated the default 12): far too few training episodes to expect a
  visible policy shift.
- Single brain seed; single eval-seed pair {5,6}; no held-out seed set.
- **Session-confound diagnosis CORRECTED (C-2)**: the -33.2 cum_reward
  frozen-brain band is NOT decoder adaptation - the sidecar reconstructs
  `MotorDecoder(seed=<episode seed>)` fresh at every reset (sidecar.py,
  `reset()`), so no decoder state carries across episodes. The measured
  source is the brain's CONTINUOUS neural draw stream (`buildBrain` re-keys
  `brain._rng` once at build, never per episode) plus un-reset fast state
  (V/spikes/refac EMAs, motorRateSmooth/motorBase) carrying across episodes.
  The decoder row below is retained as the original (wrong) diagnosis;
  see the C-2 addendum for the fix and the corrected description.
- Spawn lottery: train-phase arrivals occur without learning.
- `spike_count` records motor-layer spikes/tick only; full spike
  rasters are not persisted.
- Sessions do not fix the confound; multi-seed, longer training runs
  remain the next milestone before any H1 claim.

## C-2 addendum — paired-episode discipline + multi-replicate learning (2026-09-26)

Build-plan row 3 close-out. All changes ADDITIVE to the CLI
(`tools/phase3_behavior_experiment.js`); defaults unchanged, so every
artifact above stays byte-valid.

### Confound root cause (measured, corrected)

The frozen-brain band (-33.2 cum_reward) was traced to the brain's
CONTINUOUS neural draw stream + un-reset fast state carrying across
episodes — not the decoder (fresh per reset, verified
`sidecar.py reset(): self.decoder = MotorDecoder(seed=seed)`). Prediction
of the paired-episode fix: a learning-OFF run must show
`eval_after == eval_before` BYTE-EXACTLY. Measured: **TRUE**
(cums [150.064285, 131.794905] identical in both phases; all eval
drift_delta === 0).

### New CLI controls (env)

- `PHASE3_RNG_RESET=1` — per-episode `brain.resetForTrial()` + draw stream
  re-keyed by the episode seed (`makeRng(seed ^ 0x5f37)`, the same formula
  `buildBrain` uses). An eval seed then defines the episode COMPLETELY:
  weights | draws | physics. Eval `eval_after vs eval_before` differs only
  in what training wrote into the weights. `manifest.rng_reset` records it.
- `PHASE3_TRAIN_BASE` — first training env seed (default 100). Independent
  training blocks = the honest replicates (see brain-seed inertness).
- `PHASE3_BRAIN_SEEDS` — one full protocol run per entry (artifact
  `_b<seed>`). Measured finding: under RNG_RESET the brain seed is
  behaviorally INERT (initial weights are circuit-deterministic; init does
  not randomize wiring; draws are episode-keyed) — three seeds 11/23/47
  produced byte-identical runs. The replicate is therefore the training-
  seed block, not the brain seed.
- `PHASE3_EVAL_SEEDS` — eval-seed csv override (default {5,6}).

### Results at TRAIN_EPS=12, RNG_RESET=1 (700-step episodes)

Baseline control (learning=0): paired-identical evals (exact 0 delta) —
the confound band is eliminated BY CONSTRUCTION, not shrunk.

Learning runs, five independent training blocks (12 episodes each;
da 0.66–0.72; total weight drift ~1.2e4 each; all eval drift exactly 0):

| Training block | Δcum_reward | Δmin_dist (mm) | success before→after |
|---|---|---|---|
| 100+ | +2.00 | -1.00 | 1→1 |
| 200+ | +12.79 | -6.15 | 1→2 |
| 400+ | +12.28 | -6.14 | 1→1 |
| 600+ | -5.53 | +2.51 | 1→0 |
| 800+ | +4.28 | -2.14 | 1→1 |
| **mean ± 95% CI (n=5)** | **+5.16 ± 6.70** | **-2.58 ± 3.22** | — |

### C-2 verdict (honest)

1. **Confound ELIMINATED** (the C-2 methodological goal): the frozen-brain
   control now has EXACTLY zero drift, and the paired control run has
   exactly zero behavioral delta. Cross-phase comparisons are clean.
2. **Learning: suggestive, NOT established.** 4/5 training blocks improved
   (mean +5.2 cum_reward, -2.6 mm min-dist), but the 95% CIs include zero
   (t=1.51). The earlier n=3 preview (+9.0 ± 6.9, CI excluding zero) did
   NOT survive two added replicates — exactly why the replication was run.
3. What a decisive claim needs: longer training batches (12 episodes is
   still the sparse-reward regime for a 106k-neuron controller), more
   training blocks (n>=10), and/or eval-seed expansion. The protocol and
   controls now support such a claim directly — any delta measured under
   RNG_RESET is attributable to the weights alone.

Artifacts: `baselines/phase3b_approach/phase3_pillar_approach_rngreset_*.json`
(baseline control + 5 learning blocks; 22.9–23.4 MB each with embedded
per-step trajectories). Regression post-edit: phase3b 8/0/1, phase3 8/0/1
(real mode).
