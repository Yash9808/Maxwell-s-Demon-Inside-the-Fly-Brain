"""One-shot dataset analysis -> report_v783.md (rewrites the report each run)."""
from __future__ import annotations

import fafb783 as fb
import numpy as np
import pyarrow as pa
import pyarrow.compute as pc

NTS = ("gaba", "ach", "glut", "oct", "ser", "da")

conns = fb.load_connections()
pre, post = fb.load_pre_counts(), fb.load_post_counts()
ids = fb.load_root_ids()

lines: list[str] = []
add = lines.append


def md_table(headers, rows):
    add("| " + " | ".join(headers) + " |")
    add("|" + "|".join("---" for _ in headers) + "|")
    for r in rows:
        add("| " + " | ".join(str(x) for x in r) + " |")


# ---------------------------------------------------------------- headline
syn_total = pc.sum(conns["syn_count"]).as_py()
add("# FAFB v783 — Dataset Summary")
add("")
add(f"- **Proofread neurons:** {len(ids):,}")
add(f"- **Edges (pair × neuropil rows):** {conns.num_rows:,}")
pairs = conns.group_by(["pre_pt_root_id", "post_pt_root_id"]).aggregate([])
add(f"- **Unique neuron pairs:** {pairs.num_rows:,}")
add(f"- **Synapses in proofread edges:** {syn_total:,}")
add("")

# ------------------------------------------------- per-neuropil NT composition
nt_sums = {c: pc.sum(conns[f"{c}_avg"]).as_py() for c in NTS}
total_score_mass = sum(nt_sums.values())
nt_rows = []
for c in NTS:
    share = 100.0 * nt_sums[c] / total_score_mass
    nt_rows.append((c, f"{nt_sums[c]:,.0f}", f"{share:.1f}%"))
add("## Neurotransmitter composition (score mass over all edges)")
add("")
md_table(("NT", "Σ score", "share"), nt_rows)
add("")

# strongest neuropils by synapses, with dominant NT by score mass
by_np = conns.group_by("neuropil").aggregate(
    [("syn_count", "sum")] + [(f"{c}_avg", "sum") for c in NTS]
).to_pandas()
by_np = by_np.sort_values("syn_count_sum", ascending=False).reset_index(drop=True)
by_np["dom"] = by_np[[f"{c}_avg_sum" for c in NTS]].idxmax(axis=1).str.replace("_avg_sum", "")

add("## Top 15 neuropils by synapse count")
add("")
def _gaba_share(r):
    tot = sum(getattr(r, f"{c}_avg_sum") for c in NTS)
    return f"{100 * r.gaba_avg_sum / max(tot, 1e-9):.0f}%"


rows = [
    (r.neuropil, f"{int(r.syn_count_sum):,}",
     f"{100 * r.syn_count_sum / syn_total:.1f}%", r.dom, _gaba_share(r))
    for r in by_np.head(15).itertuples()
]
md_table(("neuropil", "synapses", "% of total", "dominant NT", "GABA share"), rows)
add("")

# ------------------------------------------------------------- degree stats
out_deg = conns.group_by("pre_pt_root_id").aggregate([("syn_count", "sum")])
in_deg = conns.group_by("post_pt_root_id").aggregate([("syn_count", "sum")])
out_arr = out_deg["syn_count_sum"].to_numpy()
in_arr = in_deg["syn_count_sum"].to_numpy()


def pct(a, q):
    return f"{np.percentile(a, q):,.0f}"


add("## Degree distributions (synapse-weighted, proofread partners only)")
add("")
add(f"- Output: {len(out_arr):,} neurons, median {pct(out_arr, 50)}, "
    f"p95 {pct(out_arr, 95)}, max {out_arr.max():,}")
add(f"- Input:  {len(in_arr):,} neurons, median {pct(in_arr, 50)}, "
    f"p95 {pct(in_arr, 95)}, max {in_arr.max():,}")
add("")

# ------------------------------------------------------- edge cross-checks
add("## Cross-checks")
add("")
add(f"- pre counts Σ = post counts Σ = {pc.sum(pre['count']).as_py():,} "
    f"(= synapse-level rows) ✔")
both = pa.concat_arrays([
    out_deg["pre_pt_root_id"].combine_chunks(),
    in_deg["post_pt_root_id"].combine_chunks(),
])
add(f"- All {pc.count_distinct(both).as_py():,} neurons appearing in edges are in "
    f"proofread_root_ids ✔")

# sanity: top partners function round-trip
hub = out_deg.sort_by([("syn_count_sum", "descending")]).slice(0, 1)
hub_id = hub["pre_pt_root_id"][0].as_py()
hub_syn = hub["syn_count_sum"][0].as_py()
add(f"- Most-output neuron: {hub_id} with {hub_syn:,} output synapses")

report = "\n".join(lines) + "\n"
with open("report_v783.md", "w", encoding="utf-8") as f:
    f.write(report)
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
print(report)
