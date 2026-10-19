"""E3R2 preregistered plots: (1) train trajectory, (2) P1 paired per-seed plot."""
import csv, os
from collections import defaultdict
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

RAW = "research_data/validation/E3R2_RAW.csv"
OUT = "research_data/validation/plots"
os.makedirs(OUT, exist_ok=True)

rows = []
with open(RAW) as f:
    for r in csv.DictReader(f):
        rows.append(r)

def gb(r):
    return float(r["goodCrossings"]) - float(r["badCrossings"])

# ---- Plot 1: training trajectory (per-quarter means, seed-level spread) -----
quart = defaultdict(lambda: defaultdict(list))   # arm -> q -> [per-seed means]
opq = defaultdict(lambda: defaultdict(list))
seed_ep = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))  # arm->seed->q->vals
seed_op = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
for r in rows:
    if r["phase"] != "train":
        continue
    arm, seed, t = r["condition"], r["seed"], int(r["trial"])
    q = min(3, t // 75)
    seed_ep[arm][seed][q].append(gb(r))
    seed_op[arm][seed][q].append(float(r["openFraction"]))
for arm in seed_ep:
    for seed in seed_ep[arm]:
        for q, vals in seed_ep[arm][seed].items():
            quart[arm][q].append(sum(vals) / len(vals))
            ov = seed_op[arm][seed][q]
            opq[arm][q].append(sum(ov) / len(ov))

fig, axes = plt.subplots(1, 2, figsize=(11, 4.2))
for ax, data, ylab, title in (
    (axes[0], quart, "good − bad crossings / episode", "Learning trajectory (train quarters)"),
    (axes[1], opq, "door open fraction", "Engagement trajectory (train quarters)"),
):
    for arm in sorted(data):
        xs = sorted(data[arm])
        means = [sum(data[arm][q]) / len(data[arm][q]) for q in xs]
        sds = []
        for q in xs:
            v = data[arm][q]
            m = sum(v) / len(v)
            sds.append((sum((x - m) ** 2 for x in v) / (len(v) - 1)) ** 0.5 if len(v) > 1 else 0)
        ax.errorbar(xs, means, yerr=sds, marker="o", capsize=3, label=arm)
    ax.set_xlabel("training quarter (75 episodes each)")
    ax.set_ylabel(ylab)
    ax.set_title(title)
    ax.legend(fontsize=7)
    ax.grid(alpha=0.3)
fig.tight_layout()
fig.savefig(os.path.join(OUT, "E3R2_trajectory.png"), dpi=150)
print("wrote", os.path.join(OUT, "E3R2_trajectory.png"))

# ---- Plot 2: P1 paired per-seed contrast (R2A_cost vs R2A_frozen) ----------
pair_a = defaultdict(dict)
pair_b = defaultdict(dict)
for r in rows:
    if r["phase"] != "test":
        continue
    arm, seed = r["condition"], r["seed"]
    if arm == "R2A_cost":
        pair_a[seed].setdefault("vals", []).append(gb(r))
        pair_a[seed].setdefault("op", []).append(float(r["openFraction"]))
    elif arm == "R2A_frozen":
        pair_b[seed].setdefault("vals", []).append(gb(r))
        pair_b[seed].setdefault("op", []).append(float(r["openFraction"]))
seeds = sorted(set(pair_a) & set(pair_b), key=int)
da = [sum(pair_a[s]["vals"]) / len(pair_a[s]["vals"]) for s in seeds]
db = [sum(pair_b[s]["vals"]) / len(pair_b[s]["vals"]) for s in seeds]
oa = [sum(pair_a[s]["op"]) / len(pair_a[s]["op"]) for s in seeds]
ob = [sum(pair_b[s]["op"]) / len(pair_b[s]["op"]) for s in seeds]

fig, axes = plt.subplots(1, 2, figsize=(11, 4.2))
axes[0].scatter(range(len(seeds)), da, label="R2A_cost", color="tab:blue")
axes[0].scatter(range(len(seeds)), db, label="R2A_frozen", color="tab:orange")
for i in range(len(seeds)):
    axes[0].plot([i, i], [da[i], db[i]], color="gray", lw=0.7, alpha=0.6)
axes[0].set_xticks(range(len(seeds)))
axes[0].set_xticklabels(seeds, rotation=90, fontsize=6)
axes[0].set_ylabel("test good − bad / episode (per seed)")
axes[0].set_title(f"P1 paired contrast (d=0.142, p=0.84, n={len(seeds)})")
axes[0].legend(fontsize=8)
axes[0].grid(alpha=0.3)
axes[1].scatter(oa, da, label="R2A_cost", color="tab:blue")
axes[1].scatter(ob, db, label="R2A_frozen", color="tab:orange", marker="x")
axes[1].set_xlabel("test open fraction (per seed)")
axes[1].set_ylabel("test good − bad / episode")
axes[1].set_title("engagement vs selectivity")
axes[1].legend(fontsize=8)
axes[1].grid(alpha=0.3)
fig.tight_layout()
fig.savefig(os.path.join(OUT, "E3R2_P1_paired.png"), dpi=150)
print("wrote", os.path.join(OUT, "E3R2_P1_paired.png"))
