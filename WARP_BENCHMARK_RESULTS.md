# Warp Benchmark Results

Machine: Windows, 32-core / 31.7 GB, NVIDIA RTX 3500 Ada 12 GB (sm_89), CUDA 12.9/13.2.
Warp 1.17.0 on Python 3.11.9 (isolated venv `.venv-warp`). Node v26.8.2.
Inputs: the REAL circuit arrays extracted from `data/circuits/fafb_circuit.js`
(N=106,765, NE=553,807 fast edges + 10,223 modulatory) — byte-identical to what
`brain_worker.js` receives (`backend_warp/data/*.bin`, SHA256-pinned in
`backend_warp/data/meta.json`). Protocol: warmup + median of 7 repeats,
synchronize inside the timed region, per-call (fresh realistic state each repeat).

## 1. Kernel results (ms, median | min)

| Workload | JS (production style) | Python NumPy | Warp CPU | Warp CUDA | CUDA vs JS |
|---|---:|---:|---:|---:|---:|
| heat decay 106k | 0.185 \| 0.101 | 0.086 | 0.166 | 0.165 | 0.9× (latency-floor bound) |
| LIF update 106k | 0.552 \| 0.536 | 0.556 | 1.024 | **0.248** | **2.2×** |
| synaptic fan-out 553k | 0.871 \| 0.859 | 3.498 (np.add.at) | 1.116 (atomic) / **0.357 (CSR)** | **0.181** (atomic) / 0.176 (CSR) | **4.8×** |
| traces 553k | 2.473 | 6.445 | 2.783 | **0.174** | **14.2×** |
| plasticity 553k | 2.724 | 6.989 | 1.980 | **0.207** | **13.2×** |
| change scan 553k | — | 5.072 | 1.921 | **0.177** | — |
| change scan + top-K 180 | 5.670 \| 4.224 | — | 4.759 | **46.741** | **0.12× — 8× SLOWER** |
| full tick (inject+LIF+fanout+commit) | **3.007** \| 2.934 | 4.479 (no inject) | 10.773 | **0.495** | **6.1×** |

Notes:
* Warp CPU full tick is *slower* than JS — 5 sequential kernel launches with
  per-launch dispatch overhead dominate on a 32-core CPU node.
* The serial min-heap top-K is the one anti-pattern: a data-dependent serial
  loop cannot use GPU parallelism (it does not "fail", it is simply the wrong
  shape — must be restructured as a parallel select or kept host-side).
* JS numbers include V8's JIT; they are the honest production baseline.

## 2. End-to-end pipeline (Warp CUDA backend → HTTP → consumer)

Server-side per tick: sim 1.9–2.1 ms (includes 5 kernels + sync), extraction:
full 6.19 ms (pinned copies of V+spikes+heat+W) vs compact 1.44 ms (spikes only).

| Version | Payload/tick | Transfer+parse (Node) | E2E median (Node) | ticks/s (Node) | E2E median (real Chrome) | ticks/s (Chrome) |
|---|---:|---:|---:|---:|---:|---:|
| V1 full state (V+spikes+heat+W) | 3.18 MB | 40.4 ms | 43.1 ms | 23.7 | 88.8 ms (p95 107.5) | 11.0 |
| V2 compact state (spikes+scalars) | 104 KB | 10.4 ms | 6.26 ms (p95 33.9) | 94.0 | 15.2 ms | 41.7 |

**V2 is 6.9× faster end-to-end in Node and 5.84× faster in real Chrome.**
Full-state transfer erases the entire 6.1× kernel speedup and then some;
compact render state preserves it. V2 sustains 41.7 ticks/s in Chrome —
comfortably above the app's 30 Hz worker cadence.

## 3. Memory

| Item | Measured |
|---|---:|
| GPU device memory (resident state + workspace, live server) | **155 MiB** / 12,288 MiB |
| Backend RSS (Python+Warp+pinned staging) | 218 MB |
| Browser payload (unchanged) | 3 MB circuit + 104 KB/tick |
| V1 (rejected design) would cost | 3.18 MB/tick ≈ 95 MB/s at 30 Hz |

## 4. Correctness gates (before any speed claim)

Six scenarios (50 ticks each, shared deterministic input files, same LCG):
steady drive, optic burst, full drive, no-injection, extreme weights (20×),
max activity. Compare against the JS replica (`replica.js`, same f32 rounding).

| Gate | Result |
|---|---|
| Warp CPU vs JS: V, W, E, heat, spikes, refac | **bit-exact, all 6 scenarios** |
| Warp CUDA vs JS: spikes, refac | exact, all 6 scenarios (incl. chaotic max-activity) |
| Warp CUDA vs JS: V | 0–48 elements differ by 1–5 ULP, max 1.5e-5 (fan-out accumulation order) — within the declared 1e-4 tolerance |
| Edge cases | no-injection: bit-exact everywhere; extreme weights and saturation: no overflow/clamp divergence |

Two real bugs were caught and fixed by this harness before benchmarking
(a vbuf reset leak that inflated spiking, and the missing prev-commit kernel
that silently disabled synaptic transmission) — the reason correctness gates
run before perf claims.

## 5. Workload classification (measured criteria)

| Workload | Classification | Evidence |
|---|---|---|
| LIF 106k | **GPU acceleration demonstrated** | 2.2× vs JS (0.248 vs 0.552 ms) |
| Synaptic fan-out 553k | **GPU acceleration demonstrated** | 4.8× (0.181 vs 0.871 ms); CSR layout even faster on CPU |
| Traces 553k | **GPU acceleration demonstrated** | 14.2× |
| Plasticity 553k | **GPU acceleration demonstrated** | 13.2× |
| Heat decay 106k | **transfer/latency-bound (not worth a GPU round-trip)** | 0.17 ms on GPU ≈ copy cost; JS already 0.19 ms; it is a render-loop op |
| Change scan (elementwise) | **GPU acceleration demonstrated** | 10.9× |
| Top-K 180 (serial heap) | **implementation incomplete for GPU** — needs parallel select | 46.7 ms CUDA vs 4.8 ms Warp CPU vs 5.7 ms JS |
| Full tick | **GPU acceleration demonstrated** | 6.1× (0.495 vs 3.007 ms) |
| V1 full-state pipeline | **transfer-bound (25:1)** | 3.18 MB/tick → 23.7 ticks/s |
| V2 compact pipeline | **viable end-to-end** | 104 KB/tick → 94 ticks/s Node / 41.7 Chrome |

## 6. Decision-gate answers (with measurements)

**Q1 — Does Warp CUDA accelerate the individual neural workloads?** YES for the
edge workloads (4.8–14.2×), LIF (2.2×) and the composed tick (6.1×). NO for the
serial top-K as written (8× slower) and pointless for heat decay (already
0.19 ms render-side).

**Q2 — Does the acceleration survive serialization and IPC?** Only with the
compact render state. V1 (full state) is transfer-bound and *slower* than the
current in-browser worker pipeline. V2 survives: 41.7 ticks/s in Chrome vs the
app's 30 Hz target.

**Q3 — Can the browser consume a compact render state?** YES — measured: the
production worker already ships a ~104 KB spike bitmap + scalars per tick; the
V2 demo matches that contract exactly (104 KB/tick) and the browser consumed it
at 41.7 ticks/s.

**Q4 — Does the combined architecture improve end-to-end frame time?** For the
simulation tick: 3.0 ms JS → 0.5 ms GPU compute, 15.2 ms browser-observed
tick cadence vs 33.3 ms target (V2). BUT the current F1-measured bottleneck is
main-thread message consumption, not tick compute — a faster backend alone does
not fix that, and cross-process IPC adds ~10 ms the in-process worker doesn't pay.

**Q5 — GPU memory acceptable?** YES: 155 MiB of 12,288 MiB (1.3%).

**Q6 — Does the added backend complexity have measurable justification?**
PARTIAL. The compute speedup is real and large; the end-to-end gain over the
existing worker is modest because the current pipeline is not compute-bound.
Justification exists where compute grows (plasticity-heavy phases, larger
circuits, batch/offline experiments) or where main-thread relief is the goal —
not as a drop-in replacement for `brain_worker.js` at today's workload.

## 7. Reproduce

```bash
node backend_warp/extract_circuit.js                       # arrays + SHA256
node backend_warp/gen_truth.js backend_warp/data/scenario_full_drive.json backend_warp/data/truth_full_drive.json
.venv-warp/Scripts/python.exe backend_warp/correctness.py backend_warp/data/scenario_*.json
node backend_warp/bench_js.js 7
.venv-warp/Scripts/python.exe backend_warp/bench_warp.py 7
.venv-warp/Scripts/python.exe backend_warp/e2e_server.py 8791 &
node backend_warp/e2e_client.js v1 200; node backend_warp/e2e_client.js v2 200
# browser leg: serve backend_warp/e2e_browser_probe.html from the app server
```
