"""Extract a compact visual -> AL -> LH/MB -> central -> motor subnetwork.

Layers (by each neuron's dominant output neuropil):
  0 AL (antennal lobe) -> 1 ME/LO/LOP (optic lobe) -> 2 LH/MB
  -> 3 SMP/SIP/SLP (central) -> 4 GNG/SAD (motor output).

The optic layer also gets a position-derived visual channel from the synapse-level
FlyWire table. This is a visualization/simulation interface, not a claim that EM
synapse coordinates alone identify a photoreceptor's receptive field.

Writes fly_brain_circuit.json with layers, synapse-weighted signed edges, and
`optic_channels`: normalized [u, v, depth] centroids for optic-layer neurons.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict

import pyarrow as pa
import pyarrow.compute as pc

import fafb783 as fb

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NTS = ("gaba", "ach", "glut", "oct", "ser", "da")
INH = {"gaba", "ser", "da"}
LAYER_NPILS = [
    {"AL_L", "AL_R"},
    {"ME_L", "ME_R", "LO_L", "LO_R", "LOP_L", "LOP_R"},
    {"LH_L", "LH_R", "MB_CA_L", "MB_CA_R", "MB_VL_L", "MB_VL_R",
     "MB_ML_L", "MB_ML_R", "MB_PED_L", "MB_PED_R"},
    {"SMP_L", "SMP_R", "SIP_L", "SIP_R", "SLP_L", "SLP_R"},
    {"GNG", "SAD"},
]

POSITION_COLUMNS = ["pre_pt_root_id", "pre_pt_position_x", "pre_pt_position_y",
                    "pre_pt_position_z"]


def optic_position_channels(optic_ids: set[int]) -> dict[int, list[float]]:
    """Return normalized synapse-position centroids for optic neurons.

    Only four columns are selected from the memory-mapped synapse table and rows
    are filtered to the optic root IDs before aggregation. Missing synapse data
    is allowed so circuit extraction can still produce a connectivity-only file.
    """
    if not optic_ids:
        return {}
    try:
        syn = fb.load_synapses().select(POSITION_COLUMNS)
    except (FileNotFoundError, OSError):
        print("warning: synapse-level table unavailable; optic channels omitted")
        return {}
    rows = syn.filter(pc.is_in(syn["pre_pt_root_id"],
                               value_set=pa.array(sorted(optic_ids), type=pa.int64())))
    if rows.num_rows == 0:
        print("warning: no optic synapse positions found; optic channels omitted")
        return {}
    centroids = rows.group_by("pre_pt_root_id").aggregate([
        ("pre_pt_position_x", "mean"),
        ("pre_pt_position_y", "mean"),
        ("pre_pt_position_z", "mean"),
    ]).to_pylist()
    if not centroids:
        return {}
    mins = [min(float(r[f"pre_pt_position_{axis}_mean"]) for r in centroids)
            for axis in "xyz"]
    maxs = [max(float(r[f"pre_pt_position_{axis}_mean"]) for r in centroids)
            for axis in "xyz"]
    channels = {}
    for row in centroids:
        xyz = [float(row[f"pre_pt_position_{axis}_mean"]) for axis in "xyz"]
        norm = [(v - lo) / (hi - lo) if hi > lo else 0.5
                for v, lo, hi in zip(xyz, mins, maxs)]
        channels[int(row["pre_pt_root_id"])] = norm
    print(f"optic position centroids: {len(channels):,} neurons from {rows.num_rows:,} synapses")
    return channels


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-positions", action="store_true",
                        help="skip the large synapse-level position lookup")
    args = parser.parse_args()

    conns = fb.load_connections()
    pre = fb.load_pre_counts()
    proofread = pa.array(fb.load_root_ids())

    # 1) dominant output neuropil per PROOFREAD neuron (ties -> alphabetical min)
    pre = pre.filter(pc.is_in(pre["pre_pt_root_id"], value_set=proofread))
    mx = pre.group_by("pre_pt_root_id").aggregate([("count", "max")])
    top = pre.join(mx, keys="pre_pt_root_id", join_type="inner")
    top = top.filter(pc.equal(top["count"], top["count_max"]))
    pre_map = top.group_by("pre_pt_root_id").aggregate([("neuropil", "min")])
    pre_map = pre_map.rename_columns(["pre_pt_root_id", "pre_neuropil"])

    # 2) neurons whose dominant output neuropil is in a layer
    layer_of = {}
    members = [[] for _ in LAYER_NPILS]
    npil_arr = pre_map["pre_neuropil"].to_pylist()
    ids_arr = pre_map["pre_pt_root_id"].to_pylist()
    for rid, npil in zip(ids_arr, npil_arr):
        for li, group in enumerate(LAYER_NPILS):
            if npil in group:
                layer_of[rid] = li
                members[li].append(rid)
                break
    for li, m in enumerate(members):
        print(f"layer {li}: {len(m):,} neurons")

    optic_ids = set(members[1])
    optic_channels = {} if args.no_positions else optic_position_channels(optic_ids)

    # 3) keep strong inter/intra-layer edges (>= 10 synapses), synapse-weighted
    keys = pa.array(list(layer_of.keys()), type=pa.int64())
    keep = conns.filter(
        (pc.field("syn_count") >= 10)
        & pc.is_in(pc.field("pre_pt_root_id"), value_set=keys)
        & pc.is_in(pc.field("post_pt_root_id"), value_set=keys)
    )
    print("inter-layer edge rows (>=10 syn):", keep.num_rows)

    edge_rows = keep.select(["pre_pt_root_id", "post_pt_root_id",
                             "syn_count", *[f"{n}_avg" for n in NTS]]).to_pylist()
    edges = []
    for r in edge_rows:
        s, t, w = r["pre_pt_root_id"], r["post_pt_root_id"], r["syn_count"]
        li, lj = layer_of[s], layer_of[t]
        scores = {n: (r[f"{n}_avg"] or 0.0) for n in NTS}
        dom = max(scores, key=scores.get) if any(scores.values()) else "ach"
        edges.append({
            "s": s, "t": t, "li": li, "lj": lj, "w": int(w),
            "sign": -1 if dom in INH else 1, "nt": dom,
        })

    # 4) aggregate parallel edges (same s,t) -> weight sum, majority sign
    agg = defaultdict(lambda: [0, 0, 0, ""])  # w, exc, inh, nt
    for e in edges:
        a = agg[(e["s"], e["t"])]
        a[0] += e["w"]
        a[1] += e["w"] if e["sign"] > 0 else 0
        a[2] += e["w"] if e["sign"] < 0 else 0
        a[3] = e["nt"]
    final_edges = [
        {"s": s, "t": t, "w": v[0], "sign": 1 if v[1] >= v[2] else -1, "nt": v[3]}
        for (s, t), v in agg.items()
    ]
    print("aggregated unique edges:", len(final_edges))

    all_ids = sorted(layer_of)
    idx = {rid: i for i, rid in enumerate(all_ids)}
    layers = [[] for _ in LAYER_NPILS]
    for rid in all_ids:
        layers[layer_of[rid]].append(idx[rid])

    out = {
        "layer_names": ["antennal lobe (AL)", "optic lobe (ME/LO/LOP)",
                        "lateral horn + mushroom body", "central (SMP/SIP/SLP)",
                        "motor (GNG/SAD)"],
        "optic_layer": 1,
        "optic_channels": {
            str(idx[rid]): channel for rid, channel in optic_channels.items()
            if rid in idx
        },
        "nt_name": [e["nt"] for e in final_edges],
        "layers": layers,
        "edges": [
            {"s": idx[e["s"]], "t": idx[e["t"]], "w": e["w"], "sign": e["sign"]}
            for e in final_edges
        ],
    }
    with open("fly_brain_circuit.json", "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    import os
    print("wrote fly_brain_circuit.json",
          f"({os.path.getsize('fly_brain_circuit.json')/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
