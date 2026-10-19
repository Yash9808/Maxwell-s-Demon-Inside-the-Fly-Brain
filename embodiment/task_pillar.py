#!/usr/bin/env python3
# embodiment/task_pillar.py — STAGE 5: the first physical task object
# (AGENT TASK Stage 5 §3–§5). One controllable environmental object, one
# measurable consequence, one sensory feedback path, one reward condition.
#
#   the PILLAR ("target_pillar")
#     a light free (6-DoF) box standing on the inference-mode walk_imitation
#     drift path (−x). Measured Stage 5 probe facts (MuJoCo 3.13, flybody
#     head, MUJOCO_GL=disable, seed/decoder fixed):
#       * the untrained-decoder fly drifts: silent decoder output sweeps the
#         thorax ~−0.126 m in 300 steps; driven intents (abd_up) hold ~−0.003
#         m — neural output gates the sweep;
#       * an 8 cm tall pillar (spans y −0.045..0.035 at x=−0.030) is in
#         contact with walker geoms 300/300 steps under silent drive and is
#         DISPLACED −0.067 m by the fly's body; the driven condition holds it
#         at ~4 mm — the interaction is real MuJoCo contact physics;
#       * the ghost (contype=0, mocap-driven) cannot collide with anything —
#         only the fly can move the pillar.
#
# Everything here is ADDITIVE: no flybody file is modified. The arena is the
# stock dm_control floors.Floor extended via its MJCF root BEFORE first
# compile (bodies may not be added after the model compiles). The task
# opt-in is carried on the sidecar `hello` message; the wire contract
# (state_contract.js v1) is unchanged — OBS_DIM stays 15 (the task sensor
# extends the 8-bin VISUAL field in place: the pillar joins the ghost in
# the same egocentric occupancy semantics documented in sidecar.py §7).
#
# Reward (AGENT TASK §6): physical, task-defined, and only TRANSPORTED by
# the sidecar — the reward→dopamine mapping stays exclusively in
# connectomeController.receiveFeedback. The MotorDecoder stays reward-blind
# (its own _guardrails enforce this structurally).
#
# Determinism (AGENT TASK §14): the whole scene is deterministic — the
# flybody reset is deterministic in inference mode, the pillar has a fixed
# build-time pose, and no RNG participates anywhere in this module.
import math

import numpy as np

# --- fixed task constants (documented, deterministic) -----------------------
PILLAR_BODY = "target_pillar"
PILLAR_GEOM = "target_pillar_geom"
PILLAR_JOINT = "target_pillar_free"
PILLAR_POS = [-0.030, -0.005, 0.040]     # on the measured −x drift path
PILLAR_HALF = [0.012, 0.040, 0.040]      # 8 cm tall, spans y −0.045..0.035
PILLAR_MASS = 1e-4                       # kg — pushable by the fly's sweep

SUCCESS_PILLAR_DISP = 0.005              # m — task success: |planar displacement| ≥ 5 mm
REWARD_DISP_SCALE = 0.0005               # m per unit reward (dense shaping)
REWARD_TOUCH = 0.25                      # one-time bonus per contact episode

THORAX_BODY = "walker/thorax"

# --- PHASE 3B: separated-spawn APPROACH task (additive; legacy "pillar"
# task constants and behavior above are unchanged) ---------------------------
# Measured design facts (MuJoCo 3.13, flybody head, silent-decoder probes,
# Phase 3B): the scaled fly's leg-sweep envelope is ~0.215 m planar (T3
# tarsal claws), so a pushable pillar within that radius can be brushed
# WITHOUT approach — the Phase 3 contact-spawn ceiling. The approach task
# therefore spawns the pillar OUTSIDE the envelope, off the −x drift line
# (drift-immune by geometry: silent passive drift runs along −x at y≈0 and
# never reaches the bin-2 quadrant), so every unit of reward requires
# genuinely closing fly→pillar distance.
APPROACH_POS = [-0.060, -0.060]      # pillar center at reset (bin 2, ~85 mm gap)
APPROACH_REWARD_SCALE = 0.0005       # m of distance closure per unit reward
APPROACH_ARRIVAL_DIST = 0.010        # m: arrival = thorax within 10 mm of pillar center
                                     # (past the ~45 mm face-touch radius: a real approach)
APPROACH_ARRIVAL_BONUS = 1.0         # one-time event bonus on first arrival
APPROACH_TIMEOUT_STEPS = 600         # 1.2 s at the 2 ms control step (reported, not enforced)


def extend_arena_with_pillar(arena, mass=None):
    """Add the task pillar to a NOT-YET-COMPILED floors.Floor arena.

    Must run before the first env reset (MJCF compiles lazily). Returns the
    MJCF body element. Fixed pose/mass — no RNG (AGENT TASK §14).
    `mass` defaults to the legacy push-pillar mass; the Phase 3B approach
    task passes APPROACH_MASS (twitch-immovable landmark).
    """
    a = arena._mjcf_root
    a.worldbody.add("body", name=PILLAR_BODY, pos=list(PILLAR_POS))
    b = a.worldbody.find("body", PILLAR_BODY)
    b.add("freejoint", name=PILLAR_JOINT)
    b.add("geom", name=PILLAR_GEOM, type="box", size=list(PILLAR_HALF),
          pos=[0, 0, 0], rgba=[0.2, 0.9, 0.3, 1],
          contype=1, conaffinity=1,          # collides with walker collision
                                             # geoms (contype=1), NEVER with
                                             # the ghost (contype=0)
          friction=[1.0, 0.005, 0.0001], mass=PILLAR_MASS if mass is None else mass)
    return b


def pillar_state(physics):
    """World pose of the pillar from the CURRENT physics (post-step)."""
    bid = physics.model.body(PILLAR_BODY).id
    return {
        "pos": [float(x) for x in physics.data.xpos[bid]],
        "quat": [float(x) for x in physics.data.xquat[bid]],
    }


def set_pillar_pose(physics, x, y, z=None):
    """DEBUG/TEST ONLY on the legacy task; ALSO the Phase 3B approach reset
    spawn mechanic (applied by the driver at the reset boundary, where no
    step reward can be attributed). Deterministically teleport the pillar
    to (x, y[, z]) between steps. This is the controlled T1 stimulus
    perturbation — an experimenter move, NEVER part of the closed loop
    (AGENT TASK §5: the fly never moves the target 'because it decided to';
    telemetry stamps the step boundary where a perturbation happened via
    the tap reply)."""
    import mujoco
    m, d = physics.model._model, physics.data._data
    jid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, PILLAR_JOINT)
    if jid < 0:
        raise RuntimeError("task_pillar: joint %r not found" % PILLAR_JOINT)
    adr = int(m.jnt_qposadr[jid])
    d.qpos[adr + 0] = float(x)
    d.qpos[adr + 1] = float(y)
    d.qpos[adr + 2] = PILLAR_POS[2] if z is None else float(z)
    d.qpos[adr + 3] = 1.0   # identity quaternion (w x y z)
    d.qpos[adr + 4] = 0.0
    d.qpos[adr + 5] = 0.0
    d.qpos[adr + 6] = 0.0
    mujoco.mj_forward(m, d)


def pillar_contact_steps(physics):
    """1 if any walker geom touches the pillar in the CURRENT physics state,
    else 0 (counted per step by the driver; the ghost cannot collide)."""
    m, d = physics.model, physics.data
    gid = m.geom(PILLAR_GEOM).id
    for i in range(d.ncon):
        c = d.contact[i]
        if c.geom1 == gid or c.geom2 == gid:
            other = c.geom2 if c.geom1 == gid else c.geom1
            nm = m.id2name(int(other), "geom") or "?"
            if nm.startswith("walker/"):
                return 1
    return 0


class TaskState:
    """Episode-mutable task state (positions, contact, success latch).

    Owns NOTHING neural: reward is a pure function of physical state
    transitions, computed by reward() below. No RNG anywhere.
    """

    def __init__(self, mode=None):
        # mode is STICKY driver provenance ("real" | "proxy"), set at
        # construction — NOT episode state; reset() must not clear it.
        self.mode = mode
        self.reset()

    def reset(self):
        self.t = 0
        self.pillar_pos0 = None            # build/reset pose (world)
        self.pillar_pos = None             # latest world pos
        self._prev_pos = None              # last step's pos (dense-reward delta;
                                           # MUST clear per episode — a stale value
                                           # from the previous episode would earn a
                                           # phantom first-step reward for motion the
                                           # fly did not cause in THIS episode)
        self.first_contact_step = None
        self.contact_steps = 0
        self.touch_bonus_given = False
        self.success = False               # latched
        self.success_step = None

    def snapshot(self):
        """Deterministic telemetry dict (AGENT TASK §12: task/environment
        state must be auditable)."""
        disp = None
        if self.pillar_pos0 is not None and self.pillar_pos is not None:
            disp = [round(a - b, 6) for a, b in zip(self.pillar_pos, self.pillar_pos0)]
            disp_norm = round(math.sqrt(sum(x * x for x in disp)), 6)
        else:
            disp_norm = 0.0
        return {
            "name": "pillar",
            "mode": self.mode,
            "pillar_pos0": self.pillar_pos0,
            "pillar_pos": self.pillar_pos,
            "pillar_disp": disp,
            "pillar_disp_norm": disp_norm,
            "first_contact_step": self.first_contact_step,
            "contact_steps": self.contact_steps,
            "success": self.success,
            "success_step": self.success_step,
        }


def reward(_prev_x, physics, task):
    """Physical reward for one step transition (pure function of MuJoCo
    state + accumulated task counters; no neural input, no RNG).

      dense: +|Δpillar_xy| / REWARD_DISP_SCALE   (moving the pillar matters,
             planar: the z term is dominated by initial settling)
      event: +REWARD_TOUCH once, on the first walker-pillar contact step
      success: task.success latches at |pillar_xy_disp| ≥ threshold; the
             dense term keeps the episode moving toward/holding displacement.

    Returns (reward_float, {"phase": "pillar", "event": ...}) — the same
    (reward, task-dict) shape as the legacy task_reward paths. The success
    threshold is POLICY — the physical displacement itself is measured
    independently in telemetry (pillar_disp_norm, never gated).
    """
    st = pillar_state(physics)
    task.pillar_pos = st["pos"]
    if task.pillar_pos0 is None:
        task.pillar_pos0 = list(st["pos"])

    touched = pillar_contact_steps(physics)
    if touched:
        task.contact_steps += 1
        if task.first_contact_step is None:
            task.first_contact_step = task.t

    # planar displacement (settling of the freejoint in z is not the task)
    dx = task.pillar_pos[0] - task.pillar_pos0[0]
    dy = task.pillar_pos[1] - task.pillar_pos0[1]
    disp_xy = math.sqrt(dx * dx + dy * dy)

    if not task.success and disp_xy >= SUCCESS_PILLAR_DISP:
        task.success = True
        task.success_step = task.t

    # dense term uses the DELTA over this step (real-time shaping signal):
    if getattr(task, "_prev_pos", None) is not None:
        ddx = task.pillar_pos[0] - task._prev_pos[0]
        ddy = task.pillar_pos[1] - task._prev_pos[1]
        r = math.sqrt(ddx * ddx + ddy * ddy) / REWARD_DISP_SCALE
    else:
        r = 0.0
    task._prev_pos = list(task.pillar_pos)

    event = "moved" if r > 0 else "stalled"
    if touched and not task.touch_bonus_given:
        # one-time bonus, latched STRUCTURALLY (not via task.t equality, which
        # silently re-fires for any caller that does not stamp task.t per call
        # — found by the Phase 3 leakage/identity tests)
        task.touch_bonus_given = True
        r += REWARD_TOUCH
        event = "first_contact"
    if task.success:
        event = event + "+success" if event != "success" else "success"
    return float(r), {"phase": "pillar", "event": event}


def proxy_reward(body, task):
    """Mock-mode PROXY reward (mode='proxy' in every snapshot — interface
    validation only, never embodiment evidence, mirroring MockBodyDriver's
    own honest-labeling rule): the surrogate body's planar displacement IS
    the pillar displacement, and there are no contacts. Lets CI exercise the
    task telemetry/reward chain without the flybody dependency. Deterministic.
    """
    if task.pillar_pos0 is None:
        task.pillar_pos0 = list(PILLAR_POS)
    task.pillar_pos = [PILLAR_POS[0] + float(body.pos[0]),
                       PILLAR_POS[1] + float(body.pos[1]),
                       PILLAR_POS[2]]
    dx = task.pillar_pos[0] - task.pillar_pos0[0]
    dy = task.pillar_pos[1] - task.pillar_pos0[1]
    if not task.success and math.sqrt(dx * dx + dy * dy) >= SUCCESS_PILLAR_DISP:
        task.success = True
        task.success_step = task.t
    if getattr(task, "_prev_pos", None) is not None:
        ddx = task.pillar_pos[0] - task._prev_pos[0]
        ddy = task.pillar_pos[1] - task._prev_pos[1]
        r = math.sqrt(ddx * ddx + ddy * ddy) / REWARD_DISP_SCALE
    else:
        r = 0.0
    task._prev_pos = list(task.pillar_pos)
    return float(r), {"phase": "pillar", "event": "moved" if r > 0 else "stalled"}



# ===========================================================================
# PHASE 3B: separated-spawn APPROACH task (additive; the legacy "pillar"
# task above is untouched — same object, new spawn + reward semantics).
# ===========================================================================
# Measured design facts (silent-decoder probes, Phase 3B): the scaled fly's
# leg-sweep envelope is ~0.215 m planar (T3 tarsal claws), so a pushable
# pillar inside that radius can be brushed WITHOUT approaching it — the
# Phase 3 contact-spawn ceiling. The approach task spawns the pillar
# OUTSIDE the leg envelope and OFF the -x drift line (silent passive drift
# runs along -x at y~=0 and never reaches the bin-2 quadrant), and the
# reward is CLOSURE-based (approach progress toward the pillar), so no
# reward is earnable without genuinely reducing fly->pillar distance.
APPROACH_POS = [-0.105, -0.060]      # pillar center at reset (bin 2; spawn gap
                                     # ~0.121 m, bearing ~-150° = the fly's measured
                                     # reachable locomotion cone, OFF the -x drift line)
APPROACH_MASS = 1.0                  # kg (~750x fly mass): twitch-immovable
                                     # landmark. Measured: silent/random drive leaves
                                     # it exactly at the spawn pose (closure must
                                     # come from real fly locomotion)
APPROACH_SPAWN_DIST_MIN = 0.100      # m: reset-time headroom gate (enforced)
APPROACH_ARRIVAL_DIST = 0.050        # m: arrival = thorax within 50 mm of pillar
                                     # center. Calibrated (700-step probes, fresh
                                     # envs): the UNTRAINED floor across silent/random/
                                     # directed drives is 54-81 mm — nothing arrives
                                     # untrained; ~10% faster closure reaches it. This
                                     # is the honest learning gradient, not a ceiling.
APPROACH_ARRIVAL_BONUS = 1.0         # one-time event bonus on first arrival
APPROACH_TIMEOUT_STEPS = 600         # 1.2 s at 2 ms control step; protocol phases
                                     # must stay under the env's own auto-reset
                                     # boundary (snippet 800 - future_steps 64 - 1
                                     # = 735 steps), where dm_control silently resets
                                     # and the driver re-applies the spawn pose


def approach_spawn_dist(physics):
    """Planar thorax->pillar distance at the CURRENT physics (reset time or
    any time). Pure state function."""
    import mujoco
    m, d = physics.model._model, physics.data._data
    tid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, PILLAR_BODY)
    thid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, THORAX_BODY)
    a = d.xpos[tid]; b = d.xpos[thid]
    return math.hypot(float(a[0]) - float(b[0]), float(a[1]) - float(b[1]))


class ApproachTaskState:
    """Episode-mutable approach task state (owns NOTHING neural; no RNG:
    the spawn pose is the documented APPROACH_POS constant)."""

    def __init__(self, mode=None):
        self.mode = mode
        self.reset()

    def reset(self):
        self.t = 0
        self.spawn_dist = None        # thorax->pillar planar gap at reset
        self.dist = None              # latest thorax->pillar planar gap
        self.min_dist = None          # best closure this episode
        self.cum_closure = 0.0        # sum of positive per-step closures (telemetry)
        self.first_arrival_step = None
        self.arrival_steps = 0
        self.success = False          # latched at first arrival
        self.success_step = None
        # PHASE 3B boundary audit: dm_control auto-resets the env SILENTLY
        # when the underlying episode ends (snippet length); the spawn pose
        # would snap back to the MJCF build pose with no protocol-visible
        # reset. The driver counts these via env_reset_seen so metrics can
        # exclude or flag boundary-crossing episodes honestly.
        self.env_reset_seen = 0

    def snapshot(self):
        return {
            "name": "pillar_approach",
            "mode": self.mode,
            "spawn_dist": None if self.spawn_dist is None else round(self.spawn_dist, 6),
            "dist": None if self.dist is None else round(self.dist, 6),
            "min_dist": None if self.min_dist is None else round(self.min_dist, 6),
            "cum_closure": round(self.cum_closure, 6),
            "first_arrival_step": self.first_arrival_step,
            "arrival_steps": self.arrival_steps,
            "success": self.success,
            "success_step": self.success_step,
            "env_reset_seen": self.env_reset_seen,
        }


def approach_reward(physics, task):
    """Physical reward for one approach step (pure function of post-step
    MuJoCo state + task counters; no neural input, no RNG, no commands).

        dense:  +(dist_prev - dist_now) / APPROACH_REWARD_SCALE
                (only CLOSING the gap pays; receding pays 0 — the task has
                no penalty term, matching the legacy task's reward sign)
        event:  +APPROACH_ARRIVAL_BONUS once, first time the thorax comes
                within APPROACH_ARRIVAL_DIST of the pillar center
        success: latched at first arrival.

    Returns (reward_float, {"phase": "pillar_approach", "event": ...}) —
    the same (reward, task-dict) shape as the legacy task_reward paths.
    """
    import mujoco
    m, d = physics.model._model, physics.data._data
    tid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, PILLAR_BODY)
    thid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, THORAX_BODY)
    a = d.xpos[tid]; b = d.xpos[thid]
    dist = math.hypot(float(a[0]) - float(b[0]), float(a[1]) - float(b[1]))
    task.dist = dist
    if task.spawn_dist is None:
        task.spawn_dist = dist
        task.min_dist = dist
    event = "receded" if task.dist is not None and dist > task.min_dist else "closed"
    r = 0.0
    if dist < task.min_dist:
        r = (task.min_dist - dist) / APPROACH_REWARD_SCALE
        task.cum_closure += (task.min_dist - dist)
        task.min_dist = dist
    if (not task.success) and dist <= APPROACH_ARRIVAL_DIST:
        task.success = True
        task.success_step = task.t
        if task.first_arrival_step is None:
            task.first_arrival_step = task.t
        task.arrival_steps += 1
        r += APPROACH_ARRIVAL_BONUS
        event = "arrival"
    elif task.success and dist <= APPROACH_ARRIVAL_DIST:
        task.arrival_steps += 1
        event = "arrival_hold"
    return float(r), {"phase": "pillar_approach", "event": event}


def approach_proxy_reward(body, task):
    """Mock-mode PROXY (mode='proxy'): the surrogate body's planar distance
    to the approach pose IS the fly->pillar distance. Interface validation
    only — never embodiment evidence (same honest-labeling rule as the
    legacy proxy). Deterministic."""
    if task.spawn_dist is None:
        bx, by = float(body.pos[0]), float(body.pos[1])
        task.spawn_dist = math.hypot(APPROACH_POS[0] - bx, APPROACH_POS[1] - by)
        task.min_dist = task.spawn_dist
        task.dist = task.spawn_dist
    bx, by = float(body.pos[0]), float(body.pos[1])
    dist = math.hypot(APPROACH_POS[0] - bx, APPROACH_POS[1] - by)
    task.dist = dist
    r = 0.0
    if dist < task.min_dist:
        r = (task.min_dist - dist) / APPROACH_REWARD_SCALE
        task.cum_closure += (task.min_dist - dist)
        task.min_dist = dist
    event = "receded" if dist > task.min_dist else "closed"
    if (not task.success) and dist <= APPROACH_ARRIVAL_DIST:
        task.success = True
        task.success_step = task.t
        if task.first_arrival_step is None:
            task.first_arrival_step = task.t
        task.arrival_steps += 1
        r += APPROACH_ARRIVAL_BONUS
        event = "arrival"
    elif task.success and dist <= APPROACH_ARRIVAL_DIST:
        task.arrival_steps += 1
        event = "arrival_hold"
    return float(r), {"phase": "pillar_approach", "event": event}


class PillarSensor:
    """Extends the sidecar's real 8-bin visual sensor with the pillar.

    Same egocentric sector semantics as sidecar.EgocentricFieldSensor
    (thorax frame, 4 azimuth x 2 elevation, azimuth-major index j+4*i), with
    the pillar MAX-pooled into the bins exactly like the ghost target: the
    pillar is the task's visual object, and its bin + gain move as the FLY
    (observer) and the PILLAR (observed) move relative to each other. Pure
    state function — deterministic on recomputation (AGENT TASK §14).
    """

    PILLAR_RANGE = 0.05   # m — same scale as the ghost target gain

    def __init__(self, physics):
        import mujoco
        self._mujoco = mujoco
        m = physics.model._model
        bid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, PILLAR_BODY)
        if bid < 0:
            raise RuntimeError("task_pillar: %r not found in the model" % PILLAR_BODY)

    def pillar_bin(self, physics):
        """(bin_index, gain, egocentric_vector) for the pillar from the
        thorax frame of the CURRENT physics."""
        mujoco = self._mujoco
        m, d = physics.model._model, physics.data._data
        tid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, PILLAR_BODY)
        thid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, THORAX_BODY)
        R = np.array(d.xmat[thid]).reshape(3, 3)
        pT = np.array(d.xpos[thid])
        vg = R.T @ (np.array(d.xpos[tid]) - pT)   # egocentric (x fwd, y left, z up)
        az = math.atan2(vg[1], vg[0])
        if az < 0:
            az += 2 * math.pi
        j = min(3, int(az / (math.pi / 2)))
        i = 1 if vg[2] >= 0 else 0
        gain = min(1.0, float(np.linalg.norm(vg)) / self.PILLAR_RANGE)
        return j + 4 * i, gain, vg

    def extend_visual(self, physics, visual8):
        """Fold the pillar into the 8-bin visual field (max-pool, in place
        semantics: returns a NEW list — never mutates the driver's cache)."""
        bg, gain, _ = self.pillar_bin(physics)
        out = list(visual8)
        out[bg] = max(float(out[bg]), gain)
        return out


class ApproachPillarSensor(PillarSensor):
    """Same 8-bin semantics as the legacy PillarSensor (the pillar folds
    into the shared visual field identically); exists so the approach task
    can stamp its own identity in telemetry and to keep the two tasks'
    sensor lifecycles independent. The spawn pose (outside the leg envelope,
    off the drift line) — not the sensor — is what changes task semantics."""

    def __init__(self, physics):
        super().__init__(physics)
