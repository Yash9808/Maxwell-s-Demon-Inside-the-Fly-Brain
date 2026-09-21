# FLYBODY ARCHITECTURE — Stage 2

Author: Agent 4 (embodiment track) · Companion to FLYBODY_INTEGRATION_AUDIT.md
Status: **design implemented for the parts runnable today** (sidecar, decoder,
protocol, harness). The flybody/MuJoCo leg activates automatically when the
dependencies land (see EMBODIMENT_SMOKE_TEST.md §6).

---

## 1. Process topology

```
┌─────────────────────────────┐
│ BROWSER (existing, untouched)│
│  fly_demon_3d.html           │
│   ├ brain_worker.js          │   neural controller (connectome, plasticity)
│   ├ experiment_worker.js     │   existing benchmark (REGRESSION HARNESS)
│   └ EmbodimentPanel (opt-in) │   ← future, additive UI only
└──────────┬──────────────────┘
           │  WebSocket (JSON lines) — FLYBODY_PROTOCOL.md
           │  60 Hz control loop, decoupled from rAF
┌──────────▼──────────────────┐
│ PYTHON SIDECAR               │
│  embodiment/sidecar.py       │
│   ├ NeuralTap feed           │   motor population → decoder input
│   ├ MotorDecoder             │   (MOTOR_DECODER_SPEC.md)
│   ├ BodyDriver               │   flybody/MuJoCo  OR  MOCK_BODY
│   ├ SensorBinder             │   body state → observation vector
│   └ RunLogger                │   full causal-chain log (JSONL)
└──────────┬──────────────────┘
           │ dm_control env.step(action_59)
┌──────────▼──────────────────┐
│ FLYBODY / MuJoCo             │
│  fruitfly.xml physics        │
│  physical body + environment │
└─────────────────────────────┘
```

Design rules:

1. **The browser is never the simulator.** It is (a) the neural controller host
   and (b) a *viewer* of sidecar-published body state (Stage 5). Browser rAF
   latency can never alter simulation timing because the sidecar steps on its
   own wall-clock-independent physics clock (PROTOCOL §4, §8).
2. **The sidecar owns the episode clock.** The benchmark (Node) may *drive*
   runs and *read* logs, but never steps physics.
3. **The neural controller stays exactly the existing connectome.** No copy, no
   re-implementation in Python, no weight tuning. The sidecar only ever *reads*
   motor population activity and *writes back* observations.

## 2. The causal loop (non-negotiable contract)

Every iteration of the sidecar must traverse all five edges:

```
 (1) motor population activity  a_neural(t)
 (2)   → decoder                 u(t) = D(a_neural(t); θ)          [MOTOR_DECODER_SPEC]
 (3)   → flybody action          action_59(t) = actuator_map(u(t))
 (4)   → MuJoCo physics          s(t+1) = physics(s(t), action_59(t))   ← THE BODY
 (5)   → environment consequence r(t), obs(t+1) = task(s(t+1))
 (6)   → sensory feedback        obs(t+1) → neural input layer (injectLayerChannels/
       visual-field encoding) → changes next-tick a_neural(t+1)
```

A run that skips any edge is not embodiment and fails the smoke test. Edge (6)
is what distinguishes a *body* from an *animation*: the loop must be able to
alter the neural state, not just display it.

## 3. Sidecar module contract (embodiment/sidecar.py)

```
INPUT  (per control step, from protocol messages):
  neural_motor   float[k]      motor-population activity (firing rates or spikes)
  observation    float[m]      sensory observations for the neural input encoding
  timestep       int           sidecar physics step index
  dt             float         physics dt (fixed; PROTOCOL §4)
  reset          bool+seed     episode reset request (PROTOCOL §6)
  learn          float         plasticity/learning-rate gate for reward routing

OUTPUT (per control step, back to protocol client):
  body_state     {pos[3], quat[4], linvel[3], angvel[3]}   torso 6-DoF + derivatives
  action         float[59]    the exact flybody action vector applied
  joints         float[J]     joint angles (legs/wings/abdomen/head, model-defined)
  reward         float        task reward from THIS step's environment consequence
  task_state     {phase, event, done, info…}               episode/task bookkeeping
  latency_ms     float        measured sidecar loop latency (PROTOCOL §9)
```

Internal components (each independently unit-testable):

- **NeuralTap** — reads motor-layer activity from the live bridge in the browser
  (additive `window.__embodimentTap` hook) or replays recorded motor traces in
  `MOCK_NEURAL` mode. Read-only: it never mutates the connectome.
- **MotorDecoder** — MOTOR_DECODER_SPEC.md. Parameterized-permission-to-learn;
  logs input, output, and the body action actually applied.
- **BodyDriver** — thin adapter with two interchangeable backends:
  - `FlybodyDriver` — `dm_control`-style env around flybody (`fruitfly.xml`),
    `env.step(action_59)`. Exists as code; **requires mujoco+dm_control+flybody**.
  - `MockBodyDriver` — deterministic Newton–Euler-lite point-mass + wing-drag
    surrogate with the SAME 59-dim action interface. It exists so the protocol,
    decoder, logging, and causal-loop logic are executable today; it is clearly
    labeled and can never be presented as embodiment evidence.
- **SensorBinder** — maps body state + task geometry to the observation vector
  (visual 8-bin field, contact/door 7-dim analogues), the same shapes the
  connectome's input layers already accept.
- **RunLogger** — JSONL, one record per step (DECODER_SPEC §6). This log is the
  *evidence artifact* for causality claims.

## 4. Why a WebSocket sidecar (and not fetch/poll, not in-browser)

- Streaming at 60 Hz with backpressure → WebSocket is the only browser transport
  that fits without unbounded queues.
- Python is where flybody lives; no WASM MuJoCo path is acceptable (it would put
  physics back on the render thread — the exact mistake patch 19 removed).
- Node regression harness talks to the same sidecar over the same protocol
  (`embodiment/embodiment_client.js`), so CI can run the causal smoke test
  headless: Node client → sidecar → (flybody | mock) → assertions.

## 5. What stays untouched

- `fly_demon_3d.html`, `experiment_core.js`, `experiment_worker.js`,
  `controllers.js`, `brain_worker.js`, `brain_worker.js` fallbacks: **zero edits**
  (verified by `git status` at the end of this track; only new files added).
- E9/E10/E11: not rewritten, not re-parameterized. The Stage 5 bridge consumes
  their *patterns* (task structure, reward shapes) as design input only.
- Benchmark process: E1–E11 remain runnable exactly as before; the embodiment
  harness is an additional client, not a replacement.

## 6. Stage 5 — full Maxwell chamber bridge (design target)

```
physical chamber (sidecar task module, MuJoCo bodies: chamber walls, doors, particles)
   ↓ visual/sensory field      SensorBinder: particle geometry → 8-bin visual, 7-dim contact
   ↓ fly sensory system        existing input encoding (injectLayerChannels semantics),
                               delivered as protocol `observation`
   ↓ FlyWire connectome        brain_worker.js — UNCHANGED, still the controller
   ↓ motor population          motor-layer spike readout (NeuralTap)
   ↓ decoder                   MotorDecoder (DECODER_SPEC)
   ↓ flybody                   action_59 → MuJoCo step
   ↓ body interacts with task  doors open when the *body* passes them; particles
                               disturbed by *wings/airflow*, not scripted
   ↓ new sensory state         SensorBinder → obs(t+1)
   ↓ reward/plasticity         reward → protocol `learn` gate → existing DA/plasticity
                               pathway in the connectome (same dopamine gate, real cause)
```

The browser 3D scene becomes a **live visualization of the same state**:
the sidecar publishes `body_state`/`joints` and the (future, additive) panel
renders that stream. No fake body motion is added to the current scene.

Roadmap after the smoke test passes:
1. Single-door chamber task in MuJoCo (one door, thermal-ish particle field, 59-dim).
2. Reward = existing demon-gate reward semantics, computed from *physical* door
   crossings; plasticity routed through the existing DA gate.
3. Dual-chamber temperature task mirroring E1/E6 semantics, then E9-style
   pressure task with physical valves.
4. Only then: replace `MOCK_*` permanently, wire the browser visualization.

## 7. Failure & degradation policy

- flybody import fails → sidecar still boots with `MOCK_BODY`, protocol and
  logging fully exercised; smoke test reports `MOCK` mode explicitly.
- WebSocket drops mid-episode → sidecar pauses physics (does NOT advance),
  buffers last state; client reconnect resumes the same episode or requests
  reset (PROTOCOL §8).
- Any exception in the decoder → action falls back to the last valid action,
  error logged, step counter marked degraded — never a silent zero-action.
