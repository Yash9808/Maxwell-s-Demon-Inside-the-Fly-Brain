"""Extract a compact visual -> AL -> LH/MB -> central -> motor subnetwork.

Layers (by each neuron's dominant output neuropil):
  0 AL (antennal lobe) -> 1 ME/LO/LOP (optic lobe) -> 2 LH/MB
  -> 3 SMP/SIP/SLP (central) -> 4 GNG/SAD (motor output).

The optic layer also gets a position-derived visual channel from the synapse-level
FlyWire table. This is a visualization/simulation interface, not a claim that EM
synapse coordinates alone identify a photoreceptor's receptive field.

Writes fly_brain_circuit.json (schema 2, P0) with layers, synapse-weighted edges,
`optic_channels`: normalized [u, v, depth] centroids for optic-layer neurons,
per-edge NT identity / modulatory flags / contributor counts, and a provenance
block (FlyWire root IDs, extraction version, sources, documented assumptions).

P0 biological-validity semantics (see P0_AUDIT.md):
  * sign (fast transmission polarity), nt (identity) and the modulatory role
    are INDEPENDENT fields per edge — one is never derived from another.
  * dopamine / serotonin / octopamine are modulatory channels: sign 0, never
    weight-bearing fast synapses.
  * aggregation of parallel (pre, post) rows is deterministic: syn-count-
    weighted majority NT vote, alphabetical tie-break, order-invariant.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone

import pyarrow as pa
import pyarrow.compute as pc

import fafb783 as fb

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NTS = ("gaba", "ach", "glut", "oct", "ser", "da")

# --- P0 NT semantics table -------------------------------------------------
# nt -> (sign, modulatory, modulator_type). One source of truth for the whole
# pipeline; nothing else in this file may assign a sign from an NT identity.
#   gaba : fast inhibitory (well supported in the fly CNS).
#   ach  : fast excitatory (well supported; KCs, sensory afferents).
#   glut : fast excitatory BY ASSUMPTION — real-fly CNS glutamate is mixed;
#          kept uniform and documented in provenance.assumptions, not invented
#          per-edge (no per-edge sign evidence is consumed here).
#   oct  : octopamine — neuromodulator (arousal/state), NOT a fast synapse.
#   ser  : serotonin   — predominantly modulatory in the fly, NOT auto-inhibitory.
#   da   : dopamine    — the MB teaching signal / third factor, NOT inhibitory.
NT_TABLE = {
    "gaba": (-1, False, None),
    "ach": (1, False, None),
    "glut": (1, False, None),
    "oct": (0, True, "octopamine"),
    "ser": (0, True, "serotonin"),
    "da": (0, True, "dopamine"),
}
MODULATORY_NTS = frozenset(n for n, (_, mod, _) in NT_TABLE.items() if mod)
EXTRACTION_VERSION = "2.0-p0"


def edge_semantics(nt: str) -> tuple[int, bool, str | None]:
    """Return (sign, modulatory, modulator_type) for an NT label."""
    return NT_TABLE[nt]
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


# --- P0 deterministic aggregation -------------------------------------------
# Parallel raw rows with the same (pre, post) are aggregated into one edge.
# The rule is deliberately simple, total (no coin flips) and order-invariant:
#   weight      : sum of contributing syn_counts (weight-bearing rows only)
#   nt          : syn-count-weighted majority of row NT labels;
#                 ties -> alphabetically smallest label
#   sign        : the majority NT's sign from NT_TABLE (never voted separately,
#                 so identity and polarity can never disagree)
#   modulatory  : true iff ANY contributing row is modulatory
#   modulator_type: the modulator type of the majority NT (None if not modulatory)
#   contributors: number of contributing raw rows (provenance)
#   nt_votes    : {nt: syn_count} — kept only when >1 distinct NT contributed


def dominant_nt(votes: dict[str, int]) -> str:
    """Syn-count-weighted majority NT; ties break to the alphabetically smallest
    label. votes maps nt label -> summed syn_count. Deterministic: the result
    depends only on the vote multiset, never on insertion or iteration order."""
    best = None
    best_w = -1
    for nt in sorted(votes):                 # sorted iteration => deterministic
        w = votes[nt]
        if w > best_w:                        # strict > : first (alphabetical)
            best, best_w = nt, w              # label wins ties
    return best


def aggregate_edges(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Aggregate raw rows (s, t, w, nt) into (fast_edges, modulatory_edges).

    Rows may arrive in any order; the output is sorted by (s, t) and every
    field is computed from totals that do not depend on traversal order.

    Fast (weight-bearing: gaba/ach/glut) and modulatory (da/ser/oct) contacts
    between the same pair are DIFFERENT synapse types, so they never merge:
    a DAN's dopamine release sites must not erase the ACh synapse count of the
    same connection, nor inherit its sign. Fast edges feed the spike-propagation
    weight arrays; modulatory edges feed the third-factor channels.
    """
    fast_acc: dict[tuple[int, int], dict] = {}
    mod_acc: dict[tuple[int, int], dict] = {}
    for r in rows:
        key = (r["s"], r["t"])
        _, mod, _ = edge_semantics(r["nt"])
        acc = mod_acc if mod else fast_acc
        a = acc.get(key)
        if a is None:
            a = acc[key] = {"w": 0, "nt_votes": defaultdict(int), "n": 0}
        a["w"] += r["w"]
        a["nt_votes"][r["nt"]] += r["w"]
        a["n"] += 1

    def emit(acc: dict, modulatory: bool) -> list[dict]:
        out = []
        for (s, t) in sorted(acc):
            a = acc[(s, t)]
            votes = dict(a["nt_votes"])
            nt = dominant_nt(votes)
            sign, _, mtype = edge_semantics(nt)
            e = {"s": s, "t": t, "w": a["w"], "sign": sign, "nt": nt,
                 "modulatory": modulatory, "contributors": a["n"]}
            if modulatory:
                e["modulatorType"] = mtype
            if len(votes) > 1:
                e["nt_votes"] = {k: votes[k] for k in sorted(votes)}
            out.append(e)
        return out

    return emit(fast_acc, False), emit(mod_acc, True)


def self_test() -> None:
    """Fast invariants for the P0 aggregation semantics (no pyarrow needed)."""
    import itertools
    import random

    # 1) DA/SER/OCT are modulatory channels with zero sign, never weight-bearing
    for nt, mtype in (("da", "dopamine"), ("ser", "serotonin"), ("oct", "octopamine")):
        fast, mod = aggregate_edges([{"s": 1, "t": 2, "w": 40, "nt": nt}])
        assert fast == [] and len(mod) == 1
        e = mod[0]
        assert e["sign"] == 0 and e["modulatory"] and e["modulatorType"] == mtype, e
    # 1b) a modulator contact does not erase or sign-flip a fast contact on the
    #     same pair: the two channels stay separate
    fast, mod = aggregate_edges([{"s": 3, "t": 4, "w": 12, "nt": "ach"},
                                 {"s": 3, "t": 4, "w": 99, "nt": "da"}])
    assert len(fast) == 1 and fast[0]["nt"] == "ach" and fast[0]["sign"] == 1 \
        and fast[0]["w"] == 12, fast
    assert len(mod) == 1 and mod[0]["nt"] == "da" and mod[0]["modulatorType"] == "dopamine" \
        and mod[0]["w"] == 99, mod
    # 2) GABA inhibitory, ACh excitatory, not modulatory
    fast, mod = aggregate_edges([{"s": 1, "t": 2, "w": 40, "nt": "gaba"}])
    assert mod == [] and fast[0]["sign"] == -1 and not fast[0]["modulatory"], fast
    fast, mod = aggregate_edges([{"s": 1, "t": 2, "w": 40, "nt": "ach"}])
    assert mod == [] and fast[0]["sign"] == 1 and not fast[0]["modulatory"], fast
    # 3) majority vote by syn count
    rows = [{"s": 1, "t": 2, "w": 30, "nt": "ach"},
            {"s": 1, "t": 2, "w": 10, "nt": "gaba"}]
    assert aggregate_edges(rows)[0][0]["nt"] == "ach"
    assert aggregate_edges(rows[::-1])[0][0]["nt"] == "ach"
    # 4) alphabetical tie-break (30 ach vs 30 gaba -> "ach" < "gaba")
    rows = [{"s": 1, "t": 2, "w": 30, "nt": "gaba"},
            {"s": 1, "t": 2, "w": 30, "nt": "ach"}]
    for perm in itertools.permutations(rows):
        assert aggregate_edges(list(perm))[0][0]["nt"] == "ach"
    # 5) order invariance on a randomized mix
    base = []
    rnd = random.Random(1234)
    for i in range(200):
        s, t = rnd.randrange(8), rnd.randrange(8)
        if s == t:
            continue
        base.append({"s": s, "t": t, "w": rnd.randrange(1, 60),
                     "nt": rnd.choice(NTS)})
    ref = aggregate_edges(base)
    for _ in range(10):
        shuffled = base[:]
        rnd.shuffle(shuffled)
        assert aggregate_edges(shuffled) == ref
    # 6) weight sums preserved across same-NT-class contributors
    rows = [{"s": 3, "t": 4, "w": 12, "nt": "ach"},
            {"s": 3, "t": 4, "w": 7, "nt": "glut"}]
    e = aggregate_edges(rows)[0][0]
    assert e["w"] == 19 and e["contributors"] == 2 and e["nt"] == "ach", e
    # 7) mixed-NT vote metadata kept when >1 NT contributed
    rows = [{"s": 5, "t": 6, "w": 3, "nt": "gaba"},
            {"s": 5, "t": 6, "w": 9, "nt": "ach"}]
    e = aggregate_edges(rows)[0][0]
    assert e["nt"] == "ach" and e["nt_votes"] == {"ach": 9, "gaba": 3}, e
    # 8) determinism: identical runs byte-identical
    j1 = json.dumps(aggregate_edges(base), sort_keys=True)
    j2 = json.dumps(aggregate_edges(base), sort_keys=True)
    assert j1 == j2
    print("self-test passed:", len(ref[0]) + len(ref[1]),
          "aggregated edges in invariance check")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-positions", action="store_true",
                        help="skip the large synapse-level position lookup")
    parser.add_argument("--self-test", action="store_true",
                        help="run P0 aggregation invariants and exit (no data files needed)")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return

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
    rows = []
    for r in edge_rows:
        s, t, w = r["pre_pt_root_id"], r["post_pt_root_id"], r["syn_count"]
        scores = {n: (r[f"{n}_avg"] or 0.0) for n in NTS}
        dom = max(scores, key=scores.get) if any(scores.values()) else "ach"
        rows.append({"s": s, "t": t, "w": int(w), "nt": dom})
    fast_edges, mod_edges = aggregate_edges(rows)   # P0: deterministic, provenance-carrying
    final_edges = fast_edges
    print("aggregated unique edges:", len(final_edges),
          f"fast + {len(mod_edges)} modulatory links")

    all_ids = sorted(layer_of)
    idx = {rid: i for i, rid in enumerate(all_ids)}
    layers = [[] for _ in LAYER_NPILS]
    for rid in all_ids:
        layers[layer_of[rid]].append(idx[rid])

    mod_n = len(mod_edges)
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
            {"s": idx[e["s"]], "t": idx[e["t"]], "w": e["w"], "sign": e["sign"],
             "nt": e["nt"], "modulatory": e["modulatory"],
             **({"nt_votes": e["nt_votes"]} if "nt_votes" in e else {})}
            for e in final_edges
        ],
        "modulatory_edges": [
            {"s": idx[e["s"]], "t": idx[e["t"]], "w": e["w"], "sign": e["sign"],
             "nt": e["nt"], "modulatory": True, "modulatorType": e["modulatorType"],
             **({"nt_votes": e["nt_votes"]} if "nt_votes" in e else {})}
            for e in mod_edges
        ],
        "provenance": {
            "dataset": "FlyWire FAFB v783 (full brain, materialization mcns_v1.0)",
            "extraction_version": EXTRACTION_VERSION,
            "extracted": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sources": [
                "proofread_connections_783.feather",
                "per_neuron_neuropil_count_pre_783.feather",
                "proofread_root_ids_783.npy",
                *([] if args.no_positions else ["synapses_connections_783.feather"]),
            ],
            "root_ids": all_ids,      # index -> FlyWire root ID (position i = index i)
            "neuron_count": len(all_ids),
            "edge_count": len(final_edges),
            "edge_rows_before_aggregation": len(rows),
            "modulatory_edge_count": mod_n,
            "modulatory_contact_note": "modulatory (da/ser/oct) contacts are separate synapses from fast contacts on the same pair; they are stored in modulatory_edges, not edges",
            "nt_vote_rule": "syn-count-weighted majority of contributing rows; ties -> alphabetically smallest NT",
            "sign_rule": "edge sign comes from the majority NT via NT_TABLE; never voted independently",
            "assumptions": {
                "glutamate": "uniformly excitatory (approximation; real-fly CNS glutamate is mixed)",
                "modulators": "da/ser/oct carry no fast synaptic weight (sign 0); oct treated as modulatory per P0 scope decision",
                "weights": "raw synapse counts, not calibrated efficacies",
                "layers": "neuron layer = dominant output neuropil (alphabetical tie-break)",
            },
        },
    }
    with open("fly_brain_circuit.json", "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    import os
    print("wrote fly_brain_circuit.json",
          f"({os.path.getsize('fly_brain_circuit.json')/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
