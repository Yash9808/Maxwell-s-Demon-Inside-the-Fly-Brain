# TrueFly (nmf_fly.glb) — "wings detached / body separated": measured cause + fix

Scope: **render only**. `fly_demon_3d.html`, the `trueflyLoad` / `trueflyWings` block.
No simulator, pose-stream or contract code was touched.

## What was wrong (two independent defects, both measured)

### 1. Wing flutter overwrote the wing body's rest orientation

`nmf_fly.glb` is built offline from the MuJoCo MJCF tree, so each wing **body node carries a
baked rest orientation** of its own (the wing root pose the XML defines):

| node | rest quat (w,x,y,z, from `fruitfly.xml`) | rest Euler XYZ | local X (hinge) axis in thorax frame |
|---|---|---|---|
| `wing_left`  | `0, -0.403, 0, -0.915` | `0°, +47.5°, -180°` | `(-0.674, 0, +0.737)` |
| `wing_right` | `0, +0.915, 0, -0.403` | `-180°, -47.5°, 0°` | `(+0.675, 0, -0.737)` |

The flutter wrote `w.rotation.x = side * amp * sin(...)`, i.e. it **replaced the Euler x
component** while three.js kept the rest y/z. For the left wing that is nearly harmless
(rest x = 0), but `wing_right`'s rest x is **−π**, so the write threw it ~180° about the
fore-aft axis:

* measured deviation from rest at the same instant: **left 2–23°, right 155–178°**
  (`angleRest_vs_applied_x0` = 2.2° / 178.0°; `x0.4` = 23.0° / 157.0°)
* live page read-back: `wing_right` euler `(-0.4365, -0.8293, 0)` — the rest `-π` gone
* the per-side sign flip made it worse: the two hinge axes are already mirror images, so a
  common angle rolls both wings dorsally, while a flip rolls the pair like one rigid sheet

### 2. The recentring step measured the model through its own stale wrapper transform

`Box3.setFromObject(gltf.scene)` reads `matrixWorld`, and the wrapper (`inner`) already held
its yaw + scale + an offset from the pre-conform centring pass. The AABB was therefore taken
in a contaminated frame:

* model-space AABB (clean measurement): centre `(0.091, 0.078, 0.013)`, size `(0.424, 0.430, 0.246)` glb units
* shipped `inner.position`: `(24.32, -3.35, 10.99)`; correct value (wrapper pinned to identity):
  `(10.99, -3.35, -24.32)` → **error 57 wrapper units ≈ 85 world units**
* measured body offset from the `flyGroup` origin (where the perch / dock / push-brace legs
  and every director pose are anchored), in flyGroup-local units: **40.7 before → 10.3 after**
  (the remaining few units are the AABB-vs-rotation second-order term the legacy path has too)

## Fix

1. Capture each wing body's rest quaternion at load (`w.userData.nmfRest`) and, per frame,
   compose the roll instead of overwriting an Euler component:
   `w.quaternion.copy(rest).multiply(quatFromAxisAngle(localX, amp*sin(phase)))`
   — the MJCF `wing_roll` joint axis (`axis="1 0 0"`), same angle sign on both sides, pair in phase.
2. Re-measure the AABB **after** the conform with the wrapper pinned to identity
   (`quaternion`, `position`, `scale` saved/restored), then place with
   `inner.position = -q_inner · s · c_conform`.

## Verification (live, unthrottled headed session, `?fly=nmf` default)

* wings symmetric: both wings read the **same** deviation from rest (10.7° / 10.7°, then 19.1° / 19.1°
  at a later phase) instead of left ≈0° and right ≈160°
* screenshots: side view and top-down view — both membranes attached at the thorax, mirrored,
  veined; no membrane floating off the body
* legacy path `?fly=legacy` (4 `FLYAL*` nodes, `rotation.z` branch) unchanged and rendering
* `fly_demon_3d.html` module block parses (`vm.SourceTextModule`); smoke suite
  **80 passed, 0 failed, exit 0** (includes `S12 dual-viewport 3D presentation (static pins)`)

## Follow-up defect: the asset was built at qpos = 0, not at flybody's rest pose

`tools/build_nmf_fly_glb.js` copied each MJCF `<body>`'s `pos`/`quat` **verbatim**, which is the
pose at **qpos = 0**. That is not the pose flybody renders: MuJoCo's passive elements hold every
joint at its `springref`, and for the wings that is a large sweep
(`wing_yaw 1.5`, `wing_roll 0.7`, `wing_pitch -1.0` rad) — so the shipped mesh sat with both wings
spread out sideways across the body (and the legs in their qpos=0 splay) instead of swept back over
the abdomen as in the flybody reference figure.

Fix — let MuJoCo answer, instead of re-deriving MJCF default resolution by hand:

* `tools/export_nmf_pose.py` (new): loads `fruitfly.xml` with `mujoco`, sets
  `qpos = model.qpos_spring`, `mj_forward`, and writes every body's **parent-local**
  translation + rotation (`nmf_pose_springref.json`, 68 bodies + all 102 hinge springrefs).
* `tools/build_nmf_fly_glb.js`: `--pose <json>` bakes those transforms into the node TRS (the
  joints' rest angles are already folded in by MuJoCo); the GLB `asset.extras` records the pose.
* Rebuild: `node tools/build_nmf_fly_glb.js --pose nmf_pose_springref.json` →
  `nmf_fly.glb`, 151 nodes / 84 meshes / 270,734 triangles, exit 0.

Also fixed in the packer while doing this: the JSON chunk was zero-padded, but glTF 2.0 requires
**space** padding for the JSON chunk — with the new (off-alignment) JSON length the builder's own
verify step threw `Unexpected non-whitespace character after JSON`, and a NUL-padded chunk is not
parseable by `JSON.parse` in the loader either. Now padded with `0x20` (the verify step still
parses the chunk back).

Verified after the rebuild: wing rest quats read `(-0.402,-0.304,-0.604,0.617)` /
`(-0.604,0.617,0.402,0.304)` (exactly MuJoCo's springref pose) with the flutter deviating
symmetric (`1.2° / 1.2°`); model AABB centre 7.6 flyGroup-local units from the anchor; smoke suite
**80 passed, 0 failed, exit 0**; screenshots show the swept-back wings, the red compound eye and the
passive leg stance matching the flybody figure.

## "Can we just use flybody directly?"

Partially yes — and we already do. `.venv-embodiment` has `flybody 0.1.0`, `mujoco 3.13.0` and
`dm_control`, and the 85 body-segment OBJs + `fruitfly.xml` live in its assets dir:
that is the source of both the meshes and the joint tree. What cannot move into the app is the
**renderer**: MuJoCo renders on the host (its own GL/EGL context), while the live chamber is a
browser tab — so the pipeline stays *MuJoCo offline as the source of truth → prebuilt glTF →
three.js*. The change above makes the offline stage ask MuJoCo for the geometry **and the pose**, so
the browser asset and the reference figure now come from the same model state. Anything that needs
MuJoCo's own lighting/materials (e.g. a reference plate for docs) has to be pre-rendered offline.

## Third defect: the fly was yawed 90° (it flew broadside)

The NMF fit was `wrapper Ry(90°) · scene Ry(180°)·Rx(−90°)`, and the earlier note that the mesh's
"forward = −X" was **wrong**. Measured on the live model's own landmarks:

| direction | mesh/model space | scene-local after conform | flyGroup-local (before fix) |
|---|---|---|---|
| thorax→head | **+X** | −X | **+Z** |
| dorsal | +Z | +Y | +Y (correct) |
| wingspan | ±Y | ±Z | ±X |

The wrapper's `Ry(90°)` is there to bring the **legacy Sketchfab** model's `+Z` nose onto the rig's
`+X`; applied to the MJCF mesh it left the nose along the rig's `+Z` while the wingspan lay along the
flight axis `±X` — the fly flew broadside, its wings sweeping across the body, which is what the
"not arranged like the flybody figure" reports were seeing.

Fix (`fly_demon_3d.html`, NMF branch only): the fit is now a single roll `Rx(−90°)` (dorsal `+Z` →
`+Y`, nose stays `+X`) with the wrapper yaw **pinned to identity**. Re-measured after the fix, in
flyGroup-local units: `head−thorax = (+11.5, −0.6, 0)`, `abdomen−thorax = (−9.1, 0.9, 0.1)`,
`wing_left = (−1.4, 1.9, −8.8)` / `wing_right = (−1.4, 1.9, +8.7)`, front claws `(−1.3, −19.7, −1.1)`,
hind claws `(−41.4, −21, −3.2)` → nose on the rig's forward `+X`, wingspan lateral `±Z`, legs below.
World box after the fix: `170.9 × 71.1 × 103.8` (fore-aft is now the long axis, and the 170-unit
normalization lands on it).

Verified: wings still deviate symmetrically from rest (`20.6° / 20.6°`); model AABB centre 10.4
flyGroup-local units from the anchor (same order as the legacy path's own AABB-vs-rotation term);
dorsal screenshot shows a straight body, wings folded back along the abdomen and legs splayed to
both sides — the top view of the flybody anatomy figure. Legacy `?fly=legacy` re-checked: asset
`legacy fly.glb`, 4 `FLYAL*` wings, wrapper yaw still `Ry(90°)` (untouched). The truefly module
block parses and the smoke suite is **80 passed, 0 failed, exit 0** after the change.

## Fourth defect (open): the meshes sit in the OBJ's scan frame, not MuJoCo's mesh frame

The three fixes above all move the **body** nodes. They cannot move the **meshes**, and a
committed two-sided capture — MuJoCo's own renderer offline next to the live app's render of the
shipped asset — says the meshes are still placed differently than the model they were packed
from:

* [`research_data/truefly/reference/README.md`](reference/README.md), plate
  [`reference/nmf_reference_plate.png`](reference/nmf_reference_plate.png), metrics in
  [`reference/plate_metrics.json`](reference/plate_metrics.json).
* The **skeleton** agrees: in the lateral view all eight landmark bodies fit one similarity to
  **1.76 px rms** (no rotation, no mirror) at the framing ratio implied by the two AABBs. So the
  joint tree, the joint angles and the views match.
* The **silhouettes** do not: IoU 0.22 at that same view (0.60 at the best uniform scale and
  offset), and the app's fly covers 26,418 px where MuJoCo's covers 63,164 px while being framed
  from an AABB 1.75x larger per axis.
* Mechanism, measured: the packer reads the OBJ files (`build_nmf_fly_glb.js`,
  `parseOBJ`, `SCALE = 0.1`) and places them at the **XML-declared** geom pos/quat. MuJoCo
  compiles the same meshes through a **rigid** reframing it does not take from the XML
  (`m.mesh_pos` / `m.mesh_quat`; Kabsch against `OBJ x 0.1`: scale `1.000000`, max residual
  `0.000000`) and draws `m.mesh_vert` at the compiled geom pose — re-rendering with
  `mesh_pos = 0 / mesh_quat = identity` is pixel-identical. Pairing the 84 mesh nodes against the
  84 model mesh geoms: **mean box-centre distance 0.0432, max 0.2825 model units**, worst at the
  wing membranes (`wing_left_membrane` 0.2825 — about 90% of the body length,
  `wing_left_brown` 0.2755, `tarsal_claw_T3_left_brown` 0.1913).
* Reproduce: `.venv-embodiment/Scripts/python.exe tools/check_nmf_glb_vs_mujoco.py` — prints the
  above and **exits 1** while the asset does not reproduce the model.

Next step if this is to be fixed: export the compiled mesh frame from MuJoCo the same way
`tools/export_nmf_pose.py` already exports the pose, have the packer use it, rebuild, and re-run
the plate and the checker (expected: AABB ratio near 1, best-case IoU well above 0.9, checker
exit 0).
