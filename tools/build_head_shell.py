#!/usr/bin/env python
"""Cut the fruit-fly HEAD from the ETAIN CT exoskeleton (Zenodo 14838021,
CC-BY; Wijnen/Southampton + Katsamenis/Southampton, model by F. Ribas).

Strategy: the exoskeleton's long axis is found by projection-spread
(border-min / max of x,y,z). A neck plane sits where the head capsule ends:
on the long axis through-plane, the histogram of vertex (bbox-normalized)
positions has a wide empty gap between the head (narrow, compact) and the
thorax (wide). We choose the plane as the first position after the head's
through-spread exceeds 45% of the head max, then keep only triangles whose
centroid projects BEFORE the plane (strictly the head capsule), and close
the cut with an opaque neck cap (all border vertices fanned to the cap
center) so the head shell is watertight-looking in the viewer.

Outputs (repo-local .sktmp/):
  head_shell.stl   binary STL, CT frame, head only (+ neck cap)
  prev_cut.png     full body projection with the chosen neck plane drawn
  prev_head.png    head-only projection (what will be shown in 3D)
"""
import struct, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

STL = ".sktmp/Drosophila/Drosophila_exoskeleton.stl"

def load_stl(path):
    with open(path, "rb") as f:
        f.read(84)
        n = None
        data = np.fromfile(f, dtype=np.uint8)
    n = len(data) // 50
    tri = data[: n * 50].reshape(n, 50)
    norm = tri[:, 0:12].copy().view(np.float32).reshape(n, 3)
    verts = tri[:, 12:48].copy().view(np.float32).reshape(n, 3, 3)
    return norm, verts

norm, V = load_stl(STL)
P = V.reshape(-1, 3)
print("tris:", len(V), "verts:", len(P))

# ---- head/body axis: the CT model is mounted nose-up along +z (verified on
# the preview render: head capsule z~=0.72..1.26, neck pinch z~=0.70)
mins, maxs = P.min(0), P.max(0)
spread = maxs - mins
long_ax = 2
HEAD_HI = True   # head at the HIGH end of the cut axis
cut_pos = 0.70   # neck plane (just below the head capsule, at the pinch)
print("spread:", spread.round(3), "cut axis: z, neck plane:", cut_pos)

# ---- head containment (CT frame, verified on renders): head capsule
# z >= 0.70 (neck pinch), y in [-0.85, -0.25] (anterior; drops the folded
# wing roots which reach z > 0.7 at y > 0), |x| <= 0.42 (drops foreleg tips)
XCAP = 0.42
YLO, YHI = -0.85, -0.25

# ---- previews BEFORE the cut
fig = plt.figure(figsize=(14, 6))
for pi, (a1, a2, t) in enumerate([(0, 1, "front x-y"), (0, 2, "top x-z")]):
    ax = fig.add_subplot(1, 2, pi + 1)
    smp = P[:: 7]
    plt.scatter(smp[:, a1], smp[:, a2], s=0.05, alpha=0.25, c="olive")
    if a2 == long_ax:
        plt.axhline(cut_pos, color="r", lw=1.2, label=f"neck {cut_pos:.3f}")
        plt.legend()
    plt.title("exoskeleton " + t); plt.setp(ax, aspect="equal")
plt.tight_layout(); plt.savefig(".sktmp/prev_cut.png", dpi=90); plt.close()

# ---- keep head: ALL THREE VERTICES inside the head box (the raw STL has
# giant stitching triangles whose centroid lands in the window but whose
# vertices span the body; all-vertex filtering kills those too)
Vin = V  # (n,3,3)
keep = (
    ((Vin[:,:,2] >= cut_pos).all(1) if HEAD_HI else (Vin[:,:,2] <= cut_pos).all(1))
    & (np.abs(Vin[:,:,0]) <= XCAP).all(1)
    & ((Vin[:,:,1] >= YLO) & (Vin[:,:,1] <= YHI)).all(1)
)
Vh = V[keep]
print("head tris:", len(Vh))

# ---- neck cap: border loops of the cut get fanned to the cap center
PH = Vh.reshape(-1, 3)
# drop stray far-out vertices (wing-root / stitch fragments) BEFORE computing
# the cap center, or one fan triangle spans the whole body
box = np.array([[-XCAP, XCAP], [YLO, YHI], [min(cut_pos, 1.30), 1.30]])
inb = ((PH >= box[:, 0]) & (PH <= box[:, 1])).all(1)
Vh2 = Vh[(( (Vh[:,:,0] >= box[0,0]) & (Vh[:,:,0] <= box[0,1])
          & (Vh[:,:,1] >= box[1,0]) & (Vh[:,:,1] <= box[1,1])
          & (Vh[:,:,2] >= box[2,0]) & (Vh[:,:,2] <= box[2,1]) ).all(1))]
print("post-box tris:", len(Vh2), "dropped:", len(Vh) - len(Vh2))
center = PH[inb].mean(0)
edge_key = {}
for t in Vh:
    for a, b in ((0, 1), (1, 2), (2, 0)):
        pa, pb = t[a], t[b]
        on_plane = (abs(pa[long_ax] - cut_pos) < 1e-4) and (abs(pb[long_ax] - cut_pos) < 1e-4)
        if on_plane:
            k2 = tuple(np.round(np.sort(np.array([pa, pb]).ravel()), 5))
            edge_key[k2] = edge_key.get(k2, 0) + 1
border = [k2 for k2, c in edge_key.items() if c == 1]
print("cap edges:", len(border))
tris = [t for t in Vh2]
for k2 in border:
    e = np.array(k2).reshape(2, 3)
    e = np.clip(e, np.array([box[0,0], box[1,0], box[2,0]]),
                   np.array([box[0,1], box[1,1], box[2,1]]))
    tris.append(np.array([e[0], e[1], center], dtype=np.float32))
tris = np.array(tris, dtype=np.float32)

def save_stl(path, tris):
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    ln = np.linalg.norm(n, axis=1, keepdims=True); ln[ln == 0] = 1
    n = (n / ln).astype(np.float32)
    with open(path, "wb") as f:
        f.write(b"head shell" + b"\0" * 70)
        f.write(struct.pack("<I", len(tris)))
        for t, nn in zip(tris, n):
            f.write(nn.tobytes()); f.write(t[0].tobytes()); f.write(t[1].tobytes()); f.write(t[2].tobytes())
            f.write(b"\0\0")

save_stl(".sktmp/head_shell.stl", tris)
print("head_shell.stl:", len(tris), "tris")

# ---- preview of the head
fig = plt.figure(figsize=(12, 5))
PH = tris.reshape(-1, 3)
for pi, (a1, a2, t) in enumerate([(0, 1, "front x-y"), (0, 2, "top x-z"), (0, long_ax, "side z")]):
    ax = fig.add_subplot(1, 3, pi + 1)
    plt.scatter(PH[::7, a1], PH[::7, a2], s=0.05, alpha=0.3, c="sienna")
    plt.setp(ax, aspect="equal"); plt.title("head " + t)
plt.tight_layout(); plt.savefig(".sktmp/prev_head.png", dpi=90); plt.close()
print("previews written")
