#!/usr/bin/env python
"""compose_nmf_reference_plate.py - put MuJoCo's own render of the qpos_spring
model and the live app's render of the shipped nmf_fly.glb side by side, with the
numbers that say how far apart they are.

This is the third and last stage of the comparison harness:

  1. tools/render_nmf_reference.py   MuJoCo's OWN renderer, offline, on
                                     qpos = qpos_spring (the pose baked into the
                                     glb). Writes mujoco_<view>.png + facts.
  2. tools/capture_nmf_browser.py    the live app (fly_demon_3d.html, its own
                                     WebGLRenderer/scene/materials) rendering the
                                     shipped nmf_fly.glb from the same views.
                                     Writes browser_<view>.png + facts.
  3. this tool                       reads both fact files, aligns the two
                                     renders, writes the plate + metrics.

Why a plate and not just a screenshot pair: every "the fly is arranged wrong"
report so far was argued from numbers read out of a live page. A committed plate
makes the claim checkable by eye, from the repo, without a browser or a GPU:
MuJoCo (source of truth) | the app's asset | the two silhouettes overlaid.

What is compared, and how:

  * silhouettes - foreground = pixels differing from the modal border colour;
    the MuJoCo renders sit on black, the browser renders on the app's own dark
    clear colour, so the same rule works for both. Reported per view: bbox,
    area, centroid, IoU as-rendered and IoU after alignment.
  * alignment - each harness frames the object from ITS OWN measured AABB, so a
    size difference between the two AABBs alone changes the image scale. The
    alignment is therefore a 2D similarity (rotation + uniform scale +
    translation, reflection only if it fits distinctly better) estimated from
    the eight named landmark bodies, in image space by Procrustes. Its residual
    is the honest "do the two images place the same skeleton the same way"
    number; the IoU after alignment then isolates SHAPE difference from
    framing difference.
  * landmarks - the same eight MJCF body names on both sides (thorax, head,
    abdomen, wing_left, wing_right, claw_T1_left, claw_T3_left, claw_T1_right).
    Each side's pixel positions were measured independently (MuJoCo: markers
    welded into the scene, DLT-fitted; browser: the app's own camera projecting
    the glb nodes).

Outputs (research_data/truefly/reference/):
  nmf_reference_plate.png   the committed plate: 4 views x 4 panels
  plate_metrics.json        every number in the plate, machine-readable
  <unchanged>               the two fact files and the ten capture PNGs

Usage:
  python tools/compose_nmf_reference_plate.py [--outdir research_data/truefly/reference]
Requires numpy and Pillow only (no MuJoCo, no browser) - the heavy lifting was
done by the two capture tools.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
DEFAULT_OUTDIR = os.path.join(ROOT, "research_data", "truefly", "reference")

VIEWS = ["dorsal", "lateral", "front", "quarter"]
BG_TOL = 12            # per-channel distance from the modal border colour
PANEL = 360            # panel edge in the plate, px (sources are 640)
PAD = 14
TITLE_H = 74
HEADER_H = 30

INK = (232, 236, 241)
DIM = (150, 160, 172)
BG = (16, 18, 22)
PANEL_BG = (10, 11, 14)
COL_MJ = (90, 170, 255)      # MuJoCo-only pixels
COL_BR = (255, 140, 60)      # browser-only pixels
COL_BOTH = (235, 240, 245)   # both
COL_MJ_LM = (120, 220, 255)
COL_BR_LM = (255, 200, 90)


# ------------------------------------------------------------------ helpers ---
def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def load_mask(path):
    raw = np.asarray(Image.open(path).convert("RGB"))
    border = np.concatenate([raw[0], raw[-1], raw[:, 0], raw[:, -1]])
    cols, counts = np.unique(border.reshape(-1, 3), axis=0, return_counts=True)
    bg = cols[counts.argmax()]
    fg = np.abs(raw.astype(np.int16) - bg.astype(np.int16)).max(axis=2) > BG_TOL
    return raw, fg, tuple(int(v) for v in bg)


def stats_of(fg):
    ys, xs = np.nonzero(fg)
    if not fg.any():
        return {"area_px": 0, "bbox_xyxy": None, "centroid_px": None}
    return {"area_px": int(fg.sum()),
            "bbox_xyxy": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
            "centroid_px": [round(float(xs.mean()), 2), round(float(ys.mean()), 2)]}


def iou(a, b):
    inter = int(np.logical_and(a, b).sum())
    union = int(np.logical_or(a, b).sum())
    return (inter / union) if union else 0.0


def sim_from_landmarks(A, B):
    """2D similarity mapping A (mujoco px) onto B (browser px). Reflection is
    allowed only when it fits distinctly better - a mirrored pair is a finding,
    not something to paper over."""
    best = None
    for mirror in (False, True):
        Am = A.copy()
        if mirror:
            Am = Am * np.array([-1.0, 1.0])
        ca, cb = Am.mean(0), B.mean(0)
        A0, B0 = Am - ca, B - cb
        U, S, Vt = np.linalg.svd(A0.T @ B0)
        D = np.diag([1.0, np.linalg.det(Vt.T @ U.T)])
        R = Vt.T @ D @ U.T
        denom = float((A0 ** 2).sum())
        s = float(S[0] + S[1]) / denom if denom else 1.0
        t = cb - s * (R @ ca)
        res = s * (Am @ R.T) + t - B
        rms = float(np.sqrt((res ** 2).sum(1).mean()))
        cand = {"scale": s, "rotation_deg": float(np.degrees(np.arctan2(R[1, 0], R[0, 0]))),
                "mirror": bool(mirror), "rms_px": rms,
                "translation_px": [round(float(t[0]), 3), round(float(t[1]), 3)],
                "residual_px": [round(float(v), 2) for v in np.sqrt((res ** 2).sum(1))],
                "_A": Am, "_R": R, "_t": t, "_s": s}
        if best is None or rms < best["rms_px"]:
            best = cand
    return best


def warp_mask(mask, fit, out_shape):
    """Sample the browser mask through the fitted map (nearest neighbour)."""
    h, w = out_shape
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return np.zeros(out_shape, bool)
    A, R, t, s = fit["_A"], fit["_R"], fit["_t"], fit["_s"]
    # invert: A = s R (mirrored A) + t  ->  A_px = R.T ((B - t)/s) with mirror
    P = np.stack([xs, ys], 1).astype(np.float64)
    Q = ((P - t) / s) @ R
    if fit["mirror"]:
        Q[:, 0] = -Q[:, 0]
    xi = np.rint(Q[:, 0]).astype(int)
    yi = np.rint(Q[:, 1]).astype(int)
    ok = (xi >= 0) & (xi < w) & (yi >= 0) & (yi < h)
    out = np.zeros(out_shape, bool)
    out[yi[ok], xi[ok]] = True
    return out


def best_shape_fit(mj_mask, br_mask, scales=None, span=40, step=8):
    """Best-case overlap: uniform scale + integer shift of the browser mask that
    maximises IoU with the MuJoCo mask. This is the honest 'how much of the
    difference is shape, not framing' number - no rotation, no mirror, no
    landmark input, just the best possible translation and size match."""
    h, w = mj_mask.shape
    if scales is None:
        scales = [round(0.30 + 0.05 * i, 3) for i in range(35)]   # 0.30 .. 2.00
    base = Image.fromarray((br_mask * 255).astype(np.uint8))
    best = {"iou": -1.0, "scale": None, "shift_px": None}
    for s in scales:
        size = max(8, int(round(h * s)))
        small = np.asarray(base.resize((size, size), Image.NEAREST)) > 127
        # place it so its centroid sits on the MuJoCo centroid, then sweep
        ys, xs = np.nonzero(small)
        if not len(xs):
            continue
        mys, mxs = np.nonzero(mj_mask)
        if not len(mxs):
            continue
        cx = int(round(mxs.mean() - xs.mean()))
        cy = int(round(mys.mean() - ys.mean()))
        for dy in range(-span, span + 1, step):
            for dx in range(-span, span + 1, step):
                canvas = np.zeros((h, w), bool)
                x0, y0 = cx + dx, cy + dy
                sx0, sy0 = max(0, -x0), max(0, -y0)
                dx0, dy0 = max(0, x0), max(0, y0)
                sw = min(size - sx0, w - dx0)
                sh = min(size - sy0, h - dy0)
                if sw <= 0 or sh <= 0:
                    continue
                canvas[dy0:dy0 + sh, dx0:dx0 + sw] = small[sy0:sy0 + sh, sx0:sx0 + sw]
                inter = int(np.logical_and(mj_mask, canvas).sum())
                union = int(np.logical_or(mj_mask, canvas).sum())
                score = inter / union if union else 0.0
                if score > best["iou"]:
                    best = {"iou": score, "scale": s, "shift_px": [int(x0), int(y0)],
                            "_mask": canvas}
    return best


def overlay_rgb(mj_mask, br_mask):
    out = np.zeros(mj_mask.shape + (3,), np.uint8)
    out[:] = PANEL_BG
    out[mj_mask] = COL_MJ
    out[br_mask] = COL_BR
    out[mj_mask & br_mask] = COL_BOTH
    return out


def to_panel(img, size=PANEL):
    im = Image.fromarray(img).convert("RGB")
    im = im.resize((size, size), Image.NEAREST)
    return im


def fit_text(draw, text, font, max_w):
    while text and draw.textlength(text, font=font) > max_w:
        text = text[:-2]
    return text


# --------------------------------------------------------------------- main ---
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--outdir", default=DEFAULT_OUTDIR)
    args = ap.parse_args()
    out = args.outdir

    mj_path = os.path.join(out, "mujoco_facts.json")
    br_path = os.path.join(out, "browser_facts.json")
    for p in (mj_path, br_path):
        if not os.path.exists(p):
            sys.exit("missing input: %s (run the two capture tools first)" % p)
    mj = json.load(open(mj_path))
    br = json.load(open(br_path))
    landmarks = mj["landmarks"]
    size = mj.get("image_size_px", 640)

    views = [v for v in VIEWS if v in mj["views"] and v in br["views"]]
    if not views:
        sys.exit("no view present in both fact files")

    metrics = {
        "what": "MuJoCo (qpos_spring, its own renderer) vs the live app's render "
                "of the shipped nmf_fly.glb, same four named views",
        "views": {},
        "sources": {
            "mujoco_facts": {"file": os.path.basename(mj_path), "sha256": sha256(mj_path),
                             "pose": mj.get("pose"), "xml": mj.get("xml"),
                             "xml_sha256": mj.get("xml_sha256"),
                             "mujoco_version": mj.get("mujoco_version")},
            "browser_facts": {"file": os.path.basename(br_path), "sha256": sha256(br_path),
                              "page": br.get("page"), "page_sha256": br.get("page_sha256"),
                              "asset": br.get("asset"), "glb_sha256": br.get("glb_sha256")},
        },
        "frames": {"mujoco": mj["frames"], "browser": br["frames"]},
        "aabb": {"mujoco_model_units": mj["aabb"], "browser_glb_units": br["aabb"].get("glb_units"),
                 "browser_world_units": br["aabb"].get("world"),
                 "note": "each capture framed ITS OWN measured AABB (fill %.2f, fovy %.1f deg), "
                         "so a raw size difference between the two images can be framing, not "
                         "geometry - that is why the aligned IoU is reported as well"
                         % (mj.get("fill_fraction", 0.0), mj.get("fovy_deg", 0.0))},
        "landmarks": landmarks,
    }
    # provenance cross-check: does the captured glb hash still match the file on disk?
    glb = os.path.join(ROOT, "nmf_fly.glb")
    if os.path.exists(glb):
        cur = sha256(glb)
        rec = br.get("glb_sha256")
        metrics["sources"]["browser_facts"]["glb_sha256_on_disk_now"] = cur
        metrics["sources"]["browser_facts"]["glb_unchanged_since_capture"] = (cur == rec)
        if cur != rec:
            print("WARNING: nmf_fly.glb has changed since the browser capture was taken "
                  "(recorded %s..., on disk %s...)" % (str(rec)[:12], cur[:12]))

    if "aabb" in mj and br["aabb"].get("glb_units"):
        a = np.array(mj["aabb"]["size"]); b = np.array(br["aabb"]["glb_units"]["size"])
        metrics["aabb"]["size_ratio_browser_over_mujoco_sorted"] = [
            round(float(x), 4) for x in np.sort(b)[::-1] / np.sort(a)[::-1]]

    panels = {}
    for v in views:
        mj_png = os.path.join(out, mj["views"][v]["png"])
        br_png = os.path.join(out, br["views"][v]["png"])
        mj_img, mj_mask, mj_bg = load_mask(mj_png)
        br_img, br_mask, br_bg = load_mask(br_png)
        A = np.array([mj["views"][v]["landmark_px"][k] for k in landmarks], float)
        B = np.array([br["views"][v]["landmark_px"][k] for k in landmarks], float)
        fit = sim_from_landmarks(A, B)
        br_warp = warp_mask(br_mask, fit, mj_mask.shape)
        raw_iou = iou(mj_mask, br_mask)
        aligned = iou(mj_mask, br_warp)
        shape = best_shape_fit(mj_mask, br_mask)
        metrics["views"][v] = {
            "silhouette_best_case_fit": {
                "iou": round(shape["iou"], 4), "scale": shape["scale"],
                "shift_px": shape["shift_px"],
                "what": "uniform scale + whole-pixel shift of the browser mask that maximises IoU "
                        "with the MuJoCo mask (no rotation, no mirror) - the shape-only agreement"},
            "pngs": {"mujoco": mj["views"][v]["png"], "browser": br["views"][v]["png"],
                     "sha256": {"mujoco": sha256(mj_png), "browser": sha256(br_png)}},
            "background_rgb": {"mujoco": mj_bg, "browser": br_bg},
            "silhouette": {"mujoco": stats_of(mj_mask), "browser": stats_of(br_mask)},
            "iou_as_rendered": round(raw_iou, 4),
            "iou_after_alignment": round(aligned, 4),
            "alignment_from_landmarks": {k: fit[k] for k in
                                         ("scale", "rotation_deg", "mirror", "rms_px",
                                          "translation_px", "residual_px")},
            "landmark_px": {k: {"mujoco": mj["views"][v]["landmark_px"][k],
                                "browser": br["views"][v]["landmark_px"][k]}
                            for k in landmarks},
        }
        panels[v] = {"mj": mj_img, "br": br_img, "mj_mask": mj_mask, "br_mask": br_mask,
                     "br_warp": br_warp, "fit": fit, "A": A, "B": B, "shape": shape,
                     "raw_iou": raw_iou, "aligned": aligned}
        print("%-8s iou as-rendered %.3f   landmark-fit aligned %.3f   best-case shape iou %.3f "
              "(scale %.2f)   landmark rms %5.2f px (scale %.3f, rot %.1f deg, mirror %s)"
              % (v, raw_iou, aligned, shape["iou"], shape["scale"], fit["rms_px"], fit["scale"],
                 fit["rotation_deg"], fit["mirror"]))

    # ------------------------------------------------------------- the plate --
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 13)
        font_b = ImageFont.truetype("DejaVuSans-Bold.ttf", 14)
        font_s = ImageFont.truetype("DejaVuSans.ttf", 11)
    except Exception:
        font = font_b = font_s = ImageFont.load_default()

    cols = ["MuJoCo renderer (source of truth)", "live app: nmf_fly.glb",
            "silhouettes as rendered", "best-case overlap (scale+shift)"]
    W = PAD + len(cols) * (PANEL + PAD)
    row_h = PANEL + HEADER_H + PAD
    H = TITLE_H + len(views) * row_h + 96
    plate = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(plate)

    d.text((PAD, 14), "TrueFly asset check: MuJoCo's own render vs the shipped nmf_fly.glb",
           font=font_b, fill=INK)
    d.text((PAD, 34), mj.get("pose", "") + "  |  asset " + str(br.get("asset")) +
           "  |  views dorsal / lateral / front / quarter, %.0f px panels" % PANEL,
           font=font_s, fill=DIM)
    d.text((PAD, 50), "left two: the two renders with their landmarks. right two: silhouette overlap "
                      "(blue = MuJoCo only, orange = browser only, white = both), before and after "
                      "the landmark-fitted alignment.", font=font_s, fill=DIM)

    for r, v in enumerate(views):
        p = panels[v]
        y0 = TITLE_H + r * row_h
        for c, name in enumerate(cols):
            x0 = PAD + c * (PANEL + PAD)
            d.text((x0, y0), name, font=font_s, fill=DIM)
        y_img = y0 + HEADER_H - 6

        shape = p["shape"]
        shape_mask = shape.get("_mask", p["br_warp"])
        for c, arr in enumerate((p["mj"], p["br"],
                                 overlay_rgb(p["mj_mask"], p["br_mask"]),
                                 overlay_rgb(p["mj_mask"], shape_mask))):
            x0 = PAD + c * (PANEL + PAD)
            plate.paste(to_panel(arr), (x0, y_img))
            d.rectangle([x0, y_img, x0 + PANEL, y_img + PANEL], outline=(48, 52, 60))

        # landmarks on the two rendered panels, plus fitted circles on panel 2
        sc = PANEL / float(size)
        for c in (0, 1):
            x0 = PAD + c * (PANEL + PAD)
            pts = p["A"] if c == 0 else p["B"]
            col = COL_MJ_LM if c == 0 else COL_BR_LM
            for k, (x, y) in zip(landmarks, pts):
                if not (0 <= x < size and 0 <= y < size):
                    continue
                px, py = x0 + x * sc, y_img + y * sc
                d.ellipse([px - 3, py - 3, px + 3, py + 3], outline=col)
                d.text((px + 4, py - 11), k[:9], font=font_s, fill=col)

        # aligned overlay: the MuJoCo landmarks, so the shift of the browser
        # silhouette against them is what the eye reads
        x0 = PAD + 3 * (PANEL + PAD)
        for k, (x, y) in zip(landmarks, p["A"]):
            if not (0 <= x < size and 0 <= y < size):
                continue
            px, py = x0 + x * sc, y_img + y * sc
            d.ellipse([px - 2, py - 2, px + 2, py + 2], outline=COL_MJ_LM)

        fit = p["fit"]
        line = ("iou %.3f as rendered | %.3f best-case (browser scaled %.2f, shifted %s px) | "
                "%.3f at the landmark fit | landmark rms %.2f px (scale %.3f, rot %.1f deg, "
                "mirror %s) | area mj %d px, br %d px"
                % (p["raw_iou"], shape["iou"], shape["scale"] or 0.0,
                   shape["shift_px"] or [0, 0], p["aligned"], fit["rms_px"], fit["scale"],
                   fit["rotation_deg"], fit["mirror"],
                   p["mj_mask"].sum(), p["br_mask"].sum()))
        d.text((PAD, y_img + PANEL + 2), fit_text(d, line, font, W - 2 * PAD), font=font, fill=INK)
        ss = metrics["views"][v]["silhouette"]
        d.text((PAD, y_img + PANEL + 18),
               fit_text(d, "bbox mujoco %s   bbox browser %s   landmark residual px %s"
                        % (ss["mujoco"]["bbox_xyxy"], ss["browser"]["bbox_xyxy"],
                           ", ".join("%s %.1f" % (k[:10], r) for k, r in
                                     zip(landmarks, fit["residual_px"]))), font, W - 2 * PAD),
               font=font_s, fill=DIM)

    y = TITLE_H + len(views) * row_h
    foot = [
        "regenerate:  .venv-embodiment/Scripts/python.exe tools/render_nmf_reference.py   "
        "(MuJoCo, offline)",
        "             python tools/capture_nmf_browser.py                               "
        "(live app, CDP; serves fly_demon_3d.html)",
        "             python tools/compose_nmf_reference_plate.py                        "
        "(this plate + plate_metrics.json)",
        "provenance:  fruitfly.xml sha256 %s" % str(mj.get("xml_sha256"))[:32] + "...",
        "             page sha256 %s" % str(br.get("page_sha256"))[:32] + "...   glb sha256 %s"
        % str(br.get("glb_sha256"))[:32] + "...",
    ]
    for i, t in enumerate(foot):
        d.text((PAD, y + 8 + 15 * i), fit_text(d, t, font_s, W - 2 * PAD), font=font_s, fill=DIM)

    plate_path = os.path.join(out, "nmf_reference_plate.png")
    plate.save(plate_path)
    mp = os.path.join(out, "plate_metrics.json")
    json.dump(metrics, open(mp, "w"), indent=1, sort_keys=True)
    print("wrote", os.path.relpath(plate_path, ROOT).replace("\\", "/"),
          "(%dx%d px)" % plate.size)
    print("wrote", os.path.relpath(mp, ROOT).replace("\\", "/"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
