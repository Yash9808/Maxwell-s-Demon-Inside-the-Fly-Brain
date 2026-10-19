# F1 — Worker Startup & Fallback Baseline (measured)

Status: **COMPLETE — measured, not assumed.** All numbers below are live
measurements of `brain_worker.js` + `fly_demon_3d.html` on this machine
(Windows, 32-core / 31.7 GB RAM, NVIDIA RTX 3500 Ada 12 GB, driver 597.06 /
CUDA 13.2), served via `launch_fly_demon_3d.py` (port 8765), Chromium
(2026-09-22). Machine is otherwise idle except one unrelated dev server.

## 1. Questions F1 had to answer

1. Does `brain_worker.js` start correctly, or does the app silently fall back
   to running the full 106k-neuron / 563k-synapse tick on the render thread?
2. Measured baseline: worker startup, ticks/s, frame time, sim tick time,
   main-thread utilization, FPS, GC/long-task spikes.
3. Is the fallback (if any) loud or silent?

## 2. Verdict (one paragraph)

The worker **starts correctly and the fallback is NOT silent**. The healthy
path shows the `brain: worker` badge; the forced fallback shows a red
`BRAIN SIM IN-FRAME` badge plus an explanatory banner — both verified live.
However, F1 measured a **real, previously-unquantified degradation on the
healthy path**: the main thread spends ~66% of wall time in long tasks and
consumes state messages slowly enough that the worker's effective tick rate
is ~11/s of the intended 30/s (the worker itself can sustain ~80/s). The
degradation lives in the **render/browser side, not the brain math** — which
directly shapes the Warp investigation that follows.

## 3. Code path facts (read from source, verified live)

- `fly_demon_3d.html` L2386–2442: builds typed arrays from the FAFB payload
  (`edges` filtered to fast edges; `modulatory_edges` → `{s, type}`), posts
  `init` with transferables, expects `ready`/`state`/`error` back. Tick
  requests are throttled to one per 33 ms (`_bwNext`).
- L2484–2497: watchdog restarts a silent worker once (>5 s without a state
  message), then falls back permanently (`_bwBroken`).
- L2511–2540: **the fallback is loud by design** — in-frame mode shows the
  `IN-FRAME` perf tag, the `BRAIN SIM IN-FRAME` badge, a banner
  (`#bwFallbackBanner`), and one console/msg announce per fallback episode.
- `?bw=off` (L2409) forces the in-frame path on purpose for characterization
  — used here for the A/B below.
- Publish protocol (brain_worker.js): every tick posts a 106,765-byte spike
  bitmap (transferable); every 12th tick additionally posts a 2,215,228-byte
  weight array (transferable). Buffers ping-pong through a 2-deep pool.
- Inside the worker, one tick = inject channels (sensory) + optic-layer
  injection (800-bin retinotopic field, per-neuron column map) + motor
  injection + 106,765-neuron LIF loop + **553,807-edge gather fan-out**
  (`prev[src[i]] → V[dst[i]]`, branchy) + eligibility trace update (553,807)
  + occasional full-weight learning pass + publish.

## 4. Live measurements

### 4.1 Healthy path (worker ON), steady state, ~90 s window

| Metric | Value |
|---|---|
| worker startup → `ready` | 86 ms (first load), 20–46 ms (warm) |
| `bwBadge` | `brain: worker` (dim) — **no fallback** |
| banner | hidden |
| FPS | 22.2 (median frame 17.3 ms) |
| frame gap p95 / p99 / max | 149 / 171 / 200 ms |
| frames >40 ms (hitches) | 131/412 = **31.8%** |
| long tasks (main thread) | 120 in 19 s = ~5/s |
| long-task duration p50 / p95 / max | 105 / 163 / 210 ms |
| **long-task share of wall time** | **66.2%** |
| worker tick rate (perf HUD `bw N/s`) | median ~11/s, series decays to 0/s |
| corr(ticks/s, long-task ms/s) | **−0.44** (anti-correlated) |
| corr(ticks/s, frames/s) | +0.45 |
| JS heap | 338→347 MB over 19 s (stable; no leak) |

Interpretation: state messages arrive at ~11/s because the congested main
thread (30 Hz tick *requests* + its own long tasks) dequeues them late.
The anti-correlation (−0.44) shows tick starvation follows main-thread
blocking, not worker compute limits.

### 4.2 Fallback path (`?bw=off`, identical tick math in-frame), 12 s window

| Metric | In-frame | Worker mode |
|---|---|---|
| badge / banner | `BRAIN SIM IN-FRAME` / shown | `brain: worker` / hidden |
| FPS | 22.3 | 22.2 |
| median frame | 49 ms | 17.3 ms |
| frame p95 / max | 84 / 117 ms | 149 / 200 ms |
| hitches >40 ms | 50.4% | 31.8% |
| long-task p50 / max | 64 / 99 ms | 105 / 210 ms |
| long-task share | 30.8% | 66.2% |
| heap | 432 MB | ~345 MB |

Interpretation: in-frame mode serializes brain+render into uniform ~49 ms
frames (smooth but slow); worker mode interleaves fast 17 ms frames with
150–200 ms stalls (same average, worse tail). The stalls are the evidence
that something main-thread-side — not the worker — produces the jank.

### 4.3 Clean-room worker cost (no render loop)

Probe page `_f1_probe.html` (added for F1, no render loop) drives the real
worker with the real circuit (N=106,765, NE=553,807, mod=10,223) in a closed
loop (next tick sent on each state receipt):

| Metric | Value |
|---|---|
| init (`buildSim` + pool alloc) → `ready` | 19.6–85.6 ms |
| **tick service time** p50 / p75 / p95 / p99 | **12.4 / 12.6 / 14.2 / 20.3 ms** |
| tick service max (200 ticks) | 29.8 ms |
| max sustainable tick rate (p50) | **~80 Hz** |
| intended rate | 30 Hz (2.6× headroom) |
| publish per tick | 106,765 B spikes; every 12th +2.2 MB weights |
| zero-drive retinotopic field (800 bins) | included (no-drive branch exercised) |

Conclusion: **the worker is not the bottleneck.** The 12–14 ms tick is real
work (563k-edge fan-out + 107k LIF) that Warp could accelerate, but the live
app never benefits beyond ~11 ticks/s because the main thread delivers
inputs/collects outputs too slowly — and the *rendering path itself* owns
the long tasks.

## 5. Answers to the F1 deliverables

- Worker startup success/failure: **success**, ~20–90 ms to `ready`;
  onerror/watchdog paths exist and were observed working.
- Silent fallback: **does not occur silently** — the in-frame fallback is
  loudly badged and banner-ed; `?bw=off` reproduces it on demand.
- `bw 0/s` vs active ticks: the perf HUD's `bw 0/s` readouts observed during
  stalls are **displayed truthfully** (they follow the cumulative
  `_bwTicks` counter); sustained 0/s coincided with a watchdog restart
  window, after which ticks resumed.
- Render-thread frame time: p50 17.3 ms / p95 149 ms (worker mode).
- Simulation tick time: **12.4 ms p50 inside the worker** (clean room).
- Main-thread CPU utilization: ~66% of wall time inside long tasks
  (blocking) — the dominant F1 finding.
- Browser FPS: ~22 fps in both modes.
- GC/frame-time spikes: heap stable (±10 MB); spikes are long tasks
  (105–210 ms), ~5/s, un-attributed pending Warp-phase profiling.

## 6. What F1 changes about the Warp investigation

1. The end-to-end bottleneck today is **main-thread work + message pacing**,
   so any Warp backend must be judged on *end-to-end frame time*, not kernel
   speed (the mission's Version-1/Version-2 transfer experiment is exactly
   right).
2. The current publish path already moves ~107 KB/tick + 2.2 MB/12 ticks —
   a compact-render-state design would not shrink the spike bitmap (it is
   already minimal) but the *weight* publishes and any future richer state
   are where transfer savings live.
3. A Python/Warp backend adds a network hop (~0.1–1 ms LAN / loopback) and
   serialization; against a 12.4 ms worker tick, the entire brain compute is
   a modest target — the transfer experiment will decide honestly.
4. F1 probe artifacts: `_f1_probe.html` (kept, harmless, excluded from the
   app), server `_f1_server.log` (temp).

## 7. Environment notes for the Warp phase

- GPU: NVIDIA RTX 3500 Ada (12 GB), idle at probe time; WDDM mode.
- System Python 3.14 (no Warp support); **Python 3.11.9 available via
  `py -3.11`** — the Warp venv will be created on 3.11.
- Node available for JS side of benchmarks; circuit arrays reachable from
  Node via `data/circuits/fafb_circuit.js` (49.5 MB payload).
