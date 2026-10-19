# Animation Performance Proposal — "Maxwell's Demon: Inside the Fly Brain"

**Status:** PROPOSAL ONLY — no code was changed to produce this document.
**Date:** 2026-09-22 · **Branch:** `deployment/phase-02`
**Scope:** why the lab page (`fly_demon_3d.html`) animation hangs/freezes, and how to make it fast. Covers boot cost, per-frame cost, and the server. Does not cover experiment math (that lives off-thread already).

---

## 0. Executive summary

The page is architecturally healthy in the places that matter most: the 106k-neuron LIF tick already runs in `brain_worker.js` off the render thread (patch 19), experiments run in `experiment_worker.js`, and there is already a perf HUD with an adaptive-resolution governor (patch 20). What remains are **five concrete, fixable cost centers**:

| # | Finding | Class (see §1) | Where it hurts |
|---|---------|----------------|----------------|
| F1 | Silent fallback to in-frame brain sim (563k synapses × 30 Hz on the render thread) | VERIFIED code, INFERRED impact | whole-page stutter whenever the worker isn't live |
| F2 | ~107 MB of boot assets re-fetched (`no-store`) + ~40 MB of it parsed on the main thread, every reload | VERIFIED code, INFERRED impact | multi-second freeze at every page load |
| F3 | Per-frame allocation churn (`TubeGeometry` rebuilt & disposed **every frame**, Map/closures/literals) | VERIFIED code, INFERRED impact | periodic GC hitches during animation |
| F4 | Recurring main-thread scans (563k-edge ranking every 6th frame; 106k-neuron heat decay every frame; ~72k cable colors at 30 Hz; full 6.8 MB instance-matrix upload per frame) | VERIFIED code, INFERRED impact | steady frame-budget tax + periodic spikes |
| F5 | Server re-parses the 53.8 MB cell-types JSON **per arbor API call** | VERIFIED code, INFERRED impact | seconds-long stall on arbor/family clicks |

Everything proposed below is reversible, presentation-layer or I/O-layer work. None of it touches simulation, learning, or experiment math.

---

## 1. Evidence classification legend

Every claim in this document carries one of these tags:

- **VERIFIED** — directly observed in source during this audit session (file + line given). States what the code *does*.
- **VERIFIED-DOC** — asserted by a repository document or test that itself claims verification (cited).
- **INFERRED** — a mechanistic consequence of VERIFIED code whose *magnitude* has not been measured at runtime. The measurement plan (§7) exists precisely to convert these into measured facts.
- **PROPOSED** — a recommendation only; not implemented.
- **EXTERNAL** — from outside this repository (e.g., upstream flybody documentation or user-supplied research); not verified here.

No claim is presented as *measured* unless a runtime measurement exists. Nothing in this document has been runtime-measured yet.

---

## 2. Current animation pipeline (inventory)

### 2.1 Per rendered frame (target 60 fps = 16.6 ms budget)

`frame()` — `fly_demon_3d.html:2744` — runs, in order (all VERIFIED):

1. `stepParticles(dt, noise, doorH)` (L2674): explicit integration + wall/door bounces + crossing detection for up to `PMAX = 600` instanced particles (L871–877), plus pairwise collisions via a uniform grid rebuilt **every frame** with `new Map()`, a `P.forEach` closure, and an allocated-but-unused `new THREE.Vector3()` (L2708–2712).
2. Sensor reads: `tempStats()` (L2715), `readSensors()` (L2826), `readVisualField()` (L2839) — 800-bin hex retinotopy over the particle set by default (`Retinotopy.readVisualFieldRetinotopy`, L2831).
3. Brain tick, gated to **30 Hz** (`_simParity` every 2nd frame, patch 18, L2752–2756):
   - Preferred path: `sim._bw.postMessage({type:"tick", …})` → `brain_worker.js` advances the full connectome (N ≈ 106k neurons, NE ≈ 563k fast edges per the worker's own header) and publishes the spike bitmap back as **zero-copy transferables** from a reused buffer pool (brain_worker.js header + `onmessage`, VERIFIED). Weights publish every 12 ticks.
   - **Fallback path:** if the worker is absent/broken (`bwLive` false), the **old in-frame `brainTick` (L2485) runs the same full N+NE loops on the render thread at 30 Hz** (L2786–2800). This fallback is by design (brain_worker.js header: "transparently falls back… e.g. file:// pages") and is **silent** — the only indicator is the perf HUD's `bw 0/s` counter.
4. `lcPanelFrame(dt)` (L3813, called in the same 30 Hz gate): neuropil heat accumulation looping **every region-member array (~106k entries total) per call**, plus per-shell uniform updates.
5. `actuate`, episode bookkeeping, then `updateVisuals(dt, doorH)` (L3012):
   - 320–600 particle instance matrix+color writes (cheap);
   - `updateWallGeometry(openHalf)` (L830) — property writes only, cheap;
   - **`updateTail()` (L2863): `tailMesh.geometry.dispose(); tailMesh.geometry = new THREE.TubeGeometry(curve, 18, 2.5, 8, false)` — every frame (L2875–2876)**;
   - `updateFlyTurn`, devil hover/intent animation (vector math, cheap);
   - `_eHeat` decay: `for (i = 0; i < sim.N; i++)` over **all ~106,765 neurons, every frame** (L3093–3095);
   - edge recolor: cable mode writes ~72k cable segments ×2 endpoints at 30 Hz (`cableEdgeTick`, gated `(tick & 1) === 0`, L3116–3124 — the code comment itself notes the cost); legacy chord mode writes ~6k segments per frame (`segIdx` budget = `NE/6000`, L1429–1435) using a **fresh `[r,g,b]` array literal per segment**, and rebuilds a `Set` per frame when a neuron/neuropil is selected (L3133–3135);
   - node glow: strided 1/7 of neurons per frame (good), but `nodeMesh.instanceMatrix.needsUpdate = true` **uploads the entire ~6.8 MB instance matrix buffer every frame** regardless (L3167–3187);
   - dopamine pulse recolor loops (bounded, cheap);
   - **`refreshWeightOverlay()` every 6th frame (L3262): a full scan of all `sim.NE` ≈ 563,942 edges** with a min-heap, a final sort, and overlay buffer writes (L3264–3320).
6. `updateHUD` (L3288) + `expFrame` (L3392): ~20 `textContent` DOM writes per frame combined (each `expFrame` alone sets 13 panel nodes, L3409–3438), plus two ~320-particle metric loops.
7. `sciFrame(dt)` (L4232): heatmap canvas push/draw at 10 Hz, integrity refresh every 2–4 s.
8. `renderer.render(scene, camera)` — `antialias: true`, `setPixelRatio(min(devicePixelRatio, 2))` (L733–734), adaptive DPR governor 0.75–2.0 with hysteresis (patch 20, L3676–3757) driving a separate `perfLoop` rAF that reports avg ms / worst gap / hitches / worker ticks / heap.

### 2.2 Boot (page load) — all VERIFIED as module-load IIFEs/script tags

| Asset | Size | Loaded | Parse cost |
|---|---|---|---|
| `data/circuits/fafb_circuit.js` | 31.3 MB (VERIFIED-DOC: PAYLOAD_SEPARATION_PLAN.md) | **blocking classic `<script>`** (L697) | main-thread JS parse, every load |
| `data/circuits/mcns_circuit.js` | 8.7 MB (VERIFIED-DOC) | **blocking classic `<script>`** (L698) | main-thread JS parse |
| `fly_brain_edge_paths.bin` | 40,610,160 B | eager fetch IIFE, `cache:"no-cache"` (L1755–1757) | none (Int16Array view) |
| `fly_brain_edge_paths.json` | 12,881,026 B | same IIFE | main-thread `r.json()` |
| `fly_brain_celltypes.json` | 53,804,833 B | **eager** fetch IIFE, `cache:"no-cache"` (L1777) — despite "optional" catch | **main-thread `r.json()` of 53.8 MB** |
| `data/skeletons/*` | small | eager IIFE (L1813–1814) | small |
| hulls / positions / meta | small | eager fetches (L1670–1727) | small |

And the launcher (`launch_fly_demon_3d.py`, full file read) sends **`Cache-Control: no-store` on every response** (documented rationale: a stale cached `experiment_worker.js` once survived a bug fix) and implements **no gzip**. Net effect: **every reload re-transfers ~107 MB from disk and re-parses ~40 MB of JS + ~67 MB of JSON on the main thread.**

### 2.3 Server-side (launcher)

`_arbor_families` / `_arbor_family` (L~140–260 of the launcher) do `json.loads(ct_path.read_text())` on `fly_brain_celltypes.json` (53.8 MB) **inside each request handler**. VERIFIED.

### 2.4 Non-issues (checked, fine)

- Center brand animation: static WebP `<img>` + CSS animation (L300, L241–245) — compositor-driven, not a hang source.
- Plots window: separate window/process over `BroadcastChannel`; experiment computation is in `experiment_worker.js` (created at L4364 with a cache-busting `?ts=`).
- Node glow striding, buffer ping-pong in the brain worker, DPR governor: already-optimized, keep.

---

## 3. Findings (ranked)

### F1 — Silent in-frame brain-sim fallback — **VERIFIED (code) / INFERRED (impact)**
When the brain worker can't start or errors (`sim._bwReady` false / `_bwBroken` true — e.g. a `file://` open, a worker exception, or a deploy where `brain_worker.js` didn't ship), `frame()` transparently runs the **full connectome LIF tick (≈106k neurons + ≈563k edges) on the render thread at 30 Hz** (L2786–2800, L2485).
- INFERRED: a 563k-edge inner loop costs several ms per tick → guaranteed sub-30 fps and 40 ms+ hitches, i.e. exactly "so much hanging".
- This is the **first thing to check** whenever the animation stutters: perf HUD shows `bw 0/s`.

### F2 — Boot: ~107 MB re-fetched + ~40 MB main-thread parse, every reload — **VERIFIED (code) / INFERRED (impact)**
Blocking 31.3+8.7 MB circuit scripts (L697–698) + eager 53.8 MB `r.json()` (L1777) + 40.6 MB edge-path bin, all under `no-store` from the launcher **and** `cache:"no-cache"` in the page.
- INFERRED: multi-second white/frozen page on every reload; the 53.8 MB JSON.parse alone is plausibly 1–3 s on a mid laptop, with a large transient double-memory spike.
- Note the tension: `no-store` exists to prevent **stale app code** (documented in the launcher), but it is currently applied to **immutable data payloads** too, where it buys nothing.

### F3 — Per-frame allocation churn — **VERIFIED (code) / INFERRED (impact)**
- `updateTail` disposes and re-`new`s a `TubeGeometry` every frame (L2875–2876) — allocation + GPU buffer upload + GC pressure at 60 Hz. This is the single most wasteful line in the render path.
- `stepParticles` rebuilds the collision `Map` via `P.forEach` closure per frame and allocates an unused `Vector3` (L2708–2712).
- Chord recolor allocates a `[r,g,b]` literal per segment per frame; `inSet` rebuilt per frame under selection.
- INFERRED: steady garbage-generation → periodic major-GC pauses → the "hangs for a blink every few seconds" texture.

### F4 — Recurring main-thread scans — **VERIFIED (code) / INFERRED (costs)**
- `refreshWeightOverlay`: 563,942-edge scan + heap + sort every 6th frame (≈10 Hz) — INFERRED low-single-digit ms each firing, ~5–15 % of frame budget in bursts, with `[score,i]` pair allocations.
- `_eHeat` decay over 106,765 neurons every frame (L3093–3095) — INFERRED ~0.2–0.5 ms/frame of pure overhead; this data lives in the worker's domain anyway.
- `lcPanelFrame` region loops (~106k reads at 30 Hz) — INFERRED small but redundant.
- Full `nodeMesh.instanceMatrix` re-upload (~106,765 × 64 B ≈ 6.8 MB) per frame although only 1/7 of instances change (L3187) — INFERRED ~400 MB/s of PCIe traffic; most punishing on integrated GPUs.
- Cable recolor ~72k×2 `setXYZ` calls at 30 Hz — already halved by the authors (comment L3116), still the largest color-write path.

### F5 — Server re-parses 53.8 MB JSON per arbor request — **VERIFIED (code) / INFERRED (impact)**
`json.loads` of `fly_brain_celltypes.json` inside `_arbor_families`/`_arbor_family` per request. INFERRED 1–3 s stall per arbor-family click.

### F6 — 60 Hz DOM writes — **VERIFIED (code) / INFERRED (impact)**
~20 `textContent` writes/frame across `updateHUD` + `expFrame` → per-frame style recalc. INFERRED small-to-moderate; trivially batchable.

---

## 4. Proposed fixes (all items PROPOSED)

### Tier 1 — quick wins (hours–days each, low risk)

| ID | Fix | Addresses | Risk notes |
|----|-----|-----------|------------|
| P1 ✅ **DONE** | **Make the fallback loud**: perf HUD badge + banner when `bwLive` is false ("brain sim IN-FRAME — expect stutters"). | F1 | none — pure diagnostics; do this first |
  **Implemented + verified (fly_demon_3d.html):** red `#bwBadge` badge + `#bwFallbackBanner` + "· IN-FRAME" perf-HUD suffix, refreshed outside the `perfHud.on` gate; one-time `msg()` + `console.warn` announce per fallback episode. Forced-fallback hook `?bw=off`. **Fallback cost characterized:** headless run of the exact fallback math against the real FAFB circuit (106,765 neurons / 553,807 synapses) = **mean 33.0 ms / min 23.5 ms per tick** → ~990 ms main-thread time per second at the 30 Hz sim gate (~59% of frame budget) before rendering. Browser A/B: fallback 53.5ms·bw 0/s·IN-FRAME vs worker 38.3ms·bw 13/s; badge/banner/HUD/announce all confirmed in-browser. |
| P2 ✅ **DONE** | **Tail geometry reuse**: preallocate one `TubeGeometry`; update vertex positions in place from the curve at 20–30 Hz; never dispose per frame. **Implemented in `fly_demon_3d.html`:** the constructor's TubeGeometry (18×8, 171 verts) is persistent and never disposed; `updateTail` mutates `tailCurve.points` in place (no per-frame Vector3/curve allocations) and rewrites position+normal buffers via `p2Retube`, which calls three.js' own `computeFrenetFrames`/`getPointAt` in TubeGeometry's generation order — bit-identical geometry, proven per-frame over 180 deterministic frames against a full-rebuild reference. Arc-length cache invalidated via `needsUpdate=true` before sampling (protocol cross-checked against three.js itself, including a stale-cache counter-example proving the flag is load-bearing); uv/index buffers untouched; `position/normal.needsUpdate` flags set per frame. `tests/p2_tail_parity.test.js` (4 tests). | F3 | visual parity trivially checkable |
| P3 | **Move `_eHeat` decay and `refreshWeightOverlay`'s top-K into `brain_worker.js`**: the worker already owns `spikes`, `W`, `W0` and already publishes buffers every 12 ticks; ship a heat snapshot and the top-180 plastic-edge list with that publish. Page code becomes buffer writes only. | F4 | top-K ranking must reproduce the current ranking exactly (same score formula, L3285–3296) |
| P4 ✅ **DONE** | **`stepParticles` hygiene**: reuse a preallocated grid (typed-array buckets or a cleared persistent Map), plain `for` loops, delete the unused `dvn`. **Implemented in `fly_demon_3d.html`:** module-level typed-array uniform grid (count → prefix-sum bases → scatter, cell size 8 and key formula unchanged); zero per-frame allocation; pair-visit order provably identical to the legacy Map (cell visit order and per-bucket order are both first-touch = ascending particle index in both), verified bit-identical trajectories over 5 seeded scenarios × 120 frames incl. door + high-turbulence collisions (`tests/p4_particle_parity.test.js`, 8 tests; validated against pre-edit production code first). Unused `dvn` Vector3 removed; `PMAX > 65535` guard added for Uint16 ids. | F3 | none |
| P5 ✅ **DONE** | **Color-write hygiene**: write channel-wise into `colAttr.array` via precomputed LUTs instead of per-segment array literals; cache `inSet` per selection change. **Implemented in `fly_demon_3d.html`:** all three edge writers (`fillCableColors`, the legacy chord loop in `updateVisuals`, `modTick`) now write channel-wise into `colAttr.array` (equivalent to `setXYZ` on unnormalized Float32 itemSize-3 attributes — verified per-frame in tests); cable writer hoists the per-segment ternary coefficient chains into per-edge constants preserving the legacy left-to-right f64 association `((0.55*b)*front)*potent`; chord loop colors come from module-level `P5_CHORD_LUT` (no per-segment `[r,g,b]` literals); `modTick` fallback color is module-level; `inSet` cached in `npSetFor()` keyed on (npMembers Map identity, selection name, member-array identity) so dataset rebuilds, selection switches, and member-array replacement all invalidate. Parity suite validated against pre-edit production code first; bit-exact buffers across cable modes/waves/heat bands, chord modes, modulator types/tones/DA/chips (`tests/p5_color_parity.test.js`, 6 tests). | F3/F4 | none |
| P6 ✅ **DONE** | **DOM batching**: keep all metric math at full rate; flush the ~20 HUD/panel writes at 10 Hz. **Implemented in `fly_demon_3d.html`:** `updateHUD`/`expFrame` keep computing every string at full frame rate — identical expressions, nothing moved or recomputed (`expFrame`'s interleaved EMA/thermo mutations and its `landauerJ`/`bitsNeeded` locals stay exactly where they are) — and stage them into module-level maps; one flush applies the staged `textContent`/`style.color` to the DOM at most every 100 ms (10 Hz). The real flush fires at the end of `expFrame` (`updateHUD` ends with a gated attempt that is a no-op until `expFrame` has staged this frame) so a flush never mixes this frame's HUD values with last frame's panel values. `bestVal`'s two per-frame write sites route through the staged path. `tests/p6_hud_parity.test.js` (7 tests; validated against pre-edit production code first): flush-frame DOM byte-identical to legacy direct writes, staged strings equal the legacy text at every frame, zero DOM writes between flushes, >4× write reduction at 60 fps, 100 ms gate exact, staged-writer hygiene assertions. | F6 | none — presentation only |
| P7 ✅ **DONE** | **Launcher caching split**: keep `no-store` for `*.html` and `experiment_worker.js` (preserves the documented stale-worker fix); serve all other assets revalidatable (`no-cache` + ETag + Last-Modified) so a warm reload is a batch of tiny 304s; gzip text assets ≥ 1 KiB. **Implemented + measured (launch_fly_demon_3d.py):** cold load 129.4 MB → **warm reload 0.9 MB** (headless Edge CDP, disk-cache enabled; text payloads revalidate as 304s, binaries served from cache). Deviation from the original wording: revalidation instead of `immutable, max-age=1y` — payloads are not filename-fingerprinted, so long max-age would serve stale data after a `tools/` rebuild. Also removed the duplicated `end_headers` and kept the `?ts=` worker cache-buster working. | F2 | must not weaken the original stale-worker guard |
| P8 ✅ **DONE** | **De-eager `loadCellTypes`**: fetch on first chip-T/anatomy use instead of at module load (the IIFE already treats it as optional). **Implemented in `fly_demon_3d.html`:** the eager IIFE became an idempotent function (one attempt per page life) triggered from the chip-T flow (`setChip` T-entry else-branch + the chip-T click handler) and from the two arbor consumers (`showArbor`, `famShow`); the payload/failure handling is byte-identical to the legacy IIFE (same fetch URL + `cache:"no-cache"`, same map/counts fill, same messages, same silence on failure); `CELLTYPES.done` (set in `finally`) distinguishes "tried, missing" from "still loading" in the chip-T hint; completion re-bakes the brain only when the T anatomy view is currently open (same self-heal as the late-arriving anatomy data). All `CELLTYPES` consumers were already `.ready`-guarded, so the pre-load state is exactly the missing-file state. `tests/p8_celltypes_lazy.test.js` (8 tests; loader transcription validated against pre-edit production code first): no fetch at eval, exactly-once fetch under concurrent/post-completion triggers, failure silence + done + no-refetch, exact legacy missing-file message preserved on the second chip-T click, pending → self-heal-rebuild → success-message click flow, non-anatomy hint click fetches nothing, other eager loaders (`loadEdgePaths`, `loadArbors`) untouched. | F2 | first anatomy click pays the cost — pair with P9/T2 |

### Tier 2 — structural

| ID | Fix | Addresses |
|----|-----|-----------|
| P9 ✅ **DONE** | **Parse off the main thread**: move circuit + cell-types parsing into workers (fetch in worker → parse → transfer typed arrays zero-copy), or convert payloads to the repo's existing `*.bin` typed-array pattern at build time (`tools/` already produces such assets). **Implemented — cell-types half (the largest single parse) — in `celltypes_worker.js` + `fly_demon_3d.html`:** the 53.8 MB `fly_brain_celltypes.json` `r.json()`/`JSON.parse` (plus the ~106k-entry double loop) now runs in a dedicated one-shot worker on first anatomy use (chained after P8's trigger points); the page receives only what its consumers ever read — `root_id → type-name` Map (cloned, ~few hundred entries) + two transferable buffers (f64 roots + a packed u8 type-index/names blob, ~950 KB total) — so the JSON never enters the render thread. The worker builds `byRoot`/`counts` with the legacy insertion orders; page applies them verbatim. **Scope decision:** the circuit `<script>` payloads are NOT moved — they are parsed by the JS engine before the ES module boots (boot reads `window.__FAFB_CIRCUIT__` synchronously at L771→`makeSim`), so the parse is not main-thread-avoidable without re-architecting boot; the worker never sees raw circuits (state is derived and shipped from the main thread post-P3), so no duplication exists to eliminate. **Root-id precision preserved:** ids exceed 2^53 and are already truncated by the legacy path; worker-side `JSON.parse` uses the same double rounding, so `String(root_id)` keys are bit-identical (f64 round-trip test included). Workerless/sandboxed contexts (no `Worker`, construction throw, or worker `onerror` before completion) fall back to the legacy inline parse, byte-identical and idempotence-guarded; failure contract identical to P8 (silent, `done`, exact legacy missing-message on next chip-T click). `tests/p9_celltypes_worker.test.js` (8 tests): real worker source in vm with real transfer/detach semantics → structuredClone → the page's actual `onmessage` closure, oracle = legacy loader transcription on the same payload (values, key orders, message), exact buffer sizes, failure matrix (404/network/empty/untyped/`>255` types refuses), P8 chip-T UX regression, idempotence, fallback structure pins; `celltypes_worker.js` added to run_smoke's syntax gate. | F2 | first anatomy click pays the cost — pair with T2 |
| P10 ✅ **DONE** | **GPU-side edge coloring**: pack per-neuron spike/heat into a small data texture; a custom `LineSegments` shader samples it per endpoint index. Eliminates both the chord loop and the 72k cable `setXYZ` path. **Implemented in `fly_demon_3d.html`:** the per-edge color math is unchanged (CPU, verbatim from the legacy writers), but it now stores one front+trail RGBA texel pair per *rendered* edge (compact `segIdx` slot, f32 `DataTexture`, one row per texel, `NearestFilter`, `flipY=false`, no mipmaps) instead of writing every segment endpoint into the color attribute; a vertex shader performs the per-segment front/trail select from the exact legacy wave window (`d = segT - wave; if (d<0) d+=1; d < 0.18`) using per-vertex `p10Edge`/`p10T` attributes bound at build (cable rebinds `p10T` once per source `segT` array). Costs now: ~6k edge stores + ~196 KB texture upload per recolor (vs ~36k segment ops + 864 KB full-buffer upload in cable mode, ~6k-edge loop + 430 KB in chord mode). Chord mode is **bit-exact** (no wave branch: `p10T` pre-bound to 0.0 → every vertex samples the front texel); cable mode exposes only the `d == 0.18` window comparison to f32 — both sides share one hue (front = 1/0.35× trail brightness), so the worst case is a ~1-ulp window band flipping one segment's brightness level for one frame (documented, tested). Presentation parity: fragment chain = `colorspace_fragment` + `fog_fragment` (fog uniforms from `UniformsLib.fog`, refreshed per frame by the renderer exactly as for `LineBasicMaterial`), opacity 0.85 in the shader, `transparent`/`AdditiveBlending`-in-anat/`depthWrite:!anatMode` preserved; the legacy color attribute stays allocated for the brain-worker mirror. Also fixed en route: the legacy `cableEdgeTick` double-call (gated 30 Hz call + unconditional second call whose full-buffer write was always overwritten before render — dead work, now removed). `tests/p10_edge_gpu.test.js` (7 tests; reconstruction model validated against pre-edit production code first): reconstruction ≡ legacy cable writer over 4 modes × heat/none × 7 waves (incl. the 0.18 band) with the window caveat pinned (only front/trail brightness flips, same hue), chord reconstruction bit-exact, texel-center indexing round-trip for 7 edge counts via the real vendored three.js, per-edge writer/texture/`ShaderMaterial`/cadence structure pins, and the real page writers (`fillCableColors`, `p10ChordColors`) driven in-sandbox against the legacy transcriptions (full `npMembers → npSetFor → inSet` derivation chain). `tests/p5_color_parity.test.js` adapted to the texture contract with its legacy transcriptions as oracle — 6/6. | F4 | F3 remains from the geometry rebuild itself |
| P11 ✅ **DONE** | **Partial instance uploads**: node-glow matrices no longer re-uploaded per frame. **Design verdict first (the row's premise, verified against r160 and the actual access pattern):** the vendored three r160 fully supports ranged uploads (`BufferAttribute.addUpdateRange`/`clearUpdateRanges`/`updateRanges`; renderer patches exactly those ranges, full-uploads otherwise — GPU buffers are also full-`bufferData`'d at creation, so build-time matrices need no extra first-frame upload). But per-touched-instance ranges are a **pessimization** here: the glow touches a strided subset (indices ≡ (tick+li) mod 7 across layers) so ranges never coalesce, and r160 issues one `gl.bufferSubData` PER range — ~15k single-matrix calls/frame vs one 6.8 MB upload. Deeper: node POSITIONS never change and the only per-frame mutation is the scalar `dummy.scale.setScalar(spikes?2.2:1)` — patching 16-float matrices is the wrong unit of work. So the minimal form of the row's "or restructure" clause was implemented instead, in `fly_demon_3d.html`: instance matrices are written ONCE at build (1.5 anat / 1 layered, `StaticDrawUsage`) and frozen; the glow pulse lives in a per-instance 1-float `aPulseScale` `InstancedBufferAttribute` (`DynamicDrawUsage`) on `nGeo`; the captured `p11Mat` patches `#include <begin_vertex>` → `...\n\ttransformed *= aPulseScale;` via `onBeforeCompile` (scale multiplies before the modelMatrix/instanceMatrix multiply — for identity-rotation instance matrices M(s)·v ≡ M₁·(s·v) EXACTLY in f32: uniform scale commutes with the rotation columns and the translation column is untouched), with `customProgramCacheKey = "p11-pulse-scale"` isolating the patched program from all other MeshBasicMaterials; the `updateVisuals` glow block keeps the identical strided visit set and `spikes[i]?2.2:1` ternary but stores scalars through `p11StoreScale` (identity hook; a documented DEGRADED precision mode can quantize here — 4-significant-bit stores stay structurally identical, single multiplicative error term bounded at 2⁻⁴) and raises only `p11Scale.needsUpdate` → ONE N·4 B upload per frame instead of N·64 B (exactly 1/16; ~6.8 MB → ~427 KB at ~107k instances) and drops the per-frame dummy compose. pMesh/instanceColor writers are separate buffers, untouched. `tests/p11_instance_upload_parity.test.js` (5 tests; core sections validated against pre-edit production code first): f32-identity proof over 2000 random cases incl. the app's scale literals, 24-frame full-scenario mirror (legacy matrix buffer vs frozen+scale: per-instance scale equality + transform parity, replicating legacy's cumulative-stale-matrix quirk), degraded-mode structural pin, post-edit page wiring pins, and the page-extracted glow block driven in a vm sandbox against the verbatim legacy oracle over the full scenario. Full run 104/104. | F4 | none — transform is f32-identical to legacy; per-frame upload is exactly 1/16 |
| P12 | **Server-side celltypes cache**: parse once at first use in the launcher process; optionally precompute arbor-family summaries at build time. | F5 |

### Tier 3 — strategic verdicts (the "base of the tools" answer, §5–§6)

- P13 Keep the hand-rolled particle physics. Do **not** introduce MuJoCo into the browser path (rationale in §6).
- P14 Keep the brain sim in a JS worker; revisit WebGPU compute only if the simulated population grows by orders of magnitude.

---

## 5. Tool foundations — what this app actually runs on

All VERIFIED this session unless noted:

- **Rendering:** vendored `three.module.js` (+ `GLTFLoader`, `BufferGeometryUtils`) served as static ES modules; no bundler participates in the page load path (script tags reference files directly). UI is hand-written DOM/CSS in the same page.
- **Compute placement:** `brain_worker.js` — full-connectome LIF + dopamine-gated plasticity off-thread, zero-copy transferable buffer pools; `experiment_worker.js` — E1–E11 orchestration; both created as classic Web Workers.
- **Data:** FlyWire **FAFB v783** connectome (boot message L3757; worker header: ~106k neurons / ~563k fast edges) + MCNS secondary dataset; typed-array `.bin` assets with JSON sidecar indexes for positions, hulls, edge way-points, skeletons; cell-type annotations (Schlegel et al. 2024 import per in-file comments).
- **Serving:** Python stdlib `ThreadingHTTPServer` launcher with arbor-family streaming APIs.
- **Verification:** Node headless batteries (`p1_tests.js` 55/55 per VERIFIED-DOC STABILIZATION_REPORT.md), `tests/run_smoke.js`, GitHub Actions `ci.yml`.
- **Embodiment leg (already deployed):** `flybody` 0.1.0 @ `d015e9bf`, MuJoCo 3.13.0, dm_control 1.0.46 in a dedicated Python 3.11.9 venv; closed-loop smoke 7/7 PASS (P1_FLYBODY_BASELINE.json + P1_FLYBODY_REPORT.md, VERIFIED-DOC). Physics timestep 1e-4 s, control 2e-3 s (VERIFIED in P1_FLYBODY_BASELINE.json).

## 6. Comparison with the external fly-simulation stack

The user-supplied ecosystem research (EXTERNAL) names: MuJoCo, dm_control, Gymnasium/FlyGym, CAVEclient/neuprint, NAVis, Ray, NVIDIA Warp, FlyWire, three.js. Mapped onto this repository:

| External tool | Role elsewhere | Verdict for this project's *animation* |
|---|---|---|
| MuJoCo / flybody | Whole-body biomechanics; RL locomotion | **Keep out of the browser.** The chamber is ≤600 kinematic particles with grid collisions — bespoke JS is strictly cheaper than a rigid-body/contact engine here, and the repo already decided "no WASM MuJoCo path" (FLYBODY_ARCHITECTURE.md, VERIFIED-DOC). MuJoCo already runs where it belongs: the Python embodiment sidecar. |
| Ray / distributed RL | Parallelizing agent training | Irrelevant to runtime animation. Offline campaign parallelism already exists as Node worker scripts (`e3r2_campaign.js`, `e9_batch_validate.js`). |
| NVIDIA Warp / GPU compute | GPU physics backends | Not needed: the brain worker holds 30 Hz today; revisit only for much larger populations (P14). |
| FlyWire / CAVEclient | Connectome source | Already the data foundation (FAFB v783 embedded + extraction tooling). |
| three.js | Rendering | Already the renderer; the wins are in *how* it's fed (P2, P5, P10, P11), not in replacing it. |
| Baked keyframes (general advice) | Offline animation | Already the right idea for the tail: keep the parameterized curve, stop rebuilding its geometry (P2). |

**Bottom line:** nothing from the external stack would make *this* animation faster; the wins are all in buffer reuse, thread placement, parse placement, and HTTP policy (§4).

---

## 7. Measurement plan (converts every INFERRED into MEASURED)

Baseline **before any fix**, then re-measure after each tier:

1. **Instrumented scenarios** (perf HUD already reports avg ms, worst gap, hitches, `bw` ticks/s, heap): (a) idle world, (b) anatomy/cable view, (c) chip-T cell-type view, (d) run-all-six experiments, (e) cold reload, (f) warm reload, (g) arbor-family click, (h) intentionally forced fallback (`sim._bwBroken = true`) to characterize F1.
2. **Chrome Performance panel / tracing** per scenario: attribute frame time to `stepParticles`, `updateVisuals` sub-blocks, `refreshWeightOverlay`, GC, raster.
3. **Boot milestones:** add temporary `performance.mark`s (HTML parsed → circuits parsed → brain ready → first frame).
4. **Acceptance targets (PROPOSED):** idle ≥ 55 fps avg with < 5 hitches (>40 ms)/min and worst gap < 100 ms; run-all-six ≥ 45 fps; warm reload → first interactive frame < 5 s (re-baseline after P7/P9); arbor click < 300 ms server response; `bw` ≈ 30 ticks/s whenever the world is visible.
5. **Behavioral parity gates:** all existing batteries stay green (`tests/run_smoke.js`, `p1_tests.js`, CI); door statistics, sim parity, and experiment metrics bit-identical — only presentation cadence and I/O placement change; P3's worker-side top-K must reproduce the current top-180 ranking exactly.

## 8. Non-goals

No UI redesign, no experiment/physics/learning changes, no data regeneration, no file renames. This document changes nothing; implementation, if approved, proceeds tier by tier with the measurement plan above.

## 9. Provenance

All file:line references were read during this audit session (branch `deployment/phase-02`; `fly_demon_3d.html` 491,862 B / 5,905 lines; `brain_worker.js` 245 lines; `launch_fly_demon_3d.py` read in full). Sizes for `fly_brain_edge_paths.bin/.json`, `fly_brain_celltypes.json`, and circuit JSONs from directory listing this session; `data/circuits/*.js` sizes cited from PAYLOAD_SEPARATION_PLAN.md (VERIFIED-DOC). Nothing was runtime-measured for this document; §7 defines how to measure.
