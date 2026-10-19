#!/usr/bin/env python3
# embodiment/sidecar.py — Stage 2 reference sidecar (FLYBODY_ARCHITECTURE.md §3).
#
#   Browser/Node  <->  JSON-lines protocol (FLYBODY_PROTOCOL.md)  <->  BodyDriver
#
# BodyDriver backends:
#   MockBodyDriver  deterministic physics surrogate, same 59-dim action
#                   interface as flybody. Runs TODAY on this host. Clearly
#                   labeled: interface validation only, never embodiment evidence.
#   FlybodyDriver   flybody (TuragaLab) via mujoco. Code complete; raises a
#                   precise dependency error until `mujoco`, `dm_control` and
#                   `flybody` are installed (see EMBODIMENT_SMOKE_TEST.md §6).
#                   NO mock result is ever reported as flybody.
#
# Transports: stdio JSON-lines (default; batch/CI — client-paced, wall-clock
# free) or WebSocket (optional, when `websockets` is installed and --ws passed;
# the only mode where server-paced auto-stepping exists).
#
# ─── Post-Phase-02 ADDITIVE change: real visual feedback (FLYBODY_ARCHITECTURE
# §7) ───
# The 8 visual channels of FlybodyDriver.observation() are no longer a constant
# zero vector: they are an EGOCENTRIC GEOMETRIC OCCUPANCY field of the MuJoCo
# scene — the walking-ghost target (the task's own visual object) plus the
# walker's moving appendages (legs, head), binned into the same 4-azimuth x
# 2-elevation grid as the chamber's canonical readVisualField. See
# EgocentricFieldSensor below for the full sensor spec.
#
# DESIGN PIVOT (documented deviation from the approved plan, per the
# "trust the actual code" rule): the plan's Option A (render the scene from
# flybody's `walker/eye_right` camera) was implemented and probed on this host
# and REJECTED on measured evidence:
#   1. OCCLUSION: the eye camera is mounted inside the head (fruitfly.xml
#      camera pos 0.0219 0.0131 0 relative to the head body). In the walking
#      pose the head collision geoms occlude the lens: 30 vigorously driven
#      steps changed 0 of 1024 rendered pixels (constant dark self-view).
#      flybody itself uses the eye cameras only for the flight task over hilly
#      terrain (vision_flight.py), never in walk_imitation.
#   2. COST: ~0.3 s per render on this host (glfw; osmesa/egl unavailable
#      unprivileged) — ~20x the physics step, with no causal signal to show
#      for it (see 1).
# Option B (geometry-based sensing) is the task's stated preference when
# available, needs no OpenGL dependency, costs microseconds, and is exactly
# causal: every input is a pure function of the post-step physics state.
#
# The wire contract (state_contract.js v1) is UNCHANGED — OBS_DIM stays 15:
#   obs[0:8]  = 8 visual bins        (4 azimuth x 2 elevation, [0,1] occupancy)
#   obs[8:15] = 7 proprio/contact    (unchanged: tanh-scaled post-root joint velocities)
# Determinism: every term is a pure function of the physics state (verified
# bit-identical across recomputation); the sector grid, gains and clipping are
# fixed constants below. No GL, no rendering, no random noise.
import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from motor_decoder import MotorDecoder, ACTION_DIM, MOTOR_POOL_SIZE, NEURAL_MAX_DIM  # noqa: E402
import task_pillar  # noqa: E402  (STAGE 5 task module; math+numpy only at import)

PROTOCOL_VERSION = 1
DT_PHYS = 1.0 / 60.0


# --------------------------------------------------------------------------- #
class MockBodyDriver:
    """Deterministic 6-DoF rigid surrogate: torso point-mass with leg-generated
    ground force and wing drag. Same 59-dim action space and step contract as
    the flybody env, seeded, pure numpy.

    Honest labeling: NOT Drosophila biomechanics. It exists so the protocol,
    decoder and causal-loop logic are executable before the flybody dependency
    lands. `mode` is stamped on every step result.
    """

    mode = "mock_body"

    def __init__(self, seed=0):
        import numpy as np
        self._np = np
        self.reset(seed)

    def reset(self, seed=0):
        np = self._np
        self.rng = np.random.default_rng(seed)
        self.pos = np.zeros(3)
        self.quat = np.array([1.0, 0.0, 0.0, 0.0])   # identity w,x,y,z
        self.vel = np.zeros(3)
        self.ang = np.zeros(3)
        self.leg_groups = np.zeros(6)                 # last per-group vigor
        self.t = 0
        return self._state()

    def _state(self):
        return {"pos": self.pos.tolist(), "quat": self.quat.tolist(),
                "linvel": self.vel.tolist(), "angvel": self.ang.tolist(),
                "z": float(self.pos[2]),
                "joints": [round(float(x), 4) for x in self.leg_groups]}

    def step(self, action, dt=DT_PHYS):
        np = self._np
        a = np.clip(np.asarray(action, dtype=np.float64), -1, 1)
        self.last_action = a
        # 6 leg groups x 9 slots (54) -> per-group vigor (T2 driver)
        for g in range(6):
            self.leg_groups[g] = float(np.mean(np.abs(a[g * 9:(g + 1) * 9])))
        leg_vigor = float(np.mean(self.leg_groups))
        drag = 0.6 * self.vel
        force = np.array([2.4 * leg_vigor, 0.0, 0.0]) - drag
        wing = 0.5 * (abs(a[54]) + abs(a[55]))
        force[2] += 0.02 * wing                        # wingbeat lift trim
        self.vel += (force / 1e-6) * dt * 1e-7         # scaled toy dynamics (~1 mg fly)
        self.vel = np.clip(self.vel, -0.05, 0.05)      # m/s cap keeps mock tame
        self.pos = self.pos + self.vel * dt
        self.pos[2] = max(0.0, self.pos[2])            # floor
        self.ang = 0.98 * self.ang + 0.02 * a[56:59] * 0.1
        self.t += 1
        return self._state()

    def observation(self):
        """SensorBinder surrogate: 8-bin visual + 7 contact/proprio channels.
        Deterministic function of body state (smoke test T3)."""
        np = self._np
        x, y, z = self.pos
        vis = np.zeros(8)
        for b in range(8):
            center = -0.35 + 0.1 * b
            vis[b] = float(np.exp(-((x - center) ** 2) / 0.02) * (0.4 + z * 2.0))
        proprio = np.tanh(np.abs(self.vel) * 20.0)
        contact = np.full(7, float(np.mean(self.leg_groups) > 0.05))
        contact[:3] = proprio[:3]
        return np.concatenate([vis, contact]).tolist()

    def task_reward(self, prev_x):
        """T0 task: reward = real forward displacement only (T5: no motion, no
        reward, regardless of action magnitude)."""
        dx = self.pos[0] - prev_x
        return float(dx / 0.0005), {"phase": "walk_forward", "x": float(self.pos[0]),
                                    "event": "moved" if abs(dx) > 1e-9 else "stalled"}


# --------------------------------------------------------------------------- #
# Real visual sensor (FLYBODY_ARCHITECTURE.md §7) — geometric, no GL.
#
# Sensor spec (fixed constants — documented, deterministic, model-derived):
#   reference frame  thorax egocentric: x = forward, y = left, z = up.
#                    Sector columns j = 0..3 = azimuth quadrants about the
#                    thorax z-axis (fwd, left, back, right); sector rows
#                    i = 0 (below horizon) / 1 (above).
#   bin index        bins[j + 4*i] — azimuth-major, index-order-aligned with
#                    the chamber's `(u*4 | 0) + ((v*2 | 0) * 4)` convention so
#                    the connectome's injectLayerChannels semantics apply
#                    unchanged (no new coordinate system invented).
#   observed objects SELF (walker appendages: 6 claw sites + head — the
#                    moving body the brain must sense) and TARGET
#                    (ghost/thorax — the walking-ghost reference fly, the
#                    task's own visual object), both always visible in this
#                    scene (occlusion is not modeled — stated limitation).
#   range model      r/0.01 m clipped to [0,1] (claw reach ~1 cm), TARGET
#                    r/0.05 m clipped to [0,1] (ghost offset ~5 cm).
#   self visibility  own appendages are always in view; per-bin visibility
#                    comes from the sector assignment (their egocentric
#                    direction), so posture changes redistribute the signal.
#   cadence          recomputed once per physics step (inside step(), after
#                    env.step) and memoized — observation() stays a pure
#                    function of the post-step state (contract C4 discipline).
_GL_MODES = ("osmesa", "glfw")   # GL auto-probe order, only for OPTIONAL
                                  # render-mode reporting; egl is honor-if-
                                  # user-set (`import OpenGL` succeeds without
                                  # EGL libs, so a probe cannot validate it)


def _resolve_mujoco_gl():
    """Resolve MUJOCO_GL exactly once, before mujoco is first imported.

    Honors ANY explicit user setting, including 'disable' (the smoke harness
    sets it for physics-only runs, and the geometric visual sensor needs no
    GL); otherwise probes the available backends in _GL_MODES order by
    importing the corresponding OS module, and falls back to 'disable' (the
    flybody backend then fails closed when it needs the renderer, never
    silently). Returns the resolved mode string.
    """
    cur = os.environ.get("MUJOCO_GL", "")
    if cur:
        return cur
    for mode in _GL_MODES:
        mod = "glfw" if mode == "glfw" else "osmesa"
        try:
            __import__(mod)
            os.environ["MUJOCO_GL"] = mode
            return mode
        except Exception:  # noqa: BLE001 — probe, best effort by design
            continue
    os.environ["MUJOCO_GL"] = "disable"
    return "disable"


class EgocentricFieldSensor:
    """Thorax-egocentric geometric occupancy field -> 8 bins (FLYBODY_ARCH §7).

    Pure state-function sensor (no rendering, no GL): for each observed point,
    compute its position in the thorax frame, assign it to one of 8 sectors
    (4 azimuth quadrants x 2 hemifields), and accumulate a distance-scaled
    occupancy. Every input is a field of the post-step physics state, so the
    output is exactly causal and bit-deterministic on recomputation.
    """

    # SELF points: EVERY geom center of the walker subtree (visual + collision
    # geoms of all body parts). A dense point cloud makes the field a smooth
    # function of posture: leg/head motion changes many point distances and
    # sector memberships at once (7 sparse end-effector sites were probed and
    # REJECTED: all below the horizon, distance gains clipped, bins static).
    SELF_PREFIX = "walker/"
    SELF_RANGE = 0.25    # m — self distance scale: the model's own body span
                         # (thorax->claw ~0.13 m), so gains are graded, not
                         # saturated, and posture changes move values smoothly
    TARGET_BODY = "ghost/thorax"   # the walking-ghost reference fly (top-level
                          # 'ghost/' tree in the walk_imitation model, NOT
                          # nested under 'walker/' — verified by name table)
    TARGET_RANGE = 0.5    # m — target distance scale (~half a body length
                          # per second of ghost-walker divergence at 2 m/s)

    def __init__(self, physics):
        import mujoco
        import numpy as np
        self._mujoco = mujoco
        self._np = np
        # Structural model facts are resolved ONCE here (names, counts) and
        # RE-RESOLVED per refresh below: dm_control's composer environment
        # swaps its physics wrapper AND the underlying MjModel/MjData on every
        # reset/step (verified: wrapper/model/data all change identity), so
        # only id INDICES are stable across steps — buffers never are.
        self._validate_model(physics.model._model)

    def _validate_model(self, m):
        """Fail closed if the flybody model layout changed (no silent stub)."""
        mujoco, np = self._mujoco, self._np
        names = bytes(m.names)

        def body_id(name):
            i = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, name)
            if i < 0:
                raise RuntimeError("EgocentricFieldSensor: body %r not found "
                                   "in the flybody model" % name)
            return i

        body_id("walker/thorax")
        body_id(self.TARGET_BODY)
        # Walker subtree geoms: names are prefixed per dm_control composer
        # namespacing (verified: 'walker/thorax', 'walker/claw_T1_left', ...).
        n = 0
        for i, a in enumerate(m.name_geomadr):
            if a > 0:
                nm = names[a:names.find(b"\x00", a)].decode()
                if nm.startswith(self.SELF_PREFIX):
                    n += 1
        if n < 10:
            raise RuntimeError(
                "EgocentricFieldSensor: only %d walker geoms found - the "
                "flybody model layout changed; refusing a silent stub" % n)

    @staticmethod
    def _sector_of(v):
        """Egocentric vector -> (azimuth-major) bin index.

        Azimuth quadrant: quadrant of atan2(v_y, v_x) about the thorax z-axis
        -> j in 0..3 (fwd, left, back, right). Hemifield: sign of v_z
        (above/below the thorax horizontal plane) -> i in {0, 1}.
        bins[j + 4*i] — azimuth-major, index-order-aligned with the chamber's
        `(u*4 | 0) + ((v*2 | 0) * 4)` convention (azimuth-major).
        """
        az = math.atan2(v[1], v[0])                    # (-pi, pi]
        if az < 0:
            az += 2 * math.pi                          # [0, 2*pi)
        j = min(3, int(az / (math.pi / 2)))
        i = 1 if v[2] >= 0 else 0
        return j + 4 * i

    @staticmethod
    def _dist_gain(r, scale):
        return min(1.0, r / scale)

    def _recompute(self, physics):
        """Read the CURRENT physics object (the composer swaps the wrapper and
        the raw MjModel/MjData on every reset/step — re-resolve per call)."""
        np = self._np
        mujoco = self._mujoco
        m = physics.model._model
        d = physics.data._data
        names = bytes(m.names)

        def body_id(name):
            i = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, name)
            if i < 0:
                raise RuntimeError("EgocentricFieldSensor: body %r not found "
                                   "in the flybody model" % name)
            return i

        thorax_id = body_id("walker/thorax")
        target_id = body_id(self.TARGET_BODY)
        geom_ids = [i for i, a in enumerate(m.name_geomadr)
                    if a > 0 and names[a:names.find(b"\x00", a)].decode()
                    .startswith(self.SELF_PREFIX)]
        n_points = float(len(geom_ids))
        bins = np.zeros(8, dtype=np.float64)
        R = np.array(d.xmat[thorax_id]).reshape(3, 3)
        pT = np.array(d.xpos[thorax_id])
        # SELF: dense geom cloud of the walker body, vectorized.
        X = d.geom_xpos[np.asarray(geom_ids, dtype=np.int32)]   # (N, 3) world
        V = (X - pT) @ R                               # (N, 3) thorax-egocentric
        az = np.arctan2(V[:, 1], V[:, 0])
        az = np.where(az < 0, az + 2 * np.pi, az)      # [0, 2*pi)
        j = np.minimum(3, (az / (np.pi / 2)).astype(np.int64))   # 4 azimuth quadrants
        i = (V[:, 2] >= 0).astype(np.int64)            # 2 hemifields (thorax plane)
        g = np.minimum(1.0, np.linalg.norm(V, axis=1) / self.SELF_RANGE)
        np.add.at(bins, j + 4 * i, g)
        bins = np.minimum(1.0, bins / n_points)        # mean-pooled, in [0,1]
        # TARGET: the ghost reference fly (the task's own visual object),
        # max-pooled so the target always registers at full strength.
        vg = R.T @ (np.array(d.xpos[target_id]) - pT)
        bg = self._sector_of(vg)
        bins[bg] = max(float(bins[bg]), self._dist_gain(float(np.linalg.norm(vg)),
                                                        self.TARGET_RANGE))
        return [float(x) for x in bins]

    def refresh(self, physics):
        """Recompute from the CURRENT physics state. Called exactly once per
        physics step by the driver (step/reset), so observation() between
        steps is free and identical (pure state function — C4 discipline)."""
        self._visual_cache = self._recompute(physics)
        return list(self._visual_cache)


class FlybodyDriver:
    """flybody/MuJoCo backend. Imports at construction; fails loudly with the
    exact missing-dependency report (never silently falls back to mock).

    Real visual feedback (FLYBODY_ARCHITECTURE.md §7): observation()[0:8] is
    the egocentric geometric occupancy field of the MuJoCo scene — the ghost
    target plus the walker's moving appendages in 8 egocentric sectors — a
    causal pure function of the post-step physics state, verified by
    closed-loop tests T-V1 and smoke T8. No GL dependency; deterministic.
    """

    mode = "flybody"

    def __init__(self, seed=0, task=None):
        _resolve_mujoco_gl()   # MUJOCO_GL decided BEFORE any mujoco import
        missing = []
        for mod in ("mujoco", "dm_control", "flybody"):
            try:
                __import__(mod)
            except Exception as e:  # noqa: BLE001
                missing.append("%s (%s)" % (mod, e))
        if missing:
            raise RuntimeError(
                "FlybodyDriver unavailable - install the embodiment stack:\n"
                "  python -m pip install mujoco dm_control\n"
                "  python -m pip install \"flybody @ git+https://github.com/TuragaLab/flybody.git\"\n"
                "missing: " + "; ".join(missing))
        try:
            from flybody.fly_envs import walk_imitation
            import numpy as np
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(
                "FlybodyDriver: flybody import failed (MUJOCO_GL=%r): %s"
                % (os.environ.get("MUJOCO_GL"), e)) from e
        # STAGE 5 task opt-in: the pillar must be part of the arena BEFORE the
        # MJCF compiles (bodies cannot be added post-compile), and
        # flybody.fly_envs.walk_imitation() builds its own arena internally —
        # so the task env replicates that construction with the extension
        # applied (verified against the installed flybody source; the only
        # difference from stock walk_imitation() is the extended arena).
        self.task_name = None
        self._pillar_sensor = None
        self._task_state = None
        if task == "pillar":
            self.env = self._build_walk_imitation_with_pillar()
            self.task_name = "pillar"
        elif task == "pillar_approach":
            self.env = self._build_walk_imitation_with_pillar(approach=True)
            self.task_name = "pillar_approach"
            # PHASE 3B horizon: replace the default 300-step synthetic ghost
            # snippet with a slow (0.5 cm/s), 800-step one BEFORE the first
            # reset so the reference walk does not outrun a standing fly
            # (termination fires at CoM distance > terminal_com_dist). With
            # terminal_com_dist widened in the task constructor, the 800-step
            # snippet sets a ~1599-step episode budget (>= 2x the 600-step
            # APPROACH_TIMEOUT_STEPS target).
            import numpy as _np
            from flybody.tasks.synthetic_trajectories import constant_speed_trajectory
            from flybody.tasks.constants import _WALK_CONTROL_TIMESTEP
            _qpos, _qvel = constant_speed_trajectory(
                n_steps=800, speed=0.5, init_pos=(0, 0, 0.1278),
                control_timestep=_WALK_CONTROL_TIMESTEP)
            self.env.task._traj_generator.set_next_trajectory(_qpos, _qvel)
        else:
            self.env = walk_imitation()
        # Hold a STRONG reference to the physics wrapper: composer envs swap
        # their internal physics object between reset/step, and transient
        # `env.physics` views are weakly held — keeping our own reference is
        # what keeps the raw MjModel/MjData buffers alive across steps.
        self._physics = self.env.physics
        spec = self.env.action_spec()
        shape = getattr(spec, "shape", None)
        if shape and shape[0] != ACTION_DIM:
            raise RuntimeError("flybody action dim %s != expected %d" % (shape, ACTION_DIM))
        # per-actuator physical bounds (NOT uniform [-1,1]): claws [0,1],
        # head twist [-3,3], asymmetric leg ranges, ... The decoder emits
        # model-agnostic [-1,1]; step() affine-maps into this space.
        self._lo = np.array(spec.minimum, dtype=np.float64)
        self._hi = np.array(spec.maximum, dtype=np.float64)
        # REQUIRED real visual sensor (fail closed — never a silent zero
        # visual). Geometric state-function sensor: no GL dependency; fails
        # only if the model lacks the expected anatomy (would be a flybody
        # version change that must be surfaced, not papered over).
        try:
            self._sensor = EgocentricFieldSensor(self._physics)
        except Exception as e:  # noqa: BLE001
            raise RuntimeError(
                "FlybodyDriver: real visual sensor unavailable - %s" % e) from e
        # STAGE 5: task sensor extension + episode task state (real mode only;
        # constructed AFTER the base sensor so model-layout failures surface
        # with the base error first)
        if self.task_name == "pillar":
            self._pillar_sensor = task_pillar.PillarSensor(self._physics)
            self._task_state = task_pillar.TaskState(mode="real")
        elif self.task_name == "pillar_approach":
            self._pillar_sensor = task_pillar.ApproachPillarSensor(self._physics)
            self._task_state = task_pillar.ApproachTaskState(mode="real")
        self.render_mode = os.environ.get("MUJOCO_GL", "disable")
        self._np = np
        self._visual_cache = self._sensor.refresh(self.env.physics)   # post-reset field

    def _build_walk_imitation_with_pillar(self, approach=False):
        """walk_imitation() inference-mode construction with the Stage 5 task
        pillar injected into the arena BEFORE first compile. Mirrors
        flybody.fly_envs.walk_imitation() defaults exactly (verified against
        the installed source); only the arena differs. The Phase 3B approach
        task builds a twitch-immovable landmark pillar (APPROACH_MASS)."""
        from dm_control import composer
        from dm_control.locomotion.arenas import floors
        from flybody.fruitfly import fruitfly
        from flybody.tasks.walk_imitation import WalkImitation
        from flybody.tasks.trajectory_loaders import InferenceWalkingTrajectoryLoader
        arena = floors.Floor(size=(8, 8))
        task_pillar.extend_arena_with_pillar(
            arena, mass=task_pillar.APPROACH_MASS if approach else None)
        traj_generator = InferenceWalkingTrajectoryLoader()
        time_limit = 10.0
        task = WalkImitation(walker=fruitfly.FruitFly, arena=arena,
                             traj_generator=traj_generator,
                             mocap_joint_names=traj_generator.get_joint_names(),
                             mocap_site_names=traj_generator.get_site_names(),
                             inference_mode=True,
                             force_actuators=False,
                             disable_wings=True,
                             joint_filter=0.01,
                             future_steps=64,
                             time_limit=time_limit,
                             terminal_com_dist=(3.0 if approach else 0.33))
        return composer.Environment(time_limit=time_limit, task=task,
                                    strip_singleton_obs_buffer_dim=True)

    def reset(self, seed=0):
        # walk_imitation resets deterministically to the reference start pose;
        # the seed is recorded by the sidecar for logging discipline.
        self._ts = self.env.reset()
        self._physics = self.env.physics   # re-bind after composer reset
        if self.task_name == "pillar_approach":
            # PHASE 3B: the approach task spawns the pillar at the documented
            # APPROACH_POS every reset (deterministic free-joint teleport —
            # the same mechanics as the debug `pillar_set_pose` tap, applied
            # at the reset boundary where no step reward can be attributed).
            task_pillar.set_pillar_pose(self.env.physics, *task_pillar.APPROACH_POS)
            self._physics = self.env.physics   # re-bind after the teleport
        self._visual_cache = self._sensor.refresh(self.env.physics)
        if self._task_state is not None:
            self._task_state.reset()       # task counters cleared; spawn dist
                                           # recorded on first reward call
        return self._state()

    def _root_idx(self):
        return 1  # body 0 = world; body 1 = 'walker/' root of the fly

    def _state(self):
        p = self.env.physics
        try:
            pos = p.named.data.xpos["walker/thorax"].tolist()
            quat = p.named.data.xquat["walker/thorax"].tolist()
        except KeyError:
            i = self._root_idx()
            pos = p.data.xpos[i].tolist()
            quat = p.data.xquat[i].tolist()
        return {"pos": pos, "quat": quat,
                "linvel": p.data.qvel[0:3].tolist(),
                "angvel": p.data.qvel[3:6].tolist(),
                "z": float(pos[2]),
                "joints": [round(float(x), 4) for x in p.data.qpos[7:13]]}

    def step(self, action, dt=DT_PHYS):
        np = self._np
        a = np.clip(np.asarray(action, dtype=np.float64), -1.0, 1.0)
        # ctrl-space convention: decoder 0 = model rest pose (position-actuator
        # targets of 0 = joint rest angles, claws un-adhered, head straight).
        # This matches flybody's own usage (README samples ~N(0,1) actions).
        # A mid-range affine map would command half-adhered claws at rest —
        # the smoke test's T1 exists precisely to catch that bug.
        a_model = np.clip(a, self._lo, self._hi)
        pre_step_count = getattr(self._ts, "step_type", None)
        self._ts = self.env.step(a_model)
        self._physics = self.env.physics   # re-bind after composer step
        if (self.task_name == "pillar_approach"
                and int(getattr(self._ts, "step_type", 0)) == 0
                and pre_step_count is not None and int(pre_step_count) != 0):
            # PHASE 3B boundary audit: dm_control SILENTLY auto-reset the env
            # (the underlying episode ended — snippet length). The pillar pose
            # snapped back to the MJCF build pose; re-apply the documented
            # APPROACH_POS spawn so the task scene stays as the protocol's
            # reset established it, and count the boundary (telemetry:
            # task.env_reset_seen) so metrics can flag boundary-crossing
            # phases honestly. No reward is attributed at this boundary —
            # the next task_reward call re-anchors distances as usual.
            task_pillar.set_pillar_pose(self.env.physics, *task_pillar.APPROACH_POS)
            self._physics = self.env.physics
            if self._task_state is not None:
                self._task_state.env_reset_seen += 1
        # Re-evaluate AFTER the physics step: the visual observation is a
        # function of the POST-step scene (contract C4 discipline).
        self._visual_cache = self._sensor.refresh(self.env.physics)
        return self._state()

    def observation(self):
        """REAL 8-bin visual (eye-camera render, post-step state) + 7 real
        proprio/contact channels from post-root joint velocities. The 8-bin
        grid matches the chamber's canonical `(u*4 | 0) + ((v*2 | 0) * 4)`
        azimuth-major convention so the connectome's `injectLayerChannels`
        semantics apply unchanged (no new coordinate system invented).
        Deterministic: same physics state -> same bins (repeat-render
        bit-identity verified by the closed-loop visual tests)."""
        np = self._np
        vis = np.asarray(self._visual_cache, dtype=np.float64)
        if self._pillar_sensor is not None:
            # STAGE 5: fold the task pillar into the 8-bin visual field
            # (max-pool, same egocentric sector semantics as the ghost —
            # obs[0:8] stays the visual field; OBS_DIM stays 15)
            vis = np.asarray(
                self._pillar_sensor.extend_visual(self.env.physics, vis.tolist()),
                dtype=np.float64)
        p = self.env.physics
        qv = np.abs(p.data.qvel[6:20])          # real joint velocities (post-root)
        proprio = np.tanh(qv * 5.0)
        contact = np.zeros(7)
        contact[:3] = proprio[:3]
        contact[3:] = proprio[3:7] if qv.size >= 7 else 0.0
        return np.concatenate([vis, contact]).tolist()

    def task_reward(self, prev_x):
        if self._task_state is not None:
            # STAGE 5 task reward: physical pillar displacement/contact only
            # (pure function of the post-step MuJoCo state + task counters)
            if self.task_name == "pillar_approach":
                # PHASE 3B: closure-based approach reward (pure function of
                # the post-step thorax->pillar distance; no commands, no RNG)
                return task_pillar.approach_reward(self.env.physics, self._task_state)
            return task_pillar.reward(prev_x, self.env.physics, self._task_state)
        x = float(self._state()["pos"][0])
        dx = x - prev_x
        return float(dx / 0.0005), {"phase": "walk_forward", "x": x,
                                    "event": "moved" if abs(dx) > 1e-9 else "stalled"}


# --------------------------------------------------------------------------- #
class RunLogger:
    """One JSONL record per physics step — the causal-evidence artifact
    (MOTOR_DECODER_SPEC §6)."""

    def __init__(self, path):
        self.path = path
        self.fh = None
        self.count = 0

    def open(self):
        d = os.path.dirname(self.path)
        if d:
            os.makedirs(d, exist_ok=True)
        self.fh = open(self.path, "a", encoding="utf-8")
        return self

    def step(self, rec):
        if self.fh:
            self.fh.write(json.dumps(rec, separators=(",", ":")) + "\n")
            self.count += 1
            if self.count % 200 == 0:
                self.fh.flush()

    def close(self):
        if self.fh:
            self.fh.flush()
            self.fh.close()
            self.fh = None


# --------------------------------------------------------------------------- #
class Sidecar:
    def __init__(self, body="auto", log_dir="embodiment/logs", pace="client",
                 transport="stdio"):
        self.body_mode_req = body
        self.pace_req = pace
        self.pace = "client" if transport == "stdio" else pace
        if self.pace != pace:
            self.pace_note = ("server pacing requires WebSocket transport; "
                              "stdio session is client-paced (PROTOCOL §8)")
        else:
            self.pace_note = None
        self.transport = transport
        self.log_dir = log_dir
        self.logger = None
        self.episode = -1
        self.seed = 0
        self.t_phys = 0
        self._last_neural_len = None   # first step command must re-declare
                                       # its neural vector dim (C1 contract)
        self.decoder = MotorDecoder(seed=0)
        self.body = None
        self.stats = {"dropped_in": 0, "auto_steps": 0, "overloaded": False,
                      "rtt_p50": None, "rtt_p95": None}
        self._last_seq = 0

    # ---------------- lifecycle ---------------- #
    def hello(self, msg):
        mode = self.body_mode_req
        self.dep_note = None
        # STAGE 5 task opt-in: "pillar" selects the physical-task scene
        # (flybody) or a documented physics-scaled PROXY on the mock driver
        # (no flybody dependency — lets CI exercise the task telemetry chain;
        # mode/task stamps always tell them apart). Unknown task names fail
        # closed.
        self.task_req = msg.get("task")
        if self.task_req not in (None, "pillar", "pillar_approach"):
            return {"type": "error", "code": "contract_violation",
                    "message": "unknown task %r (supported: 'pillar', 'pillar_approach', or omitted)"
                               % (self.task_req,)}
        if mode in ("auto", "flybody"):
            try:
                self.body = FlybodyDriver(seed=0, task=self.task_req)
                mode = "flybody"
            except RuntimeError as e:
                if self.body_mode_req == "flybody":
                    raise
                mode, self.dep_note = "mock_body", str(e).splitlines()[0]
                self.body = MockBodyDriver(seed=0)
        else:
            mode = "mock_body"
            self.body = MockBodyDriver(seed=0)
        # STAGE 5: mock driver + task opt-in => documented proxy task state
        if (self.body.mode == "mock_body" and self.task_req in ("pillar", "pillar_approach")
                and not hasattr(self.body, "_task_state")):
            if self.task_req == "pillar_approach":
                self.body._task_state = task_pillar.ApproachTaskState(mode="proxy")
            else:
                self.body._task_state = task_pillar.TaskState(mode="proxy")
        return {"type": "welcome", "v": PROTOCOL_VERSION,
                "mode": mode, "neural": "client",
                "assets": {"model": "fruitfly.xml", "ok": mode == "flybody",
                           "visual": self._visual_asset_report()},
                "capabilities": ["step", "reset", "log", "tap"],
                "dt_phys": DT_PHYS, "pace": self.pace,
                "dependency_note": self.dep_note, "pace_note": self.pace_note,
                "task": self.task_req}

    def _visual_asset_report(self):
        """Sensor provenance stamped into the welcome banner (additive; the
        wire schema gains one optional key, no version bump — consumers that
        ignore it keep working)."""
        body = self.body
        if getattr(body, "mode", None) == "flybody":
            return {"sensor": "egocentric_field_bins",
                    "frame": "walker/thorax (x fwd, y left, z up)",
                    "bins": "4x2 azimuth-major (fwd/left/back/right x below/above)",
                    "self_points": "all walker/* geom centers",
                    "target_body": EgocentricFieldSensor.TARGET_BODY,
                    "self_range_m": EgocentricFieldSensor.SELF_RANGE,
                    "target_range_m": EgocentricFieldSensor.TARGET_RANGE,
                    "render_mode": getattr(body, "render_mode", "disable")}
        return None

    def reset(self, msg):
        # Closed-loop discipline (state_contract.js): a declared seed is used
        # exactly as sent (no wall-clock default), so an episode is fully
        # determined by its command stream. A reset without a seed is a
        # protocol violation - interactive sessions always send one.
        if "seed" not in msg:
            return {"type": "error", "code": "contract_violation",
                    "message": "reset requires an explicit seed "
                               "(episodes must be replayable)"}
        seed = int(msg["seed"])
        self.seed = seed
        self.episode = int(msg.get("episode", self.episode + 1))
        if self.logger:
            self.logger.close()
        self.logger = RunLogger(os.path.join(
            self.log_dir, "run_%s_ep%d.jsonl"
            % (time.strftime("%Y%m%d_%H%M%S"), self.episode))).open()
        self.body.reset(seed)
        if getattr(self.body, "_task_state", None) is not None:
            self.body._task_state.reset()      # STAGE 5: per-episode task state
        self.decoder = MotorDecoder(seed=seed)
        self._last_neural_len = None
        self.t_phys = 0
        self.stats = {"dropped_in": 0, "auto_steps": 0, "overloaded": False,
                      "rtt_p50": None, "rtt_p95": None}
        return {"type": "reset_ack", "v": PROTOCOL_VERSION, "episode": self.episode,
                "seed_used": seed,
                "mode": self.body.mode,
                "obs0": self.body.observation(), "body0": self.body._state()}

    # ---------------- the causal step ---------------- #
    def step(self, msg):
        t0 = time.perf_counter()
        seq = int(msg.get("seq", 0))
        if seq and seq != self._last_seq + 1:
            self.stats["dropped_in"] += 1
        self._last_seq = seq

        # ---- fail-closed contract validation (embodiment/state_contract.js) --
        if msg.get("v", PROTOCOL_VERSION) != PROTOCOL_VERSION:
            return {"type": "error", "code": "contract_violation",
                    "message": "contract version %r != supported %d"
                               % (msg.get("v"), PROTOCOL_VERSION)}
        if int(msg.get("episode", -1)) != self.episode:
            return {"type": "error", "code": "stale_episode",
                    "message": "step.episode %r != current %d"
                               % (msg.get("episode"), self.episode)}
        t_n = int(msg.get("t_neural", self.t_phys))
        if t_n < self.t_phys:
            return {"type": "error", "code": "stale_time",
                    "message": "step.t_neural %d < already-processed %d" % (t_n, self.t_phys)}
        # C1: the canonical neural vector is REQUIRED. The legacy
        # last-value-hold fallback was a synthetic-substitution path and is
        # REMOVED from the production loop; smoke tests always send neural.
        neural = msg.get("neural")
        if not isinstance(neural, list) or not neural:
            return {"type": "error", "code": "missing_neural",
                    "message": "step.neural required (no synthetic fallback)"}
        if len(neural) > NEURAL_MAX_DIM:
            return {"type": "error", "code": "contract_violation",
                    "message": "step.neural length %d > NEURAL_MAX_DIM %d"
                               % (len(neural), NEURAL_MAX_DIM)}
        if any(not (isinstance(x, (int, float)) and math.isfinite(x)) for x in neural):
            return {"type": "error", "code": "contract_violation",
                    "message": "step.neural contains a non-finite value"}
        if self._last_neural_len is not None and len(neural) != self._last_neural_len:
            return {"type": "error", "code": "neural_dim_changed",
                    "message": "step.neural length %d != fixed dim %d"
                               % (len(neural), self._last_neural_len)}
        self._last_neural_len = len(neural)
        learn = float(msg.get("learn", 0.0))
        src = "auto" if msg.get("src") == "auto" else "client"
        if src == "auto":
            self.stats["auto_steps"] += 1

        prev_x = float(self.body._state()["pos"][0])
        u = self.decoder.readout(neural)             # edge 1-2: neural -> decoder
        a59 = self.decoder.actuator_map(u)           # edge 3: decoder -> action
        body = self.body.step(a59)                   # edge 4: action -> BODY
        if getattr(self.body, "_task_state", None) is not None:
            self.body._task_state.t = self.t_phys    # stamp BEFORE reward uses it
        if (getattr(self.body, "_task_state", None) is not None
                and getattr(self.body, "mode", None) == "mock_body"):
            # STAGE 5 proxy: mock body has no MuJoCo scene — the surrogate
            # body's planar displacement/distance stands in for the pillar
            # (labeled mode='proxy'; never embodiment evidence)
            if isinstance(self.body._task_state, task_pillar.ApproachTaskState):
                reward, task = task_pillar.approach_proxy_reward(self.body, self.body._task_state)
            else:
                reward, task = task_pillar.proxy_reward(self.body, self.body._task_state)
        else:
            reward, task = self.body.task_reward(prev_x)  # edge 5: env consequence
        obs_next = self.body.observation()           # edge 6: body -> sensors (incl. REAL visual)
        task["task"] = (self.body._task_state.snapshot()
                        if getattr(self.body, "_task_state", None) is not None
                        else None)
        task["learn_gate"] = learn
        task["sync"] = {"dropped_in": self.stats["dropped_in"],
                        "drift": self.t_phys - int(msg.get("t_neural", self.t_phys)),
                        "auto_steps": self.stats["auto_steps"],
                        "rtt_p50": self.stats["rtt_p50"],
                        "rtt_p95": self.stats["rtt_p95"]}
        self.t_phys += 1

        rec = {  # full causal chain — the evidence artifact
            "t": self.t_phys, "episode": self.episode, "seed": self.seed, "src": src,
            "neural_len": len(neural), "contract_v": PROTOCOL_VERSION,
            "motor": MotorDecoder.summarize_motor(neural),
            "decoder": self.decoder.describe(),
            "action": [round(float(x), 4) for x in a59],
            "body": body,
            "env": {"reward": round(reward, 6), "task_phase": task.get("phase"),
                    "event": task.get("event"), "done": False},
            "sensory": {"obs_next": [round(float(x), 4) for x in obs_next],
                        "delivered_to_brain": True},
            "task": task.get("task"),   # STAGE 5: task telemetry in the JSONL
            "timing": {"step_ms": round((time.perf_counter() - t0) * 1000, 3),
                       "rtt_ms": msg.get("rtt_ms")},
        }
        if self.logger:
            self.logger.step(rec)
        return {"type": "step_result", "v": PROTOCOL_VERSION, "episode": self.episode,
                "t_phys": self.t_phys, "mode": self.body.mode,
                "body": body, "action": rec["action"], "joints": body.get("joints"),
                "reward": rec["env"]["reward"], "task": task,
                "obs_next": rec["sensory"]["obs_next"],
                "latency_ms": rec["timing"]["step_ms"]}

    def handle(self, msg):
        mtype = msg.get("type")
        if mtype == "hello":
            return self.hello(msg)
        if mtype == "reset":
            return self.reset(msg)
        if mtype == "step":
            return self.step(msg)
        if mtype == "tap":
            # STAGE 5: deterministic test perturbation on the task scene —
            # teleports the pillar BETWEEN steps (controlled stimulus move for
            # the T1 causality test; never part of the closed loop itself).
            if msg.get("op") == "pillar_set_pose":
                if getattr(self.body, "_task_state", None) is None:
                    return {"type": "error", "code": "contract_violation",
                            "message": "pillar_set_pose requires the pillar task"}
                task_pillar.set_pillar_pose(self.body.env.physics,
                                            msg.get("x", 0.0), msg.get("y", 0.0))
                return {"type": "tap_state", "on": True,
                        "pillar_pos": task_pillar.pillar_state(self.body.env.physics)["pos"]}
            return {"type": "tap_state", "on": bool(msg.get("on", True))}
        if mtype == "bye":
            return {"type": "bye_ack"}
        return {"type": "error", "message": "unknown type %r" % mtype}


# --------------------------------------------------------------------------- #
def _serve_stdio(sc):
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        reply = None
        msg = None
        try:
            msg = json.loads(line)
            reply = sc.handle(msg)
        except Exception as e:  # noqa: BLE001
            reply = {"type": "error", "message": "%s: %s" % (type(e).__name__, e)}
        sys.stdout.write(json.dumps(reply, separators=(",", ":")) + "\n")
        sys.stdout.flush()
        if msg and msg.get("type") == "bye":
            break
    if sc.logger:
        sc.logger.close()


def _serve_ws(sc, port):
    import asyncio
    import websockets

    async def handler(ws, path=None):   # path arg for websockets < 11 compat
        try:
            async for line in ws:
                try:
                    reply = sc.handle(json.loads(line))
                except Exception as e:  # noqa: BLE001
                    reply = {"type": "error", "message": "%s: %s" % (type(e).__name__, e)}
                await ws.send(json.dumps(reply, separators=(",", ":")))
                if reply.get("type") == "bye_ack":
                    break
        except Exception:
            pass

    async def main():
        async with websockets.serve(handler, "127.0.0.1", port):
            await asyncio.Future()

    asyncio.run(main())


def main():
    ap = argparse.ArgumentParser(description="Fly embodiment sidecar")
    ap.add_argument("--body", choices=["auto", "flybody", "mock"], default="auto")
    ap.add_argument("--pace", choices=["client", "server"], default="client",
                    help="client = batch/CI (recommended); server = interactive "
                         "auto-step (WebSocket transport only)")
    ap.add_argument("--ws", action="store_true",
                    help="WebSocket mode (needs the optional 'websockets' package)")
    ap.add_argument("--port", type=int, default=8795)
    ap.add_argument("--log-dir", default="embodiment/logs")
    args = ap.parse_args()

    if args.ws:
        try:
            import websockets  # noqa: F401
        except ImportError:
            print(json.dumps({"type": "error",
                              "message": "--ws requires the optional 'websockets' "
                                         "package; use stdio mode (default) instead"}))
            sys.exit(2)

    sc = Sidecar(body=args.body, pace=args.pace, log_dir=args.log_dir,
                 transport="ws" if args.ws else "stdio")
    if args.ws:
        _serve_ws(sc, port=args.port)
    else:
        _serve_stdio(sc)


if __name__ == "__main__":
    main()
