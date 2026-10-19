# Anatomical 3D — Five Bounded Performance Probes (measured)

**Status:** MEASUREMENT ONLY — no optimization implemented, no behavior changed.
**Companion:** `ARCHITECTURE_AUDIT_ANATOMICAL_3D.md` (the audit this quantifies).
**Raw data:** `_probe_results/*.json` (env, p1, p2a, p2b, p2c, p2d, p3, p4, p5).
**Entry vs steady state:** strictly separated throughout (Probe 1 = entry; Probes 2/3 = steady 10.5 s windows after a 5–6 s settle; Probe 4/5 = structural/single-call).

---

## 1. Test Environment

| Item | Value |
|---|---|
| OS | Windows 10 (same machine as F1: 32 cores / 31.7 GB) |
| Browser | Headless Chrome 153.0.8010.53 (`--headless=new`), driven over raw CDP |
| GPU | **ANGLE (Intel UHD Graphics, Direct3D11) — SwiftShader-class headless, NOT the RTX 3500 Ada.** GPU-bound numbers are conservative lower bounds; any real-GPU run will be faster on the render side |
| Viewport / DPR | 1280×800 / DPR 1.0 (uniform across all windows) |
| Dataset | FAFB v783 (106,765 neurons / 553,807 fast edges) — all probes |
| Backends exercised | Warp CUDA sidecar (warp-cuda-1.0, GPU tick 2.8–3.2 ms, rtt 21–48 ms) · JS Worker · `?bw=off` in-frame fallback · replay (via UI "C replay") |
| Window protocol | boot → settle 5–6 s (entry work excluded) → 10.5 s measurement (PerformanceObserver longtask + rAF deltas) |
| Harness | temporary CDP script (since deleted); one dedicated target per scenario; results in `_probe_results/` |

**Method notes.** Long-task entries are quantized to 50 ms; sub-50 ms work is invisible to the LT API, so "0 long tasks" ≠ "no work". rAF cadence in headless reflects the composite of main-thread and GPU submission time on the Intel iGPU; it is not comparable to F1's RTX numbers and is labeled as such. The `?warp=off` flow requires an explicit user choice by design; the harness clicked the modal's "Use JS Worker" / the backend chip, exactly as a user would — no fallback behavior was altered.

---

## 2. Probe 1 — buildBrain Entry Cost (5 reps + dataset switch)

Per-entry synchronous main-thread block on entering Anatomical 3D (`?warp=off` → JS Worker choice; cableReady=true in all reps — real cables, not chords):

| rep | build total (ms) | instances | cable |
|---|---:|---:|---:|
| 1 | 1239.7 | 194.0 | 998.3 |
| 2 | 1271.1 | 191.7 | 1004.3 |
| 3 | 1259.0 | 219.5 | 993.8 |
| 4 | 1019.3 | 112.9 | 875.6 |
| 5 | 1541.8 | 195.5 | 1319.0 |

- **buildBrain min/median/max: 1019.3 / 1259.0 / 1541.8 ms**
- **cable construction (buildCableFor over all 553,807 edges): median ≈ 998 ms (79% of the build)**
- instance-mesh construction: median ≈ 194 ms; shells/hulls/labels/other: remainder (tens of ms)
- **prepareAnat total: 0 ms of added JS wait beyond build** (probe-init → success ≈ instantly, worker already running; the user-perceived cost is the build itself)
- **Dataset switch (FAFB→MCNS, then anat entry): 1261.0 ms** (inst 536.2, cable 694) — the cost is paid **every** entry: 5/5 re-entries, and again after a dataset switch. MCNS builds are slightly cheaper (fewer edges: 160,000 → less cable geometry).
- Earlier boot-load measurements of the same function in **layered view** (no cables): 87–1132 ms — the anat cable geometry is what pushes the entry from "noticeable" to ">1 s hard block".

**Verdict:** entry cost is real, measured, recurring, and dominated by cable geometry construction from real synapse waypoints (`fly_brain_edge_paths.bin`, 39.7 MB).

---

## 3. Probe 2 — Long Tasks by Backend (steady-state 10.5 s windows, FAFB anat)

| Backend | LTs | LT total (ms) | LT mean / med / p95 / max (ms) | Wall in LT | Frames | FPS | fr med / p95 (ms) |
|---|---:|---:|---|---:|---:|---:|---|
| **A. JS Worker** (`?warp=off`, modal choice) | 106 | 7,415 | 70 / 68 / 85 / 113 | **70.3%** | 139 | 13.2 | 66.8 / 133.3 |
| **B. Warp CUDA** (auto-select) | 112 | 7,185 | 64 / 62 / 87 / 98 | **68.1%** | 148 | 14.0 | 66.7 / 116.7 |
| **C. `?bw=off` in-frame fallback** | 59 | 10,205 | 173 / 172 / 195 / 214 | **96.4%** | 59 | 5.6 | 166.9 / 216.6 |
| **D. Replay** (layered view; note) | 103 | 9,973 | 97 / 96 / 110 / 115 | **94.4%** | 103 | 9.8 | 100.1 / 116.7 |

- **A vs B is the headline result: with the neural tick on JS Worker vs GPU, steady-state main-thread pressure is statistically indistinguishable (70.3% vs 68.1% of wall in long tasks; median frame 66.8 vs 66.7 ms).** Warp's GPU tick (2.8–3.2 ms) is real but the anat renderer saturates the main thread regardless.
- **C (in-frame fallback): the whole 106k/553k tick back on the render thread → 96.4% of wall in long tasks, median long task 172 ms, ~5.6 fps.** This quantifies what the loud fallback banner warns about.
- **D (replay):** the worst sustained case measured (94.4% wall). Attribution caveat: that run's boot console shows the JS worker was offline, so D = replay-stage presentation + in-frame simulation + (per audit L2945) the worker tick continues behind replays. The replay-specific *increment* over the healthy-worker baseline could not be isolated headlessly — see §12.

---

## 4. Probe 3 — Instance-Matrix Upload (A/B/C, JS Worker anat, 10.5 s each)

| Condition | LTs | LT total (ms) | Wall in LT | FPS | fr med / p95 (ms) |
|---|---:|---:|---:|---:|---|
| **A. normal (full node-matrix + TubeGeometry)** | 110 | 7,453 | 70.5% | 13.6 | 66.8 / 100.1 |
| **B. node-matrix upload suppressed** | **5** | 275 | **2.6%** | 14.4 | 66.7 / 100.0 |
| **C. tail TubeGeometry suppressed** | 81 | 5,717 | 54.3% | 12.4 | 83.2 / 117.1 |

- **The per-frame full ~6.8 MB instanceMatrix re-upload is the single dominant long-task source: suppressing it removes ~95% of long-task time (7,453 → 275 ms; 110 → 5 tasks).** The remaining ~15 ms/frame of continuous work (≈ 4× the 50 ms LT threshold spread across 151 frames) stays invisible to the LT API but keeps median frame at ~66.7 ms.
- **Frame cadence does NOT improve (66.8 → 66.7 ms median):** in this headless/Intel-iGPU configuration the frame floor is the GPU render of the oversized line geometry (Probe 4), not the upload. On a discrete GPU the absolute floor would differ, but the long-task structure — the thing that starves the main thread and stalls input — is proven to be the upload.
- TubeGeometry rebuild contributes measurably (C removed ~16% of LT wall) but is secondary.
- **GPU timing: not measurable in this setup** (no EXT_disjoint_timer_query path taken; headless SwiftShader). No GPU number is claimed; the upload cost is established purely via the LT-API A/B (main-thread CPU time), which is the metric that matters for main-thread starvation.
- The suppression flags were **restored after the measurement** and then removed entirely with the instrumentation.

---

## 5. Probe 4 — Cable Geometry Size

Measured from the live geometry (FAFB, anat, cableReady=true):

```text
Cable objects (visible layer):          6,020 edges (stride NE/6000)
Total cable vertices (positions):       14,398,982
Total positions bytes:                  172,787,784 (~172.8 MB, Float32)
Color attribute:                        172,787,784 bytes (~172.8 MB)
                                        -> ~345.6 MB GPU buffers for the cable layer
Segments per edge (full geometry):      mean/p50/p95/max = 13 / 13 / 13 / 13 (audit L2219: (nPts-1)+2)
Full-geometry edge count:               553,807 (E) x ~13 = ~7.2M segments -> ~14.4M vertices
Per-tick recolor subset (segIdx):       6,020 edges x 13 segs x 2 verts = 156,520 setXYZ writes
                                        (~1.9 MB color bytes re-uploaded per sim tick)
Modulatory overlay:                     separate dashed LineSegments (buildModOverlay), not included above
TubeGeometry (demon tail, per frame):   tubular=18, radial=8 -> 171 verts / 288 tris per rebuild
```

**Key correction to the audit:** the cable system is **not** "~6,000 cables". `buildCableFor` builds waypoint polylines for **all 553,807 edges** (~14.4 M vertices, ~345 MB of attribute buffers); the 6,000-edge budget applies only to the per-tick *recolor* subset (`segIdx`). The renderer GPU-submits a ~172.8 MB position buffer + ~172.8 MB color buffer every frame — this, not the 106k nodes, is the dominant render load, and it explains why Probe 3's cadence floor sits at ~67 ms even with uploads suppressed.

---

## 6. Probe 5 — Overlay Scan (`refreshWeightOverlay`)

Live background sampling (worker-branch, every 6th tick): **0.1–0.6 ms** (n=12) — the P3 worker top-K path is effectively free, as designed.

Direct calls (5×, branch state captured per call):

| Branch hit | Condition | Times (ms) | Interpretation |
|---|---|---|---|
| **worker top-K** (be=jsworker, ready, `_bwTopKBuf` present, not replaying) — verified per call | healthy worker | 0.7 / 0.7 / 0.7 / 1.6 / 1.8 (median 0.7; cold first call 0.9–80.7 in an earlier run) | unpack 180 entries + write 360 verts |
| **local full scan** (worker broken → `_bwBroken` → `_bwReady` false) | broken/replay path | 80.7 (cold) / 70.1 / 25.4 / 19.9 / 22.7 (warm median 25.4) | full 553,807-edge score scan + heap + sort, plus the 180-segment geometry write |

- 553,807 edges scanned in the local branch (code-verified loop bounds; the scan IS the 20–25 ms).
- Allocations: the heap keeps `ranked` bounded (~180 entries); per-call allocation is minor — duration is loop-bound, not GC-bound.
- DOM work per call: one `plasticVal` textContent write. Geometry work: 180-segment position+color attribute rewrite (~2.2 KB) + `needsUpdate`.
- The full-scan cost is paid **every 6th tick (~5 Hz)** whenever the worker top-K path is unavailable (broken worker; replay owns the state) — a ~20–80 ms main-thread spike recurring at 5 Hz on top of whatever else is running. Note the direct-call numbers are pure-call; in the p2d replay window this scan compounds with replay presentation.

---

## 7. Combined Evidence Table

| Bottleneck | Measurement | Median | P95 | Confidence |
|---|---|---:|---:|---|
| buildBrain entry block (anat, incl. cables) | 5 re-entries + dataset switch, per-entry build timer | **1259 ms** | 1542 ms (max) | MEASURED |
| — cable construction share | per-entry phase timer | **998 ms (79%)** | 1319 ms | MEASURED |
| — instance-mesh share | per-entry phase timer | 194 ms | 220 ms | MEASURED |
| Cable layer geometry | live geometry inspection | **14,398,982 verts / ~345.6 MB attrs** | – | MEASURED |
| Per-tick cable recolor subset | 6,020 edges × 13 segs × 2 verts | 156,520 writes (~1.9 MB upload) | – | MEASURED (structural) |
| Steady main-thread pressure (sim off-thread, Worker **or** Warp) | 10.5 s LT window | 68–70% wall in LT; fr 66.7–66.8 ms | LT p95 85–87 ms | MEASURED |
| InstanceMatrix full re-upload per frame | A/B suppression (LT API) | **110→5 LTs; 70.5%→2.6% wall** | – | MEASURED (causal) |
| Tail TubeGeometry per frame | A/C suppression | 70.5%→54.3% wall | – | MEASURED (causal) |
| In-frame fallback (`?bw=off`) | 10.5 s LT window | 96.4% wall; LT med 172 ms; ~5.6 fps | LT p95 195 ms | MEASURED |
| Replay (compound, see caveat) | 10.5 s LT window | 94.4% wall | LT p95 110 ms | MEASURED (attribution partial) |
| Overlay worker branch (healthy) | 12 background samples + 5 direct | 0.1–0.7 ms | 1.8 ms | MEASURED |
| Overlay local full scan (broken/replay) | 5 direct calls, branch-verified | **25.4 ms warm (70–81 cold)** | ~25 ms | MEASURED |
| Jet 106k decay per frame | not separately suppressed | ≤ ~15 ms/frame composite (LT-invisible) | – | INFERRED (bounded by p3-B residual) |
| Warp vs Worker steady-state difference | paired 10.5 s windows | **indistinguishable** (Δwall 2.2%) | – | MEASURED |

---

## 8. Updated Causal Model (measured)

```text
Anatomical 3D entry
        ↓
prepareAnat (backend choice; ~0 ms extra JS)
        ↓
buildBrain  ──────────────  MEASURED 1.0–1.5 s HARD MAIN-THREAD BLOCK, EVERY ENTRY
        ↓                      └ cable build = 79% of it (14.4M verts from real waypoints)
        ↓
steady-state rendering  ───  MEASURED ~68–70% of wall in long tasks
        ↓                      └ #1 source: per-frame full instanceMatrix re-upload
        ↓                         (suppression: 70.5%→2.6% wall)   [Probe 3, causal]
        ↓                         └ #2: tail TubeGeometry churn (secondary, causal)
        ↓                         └ floor: GPU render of ~345 MB cable layer
        ↓                            (frame cadence pinned ~67 ms on Intel iGPU)
        ↓
frame starvation  ──────────  MEASURED 13–14 fps anat steady state (headless iGPU)
        ↓                      └ worker fallback path: 96.4% wall, ~5.6 fps
        ↓                      └ replay: 94.4% wall (compound case)
        ↓                      └ + every-6th-tick 20–80 ms overlay scan spikes
                                 whenever the worker top-K path is unavailable
```

The audit's ordering is confirmed with one re-rank: **entry** is dominated by cable *construction*; **steady state** is dominated by the *instance-matrix re-upload* (long tasks) plus the *cable layer's render cost* (frame floor); neural compute placement (Worker vs Warp) is irrelevant to both.

---

## 9. What Warp Fixes (measurement-supported)

- The neural tick leaves the main thread (GPU tick 2.8–3.2 ms, rtt 21–48 ms, measured healthy).
- In the *tick-throttled/main-thread-saturated* regime, removing in-frame simulation: fallback 96.4% wall vs 68–70% with the tick off-thread — Warp (or any healthy worker) avoids the catastrophic mode.
- Nothing else measurably: paired A/B shows Warp ≈ JS Worker on every steady-state metric (§3).

## 10. What Warp Does NOT Fix (measurement-supported)

- The 1.0–1.5 s per-entry `buildBrain` block (precedes/complements backend start).
- The per-frame instanceMatrix long tasks (they persist identically under Warp, §3 A vs B).
- The ~67 ms frame floor from rendering the ~345 MB cable layer.
- The 20–80 ms overlay-scan spikes when the top-K path is unavailable.
- Tail TubeGeometry churn, jet decay, and the replay compound case.

## 11. What P3 Does / Does Not Fix (P3 is already implemented — not reimplemented)

- **Fixes (measured):** with a healthy worker, `refreshWeightOverlay` runs on the worker top-K path at **0.1–0.7 ms** — the 553,807-edge main-thread scan is already eliminated on the healthy path; worker-published heat/top-K keep those loops off the render thread.
- **Does not fix:** the local full-scan branch for replay/broken-worker (25.4 ms warm / 70–81 ms cold, every 6th tick), the entry block, the upload long tasks, or the cable-layer render floor.

## 12. Remaining Unknowns

1. **Replay-specific increment**: the replay arm's worker was offline (compound attribution). Isolating replay presentation cost needs one run with a healthy worker + replay.
2. **Discrete-GPU floor**: the ~67 ms cadence is an Intel-iGPU/headless bound; the RTX 3500's floor for the ~345 MB cable layer is unmeasured (the *long-task structure* findings are GPU-independent).
3. **Jet.step share**: bounded (≤ ~15 ms/frame composite) but not independently suppressed; a jet-off window would pin it.
4. **Max cable vertices/edge distribution**: measured uniform at 13 segments/edge for this dataset — the per-edge waypoint distribution (and any pathological long cables) was not profiled beyond maxSeg=13.
5. **GPU timing**: no reliable GPU timestamps in this environment; upload cost is established via main-thread LT A/B only.

## 13. Next Step (evidence-based optimization order — NOT implemented)

1. **Supersample the per-frame node-glow matrix writes + full instanceMatrix upload** (Probe 3: removes ~95% of steady-state long-task time; smallest change, biggest main-thread effect).
2. **Build the cable geometry once off-thread / cache across re-entries** (Probe 1: removes the recurring 1.0–1.5 s entry block; geometry is dataset-static, yet it is rebuilt on every enter/leave/switch).
3. **Decimate or LOD the full-edge cable layer** (553,807 edges → visible budget; reduces the ~67 ms frame floor and ~345 MB of GPU buffers).
4. **Give replay/broken-worker the same compact top-K treatment** (removes the 5 Hz, 20–80 ms scan spikes; extends the existing P3 worker path to the remaining branches).
5. **Pool or amortize the tail TubeGeometry** (secondary; C-arm shows ~16% of LT wall).

Each item is independent, presentation-layer, and separately falsifiable with the same probe harness.

---

## Appendix — Probe-by-probe acceptance & integrity

- buildBrain entry cost measured (5 reps + switch, entry/steady separated) ✔
- Long-task behavior measured for JS Worker / Warp / `?bw=off` / replay ✔
- Instance-upload impact experimentally compared (A/B/C with restoration) ✔
- Cable geometry size measured exactly (14.4 M verts; ~345.6 MB) ✔
- Overlay scan cost measured with branch attribution (worker vs local) ✔
- No scientific behavior changed; no fallback altered; no Warp architecture change; P3 untouched ✔
- Temporary instrumentation fully removed and verified (0 probe markers; module syntax re-checked) ✔

```text
FILES MODIFIED (temporary instrumentation, all since removed):
  fly_demon_3d.html   — 15 marked probe sites (timing marks, A/B switches,
                        geometry/overlay accessors, diagnostic warns). ALL REMOVED;
                        module syntax re-verified after removal.

FILES CREATED (kept):
  ANATOMICAL_3D_FIVE_PROBES.md (this report)
  _probe_results/*.json        (9 raw measurement files; untracked data)

FILES CREATED (temporary, deleted):
  _probe_harness.mjs, _probe_live.mjs, _probe_chrome.log, _probe_chrome_profile/

PRODUCTION BEHAVIOR CHANGED: NO
WARP CHANGED: NO
P3 CHANGED: NO
SCIENTIFIC PHASE CHANGED: NO
```
