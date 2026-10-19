#!/usr/bin/env python3
"""Generate the Nature-style figure set for the Maxwell-demon / Drosophila paper.

Reads fresh seeded artifacts from research_data/ and writes publication-grade
figures (white background, bright colorblind-safe palette, 300 dpi) into
'Nature paper/', plus a machine-readable results digest (paper_digest.json).

Nature figure conventions applied: white background, sans-serif 7-9 pt,
bold lowercase panel letters, 95% CI bands over independent seeds,
no chartjunk.
"""
import json
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "Nature paper")
os.makedirs(OUT, exist_ok=True)
sys.stdout.reconfigure(encoding="utf-8")

plt.rcParams.update({
    "figure.facecolor": "white", "axes.facecolor": "white", "savefig.facecolor": "white",
    "font.family": "sans-serif", "font.sans-serif": ["DejaVu Sans", "Arial"],
    "font.size": 8, "axes.titlesize": 9, "axes.labelsize": 8.5,
    "xtick.labelsize": 8, "ytick.labelsize": 8, "legend.fontsize": 7.5,
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.linewidth": 0.8, "xtick.major.width": 0.8, "ytick.major.width": 0.8,
    "axes.grid": True, "grid.color": "#E6E6E6", "grid.linewidth": 0.5,
    "legend.frameon": False, "savefig.dpi": 300, "figure.dpi": 150,
})

# bright, colorblind-safe (Okabe-Ito derived)
C = dict(classical="#0072B2", ann="#009E73", fly="#E69F00", connectome="#D55E00",
         shuffled="#7F7F7F", random="#56B4E9", neural="#D55E00", frozen="#7F7F7F",
         speed="#56B4E9", accent="#CC79A7")
CCOND = {"classical_demon": C["classical"], "random": C["random"], "ann": C["ann"],
         "drosophila": C["fly"], "connectome": C["connectome"],
         "shuffled_connectome": C["shuffled"]}
LBL = {"classical_demon": "Classical demon", "random": "Random gate", "ann": "ANN demon",
       "drosophila": "Fly-inspired (PN-KC-MBON)", "connectome": "Connectome (FAFB)",
       "shuffled_connectome": "Shuffled connectome",
       "demon_neural": "Fly brain (plastic)", "demon_frozen": "Fly brain (frozen)",
       "demon_speed": "Speed-clamped policy"}
CE9 = {"demon_neural": C["neural"], "demon_frozen": C["frozen"], "demon_speed": C["speed"]}


def ci95(a):
    a = np.asarray(a, float)
    if a.size < 2:
        return 0.0
    return 1.96 * a.std(ddof=1) / np.sqrt(a.size)


def welch_p(a, b):
    from scipy import stats as _st
    return float(_st.ttest_ind(a, b, equal_var=False).pvalue)


def save(fig, name):
    p = os.path.join(OUT, name)
    fig.savefig(p, bbox_inches="tight")
    plt.close(fig)
    print("wrote", name)


# ---------------------------------------------------------------- load data
bench = [json.load(open(os.path.join(ROOT, "research_data", f"paper_benchmark_seed{s}.json")))
         for s in range(1, 11)]
e9 = [json.loads(l) for l in open(os.path.join(ROOT, "research_data",
      "e9_batch_2026-09-22T10-21-56.jsonl"))]
e9sum = json.load(open(os.path.join(ROOT, "research_data",
             "e9_batch_2026-09-22T10-21-56_summary.json")))
e1011 = json.load(open(os.path.join(ROOT, "research_data", "paper_e10_e11_rows.json")))
fb = json.load(open(os.path.join(ROOT, "fly_brain_circuit.json")))

digest = {"figures": [], "key_numbers": {}}

# ================================================================ FIG 1 — schematic
fig = plt.figure(figsize=(7.08, 5.2))
ax = fig.add_axes([0, 0, 1, 1])
ax.set_xlim(0, 100)
ax.set_ylim(0, 76)
ax.axis("off")
ax.set_facecolor("white")


def box(x, y, w, h, fc, ec, text, fs=7.2, weight="normal"):
    ax.add_patch(FancyBboxPatch((x, y), w, h,
                                boxstyle="round,pad=0.6,rounding_size=1.4",
                                fc=fc, ec=ec, lw=1.2, mutation_scale=1))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=fs,
            color="black", weight=weight, linespacing=1.3)


def arrow(x1, y1, x2, y2, color="#444444", lw=1.4):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", lw=lw,
                                 color=color, mutation_scale=11))

# panel a — construction pipeline
ax.text(2, 73.5, "a", fontsize=11, weight="bold")
ax.text(5, 73.5, "Construction pipeline (connectome-constrained demon)", fontsize=9, weight="bold")
box(2, 62, 24, 8.5, "#EAF3FB", C["classical"], "FAFB v783 connectome\n139,255 neurons\n16.8M synapse rows", weight="bold")
box(30, 62, 22, 8.5, "#F3FBF3", C["ann"], "Signed 5-layer circuit\n106,765 neurons\n553,807 edges", weight="bold")
box(56, 62, 20, 8.5, "#FDF6E3", C["fly"], "LIF spiking brain\nreward-gated\nplasticity", weight="bold")
box(80, 62, 18, 8.5, "#FDEEEE", C["connectome"], "Valve / door\non simulated gas", weight="bold")
arrow(26.5, 66.2, 29.5, 66.2)
arrow(52.5, 66.2, 55.5, 66.2)
arrow(76.5, 66.2, 79.5, 66.2)

# panel b — chamber + brain interface
ax.text(2, 57.5, "b", fontsize=11, weight="bold")
ax.text(5, 57.5, "Maxwell-demon gas chamber and neural interface", fontsize=9, weight="bold")
box(3, 24, 26, 30, "#F7FBFF", "#888888", "")
ax.text(16, 50.0, "hot side", ha="center", fontsize=7.5, color=C["connectome"])
ax.text(16, 26.4, "cold side", ha="center", fontsize=7.5, color=C["classical"])
ax.plot([16, 16], [27, 47], color="#B03A2E", lw=2.2)
ax.plot([16, 16], [34.5, 39.5], color="white", lw=3.8)
ax.add_patch(FancyBboxPatch((14.9, 34.5), 2.2, 5, boxstyle="round,pad=0.12,rounding_size=0.5",
                            fc="white", ec="#B03A2E", lw=1.4))
rng = np.random.default_rng(3)
ax.scatter(rng.uniform(5, 15, 46), rng.normal(42, 3.0, 46), s=5,
           color=C["connectome"], zorder=5, alpha=0.85)
ax.scatter(rng.uniform(5, 15, 52), rng.normal(30.5, 1.6, 52), s=5,
           color=C["classical"], zorder=5, alpha=0.85)
ax.text(16, 21.6, "single door, opened only by\nthe demon (fast molecules pass)", ha="center", fontsize=6.4, color="#555555")
box(40, 27, 13, 28, "#FDFDFD", "#888888", "", )
ax.text(46.5, 51.3, "7 gas sensors", ha="center", fontsize=7.0, weight="bold")
ax.text(46.5, 47.6, "(quantized to 8 bins)", ha="center", fontsize=6.3)
ax.text(46.5, 42.4, "Fly brain", ha="center", fontsize=7.4, weight="bold", color=C["connectome"])
ax.text(46.5, 38.6, "LIF, 106,765 neurons", ha="center", fontsize=6.3)
ax.text(46.5, 34.6, "dopamine-gated\nplasticity", ha="center", fontsize=6.3, color="#555555")
ax.text(46.5, 29.9, "motor: open | closed", ha="center", fontsize=6.6, weight="bold")
arrow(30, 41, 39.4, 41)
arrow(53.4, 41, 62, 41)
box(62, 27, 14, 28, "#FFFDF5", "#888888", "")
ax.text(69, 49.5, "piston + spring", ha="center", fontsize=7.0, weight="bold")
ax.text(69, 45.5, "(work transducer)", ha="center", fontsize=6.3)
ax.text(69, 38, "dopamine RPE\n= work + selection", ha="center", fontsize=6.3, color="#555555")
ax.text(69, 30.5, "pressure difference\n$p = N_h k T_h / V - N_c k T_c / V$", ha="center", fontsize=6.0)
# feedback arrow from transducer back to chamber (bottom path)
ax.annotate("", xy=(16, 22.5), xytext=(69, 24.5),
            arrowprops=dict(arrowstyle="-", lw=0.9, color="#999999", linestyle=":"))
ax.text(42, 23.6, "sensory feedback loop", fontsize=6.0, color="#777777", ha="center")

# panel c — experiment suite
ax.text(2, 17.0, "c", fontsize=11, weight="bold")
ax.text(5, 17.0, "Experiment suite (E1-E11): physical anchor, learned demons, connectome test, closed loops", fontsize=9, weight="bold")
box(3, 4, 28, 9, "#EAF3FB", C["classical"], "E1  Classical reference demon\nE6/E8  causal + information controls", fs=6.7)
box(35, 4, 28, 9, "#F3FBF3", C["ann"], "E2  ANN demon (RL)\nE3  fly-inspired PN-KC-MBON", fs=6.7)
box(67, 4, 30, 9, "#FDF1EA", C["connectome"], "E4/E5  connectome vs shuffled\nE9-E11  closed-loop body demons", fs=6.7)
arrow(31.6, 8.5, 34.4, 8.5)
arrow(63.6, 8.5, 66.4, 8.5)

save(fig, "fig1_overview_schematic.png")
digest["figures"].append("fig1_overview_schematic.png")

# ================================================================ FIG 2 — benchmark
order = ["classical_demon", "random", "ann", "drosophila", "connectome",
         "shuffled_connectome"]
TLBL = {"classical_demon": "Classical\ndemon", "random": "Random\ngate",
        "ann": "ANN demon", "drosophila": "Fly-inspired\n(PN-KC-MBON)",
        "connectome": "Connectome\n(FAFB)", "shuffled_connectome": "Shuffled\nconnectome"}
fig, axes = plt.subplots(1, 3, figsize=(7.08, 3.0))
fig.subplots_adjust(left=0.085, right=0.985, bottom=0.235, top=0.88, wspace=0.36)

# per-seed test-phase values across all 10 seeds
vals = {k: np.array([src["conditions"][k]["testGoodBadRatio"]["mean"] for src in bench])
        for k in order}
effv = {k: np.array([src["thermo"][k]["efficiency"] for src in bench]) * 1e5 for k in order}
bu = {k: float(np.mean([src["thermo"][k]["bitsUsed"] for src in bench])) for k in order}
bn = {k: float(np.mean([src["thermo"][k]["bitsNeeded"] for src in bench])) for k in order}
pw_cr = welch_p(vals["classical_demon"], vals["random"])
pw_cc = welch_p(vals["classical_demon"], vals["connectome"])
pw_cs = welch_p(vals["connectome"], vals["shuffled_connectome"])
pw_ad = welch_p(vals["ann"], vals["drosophila"])

# (a) learning curves (good:bad per 10-trial block, pooled over 10 seeds)
ax = axes[0]
agg = {}
phases = {}
for k in order:
    for src in bench:
        for r in src["conditions"][k]["blocks"]:
            agg.setdefault((k, r["block"]), []).append(r["goodBadRatio"])
            phases[r["block"]] = r["phase"]
for k in order:
    xs = sorted(b for (kk, b) in agg if kk == k)
    ms = np.array([np.mean(agg[(k, x)]) for x in xs])
    es = np.array([ci95(agg[(k, x)]) for x in xs])
    ax.plot(xs, ms, "-o", ms=2.0, lw=1.1, color=CCOND[k], label=LBL[k])
    ax.fill_between(xs, ms - es, ms + es, color=CCOND[k], alpha=0.15, lw=0)
n_train_blocks = sum(1 for b, ph in sorted(phases.items()) if ph == "train")
ax.axvline(n_train_blocks - 0.5, color="#888888", ls="--", lw=0.8)
ax.text(n_train_blocks - 0.35, ax.get_ylim()[1] * 0.97, "test", fontsize=6.5,
        color="#666666", va="top")
ax.set_xlabel("Trial block (10 trials each)")
ax.set_ylabel("Good : bad crossings")
ax.set_title("Learning of sorting selectivity", loc="left", fontsize=8.5)
ax.legend(loc="upper left", fontsize=5.3, ncol=2, columnspacing=0.8,
          handlelength=1.3, borderaxespad=0.2)

# (b) test-phase comparator (10 seeds, mean +- 95% CI, Welch tests)
ax = axes[1]
means = [float(np.mean(vals[k])) for k in order]
cis = [ci95(vals[k]) for k in order]
ypos = np.arange(len(order))[::-1]
ax.barh(ypos, means, xerr=cis, color=[CCOND[k] for k in order], height=0.62,
        error_kw=dict(lw=0.9, capsize=2, capthick=0.9), zorder=3)
for y, m, c in zip(ypos, means, cis):
    ax.text(m + c + 0.07, y, f"{m:.2f}", va="center", fontsize=6.6, zorder=4)
ax.set_yticks(ypos)
ax.set_yticklabels([TLBL[k] for k in order], fontsize=6.5)
ax.set_ylim(-0.75, 7.3)                     # matches panel c row alignment
ax.set_xlim(0, max(means) * 1.62)
ax.set_xlabel("Good : bad crossings (test)")
ax.set_title("Controller comparison (test phase)", loc="left", fontsize=8.5)
ax.text(0.98, 0.985,
        f"n = 10 seeds, Welch t-tests:\n"
        f"classical vs random P = {pw_cr:.1e}\n"
        f"classical vs connectome P = {pw_cc:.1e}\n"
        f"connectome vs shuffled P = {pw_cs:.2f} (n.s.)",
        transform=ax.transAxes, fontsize=5.3, ha="right", va="top",
        bbox=dict(fc="white", ec="#CCCCCC", boxstyle="round,pad=0.3", alpha=0.9))

# (c) thermodynamic budget (10 seeds: mean +- 95% CI)
ax = axes[2]
ypos = np.arange(len(order))[::-1]          # same row order as panel b
means = [float(np.mean(effv[k])) for k in order]
cis = [ci95(effv[k]) for k in order]
ax.errorbar(means, ypos, xerr=cis, fmt="none", ecolor="#555555",
            elinewidth=0.9, capsize=2, zorder=4)
ax.scatter(means, ypos, s=34, color=[CCOND[k] for k in order], zorder=5)
ax.set_yticks(ypos)
ax.set_yticklabels([])                      # row labels shared with panel b
ax.set_ylim(-0.75, 7.3)                     # headroom for the bits inset
lo = min(m - e for m, e in zip(means, cis))
hi = max(m + e for m, e in zip(means, cis))
ax.set_xscale("log")
ax.set_xlim(lo * 0.75, hi * 1.5)
ax.set_xticks([1.0, 1.5, 2.0, 2.5])
ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:g}"))
ax.xaxis.set_minor_formatter(plt.NullFormatter())
ax.set_xlabel(r"Sorting efficiency $\eta = W_{\mathrm{ext}} / W_{\mathrm{jet}}$ ($\times 10^{-5}$)")
ax.set_title("Thermodynamic budget (jet-subsidized)", loc="left", fontsize=8.5)
ax.text(0.03, 0.985,
        "bits used / needed (mean of 10 seeds):\n" +
        "\n".join(f"{LBL[k]}: {bu[k]:.0f} / {bn[k]:,.0f}"
                  for k in order[:3]),
        transform=ax.transAxes, fontsize=4.8, color="#555555", va="top",
        bbox=dict(fc="white", ec="none", alpha=0.85, pad=1))

save(fig, "fig2_benchmark.png")
digest["figures"].append("fig2_benchmark.png")
digest["key_numbers"]["benchmark"] = {
    "nSeeds": len(bench),
    "conditions": {k: {
        "testGoodBadRatio_perSeed": [float(x) for x in vals[k]],
        "testGoodBadRatio_mean": float(np.mean(vals[k])),
        "testGoodBadRatio_ci95": float(ci95(vals[k])),
        "thermo_efficiency_perSeed_x1e5": [float(x) for x in effv[k]],
        "thermo_efficiency_mean_x1e5": float(np.mean(effv[k])),
        "thermo_efficiency_ci95_x1e5": float(ci95(effv[k])),
        "bitsUsed_mean": bu[k], "bitsNeeded_mean": bn[k]}
        for k in order},
    "welchTests": {"classical_vs_random_p": pw_cr,
                   "classical_vs_connectome_p": pw_cc,
                   "connectome_vs_shuffled_p": pw_cs,
                   "ann_vs_drosophila_p": pw_ad}}

# ================================================================ FIG 3 — E9
fig, axes = plt.subplots(1, 3, figsize=(7.08, 2.9), gridspec_kw=dict(width_ratios=[1.2, 1, 1]))

# (a) reward learning curves: per-seed 4-trial block means, mean +- 95% CI
ax = axes[0]
B = 4
n_blocks = 6
for k in ["demon_neural", "demon_frozen", "demon_speed"]:
    rows = [r for r in e9 if r["condition"] == k]
    seeds = sorted({r["seed"] for r in rows})
    curve = np.full((len(seeds), n_blocks), np.nan)
    for i, sd in enumerate(seeds):
        rr = sorted([r for r in rows if r["seed"] == sd], key=lambda r: r["trial"])
        for bi in range(n_blocks):
            seg = rr[bi * B:(bi + 1) * B]
            if seg:
                curve[i, bi] = np.mean([r["reward"] for r in seg])
    m = np.nanmean(curve, axis=0)
    es = np.array([ci95(curve[~np.isnan(curve[:, i]), i]) for i in range(n_blocks)])
    xs = np.arange(1, n_blocks + 1) * B
    ax.plot(xs, m, "-o", ms=2.4, lw=1.3, color=CE9[k], label=LBL[k])
    ax.fill_between(xs, m - es, m + es, color=CE9[k], alpha=0.15, lw=0)
ax.axvline(24.5, color="#888888", ls="--", lw=0.8)
ax.text(25.0, ax.get_ylim()[0], "test", fontsize=6.5, color="#666666")
ax.set_xlabel("Trial (4-trial blocks)")
ax.set_ylabel("Reward per episode")
ax.set_title("E9 pressure demon: learning", loc="left", fontsize=8.5)
ax.legend(loc="lower left", fontsize=6.0)

# (b) final TEST metric comparison (from summary: finals mean +- ci)
ax = axes[1]
conds = ["demon_neural", "demon_frozen", "demon_speed"]
metrics = [("reward", "Reward"), ("decisionAccuracy", "Decision accuracy"), ("demonAgree", "Demon agreement")]
xpos = np.arange(len(metrics))
w = 0.26
for j, k in enumerate(conds):
    vals, errs = [], []
    for mk, _ in metrics:
        f = e9sum["finals"][k]["test"][mk]
        vals.append(f["mean"])
        errs.append(f["ci"])
    ax.bar(xpos + (j - 1) * w, vals, w, yerr=errs, color=CE9[k],
           error_kw=dict(lw=0.9, capsize=2, capthick=0.9), zorder=3)
ax.set_xticks(xpos)
ax.set_xticklabels([m for _, m in metrics], fontsize=7)
ax.set_title("E9 final TEST metrics", loc="left", fontsize=8.5)
# significance annotations (from Welch tests in summary)
tests = {(t["metric"], t["comparison"]): t["p"] for t in e9sum["tests"]}
p_frozen = tests.get(("reward", "demon_neural vs demon_frozen (final TEST)"))
p_speed = tests.get(("reward", "demon_neural vs demon_speed (final TEST)"))
ax.text(0.02, 0.98, f"neural vs frozen: p = {p_frozen:.2f} (n.s.)\nneural vs speed: p = {p_speed:.1e}",
        transform=ax.transAxes, fontsize=6.0, va="top",
        bbox=dict(fc="white", ec="#CCCCCC", boxstyle="round,pad=0.3"))

# (c) per-seed work-ratio distribution
ax = axes[2]
ratio = e9sum["ratioStats"]
vals = e9sum.get("ratioPerSeed", [])
if vals:
    ax.hist(vals, bins=8, color=C["neural"], alpha=0.75, edgecolor="white", zorder=3)
    ax.axvline(ratio["mean"], color="black", lw=1.2)
    ax.axvline(1.0, color=C["frozen"], lw=1.0, ls="--")
    ax.text(ratio["mean"], ax.get_ylim()[1] * 0.95, f"mean {ratio['mean']:.2f}",
            fontsize=6.5, ha="center", va="top")
ax.set_xlabel("Frozen-brain ratio (neural / frozen,\nfinal TEST reward)")
ax.set_ylabel("Seeds")
ax.set_title("Per-seed effect sizes", loc="left", fontsize=8.5)
ax.text(0.02, 0.02, f"{ratio['mean']:.2f} ± {ratio['ci']:.2f} (95% CI)",
        transform=ax.transAxes, fontsize=6.5)

save(fig, "fig3_e9_pressure_demon.png")
digest["figures"].append("fig3_e9_pressure_demon.png")
digest["key_numbers"]["e9"] = {
    "ratioStats": ratio,
    "welch_p_neural_vs_frozen_reward": p_frozen,
    "welch_p_neural_vs_speed_reward": p_speed,
    "finals": {k: e9sum["finals"][k]["test"]["reward"] for k in conds},
}

# ================================================================ FIG 4 — E10/E11
fig, axes = plt.subplots(1, 4, figsize=(7.08, 2.6), gridspec_kw=dict(width_ratios=[1, 1, 1.1, 1]))

def per_seed_phase_mean(rows, field, phase):
    out = {}
    for r in rows:
        if r["phase"] != phase:
            continue
        out.setdefault(r["seed"], []).append(r[field] if field in r else r["rightCount"] - r["leftCount"])
    return {s: np.mean(v) for s, v in out.items()}

# (a) E10 transport train vs test
ax = axes[0]
rows = e1011["e10_neural"]
tr = per_seed_phase_mean(rows, "rightCount-minus-leftCount", "train")
te = per_seed_phase_mean(rows, "rightCount-minus-leftCount", "test")
seeds = sorted(set(tr) & set(te))
trv = [tr[s] for s in seeds]
tev = [te[s] for s in seeds]
for i in range(len(seeds)):
    ax.plot([0, 1], [trv[i], tev[i]], color="#BBBBBB", lw=0.7, zorder=1)
ax.scatter(np.zeros(len(trv)), trv, s=18, color=C["frozen"], zorder=3, label="train")
ax.scatter(np.ones(len(tev)), tev, s=18, color=C["neural"], zorder=3, label="test")
ax.errorbar([0], [np.mean(trv)], yerr=[ci95(trv)], color="black", lw=1.4, capsize=3, zorder=4)
ax.errorbar([1], [np.mean(tev)], yerr=[ci95(tev)], color="black", lw=1.4, capsize=3, zorder=4)
ax.set_xticks([0, 1])
ax.set_xticklabels(["train", "test"])
ax.set_xlim(-0.35, 1.35)
ax.set_ylabel("Net transport (L-R)")
ax.set_title("E10 trapdoor\ntransport", loc="left", fontsize=8.5)

# (b) E10 decision accuracy train vs test
ax = axes[1]
tr = per_seed_phase_mean(rows, "decisionAccuracy", "train")
te = per_seed_phase_mean(rows, "decisionAccuracy", "test")
trv = [tr[s] for s in seeds]
tev = [te[s] for s in seeds]
for i in range(len(seeds)):
    ax.plot([0, 1], [trv[i], tev[i]], color="#BBBBBB", lw=0.7, zorder=1)
ax.scatter(np.zeros(len(trv)), trv, s=18, color=C["frozen"], zorder=3)
ax.scatter(np.ones(len(tev)), tev, s=18, color=C["neural"], zorder=3)
ax.errorbar([0], [np.mean(trv)], yerr=[ci95(trv)], color="black", lw=1.4, capsize=3, zorder=4)
ax.errorbar([1], [np.mean(tev)], yerr=[ci95(tev)], color="black", lw=1.4, capsize=3, zorder=4)
ax.set_xticks([0, 1])
ax.set_xticklabels(["train", "test"])
ax.set_xlim(-0.35, 1.35)
ax.set_ylabel("Decision accuracy")
ax.set_title("E10 trapdoor\naccuracy (+0.035 ± 0.028)", loc="left", fontsize=8.5)

# (c) E11 signed work per episode (test) per seed + zero line
ax = axes[2]
rows11 = e1011["e11_neural"]
work = per_seed_phase_mean(rows11, "workJEp", "test")
seeds11 = sorted(work)
wv = [work[s] * 1e21 for s in seeds11]
ax.bar(np.arange(1, len(wv) + 1), wv, color=C["neural"], alpha=0.8, zorder=3)
ax.axhline(0, color="black", lw=1.0)
mm, ee = np.mean(wv), ci95(wv)
ax.errorbar([len(wv) + 0.7], [mm], yerr=[ee], fmt="D", ms=4, color="black", capsize=3, zorder=4)
ax.set_xlabel("Seed")
ax.set_ylabel(r"Signed work / episode ($10^{-21}$ J)")
ax.set_title("E11 ratchet: no work extraction\n(second law holds)", loc="left", fontsize=8.5)

# (d) E11 entropy production per episode (test)
ax = axes[3]
ent = per_seed_phase_mean(rows11, "entropyProduction", "test")
ev = [ent[s] for s in seeds11]
ax.bar(np.arange(1, len(ev) + 1), ev, color=C["speed"], alpha=0.85, zorder=3)
ax.axhline(0, color="black", lw=1.0)
ax.set_xlabel("Seed")
ax.set_ylabel(r"Entropy production / episode")
ax.set_title(r"$\Sigma \geq 0$ at equilibrium", loc="left", fontsize=8.5)

save(fig, "fig4_e10_e11_closed_loops.png")
digest["figures"].append("fig4_e10_e11_closed_loops.png")
d_acc = np.mean([per_seed_phase_mean(rows, "decisionAccuracy", "test")[s] -
                 per_seed_phase_mean(rows, "decisionAccuracy", "train")[s] for s in seeds])
digest["key_numbers"]["e10"] = {
    "deltaAccuracy_mean": d_acc,
    "deltaAccuracy_ci": ci95([per_seed_phase_mean(rows, "decisionAccuracy", "test")[s] -
                              per_seed_phase_mean(rows, "decisionAccuracy", "train")[s] for s in seeds]),
    "nSeedsImproved": sum(1 for s in seeds if per_seed_phase_mean(rows, "decisionAccuracy", "test")[s] >
                          per_seed_phase_mean(rows, "decisionAccuracy", "train")[s]),
}
mean_work = np.mean(wv) * 1e-21
mean_ent = np.mean(ev)
digest["key_numbers"]["e11"] = {
    "testSignedWorkJ_perEpisode_mean": mean_work,
    "testSignedWorkJ_perEpisode_ci": ci95(wv) * 1e-21,
    "testEntropyProduction_mean": mean_ent,
    "secondLawHolds": bool(mean_work < 0 and mean_ent >= 0),
}

# ================================================================ FIG 5 — circuit
fig, axes = plt.subplots(1, 3, figsize=(7.08, 2.7), gridspec_kw=dict(width_ratios=[1.15, 1, 1.2]))

layer_names = ["AL", "Optic", "LH+MB", "Central", "Motor"]
sizes = [len(x) for x in fb["layers"]]
ax = axes[0]
ypos = np.arange(len(sizes))[::-1]
ax.barh(ypos, sizes, color=[C["classical"], C["ann"], C["fly"], C["connectome"], C["speed"]], height=0.62, zorder=3)
for y, v in zip(ypos, sizes):
    ax.text(v * 1.05, y, f"{v:,}", va="center", fontsize=6.6)
ax.set_yticks(ypos)
ax.set_yticklabels(layer_names, fontsize=7.5)
ax.set_xscale("log")
ax.set_xlim(1e3, 3e5)
ax.set_xlabel("Neurons (log scale)")
ax.set_title("Five-layer signed circuit\n(106,765 neurons)", loc="left", fontsize=8.5)

# (b) neurotransmitter mix + polarity
ax = axes[1]
import collections
nt_counter = collections.Counter(e["nt"] for e in fb["edges"])
sign_counter = collections.Counter(e["sign"] for e in fb["edges"])
nts = ["ach", "glut", "gaba"]
nt_lbl = ["ACh (+)", "Glu (+)", "GABA (−)"]
vals = [nt_counter[n] for n in nts]
colors_nt = [C["connectome"], C["ann"], C["classical"]]
xpos = np.arange(3)
ax.bar(xpos, vals, color=colors_nt, width=0.6, zorder=3)
for x, v in zip(xpos, vals):
    ax.text(x, v * 1.05, f"{v:,}", ha="center", fontsize=6.8)
ax.set_xticks(xpos)
ax.set_xticklabels(nt_lbl, fontsize=7.5)
ax.set_ylabel("Edges")
ax.set_ylim(0, max(vals) * 1.2)
ax.set_title(f"Neurotransmitter polarity\n({sign_counter[1]:,} + / {sign_counter[-1]:,} −)", loc="left", fontsize=8.5)

# (c) modulatory edges
ax = axes[2]
mod_counter = collections.Counter(e.get("modulatorType") for e in fb["modulatory_edges"])
mods = ["serotonin", "dopamine", "octopamine"]
mod_lbl = ["Serotonin", "Dopamine", "Octopamine"]
vals = [mod_counter[m] for m in mods]
xpos = np.arange(3)
ax.bar(xpos, vals, color=[C["accent"], C["fly"], C["speed"]], width=0.6, zorder=3)
for x, v in zip(xpos, vals):
    ax.text(x, v * 1.05, f"{v:,}", ha="center", fontsize=6.8)
ax.set_xticks(xpos)
ax.set_xticklabels(mod_lbl, fontsize=7.5)
ax.set_ylabel("Modulatory edges")
ax.set_ylim(0, max(vals) * 1.2)
ax.set_title(f"Neuromodulatory backbone\n({len(fb['modulatory_edges']):,} edges)", loc="left", fontsize=8.5)

save(fig, "fig5_circuit_composition.png")
digest["figures"].append("fig5_circuit_composition.png")
digest["key_numbers"]["circuit"] = {
    "dataset": fb["provenance"]["dataset"],
    "extractionVersion": fb["provenance"]["extraction_version"],
    "neurons": fb["provenance"]["neuron_count"],
    "edges": fb["provenance"]["edge_count"],
    "sourceEdgeRows": 16847997,
    "layerSizes": dict(zip(layer_names, sizes)),
    "ntMix": dict(nt_counter),
    "signs": dict(sign_counter),
    "modulatory": dict(mod_counter),
}

# ---------------------------------------------------------------- digest
with open(os.path.join(OUT, "paper_digest.json"), "w") as f:
    json.dump(digest, f, indent=2)
print("wrote paper_digest.json")
print("ALL FIGURES DONE")
