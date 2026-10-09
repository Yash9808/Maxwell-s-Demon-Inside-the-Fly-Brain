#!/usr/bin/env python
"""check_nmf_glb_vs_mujoco.py - does the shipped nmf_fly.glb place the fly's
geometry where MuJoCo places it?

The plate (tools/compose_nmf_reference_plate.py) shows the disagreement in
pixels; this tool says where it comes from, in the model's own numbers, and is
meant to be run again after a rebuild.

What it compares, per mesh geom (all 84 mesh geoms of fruitfly.xml):

  MuJoCo side   world box of the geom's own vertices, m.mesh_vert[m] through
                data.geom_xmat/geom_xpos at qpos = qpos_spring - i.e. what
                MuJoCo's renderer draws (verified here: re-rendering with
                mesh_pos = 0 / mesh_quat = identity, and with mesh_scale = 1.0,
                is pixel-identical, so the renderer uses mesh_vert as compiled).
  glb side      world box of the glb node with the same mesh name: the accessor's
                declared min/max corners through the node's world matrix.

It also prints the two facts that explain any difference: (a) the glb's mesh
accessor range equals the OBJ file's own vertex range x 0.1, and (b) MuJoCo's
compiled mesh_vert is that same vertex set put through a RIGID reframing
(scale 1, max residual 0) recorded in m.mesh_pos / m.mesh_quat, which the XML
does not declare.

Exit status: 0 when every paired geom's box centre agrees to --tolerance
(default 0.005 model units) and the worst per-axis size difference is within
10x that; 1 otherwise (i.e. 1 means "the shipped asset does not reproduce the
MuJoCo model"). Also 2 on missing inputs.

Usage:
  .venv-embodiment/Scripts/python.exe tools/check_nmf_glb_vs_mujoco.py [--glb nmf_fly.glb]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

import numpy as np

try:
    import mujoco
except ImportError:  # pragma: no cover - environment guard
    sys.exit("mujoco not importable: run with .venv-embodiment/Scripts/python.exe")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
ASSETS = os.path.join(ROOT, ".venv-embodiment", "Lib", "site-packages",
                      "flybody", "fruitfly", "assets")
XML = os.path.join(ASSETS, "fruitfly.xml")
SCALE = 0.1          # MJCF default <mesh scale="0.1 0.1 0.1"/>


def quat_mat(q):
    x, y, z, w = q                      # glTF xyzw
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                     [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                     [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])


def node_matrix(n):
    M = np.eye(4)
    if "rotation" in n:
        M[:3, :3] = quat_mat(n["rotation"])
    if "scale" in n:
        M[:3, :3] = M[:3, :3] * np.asarray(n["scale"])[:, None]
    if "translation" in n:
        M[:3, 3] = n["translation"]
    return M


def box_corners(lo, hi):
    return np.array([[x, y, z] for x in (lo[0], hi[0])
                     for y in (lo[1], hi[1]) for z in (lo[2], hi[2])], dtype=np.float64)


def glb_mesh_boxes(path):
    """(mesh name, world box lo/hi) for every mesh node, in traversal order."""
    with open(path, "rb") as f:
        blob = f.read()
    jlen = int.from_bytes(blob[12:16], "little")
    j = json.loads(blob[20:20 + jlen].decode("utf8").rstrip("\x00 \t\r\n"))
    out = []
    stack = [(i, np.eye(4)) for i in reversed(j["scenes"][j["scene"]]["nodes"])]
    while stack:
        idx, parent = stack.pop()
        n = j["nodes"][idx]
        M = parent @ node_matrix(n)
        if "mesh" in n:
            acc = j["accessors"][j["meshes"][n["mesh"]]["primitives"][0]["attributes"]["POSITION"]]
            corners = box_corners(acc["min"], acc["max"])
            w = corners @ M[:3, :3].T + M[:3, 3]
            out.append((j["meshes"][n["mesh"]]["name"], w.min(0), w.max(0)))
        for c in reversed(n.get("children", [])):
            stack.append((c, M))
    return out, j


def mujoco_mesh_boxes(model, data):
    """(mesh name, world box lo/hi) for every mesh geom, in model order."""
    out = []
    for g in range(model.ngeom):
        did = int(model.geom_dataid[g])
        if did < 0 or model.geom_type[g] != mujoco.mjtGeom.mjGEOM_MESH:
            continue
        a, n = model.mesh_vertadr[did], model.mesh_vertnum[did]
        v = model.mesh_vert[a:a + n].reshape(-1, 3)
        w = v @ data.geom_xmat[g].reshape(3, 3).T + data.geom_xpos[g]
        out.append((mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_MESH, did),
                    w.min(0), w.max(0)))
    return out


def obj_vertices(name):
    text = open(os.path.join(ASSETS, name), encoding="utf8", errors="replace").read()
    return np.array([[float(t) for t in ln.split()[1:4]] for ln in text.splitlines()
                     if ln.startswith("v ")], dtype=np.float64)


def mesh_frame_evidence(model, names=("thorax", "head", "wing_left_membrane")):
    """Kabsch: is m.mesh_vert the OBJ x 0.1 through a rigid reframing?"""
    files = dict(re.findall(r'<mesh\s+[^>]*name="([^"]+)"\s+file="([^"]+)"',
                            open(XML, encoding="utf8").read()))
    rows = []
    for name in names:
        mid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_MESH, name)
        a, n = model.mesh_vertadr[mid], model.mesh_vertnum[mid]
        V = model.mesh_vert[a:a + n].reshape(-1, 3).astype(np.float64)
        R = obj_vertices(files[name]) * SCALE
        if R.shape != V.shape:
            rows.append((name, None, None, None, R.shape[0], V.shape[0]))
            continue
        ca, cb = R.mean(0), V.mean(0)
        H = (R - ca).T @ (V - cb)
        U, S, Vt = np.linalg.svd(H)
        d = np.sign(np.linalg.det(Vt.T @ U.T))
        Rm = Vt.T @ np.diag([1, 1, d]) @ U.T
        s = (S[0] + S[1] + d * S[2]) / ((R - ca) ** 2).sum()
        res = (s * (R @ Rm.T) + (cb - s * (Rm @ ca))) - V
        rows.append((name, float(s), float(np.abs(res).max()),
                     [float(v) for v in model.mesh_pos[mid]], R.shape[0], V.shape[0]))
    return rows


def renderer_ignores_mesh_frame(xml, size=120):
    """Re-render with mesh_pos/0 and mesh_quat/identity: identical pixels?"""
    def shot(m):
        d = mujoco.MjData(m)
        d.qpos[:] = m.qpos_spring
        mujoco.mj_forward(m, d)
        r = mujoco.Renderer(m, size, size)
        cam = mujoco.MjvCamera()
        mujoco.mjv_defaultCamera(cam)
        cam.azimuth, cam.elevation, cam.distance = 180.0, 89.5, 0.55
        r.update_scene(d, cam)
        return r.render()
    a = mujoco.MjModel.from_xml_path(xml)
    b = mujoco.MjModel.from_xml_path(xml)
    b.mesh_pos[:] = 0.0
    b.mesh_quat[:] = (1.0, 0.0, 0.0, 0.0)
    img_a, img_b = shot(a), shot(b)
    return int((img_a != img_b).sum()), img_a.size


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--glb", default=os.path.join(ROOT, "nmf_fly.glb"))
    ap.add_argument("--tolerance", type=float, default=0.005,
                    help="max mean box-centre distance, model units")
    args = ap.parse_args()
    if not os.path.exists(args.glb):
        sys.exit("missing glb: " + args.glb)

    model = mujoco.MjModel.from_xml_path(XML)
    data = mujoco.MjData(model)
    data.qpos[:] = model.qpos_spring
    mujoco.mj_forward(model, data)

    mj_boxes = mujoco_mesh_boxes(model, data)
    glb_boxes, gj = glb_mesh_boxes(args.glb)
    by_name = {}
    for name, lo, hi in mj_boxes:
        by_name.setdefault(name, []).append((lo, hi))

    seen, pairs = {}, []
    for name, lo, hi in glb_boxes:
        cands = by_name.get(name)
        if not cands:
            continue
        seen[name] = seen.get(name, 0) + 1
        mlo, mhi = cands[min(seen[name] - 1, len(cands) - 1)]
        c = (lo + hi) / 2.0
        mc = (mlo + mhi) / 2.0
        pairs.append((name, float(np.linalg.norm(c - mc)),
                      float(np.max(np.abs((hi - lo) - (mhi - mlo))))))
    if not pairs:
        sys.exit("no mesh geoms paired between the glb and the model")

    d = np.array([p[1] for p in pairs])
    s = np.array([p[2] for p in pairs])
    worst = sorted(pairs, key=lambda p: -p[1])
    print("paired mesh geoms: %d of %d glb mesh nodes / %d model mesh geoms"
          % (len(pairs), len(glb_boxes), len(mj_boxes)))
    print("box-centre distance glb vs MuJoCo:  mean %.5f  max %.5f  (model units)"
          % (d.mean(), d.max()))
    print("worst per-axis box size difference: mean %.5f  max %.5f"
          % (s.mean(), s.max()))
    print("worst 6 by centre distance:")
    for name, dist, sd in worst[:6]:
        print("   %-26s centre %.5f   size %.5f" % (name, dist, sd))

    print("\nmesh frame evidence (why the two sides differ):")
    for name, sc, res, pos, n_raw, n_mj in mesh_frame_evidence(model):
        if sc is None:
            print("   %-20s vertex counts differ (%s vs %s) - skipped" % (name, n_raw, n_mj))
        else:
            print("   %-20s m.mesh_vert = rigid(OBJ x %s): scale %.6f, max residual %.6f"
                  "   (m.mesh_pos %s, XML declares none)"
                  % (name, SCALE, sc, res, np.round(pos, 5).tolist()))
    try:
        diff, total = renderer_ignores_mesh_frame(XML)
        print("   renderer ignores mesh_pos/mesh_quat: %d of %d pixels differ"
              % (diff, total))
    except Exception as e:                                   # pragma: no cover
        print("   render check skipped:", e)

    ok = d.mean() <= args.tolerance and s.max() <= 10 * args.tolerance
    print("\nverdict: %s (tolerance: mean <= %.4f, size max <= %.4f)"
          % ("the glb reproduces the MuJoCo model" if ok
             else "the glb does NOT reproduce the MuJoCo model", args.tolerance,
             10 * args.tolerance))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
