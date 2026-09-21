# -*- coding: utf-8 -*-
"""Rebuild ALL anatomy assets in ONE canonical scene frame.

Problem: fly_brain_positions.bin, fly_brain_meta.json and fly_brain_hulls.bin
were exported in three different coordinate frames (raw nm, raw*0.1, and a
re-centered variant), so hulls didn't wrap the neuron cloud and the brain
didn't read as a fly brain.

Fix (single source of truth):
 1. Circuit neuron order: fly_brain_circuit.json layer order -> index i.
 2. For every circuit neuron: mean POST-synaptic position from the 130M-row
    synapse table (pyarrow group_by, C-speed), in FAFB nm.
 3. Canonical frame: FlyWire axes as used by the published renders, matching
    the orientation the 3D lab (camera, ellipsoid fallbacks) was tuned for:
      scene_x =  (x_nm - cx) * S   (left/right: left lobe at negative x)
      scene_y =  (z_nm - cz) * S   (dorsal up)
      scene_z = -(y_nm - cy) * S   (anterior toward viewer at negative z)
    with c* = per-axis median over circuit neurons (robust) and S chosen so
    the 99.5th-percentile brain radius maps to 400 scene units (~880-unit
    brain overall, same stage scale the 3D lab camera was tuned for).
 4. Per-neuron primary INPUT neuropil from per_neuron_neuropil_count_post
    (real annotation, not derived).
 5. Neuropil meta: for each neuropil in the post-count table, count + centroid
    + spread of its neurons IN THE CANONICAL FRAME.
 6. Hulls: per-neuropil alpha-ish hull via voxel occupancy + marching-cubes-
    free surface: sample voxel shell, emit quads -> triangles (simple, fast,
    deterministic). Use scipy.ndimage if available, else pure numpy shell.
    Hull vertices in the SAME canonical frame.

Outputs (all in the same frame):
  fly_brain_positions.bin : Int16 x,y,z*10 + Uint8 primary neuropil idx
  fly_brain_meta.json     : n, np_names, neuropils {c,s,n}, region_of, frame
  fly_brain_hulls.bin/.json : per-neuropil surfaces (canonical frame)
"""
import json, struct, math, time
from pathlib import Path
import numpy as np
import pyarrow.feather as ft
import pyarrow.compute as pc
import pyarrow as pa

T0 = time.time()
TARGET_RADIUS = 400.0          # scene units for the 99.5th-percentile radius
BIN_POS = Path("fly_brain_positions.bin")
BIN_HULL = Path("fly_brain_hulls.bin")
JSN_HULL = Path("fly_brain_hulls.json")
JSN_META = Path("fly_brain_meta.json")

# ---------------------------------------------------------------- circuit order
# fly_brain_circuit.json stores LOCAL neuron indices 0..N-1, not root IDs
# (extract_circuit.py maps sorted(root_ids) -> index and never persists the IDs).
# Rebuild that exact mapping from the pre-counts table (same algorithm as
# extract_circuit.py) so every later lookup uses REAL v783 root IDs.
circuit = json.loads(Path("fly_brain_circuit.json").read_text())
N = sum(len(l) for l in circuit["layers"])
LAYER_NPILS = [
    {"AL_L", "AL_R"},
    {"ME_L", "ME_R", "LO_L", "LO_R", "LOP_L", "LOP_R"},
    {"LH_L", "LH_R", "MB_CA_L", "MB_CA_R", "MB_VL_L", "MB_VL_R",
     "MB_ML_L", "MB_ML_R", "MB_PED_L", "MB_PED_R"},
    {"SMP_L", "SMP_R", "SIP_L", "SIP_R", "SLP_L", "SLP_R"},
    {"GNG", "SAD"},
]
pre = ft.read_table("per_neuron_neuropil_count_pre_783.feather")
proof = pa.array(np.load("proofread_root_ids_783.npy").tolist(), type=pa.int64())
pre = pre.filter(pc.is_in(pre["pre_pt_root_id"], value_set=proof))
mx = pre.group_by("pre_pt_root_id").aggregate([("count", "max")])
top = pre.join(mx, keys="pre_pt_root_id", join_type="inner")
top = top.filter(pc.equal(top["count"], top["count_max"]))
pre_map = top.group_by("pre_pt_root_id").aggregate([("neuropil", "min")])
layer_of = {}
for rid, npil in zip(pre_map["pre_pt_root_id"].to_pylist(), pre_map["neuropil_min"].to_pylist()):
    for li, group in enumerate(LAYER_NPILS):
        if npil in group:
            layer_of[int(rid)] = li
            break
root_of = sorted(layer_of)                     # circuit index -> v783 root ID
idx = {rid: i for i, rid in enumerate(root_of)}
recon = [[] for _ in LAYER_NPILS]
for rid in root_of:
    recon[layer_of[rid]].append(idx[rid])
assert recon == circuit["layers"], "reconstructed layer mapping != fly_brain_circuit.json"
print(f"circuit neurons: {N} (index->root_id mapping reconstructed & verified)")

# ------------------------------------------------- 1) mean POST position / neuron
syn = ft.read_table(
    "synapses_connections_783.feather",
    columns=["post_pt_root_id", "post_pt_position_x", "post_pt_position_y", "post_pt_position_z"],
)
keys = pa.array(root_of, type=pa.int64())
syn = syn.filter(pc.is_in(syn["post_pt_root_id"], value_set=keys))
print(f"synapse rows matched: {syn.num_rows:,}  ({time.time()-T0:.0f}s)")
gb = syn.group_by("post_pt_root_id").aggregate([
    ("post_pt_position_x", "mean"),
    ("post_pt_position_y", "mean"),
    ("post_pt_position_z", "mean"),
])
gb_ids = gb["post_pt_root_id"].to_numpy()
gx = gb["post_pt_position_x_mean"].to_numpy()
gy = gb["post_pt_position_y_mean"].to_numpy()
gz = gb["post_pt_position_z_mean"].to_numpy()
mean_x = np.full(N, np.nan); mean_y = np.full(N, np.nan); mean_z = np.full(N, np.nan)
idx_map = np.array([idx[int(r)] for r in gb_ids])
mean_x[idx_map] = gx; mean_y[idx_map] = gy; mean_z[idx_map] = gz
del syn, gb
covered = np.isfinite(mean_x)
print(f"neurons with POST positions: {covered.sum():,}/{N}  ({time.time()-T0:.0f}s)")

# fill missing (no post synapses): use PRE positions
miss_ids = [root_of[i] for i in range(N) if not covered[i]]
if miss_ids:
    syn2 = ft.read_table(
        "synapses_connections_783.feather",
        columns=["pre_pt_root_id", "pre_pt_position_x", "pre_pt_position_y", "pre_pt_position_z"],
    )
    syn2 = syn2.filter(pc.is_in(syn2["pre_pt_root_id"], value_set=pa.array(miss_ids, type=pa.int64())))
    gb2 = syn2.group_by("pre_pt_root_id").aggregate([
        ("pre_pt_position_x", "mean"), ("pre_pt_position_y", "mean"), ("pre_pt_position_z", "mean")])
    ids2 = gb2["pre_pt_root_id"].to_numpy()
    idx2 = np.array([idx[int(r)] for r in ids2])
    mean_x[idx2] = gb2["pre_pt_position_x_mean"].to_numpy()
    mean_y[idx2] = gb2["pre_pt_position_y_mean"].to_numpy()
    mean_z[idx2] = gb2["pre_pt_position_z_mean"].to_numpy()
    del syn2, gb2
    covered = np.isfinite(mean_x)
    print(f"after PRE fallback: {covered.sum():,}/{N}")

# fill any remainder with the global centroid (rare)
cx_nm, cy_nm, cz_nm = (np.nanmedian(mean_x), np.nanmedian(mean_y), np.nanmedian(mean_z))
mean_x = np.where(covered, mean_x, cx_nm)
mean_y = np.where(covered, mean_y, cy_nm)
mean_z = np.where(covered, mean_z, cz_nm)

# ------------------------------------------------- 2) canonical frame transform
# FlyWire conventions: x = left-right (L+), y = anterior-posterior (anterior+),
# z = dorsal-ventral (dorsal+). Scene: +x right lobe mirrored, +y up, +z depth.
# Adaptive robust scale: outliers (e.g. descending neurons with synapses in
# the VNC) must not set the scale -- fit S on the 99.5th-percentile extents.
ext_nm = [float(np.percentile(mean_x, 99.5) - np.percentile(mean_x, 0.5)),
          float(np.percentile(mean_y, 99.5) - np.percentile(mean_y, 0.5)),
          float(np.percentile(mean_z, 99.5) - np.percentile(mean_z, 0.5))]
S = TARGET_RADIUS / max(max(ext_nm) / 2.0, 1.0)
print(f"nm extents p0.5-99.5 x[{ext_nm[0]:.0f}] y[{ext_nm[1]:.0f}] z[{ext_nm[2]:.0f}] -> S={S:.6g}")
sx = (mean_x - cx_nm) * S
sy = (mean_z - cz_nm) * S
sz = -(mean_y - cy_nm) * S
print(f"scene extent x[{sx.min():.0f},{sx.max():.0f}] y[{sy.min():.0f},{sy.max():.0f}] z[{sz.min():.0f},{sz.max():.0f}]")

# ------------------------------------------------- 3) primary input neuropil
post_np = ft.read_table("per_neuron_neuropil_count_post_783.feather")
print("post_np columns:", post_np.column_names)
# normalize long-format key column (post_pt_root_id -> root_id)
if "post_pt_root_id" in post_np.column_names:
    post_np = post_np.rename_columns(["root_id" if c == "post_pt_root_id" else c for c in post_np.column_names])
# expect: root_id, neuropil, count  (or wide) -- normalize:
if "neuropil" in post_np.column_names:
    post_np = post_np.filter(pc.is_in(post_np["root_id"], value_set=keys))
    top = post_np.group_by("root_id").aggregate([("count", "max")])
    post_np = top.join(post_np, keys="root_id", join_type="inner")
    post_np = post_np.filter(pc.equal(post_np["count"], post_np["count_max"]))
    prim_np = {}
    for rid, npil in zip(post_np["root_id"].to_pylist(), post_np["neuropil"].to_pylist()):
        rid = int(rid)
        if rid not in prim_np or npil < prim_np[rid]:   # deterministic tie-break
            prim_np[rid] = npil
else:
    # wide format: one row per neuron, columns = neuropils
    cols = [c for c in post_np.column_names if c != "root_id"]
    arrs = {c: post_np[c].to_numpy() for c in cols}
    rids = post_np["root_id"].to_pylist()
    prim_np = {}
    for k, rid in enumerate(rids):
        best, bn = None, -1
        for c in cols:
            v = arrs[c][k]
            if v > bn: bn, best = v, c
        prim_np[int(rid)] = best
np_names = sorted({v for v in prim_np.values()})
np_idx = {nm: i for i, nm in enumerate(np_names)}
prim = np.full(N, 255, dtype=np.uint8)
for i in range(N):
    nm = prim_np.get(root_of[i])
    if nm is not None: prim[i] = np_idx[nm]
print(f"primary neuropils assigned: {(prim!=255).sum():,}/{N}  ({time.time()-T0:.0f}s)")

# ------------------------------------------------- 4) write positions bin
# Layout MUST match the 3D lab's parser: one contiguous little-endian Int16
# block with all 3N coordinates, FOLLOWED by one Uint8 block with the N
# primary-neuropil indices (Int16Array(buf,0,3n) + Uint8Array(buf,6n,n)).
# (Interleaved 7-byte records would corrupt every 4th Int16 under the flat
# view and scatter half the neurons outside the brain.)
qx = np.round(sx*10).astype(np.int64); qy = np.round(sy*10).astype(np.int64); qz = np.round(sz*10).astype(np.int64)
qall = np.empty(N*3, dtype=np.int64)
qall[0::3] = qx; qall[1::3] = qy; qall[2::3] = qz
qall = np.clip(qall, -32768, 32767).astype("<i2")
assert prim.max(initial=0) <= 255
out = qall.tobytes() + prim.astype(np.uint8).tobytes()
assert len(out) == N*7
BIN_POS.write_bytes(out)
print(f"positions bin: {len(out):,} bytes")

# ------------------------------------------------- 5) neuropil meta (canonical)
meta_np = {}
for i in range(N):
    p = prim[i]
    if p == 255: continue
    nm = np_names[p]
    d = meta_np.setdefault(nm, {"n":0, "sx":0.0, "sy":0.0, "sz":0.0,
                                "sxx":0.0, "syy":0.0, "szz":0.0})
    d["n"] += 1
    d["sx"] += sx[i]; d["sy"] += sy[i]; d["sz"] += sz[i]
    d["sxx"] += sx[i]**2; d["syy"] += sy[i]**2; d["szz"] += sz[i]**2
neuropils = {}
for nm, d in meta_np.items():
    n = max(1, d["n"])
    c = [d["sx"]/n, d["sy"]/n, d["sz"]/n]
    s = [math.sqrt(max(1.0, d["sxx"]/n - c[0]**2)),
         math.sqrt(max(1.0, d["syy"]/n - c[1]**2)),
         math.sqrt(max(1.0, d["szz"]/n - c[2]**2))]
    neuropils[nm] = {"c": [round(v,1) for v in c], "s": [round(v,1) for v in s], "n": d["n"]}
region_of = {
  "optic": [nm for nm in np_names if nm.startswith(("ME","LO","LOP","AME","LA"))],
  "antennal": [nm for nm in np_names if nm.startswith(("AL","AMMC","FLA"))],
  "mb": [nm for nm in np_names if nm.startswith(("MB","CA","PED"))],
  "lh": [nm for nm in np_names if nm.startswith("LH")],
  "cx": [nm for nm in np_names if nm.startswith(("FB","EB","PB","NO","BU","GA","SAD","EPG"))],
  "motor": [nm for nm in np_names if nm.startswith(("VNC","GNG","SOG","OCS"))],
  "central": [],
}
claimed = {nm for lst in region_of.values() for nm in lst}
region_of["central"] = [nm for nm in np_names if nm not in claimed]
meta = {
  "dataset": "fafb_v783", "n": N, "unplaced_idx": 255,
  "np_names": np_names, "neuropils": neuropils, "region_of": region_of,
  "frame": f"canonical v3: scene = ((x-x_med)*S, (z-z_med)*S, -(y-y_med)*S) -- FlyWire axes, optic lobes on scene X; S={S:.6g} (adaptive, p99.5 radius -> {TARGET_RADIUS:.0f} units), medians over circuit neurons; source synapses_connections_783 POST positions",
}
JSN_META.write_text(json.dumps(meta))
print(f"meta: {len(np_names)} neuropils  ({time.time()-T0:.0f}s)")

# ------------------------------------------------- 6) hulls (voxel shell surfaces)
# Deterministic per-neuropil surface from real neuron positions:
#  - voxelize neuron cloud at ~14-unit resolution
#  - shell = occupied voxels with an empty 6-neighbour
#  - emit 2 triangles per shell face adjacent to empty space (marching-cubes-free)
def hull_for(nm, pts):
    if len(pts) < 40: return None
    res = 14.0
    lo = pts.min(0) - res; hi = pts.max(0) + res
    dims = np.maximum(2, ((hi-lo)/res).astype(int) + 1)
    grid = np.zeros(dims, dtype=bool)
    gi = ((pts - lo)/res).astype(int)
    grid[gi[:,0], gi[:,1], gi[:,2]] = True
    # dilate-free shell: occupied with an empty neighbor
    occ = grid
    pad = np.pad(occ, 1)
    nbr_empty = ~(pad[1:-1,1:-1,1:-1] & pad[:-2,1:-1,1:-1] & pad[2:,1:-1,1:-1] &
                  pad[1:-1,:-2,1:-1] & pad[1:-1,2:,1:-1] &
                  pad[1:-1,1:-1,:-2] & pad[1:-1,1:-1,2:])
    shell = occ & nbr_empty
    if shell.sum() < 8: return None
    # emit faces where shell voxel borders empty along an axis
    faces = []
    def emit(axis_dir, shift):
        a = shell & ~np.roll(occ, -shift, axis=axis_dir) if shift else shell
        idxs = np.argwhere(a)
        for (i,j,k) in idxs:
            x0,y0,z0 = lo + [i*res, j*res, k*res]
            x1,y1,z1 = x0+res, y0+res, z0+res
            if axis_dir==0 and shift==1:   # +x face
                v = [(x1,y0,z0),(x1,y1,z0),(x1,y1,z1),(x1,y0,z1)]
            elif axis_dir==0:              # -x face
                v = [(x0,y0,z0),(x0,y0,z1),(x0,y1,z1),(x0,y1,z0)]
            elif axis_dir==1 and shift==1: # +y
                v = [(x0,y1,z0),(x0,y1,z1),(x1,y1,z1),(x1,y1,z0)]
            elif axis_dir==1:              # -y
                v = [(x0,y0,z0),(x1,y0,z0),(x1,y0,z1),(x0,y0,z1)]
            elif axis_dir==2 and shift==1: # +z
                v = [(x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1)]
            else:                          # -z
                v = [(x0,y0,z0),(x0,y1,z0),(x1,y1,z0),(x1,y0,z0)]
            faces.extend([v[0],v[1],v[2], v[0],v[2],v[3]])
    for ax in range(3):
        emit(ax, 1); emit(ax, -1)
    if not faces: return None
    return np.array(faces, dtype=np.float32)

import array as _arr
hull_out = bytearray()
records = []
for nm in np_names:
    p = np_idx[nm]
    sel = prim == p
    if sel.sum() < 40: continue
    pts = np.stack([sx[sel], sy[sel], sz[sel]], axis=1)
    pts = np.clip(pts, -32000.0, 32000.0)   # same range the Int16 bin carries
    tris = hull_for(nm, pts)
    if tris is None: continue
    ntri = len(tris)//3
    if ntri > 60000:   # decimate deterministically by stride
        keep = np.linspace(0, len(tris)-1, 60000*3).astype(int)
        tris = tris[keep]; ntri = 60000
    tv = np.asarray(tris, dtype=np.float32)
    np.clip(tv, -65504.0, 65504.0, out=tv)
    enc_bytes = tv.astype(np.float16).view(np.uint16).tobytes()
    hull_out.append(len(nm)); hull_out += nm.encode()
    hull_out += struct.pack("<H", ntri)
    hull_out += enc_bytes
    records.append({"name": nm, "tris": ntri, "n_neurons": int(sel.sum())})
    print(f"  hull {nm}: {ntri} tris from {int(sel.sum())} neurons  ({time.time()-T0:.0f}s)")

BIN_HULL.write_bytes(bytes(hull_out))
JSN_HULL.write_text(json.dumps({
    "dataset": "fafb_v783", "anchored": True,
    "frame": meta["frame"],
    "method": "voxel-shell surfaces (res 14 scene units) of real neuron positions per neuropil",
    "records": records}))
print(f"DONE in {time.time()-T0:.0f}s: {len(records)} hulls, {len(hull_out):,} bytes")
