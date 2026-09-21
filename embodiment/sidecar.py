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
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from motor_decoder import MotorDecoder, ACTION_DIM  # noqa: E402

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


class FlybodyDriver:
    """flybody/MuJoCo backend. Imports at construction; fails loudly with the
    exact missing-dependency report (never silently falls back to mock)."""

    mode = "flybody"

    def __init__(self, seed=0):
        os.environ.setdefault("MUJOCO_GL", "disable")   # headless-safe on Windows/CI
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
        from flybody.fly_envs import walk_imitation
        import numpy as np
        self.env = walk_imitation()
        spec = self.env.action_spec()
        shape = getattr(spec, "shape", None)
        if shape and shape[0] != ACTION_DIM:
            raise RuntimeError("flybody action dim %s != expected %d" % (shape, ACTION_DIM))
        # per-actuator physical bounds (NOT uniform [-1,1]): claws [0,1],
        # head twist [-3,3], asymmetric leg ranges, ... The decoder emits
        # model-agnostic [-1,1]; step() affine-maps into this space.
        self._lo = np.array(spec.minimum, dtype=np.float64)
        self._hi = np.array(spec.maximum, dtype=np.float64)

    def reset(self, seed=0):
        # walk_imitation resets deterministically to the reference start pose;
        # the seed is recorded by the sidecar for logging discipline.
        self._ts = self.env.reset()
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
        import numpy as np
        a = np.clip(np.asarray(action, dtype=np.float64), -1.0, 1.0)
        # ctrl-space convention: decoder 0 = model rest pose (position-actuator
        # targets of 0 = joint rest angles, claws un-adhered, head straight).
        # This matches flybody's own usage (README samples ~N(0,1) actions).
        # A mid-range affine map would command half-adhered claws at rest —
        # the smoke test's T1 exists precisely to catch that bug.
        a_model = np.clip(a, self._lo, self._hi)
        self._ts = self.env.step(a_model)
        return self._state()

    def observation(self):
        """8-bin visual placeholder (real ray sensors need scene cameras) +
        7 real proprio/contact channels from joint velocities. Visual upgrade
        is Stage 5 chamber work; the causal loop does not depend on it."""
        import numpy as np
        p = self.env.physics
        vis = np.zeros(8)
        qv = np.abs(p.data.qvel[6:20])          # real joint velocities (post-root)
        proprio = np.tanh(qv * 5.0)
        contact = np.zeros(7)
        contact[:3] = proprio[:3]
        contact[3:] = proprio[3:7] if qv.size >= 7 else 0.0
        return np.concatenate([vis, contact]).tolist()

    def task_reward(self, prev_x):
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
        self.last_neural = None
        self.decoder = MotorDecoder(seed=0)
        self.body = None
        self.stats = {"dropped_in": 0, "auto_steps": 0, "overloaded": False,
                      "rtt_p50": None, "rtt_p95": None}
        self._last_seq = 0

    # ---------------- lifecycle ---------------- #
    def hello(self, msg):
        mode = self.body_mode_req
        self.dep_note = None
        if mode in ("auto", "flybody"):
            try:
                self.body = FlybodyDriver(seed=0)
                mode = "flybody"
            except RuntimeError as e:
                if self.body_mode_req == "flybody":
                    raise
                mode, self.dep_note = "mock_body", str(e).splitlines()[0]
                self.body = MockBodyDriver(seed=0)
        else:
            mode = "mock_body"
            self.body = MockBodyDriver(seed=0)
        return {"type": "welcome", "v": PROTOCOL_VERSION,
                "mode": mode, "neural": "client",
                "assets": {"model": "fruitfly.xml", "ok": mode == "flybody"},
                "capabilities": ["step", "reset", "log", "tap"],
                "dt_phys": DT_PHYS, "pace": self.pace,
                "dependency_note": self.dep_note, "pace_note": self.pace_note}

    def reset(self, msg):
        seed = int(msg.get("seed", 0)) or int(time.time_ns() % 2**31)
        self.seed = seed
        self.episode = int(msg.get("episode", self.episode + 1))
        if self.logger:
            self.logger.close()
        self.logger = RunLogger(os.path.join(
            self.log_dir, "run_%s_ep%d.jsonl"
            % (time.strftime("%Y%m%d_%H%M%S"), self.episode))).open()
        self.body.reset(seed)
        self.decoder = MotorDecoder(seed=seed)
        self.t_phys = 0
        self.last_neural = None
        self.stats = {"dropped_in": 0, "auto_steps": 0, "overloaded": False,
                      "rtt_p50": None, "rtt_p95": None}
        return {"type": "reset_ack", "episode": self.episode, "seed_used": seed,
                "mode": self.body.mode,
                "obs0": self.body.observation(), "body0": self.body._state()}

    # ---------------- the causal step ---------------- #
    def step(self, msg):
        t0 = time.perf_counter()
        seq = int(msg.get("seq", 0))
        if seq and seq != self._last_seq + 1:
            self.stats["dropped_in"] += 1
        self._last_seq = seq

        neural = msg.get("neural")
        if not neural:
            neural = self.last_neural if self.last_neural is not None else [0.0]
        self.last_neural = neural
        learn = float(msg.get("learn", 0.0))
        src = "auto" if msg.get("src") == "auto" else "client"
        if src == "auto":
            self.stats["auto_steps"] += 1

        prev_x = float(self.body._state()["pos"][0])
        u = self.decoder.readout(neural)             # edge 1-2: neural -> decoder
        a59 = self.decoder.actuator_map(u)           # edge 3: decoder -> action
        body = self.body.step(a59)                   # edge 4: action -> BODY
        reward, task = self.body.task_reward(prev_x)  # edge 5: env consequence
        obs_next = self.body.observation()           # edge 6: body -> sensors
        task["learn_gate"] = learn
        task["sync"] = {"dropped_in": self.stats["dropped_in"],
                        "drift": self.t_phys - int(msg.get("t_neural", self.t_phys)),
                        "auto_steps": self.stats["auto_steps"],
                        "rtt_p50": self.stats["rtt_p50"],
                        "rtt_p95": self.stats["rtt_p95"]}
        self.t_phys += 1

        rec = {  # full causal chain — the evidence artifact
            "t": self.t_phys, "episode": self.episode, "seed": self.seed, "src": src,
            "motor": MotorDecoder.summarize_motor(neural),
            "decoder": self.decoder.describe(),
            "action": [round(float(x), 4) for x in a59],
            "body": body,
            "env": {"reward": round(reward, 6), "task_phase": task.get("phase"),
                    "event": task.get("event"), "done": False},
            "sensory": {"obs_next": [round(float(x), 4) for x in obs_next],
                        "delivered_to_brain": True},
            "timing": {"step_ms": round((time.perf_counter() - t0) * 1000, 3),
                       "rtt_ms": msg.get("rtt_ms")},
        }
        if self.logger:
            self.logger.step(rec)
        return {"type": "step_result", "t_phys": self.t_phys, "mode": self.body.mode,
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
        _serve_ws(sc, args.port)
    else:
        _serve_stdio(sc)


if __name__ == "__main__":
    main()
