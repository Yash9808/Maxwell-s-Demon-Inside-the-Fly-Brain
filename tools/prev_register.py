#!/usr/bin/env python
"""Render registration variants of CT head+brain over the real neuron cloud."""
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

def load_stl(path):
    with open(path, "rb") as f:
        f.read(84); data = np.fromfile(f, dtype=np.uint8)
    n = len(data)//50
    tri = data[:n*50].reshape(n, 50)
    return tri[:, 12:48].copy().view(np.float32).reshape(n, 3, 3)

Vb = load_stl(".sktmp/Drosophila/Drosophila_brain.stl")
Vh = load_stl(".sktmp/head_shell.stl")
meta = json.load(open("fly_brain_meta.json"))
CENTRAL = ["SMP_L","SMP_R","SIP_L","SIP_R","SLP_L","SLP_R","SCL_L","SCL_R",
           "ICL_L","ICL_R","IB_L","IB_R","ATL_L","ATL_R","CRE_L","CRE_R",
           "FB","EB","PB","NO","LAL_L","LAL_R","AL_L","AL_R","AMMC_L","AMMC_R",
           "MB_CA_L","MB_CA_R","MB_ML_L","MB_ML_R","MB_PED_L","MB_PED_R",
           "MB_VL_L","MB_VL_R","LH_L","LH_R","GOR_L","GOR_R","EPA_L","EPA_R",
           "AOTU_L","AOTU_R","BU_L","BU_R","GA_L","GA_R","CAN_L","CAN_R",
           "FLA_L","FLA_R","PRW","SAD","GNG"]
used = [nm for nm in CENTRAL if nm in meta["neuropils"]]
rec = np.frombuffer(open("fly_brain_positions.bin","rb").read(),
                    dtype=np.dtype([("x","<i2"),("y","<i2"),("z","<i2"),("p","u1")]))
pos = np.stack([rec["x"],rec["y"],rec["z"]],1).astype(np.float32)*0.1
prim = rec["p"]; names = meta["np_names"]
cidx = set(names.index(nm) for nm in used if nm in names)
m = np.array([p in cidx for p in prim]) & (np.abs(pos)<600).all(1)
cb = pos[m]
tmn = np.full(3, 1e30); tmx = np.full(3, -1e30)
for nm in used:
    g = meta["neuropils"][nm]; c = np.array(g["c"]); sg = np.array(g["s"])
    tmn = np.minimum(tmn, c-sg); tmx = np.maximum(tmx, c+sg)
ext_cloud = np.percentile(cb,99,0)-np.percentile(cb,1,0)
Pb = Vb.reshape(-1,3); bmn,bmx = Pb.min(0), Pb.max(0)
variants = {}
variants["cloudP99"] = (float(np.median(ext_cloud/(bmx-bmn))), (tmn+tmx)/2)
ext_all = cb.max(0)-cb.min(0)
variants["cloudFull"] = (float(np.median(ext_all/(bmx-bmn))), (tmn+tmx)/2)
variants["metaBbox"] = (float(np.median((tmx-tmn)/(bmx-bmn))), (tmn+tmx)/2)
cc = (bmn+bmx)/2
Pc = Vh.reshape(-1,3)
fig, axes = plt.subplots(3, 3, figsize=(16,13))
for r,(k,(s,cd)) in enumerate(variants.items()):
    Hb = ((Pc-cc)*s+cd).astype(np.float32)
    Bb = ((Pb-cc)*s+cd).astype(np.float32)
    print(k, "scale", round(s,1), "head bbox", Hb.min(0).round(0), "->", Hb.max(0).round(0))
    for c,(a1,a2,t) in enumerate([(0,1,"front x-y"),(0,2,"top x-z"),(1,2,"side y-z")]):
        ax = axes[r][c]
        ax.scatter(cb[::4,a1], cb[::4,a2], s=0.3, c="#88aacc", alpha=0.3, label="neurons")
        ax.scatter(Hb[::60,a1], Hb[::60,a2], s=0.3, c="#d2691e", alpha=0.25, label="CT head")
        ax.scatter(Bb[::30,a1], Bb[::30,a2], s=0.3, c="#cc4444", alpha=0.3, label="CT brain")
        ax.set_title(f"{k} | {t}"); ax.set_aspect("equal")
        if c==0: ax.legend(markerscale=8, loc="upper right", fontsize=7)
plt.tight_layout(); plt.savefig(".sktmp/prev_register.png", dpi=85)
print("wrote .sktmp/prev_register.png")
