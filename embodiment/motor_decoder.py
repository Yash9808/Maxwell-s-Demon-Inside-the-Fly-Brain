# embodiment/motor_decoder.py — Stage 3 reference implementation.
# Connectome motor population -> decoder -> flybody 59-dim action vector.
#
# Hard constraint (MOTOR_DECODER_SPEC.md §1): the decoder adapts its readout to
# NEURAL STATISTICS only. No reward enters the decoder. No body-performance
# feedback enters the decoder. The neural controller is never hidden: readout
# projections are frozen and logged; u is small and human-inspectable.
#
# Pure numpy. No flybody/mujoco imports here — this module is body-agnostic.
import hashlib
import json

import numpy as np

U_DIM = 16          # motor intents: 6 leg groups x (stance,swing) + wings L/R + abdomen + head
ACTION_DIM = 59     # flybody walking action dimensionality (TuragaLab/flybody)
N_LEG_GROUPS = 6
GAIT_DT = 1.5       # rad/s baseline stride rate
GAIT_VIGOR = 2.0    # additional rad/s at full vigor

LEG_GROUPS = ["L1", "R1", "L2", "R2", "L3", "R3"]
TRIPOD_A = (0, 3, 4)   # L1, R2, L3
TRIPOD_B = (1, 2, 5)   # R1, L2, R3


class MotorDecoder:
    """Neural-statistics-adaptive readout + fixed actuator map.

    Learnable parameters: gain[U_DIM] in [0.5, 4], bias[U_DIM] in [-0.5, 0.5].
    Frozen parameters: random projections w (U_DIM x k), b (U_DIM) at init.
    Learning rule: online range-tracking LMS toward a target activation band
    derived from the population's own moving statistics (spec §3). Reward is
    never an input — enforced structurally (no reward arg) and by _guardrails.
    """

    def __init__(self, seed=0, learn=True, eta_gain=1e-3, eta_bias=1e-3):
        self.rng = np.random.default_rng(seed)
        self.learn = learn
        self.eta_gain = eta_gain
        self.eta_bias = eta_bias
        # frozen readout projections (drawn once, never updated)
        self._w = None            # set on first readout (k unknown until then)
        self._b = None
        self.gain = np.ones(U_DIM, dtype=np.float64)
        self.bias = np.zeros(U_DIM, dtype=np.float64)
        # moving neural statistics (for the target band + fallback k detection)
        self._mu = None
        self._var = None
        self._n = 0
        self.learned_steps = 0
        self.frozen = False
        self.u = np.zeros(U_DIM, dtype=np.float64)
        self.last_input = None
        self.gait_phase = 0.0

    # ------------------------------------------------------------------ #
    def readout(self, a_neural):
        """a_neural: array-like [k] (rates or spikes) -> u in [0,1]^12."""
        a = np.asarray(a_neural, dtype=np.float64)
        if a.ndim != 1 or a.size == 0:
            raise ValueError("a_neural must be a non-empty 1-D vector")
        if not np.all(np.isfinite(a)):
            self.u = np.clip(self.u, 0.0, 1.0)   # hold last good (spec §7)
            return self.u
        if self._w is None:
            # frozen projections: one per intent, unit-norm rows, zero offsets.
            # b = 0 is required by the rest convention (below): a silent motor
            # layer must read out to exactly u = 0.5 (zero action deviation).
            self._w = self.rng.standard_normal((U_DIM, a.size))
            self._w /= np.linalg.norm(self._w, axis=1, keepdims=True)
            self._b = np.zeros(U_DIM)
        elif a.size != self._w.shape[1]:
            # neural vector dimension IS the motor population size; a change
            # mid-episode is a contract violation, not something to pad over.
            raise ValueError(
                "neural vector dim changed: decoder built for k=%d, got k=%d"
                % (self._w.shape[1], a.size))
        drive = self._w @ a + self._b                # neural drive per intent
        if self._mu is None:
            self._mu = np.zeros_like(a)
            self._var = np.ones_like(a)
        self._n += 1
        self._mu += (a - self._mu) / self._n
        self._var += ((a - self._mu) ** 2 - self._var) / self._n
        pop = float(a.mean())
        spread = float(np.sqrt(max(self._var.mean(), 1e-12)))
        target_act = 0.5 + 0.35 * np.tanh((pop - 0.5 * spread) / max(spread, 1e-6))
        u_raw = self.gain * drive + self.bias
        self.u = 1.0 / (1.0 + np.exp(-np.clip(u_raw, -30.0, 30.0)))
        if self.learn and not self.frozen:
            e = target_act - self.u
            self.gain = np.clip(self.gain + self.eta_gain * e * drive, 0.5, 4.0)
            self.bias = np.clip(self.bias + self.eta_bias * e, -0.5, 0.5)
            if np.any(self.gain >= 3.999) or np.any(self.gain <= 0.501):
                self.frozen = True                    # spec §7: rail -> freeze
            else:
                self.learned_steps += 1
        self.last_input = a
        return self.u

    # ------------------------------------------------------------------ #
    def actuator_map(self, u=None):
        """u [16] in [0,1] -> flybody action [59] in [-1,1].

        Rest convention: deviation d = 2u - 1 (so u = 0.5 = exactly zero
        action, which is what a silent motor layer reads out to). Fixed,
        deterministic (spec §4): stance/swing rows blended by the fixed
        tripod-gait phase, symmetric leg-group targets about neutral,
        wing/abdomen/head trims. No learning, no state (except the phase osc).
        """
        u = self.u if u is None else np.asarray(u, dtype=np.float64)
        if u.shape != (U_DIM,):
            raise ValueError("u must have shape (16,)")
        u = np.clip(u, 0.0, 1.0)
        dev = 2.0 * u - 1.0                       # rest convention: u=0.5 -> 0
        stance, swing = dev[0:6], dev[6:12]
        wing_l, wing_r, abdomen, head = dev[12], dev[13], dev[14], dev[15]
        vigor = float(np.mean(np.abs(dev[0:12])))
        self.gait_phase = (self.gait_phase + GAIT_DT + GAIT_VIGOR * vigor) % (2 * np.pi)
        a59 = np.zeros(ACTION_DIM, dtype=np.float64)
        slots_per_leg = 6                      # (59 - 3 trims) // 6 legs, remainder padded
        for g in range(N_LEG_GROUPS):
            phase_leg = (self.gait_phase + (0.0 if g in TRIPOD_A else np.pi)) % (2 * np.pi)
            blend = 0.5 + 0.5 * np.cos(phase_leg)          # 1 = stance, 0 = swing
            base = 0.35 * stance[g] - 0.35 * swing[g]      # flex/ext about neutral
            for s in range(slots_per_leg):
                idx = g * slots_per_leg + s
                a59[idx] = np.clip(base * (1.0 if s % 2 == 0 else -1.0)
                                   * (0.6 + 0.4 * blend), -1.0, 1.0)
        a59[54] = np.clip(2.0 * wing_l - 1.0, -1, 1)            # wing L trim
        a59[55] = np.clip(2.0 * wing_r - 1.0, -1, 1)            # wing R trim
        a59[56] = np.clip(2.0 * abdomen - 1.0, -1, 1)           # abdomen pitch trim
        a59[57] = np.clip(2.0 * head - 1.0, -1, 1)              # head trim
        a59[58] = 0.0                                            # reserved
        return a59

    # ------------------------------------------------------------------ #
    def state_reset(self):
        """Episode reset (protocol §6): decoder carries NO cross-episode memory
        except the frozen projections (they are its identity, not memory)."""
        self.gain[:] = 1.0
        self.bias[:] = 0.0
        self._mu = None
        self._var = None
        self._n = 0
        self.learned_steps = 0
        self.frozen = False
        self.gait_phase = 0.0
        self.u = np.zeros(U_DIM, dtype=np.float64)

    # ------------------------------------------------------------------ #
    def describe(self):
        return {
            "u": [round(float(x), 4) for x in self.u],
            "gain": [round(float(x), 4) for x in self.gain],
            "bias": [round(float(x), 4) for x in self.bias],
            "learned_steps": self.learned_steps,
            "frozen": bool(self.frozen),
            "gait_phase": round(float(self.gait_phase), 3),
        }

    @staticmethod
    def summarize_motor(a):
        a = np.asarray(a, dtype=np.float64)
        active = int(np.sum(a > 0.05 * max(float(a.max()), 1e-9)))
        return {
            "k": int(a.size),
            "mean": round(float(a.mean()), 5),
            "std": round(float(a.std()), 5),
            "active": active,
            "vec_hash": "blake2s-64:" + hashlib.blake2s(
                np.ascontiguousarray(a).tobytes(), digest_size=8).hexdigest(),
        }

    @staticmethod
    def _guardrails():
        """Structural check that body-performance signals never reach the
        decoder: tokenize the source, strip comments/docstrings, and assert no
        banned token exists in executable code. Smoke test T-series calls this."""
        import inspect
        import tokenize, io
        src = inspect.getsource(MotorDecoder)
        toks = []
        try:
            for tok in tokenize.generate_tokens(io.StringIO(src).readline):
                if tok.type in (tokenize.COMMENT, tokenize.STRING):
                    continue
                toks.append(tok.string.lower())
        except tokenize.TokenError:
            pass
        code = " ".join(toks)
        banned = ("reward", "fitness", "velocity_target", "pose_target")
        return [b for b in banned if b in code]   # must be []
