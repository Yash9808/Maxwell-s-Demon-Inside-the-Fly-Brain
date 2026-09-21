# MOTOR DECODER SPEC — Stage 3

Author: Agent 4 (embodiment track) · Implements FLYBODY_ARCHITECTURE.md §3.
Implementation: `embodiment/motor_decoder.py` (reference, pure numpy).

---

## 1. Purpose and the one hard constraint

Map connectome motor-population activity → the flybody 59-dimensional action
vector, **without ever hiding the neural controller**. Concretely:

> The decoder may adapt its *readout* of neural activity; it may never replace,
> bypass, smooth over, or be fit against body performance in a way that feeds
> back into neural weights. Locomotion quality is NOT a decoder objective.
> There is no learning rule here that takes reward as input.

## 2. Signatures

```python
u     = decoder.readout(a_neural)      # a_neural: float[k] → u: float[16]
a59   = actuator_map(u)                # u: float[16] → flybody action, float[59]
```

- `k` = motor-layer population size (connectome's last layer; k ≈ hundreds).
  The decoder never hard-codes k; it takes the vector it is given.- `u` = 16 "motor intents": 6 leg groups × (stance/swing vigor) + wing L + wing R + abdomen + head (6·2+2+1+1 = 16). This is a *readout* granularity choice, small enough to inspect by eye in logs, big enough to drive all 59 actuators.

## 3. Readout (explicitly parameterized, permission-to-learn)

Per motor intent i over population a:

```
u[i] = σ( gain[i] · ( w̄[i]·a − b̄[i] ) + bias[i] )
```

- `w̄[i]`, `b̄[i]` — fixed random-projection readout vectors (one per intent,
  drawn once from seed, then **frozen**): the honest null decoder.
- `gain[i] ∈ [0.5, 4]`, `bias[i] ∈ [−0.5, 0.5]` — the ONLY learnable parameters.
- σ = logistic squashing to [0,1].
- **Learning rule (neural-statistics-only, no reward):** an online normalized
  LMS that tracks the *spread* of the neural drive so the decoder neither
  saturates nor idles:
  ```
  e = target_act[i] − u[i],  target_act = 0.5 + 0.35·tanh(moving_avg(a)−moving_mean(a))
  gain += η_gain · e · (w̄·a) ;   bias += η_bias · e ;  η ≈ 1e-3, clipped to bounds
  ```
  This adapts dynamic range to the population's actual firing statistics. It
  cannot manufacture locomotion skill: if the connectome's motor layer is
  silent or unstructured, `u` stays near its bias and the body barely moves —
  and that is the correct, honest result.

Forbidden (asserted in code, see `motor_decoder.py::_guardrails`):
- reward-correlated updates; fitting u or a59 against velocity/pose targets;
- time-varying w̄/b̄ (readout must stay inspectable); any path from body state
  back into decoder gains other than through the neural vector.

## 4. Actuator map u → 59 (fixed, documented, no learning)

flybody's 59-dim walking action space = position-control targets for leg joint
groups (per flybody's `walk_imitation` env). Mapping (indexed to the model's
actuator order at runtime; groups verified by name when flybody is available):

| u index | meaning | maps to |
|---|---|---|
| 0–5 | leg group vigor L1,R1,L2,R2,L3,R3 (stance) | symmetric flex/ext position targets about the group's neutral pose |
| 6–11 | same groups, swing phase | antagonistic targets |
| 12–13 | wing L / wing R | wing hinge position targets (flight/steering trim) |
| 14 | abdomen | abdomen pitch trim |
| 15 | head | head yaw/roll trim |

Implementation: per-group neutral pose offsets + sign/interp tables; stance and
swing rows are combined per leg by the gait phase φ (below) before hitting the
actuators. The map is a pure function, unit-tested to output within
`[-1, 1]^59` for any u ∈ [0,1]^16.

**Ctrl-space convention (verified against the real flybody model):** the
BodyDriver passes decoder output directly as MuJoCo position-actuator targets,
clipped to the model's per-actuator bounds (`action_spec.minimum/maximum` —
NOT a uniform [-1,1] range: claws are [0,1] adhere units, head twist [-3,3]).
Decoder 0 = model rest pose. A mid-range affine map was tested and **rejected**
by T1 of the smoke test: it commands half-adhered claws at rest, i.e. an
actively-driven fly for a silent brain — exactly the class of fake causality
this track exists to prevent.

Gait phase (fixed oscillator, not learned): `φ(t+1) = φ(t) + dt·(1.5 + 2.0·ū_tripod)`
— tripodal coupling (L1,R2,L3 vs R1,L2,R3) matches insect locomotion; the fly's
own vigor signal sets stride frequency, the oscillator supplies timing. This
keeps timing honest: the *neural* signal chooses how hard/fast, the fixed map
guarantees only anatomically-plausible coordination.

## 5. What "not hiding the controller" means operationally

1. `u` is a 16-vector a human can eyeball next to the motor-layer raster.
2. Every log line contains BOTH `a_neural` (or its hash + summary stats) AND `u`
   AND `a59` — the chain is reconstructible from the log alone.
3. No component between connectome and MuJoCo is trained on body outcomes.
4. Removing the decoder (direct `a_neural → a59` projection with same bounds)
   must still produce *some* body motion — asserted in the smoke test as the
   "no-decoder-bypass" probe (EMBODIMENT_SMOKE_TEST.md §4 T4).

## 6. Causal-chain logging (the evidence artifact)

One JSONL record per physics step (`embodiment/logs/run_<ts>_ep<e>.jsonl`):

```json
{
  "t": 4120, "episode": 7, "seed": 12345, "src": "client"|"auto",
  "motor":   {"k": 412, "mean": 0.113, "std": 0.041, "active": 87,
              "vec_hash": "blake2s-64:…", "vec": "[float64]:…"},
  "decoder": {"u": [16 floats], "gain": [...], "bias": [...], "learned_steps": 512},
  "action":  [59 floats],
  "body":    {"pos":[3], "quat":[4], "linvel":[3], "angvel":[3], "z":0.0042},
  "env":     {"reward": 0.0031, "task_phase": "approach", "event": "door_cross",
              "contact_forces_top": [...], "done": false},
  "sensory": {"obs_next": [15 floats], "delivered_to_brain": true},
  "timing":  {"step_ms": 1.42, "rtt_ms": 3.1}
}
```

`delivered_to_brain: true` is written only after the observation has actually
been sent back to the neural side — closing edge (6) of the causal contract.
Log rotation per episode; ~2 KB/step at k≈400 (vec downsampled to 64 + stats).

## 7. Failure modes & guards

| Failure | Guard |
|---|---|
| NaN in a_neural | replace with last-good, flag `decoder.input_nan`, do NOT step physics with NaN |
| u saturated (>95% of intents pinned for >1 s) | log `decoder.saturation`; gain auto-clamps toward 1 |
| a59 out of bounds | clamp + log `action.clamped` (bounds are flybody's contract) |
| decoder update divergence (gain hit rail repeatedly) | freeze gains for the episode, log `decoder.frozen` |
| silent zero-action (all |u| < 1e-4 while motor layer active) | logged as `decoder.inconsistent` — smoke test treats as failure |
