# FLYBODY INTEGRATION AUDIT — Stage 1

Date: 2026-09-20 · Branch: `Ver2(Split-code-fastframe)` · Author: Agent 4 (embodiment track)
Scope: read-only inspection. **No existing experiment files were modified.**

---

## 1. Environment inventory

| Component | Status | Evidence |
|---|---|---|
| Python | ✅ present | Python 3.14.6 (system interpreter, no venv active) |
| numpy | ✅ present | 2.5.1 |
| MuJoCo Python bindings | ❌ **NOT INSTALLED** | `python -c "import mujoco"` → ModuleNotFoundError |
| dm_control (flybody's RL stack) | ❌ **NOT INSTALLED** | ModuleNotFoundError; PyPI shows 1.0.46 available |
| flybody | ❌ **NOT INSTALLED** | ModuleNotFoundError |
| flybody on PyPI | ❌ **not published to PyPI at all** | `pip index versions flybody` → "No matching distribution found" |
| flybody source | ✅ locatable | https://github.com/TuragaLab/flybody (Google DeepMind + HHMI Janelia; Nature 643:1312–1320, 2025) |
| mujoco wheels on PyPI | ✅ available | mujoco 3.13.0 (and 2.3.x–3.13.x) listed by `pip index versions mujoco` |
| Node.js | ✅ present | v24.18.0 — benchmark harness, experiment worker, JSON sidecar protocol |
| GPU / rendering | unknown | unverified; MuJoCo headless `MUJOCO_GL=egl` may need config on this Windows host |

**Exact missing dependency chain (in order):**

1. `mujoco` (PyPI wheel exists — needs install approval; ~60 MB, no compiler needed)
2. `dm_control` (PyPI wheel exists — flybody's env wrapper depends on it)
3. `flybody` itself — **must be fetched from GitHub**, e.g.
   `pip install git+https://github.com/TuragaLab/flybody.git`
   (core install only; the `[tf]`/`[ray]` extras are NOT needed for the sidecar —
   the sidecar drives the physics directly and uses our own decoder, not their DMPO policy)
4. flybody's model assets (fruitfly.xml, floor.xml, walking-pose reference data) ship inside the repo.

flybody's own README recommends Python 3.10 + conda; this host runs system
Python 3.14. Python 3.14 is newer than the versions flybody's CI tests; the
smoke test below therefore treats `import flybody` as **unverified until
executed** and the sidecar degrades gracefully if the import fails.

## 2. Current repository interfaces

### 2.1 Process topology today (all in-process, all browser/Node)

```
fly_demon_3d.html  (browser app, 39 MB, ~5000 lines)
 ├─ inline module script  ── brain sim (patch 19 moved it out):
 │    brain_worker.js      106,765-neuron LIF connectome tick, 563k synaptic edges,
 │    │                    dopamine-gated plasticity; publishes spike bitmap +
 │    │                    plastic weights as zero-copy transferables at ~15 Hz
 │    └─ fallback: legacy in-frame brainTick() (identical math) if worker absent
 ├─ classic script         UI, 3D scene, demon-game loop (rAF-driven)
 └─ experiment list ──► experiment_worker.js (576 lines)
        └─ experiment_core.js (1,866 lines) — runBenchmark(), seeded multi-condition
           trials, layerSpikeRates(), per-trial rows; E9–E11 apparatus sims inline
```

### 2.2 Motor population representation

- Connectome layers are built from `fly_brain_circuit.json` (FAFB v783) /
  `malecns_circuit.json` (male CNS); the **motor layer is `layers[layers.length-1]`**,
  an index list into the global neuron arrays (`sim.layers`, `sim.layerStart`).
- Per-tick activity is the spike bitmap `sim.spikes` (Uint8Array over all N neurons),
  produced by `brain_worker.js` (or the fallback in-frame `brainTick`).
- Existing scalar readouts: `motorRate()` = mean spike rate over the motor layer
  (fly_demon_3d.html:1849); `sim.motorRateSmooth`, `sim.motorBase` (EMA-smoothed,
  dt-scaled, updated in the worker with identical math).
- The demon-game "action" today is **not** body control: `demonGateDecision()`
  (controllers.js:86) and `demonDecisionFor()` (controllers.js:106) map motor
  statistics to door open/close for the abstract chamber; the fly avatar's motion
  is animation, not dynamics.
- **There is no per-neuron motor readout API yet** — the sidecar's `NeuralTap`
  (Stage 3) adds one read-only, without touching existing files.

### 2.3 Sensory representation

- `readSensors(Tl, Tr, doorH)` (fly_demon_3d.html:2051) — 7-dim contact/door sensors.
- `readVisualField()` (fly_demon_3d.html:2065) — 8-bin visual field from particle positions.
- Apparatus sensory adapters: `senseE9(parts, valve, pist, sideStats, doc)`
  (experiment_core.js:612) — molecule-approach / side-density features; E10/E11
  have their own per-apparatus sense functions.
- All sensory streams are computed from simulated state, never from a body.

### 2.4 E9 apparatus (Pressure Demon)

- Self-contained in `experiment_core.js` (from line 515): speed-selective valve
  `valveCmd`, piston `pistonStep`, side density statistics, 250-trial training
  sweep (E9 harness `e9_training_sweep.js` → `research_data/e9_training_sweep_progress.json`).
- E9's sensor→decision→valve→pressure loop is the closest existing analogue to a
  closed sensorimotor loop, but the "body" is the abstract piston/valve, not a fly.
- **E9 is NOT rewritten by this track.** The future chamber bridge (Stage 5 of
  FLYBODY_ARCHITECTURE.md) *reads* E9's patterns; it does not modify them.

### 2.5 Benchmark process (must remain available as regression harness)

- Experiments E1–E11 run inside `experiment_worker.js` via
  `runBenchmark(cfg)` (experiment_core.js:372): deterministic seeded trials,
  controller factory from `controllers.js`, per-trial rows with `layerRates`,
  summaries → `research_data/_payload_e*.json`, plots page `experiment_plots.html`.
- Orchestration in the browser: lab-group play buttons (patch 15), background
  sessions, live plots channel (`fly-demon-experiments` BroadcastChannel).
- Determinism/seed handling is already strict inside the benchmark (seeded
  controllers + seeded trial noise) — the embodiment track adds its own
  seed discipline (FLYBODY_PROTOCOL.md §7) without touching this.

## 3. Constraint check against the mission

| Requirement | Status |
|---|---|
| Do not destabilize browser Maxwell-Demon experiments | ✅ this audit modified nothing; smoke test runs headless on its own files |
| Causality requirement (neural→action→env→sensory→learning) | addressed in FLYBODY_ARCHITECTURE.md §2 and EMBODIMENT_SMOKE_TEST.md |
| flybody = body/locomotion layer only | matches flybody's own design (no connectome inside; we supply the controller) |
| No embodiment-from-animation | the 3D page is explicitly designated a *viewer* (ARCHITECTURE §6); smoke test asserts physics, not pixels |
| Do not tune neural weights to make locomotion look good | decoder trains/derives from neural activity statistics only; no fitness feedback into connectome weights from body performance |

## 4. Verdict

**The repository is ready for the interface layer; the machine is missing the
physics stack.** Every pure-JS/Python piece of the bridge (protocol, decoder,
logging, causal test harness, Node regression re-use) can be built and executed
today. The flybody/MuJoCo leg of the smoke test executes only after
`mujoco`, `dm_control` and `flybody` (from GitHub) are installed — see
EMBODIMENT_SMOKE_TEST.md §6 for the exact unblock procedure and the graceful
`MOCK_BODY` behavior that lets the whole pipeline be validated without them.

**Environment verdict for this audit: flybody/MuJoCo UNAVAILABLE — no
implementation was fabricated. Interface + harness code ships in this track;
physics execution is blocked on 3 pip installs.**

---

## 5. UPDATE 2026-09-20 (later same day) — stack installed, physics ACTIVE

A Python 3.11.9 venv was created at `.venv-embodiment/` (gitignored) and the
full embodiment stack installed into it:

| Package | Version | Source |
|---|---|---|
| mujoco | 3.13.0 | PyPI wheel |
| dm_control | 1.0.46 | PyPI wheel |
| flybody | 0.1.0 | git+https://github.com/TuragaLab/flybody.git |

Verified: `flybody.fly_envs.walk_imitation()` loads the 135-body / 116-qpos
model headlessly (`MUJOCO_GL=disable`); `action_spec` is exactly (59,) with
real per-actuator bounds. The causal smoke test passes **all 7 assertions in
flybody mode** — see EMBODIMENT_SMOKE_TEST.md §2b for the two test-design
corrections real physics forced (silence≠stillness; ctrl-space rest
convention). Node protocol harness also passes end-to-end through real
physics (~9–15 ms/step). Verdict escalated to **EMBODIMENT FOUNDATION
READY**. Clients select this interpreter via `PYTHON_EMBODIMENT` env var.
