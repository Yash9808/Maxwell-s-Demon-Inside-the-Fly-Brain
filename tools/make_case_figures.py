#!/usr/bin/env python3
"""Per-case paper figures from the FRESH seeded E9 batch (research_data/e9_batch_*.jsonl).

For each named case (demon_neural, demon_frozen, demon_speed):
    [ fly-brain panel ]   |   [ learning curve, mean +/- 95% CI over seeds ]

Brain panels render the SAME data and mapping as publication_figures.html
(positions.bin, pathway bundles, figure_rows.json firing vectors, shared
diverging delta scale), offline in matplotlib with a tiny numpy triangle
rasterizer (white background, no GPU). demon_speed has no connectome emitter
(speed-clamped classical policy, no brain in the loop) -> its brain panel is
annotated "no connectome in loop".

Also composes the 2x2 methods overview requested for the paper:
    row 1: [ fly ]            | [ experiment apparatus ]
    row 2: [ live connectome ]| [ learning curve ]
All panels: seaborn style, white + bright.

Outputs (Nature paper/):
  case_demon_neural.png       case_demon_frozen.png      case_demon_speed.png
  fig_methods_overview_2x2.png
  case_data.json              (numbers printed on the curves)
"""
import base64
import json
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import seaborn as sns
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "Nature paper")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- style
sns.set_theme(style="white", context="paper", font_scale=1.05)
plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "axes.edgecolor": "#444444",
    "axes.labelcolor": "#1a1a1a",
    "text.color": "#1a1a1a",
    "xtick.color": "#333333", "ytick.color": "#333333",
    "axes.spines.top": False, "axes.spines.right": False,
    "figure.facecolor": "white", "axes.facecolor": "white",
    "savefig.facecolor": "white",
})
CASE_META = {
    "demon_neural": dict(label="Case 1 — Connectome brain (demon_neural)",
                         accent="#B2182B", has_brain=True),
    "demon_frozen": dict(label="Case 2 — Frozen connectome (demon_frozen)",
                         accent="#2166AC", has_brain=True),
    "demon_speed":  dict(label="Case 3 — Speed-clamped classical (demon_speed)",
                         accent="#DD8452", has_brain=False),
}

# ---------------------------------------------------------------- data
BATCH = sorted(f for f in os.listdir(os.path.join(ROOT, "research_data"))
               if f.startswith("e9_batch_2026") and f.endswith(".jsonl"))[-1]
BATCH_PATH = os.path.join(ROOT, "research_data", BATCH)
print("fresh batch:", BATCH)

rows = []
with open(BATCH_PATH) as f:
    for line in f:
        rows.append(json.loads(line))


def b64(x):
    return np.frombuffer(base64.b64decode(x), dtype=np.uint8)


# learning curves: per-trial-index block means aggregated over seeds
def curve(cond, field="reward", B=4):
    rr = [r for r in rows if r["condition"] == cond]
    seeds = sorted({r["seed"] for r in rr})
    phases = {r["trial"]: r["phase"] for r in rr}
    ntr = max(phases) + 1
    per_seed = np.full((len(seeds), ntr), np.nan)
    for i, sd in enumerate(seeds):
        for r in rr:
            if r["seed"] == sd:
                per_seed[i, r["trial"]] = r[field]
    # block means of consecutive B trials (train blocks then test blocks)
    nblk = ntr // B
    blk = np.full((len(seeds), nblk), np.nan)
    for b in range(nblk):
        blk[:, b] = np.nanmean(per_seed[:, b * B:(b + 1) * B], axis=1)
    m = np.nanmean(blk, axis=0)
    sem = np.nanstd(blk, axis=0, ddof=1) / np.sqrt(len(seeds))
    phases_b = [phases[b * B] for b in range(nblk)]
    return m, sem, phases_b


metrics = {}
for case in CASE_META:
    m, s, ph = curve(case, "reward", B=4)
    acc, accs, _ = curve(case, "decisionAccuracy", B=4)
    def final_test(field):
        cand = [r for r in rows if r["condition"] == case and r["phase"] == "test"]
        top = max(r["trial"] for r in cand)
        vals = [r[field] for r in cand if r["trial"] >= top - 3]
        return float(np.mean(vals)), float(np.std(vals, ddof=1) / np.sqrt(10))
    rw_f, rw_fs = final_test("reward")
    ac_f, ac_fs = final_test("decisionAccuracy")
    metrics[case] = dict(reward=m.tolist(), rewardSem=s.tolist(), rewardFinalTest=rw_f,
                         rewardFinalTestSem=rw_fs,
                         acc=acc.tolist(), accSem=accs.tolist(), accFinalTest=ac_f,
                         accFinalTestSem=ac_fs, phases=ph)

# ---------------------------------------------------------------- brain panels
POS_BIN = os.path.join(ROOT, "fly_brain_positions.bin")
meta = json.load(open(os.path.join(ROOT, "fly_brain_meta.json")))
bdoc = json.load(open(os.path.join(ROOT, "fly_brain_pathway_bundles.json")))
rowsdoc = json.load(open(os.path.join(ROOT, "research_data", "figure_rows.json")))
bundles = bdoc["bundles"]
N = meta["n"]
raw = np.fromfile(POS_BIN, dtype=np.uint8)
pos = raw[: N * 6].copy().view("<i2").reshape(N, 3) / 10.0
prim = raw[N * 6: N * 7]
P = pos

cond = rowsdoc["conditions"]["demon_neural"]
fvE = b64(cond["fireVecEarly"]).astype(float)
fvL = b64(cond["fireVecLate"]).astype(float)
fvM = b64(cond["fireVecMean"]).astype(float)
dN = fvL - fvE
ds = np.abs(dN[dN != 0]).tolist()
for b in cond["bundleDelta"]:
    if b.get("deltaW"):
        ds.append(abs(b["deltaW"]))
DELTA_VMAX = max(np.percentile(ds, 99) if ds else 1.0, 1e-6)

# Figure A view: same canonical frame; x = optic-lobe axis
GROUP_OF = {}
for g, lst in meta["region_of"].items():
    for r in lst:
        GROUP_OF[r] = g
GROUP_COLOR = {"optic": "#4C72B0", "antennal": "#DD8452", "mb": "#55A868",
               "lh": "#8172B3", "cx": "#937860", "motor": "#C44E52",
               "central": "#7F7F7F", "other": "#b0b0b0"}

BPTS = np.fromfile(os.path.join(ROOT, "fly_brain_pathway_bundles.bin"),
                   dtype="<i2").reshape(-1, 3) / 10.0


def chaikin(pts, iters=2):
    for _ in range(iters):
        n = len(pts)
        out = [pts[0]]
        for i in range(n - 1):
            a, b = pts[i], pts[i + 1]
            out.append(0.75 * a + 0.25 * b)
            out.append(0.25 * a + 0.75 * b)
        out.append(pts[-1])
        pts = np.array(out)
    return pts


def div_color(d, vmax):
    from matplotlib.colors import to_rgb
    pos_c, neg_c, mid = np.array(to_rgb("#B2182B")), np.array(to_rgb("#2166AC")), np.array(to_rgb("#CCCCCC"))
    t = np.clip(d / vmax, -1, 1)
    return pos_c * max(t, 0) + neg_c * max(-t, 0) + mid * (1 - abs(t))


NT_COLOR = {"cholinergic": (0.72, 0.60, 0.24), "gabaergic": (0.44, 0.56, 0.74),
            "glutamatergic": (0.52, 0.70, 0.56), "dopaminergic": (0.74, 0.52, 0.68),
            "octopaminergic": (0.79, 0.60, 0.40), "serotonergic": (0.66, 0.57, 0.75),
            "untyped": (0.76, 0.76, 0.76)}

ct_path = os.path.join(ROOT, "fly_brain_celltypes.json")
nt_classes = None
try:
    ct = json.load(open(ct_path))
    nt_classes = [n.get("nt_class", "untyped") for n in ct["neurons"][:N]]
    if len(nt_classes) < N:
        nt_classes = nt_classes + ["untyped"] * (N - len(nt_classes))
except Exception as e:
    print("WARN celltypes unavailable ->", e)


def raster_points(ax, pts, colors, size, elev=18, azim=-58):
    """z-sorted scatter with per-point colors (matplotlib, fast path)."""
    az, el = np.radians(azim), np.radians(elev)
    x, y, z = pts[:, 0], pts[:, 1], pts[:, 2]
    X = x * np.cos(az) + y * np.sin(az)
    Y = -x * np.sin(az) + y * np.cos(az)
    Zr = z * np.cos(el) - Y * np.sin(el)
    Yp = z * np.sin(el) + Y * np.cos(el)
    order = np.argsort(Zr)
    ax.scatter(X[order], Yp[order], s=size, c=colors[order], linewidths=0,
               rasterized=True)


def draw_brain_panel(ax, case, mode):
    ax.set_facecolor("white")
    c = rowsdoc["conditions"].get(case)
    has_brain = CASE_META[case]["has_brain"]
    if not has_brain or c is None or not c.get("fireVecMean"):
        ax.text(0.5, 0.5, "no connectome in loop\n(speed-clamped classical policy)",
                ha="center", va="center", fontsize=11, color="#666666",
                transform=ax.transAxes)
        ax.set_xticks([]); ax.set_yticks([])
        for sp in ax.spines.values():
            sp.set_color("#cccccc")
        return
    fvE = b64(c["fireVecEarly"]).astype(float)
    fvL = b64(c["fireVecLate"]).astype(float)
    fvM = b64(c["fireVecMean"]).astype(float)
    dN = fvL - fvE
    if mode == "live":
        cols = np.array([NT_COLOR.get(t, NT_COLOR["untyped"]) for t in nt_classes])
        cols = np.clip(cols * (0.55 + 0.9 * (fvM / max(fvM.max(), 1)))[:, None], 0, 1)
        sizes = 1.0 + 5.0 * (fvM / max(fvM.max(), 1))
    else:
        cols = np.array([div_color(d, DELTA_VMAX) for d in dN])
        sizes = np.full(N, 2.2)
    # subsample for draw speed, deterministic
    step = max(1, N // 45000)
    raster_points(ax, P[::step], cols[::step], sizes[::step] if mode == "live" else 2.2)
    # pathway bundles
    for bi, b in enumerate(bundles):
        o, n = b["binOffset"], b["binCount"]
        pts = BPTS[o: o + n]
        pts = chaikin(pts, 2)
        if mode == "live":
            bd = c["bundleDelta"][bi]
            act = bd.get("early") or 0
            col = GROUP_COLOR.get(GROUP_OF.get(b["src"], "other"), "#999999")
            alpha = 0.25 + 0.45 * (act / max(1e-9, max(x.get("early") or 0 for x in c["bundleDelta"])))
            lw = 0.4 + 1.5 * np.sqrt(b["synTotal"] / max(x["synTotal"] for x in bundles))
        else:
            bd = c["bundleDelta"][bi]
            d = bd.get("deltaW") or 0
            col = div_color(d, DELTA_VMAX)
            alpha = 0.75
            lw = 0.9
        ls = (0, (4, 2.4)) if b["mod"] else "-"
        ax.plot(pts[:, 0], pts[:, 1], color=col, lw=lw, alpha=alpha, ls=ls, solid_capstyle="round")
    ax.set_aspect("equal")
    ax.set_xticks([]); ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_color("#bbbbbb")
    um = 100 * (bdoc.get("nmPerSceneUnit", 777550.6)) / 1000
    # scale bar pinned to the lower-left of the panel (axes fraction)
    from matplotlib.lines import Line2D
    x0, y0, ln = 0.06, 0.07, 0.16
    tr = ax.transAxes
    ax.add_line(Line2D([x0, x0 + ln], [y0, y0], color="#1a1a1a", lw=1.8,
                       transform=tr, solid_capstyle="butt"))
    ax.text(x0 + ln / 2, y0 + 0.025, f"{um:.0f} \u00b5m", transform=tr,
            ha="center", fontsize=8)


# ---------------------------------------------------------------- compose per-case figures
def learning_panel(ax, case, show_ylabel=True, field="reward"):
    m = np.array(metrics[case][field]); s = np.array(metrics[case][field + "Sem"])
    ph = metrics[case]["phases"]
    x = np.arange(len(m))
    ntr = len(ph)
    split = next((i for i, p in enumerate(ph) if p == "test"), None)
    accent = CASE_META[case]["accent"]
    if split:
        ax.axvspan(split - 0.5, ntr - 0.5, color="#f0f0f0", zorder=0)
    ax.fill_between(x, m - 1.96 * s, m + 1.96 * s, color=accent, alpha=0.18, lw=0)
    ax.plot(x, m, color=accent, lw=1.8, marker="o", ms=3.2, mfc="white", mew=1.2)
    if split:
        import matplotlib.transforms as mtransforms
        tr = mtransforms.blended_transform_factory(ax.transData, ax.transAxes)
        ax.text(split - 0.35, 0.965, "train", transform=tr,
                ha="right", va="top", fontsize=8.5, color="#555555")
        ax.text(split + 0.35, 0.965, "test", transform=tr,
                ha="left", va="top", fontsize=8.5, color="#555555")
    ax.set_xlabel("Training block (4 trials/block)", fontsize=9.5)
    if show_ylabel:
        ax.set_ylabel("Reward per trial" if field == "reward" else "Decision accuracy",
                      fontsize=9.5)
    fr = metrics[case][field + "FinalTest"]; fs = metrics[case][field + "FinalTestSem"]
    ax.annotate(f"final test {fr:.2f} \u00b1 {fs:.2f}",
                xy=(0.98, 0.05), xycoords="axes fraction", ha="right", fontsize=8.5,
                color="#333333")
    ax.tick_params(labelsize=8.5)


from matplotlib.gridspec import GridSpec

for case in CASE_META:
    fig = plt.figure(figsize=(10.6, 4.3), dpi=200)
    gs = GridSpec(1, 2, width_ratios=[1.15, 1], wspace=0.18,
                  left=0.055, right=0.985, top=0.86, bottom=0.13)
    axB = fig.add_subplot(gs[0, 0])
    draw_brain_panel(axB, case, "live")
    ttl = CASE_META[case]["label"]
    if case == "demon_speed":
        axB.set_title("no connectome in loop — classical valve rule drives the demon\n"
                      "(readouts: decision accuracy, spring work; no reward accrual)",
                      fontsize=9.5, color="#333333")
        axB.set_xlabel("")
    else:
        axB.set_title("Fly brain — live firing (FAFB v783, 106,765 neurons)",
                      fontsize=9.5, color="#333333")
    axL = fig.add_subplot(gs[0, 1])
    if case == "demon_speed":
        learning_panel(axL, case, field="acc")
    else:
        learning_panel(axL, case)
    axL.set_title("Learning curve — "
                  + ("reward, mean ± 95% CI (10 seeds)" if case != "demon_speed"
                     else "decision accuracy, mean ± 95% CI (10 seeds)"),
                  fontsize=9.5, color="#333333")
    out = os.path.join(OUT, f"case_{case}.png")
    fig.savefig(out)
    plt.close(fig)
    print("wrote", out)

# ---------------------------------------------------------------- 2x2 methods overview
fig = plt.figure(figsize=(12.6, 8.6), dpi=200)
gs = GridSpec(2, 2, hspace=0.30, wspace=0.16, left=0.06, right=0.985, top=0.90, bottom=0.075)

axA = fig.add_subplot(gs[0, 0])
try:
    d = np.load(os.path.join(ROOT, "_fly_mesh_cache.npz"))
    V, F, C = d["V"].astype(float), d["F"], d["C"]
    # PCA-align the model space to screen axes (the raw model is stored
    # diagonally); deterministic signs chosen for a dorsal-lateral view.
    ctr = (V.max(0) + V.min(0)) / 2
    Vc = V - ctr
    cov = Vc.T @ Vc
    w, U = np.linalg.eigh(cov)
    R = U[:, ::-1]                      # columns = principal axes, descending
    if np.linalg.det(R) < 0:
        R[:, 1] *= -1                   # keep a right-handed frame
    Va = Vc @ R
    span = (Va.max(0) - Va.min(0)).max()
    Vn = Va / span
    # brighten vertex colors, gentle warm shading
    Cb = np.clip(0.35 + 0.85 * C, 0, 1)
    # screen view picked from an 8-view probe sheet: horizontal side profile
    # screen x = principal axis 1, screen y = principal axis 3, depth = axis 2.
    X = Vn[:, 0]
    Yp = Vn[:, 2]
    Zr = Vn[:, 1]
    tri = np.stack([X[F[:, 0]], X[F[:, 1]], X[F[:, 2]],
                    Yp[F[:, 0]], Yp[F[:, 1]], Yp[F[:, 2]],
                    Zr[F[:, 0]], Zr[F[:, 1]], Zr[F[:, 2]]], axis=1)
    tc = Cb[F].mean(axis=1)
    # normal-based shading in SCREEN space (robust to any model orientation)
    P3 = np.stack([X, Yp, Zr], axis=1)
    nrm = np.cross(P3[F[:, 1]] - P3[F[:, 0]], P3[F[:, 2]] - P3[F[:, 0]])
    nn = nrm / (np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9)
    lam = np.clip(nn @ np.array([0.25, 0.35, 0.90]), 0, 1)
    shade = 0.58 + 0.52 * lam
    tcol = np.clip(tc * shade[:, None], 0, 1)
    order = np.argsort(tri[:, 8])
    from matplotlib.collections import PolyCollection
    # tri columns = [X0,X1,X2, Y0,Y1,Y2, Z0,Z1,Z2]. Build vertices by
    # interleaving per corner: vertex k = (X_k, Y_k). A flat reshape here
    # would pair (X0,X1),(X2,Y0),(Y1,Y2) and draw giant wedges instead of
    # triangles. Z columns are for depth sorting only.
    verts = np.stack([tri[order][:, 0:3], tri[order][:, 3:6]], axis=-1)
    pc = PolyCollection(verts, facecolors=tcol[order], edgecolors="none")
    axA.add_collection(pc)
    pad = 0.07
    axA.set_xlim(tri[:, 0:6].min() - pad, tri[:, 0:6].max() + pad)
    axA.set_ylim(tri[:, 0:6].min() - pad, tri[:, 0:6].max() + pad)
except Exception as e:
    print("WARN fly mesh render failed ->", e)
    axA.text(0.5, 0.5, "adult fly (textured model)", ha="center", va="center",
             transform=axA.transAxes, fontsize=11)
axA.set_aspect("equal"); axA.set_xticks([]); axA.set_yticks([])
axA.set_title("The animal — adult Drosophila (textured model)", loc="left",
              fontsize=11, fontweight="bold")
for sp in axA.spines.values():
    sp.set_color("#bbbbbb")

axE = fig.add_subplot(gs[0, 1])
L, H, DH, PEXT = 900.0, 420.0, 240.0, 160.0
axE.add_patch(plt.Rectangle((-L / 2, -H / 2), L, H, fill=False, lw=2.2, ec="#333333"))
axE.plot([0, 0], [-H / 2, -DH / 2], color="#333333", lw=2.2)
axE.plot([0, 0], [DH / 2, H / 2], color="#333333", lw=2.2)
# valve slot
axE.add_patch(plt.Rectangle((-6, -DH / 2), 12, DH, facecolor="#f2d8d8", edgecolor="#8a4040", lw=1.2))
axE.text(0, -DH / 2 - 26, "valve slot (demon acts here)", ha="center", fontsize=8.5, color="#8a4040")
# piston
axE.add_patch(plt.Rectangle((L / 2 - 14, -H / 2), 14, H, facecolor="#d8e2f2", edgecolor="#3a5a8a", lw=1.4))
axE.annotate("piston \u2192 spring \u2192 work W", xy=(L / 2 - 12, -H / 4),
             xytext=(L / 2 + 34, -H / 4), fontsize=8.5, color="#3a5a8a", va="center",
             ha="left",
             arrowprops=dict(arrowstyle="->", color="#3a5a8a", lw=1.1))
# molecules as dots, deterministic rng
rng = np.random.default_rng(11)
px = rng.uniform(-L / 2 + 8, L / 2 - 8, 150)
py = rng.uniform(-H / 2 + 8, H / 2 - 8, 150)
inL = px < 0
axE.scatter(px[inL], py[inL], s=5, color="#D95F02", alpha=0.75, lw=0)
axE.scatter(px[~inL], py[~inL], s=5, color="#1B9E77", alpha=0.75, lw=0)
axE.text(-L / 4, H / 2 - 34, "left chamber  (sensors ch0\u2013ch7)", ha="center", fontsize=8.5, color="#555555")
axE.text(L / 4, H / 2 - 34, "right chamber (piston side)", ha="center", fontsize=8.5, color="#555555")
axE.set_xlim(-L / 2 - 130, L / 2 + 300)
axE.set_ylim(-H / 2 - 70, H / 2 + 70)
axE.set_aspect("equal"); axE.set_xticks([]); axE.set_yticks([])
axE.set_title("The experiment — Maxwell-demon gas chamber", loc="left",
              fontsize=11, fontweight="bold")
for sp in axE.spines.values():
    sp.set_color("#bbbbbb")

axC = fig.add_subplot(gs[1, 0])
draw_brain_panel(axC, "demon_neural", "live")
axC.set_title("The live connectome — FAFB v783 in the loop", loc="left",
              fontsize=11, fontweight="bold")

axD = fig.add_subplot(gs[1, 1])
learning_panel(axD, "demon_neural")
axD.set_title("The learning — reward across training (10 seeds)", loc="left",
              fontsize=11, fontweight="bold")

for lab, ax in zip("abcd", [axA, axE, axC, axD]):
    ax.text(-0.06, 1.06, lab, transform=ax.transAxes, fontsize=15, fontweight="bold")

fig.suptitle("Experimental system — animal, apparatus, connectome, learning",
             x=0.06, ha="left", fontsize=14, fontweight="bold")
out = os.path.join(OUT, "fig_methods_overview_2x2.png")
fig.savefig(out)
plt.close(fig)
print("wrote", out)

# ---------------------------------------------------------------- digest
digest = dict(batch=BATCH, nSeeds=10, blockB=4,
              cases={k: dict(finalTestReward=v["rewardFinalTest"],
                             finalTestRewardSem=v["rewardFinalTestSem"],
                             finalTestAcc=v["accFinalTest"],
                             finalTestAccSem=v["accFinalTestSem"])
                     for k, v in metrics.items()},
              deltaVmax=float(DELTA_VMAX))
with open(os.path.join(OUT, "case_data.json"), "w") as f:
    json.dump(digest, f, indent=2)
print("wrote", os.path.join(OUT, "case_data.json"))
print("ALL DONE")
