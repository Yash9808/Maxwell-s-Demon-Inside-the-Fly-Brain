#!/usr/bin/env python
"""export_nmf_pose.py — bake NeuroMechFly's *passive rest pose* for the glb builder.

The glb packer (tools/build_nmf_fly_glb.js) copies each MJCF <body>'s pos/quat
verbatim, i.e. the pose at **qpos = 0**. That is NOT the pose flybody shows:
MuJoCo's passive elements hold every joint at its `springref`, and for the wings
that is a large yaw/roll/pitch sweep (1.5 / 0.7 / -1.0 rad) — so the qpos=0 mesh
renders with both wings spread out sideways across the body instead of swept back
over the abdomen as in the flybody reference figure.

This tool asks MuJoCo itself for the answer: load the model, set
`qpos = qpos_spring`, `mj_forward`, and write each body's transform **relative to
its parent** (translation + rotation) to JSON. The builder then bakes those into
the glb node TRS, so the shipped asset is in the same rest pose MuJoCo renders.

Usage:
  .venv-embodiment/Scripts/python.exe tools/export_nmf_pose.py [out.json]

Writes: nmf_pose_springref.json (default) — {"bodies": {name: {pos, quat(wxyz)}}}
"""
import json
import os
import sys

import numpy as np

try:
    import mujoco
except ImportError:  # pragma: no cover - environment guard
    sys.exit("mujoco not importable: run with .venv-embodiment/Scripts/python.exe")

ASSETS = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..",
    ".venv-embodiment", "Lib", "site-packages", "flybody", "fruitfly", "assets"))
XML = os.path.join(ASSETS, "fruitfly.xml")
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else
                      os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                                   "nmf_pose_springref.json"))


def quat_to_mat(q):
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def mat_to_quat(m):
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        s = np.sqrt(tr + 1.0) * 2
        return np.array([0.25 * s, (m[2, 1] - m[1, 2]) / s,
                         (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s])
    i = int(np.argmax([m[0, 0], m[1, 1], m[2, 2]]))
    if i == 0:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [(m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s]
    elif i == 1:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s]
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s]
    return np.array(q)


def main():
    model = mujoco.MjModel.from_xml_path(XML)
    data = mujoco.MjData(model)
    data.qpos[:] = model.qpos_spring
    mujoco.mj_forward(model, data)

    bodies = {}
    for i in range(model.nbody):
        name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY, i) or "body%d" % i
        par = model.body_parentid[i]
        Rpar, ppar = quat_to_mat(data.xquat[par]), data.xpos[par]
        Rloc = Rpar.T @ quat_to_mat(data.xquat[i])
        ploc = Rpar.T @ (data.xpos[i] - ppar)
        bodies[name] = {"pos": [round(float(v), 10) for v in ploc],
                        "quat": [round(float(v), 10) for v in mat_to_quat(Rloc)]}

    joints = {}
    for j in range(model.njnt):
        n = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT, j)
        if n and model.jnt_type[j] == mujoco.mjtJoint.mjJNT_HINGE:
            joints[n] = round(float(model.qpos_spring[model.jnt_qposadr[j]]), 10)

    payload = {"source": "flybody fruitfly.xml", "pose": "qpos = qpos_spring (passive rest)",
               "nbody": int(model.nbody), "njoints": int(model.njnt),
               "bodies": bodies, "springref": joints}
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=1, sort_keys=True)
    print("wrote", OUT, "bodies:", len(bodies), "hinge joints:", len(joints))
    for k in ("wing_left", "wing_right", "head", "abdomen", "thorax"):
        if k in bodies:
            print("  %-11s pos %s quat(wxyz) %s" % (k, np.round(bodies[k]["pos"], 4),
                                                    np.round(bodies[k]["quat"], 4)))


if __name__ == "__main__":
    main()
