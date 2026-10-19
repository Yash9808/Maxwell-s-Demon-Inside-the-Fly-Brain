#!/usr/bin/env python3
"""make_qc_montage.py — QC contact sheet of all paper figures."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.image as mpimg
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FIGD = os.path.join(HERE, "figures")
names = ["figure1_overview", "figure2_learning_behaviour", "figure3_information_budget",
         "figure4_connectome_and_secondlaw", "figure5_mechanism", "figure6_robustness",
         "figure7_integrated"]
fig, axes = plt.subplots(len(names), 1, figsize=(11, 4.2 * len(names)))
for ax, n in zip(axes, names):
    p = os.path.join(FIGD, n + ".png")
    img = mpimg.imread(p)
    ax.imshow(img)
    ax.set_title(n, fontsize=9)
    ax.axis("off")
fig.tight_layout()
fig.savefig(os.path.join(FIGD, "_qc_montage.png"), dpi=110)
print("montage written")
