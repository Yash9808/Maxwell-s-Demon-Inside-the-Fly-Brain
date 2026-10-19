# bench_warp.py — NumPy vs Warp CPU vs Warp CUDA benchmarks on the real circuit.
#
# Loads backend_warp/data/*.bin (byte-identical to what brain_worker.js gets),
# runs the same op set as bench_js.js, times with warmup + median-of-repeats.
# All launches are device-scoped (the harness bug class found in debugging).
#
# Usage: .venv-warp/Scripts/python.exe backend_warp/bench_warp.py [repeats=7]
import json
import os
import statistics
import sys
import time

import numpy as np
import warp as wp

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kernels   # noqa: E402
import topk      # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def load(name, dtype):
    return np.fromfile(os.path.join(DATA, name), dtype=dtype)


src = load("src.i32", np.int32)
dst = load("dst.i32", np.int32)
w0 = load("w0.f32", np.float32)
sign = load("sign.u8", np.uint8)
meta = json.load(open(os.path.join(DATA, "meta.json")))
N, NE = meta["N"], meta["NE"]
WS = 0.02
lo = meta["layerStart"]
stim = (0, lo[2])
optic = (lo[1], lo[2])
motor = (lo[4], N)

# production-style init: f64 multiply, single f32 round (matches JS bit-for-bit)
signed = w0.astype(np.float64) * (2.0 * sign.astype(np.float64) - 1.0)
W = (signed * WS).astype(np.float32)
W0s = (w0.astype(np.float64) * WS).astype(np.float32)

REPEATS = int(sys.argv[1]) if len(sys.argv) > 1 else 7


def timed(fn, repeats=REPEATS, warmup=1):
    for _ in range(warmup):
        fn()
    ts = []
    for _ in range(repeats):
        t0 = time.perf_counter()
        fn()
        ts.append((time.perf_counter() - t0) * 1000.0)
    return statistics.median(ts), min(ts)


def seed_host():
    rng = np.random.default_rng(123456789)
    Vh = (rng.random(N) * 40).astype(np.float32)
    refac = (rng.random(N) < 0.02).astype(np.uint8) * 2
    prev = (rng.random(N) < 0.03).astype(np.uint8)
    spikes = np.zeros(N, dtype=np.uint8)
    Eh = np.full(NE, 0.5, dtype=np.float32)
    heath = np.full(N, 0.5, dtype=np.float32)
    return Vh, refac, prev, spikes, Eh, heath


results = {}

# ---------------- NumPy (host CPU) ----------------
def bench_numpy():
    out = {}
    spikes_np = np.zeros(N, dtype=np.uint8)
    Vh, refac, prev, spikes, Eh, heath = seed_host()

    def heat():
        np.where(spikes_np != 0, 1.0, heath * 0.94)
    out["heat_decay_106k"] = timed(heat)

    def lif():
        act = refac == 0
        vi = Vh[act] * np.float32(0.86)
        sp = np.zeros(N, dtype=np.uint8)
        sp[act] = (vi > np.float32(30.0)).astype(np.uint8)
        Vh[act] = np.where(sp[act] != 0, vi, vi)
    out["lif_update_106k"] = timed(lif)

    def fanout():
        np.add.at(Vh, dst[prev[src] != 0], W[prev[src] != 0])
    out["fanout_553k"] = timed(fanout)

    def traces():
        ei = Eh * np.float32(0.985)
        inc = (spikes[src] != 0) & (spikes[dst] != 0)
        Eh[:] = np.where(inc, np.minimum(ei + np.float32(0.15), 1.0), ei)
    out["traces_553k"] = timed(traces)

    def plasticity():
        d = np.float32(0.001)
        mask = (Eh >= np.float32(0.01))
        wmax = W0s[mask]
        W[mask] = np.clip(W[mask] + d * Eh[mask], -wmax, wmax * 2.0)
    out["plasticity_553k"] = timed(plasticity)

    def changes():
        np.abs(W - W0s * np.where(sign != 0, 1.0, -1.0))
    out["changes_scan_553k"] = timed(changes)

    def full_tick():
        lif()
        fanout()
    out["full_tick_no_inject"] = timed(full_tick)
    return out


print("== numpy (host cpu) ==")
for k, (med, mn) in bench_numpy().items():
    print(f"{k}\t{med:.3f}\t{mn:.3f}")
    results[f"numpy:{k}"] = (med, mn)

# ---------------- Warp CPU + CUDA ----------------
for dev in ("cpu", "cuda:0"):
    print(f"== warp {dev} ==")
    with wp.ScopedDevice(dev):
        g = kernels.Graph(np, N, NE, dev)
        g.load_graph(src, dst, w0, sign)
        g.build_csr(src, dst, w0, sign)
        Vh, refac, prev, spikes, Eh, heath = seed_host()
        field_np = (np.random.default_rng(1).random(N) * 0.25).astype(np.float32)
        field = wp.array(field_np, dtype=wp.float32, device=dev)
        out = {}

        def setup_state():
            wp.copy(g.v, wp.array(Vh, dtype=wp.float32, device=dev))
            wp.copy(g.refac, wp.array(refac, dtype=wp.uint8, device=dev))
            wp.copy(g.prev, wp.array(prev, dtype=wp.uint8, device=dev))
            wp.copy(g.e, wp.array(Eh, dtype=wp.float32, device=dev))
            wp.copy(g.heat, wp.array(heath, dtype=wp.float32, device=dev))

        def heat_fn():
            wp.launch(kernels.k_decay_heat, N, [g.spikes, g.heat], device=dev)
            wp.synchronize()
        out["heat_decay_106k"] = timed(heat_fn)

        def lif_fn():
            wp.launch(kernels.k_lif_edge_parallel, N,
                      [g.v, g.spikes, g.refac, g.vbuf, 0, wp.uint32(1),
                       wp.float32(0.0), stim[0], stim[1], field, optic[0], optic[1],
                       motor[0], motor[1], wp.float32(0.0), wp.float32(0.0)], device=dev)
            wp.synchronize()
        out["lif_update_106k"] = timed(lif_fn, warmup=3)

        def fanout_fn():
            wp.launch(kernels.k_fanout_edge_parallel, NE,
                      [g.prev, g.src, g.dst, g.w, g.v], device=dev)
            wp.synchronize()
        out["fanout_553k_edge"] = timed(fanout_fn, warmup=3)

        def fanout_csr_fn():
            wp.launch(kernels.k_fanout_csr, N,
                      [g.indptr, g.indices, g.wcsr, g.prev, g.v], device=dev)
            wp.synchronize()
        out["fanout_553k_csr"] = timed(fanout_csr_fn, warmup=3)

        def traces_fn():
            wp.launch(kernels.k_traces, NE, [g.e, g.plastic, g.spikes, g.src, g.dst], device=dev)
            wp.synchronize()
        out["traces_553k"] = timed(traces_fn)

        def plasticity_fn():
            wp.launch(kernels.k_plasticity, NE,
                      [g.e, g.plastic, g.w, g.w0b, g.is_exc, wp.float32(0.001), wp.float32(0.02)], device=dev)
            wp.synchronize()
        out["plasticity_553k"] = timed(plasticity_fn)

        def changes_fn():
            wp.launch(kernels.k_changes, NE, [g.w, g.w0b, g.is_exc, wp.float32(0.02), g.changes], device=dev)
            wp.synchronize()
        out["changes_scan_553k"] = timed(changes_fn)

        def topk_fn():
            wp.launch(kernels.k_changes, NE, [g.w, g.w0b, g.is_exc, wp.float32(0.02), g.changes], device=dev)
            hv = wp.full(topk.CHANGE_TOP_K, -1.0, dtype=wp.float32, device=dev)
            hi = wp.zeros(topk.CHANGE_TOP_K, dtype=wp.int32, device=dev)
            wp.launch(topk.k_topk_changes, 1, [g.changes, hv, hi, topk.CHANGE_TOP_K, NE], device=dev)
            wp.synchronize()
        out["changes_topk180_553k"] = timed(topk_fn)

        def full_tick_fn():
            wp.launch(kernels.k_lif_edge_parallel, N,
                      [g.v, g.spikes, g.refac, g.vbuf, 0, wp.uint32(1),
                       wp.float32(0.0), stim[0], stim[1], field, optic[0], optic[1],
                       motor[0], motor[1], wp.float32(0.35), wp.float32(0.3)], device=dev)
            wp.launch(kernels.k_fanout_edge_parallel, NE,
                      [g.prev, g.src, g.dst, g.w, g.v], device=dev)
            wp.launch(kernels.k_commit_prev, N, [g.prev, g.spikes], device=dev)
            wp.synchronize()
        out["full_tick"] = timed(full_tick_fn, warmup=3)

        for k, (med, mn) in out.items():
            print(f"{k}\t{med:.3f}\t{mn:.3f}")
            results[f"warp_{dev}:{k}"] = (med, mn)

with open(os.path.join(DATA, "bench_results.json"), "w") as fh:
    json.dump({k: {"median_ms": v[0], "min_ms": v[1]} for k, v in results.items()}, fh, indent=1)
print("saved -> backend_warp/data/bench_results.json")
