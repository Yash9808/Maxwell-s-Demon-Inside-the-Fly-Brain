#!/usr/bin/env python3
"""
J-table from fly_log CSVs — computes, for test horizons of 300/600/900/1200 s,
the running J(T) = (1/T) * integral_0^T |Tl(t) - Tr(t)| dt  (your formula),
plus mean dT, jet activity, and learning activity over the same window.

Usage:
  python tools/j_from_fly_log.py <fly_log.csv> [<fly_log2.csv> ...]
Writes <input>_Jtable.csv next to each input and prints the table.

Tolerates older headers (t,dT,Tl,Tr,jet,da,...) and newer ones (demon column,
lab-control columns). Cutoffs beyond the recording's span are reported as NaN.
"""
import csv, glob, os, sys

HORIZONS = [300.0, 600.0, 900.0, 1200.0]

def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None

def process(path):
    with open(path, newline="") as fh:
        rd = csv.DictReader(fh)
        cols = rd.fieldnames or []
        rows = []
        for r in rd:
            t = fnum(r.get("t"))
            if t is None:
                continue
            tl = fnum(r.get("Tl")); tr = fnum(r.get("Tr"))
            dt = fnum(r.get("dT")); jet = fnum(r.get("jet")); da = fnum(r.get("da"))
            if tl is None or tr is None:
                continue
            rows.append((t, abs(tl - tr), dt, jet or 0.0, da or 0.0))
    rows.sort(key=lambda x: x[0])
    if len(rows) < 2:
        return None
    t0 = rows[0][0]
    # cumulative trapezoid of |Tl-Tr| over time
    cum_t = [0.0]; cum_I = [0.0]; dt_acc = 0.0; I = 0.0
    series = []
    prev = rows[0]
    for t, d_, *_ in [rows[0]]:
        pass
    # build cumulative integral series
    cum = []
    I = 0.0
    prev_t, prev_y, prev_dt, prev_jet, prev_da = rows[0]
    # align t so the recording starts at 0
    offset = rows[0][0]
    cum.append((0.0, 0.0))
    acc = {k: 0.0 for k in ("dt", "jet", "da")}
    acc_n = 0
    dt_sum = 0.0; jet_sum = 0.0; da_sum = 0.0; n = 0
    table = []
    cut_idx = 0
    prev_t, prev_y, prev_dt, prev_jet, prev_da = rows[0]
    # accumulate per-row means up to each horizon
    means = {"dt": [], "jet": [], "da": []}
    for t, y, dt, jet, da in rows[1:]:
        tt = t - offset
        I += 0.5 * (prev_y + y) * (t - prev_t)
        cum.append((tt, I))
        while cut_idx < len(HORIZONS) and HORIZONS[cut_idx] <= tt:
            J = I / HORIZONS[cut_idx] if HORIZONS[cut_idx] > 0 else float("nan")
            table.append((HORIZONS[cut_idx], J, None, None, None))
            cut_idx += 1
        prev_t, prev_y, prev_dt, prev_jet, prev_da = t, y, dt, jet, da
        if tt <= HORIZONS[-1]:
            means["dt"].append(dt); means["jet"].append(jet); means["da"].append(da)
            n += 1
    # trailing: final horizon if recording shorter than 1200 -> NaN (skip)
    T_end = rows[-1][0] - offset
    if cut_idx == 0 and T_end > 0:
        # recording shorter than 300 s: single row at T_end
        table.append((None, I / T_end, None, None, None))
    elif cut_idx > 0 and T_end < HORIZONS[-1]:
        # recording spans some but not all horizons: fill the rest with NaN rows
        for h in HORIZONS[cut_idx:]:
            table.append((h, float("nan"), None, None, None))
    elif cut_idx > 0 and T_end < HORIZONS[-1]:
        # recording spans some but not all horizons: fill the rest with NaN rows
        for h in HORIZONS[cut_idx:]:
            table.append((h, float("nan"), None, None, None))
    out_rows = []
    for h, J, *_ in table:
        row = {
            "test_cutoff_s": h if h else round(T_end, 2),
            "J_mean_abs_TL_TR": round(J, 6) if J == J else "",
            "mean_dT": (round(sum(x for x in means["dt"] if x == x) / max(1, sum(1 for x in means["dt"] if x == x)), 6) if h and means["dt"] else ""),
            "jet_activity_mean": round(sum(x for x in means["jet"] if x == x) / max(1, sum(1 for x in means["jet"] if x == x)), 6) if h else "",
            "da_learning_mean": round(sum(x for x in means["da"] if x == x) / max(1, sum(1 for x in means["da"] if x == x)), 6) if h else "",
        }
        out_rows.append(row)
    out_path = os.path.splitext(path)[0] + "_Jtable.csv"
    with open(out_path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["test_cutoff_s", "J_mean_abs_TL_TR", "mean_dT", "jet_activity_mean", "da_learning_mean"])
        w.writeheader()
        for r in out_rows:
            w.writerow(r)
    return out_path, out_rows, T_end

def main():
    paths = []
    for a in sys.argv[1:]:
        paths.extend(sorted(glob.glob(a)))
    if not paths:
        print("usage: python tools/j_from_fly_log.py <fly_log.csv> [...]")
        sys.exit(1)
    for p in paths:
        res = process(p)
        if res is None:
            print(f"{p}: not enough rows")
            continue
        out_path, rows, T_end = res
        print(f"\n{os.path.basename(p)}  (recording spans {T_end:.1f}s)")
        print(f"{'cutoff':>10} | {'J=<1/T>Int|TL-TR|':>20} | {'mean dT':>10} | {'jet mean':>9} | {'da mean':>9}")
        for r in rows:
            print(f"{str(r['test_cutoff_s']):>10} | {str(r['J_mean_abs_TL_TR']):>20} | "
                  f"{str(r['mean_dT']):>10} | {str(r['jet_activity_mean']):>9} | {str(r['da_learning_mean']):>9}")
        print(f"  -> wrote {out_path}")

if __name__ == "__main__":
    main()
