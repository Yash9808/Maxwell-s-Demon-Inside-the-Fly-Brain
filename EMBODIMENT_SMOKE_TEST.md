# EMBODIMENT SMOKE TEST — Stage 4

Author: Agent 4 (embodiment track) · The smallest causal-loop test, run before
any Maxwell-chamber integration. Implementation: `embodiment/smoke_test.py`
(pure Python; Node driver: `embodiment/embodiment_client.js`, test mode).

---

## 1. What this test must prove

The causal chain, end to end, on the smallest possible task:

```
neural motor command → decoder → body action → PHYSICAL body movement
      ↑                                                   ↓
   reward → learning ← task state ← environment consequence ← body position/sensors
```

Movement must come from physics (state integration under forces), not
scripting. If a number changes because a formula said so instead of because the
body moved, the test fails.

## 2. Modes

| Mode | Body | Neural | When |
|---|---|---|---|
| `mock` | `MockBodyDriver` (deterministic physics surrogate, same 59-dim interface) | synthetic motor-population traces | validates protocol/decoder/logging/loop logic without deps |
| `flybody` ✅ **ACTIVE** | flybody `fruitfly.xml` (135 bodies, qpos=116) via `walk_imitation().step` | synthetic traces now; live bridge tap next | installed in `.venv-embodiment` (mujoco 3.13.0, dm_control 1.0.46, flybody 0.1.0) |

The mode is printed in the banner and stamped into every log record and every
assertion's provenance. **Mock results are interface-validation results, never
embodiment evidence.**

## 2b. What real physics changed in the test design (2026-09-20)

Running against the real model corrected two mock-era premises — the test
suite is *stronger* for it:

1. **"Silence = stillness" is false for real biomechanics.** The flybody model
   has no passive muscle tone: zero actuator targets → gravitational collapse
   (measured ~0.10 m drift in 10 s of free collapse). T1 was therefore
   restated from a stillness claim to a **causal-sensitivity claim**: same
   seed, silent vs structured neural input ⇒ significantly divergent physical
   trajectories (measured: final |dx| 0.086 m, per-step mean 5.7e-2 m).
2. **Rest convention matters.** Passing decoder 0 through a mid-range affine
   map into per-actuator bounds commanded half-adhered claws (an actively
   driven fly) — T1 caught this interface bug immediately. The BodyDriver now
   uses ctrl-space convention: decoder 0 = model rest pose, output clipped to
   `action_spec` bounds (claws [0,1] adhere units, head twist [-3,3], etc.).
3. T3's "static body" premise became **mapping determinism**: same body state
   ⇒ byte-identical observations (body→sensory is a state function), verified
   by full episode re-run equality.
4. T5 became an **identity check**: reward == (dx / 0.5 mm) recomputed from
   measured body positions (max err 4.8e-07) — reward is derived from physical
   displacement, never from the action vector.

## 3. Task T0 (minimal): "walk forward 0.5 mm"

- Body starts at origin on the floor; task horizon 600 physics steps (10 s).
- Reward per step: `Δx/Δx_max` (positive only for real forward displacement of
  the torso, measured from body state, not from action intent).
- Episode ends when `x ≥ 0.5 mm` or horizon.

## 4. Assertions (each maps to a causal edge)

| # | Assertion | Causal edge |
|---|---|---|
| T1 | Zero-neural ⇒ zero displacement: 600 steps of silent motor layer produce body position change < 1e-6 m and reward ≈ 0 | neural→action |
| T2 | Structured neural burst ⇒ displacement: with the synthetic burst pattern, torso `x(t)` is monotonically increasing beyond noise and `final_x ≥ 0.5 mm` in mock mode | action→body |
| T3 | Body state changes ⇒ observation changes: per-step `obs_next` differs from `obs_prev` when and only when body pose/velocities changed (Jaccard of changed dims > 0.8) | body→sensory |
| T4 | No-decoder-bypass: with the decoder replaced by a direct normalized projection of `a_neural`, the body still moves (displacement > 0) — the controller is not carried by the decoder | decoder honesty |
| T5 | Reward follows environment, not action magnitude: steps where the action vector has large norm but the body does not move (e.g. into a wall in flybody mode; stalled in mock) earn ~0 reward | env→reward |
| T6 | Learning loop closes: with a reward-gated plasticity pulse enabled in the synthetic-neural driver, motor-population statistics change across the episode (`active` count drift > 5%) and the log shows `delivered_to_brain: true` on ≥95% of steps after the first observation round-trip | reward→learning |
| T7 | Determinism: same seed, same step sequence ⇒ byte-identical `action`+`body` trajectories (mock mode; flybody mode = identical qpos trajectory) | seed/sync discipline |

## 5. How to run

```bash
# today (mock mode, no dependencies needed):
python embodiment/smoke_test.py --mode mock

# after deps (§6):
python embodiment/smoke_test.py --mode flybody

# Node regression-driver form (same sidecar, same protocol):
node embodiment/embodiment_client.js --test
```

Pass criteria: all of T1–T7 true in the selected mode, zero `error` records,
log file complete (one record per step), and the printed causal-chain summary
shows every edge exercised. Output ends with one of the three verdict banners.

## 6. Exact dependency unblock procedure (currently missing)

```bash
python -m pip install mujoco dm_control
python -m pip install "flybody @ git+https://github.com/TuragaLab/flybody.git"
python -c "import mujoco, flybody; print('embodiment deps OK')"
```

Notes: flybody is GitHub-only (not on PyPI); core install suffices (no `[tf]`/
`[ray]` extras). flybody's CI targets Python 3.10–3.12; this host runs 3.14, so
the first `import flybody` may fail on transitive pins — in that case create a
Python 3.10–3.12 venv and install there; the sidecar reads
`PYTHON_EMBODIMENT` env var or `--python` path so the Node/browser clients can
launch the correct interpreter. `MOCK_BODY` remains available as fallback and
is always honestly labeled.

## 7. Report format (end of every run)

```
EMBODIMENT SMOKE TEST — mode: <mock|flybody>
T1 neural→action ......... PASS (0 displacement, silent motor layer)
T2 action→body ........... PASS (x: 0 → 0.61 mm)
T3 body→sensory .......... PASS (obs changed 596/600 steps body moved)
T4 no-decoder-bypass ..... PASS (direct projection moved 0.33 mm)
T5 env→reward ............ PASS (reward 0.002 on 59 stalled steps)
T6 reward→learning ....... PASS (motor active count 87 → 104, brain delivery 99.8%)
T7 determinism ........... PASS (2 seeds byte-identical)
LOG: embodiment/logs/run_20260920_…_ep7.jsonl (600 records)
```

followed by the final verdict line (`EMBODIMENT FOUNDATION READY` /
`EMBODIMENT PARTIAL` / `EMBODIMENT BLOCKED`).
