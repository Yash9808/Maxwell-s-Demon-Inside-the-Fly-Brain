import io

p = "experiment_plots.html"
d = io.open(p, "r", encoding="utf-8", newline="").read()
orig = d

def rep(old, new, n=1):
    global d
    c = d.count(old)
    assert c == n, "anchor x%d (want %d): %r" % (c, n, old[:70])
    d = d.replace(old, new)

# a) gray neuron dots drawn BEFORE the hull tints (dots at back)
rep("""    items.push({ kind: "dots", rk: null, z: 1e9 });""",
"""    items.push({ kind: "dots", rk: null, z: -1e9 });""")

# b) gentler hull tints + higher unchanged threshold (small deltas read gray)
rep("""    const tintOf = (rk) => {
      const dv = acc[rk] || 0, t = dv / gmax;
      if (Math.abs(t) < 0.06) return "rgba(140,150,165,0.16)";   // unchanged: gray
      return t > 0 ? "rgba(229,57,53," + (0.14 + 0.5 * Math.min(1, Math.abs(t))).toFixed(2) + ")"
                   : "rgba(30,136,229," + (0.14 + 0.5 * Math.min(1, Math.abs(t))).toFixed(2) + ")";
    };""",
"""    const tintOf = (rk) => {
      const dv = acc[rk] || 0, t = dv / gmax;
      if (Math.abs(t) < 0.15) return "rgba(140,150,165,0.10)";   // unchanged: gray wash
      return t > 0 ? "rgba(229,57,53," + (0.05 + 0.30 * Math.min(1, Math.abs(t))).toFixed(2) + ")"
                   : "rgba(30,136,229," + (0.05 + 0.30 * Math.min(1, Math.abs(t))).toFixed(2) + ")";
    };""")

# c) colorbar value labels were clipped at the canvas edge
rep("""  g.fillStyle = fg; g.font = "9px ui-sans-serif,system-ui";
  g.fillText("+" + gmax.toPrecision(2), cbX + 10, cbY + 8);
  g.fillText("−" + gmax.toPrecision(2), cbX + 10, cbY + cbH);""",
"""  g.fillStyle = fg; g.font = "9px ui-sans-serif,system-ui"; g.textAlign = "right";
  g.fillText("+" + gmax.toPrecision(2), cbX - 3, cbY + 8);
  g.fillText("−" + gmax.toPrecision(2), cbX - 3, cbY + cbH);
  g.textAlign = "left";""")

# d) slightly stronger ring on the most-changed region
rep("""          if (it.rk === top){ g.strokeStyle = sign >= 0 ? "rgba(255,120,110,0.8)" : "rgba(100,180,255,0.8)";
            g.lineWidth = 0.7; g.stroke(); }""",
"""          if (it.rk === top){ g.strokeStyle = sign >= 0 ? "rgba(255,120,110,0.85)" : "rgba(100,180,255,0.85)";
            g.lineWidth = 1; g.stroke(); }""")

assert d != orig
io.open(p, "w", encoding="utf-8", newline="").write(d)
print("3D figure visual tuning OK")
