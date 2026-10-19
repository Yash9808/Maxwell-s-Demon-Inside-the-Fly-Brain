#!/usr/bin/env python
"""Register the ETAIN CT head shell + brain mesh into the scene frame for the
SKELETON view.

The ETAIN STLs (Zenodo 14838021, CC-BY 4.0) each carry their own Blender
object origin, so the brain mesh and the exoskeleton do NOT share a frame.
We therefore re-unite them anatomically:

  1. uniform scale = MEDIAN of per-axis extent ratios between the scene
     central-brain bbox (fly_brain_meta.json neuropil geometry — the same
     source the page's glass shells use) and the CT brain mesh bbox;
  2. the CT brain mesh centroid is aligned onto the centroid of the REAL
     central-neuron cloud (fly_brain_positions.bin, |coord|<600) — a direct
     brain-to-brain match; the head shell (same CT frame) follows, wrapping
     the whole neuron mass like the real head does;
  3. validation: fraction of central neurons inside the CT brain / head bbox.

Output (repo root, served by the dev server):
  fly_head_shell.bin   Float32 xyz * n_tri * 3 (scene units, decimated)
  fly_head_shell.json  { n, bbox, scale, source, license }
"""
import json
import numpy as np

def load_stl(path):
    with open(path, "rb") as f:
        f.read(84)
        data = np.fromfile(f, dtype=np.uint8)
    n = len(data) // 50
    tri = data[: n * 50].reshape(n, 50)
    return tri[:, 12:48].copy().view(np.float32).reshape(n, 3, 3)

Vb = load_stl(".sktmp/Drosophila/Drosophila_brain.stl")
Vh = load_stl(".sktmp/head_shell.stl")
print("CT brain tris:", len(Vb), " head tris:", len(Vh))

meta = json.load(open("fly_brain_meta.json"))
CENTRAL = ["SMP_L","SMP_R","SIP_L","SIP_R","SLP_L","SLP_R","SCL_L","SCL_R",
           "ICL_L","ICL_R","IB_L","IB_R","ATL_L","ATL_R","CRE_L","CRE_R",
           "FB","EB","PB","NO","LAL_L","LAL_R","AL_L","AL_R","AMMC_L","AMMC_R",
           "MB_CA_L","MB_CA_R","MB_ML_L","MB_ML_R","MB_PED_L","MB_PED_R",
           "MB_VL_L","MB_VL_R","LH_L","LH_R","GOR_L","GOR_R","EPA_L","EPA_R",
           "AOTU_L","AOTU_R","BU_L","BU_R","GA_L","GA_R","CAN_L","CAN_R",
           "FLA_L","FLA_R","PRW","SAD","GNG"]
used = [nm for nm in CENTRAL if nm in meta["neuropils"]]

# --- scale: meta central-bbox extent vs CT brain extent --------------------
tmn = np.full(3, 1e30); tmx = np.full(3, -1e30)
for nm in used:
    g = meta["neuropils"][nm]; c = np.array(g["c"]); sg = np.array(g["s"])
    tmn = np.minimum(tmn, c - sg); tmx = np.maximum(tmx, c + sg)
Pb = Vb.reshape(-1, 3)
bmn, bmx = Pb.min(0), Pb.max(0)
ratios = (tmx - tmn) / (bmx - bmn)
s = float(np.median(ratios))
print("scene central bbox:", tmn.round(1), "->", tmx.round(1))
print("axis ratios:", ratios.round(1), "-> scale", round(s, 1))

# --- real central-neuron cloud (brain-to-brain center match) ---------------
rec = np.frombuffer(open("fly_brain_positions.bin", "rb").read(),
                    dtype=np.dtype([("x","<i2"),("y","<i2"),("z","<i2"),("p","u1")]))
pos = np.stack([rec["x"], rec["y"], rec["z"]], 1).astype(np.float32) * 0.1
prim = rec["p"]
names = meta["np_names"]
cidx = set(names.index(nm) for nm in used if nm in names)
m = np.array([p in cidx for p in prim]) & (np.abs(pos) < 600).all(1)
cb = pos[m]
# bbox-center match (robust to vertex density): CT brain bbox center ->
# cloud 2-98 percentile bbox center
cd = (np.percentile(cb, 2, 0) + np.percentile(cb, 98, 0)) / 2
cc = (Pb.min(0) + Pb.max(0)) / 2
print("central neurons:", int(m.sum()), "cloud center", cd.round(1))
print("CT brain center", cc.round(3))

def apply(V):
    P = V.reshape(-1, 3)
    return (((P - cc) * s + cd).astype(np.float32)).reshape(-1, 3, 3)

B = apply(Vb); H = apply(Vh)
Bp, Hp = B.reshape(-1,3), H.reshape(-1,3)
print("registered brain bbox:", Bp.min(0).round(1), "->", Bp.max(0).round(1))
print("registered head bbox:", Hp.min(0).round(1), "->", Hp.max(0).round(1))

db = ((cb[:, None, :] >= Bp.min(0)) & (cb[:, None, :] <= Bp.max(0))).all(2)
dh = ((cb[:, None, :] >= Hp.min(0)) & (cb[:, None, :] <= Hp.max(0))).all(2)
print("central neurons inside CT-brain bbox:", int(db.sum()),
      f"({db.sum()/max(m.sum(),1)*100:.0f}%)")
print("central neurons inside CT-head bbox:", int(dh.sum()),
      f"({dh.sum()/max(m.sum(),1)*100:.0f}%)")

# --- decimate the shell 2x for page memory ---------------------------------
Hd = H[::2]
with open("fly_head_shell.bin", "wb") as f:
    f.write(Hd.tobytes())
Hdp = Hd.reshape(-1, 3)
json.dump({
  "n": int(len(Hd)),
  "bbox_min": [round(float(v), 1) for v in Hdp.min(0)],
  "bbox_max": [round(float(v), 1) for v in Hdp.max(0)],
  "scale": round(s, 1),
  "source": "ETAIN micro-CT Drosophila adult female (Wijnen + Katsamenis, Univ. of Southampton; 3D model F. Ribas) - Zenodo 14838021, CC-BY 4.0; head capsule cut from Drosophila_exoskeleton.stl",
  "registration": "uniform scale (median axis ratio, meta central bbox vs CT brain) + CT-brain-centroid -> real central-neuron-cloud centroid",
}, open("fly_head_shell.json", "w"), indent=1)
print("wrote fly_head_shell.bin", round(len(Hd.tobytes()) / 1e6, 1), "MB,", len(Hd), "tris")
