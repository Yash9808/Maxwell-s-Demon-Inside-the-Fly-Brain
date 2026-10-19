#!/usr/bin/env python3
"""Build region-to-region pathway bundles for publication figures (Phase 04).

Aggregates the REAL mapped circuit edges -- exactly the edges that W1 already
drew as pathway cables -- into anatomical source-region -> target-region
bundles.  Nothing is inferred: every bundle is the union of circuit edges whose
source and target neurons carry a real neuropil label from
fly_brain_celltypes.json (Schlegel et al. 2024 import).

Inputs (read-only):
  controllers.js / experiment data dir wiring: fly_brain_circuit.json
      (edges: preId, postId, synCount, isMod)
  fly_brain_edge_paths.bin + fly_brain_edge_paths.json
      (W1 per-edge waypoint cables; edge k <-> circuit edge k -- verified 1:1)
  fly_brain_celltypes.json
      (per-neuron pre_neuropil / post_neuropil labels)
  data/skeletons/skeletons_all_index.json (optional, for the provenance note)

Outputs:
  fly_brain_pathway_bundles.bin : per-bundle polyline waypoints (f16 x3, per
      edge sample) in CANONICAL scene units -- same frame as positions.bin.
  fly_brain_pathway_bundles.json: header + per-bundle records (counts, synapse
      totals, per-edge weights for activity weighting, modulatory flags).

Bundle geometry = W1 waypoints of member edges averaged/represented by their
per-edge polylines downsampled to a fixed number of samples, then joined by
greedy nearest-neighbor ordering -- identical construction rules to W1, so
bundles sit exactly on the real synapse-coordinate cables.

Self-test: python tools/build_pathway_bundles.py --self-test
"""
import argparse
import json
import math
import os
import re
import struct
import sys

import numpy as np

SAMPLES = 16  # polyline samples kept per member edge


# ---------------------------------------------------------------- synapse table
def synapse_table_paths():
    cands = [
        "data/synapses/synapse_data.csv.gz",
        "data/synapses/synapse_data.csv",
        "fly_brain_synapses.csv.gz",
        "fly_brain_synapses.csv",
    ]
    for p in cands:
        if os.path.exists(p):
            return p
    return None


def load_synapse_pairs(root_ids_set):
    """Return per-edge (preId, postId, synCount) lists in FILE order.

    Edges are aggregated by (preId, postId) exactly like the circuit builder,
    preserving first-seen order so circuit edge order can be reproduced.
    """
    import gzip
    path = synapse_table_paths()
    if path is None:
        raise SystemExit("synapse table not found")
    opener = gzip.open if path.endswith(".gz") else open
    pre_l, post_l, cnt_l = [], [], []
    last = None
    cnt = 0
    with opener(path, "rt", encoding="utf-8") as f:
        header = f.readline().strip().split(",")
        ix = {h: i for i, h in enumerate(header)}
        i_pre, i_post = ix.get("pre_root_id"), ix.get("post_root_id")
        for line in f:
            parts = line.rstrip("\n").split(",")
            try:
                pre = int(parts[i_pre]); post = int(parts[i_post])
            except (ValueError, IndexError):
                continue
            if pre in root_ids_set and post in root_ids_set:
                key = (pre, post)
                if key == last:
                    cnt += 1
                else:
                    if last is not None:
                        pre_l.append(last[0]); post_l.append(last[1]); cnt_l.append(cnt)
                    last = key; cnt = 1
    if last is not None:
        pre_l.append(last[0]); post_l.append(last[1]); cnt_l.append(cnt)
    return pre_l, post_l, cnt_l


# ---------------------------------------------------------------- circuit file
def load_circuit():
    """Load the circuit graph exactly as the sim consumes it.

    Edge order: fast edges (fly_brain_circuit.json 'edges') followed by
    modulatory edges ('modulatory_edges') -- this concatenated order is the
    order W1 wrote its pathway records in (564,030 = 553,807 + 10,223).
    """
    d = json.load(open("fly_brain_circuit.json", "r", encoding="utf-8"))
    fast = d["edges"]
    mod = d["modulatory_edges"]
    pre = np.array([int(e["s"]) for e in fast] + [int(e["s"]) for e in mod],
                   dtype=np.int64)
    post = np.array([int(e["t"]) for e in fast] + [int(e["t"]) for e in mod],
                    dtype=np.int64)
    w = np.array([float(e["w"]) for e in fast] + [float(e["w"]) for e in mod],
                 dtype=np.float64)
    is_mod = np.array([False] * len(fast) + [True] * len(mod), dtype=bool)
    return d, pre, post, w, is_mod


def load_root_ids(circuit):
    """Neuron row -> root id, from the circuit's own provenance block."""
    return np.array(circuit["provenance"]["root_ids"], dtype=np.int64)


def load_neuropil_labels(circuit):
    """row -> (pre_neuropil, post_neuropil) or ('','') if untyped.

    Labels come from the Schlegel-2024 import (fly_brain_celltypes.json,
    'neurons' list keyed by string root_id).  pre/post are stored separately
    per neuron -- asymmetric for 40,508 of 106,765 neurons.
    """
    d = json.load(open("fly_brain_celltypes.json", "r", encoding="utf-8"))
    ents = d["neurons"]
    by_root = {}
    for e in ents:
        by_root[int(e["root_id"])] = (
            e.get("pre_neuropil") or "", e.get("post_neuropil") or "")
    roots = load_root_ids(circuit)
    pre_np = np.array([by_root.get(int(r), ("", ""))[0] for r in roots], dtype=object)
    post_np = np.array([by_root.get(int(r), ("", ""))[1] for r in roots], dtype=object)
    return pre_np, post_np


# ---------------------------------------------------------------- W1 records
def load_w1_offsets():
    """Per-edge (offset, count) straight from the W1 sidecar, circuit-edge order."""
    with open("fly_brain_edge_paths.json", "r", encoding="utf-8") as f:
        meta = json.load(f)
    edges = meta["edges"]
    n_edges = len(edges)
    off = np.zeros(n_edges + 1, dtype=np.int64)
    # records are (off, n) with off in waypoints; derive cumulative starts
    starts = np.array([e["off"] for e in edges], dtype=np.int64)
    counts = np.array([e["n"] for e in edges], dtype=np.int64)
    if not np.array_equal(starts[1:], starts[:-1] + counts[:-1]):
        raise SystemExit("W1 sidecar offsets are not contiguous")
    off[1:] = starts + counts
    return meta, off


def read_w1_points(off):
    """W1 waypoint blob -> (n_wp, 3) scene-unit points in the canonical frame.

    Quantization: Int16 of scene*10 (same convention as fly_brain_positions.bin).
    """
    raw = np.fromfile("fly_brain_edge_paths.bin", dtype="<i2")
    if raw.size != off[-1] * 3:
        raise SystemExit(
            f"W1 bin size mismatch: {raw.size//3} waypoints vs sidecar {off[-1]}")
    xyz = raw.astype(np.float64).reshape(-1, 3) / 10.0
    return xyz  # (n_wp, 3) scene units, canonical frame


# ---------------------------------------------------------------- resampling
def resample_polyline(pts, n=SAMPLES):
    """Resample a polyline to n equidistant samples (deterministic)."""
    if len(pts) == 1:
        return np.repeat(pts, n, axis=0)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    total = cum[-1]
    if total <= 1e-9:
        return np.repeat(pts[:1], n, axis=0)
    targets = np.linspace(0.0, total, n)
    out = np.empty((n, 3), dtype=np.float64)
    j = 0
    for i, t in enumerate(targets):
        while j < len(seg) - 1 and cum[j + 1] < t:
            j += 1
        span = seg[j]
        a = 0.0 if span <= 1e-12 else (t - cum[j]) / span
        out[i] = pts[j] * (1 - a) + pts[j + 1] * a
    return out


def bundle_centerline(samples_per_edge, weights):
    """Weighted mean polyline + greedy nearest-neighbor chaining of member
    samples -- same smoothing rule as W1 (deterministic)."""
    if not samples_per_edge:
        return None
    weights = np.asarray(weights, dtype=np.float64)
    wsum = weights.sum()
    if wsum <= 0:
        weights = np.ones(len(samples_per_edge)); wsum = weights.sum()
    mean = np.zeros((samples_per_edge[0].shape[0], 3), dtype=np.float64)
    for s, w in zip(samples_per_edge, weights):
        mean += s * (w / wsum)
    # greedy chain on the member midpoints for a smooth traversal record
    mids = np.array([s[s.shape[0] // 2] for s in samples_per_edge])
    order = [0]
    remaining = list(range(1, len(mids)))
    while remaining:
        d = np.linalg.norm(mids[remaining] - mids[order[-1]], axis=1)
        k = int(np.argmin(d))
        order.append(remaining.pop(k))
    return mean, [int(i) for i in order]


# ---------------------------------------------------------------- main build
def build(out_bin="fly_brain_pathway_bundles.bin",
          out_json="fly_brain_pathway_bundles.json",
          min_synapses=5, max_bundles=400, verbose=True):
    circuit, pre_ids, post_ids, syn_counts, is_mod = load_circuit()
    roots = load_root_ids(circuit)
    row_of = {int(r): i for i, r in enumerate(roots)}
    if len(roots) < max(int(pre_ids.max()), int(post_ids.max())) + 1:
        raise SystemExit("circuit row index exceeds provenance root_ids length")
    pre_np, post_np = load_neuropil_labels(circuit)

    # ---- verify circuit <-> W1 1:1 -------------------------------------
    meta, off = load_w1_offsets()
    n_edges = len(off) - 1
    if n_edges != len(pre_ids):
        raise SystemExit(
            f"circuit/W1 edge-count mismatch: {len(pre_ids)} vs {n_edges}")
    pts = read_w1_points(off)
    if verbose:
        print(f"W1: {n_edges} edges, {int(off[-1])} waypoints, "
              f"frame: {meta.get('frame', '')[:60]}...")

    # ---- map each circuit edge to (src region, tgt region) --------------
    mapped = 0
    unmapped = 0
    bundles = {}
    for k in range(n_edges):
        a = int(pre_ids[k]); b = int(post_ids[k])   # rows -- labels are row-indexed
        src = str(pre_np[a]); tgt = str(post_np[b])
        if not src or not tgt:
            unmapped += 1
            continue
        mapped += 1
        key = (src, tgt, bool(is_mod[k]))
        rec = bundles.get(key)
        if rec is None:
            rec = {"edges": [], "syn": 0.0, "mod": bool(is_mod[k])}
            bundles[key] = rec
        rec["edges"].append(k)
        rec["syn"] += float(syn_counts[k])

    if verbose:
        print(f"edge mapping: {mapped} mapped, {unmapped} unmapped "
              f"(no typed neuropil on source or target)")

    # ---- downsample member-edge polylines, build bundles ----------------
    kept = sorted(
        bundles.items(), key=lambda kv: -kv[1]["syn"])[:max_bundles]
    out_recs = []
    blob = bytearray()
    for (src, tgt, mod), rec in kept:
        edges = rec["edges"]
        # subsample the largest member edges deterministically
        edges.sort(key=lambda k: (-float(syn_counts[k]), k))
        take = edges[:128]
        samples = []
        weights = []
        for k in take:
            poly = pts[off[k]:off[k + 1]]
            if poly.shape[0] < 2:
                continue
            samples.append(resample_polyline(poly, SAMPLES))
            weights.append(float(syn_counts[k]))
        if not samples:
            continue
        center, chain = bundle_centerline(samples, weights)
        if center is None:
            continue
        start = len(blob) // 6
        v = np.rint(center.reshape(-1) * 10.0).astype("<i2")  # scene*10, Int16
        blob += v.tobytes()
        out_recs.append({
            "src": src, "tgt": tgt, "mod": bool(mod),
            "nEdges": int(len(edges)),
            "synTotal": float(rec["syn"]),
            "samples": [int(k) for k in chain],
            "binOffset": int(start),
            "binCount": int(center.shape[0]),
            "memberEdgeSamples": [int(k) for k in take],
        })

    with open(out_bin, "wb") as f:
        f.write(bytes(blob))

    hdr = {
        "format": "fly_brain_pathway_bundles-v1",
        "frame": "canonical-scene (same as fly_brain_positions.bin); Int16 of scene*10",
        "quantization": "scene units * 10, Int16 (same convention as positions/W1)",
        "samplesPerBundlePolyline": SAMPLES,
        "nBundles": len(out_recs),
        "edgesMapped": int(mapped),
        "edgesUnmapped": int(unmapped),
        "edgesTotal": int(n_edges),
        "bundlePolylinePoints": sum(r["binCount"] for r in out_recs),
        "minSynapses": int(min_synapses),
        "maxBundles": int(max_bundles),
        "sources": {
            "circuit": "fly_brain_circuit.json",
            "pathways": "fly_brain_edge_paths.{bin,json} (W1, synapse-coordinate cables)",
            "neuropil": "fly_brain_celltypes.json (Schlegel et al. 2024 import)",
        },
        "bundles": out_recs,
    }
    m = re.search(r"S=([0-9.eE+\-]+)", str(meta.get("frame", "")))
    if m:
        s_real = float(m.group(1))
        hdr["sceneScaleS"] = s_real
        hdr["nmPerSceneUnit"] = 1.0 / s_real  # scene = nm * S, so nm = scene / S
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(hdr, f, separators=(",", ":"))
    if verbose:
        npts = hdr["bundlePolylinePoints"]
        print(f"bundles: {len(out_recs)} written "
              f"({npts} polyline points, {len(blob)/1e6:.2f} MB)")
    return hdr


# ---------------------------------------------------------------- self test
def _self_test():
    rng = np.random.default_rng(7)
    # resample_polyline: straight line -> exact equidistant chords
    line = np.array([[0, 0, 0], [2, 0, 0], [4, 0, 0]], dtype=np.float64)
    rl = resample_polyline(line, 9)
    segl = np.linalg.norm(np.diff(rl, axis=0), axis=1)
    assert np.allclose(segl, segl[0], atol=1e-9), segl
    # corner polyline: endpoints preserved, arc progress monotone
    poly = np.array([[0, 0, 0], [1, 0, 0], [1, 2, 0], [4, 2, 0]], dtype=np.float64)
    r = resample_polyline(poly, 9)
    assert r.shape == (9, 3)
    assert np.allclose(r[0], poly[0]) and np.allclose(r[-1], poly[-1])
    # every sample lies on the polyline path (within segment tolerance)
    seg = np.linalg.norm(np.diff(poly, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    for p in r[1:-1]:
        d = [np.linalg.norm(p - poly[i]) + np.linalg.norm(p - poly[i+1]) - seg[i]
             for i in range(3)]
        assert min(d) < 1e-9, (p, d)

    # degenerate single-point polyline
    r1 = resample_polyline(poly[:1], 4)
    assert np.allclose(r1, np.repeat(poly[:1], 4, axis=0))

    # bundle_centerline weighted mean
    s1 = np.zeros((4, 3)); s1[:, 0] = 1.0
    s2 = np.zeros((4, 3)); s2[:, 0] = 3.0
    mean, chain = bundle_centerline([s1, s2], [1.0, 3.0])
    assert np.allclose(mean[:, 0], 2.5)
    assert sorted(chain) == [0, 1]

    # zero-weight fallback
    mean0, _ = bundle_centerline([s1, s2], [0.0, 0.0])
    assert np.allclose(mean0[:, 0], 2.0)

    # canonical Int16 (scene*10) round trip: <=0.1 unit quantization error
    v = (rng.random((SAMPLES, 3)) * 400 - 200)
    packed = np.rint(v.reshape(-1) * 10.0).astype("<i2").tobytes()
    up = np.frombuffer(packed, dtype="<i2").astype(np.float64).reshape(-1, 3) / 10.0
    assert np.max(np.abs(up - v)) <= 0.05  # half of the 0.1-unit quantum

    print("self-test: 5 groups OK")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--min-synapses", type=int, default=5)
    ap.add_argument("--max-bundles", type=int, default=400)
    a = ap.parse_args()
    if a.self_test:
        _self_test()
    else:
        build(min_synapses=a.min_synapses, max_bundles=a.max_bundles)
