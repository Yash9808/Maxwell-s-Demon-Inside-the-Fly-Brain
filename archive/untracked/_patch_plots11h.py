import io

p = "experiment_plots.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()
orig = d

def rep(old, new, n=1):
    global d
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:70])
    d = d.replace(old, new)

# dots: subsample huge regions and scale alpha by delta magnitude, so a big
# region with a small delta reads as a faint haze, never a solid flood
rep("""    if (Math.abs(acc[top] || 0) >= 0.15 * gmax){
      const tcol = sign >= 0 ? [229, 57, 53] : [30, 136, 229];
      for (const i of order){
        const rk = ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]);
        if (rk !== top) continue;
        g.fillStyle = "rgba(" + tcol[0] + "," + tcol[1] + "," + tcol[2] + ",0.75)";
        g.fillRect(ox + pts[i*3] - 0.6, oy + pts[i*3+1] - 0.6, 1.3, 1.3);
      }
    }""",
"""    if (Math.abs(acc[top] || 0) >= 0.15 * gmax){
      const tcol = sign >= 0 ? [229, 57, 53] : [30, 136, 229];
      const tmag = Math.min(1, Math.abs(acc[top]) / gmax);
      const da = 0.10 + 0.45 * tmag;               // delta-scaled opacity
      let seen = 0, stride = 1;
      for (const i of order) if (ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]) === top) seen++;
      if (seen > 6000) stride = Math.ceil(seen / 6000);
      let k = 0;
      for (const i of order){
        const rk = ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]);
        if (rk !== top) continue;
        if (k++ % stride) continue;
        g.fillStyle = "rgba(" + tcol[0] + "," + tcol[1] + "," + tcol[2] + "," + da.toFixed(2) + ")";
        g.fillRect(ox + pts[i*3] - 0.5, oy + pts[i*3+1] - 0.5, 1.1, 1.1);
      }
    }""")

# captions: 2 significant digits so a real (small) delta is not rounded to 0.00
rep("""    const dtop = acc[top] || 0;
    g.fillText(p.c + " \u2014 " + (REGION_TITLE[top] || top) + " \u00b7 \u0394 " + (dtop >= 0 ? "+" : "") + dtop.toFixed(2), ox, oy + ph + 14);""",
"""    const dtop = acc[top] || 0;
    g.fillText(p.c + " \u2014 " + (REGION_TITLE[top] || top) + " \u00b7 \u0394 " + (dtop >= 0 ? "+" : "\u2212") + Math.abs(dtop).toPrecision(2), ox, oy + ph + 14);""")

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("dot subsampling + delta-scaled alpha OK")
