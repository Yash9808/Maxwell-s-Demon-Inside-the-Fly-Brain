# e2e_server.py — Warp CUDA backend serving tick payloads over HTTP.
#
# Persistent GPU state (real circuit). Per request: run one full tick on GPU,
# extract the per-version payload, serve raw bytes with server-side timing
# headers X-Sim-Ms / X-Extract-Ms / X-Bytes.
#   v=1  full state:    V(f32) + spikes(u8) + heat(f32) + W(f32)   ~3.03 MB
#   v=2  compact state: spikes(u8) + scalars                        ~104 KB
#        (weights + top-K180 served only every 6th tick, like production)
#
# This is the F1 fallback rule applied to a new backend: the server reports
# compute_backend=warp_cuda honestly and FAILS if CUDA is missing — it never
# silently substitutes a CPU implementation.
#
# Usage: .venv-warp/Scripts/python.exe backend_warp/e2e_server.py [port] [v]
import json
import os
import socketserver
import sys
import time
from http.server import BaseHTTPRequestHandler

import numpy as np
import warp as wp

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kernels  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791


def load(name, dtype):
    return np.fromfile(os.path.join(DATA, name), dtype=dtype)


wp.init()
DEV = "cuda:0"
if not wp.is_device_available("cuda:0"):
    print("FATAL: compute_backend=warp_cuda requested but CUDA device unavailable. "
          "Refusing to silently fall back (F1 lesson).", file=sys.stderr)
    sys.exit(2)

src = load("src.i32", np.int32)
dst = load("dst.i32", np.int32)
w0 = load("w0.f32", np.float32)
sign = load("sign.u8", np.uint8)
meta = json.load(open(os.path.join(DATA, "meta.json")))
N, NE = meta["N"], meta["NE"]
lo = meta["layerStart"]
motor_drive = 0.35

with wp.ScopedDevice(DEV):
    g = kernels.Graph(np, N, NE, DEV)
    g.load_graph(src, dst, w0, sign)
    field_np = (np.random.default_rng(1).random(N) * 0.25).astype(np.float32)
    field = wp.array(field_np, dtype=wp.float32, device=DEV)
    # persistent pinned staging buffers for D2H extraction
    sp_pin = wp.empty(N, dtype=wp.uint8, device="cpu", pinned=True)
    heat_pin = wp.empty(N, dtype=wp.float32, device="cpu", pinned=True)
    v_pin = wp.empty(N, dtype=wp.float32, device="cpu", pinned=True)
    w_pin = wp.empty(NE, dtype=wp.float32, device="cpu", pinned=True)
    tick_n = [0]


def run_tick():
    t0 = time.perf_counter()
    with wp.ScopedDevice(DEV):
        wp.launch(kernels.k_lif_edge_parallel, N,
                  [g.v, g.spikes, g.refac, g.vbuf, tick_n[0], wp.uint32(1),
                   wp.float32(0.0), 0, lo[2], field, lo[1], lo[2], lo[4], N,
                   wp.float32(motor_drive), wp.float32(0.3)], device=DEV)
        wp.launch(kernels.k_fanout_edge_parallel, NE,
                  [g.prev, g.src, g.dst, g.w, g.v], device=DEV)
        wp.launch(kernels.k_commit_prev, N, [g.prev, g.spikes], device=DEV)
        wp.launch(kernels.k_traces, NE, [g.e, g.plastic, g.spikes, g.src, g.dst], device=DEV)
        wp.launch(kernels.k_decay_heat, N, [g.spikes, g.heat], device=DEV)
        wp.synchronize()
    tick_n[0] += 1
    return (time.perf_counter() - t0) * 1000.0


def extract_full():
    t0 = time.perf_counter()
    with wp.ScopedDevice(DEV):
        wp.copy(sp_pin, g.spikes)
        wp.copy(heat_pin, g.heat)
        wp.copy(v_pin, g.v)
        wp.copy(w_pin, g.w)
        wp.synchronize()
    body = v_pin.numpy().tobytes() + sp_pin.numpy().tobytes() + \
        heat_pin.numpy().tobytes() + w_pin.numpy().tobytes()
    return body, (time.perf_counter() - t0) * 1000.0


def extract_compact():
    t0 = time.perf_counter()
    with wp.ScopedDevice(DEV):
        wp.copy(sp_pin, g.spikes)
        wp.synchronize()
    body = sp_pin.numpy().tobytes()
    extra = b""
    weights = b""
    if tick_n[0] % 6 == 0:
        with wp.ScopedDevice(DEV):
            wp.copy(w_pin, g.w)
            wp.synchronize()
        weights = w_pin.numpy().tobytes()
    scalars = json.dumps({"tick": tick_n[0], "motor_drive": motor_drive}).encode()
    return body + b"|" + scalars + b"|" + weights + b"|" + extra, \
        (time.perf_counter() - t0) * 1000.0


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/tick"):
            sim_ms = run_tick()
            if "v=1" in self.path:
                body, ext_ms = extract_full()
                ver = 1
            else:
                body, ext_ms = extract_compact()
                ver = 2
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Sim-Ms", f"{sim_ms:.4f}")
            self.send_header("X-Extract-Ms", f"{ext_ms:.4f}")
            self.send_header("X-Bytes", str(len(body)))
            self.send_header("X-Version", str(ver))
            self.send_header("X-Backend", "warp_cuda")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Expose-Headers",
                             "X-Sim-Ms, X-Extract-Ms, X-Bytes, X-Version, X-Backend")
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/meta"):
            b = json.dumps({"backend": "warp_cuda", "N": N, "NE": NE}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
        else:
            self.send_response(404)
            self.end_headers()


class Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    # warmup ticks (JIT + caches) before serving
    for _ in range(5):
        run_tick()
    print(f"compute_backend=warp_cuda serving on 127.0.0.1:{PORT} "
          f"(N={N}, NE={NE})", flush=True)
    Server(("127.0.0.1", PORT), H).serve_forever()
