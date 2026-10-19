#!/usr/bin/env python3
"""Create descriptive, publication-style figures for one exported fly session.

Example (Windows PowerShell or Command Prompt):
  python tools/plot_fly_session.py \
    --session-csv "C:/.../fly_log_2026-10-01T20-31-33.csv" \
    --events-csv "C:/.../fly_path_events.csv" \
    --session-json "C:/.../fly_log_2026-10-01T20-31-33.json" \
    --image-dir "C:/.../fly_session_2026-10-01T20-31-33" \
    --output-dir "C:/.../nature_figures_2026-10-01"

Figures are descriptive summaries of one session, not inferential statistics.
The 3D image stacks place timestamped 2D screenshots along a time axis; they
are not volumetric reconstructions of the brain or apparatus.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import Normalize
from matplotlib.collections import LineCollection
from matplotlib.lines import Line2D
from PIL import Image


INK = "#202b38"
MUTED = "#667085"
GRID = "#e4e8ee"
COLORS = {
    "blue": "#2878B5", "orange": "#E07A28", "green": "#218C73",
    "red": "#C44440", "purple": "#7656A5", "gold": "#B88A17",
    "cyan": "#43A6B8", "grey": "#858D98", "pink": "#C75A83",
}
IMAGE_TIME = re.compile(r"_(?:t)([0-9]+(?:\.[0-9]+)?)s\.jpe?g$", re.IGNORECASE)


def style() -> None:
    plt.rcParams.update({
        "font.family": "DejaVu Sans", "font.size": 8.5,
        "axes.titlesize": 9.5, "axes.labelsize": 8.5,
        "axes.titleweight": "bold", "axes.edgecolor": "#7c8795",
        "axes.linewidth": 0.7, "axes.labelcolor": INK,
        "text.color": INK, "xtick.color": MUTED, "ytick.color": MUTED,
        "xtick.labelsize": 7.5, "ytick.labelsize": 7.5,
        "axes.spines.top": False, "axes.spines.right": False,
        "figure.facecolor": "white", "axes.facecolor": "white",
        "savefig.facecolor": "white", "savefig.dpi": 300,
        "pdf.fonttype": 42, "ps.fonttype": 42,
    })


def read_csv_columns(path: Path) -> tuple[list[str], dict[str, np.ndarray], int]:
    with path.open("r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        names = list(reader.fieldnames or [])
        rows = list(reader)
    columns: dict[str, np.ndarray] = {}
    for name in names:
        values = []
        numeric = True
        for row in rows:
            raw = (row.get(name) or "").strip()
            try:
                values.append(float(raw) if raw else np.nan)
            except ValueError:
                numeric = False
                break
        if numeric:
            columns[name] = np.asarray(values, dtype=float)
    return names, columns, len(rows)


def read_events(path: Path) -> list[dict[str, str | float]]:
    events: list[dict[str, str | float]] = []
    with path.open("r", newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            try:
                t = float(row.get("t_s", ""))
            except (TypeError, ValueError):
                continue
            events.append({"t_s": t, "action": (row.get("action") or "unknown").strip(),
                           "note": (row.get("note") or "").strip()})
    return events


def binned(time: np.ndarray, values: np.ndarray, width_s: float = 4.0) -> tuple[np.ndarray, np.ndarray]:
    valid = np.isfinite(time) & np.isfinite(values)
    if not valid.any():
        return np.array([]), np.array([])
    t, v = time[valid], values[valid]
    starts = np.floor(t / width_s).astype(int)
    bins = np.unique(starts)
    means = np.array([np.nanmean(v[starts == b]) for b in bins])
    return (bins + 0.5) * width_s, means


def zscore(values: np.ndarray) -> np.ndarray:
    valid = np.isfinite(values)
    if not valid.any():
        return np.full_like(values, np.nan)
    mean = np.nanmean(values)
    sd = np.nanstd(values)
    if sd <= 1e-12:
        return np.full_like(values, 0.0)
    return (values - mean) / sd


def save_figure(fig: plt.Figure, stem: Path, raster_dpi: int = 300) -> None:
    fig.savefig(stem.with_suffix(".png"), dpi=raster_dpi, bbox_inches="tight")
    fig.savefig(stem.with_suffix(".pdf"), bbox_inches="tight")
    plt.close(fig)


def add_panel_label(ax, label: str) -> None:
    text = ax.text2D if hasattr(ax, "text2D") else ax.text
    text(-0.075, 1.06, label, transform=ax.transAxes, fontsize=11,
         fontweight="bold", va="top", ha="left")


def image_files(directory: Path, prefix: str) -> list[tuple[float, Path]]:
    found = []
    for path in directory.glob(f"{prefix}_t*.jpg"):
        m = IMAGE_TIME.search(path.name)
        if m:
            found.append((float(m.group(1)), path))
    return sorted(found)


def representative_indices(n: int, count: int) -> np.ndarray:
    return np.unique(np.linspace(0, n - 1, min(n, count)).round().astype(int))


def plot_session_telemetry(out: Path, time: np.ndarray, data: dict[str, np.ndarray],
                           n_rows: int, metadata: dict) -> dict[str, float | str]:
    fig, axes = plt.subplots(6, 1, figsize=(11.5, 11.4), sharex=True,
                             gridspec_kw={"height_ratios": [1, 1.1, 1.15, 1.1, 1, 1.05]})
    fig.subplots_adjust(left=0.105, right=0.91, top=0.88, bottom=0.08, hspace=0.34)
    duration = float(np.nanmax(time)) if len(time) else 0.0
    fig.suptitle("Time-resolved fly-session telemetry", x=0.105, y=0.965,
                 ha="left", fontsize=14, fontweight="bold")
    goal = metadata.get("goal", "")
    mode = metadata.get("mode", "")
    fig.text(0.105, 0.932,
             f"Single session · mode={mode or 'not recorded'} · goal={goal or 'not recorded'} · "
             f"{n_rows:,} logged samples · 0–{duration:.1f} s",
             color=MUTED, fontsize=8.5)

    # A. Logged environment settings, retaining the column names and raw scale.
    ax = axes[0]
    for col, label, color in [("jetP", "jetP", COLORS["orange"]),
                              ("jetAim", "jetAim", COLORS["blue"]),
                              ("noise", "noise", COLORS["green"])]:
        if col in data:
            x, y = binned(time, data[col])
            ax.plot(x, y, color=color, lw=1.25, label=label)
    ax.set_ylabel("Logged setting")
    ax.set_title("Experimental environment", loc="left", pad=3)
    ax.legend(frameon=False, ncol=3, loc="upper right", fontsize=7.5)
    add_panel_label(ax, "a")

    # B. Connectome-related telemetry. Standardize each series for pattern
    # comparison only; this does not imply shared units or equivalent signals.
    ax = axes[1]
    for col, color in [("spkN", COLORS["blue"]), ("cg", COLORS["orange"]),
                       ("cb", COLORS["green"])]:
        if col in data:
            x, y = binned(time, data[col])
            ax.plot(x, zscore(y), color=color, lw=1.15, label=col)
    ax.axhline(0, color="#b5bdc7", lw=0.7, zorder=0)
    ax.set_ylabel("Within-series z-score")
    ax.set_title("Connectome telemetry (standardized independently)", loc="left", pad=3)
    ax.legend(frameon=False, ncol=3, loc="upper right", fontsize=7.5)
    add_panel_label(ax, "b")

    # C. Motor command and measured gate state.
    ax = axes[2]
    for col, label, color, ls in [("motor", "motor", COLORS["purple"], "-"),
                                  ("motorBase", "motorBase", COLORS["purple"], "--"),
                                  ("doorT", "doorT", COLORS["red"], "--"),
                                  ("doorPos", "doorPos", COLORS["blue"], "-")]:
        if col in data:
            x, y = binned(time, data[col])
            ax.plot(x, y, color=color, ls=ls, lw=1.1, label=label)
    ax.set_ylabel("Logged value")
    ax.set_title("Motor and gate telemetry", loc="left", pad=3)
    ax.legend(frameon=False, ncol=4, loc="upper right", fontsize=7.3)
    add_panel_label(ax, "c")

    # D. Temperature variables and their difference; dT is cross-checked
    # against Tl - Tr but remains labelled as the recorded CSV field.
    ax = axes[3]
    for col, color in [("Tl", COLORS["red"]), ("Tr", COLORS["blue"])]:
        if col in data:
            x, y = binned(time, data[col])
            ax.plot(x, y, color=color, lw=1.2, label=col)
    ax.set_ylabel("Tl / Tr (logged units)")
    ax2 = ax.twinx()
    if "dT" in data:
        x, y = binned(time, data["dT"])
        ax2.plot(x, y, color=COLORS["green"], lw=1.25, label="dT")
    ax2.set_ylabel("dT (logged units)", color=COLORS["green"])
    ax2.spines["top"].set_visible(False)
    ax2.spines["right"].set_visible(True)
    ax2.spines["right"].set_color(COLORS["green"])
    h1, l1 = ax.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax.legend(h1 + h2, l1 + l2, frameon=False, ncol=3, loc="upper right", fontsize=7.5)
    ax.set_title("Recorded chamber temperatures", loc="left", pad=3)
    add_panel_label(ax, "d")

    # E. Logged chemistry-like state columns, with no inference about units.
    ax = axes[4]
    for col, color in [("da", COLORS["orange"]), ("ser", COLORS["purple"]),
                       ("oct", COLORS["cyan"])]:
        if col in data:
            x, y = binned(time, data[col])
            ax.plot(x, y, color=color, lw=1.15, label=col)
    ax.set_ylabel("Logged value")
    ax.set_title("Neuromodulator state fields", loc="left", pad=3)
    ax.legend(frameon=False, ncol=3, loc="upper right", fontsize=7.5)
    add_panel_label(ax, "e")

    # F. Express each plasticity summary relative to its first finite sample,
    # because dwL1, dwN and dwMax are not on a common numerical scale.
    ax = axes[5]
    plasticity_change: dict[str, float] = {}
    for col, color in [("dwL1", COLORS["blue"]), ("dwN", COLORS["orange"]),
                       ("dwMax", COLORS["green"])]:
        if col not in data:
            continue
        raw = data[col]
        valid = np.flatnonzero(np.isfinite(raw))
        if not len(valid) or abs(raw[valid[0]]) < 1e-12:
            continue
        base = raw[valid[0]]
        rel = (raw / abs(base) - base / abs(base)) * 100.0
        x, y = binned(time, rel)
        ax.plot(x, y, color=color, lw=1.15, label=col)
        plasticity_change[col] = float(rel[valid[-1]])
    ax.axhline(0, color="#b5bdc7", lw=0.7, zorder=0)
    ax.set_ylabel("Change from first sample (%)")
    ax.set_title("Logged plasticity summaries (indexed to session start)", loc="left", pad=3)
    ax.legend(frameon=False, ncol=3, loc="upper right", fontsize=7.5)
    add_panel_label(ax, "f")

    for ax in axes:
        ax.grid(axis="y", color=GRID, lw=0.65)
        ax.set_xlim(0, duration)
        ax.spines["top"].set_visible(False)
        ax.tick_params(length=2.5, pad=2)
    axes[-1].set_xlabel("Session time (s)")
    fig.text(0.105, 0.035,
             "Lines show 4-s binned means. Standardization in panel b and start-value indexing in panel f "
             "are visualization transforms; column definitions/units should be verified against the simulator.",
             fontsize=7.2, color=MUTED)
    save_figure(fig, out / "fig01_session_telemetry")

    diff_error = float("nan")
    if all(col in data for col in ("Tl", "Tr", "dT")):
        valid = np.isfinite(data["Tl"]) & np.isfinite(data["Tr"]) & np.isfinite(data["dT"])
        if valid.any():
            diff_error = float(np.nanmedian(np.abs(data["dT"][valid] -
                                                   (data["Tl"][valid] - data["Tr"][valid]))))
    return {"duration_s": duration, "median_abs_dT_minus_Tl_minus_Tr": diff_error,
            "plasticity_relative_change_percent": plasticity_change}


def plot_neural_activity(out: Path, csv_path: Path, time: np.ndarray,
                         data: dict[str, np.ndarray]) -> dict[str, int]:
    fig, axes = plt.subplots(2, 1, figsize=(11.3, 7.3), gridspec_kw={"height_ratios": [1, 1.1]})
    fig.subplots_adjust(left=0.12, right=0.97, top=0.88, bottom=0.13, hspace=0.4)
    fig.suptitle("Neural-state measurements across the session", x=0.12, y=0.96,
                 ha="left", fontsize=13.5, fontweight="bold")

    ax = axes[0]
    # Compat note (schema v2, 2026-10-08): the export is additive — new columns
    # t_sim, dwL1_step, dwN_step, spk_<nt>/n_<nt> counts, plus events.csv and
    # README.txt in the session zip (meta.schema_version == 2). The legacy
    # rate_* columns are unchanged but read constant 0 in brain builds
    # (nt_name annotations absent); prefer the derivable spk_<nt>/n_<nt>
    # counts for per-NT rates, and join events via t_sim (see README.txt).
    # paper_analysis.py / panel_b_figure.py do not exist in this repo.
    rate_cols = ["rate_ach", "rate_gaba", "rate_glut", "rate_da", "rate_ser", "rate_oct"]
    palette = [COLORS["blue"], COLORS["red"], COLORS["green"], COLORS["orange"],
               COLORS["purple"], COLORS["cyan"]]
    for col, color in zip(rate_cols, palette):
        if col in data:
            x, y = binned(time, data[col], 6.0)
            ax.plot(x, y, color=color, lw=1.05, label=col)
    ax.set_title("Recorded rate fields (names and raw scales retained)", loc="left")
    ax.set_ylabel("Logged rate")
    ax.set_xlabel("Session time (s)")
    ax.legend(frameon=False, ncol=3, fontsize=7.3, loc="upper right")
    ax.grid(axis="y", color=GRID, lw=0.65)
    add_panel_label(ax, "a")

    # The five np* columns are a per-row ranked list, so aggregate by the
    # accompanying name rather than treating np1..np5 as fixed populations.
    names = [f"np{i}_name" for i in range(1, 6)]
    rates = [f"np{i}_rate" for i in range(1, 6)]
    # Read names from the original CSV separately; names are deliberately
    # not coerced into numeric columns by read_csv_columns.
    with csv_path.open("r", newline="", encoding="utf-8-sig") as f:
        raw_rows: list[dict[str, str]] = list(csv.DictReader(f))
    if not all(k in data for k in rates) or (raw_rows and not all(k in raw_rows[0] for k in names)):
        ax2 = axes[1]
        ax2.text(0.5, 0.5, "Named population columns are unavailable in this CSV",
                 ha="center", va="center", transform=ax2.transAxes, color=MUTED)
        ax2.set_axis_off()
        save_figure(fig, out / "fig02_neural_activity")
        return {}
    occurrences: Counter[str] = Counter()
    for row in raw_rows:
        for col in names:
            label = (row.get(col) or "").strip()
            if label:
                occurrences[label] += 1
    chosen = [label for label, _ in occurrences.most_common(14)]
    width = 10.0
    edges = np.arange(0, float(np.nanmax(time)) + width, width)
    if len(edges) < 2:
        edges = np.array([0.0, width])
    sums = np.zeros((len(chosen), len(edges) - 1), dtype=float)
    counts = np.zeros_like(sums)
    row_index = {label: i for i, label in enumerate(chosen)}
    bin_index = np.clip(np.digitize(time, edges) - 1, 0, len(edges) - 2)
    for ri, row in enumerate(raw_rows[:len(time)]):
        bi = int(bin_index[ri])
        for ncol, rcol in zip(names, rates):
            label = (row.get(ncol) or "").strip()
            if label in row_index:
                try:
                    value = float(row.get(rcol, ""))
                except (TypeError, ValueError):
                    continue
                if np.isfinite(value):
                    yi = row_index[label]
                    sums[yi, bi] += value
                    counts[yi, bi] += 1
    matrix = np.divide(sums, counts, out=np.full_like(sums, np.nan), where=counts > 0)
    ax2 = axes[1]
    if len(chosen):
        cmap = plt.get_cmap("magma").copy()
        cmap.set_bad("#f3f4f6")
        im = ax2.imshow(matrix, aspect="auto", interpolation="nearest", origin="lower",
                         extent=(edges[0], edges[-1], -0.5, len(chosen) - 0.5), cmap=cmap)
        ax2.set_yticks(np.arange(len(chosen)))
        ax2.set_yticklabels(chosen, fontsize=7.2)
        cb = fig.colorbar(im, ax=ax2, pad=0.012, fraction=0.025)
        cb.set_label("Mean logged rate", fontsize=7.5)
    else:
        ax2.text(0.5, 0.5, "No non-empty named populations were logged",
                 ha="center", va="center", transform=ax2.transAxes, color=MUTED)
    ax2.set_title("Named entries grouped by label (10-s bins; blank = not sampled)", loc="left")
    ax2.set_xlabel("Session time (s)")
    ax2.set_ylabel("Logged population name")
    ax2.tick_params(length=2)
    add_panel_label(ax2, "b")
    fig.text(0.12, 0.055,
             "np1–np5 are ranked slots whose name can change at each sample; they are grouped here by the recorded name.",
             fontsize=7.2, color=MUTED)
    save_figure(fig, out / "fig02_neural_activity")
    return dict(occurrences.most_common(14))


def plot_neural_activity_faceted(out: Path, csv_path: Path, time: np.ndarray,
                                data: dict[str, np.ndarray]) -> dict[str, int]:
    """Keep individual logged rate scales legible and aggregate ranked names."""
    with csv_path.open("r", newline="", encoding="utf-8-sig") as f:
        raw_rows = list(csv.DictReader(f))
    names = [f"np{i}_name" for i in range(1, 6)]
    rates = [f"np{i}_rate" for i in range(1, 6)]
    occurrences: Counter[str] = Counter()
    for row in raw_rows:
        for col in names:
            label = (row.get(col) or "").strip()
            if label:
                occurrences[label] += 1
    chosen = [label for label, _ in occurrences.most_common(14)]

    fig = plt.figure(figsize=(11.2, 9.6))
    gs = fig.add_gridspec(4, 2, height_ratios=(0.78, 0.78, 0.78, 1.8),
                          left=0.105, right=0.93, top=0.89, bottom=0.105,
                          hspace=0.48, wspace=0.22)
    fig.suptitle("Neural-state measurements across the session", x=0.105, y=0.96,
                 ha="left", fontsize=13.5, fontweight="bold")
    fig.text(0.105, 0.925,
             "Each exported rate has its own y-axis; units are retained as logged.",
             fontsize=8.1, color=MUTED)
    rate_cols = ["rate_ach", "rate_gaba", "rate_glut", "rate_da", "rate_ser", "rate_oct"]
    palette = [COLORS["blue"], COLORS["red"], COLORS["green"], COLORS["orange"],
               COLORS["purple"], COLORS["cyan"]]
    for idx, (col, color) in enumerate(zip(rate_cols, palette)):
        ax = fig.add_subplot(gs[idx // 2, idx % 2])
        if col in data:
            x, y = binned(time, data[col], 6.0)
            ax.plot(x, y, color=color, lw=1.15)
        ax.set_title(col, loc="left", fontsize=8.5, pad=2)
        ax.set_ylabel("Logged rate", fontsize=7.2)
        ax.grid(axis="y", color=GRID, lw=0.6)
        ax.tick_params(length=2, pad=2)
        ax.set_xlim(float(np.nanmin(time)), float(np.nanmax(time)))
        ax.text(-0.1, 1.14, chr(ord("a") + idx), transform=ax.transAxes,
                fontsize=9.5, fontweight="bold", va="top")
        if idx // 2 == 2:
            ax.set_xlabel("Session time (s)", fontsize=7.5)

    ax2 = fig.add_subplot(gs[3, :])
    width = 10.0
    edges = np.arange(0, float(np.nanmax(time)) + width, width)
    if len(edges) < 2:
        edges = np.array([0.0, width])
    sums = np.zeros((len(chosen), len(edges) - 1), dtype=float)
    counts = np.zeros_like(sums)
    row_index = {label: i for i, label in enumerate(chosen)}
    bin_index = np.clip(np.digitize(time, edges) - 1, 0, len(edges) - 2)
    for ri, row in enumerate(raw_rows[:len(time)]):
        bi = int(bin_index[ri])
        for ncol, rcol in zip(names, rates):
            label = (row.get(ncol) or "").strip()
            if label not in row_index:
                continue
            try:
                value = float(row.get(rcol, ""))
            except (TypeError, ValueError):
                continue
            if np.isfinite(value):
                yi = row_index[label]
                sums[yi, bi] += value
                counts[yi, bi] += 1
    matrix = np.divide(sums, counts, out=np.full_like(sums, np.nan), where=counts > 0)
    if chosen:
        cmap = plt.get_cmap("magma").copy()
        cmap.set_bad("#f3f4f6")
        im = ax2.imshow(matrix, aspect="auto", interpolation="nearest", origin="lower",
                         extent=(edges[0], edges[-1], -0.5, len(chosen) - 0.5), cmap=cmap)
        ax2.set_yticks(np.arange(len(chosen)))
        ax2.set_yticklabels(chosen, fontsize=7.0)
        cb = fig.colorbar(im, ax=ax2, pad=0.012, fraction=0.02)
        cb.set_label("Mean logged rate", fontsize=7.3)
    ax2.set_title("Named population-rate entries grouped by label (10-s bins; blank = not sampled)",
                  loc="left", fontsize=8.5, pad=3)
    ax2.set_xlabel("Session time (s)")
    ax2.set_ylabel("Recorded population name")
    ax2.tick_params(length=2, pad=2)
    ax2.text(-0.055, 1.08, "g", transform=ax2.transAxes, fontsize=9.5,
             fontweight="bold", va="top")
    fig.text(0.105, 0.055,
             "np1–np5 are ranked slots whose names can change each sample; the heatmap groups entries by the logged name.",
             fontsize=7.2, color=MUTED)
    save_figure(fig, out / "fig02_neural_activity")
    return dict(occurrences.most_common(14))


def plot_path_and_events(out: Path, session_json: Path,
                         events: list[dict[str, str | float]]) -> dict[str, int | float | dict]:
    payload = json.loads(session_json.read_text(encoding="utf-8"))
    meta = payload.get("meta", {}).get("flyPath", {})
    points = meta.get("path", [])
    if not points:
        raise ValueError("session JSON does not contain meta.flyPath.path")
    t = np.asarray([p.get("t", np.nan) for p in points], dtype=float)
    x = np.asarray([p.get("x", np.nan) for p in points], dtype=float)
    y = np.asarray([p.get("y", np.nan) for p in points], dtype=float)
    z = np.asarray([p.get("z", np.nan) for p in points], dtype=float)
    good = np.isfinite(t) & np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
    t, x, y, z = t[good], x[good], y[good], z[good]
    order = np.argsort(t, kind="stable")
    t, x, y, z = t[order], x[order], y[order], z[order]
    if len(t) < 2:
        raise ValueError("at least two valid path samples are needed to estimate distance")

    # Distance is the cumulative sum of straight-line 3D displacements between
    # logged samples. This is a sampled-path estimate; no scale conversion is
    # available, so retain the source's scene units.
    xyz = np.column_stack((x, y, z))
    step_dist = np.linalg.norm(np.diff(xyz, axis=0), axis=1)
    cumulative = np.r_[0.0, np.cumsum(step_dist)]
    metadata_distance = float(meta.get("distance_u", np.nan))
    sample_distance = float(cumulative[-1])
    distance_delta_pct = (100.0 * (sample_distance - metadata_distance) / metadata_distance
                          if np.isfinite(metadata_distance) and metadata_distance > 0 else np.nan)
    t0, t1 = float(t[0]), float(t[-1])
    duration = max(t1 - t0, 1e-9)

    fig = plt.figure(figsize=(12.8, 9.0))
    grid = fig.add_gridspec(2, 2, left=0.085, right=0.965, top=0.885,
                            bottom=0.09, hspace=0.39, wspace=0.30,
                            height_ratios=(1.0, 1.02))
    fig.suptitle("Fly movement and path events", x=0.085, y=0.965,
                 ha="left", fontsize=14, fontweight="bold")
    meta_text = (f"{len(t):,} 3D path samples  ·  {len(events):,} events  ·  "
                 f"{duration:.0f} s  ·  sampled path length {sample_distance:,.0f} scene units")
    fig.text(0.085, 0.928, meta_text, fontsize=8.2, color=MUTED)

    # A. Top-down projection avoids perspective distortion and makes the path
    # footprint clear; color still encodes acquisition time.
    ax_path = fig.add_subplot(grid[0, 0])
    xy = np.column_stack((x, y))
    segments2d = np.stack((xy[:-1], xy[1:]), axis=1)
    norm_time = Normalize(t0, t1)
    path_lines = LineCollection(segments2d, cmap="viridis", norm=norm_time,
                                linewidths=1.25, alpha=0.95, capstyle="round")
    path_lines.set_array((t[:-1] + t[1:]) / 2.0)
    ax_path.add_collection(path_lines)
    ax_path.scatter(x[0], y[0], s=32, color=COLORS["green"], edgecolor="white",
                    linewidth=0.6, zorder=4, label="start")
    ax_path.scatter(x[-1], y[-1], s=32, color=COLORS["red"], edgecolor="white",
                    linewidth=0.6, zorder=4, label="end")
    pad_x = max(np.ptp(x) * 0.06, 1.0)
    pad_y = max(np.ptp(y) * 0.12, 1.0)
    ax_path.set_xlim(float(np.min(x) - pad_x), float(np.max(x) + pad_x))
    ax_path.set_ylim(float(np.min(y) - pad_y), float(np.max(y) + pad_y))
    ax_path.set_aspect("equal", adjustable="box")
    ax_path.set_xlabel("x (logged scene units)")
    ax_path.set_ylabel("y (logged scene units)")
    ax_path.set_title("Top-down flight path", loc="left", pad=7)
    ax_path.legend(frameon=False, ncol=2, loc="lower right", fontsize=7.3)
    ax_path.grid(color=GRID, linewidth=0.55)
    ax_path.tick_params(labelsize=7.5, length=2)
    cb = fig.colorbar(path_lines, ax=ax_path, pad=0.025, fraction=0.05)
    cb.set_label("Time (s)", fontsize=7.4)
    cb.ax.tick_params(labelsize=7)
    add_panel_label(ax_path, "a")

    # B. Cumulative sampled 3D path distance against session time. Overlay
    # recorded crossing events by interpolating distance at event timestamps.
    ax_dist = fig.add_subplot(grid[0, 1])
    ax_dist.plot(t, cumulative, color=COLORS["blue"], linewidth=1.8, zorder=2)
    ax_dist.fill_between(t, 0, cumulative, color=COLORS["blue"], alpha=0.10, linewidth=0)
    crossing_times = np.asarray([float(e["t_s"]) for e in events
                                 if str(e["action"]) == "crossing"], dtype=float)
    in_path = crossing_times[(crossing_times >= t0) & (crossing_times <= t1)]
    if len(in_path):
        crossing_distance = np.interp(in_path, t, cumulative)
        ax_dist.scatter(in_path, crossing_distance, s=16, color=COLORS["orange"],
                        edgecolors="white", linewidths=0.35, alpha=0.85,
                        zorder=3, label="recorded crossing")
        ax_dist.legend(frameon=False, fontsize=7.2, loc="upper left")
    ax_dist.set_xlim(t0, t1)
    ax_dist.set_ylim(bottom=0)
    ax_dist.set_xlabel("Session time (s)")
    ax_dist.set_ylabel("Cumulative 3D distance (scene units)")
    ax_dist.set_title("Cumulative distance travelled", loc="left", pad=7)
    ax_dist.grid(axis="both", color=GRID, linewidth=0.6)
    ax_dist.tick_params(labelsize=7.5, length=2)
    note = f"From sampled coordinates: {sample_distance:,.0f} units"
    if np.isfinite(metadata_distance):
        note += f"  ·  export total: {metadata_distance:,.0f}"
        if np.isfinite(distance_delta_pct):
            note += f" ({distance_delta_pct:+.1f}%)"
    ax_dist.text(0.02, 0.96, note, transform=ax_dist.transAxes,
                 ha="left", va="top", fontsize=6.8, color=MUTED,
                 bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.82, "pad": 2})
    add_panel_label(ax_dist, "b")

    # C. Vertical component of the logged path, displayed separately rather
    # than squashing the trajectory into a misleading 3D perspective.
    ax_z = fig.add_subplot(grid[1, 0])
    ax_z.plot(t, z, color=COLORS["purple"], linewidth=1.15)
    ax_z.fill_between(t, float(np.nanmin(z)), z, color=COLORS["purple"], alpha=0.08, linewidth=0)
    ax_z.set_xlim(t0, t1)
    ax_z.set_xlabel("Session time (s)")
    ax_z.set_ylabel("z (logged scene units)")
    ax_z.set_title("Vertical position over time", loc="left", pad=7)
    ax_z.grid(axis="both", color=GRID, linewidth=0.6)
    ax_z.tick_params(labelsize=7.5, length=2)
    add_panel_label(ax_z, "c")

    # D. One point per recorded action. Crossing adjectives are taken verbatim
    # from startle-note text and explicitly labeled as notes, not reclassified.
    labels: list[str] = []
    normalized: list[tuple[float, str, str]] = []
    for event in events:
        action = str(event["action"])
        note_text = str(event["note"]).lower()
        label = action
        if action == "startle" and "good crossing" in note_text:
            label = "startle · good-crossing note"
        elif action == "startle" and "bad crossing" in note_text:
            label = "startle · bad-crossing note"
        normalized.append((float(event["t_s"]), label, action))
        if label not in labels:
            labels.append(label)
    labels.sort(key=lambda label: (0 if "good-crossing" in label else
                                   1 if "bad-crossing" in label else 2, label))
    yloc = {label: i for i, label in enumerate(labels)}
    action_palette = {"gate": COLORS["blue"], "jet": COLORS["orange"],
                      "crossing": COLORS["green"], "demonstrike": COLORS["red"],
                      "demonhold": COLORS["purple"], "demonwatch": COLORS["cyan"],
                      "demonattend": COLORS["gold"], "demonrecoil": COLORS["pink"],
                      "startle": COLORS["red"], "push": COLORS["grey"],
                      "hold": COLORS["blue"], "home": COLORS["grey"]}
    ax_events = fig.add_subplot(grid[1, 1])
    for label in labels:
        records = [(ts, action) for ts, lab, action in normalized if lab == label]
        if "good-crossing" in label:
            color = COLORS["green"]
        elif "bad-crossing" in label:
            color = COLORS["red"]
        else:
            color = action_palette.get(label, COLORS["grey"])
        ax_events.scatter([p[0] for p in records], [yloc[label]] * len(records),
                          s=8, color=color, alpha=0.63, linewidths=0)
    if labels:
        ax_events.set_yticks(range(len(labels)))
        ax_events.set_yticklabels(labels, fontsize=6.7)
        ax_events.set_ylim(-0.65, len(labels) - 0.35)
    else:
        ax_events.text(0.5, 0.5, "No timestamped events", ha="center", va="center",
                       transform=ax_events.transAxes, color=MUTED)
    ax_events.set_xlim(t0, t1)
    ax_events.set_xlabel("Session time (s)")
    ax_events.set_ylabel("Recorded action / note")
    ax_events.set_title("Action-event timeline", loc="left", pad=7)
    ax_events.grid(axis="x", color=GRID, linewidth=0.6)
    ax_events.spines["left"].set_visible(False)
    ax_events.tick_params(axis="y", length=0, pad=4)
    ax_events.tick_params(axis="x", labelsize=7.5, length=2)
    add_panel_label(ax_events, "d")

    fig.text(0.085, 0.035,
             "Cumulative distance is summed from straight-line 3D displacements between recorded path samples; "
             "units are scene units, with no physical scale conversion. Crossing-event points use recorded action labels.",
             fontsize=7.0, color=MUTED)
    save_figure(fig, out / "fig03_path_and_events")

    return {"path_samples": int(len(t)), "path_start_s": t0, "path_end_s": t1,
            "path_distance_u_from_sampled_coordinates": sample_distance,
            "path_distance_u_from_metadata": metadata_distance,
            "path_distance_sample_vs_metadata_delta_pct": distance_delta_pct,
            "event_actions": dict(Counter(str(ev["action"]) for ev in events))}


def plot_image_montage(out: Path, series: list[tuple[float, Path]],
                       title: str, stem: str) -> None:
    indices = representative_indices(len(series), 20)
    ncols = 5
    nrows = int(np.ceil(len(indices) / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(11.2, 2.2 * nrows), squeeze=False)
    fig.subplots_adjust(left=0.025, right=0.99, top=0.90, bottom=0.025,
                        wspace=0.035, hspace=0.12)
    fig.suptitle(title, x=0.025, y=0.97, ha="left", fontsize=13.5, fontweight="bold")
    for ax, i in zip(axes.flat, indices):
        ts, path = series[int(i)]
        with Image.open(path) as image:
            ax.imshow(image.convert("RGB"))
        ax.set_title(f"{ts:.1f} s", fontsize=7.5, loc="left", pad=2)
        ax.set_axis_off()
    for ax in axes.flat[len(indices):]:
        ax.set_axis_off()
    save_figure(fig, out / stem, raster_dpi=220)


def image_profiles(series: list[tuple[float, Path]], height: int = 80) -> tuple[np.ndarray, np.ndarray]:
    profiles = []
    times = []
    for ts, path in series:
        with Image.open(path) as image:
            gray = image.convert("L").resize((96, height), Image.Resampling.BILINEAR)
            array = np.asarray(gray, dtype=float) / 255.0
        profiles.append(np.mean(array, axis=1))
        times.append(ts)
    return np.asarray(times), np.asarray(profiles).T


def plot_image_kymographs(out: Path,
                          series_by_name: list[tuple[str, list[tuple[float, Path]]]]) -> None:
    fig, axes = plt.subplots(len(series_by_name), 1, figsize=(11.4, 6.8), squeeze=False)
    fig.subplots_adjust(left=0.12, right=0.92, top=0.88, bottom=0.11, hspace=0.38)
    fig.suptitle("Image-series temporal projections", x=0.12, y=0.96,
                 ha="left", fontsize=13.5, fontweight="bold")
    for ax, (label, series), panel in zip(axes.flat, series_by_name, ("a", "b")):
        ts, profile = image_profiles(series)
        im = ax.imshow(profile, origin="upper", aspect="auto", interpolation="nearest",
                       extent=(float(ts[0]), float(ts[-1]), 1, 0), cmap="gray",
                       vmin=0, vmax=1)
        ax.set_title(label, loc="left", pad=4)
        ax.set_ylabel("Image height (fraction)")
        ax.set_xlabel("Image timestamp (s)")
        ax.grid(False)
        cb = fig.colorbar(im, ax=ax, pad=0.012, fraction=0.025)
        cb.set_label("Mean grayscale across image width", fontsize=7.3)
        add_panel_label(ax, panel)
    fig.text(0.12, 0.045,
             "Each column is one screenshot reduced to a 96-column-wide image and averaged horizontally; "
             "this is a spatial summary, not pixel tracking.", fontsize=7.2, color=MUTED)
    save_figure(fig, out / "fig06_image_kymographs")


def plot_3d_image_stack(out: Path, series: list[tuple[float, Path]],
                        title: str, stem: str, duration_s: float) -> None:
    if not series:
        return
    indices = representative_indices(len(series), 16)
    selected = [series[int(i)] for i in indices]
    # Make a faux-isometric stack of 2D screenshot planes as one raster layer.
    # This gives the requested time-depth view without millions of 3D mesh
    # faces (and keeps the accompanying vector PDF fast and lightweight).
    plane = 150
    step_x, step_y = 16, 12
    margin_x, margin_y = 28, 30
    dx = step_x * (len(selected) - 1)
    dy = step_y * (len(selected) - 1)
    canvas_w = margin_x * 2 + plane + dx
    canvas_h = margin_y * 2 + plane + dy
    stack = Image.new("RGBA", (canvas_w, canvas_h), "white")
    draw = __import__("PIL.ImageDraw", fromlist=["ImageDraw"]).Draw(stack)

    # Draw late frames first; early frames stay at the front of the projection.
    for rank in range(len(selected) - 1, -1, -1):
        ts, path = selected[rank]
        with Image.open(path) as image:
            image = image.convert("RGB").resize((plane, plane), Image.Resampling.BILINEAR)
        rgb = np.asarray(image, dtype=float) / 255.0
        corners = np.concatenate((rgb[:6, :6].reshape(-1, 3), rgb[:6, -6:].reshape(-1, 3),
                                  rgb[-6:, :6].reshape(-1, 3), rgb[-6:, -6:].reshape(-1, 3)))
        background = np.median(corners, axis=0)
        contrast = np.linalg.norm(rgb - background, axis=2)
        alpha = (np.clip((contrast - 0.025) / 0.13, 0.0, 1.0) * 255).astype(np.uint8)
        rgba = np.dstack((np.asarray(image), alpha)).astype(np.uint8)
        frame = Image.fromarray(rgba, mode="RGBA")
        left = margin_x + rank * step_x
        top = margin_y + dy - rank * step_y
        stack.alpha_composite(frame, (left, top))
        draw.rectangle((left, top, left + plane - 1, top + plane - 1),
                       outline=(45, 57, 71, 170), width=1)
        if rank in {0, len(selected) // 2, len(selected) - 1}:
            draw.text((left + 4, top + 4), f"{ts:.1f} s", fill=(25, 35, 48, 245))

    fig, ax = plt.subplots(figsize=(9.4, 6.3))
    fig.subplots_adjust(left=0.06, right=0.96, top=0.86, bottom=0.13)
    fig.suptitle(title, x=0.06, y=0.96, ha="left", fontsize=13.5, fontweight="bold")
    fig.text(0.06, 0.915,
             f"Isometric time stack · {len(selected)} of {len(series)} timestamped 2D frames · "
             f"{duration_s:.0f} s session",
             fontsize=8.2, color=MUTED)
    ax.imshow(stack, interpolation="nearest")
    ax.set_axis_off()
    # Indicate acquisition-time direction along the receding image stack.
    ax.annotate("time →", xy=(0.91, 0.91), xytext=(0.78, 0.77),
                xycoords="axes fraction", textcoords="axes fraction",
                arrowprops={"arrowstyle": "->", "lw": 1.2, "color": INK},
                fontsize=8.5, color=INK, ha="center")
    fig.text(0.06, 0.055,
             "Illustrative projection of timestamped 2D screenshots; no 3D biological or apparatus volume is inferred.",
             fontsize=7.3, color=MUTED)
    save_figure(fig, out / stem, raster_dpi=240)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session-csv", type=Path, required=True)
    parser.add_argument("--events-csv", type=Path, required=True)
    parser.add_argument("--session-json", type=Path, required=True)
    parser.add_argument("--image-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    for path in (args.session_csv, args.events_csv, args.session_json):
        if not path.is_file():
            raise SystemExit(f"missing input file: {path}")
    if not args.image_dir.is_dir():
        raise SystemExit(f"missing image directory: {args.image_dir}")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    style()

    headers, data, n_rows = read_csv_columns(args.session_csv)
    if "t" not in data or n_rows == 0:
        raise SystemExit("session CSV must contain numeric column 't' and at least one row")
    time = data["t"]
    events = read_events(args.events_csv)
    metadata = json.loads(args.session_json.read_text(encoding="utf-8")).get("meta", {})
    exp_images = image_files(args.image_dir, "ExpImage")
    fly_images = image_files(args.image_dir, "FlyImage")
    if not exp_images or not fly_images:
        raise SystemExit("expected both ExpImage_t...jpg and FlyImage_t...jpg series")

    telemetry = plot_session_telemetry(args.output_dir, time, data, n_rows, metadata)
    named_rates = plot_neural_activity_faceted(args.output_dir, args.session_csv, time, data)
    path_summary = plot_path_and_events(args.output_dir, args.session_json, events)
    plot_image_montage(args.output_dir, exp_images, "Apparatus screenshot series", "fig04_apparatus_montage")
    plot_image_montage(args.output_dir, fly_images, "Fly-brain screenshot series", "fig05_brain_montage")
    plot_image_kymographs(args.output_dir, [("Apparatus image series", exp_images),
                                             ("Fly-brain image series", fly_images)])
    duration = float(np.nanmax(time))
    plot_3d_image_stack(args.output_dir, exp_images, "Apparatus images stacked over time",
                        "fig07_apparatus_stack3d", duration)
    plot_3d_image_stack(args.output_dir, fly_images, "Fly-brain images stacked over time",
                        "fig08_brain_stack3d", duration)

    outputs = sorted(p.name for p in args.output_dir.iterdir() if p.is_file())
    summary = {
        "session_csv": str(args.session_csv), "event_csv": str(args.events_csv),
        "session_json": str(args.session_json), "image_dir": str(args.image_dir),
        "session": {"samples": n_rows, "duration_s": telemetry["duration_s"],
                    "start_s": float(np.nanmin(time)), "end_s": float(np.nanmax(time)),
                    "mode": metadata.get("mode"), "goal": metadata.get("goal"),
                    "column_names": headers},
        "events": {"n_events": len(events), "actions": path_summary["event_actions"]},
        "path": path_summary,
        "images": {"apparatus_frames": len(exp_images), "brain_frames": len(fly_images),
                   "apparatus_time_range_s": [exp_images[0][0], exp_images[-1][0]],
                   "brain_time_range_s": [fly_images[0][0], fly_images[-1][0]],
                   "stack_frames_per_type": 16,
                   "stack_style": "isometric raster projection of timestamped 2D screenshots"},
        "checks": {"median_abs_dT_minus_Tl_minus_Tr": telemetry["median_abs_dT_minus_Tl_minus_Tr"],
                   "plasticity_relative_change_percent": telemetry["plasticity_relative_change_percent"]},
        "named_population_occurrences": named_rates,
        "caveats": ["One session only; figures are descriptive, not population-level inference.",
                    "Abbreviations and units are retained as logged and require simulator-definition verification.",
                    "np1..np5 are ranked slots and may name different populations across samples.",
                    "3D image stacks are timestamped 2D screenshots, not volumetric reconstructions."],
        "outputs": outputs,
    }
    (args.output_dir / "analysis_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    report = [
        "# Fly session figure set",
        "",
        "Descriptive, publication-style plots generated from the supplied single-session export.",
        "",
        f"- **Samples:** {n_rows:,}",
        f"- **Recorded duration:** {telemetry['duration_s']:.2f} s",
        f"- **Mode / goal:** {metadata.get('mode', 'not recorded')} / {metadata.get('goal', 'not recorded')}",
        f"- **Path samples / events:** {path_summary['path_samples']:,} / {len(events):,}",
        f"- **Timestamped images:** {len(exp_images)} apparatus and {len(fly_images)} brain",
        f"- **Median |dT − (Tl − Tr)|:** {telemetry['median_abs_dT_minus_Tl_minus_Tr']:.6g} logged units",
        f"- **Cumulative sampled path distance:** {path_summary['path_distance_u_from_sampled_coordinates']:,.1f} scene units",
        "",
        "## Figures",
        "",
        "- `fig01_session_telemetry`: six aligned time-series panels; 4-s binned means.",
        "- `fig02_neural_activity`: six independent logged-rate time-series axes and a named-population activity heatmap.",
        "- `fig03_path_and_events`: time-coloured top-down path, cumulative sampled 3D distance versus time, vertical position, and timestamped action-event timeline.",
        "- `fig04_apparatus_montage` / `fig05_brain_montage`: representative timestamped image contactsheets.",
        "- `fig06_image_kymographs`: horizontally averaged grayscale profiles through time.",
        "- `fig07_apparatus_stack3d` / `fig08_brain_stack3d`: isometric raster stacks of 16 selected timestamped 2D screenshot planes arranged along acquisition time.",
        "",
        "PNG (300 dpi; image stacks 240 dpi) and vector PDF versions are supplied for every figure.",
        "",
        "## Interpretation limits",
        "",
        "This is one session, so no causal or population-level learning claim is tested here. Column names and units are kept as exported;",
        "ambiguous abbreviations need confirmation from their simulator definitions. The `np1`–`np5` fields are ranked slots and can",
        "change population identity from row to row. The 3D screenshot stacks are visual time displays only, not volumetric reconstructions.",
        "For reproducibility, see `analysis_summary.json` and rerun `tools/plot_fly_session.py` with the original inputs.",
        "",
    ]
    (args.output_dir / "README.md").write_text("\n".join(report), encoding="utf-8")
    print(f"Wrote figures and summary to: {args.output_dir}")
    print(f"Session: {n_rows:,} rows, {telemetry['duration_s']:.1f} s; "
          f"events: {len(events):,}; images: {len(exp_images)} + {len(fly_images)}")


if __name__ == "__main__":
    main()
