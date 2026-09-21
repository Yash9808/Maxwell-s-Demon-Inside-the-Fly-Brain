"""Build per-neuron cell-type metadata for the P1 fly-brain model (Stage B).

Output: fly_brain_celltypes.json — one record per circuit neuron, keyed by
v783 root ID, joining ONLY data that already exists in this workspace:

  neuron_nt_classification.csv   per-neuron NT class (classify_neurons.py,
                                 from v783 synapse NT scores)
  per_neuron_neuropil_count_pre  dominant OUTPUT neuropil  (+ pre_syn_sum)
  per_neuron_neuropil_count_post dominant INPUT neuropil   (+ post_syn_sum)
  proofread_root_ids_783.npy     circuit root-ID ground truth

No classification is invented: a neuron's "cell type" field here is exactly
the FlyWire-score-derived NT class plus real neuropil memberships. Where
published FlyWire/flyvis cell-type tables would refine the label, the schema
(see P1_CELLTYPE_SCHEMA.md) reserves fields and the loader marks them UNKNOWN.

The circuit index->root-ID mapping is reconstructed with the exact algorithm
used by extract_circuit.py / _rebuild_anatomy.py and verified against the
reconstruction invariant: layer membership recomputed here must equal
fly_brain_circuit.json's layers.

Usage:
    python p1_build_celltypes.py            # full build (needs pyarrow)
    python p1_build_celltypes.py --verify   # verify an existing output file
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.feather as ft

ROOT = Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CIRCUIT = ROOT / "fly_brain_circuit.json"
NT_CSV = ROOT / "neuron_nt_classification.csv"
PRE = ROOT / "per_neuron_neuropil_count_pre_783.feather"
POST = ROOT / "per_neuron_neuropil_count_post_783.feather"
ROOT_IDS = ROOT / "proofread_root_ids_783.npy"
OUT = ROOT / "fly_brain_celltypes.json"

LAYER_NPILS = [
    {"AL_L", "AL_R"},
    {"ME_L", "ME_R", "LO_L", "LO_R", "LOP_L", "LOP_R"},
    {"LH_L", "LH_R", "MB_CA_L", "MB_CA_R", "MB_VL_L", "MB_VL_R",
     "MB_ML_L", "MB_ML_R", "MB_PED_L", "MB_PED_R"},
    {"SMP_L", "SMP_R", "SIP_L", "SIP_R", "SLP_L", "SLP_R"},
    {"GNG", "SAD"},
]
LAYERS = [
    ["AL_L", "AL_R"],
    ["ME_L", "ME_R", "LO_L", "LO_R", "LOP_L", "LOP_R"],
    ["LH_L", "LH_R", "MB_CA_L", "MB_CA_R", "MB_VL_L", "MB_VL_R",
     "MB_ML_L", "MB_ML_R", "MB_PED_L", "MB_PED_R"],
    ["SMP_L", "SMP_R", "SIP_L", "SIP_R", "SLP_L", "SLP_R"],
    ["GNG", "SAD"],
]
NTS = ("ach", "gaba", "glut", "oct", "ser", "da")
PROVENANCE = {
    "dataset": "fafb_v783",
    "materialization": 783,
    "scope": "proofread",
    "nt_source": "Buhmann et al. synapse-type model scores (FlyWire codex exports), "
                 "aggregated per neuron by classify_neurons.py (threshold 0.50, margin 0.05)",
    "neuropil_source": "per_neuron_neuropil_count_{pre,post}_783.feather (FlyWire community tables)",
    "cell_type_source": "NONE PRESENT in workspace; fields reserved for published "
                        "FlyWire/flyvis cell-type tables via p1_celltypes.import",
    "note": "cell_type is a P1 reserved field; nt_class and neuropils are real "
            "v783-derived data. Nothing here is a published anatomical cell type.",
}


def dominant_neuropil(table: pa.Table, key: str) -> dict[int, dict]:
    """Dominant neuropil per neuron + total synapse count (ties -> alphabetical min).

    Same tie-break as extract_circuit.py so the mapping reconstruction matches.
    """
    mx = table.group_by(key).aggregate([("count", "max")])
    top = table.join(mx, keys=key, join_type="inner")
    top = top.filter(pc.equal(top["count"], top["count_max"]))
    dom = top.group_by(key).aggregate([("neuropil", "min")])
    tot = table.group_by(key).aggregate([("count", "sum")])
    dom = dom.rename_columns([key, "dominant"])
    tot = tot.rename_columns([key, "total"])
    j = dom.join(tot, keys=key, join_type="inner")
    return {int(r[key]): {"dominant": r["dominant"], "total": int(r["total"])}
            for r in j.to_pylist()}


def top_neuropils(table: pa.Table, key: str, ids_arr: pa.Array,
                  keep: int = 4) -> dict[int, list]:
    """Top-`keep` output/input neuropils per neuron as [[name, count], ...].

    Deterministic: count descending, then neuropil name ascending as tie-break.
    """
    filt = table.filter(pc.is_in(table[key], value_set=ids_arr))
    df = filt.select([key, "neuropil", "count"]).to_pandas()
    df = df.sort_values(["count", "neuropil"], ascending=[False, True],
                        kind="stable")
    top = df.groupby(key, sort=False).head(keep)
    out: dict[int, list] = {}
    for rid, g in top.groupby(key, sort=False):
        out[int(rid)] = [[n, int(c)] for n, c in zip(g["neuropil"], g["count"])]
    return out


def reconstruct_index_mapping() -> tuple[list[int], list[list[int]], dict[int, int]]:
    """Circuit index -> root ID, layer member lists, and root->layer map, from pre-counts.

    Reproduces extract_circuit.py exactly (dominant pre neuropil, ties -> min,
    sorted IDs -> index). Raises if the recomputed layers disagree with the
    shipped circuit JSON.
    """
    pre = ft.read_table(PRE, memory_map=True)
    proof = pa.array(np.load(ROOT_IDS).tolist(), type=pa.int64())
    pre = pre.filter(pc.is_in(pre["pre_pt_root_id"], value_set=proof))
    mx = pre.group_by("pre_pt_root_id").aggregate([("count", "max")])
    top = pre.join(mx, keys="pre_pt_root_id", join_type="inner")
    top = top.filter(pc.equal(top["count"], top["count_max"]))
    pre_map = top.group_by("pre_pt_root_id").aggregate([("neuropil", "min")])

    layer_of: dict[int, int] = {}
    for rid, npil in zip(pre_map["pre_pt_root_id"].to_pylist(),
                         pre_map["neuropil_min"].to_pylist()):
        for li, group in enumerate(LAYER_NPILS):
            if npil in group:
                layer_of[int(rid)] = li
                break

    circuit = json.loads(CIRCUIT.read_text())
    root_of = sorted(layer_of)
    recon = [[] for _ in LAYER_NPILS]
    idx = {rid: i for i, rid in enumerate(root_of)}
    for rid in root_of:
        recon[layer_of[rid]].append(idx[rid])
    if recon != circuit["layers"]:
        raise RuntimeError("index->root reconstruction invariant FAILED: "
                           "recomputed layers != fly_brain_circuit.json layers")
    return root_of, circuit["layers"], layer_of


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true",
                    help="verify an existing fly_brain_celltypes.json")
    args = ap.parse_args()

    if args.verify:
        data = json.loads(OUT.read_text())
        root_of, layers, layer_of = reconstruct_index_mapping()
        recs = data["neurons"]
        assert data["meta"]["n_neurons"] == len(root_of) == len(recs), "count mismatch"
        assert data["meta"]["root_ids_sha256"] == hashlib.sha256(
            np.asarray(root_of, dtype=np.uint64).tobytes()).hexdigest(), "root-id hash"
        n_layer_ok = 0
        for rec, rid in zip(recs, root_of):
            assert rec["root_id"] == str(rid), "root order"
            assert rec["layer"] == layer_of[rid], "layer coherence"
            n_layer_ok += 1
        print(f"verify OK: {n_layer_ok:,} records, hash+order+layer coherence pass")
        return

    t0 = time.time()
    print("reconstructing circuit index->root mapping ...")
    root_of, layers, layer_of = reconstruct_index_mapping()
    n = len(root_of)
    print(f"  {n:,} circuit neurons mapped (invariant verified)  {time.time()-t0:.0f}s")

    known_ids = set(root_of)
    ids_arr = pa.array(sorted(known_ids), type=pa.int64())

    print("loading NT classification CSV ...")
    nt_of: dict[int, dict] = {}
    with NT_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rid = int(row["root_id"])
            if rid not in known_ids:
                continue
            nt_of[rid] = {
                "nt_class": row["cell_type"],
                "nt_dominant_score": float(row["dominant_score"]),
                "nt_margin": float(row["margin"]),
                "nt_scores": {k: float(row[f"{k}_score"]) for k in NTS},
                "outgoing_synapses": int(row["outgoing_synapses"]),
            }
    print(f"  {len(nt_of):,} NT records joined")

    print("loading pre/post neuropil counts ...")
    pre = ft.read_table(PRE, memory_map=True)
    pre = pre.filter(pc.is_in(pre["pre_pt_root_id"], value_set=ids_arr))
    pre_dom = dominant_neuropil(pre, "pre_pt_root_id")
    pre_top = top_neuropils(pre, "pre_pt_root_id", ids_arr)
    print(f"  pre: {len(pre_dom):,} neurons  {time.time()-t0:.0f}s")
    post = ft.read_table(POST, memory_map=True)
    post = post.filter(pc.is_in(post["post_pt_root_id"], value_set=ids_arr))
    post_dom = dominant_neuropil(post, "post_pt_root_id")
    post_top = top_neuropils(post, "post_pt_root_id", ids_arr)
    print(f"  post: {len(post_dom):,} neurons  {time.time()-t0:.0f}s")

    recs = []
    for i, rid in enumerate(root_of):
        li = layer_of[rid]
        pd_ = pre_dom.get(rid, {})
        pdm = post_dom.get(rid, {})
        nt = nt_of.get(rid)
        rec = {
            # NOTE: root_id is a decimal STRING — uint64 IDs exceed JS
            # Number.MAX_SAFE_INTEGER and would lose precision as JSON numbers.
            "root_id": str(rid),
            "layer": li,
            "pre_neuropil": pd_.get("dominant"),
            "pre_syn_total": pd_.get("total", 0),
            "pre_neuropils_top": pre_top.get(rid, []),
            "post_neuropil": pdm.get("dominant"),
            "post_syn_total": pdm.get("total", 0),
            "post_neuropils_top": post_top.get(rid, []),
            "nt_class": nt["nt_class"] if nt else "UNKNOWN",
            "nt_scores": nt["nt_scores"] if nt else None,
            "nt_dominant_score": nt["nt_dominant_score"] if nt else None,
            "nt_margin": nt["nt_margin"] if nt else None,
            # P1 reserved fields: real FlyWire cell-type tables would fill these.
            # Absent data ships as UNKNOWN, never as an invented label.
            "cell_type": "UNKNOWN",
            "cell_type_source": "UNKNOWN",
            "synapse_class_sign": sign_of(nt["nt_scores"]) if nt else 0,
        }
        recs.append(rec)

    out = {
        "meta": {
            "p1_stage": "B",
            "schema_version": 1,
            "n_neurons": n,
            "root_ids_sha256": hashlib.sha256(
                np.asarray(root_of, dtype=np.uint64).tobytes()).hexdigest(),
            "index_mapping": "sorted(root_ids) from pre-count reconstruction, "
                             "verified against fly_brain_circuit.json layers",
            "provenance": PROVENANCE,
            "n_nt_classified": sum(1 for r in recs if r["nt_class"] != "UNKNOWN"),
            "n_post_mapped": sum(1 for r in recs if r["post_neuropil"]),
        },
        "layer_names": LAYERS,
        "neurons": recs,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT.name} ({OUT.stat().st_size/1e6:.1f} MB, {n:,} neurons)  "
          f"{time.time()-t0:.0f}s total")


def sign_of(scores: dict[str, float] | None) -> int:
    """Synapse-class sign: -1 inhibitory-like (gaba/ser/da dominant), +1 exc, 0 unknown.

    Mirrors extract_circuit.py's INH set; used only as a MODEL-ASSUMED polarity
    prior, never as a biological claim about a neuron's sign.
    """
    if not scores:
        return 0
    dom = max(scores, key=lambda k: scores[k])
    return -1 if dom in ("gaba", "ser", "da") else 1


if __name__ == "__main__":
    main()
