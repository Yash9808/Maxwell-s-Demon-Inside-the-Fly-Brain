# Warp Backend Investigation — Architecture

Status: **INVESTIGATION COMPLETE (benchmarks in `WARP_BENCHMARK_RESULTS.md`).**
Scope: numerical simulation backend only. Three.js rendering stays in the browser.
No production code was modified in this investigation.

## 1. Current architecture (measured, F1)

```
Browser (fly_demon_3d.html)
  ├── Three.js render loop (17 ms p50 frame when worker healthy)
  ├── brain_worker.js  ← 30 Hz cadence, ping-pong transferables
  │     └── production kernels: injectors → LIF (V*0.86, thr>30, refrac 3)
  │         → 1-tick-delay fan-out (563k edges) → traces → gated plasticity
  ├── UI / DOM / perf HUD
  └── Python sidecar (flyvis_sidecar.py)  ← HTTP JSON, isolated venv (unused by sim)
```

F1 verdict (`F1_WORKER_BASELINE.md`): the worker **starts and runs**; no silent
fallback. But the main thread consumes worker messages too slowly: ~11 of 30
ticks/s absorbed. Clean-room worker tick service: **12.4 ms p50, ≈80 Hz ceiling**
(2.6× headroom). The tick itself is not the bottleneck; the pipeline is.

## 2. Proposed architecture (the question under test)

```
                 Python Backend (persistent GPU state)
                       |
                +------+------+       compute_backend = warp_cuda | warp_cpu
                |             |                        | python_cpu | javascript
             Warp CPU     Warp CUDA                     (explicit, loud, no silent fallback)
                |             |
                +------+------+
                       |
              compact render state (~105 KB/tick)
                       |
                  IPC/HTTP (raw bytes)
                       |
                    Browser
                       |
              Three.js + UI (unchanged role)
```

Constraint honored: the browser must NOT receive V (427 KB), W (2.2 MB),
E (2.2 MB) or intermediates every tick. The measured compact contract is
spikes (104 KB) + scalars; weights/top-K only every 6th–12th tick.

## 3. Workload analysis (from the production code, verified by benchmark)

| Workload | Where it runs today | Cost (JS, real circuit) | Parallel shape | GPU suitability |
|---|---|---|---|---|
| Injectors (stim/optic/motor/ex) | brain_worker tick | ~1.5 ms | per-neuron independent | good (RNG per thread) |
| LIF update 106k | brain_worker tick | 0.55 ms | per-neuron independent | excellent |
| Synaptic fan-out 553k | brain_worker tick | 0.87 ms | edge-parallel scatter (atomics) or CSR | good |
| Traces 553k | brain_worker tick | 2.47 ms | edge-parallel | excellent |
| Plasticity 553k | brain_worker tick | 2.72 ms | edge-parallel gated update | excellent |
| Heat decay 106k | **main thread (render loop!)** | 0.19 ms | elementwise | trivial |
| Change scan + top-K 180 | main thread, every 6th frame | 5.67 ms | serial heap (production) | poor as written (see below) |

## 4. Data-flow and CPU/GPU boundary

* State that must live GPU-side (persisted across ticks): V, spikes, refac,
  prev, W, E, heat, modulator EMAs. Everything stays resident; only the
  compact render state crosses the boundary.
* Per tick: injectors → LIF → fan-out → commit prev → traces → heat (6 kernels,
  one sync). Host touches only scalars.
* Every 6th tick: change scan (+ top-K if the UI needs it) and optional
  full-weight snapshot.
* Serialization: raw little-endian typed arrays (no JSON in the hot path).
  Spikes are u8 bitmaps; V/W/E are f32.

## 5. IPC strategy (measured)

* V1 full state (V+spikes+heat+W = 3.18 MB/tick): server extract 6.19 ms,
  localhost transfer+parse 40.4 ms → 23.7 ticks/s. **Transfer-bound (25:1).**
* V2 compact (spikes + scalars = 104 KB/tick; W every 6th tick in this demo):
  extract 1.44 ms, transfer+parse 10.4 ms → 94 ticks/s; real Chrome 15.2 ms/tick,
  41.7 ticks/s. Comfortably above the 30 Hz cadence.
* Existing pattern to reuse: the sidecar (`flyvis_sidecar.py`) already establishes
  an isolated-venv HTTP service; the ping-pong transferable pool of
  `brain_worker.js` remains the in-browser transport.

## 6. Memory strategy

* GPU (measured, live server): **155 MiB** total device memory for the whole
  resident state + workspace — trivial on the 12 GiB RTX 3500 Ada.
* Backend RSS: 218 MB (Python + Warp + pinned staging).
* Browser (unchanged): 3 MB circuit payload, spike bitmap + heat arrays.
* Pinned host buffers amortize the D2H copies; no per-tick allocation.

## 7. Fallback strategy (F1 lesson institutionalized)

* The backend exposes `compute_backend` explicitly (`/meta`, response headers)
  and **exits with code 2** if `warp_cuda` is requested but unavailable —
  it never silently substitutes a CPU path.
* Explicit ladder: `javascript` (today, always available) → `python_cpu`
  (NumPy) → `warp_cpu` → `warp_cuda`. Selection is configuration, visible in
  diagnostics; every fallback is announced, never silent.
* Bit-parity discipline: JS replica ↔ Warp CPU are **bit-exact** on all six
  correctness scenarios; Warp CUDA differs only in fan-out accumulation order
  (documented tolerance 1e-4; measured max 1.5e-5).

## 8. Risks

1. **Process boundary vs worker boundary.** The current worker is same-process
   (0.1 ms message cost); a Python backend adds an HTTP hop (~10 ms round trip
   observed). A same-host socket/stdio channel would shave most of it, but the
   cross-process floor is real. Any production design must beat the *pipeline*
   numbers, not just kernel numbers.
2. **GPU vendor lock-in** (CUDA/Warp vs the browser's zero-dependency path).
3. **Serial top-K does not map to GPUs** (46.7 ms on CUDA vs 4.8 ms Warp CPU);
   a production design would use a parallel radix-select, or keep it host-side.
4. **Laptop GPU thermal variability** — numbers are medians of repeats on an
   idle machine; sustained-load behavior will be somewhat worse.
5. **Windows process lifetime** — the backend must be supervised by the launcher
   (same lifecycle rules as the sidecar), else the F1 silent-starvation mode
   could reappear at the process level.
6. **Determinism policy** — CUDA accumulation order is not bitwise-stable vs
   CPU. The parity harness pins this down and the tolerance is documented, but
   any experiment that requires bitwise reproduction across backends must run
   on one backend.
