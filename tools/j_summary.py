#!/usr/bin/env python3
"""
j_summary.py — per-driver × cutoff summary over fly_demon_3d.html LOG CSVs
(the main fly_log_*.csv inside a fly_session zip, or any CSV with the same
column layout).

For every input CSV it groups rows by the `driver` column (DEMON | FLY | YOU |
DEMON-RANDOM — the row's door driver, from MODE + FLY_ROLE_REVERSAL) and, for
every cutoff second, emits ONE summary row:

  - window           rows of that driver whose time <= cutoff. Row time is
                     `t_sim` when present (the recording's pause-frozen sim
                     clock — the same clock J and the ▶ Run test auto-stop
                     use), else `t` (wall seconds since record start).
  - j_last           the running J read from the cumulative `J` column —
                     J(t) = (1/t)·∫0^t |Tl−Tr| dt' (trapezoid; ONE accumulator
                     per recording, reset only when a recording started, never
                     on pause) — taken on the driver's LAST row inside the
                     window. NOTE: J is a recording-level average shared by
                     every row (it is not reset at driver switches), so
                     j_last is the recording-level J at that row; per-driver
                     selectivity below IS computed per driver.
  - mean_dT          mean of the `dT` column over the window.
  - selectivity_pct  100·cg/(cg+cb) from the `cg`/`cb` columns, attributed PER
                     DRIVER: cg/cb are recording-cumulative crossing valence
                     counters, so each row's 0.1 s interval contributes its
                     (Δcg, Δcb) to that row's own driver; deltas are summed
                     over the driver's rows inside the window. Empty before
                     the first crossing.
  - mean_jet         mean of the `jet` column over the window.
  - mean_Tl / mean_Tr  means of the `Tl`/`Tr` columns over the window.
  - n_rows, test_len_s (the armed test length when present).

Cutoffs: from the CSV's `test_len_s` column when it carries values (the ▶ Run
test armed lengths), else from --cutoff (single) / --cutoffs (comma list).

Writes one summary CSV per input file next to it:
  <input-stem>.j_summary.csv   (one row per driver × cutoff)
and prints the same table.

Usage:
  python tools/j_summary.py fly_session_x/fly_log_x.csv [more.csv ...]
  python tools/j_summary.py --cutoff 600 fly_log.csv
  python tools/j_summary.py --cutoffs 300,600,900,1200 fly_log.csv
"""
import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path


def fnum(value):
    try:
        v = float(value)
        return v if v == v else None          # NaN guard
    except (TypeError, ValueError):
        return None


def load_rows(path):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        rows = [r for r in reader if any((v or "").strip() for v in r.values())]
        fields = list(reader.fieldnames or [])
    need = ["driver", "J", "dT", "cg", "cb", "jet", "Tl", "Tr", "test_len_s"]
    missing = [c for c in need if c not in fields]
    if missing:
        raise SystemExit(f"{path}: missing required column(s): {', '.join(missing)} — "
                         f"this tool expects the fly_log CSV with the appended "
                         f"driver/driver_Tl/driver_Tr/J/test_len_s tail columns")
    return rows, fields


def row_time(row):
    tsim = fnum(row.get("t_sim"))
    if tsim is not None:
        return tsim
    return fnum(row.get("t")) or 0.0


def summarize(path, cutoffs_arg=None):
    rows, _ = load_rows(path)
    if not rows:
        raise SystemExit(f"{path}: no rows")
    # cutoffs: armed test_len_s values first, else the CLI arguments
    test_lens = sorted({fnum(r.get("test_len_s")) for r in rows
                        if fnum(r.get("test_len_s")) is not None})
    cutoffs = test_lens if test_lens else (cutoffs_arg or [])
    if not cutoffs:
        raise SystemExit(f"{path}: no test_len_s values and no --cutoff/--cutoffs given")

    # crossing attribution: cg/cb are recording-cumulative, so a driver owns
    # the deltas of each row's own (0.1 s) interval — rows sorted by time and
    # walked from 0. First row's interval (recording start → row 1) belongs to
    # row 1's driver as well.
    ordered = sorted(rows, key=row_time)
    d_cg = defaultdict(float)
    d_cb = defaultdict(float)
    prev_cg = prev_cb = 0.0
    for r in ordered:
        cg = fnum(r.get("cg")) or 0.0
        cb = fnum(r.get("cb")) or 0.0
        drv = (r.get("driver") or "").strip()
        d_cg[drv] += max(0.0, cg - prev_cg)
        d_cb[drv] += max(0.0, cb - prev_cb)
        prev_cg, prev_cb = cg, cb

    out = []
    for cutoff in cutoffs:
        # per-driver groups inside the window
        groups = defaultdict(list)
        for r in ordered:
            if row_time(r) <= cutoff:
                groups[(r.get("driver") or "").strip()].append(r)
        for drv, grp in sorted(groups.items()):
            # per-driver deltas INSIDE the window: walk the full ordered row
            # list again and keep the deltas of intervals whose owning row
            # falls in this driver's window
            cgd = cbd = 0.0
            prev_cg = prev_cb = 0.0
            for r in ordered:
                cg = fnum(r.get("cg")) or 0.0
                cb = fnum(r.get("cb")) or 0.0
                if row_time(r) <= cutoff and (r.get("driver") or "").strip() == drv:
                    cgd += max(0.0, cg - prev_cg)
                    cbd += max(0.0, cb - prev_cb)
                prev_cg, prev_cb = cg, cb
            sel = (100.0 * cgd / (cgd + cbd)) if (cgd + cbd) > 0 else None
            dts = [fnum(r.get("dT")) for r in grp if fnum(r.get("dT")) is not None]
            jets = [fnum(r.get("jet")) for r in grp if fnum(r.get("jet")) is not None]
            tls = [fnum(r.get("Tl")) for r in grp if fnum(r.get("Tl")) is not None]
            trs = [fnum(r.get("Tr")) for r in grp if fnum(r.get("Tr")) is not None]
            js = [fnum(r.get("J")) for r in grp if fnum(r.get("J")) is not None]
            mean = lambda xs: sum(xs) / len(xs) if xs else None
            out.append({
                "input": path.name, "cutoff_s": cutoff, "driver": drv,
                "n_rows": len(grp),
                "j_last": js[-1] if js else None,          # running J at the last window row
                "mean_dT": None if mean(dts) is None else round(mean(dts), 4),
                "selectivity_pct": None if sel is None else round(sel, 2),
                "cg": cgd, "cb": cbd,                      # per-driver attributed crossings
                "mean_jet": None if mean(jets) is None else round(mean(jets), 4),
                "mean_Tl": None if mean(tls) is None else round(mean(tls), 4),
                "mean_Tr": None if mean(trs) is None else round(mean(trs), 4),
                "test_len_s": test_lens[0] if test_lens else "",
            })
    return out


def fmt(v, nd=2):
    if v is None:
        return ""
    if isinstance(v, float):
        return f"{v:.{nd}f}" if nd else f"{v:.0f}"
    return str(v)


# (Windows console safety) force UTF-8 stdout so non-ASCII deco never breaks a
# summary run on cp1252 terminals.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def main():
    ap = argparse.ArgumentParser(description="per driver × cutoff summary of fly_log CSVs")
    ap.add_argument("csv", nargs="+", help="fly_log CSV files")
    ap.add_argument("--cutoff", type=float, default=None, help="single cutoff in seconds")
    ap.add_argument("--cutoffs", type=str, default=None,
                    help="comma-separated cutoffs in seconds, e.g. 300,600,900,1200")
    args = ap.parse_args()
    cutoffs_arg = None
    if args.cutoffs:
        cutoffs_arg = [c for c in (fnum(x) for x in args.cutoffs.split(",")) if c is not None]
    elif args.cutoff is not None:
        cutoffs_arg = [args.cutoff]

    print(f"{'input':<40}{'cutoff_s':>9}{'driver':<14}{'n_rows':>7}{'j_last':>9}"
          f"{'mean_dT':>9}{'sel%':>9}{'cg':>7}{'cb':>7}{'jet':>7}{'Tl':>8}{'Tr':>8}{'test_len':>9}")
    all_rows = []
    for path in [Path(p) for p in args.csv]:
        if not path.is_file():
            raise SystemExit(f"not found: {path}")
        table = summarize(path, cutoffs_arg)
        out_path = path.with_suffix(path.suffix + ".j_summary.csv")   # fly_log.csv → fly_log.csv.j_summary.csv
        with open(out_path, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=["input", "cutoff_s", "driver", "n_rows",
                                               "j_last", "mean_dT", "selectivity_pct", "cg", "cb",
                                               "mean_jet", "mean_Tl", "mean_Tr", "test_len_s"])
            w.writeheader()
            w.writerows(table)
        for row in table:
            print(f"{row['input']:<40}{fmt(row['cutoff_s'], 0):>9}{row['driver']:<14}"
                  f"{row['n_rows']:>7}{fmt(row['j_last']):>9}{fmt(row['mean_dT']):>9}"
                  f"{fmt(row['selectivity_pct']):>9}{fmt(row['cg'], 1):>7}{fmt(row['cb'], 1):>7}"
                  f"{fmt(row['mean_jet']):>7}{fmt(row['mean_Tl']):>8}{fmt(row['mean_Tr']):>8}"
                  f"{fmt(row['test_len_s'], 0):>9}")
        print(f"  wrote -> {out_path}")
        all_rows.extend(table)
    return all_rows


if __name__ == "__main__":
    main()
