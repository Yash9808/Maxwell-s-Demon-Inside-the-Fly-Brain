# MuJoCo-as-Authoritative-Physics — Impact Assessment (AUDIT ONLY, no code changed)

Scope: what would change if MuJoCo became the authoritative 3D physics backend for the *whole physical world* (chamber, gas molecules, valve/door, piston, demon, fly body), not just the fly body it already owns in the closed-loop path.

---

## 1. What currently uses MuJoCo

| Surface | Current state |
|---|---|
| **FlyBody** | Yes — the only MuJoCo consumer. `embodiment/sidecar.py::FlybodyDriver` wraps `flybody.fly_envs.walk_imitation` (TuragaLab flybody, pinned commit `d015e9b`, Nature 2025 Vaxenburg et al. fruit-fly model, `fruitfly.xml`), pinned stack `mujoco==3.13.0` + `dm_control==1.0.46` in `.venv-flybody` / `.venv-embodiment` (locked `requirements-*.txt`). |
| **Closed-loop path** | Yes — the ONLY place MuJoCo is in the loop. `experiment_worker.js::runClosedLoop` → `embodiment/cl_ws.js` (WebSocket JSON-lines, port 8795) → `sidecar.py` → `FlybodyDriver.step(action_59)` → `observation()` back to the brain. `embodiment/closed_loop_core.js` owns the causal chain; `state_contract.js` (contract_v=1) validates envelopes. The browser page displays `cl_state` and, optionally, drives the `fly.glb` mesh with the real torso pose (rigid, translation+rotation only, no gait synthesis). |
| **Sidecar/backend** | Yes — `sidecar.py` owns the physics clock (dt_phys = 1/60 s fixed), decoder (`motor_decoder.py`, u[16]→a59), `SensorBinder` (15-ch obs), `RunLogger` (JSONL causal-chain evidence). A `MockBodyDriver` (deterministic numpy surrogate) shadows the same 59-dim contract for CI. |
| **Browser/rendering** | **No.** The browser is explicitly *never* the simulator (FLYBODY_ARCHITECTURE rule 1). Three.js renders; the only physics-adjacent browser code is display kinematics. There is no WASM MuJoCo and the architecture doc explicitly rejects that path. |

**Everything else in the repo runs on the in-house JS physics** in `experiment_core.js` (1,884 lines) and its `fly_demon_3d.html` twin: Euler-integrated point particles (molecules), reflective box walls, uniform-grid pairwise elastic collisions, center wall + guillotine door, E9 pressure apparatus (two chambers + valve + piston + spring, damped 2nd-order piston ODE), E10/E11 (thermal trapdoor, Feynman ratchet & pawl), plus the kinematic DemonGatekeeper avatar.

## 2. What would change if MuJoCo became authoritative for the whole physical world

- **Fly** — no change in *who* computes it (already MuJoCo). Change: it would share one scene with chamber/door/piston; contact between fly and apparatus becomes possible (currently impossible — different simulators).
- **Demon** — the DemonGatekeeper avatar (WATCH/ATTEND/HOLD/STRIKE/RECOIL, kinematic, no physics by explicit design comment) would have to become either (a) a MuJoCo body with actuated DOFs, or (b) stay a kinematic avatar *driven by* MuJoCo-derived quantities. Its STRIKE/RECOIL impulses (140/90 u/s velocity *replacements*) are currently non-physical events; under an authoritative engine they must become applied forces/impulses through `xfrc_applied` or actuators, or remain explicitly non-physical narrative overlays.
- **Chamber/environment** — REPLACE: `makeEnvironment`/`_apparatus*` walls, geometry (CH = 760×380×300), thermo-wall reflection (`_thermoWalls`) → MuJoCo geoms. The "thermal wall" behavior (stochastic velocity resampling to hold a target temperature) has **no native MuJoCo equivalent** — it must be reimplemented as a per-contact velocity-reset plugin/custom force, which is the single hardest fidelity problem.
- **Doors/gates** — REPLACE: `door.pos/target` easing (lerp `dt*8`) and the E9 valve slot (`valve.pos > 0.6` passability test with one-way rectification) → actuated MuJoCo hinge/slide joints with position servos. The **one-way valve rectification rule** (pass only if `p.vx > 0`) is an information-bearing, non-conservative rule that MuJoCo will not give you for free — it must be a contact/velocity-gated constraint you implement.
- **Collisions/contact** — REPLACE: the uniform-grid pairwise elastic collision pass (diameter 6.8, elastic, momentum-conserving) → MuJoCo narrowphase + contact solver. 320–800 particles as MuJoCo bodies is feasible; the *elastic, restitution=1, no-friction* gas behavior needs solver tuning (solref/solimp) and will not be bit-identical.
- **Actuators** — NEW for everything except the fly: door servo, valve servo, piston slide joint + spring (`SPRING·x`) + load mass, ratchet pawl. The fly's 59 position actuators stay as-is.
- **Camera/rendering** — SMALL ADJUSTMENT: Three.js keeps rendering; the render loop consumes MuJoCo state (`qpos/qvel` → mesh transforms) instead of internal particle arrays. The `fly.glb` rigid-pose drive already implements exactly this pattern for the fly — it generalizes.
- **Browser ↔ Python communication** — MAJOR CHANGE: today only `cl_state` crosses the wire (torso pose, action, reward, dopamine). Authoritative physics means per-step state for *hundreds* of molecules + door + piston + demon at 60 Hz. FLYBODY_PROTOCOL §10 explicitly warns about flooding the browser ("patch-16 lesson") — the wire needs a binary/quantized batch layout, or the browser renders slim visual proxies instead of full molecule state.

## 3. What calculations would change

- **Current JS calculations → MuJoCo:** particle integration (`p.x += vx*dt` + drag 0.999), wall reflection, grid collisions, door/valve easing, piston ODE (`F = ΔP − SPRING·x; v += F/m − drag·v`), E10 trapdoor, E11 ratchet hops — all move into `mj_step`.
- **Kinematics:** demon `seekPost`/arrive/heading easing — either replaced by MuJoCo motion or kept as kinematic overlay.
- **Neural → motor:** the decoder path is unchanged (a_neural → u[16] → a59). What changes: in E9 the "motor" signal is `mFast − mSlow` rate-code → binary valve; under MuJoCo the same signal must drive a *physical* valve actuator target, and STRIKE/RECOIL-style impulse events must become force commands.
- **Position/velocity/orientation:** molecule `p/v`, demon `pos/vel/heading`, piston `x/v` → `qpos/qvel` in one state vector. One source of truth ends the current dual bookkeeping (3D app vs experiment_core).
- **Collision/contact:** grid-narrowphase pair resolution → constraint solver; elastic restitution becomes a contact parameter, not an exact analytic velocity swap.
- **Timing/timestep:** JS uses dt = 1/60 with variable render dt clamped to 0.1 (demon integrator substeps at DEMON_REF_DT = 16.667 ms). MuJoCo wants smaller dt (typically 1–5 ms for stable contacts on small geoms). Consequences: (a) step ratio R (neural:physics) changes — multiple MuJoCo substeps per neural tick; (b) the protocol's R constant must be renegotiated (version bump).
- **Interpolation:** render-side easing (`door.pos += (target−pos)·dt*8`, valve lerp, demon lerp) is replaced by solver-imposed motion; visual smoothing becomes renderer-side interpolation of `qpos`, not simulation.
- **Forces/torques/constraints:** explicit velocity kicks (jet reassignments, STRIKE/RECOIL velocity replacement, recoil caps) → `xfrc_applied`/impulse APIs or actuator targets; spring/drag → MuJoCo spring/damper elements.

## 4. What would remain unchanged

- **LIF neurons** — `controllers.js::connectomeController` (V, spikes, refac, CSR spike propagation over the FAFB v783 circuit) — untouched.
- **Synapses/plasticity** — eligibility-by-contact, dopamine-gated `applyLearning`, KC→MBON winner-take-all, PG readout — untouched.
- **Dopamine/modulation** — `MOD_GAINS`, da/ser/oct EMA channels, reward routing `receiveFeedback({reward})` — untouched (only *where the reward number comes from* changes).
- **Spike generation** — binary KC spikes, motor-pool vector `motorSpikeVector()` — untouched.
- **Experimental metrics** — `METRICS` (spatial/sorting entropy, MI, KL, Landauer, extractable work), `tempStats`, crossings, `workU` — untouched as *definitions*; their **inputs** become MuJoCo-derived quantities.
- **Scientific definitions** — T = √⟨v²⟩·K, one-way rectification semantics, decision-bit accounting, train/test protocol, seeds — preserved verbatim; only the substrate computing them changes.

## 5. Demon specifically

- **Becomes unnecessary:** hand-written `seekPost`/arrive/heading easing, velocity-replacement impulses, recoil caps, FPS-independent substep accumulator — exactly the class of code a physics engine owns.
- **Becomes MuJoCo quantities:** demon mass/inertia, contact with floor/gate, strike force, recoil impulse, hold-post contact forces.
- **Remains a controller signal:** the *decision* layer — door regime commands, crossing quality q, crossing speed sp — is policy output and stays neural/behavioral.
- **STRIKE/RECOIL/ATTEND/HOLD:** keep them as **behavioral states** (a policy layer above physics) that *issue* physical control signals (actuator targets / applied forces). Demoting them to raw physical signals would entangle narrative semantics with solver state and break the current event-causality test (T5: STRIKE only after a real crossing event).

## 6. Data/state ownership

| Owner | Would own |
|---|---|
| **Python (sidecar)** | Episode clock, decoder, task/reward logic, SensorBinder, RunLogger, reset/seed orchestration |
| **MuJoCo** | All `qpos/qvel/act`, contacts, constraints, actuator dynamics, chamber/door/piston/fly/demon geometry and state |
| **Neural simulation (browser worker)** | Connectome state: V, spikes, weights, eligibility, dopamine EMA, plasticity — bit-identical to today |
| **Browser/Three.js** | Rendering only: mesh transforms from streamed state, camera, HUD, galleries; no physics authority |

## 7. Performance implications

- **Gains:** one solver replaces hand-written collision + ODE code; correct fly↔world contact for free; MuJoCo's C engine is fast for this model class (protocol budget: flybody ≈ 1–3 ms/step, <5 ms budget).
- **Losses:** the JS gas is ~O(n) per step (grid collisions are cheap); MuJoCo with 320–800 small geoms + contacts is heavier per step, likely 2–10× the current JS physics cost — probably still inside the <5 ms budget, but no longer trivial.
- **New bottlenecks:** (a) **IPC/serialization** — per-step JSON of hundreds of molecule states at 60 Hz would dominate; needs Float32 binary frames or render-proxy downsampling; (b) **timestep mismatch** — substepping multiplies Python↔JS round trips; (c) browser rendering unchanged (Three.js already handles the scene); (d) **CPU only** — MuJoCo is CPU-side; no GPU implications; (e) Python GIL pattern unchanged.
- **Determinism hazard:** float precision through the wire and async delivery can break bit-identical replays unless the state contract pins serialization exactly (it already demands exact envelopes for cl_state).

## 8. Scientific implications

- **Meaning changes (must be managed):** temperature definition (thermo-wall resampling vs. real thermal bath), elastic-gas ideality, one-way valve information semantics, STRIKE/RECOIL as non-physical narrative events, piston-as-ODE vs. piston-as-constrained-body.
- **Reproducibility:** JS runs are bit-reproducible today (mulberry32, fixed evaluation order). MuJoCo is deterministic for identical step sequences, but determinism becomes *pinned-environment* (version, threads, solver) instead of language-level; all published numbers (E9 ratio 0.935 ± 0.057, P = 0.72; E10/E11 work-vs-Landauer) need re-derivation — same qualitative claims, different numbers.
- **Interpretation:** "connectome topology causally shapes the gate policy" is substrate-independent in principle, but every figure and regression fixture (`tests/run_smoke.js` S9 golden E1) breaks and must be regenerated with an explicit "physics substrate changed" note.

## 9. Migration scope

| Component | Scope |
|---|---|
| brain_worker.js, controllers.js (LIF/CSR/plasticity/PG) | **NO CHANGE** |
| experiment_core.js METRICS definitions | **NO CHANGE** (inputs change) |
| sidecar.py protocol, decoder, RunLogger, SensorBinder shapes | **SMALL ADJUSTMENT** |
| fly.glb rigid-pose rendering path | **NO CHANGE** (already the target pattern) |
| 3D app render loop consuming particle arrays | **MAJOR CHANGE** (consume MuJoCo state) |
| experiment_core.js particle env / E9 apparatus / E10 / E11 | **REPLACE** (MuJoCo MJCF models) |
| DemonGatekeeper physics layer | **REPLACE** (kinematic → actuated body, or documented kinematic overlay) |
| Per-step world-state wire format | **NEW COMPONENT** (binary/quantized batch) |
| Chamber/door/valve/piston MJCF model | **NEW COMPONENT** |
| Golden fixtures (S9), E1–E11 expected outputs | **REPLACE** (regenerate with substrate-change note) |
| MANIFEST/CI/reproducibility docs | **SMALL ADJUSTMENT** (MuJoCo version, MJCF hash) |

## 10. Calculation mapping

| CURRENT CALCULATION | MUJOCO EQUIVALENT | KEEP / REMOVE / ADJUST |
|---|---|---|
| Particle Euler integration + drag | `mj_step` integration | REMOVE (JS) / ADJUST (semantics) |
| Wall reflection + `_thermoWalls` | geom contact + custom thermal-wall force | ADJUST (hardest fidelity item) |
| Grid pairwise elastic collisions | contact solver, restitution = 1 | REPLACE |
| Door/valve lerp easing | hinge/slide position servo | REPLACE |
| One-way valve rule (`vx > 0`) | gated contact/velocity constraint (custom) | ADJUST |
| Piston ODE + spring | slide joint + spring + load mass | REPLACE |
| Jet velocity reassignment | `xfrc_applied` impulse | ADJUST |
| Demon kinematic seek/arrive | actuated body or kinematic overlay | ADJUST |
| STRIKE/RECOIL velocity replacement | applied impulse (bounded) | ADJUST |
| Decoder u[16] → a59 | unchanged (already MuJoCo-facing) | KEEP |
| LIF / CSR / plasticity / dopamine | n/a (neural) | KEEP |
| tempStats / METRICS / Landauer | same formulas, MuJoCo-derived inputs | KEEP (inputs ADJUST) |
| Seeds (mulberry32) | MuJoCo seeded reset + task RNG | ADJUST (dual-source seeds) |

## 11. Risks

1. **Thermal-wall fidelity** — the stochastic velocity-resampling bath has no MuJoCo native analogue; getting it wrong changes the temperature definition and every downstream number.
2. **One-way valve semantics** — the rectification rule *is* the Maxwell-demon information mechanism; a naive contact constraint may leak or rectify incorrectly.
3. **Determinism/reproducibility reset** — all golden fixtures and published numbers become invalid; cross-platform MuJoCo determinism must be pinned (version, thread count, solver).
4. **Performance inversion** — the JS gas is cheap; MuJoCo + IPC may be slower end-to-end at 60 Hz with hundreds of molecules.
5. **Two-clock complexity** — R (neural:physics) renegotiation and substepping enlarge the failure surface the protocol already guards (drift, auto-step, sync_hold).
6. **Narrative vs. physical conflation** — the demon avatar's documented "not a body" status could silently become pseudo-physical evidence if it enters the solver without re-documentation.
7. **Scope creep** — E1–E11 span five apparatuses; each needs its own MJCF + task logic; this is a program, not a patch.

## 12. Final architecture (proposed data flow)

```
neural simulation (browser brain_worker / controllers.js, unchanged)
        │  motor population a_neural (tap, read-only)
        ▼
controller/decoder (sidecar: u[16] → a59 + valve/door/strike commands)
        │  actions + behavioral-state commands
        ▼
MuJoCo (AUTHORITATIVE world: fly + chamber + door + valve + piston + demon body)
        │  qpos/qvel/contacts/reward per substep
        ▼
sidecar aggregation (SensorBinder, metrics, RunLogger)
        │  slim per-frame state (binary batch)
        ▼
browser/Three.js (render only: meshes from streamed state; no physics)
```

---

**What changes** — the entire physical world (gas, walls, door/valve, piston, demon body, contacts, forces) moves from hand-written JS dynamics into one MuJoCo scene; the browser becomes purely a renderer; the wire carries world state, not just torso pose; all golden fixtures and published numbers are regenerated under the new substrate.

**What stays** — the connectome brain end-to-end (LIF, CSR spike propagation, KC→MBON and eligibility plasticity, dopamine gating, PG readout), the decoder contract (u[16]→a59), the sidecar protocol skeleton, the metric *definitions*, the experimental semantics (one-way rectification, decision bits, train/test, seeds-as-contracts), and the flybody model itself.

**What must be recalculated** — temperatures, pressures, work, crossings, entropy/MI, and every per-step trajectory (now from `qpos/qvel`); timestep ratios and substepping; the E9 ratio (0.935 ± 0.057) and E10/E11 work-vs-Landauer figures; the S9 golden fixture.

**What must NOT be changed** — the neural dynamics and plasticity rules, the causal-loop contract (five edges, read-only neural tap), the decoder guardrails (no reward into decoder), the scientific definitions of T/work/bits, and the "browser is never the simulator" rule.

**Biggest migration risk** — faithfully reproducing the thermal-wall bath and the one-way valve rectification inside MuJoCo; those two custom behaviors carry the experiment's thermodynamic meaning, and a subtly wrong reimplementation would invalidate every sorting/work claim while still "running fine."

**Smallest safe next experiment** — run the existing E9 pressure apparatus as a **parallel shadow**: keep the JS physics authoritative for results, add a MuJoCo MJCF twin of chamber+valve+piston, step both from the same seeds, and publish a divergence report (ΔT, ΔP, Δwork per step) before any cutover. Zero risk to current results; it converts the two hardest risks (thermal wall, valve) into measured quantities.

*End of audit. No code was modified.*
