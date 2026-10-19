#!/usr/bin/env python3
"""
figure15_entropy_ledger.py — Figure 15: sorting-entropy reduction and the
crossing ledger (raw counts, never ratio-only).

a  Sorting-entropy reduction ΔH = H_mixed − H_sorted (bits, end-of-trial; E1
   definition, experiment_core.METRICS.sortingEntropy) by condition, test phase,
   per-seed points + mean. Conditions from E1–E8 door experiments that record
   sortEntropy.
b  Crossing ledger: good (hot→cold) and bad (cold→hot) crossing COUNTS per
   episode, same conditions, with the conditional ratio g:b (given crossings)
   printed above each bar. Counts — not ratios — are the primary display; the
   ratio is unstable when the denominator approaches zero and is shown only as
   an annotation.

Data: paper_v2/raw/E{1..8}*_rows*.jsonl (per-trial rows; seeds are replicates).
"""
import os, json, glob
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
FIGD = os.path.join(HERE, "figures")
RED = "#c0392b"; BLUE = "#2b6cb0"; AMBER = "#d9930d"; GRAY = "#7f8c9a"

COND_STYLE = {
    "classical_demon":      ("classical demon", "#37474f"),
    "ann":                  ("ANN", AMBER),
    "drosophila":           ("fly (learning)", RED),
    "drosophila_frozen":    ("fly (frozen)", "#e4908a"),
    "connectome":           ("FAFB real", BLUE),
    "shuffled_connectome":  ("FAFB shuf.", "#9bb7d4"),
    "connectome_4A":        ("FAFB real 4A", BLUE),
    "connectome_4B":        ("FAFB real 4B", "#5a89c2"),
    "connectome_4C":        ("FAFB shuf. 4C", "#9bb7d4"),
    "never_gate":           ("never-gate", GRAY),
    "random":               ("random", "#b0bec5"),
    "info_limited_1":       ("info-limited 1", "#6d4c41"),
    "info_limited_2":       ("info-limited 2", "#8d6e63"),
}

def load_rows():
    rows = []
    for p in sorted(glob.glob(os.path.join(HERE, "raw", "E*_rows*.jsonl"))):
        exp = os.path.basename(p).split("_")[0].upper()
        with open(p) as f:
            for l in f:
                r = json.loads(l)
                r["_exp"] = exp
                rows.append(r)
    return rows

def fig15():
    rows = load_rows()
    # door experiments only, with sortEntropy; test phase
    door = [r for r in rows if r["_exp"] in ("E1", "E2", "E3", "E4", "E5", "E6", "E8")
            and r.get("sortEntropy") is not None and r["phase"] == "test"]
    # keep one condition per (exp, condition) pair; label = exp-cond
    conds = []
    seen = set()
    for r in door:
        k = (r["_exp"], r["condition"])
        if k not in seen:
            seen.add(k); conds.append(k)

    fig, (axa, axb) = plt.subplots(2, 1, figsize=(7.2, 5.6),
                                   gridspec_kw={"hspace": 0.62})

    # ---------- a: sorting-entropy reduction ----------
    xs, dh_means, dh_seeds, labels, cols = [], [], [], [], []
    for i, (exp, cond) in enumerate(conds):
        rs = [r for r in door if r["_exp"] == exp and r["condition"] == cond]
        per_seed = {}
        for r in rs:
            per_seed.setdefault(r["seed"], []).append(r["sortEntropy"])
        vals = [np.mean(v) for v in per_seed.values()]
        xs.append(i); dh_means.append(np.mean(vals)); dh_seeds.append(vals)
        lbl, col = COND_STYLE.get(cond, (cond, "#666"))
        labels.append(f"{exp}\n{lbl}")
        cols.append(col)
    axa.bar(xs, dh_means, color=cols, alpha=0.75, width=0.62)
    for x, vals in zip(xs, dh_seeds):
        axa.scatter([x + 0.16] * len(vals), vals, s=10, color="k", zorder=3, alpha=0.55)
    axa.set_xticks(xs); axa.set_xticklabels(labels, fontsize=5.4)
    axa.set_ylabel("sorting-entropy reduction ΔH\n(bits, end of trial)", fontsize=7)
    axa.tick_params(labelsize=6)
    for s in ("top", "right"): axa.spines[s].set_visible(False)
    axa.set_title("a  Sorting-entropy reduction by condition (E1–E6, E8; test phase; dots = seeds)",
                  fontsize=8, loc="left")

    # ---------- b: crossing ledger (counts first, ratio annotated) ----------
    xs2, good, bad, labels2, cols2, ratios = [], [], [], [], [], []
    for i, (exp, cond) in enumerate(conds):
        rs = [r for r in door if r["_exp"] == exp and r["condition"] == cond]
        per_seed_g, per_seed_b = {}, {}
        for r in rs:
            per_seed_g.setdefault(r["seed"], []).append(r.get("goodCrossings", 0))
            per_seed_b.setdefault(r["seed"], []).append(r.get("badCrossings", 0))
        g = np.mean([np.mean(v) for v in per_seed_g.values()])
        b = np.mean([np.mean(v) for v in per_seed_b.values()])
        xs2.append(i); good.append(g); bad.append(b)
        lbl, col = COND_STYLE.get(cond, (cond, "#666"))
        labels2.append(f"{exp}\n{lbl}"); cols2.append(col)
        ratios.append(g / b if b > 0 else None)
    w = 0.38
    axb.bar([x - w / 2 for x in xs2], good, w, color="#2e7d32", label="good crossings / episode (hot→cold)")
    axb.bar([x + w / 2 for x in xs2], bad, w, color="#c62828", label="bad crossings / episode (cold→hot)")
    for x, g, b, rat in zip(xs2, good, bad, ratios):
        if rat is not None and b > 0:
            axb.text(x, max(g, b) + 0.18, f"g:b={rat:.2f}", ha="center", fontsize=4.8, color="#333")
        elif g > 0:
            axb.text(x, g + 0.18, "b=0", ha="center", fontsize=4.8, color="#777")
    axb.set_xticks(xs2); axb.set_xticklabels(labels2, fontsize=5.4)
    axb.set_ylabel("crossings per episode\ntest phase", fontsize=7)
    axb.tick_params(labelsize=6)
    axb.legend(fontsize=5.6, frameon=False, loc="upper right")
    for s in ("top", "right"): axb.spines[s].set_visible(False)
    axb.set_title("b  Crossing ledger: raw counts with conditional g:b ratio annotated",
                  fontsize=8, loc="left")

    fig.suptitle("Figure 15 — Entropy reduction and the crossing ledger across door conditions",
                 fontsize=9.5, y=0.985, color="#111")
    fig.text(0.5, 0.005,
             "ΔH = H_mixed − H_sorted over speed classes per side (E1 definition; SHANNON entropy of the sorted state — "
             "not a thermodynamic entropy). g:b ratio shown only where bad crossings > 0; counts are the primary quantity. "
             "Dots/bars: per-seed means (seeds = replicates); door contrasts have n = 2 seeds (descriptive).",
             ha="center", fontsize=5.2, color="#444")
    fig.patch.set_facecolor("white")
    for ext in ("png", "pdf"):
        fig.savefig(os.path.join(FIGD, f"figure15_entropy_ledger.{ext}"), dpi=300,
                    facecolor="white", bbox_inches="tight")
    plt.close(fig)

    prov = {"figure15_entropy_ledger": {
        "a": "sorting-entropy reduction (bits) per condition, test phase, per-seed dots",
        "b": "good/bad crossing counts per episode with conditional g:b ratio",
        "data": ["raw/E1_rows.jsonl", "raw/E2_rows.jsonl", "raw/E3_rows.jsonl",
                 "raw/E4_rows_s*.jsonl", "raw/E5_rows_s*.jsonl", "raw/E6_rows.jsonl",
                 "raw/E8_rows.jsonl"],
        "definitions": "ΔH = H_mixed − H_sorted (speed classes × sides); good = hot→cold crossing; bad = cold→hot"}}
    json.dump(prov, open(os.path.join(FIGD, "PROVENANCE_fig15.json"), "w"), indent=1)
    print("figure15 saved (with provenance)")

if __name__ == "__main__":
    fig15()
