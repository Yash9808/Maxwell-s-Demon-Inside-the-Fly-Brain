"""Loaders and helpers for the FlyWire FAFB v783 proofread connectome files.

All tables are opened with pyarrow.feather (memory-mapped), so nothing is
eagerly materialized; aggregate with pyarrow.compute / pandas on slices.

Usage:
    import fafb783
    conns = fafb783.load_connections()
    fb.summary()
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.feather as ft

ROOT = Path(__file__).resolve().parent

CONNECTIONS = ROOT / "proofread_connections_783.feather"
PRE_COUNTS = ROOT / "per_neuron_neuropil_count_pre_783.feather"
POST_COUNTS = ROOT / "per_neuron_neuropil_count_post_783.feather"
ROOT_IDS = ROOT / "proofread_root_ids_783.npy"
SYNAPSES_FALLBACK = ROOT / "Unconfirmed 955629.crdownload"
SYNAPSES = ROOT / "synapses_connections_783.feather"

_NT_COLS = ("gaba", "ach", "glut", "oct", "ser", "da")


def load_connections() -> pa.Table:
    """Aggregated edges between proofread neurons (16.8M rows)."""
    return ft.read_table(CONNECTIONS, memory_map=True)


def load_pre_counts() -> pa.Table:
    """Per-neuron output synapse counts per neuropil (2.8M rows)."""
    return ft.read_table(PRE_COUNTS, memory_map=True)


def load_post_counts() -> pa.Table:
    """Per-neuron input synapse counts per neuropil (43.4M rows)."""
    return ft.read_table(POST_COUNTS, memory_map=True)


def load_root_ids() -> np.ndarray:
    """uint64 array of the 139,255 proofread neurons in v783."""
    return np.load(ROOT_IDS)


def load_synapses() -> pa.Table:
    """Synapse-level table (130M rows). Uses the renamed file if present."""
    path = SYNAPSES if SYNAPSES.exists() else SYNAPSES_FALLBACK
    return ft.read_table(path, memory_map=True)


def dominant_nt(scores: pa.Table, nt_cols: tuple[str, ...] = _NT_COLS,
                threshold: float = 0.5) -> pa.ChunkedArray:
    """Argmax neurotransmitter per row, or 'none' if max score < threshold.

    Accepts tables with either bare (`gaba`) or averaged (`gaba_avg`) columns.
    """
    cols = {}
    for c in nt_cols:
        name = c if c in scores.column_names else f"{c}_avg"
        cols[c] = scores[name]
    mat = pa.table(cols).to_pandas().to_numpy()
    idx = mat.argmax(axis=1)
    best = mat[np.arange(len(idx)), idx]
    names = np.array(nt_cols, dtype=object)
    out = np.where(best >= threshold, names[idx], "none")
    return pa.array(out, type=pa.string())


def top_partners(conns: pa.Table, root_id: int, direction: str = "post",
                 k: int = 20) -> pa.Table:
    """Strongest partners of `root_id`.

    direction='post' -> its outputs (postsynaptic partners);
    direction='pre'  -> its inputs (presynaptic partners).
    Aggregated across neuropils, sorted by syn_count descending.
    """
    if direction == "post":
        filt = pc.field("pre_pt_root_id") == root_id
        partner = "post_pt_root_id"
    elif direction == "pre":
        filt = pc.field("post_pt_root_id") == root_id
        partner = "pre_pt_root_id"
    else:
        raise ValueError("direction must be 'post' or 'pre'")

    t = conns.filter(filt)
    return (
        t.group_by(partner)
        .aggregate([("syn_count", "sum")])
        .sort_by([("syn_count_sum", "descending")])
        .slice(0, k)
    )


def summary() -> dict:
    """Dataset health check: row counts, ID coverage, syn-count cross-checks."""
    conns = load_connections()
    pre, post = load_pre_counts(), load_post_counts()
    ids = load_root_ids()

    n_edges = conns.num_rows
    n_pairs = conns.group_by(["pre_pt_root_id", "post_pt_root_id"]).aggregate([]).num_rows
    syn_total = pc.sum(conns["syn_count"]).as_py()

    in_conns = pa.concat_arrays([
        conns["pre_pt_root_id"].combine_chunks(),
        conns["post_pt_root_id"].combine_chunks(),
    ])
    id_set = pa.array(ids)
    n_in = pc.count_distinct(in_conns).as_py()
    covered = pc.filter(in_conns, pc.is_in(in_conns, value_set=id_set))
    n_covered = pc.count_distinct(covered).as_py()

    return {
        "proofread_neurons": len(ids),
        "edges": n_edges,
        "unique_pairs": n_pairs,
        "total_synapses_edges": syn_total,
        "neurons_in_edges": n_in,
        "neurons_in_edges_also_proofread": n_covered,
        "pre_count_rows": pre.num_rows,
        "post_count_rows": post.num_rows,
        "pre_syn_total": pc.sum(pre["count"]).as_py(),
        "post_syn_total": pc.sum(post["count"]).as_py(),
    }


if __name__ == "__main__":
    for k, v in summary().items():
        print(f"{k}: {v:,}")
