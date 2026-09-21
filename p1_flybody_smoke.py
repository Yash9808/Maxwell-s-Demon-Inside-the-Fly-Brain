"""Closed-loop real-physics smoke test for the flybody/MuJoCo fruit-fly body (P1 Stage F2).

Runs the flybody walking environment (dm_control composer, inference mode — no
reference dataset needed) under three controllers and asserts real-physics
invariants:

  S1  environment builds / resets; observations finite; action spec shape (59,)
  S2  zero action (position actuators): passive stability — CoM drift < tol
  S3  scripted sine actions: finite, bounded velocities, nonzero drive
  S4  observation-conditioned feedback: loop wiring proven exactly
      (a) logged actions == controller(logged obs) bitwise-recomputed
      (b) nonzero action norm
      (c) physics actually responds: |qpos_feedback - qpos_zero| > eps
  S5  determinism: same seed + same actions => identical final qpos (fresh env)

Writes P1_FLYBODY_SMOKE_RESULTS.json. Exit 0 iff all checks pass.

Run:  .venv-flybody/Scripts/python.exe p1_flybody_smoke.py

Provenance tags (P1 discipline — never blurred):
  SOURCE-DERIVED  physics_timestep, control_timestep, action dimension,
                  walker/arena model parameters (flybody defaults, Nature 2025)
  MODEL-ASSUMED   episode durations, tolerances, controller gains/frequencies
"""
import json
import math
import platform
import sys
import time
import importlib.metadata as _md

import numpy as np

RESULT_PATH = "P1_FLYBODY_SMOKE_RESULTS.json"

PARAMS = [
    {"name": "physics_timestep", "value": 1e-4, "tag": "SOURCE-DERIVED",
     "source": "flybody FruitFly._build default (Vaxenburg et al., Nature 2025)"},
    {"name": "control_timestep", "value": 2e-3, "tag": "SOURCE-DERIVED",
     "source": "flybody FruitFly._build default; re-measured from data.time at runtime"},
    {"name": "action_dimension", "value": 59, "tag": "SOURCE-DERIVED",
     "source": "flybody README walking action dimension; asserted against action_spec at runtime"},
    {"name": "smoke_episode_seconds", "value": 0.2, "tag": "MODEL-ASSUMED",
     "source": "this test protocol"},
    {"name": "sine_amplitude", "value": 0.3, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
    {"name": "sine_frequency_hz", "value": 2.0, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
    {"name": "feedback_gain", "value": 1.0, "tag": "MODEL-ASSUMED",
     "source": "this test protocol (wiring check, not control performance)"},
    {"name": "stability_tolerance_m", "value": 5e-3, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
    {"name": "velocity_bound", "value": 1e3, "tag": "MODEL-ASSUMED",
     "source": "divergence guard, this test protocol"},
    {"name": "physics_response_eps_m", "value": 1e-9, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
    {"name": "determinism_tol", "value": 1e-12, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
]

CHECKS = []


def check(name, passed, detail, metrics=None):
    CHECKS.append({"name": name, "passed": bool(passed), "detail": detail,
                   "metrics": metrics or {}})
    print(("PASS " if passed else "FAIL ") + name + " — " + detail)
    return passed


def versions():
    def v(pkg):
        try:
            return _md.version(pkg)
        except Exception:
            return None
    commit = None
    try:
        d = _md.distribution("flybody")
        raw = d.read_text("direct_url.json")
        if raw:
            u = json.loads(raw).get("url", "")
            if "@" in u:
                commit = u.split("@", 1)[1].split("#", 1)[0]
    except Exception:
        pass
    return {"python": platform.python_version(), "mujoco": v("mujoco"),
            "dm_control": v("dm_control"), "flybody": v("flybody"),
            "flybody_commit": commit, "platform": platform.platform()}


def com_z(physics):
    """Whole-body centre-of-mass height (mass-weighted; world body has zero mass)."""
    m = np.asarray(physics.model.body_mass, dtype=np.float64)
    p = np.asarray(physics.data.xipos, dtype=np.float64)
    return float((m @ p[:, 2]) / m.sum())


def obs_finite(obs):
    for k, v in obs.items():
        a = np.asarray(v)
        if a.dtype.kind == "f" and not np.isfinite(a).all():
            return False, k
    return True, None


def pick_obs_source(obs):
    """Deterministically choose a small float observable for the feedback controller."""
    def usable(k, v):
        a = np.asarray(v)
        return (a.dtype.kind == "f" and 1 <= a.size <= 512
                and not any(s in k for s in ("camera", "rgb", "image", "mask")))
    cands = sorted(k for k, v in obs.items() if usable(k, v))
    for pref in ("walker/veloc", "walker/joints_vel", "walker/appendages_pos"):
        if pref in cands:
            return pref
    return cands[0] if cands else None


def zero_controller(spec):
    return lambda obs, t: np.zeros(spec.shape, dtype=spec.dtype)


def sine_controller_factory(spec, amp, freq):
    idx = np.arange(spec.shape[0])
    def ctrl(obs, t):
        return (amp * np.sin(2 * np.pi * freq * t + 0.1 * idx)).astype(spec.dtype)
    return ctrl


def feedback_controller_factory(spec, key, gain):
    n_cache = {}
    def ctrl(obs, t):
        v = np.asarray(obs[key], dtype=np.float64).ravel()
        a = np.zeros(spec.shape[0], dtype=np.float64)
        n = v.size
        a[:] = gain * np.tanh(v[np.arange(a.size) % n])
        return np.clip(a, spec.minimum, spec.maximum).astype(spec.dtype)
    return ctrl


def run_episode(env, controller, max_seconds, log_source_key=None):
    """One closed-loop episode: obs -> controller -> physics -> obs."""
    timestep = env.reset()
    spec = env.action_spec()
    obs = timestep.observation
    dt = None
    actions, src_log, rewards, comz = [], [], [], []
    finite_ok, bad_key = True, None
    t0 = time.perf_counter()
    terminated_early = False
    while True:
        a = np.clip(np.asarray(controller(obs, env.physics.data.time),
                               dtype=spec.dtype), spec.minimum, spec.maximum)
        timestep = env.step(a)
        if dt is None:
            dt = float(env.physics.data.time)
        actions.append(np.asarray(a, dtype=np.float64))
        rewards.append(float(timestep.reward) if timestep.reward is not None else 0.0)
        comz.append(com_z(env.physics))
        if log_source_key is not None:
            src_log.append(np.asarray(obs[log_source_key], dtype=np.float64).ravel())
        ok, bk = obs_finite(timestep.observation)
        finite_ok = finite_ok and ok
        bad_key = bad_key or bk
        obs = timestep.observation
        if timestep.last():
            terminated_early = True
            break
        if env.physics.data.time >= max_seconds - 1e-9:
            break
    wall = time.perf_counter() - t0
    qvel_max = float(np.abs(np.asarray(env.physics.data.qvel, dtype=np.float64)).max())
    return {
        "steps": len(actions),
        "dt": dt,
        "wall_s": wall,
        "finite_obs": finite_ok,
        "bad_obs_key": bad_key,
        "terminated_early": terminated_early,
        "max_abs_qvel": qvel_max,
        "mean_reward": float(np.mean(rewards)) if rewards else 0.0,
        "final_com_z": comz[-1] if comz else float("nan"),
        "com_z_min": float(np.min(comz)) if comz else float("nan"),
        "com_z_max": float(np.max(comz)) if comz else float("nan"),
        "qpos_final": np.asarray(env.physics.data.qpos, dtype=np.float64).copy(),
        "actions": actions,
        "src_log": src_log,
    }


def main():
    from flybody.fly_envs import walk_imitation  # noqa: E402  (import after metadata)

    ver = versions()
    print("flybody smoke —", ver)

    # S1: build + reset + spec.
    env = walk_imitation(random_state=np.random.RandomState(0))
    timestep = env.reset()
    spec = env.action_spec()
    ok, bk = obs_finite(timestep.observation)
    shape_ok = tuple(spec.shape) == (59,)
    check("S1_build_reset_spec", ok and shape_ok,
          f"action_spec shape={tuple(spec.shape)} (expect (59,)), reset obs finite={ok}",
          {"action_dim": int(spec.shape[0]), "n_obs_keys": len(timestep.observation) if isinstance(timestep.observation, dict) else 1})
    src_key = pick_obs_source(timestep.observation)
    dt_measured = run_episode(env, zero_controller(spec), 0.01)["dt"]

    # S2: passive stability under zero command (position actuators hold default pose).
    env2 = walk_imitation(random_state=np.random.RandomState(0))
    r2 = run_episode(env2, zero_controller(env2.action_spec()), PARAMS[3]["value"])
    drift = max(abs(r2["com_z_min"] - r2["final_com_z"]), abs(r2["com_z_max"] - r2["final_com_z"]))
    initial_com_z = None
    # re-derive initial com from a fresh reset of same config
    env2b = walk_imitation(random_state=np.random.RandomState(0))
    env2b.reset()
    initial_com_z = com_z(env2b.physics)
    check("S2_passive_stability",
          r2["finite_obs"] and drift < PARAMS[7]["value"] and r2["max_abs_qvel"] < PARAMS[8]["value"]
          and abs(r2["final_com_z"] - initial_com_z) < PARAMS[7]["value"],
          f"CoM drift {drift:.2e} m over {r2['steps']} steps (tol {PARAMS[7]['value']:.0e}); "
          f"max|qvel|={r2['max_abs_qvel']:.3g}; finite_obs={r2['finite_obs']}",
          {"com_z_initial": initial_com_z, "com_z_final": r2["final_com_z"],
           "drift": drift, "max_abs_qvel": r2["max_abs_qvel"], "steps": r2["steps"]})

    # S3: scripted sine drive.
    env3 = walk_imitation(random_state=np.random.RandomState(0))
    spec3 = env3.action_spec()
    r3 = run_episode(env3, sine_controller_factory(spec3, PARAMS[4]["value"], PARAMS[5]["value"]),
                     PARAMS[3]["value"])
    check("S3_scripted_actions",
          r3["finite_obs"] and r3["max_abs_qvel"] < PARAMS[8]["value"]
          and max(np.abs(a).max() for a in r3["actions"]) > 0,
          f"finite_obs={r3['finite_obs']}; max|qvel|={r3['max_abs_qvel']:.3g}; "
          f"mean_reward={r3['mean_reward']:.6f}",
          {"mean_reward": r3["mean_reward"], "max_abs_qvel": r3["max_abs_qvel"],
           "steps": r3["steps"]})

    # S4: feedback loop wiring.
    env4 = walk_imitation(random_state=np.random.RandomState(0))
    spec4 = env4.action_spec()
    ctrl4 = feedback_controller_factory(spec4, src_key, PARAMS[6]["value"])
    r4 = run_episode(env4, ctrl4, PARAMS[3]["value"], log_source_key=src_key)
    recomp_err, anorm = 0.0, 0.0
    for a, src in zip(r4["actions"], r4["src_log"]):
        a2 = ctrl4({src_key: src}, 0.0)  # controller is time-independent
        recomp_err = max(recomp_err, float(np.abs(a - a2).max()))
        anorm = max(anorm, float(np.abs(a).max()))
    dq = float(np.abs(r4["qpos_final"] - r2["qpos_final"]).max())
    check("S4_feedback_loop_wiring",
          recomp_err < 1e-12 and anorm > 0 and dq > PARAMS[9]["value"] and r4["finite_obs"],
          f"recompute_err={recomp_err:.2e}; max|action|={anorm:.3f}; "
          f"|qpos_fb - qpos_zero|max={dq:.3e}; src_obs='{src_key}'",
          {"recompute_err": recomp_err, "max_action": anorm, "qpos_delta_vs_zero": dq})

    # S5: determinism — fresh env, same seed, same controller.
    env5 = walk_imitation(random_state=np.random.RandomState(0))
    spec5 = env5.action_spec()
    r5 = run_episode(env5, sine_controller_factory(spec5, PARAMS[4]["value"], PARAMS[5]["value"]),
                     PARAMS[3]["value"])
    dd = float(np.abs(r5["qpos_final"] - r3["qpos_final"]).max())
    check("S5_determinism", dd < PARAMS[10]["value"],
          f"|dqpos|max between identical reruns = {dd:.3e} (tol {PARAMS[10]['value']:.0e})",
          {"determinism_delta": dd})

    results = {
        "meta": {"tool": "p1_flybody_smoke", "versions": ver,
                 "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        "params": PARAMS,
        "env": {"action_dim": int(spec.shape[0]), "control_timestep_measured": dt_measured,
                "obs_source_key": src_key},
        "checks": CHECKS,
        "verdict": "PASS" if all(c["passed"] for c in CHECKS) else "FAIL",
    }
    with open(RESULT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1, default=float)
    print("verdict:", results["verdict"], "->", RESULT_PATH)
    return 0 if results["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
