# Architecture Audit — Anatomical 3D Brain (read-only)

**Status:** AUDIT ONLY — no file was modified, no behavior changed.
**Branch inspected:** `deployment/phase-02` · Date: 2026-09-23.
**Scope:** why Anatomical 3D can hang or run slowly; the exact current architecture; what would and would not be fixed by Warp / P3.
**Evidence tags:** `MEASURED` (runtime numbers from F1/Warp reports), `VERIFIED` (read in source this session, file+line), `INFERRED` (mechanistic consequence of verified code, magnitude not measured).

---

## 1. Executive Summary

1. **The brain tick itself is already off the main thread.** The 106,765-neuron / 553,807-edge LIF+plasticity tick runs in `brain_worker.js` at ~33 ms cadence; the page only latches inputs and consumes a published state (`fly_demon_3d.html` L2663–2678, `brain_worker.js` L295–355). The worker sustains ~80 ticks/s; the *browser* consumes only ~11/s (F1, MEASURED).
2. **The hang is therefore a render-side + lifecycle problem, not a compute-side one.** F1 measured ~66% of main-thread wall time in long tasks *on the healthy worker path* (MEASURED, `F1_WORKER_BASELINE.md` §4.1). Warp's anat A/B measured 0 long tasks with the tick on the GPU, but still ~12 fps rAF under throttling — confirming large non-simulation render cost (MEASURED, `WARP_ANAT_INTEGRATION.md` §9).
3. **Anatomical mode rebuilds the whole scene graph synchronously on the main thread**: `buildBrain(circuit)` constructs a 106k-instance mesh, a ~6,000-edge cable geometry built from **real synapse waypoints** (39.7 MB `fly_brain_edge_paths.bin` → several million vertices), labels, and hull meshes in one blocking call (VERIFIED L1351–1530, `buildCableFor` L2140–2260). `switchDataset` even documents "makeSim+buildBrain block one frame" (VERIFIED L4161–4162).
4. **Recurring per-frame scans remain on the render thread.** `refreshWeightOverlay()` ranks **all 553,807 fast edges every 6th tick** when the worker is broken/replaying (VERIFIED L3404, L3424–3440); `jet.step()` scans 106k neurons/frame for decay + recolors ~15×/s with a sampled-sort p95 (VERIFIED L1435–1460); `cableEdgeTick` recolors ~72k cable segment vertices per sim tick (VERIFIED L2247–2301); full ~6.8 MB node instance-matrix re-upload every frame with **no `DynamicDrawUsage`/`updateRange` anywhere in the file** (VERIFIED L3360–3371, grep empty).
5. **Per-frame geometry allocation exists outside the brain**: `updateTail` rebuilds a `TubeGeometry` and disposes it **every frame** (VERIFIED L3046), a documented GC-hitch source (ANIMATION_PERFORMANCE_PROPOSAL F3).
6. **The worker→main publish channel is already compact and zero-copy** (spike bitmap 106 KB/tick, heat 106 KB/tick quantized, weights 2.2 MB + top-K every 12th tick, all pool-recycled transferables — VERIFIED L2496–2555, `brain_worker.js` L327–355). This is effectively the compact boundary already; Warp re-derived the same contract independently.
7. **The real anat-mode killer at 30 Hz is the combination of (3)+(4)**: a multi-hundred-ms synchronous build on entry (observed p50 frames 177–228 ms in anat, MEASURED) plus a steady per-tick/per-frame color+matrix tax that the preview-machine could only sustain at ~12–20 fps.
8. **Fallback is loud, not silent** (`IN-FRAME` badge + banner + console, VERIFIED L2680–2690; F1 verified live). When it does run, the full 563k-edge tick is on the render thread — that *is* a guaranteed hang-class event, but it is visible and intentional (`?bw=off`).
9. **Lifecycle hazards found (unfixed, reported only)**: `?bw=off` permanently kills the JS worker for the session with no restart path (VERIFIED L2456–2458, L2604–2606); the anat success path guards the boot race but the click handler dereferences `sim.circuit` after an await (guarded, L4218); replay mode diverts state mirrors and drains pools correctly but keeps the worker ticking during apparatus replays (VERIFIED L2945–2952 comment + onmessage replay branches L2509–2545).
10. **State boundary vs Eon-style target**: the transfer layer is nearly there (compact, double-buffered, transferable); the *render layer* (not the boundary) is where the architecture still couples 106k-neuron loops to frames.

---

## 2. Current Runtime Architecture

```text
[Blocking <script src>] data/circuits/fafb_circuit.js (49.5 MB) + mcns_circuit.js (8.3 MB)   VERIFIED L748–749
        │  parses JSON literals on the MAIN THREAD before module eval
        ▼
window.__FAFB_CIRCUIT__ / __MCNS_CIRCUIT__
        │
        ▼
makeSim(key) ──builds sim state (V, W, W0b, E, heat, spikes, DA…) + _warpInitPayload (typed-array copies)
        │
        ▼
frame(now)  ── rAF, fly_demon_3d.html L2912                     ┊ every frame:
        │  stepParticles (320 particles), updateTail (TubeGeometry realloc!),   ┊   physics + alloc
        │  readSensors / readVisualField
        ▼
_simParity gate (every 2nd frame = ~30 Hz brain cadence)   VERIFIED L2913, L2954
        │
        ├─ BrainBackend.warpLoopTick()      ── if Warp owns the brain: rAF-paced POST /tick (compact state)
        ├─ brainTick(sens, visual, …)       ── ROUTER  VERIFIED L2626:
        │     ├─ backend==="warp"  → latch inputs, return (no JS sim)
        │     ├─ worker healthy    → postMessage{tick, s[7], visual[800], motorDrive, exAmp, lr, dt}  (throttled 33 ms)
        │     └─ else              → IN-FRAME fallback: full 106k/553k tick on the RENDER THREAD (loud badge/banner)
        │
        ▼
brain_worker.js (dedicated Worker)                                  [off main thread]
   inject channels → 106,765-neuron LIF → 553,807-edge fan-out gather →
   eligibility traces → applyLearning (every tick w/ lr) → heat decay →
   updateTraces → publish  VERIFIED L295–355
        │  postMessage {state: spikes u8[106,765] (transferable), dav, mrs, mb,
        │                heat u8[N] every tick, W f32[553,807] + packed top-K every 12th}
        ▼
page onmessage  VERIFIED L2496–2555: zero-copy ping-pong buffer pools;
   mirrors → s.spikes / s._eHeat8 / s._bwWAvail / s._bwTopKBuf
        │
        ▼
frame() render side (main thread):
   updateVisuals(dt)  VERIFIED L3182–3404
     ├─ cableEdgeTick / legacy chord recolor (per sim tick)      ~72k seg colors / 12k chord colors
     ├─ node glow: instance matrices, 1/7 of neurons per frame (strided) → FULL ~6.8 MB upload anyway
     ├─ NT pulse colors (layered only)
     ├─ jet.step(spikes) (anat): 106k decay/frame + recolor ~15×/s
     └─ tick%6==0 → refreshWeightOverlay(): worker top-K unpack (cheap) OR
                     full 553k-edge scan (fallback/replay) + 180-segment overlay update
        │
        ▼
renderer.render(scene, camera)  →  GPU (Three.js WebGL)
```

---

## 3. Anatomical 3D Lifecycle (exact)

| # | Step | Where | Thread | Blocking? | Cost (evidence) |
|---|------|-------|--------|-----------|-----------------|
| 1 | Click `#btnAnat` (L364) | handler L4200 | main | – | – |
| 2 | `anatMode=!anatMode`; legend toggle | L4201–4203 | main | no | – |
| 3 | `BrainBackend.prepareAnat()` | L4033 module | main | **suspends JS worker first** (`terminate()`, L3871–3877) | worker loss + rebuild |
| 4 | availability: 2 s probe `/health` w/ 60 s negative TTL; `?bw=off` forces unavailable (L4138) | L4113–4141 | main (async) | no | 2 s worst case |
| 5a | unavailable → explicit modal `[Use JS Worker]/[Cancel]` (L4049–4082) — **no silent fallback** | – | main | user-gated | – |
| 5b | available → `suspendJsWorker` → POST `/init` with base64 blobs of the **real circuit arrays** | `BrainBackend.start` | main (async) | payload build ~4 MB→base64 synchronous | INFERRED tens of ms |
| 6 | on success → `cameraTarget/orbit` set → `ntClassCounts` census → **`buildBrain(circuit)`** | L4235 → L1351 | main | **YES — one long synchronous block** | VERIFIED construction below |
| 7 | `buildBrain`: positions (`anatFillPositions`, measured FAFB synapse coords, `fly_brain_positions.bin` 730 KB), 106k-instance `InstancedMesh`, per-neuron color loop w/ `ntClassify` (cached, L1176) + cell-type map lookup, **`buildCableFor`** (6,000 edges → per-edge polyline from real waypoints, millions of vertices, `chain` array alloc per edge), labels (canvas textures), hulls | L1351–1530, L2140–2260 | main | **YES** | VERIFIED; MEASURED entry freeze >2.5 s during A/B testing (`WARP_ANAT_INTEGRATION.md` watchdog incident) |
| 8 | steady state: every 2nd frame `brainTick` routes to Warp POST or latches; per-tick/per-frame color+matrix work (§6) | L3182–3404 | main | per-frame | §7 table |
| 9 | leave: toggle off → `BrainBackend.leaveAnat()` (stop Warp / restore JS worker, L4085–4093) → `buildBrain` again (layered) → **another synchronous rebuild** | L4293 | main | **YES** | VERIFIED |
| 10 | dataset switch while anat: `switchDataset` → `BrainBackend.datasetSwitch` (stop backend) → cached `makeSim` reuse → `buildBrain` (L4154–4186) → re-probe → re-init Warp with guards | L4154+ | main | **YES (build) + async (init)** | dimension guards verified live (FAFB 106,765/553,807; MCNS 52,849/160,000) |

Note: `buildBrain` is called on 4 paths (L1857 REAL_ANAT late load, L4133, L4235, L4293) — every mode transition pays the full synchronous rebuild.

---

## 4. Simulation Backends

| Backend | Where runs | How started | Tick rate | State size | Main-thread work | Fallback behavior |
|---|---|---|---:|---|---|---|
| **In-frame fallback** (legacy) | render thread, `brainTick` body | automatic when worker broken; forced by `?bw=off` | 30 Hz (every 2nd rAF) | owns full sim in-page | **entire 106k/553k tick** | it *is* the fallback; LOUD badge/banner/msg (L2680–2690) |
| **JS Worker** (`brain_worker.js`) — default | dedicated Worker | `makeSim` → `_bwStart()` (L2455–2495), `init` w/ transferables | posts ≤30/s; consumes ~11/s (F1 MEASURED); sustains ~80/s | worker-owned; page gets compact mirrors | input latch + message consume (pool recycling) | watchdog: 1 restart after 5 s silence → `_bwBroken` → loud fallback (L2560–2567) |
| **Warp CUDA** (`backend_warp/warp_server.py`) — experimental | Python sidecar + GPU | `BrainBackend.prepareAnat` auto-select **only in anat mode**; explicit modal if down | rAF-paced POST; GPU tick 2–3 ms, rtt P50 13–38 ms (MEASURED) | 24 B header + spikes + W every 12th ≈104 KB/tick (MEASURED) | HTTP/JSON+base64 ticks + state apply | none silent: explicit UNAVAILABLE modal; `?warp=off` disables |
| Experiment workers (`experiment_worker.js`) | Workers ×N | per experiment | own cadence | own | none | n/a |
| **Warp status overall** | – | – | – | – | – | **production-connected for anat only** (auto-select + top-bar chip + guards); JS worker remains the global default; not a replacement, per `WARP_ANAT_INTEGRATION.md` |

Backend exclusivity is enforced structurally: entering anat suspends the JS worker *before* probing; `brainTick` early-returns when backend==="warp" (L2633–2640); leaving stops Warp then `resumeJsWorker` (L3973–3978).

---

## 5. Per-Tick Data Flow (one JS-worker tick, 33 ms cadence)

| Stage | File:line | Thread | Size/work | Alloc | Can delay rendering? |
|---|---|---|---|---|---|
| Input latch | page L2663–2678 | main | 7 floats + 800-bin visual copy into `_bwLast` | no (reused) | no |
| postMessage tick | L2676–2678 | main→worker | ~3.3 KB structured clone | tiny | no |
| stimulus envelope | worker L296–298 | worker | scalar | no | no |
| channel injection | worker `brainTick` | worker | 106k-loop subset (sensory layers) | no | no |
| LIF update | worker | worker | 106,765 neurons, f64 | no | no |
| edge fan-out gather | worker | worker | **553,807 edges**, branchy `prev[src]→V[dst]` | no | no |
| eligibility traces | worker | worker | 553,807 × decay | no | no |
| applyLearning | worker (when lr≠0 → every tick from page) | worker | 553,807 × gated ΔW | no | no |
| heat decay | worker L327–329 | worker | 106,765 | no | no |
| publish | worker L331–355 | worker→main | spikes 106 KB + heat 106 KB (every tick); W 2.2 MB + top-K ~5 KB (every 12th) | pool `new Uint8Array(buf)` + set (copy within worker) | consume is O(1) on main |
| page consume | L2496–2555 | main | mirror swap + buffer return | no (transferables) | no |
| presentation | L3182–3404 | main | §6/§7 | **partially yes** | **yes** |

**Verdict:** stages 1–11 never block rendering. What can delay rendering is everything after "page consume" — plus the tick#12 W copy (2.2 MB message, MEASURED contributor to F1's slow consumption).

---

## 6. Per-Frame Data Flow (render side)

**EVERY FRAME**
- `stepParticles` (320 particles), `updateTail` — **new TubeGeometry(18×8) + dispose of old, every frame** (L3046) — allocation + GPU upload churn.
- `applyCamera`, HUD writes (`fps`, `bestVal`), `updateHUD` DOM.
- `updateVisuals`: node-glow strided instance matrices (1/7 of neurons, but `instanceMatrix.needsUpdate` re-uploads the **full 106,765×16-float ≈ 6.8 MB** buffer each frame; no `DynamicDrawUsage`/`updateRange` in file — grep empty) — VERIFIED L3360–3371.
- `jet.step(spikes)` in anat: 106k decay loop every frame; recolor every 4th frame (~15 Hz) incl. sampled p95 (`arr.sort`) + 106k color write (L1435–1460).
- `renderer.render` (Three.js full pass, additive-blended ~6k cables + 106k instances + hulls + labels).

**EVERY SIMULATION TICK (every 2nd frame, ~30 Hz)**
- `cableEdgeTick` → `fillCableColors` over `segIdx` (~6,000 edges, ~72k segment vertices incl. per-segment wave math and `setXYZ` ×2) + `colAttr.needsUpdate` (L2247–2301).
- or legacy chord recolor loop (~12k chords × 2 vertices, L3318–3357).
- `lcPanelFrame`, `updateTraces` (only when no live worker mirror).
- `BrainBackend.warpLoopTick()` when Warp owns (rAF-paced POST).

**EVERY 6TH TICK (~5 Hz)**
- `refreshWeightOverlay()`: worker branch = unpack packed top-K + write 180×2 vertices (cheap). **Fallback/replay branch = full 553,807-edge score scan + min-heap + sort** (L3424–3440) — a ~10–20 ms main-thread spike when the worker is broken or replaying.

**EVERY WORKER MESSAGE (~11/s measured)**
- Mirror swap + up to 3 buffer returns; on every 12th message a 2.2 MB W copy + top-K unpack.

**ON DATASET LOAD / MODE SWITCH**
- Blocking `<script src>` circuit payloads at boot (49.5+8.3 MB parsed on main); `makeSim` typed-array construction; full `buildBrain` rebuild (§3).

**ON USER INTERACTION**
- Orbit/pan; selection raycast on instanced nodes (event-driven); neuron inspection overlay (event-driven).

---

## 7. Main-Thread Workload Table

| Operation | Location | Frequency | Approx work | Main thread | Alloc | GPU upload |
|---|---|---|---|---|---|---|
| Circuit payload parse (boot) | `<script src>` L748–749 | once | 57.8 MB JSON literals | YES | YES | no |
| `makeSim` state build | L2401+ | per dataset load | ~10+ typed arrays of N/NE | YES (sync) | YES | no |
| `buildBrain` full rebuild | L1351–1530 | every anat enter/leave/switch | 106k instances + ~6k-edge cable geometry (millions of verts) + labels/hulls | YES (sync, long) | YES | initial uploads |
| `buildCableFor` waypoint walk | L2140–2260 | inside every anat rebuild | per-edge `chain` array alloc × 6,000 | YES | YES | no |
| node-glow matrices | L3360–3371 | every frame | 15k matrix updates → **full 6.8 MB buffer upload** | YES | no | YES (full) |
| `jet.step` decay+recolor | L1435–1460 | decay/frame; recolor ~15 Hz | 106k ×2 loops + sampled sort | YES | small (recolor) | YES (instanceColor) |
| cable recolor | L2247–2301 | every sim tick (~30 Hz) | ~72k vertex colors | YES | no | YES (color attr) |
| legacy chord recolor | L3318–3357 | every sim tick (no cables) | ~12k chords | YES | literals per vertex (`c = [r,g,b]` arrays) | YES |
| `refreshWeightOverlay` fallback scan | L3424–3440 | every 6th tick when worker broken/replaying | 553,807-edge scan + heap | YES | 2 `[score,i]` per push | small |
| `updateTail` TubeGeometry | L3046 | every frame | geometry rebuild+dispose | YES | YES (GPU churn) | YES |
| perf HUD 1 Hz | L4311–4360 | 1 Hz | DOM text | YES | no | no |
| worker consume | L2496–2555 | ~11–30 Hz | O(1) swaps | YES (tiny) | no | no |
| Warp tick POST/apply | BrainBackend loop | ~30 Hz | 24 B+bitmap JSON/base64 + view writes | YES | per-tick strings | YES (instance attrs) |

---

## 8. Simulation → Renderer Boundary

**What crosses today (JS-worker path):** spike bitmap `u8[106,765]` (106 KB) + DA/motor scalars + heat `u8[N]` (106 KB) every tick; `W f32[553,807]` (2.2 MB) + packed top-K (~5 KB) every 12th tick. All transferable, double-buffered, pool-recycled — **zero-copy in both directions**, with starvation recovery (worker re-allocates after ~1 s; VERIFIED L330–335 comment, L356–375).

**What does NOT cross:** V, E (eligibility), traces, plasticity internals, positions/geometry (static, page-owned from measured-anatomy files).

**Warp path:** 24-byte header + spike bitmap + W-every-12th ≈ **104 KB/tick**; `full_state_path: false` (MEASURED `/health`).

**Classification (§ task 8):**
- **A. simulation-only (correctly kept off-page):** V, W, E, traces, learning state.
- **B. visualization (legitimately crosses):** spikes, heat, DA, motor rate, top-K plastic overlay, selected edges (event-driven).
- **C. UI-only:** tick counter, badges, telemetry.
- **D. transferred but unnecessary:** the every-12th-tick **full W array (2.2 MB)** — the page uses it only for `refreshWeightOverlay`'s fallback scan and weight inspection; the packed top-K already carries the render-relevant delta. F1 measured the W-publish cadence as the dominant consumer bottleneck. It is provenance/useful for charts, but it is the one item in D.

Byte math per second at healthy cadence: ~30 × (106+106) KB ≈ 6.4 MB/s steady + 5/s × 2.2 MB ≈ 11 MB/s spikes-peak — modest, but the 2.2 MB messages deserialize as pool swaps (cheap) yet still gate the worker's next tick under main-thread saturation (F1: effective 11/s).

---

## 9. Current Hang Mechanism (evidence-based causal chain)

```text
Click Anatomical 3D
  ↓ (1) synchronous scene rebuild: buildBrain + buildCableFor
  │      multi-second single-block main-thread stall   [VERIFIED code; MEASURED >2.5 s freeze in A/B]
  ↓ (2) steady state: 30 Hz brain cadence drives per-tick color work
  │      ~72k cable colors + (layered) chord recolor  [VERIFIED]
  ↓ (3) per frame: 6.8 MB full instance-matrix re-upload (no updateRange)
  │      + 106k jet decay + TubeGeometry realloc/dispose  [VERIFIED]
  ↓ (4) every 6th tick: if worker broken/replaying → full 553k-edge scan  [VERIFIED]
  ↓ (5) main thread saturated → state messages consumed slowly
  │      → worker effective 11 ticks/s, ~66% long-task wall time  [MEASURED F1]
  ↓ (6) adaptive DPR governor lowers resolution but cannot recover the budget
  ▼
Visible symptom: multi-second freeze on entry, then 12–20 fps with hitches.
```

With Warp active, stage (5)'s simulation cost leaves the CPU (0 long tasks in clean windows, MEASURED), but stages (1)–(4) remain — consistent with Warp-arm anat still measuring ~12 fps rAF under throttling. **Conclusion: the hang is initialization + presentation-layer, not neural computation.** If the worker is ever broken (watchdog exhausted) or `?bw=off`, add stage (4b): the full tick itself on the render thread — a guaranteed hard hang, loud by design.

---

## 10. Comparison With Eon-Style Architecture

**REFERENCE ARCHITECTURE (conceptual, per the task brief; not claimed to be Eon's implementation):** simulation process (brain+body) → compact state → renderer/viewer → GPU; sim and render cadences decoupled.

| Concern | Current system (FACT, this repo) | Eon-style target (REFERENCE) | Difference | Evidence |
|---|---|---|---|---|
| Brain compute | Worker (default) / Warp sidecar (anat) / in-frame fallback | dedicated sim process | equivalent in spirit; fallback path violates it | §4 |
| Body physics | **main thread, in `frame()`** (320 particles) | sim process | **misplaced** | L2940 |
| Sim cadence | fixed 30 Hz parity gate | sim-rate | comparable | L2913/L2954 |
| Render cadence | rAF, DPR governor 0.75–max | vsync | same | perfLoop |
| State boundary | compact, transferable, double-buffered (W every 12th = partial violation) | compact-only | **nearly compliant** | §8 |
| State size | 106 KB+106 KB/tick + 2.2 MB/12th | compact | W array is the outlier | §8 |
| Main-thread work | per-frame color/matrices/scans + sync rebuilds; body physics | ~zero sim-derived work | **large residual** | §7 |
| GPU work | full-buffer uploads, additive cables, TubeGeometry churn | minimal uploads | **upload-pattern gap** | §7 |
| DOM work | 1 Hz HUD + msg toasts | low | fine | perfLoop |
| Fallback behavior | loud in-frame simulation | n/a | differs by design (characterization mode) | §4 |
| Sim/render coupling | **coupled via the 30 Hz parity gate**: color work and tick input ride `frame()` | decoupled queues | **core structural difference** | L2954–2972 |

---

## 11. Current vs Target Architecture

**Diagram A — CURRENT** = §2 diagram (verbatim).

**Diagram B — TARGET (not implemented):**

```text
UI/controls
   │  intents only
   ▼
SIMULATION PROCESS (Worker today; Warp-capable sidecar for anat)
   brain tick (106k/553k) + body physics (moved off main) + heat decay
   │  compact render state ONLY: spike bitmap + heat u8 + scalars + top-K packed
   │  (full W off the hot path — pulled explicitly for inspector views)
   ▼  double-buffered transferables (unchanged — already correct)
RENDER-WORKER / OFFSCREEN or main-thread thin compositor
   ▼  preallocated GPU arenas, partial updates (updateRange), static geometry
THREE.js WebGL2
   ▼
GPU (106k instanced nodes, ~6k cables, hulls, labels)
```

Minimal deltas implied by Diagram B (for the record, not a plan): build brain geometry off-thread or in idle slices; make per-tick color data worker-authored; partial buffer uploads; move body physics into the sim process; drop per-frame TubeGeometry. **Nothing here has been implemented in this audit.**

---

## 12. Bottleneck Map

**CRITICAL (can directly cause the hang)**
- C1. Synchronous `buildBrain`+`buildCableFor` rebuild on every anat enter/leave/dataset switch — multi-second single-thread block. [VERIFIED; MEASURED >2.5 s]
- C2. In-frame fallback active (worker broken or `?bw=off`): full 563k-edge tick at 30 Hz on the render thread. [VERIFIED; MEASURED F1]
- C3. `refreshWeightOverlay` full 553k-edge scan every 6th tick whenever the worker top-K path is unavailable (broken worker, replay). [VERIFIED]

**IMPORTANT (hurts fps, unlikely to fully hang)**
- I1. Full ~6.8 MB instance-matrix (and color) re-uploads every frame; no `DynamicDrawUsage`/`updateRange`. [VERIFIED]
- I2. Per-tick cable recolor (~72k colors @30 Hz) + per-frame `jet.step` 106k decay. [VERIFIED]
- I3. Per-frame `TubeGeometry` rebuild/dispose in `updateTail`. [VERIFIED; proposal F3]
- I4. Full-W 2.2 MB publish every 12th tick throttles the worker under main saturation (F1: 11/s effective). [MEASURED]
- I5. Body physics (`stepParticles`) + intent animation on the render thread each frame. [VERIFIED]

**SECONDARY**
- S1. Blocking boot parse of 57.8 MB circuit payloads. [VERIFIED; proposal F2]
- S2. Per-vertex literal allocations in the chord recolor loop; `chain` arrays in cable build. [VERIFIED]
- S3. Cell-types JSON 52.5 MB fetch (arbor features; not the anat tick path). [VERIFIED; proposal F5]

---

## 13. What Warp Would and Would Not Fix

**Fixes (MEASURED):** neural tick off the main thread (GPU 2–3 ms, rtt P50 13–38 ms); zero long tasks in clean windows; strict backend exclusivity + explicit-unavailable UX already implemented.
**Does NOT fix:** C1 synchronous rebuilds (they precede backend start); C3 fallback scan; I1–I3, I5 render-thread presentation and physics; boot parse S1. Warp also does not change the JS-worker default for non-anat modes.

## 14. What P3 Would and Would Not Fix

P3 scope (per this repo's definition) = heat decay + top-K ranking moved into `brain_worker.js` — **already implemented**: worker heat decay (L327–329) and worker `topKChanges` (every 12th tick, L341–355) with a page unpack path (`drawOverlayEntries`). Therefore P3 already eliminates: the page's 106k heat decay mirror cost and — **only when the worker is healthy** — the 553k overlay scan.
P3 does **NOT** fix: C3's replay/broken-worker branches (local scan retained by design), C1, C2, I1–I5. P3's gains are conditional on worker health; Warp's on sidecar health; the render-side costs are unconditional.

---

## 15. Unknowns (cannot be established from the repository)

1. Absolute anat-entry freeze duration on target hardware (only the >2.5 s watchdog incident and 177–228 ms steady p50 frames are measured; a clean-foreground build-cost measurement was never captured — occlusion-throttled preview contaminated rAF numbers).
2. Exact cable vertex count in anat mode (sum of per-edge waypoints in `fly_brain_edge_paths.bin` — readable but not counted here; INFERRED "millions of vertices").
3. Whether GC pressure from `updateTail`/`chain` allocs produces visible hitch periodicity at runtime (code-verified alloc; magnitude unmeasured).
4. Real-world behavior on machines without the RTX 3500 Ada / with >2 backends contending.
5. Whether the preview browser's occlusion throttling masks or exaggerates any steady-state number (documented contaminant in `WARP_ANAT_INTEGRATION.md` §9).

## 16. Recommended NEXT INVESTIGATION ONLY (no implementation plan)

1. **Measure `buildBrain`+`buildCableFor` wall time directly** (performance.mark around the call; one line, removable) for FAFB and MCNS, entry vs switch. Converts C1 from INFERRED+incident to MEASURED.
2. **Long Tasks API capture** (PerformanceObserver, 30 s per arm) in a foreground tab: in-frame fallback vs worker vs Warp in anat — quantifies C2/C3/I1–I3 shares of main-thread time.
3. **GPU-timing probe** on the two hot uploads (instanceMatrix, cable color attr) — e.g., toggle the strided-matrix loop off in a scratch copy to bound I1.
4. **Count cable vertices** (one `console.log` of `acc` in a scratch run) to size the geometry for any future off-thread build decision.
5. Confirm replay-mode overlay cost (C3's replay branch) with the E9 replay at FAFB scale.

---

```text
FILES MODIFIED: NONE
PRODUCTION BEHAVIOR CHANGED: NO
```
