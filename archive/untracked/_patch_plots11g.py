import io

p = "experiment_plots.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()
orig = d

def rep(old, new, n=1):
    global d
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:70])
    d = d.replace(old, new)

# only paint the top-region neuron dots when that region actually changed
# (otherwise a huge region like the optic lobe floods solid red at Δ ≈ 0)
rep("""    // firing-delta dots of the learning region on top
    const tcol = sign >= 0 ? [229, 57, 53] : [30, 136, 229];
    for (const i of order){
      const rk = ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]);
      if (rk !== top) continue;
      g.fillStyle = "rgba(" + tcol[0] + "," + tcol[1] + "," + tcol[2] + ",0.75)";
      g.fillRect(ox + pts[i*3] - 0.6, oy + pts[i*3+1] - 0.6, 1.3, 1.3);
    }""",
"""    // firing-delta dots of the learning region on top — only when the region
    // meaningfully changed (same threshold as the gray-wash tint), so a huge
    // unchanged region (e.g. the optic lobe at Δ ≈ 0) never floods solid
    if (Math.abs(acc[top] || 0) >= 0.15 * gmax){
      const tcol = sign >= 0 ? [229, 57, 53] : [30, 136, 229];
      for (const i of order){
        const rk = ANAT.npRegion.get(ANAT.meta.np_names[ANAT.prim[i]]);
        if (rk !== top) continue;
        g.fillStyle = "rgba(" + tcol[0] + "," + tcol[1] + "," + tcol[2] + ",0.75)";
        g.fillRect(ox + pts[i*3] - 0.6, oy + pts[i*3+1] - 0.6, 1.3, 1.3);
      }
    }""")

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("delta-dot threshold gate OK")
