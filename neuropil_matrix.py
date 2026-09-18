"""Neuropil-by-neuropil connectivity matrix for FAFB v783.

Builds an N x N matrix of synapse counts summed over neuron pairs:
  rows    = presynaptic neuropil  (each pre neuron assigned its dominant
            output neuropil from per_neuron_neuropil_count_pre_783;
            ties broken alphabetically -- the standard FlyViz approach)
  columns = postsynaptic neuropil (the connections table's `neuropil`
            column, i.e. where the postsynaptic sites sit)

Outputs (next to the data files):
    neuropil_matrix.csv            full N x N synapse-count matrix
    neuropil_matrix.png            full matrix heatmap (log color scale)
    neuropil_matrix_top30.png      top-30 neuropils, annotated with counts
    neuropil_matrix_report.md      ordering, ipsi/contra split, symmetry notes

Row/column order: major neuropils first in FlyViz community order (Xu et al.
2020), L/R pairs adjacent (L before R); remaining neuropils follow, also
paired. Unpaired neuropils (FB, PB, EB, NO, ...) sit at the end.

Run:  python neuropil_matrix.py
"""
from __future__ import annotations

import csv
import sys
from collections import defaultdict

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pyarrow.compute as pc  # noqa: E402

import fafb783 as fb  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Major neuropils in FlyViz community order (Xu et al. 2020, Fig. 2).
FLYVIZ = ["AL", "MB_CA", "MB_PED", "MB_VL", "MB_ML", "LH", "SMP", "SIP", "SLP",
          "AVLP", "PVLP", "IVLP", "PLP", "WED", "GOR", "AMMC", "VES", "SPS",
          "IPS", "SCL", "EPA", "CAN", "IB", "ATL", "GA", "CRE", "BU", "LAL",
          "FLA", "ROB", "RUB", "AOTU", "LA", "ME", "LO", "LOP", "AME",
          "FB", "PB", "EB", "NO"]


def pair_order(names: list[str]) -> list[str]:
    """Order neuropil names so each X_L, X_R pair is adjacent (L before R)."""
    unpaired, paired = [], defaultdict(dict)
    for n in names:
        if n.endswith("_L") or n.endswith("_R"):
            paired[n[:-2]][n[-1]] = n
        else:
            unpaired.append(n)
    ordered = []
    for k in sorted(paired, key=lambda s: (FLYVIZ.index(s) if s in FLYVIZ else 999, s)):
        ordered += [paired[k][s] for s in ("L", "R") if s in paired[k]]
    return ordered + sorted(unpaired)


def build_pre_neuropil_map(pre):
    """Map each presynaptic neuron to its dominant output neuropil.

    Exact per-synapse pre-neuropil is not in the data; the dominant-output
    assignment reproduces the standard FlyViz neuropil-matrix approach.
    """
    mx = pre.group_by("pre_pt_root_id").aggregate([("count", "max")])
    top = pre.join(mx, keys="pre_pt_root_id", join_type="inner")
    top = top.filter(pc.equal(top["count"], top["count_max"]))
    m = top.group_by("pre_pt_root_id").aggregate([("neuropil", "min")])
    return m.rename_columns(["pre_pt_root_id", "pre_neuropil"])


def render(matrix: np.ndarray, labels: list[str], path: str,
           title: str, annotate: bool = False) -> None:
    """Log-scale heatmap with L/R block separators."""
    fig_w = max(10, 0.32 * len(labels))
    fig, ax = plt.subplots(figsize=(fig_w, fig_w * 0.95))
    disp = np.log10(matrix + 1)
    im = ax.imshow(disp, cmap="magma", interpolation="nearest")

    nz = matrix[matrix > 0]
    cb = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.03)
    cb.set_label("log10(synapses + 1)")

    if annotate:
        thr = np.percentile(nz, 75)
        for i in range(len(labels)):
            for j in range(len(labels)):
                v = matrix[i, j]
                if v > thr:
                    ax.text(j, i, f"{v:.0f}" if v < 10_000 else f"{v/1e3:.0f}k",
                            ha="center", va="center", fontsize=5.5,
                            color="white" if disp[i, j] < disp.max() * 0.6 else "black")

    # separator line after each complete L/R pair (and around unpaired labels)
    seps = [k for k in range(1, len(labels))
            if not (labels[k - 1].endswith("_L")
                    and labels[k] == labels[k - 1][:-2] + "_R")]
    for s in seps:
        if 0 < s < len(labels):
            ax.axhline(s - 0.5, color="cyan", lw=0.6, alpha=0.7)
            ax.axvline(s - 0.5, color="cyan", lw=0.6, alpha=0.7)

    ax.set_xticks(range(len(labels)), labels, rotation=90, fontsize=6)
    ax.set_yticks(range(len(labels)), labels, fontsize=6)
    ax.set_xlabel("postsynaptic neuropil")
    ax.set_ylabel("presynaptic neuropil")
    ax.set_title(title, fontsize=10)
    fig.tight_layout()
    fig.savefig(path, dpi=200)
    plt.close(fig)
    print("wrote", path)


def main() -> None:
    conns = fb.load_connections()
    pre = fb.load_pre_counts()

    print("assigning pre neurons to dominant output neuropil ...")
    pre_map = build_pre_neuropil_map(pre)

    print("joining edges ...")
    edges = conns.join(pre_map, keys="pre_pt_root_id", join_type="left outer")
    null_mask = pc.is_null(edges["pre_neuropil"])
    n_unmatched = pc.sum(null_mask).as_py() or 0
    syn_unmatched = pc.sum(
        pc.filter(edges["syn_count"], null_mask)
    ).as_py() or 0
    print(f"  edges from neurons without pre-count rows: {n_unmatched:,} "
          f"({syn_unmatched:,} synapses) -> 'UNASSIGNED' row")

    edges = edges.set_column(
        edges.schema.get_field_index("pre_neuropil"), "pre_neuropil",
        pc.fill_null(edges["pre_neuropil"], "UNASSIGNED"),
    )

    print("aggregating ...")
    mat_tbl = edges.group_by(["pre_neuropil", "neuropil"]).aggregate(
        [("syn_count", "sum"), ("syn_count", "count")]
    )
    all_np = sorted(set(mat_tbl["pre_neuropil"].to_pylist())
                    | set(mat_tbl["neuropil"].to_pylist()))
    labels = pair_order(all_np)
    if "UNASSIGNED" in labels:
        labels.remove("UNASSIGNED")
        labels.append("UNASSIGNED")
    ix = {n: i for i, n in enumerate(labels)}
    n = len(labels)

    matrix = np.zeros((n, n), dtype=np.int64)
    counts = np.zeros((n, n), dtype=np.int64)  # contributing edge rows
    for r in mat_tbl.to_pylist():
        i, j = ix[r["pre_neuropil"]], ix[r["neuropil"]]
        matrix[i, j] = r["syn_count_sum"]
        counts[i, j] = r["syn_count_count"]

    # ------------------------------------------------------------ outputs
    with open("neuropil_matrix.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["pre\\post"] + labels)
        for i, lab in enumerate(labels):
            w.writerow([lab] + matrix[i].tolist())
    print("wrote neuropil_matrix.csv")

    render(matrix, labels, "neuropil_matrix.png",
           f"FAFB v783 neuropil connectome ({n - ('UNASSIGNED' in labels)} neuropils, "
           f"synapse counts, log scale)")

    special = {"UNASSIGNED", "UNASGD", "None"}
    top = [l for l in labels if l not in special]
    # rank rows+cols by total synapse involvement, take top 30
    involvement = matrix.sum(axis=0) + matrix.sum(axis=1)
    top30 = sorted(top, key=lambda l: -involvement[ix[l]])[:30]
    keep = pair_order(top30)
    idx = [ix[l] for l in keep]
    render(matrix[np.ix_(idx, idx)], keep, "neuropil_matrix_top30.png",
           "Top 30 neuropils by total synapse involvement (annotated)",
           annotate=True)

    # ------------------------------------------------------------ report
    tot = matrix.sum()
    main_mask = np.array([l != "UNASSIGNED" for l in labels])
    diag = sum(matrix[i, i] for i in range(n) if labels[i] != "UNASSIGNED")
    ipsi = contra = 0
    for i, a in enumerate(labels):
        for j, b in enumerate(labels):
            if a == "UNASSIGNED" or b == "UNASSIGNED" or a == b:
                continue
            if a.endswith("_L") and b.endswith("_R"):
                contra += matrix[i, j]
            elif a.endswith("_R") and b.endswith("_L"):
                contra += matrix[i, j]
            else:
                ipsi += matrix[i, j]
    u_row = matrix[ix["UNASSIGNED"]].sum() if "UNASSIGNED" in ix else 0

    mirror_diffs = []
    paired = [l for l in labels if l.endswith("_L") and l[:-2] + "_R" in ix]
    for l in paired:
        iL, iR = ix[l], ix[l[:-2] + "_R"]
        a = matrix[iL][[ix[k] for k in labels if k.endswith("_L")]]
        b = matrix[iR][[ix[k] for k in labels if k.endswith("_R")]]
        da = np.abs(a - b).sum()
        mirror_diffs.append((da / max(a.sum() + b.sum(), 1), l))
    mirror_diffs.sort(reverse=True)
    sym = 1 - sum(d for d, _ in mirror_diffs) / max(len(mirror_diffs), 1)

    lines = []
    A = lines.append
    A("# Neuropil x neuropil matrix — findings")
    A("")
    A(f"Total synapses in matrix: **{tot:,}** "
      f"(of {pc.sum(conns['syn_count']).as_py():,} in the connections table; "
      f"{u_row:,} had unassignable pre-neuropil).")
    A("")
    A("## Method")
    A("- rows: presynaptic neuron -> dominant output neuropil "
      "(per_neuron_neuropil_count_pre_783, ties alphabetical)")
    A("- columns: postsynaptic neuropil (connections `neuropil` column)")
    A("- L/R pairs adjacent (L first), major neuropils in FlyViz order; "
      "cyan lines mark pair boundaries")
    A("")
    A("## Headline numbers")
    A("")
    A(f"- within-neuropil (diagonal) synapses: {diag:,} "
      f"({100 * diag / tot:.1f}% of total)")
    A(f"- ipsilateral (L->L, R->R): {ipsi:,} ({100 * ipsi / tot:.1f}%)")
    A(f"- contralateral (L->R, R->L): {contra:,} ({100 * contra / tot:.1f}%)")
    A(f"- mean mirror asymmetry across {len(mirror_diffs)} paired neuropils: "
      f"{100 * (1 - sym):.1f}% (1 - symmetric share, summed over L-column halves)")
    A("")
    unasgd_col = int(matrix[:, ix["UNASGD"]].sum()) if "UNASGD" in ix else 0
    A(f"- `UNASGD` (postsynaptic sites outside named neuropils) column total: "
      f"{unasgd_col:,} synapses ({100 * unasgd_col / tot:.1f}%)")
    A("- `None` is a literal string label in the pre-counts table (29 output "
      "synapses) — data quirk, kept for completeness")
    A("")
    A("## Top 10 inter-neuropil flows (off-diagonal)")
    A("")
    A("| pre -> post | synapses |")
    A("|---|---|")
    flows = [(labels[i], labels[j], matrix[i, j])
             for i in range(n) for j in range(n)
             if i != j and labels[i] != "UNASSIGNED" and labels[j] != "UNASSIGNED"]
    for a, b, v in sorted(flows, key=lambda t: -t[2])[:10]:
        A(f"| {a} -> {b} | {v:,} |")
    A("")
    A("## Most mirror-asymmetric pairs (|L - R| / total, row halves)")
    A("")
    A("| pair | asymmetry |")
    A("|---|---|")
    for d, l in mirror_diffs[:8]:
        A(f"| {l[:-2]} | {100 * d:.1f}% |")
    A("")
    A("Files: `neuropil_matrix.csv`, `neuropil_matrix.png`, "
      "`neuropil_matrix_top30.png`.")
    with open("neuropil_matrix_report.md", "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("wrote neuropil_matrix_report.md")

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
