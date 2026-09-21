# P1 FLYBODY REPORT — Real-physics closed-loop embodiment (Stage F2)

Status: **F2 COMPLETE** — flybody/MuJoCo stack installed, closed-loop smoke test 5/5 PASS,
regression benchmark 7/7 PASS, baseline anchored and reproduced bit-exactly, suite-registered (F2a–F2e).

Mandate note: the original P1 brief excluded flybody; the user **explicitly commissioned**
this extension afterward ("Install the flybody/MuJoCo stack and run the real-physics
closed-loop smoke test plus its regression benchmark"). It is implemented as a strictly
isolated add-on: **no P0 file and no P1 file was modified** except `p1_tests.js` (new F2
section) and `.gitignore` (venv pattern).

## Environment (all versions recorded in result JSONs)

| Component | Version | Note |
|---|---|---|
| Python | 3.11.9 | dedicated venv `.venv-flybody` (flybody pins `numpy==1.26.4`, which has no cp314 wheels; host default is 3.14) |
| mujoco | 3.13.0 | wheel install, no source builds |
| dm_control | 1.0.46 | composer environments |
| flybody | 0.1.0 @ upstream `git+https://github.com/TuragaLab/flybody.git` | pip-installed from source repo; **zero local modifications**; commit resolved via `direct_url.json` when available |

Install (reproducible):
```bash
py -3.11 -m venv .venv-flybody
.venv-flybody/Scripts/python.exe -m pip install "flybody @ git+https://github.com/TuragaLab/flybody.git"
```
Core install only — no TF/Acme/Ray extensions; the tests drive the environment directly
through `dm_control.composer` (observation → controller → `env.step(action)` → physics).

## Closed-loop smoke test (`p1_flybody_smoke.py` → `P1_FLYBODY_SMOKE_RESULTS.json`)

Environment: `flybody.fly_envs.walk_imitation()` in inference mode (no reference dataset),
walker = fruitfly (`use_wings=False`, position actuators), physics dt = 1e-4 s
(SOURCE-DERIVED flybody default), control dt = 2e-3 s.

| Check | Claim guarded | Measured | Result |
|---|---|---|---|
| S1 build/reset/spec | env builds, obs finite, action spec = (59,) | shape (59,), finite | PASS |
| S2 passive stability | zero command ⇒ body holds under position actuators | CoM drift 1.9e-3 m (tol 5e-3), max\|qvel\|=2 | PASS |
| S3 scripted sine drive | finite, bounded, driven episode | max\|qvel\|=4.51, mean reward 1.0 | PASS |
| S4 feedback loop wiring | obs→action→physics loop is real, not decorative | action recompute err 0.0e0; \|Δqpos\| vs zero-ctrl = 9.8e-1 m; logged action == controller(logged obs) bitwise | PASS |
| S5 determinism | same seed + same actions ⇒ identical physics | \|Δqpos\|max = 0.0e0 | PASS |

The load-bearing check is **S4/S5 combined**: (a) every logged action equals
`controller(logged_obs)` recomputed offline (proves the loop consumes real observations),
(b) the resulting state diverges from the zero-action run by ~1 m of joint-space motion
(proves actions reach the physics), (c) reruns are bit-identical (proves no hidden RNG).

## Regression benchmark (`p1_flybody_benchmark.py` → `P1_FLYBODY_RESULTS.json`)

| Cell | Claim | Measured | Result |
|---|---|---|---|
| FB1 passive stability | drift < 5e-3 m, bounded qvel | 1.4e-3 m | PASS |
| FB2 gravity collapse | force actuators + zero force ⇒ CoM falls (real gravity) | **drop 1.22e-2 m**, bounded | PASS |
| FB3 scripted sine | finite/bounded/driven, reward recorded | mean reward 1.0 | PASS |
| FB4 determinism | replay bit-identical, incl. reset identity / no RNG drift across resets | 0.0e0 | PASS |
| FB5 closed-loop feedback | obs-conditioned controller changes trajectory | recompute 0.0e0; \|Δqpos\| vs scripted 1.13e0 m | PASS |
| FB6 specs + throughput | action dim (59,); ms/control-step recorded | 10.04 ms/control-step ≈ **~2,000 physics steps/s wall** | PASS |
| FB7 baseline regression | state metrics vs `P1_FLYBODY_BASELINE.json` (strict when versions match) | worst delta **0.0e+00** on re-run | PASS |

### Regression protocol (honest, version-strict)

- `--full` (default): run battery → write results → compare to baseline. Comparison is
  **strict only when the environment (python/mujoco/dm_control/flybody/commit) matches
  the baseline**; on version change the comparison is reported as informational and the
  test tells you to re-anchor with `--force-baseline`. This is deliberate: physics metrics
  are not expected to be stable across flybody/MuJoCo versions, and silently comparing
  across versions would fake a regression signal.
- `--force-baseline`: re-anchor (explicit, logged).
- `--check`: no simulation — validates the recorded results file (schema, verdict, all
  checks passed, determinism == 0, no NaN/Inf, environment-version match) for CI /
  `node p1_tests.js`. Suite test **F2d fails on stale environments** so a mujoco upgrade
  cannot silently invalidate the recorded physics results.

### Protocol note on environment reuse

One shared composer env per actuator mode (2 builds instead of 8): MJCF compilation
dominates wall time on this machine (~40 s per build). Every battery cell still starts
from a composer `reset()`, and **reset-identity / no-RNG-drift across resets is proven
empirically by FB4 on every run** (it compares two full episodes on the same shared env).
Fresh-process determinism was established independently by smoke test S5. Tagged
MODEL-ASSUMED (`env_reuse_protocol`) — visible in the results JSON, not hidden.

## Parameter provenance (no blurring)

| Parameter | Value | Tag |
|---|---|---|
| physics_timestep, control_timestep | 1e-4 / 2e-3 s | SOURCE-DERIVED (flybody defaults, Vaxenburg et al., Nature 2025) |
| action_dimension | 59 | SOURCE-DERIVED (asserted against `action_spec` at runtime) |
| episode durations (0.2–0.4 s) | — | MODEL-ASSUMED (test protocol) |
| stability tol 5e-3 m, gravity min 1e-3 m, velocity bound, determinism tol 1e-12, baseline abs tol 1e-6, throughput band ×5 | — | MODEL-ASSUMED (this test protocol) |
| sine amp/freq, feedback gain (1.0) | — | MODEL-ASSUMED (wiring check, not control performance) |

No parameter in this stage is TUNED (nothing was optimized for a favorable look),
EMPIRICAL (nothing fitted to data), or UNKNOWN.

## What the physics actually demonstrated

1. **Real body, real gravity**: with force actuators and zero command the fly's CoM falls
   12.2 mm with physically plausible bounded velocities — this is a MuJoCo dynamics
   solution, not scripted animation.
2. **Passive joint posture holds**: under position actuators the body's CoM drifts < 2 mm
   over 0.3 s — the default-pose attractor behaves.
3. **The loop is genuinely closed**: observation-conditioned actions both match their
   controller exactly and measurably steer the state.
4. **Reproducible**: physics replay is bit-identical (determinism delta exactly 0), which
   is what makes FB7 a meaningful regression gate at 1e-6 tolerance.

## Suite integration (`node p1_tests.js` → Stage F2)

- **F2a** smoke results all-passed (guards the 5 invariants)
- **F2b** benchmark results all-passed (guards the 7 battery cells)
- **F2c** every flybody parameter carries SOURCE-DERIVED / MODEL-ASSUMED only
- **F2e** recorded determinism delta is exactly 0 (reproducible embodiment)
- **F2d** live physics gate: runs `p1_flybody_benchmark.py --check` against the current
  venv (no simulation, CI-safe); fails loudly with a remediation hint if the venv is
  missing or the stack version drifted from the recorded results.

Artifacts list (H1) extended to include both scripts, all three result JSONs, and this report.

## Limitations (disclosed, not hidden)

- **No learned policy**: the controllers are zero / scripted sine / fixed-gain feedback.
  Tracking-mode `mean_reward = 1.0` reflects the inference-mode reward of the shipped
  task, not skilled locomotion — training (DMPO/Ray) is out of scope of the commission.
- **Vision not exercised**: no pixel observables were used; the eye cameras exist in the
  model but rendering (GPU/EGL) is not part of this battery.
- **Walking task only**: `walk_imitation`; flight / walk-on-ball / vision-guided tasks are
  available behind the same interface but not benchmarked here.
- **Windows CPU timing is noisy**: throughput uses a ×5 regression band; the reported
  10 ms/control-step is indicative, not a performance claim.
- Reference-trajectory datasets (DeepMind fly locomotion HDF5) were not downloaded; all
  episodes run in the documented inference mode.

## Files added

`p1_flybody_smoke.py`, `p1_flybody_benchmark.py`, `P1_FLYBODY_SMOKE_RESULTS.json`,
`P1_FLYBODY_RESULTS.json`, `P1_FLYBODY_BASELINE.json`, this report; `.venv-flybody/`
(gitignored).
