"""Render the publication figure pack from research_data/summary_*.json.

Run:
    node benchmark.js --seeds 10        (or --quick for a smoke test)
    python analysis/plot_research_figures.py

Produces research_figures/fig1..fig8 as PNG (300 dpi) + PDF. Panels follow the
research plan: learning curves, behavioural accuracy, controller comparison,
demon-vs-fly decisions, neural tuning, entropy, mutual information, and the
information-vs-energy (neuroenergetic) plot.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
NAVY = "#17263d"
TEAL = "#008f78"
PINK = "#d83b67"
MUTED = "#667085"
GRID = "#d9dee8"
COLORS = {
    "classical_demon": "#111827",
    "random": "#9ca3af",
    "ann": "#7c3aed",
    "drosophila": "#ea580c",
    "connectome": "#0e7490",
    "shuffled_connectome": PINK,
}
LABELS = {
    "classical_demon": "Classical demon (reference)",
    "random": "Random",
    "ann": "ANN learner",
    "drosophila": "Drosophila-inspired",
    "connectome": "Connectome fly (FAFB v783)",
    "shuffled_connectome": "Shuffled connectome",
}


def latest_summary() -> Path:
    files = sorted((ROOT / "research_data").glob("summary_*.json"))
    if not files:
        raise SystemExit("no research_data/summary_*.json found; run node benchmark.js first")
    return files[-1]


def blocks_axis(cond: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (block index, phase flag, value) using every seed's blocks."""
    xs, ys, ph = [], [], []
    for run in cond.get("_raw", []):
        trials = run["trials"]
        n = len(trials)
        for b in range(n // 10):
            seg = trials[b * 10:(b + 1) * 10]
            vals = [t.get("demonAgree") or 0 for t in seg]
            xs.append(b)
            ph.append(0 if seg[0]["phase"] == "train" else 1)
            ys.append(float(np.mean(vals)))
    return np.array(xs), np.array(ph), np.array(ys)


def style_ax(ax):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color=GRID, linewidth=0.7)


def save(fig, stem: Path):
    fig.savefig(stem.with_suffix(".png"), dpi=300, bbox_inches="tight")
    fig.savefig(stem.with_suffix(".pdf"), bbox_inches="tight")
    plt.close(fig)
    print("wrote", stem.with_suffix(".png"))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", type=Path, default=None)
    ap.add_argument("--outdir", type=Path, default=ROOT / "research_figures")
    args = ap.parse_args()
    src = args.input or latest_summary()
    data = json.loads(src.read_text(encoding="utf-8"))
    conds = data["conditions"]
    args.outdir.mkdir(parents=True, exist_ok=True)

    plt.rcParams.update({
        "font.family": "DejaVu Sans", "font.size": 9,
        "axes.titlesize": 11, "axes.labelsize": 9,
        "axes.edgecolor": "#98a2b3", "axes.linewidth": 0.8,
        "xtick.color": MUTED, "ytick.color": MUTED,
        "savefig.facecolor": "white",
    })

    order = [k for k in ["classical_demon", "random", "ann", "drosophila",
                         "connectome", "shuffled_connectome"] if k in conds]

    # ---------------------------------------------------------- Fig 1: DSI
    fig, ax = plt.subplots(figsize=(6.4, 3.6))
    for key in order:
        if "_raw" not in conds[key]:
            continue
        xs, ph, ys = blocks_axis(conds[key])
        if not len(xs):
            continue
        # mean per block index across seeds
        blocks = sorted(set(xs))
        mu = [ys[xs == b].mean() for b in blocks]
        ax.plot(blocks, mu, color=COLORS.get(key, MUTED), linewidth=1.8,
                label=LABELS.get(key, key))
    ax.axvline(conds[order[0]].get("_trainLen", 0), color="#98a2b3",
               linestyle="--", linewidth=1)
    ax.set_xlabel("training block (10 trials each)")
    ax.set_ylabel("Demon agreement")
    ax.set_title("Figure 1 — Learning curves: demon agreement", loc="left",
                 fontweight="bold", color=NAVY)
    ax.legend(frameon=False, fontsize=8)
    style_ax(ax)
    save(fig, args.outdir / "fig1_learning_curves")

    # ------------------------------------------------- Fig 2: accuracy bars
    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    names, mus, cis = [], [], []
    for key in order:
        t = conds[key].get("testAgreement", {"mean": 0, "ci": 0})
        names.append(LABELS.get(key, key))
        mus.append(t["mean"]); cis.append(t["ci"])
    ypos = np.arange(len(names))[::-1]
    ax.barh(ypos, mus, xerr=cis, color=[COLORS.get(k, MUTED) for k in order],
            height=0.62, error_kw={"linewidth": 1, "capsize": 3})
    ax.set_yticks(ypos, names, fontsize=8)
    ax.set_xlabel("demon agreement (test trials)")
    ax.set_xlim(0, 1.05)
    ax.set_title("Figure 2 — Behavioural accuracy by controller", loc="left",
                 fontweight="bold", color=NAVY)
    style_ax(ax)
    save(fig, args.outdir / "fig2_accuracy")

    # --------------------------------- Fig 3: 6-panel controller comparison
    fig, axes = plt.subplots(2, 3, figsize=(11.5, 5.6), constrained_layout=True)
    fig.suptitle("Figure 3 — Controller comparison (test phase, mean ± 95% CI)",
                 fontsize=13, fontweight="bold", color=NAVY)
    panels = [
        ("testAgreement", "Demon agreement", (0, 1)),
        ("testGoodBadRatio", "Good:bad crossing ratio", None),
        ("testSortEntropy", "Sorting entropy (bits)", None),
        ("testDT", "ΔT (hot − cold)", None),
        ("testMiNeural", "Mutual information (bits)", None),
        ("testEnergyJ", "Kinetic energy transferred (J·10⁻²¹)", None),
    ]
    for ax, (field, label, ylim) in zip(axes.flat, panels):
        mus, cis = [], []
        for key in order:
            t = conds[key].get(field, {"mean": 0, "ci": 0}) or {"mean": 0, "ci": 0}
            mus.append(t["mean"]); cis.append(t["ci"])
        ypos = np.arange(len(order))
        ax.bar(ypos, mus, yerr=cis, color=[COLORS.get(k, MUTED) for k in order],
               width=0.66, error_kw={"linewidth": 1, "capsize": 3})
        ax.set_xticks(ypos, [k.replace("_", "\n") for k in order], fontsize=6.5)
        ax.set_title(label, fontsize=9)
        if ylim:
            ax.set_ylim(*ylim)
        style_ax(ax)
    save(fig, args.outdir / "fig3_controller_comparison")

    # ------------------------------- Fig 4: demon decision vs fly decision
    fig, ax = plt.subplots(figsize=(4.6, 4.4))
    for key in [k for k in order if k not in ("classical_demon", "random")]:
        pts_x, pts_y = [], []
        for run in conds[key].get("_raw", []):
            for t in run["trials"]:
                if t["phase"] != "test":
                    continue
                d = t.get("demonOpenFraction", t.get("openFraction", 0))
                f = t.get("openFraction", 0)
                pts_x.append(d); pts_y.append(f)
        if pts_x:
            ax.scatter(pts_x, pts_y, s=9, alpha=0.45,
                       color=COLORS.get(key, MUTED), label=LABELS.get(key, key))
    ax.plot([0, 1], [0, 1], color="#98a2b3", linewidth=1, linestyle="--")
    ax.set_xlabel("demon door-open fraction")
    ax.set_ylabel("controller door-open fraction")
    ax.set_title("Figure 4 — Demon vs controller decisions", loc="left",
                 fontweight="bold", color=NAVY)
    ax.legend(frameon=False, fontsize=7)
    style_ax(ax)
    save(fig, args.outdir / "fig4_decision_scatter")

    # ---------------------- Fig 5: neural activity vs particle velocity MI
    fig, ax = plt.subplots(figsize=(6.0, 3.5))
    for key in order:
        xs, ph, ys = [], [], []
        for run in conds[key].get("_raw", []):
            for i, t in enumerate(run["trials"]):
                xs.append(i); ph.append(0 if t["phase"] == "train" else 1)
                ys.append(t.get("miNeural", 0) or 0)
        if xs:
            ax.plot(xs, ys, color=COLORS.get(key, MUTED), linewidth=1.2,
                    alpha=0.85, label=LABELS.get(key, key))
    ax.set_xlabel("trial")
    ax.set_ylabel("I(neural activity; particle speed) — bits")
    ax.set_title("Figure 5 — Information carried by neural state", loc="left",
                 fontweight="bold", color=NAVY)
    ax.legend(frameon=False, fontsize=7)
    style_ax(ax)
    save(fig, args.outdir / "fig5_neural_information")

    # --------------------------------------------------- Fig 6: entropy
    fig, ax = plt.subplots(figsize=(6.0, 3.5))
    for key in order:
        xs, ys = [], []
        for run in conds[key].get("_raw", []):
            for i, t in enumerate(run["trials"]):
                xs.append(i); ys.append(t.get("sortEntropy", 0) or 0)
        if xs:
            ax.plot(xs, ys, color=COLORS.get(key, MUTED), linewidth=1.2,
                    alpha=0.85, label=LABELS.get(key, key))
    ax.set_xlabel("trial")
    ax.set_ylabel("sorting entropy recovered (bits)")
    ax.set_title("Figure 6 — Entropy production alongside the demon", loc="left",
                 fontweight="bold", color=NAVY)
    ax.legend(frameon=False, fontsize=7)
    style_ax(ax)
    save(fig, args.outdir / "fig6_entropy")

    # ------------------------------------------- Fig 7: MI learning curve
    fig, ax = plt.subplots(figsize=(6.0, 3.5))
    for key in order:
        xs, ph, ys = blocks_axis(conds[key]) if "_raw" in conds[key] else ([], [], [])
        if len(xs):
            blocks = sorted(set(xs))
            mu = [ys[xs == b].mean() for b in blocks]
            ax.plot(blocks, mu, color=COLORS.get(key, MUTED), linewidth=1.8,
                    label=LABELS.get(key, key))
    ax.set_xlabel("training block")
    ax.set_ylabel("MI(activity; speed), bits")
    ax.set_title("Figure 7 — Mutual information across training", loc="left",
                 fontweight="bold", color=NAVY)
    ax.legend(frameon=False, fontsize=7)
    style_ax(ax)
    save(fig, args.outdir / "fig7_mutual_information")

    # --------------------------------- Fig 8: information vs energy cost
    fig, ax = plt.subplots(figsize=(5.6, 4.2))
    for key in order:
        t = conds[key]
        x = (t.get("testEnergyJ") or {"mean": 0})["mean"] * 1e21
        y = (t.get("testMiNeural") or {"mean": 0})["mean"]
        e = (t.get("testEnergyJ") or {"ci": 0})["ci"] * 1e21
        ax.errorbar([x], [y], xerr=[e] if e else None, fmt="o", markersize=8,
                    color=COLORS.get(key, MUTED), label=LABELS.get(key, key),
                    capsize=3)
    ax.set_xlabel("kinetic energy transferred at the gate (J·10⁻²¹)")
    ax.set_ylabel("mutual information (bits)")
    ax.set_title("Figure 8 — Information versus energetic cost", loc="left",
                 fontweight="bold", color=NAVY)
    ax.legend(frameon=False, fontsize=7)
    style_ax(ax)
    save(fig, args.outdir / "fig8_info_vs_energy")

    # ------------------------------------------------- headline table txt
    lines = ["Condition".ljust(24), "agree".rjust(12), "good:bad".rjust(12),
             "entropy".rjust(12), "MI".rjust(12), "energy(J·10⁻²¹)".rjust(16)]
    txt = ["\t".join(lines), "-" * 90]
    for key in order:
        c = conds[key]
        g = lambda f, d=0: (c.get(f) or {"mean": d})["mean"]
        # MI: mark 'n/a' when a controller has no MI instrumentation rather
        # than reporting 0.0000 (which looks like a measured zero).
        mi_mean = g('testMiNeural')
        mi_cell = f"{mi_mean:.4f}".rjust(12) if mi_mean > 0 else "n/a".rjust(12)
        txt.append("\t".join([
            key.ljust(24),
            f"{g('testAgreement'):.3f}±{(c.get('testAgreement') or {'ci':0})['ci']:.3f}".rjust(12),
            f"{g('testGoodBadRatio'):.2f}".rjust(12),
            f"{g('testSortEntropy'):.4f}".rjust(12),
            mi_cell,
            f"{g('testEnergyJ'):.4f}".rjust(16),   # already in J·10⁻²¹ units
        ]))
    (args.outdir / "results_table.txt").write_text("\n".join(txt) + "\n", encoding="utf-8")
    print("wrote", args.outdir / "results_table.txt")

    # ------------------------------------------ thermodynamic budget table
    LANDAUER_BIT_J = 2.871e-21   # k_B * 300 K * ln2
    lines = ["Condition".ljust(24), "work_in(J)".rjust(13), "extractable(J)".rjust(15),
             "efficiency".rjust(11), "landauer(J)".rjust(13),
             "ext/cost".rjust(10), "bits_need".rjust(11), "bits_used".rjust(10)]
    txt = ["\t".join(lines), "-" * 110]
    for key in order:
        c = conds[key]
        g = lambda f: (c.get(f) or {"mean": float("nan")})["mean"]
        w, x, l, b = g("testWorkInJ"), g("testExtractableJ"), g("testErasureCostJ"), g("testMeasuredBits")
        eff = x / w if w and w > 0 and x == x else float("nan")
        bits_need = x / LANDAUER_BIT_J if x == x else float("nan")
        fJ = lambda v: f"{v:.2e}" if v == v else "n/a"
        txt.append("\t".join([
            key.ljust(24), fJ(w).rjust(13), fJ(x).rjust(15),
            (f"{eff:.1e}" if eff == eff else "n/a").rjust(11),
            fJ(l).rjust(13),
            (f"{x / l:.1e}" if (l and l > 0 and x == x) else "n/a").rjust(10),
            (f"{bits_need:.0f}" if bits_need == bits_need else "n/a").rjust(11),
            (f"{b:.0f}" if b == b else "n/a").rjust(10),
        ]))
    txt.append("")
    txt.append("efficiency = extractable/work_in (the jet pays the entropy bill; second law holds if << 1)")
    txt.append("bits_need = extractable work priced in Landauer bits @300K; bits_used = metered memory traffic")
    txt.append("bits_used << bits_need -> the demon's sorting is jet-subsidized, its erasure bill negligible")
    (args.outdir / "thermo_budget.txt").write_text("\n".join(txt) + "\n", encoding="utf-8")
    print("wrote", args.outdir / "thermo_budget.txt")


if __name__ == "__main__":
    main()
