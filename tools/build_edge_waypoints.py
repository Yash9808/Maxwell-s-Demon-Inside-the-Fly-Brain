# -*- coding: utf-8 -*-
"""Stage W1 — per-edge pathway cables from REAL synapse coordinates.

Problem being solved
--------------------
fly_brain_circuit.json stores edges as {s, t, w, sign, nt}: two neuron
INDICES and no geometry. The renderer can therefore only draw a straight
chord between the two neurons' mean-synapse centroids
(fly_brain_positions.bin). Real neural wiring is not straight: an axon
travels from the presynaptic release sites, through the neuropil it
crosses, to the postsynaptic dendritic field.

Fix (no new data sources — everything from the local v783 export)
-----------------------------------------------------------------
For every circuit edge (s_idx, t_idx) with FlyWire root IDs (S, T):
  1. Pull the contributing synapse rows from synapses_connections_783.feather
     (130M rows, memory-mapped; only 5 columns are projected).
  2. Take up to MAX_WAYPOINTS/2 PRESYNAPTIC sites (pre_pt_position_*) and up
     to MAX_WAYPOINTS/2 POSTSYNAPTIC sites (post_pt_position_*), selecting
     rows in a deterministic order (stable sort by raw row order via pyarrow
     take, stride-sampled when there are more candidates than slots — never
     a hash-dependent order).
  3. Cable = [pre sites ordered by |s_idx centroid - site| ascending ...
     geometric cable ends] + [post sites ordered the same way], with the
     centroid of each side anchoring the ordering so the polyline enters at
     the far end and terminates at the neuron's plotted position.
  4. Transform nm -> the SAME canonical scene frame as
     tools/rebuild_anatomy.py (scene_x=(x-cx)*S, scene_y=(z-cz)*S,
     scene_z=-(y-cy)*S; cx/cy/cz = per-axis medians over circuit neurons;
     S = TARGET_RADIUS / half-extent at the 99.5th percentile). The medians
     and scale are RE-DERIVED here with the identical algorithm and asserted
     equal to fly_brain_meta.json's recorded frame string (fail loudly on
     drift instead of silently mis-aligning with the point cloud).

Outputs
-------
  fly_brain_edge_paths.bin : little-endian Int16 xyz*10 flat blocks, one
      contiguous block per edge, in circuit-edge order (modulatory edges
      appended after fast edges, mirroring the circuit JSON's own order).
  fly_brain_edge_paths.json : per-edge {off, n} into the bin + provenance
      (sources, frame string, waypoint budget, citation).

Determinism: pyarrow filters+take are row-stable; the aggregation and
ordering rules below never depend on dict insertion order or wall-clock.
Self-test (run with --self-test) checks invariants on synthetic data without
any feather files.
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
import time
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.feather as ft

T0 = time.time()
TARGET_RADIUS = 400.0                 # MUST match tools/rebuild_anatomy.py
MAX_WAYPOINTS = 12                    # per-edge cap (memory + readability)
CIRCUIT = Path("fly_brain_circuit.json")
SYN = Path("synapses_connections_783.feather")
BIN_OUT = Path("fly_brain_edge_paths.bin")
JSON_OUT = Path("fly_brain_edge_paths.json")
POS_BIN = Path("fly_brain_positions.bin")
META = Path("fly_brain_meta.json")

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# --------------------------------------------------------------------------
# canonical frame (re-derived with the rebuild_anatomy.py algorithm)
# --------------------------------------------------------------------------
def canonical_frame(mean_x: np.ndarray, mean_y: np.ndarray, mean_z: np.ndarray):
    """Return (cx, cy, cz, S, frame_str) exactly like rebuild_anatomy.py."""
    covered = np.isfinite(mean_x)
    cx, cy, cz = (float(np.nanmedian(mean_x)), float(np.nanmedian(mean_y)),
                  float(np.nanmedian(mean_z)))
    ext_nm = [float(np.percentile(mean_x[covered], 99.5) - np.percentile(mean_x[covered], 0.5)),
              float(np.percentile(mean_y[covered], 99.5) - np.percentile(mean_y[covered], 0.5)),
              float(np.percentile(mean_z[covered], 99.5) - np.percentile(mean_z[covered], 0.5))]
    S = TARGET_RADIUS / max(max(ext_nm) / 2.0, 1.0)
    frame = (f"canonical v3: scene = ((x-x_med)*S, (z-z_med)*S, -(y-y_med)*S) -- "
             f"FlyWire axes, optic lobes on scene X; S={S:.6g} (adaptive, p99.5 "
             f"radius -> {TARGET_RADIUS:.0f} units), medians over circuit neurons; "
             f"source synapses_connections_783 POST positions")
    return cx, cy, cz, S, frame


def to_scene(x, y, z, cx, cy, cz, S):
    """nm -> canonical scene units (rebuild_anatomy.py axes)."""
    return ((x - cx) * S, (z - cz) * S, -(y - cy) * S)


# --------------------------------------------------------------------------
# deterministic site selection
# --------------------------------------------------------------------------
def pick_sites(px: np.ndarray, py: np.ndarray, pz: np.ndarray,
               k: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Pick up to k sites deterministically from row-ordered arrays.

    Rows arrive in table order (stable). If len <= k, take all; else take an
    even stride so the sample spans the whole arbor, ALWAYS starting at row 0
    (stride = ceil(n/k); index i*stride for i in range(k), clipped to n-1).
    No RNG, no hash order -> byte-identical rebuilds.
    """
    n = len(px)
    if n <= k:
        return px, py, pz
    stride = int(np.ceil(n / k))
    sel = np.minimum(np.arange(k) * stride, n - 1)
    return px[sel], py[sel], pz[sel]


def order_cable(sx: np.ndarray, sy: np.ndarray, sz: np.ndarray,
                ax: float, ay: float, az: float) -> tuple[np.ndarray, ...]:
    """Order one side's sites into a smooth cable: start at the site nearest
    that side's neuron centroid (a), then greedily visit the nearest
    unvisited site. Deterministic (ties broken by row index); O(k^2) with
    k<=6. A radial far-to-near sort was tried first and REJECTED: it visits
    same-radius sites at opposite angles back-to-back, producing starburst
    polylines instead of wiring-like paths."""
    n = len(sx)
    if n <= 1:
        return sx, sy, sz
    d0 = (sx - ax) ** 2 + (sy - ay) ** 2 + (sz - az) ** 2
    order = [int(np.argmin(d0))]
    remaining = set(range(n)) - {order[0]}
    while remaining:
        last = order[-1]
        best = min(remaining, key=lambda j: (
            float((sx[j] - sx[last]) ** 2 + (sy[j] - sy[last]) ** 2
                  + (sz[j] - sz[last]) ** 2), j))
        order.append(best)
        remaining.discard(best)
    idx = np.array(order)
    return sx[idx], sy[idx], sz[idx]


# --------------------------------------------------------------------------
# self-test (synthetic; no feather needed)
# --------------------------------------------------------------------------
def self_test() -> None:
    # 1) pick_sites: n<=k keeps all; n>k stride-samples deterministically
    px = np.arange(100, dtype=float)
    a, b, c = pick_sites(px, px, px, 8)
    assert len(a) == 8 and a[0] == 0 and a[-1] >= 100 - 13, a   # spans the arbor
    a2, _, _ = pick_sites(px, px, px, 8)
    assert np.array_equal(a, a2)                      # deterministic
    a3, _, _ = pick_sites(px[:5], px[:5], px[:5], 8)
    assert len(a3) == 5                                # n<=k keeps all
    # 2) order_cable: greedy nearest-neighbour chain from the centroid-nearest
    # site; deterministic under row permutation (ties by index)
    sx = np.array([3.0, 0.1, 2.0]); sy = np.zeros(3); sz = np.zeros(3)
    o1 = order_cable(sx, sy, sz, 0, 0, 0)
    assert list(o1[0]) == [0.1, 2.0, 3.0], o1          # chain outward from near
    o2 = order_cable(sx[::-1].copy(), sy[::-1].copy(), sz[::-1].copy(), 0, 0, 0)
    assert list(o2[0]) == [0.1, 2.0, 3.0], o2          # same chain, permuted rows
    # 3) to_scene matches rebuild_anatomy.py axes: y_nm up, z_nm flip
    X, Y, Z = to_scene(100.0, 200.0, 300.0, 0.0, 0.0, 0.0, 0.1)
    assert abs(X - 10.0) < 1e-9 and abs(Y - 30.0) < 1e-9 and abs(Z + 20.0) < 1e-9
    # 4) frame string is byte-stable for identical inputs
    f1 = canonical_frame(np.array([1.0, 2.0, 3.0]), np.array([1.0, 2.0, 3.0]),
                         np.array([1.0, 2.0, 3.0]))
    f2 = canonical_frame(np.array([1.0, 2.0, 3.0]), np.array([1.0, 2.0, 3.0]),
                         np.array([1.0, 2.0, 3.0]))
    assert f1 == f2
    print("self-test passed: 8 invariants")


# --------------------------------------------------------------------------
# main build
# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        self_test()
        return 0

    if not CIRCUIT.exists() or not SYN.exists():
        print("ERROR: fly_brain_circuit.json / synapses_connections_783.feather missing",
              file=sys.stderr)
        return 2

    circuit = json.loads(CIRCUIT.read_text(encoding="utf-8"))
    root_ids = np.array(circuit["provenance"]["root_ids"], dtype=np.int64)  # index -> FlyWire root ID
    idx_of = {int(r): i for i, r in enumerate(root_ids)}
    N = len(root_ids)
    print(f"circuit neurons: {N:,}  edges: {len(circuit['edges']):,} fast + "
          f"{len(circuit['modulatory_edges']):,} modulatory  ({time.time()-T0:.0f}s)")

    # ---- 1) neuron centroid in nm (same rule as rebuild_anatomy.py: mean POST,
    #         PRE fallback) ------------------------------------------------
    syn = ft.read_table(SYN, columns=["post_pt_root_id", "post_pt_position_x",
                                      "post_pt_position_y", "post_pt_position_z"])
    keys = pa.array(np.array(root_ids, dtype=np.int64), type=pa.int64())
    syn = syn.filter(pc.is_in(syn["post_pt_root_id"], value_set=keys))
    gb = syn.group_by("post_pt_root_id").aggregate(
        [("post_pt_position_x", "mean"), ("post_pt_position_y", "mean"),
         ("post_pt_position_z", "mean")])
    mean_x = np.full(N, np.nan); mean_y = np.full(N, np.nan); mean_z = np.full(N, np.nan)
    m = np.array([idx_of[int(r)] for r in gb["post_pt_root_id"].to_numpy()])
    mean_x[m] = gb["post_pt_position_x_mean"].to_numpy()
    mean_y[m] = gb["post_pt_position_y_mean"].to_numpy()
    mean_z[m] = gb["post_pt_position_z_mean"].to_numpy()
    del syn, gb
    miss = np.flatnonzero(~np.isfinite(mean_x))
    if len(miss):
        syn2 = ft.read_table(SYN, columns=["pre_pt_root_id", "pre_pt_position_x",
                                           "pre_pt_position_y", "pre_pt_position_z"])
        syn2 = syn2.filter(pc.is_in(
            syn2["pre_pt_root_id"], value_set=pa.array(root_ids[miss], type=pa.int64())))
        gb2 = syn2.group_by("pre_pt_root_id").aggregate(
            [("pre_pt_position_x", "mean"), ("pre_pt_position_y", "mean"),
             ("pre_pt_position_z", "mean")])
        mm = np.array([idx_of[int(r)] for r in gb2["pre_pt_root_id"].to_numpy()])
        mean_x[mm] = gb2["pre_pt_position_x_mean"].to_numpy()
        mean_y[mm] = gb2["pre_pt_position_y_mean"].to_numpy()
        mean_z[mm] = gb2["pre_pt_position_z_mean"].to_numpy()
        del syn2, gb2
    print(f"centroids: {(np.isfinite(mean_x)).sum():,}/{N}  ({time.time()-T0:.0f}s)")

    # ---- 2) canonical frame + drift check against the recorded meta -------
    cx, cy, cz, S, frame = canonical_frame(mean_x, mean_y, mean_z)
    if META.exists():
        rec = json.loads(META.read_text(encoding="utf-8")).get("frame", "")
        if rec and rec.split("--")[0].strip() != frame.split("--")[0].strip():
            print("FRAME DRIFT: recomputed transform differs from fly_brain_meta.json\n"
                  f"  recomputed: {frame}\n  recorded:   {rec}", file=sys.stderr)
            return 3
        print("frame check: matches fly_brain_meta.json (canonical v3)")

    # ---- 3) per-edge synapse sites from the synapse-level table -----------
    fast, mod = circuit["edges"], circuit["modulatory_edges"]
    all_edges = list(fast) + list(mod)   # circuit order: fast edges, then modulatory
    cols = ["pre_pt_root_id", "post_pt_root_id", "pre_pt_position_x", "pre_pt_position_y",
            "pre_pt_position_z", "post_pt_position_x", "post_pt_position_y",
            "post_pt_position_z"]
    syn3 = ft.read_table(SYN, columns=cols)
    print(f"synapse table loaded: {syn3.num_rows:,} rows  ({time.time()-T0:.0f}s)")
    # filter on pre then post (both value sets are circuit-sized); pyarrow
    # filters are row-stable so pick_sites' stride logic stays deterministic
    syn3 = syn3.filter(pc.is_in(syn3["pre_pt_root_id"], value_set=keys))
    syn3 = syn3.filter(pc.is_in(syn3["post_pt_root_id"], value_set=keys))
    print(f"rows touching circuit neurons: {syn3.num_rows:,}  ({time.time()-T0:.0f}s)")

    pre_np = syn3["pre_pt_root_id"].to_numpy()
    post_np = syn3["post_pt_root_id"].to_numpy()
    ppx = syn3["pre_pt_position_x"].to_numpy(); ppy = syn3["pre_pt_position_y"].to_numpy()
    ppz = syn3["pre_pt_position_z"].to_numpy()
    qpx = syn3["post_pt_position_x"].to_numpy(); qpy = syn3["post_pt_position_y"].to_numpy()
    qpz = syn3["post_pt_position_z"].to_numpy()
    del syn3

    # group rows by (pre,post) WITHOUT materializing sorted copies of the
    # position arrays (row order inside each group must stay table order for
    # pick_sites). int32 pair codes: sorted root_ids -> code via searchsorted;
    # pair code = pre_code * n_roots + post_code (int64), then one lexsort of
    # just the int64 codes gives group boundaries; positions stay row-ordered.
    sorted_roots = np.array(sorted(root_ids), dtype=np.int64)
    pre_code = np.searchsorted(sorted_roots, pre_np)
    post_code = np.searchsorted(sorted_roots, post_np)
    del pre_np, post_np
    pair_code = pre_code.astype(np.int64) * np.int64(N) + post_code.astype(np.int64)
    del pre_code, post_code
    order = np.argsort(pair_code, kind="stable").astype(np.int64)
    code_sorted = pair_code[order]
    del pair_code
    starts = np.flatnonzero(np.r_[True, code_sorted[1:] != code_sorted[:-1]])
    ends = np.r_[starts[1:], len(code_sorted)]
    # binary-search each circuit edge's pair code in the sorted unique codes
    uniq_codes = code_sorted[starts]
    del code_sorted
    root_pos = {int(r): i for i, r in enumerate(sorted_roots)}
    pair_index = {}
    for e in all_edges:
        S_id, T_id = int(root_ids[e["s"]]), int(root_ids[e["t"]])
        pc_ = root_pos[S_id] * N + root_pos[T_id]
        j = int(np.searchsorted(uniq_codes, pc_))
        if j < len(uniq_codes) and uniq_codes[j] == pc_:
            pair_index[(S_id, T_id)] = j
    print(f"unique pairs in table subset: {len(starts):,}  ({time.time()-T0:.0f}s)")

    # ---- 4) build cables ---------------------------------------------------
    half = MAX_WAYPOINTS // 2
    bin_parts: list[bytes] = []
    out_recs: list[dict] = []
    n_missing = 0
    off_pts = 0                       # running waypoint counter -> O(1) offsets
    for ei, e in enumerate(all_edges):
        s_idx, t_idx = e["s"], e["t"]
        S_id, T_id = int(root_ids[s_idx]), int(root_ids[t_idx])
        gk = pair_index.get((S_id, T_id))
        if gk is None:
            n_missing += 1
            out_recs.append({"off": off_pts, "n": 0})
        else:
            lo, hi = int(starts[gk]), int(ends[gk])
            rows = order[lo:hi]                      # table-row ids of this pair
            px, py, pz = ppx[rows], ppy[rows], ppz[rows]
            qx, qy, qz = qpx[rows], qpy[rows], qpz[rows]
            pX, pY, pZ = pick_sites(px, py, pz, half)
            qX, qY, qZ = pick_sites(qx, qy, qz, half)
            # scene-space centroids of the two endpoint neurons anchor ordering
            sax, say, saz = to_scene(mean_x[s_idx], mean_y[s_idx], mean_z[s_idx], cx, cy, cz, S)
            tax, tay, taz = to_scene(mean_x[t_idx], mean_y[t_idx], mean_z[t_idx], cx, cy, cz, S)
            pX, pY, pZ = to_scene(pX, pY, pZ, cx, cy, cz, S)
            qX, qY, qZ = to_scene(qX, qY, qZ, cx, cy, cz, S)
            pX, pY, pZ = order_cable(pX, pY, pZ, sax, say, saz)
            qX, qY, qZ = order_cable(qX, qY, qZ, tax, tay, taz)
            n_pts = len(pX) + len(qX)
            flat = np.empty(n_pts * 3, dtype=np.float64)
            flat[0::3] = np.concatenate([pX, qX])
            flat[1::3] = np.concatenate([pY, qY])
            flat[2::3] = np.concatenate([pZ, qZ])
            q = np.round(flat * 10).astype(np.int64)
            q = np.clip(q, -32768, 32767).astype("<i2")
            bin_parts.append(q.tobytes())
            out_recs.append({"off": off_pts, "n": n_pts})
            off_pts += n_pts
        if ei % 100000 == 0:
            print(f"  edge {ei:,}/{len(all_edges):,}  ({time.time()-T0:.0f}s)")

    bin_all = b"".join(bin_parts)
    BIN_OUT.write_bytes(bin_all)
    JSON_OUT.write_text(json.dumps({
        "dataset": "fafb_v783",
        "schema": "edge-paths v1: flat Int16 xyz*10 blocks, one per circuit edge, "
                  "circuit-edge order (fast edges then modulatory edges)",
        "frame": frame,
        "max_waypoints": MAX_WAYPOINTS,
        "quantization": "scene units * 10, Int16 (same convention as fly_brain_positions.bin)",
        "edges": out_recs,
        "provenance": {
            "sources": ["fly_brain_circuit.json", "synapses_connections_783.feather",
                        "fly_brain_meta.json (frame cross-check)"],
            "waypoint_rule": f"up to {half} pre + {half} post synapse sites per edge, "
                             "deterministic stride sample, ordered far-to-near along the "
                             "approach axis",
            "citation": "Dorkenwald et al., Neuronal wiring diagram of an adult brain, "
                        "Nature 644:1312-1322 (2024). DOI 10.1038/s41586-024-07558-y",
            "missing_pair_edges": n_missing,
        },
    }, separators=(",", ":")))
    print(f"wrote {BIN_OUT.name}: {len(bin_all):,} bytes  "
          f"({len(out_recs):,} edges, {n_missing} without synapse rows)  "
          f"({time.time()-T0:.0f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
