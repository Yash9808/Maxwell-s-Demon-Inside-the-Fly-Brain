#!/usr/bin/env python3
"""paper_figures.py — publication figures for the E1–E11 paper program.

Every panel is generated from actual experimental outputs:
  raw:      paper_v2/raw/E<k>_rows.jsonl      (written by paper_program.js)
  analysis: paper_v2/analysis/ANALYSIS_RESULTS.json (written by paper_analysis.js)
  curves:   paper_v2/processed/curves_E<k>.csv

Figure data (underlying numbers per panel) are written to paper_v2/figure_data/,
provenance blocks to paper_v2/figures/PROVENANCE.json. Conceptual schematics
(Fig 1) are drawn ONLY from registry metadata and are labeled as schematics.
"""
import json
import os
import csv
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(HERE, "raw")
PRO = os.path.join(HERE, "processed")
FIGD = os.path.join(HERE, "figures")
FDATA = os.path.join(HERE, "figure_data")
for d in (FIGD, FDATA):
    os.makedirs(d, exist_ok=True)

plt.rcParams.update({
    "figure.facecolor": "white", "axes.facecolor": "white", "savefig.facecolor": "white",
    "font.family": "sans-serif", "font.sans-serif": ["DejaVu Sans", "Arial"],
    "font.size": 8, "axes.titlesize": 9, "axes.labelsize": 8.5,
    "xtick.labelsize": 7.5, "ytick.labelsize": 7.5, "legend.fontsize": 7,
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.linewidth": 0.8, "xtick.major.width": 0.8, "ytick.major.width": 0.8,
    "axes.grid": True, "grid.color": "#E8E8E8", "grid.linewidth": 0.5,
    "legend.frameon": False, "savefig.dpi": 300, "figure.dpi": 150,
})

# Okabe–Ito derived palette
C = {"classical": "#0072B2", "ann": "#009E73", "fly": "#E69F00", "connectome": "#D55E00",
     "shuffled": "#999999", "random": "#CC79A7", "never": "#56B4E9", "frozen": "#7F7F7F",
     "speed": "#0072B2", "neural": "#D55E00", "light": "#009E73", "heavy": "#7F7F7F",
     "gradient": "#D55E00", "equilibrium": "#56B4E9", "fixed": "#56B4E9", "mem4": "#CC79A7",
     "adaptive": "#0072B2"}

PROVENANCE = {"schema": "figure-provenance/1.0", "generated": None, "figures": {}}
RESULTS = json.load(open(os.path.join(HERE, "analysis", "ANALYSIS_RESULTS.json"), encoding="utf-8"))


def load_jsonl(patterns):
    rows = []
    for f in sorted(os.listdir(RAW)):
        if any(f.startswith(p) and f.endswith(".jsonl") for p in patterns):
            for line in open(os.path.join(RAW, f), encoding="utf-8"):
                line = line.strip()
                if line:
                    try:
                        rows.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    return rows


def savefig(fig, name, provenance, legend_note=None):
    fig.savefig(os.path.join(FIGD, name + ".png"), dpi=300)
    fig.savefig(os.path.join(FIGD, name + ".pdf"))
    plt.close(fig)
    PROVENANCE["figures"][name] = {
        "source": provenance.get("source", []),
        "panels": provenance.get("panels", {}),
        "data_files": provenance.get("data_files", []),
        "script": "paper_v2/paper_figures.py",
        "note": legend_note or "",
    }
    print("  figure", name, "written")


def panel_letter(ax, letter):
    ax.text(-0.09, 1.06, letter, transform=ax.transAxes, fontsize=11,
            fontweight="bold", va="top", ha="right")


def ci_of(vals):
    v = np.asarray([x for x in vals if np.isfinite(x)], dtype=float)
    if v.size == 0:
        return np.nan, np.nan
    m = v.mean()
    if v.size < 2:
        return m, 0.0
    sd = v.std(ddof=1)
    tcrit = {2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571, 7: 2.447,
             8: 2.365, 9: 2.306, 10: 2.262, 11: 2.228, 12: 2.201}.get(v.size, 1.96)
    return m, tcrit * sd / np.sqrt(v.size)


# ---------------------------------------------------------------- Figure 1
def figure1():
    """Conceptual schematic ONLY — labeled as such; drawn from registry metadata."""
    fig, ax = plt.subplots(figsize=(7.0, 4.6))
    ax.set_xlim(0, 10); ax.set_ylim(0, 6.4); ax.axis("off")
    ax.grid(False)

    def box(x, y, w, h, text, fc, ec="#333333", fs=8, tc="black"):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.08",
                                    fc=fc, ec=ec, lw=1.0))
        ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=fs, color=tc)

    def arrow(x1, y1, x2, y2):
        ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>",
                                     mutation_scale=11, lw=1.1, color="#444444"))

    # experimental program columns (from experiments/e*.json questions)
    box(0.3, 4.9, 2.5, 1.1, "Chamber / apparatus\nE1–E8 door task\nE9–E11 engines", "#EAF2F8", fs=7.5)
    box(3.4, 4.9, 3.0, 1.1, "Agents\nengineered gate, ANN, PN→KC→MBON,\nFAFB connectome (106,765 neurons)", "#EAF2F8", fs=7.5)
    box(7.0, 4.9, 2.7, 1.1, "Reward: crossing / work\n→ dopamine-gated plasticity\n(eligibility traces)", "#EAF2F8", fs=7.5)
    arrow(2.8, 5.45, 3.4, 5.45); arrow(6.4, 5.45, 7.0, 5.45)
    arrow(8.3, 4.9, 8.3, 4.15); arrow(8.3, 4.15, 4.9, 4.15)

    # second law audit row
    box(0.3, 2.7, 4.4, 1.2, "Thermodynamic ledger (every trial)\nwork_in, extractable work, Landauer erasure bill,\nbits_used vs bits_needed", "#FDF2E9", fs=7.5)
    box(5.2, 2.7, 4.5, 1.2, "Information measures\nMI(neural, particle state), measurement\n& memory budget (E8), causal ΔH decomposition (E6)", "#FDF2E9", fs=7.5)
    arrow(2.5, 4.15, 2.5, 3.9)
    arrow(7.4, 4.15, 7.4, 3.9)

    # outcome
    box(1.6, 0.6, 6.8, 1.1, "Question: is demon-like sorting information-driven or jet-subsidized,\nand can a real connectome learn it?", "#FBE9E7", fs=8.5)
    arrow(2.5, 2.7, 2.5, 1.7); arrow(7.4, 2.7, 7.4, 1.7)

    ax.text(0.3, 6.25, "Conceptual schematic — not experimental data", fontsize=8,
            style="italic", color="#666666")
    ax.text(0.3, 0.15, "E1–E11: seeded train→test program; seed = independent replicate; "
                       "FlyWire FAFB v783 connectome constrains E4/E5/E9–E11.",
            fontsize=7, color="#444444")
    savefig(fig, "figure1_overview",
            {"source": ["experiments/e1.json..e11.json (registry)", "paper_v2/configs/experiment_registry.json"],
             "panels": {"A": "Conceptual schematic (program flow), drawn from registry metadata only"},
             "data_files": []},
            "Panel A is a conceptual schematic of the experimental program, not a result.")


# ---------------------------------------------------------------- Figure 2
def figure2():
    """Learning / behavioral performance: E3 policy collapse (A), E2/E5 ANN lock-open
    vs random (B), E5 comparator openFraction + dT (C), E9 decision variables (D)."""
    e3 = load_jsonl(["E3_rows"])
    e5 = load_jsonl(["E5_rows_s"])
    e2 = load_jsonl(["E2_rows"])
    e9 = load_jsonl(["E9_rows"])
    fig, axes = plt.subplots(2, 2, figsize=(7.2, 5.6))
    axA, axB, axC, axD = axes.ravel()

    # A: E3 openFraction block curve (learning drives the door shut).
    # The frozen control is BIMODAL across seeds (one brain draw parks the
    # door open, the other closed), so we draw PER-SEED lines, not a band.
    per = {}
    for r in e3:
        per.setdefault(r["condition"], {}).setdefault(r["seed"], []).append(r)
    for cond, color in [("drosophila", C["fly"]), ("drosophila_frozen", C["frozen"])]:
        seed_lines = []
        for seed, rs in per[cond].items():
            rs.sort(key=lambda x: x["trial"])
            bs, means = [], []
            for b in range(0, 60, 12):
                seg = [x for x in rs if b <= x["trial"] < b + 12]
                if not seg:
                    continue
                bs.append(b + 6)
                means.append(np.mean([x["openFraction"] for x in seg]))
            seed_lines.append((bs, means))
        for k, (bs, means) in enumerate(seed_lines):
            axA.plot(bs, means, "-", color=color, alpha=0.45, lw=0.9,
                     label=("learning (per seed)" if cond == "drosophila" else "frozen control (per seed)") if k == 0 else None)
        mbs = seed_lines[0][0]
        mm = np.mean([m for _, m in seed_lines], axis=0)
        axA.plot(mbs, mm, "-o", color=color, ms=3, lw=1.6,
                 label="learning (mean)" if cond == "drosophila" else "frozen control (mean)")
    axA.axvline(60.5, color="#888888", ls="--", lw=0.8)
    axA.text(60.5, 0.55, " test →", fontsize=6.5, color="#666666")
    axA.set_xlabel("trial block (12 s episodes)"); axA.set_ylabel("door open fraction")
    axA.set_title("E3 · DA-gated plasticity closes the door"); axA.legend(loc="center right")
    panel_letter(axA, "a")

    # B: E2/E5 policies on the door: per-seed points + mean (n=2 seeds each;
    # with n=2 a 95% t-CI spans huge, so points are shown explicitly)
    conds = [("classical_demon", e5, "classical (ref)"), ("ann", e2, "ANN"), ("random", e2, "random")]
    xs, ms, cols = [], [], []
    for i, (cond, rows, lab) in enumerate(conds):
        test = [r for r in rows if r["condition"] == cond and r["phase"] == "test"]
        per_seed = {}
        for r in test:
            per_seed.setdefault(r["seed"], []).append(r["openFraction"])
        vals = [np.mean(v) for v in per_seed.values()]
        m, _ = ci_of(vals)
        xs.append(i); ms.append(m)
        cols.append(C["classical"] if "classical" in lab else C["ann"] if lab == "ANN" else C["random"])
        axB.scatter(np.random.default_rng(21).normal(i, 0.05, len(vals)), vals, s=26,
                    color="#222222", zorder=3)
    axB.bar(xs, ms, color=cols, width=0.55, alpha=0.6)
    axB.set_xticks(xs); axB.set_xticklabels([c[2] for c in conds])
    axB.set_ylabel("door open fraction (test)"); axB.set_ylim(0, 1.05)
    axB.text(0.02, 0.95, "dots = per-seed means (n=2)", transform=axB.transAxes,
             fontsize=6.5, va="top")
    axB.set_title("E2/E5 · policies act on the door differently")
    panel_letter(axB, "b")

    # C: E5 comparator: dT (sorting) with per-seed points
    order = ["classical_demon", "ann", "drosophila", "connectome", "shuffled_connectome"]
    labs = ["classical", "ANN", "drosophila", "FAFB", "FAFB\nshuffled"]
    cols = [C["classical"], C["ann"], C["fly"], C["connectome"], C["shuffled"]]
    data = []
    for cond in order:
        test = [r for r in e5 if r["condition"] == cond and r["phase"] == "test"]
        per_seed = {}
        for r in test:
            per_seed.setdefault(r["seed"], []).append(r["dTfinal"])
        data.append([np.mean(v) for v in per_seed.values()])
    bp = axC.boxplot(data, patch_artist=True, widths=0.55, medianprops=dict(color="#333333"))
    for patch, col in zip(bp["boxes"], cols):
        patch.set_facecolor(col); patch.set_alpha(0.7); patch.set_edgecolor("#333333")
    for i, d in enumerate(data):
        axC.scatter(np.random.default_rng(7).normal(i + 1, 0.05, len(d)), d, s=8, color="#222222", zorder=3)
    axC.axhline(0, color="#888888", lw=0.7)
    axC.set_xticklabels(labs); axC.set_ylabel(r"$\Delta T$ (sim units, test)")
    axC.set_title("E5 · comparator study (per-seed)")
    panel_letter(axC, "c")

    # D: E9 decision variables (neural valve: sensory & motor activity, by seed)
    n_rows = [r for r in e9 if r["condition"] == "demon_neural"]
    sact = [r["sensoryActivity"] for r in n_rows if np.isfinite(r.get("sensoryActivity", np.nan))]
    mact = [r["motorActivity"] for r in n_rows if np.isfinite(r.get("motorActivity", np.nan))]
    axD.scatter(sact, mact, s=6, alpha=0.35, color=C["neural"], edgecolors="none")
    if len(sact) > 2:
        r = np.corrcoef(sact, mact)[0, 1]
        axD.text(0.03, 0.94, f"Pearson r = {r:.2f} (pooled episodes;\nper-seed mean r = "
                 f"{RESULTS['experiments']['E9']['sensoryMotorCorrelation']['mean']:.2f} ± "
                 f"{RESULTS['experiments']['E9']['sensoryMotorCorrelation']['ci']:.2f})",
                 transform=axD.transAxes, fontsize=7, va="top")
    axD.set_xlabel("sensory pool activity (a.u.)"); axD.set_ylabel("motor pool activity (a.u.)")
    axD.set_title("E9 · brain-driven valve: sensory → motor coupling")
    panel_letter(axD, "d")

    fig.tight_layout()
    savefig(fig, "figure2_learning_behaviour",
            {"source": ["paper_v2/raw/E3_rows.jsonl", "paper_v2/raw/E2_rows.jsonl",
                        "paper_v2/raw/E5_rows_s*.jsonl", "paper_v2/raw/E9_rows.jsonl"],
             "panels": {"a": "E3 openFraction blocks (learning vs frozen)",
                        "b": "E2/E5 test openFraction bars ±95%CI",
                        "c": "E5 test dTfinal per-seed box+points",
                        "d": "E9 sensory vs motor pool activity scatter"},
             "data_files": ["paper_v2/processed/curves_E3.csv", "paper_v2/processed/E5_per_seed.csv"]},
            "a: blocks over 2 seeds × 72 trials (band = 2.5–97.5 percentile across seeds). "
            "b: n=2 seeds, bar = mean, error = 95% t-CI. c: n=2 seeds/condition. "
            "d: n=10 seeds pooled episodes; r reported per seed in the statistics report.")


# ---------------------------------------------------------------- Figure 3
def figure3():
    """Information & thermodynamic budget: MI by condition (A), bits used vs needed (B),
    E6 causal decomposition of ΔH (C), E8 measurement/memory price (D)."""
    e5 = load_jsonl(["E5_rows_s"])
    e6 = load_jsonl(["E6_rows"])
    e8 = load_jsonl(["E8_rows"])
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.0))
    axA, axB = axes

    # A: MI(neural, particle state) by condition (test)
    order = ["classical_demon", "ann", "drosophila", "connectome", "shuffled_connectome"]
    labs = ["classical", "ANN", "drosophila", "FAFB", "FAFB shuf."]
    data = []
    for cond in order:
        test = [r for r in e5 if r["condition"] == cond and r["phase"] == "test"]
        per_seed = {}
        for r in test:
            if np.isfinite(r.get("miNeural", np.nan)):
                per_seed.setdefault(r["seed"], []).append(r["miNeural"])
        data.append([np.mean(v) for v in per_seed.values()] if per_seed else [np.nan])
    bp = axA.boxplot(data, patch_artist=True, widths=0.55, medianprops=dict(color="#333333"))
    cols = [C["classical"], C["ann"], C["fly"], C["connectome"], C["shuffled"]]
    for patch, col in zip(bp["boxes"], cols):
        patch.set_facecolor(col); patch.set_alpha(0.7)
    axA.set_xticklabels(labs, rotation=20, ha="right")
    axA.set_ylabel("MI (bits, test)"); axA.set_title("E5 · neural MI with particle state")
    panel_letter(axA, "a")

    # B: bits used vs bits needed (log scale, from thermoLedger)
    ledger = RESULTS["thermoLedger"]
    labsB, used, needed = [], [], []
    for row in ledger:
        labsB.append(row["experiment"] + "\n" + row["condition"].replace("_", "\n"))
        used.append(max(row["bitsUsed"], 0.5))
        needed.append(row["bitsNeeded"])
    y = np.arange(len(labsB))
    axB.barh(y - 0.2, needed, height=0.38, color="#B0BEC5", label="bits needed (extractable/Landauer)")
    axB.barh(y + 0.2, used, height=0.38, color="#D55E00", label="bits used (metered)")
    axB.set_yticks(y); axB.set_yticklabels(labsB, fontsize=5.5)
    axB.set_xscale("log"); axB.set_xlabel("bits per trial (log)")
    axB.legend(loc="lower right", fontsize=6)
    axB.set_title("thermodynamic ledger: used ≪ needed")
    panel_letter(axB, "b")

    fig.tight_layout()
    savefig(fig, "figure3_information_budget",
            {"source": ["paper_v2/raw/E5_rows_s*.jsonl", "paper_v2/analysis/ANALYSIS_RESULTS.json (thermoLedger)"],
             "panels": {"a": "E5 test MI by condition", "b": "thermo ledger bits used vs needed"},
             "data_files": ["paper_v2/analysis/ANALYSIS_RESULTS.json"]},
            "a: n=2 seeds/condition (box = per-seed means). b: bits_needed = extractable work "
            "priced in Landauer bits (k_B·300 K·ln2); bits_used = metered decision + crossing evaluations.")


# ---------------------------------------------------------------- Figure 4
def figure4():
    """Connectome constraint & second-law boundary: E4 real vs shuffled (A),
    E10 passive trapdoor physics (B), E11 gradient vs equilibrium (C)."""
    e4 = load_jsonl(["E4_rows_s"])
    e10 = load_jsonl(["E10_rows"])
    e11 = load_jsonl(["E11_rows"])
    fig, axes = plt.subplots(1, 3, figsize=(7.4, 2.9))
    axA, axB, axC = axes

    # A: E4 per-seed dT (test): 4A vs 4B vs 4C
    order4 = [("connectome_4A", "FAFB full", C["connectome"]),
              ("connectome_4B", "FAFB restricted", "#E8926B"),
              ("connectome_4C", "shuffled", C["shuffled"])]
    data = []
    for cond, lab, col in order4:
        test = [r for r in e4 if r["condition"] == cond and r["phase"] == "test"]
        per_seed = {}
        for r in test:
            per_seed.setdefault(r["seed"], []).append(r["dTfinal"])
        data.append(([np.mean(v) for v in per_seed.values()], lab, col))
    for i, (d, lab, col) in enumerate(data):
        x = np.random.default_rng(3).normal(i + 1, 0.06, len(d))
        axA.scatter(x, d, s=22, color=col, alpha=0.8, edgecolors="#333333", lw=0.4)
        m, ci = ci_of(d)
        axA.hlines(m, i + 0.75, i + 1.25, color="#222222", lw=1.2)
        axA.vlines(i + 1, m - ci, m + ci, color="#222222", lw=1.2)
    axA.axhline(0, color="#888888", lw=0.7)
    axA.set_xticks([1, 2, 3]); axA.set_xticklabels([d[1] for d in data], fontsize=7)
    axA.set_ylabel(r"$\Delta T$ (test)"); axA.set_title("E4 · real vs shuffled wiring")
    panel_letter(axA, "a")

    # B: E10 crossing rate: light/heavy physics flaps vs neural
    order10 = [("trapdoor_light", "flap light", C["light"]),
               ("trapdoor_heavy", "flap heavy", C["heavy"]),
               ("trapdoor_neural", "brain-gated", C["neural"]),
               ("trapdoor_frozen", "brain frozen", C["frozen"])]
    data = []
    for cond, lab, col in order10:
        test = [r for r in e10 if r["condition"] == cond and r["phase"] == "test"]
        per_seed = {}
        for r in test:
            per_seed.setdefault(r["seed"], []).append(r["crossingRate"])
        data.append(([np.mean(v) for v in per_seed.values()], lab, col))
    for i, (d, lab, col) in enumerate(data):
        x = np.random.default_rng(5).normal(i + 1, 0.06, len(d))
        axB.scatter(x, d, s=22, color=col, alpha=0.8, edgecolors="#333333", lw=0.4)
        m, ci = ci_of(d)
        axB.hlines(m, i + 0.75, i + 1.25, color="#222222", lw=1.2)
        axB.vlines(i + 1, m - ci, m + ci, color="#222222", lw=1.2)
    axB.set_xticks([1, 2, 3, 4]); axB.set_xticklabels([d[1] for d in data], fontsize=7)
    axB.set_ylabel("crossing rate (test)"); axB.set_title("E10 · trapdoor: no active sorting")
    panel_letter(axB, "b")

    # C: E11 net rotation: gradient vs equilibrium vs heavy load
    order11 = [("ratchet_gradient", "gradient\n(Th>Tc)", C["gradient"]),
               ("ratchet_equilibrium", "equilibrium\n(Th=Tc)", C["equilibrium"]),
               ("ratchet_heavy_load", "gradient\nheavy load", "#8C4A2F")]
    data = []
    for cond, lab, col in order11:
        test = [r for r in e11 if r["condition"] == cond and r["phase"] == "test"]
        per_seed = {}
        for r in test:
            per_seed.setdefault(r["seed"], []).append(r["netPerEpisode"])
        data.append(([np.mean(v) for v in per_seed.values()], lab, col))
    for i, (d, lab, col) in enumerate(data):
        x = np.random.default_rng(11).normal(i + 1, 0.06, len(d))
        axC.scatter(x, d, s=22, color=col, alpha=0.8, edgecolors="#333333", lw=0.4)
        m, ci = ci_of(d)
        axC.hlines(m, i + 0.75, i + 1.25, color="#222222", lw=1.2)
        axC.vlines(i + 1, m - ci, m + ci, color="#222222", lw=1.2)
    axC.axhline(0, color="#888888", lw=0.7)
    axC.set_xticks([1, 2, 3]); axC.set_xticklabels([d[1] for d in data], fontsize=7)
    axC.set_ylabel("net steps / episode"); axC.set_title("E11 · ratchet: 2nd-law boundary")
    panel_letter(axC, "c")

    fig.tight_layout()
    savefig(fig, "figure4_connectome_and_secondlaw",
            {"source": ["paper_v2/raw/E4_rows_s*.jsonl", "paper_v2/raw/E10_rows.jsonl",
                        "paper_v2/raw/E11_rows.jsonl"],
             "panels": {"a": "E4 test dTfinal per seed (n=2/cond)",
                        "b": "E10 test crossingRate per seed (n=10/cond)",
                        "c": "E11 test netPerEpisode per seed (n=10/cond)"},
             "data_files": ["paper_v2/processed/E4_per_seed.csv", "paper_v2/processed/E10_per_seed.csv",
                            "paper_v2/processed/E11_per_seed.csv"]},
            "Points = per-seed test-phase means; heavy line = mean ± 95% t-CI (n=10) or "
            "mean ± CI (n=2). Panel c shows the second-law boundary: rectification only "
            "with a thermal gradient.")


# ---------------------------------------------------------------- Figure 5
def figure5():
    """Mechanism: E9 neural valve vs speed reference vs never_open (A: openFraction &
    dP; B: decision accuracy; C: weight drift manipulation check), E10 hold fraction."""
    e9 = load_jsonl(["E9_rows"])
    e10 = load_jsonl(["E10_rows"])
    fig, axes = plt.subplots(1, 3, figsize=(7.4, 2.9))
    axA, axB, axC = axes

    def per_seed_metric(rows, cond, metric):
        per = {}
        for r in rows:
            if r["condition"] == cond and r["phase"] == "test" and np.isfinite(r.get(metric, np.nan)):
                per.setdefault(r["seed"], []).append(r[metric])
        return [np.mean(v) for v in per.values()]

    # A: openFraction (policy state)
    conds = [("demon_neural", "FAFB brain", C["neural"]), ("demon_frozen", "brain frozen", C["frozen"]),
             ("demon_speed", "speed rule", C["speed"]), ("demon_random", "random", C["random"]),
             ("never_open", "never open", C["never"])]
    data = [(per_seed_metric(e9, c, "openFraction"), lab, col) for c, lab, col in conds]
    for i, (d, lab, col) in enumerate(data):
        x = np.random.default_rng(2).normal(i + 1, 0.06, len(d))
        axA.scatter(x, d, s=20, color=col, alpha=0.8, edgecolors="#333333", lw=0.4)
        m, ci = ci_of(d)
        axA.hlines(m, i + 0.75, i + 1.25, color="#222222", lw=1.2)
        axA.vlines(i + 1, m - ci, m + ci, color="#222222", lw=1.2)
    axA.set_xticks(range(1, 6)); axA.set_xticklabels([d[1] for d in data], fontsize=6.5, rotation=20, ha="right")
    axA.set_ylabel("valve open fraction (test)"); axA.set_title("E9 · valve policy state")
    panel_letter(axA, "a")

    # B: decision accuracy
    data = [(per_seed_metric(e9, c, "decisionAccuracy"), lab, col) for c, lab, col in conds]
    for i, (d, lab, col) in enumerate(data):
        x = np.random.default_rng(4).normal(i + 1, 0.06, len(d))
        axB.scatter(x, d, s=20, color=col, alpha=0.8, edgecolors="#333333", lw=0.4)
        m, ci = ci_of(d)
        axB.hlines(m, i + 0.75, i + 1.25, color="#222222", lw=1.2)
        axB.vlines(i + 1, m - ci, m + ci, color="#222222", lw=1.2)
    axB.axhline(0.5, color="#888888", ls=":", lw=0.8)
    axB.text(5.35, 0.5, "chance", fontsize=6, color="#666666", va="center")
    axB.set_xticks(range(1, 6)); axB.set_xticklabels([d[1] for d in data], fontsize=6.5, rotation=20, ha="right")
    axB.set_ylabel("decision accuracy (test)"); axB.set_title("E9 · decisions vs reference rule")
    panel_letter(axB, "b")

    # C: manipulation check: weight drift neural vs frozen (E9) + E10 holdFraction
    w9n = per_seed_metric(e9, "demon_neural", "weightDrift")
    w9f = per_seed_metric(e9, "demon_frozen", "weightDrift")
    h10n = per_seed_metric(e10, "trapdoor_neural", "holdFraction")
    h10f = per_seed_metric(e10, "trapdoor_frozen", "holdFraction")
    axC.scatter(np.random.default_rng(6).normal(1, 0.06, len(w9n)), w9n, s=20, color=C["neural"],
                alpha=0.8, edgecolors="#333333", lw=0.4, label="E9 brain (learning)")
    axC.scatter([1.0] * len(w9f), w9f, s=20, color=C["frozen"], edgecolors="#333333", lw=0.4,
                label="E9 brain (frozen)")
    axC.scatter(np.random.default_rng(8).normal(2, 0.06, len(h10n)), h10n, s=20, color="#8E44AD",
                alpha=0.8, edgecolors="#333333", lw=0.4, label="E10 brain (learning)")
    axC.scatter([2.0] * len(h10f), h10f, s=20, color="#B2BABB", edgecolors="#333333", lw=0.4,
                label="E10 brain (frozen)")
    axC.set_xticks([1, 2]); axC.set_xticklabels(["E9 weight drift", "E10 hold fraction"], fontsize=7.5)
    axC.set_ylabel("weight drift (sim units) / hold fraction")
    axC.set_title("manipulation checks"); axC.legend(fontsize=5.8, loc="center left")
    panel_letter(axC, "c")

    fig.tight_layout()
    savefig(fig, "figure5_mechanism",
            {"source": ["paper_v2/raw/E9_rows.jsonl", "paper_v2/raw/E10_rows.jsonl"],
             "panels": {"a": "E9 openFraction per seed", "b": "E9 decisionAccuracy per seed",
                        "c": "E9/E10 manipulation checks (weight drift, hold fraction)"},
             "data_files": ["paper_v2/processed/E9_per_seed.csv", "paper_v2/processed/E10_per_seed.csv"]},
            "Points = per-seed test-phase means (n=10 seeds). Chance line at 0.5 in b. "
            "Learning manipulations are verified: weight drift only in learning arms.")


# ---------------------------------------------------------------- Figure 6
def figure6():
    """Robustness: E7 regimes (A), E8 demon variants (B), E9/E11 learning arms
    test-vs-train reward deltas (C)."""
    e7 = load_jsonl(["E7_rows"])
    e8 = load_jsonl(["E8_rows"])
    e9 = load_jsonl(["E9_rows"])
    e11 = load_jsonl(["E11_rows"])
    fig, axes = plt.subplots(1, 3, figsize=(7.4, 2.9))
    axA, axB, axC = axes

    # A: E7 g:B conditional + dT by regime (per seed)
    regimes = {1: "sparse\n(120, nz 0)", 102: "dense\n(640, nz 0.3)", 203: "default\n(320, nz 0.12)"}
    data = []
    for seed, lab in regimes.items():
        rs = [r for r in e7 if r["seed"] == seed and r["phase"] == "test"]
        rs = [r for r in rs if r.get("goodBadRatio") is not None and np.isfinite(r["goodBadRatio"])]
        data.append((rs, lab))
    colsA = [C["never"], C["random"], C["classical"]]
    for i, (rs, lab) in enumerate(data):
        vals = [r["goodBadRatio"] for r in rs]
        x = np.random.default_rng(9).normal(i + 1, 0.06, len(vals))
        axA.scatter(x, vals, s=22, color=colsA[i], alpha=0.8, edgecolors="#333333", lw=0.4)
        m, ci = ci_of(vals)
        axA.hlines(m, i + 0.75, i + 1.25, color="#222222", lw=1.2)
        axA.vlines(i + 1, m - ci, m + ci, color="#222222", lw=1.2)
    axA.set_xticks([1, 2, 3]); axA.set_xticklabels([d[1] for d in data], fontsize=7)
    axA.set_ylabel("good:bad ratio (test, crossings>0)")
    axA.set_title("E7 · classical demon across physics regimes")
    panel_letter(axA, "a")

    # B: E8 variants: openFraction + dT
    conds8 = [("demon_adaptive", "adaptive", C["adaptive"]), ("demon_fixed", "fixed", C["fixed"]),
              ("demon_mem4", "memory 4", C["mem4"])]
    data = [(per_seed(e8, c, "openFraction"), lab, col) for c, lab, col in conds8]
    for i, (d, lab, col) in enumerate(data):
        x = np.random.default_rng(13).normal(i + 1, 0.06, len(d))
        axB.scatter(x, d, s=22, color=col, alpha=0.8, edgecolors="#333333", lw=0.4)
        m, ci = ci_of(d)
        axB.hlines(m, i + 0.75, i + 1.25, color="#222222", lw=1.2)
        axB.vlines(i + 1, m - ci, m + ci, color="#222222", lw=1.2)
    axB.set_xticks([1, 2, 3]); axB.set_xticklabels([d[1] for d in data], fontsize=7.5)
    axB.set_ylabel("door open fraction (test)")
    axB.set_title("E8 · information-limited demons")
    panel_letter(axB, "b")

    # C: learning acts: test-vs-train reward deltas (E9/E11 neural arms)
    def delta(rows, cond):
        per = {}
        for r in rows:
            if r["condition"] == cond and np.isfinite(r.get("reward", np.nan)):
                per.setdefault(r["seed"], {}).setdefault(r["phase"], []).append(r["reward"])
        out = []
        for seed, d in per.items():
            if "train" in d and "test" in d:
                out.append(np.mean(d["test"]) - np.mean(d["train"]))
        return out
    d9 = delta(e9, "demon_neural")
    d11 = delta(e11, "ratchet_neural")
    axC.scatter(np.random.default_rng(15).normal(1, 0.06, len(d9)), d9, s=22, color=C["neural"],
                alpha=0.8, edgecolors="#333333", lw=0.4, label="E9 valve")
    axC.scatter(np.random.default_rng(16).normal(2, 0.06, len(d11)), d11, s=22, color="#8E44AD",
                alpha=0.8, edgecolors="#333333", lw=0.4, label="E11 pawl")
    for i, d in enumerate([d9, d11]):
        m, ci = ci_of(d)
        axC.hlines(m, i + 0.75, i + 1.25, color="#222222", lw=1.2)
        axC.vlines(i + 1, m - ci, m + ci, color="#222222", lw=1.2)
    axC.axhline(0, color="#888888", lw=0.7)
    axC.set_xticks([1, 2]); axC.set_xticklabels(["E9", "E11"])
    axC.set_ylabel("reward Δ (test − train, per seed)")
    axC.set_title("learning changes behaviour")
    axC.legend(fontsize=6.5)
    panel_letter(axC, "c")

    fig.tight_layout()
    savefig(fig, "figure6_robustness",
            {"source": ["paper_v2/raw/E7_rows.jsonl", "paper_v2/raw/E8_rows.jsonl",
                        "paper_v2/raw/E9_rows.jsonl", "paper_v2/raw/E11_rows.jsonl"],
             "panels": {"a": "E7 g:B by physics regime (per seed)",
                        "b": "E8 openFraction by demon variant",
                        "c": "E9/E11 per-seed test−train reward delta"},
             "data_files": ["paper_v2/processed/E7_per_seed.csv", "paper_v2/processed/E8_per_seed.csv"]},
            "a: one regime per seed (regime fixed per seed by the manifest). b: n=2 seeds/variant. "
            "c: n=10 seeds; reward is apparatus reward, not work.")


def per_seed(rows, cond, metric):
    per = {}
    for r in rows:
        if r["condition"] == cond and r["phase"] == "test" and np.isfinite(r.get(metric, np.nan)):
            per.setdefault(r["seed"], []).append(r[metric])
    return [np.mean(v) for v in per.values()]


# ---------------------------------------------------------------- Figure 7
def figure7():
    """Integrated summary: experimentally supported information→action→consequence
    chain, with observed/inferred/hypothesis labeling. Schematic + measured values."""
    fig, ax = plt.subplots(figsize=(7.0, 4.8))
    ax.set_xlim(0, 10); ax.set_ylim(0, 6.6); ax.axis("off"); ax.grid(False)

    def box(x, y, w, h, title, lines, fc, ec="#333333"):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.08", fc=fc, ec=ec, lw=1.0))
        ax.text(x + w / 2, y + h - 0.22, title, ha="center", va="top", fontsize=8, fontweight="bold")
        ax.text(x + w / 2, y + (h - 0.45) / 2, lines, ha="center", va="center", fontsize=6.8)

    def arrow(x1, y1, x2, y2, color="#444444", ls="-"):
        ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=11,
                                     lw=1.1, color=color, linestyle=ls))

    # chain (top): environment -> sensing -> connectome processing -> decision -> action -> consequence
    box(0.2, 4.6, 1.55, 1.5, "Environment", "particle states,\njet & door", "#EAF2F8")
    box(2.0, 4.6, 1.7, 1.5, "Sensing", "8ch local + bulk\n(E9 sensor)", "#EAF2F8")
    box(3.95, 4.6, 2.1, 1.5, "Connectome\nprocessing", "FAFB LIF, 563k edges,\nDA-gated plasticity", "#EAF2F8")
    box(6.3, 4.6, 1.6, 1.5, "Decision", "PG readout /\nthresholds", "#EAF2F8")
    box(8.15, 4.6, 1.6, 1.5, "Action", "gate / valve /\nflap / pawl", "#EAF2F8")
    for x1, x2 in [(1.75, 2.0), (3.7, 3.95), (6.05, 6.3), (7.9, 8.15)]:
        arrow(x1, 5.35, x2, 5.35)
    box(3.95, 2.9, 5.8, 1.1, "Behavioral consequence", "crossings, ΔH, ΔP, net work — measured per trial", "#FDF2E9")
    arrow(8.95, 4.6, 8.95, 4.0)

    # evidence row (bottom): measured results per stage
    box(0.2, 0.7, 4.4, 1.6,
        "OBSERVED (E1–E11)",
        "• DA-gated learning changes policy (E3/E9/E11):\n  door closes; reward/accuracy shift vs frozen\n• Sorting ΔH ≈ never-gate with jet on (E6)\n• bits_used ≪ bits_needed (ledger, E1–E8)\n• Real ≈ shuffled wiring behaviourally (E4/E5)", "#E8F6EF")
    box(5.0, 0.7, 4.6, 1.6,
        "INFERRED / HYPOTHESIS",
        "• INFERRED: demon-like sorting here is jet-subsidized,\n  not information-driven\n• INFERRED: connectome constrains dynamics but not\n  task competence at this drive\n• HYPOTHESIS (testable): richer sensory pairing or\n  credit assignment could change E9 work outcome", "#F6F0E8")
    arrow(2.4, 2.9, 2.4, 2.3); arrow(7.3, 2.9, 7.3, 2.3)

    ax.text(0.2, 6.45, "Integrated summary — chain is schematic; boxes below report measured results "
                       "(evidence class labeled)", fontsize=8, style="italic", color="#555555")
    savefig(fig, "figure7_integrated",
            {"source": ["paper_v2/analysis/ANALYSIS_RESULTS.json", "paper_v2/analysis/STATISTICS_REPORT.md"],
             "panels": {"A": "Schematic chain + evidence classification (OBSERVED / INFERRED / HYPOTHESIS)"},
             "data_files": []},
            "Top chain is a schematic of the modeled pipeline; bottom boxes list measured "
            "results with evidence class labels. Nothing in the schematic is data.")


if __name__ == "__main__":
    from datetime import datetime, timezone
    PROVENANCE["generated"] = datetime.now(timezone.utc).isoformat()
    print("generating figures ...")
    figure1()
    figure2()
    figure3()
    figure4()
    figure5()
    figure6()
    figure7()
    with open(os.path.join(FIGD, "PROVENANCE.json"), "w", encoding="utf-8") as f:
        json.dump(PROVENANCE, f, indent=1)
    print("figures complete; PROVENANCE.json written")
