#!/usr/bin/env python
"""Decisive frame check: are the CT brain STL and exoskeleton STL in the same
coordinate frame? Render both raw + the scene neuron cloud for reference."""
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

Vb = load_stl(".sktmp/Drosophila/Drosophila_brain.stl").reshape(-1,3)
Ve = load_stl(".sktmp/Drosophila/Drosophila_exoskeleton.stl").reshape(-1,3)
print("CT brain bbox:", Vb.min(0).round(3), "->", Vb.max(0).round(3))
print("CT exo   bbox:", Ve.min(0).round(3), "->", Ve.max(0).round(3))

meta = json.load(open("fly_brain_meta.json"))
buf = open("fly_brain_positions.bin","rb").read()
n = meta["n"]
ints = np.frombuffer(buf, "<i2", count=n*3).reshape(n,3).astype(np.float32)*0.1
prim = np.frombuffer(buf, "u1", offset=n*6)
names = meta["np_names"]
keep = (np.abs(ints) < 600).all(1)
P = ints[keep][::3]

fig, axes = plt.subplots(2, 3, figsize=(17, 10))
for c,(a1,a2,t) in enumerate([(0,1,"x-y"),(0,2,"x-z"),(1,2,"y-z")]):
    ax = axes[0][c]
    ax.scatter(Ve[::40,a1], Ve[::40,a2], s=0.15, c="#d2691e", alpha=0.2, label="CT exoskeleton")
    ax.scatter(Vb[::8,a1], Vb[::8,a2], s=0.4, c="#cc2222", alpha=0.5, label="CT brain")
    ax.set_title("CT raw frame | "+t); ax.set_aspect("equal")
    ax.legend(markerscale=10, fontsize=7)
    ax2 = axes[1][c]
    ax2.scatter(P[:,a1], P[:,a2], s=0.15, c="#4477aa", alpha=0.25, label="scene neurons (all, |c|<600)")
    ax2.set_title("SCENE frame | "+t); ax2.set_aspect("equal")
    ax2.legend(markerscale=10, fontsize=7)
plt.tight_layout(); plt.savefig(".sktmp/prev_frames.png", dpi=80)
print("wrote .sktmp/prev_frames.png")
