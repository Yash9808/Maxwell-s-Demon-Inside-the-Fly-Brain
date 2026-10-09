#!/usr/bin/env python
"""render_nmf_reference.py — MuJoCo's OWN renderer, offline, on the exact pose
the browser asset is built from.

Why this exists: `nmf_fly.glb` is produced offline (tools/export_nmf_pose.py +
tools/build_nmf_fly_glb.js) and then rendered by three.js inside a browser tab.
Every "the fly looks wrong / is arranged differently than the flybody figure"
report so far had to be argued from numbers read out of the live page, because
MuJoCo cannot render inside that tab. This tool removes the argument: it renders
the SAME model state (qpos = qpos_spring, the pose baked into the glb) with
MuJoCo's own renderer, from named views of the model's OWN axes, and writes:

  research_data/truefly/reference/mujoco_<view>.png
      a clean plate per view (fly only, no markers)
  research_data/truefly/reference/mujoco_facts.json
      per view: camera (azimuth/elevation/distance/lookat, fovy), the fly's
      geometry AABB in model units, the object's pixel bbox, the projected
      pixel position of each named landmark body, the camera->pixel mapping
      residual, and hashes/versions for provenance.

The landmark pixels are not guessed: a single marker sphere is welded into the
model, moved through a shell of known world positions (12 renders per view),
and located in the image as the centroid of its own colour; the resulting
world->pixel correspondences are least-squares fitted with a DLT (3x4
projective) whose residual is reported. MuJoCo's free-camera conventions
(lookat/azimuth/elevation/up, and its renderer's viewport mapping) are
deliberately NOT assumed anywhere — the mapping is measured from the images.

Views are the model's own axes (MJCF/model frame: nose = +X, dorsal = +Z,
lateral = +/-Y), with a presentation matching the app rig frame
(tools/capture_nmf_browser.py renders the same four views of the rig frame:
nose = +X, dorsal = +Y, lateral = +/-Z) so the two sets can be read side by side.

Usage:
  .venv-embodiment/Scripts/python.exe tools/render_nmf_reference.py [--size 640]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys

import numpy as np
from PIL import Image

try:
    import mujoco
except ImportError:  # pragma: no cover - environment guard
    sys.exit("mujoco not importable: run with .venv-embodiment/Scripts/python.exe")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
ASSETS = os.path.join(ROOT, ".venv-embodiment", "Lib", "site-packages",
                      "flybody", "fruitfly", "assets")
XML = os.path.join(ASSETS, "fruitfly.xml")
OUTDIR = os.path.join(ROOT, "research_data", "truefly", "reference")

# (azimuth, elevation) in the MuJoCo free-camera convention, model frame.
# NOTE: these are the values that produce the intended PRESENTATION, and the
# presentation is not assumed from MuJoCo's conventions (its azimuth sign and
# its degenerate top-down roll were both measured, not guessed: see the
# per-view `presentation` block in the output JSON, computed from the landmark
# pixels). Dorsal is 89.5 deg rather than 90 because at exactly 90 the free
# camera's roll is degenerate and the renderer picks it.
VIEWS = [
    ("dorsal", 180.0, 89.5),   # camera above (+Z), nose drawn up the frame
    ("lateral", 270.0, 0.0),   # camera on the model's +Y side, dorsal up, nose left
    ("front", 0.0, 0.0),       # camera on the nose (+X) side: face-on
    ("quarter", 315.0, 20.0),  # three-quarter hero view (front-right, raised)
]

# Named MJCF body-frame origins, shared with the browser capture (the glb
# carries the same body names, so the same list is measured on both sides).
LANDMARKS = [
    "thorax", "head", "abdomen", "wing_left", "wing_right",
    "claw_T1_left", "claw_T3_left", "claw_T1_right",
]

FILL = 0.8          # object radius as a fraction of the frame half-height
MARKER_RF = 0.02    # marker sphere radius, as a fraction of the AABB diagonal
SHELL_R = 1.05      # marker shell radius, in units of the AABB bounding radius
BG_TOL = 12         # per-channel distance from the background sample
MARKER_MIN, MARKER_MAX = 0.02, 8.0   # accepted marker blob size, % of frame area


# ---------------------------------------------------------------- geometry ---
def fly_aabb(model, data, ngeom_fly):
    """Axis-aligned box of the fly's own geoms (transformed mesh vertices)."""
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    for g in range(ngeom_fly):
        did = model.geom_dataid[g]
        if did >= 0:
            a, n = model.mesh_vertadr[did], model.mesh_vertnum[did]
            v = model.mesh_vert[a:a + n].reshape(-1, 3) * model.mesh_scale[did]
        else:
            v = np.zeros((1, 3))
        w = v @ data.geom_xmat[g].reshape(3, 3).T + data.geom_xpos[g]
        lo = np.minimum(lo, w.min(0))
        hi = np.maximum(hi, w.max(0))
    return lo, hi


def landmark_world(model, data):
    out = {}
    for name in LANDMARKS:
        bid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, name)
        if bid < 0:
            raise SystemExit("landmark body missing from the model: " + name)
        out[name] = [float(v) for v in data.xpos[bid]]
    return out


# ------------------------------------------------------------- markers/DLT ---
def icosphere_dirs(n_ish=12):
    """Well-spread unit directions (golden spiral) for the marker shell."""
    out = []
    ga = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(n_ish):
        y = 1.0 - 2.0 * (i + 0.5) / n_ish
        r = math.sqrt(max(0.0, 1.0 - y * y))
        th = ga * i
        out.append([math.cos(th) * r, math.sin(th) * r, y])
    return out


def blob_centroid(img, tol=90, view_rgb=(255, 0, 255)):
    """Centroid + support of pixels matching the marker colour."""
    d = np.abs(img.astype(np.int16) - np.array(view_rgb, np.int16)).max(axis=2)
    m = d <= tol
    n = int(m.sum())
    if n < 4:
        return None
    ys, xs = np.nonzero(m)
    return float(xs.mean()), float(ys.mean()), n


def fit_dlt(X, x):
    """Least-squares 3x4 projective map world(X, Nx3) -> image(x, Nx2)."""
    rows = []
    for Xw, xi in zip(X, x):
        w = np.append(np.asarray(Xw, float), 1.0)
        rows.append(np.concatenate([w, np.zeros(4), -xi[0] * w]))
        rows.append(np.concatenate([np.zeros(4), w, -xi[1] * w]))
    A = np.asarray(rows)
    _, _, vt = np.linalg.svd(A)
    P = vt[-1].reshape(3, 4)
    proj = (np.column_stack([X, np.ones(len(X))]) @ P.T)
    pxy = proj[:, :2] / proj[:, 2:3]
    res = np.linalg.norm(pxy - np.asarray(x), axis=1)
    return P, float(res.max()), float(res.mean())


def project(P, X):
    w = np.append(np.asarray(X, float), 1.0)
    h = P @ w
    return float(h[0] / h[2]), float(h[1] / h[2])


# -------------------------------------------------------------- rendering ----
def make_renderer(model, size):
    r = mujoco.Renderer(model, size, size)
    return r


def build_model(marker_radius=None):
    """The fly model at qpos_spring, optionally with one welded marker body.

    The marker body has no joint, so it is welded to the world; its `body_pos`
    is mutated per calibration render. Radius is fixed at compile time (MuJoCo
    rejects a zero size), which is why it is a parameter.
    """
    if marker_radius is None:
        m = mujoco.MjModel.from_xml_path(XML)
    else:
        spec = mujoco.MjSpec.from_file(XML)
        mat = spec.add_material(name="nmf_probe")
        mat.rgba[:] = [1.0, 0.0, 1.0, 1.0]
        mat.emission = 1.0                # spec exposes emission as a scalar
        body = spec.worldbody.add_body(name="nmf_probe_body", pos=[0.0, 0.0, 0.0])
        geom = body.add_geom()
        geom.type = mujoco.mjtGeom.mjGEOM_SPHERE
        geom.material = "nmf_probe"
        geom.size[:] = [marker_radius, 0.0, 0.0]
        geom.contype = 0
        geom.conaffinity = 0
        m = spec.compile()
    d = mujoco.MjData(m)
    d.qpos[:] = m.qpos_spring
    mujoco.mj_forward(m, d)
    return m, d


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--size", type=int, default=640, help="square plate size in px")
    ap.add_argument("--outdir", default=OUTDIR)
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)
    size = args.size

    model, data = build_model()
    ngeom_fly = model.ngeom
    lo, hi = fly_aabb(model, data, ngeom_fly)
    center = (lo + hi) / 2.0
    extent = hi - lo
    radius = float(np.linalg.norm(extent) / 2.0)
    fovy = float(model.vis.global_.fovy)
    distance = radius / (FILL * math.tan(math.radians(fovy) / 2.0))
    diag = float(np.linalg.norm(extent))
    marker_radius = MARKER_RF * diag
    print("fly AABB (model units) lo %s hi %s" % (np.round(lo, 5), np.round(hi, 5)))
    print("  size %s centre %s   R=%.5f  fovy=%.1f  distance=%.5f  size_px=%d"
          % (np.round(extent, 5), np.round(center, 5), radius, fovy, distance, size))

    landmarks_world = landmark_world(model, data)

    # marker model: the same model + one welded marker body; body_pos is mutated
    # per calibration render, so the camera and the fly kinematics are the same
    # object as the plate render (the fly AABB is re-checked below).
    mmodel, mdata = build_model(marker_radius)
    mbid = mujoco.mj_name2id(mmodel, mujoco.mjtObj.mjOBJ_BODY, "nmf_probe_body")
    mlo, mhi = fly_aabb(mmodel, mdata, ngeom_fly)
    if not (np.allclose(mlo, lo) and np.allclose(mhi, hi)):
        raise SystemExit("marker model changed the fly's own AABB")

    facts = {
        "source": "flybody fruitfly.xml",
        "pose": "qpos = qpos_spring (passive rest) — the pose baked into nmf_fly.glb",
        "model_units": "MJCF units; glb packer scale = 0.1 (build_nmf_fly_glb.js SCALE)",
        "mujoco_version": mujoco.__version__,
        "xml": os.path.relpath(XML, ROOT).replace("\\", "/"),
        "xml_sha256": hashlib.sha256(open(XML, "rb").read()).hexdigest(),
        "image_size_px": size,
        "frames": "model frame: nose +X, dorsal +Z, lateral +/-Y "
                  "(app rig frame: nose +X, dorsal +Y, lateral +/-Z)",
        "fill_fraction": FILL,
        "fovy_deg": fovy,
        "distance": distance,
        "aabb": {"lo": lo.tolist(), "hi": hi.tolist(), "centre": center.tolist(),
                 "size": extent.tolist(), "bounding_radius": radius},
        "landmarks": LANDMARKS,
        "landmarks_world": landmarks_world,
        "views": {},
    }

    shell = [np.array(center) + SHELL_R * radius * np.array(d) for d in icosphere_dirs(12)]

    for name, az, el in VIEWS:
        cam = mujoco.MjvCamera()
        cam.type = mujoco.mjtCamera.mjCAMERA_FREE
        cam.lookat[:] = center
        cam.distance = distance
        cam.azimuth = az
        cam.elevation = el

        # 1. clean plate render
        renderer = make_renderer(model, size)
        renderer.update_scene(data, cam)
        clean = renderer.render().copy()
        bg = clean[0, 0].astype(np.int16)
        fg = (np.abs(clean.astype(np.int16) - bg).max(axis=2) > BG_TOL)
        ys, xs = np.nonzero(fg)
        bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
        Image.fromarray(clean).save(os.path.join(args.outdir, "mujoco_%s.png" % name))

        # 2. calibration: sweep the marker through the shell, locate its blob
        mrenderer = make_renderer(mmodel, size)
        pairs, n_missing, n_odd = [], 0, 0
        for p in shell:
            mmodel.body_pos[mbid] = p
            mujoco.mj_forward(mmodel, mdata)
            mrenderer.update_scene(mdata, cam)
            img = mrenderer.render()
            c = blob_centroid(img)
            if c is None:
                n_missing += 1                 # occluded / off frame: drop it
                continue
            x0, y0, n_px = c
            frac = 100.0 * n_px / (size * size)
            if not (MARKER_MIN <= frac <= MARKER_MAX):
                n_odd += 1                     # partly occluded blob: drop it
                continue
            pairs.append((mdata.xpos[mbid].copy(), (x0, y0), n_px))
        if len(pairs) < 6:
            raise SystemExit("view %s: only %d usable calibration markers (need >= 6)"
                             % (name, len(pairs)))
        X = np.array([p[0] for p in pairs])
        x = np.array([p[1] for p in pairs])
        P, res_max, res_mean = fit_dlt(X, x)

        # 3. project the anatomical landmarks with the MEASURED mapping, and
        #    check they land on the fly in the (marker-free) plate render.
        lm_px, on_fg = {}, {}
        for lname, w in landmarks_world.items():
            px, py = project(P, w)
            lm_px[lname] = [round(px, 2), round(py, 2)]
            xi, yi = int(round(px)), int(round(py))
            ok = 0 <= xi < size and 0 <= yi < size
            on_fg[lname] = bool(ok and fg[max(0, yi - 2):yi + 3, max(0, xi - 2):xi + 3].any())

        facts["views"][name] = {
            "camera": {"azimuth": az, "elevation": el, "distance": distance,
                       "lookat": center.tolist(), "fovy_deg": fovy},
            "calibration_markers_used": len(pairs),
            "calibration_markers_dropped": {"offscreen_or_occluded": n_missing,
                                           "partly_occluded": n_odd},
            "dlt_residual_px": {"max": round(res_max, 3), "mean": round(res_mean, 3)},
            "marker_radius": marker_radius,
            "silhouette": {"bbox_xyxy": bbox,
                           "width_px": bbox[2] - bbox[0], "height_px": bbox[3] - bbox[1],
                           "fill_fraction_of_frame": round(float(fg.mean()), 4),
                           "centroid_px": [round(float(xs.mean()), 2), round(float(ys.mean()), 2)]},
            "landmark_px": lm_px,
            "landmark_on_fly_px": on_fg,
            "png": "mujoco_%s.png" % name,
        }
        n_ok = sum(on_fg.values())
        # presentation, measured from the landmark pixels that just came out of
        # the DLT (nothing here is taken from MuJoCo's camera conventions)
        def sxy(k):
            return lm_px[k]
        nose = (sxy("head")[0] - sxy("abdomen")[0], -(sxy("head")[1] - sxy("abdomen")[1]))
        wing = (sxy("wing_right")[0] - sxy("wing_left")[0],
                -(sxy("wing_right")[1] - sxy("wing_left")[1]))
        facts["views"][name]["presentation"] = {
            "nose_screen_deg": round(math.degrees(math.atan2(nose[1], nose[0])), 2),
            "wing_axis_screen_deg": round(math.degrees(math.atan2(wing[1], wing[0])), 2),
            "note": "0 deg = screen right, 90 deg = screen up (y up)",
        }
        print("%-8s az=%6.1f el=%5.1f  markers %2d  DLT res max %.2f px  "
              "silhouette %dx%d (%.1f%% of frame)  landmarks on fly %d/%d  "
              "nose@%.1f deg  wingaxis@%.1f deg"
              % (name, az, el, len(pairs), res_max, bbox[2] - bbox[0], bbox[3] - bbox[1],
                 100 * fg.mean(), n_ok, len(on_fg),
                 facts["views"][name]["presentation"]["nose_screen_deg"],
                 facts["views"][name]["presentation"]["wing_axis_screen_deg"]))
        if n_ok < len(on_fg):
            print("   NOTE: landmarks not on fly pixels:",
                  [k for k, v in on_fg.items() if not v])
        renderer.close()
        mrenderer.close()

    path = os.path.join(args.outdir, "mujoco_facts.json")
    with open(path, "w") as f:
        json.dump(facts, f, indent=1, sort_keys=True)
    print("wrote", os.path.relpath(path, ROOT).replace("\\", "/"))


if __name__ == "__main__":
    main()
