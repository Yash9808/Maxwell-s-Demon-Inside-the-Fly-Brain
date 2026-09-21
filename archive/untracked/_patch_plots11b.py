import io

p = "experiment_plots.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()
orig = d

def rep(old, new, n=1):
    global d
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:70])
    d = d.replace(old, new)

# center the projection vertically on the brain's y-range; drop unused var
rep("""  const pw = Math.floor((W - 40) / cols) - 14, ph = H - 96;
  const cxw = (B.x0 + B.x1) / 2, czw = 0;""",
"""  const pw = Math.floor((W - 40) / cols) - 14, ph = H - 96;
  const cxw = (B.x0 + B.x1) / 2, cyw = (B.y0 + B.y1) / 2;""")

rep("""      pts[i*3] = pw / 2 + rx * s;
      pts[i*3+1] = ph / 2 - y * s;
      pts[i*3+2] = rz;""",
"""      pts[i*3] = pw / 2 + rx * s;
      pts[i*3+1] = ph / 2 - (y - cyw) * s;
      pts[i*3+2] = rz;""")

rep("""      return [ox2 + pw2 / 2 + rx * s, oy2 + ph2 / 2 - y * s];""",
"""      return [ox2 + pw2 / 2 + rx * s, oy2 + ph2 / 2 - (y - cyw) * s];""")

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("y-centering fixed OK")
