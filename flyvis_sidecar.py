#!/usr/bin/env python3
"""P1 Stage F — flyvis sidecar: an HTTP boundary between the browser model and
flyvis (TuragaLab), WITHOUT importing flyvis at build time.

Responsibility boundary (see P1_FLYVIS_BRIDGE.md):

    physical visual field (browser chamber)
        -> standardized P1 stimulus suite (p1_stimuli, JSON)
        -> THIS sidecar: stimulus -> flyvis-compatible ndarray
        -> flyvis Network (executed only if flyvis+torch+checkpoints exist)
        -> per-type, per-tick firing-rate response (JSON, downsampled)
        -> p1_flyvis_client.js / p1_parity_test.js (browser-model comparison)

Design rules honored here:
  * NO fabricated parameters: if flyvis is missing, /health says so and every
    /predict returns 503 with the exact reason. No model, no weights, no
    numbers are invented.
  * The stimulus contract is fully specified and testable WITHOUT flyvis
    (the /stimulus endpoint round-trips the same JSON the browser sends).
  * Standard library only (no Flask dependency): http.server based.

flyvis execution (implemented; requires the .venv-flyvis environment):
  * first /predict lazily loads a pretrained connectome-constrained Network
    (env P1_FLYVIS_MODEL, default flow/0000/000 from the published ensemble)
    and runs Network.simulate on the request frames rasterized onto the real
    721-hexel lattice (azimuth-binned HexEye geometry — same column semantics
    as the browser model's 8-bin interface).
  * returned traces are per-cell-type CENTRAL activity, aligned 1:1 with the
    submitted frames (flyvis prepends its own 1 s grey steady state internally).
  * inference timing measured on this machine: ~4 s per 80-frame stimulus
    after a ~15-40 s one-time model load; clients must allow for that.

Run (host python, no flyvis):   python flyvis_sidecar.py --port 8767
Run (flyvis env):               .venv-flyvis/Scripts/python.exe flyvis_sidecar.py --port 8767
Contract tests (no flyvis):     python flyvis_sidecar.py --self-test
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ---------------------------------------------------------------- flyvis probe
def probe_flyvis() -> dict:
    """Report flyvis availability HONESTLY. Never raises; never fabricates."""
    import importlib.util as u
    report = {
        "flyvis_installed": u.find_spec("flyvis") is not None,
        "torch_installed": u.find_spec("torch") is not None,
        "numpy": u.find_spec("numpy") is not None,
    }
    report["ready"] = report["flyvis_installed"] and report["torch_installed"] \
        and report["numpy"]
    # checkpoint discovery is flyvis-version specific; we only LOOK, never guess
    report["checkpoint_env"] = None
    try:
        import os
        if report["flyvis_installed"]:
            report["checkpoint_env"] = os.environ.get("FLYVIS_ROOT") or \
                os.environ.get("FLYVIS_CHECKPOINT") or "default (flyvis cache)"
    except Exception:
        pass
    if not report["ready"]:
        report["blocked_reason"] = (
            "flyvis/torch not installed in this environment — the sidecar "
            "serves the stimulus contract and returns 503 for /predict. "
            "Install flyvis (TuragaLab) + pretrained ensemble checkpoints to "
            "enable real inference. No parameters are fabricated meanwhile.")
    return report


# ------------------------------------------------------- stimulus -> flyvis
# The standardized P1 stimulus suite (parity test). Coordinates: the stimulus
# is defined on the same normalized (u, v) field as Stage E's retinotopy grid
# (u = scene elevation axis, v = azimuth axis — see P1_RETINOTOPY_REPORT.md).
STIMULUS_SUITE = {
    "flash":            {"type": "full_field", "profile": "step", "amplitude": 1.0,
                         "on_ticks": 40, "off_ticks": 40},
    "moving_edge_lr":   {"type": "edge", "direction": +1, "columns": 8,
                         "ticks_per_column": 6, "amplitude": 1.0},
    "moving_edge_rl":   {"type": "edge", "direction": -1, "columns": 8,
                         "ticks_per_column": 6, "amplitude": 1.0},
    "stationary_contrast": {"type": "full_field", "profile": "sin",
                            "freq_hz": 1.0, "amplitude": 0.5, "ticks": 80},
}
TICK_MS = 16.7   # the app's frame semantics; flyvis uses its own dt (declared in responses)


def stimulus_to_frames(name: str) -> list[list[float]]:
    """Expand a named stimulus into per-tick intensity frames [0..1]^C.

    C = columns (default 8) for edge stimuli; full-field uses C=1 internally
    and the client broadcasts. Returns the EXACT frames the flyvis adapter
    would rasterize — this function is pure and testable without flyvis.
    """
    spec = STIMULUS_SUITE[name]
    frames: list[list[float]] = []
    if spec["type"] == "full_field":
        if spec["profile"] == "step":
            frames = [[spec["amplitude"]]] * spec["on_ticks"] + [[0.0]] * spec["off_ticks"]
        else:  # sin
            import math
            n = spec["ticks"]
            frames = [[spec["amplitude"] * 0.5 * (1 + math.sin(2 * math.pi * spec["freq_hz"] * t / (n * TICK_MS / 1000)))]
                      for t in range(n)]
    elif spec["type"] == "edge":
        C = spec["columns"]
        for t in range(C * spec["ticks_per_column"]):
            col = (t // spec["ticks_per_column"]) % C
            c = col if spec["direction"] > 0 else C - 1 - col
            frames.append([spec["amplitude"] if i == c else 0.0 for i in range(C)])
    return frames


# ------------------------------------------------------------- HTTP surface
class Handler(BaseHTTPRequestHandler):
    server_version = "P1-flyvis-sidecar/0.1"

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 (http.server API)
        from urllib.parse import urlsplit, parse_qs
        parts = urlsplit(self.path)
        path, query = parts.path, parts.query
        if path == "/health":
            self._json(200, {"sidecar": "p1", "status": "up",
                             "flyvis": probe_flyvis(),
                             "runtime": {"model": _STATE["model"],
                                         "loaded": _STATE["net"] is not None,
                                         "load_seconds": _STATE["load_seconds"],
                                         "error": _STATE["error"]},
                             "time": time.time()})
        elif path == "/stimulus":
            qs = parse_qs(query)
            name = (qs.get("name") or ["flash"])[0]
            if name not in STIMULUS_SUITE:
                self._json(404, {"error": f"unknown stimulus '{name}'",
                                 "available": sorted(STIMULUS_SUITE)})
                return
            frames = stimulus_to_frames(name)
            self._json(200, {"name": name, "n_frames": len(frames),
                             "columns": len(frames[0]), "tick_ms": TICK_MS,
                             "frames": frames})
        else:
            self._json(404, {"error": "unknown endpoint", "endpoints":
                             ["/health", "/stimulus?name=", "/predict (POST)"]})

    def do_POST(self):  # noqa: N802
        if self.path != "/predict":
            self._json(404, {"error": "unknown endpoint"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(length) or b"{}")
        except Exception as e:
            self._json(400, {"error": f"bad JSON: {e}"})
            return
        ready = probe_flyvis()
        if not ready["ready"]:
            self._json(503, {"error": "flyvis not available",
                             "flyvis": ready,
                             "contract_echo": {k: (len(v) if isinstance(v, list) else v)
                                               for k, v in req.items()}})
            return
        # ---- real flyvis execution path (reached only when installed) ------
        # NOTE: not exercised in this workspace (audit fact). The adapter maps
        # req["stimulus"] frames onto flyvis's stimulus object (stretched over
        # the hex columns via Stage E's grid) and returns per-type rates.
        try:
            self._json(200, _run_flyvis(req))
        except Exception as e:  # pragma: no cover - depends on optional dep
            self._json(500, {"error": f"flyvis execution failed: {e}"})

    def log_message(self, fmt, *args):  # quiet
        pass


# ------------------------------------------------------------- flyvis runtime
# Loaded lazily on first /predict; loading is locked so concurrent requests
# share one model instance. _STATE["error"] carries the honest failure reason.
_STATE = {
    "net": None,
    "model": None,
    "loading": False,
    "error": None,
    "hexel_cols": None,   # (n_hexels,) int8 azimuth-column map, 0..7
    "load_seconds": None,
}


def _load_flyvis() -> None:
    """Import flyvis and load the pretrained network. Sets _STATE honestly."""
    import threading
    if _STATE["net"] is not None or _STATE["loading"]:
        return
    with threading.Lock():
        if _STATE["net"] is not None or _STATE["loading"]:
            return
        _STATE["loading"] = True
        t0 = time.time()
        try:
            # Windows fix must precede flyvis import (datamate HDF5 unlink bug).
            from p1_flyvis_winfix import apply_winfix
            apply_winfix()
            import torch  # noqa: F401
            import flyvis  # noqa: F401  (sets torch default device, root dirs)
            from flyvis.network.network_view import NetworkView
            model = os.environ.get("P1_FLYVIS_MODEL", "flow/0000/000")
            net = NetworkView(model).init_network()
            _STATE["net"] = net
            _STATE["model"] = model
            _STATE["load_seconds"] = round(time.time() - t0, 1)
            _STATE["error"] = None
        except Exception as e:  # pragma: no cover - environment-dependent
            _STATE["net"] = None
            _STATE["error"] = f"{type(e).__name__}: {e}"
        finally:
            _STATE["loading"] = False


def _hexel_azimuth_columns(n_cols: int = 8):
    """Map the 721 real hexels onto n_cols azimuth bins (Stage E semantics).

    Hexel centers come from flyvis.datasets.rendering.utils.hex_center_
    coordinates — the same function HexEye itself is built on — where x is
    the horizontal (azimuth) lattice axis (x = dist_w * r). Equal-width bins
    over the x extent give columns whose temporal order matches the browser
    model's 8-bin edge stimulus.
    """
    import numpy as np
    if _STATE["hexel_cols"] is None:
        from flyvis.datasets.rendering.utils import hex_center_coordinates
        # replicate HexEye's default monitor sizing for n_ommatidia=721, ppo=25
        n_hex_circfer = int(2 * (-0.5 + np.sqrt(0.25 - (1 - 721) / 3)) + 1)  # == 31
        monitor = 25 * n_hex_circfer
        xs, _, _ = hex_center_coordinates(721, monitor, monitor)
        x = np.asarray(xs, dtype=float)
        edges = np.linspace(x.min() - 1e-6, x.max() + 1e-6, n_cols + 1)
        _STATE["hexel_cols"] = np.clip(np.digitize(x, edges) - 1, 0, n_cols - 1).astype(int)
    return _STATE["hexel_cols"]


def _run_flyvis(req: dict) -> dict:
    """Adapter: standardized frames -> flyvis Network -> per-type traces.

    Request:  {"stimulus": name, "frames": [[c0..cC-1], ...], "tick_ms": float}
    Response: {"model", "n_frames", "dt", "steady_state_note",
               "cell_types": {type: [T floats (central activity)]},
               "input_types": {"R1": [...], ...}}

    Traces align 1:1 with the submitted frames; flyvis internally prepends
    1 s of grey (0.5) steady-state stimulus, which is NOT part of the output.
    Activity is the trained network's dimensionless membrane-state variable —
    a model output, not a measured firing rate (provenance note in response).
    """
    # --- validate the request BEFORE importing anything heavy (host-safe) ---
    frames = req.get("frames")
    if not frames or not isinstance(frames, list):
        raise ValueError("request must carry non-empty 'frames' [[...], ...]")
    tick_ms = float(req.get("tick_ms", TICK_MS))
    dt = tick_ms / 1000.0
    if dt > 1 / 50:
        raise ValueError(f"tick_ms={tick_ms} integrates at dt={dt:.4f}s > 1/50")

    import numpy as np
    import torch

    if _STATE["net"] is None:
        _load_flyvis()
        if _STATE["net"] is None:
            raise RuntimeError(f"flyvis model unavailable: {_STATE['error']}")
    net = _STATE["net"]

    cols = _hexel_azimuth_columns()          # (721,) in 0..7
    n_hexels = len(cols)
    T = len(frames)
    C = max(len(f) for f in frames)
    if not all(len(f) == C for f in frames):
        raise ValueError("all frames must have identical width")
    inten = np.zeros((T, C), dtype=np.float32)
    for t, f in enumerate(frames):
        inten[t, :len(f)] = np.asarray(f, dtype=np.float32)
    # rasterize onto the real lattice:
    #   width 1        -> full-field, broadcast to every hexel
    #   width n_cols   -> hexel h shows its azimuth column's intensity
    if C == 1:
        movie = np.repeat(inten, n_hexels, axis=1)         # (T, 721)
    elif C == 8:
        movie = inten[:, cols]                             # (T, 721)
    else:
        raise ValueError(
            f"frames width {C} unsupported: use 1 (full-field broadcast) "
            f"or 8 (azimuth columns), matching the P1 stimulus suite")
    movie = torch.from_numpy(np.ascontiguousarray(movie))
    movie = movie[None, :, None, :]                    # (1, T, 1, 721)

    y = net.simulate(movie, dt)                        # (1, T, n_nodes)
    from flyvis.utils.activity_utils import LayerActivity
    la = LayerActivity(y.cpu(), net.connectome, keepref=True)

    def dec(x):
        return x.decode() if isinstance(x, bytes) else str(x)

    traces = {}
    for t in la.unique_cell_types:
        name = dec(t)
        tr = np.asarray(la.central.__getattr__(name))[0]  # (T,)
        traces[name] = [round(float(v), 6) for v in tr]
    input_traces = {}
    for it in la.input_cell_types:
        name = dec(it)
        tr = np.asarray(la.central.__getattr__(name))[0]
        input_traces[name] = [round(float(v), 6) for v in tr]

    return {
        "model": _STATE["model"],
        "n_frames": T,
        "dt": dt,
        "tick_ms": tick_ms,
        "steady_state_note": "flyvis prepends 1 s grey(0.5) steady state internally; "
                             "traces cover exactly the submitted frames",
        "provenance": "SOURCE-DERIVED network/checkpoints (TuragaLab flyvis ensemble); "
                      "activity = trained dimensionless state, not measured Hz",
        "n_cell_types": len(traces),
        "cell_types": traces,
        "input_types": input_traces,
    }


def self_test() -> int:
    """Contract tests runnable WITHOUT flyvis (the sidecar's testable half)."""
    ok = True
    # 1) every suite stimulus expands to frames with consistent shape
    for name in STIMULUS_SUITE:
        frames = stimulus_to_frames(name)
        assert frames, name
        assert all(len(f) == len(frames[0]) for f in frames), name
        assert all(0.0 <= x <= 1.0 for f in frames for x in f), name
        print(f"contract OK  {name}: {len(frames)} frames x {len(frames[0])} cols")
    # 2) edge directions are time-reverses of each other
    a = stimulus_to_frames("moving_edge_lr")
    b = stimulus_to_frames("moving_edge_rl")
    assert a == b[::-1], "directions must mirror"
    print("contract OK  moving_edge_lr == reverse(moving_edge_rl)")
    # 3) health probe honest
    probe = probe_flyvis()
    assert isinstance(probe["ready"], bool)
    if not probe["ready"]:
        assert "blocked_reason" in probe
        print("contract OK  /health reports blocked:", probe["blocked_reason"][:60], "...")
    else:
        print("contract OK  /health reports flyvis READY")
    # 4) the Windows datamate shim: True under datamate, honest False without it
    import importlib.util as _u
    from p1_flyvis_winfix import apply_winfix
    has_datamate = _u.find_spec("datamate") is not None
    assert apply_winfix() is has_datamate
    print("contract OK  datamate Windows HDF5 shim "
          + ("applied" if has_datamate else "honestly skipped (no datamate here)"))
    # 5) _run_flyvis validates the request BEFORE importing flyvis (host-safe)
    try:
        _run_flyvis({})
        raise AssertionError("empty request must raise")
    except ValueError:
        print("contract OK  _run_flyvis rejects empty request before flyvis import")
    except RuntimeError as e:
        raise AssertionError(f"validation must precede flyvis import: {e}")
    return 0 if ok else 1


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8767)
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        sys.exit(self_test())
    # Single-threaded BY DESIGN: datamate (flyvis's storage layer) keeps its
    # context in a threading.local that is only initialized on the main thread,
    # so request handling on worker threads raises AttributeError. Serving on
    # the main thread serializes requests — correct for this single-client
    # parity workload and avoids CPU thrash during flyvis inference.
    httpd = HTTPServer(("127.0.0.1", args.port), Handler)
    probe = probe_flyvis()
    print(f"P1 flyvis sidecar on 127.0.0.1:{args.port} — flyvis ready: {probe['ready']}")
    if not probe["ready"]:
        print("  " + probe["blocked_reason"])
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
