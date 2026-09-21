#!/usr/bin/env python3
"""validation_plots.py — Agent 3 publication-style plots for the validation
campaign. Reads research_data/validation/raw_{exp}.csv and the analysis CSVs;
writes PNG plots into research_data/validation/plots/. matplotlib only (Agg).
"""
import os
import sys
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "research_data", "validation")
OUT = os.path.join(BASE, "plots")
os.makedirs(OUT, exist_ok=True)

plt.rcParams.update({
    "figure.dpi": 150, "savefig.dpi": 200, "font.size": 9,
    "axes.grid": True, "grid.alpha": 0.3, "axes.spines.top": False,
    "axes.spines.right": False, "figure.autolayout": True,
})
C = {"drosophila": "#4C72B0", "drosophila_frozen": "#8FB3E0", "random": "#C44E52",
     "classical_demon": "#DD8452", "connectome_4A": "#4C72B0", "connectome_4B": "#64B5CD",
     "connectome_frozen": "#8FB3E0", "connectome_4C": "#C44E52",
     "demon_neural": "#4C72B0", "demon_frozen": "#8FB3E0", "demon_speed": "#DD8452",
     "demon_random": "#55A868", "never_open": "#999999",
     "trapdoor_neural": "#4C72B0", "trapdoor_frozen": "#8FB3E0",
     "trapdoor_light": "#DD8452", "trapdoor_heavy": "#937860",
     "ratchet_neural": "#4C72B0", "ratchet_frozen": "#8FB3E0",
     "ratchet_gradient": "#DD8452", "ratchet_equilibrium": "#999999",
     "ratchet_heavy_load": "#937860"}

BLOCK = 5   # episodes per block (per seed) before cross-seed aggregation


def block_curves(df, metric, block=BLOCK):
    """Per-seed block means -> cross-seed mean + 95% t CI per block index.
    The SEED is the unit of inference; blocks only reduce within-seed noise."""
    out = []
    for (cond, phase), g in df.groupby(["condition", "phase"]):
        g = g.copy()
        g["block"] = g["trial"] // block
        per_seed = g.groupby(["seed", "block"])[metric].mean().reset_index()
        agg = per_seed.groupby("block")[metric].agg(["mean", "std", "count"]).reset_index()
        n = agg["count"].to_numpy()
        tcrit = np.vectorize(lambda k: 1.96 if k <= 2 else
                             float(pd.Series([2.571 if k <= 5 else 2.262 if k <= 9 else
                                              2.093 if k <= 19 else 2.045 if k <= 29 else 1.96])
                                   .iloc[0]))(n)
        se = (agg["std"].fillna(0) / np.sqrt(n)).to_numpy()
        for _, row in agg.iterrows():
            out.append(dict(condition=cond, phase=phase, block=int(row["block"]),
                            mean=row["mean"],
                            lo=row["mean"] - tcrit * se, hi=row["mean"] + tcrit * se))
    return pd.DataFrame(out)


def plot_metric(df, metric, title, fname, ylabel, phase_split=True):
    curves = block_curves(df, metric)
    if curves.empty:
        print("  (no data for", metric, ")")
        return
    fig, ax = plt.subplots(figsize=(7, 4))
    conds = sorted(curves["condition"].unique())
    offset = 0
    for cond in conds:
        for phase in ["train", "test"]:
            c = curves[(curves.condition == cond) & (curves.phase == phase)].sort_values("block")
            if c.empty or len(c) == 0:
                continue
            x = c["block"].to_numpy().astype(float) + offset
            y = pd.to_numeric(c["mean"], errors="coerce").to_numpy(dtype=float)
            lo = pd.to_numeric(c["lo"], errors="coerce").to_numpy(dtype=float)
            hi = pd.to_numeric(c["hi"], errors="coerce").to_numpy(dtype=float)
            ok = np.isfinite(y) & np.isfinite(lo) & np.isfinite(hi)
            x, y, lo, hi = x[ok], y[ok], lo[ok], hi[ok]
            color = C.get(cond, "gray")
            ls = "-" if phase == "train" else "--"
            ax.plot(x, y, ls, color=color, lw=1.6,
                    label=f"{cond} ({phase})" if phase == "train" else None)
            ax.fill_between(x, lo, hi, color=color, alpha=0.18)
        if phase_split:
            offset += curves[curves.condition == cond]["block"].max() + 2
    ax.set_xlabel("episode block (train — solid | test — dashed)")
    ax.set_ylabel(ylabel)
    ax.set_title(title)
    ax.legend(fontsize=7, ncol=2)
    fig.savefig(os.path.join(OUT, fname))
    plt.close(fig)
    print("  wrote", fname)


def plot_primary_contrast(exp, neural, frozen, metric, title, fname):
    df = pd.read_csv(os.path.join(BASE, f"raw_{exp}.csv"))
    if metric not in df.columns:
        df[metric] = df["crossLR"] - df["crossRL"]
    df = df[df.phase == "test"]
    per_seed = df.groupby(["condition", "seed"])[metric].mean().reset_index()
    a = per_seed[per_seed.condition == neural].set_index("seed")[metric]
    b = per_seed[per_seed.condition == frozen].set_index("seed")[metric]
    common = a.index.intersection(b.index)
    if len(common) == 0:
        print("  (no paired seeds for", exp, ")")
        return
    d = (a[common] - b[common]).to_numpy()
    fig, axes = plt.subplots(1, 2, figsize=(8, 3.4))
    axes[0].boxplot([a[common].to_numpy(), b[common].to_numpy()], tick_labels=[neural, frozen])
    axes[0].set_ylabel(f"test {metric}")
    axes[0].set_title("per-seed test means")
    axes[1].boxplot([d, np.zeros_like(d) + 0.001 * (d.max() - d.min() if d.max() != d.min() else 1)],
                    tick_labels=["paired diff", "0"])
    axes[1].axhline(0, color="k", lw=0.8)
    axes[1].set_title(f"paired neural − frozen (n={len(d)})")
    m, sd = np.mean(d), np.std(d, ddof=1) if len(d) > 1 else 0
    axes[1].text(0.02, 0.02, f"mean={m:.3g}\nsd={sd:.3g}\npositive: {(d > 0).sum()}/{len(d)}",
                 transform=axes[1].transAxes, fontsize=8, va="bottom")
    fig.suptitle(title, fontsize=10)
    fig.savefig(os.path.join(OUT, fname))
    plt.close(fig)
    print("  wrote", fname)


def main():
    which = sys.argv[1].split(",") if len(sys.argv) > 1 else ["e3", "e4", "e9", "e10", "e11"]
    specs = {
        "e3": [("raw_e3.csv", "goodBadRatio", "E3 · good:bad crossing ratio (door task)", "e3_goodbad.png", "good:bad ratio"),
               ("raw_e3.csv", "openFraction", "E3 · door engagement (collapse audit)", "e3_engagement.png", "open fraction")],
        "e4": [("raw_e4.csv", "goodBadRatio", "E4 · good:bad ratio (connectome 4A/4B/4C/frozen)", "e4_goodbad.png", "good:bad ratio"),
               ("raw_e4.csv", "openFraction", "E4 · door engagement", "e4_engagement.png", "open fraction")],
        "e9": [("raw_e9.csv", "workJEp", "E9 · per-episode spring work", "e9_work.png", "work (sim J)"),
               ("raw_e9.csv", "dopamine", "E9 · dopamine signal", "e9_dopamine.png", "dopamine")],
        "e10": [("raw_e10.csv", "directionalBias", "E10 · transport directionality", "e10_bias.png", "(LR−RL)/(LR+RL)"),
                ("raw_e10.csv", "crossLR", "E10 · sorted L→R crossings", "e10_crossLR.png", "crossings")],
        "e11": [("raw_e11.csv", "workJEp", "E11 · signed per-episode work", "e11_work.png", "work (sim J)"),
                ("raw_e11.csv", "entropyProduction", "E11 · entropy bookkeeping (MODEL-DEPENDENT)", "e11_entropy.png", "Qh/Th − Qc/Tc")],
    }
    contrasts = {
        "e9": ("demon_neural", "demon_frozen", "workJEp", "E9 primary: paired neural − frozen (test)"),
        "e10": ("trapdoor_neural", "trapdoor_frozen", "netSortedProxy", "E10 primary: paired neural − frozen (test)"),
        "e11": ("ratchet_neural", "ratchet_frozen", "workJEp", "E11 primary: paired neural − frozen (test)"),
    }
    for exp in which:
        print(f"plots for {exp.upper()}:")
        for src, metric, title, fname, ylabel in specs.get(exp, []):
            p = os.path.join(BASE, src)
            if not os.path.exists(p):
                print("  (missing", src, ")")
                continue
            df = pd.read_csv(p)
            if exp == "e10" and metric == "netSortedProxy":
                df["netSortedProxy"] = df["crossLR"] - df["crossRL"]
            plot_metric(df, metric, title, fname, ylabel)
        if exp in contrasts:
            neural, frozen, metric, title = contrasts[exp]
            p = os.path.join(BASE, f"raw_{exp}.csv")
            if os.path.exists(p):
                df = pd.read_csv(p)
                if metric not in df.columns:
                    df[metric] = df["crossLR"] - df["crossRL"]
                plot_primary_contrast(exp, neural, frozen, metric, title, f"{exp}_primary.png")


if __name__ == "__main__":
    main()
