# warp_server.py — production Warp CUDA brain backend (Anatomical 3D A/B test).
#
# Evolution of backend_warp/e2e_server.py (the validated investigation
# prototype): same kernels (backend_warp/kernels.py, correctness-gated against
# brain_worker.js semantics), extended to the FULL production tick so the
# browser experiment runs the same simulation as brain_worker.js:
#
#   production additions vs the prototype
#     * layer-0 sensor-channel injection  (injectLayerChannels, gain 12)
#     * stimulus burst envelope           (kernel-side, stim_burst arg)
#     * modulatory third-factor EMAs      (dopamine/serotonin/octopamine)
#     * dopamine envelope + gated learning (k_plasticity, d = lr*DA*G;
#       DA += reward dq; DA *= 0.985) and the motor-rate / motor-base stats
#
#   backend rules (F1 lesson, enforced)
#     * reports compute_backend=warp_cuda honestly; exits if CUDA is missing —
#       it NEVER silently substitutes a CPU implementation.
#     * serves the COMPACT render state only (spikes u8[N] + scalars, weights
#       every 12th tick, mirroring brain_worker's publish schedule). The
#       ~3 MB/tick full-state path is deliberately NOT implemented.
#
# RNG note (from WARP_BACKEND_INVESTIGATION.md): JS Math.random() is
# process-local and cannot run on a GPU. The kernel uses the per-(neuron,tick)
# LCG stream (same statistics, deterministic per tick) for the stim/optic/
# motor/excitability Poisson gates; the layer-0 SENSOR gate (per-channel
# values from the page) is drawn host-side with NumPy. This is a documented,
# honest difference from the JS worker, not a silent one.
#
# /tick response (binary, Content-Type application/octet-stream):
#   25-byte header  struct "<IIBfff":  tick u32, N u32, hasW u8,
#                                      dav f32, mrs f32, mb f32
#   then N bytes spikes (u8)
#   then, if hasW, NE*4 bytes W (f32 LE)
#   Timing/identity headers: X-Sim-Ms, X-Backend, X-Tick, X-Has-W.
#
# Dataset rule: /init REJECTS a circuit whose declared key/dimensions do not
# match its arrays (409). The page re-inits on every dataset switch, so a
# stale circuit can never be simulated silently.
#
# Usage:
#   .venv-warp/Scripts/python.exe backend_warp/warp_server.py [port]
import base64
import json
import os
import socketserver
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler

import numpy as np
import warp as wp

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kernels  # noqa: E402

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
SERVER_VERSION = "warp-cuda-1.0"
DA_CLAMP = (-1.5, 3.0)          # brain_worker.js reward clamp
MOD_GAINS = (0.15, 0.15, 0.15)  # dopamine, serotonin, octopamine
HDR_FMT = "<IIBfff"
HDR_SIZE = struct.calcsize(HDR_FMT)          # 21 bytes
HDR_PAD = struct.calcsize("<IIBfffxxx")      # padded to 24: W is read as a
                                             # Float32Array view at 21+N in the
                                             # browser, which requires 4-byte
                                             # alignment (21 alone is misaligned)

wp.init()
DEV = "cuda:0"
if not wp.is_device_available("cuda:0"):
    print("FATAL: compute_backend=warp_cuda requested but CUDA device unavailable. "
          "Refusing to serve (never silently fall back to CPU - F1 lesson).",
          file=sys.stderr)
    sys.exit(2)


def clampf(x, a, b):
    return a if x < a else (b if x > b else x)


@wp.kernel
def k_vbuf_pre(vbuf: wp.array(dtype=wp.float32),
               pre: wp.array(dtype=wp.float32)):
    """Fold host-drawn sensor injections into the per-tick injector buffer
    before k_lif_edge_parallel adds its own (kernel-RNG) gates and runs LIF."""
    i = wp.tid()
    vbuf[i] = vbuf[i] + pre[i]


class Brain:
    """Persistent GPU state for one initialized dataset (serialized by lock)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.ready = False
        self.dataset = None
        self.N = self.NE = 0
        self.tick_n = 0
        self.dav = 0.0
        self.mrs = 0.0
        self.mb = 0.0
        self.stim_pulse = 0.0
        self.mod_ema = np.zeros(3, dtype=np.float64)
        self.ws = 0.02
        self.last_err = None

    # ---- init from the page's /init body (production filter, WS applied) ---
    def init(self, req):
        dataset = str(req.get("dataset", ""))
        N = int(req["N"]); NE = int(req["NE"])
        lo = np.frombuffer(req["_layerOff"], dtype="<i4").astype(np.int64)
        members = np.frombuffer(req["_members"], dtype="<i4")
        src = np.frombuffer(req["_src"], dtype="<i4").astype(np.int32)
        dst = np.frombuffer(req["_dst"], dtype="<i4").astype(np.int32)
        w0 = np.frombuffer(req["_w0"], dtype="<f4").astype(np.float32)
        sign = np.frombuffer(req["_sign"], dtype=np.uint8)
        oc_raw = req.get("_opticCol")
        optic_col = (np.frombuffer(oc_raw, dtype="<u2").astype(np.int64)
                     if oc_raw else None)
        optic_layer = int(req.get("opticLayer", -1))
        stim_layers = [int(x) for x in (req.get("stimLayers") or [0, 1])]
        ms_raw, mt_raw = req.get("_modS"), req.get("_modType")
        mod_s = (np.frombuffer(ms_raw, dtype="<i4").astype(np.int64)
                 if ms_raw else np.zeros(0, dtype=np.int64))
        mod_t = (np.frombuffer(mt_raw, dtype=np.uint8)
                 if mt_raw else np.zeros(0, dtype=np.uint8))
        ws = float(req.get("WS", 0.02))

        # ---- dimension guards (wrong-circuit protection) -------------------
        if int(lo[-1]) != N or members.size != N:
            raise ValueError(f"members/layerOff do not sum to N={N}")
        if src.size != NE or dst.size != NE or w0.size != NE or sign.size != NE:
            raise ValueError(f"edge arrays do not match NE={NE}")
        if mod_s.size != mod_t.size:
            raise ValueError("modS/modType length mismatch")
        if NE and (int(src.min()) < 0 or int(src.max()) >= N
                   or int(dst.min()) < 0 or int(dst.max()) >= N):
            raise ValueError("edge endpoint out of range for N")
        if optic_col is not None and optic_layer >= 0:
            k_n = int(lo[optic_layer + 1] - lo[optic_layer])
            if optic_col.size < k_n:
                raise ValueError(f"opticCol shorter than optic layer ({optic_col.size} < {k_n})")
        if dataset not in ("fafb", "mcns"):
            raise ValueError(f"unknown dataset key: {dataset!r}")

        with wp.ScopedDevice(DEV):
            g = kernels.Graph(np, N, NE, DEV)
            g.load_graph(src, dst, w0, sign)
            self.g = g
            self.d_field = wp.zeros(N, dtype=wp.float32, device=DEV)
            self.sens_buf = wp.zeros(N, dtype=wp.float32, device=DEV)
            self.sp_pin = wp.empty(N, dtype=wp.uint8, device="cpu", pinned=True)
            self.sens_pin = wp.empty(N, dtype=wp.float32, device="cpu", pinned=True)
            self.w_pin = wp.empty(NE, dtype=wp.float32, device="cpu", pinned=True)
            self.field_pin = wp.empty(N, dtype=wp.float32, device="cpu", pinned=True)
        self.N, self.NE = N, NE
        # W section must start at a 4-byte boundary (browser Float32Array view):
        # pad after the N-byte spike section.
        self.w_pad = (4 - (N % 4)) % 4
        self.dataset = dataset
        self.ws = ws
        self.last_err = None   # a successful init clears any stale error banner
        self.layer_off = lo
        self.members = members
        self.optic_layer = optic_layer
        self.optic_col = optic_col
        self.stim_layers = stim_layers
        self.mod_groups = [mod_s[mod_t == t] for t in range(3)]
        self.n_layers = len(lo) - 1
        self.tick_n = 0
        self.dav = 0.0
        self.mrs = self.mb = 0.0
        self.stim_pulse = 0.0
        self.mod_ema[:] = 0.0
        self.ready = True
        return {"ok": True, "N": N, "NE": NE, "dataset": dataset,
                "layers": self.n_layers,
                "modulatory": int(sum(x.size for x in self.mod_groups))}

    # ---- one production tick ------------------------------------------------
    def tick(self, s7, visual, motor_drive, ex_amp, lr, dt):
        g = self.g
        lo = self.layer_off
        t_n = self.tick_n
        t0 = time.perf_counter()

        # tick-start stimulus envelope (worker: _stimPulse*0.82 + m.stim, where
        # reward events arrive separately and decay here)
        burst = min(1.5, self.stim_pulse * 0.82)
        self.stim_pulse = burst

        # -- host-side input assembly ----------------------------------------
        # (a) per-neuron optic drive from the page's retinotopic field
        if visual is not None and self.optic_layer >= 0 and self.optic_col is not None:
            a, b = int(lo[self.optic_layer]), int(lo[self.optic_layer + 1])
            k_n = b - a
            vals = np.asarray(visual, dtype=np.float32)
            dr = np.zeros(k_n, dtype=np.float32)
            col = self.optic_col[:k_n]
            ok = col < vals.size
            dr[ok] = vals[col[ok]]
            self.field_pin.numpy()[:] = 0.0
            self.field_pin.numpy()[a:b] = dr
            wp.copy(self.d_field, self.field_pin)
        # (b) layer-0 sensor-channel injection (production injectLayerChannels:
        #     channel = floor(k*bins/len); gate rand < s[ch]*0.5; += 12*(0.5+rand))
        self.sens_pin.numpy()[:] = 0.0
        if s7 and len(s7) > 0:
            a, b = int(lo[0]), int(lo[1])
            n0 = b - a
            bins = len(s7)
            sv = np.asarray(s7, dtype=np.float32)
            chans = np.minimum(bins - 1, (np.arange(n0, dtype=np.int64) * bins) // n0)
            gate = np.random.random(n0) < (sv[chans] * np.float32(0.5))
            amp = (np.random.random(n0) * 0.5 + 0.5).astype(np.float32) * np.float32(12.0)
            add = np.where(gate, amp, np.float32(0.0)).astype(np.float32)
            self.sens_pin.numpy()[a:b] = add
        wp.copy(self.sens_buf, self.sens_pin)

        # -- GPU tick (production order) --------------------------------------
        with wp.ScopedDevice(DEV):
            stim_a = int(lo[self.stim_layers[0]]) if self.stim_layers else 0
            stim_b = int(lo[self.stim_layers[-1] + 1]) if self.stim_layers else 0
            ml = self.n_layers - 1
            ol_a = int(lo[self.optic_layer]) if self.optic_layer >= 0 else 0
            ol_b = int(lo[self.optic_layer + 1]) if self.optic_layer >= 0 else 0
            wp.launch(k_vbuf_pre, self.N, [g.vbuf, self.sens_buf], device=DEV)
            wp.launch(kernels.k_lif_edge_parallel, self.N,
                      [g.v, g.spikes, g.refac, g.vbuf,
                       t_n, wp.uint32(1), wp.float32(burst),
                       stim_a, stim_b,
                       self.d_field, ol_a, ol_b,
                       lo[ml], lo[ml + 1],
                       wp.float32(motor_drive), wp.float32(ex_amp)], device=DEV)
            wp.launch(kernels.k_fanout_edge_parallel, self.NE,
                      [g.prev, g.src, g.dst, g.w, g.v], device=DEV)
            wp.launch(kernels.k_commit_prev, self.N, [g.prev, g.spikes], device=DEV)
            wp.launch(kernels.k_traces, self.NE,
                      [g.e, g.plastic, g.spikes, g.src, g.dst], device=DEV)
            wp.synchronize()

        # -- host-side scalars (brain_worker.js order) ------------------------
        wp.copy(self.sp_pin, g.spikes)
        wp.synchronize()
        sp = self.sp_pin.numpy()
        # P0 third-factor EMAs from modulatory source activity
        for t in range(3):
            idxs = self.mod_groups[t]
            if idxs.size:
                act = float(sp[idxs].sum())
                self.mod_ema[t] = self.mod_ema[t] * 0.99 + (act / idxs.size) * 0.01
        # dopamine envelope decay, then DA-gated learning
        self.dav *= 0.985
        d0 = lr * self.dav
        if abs(d0) >= 1e-5:
            G = 1.0
            for t in range(3):
                if MOD_GAINS[t] and self.mod_ema[t] > 0:
                    G += MOD_GAINS[t] * min(1.0, self.mod_ema[t])
            with wp.ScopedDevice(DEV):
                wp.launch(kernels.k_plasticity, self.NE,
                          [g.e, g.plastic, g.w, g.w0b, g.is_exc,
                           wp.float32(d0 * G), wp.float32(self.ws)], device=DEV)
                wp.synchronize()
        # motor firing statistics (identical math to the worker)
        a, b = int(lo[ml]), int(lo[ml + 1])
        ms = float(sp[a:b].sum())
        self.mrs = self.mrs * 0.85 + (ms / max(1, b - a) / max(dt, 1e-3)) * 0.15
        self.mb += (self.mrs - self.mb) * clampf(dt * 0.1, 0.0, 1.0)

        sim_ms = (time.perf_counter() - t0) * 1000.0
        self.tick_n = t_n + 1

        # -- compact-state message (spikes already on host; W every 12th) ----
        has_w = (self.tick_n % 12) == 0
        body = bytearray(struct.pack(HDR_FMT, self.tick_n, self.N,
                                     1 if has_w else 0,
                                     self.dav, self.mrs, self.mb))
        body += b"\x00\x00\x00"               # pad 21 -> 24 (f32 view alignment)
        body += sp.tobytes()
        body += b"\x00" * self.w_pad          # align W to 4 bytes for f32 views
        if has_w:
            with wp.ScopedDevice(DEV):
                wp.copy(self.w_pin, g.w)
                wp.synchronize()
            body += self.w_pin.numpy().tobytes()
        return sim_ms, bytes(body)

    def reward(self, dq, stim):
        self.dav = clampf(self.dav + dq, DA_CLAMP[0], DA_CLAMP[1])
        if stim:
            self.stim_pulse = min(1.5, self.stim_pulse + stim)


BRAIN = Brain()


# ---- HTTP layer -------------------------------------------------------------
class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    disable_nagle_algorithm = True   # localhost tick traffic: cut 40-100 ms
                                     # Nagle/delayed-ACK stalls per request

    def end_headers(self):
        # page reads timing headers -> must be CORS-exposed
        self.send_header("Access-Control-Expose-Headers", "X-Sim-Ms, X-Backend, X-Tick")
        super().end_headers()

    def log_message(self, *a):
        pass

    def _send(self, code, ctype, body, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, "application/json", json.dumps(obj).encode())

    def _read_body(self):
        n = int(self.headers.get("Content-Length", "0"))
        if n <= 0 or n > 400 * 1024 * 1024:
            raise ValueError(f"bad body size {n}")
        return self.rfile.read(n)

    def do_GET(self):
        if self.path.startswith("/health"):
            self._json({
                "backend": "warp_cuda", "server_version": SERVER_VERSION,
                "cuda": True, "ready": BRAIN.ready, "dataset": BRAIN.dataset,
                "N": BRAIN.N, "NE": BRAIN.NE, "tick": BRAIN.tick_n,
                "last_error": BRAIN.last_err,
                "state_bytes_per_tick": (BRAIN.N if BRAIN.ready else 0),
                "weights_every": 12, "full_state_path": False,
            })
        else:
            self._json({"error": "not found"}, 404)

    def do_OPTIONS(self):
        # browser preflight for cross-origin POSTs (belt & braces: the page
        # avoids preflight by not setting Content-Type, but stay correct)
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        try:
            if self.path.startswith("/init"):
                raw = self._read_body()
                hdr_len = struct.unpack("<I", raw[:4])[0]
                hdr = json.loads(raw[4:4 + hdr_len].decode())
                blobs = json.loads(raw[4 + hdr_len:].decode())
                req = dict(hdr)
                for k, b64 in blobs.items():
                    req[k] = base64.b64decode(b64)
                with BRAIN.lock:
                    out = BRAIN.init(req)
                self._json(out)
            elif self.path.startswith("/tick"):
                if not BRAIN.ready:
                    self._json({"error": "not initialized"}, 409)
                    return
                m = json.loads(self._read_body().decode())
                with BRAIN.lock:
                    sim_ms, body = BRAIN.tick(
                        m.get("s") or [], m.get("visual"),
                        float(m.get("motorDrive", 0.35)),
                        float(m.get("exAmp", 0.3)),
                        float(m.get("lr", 0.0)), float(m.get("dt", 0.016)))
                self._send(200, "application/octet-stream", body, {
                    "X-Backend": "warp_cuda",
                    "X-Sim-Ms": f"{sim_ms:.3f}",
                    "X-Tick": str(BRAIN.tick_n),
                })
            elif self.path.startswith("/stop"):
                # page-requested teardown (leaving anat / backend switch).
                # Marks the backend not-ready; the next /init re-initializes.
                with BRAIN.lock:
                    BRAIN.ready = False
                self._json({"ok": True, "stopped": True})
            elif self.path.startswith("/reward"):
                if not BRAIN.ready:
                    self._json({"error": "not initialized"}, 409)
                    return
                m = json.loads(self._read_body().decode())
                with BRAIN.lock:
                    BRAIN.reward(float(m.get("dq", 0.0)),
                                 float(m.get("stim", 0.0)))
                self._json({"ok": True})
            else:
                self._json({"error": "not found"}, 404)
        except Exception as e:  # explicit error surface; never a silent fallback
            msg = f"{type(e).__name__}: {e}"
            BRAIN.last_err = msg
            try:
                self._json({"error": msg}, 400)
            except Exception:
                pass


class Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    # JIT warmup of the two local kernels (kernels.py modules cache on disk)
    _z = wp.zeros(8, dtype=wp.float32, device=DEV)
    _zb = wp.zeros(8, dtype=wp.uint8, device=DEV)
    wp.launch(k_vbuf_pre, 8, [_z, _z], device=DEV)
    wp.launch(kernels.k_lif_edge_parallel, 8,
              [_z, _zb, _zb, _z, 0, wp.uint32(1), wp.float32(0.0),
               0, 0, _z, 0, 0, 0, 8, wp.float32(0.0), wp.float32(0.0)], device=DEV)
    wp.synchronize()
    print(f"compute_backend=warp_cuda serving on 127.0.0.1:{PORT} "
          f"(v={SERVER_VERSION}); POST /init to load a dataset", flush=True)
    Server(("127.0.0.1", PORT), H).serve_forever()
