#!/usr/bin/env python3
"""
figure14_door_brains.py — Figure 14: door-task brain outcome at honest scopes.

Panel a–c  E3 drosophila MB mini-circuit (32 PN + 200 KC + 16 MBON model units):
  a  unit-activity map early learning (trained, per-unit decoded activity)
  b  unit-activity map late learning
  c  learning delta (late − early) with block-labelled populations
Panel d  E3 layerRates trajectory (PN / Kenyon cells / MB output over trials,
  both conditions — data exist for ALL rows, no fireVec needed)
Panel e  E5 whole-FAFB connectome controller: region activity (real wiring)
Panel f  E5 whole-FAFB shuffled-wiring control: region activity
Panel g  E4 neural similarity: per-neuron activity correlation between wiring
  conditions (real-real vs real-shuffled) — the neural echo of the behavioral null

Scope labels are explicit: E3/E5-ann controllers simulate mini-circuits whose
fireVec indexes their own units (NOT FAFB anatomy); E4/E5 connectome conditions
run the full 106,765-neuron FAFB circuit and ARE anatomically mappable.

Data: paper_v2/processed/brain/ (ACT bins, MINI_E3.json), raw rows for layerRates,
raw E4 bins for correlations. Nothing is synthesized.
"""
import os, json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, PowerNorm, TwoSlopeNorm

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIGD = os.path.join(HERE, "figures")

AMBER = "#d9930d"; RED = "#c0392b"; BLUE = "#2b6cb0"; GRAY = "#7f8c9a"
ACT_CMAP = LinearSegmentedColormap.from_list("act", ["#0d1321", "#1b3a6b", "#2f8fca", "#8fd3ff"])
DIV_CMAP = LinearSegmentedColormap.from_list("div", ["#2166ac", "#67a9cf", "#f7f7f7", "#ef8a62", "#b2182b"])

BR = os.path.join(HERE, "processed", "brain")
MINI = json.load(open(os.path.join(BR, "MINI_E3.json")))
MI3 = json.load(open(os.path.join(BR, "MI_E3.json")))

def load_mini(cond, win):
    fn = os.path.join(BR, f"ACT_E3_{cond}_{win}.bin")
    b = open(fn, "rb").read()
    return np.frombuffer(b, dtype="<f4").copy()   # 248 = 32 PN | 200 KC | 16 MBON

def load_fafb(name):
    b = open(os.path.join(BR, name), "rb").read()
    return np.frombuffer(b, dtype="<f4").copy()   # 106,765

# ---- panel g: E4 per-neuron correlations (real vs real, real vs shuffled)
def pearson(a, b):
    ma, mb = a.mean(), b.mean()
    num = ((a - ma) * (b - mb)).sum()
    den = np.sqrt(((a - ma) ** 2).sum() * ((b - mb) ** 2).sum())
    return num / den if den > 0 else np.nan

def fig14():
    fig = plt.figure(figsize=(7.2, 7.6))
    gs = fig.add_gridspec(3, 2, height_ratios=[1.15, 0.95, 1.0], hspace=0.55, wspace=0.42)

    # ---------- a/b/c: E3 MB mini-circuit unit maps ----------
    e_tr = load_mini("drosophila", "early")
    l_tr = load_mini("drosophila", "late")
    delta = l_tr - e_tr

    def unit_axis(ax):
        ax.axhspan(0, 32, color="#f5efe0", alpha=0.55, lw=0)
        ax.axhspan(32, 232, color="#eef3f8", alpha=0.55, lw=0)
        ax.axhspan(232, 248, color="#f9ecec", alpha=0.55, lw=0)
        for y, t in ((16, "PN (32)"), (132, "Kenyon cells (200)"), (240, "MBON (16)")):
            ax.text(0.99, y, t, transform=ax.get_yaxis_transform(), ha="right", va="center",
                    fontsize=5.2, color="#555", style="italic")

    for ax, vec, ttl in (
        (fig.add_subplot(gs[0, 0]), e_tr, "a  E3 MB mini-circuit — EARLY training"),
        (fig.add_subplot(gs[0, 1]), l_tr, "b  E3 MB mini-circuit — LATE training"),
    ):
        ax.set_facecolor("white")
        vmax = max(e_tr.max(), l_tr.max(), 1e-9)
        pn = PowerNorm(0.4, vmin=0, vmax=vmax)
        ax.scatter(np.arange(248), np.arange(248), s=2 + 34 * pn(vec),
                   c=ACT_CMAP(pn(vec)), lw=0)
        unit_axis(ax)
        ax.set_xlim(-4, 251); ax.set_ylim(251, -4)
        ax.set_xlabel("model unit index (0–247)", fontsize=6.5)
        ax.set_ylabel("model unit index", fontsize=6.5)
        ax.tick_params(labelsize=5.5)
        ax.set_title(ttl, fontsize=8, loc="left")
        ax.set_aspect("equal")

    axc = fig.add_subplot(gs[1, 0]); axc.set_facecolor("white")
    lim = np.abs(delta).max()
    if lim <= 0: lim = 1e-9
    nrm = TwoSlopeNorm(vcenter=0, vmin=-lim, vmax=lim)
    axc.scatter(np.arange(248), np.arange(248), s=2 + 34 * np.abs(delta) / lim,
                c=DIV_CMAP(nrm(delta)), lw=0)
    unit_axis(axc)
    axc.set_xlim(-4, 251); axc.set_ylim(251, -4)
    axc.set_xlabel("model unit index (0–247)", fontsize=6.5)
    axc.set_ylabel("model unit index", fontsize=6.5)
    axc.tick_params(labelsize=5.5)
    axc.set_title("c  Learning delta (late − early, per model unit)", fontsize=8, loc="left")
    axc.set_aspect("equal")
    cb = fig.colorbar(plt.cm.ScalarMappable(norm=nrm, cmap=DIV_CMAP), ax=axc,
                      fraction=0.046, pad=0.03)
    cb.set_label("Δ decoded activity (a.u.)", fontsize=5.5)
    cb.ax.tick_params(labelsize=5)

    # ---------- d: E3 layerRates over trials ----------
    axd = fig.add_subplot(gs[1, 1]); axd.set_facecolor("white")
    rows = []
    with open(os.path.join(HERE, "raw", "E3_rows.jsonl")) as f:
        for l in f:
            r = json.loads(l)
            if r.get("layerRates") and r["condition"] in ("drosophila", "drosophila_frozen"):
                rows.append(r)
    for cond, col, lsty in (("drosophila", RED, "-"), ("drosophila_frozen", BLUE, "--")):
        rs = [r for r in rows if r["condition"] == cond]
        for key, kcol in (("PN (antennal lobe)", "#8a6d1a"),
                          ("Kenyon cells", col),
                          ("MB output", "#3d8f5f")):
            trs = sorted(set(r["trial"] for r in rs))
            ys = [np.mean([r["layerRates"][key] for r in rs if r["trial"] == t]) for t in trs]
            axd.plot(trs, ys, lsty, color=kcol, lw=0.9, alpha=0.85,
                     label=f"{key.split(' ')[0]} · {cond.replace('drosophila','fly').replace('_frozen',' frozen') if cond!='drosophila' else 'learning'}")
    axd.set_xlabel("trial", fontsize=6.5); axd.set_ylabel("model layer rate (a.u.)", fontsize=6.5)
    axd.tick_params(labelsize=5.5)
    axd.legend(fontsize=4.6, frameon=False, ncol=2, loc="upper right")
    for s in ("top", "right"): axd.spines[s].set_visible(False)
    axd.set_title("d  E3 MB-circuit layer rates (solid: learning, dashed: frozen)", fontsize=8, loc="left")

    # ---------- e/f: E5 FAFB region activity, real vs shuffled ----------
    POS = json.load(open(os.path.join(ROOT, "fly_brain_positions.json")))
    PRIM = np.array(POS["primary"], dtype=np.int64)
    NPN = len(POS["np_names"])
    real = load_fafb("ACT_E5s0_connectome_test.bin")
    shuf = load_fafb("ACT_E5s0_shuffled_connectome_test.bin")
    top = [n for n, _ in sorted(
        [(POS["np_names"][p], real[PRIM == p].sum()) for p in range(NPN)],
        key=lambda kv: -kv[1])[:12]]
    keep_idx = [i for i in range(NPN) if POS["np_names"][PRIM[i]] in top]
    for ax, vec, col, ttl in (
        (fig.add_subplot(gs[2, 0]), real, BLUE, "e  E5 FAFB connectome controller — region activity (test)"),
        (fig.add_subplot(gs[2, 1]), shuf, GRAY, "f  E5 FAFB SHUFFLED wiring — region activity (test)"),
    ):
        ax.set_facecolor("white")
        vals = vec[keep_idx]
        pn = PowerNorm(0.4, vmin=0, vmax=max(real.max(), 1e-9))
        ax.scatter([top.index(POS["np_names"][PRIM[i]]) + np.random.uniform(-0.28, 0.28) for i in keep_idx],
                   [np.random.uniform(-0.28, 0.28) for _ in keep_idx],
                   s=1.5 + 14 * pn(vals), c=col, alpha=0.5, lw=0)
        ax.set_xticks(range(len(top)))
        ax.set_xticklabels(top, rotation=60, fontsize=4.6, ha="right")
        ax.set_yticks([])
        ax.tick_params(labelsize=5)
        for s in ("top", "right"): ax.spines[s].set_visible(False)
        ax.set_title(ttl, fontsize=7.6, loc="left")
    fig.texts.append(fig.text(0.5, 0.015,
        "Points: individual neurons (jittered); size/opacity = decoded model spike counts. "
        "a–c: 248-unit MB mini-circuit (E3 controller) — model units, NOT FAFB anatomy. "
        "e–f: full 106,765-neuron FAFB circuit (E5 connectome conditions).",
        ha="center", fontsize=5.2, color="#444"))

    fig.suptitle("Figure 14 — Door-task brain outcome at honest scopes: MB mini-circuit (E3) and FAFB connectome (E4/E5)",
                 fontsize=9.5, y=0.995, color="#111")
    fig.patch.set_facecolor("white")
    for ext in ("png", "pdf"):
        fig.savefig(os.path.join(FIGD, f"figure14_door_brains.{ext}"), dpi=300, facecolor="white",
                    bbox_inches="tight")
    plt.close(fig)

    # ---------- panel g: separate small figure (E4 neural similarity) ----------
    fig2, axg = plt.subplots(figsize=(3.6, 3.0))
    axg.set_facecolor("white")
    pairs, labels = [], []
    for s in ("s0", "s1"):
        A = load_fafb(f"ACT_E4{s}_connectome_4A_test.bin")
        B = load_fafb(f"ACT_E4{s}_connectome_4B_test.bin")
        C = load_fafb(f"ACT_E4{s}_connectome_4C_test.bin")
        pairs.append((pearson(A, B), pearson(A, C), pearson(B, C)))
    xs = np.arange(3)
    means = np.mean(pairs, axis=0)
    seeds = list(zip(*pairs))
    for xi, (m, sc) in enumerate(zip(means, seeds)):
        axg.scatter([xi + 0.12] * len(sc), sc, s=14, color=RED if xi == 2 else BLUE,
                    zorder=3, alpha=0.8)
        axg.scatter([xi], [m], marker="_", s=180, color="k", zorder=4, lw=1.4)
    axg.set_xticks(xs)
    axg.set_xticklabels(["4A vs 4B\n(real, plasticity\nfull vs restricted)", "4A vs 4C\n(real vs\nshuffled)", "4B vs 4C\n(real vs\nshuffled)"], fontsize=5.5)
    axg.set_ylabel("per-neuron activity correlation\n(test phase, Pearson r)", fontsize=6.5)
    axg.set_ylim(0.9, 1.0)
    axg.tick_params(labelsize=5.5)
    for s in ("top", "right"): axg.spines[s].set_visible(False)
    axg.set_title("g  E4 neural similarity: wiring manipulations", fontsize=8, loc="left")
    fig2.text(0.5, 0.015, "Dots: individual seeds (n=2); bars: mean. Real–shuffled similarity ≈ real–real:\n"
              "the neural echo of the behavioral null (E4/E5).",
              ha="center", fontsize=5.2, color="#444")
    for ext in ("png", "pdf"):
        fig2.savefig(os.path.join(FIGD, f"figure14g_wiring_similarity.{ext}"), dpi=300,
                     facecolor="white", bbox_inches="tight")
    plt.close(fig2)

    prov = {
        "figure14_door_brains": {
            "a": "E3 MB mini-circuit early-training unit activity (248 units)",
            "b": "E3 MB mini-circuit late-training unit activity",
            "c": "E3 learning delta (late − early) per mini-circuit unit",
            "d": "E3 layerRates (PN/KC/MBON) over trials, both conditions",
            "e": "E5 connectome controller FAFB region activity (test)",
            "f": "E5 shuffled-wiring FAFB region activity (test)",
        },
        "figure14g_wiring_similarity": {
            "g": "E4 per-neuron Pearson r between wiring conditions (2 seeds)",
        },
        "data": ["processed/brain/ACT_E3_*.bin", "processed/brain/MINI_E3.json",
                 "processed/brain/ACT_E5s0_connectome_*.bin",
                 "processed/brain/ACT_E5s0_shuffled_connectome_*.bin",
                 "processed/brain/ACT_E4s?_connectome_4?_test.bin",
                 "raw/E3_rows.jsonl", "fly_brain_positions.json"],
        "scope": "E3/E5-ann = mini-circuit model units; E4/E5 connectome = FAFB anatomy",
    }
    json.dump(prov, open(os.path.join(FIGD, "PROVENANCE_fig14.json"), "w"), indent=1)
    print("figure14 + figure14g saved (with provenance)")

if __name__ == "__main__":
    fig14()
