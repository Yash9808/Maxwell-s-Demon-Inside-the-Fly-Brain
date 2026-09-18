"""Classify proofread FAFB v783 neurons by outgoing neurotransmitter scores.

The connection table stores mean NT prediction scores per presynaptic/post-
synaptic pair and postsynaptic neuropil. This script weights those scores by
synapse count, aggregates over every proofread neuron's outgoing edges, and
assigns the dominant transmitter when it clears the confidence thresholds.

Outputs:
  neuron_nt_classification.csv       one row for every proofread neuron
  neuron_nt_summary_by_neuropil.csv  cell-type counts per dominant output neuropil
  neuron_nt_report.md                dataset-level and per-neuropil summary

The labels are prediction-based classes, not experimentally verified cell types.
"""
from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc

import fafb783 as fb

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NTS = ("ach", "gaba", "glut", "oct", "ser", "da")
LABELS = {
    "ach": "cholinergic",
    "gaba": "GABAergic",
    "glut": "glutamatergic",
    "oct": "octopaminergic",
    "ser": "serotonergic",
    "da": "dopaminergic",
}
CLASS_COLUMNS = tuple(LABELS.values()) + ("mixed_uncertain", "no_outgoing")


def dominant_output_neuropil(pre: pa.Table, proofread: pa.Array) -> dict[int, str]:
    """Map every proofread neuron with pre-count data to its dominant neuropil."""
    pre = pre.filter(pc.is_in(pre["pre_pt_root_id"], value_set=proofread))
    mx = pre.group_by("pre_pt_root_id").aggregate([("count", "max")])
    top = pre.join(mx, keys="pre_pt_root_id", join_type="inner")
    top = top.filter(pc.equal(top["count"], top["count_max"]))
    top = top.group_by("pre_pt_root_id").aggregate([("neuropil", "min")])
    top = top.rename_columns(["pre_pt_root_id", "neuropil"])
    return {
        int(row["pre_pt_root_id"]): row["neuropil"]
        for row in top.to_pylist()
    }


def aggregate_outgoing_nt(conns: pa.Table) -> dict[int, dict[str, float]]:
    """Aggregate synapse-weighted NT score mass and total outgoing synapses."""
    cols: dict[str, pa.Array | pa.ChunkedArray] = {
        "pre_pt_root_id": conns["pre_pt_root_id"],
        "outgoing_synapses": conns["syn_count"],
    }
    for nt in NTS:
        # `_avg` is a per-synapse prediction for this connection row, so this
        # preserves the correct weight when aggregating rows with different sizes.
        cols[f"{nt}_mass"] = pc.multiply(conns["syn_count"], conns[f"{nt}_avg"])
    weighted = pa.table(cols)
    aggregate = weighted.group_by("pre_pt_root_id").aggregate(
        [("outgoing_synapses", "sum")]
        + [(f"{nt}_mass", "sum") for nt in NTS]
    )
    return {
        int(row["pre_pt_root_id"]): row
        for row in aggregate.to_pylist()
    }


def classify(row: dict, threshold: float, min_margin: float) -> tuple[str, dict[str, float]]:
    outgoing = int(row.get("outgoing_synapses_sum") or 0)
    if outgoing <= 0:
        return "no_outgoing", {nt: 0.0 for nt in NTS}
    scores = {
        nt: float(row.get(f"{nt}_mass_sum") or 0.0) / outgoing
        for nt in NTS
    }
    ordered = sorted(scores.values(), reverse=True)
    best = max(NTS, key=scores.get)
    if scores[best] < threshold or scores[best] - ordered[1] < min_margin:
        return "mixed_uncertain", scores
    return LABELS[best], scores


def write_neuron_csv(path: Path, rows: list[dict]) -> None:
    fields = [
        "root_id", "output_neuropil", "cell_type", "outgoing_synapses",
        "dominant_score", "second_score", "margin",
        *[f"{nt}_score" for nt in NTS],
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_neuropil_csv(path: Path, summary: dict[str, Counter], totals: Counter) -> None:
    neuropils = sorted(summary)
    fields = ["output_neuropil", "total_neurons", *CLASS_COLUMNS]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for neuropil in neuropils:
            counts = summary[neuropil]
            writer.writerow({
                "output_neuropil": neuropil,
                "total_neurons": sum(counts.values()),
                **{label: counts.get(label, 0) for label in CLASS_COLUMNS},
            })


def write_report(path: Path, rows: list[dict], summary: dict[str, Counter],
                 totals: Counter, threshold: float, min_margin: float) -> None:
    lines: list[str] = []
    add = lines.append
    total = len(rows)
    add("# FAFB v783 proofread-neuron neurotransmitter classification")
    add("")
    add(f"- Proofread neurons classified: **{total:,}**")
    add(f"- Confidence threshold: **{threshold:.2f}**")
    add(f"- Minimum dominant-vs-second margin: **{min_margin:.2f}**")
    add("")
    add("## Overall cell-type counts")
    add("")
    add("| cell type | neurons | share |")
    add("|---|---:|---:|")
    for label in CLASS_COLUMNS:
        count = totals.get(label, 0)
        add(f"| {label} | {count:,} | {100 * count / max(total, 1):.1f}% |")
    add("")
    add("## Per-neuropil summary")
    add("")
    add("The complete wide table is in `neuron_nt_summary_by_neuropil.csv`; each row uses the neuron's dominant output neuropil from the pre-count table.")
    add("")
    add("| output neuropil | total | dominant class | count |")
    add("|---|---:|---|---:|")
    for neuropil in sorted(summary):
        counts = summary[neuropil]
        label, count = max(counts.items(), key=lambda item: item[1])
        add(f"| {neuropil} | {sum(counts.values()):,} | {label} | {count:,} |")
    add("")
    add("## Method and caveats")
    add("")
    add("- Each neuron's outgoing NT score is `Σ(syn_count × edge_mean_score) / Σ(syn_count)` over proofread connection rows.")
    add("- The output neuropil is the dominant presynaptic neuropil in `per_neuron_neuropil_count_pre_783.feather`; ties are resolved alphabetically.")
    add("- `mixed_uncertain` means the top score is below the threshold or too close to the runner-up; `no_outgoing` means no proofread outgoing edge was present.")
    add("- NT scores are model predictions, not direct experimental transmitter measurements, so these are transmitter-like computational classes rather than definitive biological labels.")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--threshold", type=float, default=0.50,
                        help="minimum dominant weighted NT score (default: 0.50)")
    parser.add_argument("--min-margin", type=float, default=0.05,
                        help="minimum lead over second score (default: 0.05)")
    args = parser.parse_args()
    if not 0 <= args.threshold <= 1 or not 0 <= args.min_margin <= 1:
        parser.error("--threshold and --min-margin must be between 0 and 1")

    conns = fb.load_connections()
    pre = fb.load_pre_counts()
    proofread = pa.array(fb.load_root_ids(), type=pa.int64())
    output_np = dominant_output_neuropil(pre, proofread)
    aggregate = aggregate_outgoing_nt(conns)

    rows: list[dict] = []
    by_neuropil: dict[str, Counter] = defaultdict(Counter)
    totals: Counter = Counter()
    for root_id in proofread.to_pylist():
        root_id = int(root_id)
        agg = aggregate.get(root_id, {})
        cell_type, scores = classify(agg, args.threshold, args.min_margin)
        ordered = sorted(scores.values(), reverse=True)
        dominant_score = ordered[0] if ordered else 0.0
        second_score = ordered[1] if len(ordered) > 1 else 0.0
        neuropil = output_np.get(root_id, "UNASSIGNED")
        row = {
            "root_id": root_id,
            "output_neuropil": neuropil,
            "cell_type": cell_type,
            "outgoing_synapses": int(agg.get("outgoing_synapses_sum") or 0),
            "dominant_score": f"{dominant_score:.6f}",
            "second_score": f"{second_score:.6f}",
            "margin": f"{dominant_score - second_score:.6f}",
            **{f"{nt}_score": f"{scores[nt]:.6f}" for nt in NTS},
        }
        rows.append(row)
        by_neuropil[neuropil][cell_type] += 1
        totals[cell_type] += 1

    write_neuron_csv(Path("neuron_nt_classification.csv"), rows)
    write_neuropil_csv(Path("neuron_nt_summary_by_neuropil.csv"), by_neuropil, totals)
    write_report(Path("neuron_nt_report.md"), rows, by_neuropil, totals,
                 args.threshold, args.min_margin)
    print(f"classified {len(rows):,} proofread neurons")
    print("overall:", ", ".join(f"{k}={totals[k]:,}" for k in CLASS_COLUMNS))
    print("wrote neuron_nt_classification.csv")
    print("wrote neuron_nt_summary_by_neuropil.csv")
    print("wrote neuron_nt_report.md")


if __name__ == "__main__":
    main()
