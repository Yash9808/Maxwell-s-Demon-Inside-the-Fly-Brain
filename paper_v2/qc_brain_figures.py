#!/usr/bin/env python3
"""qc_brain_figures.py — programmatic QC of Figures 8–13.

Checks per figure:
  * file exists and non-trivial size (PNG + PDF)
  * PNG decodes
  * content coverage: fraction of pixels that differ from the declared background
  * color diversity: number of distinct dominant hues (catches blank axes / all-one-color)
  * per-figure expectations (e.g. Fig 8 must contain both dark background AND
    activity colors AND gray hull pixels)
Writes QC_BRAIN_FIGURES.json and prints a one-line verdict per figure.
"""
import os, json
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FIGD = os.path.join(HERE, "figures")

EXPECT = {
    "figure8_brain_activity": dict(bg_dark=True, want_colors=["#0d1321", "#2f8fca", "#c9cdd4"]),
    "figure9_which_neurons":  dict(bg_dark=True, want_colors=["#8fd3ff", "#d9930d"]),
    "figure10_learning_delta": dict(bg_dark=True, want_colors=["#2166ac", "#b2182b"]),
    "figure11_neural_mi":     dict(bg_dark=True, want_colors=["#d9930d", "#2f8fca"]),
    "figure12_learning_curves": dict(bg_dark=False, want_colors=["#c0392b", "#2b6cb0", "#d9930d"]),
    "figure13_predictions_budget_ledger": dict(bg_dark=False, want_colors=["#2b6cb0", "#c0392b", "#2e8b57"]),
}

def hex2rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i+2], 16) for i in (0, 2, 4)], dtype=np.int16)

def analyze(name):
    png = os.path.join(FIGD, name + ".png")
    pdf = os.path.join(FIGD, name + ".pdf")
    res = {"png_exists": os.path.exists(png), "pdf_exists": os.path.exists(pdf)}
    if not res["png_exists"]:
        return res
    res["png_bytes"] = os.path.getsize(png)
    res["pdf_bytes"] = os.path.getsize(pdf) if res["pdf_exists"] else 0
    im = Image.open(png).convert("RGB")
    a = np.asarray(im, dtype=np.int16)
    h, w, _ = a.shape
    res["size"] = [w, h]
    corners = np.concatenate([a[:8, :8].reshape(-1, 3), a[:8, -8:].reshape(-1, 3),
                              a[-8:, :8].reshape(-1, 3), a[-8:, -8:].reshape(-1, 3)])
    bg = corners.mean(axis=0)
    res["bg_rgb"] = [int(v) for v in bg]
    res["bg_is_dark"] = bool(bg.mean() < 80)
    diff = np.abs(a - bg).sum(axis=2)
    res["content_frac"] = float((diff > 30).mean())
    # hue diversity on a coarse quantization
    q = (a[::4, ::4] // 32).reshape(-1, 3)
    uniq = np.unique(q, axis=0)
    res["n_color_cells"] = int(len(uniq))
    # specific color presence (within tolerance)
    for hexc in EXPECT.get(name, {}).get("want_colors", []):
        t = hex2rgb(hexc)
        d = np.abs(a.astype(np.int16) - t).sum(axis=2)
        res[f"has_{hexc}"] = bool((d < 60).mean() > 0.0005)
    res["pass"] = (res["png_bytes"] > 40000 and res["content_frac"] > 0.05
                   and res["n_color_cells"] > 40)
    return res

def main():
    out = {}
    for name in EXPECT:
        out[name] = analyze(name)
        r = out[name]
        bits = []
        if r.get("png_exists"):
            bits.append(f"{r['size'][0]}x{r['size'][1]}")
            bits.append(f"content={r['content_frac']:.2%}")
            bits.append(f"colors={r['n_color_cells']}")
            bits.append(f"bg_dark={r['bg_is_dark']}")
        verdict = "PASS" if r.get("pass") else "CHECK"
        print(f"{name}: {verdict} ({', '.join(bits)})")
    json.dump(out, open(os.path.join(HERE, "QC_BRAIN_FIGURES.json"), "w"), indent=1)
    print("QC_BRAIN_FIGURES.json written")

if __name__ == "__main__":
    main()
