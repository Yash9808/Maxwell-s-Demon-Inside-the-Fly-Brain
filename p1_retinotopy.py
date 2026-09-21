"""Stage E — retinotopy: derive a 2D medulla-column map from real geometry.

Input (all local, SOURCE-DERIVED):
  fly_brain_circuit.json  optic_channels: normalized [u, v, depth] per optic
                          neuron, u/v from mean PRE-synapse positions in FAFB
                          nm (extract_circuit.py), separately min-max
                          normalized over optic neurons.
  fly_brain_meta.json     canonical frame + ME_L/ME_R centroid/spread stats.

Output: fly_brain_retinotopy.json
  grid          : hexagonal column lattice spec over the normalized [u, v]
                  visual field (u = elevation axis from particle x, v =
                  azimuth axis from particle y -- MATCHING the data, and
                  documented against the legacy 8-bin formula's mislabel).
  neurons       : per optic-layer neuron: column id (nearest lattice node),
                  u, v, depth, layer, side, confidence (distance ratio),
                  output neuropil (real annotation), nt class.
  stimulus_map  : the exact function stimulus(u,v) -> column -> neurons used
                  by the parity suite (shared with the JS side).
  provenance    : explicit separation of anatomical location (u,v = real
                  synapse centroid), inferred column (nearest node, with
                  confidence), receptive field (NOT claimed; UNKNOWN), and
                  stimulus mapping (the declared binning convention).

Column count target ~800 (the FAFB medulla's order of magnitude; each column
becomes ~2-4 lattice nodes across depth-normalized u/v in this build). The
hex grid is a MODEL-ASSUMED lattice over SOURCE-DERIVED positions: it is a
sampling convention, not a claim that FAFB columns are perfectly hexagonal.

Usage:
    python p1_retinotopy.py            # build fly_brain_retinotopy.json
    python p1_retinotopy.py --verify   # re-check invariants of the output
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CIRCUIT = ROOT / "fly_brain_circuit.json"
CELLTYPES = ROOT / "fly_brain_celltypes.json"
OUT = ROOT / "fly_brain_retinotopy.json"

# hex-lattice resolution: columns along u (elevation) x along v (azimuth).
# ~40 x ~20 nodes -> 800 nodes, the published order of magnitude for medulla
# columns in FAFB. MODEL-ASSUMED resolution over SOURCE-DERIVED positions.
N_U = 40
N_V = 20


def hex_lattice(n_u: int, n_v: int) -> list[dict]:
    """Hexagonal lattice covering [0,1) x [0,1): rows offset by half a step."""
    du, dv = 1.0 / n_u, 1.0 / n_v
    nodes = []
    for j in range(n_v):
        for i in range(n_u):
            nodes.append({
                "col": len(nodes),
                "u": (i + (0.5 if j % 2 else 0.0)) * du,
                "v": j * dv,
                "row": j, "colidx": i,
            })
    return nodes


def assign_columns(u: np.ndarray, v: np.ndarray, nodes: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Nearest hex node per neuron (Euclidean in (u,v); hex spacing is
    anisotropic only in the offset direction, nearest-node is well-defined).
    Returns (col_id, confidence) where confidence = d2 / d2_second_best
    (small = unambiguous; >=0.9 = border ambiguity flagged in the report)."""
    nu = np.array([n["u"] for n in nodes])
    nv = np.array([n["v"] for n in nodes])
    # brute force in chunks: 106k x 800 fits fine chunked
    col = np.empty(len(u), dtype=np.int32)
    conf = np.empty(len(u), dtype=np.float32)
    CH = 8192
    for s in range(0, len(u), CH):
        uu = u[s:s + CH, None]; vv = v[s:s + CH, None]
        d2 = (uu - nu[None, :]) ** 2 + (vv - nv[None, :]) ** 2
        idx = np.argpartition(d2, 1, axis=1)[:, :2]
        rows = np.arange(len(uu))[:, None]
        best = d2[rows, idx]
        first = best[np.arange(len(uu)), np.argmin(best, axis=1)]
        second = np.max(best, axis=1)
        col[s:s + CH] = idx[np.arange(len(uu)), np.argmin(best, axis=1)]
        conf[s:s + CH] = np.where(first > 0, first / np.maximum(second, 1e-12), 0.0)
    return col, conf


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()

    circuit = json.loads(CIRCUIT.read_text())
    celltypes = json.loads(CELLTYPES.read_text())
    optic_layer = circuit.get("optic_layer", 1)
    optic_members = circuit["layers"][optic_layer]
    channels = circuit.get("optic_channels", {})

    n_optic = len(optic_members)
    u = np.full(n_optic, np.nan, dtype=np.float32)
    v = np.full(n_optic, np.nan, dtype=np.float32)
    depth = np.full(n_optic, np.nan, dtype=np.float32)
    for k, idx in enumerate(optic_members):
        ch = channels.get(str(idx))
        if ch:
            u[k], v[k], depth[k] = ch[0], ch[1], ch[2]
    have = np.isfinite(u)
    print(f"optic neurons: {n_optic:,}, with channels: {int(have.sum()):,} "
          f"({have.mean()*100:.1f}%)")

    nodes = hex_lattice(N_U, N_V)
    col = np.full(n_optic, -1, dtype=np.int32)
    conf = np.full(n_optic, np.nan, dtype=np.float32)
    col[have], conf[have] = assign_columns(u[have], v[have], nodes)

    # neuron records (root ids, side, output neuropil, nt class) from Stage B
    recs_b = celltypes["neurons"]
    neurons = []
    for k, idx in enumerate(optic_members):
        b = recs_b[idx]
        neurons.append({
            "i": idx,
            "root_id": str(b["root_id"]),   # decimal string: exact uint64 in JS
            "u": None if not have[k] else round(float(u[k]), 6),
            "v": None if not have[k] else round(float(v[k]), 6),
            "depth": None if not have[k] else round(float(depth[k]), 6),
            "column": int(col[k]) if have[k] else -1,
            "column_confidence": None if not have[k] else round(float(conf[k]), 4),
            "pre_neuropil": b["pre_neuropil"],
            "nt_class": b["nt_class"],
        })

    per_col = np.bincount(col[have], minlength=len(nodes))
    # count border-ambiguous on the EMITTED (4-decimal) confidence values so
    # the disclosed number is exactly reproducible from the JSON
    conf_r = np.round(conf, 4)
    ambiguous = int(np.sum((conf_r >= 0.9) & have))

    stim_map = {
        "convention": "stimulus intensity I(u,v) in [0,1]; a neuron's drive = "
                      "I(nearest column node (u,v)) — nearest-node binning, no "
                      "interpolation (declared approximation, reproducible)",
        "axes": "u = normalized particle-x axis (elevation in the 3D scene), "
                "v = normalized particle-y axis (azimuth). NOTE: the legacy "
                "8-bin formula `(u*4|0)+((v*2|0)*4)` indexes channels 0-3 by "
                "the FIRST (elevation) term — see P1_BIOLOGY_AUDIT.md E1. "
                "This grid keeps the data's own axes and does NOT reproduce "
                "the legacy mislabel.",
        "grid": {"type": "hex_rows_offset", "n_u": N_U, "n_v": N_V},
    }

    out = {
        "meta": {
            "p1_stage": "E",
            "schema_version": 1,
            "n_optic_neurons": n_optic,
            "n_with_position": int(have.sum()),
            "n_columns": len(nodes),
            "columns_occupied": int((per_col > 0).sum()),
            "median_neurons_per_occupied_column": float(np.median(per_col[per_col > 0])) if (per_col > 0).any() else 0,
            "border_ambiguous_neurons": ambiguous,
            "u_axis_source": "extract_circuit.py optic_channels (mean PRE-synapse "
                             "position, min-max normalized over optic neurons)",
            "provenance_separation": {
                "anatomical_location": "SOURCE-DERIVED (u,v,depth from FAFB synapse positions)",
                "inferred_column": "MODEL-ASSUMED lattice + SOURCE-DERIVED nearest-node "
                                   "assignment, with column_confidence",
                "receptive_field": "UNKNOWN — deliberately not claimed; a centroid is "
                                   "not an RF and no RF measurements exist in this workspace",
                "stimulus_mapping": "the declared nearest-node convention in stimulus_map",
            },
            "cell_type_status": "UNKNOWN for all neurons (Stage B reserved field); "
                                "therefore column identity is NOT verified per cell type",
        },
        "grid_nodes": nodes,
        "stimulus_map": stim_map,
        "neurons": neurons,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    h = hashlib.sha256(OUT.read_bytes()).hexdigest()
    print(f"wrote {OUT.name} ({OUT.stat().st_size/1e6:.1f} MB) sha256[:12]={h[:12]}")
    print(f"columns occupied: {(per_col>0).sum()}/{len(nodes)}; "
          f"median neurons/occupied column: {out['meta']['median_neurons_per_occupied_column']}; "
          f"border-ambiguous: {ambiguous}")

    if args.verify:
        d = json.loads(OUT.read_text())
        assert d["meta"]["n_optic_neurons"] == len(d["neurons"])
        occ = sum(1 for n in d["neurons"] if n["column"] >= 0)
        assert occ == d["meta"]["n_with_position"], "occupied count"
        for n in d["neurons"][:1000]:
            if n["column"] >= 0:
                node = d["grid_nodes"][n["column"]]
                assert 0 <= node["u"] < 1.0001 and 0 <= node["v"] < 1.0001
        print("verify OK")


if __name__ == "__main__":
    main()
