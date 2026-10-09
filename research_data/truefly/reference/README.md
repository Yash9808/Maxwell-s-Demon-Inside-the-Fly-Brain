# TrueFly asset check — MuJoCo's own render vs the shipped `nmf_fly.glb`

This folder is the reference plate for one question: **the browser asset the app renders
(`nmf_fly.glb`) and the flybody MuJoCo model it was packed from are supposed to be the same
fly in the same pose — are they?**

It is a two-sided capture. One side is MuJoCo's *own* renderer, offline, on
`qpos = qpos_spring` (the pose baked into the glb), which is the source of truth — flybody's
published figures are MuJoCo renders. The other side is the *live app* (`fly_demon_3d.html`,
its own `WebGLRenderer`, scene, materials, CONFORM fit and 170-unit normalisation) rendering
the shipped asset, with the director pose frozen and both wings put back on their baked rest
quaternion. Both sides take the same four named views and are written to the same folder, so a
pose or orientation mismatch can be read off one image, from the repo, without a browser.

**Start here: [`nmf_reference_plate.png`](nmf_reference_plate.png)** — 4 views x 4 panels
(MuJoCo | the app's asset | silhouettes as rendered | best-case overlap).

## Files

| file | what it is |
|---|---|
| `nmf_reference_plate.png` | the plate: every view, both renders, both silhouette overlaps, the numbers inline |
| `plate_metrics.json` | every number in the plate, machine-readable, with hashes |
| `mujoco_<view>.png` | MuJoCo's own render (source of truth), one per view |
| `mujoco_facts.json` | MuJoCo camera, model AABB, per-view landmark pixels, marker-DLT residual, hashes |
| `browser_<view>.png` | the live app's render of the shipped glb, one per view |
| `browser_probe.png` | the browser harness's own self-check render (welded markers vs analytic projection) |
| `browser_facts.json` | poses/scale, AABBs, per-view landmark pixels, projection self-check, page + asset hashes |

Both captures were verified by the two harnesses before the plate was drawn:
MuJoCo's landmark pixels come from marker spheres welded into the scene and a DLT fit of the
world→pixel map (residual 0.041 – 0.112 px mean, worst 0.19 px); the browser's come from the
app's own camera projecting the glb nodes, cross-checked against markers (0.74 px worst).
`plate_metrics.json` records the glb hash recorded at capture time and the hash of
`nmf_fly.glb` on disk now — `glb_unchanged_since_capture` was `true` for this plate.

## Regenerate

```
.venv-embodiment/Scripts/python.exe tools/render_nmf_reference.py      # MuJoCo, offline
python tools/capture_nmf_browser.py                                    # live app, CDP (needs Chrome)
python tools/compose_nmf_reference_plate.py                            # this plate + metrics
.venv-embodiment/Scripts/python.exe tools/check_nmf_glb_vs_mujoco.py   # geometry-only, model numbers
```

`tools/check_nmf_glb_vs_mujoco.py` needs no browser and no plate: it compares the glb's mesh
nodes against MuJoCo's compiled mesh geoms and **exits 1 while the asset has the mismatch
reported below** (mean box-centre distance 0.0432 model units against a 0.005 tolerance), so it
doubles as the regression check for a rebuild. Its output is the source of the numbers in
"The mechanical difference" section.

## The numbers

Silhouettes are foreground = pixels differing from the modal border colour (MuJoCo renders on
black, the app on its own dark clear colour; the IoU is insensitive to the threshold —
0.409 → 0.415 for the dorsal view as the tolerance drops from 12 to 2).

*IoU* = overlap of the two silhouettes. *landmark-fit* = IoU after the 2D similarity estimated
from the eight named landmark bodies (absorbs the framing difference; its residual says whether
the two images even show the same skeleton). *best-case* = IoU at the uniform scale and integer
shift that maximise it (shape only, no rotation, no mirror).

| view | MuJoCo bbox | app bbox | MuJoCo px | app px | IoU as rendered | IoU at landmark fit | IoU best case | best scale | landmark rms | landmark scale | mirror |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dorsal | 189x483 | 199x450 | 65,910 | 34,477 | 0.409 | 0.153 | 0.544 | 1.35 | 6.65 px | 0.483 | yes |
| lateral | 557x243 | 453x356 | 63,164 | 26,418 | 0.269 | 0.221 | 0.595 | 1.60 | **1.76 px** | 0.561 | no |
| front | 267x356 | 216x460 | 51,296 | 13,786 | 0.227 | 0.147 | 0.528 | 2.00 | 11.60 px | 0.507 | yes |
| quarter | 467x366 | 352x421 | 74,885 | 26,047 | 0.278 | 0.148 | 0.618 | 1.75 | 25.03 px | 0.458 | no |

Framing: each capture frames **its own** measured AABB (fill 0.80, fovy 45 deg), so the app's
image is smaller by construction whenever the two AABBs differ — and they do:

| | AABB size (model units) | bounding radius |
|---|---|---|
| MuJoCo model (compiled geometry) | `0.3137 x 0.1011 x 0.1429` | 0.1796 |
| shipped glb (wrappers pinned to identity) | `0.5477 x 0.2453 x 0.2221` | 0.32 |

Sorted per-axis ratio browser/MuJoCo: **1.75 / 1.72 / 2.20**.

## Reading the numbers

* **The skeleton agrees.** In the lateral view all eight landmark bodies — thorax, head,
  abdomen, both wing roots, front and hind claws — fit a single similarity to **1.76 px rms**
  (worst single landmark 3.6 px), with no rotation and no mirror, at scale 0.561. That scale is
  exactly the framing ratio implied by the two radii (0.1796 / 0.32 in the same units), i.e.
  1/0.561 = 1.78. So the joint tree, the joint angles and the view itself are the same on both
  sides; the only thing that can explain the rest is geometry, not pose or camera.
* **The meshes do not agree.** At that same view, the two silhouettes overlap only
  **0.22**, and even at the best uniform scale and offset only **0.60**. The app's fly covers
  **0.42** of the silhouette area MuJoCo gives the same fly (26,418 px vs 63,164 px) while
  being framed from an AABB that is 1.75x larger per axis: the app's fly is a *compact* body
  with parts sticking out far enough to inflate its own bounding box, and those outliers are
  why its silhouette is small relative to the frame.
* The dorsal, front and quarter views fit the landmark constellation **better with a mirror**
  than without (6.65 px vs 31.9 px in dorsal), while lateral does not — worth remembering when
  reading the panels, because a mirrored fit is a statement about which side of the fly is
  facing the camera, not about its shape.

## The mechanical difference between the two (measured offline)

`tools/build_nmf_fly_glb.js` reads the flybody **OBJ** files directly and multiplies by the
MJCF mesh scale 0.1:

* the shipped glb's mesh accessor for the thorax is `min (-0.06473, -0.04388, 0.06821)`,
  `max (0.05132, 0.04388, 0.16889)` — **bit-for-bit the OBJ's own vertex range, x 0.1** (the
  OBJ lives in the original scan frame, with the thorax around `z = 1.19`, not at the origin).

MuJoCo compiles the same file differently: `m.mesh_vert` is the same vertices through a
**rigid** reframing — a Kabsch fit of `m.mesh_vert` against the OBJ vertices x 0.1 gives
scale **1.000000** and **0.000000** maximum residual on thorax, head and wing membrane — and
the reframing is recorded in `m.mesh_pos` / `m.mesh_quat`, which `fruitfly.xml` does not
declare (the compiler produced them). MuJoCo's renderer draws `m.mesh_vert` at the compiled
geom pose, and is provably insensitive to the mesh frame: re-rendering with
`mesh_pos = 0, mesh_quat = identity` is **pixel-identical**, and so is `mesh_scale = 1.0`.

So the two sides place the *same* vertices with *different* per-geom frames. Pairing the glb's
84 mesh nodes against the 84 MuJoCo mesh geoms of the same name (world box centre and size):

* mean centre distance **0.0432** model units, max **0.2825**
* worst offenders: `wing_left_membrane` 0.2825, `wing_left_brown` 0.2755,
  `tarsal_claw_T3_left_brown` 0.1913, `abdomen_8` 0.1392, `antenna_right` 0.1363
* per-mesh *sizes* agree (mean worst-axis difference 0.020 units, most of it the
  axis-aligned-box inflation of a rotated mesh)

The largest offsets are the wing membranes, at 0.28 model units — about 90% of the body length
— which is the same signature as the "wings detached / body separated" reports. Reproduce with
`tools/check_nmf_glb_vs_mujoco.py`, which prints all of the above and exits 1.

## What this plate does and does not settle

* It **does** settle the "read the numbers out of a live page" problem: both renders are in the
  repo, reproducible, with their hashes, and the disagreement is now a picture plus a table.
* The MuJoCo side is the reference **by construction** (it is the renderer flybody publishes
  with) — the plate shows the app's asset does not reproduce it, it does not by itself prove
  which end of the packer should change.
* The framing difference (each side frames its own AABB) is deliberate and is why the plate
  reports both the as-rendered and the aligned IoU. The aligned numbers are the ones to compare
  shapes with.
* The silhouettes are thresholded, so a semi-transparent material (the wing membrane is
  `alphaMode: BLEND`, base colour alpha 0.4) could in principle vanish in the app's render and
  shrink its silhouette; the IoU is insensitive to the threshold (see above), so the small app
  silhouette is not a thresholding artefact.
* Everything on both sides is frozen: the app's director pitch/roll/yaw are zeroed, its HUD is
  excluded (the image is read from the WebGL drawing buffer, not composited from the DOM), and
  only the fly's own subtree is kept.

## If the asset is to be rebuilt

The packer already asks MuJoCo for the pose (`tools/export_nmf_pose.py` → `--pose`). The same
move for the geometry would close the gap measured here: export each geom's **compiled** pose
(`data.geom_xpos` / `geom_xmat` in the body frame, or `m.geom_pos` / `m.geom_quat`) and/or each
mesh's frame (`m.mesh_pos` / `m.mesh_quat`), have the builder use those instead of the
XML-declared geom pos/quat, rebuild, and re-run these three commands — the expected signature is
an AABB ratio near 1 and a best-case IoU well above 0.9.
