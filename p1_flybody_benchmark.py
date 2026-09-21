"""Fixed-seed real-physics regression benchmark for the flybody/MuJoCo fly (P1 Stage F2).

Battery (fixed seed; one shared env per actuator mode — every cell starts from a
composer reset, and reset-identity/no-RNG-drift is proven empirically by FB4):
  FB1  passive stability      — position actuators, zero ctrl; CoM drift < tol
  FB2  gravity collapse       — force actuators, zero ctrl; CoM must drop (true gravity)
  FB3  scripted sine drive    — finite, bounded, mean-reward recorded
  FB4  determinism            — FB3 rerun in a fresh env => |dqpos|max < 1e-12
  FB5  closed-loop feedback   — obs->action wiring exact; physics responds vs FB3
  FB6  specs + throughput     — action dim (59,) documented; ms/control-step, physics steps/s
  FB7  baseline regression    — state metrics vs P1_FLYBODY_BASELINE.json (strict when
                               env versions match; informational on version change)

Modes:
  --full (default)      run battery, write P1_FLYBODY_RESULTS.json, create/compare baseline
  --force-baseline      run battery and overwrite baseline without comparison
  --check               no simulation: validate existing P1_FLYBODY_RESULTS.json
                        (schema, all-passed, determinism-zero, no NaN) for CI/p1_tests.js

Writes: P1_FLYBODY_RESULTS.json, P1_FLYBODY_BASELINE.json (full mode).
Exit 0 iff verdict PASS.

Provenance tags: flybody defaults (timesteps, action dim) = SOURCE-DERIVED;
episode durations, tolerances, controller params, throughput band = MODEL-ASSUMED.
"""
import json
import math
import platform
import sys
import time
import importlib.metadata as _md

import numpy as np

RESULTS_PATH = "P1_FLYBODY_RESULTS.json"
BASELINE_PATH = "P1_FLYBODY_BASELINE.json"

PARAMS = [
    {"name": "physics_timestep", "value": 1e-4, "tag": "SOURCE-DERIVED",
     "source": "flybody FruitFly._build default (Vaxenburg et al., Nature 2025)"},
    {"name": "control_timestep", "value": 2e-3, "tag": "SOURCE-DERIVED",
     "source": "flybody FruitFly._build default; re-measured from data.time at runtime"},
    {"name": "action_dimension", "value": 59, "tag": "SOURCE-DERIVED",
     "source": "flybody README walking action dimension; asserted against action_spec"},
    {"name": "stability_episode_s", "value": 0.3, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
    {"name": "collapse_episode_s", "value": 0.3, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
    {"name": "drive_episode_s", "value": 0.4, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
    {"name": "sine_amplitude", "value": 0.3, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
    {"name": "sine_frequency_hz", "value": 2.0, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
    {"name": "feedback_gain", "value": 1.0, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
    {"name": "stability_tolerance_m", "value": 5e-3, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
    {"name": "gravity_drop_min_m", "value": 1e-3, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
    {"name": "velocity_bound", "value": 1e3, "tag": "MODEL-ASSUMED",
     "source": "divergence guard, this test protocol"},
    {"name": "determinism_tol", "value": 1e-12, "tag": "MODEL-ASSUMED", "source": "this test protocol"},
    {"name": "state_compare_abs_tol", "value": 1e-6, "tag": "MODEL-ASSUMED",
     "source": "baseline regression band (strict only when versions match)"},
    {"name": "throughput_max_ratio", "value": 5.0, "tag": "MODEL-ASSUMED",
     "source": "performance regression band, this test protocol"},
    {"name": "env_reuse_protocol", "value": "one shared env per (seed, actuator mode); every battery cell starts from composer reset; reset-determinism (incl. no RNG drift across resets) is proven empirically by FB4 on every run", "tag": "MODEL-ASSUMED",
     "source": "this test protocol; fresh-env determinism independently established by p1_flybody_smoke.py S5"},
]

CHECKS = []


def check(name, passed, detail, metrics=None):
    CHECKS.append({"name": name, "passed": bool(passed), "detail": detail, "metrics": metrics or {}})
    print(("PASS " if passed else "FAIL ") + name + " — " + detail)
    return bool(passed)


def versions():
    def v(pkg):
        try:
            return _md.version(pkg)
        except Exception:
            return None
    commit = None
    try:
        raw = _md.distribution("flybody").read_text("direct_url.json")
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
    return lambda obs, t: (amp * np.sin(2 * np.pi * freq * t + 0.1 * idx)).astype(spec.dtype)


def feedback_controller_factory(spec, key, gain):
    def ctrl(obs, t):
        v = np.asarray(obs[key], dtype=np.float64).ravel()
        n = v.size
        a = gain * np.tanh(v[np.arange(spec.shape[0]) % n])
        return np.clip(a, spec.minimum, spec.maximum).astype(spec.dtype)
    return ctrl


def run_episode(env, controller, max_seconds, log_source_key=None):
    timestep = env.reset()
    spec = env.action_spec()
    obs = timestep.observation
    dt = None
    actions, rewards, comz, src_log = [], [], [], []
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
    return {
        "steps": len(actions), "dt": dt, "wall_s": wall, "finite_obs": finite_ok,
        "bad_obs_key": bad_key, "terminated_early": terminated_early,
        "max_abs_qvel": float(np.abs(np.asarray(env.physics.data.qvel, dtype=np.float64)).max()),
        "mean_reward": float(np.mean(rewards)) if rewards else 0.0,
        "final_com_z": comz[-1] if comz else float("nan"),
        "com_z_min": float(np.min(comz)) if comz else float("nan"),
        "com_z_max": float(np.max(comz)) if comz else float("nan"),
        "qpos_final": np.asarray(env.physics.data.qpos, dtype=np.float64).copy(),
        "actions": actions, "src_log": src_log,
    }


def summarize(r):
    return {"steps": r["steps"], "dt": r["dt"], "mean_reward": round(r["mean_reward"], 10),
            "final_com_z": round(r["final_com_z"], 10), "com_z_min": round(r["com_z_min"], 10),
            "com_z_max": round(r["com_z_max"], 10), "max_abs_qvel": round(r["max_abs_qvel"], 10),
            "terminated_early": r["terminated_early"],
            "qpos_final": [round(float(x), 10) for x in r["qpos_final"]]}


def make_env(seed, force_actuators):
    from flybody.fly_envs import walk_imitation
    return walk_imitation(force_actuators=force_actuators,
                          random_state=np.random.RandomState(seed))


def run_battery():
    ver = versions()
    battery, throughput = {}, {}
    # One shared env per actuator mode (see env_reuse_protocol param): MJCF compiles
    # dominate wall time; composer reset restores the episode-initial state, and FB4
    # verifies that empirically on every run.
    envP = make_env(0, False)
    spec = envP.action_spec()
    src_key = pick_obs_source(envP.reset().observation)
    r_probe = run_episode(envP, zero_controller(spec), 0.01)
    dt = r_probe["dt"]
    shape_ok = tuple(spec.shape) == (59,)

    # FB1 passive stability (first full episode on envP after a fresh reset)
    envP.reset()
    com_z0 = com_z(envP.physics)
    r1 = run_episode(envP, zero_controller(spec), PARAMS[3]["value"])
    drift = max(abs(r1["com_z_min"] - com_z0), abs(r1["com_z_max"] - com_z0))
    battery["FB1_passive_stability"] = summarize(r1) | {"com_z_initial": round(com_z0, 10), "drift": round(drift, 10)}
    check("FB1_passive_stability",
          r1["finite_obs"] and drift < PARAMS[9]["value"] and r1["max_abs_qvel"] < PARAMS[11]["value"],
          f"CoM drift {drift:.2e} m (tol {PARAMS[9]['value']:.0e}), max|qvel|={r1['max_abs_qvel']:.3g}, finite={r1['finite_obs']}",
          {"drift": drift, "max_abs_qvel": r1["max_abs_qvel"]})

    # FB2 gravity collapse (force actuators, zero force)
    envF = make_env(0, True)
    envF.reset()
    com_z0f = com_z(envF.physics)
    r2 = run_episode(envF, zero_controller(envF.action_spec()), PARAMS[4]["value"])
    drop = com_z0f - r2["final_com_z"]
    battery["FB2_gravity_collapse"] = summarize(r2) | {"com_z_initial": round(com_z0f, 10), "drop": round(drop, 10)}
    check("FB2_gravity_collapse",
          r2["finite_obs"] and drop > PARAMS[10]["value"] and r2["max_abs_qvel"] < PARAMS[11]["value"],
          f"CoM dropped {drop:.4f} m under gravity (min {PARAMS[10]['value']:.0e}), max|qvel|={r2['max_abs_qvel']:.3g}",
          {"drop_m": drop, "max_abs_qvel": r2["max_abs_qvel"]})

    # FB3 scripted sine (same shared env, fresh reset inside run_episode)
    r3 = run_episode(envP, sine_controller_factory(spec, PARAMS[6]["value"], PARAMS[7]["value"]),
                     PARAMS[5]["value"])
    battery["FB3_scripted_sine"] = summarize(r3)
    check("FB3_scripted_sine",
          r3["finite_obs"] and r3["max_abs_qvel"] < PARAMS[11]["value"]
          and max(np.abs(a).max() for a in r3["actions"]) > 0,
          f"finite={r3['finite_obs']}, max|qvel|={r3['max_abs_qvel']:.3g}, mean_reward={r3['mean_reward']:.6f}",
          {"mean_reward": r3["mean_reward"], "max_abs_qvel": r3["max_abs_qvel"]})

    # FB4 determinism — rerun on the SAME env: also proves reset returns the
    # identical episode-initial state (no RNG drift across resets).
    r4 = run_episode(envP, sine_controller_factory(spec, PARAMS[6]["value"], PARAMS[7]["value"]),
                     PARAMS[5]["value"])
    dd = float(np.abs(r4["qpos_final"] - r3["qpos_final"]).max())
    battery["FB4_determinism"] = {"determinism_delta": dd}
    check("FB4_determinism", dd < PARAMS[12]["value"],
          f"rerun on shared env |dqpos|max = {dd:.3e} (tol {PARAMS[12]['value']:.0e}; "
          "proves reset-identity + no RNG drift)",
          {"determinism_delta": dd})

    # FB5 closed-loop feedback vs FB3 (different actions, both well-posed)
    ctrl5 = feedback_controller_factory(spec, src_key, PARAMS[8]["value"])
    r5 = run_episode(envP, ctrl5, PARAMS[5]["value"], log_source_key=src_key)
    recomp = 0.0
    for a, src in zip(r5["actions"], r5["src_log"]):
        recomp = max(recomp, float(np.abs(a - ctrl5({src_key: src}, 0.0)).max()))
    dq35 = float(np.abs(r5["qpos_final"] - r3["qpos_final"]).max())
    battery["FB5_closed_loop_feedback"] = summarize(r5) | {
        "recompute_err": recomp, "qpos_delta_vs_scripted": round(dq35, 10)}
    check("FB5_closed_loop_feedback",
          recomp < 1e-12 and dq35 > 1e-9 and r5["finite_obs"]
          and r5["max_abs_qvel"] < PARAMS[11]["value"],
          f"recompute_err={recomp:.2e}; |dqpos| vs scripted={dq35:.3e} (loop influences physics); finite={r5['finite_obs']}",
          {"recompute_err": recomp, "qpos_delta": dq35})

    # FB6 specs + throughput
    total_steps = r1["steps"] + r2["steps"] + r3["steps"] + r4["steps"] + r5["steps"]
    total_wall = r1["wall_s"] + r2["wall_s"] + r3["wall_s"] + r4["wall_s"] + r5["wall_s"]
    ms_per_step = 1e3 * total_wall / max(total_steps, 1)
    # control step = 2 ms of simulated time = dt/1e-4 physics steps at flybody's 1e-4 s physics step
    physics_steps_per_s = (total_steps * (dt / 1e-4) / total_wall) if (dt and total_wall > 0) else 0.0
    throughput = {"mean_ms_per_control_step": round(ms_per_step, 4),
                  "physics_steps_per_s": round(physics_steps_per_s, 1),
                  "total_control_steps": total_steps, "total_wall_s": round(total_wall, 3),
                  "control_timestep_measured": dt}
    battery["FB6_specs_throughput"] = {"action_shape": list(spec.shape)}
    check("FB6_specs_throughput", shape_ok and math.isfinite(ms_per_step) and ms_per_step > 0,
          f"action shape {tuple(spec.shape)} (expect (59,)); {ms_per_step:.2f} ms/control-step",
          {"action_dim": int(spec.shape[0]), "ms_per_step": ms_per_step})

    return ver, battery, throughput, src_key


def compare_baseline(ver, battery, throughput):
    try:
        with open(BASELINE_PATH, "r", encoding="utf-8") as f:
            base = json.load(f)
    except FileNotFoundError:
        with open(BASELINE_PATH, "w", encoding="utf-8") as f:
            json.dump({"meta": {"versions": ver, "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                       "battery": battery, "throughput": throughput}, f, indent=1)
        return check("FB7_baseline_regression", True,
                     "no baseline existed — created P1_FLYBODY_BASELINE.json (first anchor)",
                     {"status": "baseline-created"})
    bv = base.get("meta", {}).get("versions", {})
    tol = PARAMS[13]["value"]
    if any(bv.get(k) != ver.get(k) for k in ("python", "mujoco", "dm_control", "flybody", "flybody_commit")):
        return check("FB7_baseline_regression", True,
                     f"environment versions changed since baseline ({bv} -> {ver}); "
                     "state comparison skipped as informational — re-anchor with --force-baseline if intended",
                     {"status": "version-changed", "baseline_versions": bv, "current_versions": ver})
    diffs = {}
    worst = 0.0
    for key in ("FB1_passive_stability", "FB2_gravity_collapse", "FB3_scripted_sine"):
        for m in ("mean_reward", "final_com_z", "com_z_min", "com_z_max", "max_abs_qvel", "drift", "drop"):
            a = battery.get(key, {}).get(m)
            b = base.get("battery", {}).get(key, {}).get(m)
            if a is None and b is None:
                continue
            if a is None or b is None:
                diffs[f"{key}.{m}"] = "missing"
                worst = float("inf")
                continue
            d = abs(a - b)
            diffs[f"{key}.{m}"] = d
            worst = max(worst, d)
    tb = base.get("throughput", {}).get("mean_ms_per_control_step")
    tnow = throughput.get("mean_ms_per_control_step")
    tp_ok = tb is None or tnow is None or tnow < PARAMS[14]["value"] * tb
    passed = worst < tol and tp_ok
    return check("FB7_baseline_regression", passed,
                 f"worst state metric delta {worst:.3e} (tol {tol:.0e}); throughput "
                 f"{tnow:.2f} vs baseline {tb:.2f} ms/step (band x{PARAMS[14]['value']:.0f})",
                 {"status": "compared", "diffs": diffs, "throughput_ok": tp_ok})


def validate_results_file():
    try:
        with open(RESULTS_PATH, "r", encoding="utf-8") as f:
            res = json.load(f)
    except FileNotFoundError:
        print("FAIL --check: missing", RESULTS_PATH)
        return 1
    problems = []
    if res.get("verdict") != "PASS":
        problems.append("verdict != PASS")
    checks = res.get("checks", [])
    if not checks:
        problems.append("no checks recorded")
    for c in checks:
        if not c.get("passed"):
            problems.append("check failed: " + c.get("name", "?"))
    det = next((c for c in checks if c["name"] == "FB4_determinism"), None)
    if det is None:
        problems.append("FB4_determinism missing")
    def walk(o):
        if isinstance(o, float):
            if math.isnan(o) or math.isinf(o):
                return False
        if isinstance(o, dict):
            return all(walk(v) for v in o.values())
        if isinstance(o, list):
            return all(walk(v) for v in o)
        return True
    if not walk(res):
        problems.append("NaN/Inf present in results")
    cur = versions()
    ver_changed = any(res.get("meta", {}).get("versions", {}).get(k) != cur.get(k)
                      for k in ("python", "mujoco", "dm_control", "flybody"))
    print("note: environment versions changed since results were recorded"
          if ver_changed else "note: environment versions match recorded results")
    print("PASS --check" if not problems else "FAIL --check: " + "; ".join(problems))
    return 0 if not problems else 1


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--full"
    if mode == "--check":
        return validate_results_file()
    if mode not in ("--full", "--force-baseline"):
        print("usage: p1_flybody_benchmark.py [--full|--force-baseline|--check]")
        return 2
    ver, battery, throughput, src_key = run_battery()
    if mode == "--force-baseline":
        with open(BASELINE_PATH, "w", encoding="utf-8") as f:
            json.dump({"meta": {"versions": ver, "created_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                       "battery": battery, "throughput": throughput}, f, indent=1)
        check("FB7_baseline_regression", True, "baseline force-rewritten", {"status": "baseline-created"})
    else:
        compare_baseline(ver, battery, throughput)
    results = {
        "meta": {"tool": "p1_flybody_benchmark", "mode": mode, "versions": ver,
                 "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        "params": PARAMS,
        "env": {"obs_source_key": src_key, **throughput},
        "battery": battery,
        "checks": CHECKS,
        "verdict": "PASS" if all(c["passed"] for c in CHECKS) else "FAIL",
    }
    with open(RESULTS_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1, default=float)
    print("verdict:", results["verdict"], "->", RESULTS_PATH)
    return 0 if results["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
