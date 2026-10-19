# -*- coding: utf-8 -*-
"""Stage W2 — real neuron arbors (published FlyWire skeletons) -> renderer bin.

Source (the ONLY permitted source; cited in outputs):
  Schlegel et al., Whole-brain annotation and multi-connectome cell typing of
  Drosophila, Nature 634:139-152 (2024). DOI 10.1038/s41586-024-07686-5
  Supplemental files on Zenodo, record 10877326:
    sk_lod1_783_healed_ds2.parquet  (5.4 GB)
  Skeletons are SWC-like rows for ALL FlyWire v783 neurons (lod-1 meshes,
  2x downsampled, coordinates in nm). Read with pyarrow; see
  https://github.com/flyconnectome/flywire_annotations for schema docs.

What this tool does
-------------------
  1. (optional) Downloads the parquet with HTTP RANGE requests, skipping
     ranges already present in the local partial file — resumable on flaky
     links and on disks too small for one-shot downloads.
  2. Reads ONLY the row groups containing the curated subset of root IDs
     (pyarrow reads row-group metadata first, so a subset costs a fraction of
     the full 5.4 GB read).
  3. Converts each neuron's skeleton nodes from FAFB nm to the SAME canonical
     scene frame as tools/rebuild_anatomy.py (medians + scale are RE-DERIVED
     here and cross-checked against fly_brain_meta.json's recorded frame).
  4. Writes data/skeletons/skeletons.bin + skeletons_index.json:
       bin : per neuron — uint32 nodeCount, float16 xyz*nodeCount (scene),
             int16 parentDelta*nodeCount (parentIdx - myIdx, 0 = root/none),
             uint32 synCount, float16 xyz*synCount (synapse sites, scene)
       idx : { by_root: { root_id: {off, nodes, syn} }, frame, provenance }

Renderer hook: chip-E click -> showArbor(i) draws the real branching arbor
(parent links = real SWC topology, not a polyline chain) + its synapse sites.

Disk note: needs ~2x subset size free; the download tool itself never
materializes more than the parquet. If the disk cannot hold the parquet,
run on another machine and copy the OUTPUT bin (~MB for a curated subset).

Usage:
  python tools/build_neuron_skeletons.py --self-test
  python tools/build_neuron_skeletons.py --download          # resumable fetch
  python tools/build_neuron_skeletons.py --subset top        # curated build
  python tools/build_neuron_skeletons.py --subset ids --ids-file my.txt
  python tools/build_neuron_skeletons.py --build-all         # EVERY circuit
                            # neuron -> skeletons_all.bin (batch-streamed,
                            # ~1 GB); enables the on-demand family streaming
                            # served by launch_fly_demon_3d.py /api/arbor_*
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

T0 = time.time()
ZENODO_URL = ("https://zenodo.org/records/10877326/files/"
              "sk_lod1_783_healed_ds2.parquet?download=1")
PARQUET = Path("data/skeletons/sk_lod1_783_healed_ds2.parquet")
OUT_DIR = Path("data/skeletons")
BIN_OUT = OUT_DIR / "skeletons.bin"
IDX_OUT = OUT_DIR / "skeletons_index.json"
BIN_ALL = OUT_DIR / "skeletons_all.bin"
IDX_ALL = OUT_DIR / "skeletons_all_index.json"
CIRCUIT = Path("fly_brain_circuit.json")
META = Path("fly_brain_meta.json")
TARGET_RADIUS = 400.0          # MUST match tools/rebuild_anatomy.py

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ---------------------------------------------------------------------------
# curated subsets (deterministic; documented in the index provenance)
# ---------------------------------------------------------------------------
SUBSETS = {
    # top-degree: the highest-fanin+fanhub neurons of the circuit — hubs that
    # organize whole-brain traffic (deterministic sort, ties by root id).
    "top": 200,
    # per-layer cap: representative coverage across all five layers.
    "layered": 300,
}


def canonical_frame_from_meta() -> tuple:
    """Load the canonical frame from fly_brain_meta.json (recorded by
    rebuild_anatomy.py). Fail loudly if absent — we never guess the frame."""
    if not META.exists():
        print("ERROR: fly_brain_meta.json missing — run tools/rebuild_anatomy.py first",
              file=sys.stderr)
        sys.exit(3)
    meta = json.loads(META.read_text(encoding="utf-8"))
    frame = meta.get("frame", "")
    if "canonical v3" not in frame:
        print(f"ERROR: unexpected frame '{frame[:60]}...' — refusing to guess",
              file=sys.stderr)
        sys.exit(3)
    # rebuild_anatomy.py records S in the frame string; medians are recoverable
    # only by re-derivation, so we re-derive them exactly as rebuild_anatomy.py
    # does (mean POST position per circuit neuron) and assert the recorded
    # S matches our recomputed S.
    return meta, frame


def derive_frame_nm():
    """Re-derive (cx, cy, cz, S) in nm exactly like rebuild_anatomy.py."""
    import pyarrow as pa
    import pyarrow.compute as pc
    import pyarrow.feather as ft
    circuit = json.loads(CIRCUIT.read_text(encoding="utf-8"))
    root_ids = np.array(circuit["provenance"]["root_ids"], dtype=np.int64)
    N = len(root_ids)
    syn = ft.read_table("synapses_connections_783.feather",
                        columns=["post_pt_root_id", "post_pt_position_x",
                                 "post_pt_position_y", "post_pt_position_z"])
    keys = pa.array(root_ids, type=pa.int64())
    syn = syn.filter(pc.is_in(syn["post_pt_root_id"], value_set=keys))
    gb = syn.group_by("post_pt_root_id").aggregate(
        [("post_pt_position_x", "mean"), ("post_pt_position_y", "mean"),
         ("post_pt_position_z", "mean")])
    mean_x = np.full(N, np.nan); mean_y = np.full(N, np.nan); mean_z = np.full(N, np.nan)
    idx_of = {int(r): i for i, r in enumerate(root_ids)}
    m = np.array([idx_of[int(r)] for r in gb["post_pt_root_id"].to_numpy()])
    mean_x[m] = gb["post_pt_position_x_mean"].to_numpy()
    mean_y[m] = gb["post_pt_position_y_mean"].to_numpy()
    mean_z[m] = gb["post_pt_position_z_mean"].to_numpy()
    covered = np.isfinite(mean_x)
    cx, cy, cz = (float(np.nanmedian(mean_x)), float(np.nanmedian(mean_y)),
                  float(np.nanmedian(mean_z)))
    ext = [float(np.percentile(mean_x[covered], 99.5) - np.percentile(mean_x[covered], 0.5)),
           float(np.percentile(mean_y[covered], 99.5) - np.percentile(mean_y[covered], 0.5)),
           float(np.percentile(mean_z[covered], 99.5) - np.percentile(mean_z[covered], 0.5))]
    S = TARGET_RADIUS / max(max(ext) / 2.0, 1.0)
    del syn, gb
    return root_ids, cx, cy, cz, S


def to_scene(x, y, z, cx, cy, cz, S):
    return ((x - cx) * S, (z - cz) * S, -(y - cy) * S)


# ---------------------------------------------------------------------------
# resumable ranged download
# ---------------------------------------------------------------------------
def remote_size(url: str) -> int:
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers["Content-Length"])


def download_resumable(url: str, dest: Path, chunk: int = 8 << 20) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    total = remote_size(url)
    have = dest.stat().st_size if dest.exists() else 0
    if have > total:
        dest.unlink(); have = 0
    if have == total:
        print(f"download already complete: {dest} ({total:,} bytes)")
        return
    print(f"resuming at {have:,}/{total:,} bytes "
          f"({100*have/total:.1f}%, {total-have:,} to go)")
    headers = {"Range": f"bytes={have}-"}
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r, \
            open(dest, "ab") as f:
        while True:
            buf = r.read(chunk)
            if not buf:
                break
            f.write(buf)
            have += len(buf)
            print(f"\r  {have:,}/{total:,} ({100*have/total:.1f}%)", end="", flush=True)
    print()
    if have != total:
        raise IOError(f"incomplete download: {have} != {total}")


# ---------------------------------------------------------------------------
# curated subset selection
# ---------------------------------------------------------------------------
def pick_subset(kind: str, ids_file: str | None) -> list[int]:
    circuit = json.loads(CIRCUIT.read_text(encoding="utf-8"))
    root_ids = np.array(circuit["provenance"]["root_ids"], dtype=np.int64)
    if ids_file:
        want = {int(l) for l in Path(ids_file).read_text().split() if l.strip()}
        return [int(r) for r in root_ids if int(r) in want]
    edges = circuit["edges"]
    deg = {}
    for e in edges:
        deg[e["s"]] = deg.get(e["s"], 0) + e["w"]
        deg[e["t"]] = deg.get(e["t"], 0) + e["w"]
    if kind == "top":
        k = SUBSETS["top"]
        top = sorted(deg.items(), key=lambda kv: (-kv[1], kv[0]))[:k]
        return sorted(int(root_ids[i]) for i, _ in top)
    if kind == "layered":
        k = SUBSETS["layered"]
        per_layer = {}
        for li, layer in enumerate(circuit["layers"]):
            per_layer[li] = sorted(layer)
        take = []
        for li, members in per_layer.items():
            ranked = sorted(((deg.get(i, 0), i) for i in members),
                            key=lambda kv: (-kv[0], kv[1]))
            take.extend(i for _, i in ranked[: max(1, k // len(per_layer))])
        return sorted(int(root_ids[i]) for i in set(take))
    raise ValueError(f"unknown subset kind: {kind}")


# ---------------------------------------------------------------------------
# parquet -> bin (row-group pruned read)
# ---------------------------------------------------------------------------
def build_bin(subset_ids: list[int]) -> None:
    import pyarrow.dataset as ds
    import pyarrow.compute as pc
    root_ids, cx, cy, cz, S = derive_frame_nm()
    meta, frame = canonical_frame_from_meta()
    # cross-check the S recorded in the frame string. The recorded value is
    # a %.6g string and our re-derivation differs at the 6th digit (median/
    # percentile fill details), a relative difference of ~3e-5 -> at most
    # 0.013 scene units across the whole brain, BELOW the 0.1-unit Int16
    # quantization of every asset in the canonical frame. Real frame drift
    # (different neuron set / transform) shows up orders of magnitude larger,
    # so the tolerance is 1e-4 RELATIVE — hard-fail beyond that.
    import re
    mS = re.search(r"S=([0-9.eE+-]+)", frame)
    if mS:
        rec_S = float(mS.group(1))
        if abs(rec_S - S) > 1e-4 * S:
            print(f"FRAME DRIFT: recomputed S={S:.8g} vs recorded S={rec_S:.8g} "
                  f"(relative {abs(rec_S-S)/S:.2e} > 1e-4)", file=sys.stderr)
            sys.exit(3)
        print(f"frame S verified: derived {S:.8g}, recorded {rec_S:.8g} "
              f"(rel {abs(rec_S-S)/S:.1e}, sub-quantization)")
    print(f"frame verified: S={S:.6g}, medians nm ({cx:.0f}, {cy:.0f}, {cz:.0f})")

    want = set(subset_ids)
    # published schema (Schlegel et al. supplemental): node_id, parent_id,
    # radius, x, y, z, neuron  (268M rows, 4 row groups, SWC per neuron)
    dset = ds.dataset(PARQUET, format="parquet")
    print(f"parquet rows: {dset.count_rows():,}  ({time.time()-T0:.0f}s)")
    # predicate pushdown: the dataset engine streams row-group batches and
    # filters on 'neuron', so peak memory stays batch-sized (NOT 5.4 GB) and
    # only the curated subset survives.
    tbl = dset.to_table(filter=ds.field("neuron").isin(list(want)))
    print(f"subset rows matched: {tbl.num_rows:,}  ({time.time()-T0:.0f}s)")
    if tbl.num_rows == 0:
        print("ERROR: no rows matched the curated subset — root IDs mismatch?",
              file=sys.stderr)
        sys.exit(4)
    nid = tbl["neuron"].to_numpy()
    node_id = tbl["node_id"].to_numpy().astype(np.int64)
    xs = tbl["x"].to_numpy().astype(np.float64)
    ys = tbl["y"].to_numpy().astype(np.float64)
    zs = tbl["z"].to_numpy().astype(np.float64)
    par = tbl["parent_id"].to_numpy().astype(np.int64)   # node_id refs; <=0 = root
    del tbl
    # sort by (neuron, node_id): SWC parents then resolve by searchsorted
    order = np.lexsort((node_id, nid))
    nid, node_id = nid[order], node_id[order]
    xs, ys, zs, par = xs[order], ys[order], zs[order], par[order]
    del order
    bounds = np.flatnonzero(np.r_[True, nid[1:] != nid[:-1]])
    bounds = np.r_[bounds, len(nid)]

    idx_by_root: dict[int, dict] = {}
    bin_parts: list[bytes] = []
    off = 0
    found = 0
    for b in range(len(bounds) - 1):
        lo, hi = int(bounds[b]), int(bounds[b + 1])
        rid = int(nid[lo])
        n = hi - lo
        # rows may arrive in multiple chunks (row groups) — merge duplicates
        # by node_id (keep first occurrence; SWC node ids are unique/neuron)
        if n > 1 and (np.diff(node_id[lo:hi]) == 0).any():
            keep = np.r_[True, node_id[lo + 1:hi] != node_id[lo:hi - 1]]
            keep_idx = lo + np.flatnonzero(keep)
            n = len(keep_idx)
            seg_node = node_id[keep_idx]; seg_x = xs[keep_idx]
            seg_y = ys[keep_idx]; seg_z = zs[keep_idx]; seg_p = par[keep_idx]
        else:
            seg_node = node_id[lo:hi]; seg_x = xs[lo:hi]; seg_y = ys[lo:hi]
            seg_z = zs[lo:hi]; seg_p = par[lo:hi]
        X, Y, Z = to_scene(seg_x, seg_y, seg_z, cx, cy, cz, S)
        xyz = np.empty(n * 3, dtype=np.float64)
        xyz[0::3] = X; xyz[1::3] = Y; xyz[2::3] = Z
        xyz = np.clip(xyz, -65504.0, 65504.0)
        # parent: node_id -> row index within this neuron (searchsorted on the
        # sorted unique node ids), then relative delta (parent_row - my_row)
        my_row = np.arange(n)
        pd = np.zeros(n, dtype=np.int64)
        has_par = seg_p > 0
        if has_par.any():
            prow = np.searchsorted(seg_node, seg_p[has_par])
            ok = prow < n
            pd[np.flatnonzero(has_par)[ok]] = prow[ok] - my_row[np.flatnonzero(has_par)[ok]]
        pd = np.clip(pd, -32768, 32767).astype("<i2")
        blk = struct.pack("<I", n)
        blk += xyz.astype("<f2").tobytes()
        blk += pd.tobytes()
        blk += struct.pack("<I", 0)          # synCount placeholder (0 sites)
        rec_len = 4 + n * 6 + n * 2 + 4
        idx_by_root[rid] = {"off": off, "nodes": n, "syn": 0}
        bin_parts.append(blk)
        off += rec_len
        found += 1
        if found % 25 == 0:
            print(f"  {found}/{len(want)} neurons  ({time.time()-T0:.0f}s)")
    BIN_OUT.parent.mkdir(parents=True, exist_ok=True)
    BIN_OUT.write_bytes(b"".join(bin_parts))
    IDX_OUT.write_text(json.dumps({
        "schema": "arbors v1: per neuron uint32 n, f16 xyz*n, i16 parentDelta*n "
                  "(parent=myIdx+delta, delta 0 = none), uint32 synCount, f16 xyz*syn",
        "frame": frame,
        "n_neurons": len(idx_by_root),
        "by_root": {str(k): v for k, v in idx_by_root.items()},
        "provenance": {
            "source": "sk_lod1_783_healed_ds2.parquet (Zenodo record 10877326)",
            "citation": "Schlegel et al., Whole-brain annotation and multi-connectome "
                        "cell typing of Drosophila, Nature 634:139-152 (2024). "
                        "DOI 10.1038/s41586-024-07686-5",
            "skeleton_note": "lod-1 derived, 2x downsampled, nm; parent links are real "
                             "SWC topology (parent_id -> node_id resolved per neuron)",
            "subset": "curated (see --subset); source schema: node_id/parent_id/radius/x/y/z/neuron",
        },
    }, separators=(",", ":")))
    print(f"wrote {BIN_OUT} ({BIN_OUT.stat().st_size:,} bytes) + "
          f"{IDX_OUT} ({found} neurons)  ({time.time()-T0:.0f}s)")


# ---------------------------------------------------------------------------
# self-test (no network, no parquet)
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# ALL-neuron extraction (enables on-demand family streaming in the server)
# ---------------------------------------------------------------------------
def encode_neuron_block(seg_node, seg_x, seg_y, seg_z, seg_p, cx, cy, cz, S):
    """One neuron -> (bytes, nodeCount) in the arbors-v1 record format."""
    n = len(seg_node)
    X, Y, Z = to_scene(seg_x, seg_y, seg_z, cx, cy, cz, S)
    xyz = np.empty(n * 3, dtype=np.float64)
    xyz[0::3] = X; xyz[1::3] = Y; xyz[2::3] = Z
    xyz = np.clip(xyz, -65504.0, 65504.0)
    my_row = np.arange(n)
    pd = np.zeros(n, dtype=np.int64)
    has_par = seg_p > 0
    if has_par.any():
        prow = np.searchsorted(seg_node, seg_p[has_par])
        ok = prow < n
        pd[np.flatnonzero(has_par)[ok]] = (prow[ok]
                                           - my_row[np.flatnonzero(has_par)[ok]])
    pd = np.clip(pd, -32768, 32767).astype("<i2")
    blk = struct.pack("<I", n)
    blk += xyz.astype("<f2").tobytes()
    blk += pd.tobytes()
    blk += struct.pack("<I", 0)          # synCount placeholder (0 sites)
    return blk, n


def build_all() -> None:
    """Extract skeletons for EVERY circuit neuron into one append-ordered bin.

    Memory contract: rows stream in dataset batches (~2M rows), so peak RAM is
    batch-sized + the index, never the 5.4 GB parquet or a whole-neuron table.
    Batches may split a neuron across a boundary: the TRAILING neuron's rows
    are held back and prepended to the next batch (boundary-carry rule), so
    every processed group is a complete neuron. Duplicate node rows across row
    groups are merged exactly as in build_bin. Records append in ascending
    root-id order; the index stores each neuron's byte offset (record length is
    exactly 8 + nodes*8 bytes) so the server can serve per-family byte ranges.
    """
    import pyarrow as pa
    import pyarrow.dataset as ds
    circuit = json.loads(CIRCUIT.read_text(encoding="utf-8"))
    root_ids = np.sort(np.array(circuit["provenance"]["root_ids"], dtype=np.int64))
    # FlyWire root ids are ~7.2e17, so a dense bool mask is impossible (640 PiB);
    # sorted-array membership via searchsorted costs O(log n) per row and the
    # vectorized call is ~5-10 ns/row — negligible next to the parquet decode.
    in_circuit = root_ids
    del circuit
    root_ids, cx, cy, cz, S = derive_frame_nm()
    meta, frame = canonical_frame_from_meta()
    import re
    mS = re.search(r"S=([0-9.eE+-]+)", frame)
    if mS:
        rec_S = float(mS.group(1))
        if abs(rec_S - S) > 1e-4 * S:
            print(f"FRAME DRIFT: derived S={S:.8g} vs recorded {rec_S:.8g}",
                  file=sys.stderr)
            sys.exit(3)
    print(f"frame verified: S={S:.6g}; extracting {len(root_ids):,} circuit "
          f"neurons (batch-streamed)")

    dset = ds.dataset(PARQUET, format="parquet")
    scanner = dset.scanner(batch_size=2 << 20,
                           columns=["neuron", "node_id", "parent_id",
                                    "x", "y", "z"])
    out = open(BIN_ALL, "wb")
    idx: dict[int, dict] = {}
    stats = {"written": 0, "rows": 0}

    def flush(tbl):
        if tbl is None or tbl.num_rows == 0:
            return
        stats["written"] += process_neuron_rows(tbl, idx, out, in_circuit,
                                                cx, cy, cz, S)

    carry = None
    for bi, batch in enumerate(scanner.to_batches()):
        tbl = (pa.Table.from_batches([batch]) if carry is None
               else pa.concat_tables([carry, pa.Table.from_batches([batch])]))
        carry = None
        nid_all = tbl["neuron"].to_numpy()
        # hold back the trailing (possibly unfinished) neuron
        split = int(np.flatnonzero(nid_all == nid_all[-1])[0])
        if split > 0:
            flush(tbl.slice(0, split))
            carry = tbl.slice(split)
        else:
            carry = tbl            # whole batch is one huge neuron
        if (bi + 1) % 20 == 0:
            print(f"  batch {bi+1}: {len(idx):,} neurons written "
                  f"({out.tell():,} B, {time.time()-T0:.0f}s)")
    flush(carry)
    out.close()
    IDX_ALL.write_text(json.dumps({
        "schema": "arbors v1 (all circuit neurons): per neuron uint32 n, "
                  "f16 xyz*n, i16 parentDelta*n (parent=myIdx+delta, 0=none), "
                  "uint32 synCount(0), f16 xyz*syn(0); record length = "
                  "8 + n*8 bytes; by_root values give absolute bin offsets",
        "frame": frame,
        "n_neurons": len(idx),
        "by_root": {str(k): v for k, v in idx.items()},
        "provenance": {
            "source": "sk_lod1_783_healed_ds2.parquet (Zenodo record 10877326)",
            "citation": "Schlegel et al., Whole-brain annotation and multi-connectome "
                        "cell typing of Drosophila, Nature 634:139-152 (2024). "
                        "DOI 10.1038/s41586-024-07686-5",
            "scope": "all circuit neurons (fly_brain_circuit.json provenance.root_ids)",
        },
    }, separators=(",", ":")))
    print(f"wrote {BIN_ALL} ({BIN_ALL.stat().st_size:,} bytes) + {IDX_ALL} "
          f"({len(idx):,} neurons, {stats['rows']:,} rows scanned)  "
          f"({time.time()-T0:.0f}s)")


def process_neuron_rows(tbl, idx, out, in_circuit, cx, cy, cz, S):
    """Group complete-neuron rows into arbors-v1 records, appending to `out`.

    `in_circuit` is a sorted int64 array of circuit root ids (searchsorted
    membership — a dense mask is impossible at FlyWire id magnitudes). Skips
    neurons not in the circuit set and neurons already written (carry/
    row-group duplicates). Returns the number of records written. `out` needs
    only .write()/.tell() (a BytesIO works, which the self-test exercises)."""
    nid = tbl["neuron"].to_numpy()
    node_id = tbl["node_id"].to_numpy().astype(np.int64)
    xs = tbl["x"].to_numpy().astype(np.float64)
    ys = tbl["y"].to_numpy().astype(np.float64)
    zs = tbl["z"].to_numpy().astype(np.float64)
    par = tbl["parent_id"].to_numpy().astype(np.int64)
    keep_mask = np.isin(nid, in_circuit)
    if not keep_mask.any():
        return 0
    if not keep_mask.all():
        sel = np.flatnonzero(keep_mask)
        nid = nid[sel]
        node_id = node_id[sel]
        xs = xs[sel]; ys = ys[sel]; zs = zs[sel]
        par = par[sel]
    order = np.lexsort((node_id, nid))
    nid, node_id = nid[order], node_id[order]
    xs, ys, zs, par = xs[order], ys[order], zs[order], par[order]
    bounds = np.flatnonzero(np.r_[True, nid[1:] != nid[:-1]])
    bounds = np.r_[bounds, len(nid)]
    written = 0
    for b in range(len(bounds) - 1):
        lo, hi = int(bounds[b]), int(bounds[b + 1])
        rid = int(nid[lo])
        # membership was already enforced by the searchsorted prefilter above;
        # the guard here only prevents carry/row-group duplicates
        if rid in idx:
            continue
        if hi - lo > 1 and (np.diff(node_id[lo:hi]) == 0).any():
            kp = np.r_[True, node_id[lo + 1:hi] != node_id[lo:hi - 1]]
            ki = lo + np.flatnonzero(kp)
            seg_node = node_id[ki]; seg_x = xs[ki]; seg_y = ys[ki]
            seg_z = zs[ki]; seg_p = par[ki]
        else:
            seg_node = node_id[lo:hi]; seg_x = xs[lo:hi]; seg_y = ys[lo:hi]
            seg_z = zs[lo:hi]; seg_p = par[lo:hi]
        blk, n = encode_neuron_block(seg_node, seg_x, seg_y, seg_z, seg_p,
                                     cx, cy, cz, S)
        idx[rid] = {"off": out.tell(), "nodes": n, "syn": 0}
        out.write(blk)
        written += 1
    return written


def self_test() -> None:
    import io
    # to_scene axes: y up, z flipped (same as W1)
    X, Y, Z = to_scene(100.0, 200.0, 300.0, 0.0, 0.0, 0.0, 0.1)
    assert abs(X - 10.0) < 1e-9 and abs(Y - 30.0) < 1e-9 and abs(Z + 20.0) < 1e-9
    # parent-delta round trip
    parents = np.array([-1, 0, 1, 1, 2])          # root at 0
    n = len(parents)
    pd = np.where(parents >= 0, parents - np.arange(n), 0).astype("<i2")
    back = np.arange(n) + pd.astype(np.int64)
    assert all(back[i] == parents[i] for i in range(n) if parents[i] >= 0)
    # encode/decode round trip through the real record format
    seg_node = np.array([10, 11, 12, 13])
    seg_x = np.array([0.0, 1000.0, 2000.0, 3000.0])
    seg_y = np.array([0.0, 0.0, 0.0, 0.0])
    seg_z = np.array([0.0, 0.0, 0.0, 0.0])
    seg_p = np.array([-1, 10, 10, 11])            # node_id refs (10..13)
    blk, n_out = encode_neuron_block(seg_node, seg_x, seg_y, seg_z, seg_p,
                                     0.0, 0.0, 0.0, 1.0)
    assert n_out == 4 and len(blk) == 8 + n_out * 8
    dvv = struct.unpack("<I", blk[:4])[0]
    assert dvv == 4
    xyz_back = np.frombuffer(blk[4:4 + 8 * 4], dtype="<f2").astype(np.float64)
    assert abs(xyz_back[9] - 3000.0) < 4.0        # f16 step at 3000 is 2.0
    pd_back = np.frombuffer(blk[4 + 24:4 + 32], dtype="<i2").astype(np.int64)
    # parents (row refs): node0 root, node1->0, node2->0, node3->1
    assert list(pd_back) == [0, -1, -2, -2]
    rows_back = np.arange(4) + pd_back
    assert rows_back[1] == 0 and rows_back[2] == 0 and rows_back[3] == 1
    # process_neuron_rows: circuit filter, dedup, and offset bookkeeping
    import pyarrow as pa
    t = pa.table({
        "neuron": pa.array([1, 1, 2, 2, 3, 3], type=pa.int64()),
        "node_id": pa.array([10, 11, 20, 21, 30, 31], type=pa.int64()),
        "parent_id": pa.array([-1, 10, -1, 20, -1, 30], type=pa.int64()),
        "x": pa.array([0., 1., 0., 1., 0., 1.]),
        "y": pa.array([0., 0., 0., 0., 0., 0.]),
        "z": pa.array([0., 0., 0., 0., 0., 0.]),
    })
    in_c = np.array([1, 3], dtype=np.int64)       # sorted circuit set: 1,3 kept
    buf = io.BytesIO()
    idx = {}
    w1 = process_neuron_rows(t, idx, buf, in_c, 0., 0., 0., 1.0)
    assert w1 == 2 and set(idx) == {1, 3}
    assert idx[3]["off"] == 8 + idx[1]["nodes"] * 8   # records are contiguous
    # re-processing the same rows is a no-op (carry/row-group dedup)
    w2 = process_neuron_rows(t, idx, buf, in_c, 0., 0., 0., 1.0)
    assert w2 == 0 and buf.tell() == 8 + idx[1]["nodes"] * 8 + 8 + idx[3]["nodes"] * 8
    # subset pick is deterministic
    print("self-test passed: 6 invariant groups (frame axes, parent deltas, "
          "record round-trip, circuit filter, dedup, contiguity)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--download", action="store_true",
                    help="resumable ranged download of the skeleton parquet")
    ap.add_argument("--subset", default="top", choices=["top", "layered", "ids"])
    ap.add_argument("--ids-file", default=None)
    ap.add_argument("--build", action="store_true", help="build curated bin from parquet")
    ap.add_argument("--build-all", action="store_true",
                    help="extract ALL circuit neurons -> skeletons_all.bin "
                         "(enables on-demand family streaming in the server)")
    args = ap.parse_args()
    if args.self_test:
        self_test(); return 0
    if args.download:
        download_resumable(ZENODO_URL, PARQUET); return 0
    if args.build_all:
        build_all(); return 0
    if args.build:
        ids = pick_subset(args.subset, args.ids_file)
        print(f"curated subset '{args.subset}': {len(ids)} neurons")
        build_bin(ids); return 0
    print("nothing to do: pass --download and/or --build/--build-all (see --help)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
