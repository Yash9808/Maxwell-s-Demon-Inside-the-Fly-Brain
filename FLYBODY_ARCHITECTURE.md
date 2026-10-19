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

## 8. In-scene flybody visualization (browser)

The browser renders the closed-loop body as a rigid marker driven **only** by
the real `cl_state` stream (no synthetic pose, no fake gait):

- Factory `window.__clViz` lives in the ES-module scope (it needs the module's
  THREE import — the experiments/CL script block is classic and has no THREE;
  the CL section calls it through a guarded shim). Lazily built on first run.
- Pose: `body_pos`/`body_quat` from the loop, ×1000 (1 scene unit = 1 mm),
  MuJoCo Z-up → Three.js Y-up via a true basis-change quaternion
  (−90° about X), never a component shuffle.
- Leg glow tracks the REAL `motor_rate`; the trail is the REAL position
  history. Contract v1 streams no joint angles, so legs are a static stance
  silhouette — labeled as such in the card (`3D flybody — real physics pose ·
  trail ×1000 · body enlarged`).
- One-shot camera focus on run start (`orbit.dist` set to 260 only if the user
  is zoomed out beyond 600 — user zoom closer is respected).
- Toggle: the CLOSED-LOOP card's `clVizChk` checkbox; `window.__clVizMarker`
  is the console/debug handle (pose is always the genuine `cl_state`).
- Physics-driven glb fly (`clGlbDriveChk`, patch 3d22): the realistic fly
  (`fly.glb` / `flyGroup`) can also adopt the SAME real `cl_state` pose —
  **translation + rotation only**. The stream carries no joint angles, so no
  gait is ever synthesized (the glb keeps its neutral stance; wing flutter is
  oscillator cosmetic, labeled as such). While driven, the chamber flight
  director (`updateFlyTurn`) is suspended — the streamed pose is the single
  writer; on loop end or toggle-off the director resumes from the perch and
  the pre-drive TrueFly on/off state is restored. The `__clViz` marker is
  hidden while the glb body is driven (one fly, one body) and returns when
  the drive releases.
- Pose provenance (Stage 5 §17 follow-through): the `cl_state` envelope
  carries `fly_motion_source: "flybody"` (worker, `experiment_worker.js`) —
  this pose IS the physical body, never a page-side invention — and the page
  exposes the live avatar-ownership state machine-readably:
  `window.__flyMotionSource()` returns `"flybody"` while the stream owns the
  pose and `"presentation"` when the chamber flight director / demon
  narrative does (`window.__flyMotionFacts()` adds `contract_v`,
  `rigid_pose_only`, gait/wing-flutter disclosures, `last_stream_t`). The
  CLOSED-LOOP card mirrors it in the verdict chips (`pose: flybody (real)` /
  `pose: presentation`). Release paths (`clGlbEnd`, worker `onerror`) return
  provenance to `"presentation"` so it can never stick on `"flybody"` after
  the stream stops. The demon role-swap story stays narrative-only in either
  state — it is never presented as neural or physical behavior. Guarded by
  `tests/presentation_fly_provenance.test.js` (behavioral sandbox on the
  page's own code + worker-sandbox stream replay + fail-closed release pins).
- Verified live: 3 full episodes (seed 11), each ending "closed loop OK
  (flybody, 240 steps)" with byte-identical chips (Σ|Δw| 594.5, DA −1.50) and
  identical final pose — determinism holds through the whole
  browser→worker→WebSocket→MuJoCo chain.

---

## 7. Real visual feedback — implemented (post-Phase-02, ADDITIVE)

Status: **implemented and causally verified** (`tests/closed_loop.test.js`
T-V1/T-V2/T-V3, `embodiment/smoke_test.py` T8). The 8 visual channels of
`FlybodyDriver.observation()` are no longer a constant zero vector.

### 7.1 Sensor spec (fixed constants, `embodiment/sidecar.py`)

| Property | Value |
|---|---|
| Reference frame | `walker/thorax` egocentric: x forward, y left, z up |
| Grid | 8 sectors = 4 azimuth quadrants (fwd/left/back/right) × 2 hemifields (below/above the thorax horizontal plane) |
| Bin index | `bins[j + 4·i]` — azimuth-major, index-order-aligned with the chamber's `(u*4\|0) + ((v*2\|0)·4)` convention (`injectLayerChannels` semantics unchanged) |
| SELF points | every `walker/*` geom center (159 geoms: visual + collision, all body parts) — a dense posture-sensitive cloud |
| TARGET | `ghost/thorax` — the walking-ghost reference fly (the task's own visual object), max-pooled |
| Range model | SELF `min(1, r/0.25 m)` mean-pooled over points, clipped to [0,1]; TARGET `min(1, r/0.5 m)` max-pooled |
| Cadence | recomputed once per physics step (after `env.step`), memoized until the next step — `observation()` stays a pure function of the post-step state (contract C4) |
| Cost | ~1 ms/step (measured ~6–8 ms including MuJoCo control substeps) |
| Determinism | pure state function — byte-identical on recomputation (asserted in T8) |
| GL dependency | none (no rendering, no OpenGL backend required; `MUJOCO_GL` untouched) |
| Occlusion | NOT modeled — stated limitation; the scene's visible set here is self + ghost target only |

### 7.2 Why geometric sensing and not the eye camera (Option A probe record)

The plan's first choice — rendering the scene from flybody's `walker/eye_right`
camera — was implemented and probed on this host, then rejected on measured
evidence:

1. **Occlusion**: the eye camera is mounted *inside* the head
   (`fruitfly.xml` camera pos `0.0219 0.0131 0`, child of the head body). In
   the walking pose the head geoms occlude the lens: 30 vigorously driven
   steps changed **0 of 1024** rendered pixels (constant dark self-view).
   flybody itself uses the eye cameras only for the flight task over hilly
   terrain (`tasks/vision_flight.py`), never in `walk_imitation`.
2. **Cost**: ~0.3 s per 32×32 render under `MUJOCO_GL=glfw` (osmesa/egl
   unavailable unprivileged on this host) — ~20× the physics step, for a
   constant image.

Geometry-based sensing is the stated preference when available, needs no GL,
costs microseconds, and is exactly causal.

### 7.3 Wiring (unchanged beyond the sensor)

```text
MuJoCo scene (post-step state)
   ↓  EgocentricFieldSensor (geometry → 8 bins)
obs[0:8]  +  obs[8:15] proprio (unchanged)
   ↓  sidecar step_result.obs_next (OBS_DIM = 15, contract v1 UNCHANGED)
sensoryTransform → visual[8] + contact[7]
   ↓  injectLayerChannels (AL) + optic stochastic kicks
connectomeController (UNCHANGED)
```

The welcome banner's `assets.visual` now carries the sensor provenance
(camera frame, grid, ranges); the wire schema gains one optional key — no
protocol-version bump. New regression anchors: `EMBODIMENT_TRAJECTORY_SHA256`
(replay target override for post-visual-change baselines) and
`EMBODIMENT_REQUIRE_GL=1` (deployment flybody gate on the visual provenance
stamp); both opt-in, frozen-Phase-01 defaults unchanged.

### 7.4 Honest limits

- The `walk_imitation` scene contains only the walker, the ghost target, and
  the floor; visual richness will grow with the Stage 5 MuJoCo chamber task.
- Sector assignment is angular, not ray-cast: no occlusion, no distance
  falloff beyond the linear range model, no retina geometry (retinotopy stays
  an opt-in, uncalibrated alternative on the chamber side).
- No claim of biological realism beyond "egocentric, spatially organized,
  causally coupled": the biological mapping remains the connectome's own
  optic-channel injection semantics.

## 9. STAGE 5 — the first physical task (the pillar; ADDITIVE)

The first task object the fly can physically affect, and whose state change
feeds back into its (unchanged) 8-bin visual field — `embodiment/task_pillar.py`,
opt-in per session via `hello.task = "pillar"` (unknown task names fail
closed). The wire contract is UNCHANGED: `OBS_DIM = 15`, contract v1, and the
reward is still only TRANSPORTED by the sidecar (reward→dopamine mapping lives
exclusively in `receiveFeedback`).

Scene: a light free (6-DoF) box pillar (fixed build pose (−0.030, −0.005,
0.040) m, mass 1e-4 kg, contype=1) added to the `floors.Floor` arena BEFORE
first compile — `flybody.fly_envs.walk_imitation()` builds its own arena, so
the task env replicates that construction with only the arena extended. The
ghost cannot collide (contype=0): only the fly can move the pillar. The task
sensor MAX-POOLS the pillar into the SAME 8-bin egocentric field (same sector
semantics as the ghost — the pillar joins the visual field in place, no new
coordinate system). Reward (pure function of post-step MuJoCo state, no RNG):
dense planar pillar-displacement delta (`REWARD_DISP_SCALE = 0.5 mm per unit`)
+ one-time first-contact bonus (0.25); success POLICY latches at ≥ 5 mm planar
displacement (telemetry `pillar_disp_norm` is measured independently, never
gated). Telemetry: a `task` snapshot on every step result and JSONL record
(pose, displacement, first-contact step, contact-step count, success, and
`mode: "real" | "proxy"` — the mock driver runs a documented physics-scaled
PROXY for CI, never embodiment evidence). A `tap {op:"pillar_set_pose"}`
deterministic debug op teleports the pillar BETWEEN steps for controlled
stimulus perturbations (an experimenter move, never part of the closed loop).
Measured Stage 5 probe facts (MuJoCo 3.13, fixed decoder seed): silent decoder
output sweeps the walker ~−0.126 m in 300 steps into the pillar and displaces
it ~0.067 m (300/300 contact steps); driven intents (calibrated u-contrast)
gate the sweep to ~4 mm — neural output demonstrably gates the environmental
outcome through real MuJoCo contact physics.

Causality tests: `tests/stage5_task.test.js` (T1–T11 + guards, run green on
real flybody physics). Legacy (no-task) runs keep the EXACT pre-Stage-5
core-record shape, so the frozen Phase 01/02 trajectory anchors stay
byte-identical (replay discipline verified: `EMBODIMENT_TRAJECTORY_SHA256`
anchor MATCH=true after the change).
