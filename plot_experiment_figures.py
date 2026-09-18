"""Render publication-style figures from learning_test.js measurements.

Run:
    node learning_test.js
    python plot_experiment_figures.py

Writes `maxwell_demon_figure.png` and `.pdf` by default.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


TEAL = "#008f78"
PINK = "#d83b67"
NAVY = "#17263d"
MUTED = "#667085"
GRID = "#d9dee8"


def layer_xy(layer: int, index: int, sizes: list[int]) -> tuple[float, float]:
    starts = np.cumsum([0, *sizes[:-1]])
    x = layer / max(len(sizes) - 1, 1)
    local = index - int(starts[layer])
    y = 0.92 - 0.84 * local / max(sizes[layer] - 1, 1)
    return x, y


def draw_plasticity(ax, data: dict) -> None:
    names = data.get("layerNames", [])
    sizes = [int(x) for x in data.get("layerSizes", [])]
    edges = data.get("plasticity", [])
    if not names or not sizes:
        ax.text(0.5, 0.5, "No layer metadata in learning_curve.json",
                ha="center", va="center", color=MUTED)
        return

    rng = np.random.default_rng(7)
    for layer, size in enumerate(sizes):
        # Show a reproducible sample of neuron positions rather than all nodes.
        count = min(900, size)
        sample = rng.choice(size, count, replace=False) if size > count else np.arange(size)
        starts = sum(sizes[:layer])
        x = layer / max(len(sizes) - 1, 1)
        y = 0.92 - 0.84 * sample / max(size - 1, 1)
        ax.scatter(np.full(len(sample), x), y, s=2, color="#b9c4d5", alpha=0.45,
                   linewidths=0, zorder=1)
        ax.text(x, 1.04, names[layer].replace(" + ", "\n+"), ha="center", va="bottom",
                fontsize=7, color=NAVY, rotation=0)

    for edge in edges:
        source = int(edge["source"])
        target = int(edge["target"])
        sl, tl = int(edge["sourceLayer"]), int(edge["targetLayer"])
        x0, y0 = layer_xy(sl, source, sizes)
        x1, y1 = layer_xy(tl, target, sizes)
        score = min(float(edge["score"]), 1.0)
        color = TEAL if edge["direction"] == "strengthened" else PINK
        ax.plot([x0, x1], [y0, y1], color=color, alpha=0.16 + 0.72 * score,
                linewidth=0.45 + 1.6 * score, zorder=2)

    ax.scatter([], [], color=TEAL, s=18, label="strengthened")
    ax.scatter([], [], color=PINK, s=18, label="weakened")
    ax.legend(loc="lower center", bbox_to_anchor=(0.5, -0.12), ncol=2,
              frameon=False, fontsize=8)
    ax.set_xlim(-0.06, 1.06)
    ax.set_ylim(-0.04, 1.12)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_ylabel("position within layer", color=MUTED)
    ax.spines[:].set_visible(False)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("learning_curve.json"))
    parser.add_argument("--output", type=Path, default=Path("maxwell_demon_figure"),
                        help="output stem; .png and .pdf are written")
    args = parser.parse_args()
    if not args.input.exists():
        raise SystemExit(
            f"missing {args.input}; run `node learning_test.js` first to record measurements"
        )
    data = json.loads(args.input.read_text(encoding="utf-8"))
    history = data.get("history", [])
    if not history:
        raise SystemExit("learning_curve.json contains no history")

    plt.rcParams.update({
        "font.family": "DejaVu Sans",
        "font.size": 9,
        "axes.titlesize": 11,
        "axes.labelsize": 9,
        "axes.edgecolor": "#98a2b3",
        "axes.linewidth": 0.8,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "savefig.facecolor": "white",
    })
    fig, axes = plt.subplots(1, 3, figsize=(13.2, 4.1), constrained_layout=True)
    fig.suptitle("Connectome-driven Maxwell demon: learning and plasticity",
                 fontsize=14, fontweight="bold", color=NAVY)

    frame = np.array([h["frame"] for h in history])
    ratio = np.array([float(h["ratio"]) if h.get("ratio") is not None else np.nan
                      for h in history], dtype=float)
    good = np.cumsum([h.get("good", 0) for h in history])
    bad = np.cumsum([h.get("bad", 0) for h in history])
    ax = axes[0]
    ax.plot(frame, ratio, color=TEAL, marker="o", markersize=4, linewidth=2,
            label="good:bad ratio")
    ax.axhline(1, color="#98a2b3", linewidth=1, linestyle="--", label="parity")
    ax.set_title("A  Learning curve", loc="left", fontweight="bold")
    ax.set_xlabel("simulation frame")
    ax.set_ylabel("beneficial / harmful crossings")
    ax.grid(axis="y", color=GRID, linewidth=0.7)
    ax.legend(frameon=False, fontsize=8)
    ax.text(0.03, 0.05, f"cumulative crossings: {good[-1]:.0f} good, {bad[-1]:.0f} bad",
            transform=ax.transAxes, fontsize=8, color=MUTED)

    ax = axes[1]
    open_rate = np.array([h["openRate"] for h in history])
    door_fast = np.array([h.get("doorFast", np.nan) for h in history])
    ax.plot(frame, open_rate, color=NAVY, marker="o", markersize=4, linewidth=1.8,
            label="door open rate")
    ax.plot(frame, door_fast, color=PINK, marker="s", markersize=3.5, linewidth=1.6,
            label="local fast-particle signal")
    ax.set_title("B  Control policy", loc="left", fontweight="bold")
    ax.set_xlabel("simulation frame")
    ax.set_ylabel("fraction / normalized signal")
    ax.set_ylim(-0.03, 1.03)
    ax.grid(axis="y", color=GRID, linewidth=0.7)
    ax.legend(frameon=False, fontsize=8, loc="best")
    ax.text(0.03, 0.05, "policy samples every 20 frames",
            transform=ax.transAxes, fontsize=8, color=MUTED)

    ax = axes[2]
    draw_plasticity(ax, data)
    ax.set_title("C  Largest synaptic changes", loc="left", fontweight="bold")
    ax.text(0.5, -0.22, f"top {len(data.get('plasticity', []))} | teal: +ΔW | pink: −ΔW",
            transform=ax.transAxes, ha="center", color=MUTED, fontsize=8)

    for ax in axes[:2]:
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_color("#98a2b3")
        ax.spines["bottom"].set_color("#98a2b3")

    png = args.output.with_suffix(".png")
    pdf = args.output.with_suffix(".pdf")
    fig.savefig(png, dpi=300, bbox_inches="tight")
    fig.savefig(pdf, bbox_inches="tight")
    plt.close(fig)
    print(f"wrote {png}")
    print(f"wrote {pdf}")


if __name__ == "__main__":
    main()
