#!/usr/bin/env python3
"""
paper_brain_figures.py — brain-level figures (Figs 8–13) for the E1–E11 paper.

All panels are generated from actual experimental outputs:
  raw rows:            paper_v2/raw/E{1..11}_rows*.jsonl
  per-neuron activity: paper_v2/processed/brain/ACT_*.bin (Float32, 106,765 neurons)
  MI:                  paper_v2/processed/brain/MI_E9.json
  cell types:          fly_brain_celltypes.json (Schlegel et al. 2024 annotations)
  anatomy:             fly_brain_positions.json + fly_brain_hulls.json/bin
  behavior/thermo:     paper_v2/analysis/ANALYSIS_RESULTS.json
  preregistration:     PRE_REGISTERED_CRITERIA.json

Rendering notes (documented honestly):
  * Neuron positions are real FAFB v783 coordinates; hull meshes are the real
    neuropil volumes; both live in the app's canonical scene frame (documented in
    fly_demon_3d.html). The 3D panels use a fixed orthographic projection of that
    frame (frontal view: -y right, z up) with depth-coded marker size.
  * fireVec is a sqrt-quantization of spike counts; we plot the decoded counts
    (c = (q/16)^2) as "model neural activity (decoded spike counts / trial)".
  * Cross-hull mesh depth sorting is approximated per-triangle (painter's sort);
    this is a visualization of real geometry, not a full ray-traced renderer.
"""
import os, json, gzip, struct, math, base64
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, Normalize, PowerNorm
from matplotlib.cm import ScalarMappable
from matplotlib.patches import FancyArrowPatch
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIGD = os.path.join(HERE, "figures")
os.makedirs(FIGD, exist_ok=True)

ACT = {}
def load_act(name):
    if name not in ACT:
        with open(os.path.join(HERE, "processed", "brain", name), "rb") as f:
            ACT[name] = np.frombuffer(f.read(), dtype="<f4").copy()
    return ACT[name]

POS = json.load(open(os.path.join(ROOT, "fly_brain_positions.json")))
XYZ = np.stack([np.array(POS["x"], dtype=np.float32),
                np.array(POS["y"], dtype=np.float32),
                np.array(POS["z"], dtype=np.float32)], axis=1)
NPNAMES = POS["np_names"]
PRIM = np.array(POS["primary"], dtype=np.int64)
CT = json.load(open(os.path.join(ROOT, "fly_brain_celltypes.json")))
CT_TYPE = [n.get("cell_type") for n in CT["neurons"]]
ANALYSIS = json.load(open(os.path.join(HERE, "analysis", "ANALYSIS_RESULTS.json")))
PREREG = json.load(open(os.path.join(ROOT, "PRE_REGISTERED_CRITERIA.json")))

# ------------------------------------------------------------------ hull meshes
def load_hulls():
    recs = json.load(open(os.path.join(ROOT, "fly_brain_hulls.json")))
    if isinstance(recs, dict):
        recs = recs.get("hulls", recs.get("records", []))
    if os.path.exists(os.path.join(ROOT, "fly_brain_hulls.bin")):
        binp = os.path.join(ROOT, "fly_brain_hulls.bin")
    else:
        binp = None
    buf = None
    if binp:
        raw = open(binp, "rb").read()
        buf = raw if raw[:2] in (b"\x1f\x8b",) else None
        if raw[:2] == b"\x1f\x8b":
            buf = gzip.decompress(raw)
        else:
            buf = raw
    meshes = {}
    off = 0
    for rec in recs:
        n = int(rec.get("nVerts", rec.get("n", 0)))
        need = n * 6
        if buf is None or off + need > len(buf):
            meshes[rec.get("name", rec.get("np", "?"))] = None
            off = 0
            continue
        arr = np.frombuffer(buf[off:off + need * 2], dtype="<f2").astype(np.float32)
        off += need * 2
        meshes[rec.get("name", rec.get("np", "?"))] = arr.reshape(n, 3)
    return recs, meshes

HULL_RECS, HULL_MESHES = load_hulls()

HULL_STYLE = dict(facecolor="#c9cdd4", edgecolor="#9aa0ab", lw=0.3, alpha=0.16, shade=False)

def poly3d(ax, verts, **kw):
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    if verts is None or len(verts) < 3:
        return
    tris = [verts[i:i + 3] for i in range(0, len(verts) - 2, 3)]
    depth = tris and np.array([t[:, 2].mean() for t in tris])
    order = np.argsort(-depth) if depth is not None else []
    pc = Poly3DCollection([tris[i] for i in order], **kw)
    ax.add_collection3d(pc)

def _proj_ax(ax, brain_xyz, sizes, colors, hull_names=None, view="frontal",
             elev=8, azim=-90, point_alpha=0.9, edge=0.55):
    """Draw hulls + neuron points on a 3D axes in the canonical frame.
    view='zoom' sets data-driven axis limits around the selected points."""
    ax.set_facecolor("#0e1420")
    ax.xaxis.set_pane_color((0, 0, 0, 0)); ax.yaxis.set_pane_color((0, 0, 0, 0))
    ax.zaxis.set_pane_color((0, 0, 0, 0))
    for axis in (ax.xaxis, ax.yaxis, ax.zaxis):
        axis.set_ticks([]); axis.line.set_color((0.3, 0.35, 0.45, 0.4))
    names = hull_names or [r.get("name", r.get("np")) for r in HULL_RECS]
    for nm in names:
        if nm in HULL_MESHES and HULL_MESHES[nm] is not None:
            poly3d(ax, HULL_MESHES[nm], **HULL_STYLE)
    ax.scatter(brain_xyz[:, 0], brain_xyz[:, 1], brain_xyz[:, 2],
               s=sizes, c=colors, depthshade=False, alpha=point_alpha, lw=0)
    if view == "frontal":
        ax.view_init(elev=elev, azim=azim)
    ax.set_box_aspect((1.25, 1.0, 1.0))
    if view == "zoom":
        # data-driven limits around the selected population (5th-95th pct + margin)
        lo = np.percentile(brain_xyz, 5, axis=0) - 60
        hi = np.percentile(brain_xyz, 95, axis=0) + 60
        cx, cy, cz = (lo + hi) / 2
        span = float(max(hi - lo)) / 2
        ax.set_xlim(cx - 1.25 * span, cx + 1.25 * span)
        ax.set_ylim(cy - span, cy + span)
        ax.set_zlim(cz - span, cz + span)
    else:
        lim = 220
        ax.set_xlim(-lim * 1.25, lim * 1.25); ax.set_ylim(-lim, lim); ax.set_zlim(-lim, lim)
    ax.set_xlabel("x (FlyWire, a.u.)", color="#8892a6", labelpad=-8, fontsize=6)
    ax.set_ylabel("y", color="#8892a6", labelpad=-8, fontsize=6)
    ax.set_zlabel("z", color="#8892a6", labelpad=-8, fontsize=6)
    try:
        for t in ax.get_xticklabels() + ax.get_yticklabels() + ax.get_zticklabels():
            t.set_color("#8892a6"); t.set_fontsize(5)
    except Exception:
        pass
    return ax

def _labels_3d(ax):
    for txt, x, y, z in [
        ("AL (antennal lobe)", 60, 30, -120), ("MB (mushroom body)", -20, 90, 60),
        ("CX (central complex)", -10, 0, 60), ("optic lobe", 190, 20, -20)]:
        ax.text(x, y, z, txt, color="#dfe6f2", fontsize=6, style="italic",
                ha="center", zorder=100)

def _src_note(fig, text):
    fig.text(0.005, 0.005, text, fontsize=5.5, color="#5a6473", ha="left", va="bottom")

def savefig(fig, name, provenance):
    fig.savefig(os.path.join(FIGD, name + ".png"), dpi=300, facecolor="white")
    fig.savefig(os.path.join(FIGD, name + ".pdf"), facecolor="white")
    plt.close(fig)
    prov_path = os.path.join(FIGD, "PROVENANCE.json")
    prov = {}
    if os.path.exists(prov_path):
        prov = json.load(open(prov_path))
    prov[name] = provenance
    json.dump(prov, open(prov_path, "w"), indent=1)
    print("saved", name)

ACT_CMAP = LinearSegmentedColormap.from_list("act", ["#0d1321", "#1b3a6b", "#2f8fca", "#8fd3ff"])
DELTA_CMAP = LinearSegmentedColormap.from_list("delta", ["#2166ac", "#4393c3", "#f0f0f0", "#f4a582", "#b2182b"])
AMBER = "#d9930d"; RED = "#c0392b"; BLUE = "#2b6cb0"; GRAY = "#7f8c9a"

NP_3D_LABEL = ["AL_L", "AL_R", "MB_CA_L", "MB_CA_R", "FB", "EB", "PB", "NO", "LO_L", "LO_R",
               "ME_L", "ME_R", "LH_L", "LH_R", "GNG", "SMP_L", "SMP_R", "SLP_L", "SLP_R"]

def top_np_values(vec, k=14, exclude=()):
    """k largest per-neuropil sums of an activity vector."""
    s = {}
    for i in np.nonzero(vec > 0)[0]:
        nm = NPNAMES[PRIM[i]]
        if nm in exclude: continue
        s[nm] = s.get(nm, 0.0) + float(vec[i])
    return sorted(s.items(), key=lambda kv: -kv[1])[:k]

# ============================================================ FIG 8
def figure8():
    act_tr = load_act("ACT_E9_demon_neural_test.bin")
    act_fz = load_act("ACT_E9_demon_frozen_test.bin")
    fig = plt.figure(figsize=(7.2, 6.0))
    gs = fig.add_gridspec(3, 2, height_ratios=[1.45, 1.0, 1.0], hspace=0.45, wspace=0.3)

    # a: whole brain, trained brain (dark 3D); PowerNorm spreads heavy-tailed counts
    axa = fig.add_subplot(gs[0, :], projection="3d")
    sel = np.nonzero(act_tr > 0)[0]
    act_a = act_tr[sel]
    na = PowerNorm(0.35, vmin=0, vmax=act_a.max())
    sz = 1.5 + 22 * (na(act_a))
    _proj_ax(axa, XYZ[sel], sz, ACT_CMAP(na(act_a)), view="frontal")
    _labels_3d(axa)
    axa.set_title("a  Whole connectome-constrained brain — model neural activity (trained brain, test phase)",
                  color="#e8edf5", fontsize=8, loc="left", pad=2)
    cb = fig.colorbar(ScalarMappable(na, ACT_CMAP), ax=axa,
                      fraction=0.03, pad=0.02)
    cb.set_label("decoded spike counts / trial", fontsize=6, color="#8892a6")
    cb.ax.tick_params(labelsize=5, colors="#8892a6"); cb.outline.set_color("#44506a")

    # b: trained vs c: frozen, zoomed to informative neuropils
    lab = top_np_values(act_tr, k=12)
    keep = [nm for nm, _ in lab]
    selb = np.isin([NPNAMES[PRIM[i]] for i in sel], keep)
    axb = fig.add_subplot(gs[1, 0], projection="3d")
    sel_b = sel[selb]; act_b = act_tr[sel_b]
    nb = PowerNorm(0.35, vmin=0, vmax=act_b.max())
    _proj_ax(axb, XYZ[sel_b], 1.5 + 20 * nb(act_b), ACT_CMAP(nb(act_b)),
             hull_names=keep, view="zoom")
    axb.set_title("b  Trained brain — zoom: most-active neuropils", color="#e8edf5", fontsize=7.5, loc="left", pad=0)
    axc = fig.add_subplot(gs[1, 1], projection="3d")
    fz_idx = np.nonzero(act_fz > 0)[0]
    keepfz = [nm for nm, _ in top_np_values(act_fz, k=12)]
    sel_c = fz_idx[np.isin([NPNAMES[PRIM[i]] for i in fz_idx], keepfz)]
    act_c = act_fz[sel_c]
    nc = PowerNorm(0.35, vmin=0, vmax=act_c.max())
    _proj_ax(axc, XYZ[sel_c], 1.5 + 20 * nc(act_c), ACT_CMAP(nc(act_c)),
             hull_names=keepfz, view="zoom")
    axc.set_title("c  Frozen-control brain — zoom: most-active neuropils", color="#e8edf5", fontsize=7.5, loc="left", pad=0)

    # d: region-level quantification (white panel)
    axd = fig.add_subplot(gs[2, :]); axd.set_facecolor("white")
    tr_np = dict(top_np_values(act_tr, k=10)); fz_np = dict(top_np_values(act_fz, k=10))
    names = list(dict.fromkeys(list(tr_np.keys()) + list(fz_np.keys())))[:10]
    w = 0.38; xs = np.arange(len(names))
    axd.bar(xs - w/2, [tr_np.get(n, 0) for n in names], w, color=RED, label="trained (learning on)")
    axd.bar(xs + w/2, [fz_np.get(n, 0) for n in names], w, color=BLUE, label="frozen (learning off)")
    axd.set_xticks(xs); axd.set_xticklabels(names, fontsize=6)
    axd.set_ylabel("region model activity\n(decoded counts / trial)", fontsize=7)
    axd.legend(fontsize=6, frameon=False); axd.tick_params(labelsize=6)
    axd.set_title("d  Region-level activity: trained vs frozen (E9, 10 seeds, test phase)", fontsize=8, loc="left")
    for s in ("top", "right"): axd.spines[s].set_visible(False)

    _src_note(fig, "Data: E9 raw rows (n=10 seeds/condition); per-neuron model spike counts decoded from fireVec; "
                   "anatomy: FAFB v783 positions + 46 neuropil hull meshes (canonical frame). Connectome-constrained "
                   "MODEL neural activity — not biological recordings.")
    fig.suptitle("Figure 8 — Brain outcome: 3D anatomy with simulated neural activity",
                 fontsize=10, y=0.985, color="#111")
    fig.patch.set_facecolor("#0e1420")
    fig.savefig(os.path.join(FIGD, "figure8_brain_activity.png"), dpi=300,
                facecolor="#0e1420")
    fig.savefig(os.path.join(FIGD, "figure8_brain_activity.pdf"), facecolor="#0e1420")
    plt.close(fig)
    prov = {"panels": {"a": "E9 demon_neural test-phase per-neuron decoded activity on FAFB anatomy (3D)",
                        "b": "E9 demon_neural zoom: 12 most-active neuropils",
                        "c": "E9 demon_frozen zoom: 12 most-active neuropils",
                        "d": "E9 top-10 neuropil sums, trained vs frozen (10 seeds)"},
            "data": ["raw/E9_rows.jsonl", "processed/brain/ACT_E9_*.bin",
                     "fly_brain_positions.json", "fly_brain_hulls.json/bin"],
            "window": "test phase, seeds 1..10"}
    prov["figure8_brain_activity"] = prov.pop("panels")
    _savefig_factory()(fig, "figure8_brain_activity", prov)  # provenance only; dark files already saved

# ============================================================ FIG 9
def figure9():
    act_tr = load_act("ACT_E9_demon_neural_test.bin")
    fig = plt.figure(figsize=(7.2, 5.4))
    gs = fig.add_gridspec(2, 2, height_ratios=[1.2, 1.0], hspace=0.5, wspace=0.35)
    axa = fig.add_subplot(gs[0, 0], projection="3d")
    sel = np.nonzero(act_tr > 0)[0]
    act_a = act_tr[sel]
    na9 = PowerNorm(0.35, vmin=0, vmax=act_a.max())
    _proj_ax(axa, XYZ[sel], 1.5 + 22 * na9(act_a), ACT_CMAP(na9(act_a)))
    axa.set_title("a  All neurons that fired (trained, test)", color="#e8edf5", fontsize=7.5, loc="left", pad=0)

    axb = fig.add_subplot(gs[0, 1], projection="3d")
    top_i = sel[np.argsort(-act_a)[:800]]
    act_t = act_tr[top_i]
    nb9 = PowerNorm(0.35, vmin=0, vmax=act_t.max())
    _proj_ax(axb, XYZ[top_i], 3 + 26 * nb9(act_t), ACT_CMAP(nb9(act_t)),
             hull_names=NP_3D_LABEL)
    axb.set_title("b  Top 800 most-active identified neurons", color="#e8edf5", fontsize=7.5, loc="left", pad=0)

    # c: cell-type composition of the most-active neurons (white)
    axc = fig.add_subplot(gs[1, 0]); axc.set_facecolor("white")
    order = np.argsort(-act_tr)[:600]
    from collections import Counter
    cc = Counter((CT_TYPE[i] or "unannotated", NPNAMES[PRIM[i]]) for i in order)
    top = cc.most_common(12)
    axc.barh(range(len(top)), [c for _, c in top], color=AMBER)
    axc.set_yticks(range(len(top)))
    axc.set_yticklabels([f"{t} @ {nm}" for (t, nm), _ in top], fontsize=5.5)
    axc.invert_yaxis(); axc.set_xlabel("neurons in top-600 activity", fontsize=6)
    axc.tick_params(labelsize=5.5)
    for s in ("top", "right"): axc.spines[s].set_visible(False)
    axc.set_title("c  Cell types of the most-active neurons (Schlegel-2024 annotations)", fontsize=7.5, loc="left")

    # d: AL zoom — the dominant informative region
    axd = fig.add_subplot(gs[1, 1], projection="3d")
    al_idx = sel[np.isin([NPNAMES[PRIM[i]] for i in sel], ["AL_L", "AL_R"])]
    act_al = act_tr[al_idx]
    nd9 = PowerNorm(0.35, vmin=0, vmax=act_al.max())
    _proj_ax(axd, XYZ[al_idx], 2 + 26 * nd9(act_al), ACT_CMAP(nd9(act_al)),
             hull_names=["AL_L", "AL_R"], view="zoom")
    axd.set_title("d  Antennal-lobe zoom: sensory input region (ORN-driven)", color="#e8edf5",
                  fontsize=7.5, loc="left", pad=0)
    _src_note(fig, "Data: E9 raw rows, per-neuron decoded model spike counts; cell types from repository "
                   "annotations (Schlegel et al. 2024, FAFB v783). Activity differences between conditions are "
                   "OBSERVED; causal claims would require ablation/intervention, which E1–E11 do not perform.")
    fig.suptitle("Figure 9 — Which neurons fired (connectome-constrained model states)",
                 fontsize=10, y=0.99, color="#111")
    fig.patch.set_facecolor("#0e1420")
    for ext, fc in (("png", "#0e1420"), ("pdf", "#0e1420")):
        fig.savefig(os.path.join(FIGD, f"figure9_which_neurons.{ext}"), dpi=300, facecolor=fc)
    plt.close(fig)
    prov = {"panels": {"a": "all firing neurons, trained brain, test phase (3D)",
                       "b": "top-800 most-active neurons on hulls",
                       "c": "cell-type composition of top-600",
                       "d": "AL zoom (sensory input)"},
            "data": ["raw/E9_rows.jsonl", "processed/brain/ACT_E9_demon_neural_test.bin",
                     "fly_brain_celltypes.json", "fly_brain_positions.json", "fly_brain_hulls.json/bin"]}
    savefig = _savefig_factory()
    savefig(fig, "figure9_which_neurons", prov)

def _savefig_factory():
    def f(fig, name, prov):
        prov_path = os.path.join(FIGD, "PROVENANCE.json")
        p = json.load(open(prov_path)) if os.path.exists(prov_path) else {}
        p[name] = prov
        json.dump(p, open(prov_path, "w"), indent=1)
        print("provenance saved:", name)
    return f

# ============================================================ FIG 10
def figure10():
    tr_e = load_act("ACT_E9_demon_neural_early.bin")
    tr_l = load_act("ACT_E9_demon_neural_late.bin")
    delta = tr_l - tr_e
    fig = plt.figure(figsize=(7.2, 6.2))
    gs = fig.add_gridspec(3, 2, height_ratios=[1.0, 1.0, 0.9], hspace=0.5, wspace=0.3)

    for col, (vec, ttl) in enumerate([(tr_e, "a  Early brain state (train trials 0–4)"),
                                      (tr_l, "b  Late brain state (remaining train trials)")]):
        ax = fig.add_subplot(gs[0, col], projection="3d")
        sel = np.nonzero(vec > 0)[0]
        v = vec[sel]
        _proj_ax(ax, XYZ[sel], 1.5 + 22 * (v / max(v.max(), 1e-9)), ACT_CMAP(v / max(v.max(), 1e-9)))
        ax.set_title(ttl, color="#e8edf5", fontsize=7.5, loc="left", pad=0)

    axc = fig.add_subplot(gs[1, :], projection="3d")
    sel = np.nonzero(np.abs(delta) > 0)[0]
    d = delta[sel]
    nrm = Normalize(-np.abs(d).max(), np.abs(d).max())
    _proj_ax(axc, XYZ[sel], 1.5 + 22 * (np.abs(d) / np.abs(d).max()), DELTA_CMAP(nrm(d)))
    axc.set_title("c  Learning delta = late − early model activity (per neuron)", color="#e8edf5",
                  fontsize=7.5, loc="left", pad=0)
    cb = fig.colorbar(ScalarMappable(nrm, DELTA_CMAP), ax=axc, fraction=0.03, pad=0.02)
    cb.set_label("Δ decoded counts / trial", fontsize=6, color="#8892a6")
    cb.ax.tick_params(labelsize=5, colors="#8892a6"); cb.outline.set_color("#44506a")

    axd = fig.add_subplot(gs[2, 0]); axd.set_facecolor("white")
    axd.hist(np.abs(delta[delta != 0]), bins=60, color=AMBER)
    axd.set_xlabel("|learning delta| (counts/trial)", fontsize=6.5)
    axd.set_ylabel("neurons", fontsize=6.5); axd.tick_params(labelsize=6)
    for s in ("top", "right"): axd.spines[s].set_visible(False)
    axd.set_title("d  Distribution of |learning delta|", fontsize=7.5, loc="left")

    axe = fig.add_subplot(gs[2, 1]); axe.set_facecolor("white")
    tops = top_np_values(np.abs(delta), k=10)
    axe.barh([nm for nm, _ in tops][::-1], [v for _, v in tops][::-1], color=RED)
    axe.set_xlabel("Σ|Δ| per region (a.u.)", fontsize=6.5); axe.tick_params(labelsize=6)
    for s in ("top", "right"): axe.spines[s].set_visible(False)
    axe.set_title("e  Regions ranked by learning-delta magnitude", fontsize=7.5, loc="left")

    _src_note(fig, "Data: E9 raw rows (demon_neural, 10 seeds); windows: early = train trials 0–4, late = "
                   "remaining train trials (E9 lacks a separate test-window distinction for this figure's "
                   "early/late split). Per-neuron decoded model spike counts on FAFB v783 anatomy. "
                   "OBSERVED activity change; not a biological measurement.")
    fig.suptitle("Figure 10 — Brain-level learning deltas (where learning changed model neural state)",
                 fontsize=10, y=0.99, color="#111")
    fig.patch.set_facecolor("#0e1420")
    for ext in ("png", "pdf"):
        fig.savefig(os.path.join(FIGD, f"figure10_learning_delta.{ext}"), dpi=300, facecolor="#0e1420")
    plt.close(fig)
    prov = {"panels": {"a": "early-window activity (3D)", "b": "late-window activity (3D)",
                       "c": "per-neuron learning delta on anatomy",
                       "d": "|delta| distribution", "e": "regions ranked by delta"},
            "data": ["raw/E9_rows.jsonl", "processed/brain/ACT_E9_demon_neural_early.bin",
                     "processed/brain/ACT_E9_demon_neural_late.bin", "fly_brain_positions.json",
                     "fly_brain_hulls.json/bin"],
            "definition": "learning delta = late − early per-neuron decoded spike counts, seed-averaged"}
    _savefig_factory()(fig, "figure10_learning_delta", prov)

# ============================================================ FIG 11
def figure11():
    MI = json.load(open(os.path.join(HERE, "processed", "brain", "MI_E9.json")))
    # E9 rows carry decisionAccuracy (per-episode), not a boolean success flag;
    # the exported MI variable is 'decisionAboveChance' (accuracy > 0.5 per episode).
    beh = MI["behavior"]["decisionAboveChance"]["demon_neural"]["neuropils"]
    beh_fz = MI["behavior"]["decisionAboveChance"].get("demon_frozen", {}).get("neuropils", {})
    items = sorted(beh.items(), key=lambda kv: -kv[1]["mean"])[:12]
    names = [k for k, _ in items]
    m = np.array([v["mean"] for _, v in items])
    sd = np.array([v["sd"] for _, v in items])
    n = np.array([v["nSeeds"] for _, v in items])
    fig = plt.figure(figsize=(7.2, 4.6))
    gs = fig.add_gridspec(1, 2, width_ratios=[1.15, 1.0], wspace=0.35)

    axa = fig.add_subplot(gs[0, 0]); axa.set_facecolor("white")
    y = np.arange(len(names))[::-1]
    axa.errorbar(m, y, xerr=sd / np.sqrt(n), fmt="o", color=AMBER, ecolor=AMBER,
                 capsize=2, ms=4, lw=1)
    axa.set_yticks(y); axa.set_yticklabels(names, fontsize=6.5)
    axa.set_xlabel("MI(model region state → above-chance decision episode)  bits", fontsize=6.5)
    axa.tick_params(labelsize=6)
    for s in ("top", "right"): axa.spines[s].set_visible(False)
    axa.set_title("a  Neural mutual information by region (trained brain, E9)", fontsize=8, loc="left")

    axb = fig.add_subplot(gs[0, 1], projection="3d")
    sel = np.isin([NPNAMES[PRIM[i]] for i in range(len(PRIM))], names)
    idx = np.nonzero(sel)[0]
    vals = np.array([beh.get(NPNAMES[PRIM[i]], {}).get("mean", 0.0) for i in idx])
    _proj_ax(axb, XYZ[idx], 1.0 + 20 * (vals / max(vals.max(), 1e-9)), ACT_CMAP(vals / max(vals.max(), 1e-9)),
             hull_names=NP_3D_LABEL)
    axb.set_title("b  MI mapped onto brain regions", color="#e8edf5", fontsize=7.5, loc="left", pad=0)
    cb = fig.colorbar(ScalarMappable(Normalize(0, max(vals.max(), 1e-9)), ACT_CMAP), ax=axb,
                      fraction=0.03, pad=0.02)
    cb.set_label("MI (bits)", fontsize=6, color="#8892a6")
    cb.ax.tick_params(labelsize=5, colors="#8892a6"); cb.outline.set_color("#44506a")

    _src_note(fig, "MI(model neuropil state → binarized behavior; behavior variable = per-episode decision "
                   "accuracy above chance): binarized (median-split region activity, binary behavior), "
                   "Miller–Madow bias-corrected plug-in estimator; per-seed estimates (n = 10 seeds shown as "
                   "mean ± SEM). OBSERVED statistical association in the model; not evidence of biological "
                   "information encoding.")
    fig.suptitle("Figure 11 — Neural mutual information and its anatomical distribution",
                 fontsize=10, y=0.99, color="#111")
    fig.patch.set_facecolor("#0e1420")
    for ext in ("png", "pdf"):
        fig.savefig(os.path.join(FIGD, f"figure11_neural_mi.{ext}"), dpi=300, facecolor="#0e1420")
    plt.close(fig)
    prov = {"panels": {"a": "top-12 neuropil MI(model state -> above-chance decision episode), mean ± SEM over 10 seeds",
                       "b": "same MI values rendered on FAFB anatomy"},
            "data": ["raw/E9_rows.jsonl", "processed/brain/MI_E9.json", "fly_brain_positions.json",
                     "fly_brain_hulls.json/bin"],
            "estimator": "2x2 plug-in MI, Miller-Madow bias correction, per-seed replication"}
    _savefig_factory()(fig, "figure11_neural_mi", prov)

# ============================================================ FIG 12
def figure12():
    fig = plt.figure(figsize=(7.2, 5.0))
    gs = fig.add_gridspec(2, 2, hspace=0.55, wspace=0.3)

    # a: E9 learning curves (all seeds + mean) — decision accuracy over episodes
    axa = fig.add_subplot(gs[0, 0]); axa.set_facecolor("white")
    rows = []
    with open(os.path.join(HERE, "raw", "E9_rows.jsonl")) as f:
        for l in f:
            r = json.loads(l)
            if r["condition"] == "demon_neural" and r["phase"] == "train" and r.get("decisionAccuracy") is not None:
                rows.append(r)
    curve = {}
    for r in rows:
        curve.setdefault(r["seed"], []).append((r["trial"], r["decisionAccuracy"]))
    for seed in sorted(curve):
        ep = sorted(curve[seed])
        xs = [e for e, _ in ep]; ys = [v for _, v in ep]
        axa.plot(xs, ys, color=RED, alpha=0.25, lw=0.7)
    seeds = sorted(curve)
    ep_max = max(max(e for e, _ in curve[s]) for s in seeds)
    grid = np.arange(0, ep_max + 1)
    mat = np.full((len(seeds), len(grid)), np.nan)
    for si, s in enumerate(seeds):
        for e, v in curve[s]:
            mat[si, e] = v
    mean = np.nanmean(mat, axis=0)
    axa.plot(grid, mean, color=RED, lw=2, label="mean (n=10 seeds)")
    axa.axhline(0.5, color=GRAY, ls=":", lw=1)
    axa.text(ep_max * 0.99, 0.505, "chance", color=GRAY, fontsize=5.5, ha="right")
    axa.set_xlabel("training episode", fontsize=7); axa.set_ylabel("decision accuracy", fontsize=7)
    axa.tick_params(labelsize=6); axa.legend(fontsize=5.5, frameon=False)
    for s_ in ("top", "right"): axa.spines[s_].set_visible(False)
    axa.set_title("a  E9 pressure demon: learning curve (individual seeds + mean)", fontsize=8, loc="left")

    # b: E3 door-task learning curve (open fraction, per seed + mean)
    axb = fig.add_subplot(gs[0, 1]); axb.set_facecolor("white")
    rows = []
    with open(os.path.join(HERE, "raw", "E3_rows.jsonl")) as f:
        for l in f:
            r = json.loads(l)
            if r["condition"] in ("drosophila", "drosophila_frozen"):
                rows.append(r)
    by = {}
    for r in rows:
        by.setdefault((r["condition"], r["trial"]), []).append(r["openFraction"])
    trs = sorted(set(t for (_, t) in by))
    for cond, col in (("drosophila", RED), ("drosophila_frozen", BLUE)):
        means = [np.mean(by[(cond, t)]) for t in trs if (cond, t) in by]
        tlist = [t for t in trs if (cond, t) in by]
        axb.plot(tlist, means, color=col, lw=1.5,
                 label=f"{cond} (n=2 seeds)")
    axb.set_xlabel("trial", fontsize=7); axb.set_ylabel("door-open fraction", fontsize=7)
    axb.tick_params(labelsize=6); axb.legend(fontsize=5.5, frameon=False)
    for s_ in ("top", "right"): axb.spines[s_].set_visible(False)
    axb.set_title("b  E3 door task: policy trajectory (learning collapses policy shut)", fontsize=8, loc="left")

    # c: E10/E11 learning curves (accuracy over episodes)
    axc = fig.add_subplot(gs[1, 0]); axc.set_facecolor("white")
    for fname, cond, col, lbl in (("E10_rows.jsonl", "trapdoor_neural", RED, "E10 trapdoor (neural)"),
                                  ("E11_rows.jsonl", "ratchet_neural", AMBER, "E11 ratchet (neural)")):
        if not os.path.exists(os.path.join(HERE, "raw", fname)):
            continue
        eps = {}
        with open(os.path.join(HERE, "raw", fname)) as f:
            for l in f:
                r = json.loads(l)
                if r["condition"] != cond or r["phase"] != "train" or r.get("decisionAccuracy") is None:
                    continue
                eps.setdefault(r["trial"], []).append(r["decisionAccuracy"])
        if eps:
            es = sorted(eps)
            axc.plot(es, [np.mean(eps[e]) for e in es], color=col, lw=1.5, label=lbl)
    axc.axhline(0.5, color=GRAY, ls=":", lw=1)
    axc.set_xlabel("training episode", fontsize=7); axc.set_ylabel("decision accuracy", fontsize=7)
    axc.tick_params(labelsize=6); axc.legend(fontsize=5.5, frameon=False)
    for s_ in ("top", "right"): axc.spines[s_].set_visible(False)
    axc.set_title("c  E10/E11 apparatus tasks: decision accuracy during training", fontsize=8, loc="left")

    # d: demon-agreement metric definition panel (E1 field demonAgree)
    axd = fig.add_subplot(gs[1, 1]); axd.set_facecolor("white")
    rows = []
    with open(os.path.join(HERE, "raw", "E1_rows.jsonl")) as f:
        for l in f:
            r = json.loads(l)
            if r["condition"] == "budget_model":
                rows.append(r)
    tr = [r for r in rows if r["phase"] == "train"]
    xs = sorted(set(r["trial"] for r in tr))
    per = {}
    for r in tr:
        per.setdefault(r["trial"], []).append(r["demonAgree"])
    axd.plot(xs, [np.mean(per[x]) for x in xs], color=AMBER, lw=1.5)
    axd.set_xlabel("training trial", fontsize=7)
    axd.set_ylabel("demon agreement\n(model vs ideal demon policy)", fontsize=7)
    axd.tick_params(labelsize=6)
    for s_ in ("top", "right"): axd.spines[s_].set_visible(False)
    axd.set_title("d  Demon-agreement metric (E1; defined in Methods/legend)", fontsize=8, loc="left")

    _src_note(fig, "All curves: per-seed replicate trajectories plus population mean; independent replicate = seed. "
                   "demonAgree = fraction of trials where the agent's gate decision matches the information-ideal "
                   "demon policy (exact definition in Methods §Demon-agreement metric).")
    fig.suptitle("Figure 12 — Learning curves and demon-agreement across the program",
                 fontsize=10, y=0.99, color="#111")
    fig.patch.set_facecolor("white")
    for ext in ("png", "pdf"):
        fig.savefig(os.path.join(FIGD, f"figure12_learning_curves.{ext}"), dpi=300, facecolor="white")
    plt.close(fig)
    prov = {"panels": {"a": "E9 decisionAccuracy over episodes, 10 seed replicates + mean",
                       "b": "E3 openFraction per trial, both learning conditions",
                       "c": "E10/E11 decisionAccuracy over episodes",
                       "d": "E1 demonAgree over training trials"},
            "data": ["raw/E9_rows.jsonl", "raw/E3_rows.jsonl", "raw/E10_rows.jsonl",
                     "raw/E11_rows.jsonl", "raw/E1_rows.jsonl"]}
    _savefig_factory()(fig, "figure12_learning_curves", prov)

# ============================================================ FIG 13
def figure13():
    fig = plt.figure(figsize=(7.2, 5.6))
    gs = fig.add_gridspec(2, 2, hspace=0.55, wspace=0.35)

    # a: predictions vs observations (preregistered contrasts)
    axa = fig.add_subplot(gs[0, :]); axa.set_facecolor("white")
    # verdict -> category: +1 = as predicted, 0 = direction only / not evaluable, -1 = opposite
    def cat_of(verdict):
        v = (verdict or "")
        if v.startswith("SUCCESS"):
            return 1
        return 0  # DIRECTION_ONLY / DEGENERATE / thermodynamic-negligibility gates
    # preregistered primary endpoints -> (a, b) arm pair of the matching comparison
    pred_rows = [
        ("E3", "drosophila", "drosophila_frozen"),
        ("E4", "connectome_4A", "connectome_4C"),
        ("E9", "demon_neural", "demon_frozen"),
        ("E10", "trapdoor_neural", "trapdoor_frozen"),
        ("E11", "ratchet_neural", "ratchet_frozen"),
    ]
    AEX = ANALYSIS["experiments"]
    labels, cats, pvals, verd = [], [], [], []
    for ex, a, b in pred_rows:
        got = None
        for c in AEX[ex].get("comparisons", []):
            if c.get("a") == a and c.get("b") == b:
                got = c
                break
        if got is None:
            labels.append(f"{ex}: {a} - {b} (preregistered primary)")
            cats.append(0); pvals.append(None); verd.append("NOT EVALUATED (no matching comparison)")
            continue
        labels.append(f"{ex}: {got['metric']} ({a} - {b})")
        cats.append(cat_of(got.get("verdict")))
        pvals.append(got.get("p_bh"))
        verd.append(got.get("verdict") or "")
    y = np.arange(len(labels))
    colmap = {1: "#2e7d4f", 0: "#8a94a6", -1: "#b0433a"}
    axa.barh(y, [cats[i] for i in range(len(labels))],
             color=[colmap[cats[i]] for i in range(len(labels))], alpha=0.9, height=0.55)
    for i in range(len(labels)):
        if pvals[i] is not None:
            axa.text(cats[i] + (0.05 if cats[i] >= 0 else -0.05), i,
                     f"p_BH={pvals[i]:.3f}  {verd[i][:58]}",
                     va="center", ha="left" if cats[i] >= 0 else "right", fontsize=5.8, color="#333")
        else:
            axa.text(0.05, i, verd[i], va="center", ha="left", fontsize=5.8, color="#333")
    axa.set_yticks(y); axa.set_yticklabels(labels, fontsize=6.5)
    axa.axvline(0, color="k", lw=0.8)
    axa.set_xlim(-1.35, 1.35)
    axa.set_xticks([-1, 0, 1])
    axa.set_xticklabels(["opposite to\nprediction", "direction only /\nnot evaluable", "as\npredicted"], fontsize=6.5)
    for s_ in ("top", "right", "left"): axa.spines[s_].set_visible(False)
    axa.set_title("a  Preregistered primary endpoints vs observed verdicts (this paper-program run)",
                  fontsize=8, loc="left")

    # b: thermodynamic budget (E1): information vs energy, explicit distinction
    axb = fig.add_subplot(gs[1, 0]); axb.set_facecolor("white")
    rows = []
    with open(os.path.join(HERE, "raw", "E1_rows.jsonl")) as f:
        for l in f:
            r = json.loads(l)
            if r["condition"] == "budget_model":
                rows.append(r)
    te = [r for r in rows if r["phase"] == "test"]
    tr = [r for r in rows if r["phase"] == "train"]
    import math
    def mn(rs, k): return float(np.mean([r[k] for r in rs])) if rs else float("nan")
    cats = ["jet work\n(thermo, J)", "erasure cost\n(thermo, J)", "extractable\n(thermo, J)"]
    tr_vals = [mn(tr, "workInJ"), mn(tr, "erasureCostJ"), mn(tr, "extractableJ")]
    te_vals = [mn(te, "workInJ"), mn(te, "erasureCostJ"), mn(te, "extractableJ")]
    xs = np.arange(3); w = 0.38
    axb.bar(xs - w/2, tr_vals, w, color=RED, label="train")
    axb.bar(xs + w/2, te_vals, w, color=BLUE, label="test")
    axb.set_yscale("log")
    axb.set_xticks(xs); axb.set_xticklabels(cats, fontsize=6)
    axb.set_ylabel("energy (J, log scale)", fontsize=7)
    axb.legend(fontsize=5.5, frameon=False); axb.tick_params(labelsize=6)
    for s_ in ("top", "right"): axb.spines[s_].set_visible(False)
    axb.set_title("b  E1 thermodynamic budget terms (model quantities)", fontsize=8, loc="left")

    # c: crossing ledger (good/bad counts per experiment, test phase)
    axc = fig.add_subplot(gs[1, 1]); axc.set_facecolor("white")
    led = []
    for ex in ("E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"):
        fp = os.path.join(HERE, "raw", f"{ex}_rows.jsonl")
        if not os.path.exists(fp):
            continue
        g = b = 0
        with open(fp) as f:
            for l in f:
                r = json.loads(l)
                if r.get("phase") != "test":
                    continue
                g += r.get("goodCrossings", 0) or 0
                b += r.get("badCrossings", 0) or 0
        led.append((ex, g, b))
    xs = np.arange(len(led)); w = 0.38
    axc.bar(xs - w/2, [g for _, g, b in led], w, color="#2e8b57", label="good")
    axc.bar(xs + w/2, [b for _, g, b in led], w, color="#b04a3a", label="bad")
    axc.set_xticks(xs); axc.set_xticklabels([e for e, _, _ in led], fontsize=6)
    axc.set_ylabel("crossing events (test phase, summed)", fontsize=7)
    axc.legend(fontsize=5.5, frameon=False); axc.tick_params(labelsize=6)
    for s_ in ("top", "right"): axc.spines[s_].set_visible(False)
    axc.set_title("c  Crossing ledger: good vs bad crossings (E1–E8)", fontsize=8, loc="left")

    _src_note(fig, "a: preregistered primary endpoints (PRE_REGISTERED_CRITERIA.json, committed before the "
                   "validation campaigns) mapped to the observed verdicts of this paper-program run. Verdict "
                   "categories follow the analysis gates: SUCCESS / SUCCESS_SMALL_EFFECT = as predicted; "
                   "DIRECTION_ONLY, DEGENERATEcontrast, and thermodynamic-negligibility gates = not evaluable "
                   "as positive evidence. b: model energetic quantities from E1 ledger (workInJ = jet/pump work; "
                   "erasureCostJ = Landauer-bounded erasure accounting; extractableJ = extractable work from the "
                   "sorted gradient). c: good = hot->cold (down-gradient) crossings, bad = cold->hot, summed over "
                   "test-phase trials. All quantities are MODEL quantities; no thermodynamic claim is made about "
                   "biological tissue.")
    fig.suptitle("Figure 13 — Preregistered predictions, thermodynamic budget, and crossing ledger",
                 fontsize=10, y=0.99, color="#111")
    fig.patch.set_facecolor("white")
    for ext in ("png", "pdf"):
        fig.savefig(os.path.join(FIGD, f"figure13_predictions_budget_ledger.{ext}"), dpi=300, facecolor="white")
    plt.close(fig)
    prov = {"panels": {"a": "preregistered primary endpoints vs observed sign",
                       "b": "E1 thermodynamic budget (jet work, erasure, extractable; log scale)",
                       "c": "good/bad crossing ledger E1–E8 (test phase)"},
            "data": ["PRE_REGISTERED_CRITERIA.json", "raw/E1_rows.jsonl",
                     "raw/E{1..8}_rows.jsonl", "analysis/ANALYSIS_RESULTS.json"]}
    _savefig_factory()(fig, "figure13_predictions_budget_ledger", prov)

# ============================================================ registry
REGISTRY = [
    ("3D brain + neural activity", "E9 (demon_neural/demon_frozen)", "Fig 8", "a–c",
     "Required — provided (3D FAFB anatomy + per-neuron activity)", "raw/E9_rows.jsonl fireVec -> ACT bins", "DONE"),
    ("Which neurons fired", "E9", "Fig 9", "a–d", "Required — provided", "ACT bins + celltypes", "DONE"),
    ("Learning curve", "E9, E3, E10, E11", "Fig 12", "a–c", "Optional/linked", "raw rows", "DONE"),
    ("Good:bad crossing ratio", "E1–E8", "Fig 13", "c", "Optional/linked (counts shown with ledger)", "raw rows", "DONE"),
    ("Thermodynamic budget", "E1", "Fig 13", "b", "Optional — provided (model quantities only)", "raw/E1_rows.jsonl", "DONE"),
    ("Neural mutual information", "E9", "Fig 11", "a–b", "Required where localizable — provided (region map)", "MI_E9.json", "DONE"),
    ("Sorting entropy reduction", "E1 (sortEntropy/spatialH ledger)", "Main Fig 3 (existing) + S tables", "—",
     "Required where localizable — quantified in Fig 3 & SUPPLEMENTARY S1", "raw/E1_rows.jsonl", "DONE (existing Fig 3)"),
    ("Learning delta", "E9", "Fig 10", "a–e", "Required — provided", "ACT bins early/late", "DONE"),
]

def main():
    figure8(); figure9(); figure10(); figure11(); figure12(); figure13()
    json.dump(REGISTRY, open(os.path.join(HERE, "FIGURE_REGISTRY_BRAIN.json"), "w"), indent=1)
    print("registry saved")

if __name__ == "__main__":
    main()
