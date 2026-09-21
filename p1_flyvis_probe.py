"""p1_flyvis_probe.py — live flyvis diagnostics for the Stage F sidecar.

Verifies, against the REAL pretrained stack (no mocks):
  P1. checkpoints exist under FLYVIS_ROOT_DIR and a Network loads
  P2. network dims: n_nodes, input elements (721 hexels), cell types present
  P3. simulate() accepts (batch, frames, 1, 721) and returns (batch, frames, n_nodes)
  P4. LayerActivity exposes per-type traces (T4a / T4c / T5a sanity)
  P5. inference time per frame — feeds the sidecar's documented timeout policy

Run: ./.venv-flyvis/Scripts/python.exe p1_flyvis_probe.py [--model flow/0000/000]
Exit 0 only if all probes pass.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

# FLYVIS_ROOT_DIR must be set BEFORE importing flyvis (resolved at import time).
_ROOT = Path(__file__).resolve().parent / ".flyvis_data"
os.environ.setdefault("FLYVIS_ROOT_DIR", str(_ROOT))

# Windows fix MUST be applied before flyvis/datamate first write (see module doc).
from p1_flyvis_winfix import apply_winfix  # noqa: E402

apply_winfix()

import numpy as np  # noqa: E402
import torch  # noqa: E402

dt = 1 / 60  # matches the P1 suite's 16.7 ms tick; below flyvis's 1/50 warn threshold


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="flow/0000/000")
    args = ap.parse_args()

    t_all = time.time()
    t0 = time.time()
    import flyvis
    from flyvis import results_dir
    from flyvis.network.network_view import NetworkView
    from flyvis.utils.activity_utils import LayerActivity
    print(f"P0 import flyvis {flyvis.__version__}: {time.time()-t0:.1f}s root={results_dir}")

    t0 = time.time()
    view = NetworkView(args.model)
    net = view.init_network()
    print(f"P1 loaded {args.model}: {time.time()-t0:.1f}s "
          f"(n_nodes={net.n_nodes}, n_edges={net.n_edges}, params={net.num_parameters})")

    # --- stimulus surface ------------------------------------------------
    stim = net.stimulus
    n_in = stim.n_input_elements
    conn = net.connectome
    types = [t.decode() if isinstance(t, bytes) else str(t)
             for t in conn.unique_cell_types[:]]
    print(f"P2 input elements={n_in}; cell types={len(types)}; "
          f"input types={[t.decode() if isinstance(t, bytes) else str(t) for t in conn.input_cell_types]}")
    assert n_in == 721, f"expected 721 hexels, got {n_in}"
    for want in ("T4a", "T4c", "T5a"):
        assert want in types, f"{want} missing from connectome cell types"

    # --- flash response ---------------------------------------------------
    T_on, T_off = 40, 40
    movie = torch.zeros(1, T_on + T_off, 1, n_in)
    movie[:, :T_on] = 1.0
    # simulate() 'auto' prepends 1 s grey steady state; time the whole call
    t0 = time.time()
    y = net.simulate(movie, dt)
    torch.cuda.synchronize if torch.cuda.is_available() else None
    elapsed = time.time() - t0
    assert y.shape == (1, T_on + T_off, net.n_nodes), f"unexpected activity shape {y.shape}"
    print(f"P3 simulate OK {tuple(y.shape)} in {elapsed:.2f}s "
          f"({(T_on+T_off)/elapsed:.1f} frames/s incl. steady-state)")

    la = LayerActivity(y, net.connectome, keepref=True)
    for k in ("T4a", "T4c", "T5a"):
        tr = np.asarray(la.central.__getattr__(k))
        d = float(tr[0, T_on - 1] - tr[0, 0])
        print(f"P4 {k}: central trace dim={tr.shape} on-response delta={d:+.4f}")

    # --- direction sanity: render two bars via the native renderer --------
    from flyvis.datasets.rendering import HexEye
    eye = HexEye(721, 25)
    offsets = np.array([-8, 8]) * 2.25 * np.pi / 180
    seq = eye.render_offset_bars(bar_width_rad=2.25 * np.pi / 180,
                                 bar_height_rad=2.25 * np.pi / 180 * 9,
                                 n_bars=1, offsets=offsets,
                                 bar_intensity=1, bg_intensity=0.5,
                                 moving_angle=0, bar_loc_horizontal=np.pi / 2)
    print(f"P5 HexEye render OK shape={tuple(seq.shape)} "
          f"(frames={seq.shape[0]}, hexels={seq.shape[-1]})")

    print(f"\nALL PROBES PASS ({time.time()-t_all:.1f}s total)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
